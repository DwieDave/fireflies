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

import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent, Size } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle, ScrollHandle } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, nullable, object } from "./guard.ts";
import { isList, maybe } from "./guards.ts";
import { api, ghRun, fileAt, slimmed } from "./gh.ts";
import type { Job, LogLine, Needs, NeedsOf, Run, Step } from "./model.ts";
import { tone, pollEvery, duration, ago, jobColumns, jobParents, needsFromWorkflow, splitLog, logLine, isRunList, isRuns, isRun, isJobList, isJobs, isJob } from "./model.ts";
import type { Hint } from "./kit.ts";
import { dither, pip, panel, empty, band, TONE_WORD, sweep, stop, splitter, unzoom, unzoomSize, chip } from "./kit.ts";
import type { Parents } from "./graph.ts";
import { canvas, layout, NW, NH } from "./graph.ts";
import type { Pieces } from "./cache.ts";
import { slimRun, slimJob, newest, LIMITS } from "./cache.ts";
import type { Waiting } from "./dispatchForm.ts";
import { DispatchForm } from "./dispatchForm.ts";
import type { Host, PickRow, ReadOptions, RunFilter } from "./host.ts";
import type { KeyRow } from "./keyhelp.ts";

const ROW = 38, STEP = 24, LINE = 18;

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

const isRunFilter = object({ branch: isString, label: isString });

/** What the tab keeps in shared state between openings (main.ts STATE). */
export const isActionsKept = object({}, {
  filter: nullable(isRunFilter), sel: nullable(isNumber), jobSel: nullable(isNumber),
  sizes: object({}, { runs: isNumber, runsH: isNumber, graph: isNumber, steps: isNumber }),
});

export type ActionsKept = Guarded<typeof isActionsKept>;

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
type JobLog = ReadonlyMap<number, string[]> | { readonly error: string };

/** A workflow job as the cache keeps it: [key, { name, needs }]. */
const isNeedsOf = object({ name: nullable(isString), needs: arrayOf(isString) });

const isNeedEntry: Guard<readonly [string, NeedsOf]> = (value: unknown): value is readonly [string, NeedsOf] =>
  isList(value) && value.length === 2 && isString(value[0]) && isNeedsOf(value[1]);

const isRunsPiece = object({ list: arrayOf(isRun) }, { etag: maybe(isString), at: maybe(isNumber) });

const isJobsPiece = object({ jobs: arrayOf(isJob) }, { etag: maybe(isString), at: maybe(isNumber) });

const isNeedsPiece = object({ jobs: arrayOf(isNeedEntry) }, { at: maybe(isNumber) });

/** The cache's part for this tab (cache.ts entry.actions). */
export interface ActionsCached {
  readonly runs?: Pieces | undefined;
  readonly jobs?: Pieces | undefined;
  readonly needs?: Pieces | undefined;
}

/** What the tab gives the cache: each branch's runs, the newest runs' jobs, the workflows' needs. */
export interface ActionsSnapshot {
  readonly runs: Map<string, RunsRead>;
  readonly jobs: Map<string, { readonly jobs: readonly Job[]; readonly etag: string | null; readonly at: number }>;
  readonly needs: Map<string, { readonly jobs: readonly (readonly [string, NeedsOf])[]; readonly at: number }>;
}

/** Where the graph was dragged to, and where the drag started. */
interface Drag {
  readonly x: number;
  readonly y: number;
  readonly from: { readonly x: number; readonly y: number };
}

/** A run's re-run or cancel. */
type RunAction = "failed" | "all" | "cancel" | "job";

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

  /** The other tab's read behind this one, while it runs. */
  warming: Promise<void> | null = null;

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

  /** n, the button, the menu, the palette: run a workflow by hand (the selected run's, when it can be). */
  runWorkflow(cx: Context): void {
    const repo = this.app.repo;

    if (!repo) return;

    this.flow?.form.release();
    this.flow = new DispatchForm(this.app, this, repo, { path: this.run()?.path?.replace(/@.*$/, "") ?? null });
    this.flow.load(cx);
    this.flow.form.go(0, cx);
  }

  closeForm(): void {
    if (this.flow) this.flow.closed = true;

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
   *  is proven here: one in another shape is left out. */
  hydrate(c: ActionsCached | null | undefined): void {
    this.runsCache = new Map();

    for (const [b, l] of c?.runs ?? []) if (isRunsPiece(l)) this.runsCache.set(b, { list: l.list, etag: l.etag ?? null, at: l.at ?? 0 });

    this.useRuns();
    this.jobs = new Map();
    this.jobTags = new Map();

    for (const [id, j] of c?.jobs ?? []) {
      if (!isJobsPiece(j)) continue;

      this.jobs.set(Number(id), j.jobs);
      this.jobTags.set(Number(id), { etag: j.etag ?? null, at: j.at ?? 0 });
    }

    this.needs = new Map();
    this.needsAt = new Map();

    for (const [k, n] of c?.needs ?? []) {
      if (!isNeedsPiece(n)) continue;

      this.needs.set(k, new Map(n.jobs));
      this.needsAt.set(k, n.at ?? 0);
    }

    if (this.runs && (this.sel === null || !this.list().some((r) => r.id === this.sel))) this.sel = this.list()[0]?.id ?? null;
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
    const jobs = new Map<string, { readonly jobs: readonly Job[]; readonly etag: string | null; readonly at: number }>();

    for (const [id, list] of this.jobs) jobs.set(String(id), { jobs: list, etag: this.jobTags.get(id)?.etag ?? null, at: this.jobTags.get(id)?.at ?? 0 });

    const needs = new Map<string, { readonly jobs: readonly (readonly [string, NeedsOf])[]; readonly at: number }>();

    for (const [k, m] of this.needs) needs.set(k, { jobs: [...m], at: this.needsAt.get(k) ?? 0 });

    return { runs: newest(this.runsCache, LIMITS.runs), jobs: newest(jobs, LIMITS.jobs), needs: newest(needs, LIMITS.needs) };
  }

  /** When the shown list was read (0: never). */
  readAt(): number {
    return this.runsAt;
  }

  // ---- data

  list(): Run[] {
    const runs = this.runs ?? [];
    const more = [...this.extra.values()].filter((r) => !runs.some((x) => x.id === r.id));

    return [...more, ...runs];
  }

  run(): Run | null {
    const l = this.list();

    return l.find((r) => r.id === this.sel) ?? l[0] ?? null;
  }

  jobsOf(r: Run | null): readonly Job[] | null {
    return r ? this.jobs.get(r.id) ?? null : null;
  }

  job(): Job | null {
    const j = this.jobsOf(this.run()) ?? [];

    return j.find((x) => x.id === this.jobSel) ?? j[0] ?? null;
  }

  steps(): readonly Step[] {
    return this.job()?.steps ?? [];
  }

  step(): Step | null {
    const s = this.steps();

    return s.find((x) => x.number === this.stepSel) ?? s.find((x) => x.status === "in_progress") ?? s.find((x) => x.conclusion === "failure") ?? s[0] ?? null;
  }

  /** The run's workflow file at its commit, as the needs' key. */
  needsKey(r: Run): string {
    return `${r.path ?? ""}@${r.head_sha ?? ""}`;
  }

  columns(): Job[][] {
    const r = this.run(), jobs = this.jobsOf(r);

    if (!r || !jobs) return [];

    return jobColumns(jobs, this.needs.get(this.needsKey(r)) ?? null);
  }

  /** Which jobs each job waits for (null: unknown, columns follow each other). */
  parents(): Parents {
    const r = this.run(), jobs = this.jobsOf(r);

    return r && jobs ? jobParents(jobs, this.needs.get(this.needsKey(r)) ?? null) : null;
  }

  /** Runs and the selected run's jobs: what's moving decides the pace. */
  interval(): number {
    return pollEvery([...(this.runs ?? []).slice(0, 10), ...this.extra.values(), ...(this.jobsOf(this.run()) ?? [])]);
  }

  live(): boolean {
    return this.interval() < 10000;
  }

  /** Reads the runs, then the selected run's jobs (and its workflow, at once).
   *  all: past the timers; fresh: past the ETags. */
  async poll({ fresh = false }: ReadOptions, cx: Context | null): Promise<void> {
    const repo = this.app.repo;

    if (!repo) return;

    const branch = this.branchKey();
    const q = branch ? `&branch=${encodeURIComponent(branch)}` : "";
    const kept = this.runsCache.get(branch);
    // The selected run's jobs are read with the list when the cache already knows the run.
    const early = this.run();
    const jobs = early ? this.pollRun(fresh, cx, early) : null;

    jobs?.catch(() => {});

    const [{ data, etag }] = await Promise.all([
      api(repo, `repos/${repo.full}/actions/runs?per_page=40${q}`, slimmed(isRunList, (d) => (d.workflow_runs ?? []).map(slimRun), isRuns), { fresh, prior: kept?.etag ? { etag: kept.etag, data: kept.list } : null }),
      ...[...this.extra.keys()].map((id) => api(repo, `repos/${repo.full}/actions/runs/${id}`, slimmed(isRun, slimRun, isRun)).then((r) => {
        if (r.data) this.extra.set(id, r.data);
      }).catch(() => null)),
    ]);

    if (this.app.repo !== repo || this.branchKey() !== branch) return;

    this.runsCache.set(branch, { list: data ?? [], etag, at: Date.now() });
    this.useRuns();

    if (this.sel === null || !this.list().some((r) => r.id === this.sel)) this.sel = this.list()[0]?.id ?? null;

    cx?.notify();
    await jobs;

    const now = this.run();

    if (now && now.id !== early?.id) await this.pollRun(fresh, cx, now);
    else if (early && now) this.pickJob(null);
  }

  async pollRun(fresh: boolean, cx: Context | null, r: Run | null = this.run()): Promise<void> {
    const repo = this.app.repo;

    if (!repo || !r) return;

    const key = this.needsKey(r);
    const tag = this.jobTags.get(r.id), had = this.jobs.get(r.id);
    const workflow = r.path && !this.needs.has(key) ? fileAt(repo, r.path.replace(/@.*$/, ""), r.head_sha ?? "") : null;

    const [{ data, etag }, yaml] = await Promise.all([
      api(repo, `repos/${repo.full}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`, slimmed(isJobList, (d) => (d.jobs ?? []).map(slimJob), isJobs), { fresh, prior: tag?.etag && had ? { etag: tag.etag, data: had } : null }),
      workflow,
    ]);

    if (this.app.repo !== repo) return;

    this.jobs.set(r.id, data ?? []);
    this.jobTags.set(r.id, { etag, at: Date.now() });

    if (this.jobs.size > LIMITS.jobs * 2) {
      const keep = new Set([...this.jobTags].sort((a, b) => b[1].at - a[1].at).slice(0, LIMITS.jobs).map(([id]) => id));

      for (const id of this.jobs.keys()) {
        if (keep.has(id)) continue;

        this.jobs.delete(id);
        this.jobTags.delete(id);
      }
    }

    if (workflow) {
      this.needs.set(key, yaml ? needsFromWorkflow(yaml) : new Map());
      this.needsAt.set(key, Date.now());
    }

    if (r.id === this.run()?.id) this.pickJob(cx);
  }

  /** Keeps a job selected in the shown run, and its log coming. */
  pickJob(cx: Context | null): void {
    const jobs = this.jobsOf(this.run());

    if (!jobs) return;

    if (!jobs.some((j) => j.id === this.jobSel)) this.jobSel = (jobs.find((j) => j.status === "in_progress") ?? jobs.find((j) => j.conclusion === "failure") ?? jobs[0])?.id ?? null;

    if (cx) this.loadLog(cx);
  }

  /** The selected job's log, once it's finished (kept: a finished log doesn't change). */
  loadLog(cx: Context): void {
    const j = this.job(), repo = this.app.repo;

    if (!j || !repo || j.status !== "completed" || this.logs.has(j.id) || this.logBusy.has(j.id)) return;

    this.logBusy.add(j.id);
    this.app.spawn(cx, async () => {
      const r = await ghRun(repo, ["run", "view", "--job", String(j.id), "--log"], { timeout: 90000 });

      this.logs.set(j.id, r.ok ? splitLog(r.out, j.steps ?? []) : { error: r.err });
      this.logBusy.delete(j.id);
    });
  }

  // ---- moves

  selectRun(i: number, cx: Context): void {
    const list = this.list();

    if (!list.length) return;

    const k = Math.max(0, Math.min(list.length - 1, i));
    const r = list[k];

    if (r && r.id !== this.sel) {
      this.sel = r.id;
      this.jobSel = null;
      this.stepSel = null;
      this.pan = null;
      this.app.kick(cx);
    }

    this.runsScroll.scroll_to_item(k);
  }

  /** From a PR's check: that run (fetched if the list doesn't have it) and job. */
  show(runId: number, jobId: number | null, cx: Context): void {
    if (!this.list().some((r) => r.id === runId)) this.extra.set(runId, { id: runId, name: "…", status: "queued", event: "", head_branch: "" });

    this.sel = runId;
    this.jobSel = jobId ?? null;
    this.stepSel = null;
    this.pan = null;
    this.focus = jobId ? "steps" : "graph";
    this.app.refresh(cx, true);
  }

  showRuns(filter: RunFilter | null, cx: Context): void {
    this.filter = filter;
    this.sel = null;
    this.focus = "runs";
    this.useRuns();
    this.app.refresh(cx, true);
  }

  moveJob(dx: number, dy: number, cx: Context): void {
    const cols = this.columns();

    if (!cols.length) return;

    let ci = cols.findIndex((c) => c.some((j) => j.id === this.jobSel));
    let ri = ci < 0 ? 0 : (cols[ci] ?? []).findIndex((j) => j.id === this.jobSel);

    if (ci < 0) ci = 0;

    if (dx < 0 && ci === 0) {
      this.focus = "runs";

      return;
    }

    const len = (c: number) => cols[c]?.length ?? 0;

    if (dx) {
      const row = ri / Math.max(1, len(ci) - 1);

      ci = Math.max(0, Math.min(cols.length - 1, ci + dx));
      ri = Math.round(row * (len(ci) - 1));
    }

    if (dy) ri = Math.max(0, Math.min(len(ci) - 1, ri + dy));

    const j = cols[ci]?.[ri];

    if (j && j.id !== this.jobSel) {
      this.jobSel = j.id;
      this.stepSel = null;
      this.logAt = 0;
      this.loadLog(cx);
    }

    this.pan = null;
  }

  moveStep(d: number): void {
    const s = this.steps(), cur = this.step();

    if (!s.length) return;

    const i = Math.max(0, Math.min(s.length - 1, (cur ? s.indexOf(cur) : -1) + d));

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

    if (!n) return;

    const vis = Math.max(1, this.logVis);
    const top = Math.max(0, Math.min(Math.max(0, n - vis), this.logTop() + d));

    this.logAt = top;

    if (d < 0) this.logScroll.scroll_to_item(top, "top");
    else this.logScroll.scroll_to_item(Math.min(n - 1, top + vis - 1), "top");
  }

  /** The chosen step's log lines, formatted. */
  logLines(): LogLine[] {
    const j = this.job(), s = this.step(), got = j ? this.logs.get(j.id) : undefined;

    if (!got || "error" in got || !s) return [];

    return (got.get(s.number) ?? []).flatMap((l) => {
      const line = logLine(l);

      return line ? [line] : [];
    });
  }

  act(what: RunAction, cx: Context): void {
    const r = this.run(), repo = this.app.repo;

    if (!r || !repo) return;

    const t = `#${r.run_number ?? ""} ${r.name ?? ""}`;
    const forget = () => this.jobs.delete(r.id);

    if (what === "failed") this.app.ask(`Re-run the failed jobs of ${t}?`, () => this.app.act(ghRun(repo, ["run", "rerun", String(r.id), "--failed"]), `Re-running failed jobs of ${t}.`, cx, forget));
    else if (what === "all") this.app.ask(`Re-run every job of ${t}?`, () => this.app.act(ghRun(repo, ["run", "rerun", String(r.id)]), `Re-running ${t}.`, cx, forget));
    else if (what === "cancel") this.app.ask(`Cancel ${t}?`, () => this.app.act(ghRun(repo, ["run", "cancel", String(r.id)]), `Cancelling ${t}.`, cx));
    else {
      const j = this.job();

      if (j) this.app.ask(`Re-run the job "${j.name ?? ""}"?`, () => this.app.act(ghRun(repo, ["run", "rerun", "--job", String(j.id)]), `Re-running ${j.name ?? ""}.`, cx, forget));
    }
  }

  key(k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    const list = this.list(), r = this.run(), i = r ? list.indexOf(r) : -1;
    const at = PANELS.indexOf(this.focus);
    const f = this.focus;

    if (k === "tab") this.focus = PANELS[(at + (e.modifiers.shift ? PANELS.length - 1 : 1)) % PANELS.length] ?? f;
    else if (k === "escape" && f !== "runs") this.focus = PANELS[at - 1] ?? "runs";
    else if (f === "runs" && (k === "j" || k === "down")) this.selectRun(i + 1, cx);
    else if (f === "runs" && (k === "k" || k === "up")) this.selectRun(i - 1, cx);
    else if (f === "runs" && (k === "g" || k === "home")) this.selectRun(0, cx);
    else if (f === "runs" && (k === "G" || k === "end")) this.selectRun(list.length - 1, cx);
    else if (f === "runs" && (k === "l" || k === "right" || k === "enter")) this.focus = "graph";
    else if (f === "graph" && (k === "h" || k === "left")) this.moveJob(-1, 0, cx);
    else if (f === "graph" && (k === "l" || k === "right")) this.moveJob(1, 0, cx);
    else if (f === "graph" && (k === "j" || k === "down")) this.moveJob(0, 1, cx);
    else if (f === "graph" && (k === "k" || k === "up")) this.moveJob(0, -1, cx);
    else if (f === "graph" && k === "enter") this.focus = "steps";
    else if (f === "steps" && (k === "j" || k === "down")) this.moveStep(1);
    else if (f === "steps" && (k === "k" || k === "up")) this.moveStep(-1);
    else if (f === "steps" && (k === "h" || k === "left")) this.focus = "graph";
    else if (f === "steps" && (k === "l" || k === "right" || k === "enter")) this.focus = "log";
    else if (f === "log" && (k === "j" || k === "down")) this.scrollLog(3);
    else if (f === "log" && (k === "k" || k === "up")) this.scrollLog(-3);
    else if (f === "log" && (k === "h" || k === "left")) this.focus = "steps";
    else if (f === "log" && (k === "g" || k === "home")) this.scrollLog(-1e9);
    else if (f === "log" && (k === "G" || k === "end")) this.scrollLog(1e9);
    else if (k === "J" || k === "pagedown") this.scrollLog(20);
    else if (k === "K" || k === "pageup") this.scrollLog(-20);
    else if (k === "w") this.nextRunning(cx);
    else if (k === "n") this.runWorkflow(cx);
    else if (k === "R") this.act("failed", cx);
    else if (k === "A") this.act("all", cx);
    else if (k === "X") this.act("cancel", cx);
    else if (k === "e" && f !== "runs") this.act("job", cx);
    else if (k === "b") {
      const branch = this.app.repo?.branch;

      this.showRuns(this.filter ? null : branch ? { branch, label: branch } : null, cx);
    } else if (k === "o" && r) {
      const j = f !== "runs" ? this.job() : null;
      const url = j?.html_url ?? r.html_url;

      if (url) this.app.openUrl(url, cx);
    } else return false;

    return true;
  }

  /** w: the next run (from the selected one) that's running, else the next running job. */
  nextRunning(cx: Context): void {
    const list = this.list(), r = this.run(), i = r ? list.indexOf(r) : -1;
    const next = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((x) => x.status === "in_progress" || x.status === "queued");

    if (next) {
      this.selectRun(list.indexOf(next), cx);
      this.focus = "graph";
    }
  }

  hints(): Hint[] {
    if (this.form) return this.form.hints();

    const f = this.focus;

    if (f === "runs") return [["j/k", "run"], ["l", "jobs"], ["n", "run workflow"], ["w", "next live"], ["b", this.filter ? "all runs" : "this branch"], ["R", "re-run failed"], ["X", "cancel"], ["?", "keys"]];

    if (f === "graph") return [["hjkl", "job"], ["enter", "steps"], ["e", "re-run job"], ["R", "re-run failed"], ["o", "browser"], ["?", "keys"]];

    if (f === "steps") return [["j/k", "step"], ["l", "log"], ["J/K", "scroll log"], ["h", "jobs"], ["?", "keys"]];

    return [["j/k", "scroll"], ["J/K", "page"], ["g/G", "top/end"], ["h", "steps"], ["?", "keys"]];
  }

  static help(): KeyRow[] {
    return [
      ["j k ↓ ↑", "move: runs, steps; scroll the log"], ["h l ← →", "out / in: runs → jobs → steps → log"], ["hjkl (jobs)", "move through the graph"],
      ["enter tab ⇧tab", "in / next / previous panel"], ["esc", "back out"], ["J K pgdn pgup", "page the log"], ["g G home end", "first / last"],
      ["w", "next running run"], ["n", "run a workflow by hand (workflow_dispatch)"], ["b", "this branch's runs / all"], ["R", "re-run failed jobs"], ["A", "re-run all"], ["e", "re-run this job"],
      ["X", "cancel the run"], ["o", "in the browser"], ["r", "refresh now"],
      ["drag scroll", "move the graph (double-click: back)"],
    ];
  }

  // ---- drawing

  runRow(t: Theme, r: Run, sel: boolean, active: boolean): Element {
    const k = tone(r.status, r.conclusion);
    const live = k === "working" || k === "queued";

    return v_flex().id(`run-${r.id}`).relative().h(ROW).w_full().pl(10).pr(8).justify_center().flex_none().overflow_hidden()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .when(sel, (el) => el.children(band(t, active)))
      .when(k === "working", (el) => el.child(sweep(t, t.working, 420)))
      .child(h_flex().relative().gap(7).items_center().text_size(12)
        .child(pip(t, k, 7))
        .child(div().flex_none().text_color(sel ? t.foreground : t.muted).child(r.name ?? ""))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.display_title ?? "")))
      .child(h_flex().relative().gap(6).pl(14).items_center().text_size(10).text_color(t.dim)
        .child(div().flex_none().text_color(sel ? t.accent : t.ansi8).child(`#${r.run_number ?? ""}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.ansi5).child(r.head_branch ?? ""))
        .child(div().flex_none().child(r.event ?? ""))
        .child(div().flex_none().text_color(live ? t.working : t.dim).child(live ? duration(r.run_started_at, null) : TONE_WORD[k] === "passed" ? ago(r.updated_at) : TONE_WORD[k])));
  }

  runsPanel(t: Theme): Element {
    const list = this.list(), cur = this.run(), active = this.focus === "runs";

    const body = !this.runs ? empty(t, "Reading runs…", null, { small: true })
      : !list.length ? empty(t, "No runs", this.filter ? `Nothing ran on ${this.filter.label}. b shows every run.` : "This repo hasn't run a workflow yet.", { moon: 1 })
      : div().size_full().pt(2)
        .on_mouse_down("left", (_e, cx) => {
          this.focus = "runs";
          this.app.focusSelf();
          cx.stop_propagation();
        })
        .child(v_virtual_list("runs", list.length, ROW, (i) => String(list[i]?.id ?? i),
          (range) => list.slice(range.start, range.end).map((r) => this.runRow(t, r, r === cur, active)))
          .on_item_click((key, cx) => {
            this.focus = "runs";
            this.selectRun(list.findIndex((r) => String(r.id) === key), cx);
            cx.notify();
          })
          .size_full().track_scroll(this.runsScroll));

    const running = list.filter((r) => r.status === "in_progress").length;

    const right = h_flex().gap(6).items_center()
      .child(div().text_color(this.waiting ? t.working : t.dim).child(this.waiting ? "waiting for the run…" : running ? `${running} running` : this.runs ? `${list.length}` : ""))
      .child(chip(t, "run-workflow", "▶ run workflow", false, (cx) => this.runWorkflow(cx), t.accent));

    return panel(t, "runs", this.filter ? `Runs · ${this.filter.label}` : "Runs", active, body, { right })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menu();
        cx.notify();
      });
  }

  /** Right-click on the runs: what can be done from here. */
  menu(): void {
    const r = this.run();
    const rows: PickRow[] = [{ label: "Run a workflow…", sub: "n", go: (cx) => this.runWorkflow(cx) }];

    if (r) {
      const n = r.run_number ?? "";

      rows.push({ label: `Re-run the failed jobs of #${n}`, sub: "R", go: (cx) => this.act("failed", cx) },
        { label: `Re-run #${n}`, sub: "A", go: (cx) => this.act("all", cx) },
        { label: `Cancel #${n}`, sub: "X", go: (cx) => this.act("cancel", cx) },
        {
          label: `#${n} in the browser`, sub: "o", go: (cx) => {
            if (r.html_url) this.app.openUrl(r.html_url, cx);
          },
        });
    }

    this.app.picker = { title: "ACTIONS", at: 0, rows };
  }

  graphPanel(t: Theme): Element {
    const r = this.run(), cols = this.columns(), active = this.focus === "graph";
    const title = r ? `${r.name ?? ""} #${r.run_number ?? ""}` : "Run";

    if (!r) return panel(t, "graph", title, active, empty(t, "No run selected", null, { small: true }));

    if (!this.jobsOf(r)) return panel(t, "graph", title, active, empty(t, "Reading jobs…", null, { small: true }));

    if (!cols.length) return panel(t, "graph", title, active, empty(t, "No jobs yet", "The run hasn't started its jobs.", { small: true }));

    // Keep the selected job in view: pan only as far as needed.
    const g = layout(cols, this.parents(), r);
    const n = g.nodes.find((x) => x.job.id === this.jobSel);
    const { width: W, height: H } = this.graphSize;
    let px = g.width <= W ? Math.round((W - g.width) / 2) : 0, py = g.height <= H ? Math.round((H - g.height) / 2) : 0;

    if (n && g.width > W) px = Math.min(0, Math.max(W - g.width, Math.round(W / 2 - (n.x + NW / 2))));

    if (n && g.height > H) py = Math.min(0, Math.max(H - g.height, Math.round(H / 2 - (n.y + NH / 2))));

    if (this.pan) {
      px = this.pan.x;
      py = this.pan.y;
    }

    const c = canvas(t, r, cols, this.parents(), this.jobSel, active, (node, cx) => {
      this.focus = "graph";
      this.jobSel = node.job.id;
      this.stepSel = null;
      this.loadLog(cx);
      this.app.focusSelf();
      cx.notify();
    }, px, py);

    const k = tone(r.status, r.conclusion);

    // Drag the sky (or scroll) to move the graph; double-click it to bring the selected job back.
    const end = (cx: Context) => {
      if (this.drag) {
        this.drag = null;
        cx.notify();
      }
    };

    const body = div().id("graph-view").relative().size_full().overflow_hidden()
      .when(Boolean(this.drag), (el) => el.cursor_grabbing()).when(!this.drag, (el) => el.cursor_grab())
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - W) > 1 || Math.abs(size.height - H) > 1) {
          this.graphSize = size;
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.pan = { x: Math.round(px + unzoom(e.delta.x)), y: Math.round(py + unzoom(e.delta.y)) };
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        this.focus = "graph";
        this.app.focusSelf();
        cx.stop_propagation();

        if (e.click_count === 2) {
          this.pan = null;
          this.drag = null;
          cx.notify();

          return;
        }

        this.drag = { x: e.position.x, y: e.position.y, from: { x: px, y: py } };
        cx.notify();
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;

        if (!d) return;

        this.pan = { x: Math.round(d.from.x + unzoom(e.position.x - d.x)), y: Math.round(d.from.y + unzoom(e.position.y - d.y)) };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => end(cx))
      .on_hover((h, cx) => {
        if (!h) end(cx);
      })
      .child(c.el);

    const right = `${TONE_WORD[k]} · ${duration(r.run_started_at, k === "working" || k === "queued" ? null : r.updated_at)}`;

    return panel(t, "graph", title, active, body, { right });
  }

  stepsPanel(t: Theme): Element {
    const j = this.job(), steps = this.steps(), cur = this.step(), active = this.focus === "steps";

    if (!j) return panel(t, "steps", "Steps", active, empty(t, "No job selected", null, { small: true }));

    const rows = steps.map((s) => {
      const k = tone(s.status, s.conclusion), sel = s === cur;

      return h_flex().id(`step-${s.number}`).relative().h(STEP).px(10).gap(8).items_center().flex_none().text_size(11).overflow_hidden()
        .hover((st) => st.bg(`${t.ansi0}55`))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.focus = "steps";
          this.stepSel = s.number;
          this.logAt = 0;
          this.app.focusSelf();
          cx.notify();
        })
        .when(sel, (el) => el.children(band(t, active)))
        .when(k === "working", (el) => el.child(sweep(t, t.working, 360)))
        // The timeline's thread: a dithered line through every pip.
        .child(div().absolute().left(13).top(0).bottom(0).w(1).child(dither(t.ansi0, 1)))
        .child(div().relative().w(8).flex_none().flex().justify_center().child(pip(t, k, 7)))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(k === "skipped" ? t.dim : sel ? t.foreground : t.muted).child(s.name))
        .child(div().relative().flex_none().text_color(k === "working" ? t.working : k === "failed" ? t.blocked : t.dim).child(k === "skipped" ? "skipped" : duration(s.started_at, s.completed_at)));
    });

    const k = tone(j.status, j.conclusion);

    // The chosen step stays in view: j / k past the edge, a new job whose
    // running or failed step is further down.
    const at = cur ? steps.indexOf(cur) : -1, key = `${j.id}:${at}`;

    if (at >= 0 && key !== this.stepsAt) {
      this.stepsAt = key;
      this.stepsScroll.scroll_to_item(at);
    }

    const body = !steps.length ? empty(t, k === "queued" ? "Waiting for a runner…" : "No steps", null, { small: true })
      : div().id("steps-body").size_full().overflow_y_scroll().track_scroll(this.stepsScroll).py(2).children(rows);

    return panel(t, "steps", j.name ?? "", active, body, { right: `${steps.filter((s) => s.status === "completed").length}/${steps.length}` });
  }

  logPanel(t: Theme): Element {
    const j = this.job(), s = this.step(), active = this.focus === "log";
    const title = s ? `Log · ${s.name}` : "Log";

    if (!j || !s) return panel(t, "log", title, active, empty(t, "Pick a step", null, { small: true }));

    const k = tone(j.status, j.conclusion), sk = tone(s.status, s.conclusion);
    const got = this.logs.get(j.id);
    let body: Element;

    if (j.status !== "completed") {
      body = empty(t, sk === "working" ? `${s.name} is running · ${duration(s.started_at, null)}` : sk === "queued" ? "Not started yet" : `${s.name}: ${TONE_WORD[sk]}`,
        "GitHub hands out a job's log once the job finishes; the steps move live meanwhile, and the log lands here when it's done.", { moon: k === "working" ? 4 : 0 });
    } else if (!got) body = empty(t, "Reading the log…", null, { small: true });
    else if ("error" in got) body = empty(t, "The log didn't come", got.error, { small: true });
    else {
      const lines = this.logLines();
      const code = settings().font_family || "JetBrains Mono";

      const color = { group: t.accent, error: t.blocked, warning: t.ansi3, notice: t.ansi4, debug: t.dim, plain: t.muted } satisfies { readonly [K in LogLine["kind"]]: Color };

      body = !lines.length ? empty(t, sk === "skipped" ? "Skipped" : "Nothing logged for this step", null, { small: true })
        : div().size_full().px(8).py(2)
          .on_size_change((size, cx) => {
            const v = Math.max(1, Math.floor((unzoom(size.height) - 4) / LINE));

            if (v !== this.logVis) {
              this.logVis = v;
              cx.notify();
            }
          })
          .on_mouse_down("left", (_e, cx) => {
            this.focus = "log";
            this.app.focusSelf();
            cx.stop_propagation();
          })
          .child(v_virtual_list(`log-${j.id}-${s.number}`, lines.length, LINE, (i) => String(i),
            (range) => lines.slice(range.start, range.end).map((l, n) => h_flex().h(LINE).w_full().gap(8).items_center().font_family(code).text_size(11.5)
              .when(l.kind === "error", (el) => el.bg(`${t.blocked}1c`))
              .child(div().w(38).flex_none().text_right().text_color(t.ansi0).child(String(range.start + n + 1)))
              .child(div().flex_1().min_w(0).truncate().text_color(color[l.kind]).child(l.kind === "group" ? `▸ ${l.text}` : l.text || " "))))
            .size_full().track_scroll(this.logScroll));
    }

    return panel(t, "log", title, active, body, { right: got && !("error" in got) ? `${this.logLines().length} lines` : "" });
  }

  render(t: Theme, size: Size): Element {
    if (this.form) return this.form.render(t, size);

    const app = this.app, wide = size.width >= 820;
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(lo, hi), Math.max(lo, v)));
    const rw = clamp(this.sizes.runs ?? Math.min(400, Math.max(280, size.width * 0.3)), 200, size.width - 420);
    const rh = clamp(this.sizes.runsH ?? size.height * 0.3, 100, size.height - 260);
    const rightW = wide ? size.width - rw - 6 : size.width;
    const rightH = wide ? size.height : size.height - rh - 6;
    const gh = graphHeight(this.sizes.graph, rightH);
    const sw = clamp(this.sizes.steps ?? Math.max(240, Math.min(360, size.width * 0.3)), 160, rightW - 200);
    const runs = this.runsPanel(t);

    const right = v_flex().flex_1().min_w(0).min_h(0).h_full()
      .child(this.graphPanel(t).h(gh).flex_none())
      .child(splitter(t, "act-split-graph", "y", app.dragged("graph"), (e) => app.resize(e, "graph", "y", gh, (v) => {
        this.sizes.graph = v;
      }, { min: 100, max: rightH - 120 })))
      .child(h_flex().flex_1().min_h(0)
        .child(this.stepsPanel(t).w(sw).flex_none().h_full())
        .child(splitter(t, "act-split-steps", "x", app.dragged("steps"), (e) => app.resize(e, "steps", "x", sw, (v) => {
          this.sizes.steps = v;
        }, { min: 160, max: rightW - 200 })))
        .child(this.logPanel(t).flex_1().h_full()));

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
