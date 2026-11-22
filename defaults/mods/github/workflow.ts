// A workflow run's shape, from its files and its log: the jobs' `needs:`
// (read from the workflow file), which API job is which workflow job, the
// jobs in columns, and a job's log split into its steps. Plain functions over
// text and gh's JSON (model.ts re-exports them): no herdr imports, so
// scripts/ tests them.

import { Array as Arr, Option, Order, String as Str } from "effect";
import type { Step, Timed } from "./model.ts";

/** A job of a workflow file: its `name:` and the jobs it `needs:`. */
export interface WorkflowJob {
  name: string | null;
  needs: string[];
}

/** A job of a workflow as read back: its name and what it needs. */
export interface NeedsOf {
  readonly name: string | null;
  readonly needs: readonly string[];
}

/** A workflow's jobs by key. */
export type Needs = ReadonlyMap<string, NeedsOf>;

/** A YAML scalar without its comment and quotes. */
const clean = (v: string): string => Str.replace(/^["']|["']$/g, "")(Str.trim(Str.replace(/\s#.*$/, "")(v)));

/** A line's indent. */
const indentOf = (line: string): number => line.length - Str.trimStart(line).length;

/** A list's items, as `[a, b]` names them. */
const flowList = (v: string): string[] => Arr.filter(Arr.map(Str.split(Str.slice(1, Option.getOrElse(Str.lastIndexOf("]")(v), () => -1))(v), ","), clean), Str.isNonEmpty);

/** Where the reader is in the `jobs:` block. */
interface Reading {
  /** The job keys' indent, the current job's keys' (2 or 4 deeper, whatever the file uses). */
  indent: number | null;
  prop: number | null;
  job: WorkflowJob | null;
  /** In a block list of `needs:`. */
  list: boolean;
}

/** A line under a job: its `name:`, its `needs:` (one, a flow list, or a block list's start), or a block list's item. */
function jobLine(r: Reading, job: WorkflowJob, line: string, pad: number, prop: number): void {
  if (pad <= prop) r.list = false;

  const kv = /^\s*(name|needs):\s*(.*)$/.exec(line);

  if (pad === prop && kv !== null) {
    const v = clean(kv[2] ?? "");

    if (kv[1] === "name") job.name = Str.isEmpty(v) ? null : v;
    else if (Str.startsWith("[")(v)) job.needs = flowList(v);
    else if (Str.isNonEmpty(v)) job.needs = [v];
    else r.list = true;

    return;
  }

  if (r.list && pad > prop) {
    const item = /^\s*-\s*(.+)$/.exec(line)?.[1];

    if (item !== undefined) job.needs.push(clean(item));
  }
}

/** The `jobs:` of a workflow file: key -> { name, needs }. A tiny reader for
 *  the shapes GitHub accepts (`needs: a`, `needs: [a, b]`, a block list), at
 *  any indent; anything it can't read is left out (the graph then falls back
 *  to timing). */
export function needsFromWorkflow(yaml: string | null | undefined): Map<string, WorkflowJob> {
  const out = new Map<string, WorkflowJob>();
  const lines = Str.split(yaml ?? "", /\r?\n/);
  const start = Option.getOrElse(Arr.findFirstIndex(lines, (l) => /^jobs:\s*(#.*)?$/.test(l)), () => -1);

  if (start < 0) return out;

  const r: Reading = { indent: null, prop: null, job: null, list: false };

  for (const line of Arr.drop(lines, start + 1)) {
    if (Str.isEmpty(Str.trim(line)) || /^\s*#/.test(line)) continue;

    const pad = indentOf(line);

    if (pad === 0) break; // the next top-level key

    r.indent ??= pad;

    if (pad <= r.indent) {
      const key = /^\s*["']?([A-Za-z0-9_-]+)["']?:\s*(#.*)?$/.exec(line)?.[1];

      r.job = key !== undefined && pad === r.indent ? { name: null, needs: [] } : null;

      if (r.job !== null && key !== undefined) out.set(key, r.job);

      r.prop = null;
      r.list = false;

      continue;
    }

    if (r.job === null) continue;

    r.prop ??= pad;
    jobLine(r, r.job, line, pad, r.prop);
  }

  return out;
}

/** A `name:` as a test of the shown name: `${{ … }}` matches anything. */
function nameTest(name: string): (s: string) => boolean {
  if (!Str.includes("${{")(name)) return (s) => s === name;

  const re = new RegExp(`^${Arr.join(Arr.map(Str.split(name, /\$\{\{.*?\}\}/), (p) => Str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")(p)), ".*")}$`);

  return (s) => re.test(s);
}

/** What keyOf reads of an API job. */
export interface NamedJob {
  readonly id: number;
  readonly name?: string | null | undefined;
}

/** A name without its matrix's " (…)". */
const unmatrixed = Str.replace(/ \(.*\)$/, "");

/** Which workflow job an API job is: its key, by `name:` or key. The shown
 *  name may carry a matrix's " (…)" and, for a reusable workflow's jobs, the
 *  caller's name before " / ". The fullest form that matches any job wins,
 *  so "Deploy (prod)" finds `name: Deploy (${{ env }})` before `name: Deploy`. */
export function keyOf(job: NamedJob, needs: Needs): string | null {
  const shown = job.name ?? "";
  const caller = Str.split(shown, " / ")[0];
  const tries = Arr.dedupe([shown, caller, unmatrixed(shown), unmatrixed(caller)]);
  const tests = Arr.map(Arr.fromIterable(needs), ([key, j]) => [key, nameTest(j.name ?? key)] as const);

  for (const s of tries) for (const [key, test] of tests) if (s === key || test(s)) return key;

  return null;
}

/** Which jobs each job waits for, by `needs:`: job id -> parent job ids
 *  ([] for a first job). null when the workflow's needs aren't known (the
 *  columns then come from timing, and each column follows the one before). */
export function jobParents(jobs: readonly NamedJob[] | null | undefined, needs: Needs | null | undefined): Map<number, number[]> | null {
  if (needs === null || needs === undefined || needs.size === 0) return null;

  const list = jobs ?? [];
  const keys = Arr.map(list, (j) => keyOf(j, needs));

  if (!Arr.some(keys, (k) => k !== null)) return null;

  const byKey = new Map<string, number[]>();

  for (const [j, key] of Arr.zip(list, keys)) {
    if (key === null) continue;

    const ids = byKey.get(key) ?? [];

    byKey.set(key, ids);
    ids.push(j.id);
  }

  const out = new Map<number, number[]>();

  for (const [j, key] of Arr.zip(list, keys)) {
    out.set(j.id, key === null ? [] : Arr.flatMap(needs.get(key)?.needs ?? [], (k) => byKey.get(k) ?? []));
  }

  return out;
}

/** The jobs in columns by `needs:` (each job one past the deepest it needs), in the API's order. */
function needsColumns<J extends NamedJob>(list: readonly J[], keys: readonly (string | null)[], needs: Needs): J[][] {
  const memo = new Map<string, number>();

  const depth = (key: string, seen = new Set<string>()): number => {
    const known = memo.get(key);

    if (known !== undefined) return known;

    if (seen.has(key)) return 0;

    seen.add(key);

    const d = Math.max(-1, ...Arr.flatMap(needs.get(key)?.needs ?? [], (k) => (needs.has(k) ? [depth(k, seen)] : []))) + 1;

    memo.set(key, d);

    return d;
  };

  const cols: J[][] = [];

  for (const [j, key] of Arr.zip(list, keys)) {
    const d = key === null ? 0 : depth(key);
    const col = cols[d] ?? [];

    cols[d] = col;
    col.push(j);
  }

  // A depth no job has is a hole in the array: left out.
  return Arr.filter(cols, (col) => Arr.isArray(col));
}

/** A time GitHub wrote, in ms (NaN for none). */
const at = (v: string | null | undefined): number => (v === null || v === undefined || v === "" ? NaN : Date.parse(v));

/** A job by when it started, and where it was in the API's list. */
interface Started<J> {
  readonly j: J;
  readonly i: number;
  readonly s: number;
}

/** Jobs in the API's order. */
const byIndex = <J>(): Order.Order<Started<J>> => Order.mapInput(Order.Number, (x: Started<J>) => x.i);

/** The jobs in waves by time: a job that started after every job of a wave finished starts the next one. */
function timeColumns<J extends NamedJob & Timed>(list: readonly J[]): J[][] {
  // A job that hasn't started goes last; ties keep the API's order.
  const started = (x: Started<J>) => (Number.isNaN(x.s) || x.s === 0 ? Infinity : x.s);
  const byStart = Arr.sort(Arr.map(list, (j, i): Started<J> => ({ j, i, s: at(j.started_at) })), Order.combine(Order.mapInput(Order.Number, started), byIndex<J>()));
  const cols: Started<J>[][] = [];
  let wave: Started<J>[] = [], end = -Infinity;

  for (const x of byStart) {
    if (wave.length > 0 && Number.isFinite(x.s) && x.s >= end && Number.isFinite(end)) {
      cols.push(wave);
      wave = [];
      end = -Infinity;
    }

    wave.push(x);

    const e = at(x.j.completed_at);

    end = Number.isFinite(e) && end !== Infinity ? Math.max(end, e) : Infinity;
  }

  if (wave.length > 0) cols.push(wave);

  return Arr.map(cols, (c) => Arr.map(Arr.sort(c, byIndex<J>()), (x) => x.j));
}

/** The jobs in columns, left to right: by `needs:` when the workflow says,
 *  else in waves by time (a job that started after every job of a wave
 *  finished starts the next one). Each column keeps the API's order. */
export function jobColumns<J extends NamedJob & Timed>(jobs: readonly J[] | null | undefined, needs: Needs | null | undefined): J[][] {
  const list = jobs ?? [];

  if (list.length === 0) return [];

  const known = needs !== null && needs !== undefined && needs.size > 0 ? needs : null;
  const keys = Arr.map(list, (j) => (known === null ? null : keyOf(j, known)));

  if (known !== null && Arr.some(keys, (k) => k !== null)) return needsColumns(list, keys, known);

  return timeColumns(list);
}

// Color codes, real or as gh prints them without a terminal ("^[[36;1m").
// The escape character (27) goes in as itself: a regex literal may not name a control character.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`(?:${ESC}|\\^\\[)\\[[0-9;?]*[A-Za-z]`, "g");
const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z ?/;
const sec = (v: string | null | undefined): number => Math.floor(at(v) / 1000);
const noBom = Str.replace(/^\uFEFF/, "");

/** A log line's text (no job and step columns, no stamp, no colors) and its time in s (NaN for none). */
interface Logged {
  readonly shown: string;
  readonly ts: number;
}

/** A log line as gh prints it, as it's shown. */
function logText(raw: string): Logged {
  const parts = Str.split(raw, "\t");
  const line = noBom(parts.length >= 3 ? Arr.join(Arr.drop(parts, 2), "\t") : raw);
  const m = STAMP.exec(line);
  const ts = m === null ? NaN : Math.floor(Date.parse(`${m[1] ?? ""}Z`) / 1000);

  return { shown: Str.replace(ANSI, "")(noBom(m === null ? line : Str.slice(m[0].length)(line))), ts };
}

/** The index of the first step after `cur` that `test` takes, or -1. */
const after = (live: readonly Step[], cur: number, test: (s: Step) => boolean): number =>
  Option.getOrElse(Arr.findFirstIndex(live, (s, i) => i > cur && test(s)), () => -1);

/** The runner's own lines that open its post steps and the last one. */
function runnerOpens(shown: string): ((s: Step) => boolean) | null {
  if (shown === "Post job cleanup.") return (s) => Str.startsWith("Post ")(s.name);

  if (shown === "Cleaning up orphan processes") return (s) => s.name === "Complete job";

  return null;
}

/** The step a log line belongs to, from the step `cur` the line before was in (see splitLog). */
function stepOf(live: readonly Step[], cur: number, shown: string, ts: number): number {
  const strong = Str.startsWith("##[group]")(shown) ? after(live, cur, (s) => `##[group]${s.name}` === shown) : -1;
  const runner = runnerOpens(shown);
  const opens = runner === null ? -1 : after(live, cur, runner);

  if (strong >= 0) return strong;

  if (opens >= 0) return opens;

  if (Str.startsWith("##[group]Run ")(shown)) {
    const next = live[cur + 1];

    return next !== undefined && !Str.startsWith("Run ")(next.name) && !(ts < sec(next.started_at)) ? cur + 1 : cur;
  }

  let i = cur;

  if (Number.isFinite(ts)) {
    for (let next = live[i + 1]; next !== undefined && ts > sec(live[i]?.completed_at) && ts >= sec(next.started_at); next = live[i + 1]) i++;
  }

  return i;
}

/**
 * A job's log split into its steps: step number -> lines (no timestamps).
 * `gh run view --job <id> --log` prefixes every line "job\tstep\t" (often
 * "UNKNOWN STEP"), so lines are placed by time and markers: a
 * `##[group]<name>` naming a later step starts it (an action's step is
 * named "Run owner/action@ref", as its group is); a `##[group]Run ...` starts
 * the next step when that one has a name of its own (a `run:` with `name:`)
 * and has begun; a line later than its step's end moves on to the step
 * running then; the runner's "Post job cleanup." and "Cleaning up orphan
 * processes" open the post steps and "Complete job". Skipped steps get nothing.
 */
export function splitLog(text: string | null | undefined, steps: readonly Step[] | null | undefined): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const live = Arr.sort(Arr.filter(steps ?? [], (s) => s.conclusion !== "skipped" && (s.started_at ?? "") !== ""), Order.mapInput(Order.Number, (s: Step) => s.number));

  if (live.length === 0) return out;

  for (const s of live) out.set(s.number, []);

  let cur = 0;

  for (const whole of Str.split(text ?? "", "\n")) {
    const raw = Str.replace(/\r$/, "")(whole);

    if (Str.isEmpty(raw)) continue;

    const { shown, ts } = logText(raw);

    cur = stepOf(live, cur, shown, ts);

    const step = live[cur];

    if (step !== undefined) out.get(step.number)?.push(shown);
  }

  return out;
}

/** A log line as drawn: a group's title, an error, a warning, a notice, debug, or plain. */
export interface LogLine {
  readonly kind: "group" | "error" | "warning" | "notice" | "debug" | "plain";
  readonly text: string;
}

/** The log's markers and the kind each line starting with one is. */
const MARKS: readonly (readonly [string, LogLine["kind"] | null])[] = [
  ["##[group]", "group"], ["##[endgroup]", null], ["##[error]", "error"], ["##[warning]", "warning"], ["##[notice]", "notice"], ["##[debug]", "debug"],
];

/** How a log line looks: a group's title, an error, a warning, or plain. */
export function logLine(line: string): LogLine | null {
  const mark = Arr.findFirst(MARKS, ([m]) => Str.startsWith(m)(line));

  return Option.match(mark, {
    onNone: (): LogLine | null => ({ kind: "plain", text: Str.replaceAll("\t", "    ")(line) }),
    onSome: ([m, kind]): LogLine | null => (kind === null ? null : { kind, text: Str.slice(m.length)(line) }),
  });
}
