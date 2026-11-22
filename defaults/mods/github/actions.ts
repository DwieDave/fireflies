// The Actions tab: the repo's workflow runs down the left; on the right the
// selected run as a graph of its jobs (graph.ts), and under it the selected
// job's steps as a timeline beside the chosen step's log. Live: while
// anything shown is queued or running, reads repeat every few seconds
// (ETag'd, model.ts pollEvery); running things breathe, pulse and tick.
// A running job's log only exists once it finishes (GitHub doesn't hand out
// partial logs), so its steps move live and the log arrives at the end.
// The runs and steps lists follow their cursor (scroll handles: they move
// only as far as it takes to show the row); j / k in the log scroll it by
// lines from where the wheel left it.

import { Array as Arr, Option, Schema, Semaphore, String as Str } from "effect";
import type { Context, Element, KeyEvent, Size } from "gpui-kit";
import { h_flex, v_flex, VirtualListScrollHandle, ScrollHandle } from "gpui-base";
import type { Theme } from "herdr";
import type { Job, LogLine, Needs, NeedsOf, Run, Step } from "./model.ts";
import { JobSchema, RunSchema, maybe, pollEvery, jobColumns, jobParents, logLine } from "./model.ts";
import type { Hint } from "./kit.ts";
import { splitter, unzoom } from "./kit.ts";
import type { Parents } from "./graph.ts";
import type { Pieces } from "./cache.ts";
import { newest, LIMITS } from "./cache.ts";
import type { Waiting } from "./dispatchForm.ts";
import { DispatchForm } from "./dispatchForm.ts";
import type { Host, ReadOptions, RunFilter } from "./host.ts";
import type { KeyRow } from "@fireflies/keyhelp";
import { runsPanel, runsMenu, graphPanel, stepsPanel, logPanel } from "./actions-panels.ts";
import { pollActions, readLog } from "./actions-reads.ts";
import { ghRun } from "./gh.ts";

export const ROW = 38, STEP = 24, LINE = 18;

/** The tab's panels, in tab order. */
type Panel = "runs" | "graph" | "steps" | "log";

const PANELS: readonly Panel[] = ["runs", "graph", "steps", "log"];

/** The job graph panel's height in a right column `rightH` tall: the one
 *  Developer dragged (`stored`, kept in sizes.graph), else 55 % of the column
 *  (220..520), room for a column of six jobs (wires.ts NH, GAP_Y) without
 *  panning; the steps and the log take the rest, never less than 120. */
export function graphHeight(stored: number | null | undefined, rightH: number): number {
  const want = stored ?? Math.max(220, Math.min(rightH * 0.55, 520));

  return Math.round(Math.min(Math.max(100, rightH - 120), Math.max(100, want)));
}

const RunFilterSchema = Schema.Struct({ branch: Schema.String, label: Schema.String });

const size = Schema.optionalKey(Schema.Finite);

/** What the tab keeps in shared state between openings (main.ts STATE). */
export const ActionsKeptSchema = Schema.Struct({
  filter: Schema.optionalKey(Schema.NullOr(RunFilterSchema)), sel: Schema.optionalKey(Schema.NullOr(Schema.Finite)), jobSel: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  sizes: Schema.optionalKey(Schema.Struct({ runs: size, runsH: size, graph: size, steps: size })),
});

export type ActionsKept = typeof ActionsKeptSchema.Type;

/** The splitters' sizes, once dragged: runs (width), runsH (height, narrow), graph (height), steps (width). */
interface Sizes {
  runs?: number;
  runsH?: number;
  graph?: number;
  steps?: number;
}

/** A branch's runs as last read, with their ETag. */
interface RunsRead {
  readonly list: readonly Run[];
  readonly etag: string | null;
  readonly at: number;
}

/** A run's jobs' ETag, and when they were read. */
interface Tag {
  readonly etag: string | null;
  readonly at: number;
}

/** A finished job's log by step, or why it didn't come. */
export type JobLog = ReadonlyMap<number, string[]> | { readonly error: string };

/** A workflow job as the cache keeps it: [key, { name, needs }]. */
const NeedEntrySchema = Schema.Tuple([Schema.String, Schema.Struct({ name: Schema.NullOr(Schema.String), needs: Schema.Array(Schema.String) })]);

const runsPiece = Schema.decodeUnknownOption(Schema.Struct({ list: Schema.Array(RunSchema), etag: maybe(Schema.String), at: maybe(Schema.Finite) }));

const jobsPiece = Schema.decodeUnknownOption(Schema.Struct({ jobs: Schema.Array(JobSchema), etag: maybe(Schema.String), at: maybe(Schema.Finite) }));

const needsPiece = Schema.decodeUnknownOption(Schema.Struct({ jobs: Schema.Array(NeedEntrySchema), at: maybe(Schema.Finite) }));

/** The cache's part for this tab (cache.ts entry.actions). */
export interface ActionsCached {
  readonly runs?: Pieces | undefined;
  readonly jobs?: Pieces | undefined;
  readonly needs?: Pieces | undefined;
}

/** A run's jobs as the cache keeps them. */
interface JobsKept {
  readonly jobs: readonly Job[];
  readonly etag: string | null;
  readonly at: number;
}

/** A workflow's needs as the cache keeps them. */
interface NeedsKept {
  readonly jobs: readonly (readonly [string, NeedsOf])[];
  readonly at: number;
}

/** What the tab gives the cache: each branch's runs, the newest runs' jobs, the workflows' needs. */
export interface ActionsSnapshot {
  readonly runs: Map<string, RunsRead>;
  readonly jobs: Map<string, JobsKept>;
  readonly needs: Map<string, NeedsKept>;
}

/** Where the graph was dragged to, and where the drag started. */
interface Drag {
  readonly x: number;
  readonly y: number;
  readonly from: { readonly x: number; readonly y: number };
}

/** A run's re-run or cancel. */
type RunAction = "failed" | "all" | "cancel" | "job";

/** A run's workflow file, without a reusable workflow's `@ref`. */
export const workflowPath = (r: Run | null): string | null => (r?.path === null || r?.path === undefined ? null : Str.replace(/@.*$/, "")(r.path));

export default class Actions {
  readonly app: Host;

  /** { branch, label } or null. */
  filter: RunFilter | null;

  /** The run id. */
  sel: number | null;

  /** The job id. */
  jobSel: number | null;

  /** The step number. */
  stepSel: number | null = null;
  focus: Panel = "runs";
  runs: readonly Run[] | null = null;
  runsAt = 0;

  /** The runs list's ETag. */
  runsTag: string | null = null;

  /** Branch ("" all) -> its list's last answer. */
  runsCache = new Map<string, RunsRead>();

  /** Run id -> its jobs. */
  jobs = new Map<number, readonly Job[]>();
  jobTags = new Map<number, Tag>();

  /** `${path}@${sha}` -> the workflow's needs. */
  needs = new Map<string, Needs>();
  needsAt = new Map<string, number>();
  logs = new Map<number, JobLog>();
  logBusy = new Set<number>();

  /** Runs opened from a PR's checks that the list doesn't hold. */
  extra = new Map<number, Run>();
  runsScroll = VirtualListScrollHandle.new();
  logScroll = VirtualListScrollHandle.new();

  /** The steps list follows the chosen step. */
  stepsScroll = ScrollHandle.new();

  /** `${job}:${index}` the steps list last scrolled to. */
  stepsAt: string | null = null;

  /** The log's top line. */
  logAt = 0;

  /** Log lines that fit, from its height. */
  logVis = 20;
  graphSize: Size = { width: 600, height: 240 };

  /** Once dragged or scrolled. */
  pan: { readonly x: number; readonly y: number } | null = null;

  /** While the graph is dragged. */
  drag: Drag | null = null;
  sizes: Sizes;

  /** While a workflow run is set up. */
  flow: DispatchForm | null = null;

  /** A dispatch sent, its run not listed yet. */
  waiting: Waiting | null = null;

  /** One read of this tab at a time (the shown tab's and the read behind the other one). */
  readonly reading = Semaphore.makeUnsafe(1);

  /** The read behind the shown tab is running. */
  warming = false;

  constructor(app: Host, kept: ActionsKept = {}) {
    this.app = app;
    this.filter = kept.filter ?? null;
    this.sel = kept.sel ?? null;
    this.jobSel = kept.jobSel ?? null;
    this.sizes = { ...kept.sizes };
  }

  /** The open form (form.ts), if any: it takes the keys and the body. */
  get form() {
    return this.flow?.form ?? null;
  }

  /** No comment box or menu of its own on this tab: the window keeps the keys. */
  get composer(): boolean {
    return false;
  }

  /** n, the button, the menu, the palette: run a workflow by hand (the selected run's, when it can be). */
  runWorkflow(cx: Context): void {
    const repo = this.app.repo;

    if (repo === null) return;

    this.flow?.form.release();
    this.flow = new DispatchForm(this.app, this, repo, { path: workflowPath(this.run()) });
    this.flow.load();
    this.flow.form.go(0, cx);
  }

  closeForm(): void {
    if (this.flow !== null) this.flow.closed = true;

    this.flow = null;
    this.app.focusSelf();
  }

  save(): ActionsKept {
    return { filter: this.filter, sel: this.sel, jobSel: this.jobSel, sizes: this.sizes };
  }

  branchKey(): string {
    return this.filter?.branch ?? "";
  }

  /** Shows what an earlier opening read (cache.ts entry.actions), until GitHub answers. Each piece
   *  is decoded here: one in another shape is left out. */
  hydrate(c: ActionsCached | null | undefined): void {
    this.runsCache = new Map();

    for (const [b, piece] of c?.runs ?? []) {
      for (const l of Option.toArray(runsPiece(piece))) this.runsCache.set(b, { list: l.list, etag: l.etag ?? null, at: l.at ?? 0 });
    }

    this.useRuns();
    this.jobs = new Map();
    this.jobTags = new Map();

    for (const [id, piece] of c?.jobs ?? []) {
      for (const j of Option.toArray(jobsPiece(piece))) {
        this.jobs.set(Number(id), j.jobs);
        this.jobTags.set(Number(id), { etag: j.etag ?? null, at: j.at ?? 0 });
      }
    }

    this.needs = new Map();
    this.needsAt = new Map();

    for (const [k, piece] of c?.needs ?? []) {
      for (const n of Option.toArray(needsPiece(piece))) {
        this.needs.set(k, new Map(n.jobs));
        this.needsAt.set(k, n.at ?? 0);
      }
    }

    if (this.runs !== null && (this.sel === null || !Arr.some(this.list(), (r) => r.id === this.sel))) this.sel = this.list()[0]?.id ?? null;
  }

  /** The shown branch's cached runs (or none yet). */
  useRuns(): void {
    const l = this.runsCache.get(this.branchKey());

    this.runs = l?.list ?? null;
    this.runsTag = l?.etag ?? null;
    this.runsAt = l?.at ?? 0;
  }

  /** What's worth keeping for the next opening (slim: only what's drawn). */
  snapshot(): ActionsSnapshot {
    const jobs = new Map<string, JobsKept>();

    for (const [id, list] of this.jobs) jobs.set(String(id), { jobs: list, etag: this.jobTags.get(id)?.etag ?? null, at: this.jobTags.get(id)?.at ?? 0 });

    const needs = new Map<string, NeedsKept>();

    for (const [k, m] of this.needs) needs.set(k, { jobs: Arr.fromIterable(m), at: this.needsAt.get(k) ?? 0 });

    return { runs: newest(this.runsCache, LIMITS.runs), jobs: newest(jobs, LIMITS.jobs), needs: newest(needs, LIMITS.needs) };
  }

  /** When the shown list was read (0: never). */
  readAt(): number {
    return this.runsAt;
  }

  // ---- data

  list(): Run[] {
    const runs = this.runs ?? [];
    const more = Arr.filter(Arr.fromIterable(this.extra.values()), (r) => !Arr.some(runs, (x) => x.id === r.id));

    return [...more, ...runs];
  }

  run(): Run | null {
    const l = this.list();

    return Option.getOrNull(Arr.findFirst(l, (r) => r.id === this.sel)) ?? l[0] ?? null;
  }

  jobsOf(r: Run | null): readonly Job[] | null {
    return r === null ? null : this.jobs.get(r.id) ?? null;
  }

  job(): Job | null {
    const j = this.jobsOf(this.run()) ?? [];

    return Option.getOrNull(Arr.findFirst(j, (x) => x.id === this.jobSel)) ?? j[0] ?? null;
  }

  steps(): readonly Step[] {
    return this.job()?.steps ?? [];
  }

  step(): Step | null {
    const s = this.steps();
    const first = (test: (x: Step) => boolean) => Option.getOrNull(Arr.findFirst(s, test));

    return first((x) => x.number === this.stepSel) ?? first((x) => x.status === "in_progress") ?? first((x) => x.conclusion === "failure") ?? s[0] ?? null;
  }

  /** The run's workflow file at its commit, as the needs' key. */
  needsKey(r: Run): string {
    return `${r.path ?? ""}@${r.head_sha ?? ""}`;
  }

  columns(): Job[][] {
    const r = this.run(), jobs = this.jobsOf(r);

    if (r === null || jobs === null) return [];

    return jobColumns(jobs, this.needs.get(this.needsKey(r)) ?? null);
  }

  /** Which jobs each job waits for (null: unknown, columns follow each other). */
  parents(): Parents {
    const r = this.run(), jobs = this.jobsOf(r);

    return r !== null && jobs !== null ? jobParents(jobs, this.needs.get(this.needsKey(r)) ?? null) : null;
  }

  /** Runs and the selected run's jobs: what's moving decides the pace. */
  interval(): number {
    return pollEvery([...Arr.take(this.runs ?? [], 10), ...this.extra.values(), ...(this.jobsOf(this.run()) ?? [])]);
  }

  live(): boolean {
    return this.interval() < 10000;
  }

  /** Reads the runs, then the selected run's jobs (actions-reads.ts). `fresh`: past the ETags. */
  poll(opts: ReadOptions) {
    return pollActions(this, opts);
  }

  /** Keeps a job selected in the shown run, and (`load`) its log coming. */
  pickJob(load: boolean): void {
    const jobs = this.jobsOf(this.run());

    if (jobs === null) return;

    const first = (test: (j: Job) => boolean) => Option.getOrNull(Arr.findFirst(jobs, test));

    if (!Arr.some(jobs, (j) => j.id === this.jobSel)) this.jobSel = (first((j) => j.status === "in_progress") ?? first((j) => j.conclusion === "failure") ?? jobs[0])?.id ?? null;

    if (load) this.loadLog();
  }

  /** The selected job's log, once it's finished (kept: a finished log doesn't change). */
  loadLog(): void {
    const j = this.job(), repo = this.app.repo;

    if (j === null || repo === null || j.status !== "completed" || this.logs.has(j.id) || this.logBusy.has(j.id)) return;

    this.logBusy.add(j.id);
    this.app.run(readLog(this, repo, j.id));
  }

  // ---- moves

  selectRun(i: number): void {
    const list = this.list();

    if (list.length === 0) return;

    const k = Math.max(0, Math.min(list.length - 1, i));
    const r = list[k];

    if (r !== undefined && r.id !== this.sel) {
      this.sel = r.id;
      this.jobSel = null;
      this.stepSel = null;
      this.pan = null;
      this.app.kick();
    }

    this.runsScroll.scroll_to_item(k);
  }

  /** The selected run's place in the list (-1: none). */
  runIndex(): number {
    const list = this.list(), r = this.run();

    return r === null ? -1 : Option.getOrElse(Arr.findFirstIndex(list, (x) => x.id === r.id), () => -1);
  }

  /** From a PR's check: that run (fetched if the list doesn't have it) and job. */
  show(runId: number, jobId: number | null): void {
    if (!Arr.some(this.list(), (r) => r.id === runId)) this.extra.set(runId, { id: runId, name: "…", status: "queued", event: "", head_branch: "" });

    this.sel = runId;
    this.jobSel = jobId ?? null;
    this.stepSel = null;
    this.pan = null;
    this.focus = jobId === null ? "graph" : "steps";
    this.app.refresh(true);
  }

  showRuns(filter: RunFilter | null): void {
    this.filter = filter;
    this.sel = null;
    this.focus = "runs";
    this.useRuns();
    this.app.refresh(true);
  }

  moveJob(dx: number, dy: number): void {
    const cols = this.columns();

    if (cols.length === 0) return;

    let ci = Option.getOrElse(Arr.findFirstIndex(cols, (c) => Arr.some(c, (j) => j.id === this.jobSel)), () => -1);
    let ri = ci < 0 ? 0 : Option.getOrElse(Arr.findFirstIndex(cols[ci] ?? [], (j) => j.id === this.jobSel), () => -1);

    if (ci < 0) ci = 0;

    if (dx < 0 && ci === 0) {
      this.focus = "runs";

      return;
    }

    const len = (c: number) => cols[c]?.length ?? 0;

    if (dx !== 0) {
      const row = ri / Math.max(1, len(ci) - 1);

      ci = Math.max(0, Math.min(cols.length - 1, ci + dx));
      ri = Math.round(row * (len(ci) - 1));
    }

    if (dy !== 0) ri = Math.max(0, Math.min(len(ci) - 1, ri + dy));

    const j = cols[ci]?.[ri];

    if (j !== undefined && j.id !== this.jobSel) {
      this.jobSel = j.id;
      this.stepSel = null;
      this.logAt = 0;
      this.loadLog();
    }

    this.pan = null;
  }

  moveStep(d: number): void {
    const s = this.steps(), cur = this.step();

    if (s.length === 0) return;

    const at = cur === null ? -1 : Option.getOrElse(Arr.findFirstIndex(s, (x) => x.number === cur.number), () => -1);
    const i = Math.max(0, Math.min(s.length - 1, at + d));

    this.stepSel = s[i]?.number ?? null;
    this.logAt = 0;
    this.logScroll.scroll_to_item(0);
  }

  /** The log's top line now: the wheel moves it too, so it's read from the list. */
  logTop(): number {
    const y = this.logScroll.offset().y;

    return Number.isFinite(y) ? Math.max(0, Math.round(-unzoom(y) / LINE)) : this.logAt;
  }

  /** Scrolls the log by `d` lines (J/K a page, g/G the ends). A scroll to an
   *  item only moves as far as it takes to show that line, so going down asks
   *  for the line that ends up at the bottom edge. */
  scrollLog(d: number): void {
    const n = this.logLines().length;

    if (n === 0) return;

    const vis = Math.max(1, this.logVis);
    const top = Math.max(0, Math.min(Math.max(0, n - vis), this.logTop() + d));

    this.logAt = top;

    if (d < 0) this.logScroll.scroll_to_item(top, "top");
    else this.logScroll.scroll_to_item(Math.min(n - 1, top + vis - 1), "top");
  }

  /** The chosen step's log lines, formatted. */
  logLines(): LogLine[] {
    const j = this.job(), s = this.step(), got = j === null ? undefined : this.logs.get(j.id);

    if (got === undefined || "error" in got || s === null) return [];

    return Arr.flatMap(got.get(s.number) ?? [], (l) => Arr.fromNullishOr(logLine(l)));
  }

  act(what: RunAction, cx: Context): void {
    const r = this.run(), repo = this.app.repo;

    if (r === null || repo === null) return;

    const t = `#${r.run_number ?? ""} ${r.name ?? ""}`;
    const forget = () => this.jobs.delete(r.id);
    const gh = (args: readonly string[]) => ghRun(repo, args);

    if (what === "failed") this.app.ask(`Re-run the failed jobs of ${t}?`, () => this.app.act(gh(["run", "rerun", String(r.id), "--failed"]), `Re-running failed jobs of ${t}.`, cx, forget));
    else if (what === "all") this.app.ask(`Re-run every job of ${t}?`, () => this.app.act(gh(["run", "rerun", String(r.id)]), `Re-running ${t}.`, cx, forget));
    else if (what === "cancel") this.app.ask(`Cancel ${t}?`, () => this.app.act(gh(["run", "cancel", String(r.id)]), `Cancelling ${t}.`, cx));
    else {
      const j = this.job();

      if (j !== null) this.app.ask(`Re-run the job "${j.name ?? ""}"?`, () => this.app.act(gh(["run", "rerun", "--job", String(j.id)]), `Re-running ${j.name ?? ""}.`, cx, forget));
    }
  }

  /** The keys that move inside the focused panel; true when one was used. */
  moveKey(k: string): boolean {
    const f = this.focus, i = this.runIndex();
    const down = k === "j" || k === "down", up = k === "k" || k === "up", left = k === "h" || k === "left", right = k === "l" || k === "right";
    const top = k === "g" || k === "home", end = k === "G" || k === "end";

    if (f === "runs" && (down || up)) this.selectRun(i + (down ? 1 : -1));
    else if (f === "runs" && (top || end)) this.selectRun(top ? 0 : this.list().length - 1);
    else if (f === "runs" && (right || k === "enter")) this.focus = "graph";
    else if (f === "graph" && (left || right)) this.moveJob(left ? -1 : 1, 0);
    else if (f === "graph" && (down || up)) this.moveJob(0, down ? 1 : -1);
    else if (f === "graph" && k === "enter") this.focus = "steps";
    else if (f === "steps" && (down || up)) this.moveStep(down ? 1 : -1);
    else if (f === "steps" && left) this.focus = "graph";
    else if (f === "steps" && (right || k === "enter")) this.focus = "log";
    else if (f === "log" && (down || up)) this.scrollLog(down ? 3 : -3);
    else if (f === "log" && left) this.focus = "steps";
    else if (f === "log" && (top || end)) this.scrollLog(top ? -1e9 : 1e9);
    else return false;

    return true;
  }

  key(k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    const r = this.run();
    const at = Option.getOrElse(Arr.findFirstIndex(PANELS, (p) => p === this.focus), () => 0);
    const f = this.focus;

    if (k === "tab") this.focus = PANELS[(at + (e.modifiers.shift ? PANELS.length - 1 : 1)) % PANELS.length] ?? f;
    else if (k === "escape" && f !== "runs") this.focus = PANELS[at - 1] ?? "runs";
    else if (this.moveKey(k)) { /* moved */ }
    else if (k === "J" || k === "pagedown") this.scrollLog(20);
    else if (k === "K" || k === "pageup") this.scrollLog(-20);
    else if (k === "w") this.nextRunning();
    else if (k === "n") this.runWorkflow(cx);
    else if (k === "R") this.act("failed", cx);
    else if (k === "A") this.act("all", cx);
    else if (k === "X") this.act("cancel", cx);
    else if (k === "e" && f !== "runs") this.act("job", cx);
    else if (k === "m") runsMenu(this);
    else if (k === "b") {
      const branch = this.app.repo?.branch ?? null;

      this.showRuns(this.filter !== null || branch === null || branch === "" ? null : { branch, label: branch });
    } else if (k === "o" && r !== null) {
      const j = f === "runs" ? null : this.job();
      const url = j?.html_url ?? r.html_url ?? null;

      if (url !== null && url !== "") this.app.openUrl(url, cx);
    } else return false;

    return true;
  }

  /** w: the next run (from the selected one) that's running, else the next running job. */
  nextRunning(): void {
    const list = this.list(), i = this.runIndex();
    const next = Arr.findFirst([...Arr.drop(list, i + 1), ...Arr.take(list, i + 1)], (x) => x.status === "in_progress" || x.status === "queued");

    for (const r of Option.toArray(next)) {
      this.selectRun(Option.getOrElse(Arr.findFirstIndex(list, (x) => x.id === r.id), () => 0));
      this.focus = "graph";
    }
  }

  hints(): Hint[] {
    if (this.form !== null) return this.form.hints();

    const f = this.focus;

    if (f === "runs") return [["j/k", "run"], ["l", "jobs"], ["n", "run workflow"], ["w", "next live"], ["b", this.filter === null ? "this branch" : "all runs"], ["R", "re-run failed"], ["X", "cancel"], ["?", "keys"]];

    if (f === "graph") return [["hjkl", "job"], ["enter", "steps"], ["e", "re-run job"], ["R", "re-run failed"], ["o", "browser"], ["?", "keys"]];

    if (f === "steps") return [["j/k", "step"], ["l", "log"], ["J/K", "scroll log"], ["h", "jobs"], ["?", "keys"]];

    return [["j/k", "scroll"], ["J/K", "page"], ["g/G", "top/end"], ["h", "steps"], ["?", "keys"]];
  }

  static help(): KeyRow[] {
    return [
      ["j k ↓ ↑", "move: runs, steps; scroll the log"], ["h l ← →", "out / in: runs → jobs → steps → log"], ["hjkl (jobs)", "move through the graph"],
      ["enter tab ⇧tab", "in / next / previous panel"], ["esc", "back out"], ["J K pgdn pgup", "page the log"], ["g G home end", "first / last"],
      ["w", "next running run"], ["n", "run a workflow by hand (workflow_dispatch)"], ["b", "this branch's runs / all"], ["R", "re-run failed jobs"], ["A", "re-run all"], ["e", "re-run this job"],
      ["X", "cancel the run"], ["m", "the run's menu"], ["o", "in the browser"], ["r", "refresh now"],
      ["drag scroll", "move the graph (double-click: back)"],
    ];
  }

  // ---- drawing (actions-panels.ts)

  /** The steps panel (tests draw it alone). */
  stepsPanel(t: Theme): Element {
    return stepsPanel(this, t);
  }

  render(t: Theme, size: Size): Element {
    if (this.form !== null) return this.form.render(t, size);

    const app = this.app, wide = size.width >= 820;
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(lo, hi), Math.max(lo, v)));
    const rw = clamp(this.sizes.runs ?? Math.min(400, Math.max(280, size.width * 0.3)), 200, size.width - 420);
    const rh = clamp(this.sizes.runsH ?? size.height * 0.3, 100, size.height - 260);
    const rightW = wide ? size.width - rw - 6 : size.width;
    const rightH = wide ? size.height : size.height - rh - 6;
    const gh = graphHeight(this.sizes.graph, rightH);
    const sw = clamp(this.sizes.steps ?? Math.max(240, Math.min(360, size.width * 0.3)), 160, rightW - 200);
    const runs = runsPanel(this, t);

    const right = v_flex().flex_1().min_w(0).min_h(0).h_full()
      .child(graphPanel(this, t).h(gh).flex_none())
      .child(splitter(t, "act-split-graph", "y", app.dragged("graph"), (e) => app.resize(e, "graph", "y", gh, (v) => {
        this.sizes.graph = v;
      }, { min: 100, max: rightH - 120 })))
      .child(h_flex().flex_1().min_h(0)
        .child(stepsPanel(this, t).w(sw).flex_none().h_full())
        .child(splitter(t, "act-split-steps", "x", app.dragged("steps"), (e) => app.resize(e, "steps", "x", sw, (v) => {
          this.sizes.steps = v;
        }, { min: 160, max: rightW - 200 })))
        .child(logPanel(this, t).flex_1().h_full()));

    if (!wide) {
      return v_flex().size_full()
        .child(runs.h(rh).flex_none())
        .child(splitter(t, "act-split-runs-h", "y", app.dragged("runsH"), (e) => app.resize(e, "runsH", "y", rh, (v) => {
          this.sizes.runsH = v;
        }, { min: 100, max: size.height - 260 })))
        .child(right);
    }

    return h_flex().size_full()
      .child(runs.w(rw).flex_none().h_full())
      .child(splitter(t, "act-split-runs", "x", app.dragged("runs"), (e) => app.resize(e, "runs", "x", rw, (v) => {
        this.sizes.runs = v;
      }, { min: 200, max: size.width - 420 })))
      .child(right);
  }
}
