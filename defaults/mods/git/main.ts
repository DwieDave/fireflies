// Nocturne Git: lazygit in Nocturne's night look, and the one git + review
// tool (diff's review lives here now, as the Files panel's Review
// tab). Every operation runs the real git CLI (git.ts), on this computer or
// a space's machine (`on`).
//
// Layout, lazygit's: five numbered side panels on the left (1 Status,
// 2 Files / Review / Worktrees, 3 Local branches / Remotes / Tags,
// 4 Commits / Reflog, 5 Stash), the main view on the right (the selection's
// diff; Unstaged over Staged while staging lines), the command log under it,
// the options bar at the bottom. + and _ (or the ⤢ in a panel's title)
// cycle the focused panel's screen mode: normal, half (it takes a wide middle
// column and the others fold into a rail; Commits draws its wide graph
// there) and full. Narrower than NARROW: one thing at a time.
//
// History comes in pages (lazygit's): the Commits panel and a branch's
// commits read LOG_LIMIT commits, the branch log LOG_FULL_LIMIT; when the end
// of a cut history comes into view, more() reads the next page below it.
// Every list is windowed (rowWindow): whole rows that fit its height, the
// last one ending inside the list.
//
// Keys: lazygit's defaults (keys.ts holds them all; ? lists them). Mouse:
// click focuses and selects, double-click drills in (enter), right-click
// opens that row's menu (its actions with their keys), the wheel scrolls
// the panel under it, the gaps between columns drag.
//
// keys.json (or `herdr-app do`) can send git.<action> to a shown
// window: any action of keys.ts (screen-next, push, panel-commits…).
//
// ctrl-p (or the ⧉ in the main view's title, a right-click menu, the
// palette) opens what the main view shows as a pane beside the focused pane,
// ctrl-shift-p in a new tab, and closes the window. That pane is this mod
// with props { show }: { kind: "file", path } (the working diff), "commit"
// { hash, path? }, "stash" { ref, path? }, "range" { a, b } (diff mode), or
// "review" { scope, pr?, repo?, path? } (the review list beside its diff),
// "log" { ref } (a branch's, remote branch's or tag's log, as the main view
// shows it for the Branches panel: lazygit's git log --graph on our lanes).
// It reads again on changes like the window; q / esc close the pane.
//
// Props: { folder?, on? } (the shown space's when missing), { review: true,
// scope? } to start on Review (diff's props land here), { pr, repo,
// back } a pull request's diff opened from the GitHub window: esc / q puts
// that window back. As an overlay window it says so in shared(WINDOW), so
// the toggle (nocturne's git.js) closes it.


import { View, div, svg } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent, ScrollWheelEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, theme, settings, shared, setShared, spaces, panes, focused, run, nextCommand, closeOverlay, openOverlay, watchFolder, home } from "herdr";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { CommitFile, Env, LogEntry } from "./git.ts";
import { Git, LOG_LIMIT, LOG_FULL_LIMIT } from "./git.ts";
import type { Graph } from "./graph.ts";
import { layoutGraph, usedWidth, widthOf } from "./graph.ts";
import type { DiffFile, DiffRow } from "./patch.ts";
import { rows as diffRows, isChange, hunkKeys } from "./patch.ts";
import type { Branch, Commit, ReflogEntry, Remote, RemoteBranch, RepoState, StashEntry, Status, StatusFile, Tag, TreeRow } from "./parse.ts";
import { fileTree, dirLetters, letters, age, initials, relativeDate } from "./parse.ts";
import type { Action, Binding, KeyContext, ListContext } from "./keys.ts";
import { lookup, barKeys, menuKeys, bindings, keyName, keyLabel, isListContext } from "./keys.ts";
import { act } from "./actions.ts";
import type { Check, CommitOptions, ConfirmOptions, Line, MenuItem, MenuOptions, PromptOptions } from "./popups.ts";
import { Popups } from "./popups.ts";
import { keysHint } from "./keyhelp.ts";
import type { KeyRow, KeySection } from "./keyhelp.ts";
import { bindTab, tabActions } from "./form-keys.ts";
import * as WT from "./worktrees.ts";
import type { Checkout, Loss, Occupants } from "./worktrees.ts";
import type { ReviewFile } from "./review.ts";
import { Review } from "./review.ts";
import type { Hint, Ink, MainRow, Part } from "./draw.ts";
import { ART, dither, panel, band, chip, hints, empty, graphCell, graphPass, logTail, diffLine, laneColors, letterColor, unzoom, unzoomSize } from "./draw.ts";

export const WINDOW = "git.window"; // { id, beat }: the open window, for the toggle

/** The open window, for the toggle (nocturne's git.js reads it). */
const WINDOW_KEY = sharedKey(WINDOW, nullable(object({ id: isString }, { beat: isNumber, folder: nullable(isString) })));

/** The GitHub window's note (github's main.js): this window holds its place when opened from it. */
const GITHUB_WINDOW = sharedKey("github.window", nullable(object({ id: isString }, { beat: isNumber })));

/** The side panels, top to bottom. */
export type Panel = "status" | "files" | "branches" | "commits" | "stash";

const PANELS: readonly Panel[] = ["status", "files", "branches", "commits", "stash"];

const isPanel = literal("status", "files", "branches", "commits", "stash");

/** Each tabbed panel's tabs. */
type FilesTab = "files" | "review" | "worktrees";

type BranchesTab = "branches" | "remotes" | "tags";

type CommitsTab = "commits" | "reflog";

type Tab = FilesTab | BranchesTab | CommitsTab;

/** The tab each tabbed panel shows. */
interface TabOf {
  files: FilesTab;
  branches: BranchesTab;
  commits: CommitsTab;
}

const TABS = {
  files: [["files", "Files"], ["review", "Review"], ["worktrees", "Worktrees"]],
  branches: [["branches", "Local branches"], ["remotes", "Remotes"], ["tags", "Tags"]],
  commits: [["commits", "Commits"], ["reflog", "Reflog"]],
} as const satisfies { readonly [P in keyof TabOf]: readonly (readonly [TabOf[P], string])[] };

const isTabbed = (p: Panel): p is keyof TabOf => p === "files" || p === "branches" || p === "commits";

/** A side panel's screen mode. */
type Mode = "normal" | "half" | "full";

const MODES: readonly Mode[] = ["normal", "half", "full"];

const isMode = literal("normal", "half", "full");

// Where the window was, per folder: its panel, tabs, mode and sizes.
const isKept = object({}, {
  panel: isPanel,
  tabOf: object({}, { files: literal("files", "review", "worktrees"), branches: literal("branches", "remotes", "tags"), commits: literal("commits", "reflog") }),
  mode: isMode,
  tree: isBoolean,
  showLog: isBoolean,
  sideW: nullable(isNumber),
  railW: nullable(isNumber),
  midW: nullable(isNumber),
  logH: isNumber,
});

type Kept = Guarded<typeof isKept>;

const STATE = sharedMapKey("git.state", isKept);

const ROW = 18, WIDE_ROW = 32, LOG_ROW = 16, NARROW = 640;

// The graph's lane width: the Commits list, its wide rows, the branch log.
const LANE = 10, WIDE_LANE = 13;

/** Every context the window's keyboard can be in: the key table's, the ? overview, the filter. */
export type ViewContext = KeyContext | "keys" | "filter";

const CONTEXT_NAMES = {
  status: "status", files: "files", review: "review", worktrees: "worktrees", branches: "branches", remotes: "remotes", remoteBranches: "remote branches",
  tags: "tags", commits: "commits", reflog: "reflog", subCommits: "commits", commitFiles: "commit files", stash: "stash", staging: "staging", main: "main view",
  menu: "menu", confirm: "confirm", prompt: "prompt", commit: "commit", filter: "filter", keys: "keys", global: "global", list: "list",
} as const satisfies { readonly [C in ViewContext]: string };

/** The rows a windowed list draws: `vis` whole rows fit `px` (its height in
 *  layout units: the measured window px over the zoom, draw.ts unzoom), and
 *  `top` is clamped so the last row ends inside the list, never under its
 *  edge. Shared by the side lists and the main view. */
export function rowWindow(n: number, top: number, px: number, rowH: number) {
  const vis = Math.max(1, Math.floor(px / rowH));

  return { vis, top: Math.max(0, Math.min(top, Math.max(0, n - vis))) };
}

/** A busy row's mark, over the row (it keeps its width): a dithered sweep
 *  running through it and the command log's spinner at its right end. */
export function busyMark(t: Theme, id: string) {
  return [
    div().absolute().top(0).bottom(0).w(40).opacity(0.45).child(dither(t.working, 1)).loop("left", { from: -40, to: 360, period: 1600, easing: "linear" }),
    h_flex().id(id).absolute().top(0).bottom(0).right(0).w(22).items_center().justify_center().bg(t.background).text_size(11)
      .child(div().text_color(t.working).frames(["░", "▒", "▓", "█", "▓", "▒"], 120)),
  ];
}

// ---- the lists' rows

/** The Status panel's one row. */
export interface StatusRow {
  readonly kind: "status";
}

/** A row of any list: what items(ctx) gives for its context. */
export type Item =
  | StatusRow | TreeRow<StatusFile> | TreeRow<CommitFile> | ReviewFile | Checkout
  | Branch | Remote | Tag | Commit | ReflogEntry | StashEntry | RemoteBranch;

// Which record a row is: each has a field none of the others has.
export const isBranch = (x: Item | null): x is Branch => x !== null && "gone" in x;
export const isCommit = (x: Item | null): x is Commit => x !== null && "parents" in x;
export const isReflog = (x: Item | null): x is ReflogEntry => x !== null && "selector" in x;
export const isStash = (x: Item | null): x is StashEntry => x !== null && "index" in x;
export const isRemote = (x: Item | null): x is Remote => x !== null && "push" in x;
export const isRemoteBranch = (x: Item | null): x is RemoteBranch => x !== null && "remote" in x;
export const isTag = (x: Item | null): x is Tag => x !== null && "annotated" in x;
export const isCheckout = (x: Item | null): x is Checkout => x !== null && "prunable" in x;
export const isReviewFile = (x: Item | null): x is ReviewFile => x !== null && "hunks" in x;
export const isTreeRow = (x: Item | null): x is TreeRow<StatusFile> | TreeRow<CommitFile> => x !== null && "depth" in x;

/** A Files row's working-tree file (not a directory's). */
export function statusFileOf(x: Item | null): StatusFile | null {
  if (!isTreeRow(x) || x.kind !== "file") return null;

  const f = x.file;

  return "staged" in f ? f : null;
}

/** A row's path: a file's, a directory's, a worktree's. */
export function pathOf(x: Item | null): string | null {
  if (x === null) return null;

  if ("path" in x) return x.path;

  return null;
}

/** A row's name: a branch's, a tag's, a remote's, a file row's. */
export function nameOf(x: Item | null): string | null {
  return x !== null && "name" in x ? x.name : null;
}

/** A row's commit hash: a commit's, a reflog entry's, a stash entry's. */
export function hashOf(x: Item | null): string | null {
  return x !== null && "hash" in x ? x.hash : null;
}

/** A row's subject: a branch's last commit's, a commit's, a tag's, a stash entry's. */
export function subjectOf(x: Item | null): string | null {
  return x !== null && "subject" in x ? x.subject : null;
}

/** What the filter matches a row by. */
function words(x: Item): (string | null)[] {
  return [nameOf(x), pathOf(x), subjectOf(x), hashOf(x), isRemote(x) ? x.url : null, isRemoteBranch(x) || isCheckout(x) ? x.branch : null];
}

/** A list row's identity for busy marks: the same thing in any list (a
 *  branch, a commit, a file), so a row keeps its mark through a reload. */
export function rowKey(ctx: ListContext, x: Item | null) {
  if (!x) return null;

  if (ctx === "commits" || ctx === "subCommits" || ctx === "reflog") {
    const h = hashOf(x);

    return h ? `commit:${h}` : null;
  }

  if (ctx === "branches") return `branch:${nameOf(x) ?? ""}`;

  if (ctx === "files" || ctx === "review" || ctx === "commitFiles") {
    const p = pathOf(x);

    return p !== null ? `file:${p}` : null;
  }

  if (ctx === "worktrees") return `wt:${pathOf(x) ?? ""}`;

  if (ctx === "stash") return isStash(x) ? `stash:${x.ref}` : null;

  if (ctx === "tags" || ctx === "remotes" || ctx === "remoteBranches") return `${ctx}:${nameOf(x) ?? ""}`;

  return null;
}

/** A job queue a long-lived task drains: async work keeps that task's cx. */
type Job = (cx: AsyncContext) => Promise<void> | void;

class Queue {
  items: Job[] = [];
  wake: (() => void) | null = null;

  push(job: Job) {
    this.items.push(job);

    const w = this.wake;

    this.wake = null;
    w?.();
  }

  async next(): Promise<Job> {
    for (;;) {
      const job = this.items.shift();

      if (job) return job;

      await new Promise<void>((r) => { this.wake = r; });
    }
  }
}

/** The shown space's folder and machine. */
function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? panes().find((p) => p.tab === tab && p.cwd);

  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

// ---- what the window is opened with

/** A pane opened from the window (ctrl-p): what it shows. */
const isShow = oneOf(
  object({ kind: literal("file"), path: isString }),
  object({ kind: literal("commit"), hash: isString }, { path: isString }),
  object({ kind: literal("stash"), ref: isString }, { path: isString }),
  object({ kind: literal("range"), a: isString, b: isString }),
  object({ kind: literal("review"), scope: literal("work", "branch", "pr") }, { pr: isNumber, repo: nullable(isString), path: isString }),
  object({ kind: literal("log"), ref: isString }),
);

export type Show = Guarded<typeof isShow>;

/** The GitHub window to put back (github's main.js: { mod, props }). */
const isBack = object({ mod: isString }, { props: object({}) });

type Back = Guarded<typeof isBack>;

/** Opened for a worktree (the space menu's New / Remove worktree, the sidebar's w, the palette). */
const isIntent = object({}, { action: literal("new", "open", "remove"), space: isString, branch: isString, tab: isString, argv: arrayOf(isString) });

type Intent = Guarded<typeof isIntent>;

/** The window's props, the plain fields (show, back and worktrees are read on their own:
 *  one of them in another shape leaves the rest). */
const isGitProps = object({}, {
  overlay: isString,
  folder: nullable(isString),
  on: nullable(isString),
  paneId: isString,
  review: isBoolean,
  pr: isNumber,
  repo: nullable(isString),
  scope: literal("work", "branch", "pr"),
});

/** The props' fields read on their own. */
const isGroups = object({}, { show: isShow, back: isBack, worktrees: isIntent });

type GitProps = Guarded<typeof isGitProps>;

type Groups = Guarded<typeof isGroups>;

const NO_PROPS: GitProps = {};

const NO_GROUPS: Groups = {};

// ---- the window's state

/** Everything read from the repo. */
interface Data {
  status: Status | null;
  branches: readonly Branch[];
  remotes: readonly Remote[];
  remoteBranches: readonly RemoteBranch[];
  tags: readonly Tag[];
  commits: readonly Commit[];
  reflog: readonly ReflogEntry[];
  stash: readonly StashEntry[];
  worktrees: readonly Checkout[];
  state: RepoState | null;
  /** The main branch; undefined: looked for and none. */
  main: string | null | undefined;
  unpushed: ReadonlySet<string>;
  notMain: ReadonlySet<string>;
}

/** A drill-in list over a panel (enter on a branch, a remote, a commit). */
type Sub =
  | { readonly kind: "subCommits"; readonly ref: string; readonly title: string; items: readonly Commit[]; graph: Graph | null; limit?: number }
  | { readonly kind: "remoteBranches"; readonly remote: string; readonly title: string; items: readonly RemoteBranch[] }
  | { readonly kind: "commitFiles"; readonly hash: string; readonly title: string; readonly stash: boolean; items: readonly CommitFile[] };

/** Each panel's drill-ins, the newest last. */
interface Subs {
  status: Sub[];
  files: Sub[];
  branches: Sub[];
  commits: Sub[];
  stash: Sub[];
}

/** The main view's lists' measured heights. */
interface MainHeights {
  main?: number;
  staging?: number;
  other?: number;
  second?: number;
}

/** Where the main view's second lists are scrolled to. */
interface OtherTops {
  other?: number;
  second?: number;
}

/** What enterSub opens (its items read after). */
export type NewSub =
  | { readonly kind: "subCommits"; readonly ref: string; readonly title: string }
  | { readonly kind: "remoteBranches"; readonly remote: string; readonly title: string }
  | { readonly kind: "commitFiles"; readonly hash: string; readonly title: string; readonly stash: boolean };

/** Staging lines of one file: its side's diff, the cursor, a range's anchor, hunk mode, the other side's rows. */
interface Staging {
  file: StatusFile;
  side: "staged" | "unstaged";
  diff: DiffFile | null;
  rows: readonly DiffRow[];
  cur: number;
  anchor: number | null;
  hunkMode: boolean;
  other: readonly DiffRow[] | null;
  top?: number;
}

/** What the main view shows: its rows and title, the file they're of, a second
 *  panel (the staged side), the row height, and the ref whose log goes further. */
interface MainContent {
  readonly title: string;
  readonly rows: readonly MainRow[];
  readonly path?: string;
  readonly rowH?: number;
  readonly more?: string | null;
  readonly second?: { readonly title: string; readonly rows: readonly MainRow[] } | null;
}

/** A splitter being dragged: what it sets, from where. */
interface Resizing {
  readonly key: string;
  readonly axis: "x" | "y";
  readonly at: number;
  readonly from: number;
  readonly set: (v: number) => void;
  readonly min: number;
  readonly max: number;
  readonly sign: number;
}

/** A splitter's bounds and direction. */
interface ResizeOptions {
  readonly min?: number;
  readonly max?: number;
  readonly sign?: number;
  readonly axis?: "x" | "y";
}

/** A copied commit (C), pasted with V in commit order. */
interface Copied {
  readonly hash: string;
  readonly subject: string;
  readonly date: number;
}

/** A note on the options bar. */
interface Note {
  readonly text: string;
  readonly tone: "done" | "failed";
  readonly at: number;
}

/** A history read further when its end comes into view. */
type More = "commits" | "subCommits" | "main";

/** What newWorktree is asked: a branch name, its base, its upstream, at once (`now`), and the space's first tab. */
export interface NewWorktree {
  readonly value?: string;
  readonly base?: string | null;
  readonly label?: string | null;
  readonly track?: boolean;
  readonly now?: boolean;
  readonly tab?: string | undefined;
  readonly argv?: readonly string[] | undefined;
}

/** How goToWorktree opens a new space there. */
interface SpaceOptions {
  readonly tab?: string | undefined;
  readonly argv?: readonly string[] | undefined;
}

/** How spawn marks a row busy: `row` a rowKey; null none; left out, the selected row. */
export interface SpawnOptions {
  readonly row?: string | null;
}

/** A git action's options: Git.run's and the row it marks busy. */
export interface ExecOptions extends SpawnOptions {
  readonly env?: Env;
  readonly shell?: string | null;
  readonly shown?: string | null;
  readonly timeout?: number;
}

/** A side panel's width and room. */
interface SideOptions {
  readonly wide?: boolean;
  readonly compact?: boolean;
}

/** A main-view list's cursor to keep in sight, which scroll it keeps, its row height. */
interface MainListOptions {
  readonly follow?: number | null;
  readonly key?: "main" | "staging" | "other" | "second";
  readonly rowH?: number;
}

/** txt's width, or the rest of the row. */
interface TxtOptions {
  readonly w?: number | null;
  readonly grow?: boolean;
}

/** A list's row drawn: the row, its index, whether it's selected. */
type DrawRow = (r: Item, i: number, sel: boolean) => Element;

export default class GitView extends View {
  overlay: string | null = null;
  folder: string | null = null;
  on: string | null = null;
  /** The GitHub window to put back. */
  backTo: Back | null = null;
  state: "loading" | "norepo" | "ready" = "loading";
  git: Git | null = null;
  data: Data = { status: null, branches: [], remotes: [], remoteBranches: [], tags: [], commits: [], reflog: [], stash: [], worktrees: [], state: null, main: null, unpushed: new Set(), notMain: new Set() };
  graph: Graph | null = null;
  panel: Panel = "files";
  tabOf: TabOf = { files: "files", branches: "branches", commits: "commits" };
  subs: Subs = { status: [], files: [], branches: [], commits: [], stash: [] };
  sel: { [C in ListContext]?: number } = {};
  top: { [C in ListContext]?: number } = {};
  follow: { [C in ListContext]?: boolean } = {};
  vis: { [C in ListContext]?: number } = {};
  mode: Mode = "normal";
  focus: "side" | "main" = "side";
  tree = true;
  collapsed = new Set<string>();
  filters: { [C in ListContext]?: string } = {};
  filtering: { readonly ctx: ListContext; readonly input: InputState } | null = null;
  range: { readonly ctx: ListContext; readonly anchor: number } | null = null;
  statusFilter: "staged" | "unstaged" | null = null;
  branchSort: "date" | "name" = "date";
  copied: Copied[] = [];
  allBranches = false;
  noGraph = false;
  context = 3;
  ws = false;
  diffBase: string | null = null;
  diffReverse = false;
  main: MainContent | null = null;
  mainTop = 0;
  mainGen = 0;
  // How far back history is read: the Commits panel, and each ref's log in
  // the main view. Reaching the end of a history cut at its limit reads
  // further (more()), as lazygit does.
  commitLimit = LOG_LIMIT;
  logLimits = new Map<string, number>();
  moreBusy = new Set<More>();
  staging: Staging | null = null;
  logs: LogEntry[] = [];
  showLog = true;
  shellHistory: string[] = [];
  draft: string | null = null;
  noteText: Note | null = null;
  busyText: string | null = null;
  busyRows = new Map<string, number>(); // rowKey -> operations acting on that row (spawn)
  size = { width: 1000, height: 700 };
  sideW: number | null = null;
  railW: number | null = null;
  midW: number | null = null;
  logH = 110;
  resizing: Resizing | null = null;
  mouse = { x: 200, y: 200 };
  popups: Popups = new Popups(this);
  // A pane opened from the window (ctrl-p): one diff, or a review.
  show: Show | null = null;
  paneId: string | null = null;
  review: Review = new Review(this);
  // Opened for a worktree (the space menu's New / Remove worktree, the
  // sidebar's w, the palette, the old worktree dialog's callers):
  // { action: "new" | "open" | "remove", space?, branch?, tab?, argv? }.
  wtIntent: Intent | null = null;
  wtPicked = new Set<string>(); // worktree paths picked for d (M, U, A)
  userHome: string | null = null;
  handle: FocusHandle | null = null;
  acts = new Queue();
  reads = new Queue();
  closed = false;
  watching = false;
  reloadQueued = false;
  pickedPath = false;
  listPx: { [C in ListContext]?: number } = {};
  mainPx: MainHeights = {};
  otherTop: OtherTops = {};
  mainVis: number | null = null;
  wheelAcc = 0;
  mainWheel = 0;

  override init(p: Props | undefined, cx: AsyncContext) {
    const given = props() ?? p ?? NO_PROPS;
    const pr = isGitProps(given) ? given : NO_PROPS;
    const groups = isGroups(given) ? given : NO_GROUPS;

    this.overlay = pr.overlay ?? null;

    const h = pr.folder ? { folder: pr.folder, on: pr.on ?? null } : here();

    this.folder = h.folder;
    this.on = h.on ?? null;
    this.backTo = groups.back ?? null; // { mod, props }: the GitHub window to put back

    const kept: Kept = this.folder === null ? {} : readSharedMap(shared, STATE).get(this.folder) ?? {};

    this.panel = kept.panel ?? "files";
    this.tabOf = { files: kept.tabOf?.files ?? "files", branches: kept.tabOf?.branches ?? "branches", commits: kept.tabOf?.commits ?? "commits" };
    this.mode = kept.mode ?? "normal";
    this.tree = kept.tree ?? true;
    this.showLog = kept.showLog ?? true;
    this.sideW = kept.sideW ?? null;
    this.railW = kept.railW ?? null;
    this.midW = kept.midW ?? null;
    this.logH = kept.logH ?? 110;
    // A pane opened from the window (ctrl-p): one diff, or a review.
    this.show = groups.show ?? null;
    this.paneId = pr.paneId ?? null;

    const rv = this.show?.kind === "review" ? this.show : pr;

    this.review = new Review(this, { scope: rv.scope ?? "work", pr: rv.pr ?? null, repo: rv.repo ?? null });

    if (pr.review || pr.pr || pr.scope || this.show?.kind === "review") {
      this.panel = "files";
      this.tabOf.files = "review";
    }

    this.wtIntent = groups.worktrees ?? null;
    this.userHome = this.on ? null : home();

    if (this.wtIntent) {
      this.panel = "files";
      this.tabOf.files = "worktrees";
      this.mode = "normal";
    }

    if (this.show) {
      this.mode = "normal";
      this.showLog = false;

      if (this.show.kind !== "review") this.focus = "main";
    }

    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    handle.focus();

    if (this.overlay) {
      for (const ms of [60, 250, 600]) {
        cx.timer.after(ms, () => {
          if (!this.closed && !this.popups.open && !this.filtering) handle.focus();
        });
      }
    }

    this.beat();

    if (this.overlay) cx.timer.every(4000, () => this.beat());

    for (const q of [this.acts, this.reads]) {
      cx.spawn(async (cx) => {
        for (;;) {
          const job = await q.next();

          if (this.closed) return;

          try { await job(cx); } catch (cause: unknown) { this.error(cause instanceof Error ? cause.message : String(cause)); }

          if (this.closed) return;

          cx.notify();
        }
      });
    }

    this.start();
    cx.timer.every(this.on ? 15000 : 30000, () => this.reload());
    cx.timer.every(1000, (cx) => {
      if (this.noteText && Date.now() - this.noteText.at > 6000) {
        this.noteText = null;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^git\./, "");

        if (c === "focus") handle.focus();
        else if (c === "refresh") this.reload(true);
        else if (c === "review") {
          this.setPanel("files");
          this.setTab("review");
        }
        // keys.json can bind any key table action: git.<action>
        // (panel-commits for panel:commits).
        // While a git window is open, commands are its keys: other copies (panes) leave them.
        else if (this.notMine()) { /* the window's */ }
        else if (this.popups.open) {
          if (c === "back") this.popups.close();
          else if (c === "menu-run" || c === "confirm-yes" || c === "prompt-ok" || c === "commit-ok") this.popups.ok(cx);
        } else if (this.state === "ready") act(this, c.replace(/^panel-/, "panel:"), cx);

        cx.notify();
      }
    });
  }

  // ---- life

  start() {
    this.reads.push(async () => {
      if (!this.folder) {
        this.state = "norepo";

        return;
      }

      this.git = await Git.open(this.folder, this.on, (e) => this.logged(e));

      if (!this.git) {
        this.state = "norepo";

        return;
      }

      this.state = "ready";
      await this.loadAll();
      this.watch();

      if (this.on && !this.userHome) this.userHome = await WT.userHomeOn(this.on).catch(() => null);

      this.worktreeIntent();
    });
  }

  watch() {
    const g = this.git;

    if (this.on || this.watching || !g) return;

    this.watching = true;
    this.reads.push(async (cx) => {
      cx.spawn(async () => {
        try {
          for (;;) {
            const paths = await watchFolder(g.root);

            if (this.closed) return;

            // Our own index writes show up too; a refresh is cheap and idempotent.
            if (paths.length) this.reload();
          }
        } catch { this.watching = false; }
      });
    });
  }

  /** A git window is open and this copy isn't it. */
  notMine() {
    const w = readShared(shared, WINDOW_KEY, null);

    return Boolean(w?.id && Date.now() - (w.beat ?? 0) < 10000 && w.id !== this.overlay);
  }

  beat() {
    if (!this.overlay || this.closed) return;

    // In the GitHub window's place (its d), this window is the one cmd-shift-g closes.
    if (this.backTo) writeShared(setShared, GITHUB_WINDOW, { id: this.overlay, beat: Date.now() });
    else writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: Date.now(), folder: this.folder });
  }

  override async close() {
    this.closed = true;
    this.saveState();

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);
  }

  saveState() {
    if (!this.folder || this.show) return;

    const all = new Map(readSharedMap(shared, STATE));

    all.set(this.folder, { panel: this.panel, tabOf: this.tabOf, mode: this.mode, tree: this.tree, showLog: this.showLog, sideW: this.sideW, railW: this.railW, midW: this.midW, logH: this.logH });
    writeSharedMap(setShared, STATE, all);
  }

  focusSelf() { if (!this.closed) this.handle?.focus(); }

  /** Queues an operation. While it's queued and running, the row it acts on
   *  (`row`: a rowKey; by default the shown panel's selected row, taken now,
   *  at the key; null: none, as fetch all) shows a spinner in the row. */
  spawn(fn: Job, options: SpawnOptions = {}) {
    const done = this.hold(options.row === undefined ? this.selectedRow() : options.row);

    this.acts.push(async (cx) => {
      try { await fn(cx); } finally { done(); }
    });
  }

  /** The shown panel's selected row, as a rowKey (null for Status). */
  selectedRow() {
    const ctx = this.ctxOf(this.panel);

    return rowKey(ctx, this.item(ctx));
  }

  /** Marks a row busy until the returned function is called (counted: two
   *  operations on one row keep it busy until both are done). */
  hold(key: string | null) {
    if (!key) return () => {};

    this.busyRows.set(key, (this.busyRows.get(key) ?? 0) + 1);

    let held = true;

    return () => {
      if (!held) return;

      held = false;

      const n = (this.busyRows.get(key) ?? 1) - 1;

      if (n > 0) this.busyRows.set(key, n);
      else this.busyRows.delete(key);
    };
  }

  /** `fn(cx)` shortly after the next frame (focusing a new input). */
  later(fn: (cx: Context) => void, ms = 40) { this.reads.push(async (cx) => { cx.timer.after(ms, (cx2) => fn(cx2)); }); }

  reload(loud = false) {
    if (this.state !== "ready" || this.reloadQueued) return;

    this.reloadQueued = true;
    this.reads.push(async () => {
      this.reloadQueued = false;
      await this.loadAll();

      if (loud) this.note("Refreshed");
    });
  }

  async reloadNow() { await this.loadAll(); }

  reloadReview() {
    this.reads.push(async () => {
      await this.review.load();
      this.pickShownPath();
      this.clampAll();
      this.loadMain();
    });
  }

  /** A review pane opened on a file starts on it. */
  pickShownPath() {
    const path = this.show?.kind === "review" ? this.show.path : undefined;

    if (path === undefined || this.pickedPath) return;

    const i = this.review.shown().findIndex((f) => f.path === path);

    if (i >= 0) {
      this.sel.review = i;
      this.follow.review = true;
      this.pickedPath = true;
    }
  }

  async loadAll() {
    const g = this.git;

    if (!g) return;

    const [status, branches, remotes, remoteBranches, tags, stash, worktrees, state] = await Promise.all([
      g.status(), g.branches(), g.remotes(), g.remoteBranches(), g.tags(), g.stash(), WT.listWorktrees(g), g.state(),
    ]);

    if (this.data.main === null) this.data.main = (await g.mainBranch()) ?? undefined;

    const main = this.data.main || null;
    const limit = this.commitLimit;
    const commits = await g.log("HEAD", { all: this.allBranches, limit });

    const [unpushed, notMain] = await Promise.all([
      status.upstream ? g.only("HEAD", "@{u}", limit) : Promise.resolve(new Set(commits.map((c) => c.hash))),
      main && status.head !== main ? g.only("HEAD", main, limit) : Promise.resolve(new Set<string>()),
    ]);

    this.data = { ...this.data, status, branches, remotes, remoteBranches, tags, stash, worktrees, state, commits, unpushed, notMain };
    this.graph = layoutGraph(commits);

    if (this.ctxOf(this.panel) === "reflog" || this.data.reflog.length) this.data.reflog = await g.reflog();

    for (const s of Object.values(this.subs).flat()) await this.loadSub(s);

    if (this.tabOf.files === "review" || this.review.files.length) {
      await this.review.load();
      this.pickShownPath();
    }

    if (this.staging) await this.loadStaging();

    this.clampAll();
    this.loadMain();
  }

  async loadSub(s: Sub) {
    const g = this.git;

    if (!g) return;

    if (s.kind === "subCommits") {
      s.items = await g.log(s.ref, { limit: s.limit ?? LOG_LIMIT });
      s.graph = layoutGraph(s.items);
    } else if (s.kind === "remoteBranches") s.items = this.data.remoteBranches.filter((r) => r.remote === s.remote);
    else s.items = await g.commitFiles(s.hash);
  }

  // ---- notes, errors, the log

  note(text: string, tone: Note["tone"] = "done") { this.noteText = { text, tone, at: Date.now() }; }

  busy(text: string | null) { this.busyText = text; }

  error(text: string) { this.popups.confirm({ title: "Error", text: (text || "git failed").trim().split("\n").slice(-6).join("\n"), error: true }); }

  logged(entry: LogEntry) {
    if (!this.logs.includes(entry)) this.logs.push(entry);

    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
  }

  showOutput(cmd: string, text: string, ok: boolean) {
    this.popups.confirm({ title: cmd, text: text.split("\n").slice(-14).join("\n") || "(no output)", error: !ok });
  }

  /** A git action: runs, then reads everything again; a failure opens lazygit's error popup. */
  exec(title: string, args: readonly string[], options: ExecOptions = {}) {
    const { row, ...opts } = options;

    this.spawn(async () => {
      const g = this.git;

      if (!g) return;

      const r = await g.run(title, args, opts);

      if (!r.ok) this.error(r.err);

      await this.loadAll();
    }, row === undefined ? {} : { row });
  }

  copy(text: string, cx: Context) {
    cx.write_to_clipboard(text);
    this.note(`Copied ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  }

  ask(o: ConfirmOptions) { this.popups.confirm(o); }

  prompt(o: PromptOptions) { this.popups.prompt(o); }

  menu(o: MenuOptions) { this.popups.menu(o); }

  commitPopup(o: CommitOptions) { this.popups.commit(o); }

  commitWhat() {
    const n = (this.data.status?.files ?? []).filter((f) => f.staged).length;

    return `${n} file${n === 1 ? "" : "s"} staged · ${this.data.status?.head ?? "detached"}`;
  }

  /** A program in a terminal floating over the tab (an editor, git's own editor). */
  terminal(argv: readonly string[], name: string, folder: string | null = this.git?.root ?? null) {
    run("terminal.open", { argv, folder, place: "float", name });

    // lazygit suspends for an editor; the floating window would sit over it.
    if (this.overlay) {
      this.saveState();
      closeOverlay(this.overlay);
    }
  }

  editFile(path: string) {
    this.terminal(["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} "$1"', "-", path], path.split("/").pop() ?? path);
  }

  /** $VISUAL / $EDITOR on a folder (a worktree), in a floating terminal there. */
  editIn(folder: string) {
    this.terminal(["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} .'], folder.split("/").pop() ?? folder, folder);
  }

  openFile(path: string) {
    const root = this.git?.root ?? "";

    run("preview.open", this.on ? { path: `${root}/${path}`, in: "system", on: this.on } : { path: `${root}/${path}`, in: "system" });
  }

  recentRepos() {
    const seen = new Set([this.git?.root, this.folder]);
    const out: { folder: string; name: string }[] = [];

    for (const s of spaces()) {
      for (const f of [s.folder, ...panes().filter((p) => s.tabs.some((c) => c.id === p.tab)).map((p) => p.cwd)]) {
        if (!f || seen.has(f) || s.machine !== this.on) continue;

        seen.add(f);
        out.push({ folder: f, name: f.split("/").pop() ?? f });
      }
    }

    return out.slice(0, 20);
  }

  switchRepo(folder: string) {
    this.saveState();
    this.folder = folder;
    this.git = null;
    this.state = "loading";
    this.subs = { status: [], files: [], branches: [], commits: [], stash: [] };
    this.sel = {};
    this.top = {};
    this.staging = null;
    this.focus = "side";
    this.main = null;
    this.data.main = null;
    this.review.files = [];
    this.watching = false;
    this.wtPicked = new Set();
    this.start();
  }

  // ---- worktrees

  tilde(p: string) { return WT.tilde(p, this.userHome); }

  /** Per worktree: the spaces showing it and the agents in it. */
  occupancy() { return WT.occupancy(this.data.worktrees, this.on); }

  /** After a worktree was made or picked from outside (a space's menu, the
   *  palette, the sidebar's w): what it asked for, once the repo is read. */
  worktreeIntent() {
    const want = this.wtIntent;

    this.wtIntent = null;

    if (!want) return;

    this.setPanel("files");
    this.setTab("worktrees");

    const s = want.space ? spaces().find((x) => x.id === want.space) : null;
    const at = s ? WT.owner(this.data.worktrees, WT.spaceFolder(s)) : WT.owner(this.data.worktrees, this.folder);
    const i = at ? this.items("worktrees").findIndex((w) => pathOf(w) === at.path) : -1;

    if (i >= 0) this.moveTo(i);

    if (want.action === "new" || want.branch) this.newWorktree({ value: want.branch ?? "", now: Boolean(want.branch), tab: want.tab, argv: want.argv });
    else if (want.action === "remove") {
      if (!at || at.main) this.error(at ? "This is the repository's main checkout, not a worktree." : "That space isn't on a worktree of this repo.");
      else this.removeWorktrees([at]);
    }
  }

  /** Goes to a worktree: the space showing it, else a new space there
   *  (unnamed, so it follows the checkout and nests under its repo); the
   *  window steps aside, as after lazygit's worktree switch. */
  goToWorktree(w: { readonly path: string; readonly prunable?: boolean }, options: SpaceOptions = {}) {
    const { tab, argv } = options;

    if (w.prunable) return this.error("Its folder is gone: X prunes it.");

    const s = this.occupancy().get(w.path)?.spaces[0];

    if (s && !tab && !argv) run("space.select", { id: s.id });
    else {
      const args = { folder: w.path, machine: this.on ?? "" };
      const named = tab ? { ...args, tab } : args;

      run("space.new", argv ? { ...named, argv } : named);
    }

    if (this.overlay && !this.show) {
      this.saveState();
      closeOverlay(this.overlay);
    }
  }

  /** n: a branch for a new worktree (an existing one is checked out, a new
   *  one starts from `base`, HEAD by default), checked out under
   *  ~/.herdr/worktrees/<repo>/ and opened as a space. `now`: no prompt. */
  newWorktree(options: NewWorktree = {}) {
    const { value = "", base = null, label = null, track = false, now = false, tab, argv } = options;
    const g = this.git;

    if (!g) return;

    const from = label ?? this.data.status?.head ?? "HEAD";

    const go = (branch: string) => {
      const name = branch.trim();

      if (!name) return;

      this.spawn(async () => {
        this.busyText = `Checking out ${name}…`;

        const made = await WT.create(g, name, { base });

        this.busyText = null;

        if ("error" in made) {
          this.error(made.error);
          await this.loadAll();

          return;
        }

        if (track && made.created && base) await g.run("Set upstream", ["-C", made.path, "branch", "--set-upstream-to", base]);

        await this.loadAll();

        const w = this.data.worktrees.find((x) => x.path === made.path) ?? { path: made.path, branch: name };

        this.note(`${name} checked out in ${this.tilde(made.path)}`);
        this.goToWorktree(w, { tab, argv });
      });
    };

    if (now) return go(value);

    const out = new Set(this.data.worktrees.flatMap((w) => (w.branch ? [w.branch] : [])));
    const local = this.data.branches.filter((b) => !out.has(b.name));

    this.prompt({
      title: "New worktree: branch", value,
      placeholder: "a branch: an existing one, or a new name",
      note: `An existing branch is checked out; a new one starts from ${from}. It goes to ${this.tilde(this.userHome ? WT.ROOT(this.userHome) : "~/.herdr/worktrees")}/${g.name}/ and opens as a space.`,
      suggest: (q) => {
        const f = q.trim().toLowerCase();

        return local.flatMap((b) => (!f || b.name.toLowerCase().includes(f) ? [{ value: b.name, sub: b.subject }] : []));
      },
      ok: go,
    });
  }

  /** d: removes the picked worktrees (M / U / A), else the range, else the
   *  selected one, after one confirm that says what goes with them. */
  removeWorktrees(list: readonly Checkout[] | null = null) {
    const all = this.items("worktrees").filter(isCheckout);
    let items = list;

    if (!items && this.wtPicked.size) items = this.data.worktrees.filter((w) => this.wtPicked.has(w.path));

    if (!items && this.range?.ctx === "worktrees") {
      const at = this.sel.worktrees ?? 0;

      items = all.slice(Math.min(this.range.anchor, at), Math.max(this.range.anchor, at) + 1);
    }

    if (!items) {
      const x = this.item("worktrees");

      items = isCheckout(x) ? [x] : [];
    }

    if (items.some((w) => w.main)) {
      items = items.filter((w) => !w.main);

      if (!items.length) return this.error("This is the repository's main checkout: it can't be removed (a worktree can).");
    }

    const picked = items;
    const first = picked[0];

    if (!first) return;

    this.note(`Checking ${picked.length === 1 ? WT.label(first) : `${picked.length} worktrees`}…`);
    this.reads.push(async () => {
      const none: Loss = { dirty: 0, subs: 0, unpushed: [] };
      const info = await Promise.all(picked.map((w) => (w.prunable ? none : WT.inspect(w, this.on))));
      const occ = this.occupancy();
      const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
      const dirty = info.filter((x) => x.dirty), subs = info.filter((x) => x.subs), lost = info.flatMap((x) => x.unpushed);
      const spaceN = picked.reduce((k, w) => k + (occ.get(w.path)?.spaces.length ?? 0), 0);
      const agentN = picked.reduce((k, w) => k + (occ.get(w.path)?.agents.length ?? 0), 0);
      const one = picked.length === 1;

      const lines: Line[] = [
        ...(one ? [[`Deletes ${this.tilde(first.path)}. The branch stays unless b.`, "muted"] as const] : picked.slice(0, 6).map((w): Line => [`${WT.label(w)}  ${this.tilde(w.path)}`, "muted"])),
        ...(picked.length > 6 ? [[`and ${picked.length - 6} more`, "dim"] as const] : []),
        ...(dirty.length ? [[one ? `${n(dirty[0]?.dirty ?? 0, "uncommitted file")}: lost` : `${n(dirty.length, "has", "have")} uncommitted changes: lost`, "ansi1"] as const] : []),
        ...(lost.length ? [[`Submodule ${lost.join(", ")} has commits pushed nowhere: lost`, "ansi1"] as const] : []),
        ...(spaceN || agentN ? [[[spaceN ? `closes ${n(spaceN, "space")}` : null, agentN ? `ends ${n(agentN, "agent")}` : null].filter(Boolean).join(", "), agentN ? "ansi1" : "ansi3"] as const] : []),
      ];

      const checks: Check[] = [{ key: "b", label: one ? "also delete its branch" : "also delete their branches", on: false }];

      if (subs.length) checks.push({ key: "s", label: "take the submodules out first (else forced)", on: true });

      this.ask({
        title: one ? `Remove worktree ${WT.label(first)}` : `Remove ${picked.length} worktrees`,
        text: one ? `Remove the worktree ${WT.label(first)}?` : `Remove these ${picked.length} worktrees?`,
        danger: true, lines, checks,
        go: (_cx, answers) => {
          const branch = answers.find((c) => c.key === "b")?.on ?? false;
          const clearSubs = answers.find((c) => c.key === "s")?.on ?? true;

          this.spawn(async () => {
            const g = this.git;

            if (!g) return;

            const failed: string[] = [];
            const leaving = picked.some((w) => w.path === g.root);

            for (const [k, w] of picked.entries()) {
              if (w.prunable) continue;

              const say = (text: string) => { this.busyText = `${picked.length > 1 ? `${k + 1} of ${picked.length}, ` : ""}${WT.label(w)}: ${text}`; };

              const error = await WT.removeOne(g, w, { ...info[k], clearSubs, branch, spaces: occ.get(w.path)?.spaces ?? [] },
                { closeSpace: (s) => run("space.close", { id: s.id, confirmed: true }), step: say });

              if (error) failed.push(`${WT.label(w)}: ${error}`);
              else this.wtPicked.delete(w.path);
            }

            if (picked.some((w) => w.prunable)) await g.run("Prune worktrees", ["worktree", "prune"]);

            this.busyText = null;

            if (failed.length) this.error(`Removed ${picked.length - failed.length} of ${picked.length}. Not removed:\n${failed.join("\n")}`);
            else this.note(one ? `Removed ${WT.label(first)}` : `Removed ${picked.length} worktrees`);

            // The window was on one of them: it goes to the main checkout.
            if (leaving && !failed.length) {
              const main = this.data.worktrees.find((w) => w.main);

              if (main) {
                this.switchRepo(main.path);

                return;
              }
            }

            await this.loadAll();
          });
        },
      });
    });
  }

  /** M: picks the worktrees whose branch is merged into the main checkout's. */
  pickMergedWorktrees() {
    const base = this.data.worktrees.find((w) => w.main)?.branch;
    const g = this.git;

    if (!base || !g) return this.error("The main checkout has no branch to compare with.");

    this.reads.push(async () => {
      const merged = await WT.merged(g, base);

      this.wtPicked = new Set(this.data.worktrees.flatMap((w) => (!w.main && w.branch && w.branch !== base && merged.has(w.branch) ? [w.path] : [])));
      this.note(this.wtPicked.size ? `${this.wtPicked.size} merged into ${base} picked: d removes them, esc lets go` : `Nothing merged into ${base}`);
    });
  }

  // ---- what's where

  sub(p: Panel = this.panel): Sub | null {
    const s = this.subs[p];

    return s[s.length - 1] ?? null;
  }

  ctxOf(p: Panel): ListContext {
    const s = this.sub(p);

    if (s) return s.kind;

    if (p === "status" || p === "stash") return p;

    return this.tabOf[p];
  }

  ctx(): ViewContext {
    if (this.popups.open) return this.popups.kind ?? "menu";

    if (this.filtering) return "filter";

    if (this.focus === "main" || (this.show && this.show.kind !== "review")) return this.staging ? "staging" : "main";

    return this.ctxOf(this.panel);
  }

  /** The newest drill-in list of a kind (enter on a branch: its commits). */
  subOfKind(kind: Sub["kind"]) { return Object.values(this.subs).flat().reverse().find((x) => x.kind === kind) ?? null; }

  /** The rows a list context shows (filtered). */
  items(ctx: ListContext): readonly Item[] {
    const d = this.data;

    const list = ((): readonly Item[] => {
      switch (ctx) {
        case "status": return [{ kind: "status" }];
        case "files": {
          const files = (d.status?.files ?? []).filter((f) => !this.statusFilter || (this.statusFilter === "staged" ? f.staged : f.unstaged));

          return this.tree ? fileTree(files, this.collapsed) : files.map((f) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));
        }

        case "review": return this.review.shown();
        case "worktrees": return d.worktrees;
        case "branches": return this.branchSort === "name" ? [...d.branches].sort((a, b) => (Number(b.head) - Number(a.head)) || a.name.localeCompare(b.name)) : d.branches;
        case "remotes": return d.remotes;
        case "tags": return d.tags;
        case "commits": return d.commits;
        case "reflog": return d.reflog;
        case "stash": return d.stash;
        case "remoteBranches": case "subCommits": case "commitFiles": {
          const s = this.subOfKind(ctx);

          if (s?.kind === "commitFiles") {
            const rows: readonly TreeRow<CommitFile>[] = this.tree ? fileTree<CommitFile>(s.items, this.collapsed) : s.items.map((f: CommitFile) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));

            return rows;
          }

          return s?.items ?? [];
        }
      }
    })();

    const q = (this.filters[ctx] ?? "").toLowerCase();

    if (!q) return list;

    return list.filter((x) => words(x).some((s) => s && s.toLowerCase().includes(q)));
  }

  /** The review file under the cursor, when the cursor is on one (review.ts). */
  reviewItem() {
    const x = this.item();

    return isReviewFile(x) ? x : null;
  }

  /** The selected row of a context (the focused panel's by default). */
  item(context: ViewContext = this.focus === "main" ? this.ctxOf(this.panel) : this.ctx()): Item | null {
    const ctx = isListContext(context) ? context : this.ctxOf(this.panel);
    const list = this.items(ctx);

    return list[Math.min(this.sel[ctx] ?? 0, list.length - 1)] ?? null;
  }

  itemPath() {
    if (this.staging) return this.staging.file.path;

    const x = this.item();

    return pathOf(x);
  }

  /** The rows a range selection (v) covers, or the selected one. */
  pickedRows(): readonly Item[] {
    const ctx = this.ctxOf(this.panel), list = this.items(ctx), i = this.sel[ctx] ?? 0;

    if (this.range?.ctx === ctx) return list.slice(Math.min(this.range.anchor, i), Math.max(this.range.anchor, i) + 1);

    const x = list[i];

    return x ? [x] : [];
  }

  selectRange(a: number, b: number) {
    const ctx = this.ctxOf(this.panel);

    this.range = { ctx, anchor: a };
    this.sel[ctx] = b;
    this.follow[ctx] = true;
  }

  commitList(): readonly Commit[] {
    const s = this.sub();

    return this.ctxOf(this.panel) === "subCommits" ? (s?.kind === "subCommits" ? s.items : []) : this.data.commits;
  }

  commitIndex() { return this.sel[this.ctxOf(this.panel)] ?? 0; }

  isHead(c: { readonly hash: string }) { return c.hash === this.data.status?.oid; }

  rebasing() { return this.data.state === "rebasing"; }

  clampAll() {
    for (const p of PANELS) {
      const ctx = this.ctxOf(p), n = this.items(ctx).length;

      if ((this.sel[ctx] ?? 0) >= n) this.sel[ctx] = Math.max(0, n - 1);
    }
  }

  // ---- moving

  setPanel(p: Panel) {
    if (this.show && p !== "files") return;

    if (this.panel === p && this.focus === "side") return;

    this.panel = p;
    this.focus = "side";
    this.staging = null;
    this.range = null;
    this.ensureLoaded();
    this.loadMain();
  }

  ensureLoaded() {
    const ctx = this.ctxOf(this.panel);
    const g = this.git;

    if (ctx === "reflog" && !this.data.reflog.length && g) {
      this.reads.push(async () => {
        this.data.reflog = await g.reflog();
        this.loadMain();
      });
    }

    if (ctx === "review" && this.review.state === "idle") this.reloadReview();
  }

  stepPanel(d: number) {
    if (this.focus === "main") {
      this.back();

      return;
    }

    const i = PANELS.indexOf(this.panel);

    this.setPanel(PANELS[(i + d + PANELS.length) % PANELS.length] ?? "status");
  }

  setTab(id: Tab) {
    if (id === "files" || id === "review" || id === "worktrees") this.tabOf.files = id;
    else if (id === "branches" || id === "remotes" || id === "tags") this.tabOf.branches = id;
    else this.tabOf.commits = id;

    const p = id === "files" || id === "review" || id === "worktrees" ? "files" : id === "commits" || id === "reflog" ? "commits" : "branches";

    this.subs[p] = [];
    this.range = null;
    this.ensureLoaded();
    this.loadMain();
  }

  stepTab(d: number) {
    const p = this.panel;

    if (!isTabbed(p) || this.sub()) return;

    const tabs: readonly (readonly [Tab, string])[] = TABS[p];
    const i = tabs.findIndex(([t]) => t === this.tabOf[p]);
    const next = tabs[(i + d + tabs.length) % tabs.length];

    if (next) this.setTab(next[0]);
  }

  move(d: number) {
    const ctx = this.ctxOf(this.panel), n = this.items(ctx).length;

    if (!n) return;

    this.sel[ctx] = Math.max(0, Math.min(n - 1, (this.sel[ctx] ?? 0) + d));
    this.follow[ctx] = true;
    this.mainTop = 0;
    this.loadMain();
  }

  moveTo(i: number) {
    const ctx = this.ctxOf(this.panel), n = this.items(ctx).length;

    this.sel[ctx] = Math.max(0, Math.min(n - 1, i === Infinity ? n - 1 : i));
    this.follow[ctx] = true;
    this.mainTop = 0;
    this.loadMain();
  }

  page() { return Math.max(1, (this.vis[this.ctxOf(this.panel)] ?? 10) - 1); }

  toggleRange() {
    const ctx = this.ctxOf(this.panel);

    if (this.focus === "main" && this.staging) {
      this.staging.anchor = this.staging.anchor === null ? this.staging.cur : null;
      this.staging.hunkMode = false;

      return;
    }

    this.range = this.range ? null : { ctx, anchor: this.sel[ctx] ?? 0 };
  }

  toggleDir(path: string) {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
  }

  collapseAll(fold: boolean) {
    if (!fold) {
      this.collapsed.clear();

      return;
    }

    const s = this.sub();
    const files: readonly { readonly path: string }[] = this.ctxOf(this.panel) === "commitFiles" ? (s?.kind === "commitFiles" ? s.items : []) : this.data.status?.files ?? [];

    for (const r of fileTree(files)) if (r.kind === "dir") this.collapsed.add(r.path);
  }

  enterSub(n: NewSub) {
    const p = this.panel;
    const s: Sub = n.kind === "subCommits" ? { ...n, items: [], graph: null } : { ...n, items: [] };

    this.subs[p] = [...this.subs[p], s];
    this.sel[s.kind] = 0;
    this.top[s.kind] = 0;
    this.reads.push(async () => {
      await this.loadSub(s);
      this.loadMain();
    });
  }

  openFilter() {
    const ctx = this.ctxOf(this.panel);
    const input = InputState.new({ placeholder: "filter", value: this.filters[ctx] ?? "" });

    input.on("change", (_e, cx) => {
      this.filters[ctx] = input.value();
      this.sel[ctx] = 0;
      this.top[ctx] = 0;
      cx.notify();
    });
    input.on("submit", (_e, cx) => {
      this.filtering = null;
      this.handle?.focus();
      this.loadMain();
      cx.notify();
    });
    this.filtering = { ctx, input };
    input.focus();
    this.later(() => { if (this.filtering?.input === input) input.focus(); });
  }

  /** esc: the innermost thing gives way first. */
  back() {
    if (this.filtering) {
      const c = this.filtering.ctx;

      this.filtering = null;
      this.filters[c] = "";
      this.handle?.focus();

      return;
    }

    if (this.show && this.show.kind !== "review") {
      this.closePane();

      return;
    }

    if (this.focus === "main") {
      this.focus = "side";
      this.staging = null;
      this.loadMain();

      return;
    }

    if (this.range) {
      this.range = null;

      return;
    }

    const ctx = this.ctxOf(this.panel);

    if (ctx === "worktrees" && this.wtPicked.size) {
      this.wtPicked = new Set();

      return;
    }

    if (this.filters[ctx]) {
      this.filters[ctx] = "";

      return;
    }

    if (this.sub()) {
      this.subs[this.panel] = this.subs[this.panel].slice(0, -1);
      this.loadMain();

      return;
    }

    if (this.diffBase) {
      this.diffBase = null;
      this.loadMain();

      return;
    }

    if (this.copied.length && (ctx === "commits" || ctx === "reflog" || ctx === "subCommits")) {
      this.copied = [];
      this.note("Copied commits forgotten");

      return;
    }

    if (this.mode !== "normal") {
      this.mode = "normal";

      return;
    }

    this.quit(true);
  }

  /** q: back to the GitHub window when it opened this, else close. esc
   *  at the top level closes only a window (a pane stays). */
  quit(fromEsc = false) {
    if (this.show) return this.closePane();

    if (this.backTo) return this.goBack();

    if (this.overlay) {
      this.saveState();
      closeOverlay(this.overlay);

      return;
    }

    if (!fromEsc) run("pane.close");
  }

  /** Closes this copy's own pane (a ctrl-p pane finds itself by its paneId prop). */
  closePane() {
    const id = this.paneId;
    const mine = id ? panes().find((p) => p.mod === "git" && isGitProps(p.props) && p.props.paneId === id) : undefined;

    run("pane.close", mine ? { pane: mine.pane } : {});
  }

  /** What the main view shows now, as a pane's { show } (null: nothing to open). */
  showNow(): Show | null {
    const ctx = this.ctxOf(this.panel), x = this.item(ctx);

    if (this.diffBase) {
      const ref = hashOf(x) ?? (isBranch(x) || isRemoteBranch(x) || isTag(x) ? x.oid : null);

      if (ref) return this.diffReverse ? { kind: "range", a: ref, b: this.diffBase } : { kind: "range", a: this.diffBase, b: ref };
    }

    if (this.staging) return { kind: "file", path: this.staging.file.path };

    switch (ctx) {
      case "files": {
        const f = statusFileOf(x);

        if (f) return { kind: "file", path: f.path };

        const first = isTreeRow(x) && x.kind === "dir" ? x.files[0]?.path : undefined;

        return isTreeRow(x) && x.kind === "dir" ? (first === undefined ? { kind: "review", scope: "work" } : { kind: "review", scope: "work", path: first }) : null;
      }

      case "review": {
        const review: Show = this.review.pr ? { kind: "review", scope: this.review.scope, pr: this.review.pr, repo: this.review.prRepo } : { kind: "review", scope: this.review.scope };
        const path = pathOf(x);

        return path ? { ...review, path } : review;
      }

      case "commits": case "subCommits": case "reflog": {
        const hash = hashOf(x);

        return hash ? { kind: "commit", hash } : null;
      }

      case "commitFiles": {
        const s = this.sub();

        if (s?.kind !== "commitFiles") return null;

        const path = isTreeRow(x) && x.kind === "dir" ? null : pathOf(x);

        return s.stash ? (path ? { kind: "stash", ref: s.hash, path } : { kind: "stash", ref: s.hash }) : (path ? { kind: "commit", hash: s.hash, path } : { kind: "commit", hash: s.hash });
      }

      case "stash": return isStash(x) ? { kind: "stash", ref: x.hash } : null;
      case "branches": case "tags": case "remoteBranches": {
        const name = nameOf(x);

        return name ? { kind: "log", ref: name } : null;
      }

      default: return null;
    }
  }

  /** ctrl-p: the main view as a pane beside the focused pane (tab: in a new
   *  tab); the window steps aside. */
  openPane(tab = false) {
    const g = this.git;
    const show = g ? this.showNow() : null;

    if (!g || !show) return this.error("Nothing in the main view to open as a pane.");

    const paneId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const props = this.on ? { folder: g.root, on: this.on, show, paneId } : { folder: g.root, show, paneId };

    if (tab) run("tab.new", { mod: "git", props, name: paneName(show) });
    else run("pane.split", { direction: "auto", mod: "git", props });

    // The window steps aside a moment later: closed in the same turn, the new
    // pane's first tasks were cancelled with it (it stayed on "Reading…").
    if (this.overlay) {
      this.saveState();

      const id = this.overlay;

      this.later(() => closeOverlay(id), 300);
    }
  }

  goBack() {
    const back = this.backTo;

    if (!back) return;

    this.saveState();
    openOverlay({ mod: back.mod, kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: back.props ?? {} });
  }

  focusMain() {
    const ctx = this.ctxOf(this.panel);

    if (ctx === "files") {
      const f = statusFileOf(this.item());

      if (f) return this.startStaging(f);
    }

    if (!this.main?.rows.length) return;

    this.focus = "main";
  }

  screen(d: number) {
    this.mode = MODES[(MODES.indexOf(this.mode) + d + MODES.length) % MODES.length] ?? "normal";
    this.focus = "side";
    this.saveState();
  }

  setContext(d: number) {
    this.context = Math.max(0, Math.min(30, this.context + d));
    this.note(`Diff context: ${this.context} lines`);

    if (this.staging) this.reads.push(async () => { await this.loadStaging(); });

    this.loadMain();
  }

  scrollMain(d: number, lines: number | null = null) {
    const n = (this.staging?.rows ?? this.main?.rows ?? []).length;
    const step = lines ?? Math.max(4, Math.floor((this.mainVis ?? 20) / 2));

    if (this.staging && lines === null) {
      this.stepLine(d * step);

      return;
    }

    this.mainTop = Math.max(0, Math.min(Math.max(0, n - 4), this.mainTop + d * step));
  }

  /** ?: every key of the focused context, the list's and the window's, as
   *  keyhelp.ts's overview; a row runs its action (j k enter, or its key). */
  openKeys() {
    const ctx = this.ctx();
    const own = bindings(isListContext(ctx) || ctx === "staging" || ctx === "main" ? ctx : this.ctxOf(this.panel));
    const glob = bindings("global").filter((b) => !b.flags.has("hidden"));
    const list = isListContext(ctx) ? bindings("list").filter((b) => !b.flags.has("hidden")) : [];
    const row = (b: Binding): KeyRow => Object.assign([b.keys.map(keyLabel).join(" "), b.label, (cx: Context) => this.run(b.action, cx)] as const, { key: b.keys[0] ?? "", danger: b.flags.has("danger") });

    const sections: KeySection[] = [{ title: CONTEXT_NAMES[ctx], keys: own.filter((b) => !b.flags.has("hidden")).map(row) },
      ...(list.length ? [{ title: "list", keys: list.map(row) }] : []),
      { title: "global", keys: glob.map(row) }];

    this.popups.keys({ title: `git · ${CONTEXT_NAMES[ctx]}`, sections: sections.filter((s) => s.keys.length) });
  }

  /** A row's right-click menu: its context's actions with their keys. */
  contextMenu(ctx: ListContext | "staging" | "main") {
    const items: MenuItem[] = menuKeys(ctx).map((b) => ({ key: keyLabel(b.key), label: b.label, danger: b.flags.has("danger"), go: (cx: Context) => this.run(b.action, cx) }));

    if (!this.show && PANE_CONTEXTS.has(ctx)) {
      items.push({ key: "ctrl-p", label: "Open the diff as a pane", go: () => this.openPane(false) });
      items.push({ key: "ctrl-shift-p", label: "Open the diff in a new tab", go: () => this.openPane(true) });
    }

    const x = this.item(ctx);
    const title = nameOf(x) ?? pathOf(x) ?? subjectOf(x) ?? CONTEXT_NAMES[ctx];

    this.menu({ title: title.slice(0, 60), items, at: { x: this.mouse.x, y: this.mouse.y } });
  }

  run(action: Action, cx: Context) { act(this, action, cx); }

  // ---- staging lines

  startStaging(file: StatusFile) {
    this.staging = { file, side: file.unstaged ? "unstaged" : "staged", diff: null, rows: [], cur: 0, anchor: null, hunkMode: false, other: null };
    this.focus = "main";
    this.reads.push(async () => { await this.loadStaging(true); });
  }

  async loadStaging(first = false) {
    const s = this.staging, g = this.git;

    if (!s || !g) return;

    const now = (this.data.status?.files ?? []).find((f) => f.path === s.file.path);

    if (!now) {
      this.staging = null;
      this.focus = "side";

      return;
    }

    s.file = now;

    if (s.side === "unstaged" && !now.unstaged) s.side = "staged";

    if (s.side === "staged" && !now.staged) s.side = "unstaged";

    const [mine, other] = await Promise.all([
      g.fileDiff(now, { cached: s.side === "staged", context: this.context, ws: false }),
      (s.side === "staged" ? now.unstaged : now.staged) ? g.fileDiff(now, { cached: s.side !== "staged", context: this.context }) : Promise.resolve(null),
    ]);

    if (this.staging !== s) return;

    s.diff = mine;
    s.rows = mine ? diffRows(mine) : [];
    s.other = other ? diffRows(other) : null;

    if (!s.rows.length) {
      this.staging = null;
      this.focus = "side";

      return;
    }

    const changes = s.rows.flatMap((r, i) => (isChange(r) ? [i] : []));

    if (first || !isChange(s.rows[s.cur])) s.cur = changes.find((i) => i >= (first ? 0 : s.cur)) ?? changes[changes.length - 1] ?? 0;

    s.top = Math.min(s.top ?? 0, s.cur);
  }

  pickedKeys(): Set<string> {
    const s = this.staging;

    if (!s) return new Set();

    const r = s.rows[s.cur];

    if (!r) return new Set();

    if (s.hunkMode) return new Set(s.diff ? hunkKeys(s.diff, r.hunk) : []);

    const [a, b] = s.anchor === null ? [s.cur, s.cur] : [Math.min(s.anchor, s.cur), Math.max(s.anchor, s.cur)];

    return new Set(s.rows.slice(a, b + 1).flatMap((x) => (isChange(x) && x.line !== null ? [`${x.hunk}:${x.line}`] : [])));
  }

  stepLine(d: number) {
    const s = this.staging;

    if (!s) return;

    if (s.hunkMode) return this.stepHunk(d > 0 ? 1 : -1);

    let i = s.cur;
    const n = Math.abs(d), dir = Math.sign(d);

    for (let k = 0; k < n; k++) {
      let j = i + dir;

      while (j >= 0 && j < s.rows.length && !isChange(s.rows[j])) j += dir;

      if (j < 0 || j >= s.rows.length) break;

      i = j;
    }

    s.cur = i;
  }

  stepHunk(d: number) {
    const s = this.staging;

    if (!s) {
      this.scrollMain(d);

      return;
    }

    const h = s.rows[s.cur]?.hunk ?? 0;
    const target = Math.max(0, Math.min((s.diff?.hunks.length ?? 0) - 1, h + d));
    const i = s.rows.findIndex((r) => r.hunk === target && isChange(r));

    if (i >= 0) s.cur = i;
  }

  switchSide() {
    const s = this.staging;

    if (!s?.other) return;

    s.side = s.side === "staged" ? "unstaged" : "staged";
    s.anchor = null;
    s.cur = 0;
    this.reads.push(async () => { await this.loadStaging(true); });
  }

  stepFile(d: number) {
    const st = this.staging;

    if (!st) {
      // The main view of a multi-file diff: jump between its files.
      const rows = this.main?.rows ?? [];
      const starts = rows.flatMap((r, i) => (r.kind === "file" ? [i] : []));
      const next = d > 0 ? starts.find((i) => i > this.mainTop) : [...starts].reverse().find((i) => i < this.mainTop);

      if (next !== undefined) this.mainTop = next;
      else if (this.ctxOf(this.panel) === "review") this.move(d);

      return;
    }

    const files = this.data.status?.files ?? [];
    const i = files.findIndex((f) => f.path === st.file.path);
    const f = files[(i + d + files.length) % files.length];

    if (f) this.startStaging(f);
  }

  // ---- the main view's content

  loadMain() {
    const gen = ++this.mainGen;

    this.reads.push(async () => {
      if (gen !== this.mainGen || !this.git) return;

      const m = await this.mainContent();

      if (gen !== this.mainGen) return;

      this.main = m;
      this.mainTop = Math.min(this.mainTop, Math.max(0, (m.rows.length || 1) - 1));
    });
  }

  /** The end of a history cut at its limit came into view (`what`: "commits",
   *  "subCommits" or "main"): read as far again, the rows already shown stay
   *  where they are. Once per end: a read already going isn't asked twice. */
  more(what: More) {
    const g = this.git;

    if (this.moreBusy.has(what) || !g) return;

    this.moreBusy.add(what);
    this.reads.push(async () => {
      try {
        if (what === "commits") {
          this.commitLimit += LOG_LIMIT;

          const commits = await g.log("HEAD", { all: this.allBranches, limit: this.commitLimit });

          this.data.commits = commits;
          this.graph = layoutGraph(commits);
        } else if (what === "subCommits") {
          const s = this.subOfKind("subCommits");

          if (s?.kind === "subCommits") {
            s.limit = (s.limit ?? LOG_LIMIT) + LOG_LIMIT;
            await this.loadSub(s);
          }
        } else if (what === "main" && this.main?.more) {
          const ref = this.main.more;

          this.logLimits.set(ref, (this.logLimits.get(ref) ?? LOG_FULL_LIMIT) + LOG_FULL_LIMIT);

          const gen = this.mainGen, m = await this.mainContent();

          if (gen === this.mainGen) this.main = m; // top stays: the new rows come below
        }
      } finally { this.moreBusy.delete(what); }
    });
  }

  /** lazygit's branch log (git log --graph with whole headers): a block of
   *  rows per commit, the commit line on the lane graph's node, the others
   *  with the lanes running through, in the Commits panel's colors. `more`:
   *  the ref, when its log is cut at the limit and goes further. */
  async logRows(ref: string): Promise<{ readonly rows: readonly MainRow[]; readonly more: string | null }> {
    const g = this.git;

    if (!g) return { rows: [], more: null };

    const limit = this.logLimits.get(ref) ?? LOG_FULL_LIMIT;
    const commits = await g.logFull(ref, limit);
    const graph = layoutGraph(commits);
    const head = this.data.status?.oid;
    const refColor = { head: "ansi6", branch: "ansi2", ref: "ansi1", tag: "ansi3", detached: "ansi6" } as const;
    const rows: MainRow[] = [];

    commits.forEach((c, i) => {
      const gr = graph.rows[i];

      if (!gr) return;

      const w = usedWidth(gr);
      const line = (parts: readonly Part[]) => rows.push({ kind: "log", g: gr, w, node: false, parts });
      const refs = c.refs.flatMap((r, k): Part[] => [[k ? ", " : " (", "ansi3"], [r.kind === "head" ? `HEAD -> ${r.name}` : r.kind === "tag" ? `tag: ${r.name}` : r.name, refColor[r.kind]]]);

      rows.push({ kind: "log", g: gr, w, node: true, head: c.hash === head, parts: [[`commit ${c.short}`, "ansi3"], ...refs, ...(refs.length ? [[")", "ansi3"] as const] : [])] });

      if (c.parents.length > 1) line([["Merge: ", "dim"], [c.parents.map((p) => p.slice(0, 7)).join(" "), "muted"]]);

      line([["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]]);
      line([["Date:   ", "dim"], [relativeDate(c.date), "muted"]]);

      for (const l of c.message.split("\n")) line([[`    ${l}`, "foreground"]]);

      line([]);
    });

    return { rows: rows.length ? rows : [text("No commits.", "muted")], more: commits.length >= limit ? ref : null };
  }

  /** A worktree in the main view: where it is, what's in it (spaces,
   *  agents, uncommitted changes), then its branch's log. */
  async worktreeContent(w: Checkout): Promise<MainContent> {
    const g = this.git;
    const occ: Occupants = this.occupancy().get(w.path) ?? { spaces: [], agents: [] };
    const kv = (k: string, parts: readonly Part[]): MainRow => ({ kind: "text", parts: [[k.padEnd(10), "dim"], ...parts] });
    const rows: MainRow[] = [kv("Worktree", [[this.tilde(w.path), "foreground"], ...(w.main ? [["  (the main checkout)", "dim"] as const] : [])])];

    rows.push(kv("Branch", w.branch ? [[w.branch, "ansi6"]] : [[`detached at ${(w.head ?? "").slice(0, 7)}`, "ansi3"]]));

    if (w.prunable) rows.push(kv("Folder", [["gone: X forgets it (git worktree prune)", "ansi1"]]));
    else if (g) {
      const st = await g.read(["-C", w.path, "status", "--porcelain"]);
      const n = st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null;

      rows.push(kv("Changes", n === null ? [["unreadable", "ansi1"]] : n ? [[`${n} uncommitted file${n === 1 ? "" : "s"}`, "ansi3"]] : [["none", "muted"]]));
    }

    if (w.locked) rows.push(kv("Locked", [["git won't remove it until it's unlocked (git worktree unlock)", "ansi3"]]));

    rows.push(kv("Spaces", occ.spaces.length ? [[occ.spaces.map((s) => s.name || "unnamed").join(", "), "accent"]] : [["none: space opens one", "muted"]]));

    if (occ.agents.length) rows.push(kv("Agents", [[occ.agents.map((a) => `${a.program.name} (${a.status})`).join(", "), "ansi3"]]));

    rows.push(text(""));

    const ref = w.branch ?? w.head;
    const log = ref && !w.prunable ? await this.logRows(ref) : { rows: [], more: null };

    return { title: `Worktree · ${WT.label(w)}`, rows: [...rows, ...log.rows], rowH: LOG_ROW, more: log.more };
  }

  /** A diff's files as main-view rows: a file's head over each (unless there's one). */
  flat(files: readonly DiffFile[]): MainRow[] {
    const only = files.length === 1 ? files[0] : undefined;

    if (only) return diffRows(only).map((r) => ({ ...r, path: only.path }));

    return files.flatMap((f): MainRow[] => [{ kind: "file", text: f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path, sub: f.binary ? "binary" : `+${f.add} -${f.del}` }, ...diffRows(f).map((r) => ({ ...r, path: f.path }))]);
  }

  /** A commit's head rows: its hash and refs, a merge's parents, author, date, message. */
  commitHead(c: { readonly hash: string; readonly refs: string; readonly parents: readonly string[]; readonly author: string; readonly email: string; readonly date: number; readonly body: string }, merge: boolean): MainRow[] {
    return [
      { kind: "text", parts: [[`commit ${c.hash}`, "ansi3"], ...(c.refs ? [[` (${c.refs})`, "ansi5"] as const] : [])] },
      ...(merge && c.parents.length > 1 ? [text(`Merge: ${c.parents.map(short).join(" ")}`, "muted")] : []),
      { kind: "text", parts: [["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]] },
      { kind: "text", parts: [["Date:   ", "dim"], [new Date(c.date * 1000).toLocaleString(), "muted"]] },
      text(""), ...c.body.split("\n").map((l) => text(`    ${l}`, "foreground")), text(""),
    ];
  }

  /** A ctrl-p pane's one diff (show kinds other than review). */
  async showContent(s: Exclude<Show, { kind: "review" }>): Promise<MainContent> {
    const g = this.git, opts = { context: this.context, ws: this.ws };

    if (!g) return { title: "", rows: [] };

    if (s.kind === "file") {
      const f = (this.data.status?.files ?? []).find((x) => x.path === s.path);

      if (!f) return { title: s.path, path: s.path, rows: [text("No changes in this file now.", "muted")] };

      const [un, st] = await Promise.all([f.unstaged ? g.fileDiff(f, opts) : null, f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null]);

      const rows: MainRow[] = [
        ...(un ? [{ kind: "file", text: "unstaged", sub: `+${un.add} -${un.del}` } as const, ...diffRows(un).map((r) => ({ ...r, path: f.path }))] : []),
        ...(st ? [{ kind: "file", text: "staged", sub: `+${st.add} -${st.del}` } as const, ...diffRows(st).map((r) => ({ ...r, path: f.path }))] : []),
      ];

      return { title: `Working diff · ${f.path}`, path: f.path, rows: rows.length ? rows : [text("No text changes (mode, rename or binary).", "muted")] };
    }

    if (s.kind === "commit") {
      const c = await g.show(s.hash, { ...opts, path: s.path ?? null });

      if (!c) return { title: short(s.hash), rows: [text("Not a commit.", "muted")] };

      return { title: `Patch · ${short(c.hash)}${s.path ? ` · ${s.path}` : ""}`, rows: [...this.commitHead(c, false), ...this.flat(c.files)] };
    }

    if (s.kind === "stash") {
      const files = (await g.stashShow(s.ref, opts)).filter((f) => !s.path || f.path === s.path);

      return { title: `Stash · ${short(s.ref)}${s.path ? ` · ${s.path}` : ""}`, rows: files.length ? this.flat(files) : [text("Empty stash entry.", "muted")] };
    }

    if (s.kind === "log") {
      const log = await this.logRows(s.ref);

      return { title: `Log · ${s.ref}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
    }

    const files = await g.between(s.a, s.b, opts);

    return { title: `Diff ${short(s.a)}..${short(s.b)}`, rows: files.length ? this.flat(files) : [text("No differences.", "muted")] };
  }

  async mainContent(): Promise<MainContent> {
    if (this.show && this.show.kind !== "review") return this.showContent(this.show);

    const g = this.git, ctx = this.ctxOf(this.panel), x = this.item(ctx), opts = { context: this.context, ws: this.ws };

    if (!g) return { title: "", rows: [] };

    const ref = hashOf(x) ?? (ctx === "branches" || ctx === "tags" || ctx === "remoteBranches" ? nameOf(x) : null);

    if (this.diffBase && ref) {
      const [a, b] = this.diffReverse ? [ref, this.diffBase] : [this.diffBase, ref];
      const files = await g.between(a, b, opts);

      return { title: `Diff ${short(a)}..${short(b)}`, rows: files.length ? this.flat(files) : [text("No differences.")] };
    }

    if (!x) return { title: "", rows: [] };

    switch (ctx) {
      case "status": {
        const s = this.data.status;
        const n = (s?.files ?? []).length;

        return { title: "Status", rows: [
          text(`${g.name}`, "foreground"), text(g.root, "dim"), text(""),
          text(`on ${s?.head ?? "a detached HEAD"}${s?.upstream ? ` → ${s.upstream}` : " (no upstream)"}`, "ansi6"),
          ...(s?.upstream ? [text(`↑${s.ahead} ahead · ↓${s.behind} behind`, "ansi4")] : []),
          ...(this.data.state ? [text(`${this.data.state}: m for continue / abort`, "ansi3")] : []),
          text(`${n} changed file${n === 1 ? "" : "s"} · ${this.data.stash.length} stash entr${this.data.stash.length === 1 ? "y" : "ies"} · ${this.data.branches.length} branches`, "muted"),
          text(""), text("? lists every key · 1-5 jump to a panel · + widens it · enter on Status: recent repos", "dim"),
        ] };
      }

      case "files": {
        if (isTreeRow(x) && x.kind === "dir") {
          const files = await g.between("HEAD", null, { ...opts, path: x.path });
          const n = x.files.length;

          return { title: `${x.path} · ${n} file${n === 1 ? "" : "s"}`, rows: files.length ? this.flat(files) : [text(`${n} new file${n === 1 ? "" : "s"} under ${x.path}`, "muted")] };
        }

        const f = statusFileOf(x);

        if (!f) return { title: "", rows: [] };

        const [un, st] = await Promise.all([
          f.unstaged ? g.fileDiff(f, { ...opts }) : null,
          f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null,
        ]);

        const shown = f.unstaged ? un : st;

        return {
          title: f.unstaged ? "Unstaged changes" : "Staged changes", path: f.path,
          rows: shown ? diffRows(shown).map((r) => ({ ...r, path: f.path })) : [text(f.conflict ? "Merge conflict: enter or M for the options." : "No text changes (mode, rename or binary).", "muted")],
          second: f.unstaged && st ? { title: "Staged changes", rows: diffRows(st) } : null,
        };
      }

      case "review": {
        if (!isReviewFile(x)) return { title: "", rows: [] };

        const f = x;
        const rows = f.binary ? [text("Binary file: not shown.", "muted")] : !f.hunks.length ? [text(f.status === "untracked" ? "Untracked, not diffed (too many new files)." : "No text changes (mode or rename only).", "muted")] : diffRows(f).map((r) => ({ ...r, path: f.path }));

        return { title: `${this.review.scopeName()} · ${f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path}`, path: f.path, rows };
      }

      case "worktrees": return isCheckout(x) ? this.worktreeContent(x) : { title: "", rows: [] };
      case "remotes": {
        if (!isRemote(x)) return { title: "", rows: [] };

        return { title: x.name, rows: [text(`fetch ${x.url}`, "foreground"), text(`push  ${x.push}`, "muted"), text(""), ...this.data.remoteBranches.filter((r) => r.remote === x.name).slice(0, 40).map((r) => text(`${r.branch}  ${r.subject}`, "muted"))] };
      }

      case "branches": case "remoteBranches": case "tags": {
        const name = nameOf(x) ?? "";
        const log = await this.logRows(name);

        return { title: `Log · ${name}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
      }

      case "commits": case "subCommits": case "reflog": {
        const hash = hashOf(x) ?? "";
        const c = await g.show(hash, opts);

        if (!c) return { title: short(hash), rows: [text("Not a commit.", "muted")] };

        return { title: `Patch · ${short(c.hash)}`, rows: [...this.commitHead(c, true), ...this.flat(c.files)] };
      }

      case "commitFiles": {
        const s = this.sub();

        if (isTreeRow(x) && x.kind === "dir") return { title: x.path, rows: [text(`${x.files.length} files under ${x.path}`, "muted")] };

        if (s?.kind !== "commitFiles") return { title: "", rows: [] };

        const path = pathOf(x) ?? "";
        const files = s.stash ? (await g.stashShow(s.hash, opts)).filter((d) => d.path === path) : (await g.show(s.hash, { ...opts, path }))?.files ?? [];

        return { title: `${short(s.hash)} · ${path}`, rows: files.length ? this.flat(files) : [text("No text changes.", "muted")] };
      }

      case "stash": {
        if (!isStash(x)) return { title: "", rows: [] };

        const files = await g.stashShow(x.ref, opts);

        return { title: `${x.ref} · ${x.subject}`, rows: files.length ? this.flat(files) : [text("Empty stash entry.", "muted")] };
      }
    }
  }

  // ---- keys

  key(e: KeyEvent, cx: Context) {
    // cmd-enter submits a popup's form (keyName leaves cmd chords to the app).
    const k = this.popups.open && e.key === "enter" && e.modifiers.platform ? "cmd-enter" : keyName(e);

    if (!k) return;

    if (this.popups.open) {
      if (this.popups.key(k, e, cx)) {
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    if (this.filtering) {
      if (k === "escape") {
        this.back();
        cx.stop_propagation();
        cx.notify();
      } else if (k === "enter" || k === "down" || k === "up") {
        this.filtering = null;
        this.handle?.focus();
        this.loadMain();
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    const ctx = this.ctx();

    if (this.state !== "ready") {
      if (k === "q" || k === "escape") {
        this.quit(k === "escape");
        cx.stop_propagation();
      }

      return;
    }

    if (ctx === "keys" || ctx === "filter") return;

    const b = lookup(ctx, k);

    if (!b) return;

    if (!act(this, b.action, cx)) return;

    cx.stop_propagation();
    cx.notify();
  }

  // ---- mouse

  rowPress(ctx: ListContext, i: number, e: MouseButtonEvent, cx: Context) {
    const p = PANELS.find((x) => this.ctxOf(x) === ctx) ?? this.panel;
    const was = this.panel === p && this.focus === "side" && (this.sel[ctx] ?? 0) === i;

    this.handle?.focus();

    if (this.panel !== p || this.focus !== "side") {
      this.panel = p;
      this.focus = "side";
      this.staging = null;
    }

    if (e.modifiers.shift) {
      if (!this.range) this.range = { ctx, anchor: this.sel[ctx] ?? 0 };
    } else if (!was) this.range = null;

    this.sel[ctx] = i;
    this.mainTop = 0;
    this.loadMain();

    if (e.click_count === 2) {
      const b = lookup(ctx, "enter");

      if (b) act(this, b.action, cx);
    }

    cx.notify();
  }

  rowMenu(ctx: ListContext, i: number, cx: Context) {
    const p = PANELS.find((x) => this.ctxOf(x) === ctx) ?? this.panel;

    this.panel = p;
    this.focus = "side";
    this.staging = null;
    this.sel[ctx] = i;
    this.loadMain();
    this.contextMenu(ctx);
    cx.notify();
  }

  wheel(ctx: ListContext, e: ScrollWheelEvent, rowH: number, n: number, cx: Context) {
    cx.stop_propagation();

    const dy = unzoom(e.delta.y);

    this.wheelAcc += dy / rowH;

    const steps = Math.trunc(this.wheelAcc);

    if (!steps) return;

    this.wheelAcc -= steps;

    const vis = this.vis[ctx] ?? 10;

    this.top[ctx] = Math.max(0, Math.min(Math.max(0, n - vis), (this.top[ctx] ?? 0) - steps));
    cx.notify();
  }

  resize(e: MouseButtonEvent, key: string, from: number, set: (v: number) => void, options: ResizeOptions = {}) {
    const { min = 160, max = 4000, sign = 1, axis = "x" } = options;

    this.resizing = { key, axis, at: axis === "x" ? e.position.x : e.position.y, from, set, min, max: Math.max(min, max), sign };
  }

  splitter(t: Theme, id: string, axis: "x" | "y", key: string, from: number, set: (v: number) => void, opts: ResizeOptions) {
    const on = this.resizing?.key === key;
    const el = div().id(id).relative().flex_none();
    const sized = axis === "x" ? el.w(6).h_full().cursor_col_resize() : el.h(6).w_full().cursor_row_resize();

    const live = sized
      .hover((s) => s.bg(`${t.ansi0}88`))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.resize(e, key, from, set, { axis, ...opts });
        cx.notify();
      });

    const line = div().absolute();

    return on ? live.child((axis === "x" ? line.top(0).bottom(0).left(2).w(2) : line.left(0).right(0).top(2).h(2)).bg(t.accent)) : live;
  }

  // ---- drawing: lists

  /** A list body: only the rows in view are drawn (lazygit scrolls by row). */
  list(t: Theme, ctx: ListContext, rowH: number, draw: DrawRow, active: boolean) {
    const rows = this.items(ctx);
    const n = rows.length;
    // The rows that fit, from the list's height: the row height can change
    // without a resize (Commits going wide), so a count kept from the last
    // resize would leave the bottom of the list empty.
    const px = this.listPx[ctx];
    const vis = px ? rowWindow(n, 0, px, rowH).vis : Math.max(1, this.vis[ctx] ?? 12);

    this.vis[ctx] = vis;

    let top = this.top[ctx] ?? 0;
    const sel = Math.min(this.sel[ctx] ?? 0, Math.max(0, n - 1));

    if (this.follow[ctx]) {
      if (sel < top) top = sel;

      if (sel >= top + vis) top = sel - vis + 1;

      this.follow[ctx] = false;
    }

    top = Math.max(0, Math.min(top, Math.max(0, n - vis)));
    this.top[ctx] = top;

    // The end of a history cut at its limit is in view: read further.
    if (n && top + vis >= n - 1 && this.cut(ctx) && (ctx === "commits" || ctx === "subCommits")) this.more(ctx);

    const range = this.range?.ctx === ctx ? [Math.min(this.range.anchor, sel), Math.max(this.range.anchor, sel)] as const : null;

    const shown = rows.slice(top, top + vis + 1).map((r, k) => {
      const i = top + k, isSel = i === sel, inRange = range !== null && i >= range[0] && i <= range[1];

      const row = div().id(`${ctx}-row-${i}`).relative().h(rowH).flex_none().w_full()
        .hover((s) => s.bg(`${t.ansi0}55`))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.rowPress(ctx, i, e, cx); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rowMenu(ctx, i, cx); });

      const banded = (isSel || inRange ? row.children(band(t, active && this.focus === "side")) : row)
        .child(draw(r, i, isSel).relative().size_full());

      return this.busyRows.size > 0 && this.busyRows.has(rowKey(ctx, r) ?? "") ? banded.children(busyMark(t, `${ctx}-busy-${i}`)) : banded;
    });

    const tail = n > 0 && top + vis >= n - 1 ? this.listTail(t, ctx, n - 1, rowH) : null;

    const body = div().id(`${ctx}-list`).relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);

        if (h !== this.listPx[ctx]) {
          this.listPx[ctx] = h;
          this.vis[ctx] = Math.max(1, Math.floor(h / rowH));
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => this.wheel(ctx, e, rowH, n, cx))
      .child(v_flex().size_full().children(shown).children(tail ? [tail] : []));

    const scrolled = n > vis
      ? body.child(div().absolute().right(0).w(2).top(`${Math.round((top / n) * 100)}%`).h(`${Math.max(4, Math.round((vis / n) * 100))}%`).bg(active ? `${t.accent}aa` : `${t.ansi8}66`))
      : body;

    return n ? scrolled : scrolled.child(div().absolute().inset_0().child(empty(t, this.emptyText(ctx), null, { small: true })));
  }

  /** Whether a list holds a history cut at its limit (it goes further back).
   *  Not while filtered: the end of a filtered list isn't the history's. */
  cut(ctx: ListContext) {
    if (this.filters[ctx]) return false;

    if (ctx === "commits") return this.data.commits.length >= this.commitLimit;

    if (ctx === "subCommits") {
      const s = this.subOfKind("subCommits");

      return s?.kind === "subCommits" && s.items.length >= (s.limit ?? LOG_LIMIT);
    }

    return false;
  }

  /** Below a commit list's last row: its open lanes run on to the bottom
   *  edge (history cut at the limit, or the panel taller than the list), so
   *  no line ends in the air. */
  listTail(t: Theme, ctx: ListContext, last: number, rowH: number) {
    if (ctx !== "commits" && ctx !== "subCommits") return null;

    const g = this.graphFor(ctx), row = g?.rows[last];

    if (!g || !row || !row.after.some((c) => c != null)) return null;

    const wide = rowH === WIDE_ROW;
    const h = Math.max(rowH, this.listPx[ctx] ?? 600);
    const lanes = graphPass(t, row.after, this.shownWidth(ctx, g), { lane: wide ? WIDE_LANE : LANE, h });
    const tail = h_flex().id(`${ctx}-tail`).flex_1().min_h(0).w_full().items_start().overflow_hidden();

    return wide ? tail.pl(4).child(lanes) : tail.px(6).gap(7).child(div().w(56).flex_none()).child(div().w(18).flex_none()).child(lanes);
  }

  emptyText(ctx: ListContext) {
    if (this.filters[ctx]) return `Nothing matches "${this.filters[ctx] ?? ""}"`;

    switch (ctx) {
      case "files": return "Nothing changed: the work tree is clean";
      case "review": return this.review.state === "loading" ? "Reading changes…" : this.review.state === "error" ? this.review.error : `Nothing changed (${this.review.scopeName()})`;
      case "branches": return "No branches";
      case "remotes": return "No remotes: n adds one";
      case "tags": return "No tags";
      case "commits": return "No commits yet";
      case "reflog": return "Empty reflog";
      case "stash": return "Nothing stashed";
      case "worktrees": return "No worktrees";
      case "remoteBranches": return "No branches on this remote";
      case "subCommits": case "commitFiles": return "Reading…";
      default: return "Empty";
    }
  }

  rowLine(kids: readonly (Element | null)[], pad = 8) {
    return h_flex().px(pad).gap(7).items_center().text_size(11).overflow_hidden().children(kids.flatMap((k) => (k ? [k.relative()] : [])));
  }

  txt(s: string, color: Color, options: TxtOptions = {}) {
    const { w = null, grow = false } = options;

    if (grow) return div().flex_1().min_w(0).truncate().text_color(color).child(s);

    const el = div().flex_none().text_color(color).child(s);

    return w ? el.w(w) : el;
  }

  drawRow(t: Theme, ctx: ListContext, wide: boolean): DrawRow {
    const T = (s: string, c: Color, o?: TxtOptions) => this.txt(s, c, o);
    const none = () => div();

    switch (ctx) {
      case "status": return () => {
        const s = this.data.status;

        return this.rowLine([
          s?.upstream ? h_flex().gap(2).child(T(`↑${s.ahead}`, t.ansi4)).child(T(`↓${s.behind}`, t.ansi5)) : null,
          T(this.git?.name ?? "", t.foreground), T("→", t.dim), T(s?.head ?? "(detached)", t.ansi6),
          this.data.state ? T(this.data.state.toUpperCase(), t.ansi3) : null,
        ]);
      };

      case "files": case "commitFiles": return (r, _i, sel) => {
        if (!isTreeRow(r)) return none();

        if (r.kind === "dir") {
          const files = r.files;
          const l = ctx === "files" ? dirLetters(files.flatMap((f) => ("staged" in f ? [f] : []))) : null;

          return this.rowLine([div().w(r.depth * 12).flex_none(), T(r.open ? "▾" : "▸", t.dim),
            l ? h_flex().child(T(l.x, letterColor(t, l.x, true))).child(T(l.y, letterColor(t, l.y, false))) : null,
            T(r.name, t.muted, { grow: true }), T(String(r.files.length), t.dim)]);
        }

        const f = r.file;

        if ("status" in f) {
          const c = f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "M" ? t.ansi3 : f.status === "R" ? t.ansi4 : t.muted;

          return this.rowLine([div().w(r.depth * 12 + (this.tree ? 12 : 0)).flex_none(), T(f.status, c, { w: 10 }), T(f.from ? `${f.from} → ${r.name}` : r.name, sel ? t.foreground : t.muted, { grow: true })]);
        }

        const [x = " ", y = " "] = letters(f);
        const color = f.conflict ? t.ansi3 : f.untracked ? t.ansi1 : f.staged && !f.unstaged ? t.ansi2 : sel ? t.foreground : t.muted;

        return this.rowLine([div().w(r.depth * 12 + (this.tree ? 12 : 0)).flex_none(),
          h_flex().w(16).flex_none().child(T(x, letterColor(t, x, true))).child(T(y, letterColor(t, y, false))),
          T(f.from ? `${f.from} → ${r.name}` : r.name, color, { grow: true })]);
      };

      case "review": return (f, i, sel) => {
        if (!isReviewFile(f)) return none();

        const done = this.review.marks().has(f.key);
        const [letter, c] = reviewLetter(t, f.status);
        const slash = f.path.lastIndexOf("/");
        const box = div().id(`rv-box-${i}`).relative().size(10).flex_none().border(1).border_color(done ? t.ansi2 : t.ansi8);

        return this.rowLine([
          (done ? box.child(dither(t.ansi2, 1)) : box)
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.review.toggle(f); cx.notify(); }),
          T(letter, c, { w: 8 }),
          h_flex().flex_1().min_w(0).gap(6).child(div().flex_none().truncate().text_color(done ? t.dim : sel ? t.foreground : t.muted).child(f.path.slice(slash + 1)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash) : "")),
          T(f.binary ? "bin" : `${f.add + f.del}`, t.dim),
        ]);
      };

      case "worktrees": {
        // * this window's checkout, ◆ picked for d; then the branch, what's
        // in it (agents, open in a space), how old its last commit is, where.
        const occ = this.occupancy();

        return (w, _i, sel) => {
          if (!isCheckout(w)) return none();

          const o = occ.get(w.path) ?? { spaces: [], agents: [] };
          const picked = this.wtPicked.has(w.path);
          const mark = picked ? ["◆", t.ansi5] as const : w.path === this.git?.root ? ["*", t.ansi6] as const : [" ", t.dim] as const;
          const busy = o.agents.length ? [`${o.agents.length} agent${o.agents.length === 1 ? "" : "s"}`, o.agents.some((a) => a.status === "blocked") ? t.ansi1 : t.working] as const : null;

          return this.rowLine([
            T(mark[0], mark[1], { w: 8 }),
            T(w.branch ?? `(detached) ${(w.head ?? "").slice(0, 7)}`, w.branch ? (sel ? t.foreground : t.ansi6) : t.ansi3),
            w.main ? T("main", t.dim) : null,
            w.prunable ? T("folder gone", t.ansi1) : w.locked ? T("locked", t.ansi3) : null,
            T(this.tilde(w.path), t.dim, { grow: true }),
            busy ? T(busy[0], busy[1]) : o.spaces.length ? T("open", t.accent) : null,
            w.at ? T(age(w.at), t.dim) : null,
          ]);
        };
      }

      case "branches": return (b, _i, sel) => (isBranch(b) ? this.rowLine([
        T(age(b.date), t.dim, { w: 26 }),
        T(b.head ? `* ${b.name}` : b.name, b.head ? t.ansi6 : sel ? t.foreground : t.muted),
        b.ahead ? T(`↑${b.ahead}`, t.ansi4) : null, b.behind ? T(`↓${b.behind}`, t.ansi5) : null,
        b.gone ? T("(upstream gone)", t.dim) : b.upstream && !b.ahead && !b.behind ? T("✓", t.ansi2) : null,
        wide ? T(b.subject, t.dim, { grow: true }) : null,
      ]) : none());
      case "remotes": return (r, _i, sel) => (isRemote(r) ? this.rowLine([T(r.name, sel ? t.foreground : t.muted), T(r.url, t.dim, { grow: true })]) : none());
      case "remoteBranches": return (r, _i, sel) => (isRemoteBranch(r) ? this.rowLine([T(age(r.date), t.dim, { w: 26 }), T(r.name, sel ? t.foreground : t.muted), wide ? T(r.subject, t.dim, { grow: true }) : null]) : none());
      case "tags": return (g, _i, sel) => (isTag(g) ? this.rowLine([T("◆", t.ansi3), T(g.name, sel ? t.foreground : t.muted), T(g.subject, t.dim, { grow: true })]) : none());
      case "reflog": return (r, _i, sel) => (isReflog(r) ? this.rowLine([T(r.short, t.ansi5, { w: 56 }), T(age(r.date), t.dim, { w: 26 }), T(r.subject, sel ? t.foreground : t.muted, { grow: true })]) : none());
      case "stash": return (s, _i, sel) => (isStash(s) ? this.rowLine([T(String(s.index), t.dim, { w: 14 }), T(s.subject, sel ? t.foreground : t.muted, { grow: true })]) : none());
      case "commits": case "subCommits": return wide ? this.wideCommit(t, ctx) : this.commitRow(t, ctx);
    }
  }

  /** The graph column's width in lanes for the rows in view (list() sets
   *  the top before it draws them). */
  shownWidth(ctx: ListContext, g: Graph) {
    const top = this.top[ctx] ?? 0;

    return widthOf(g.rows, top, top + Math.max(1, this.vis[ctx] ?? 12) + 1);
  }

  graphFor(ctx: ListContext): Graph | null {
    if (this.noGraph || this.filters[ctx]) return null;

    const s = this.sub();

    return ctx === "subCommits" ? (s?.kind === "subCommits" ? s.graph : null) : this.graph;
  }

  hashColor(t: Theme, c: Commit) {
    if (this.data.unpushed.has(c.hash)) return t.ansi1;

    if (this.data.notMain.size && !this.data.notMain.has(c.hash)) return t.ansi2;

    return t.ansi3;
  }

  authorColor(t: Theme, name: string) {
    const cs = [t.ansi5, t.ansi6, t.ansi4, t.ansi3, t.ansi2, t.ansi13, t.ansi10, t.ansi12];
    let h = 0;

    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;

    return cs[h % cs.length] ?? t.ansi5;
  }

  refChips(t: Theme, c: Commit) {
    return c.refs.flatMap((r) => {
      if (r.kind === "detached") return [];

      const color = r.kind === "tag" ? t.ansi3 : r.kind === "ref" ? t.ansi5 : t.ansi6;

      return [div().flex_none().text_color(color).child(r.kind === "tag" ? `◆ ${r.name}` : r.kind === "head" ? `${r.name} ✱` : r.name)];
    });
  }

  commitRow(t: Theme, ctx: ListContext): DrawRow {
    const g = this.graphFor(ctx);

    return (c, i, sel) => {
      if (!isCommit(c)) return div();

      const row = g?.rows[i];
      const copied = this.copied.some((x) => x.hash === c.hash);

      return this.rowLine([
        T7(c.short, this.hashColor(t, c)),
        div().w(18).flex_none().text_color(this.authorColor(t, c.author)).child(initials(c.author)),
        g && row ? graphCell(t, row, this.shownWidth(ctx, g), { lane: LANE, h: ROW, head: this.isHead(c) }) : null,
        copied ? div().flex_none().px(3).bg(`${t.ansi5}44`).text_color(t.ansi5).child("copied") : null,
        ...this.refChips(t, c),
        div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(c.subject),
      ], 6);
    };
  }

  /** Commits in half / full mode: B's constellation rows. */
  wideCommit(t: Theme, ctx: ListContext): DrawRow {
    const g = this.graphFor(ctx);
    const colors = laneColors(t);
    const list = this.items(ctx);
    const firstOnMain = this.data.notMain.size ? list.findIndex((c) => !this.data.notMain.has(hashOf(c) ?? "")) : -1;

    return (c, i, sel) => {
      if (!isCommit(c)) return div();

      const row = g?.rows[i];
      const lane = row ? colors[row.color % colors.length] ?? t.accent : t.accent;

      const flags = c.refs.flatMap((r) => {
        if (r.kind === "detached") return [];

        const color = r.kind === "tag" ? t.ansi3 : lane;

        return [r.kind === "ref"
          ? div().flex_none().h(15).px(5).flex().items_center().border(1).border_color(t.ansi5).text_size(10).text_color(t.ansi5).child(r.name)
          : div().flex_none().h(15).px(5).flex().items_center().bg(color).text_size(10).text_color(t.background).child(r.kind === "tag" ? `◆ ${r.name}` : r.name)];
      });

      const copied = this.copied.some((x) => x.hash === c.hash);
      const ahead = this.data.unpushed.has(c.hash);
      const head = h_flex().gap(7).items_center().text_size(11).children(flags);
      const marked = copied ? head.child(div().flex_none().px(3).bg(`${t.ansi5}44`).text_color(t.ansi5).child("copied")) : head;

      const line = h_flex().pl(4).pr(8).gap(8).items_center().overflow_hidden()
        .child(g && row ? graphCell(t, row, this.shownWidth(ctx, g), { lane: WIDE_LANE, h: WIDE_ROW, head: this.isHead(c), big: true }).relative() : div())
        .child(v_flex().relative().flex_1().min_w(0).gap(2).justify_center()
          .child(marked.child(div().flex_1().min_w(0).truncate().text_color(sel || this.data.notMain.has(c.hash) ? t.foreground : t.muted).child(c.subject)))
          .child(h_flex().gap(8).text_size(10).text_color(t.dim)
            .child(div().flex_none().text_color(ahead ? t.ansi1 : this.hashColor(t, c)).child(`${c.short}${ahead ? " ↑" : ""}`))
            .child(div().flex_none().text_color(this.authorColor(t, c.author)).child(c.author))
            .child(div().flex_none().child(age(c.date)))));

      return i === firstOnMain && firstOnMain > 0
        ? line.child(h_flex().absolute().left(g ? this.shownWidth(ctx, g) * WIDE_LANE + 8 : 8).right(8).top(0).h(1).child(dither(t.ansi8, 1)))
          .child(div().absolute().right(10).top(-6).px(4).bg(t.background).text_size(10).text_color(t.ansi4).child(`↑ ${firstOnMain} not on ${this.data.main ?? ""}`))
        : line;
    };
  }

  // ---- drawing: panels

  tabsTitle(t: Theme, p: Panel, active: boolean, num: number): Element[] {
    const parts = [div().text_color(active ? t.accent : t.dim).child(`[${num}]`)];
    const s = this.sub(p);

    if (s) {
      parts.push(div().text_color(t.foreground).child(s.kind === "subCommits" ? "Commits" : s.kind === "remoteBranches" ? "Remote branches" : "Files"));
      parts.push(div().text_color(t.dim).child(`· ${s.title}`));

      return parts;
    }

    if (!isTabbed(p)) {
      parts.push(div().text_color(active ? t.foreground : t.muted).child(p === "status" ? "Status" : "Stash"));

      return parts;
    }

    const tabs: readonly (readonly [Tab, string])[] = TABS[p];

    tabs.forEach(([id, label], k) => {
      if (k) parts.push(div().text_color(t.ansi0).child("-"));

      const on = this.tabOf[p] === id;

      // The open tab of the focused panel is lit in the accent, lazygit's
      // way: an underline would sit below the edge row, on the first row.
      parts.push(div().id(`tab-${p}-${id}`).text_color(on ? (active ? t.accent : t.muted) : t.dim)
        .hover((st) => st.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          this.panel = p;
          this.focus = "side";
          this.setTab(id);
          cx.notify();
        })
        .child(label));
    });

    return parts;
  }

  /** The ⤢ that cycles a panel's screen mode (the mouse's + and _). */
  modeChip(t: Theme, p: Panel) {
    const big = this.panel === p && this.mode !== "normal";

    return div().id(`mode-${p}`).px(2).text_color(big ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
      .tooltip(big ? `${this.mode} screen: + / _ cycle, click to shrink` : "Widen (+): half, then full screen")
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();

        if (this.panel !== p) {
          this.panel = p;
          this.focus = "side";
          this.mode = "normal";
        }

        this.screen(1);
        this.loadMain();
        cx.notify();
      })
      .child(big ? "⤡" : "⤢");
  }

  sidePanel(t: Theme, p: Panel, options: SideOptions = {}) {
    const { wide = false, compact = false } = options;
    const active = this.panel === p && this.focus === "side" && !this.popups.open;
    const num = PANELS.indexOf(p) + 1;
    const ctx = this.ctxOf(p);
    const n = this.items(ctx).length;
    const isCommits = ctx === "commits" || ctx === "subCommits";
    const rowH = wide && isCommits ? WIDE_ROW : ROW;
    const filtering = this.filtering?.ctx === ctx ? this.filtering : null;
    const count = n ? `${Math.min((this.sel[ctx] ?? 0) + 1, n)} of ${n}${this.cut(ctx) ? "+" : ""}` : null;
    const reviewed = ctx === "review" && this.review.files.length ? `${this.review.scopeName()} · ${this.review.summary()}` : count;
    const filter = this.filters[ctx];
    const foot = filter && !filtering ? `/${filter} · ${reviewed ?? "0"}` : reviewed;

    const list = v_flex().size_full()
      .child(div().flex_1().min_h(0).child(this.list(t, ctx, rowH, this.drawRow(t, ctx, wide), active)));

    const body = filtering
      ? list.child(h_flex().h(22).mx(4).mb(2).px(6).gap(6).items_center().border(1).border_color(t.accent).text_size(11)
        .child(div().text_color(t.accent).child("/")).child(Input.new(filtering.input).flex_1().text_size(11).text_color(t.foreground)))
      : list;

    return panel(t, `panel-${p}`, this.tabsTitle(t, p, active, num), active, body, {
      foot: compact || p === "status" ? null : foot,
      right: p === "status" ? null : this.modeChip(t, p),
      onTitle: (e, cx) => {
        this.handle?.focus();
        this.panel = p;
        this.focus = "side";
        this.staging = null;

        if (e.click_count === 2) this.screen(1);

        this.loadMain();
        cx.notify();
      },
    }).on_mouse_down("left", (_e, cx) => {
      this.handle?.focus();

      if (this.panel !== p || this.focus !== "side") {
        this.panel = p;
        this.focus = "side";
        this.staging = null;
        this.loadMain();
      }

      cx.notify();
    });
  }

  sideColumn(t: Theme, panels: readonly Panel[], compact = false) {
    return v_flex().size_full().gap(12).pt(7).children(panels.map((p) => {
      const el = this.sidePanel(t, p, { compact });
      const focusedHere = this.panel === p;

      if (p === "status") return el.h(30).flex_none();

      if (p === "stash" && !focusedHere) return el.h(this.data.stash.length ? Math.min(3, this.data.stash.length) * ROW + 20 : 30).flex_none();

      return el.flex_grow(focusedHere && !compact ? 2.2 : 1).flex_basis(0).min_h(30);
    }));
  }

  mainPanel(t: Theme) {
    const active = this.focus === "main" && !this.popups.open;
    const code = settings().font_family || "JetBrains Mono";
    const s = this.staging;
    const m = this.main;
    const narrow = this.size.width < NARROW;

    if (s) {
      const keys = this.pickedKeys();
      const mine = this.mainList(t, "main-diff", s.rows, (r, i) => diffLine(t, r, { code, compact: narrow, pick: r.kind !== "@" && keys.has(`${r.hunk}:${r.line}`), cursor: i === s.cur, active, path: s.file.path }), { follow: s.cur, key: "staging" });
      const title = (on: boolean, label: string) => [div().text_color(on ? t.foreground : t.dim).child(label)];
      const right = div().text_color(t.dim).child(`${s.file.path}${s.hunkMode ? " · hunk" : s.anchor !== null ? " · range" : ""}`);
      const a = panel(t, "main-a", title(true, s.side === "staged" ? "Staged changes" : "Unstaged changes"), active, mine, { right, foot: active ? "tab: other side · a: hunk mode" : null }).flex_grow(1.4).flex_basis(0);

      if (!s.other) return v_flex().size_full().gap(12).pt(7).child(a);

      const b = panel(t, "main-b", title(false, s.side === "staged" ? "Unstaged changes" : "Staged changes"), false,
        this.mainList(t, "main-other", s.other, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: s.file.path }), { key: "other" }),
        { onTitle: (_e, cx) => { this.switchSide(); cx.notify(); } }).flex_grow(0.8).flex_basis(0);

      return v_flex().size_full().gap(12).pt(7).child(s.side === "staged" ? b : a).child(s.side === "staged" ? a : b);
    }

    const rows = m?.rows ?? [];
    const rowH = m?.rowH ?? ROW;

    const body = !m ? empty(t, this.state === "ready" ? "Reading…" : "", null, { small: true })
      : !rows.length ? empty(t, "Nothing to show", null, { small: true })
      : this.mainList(t, "main-diff", rows, (r) => diffLine(t, r, { code, compact: narrow, path: ("path" in r ? r.path : undefined) ?? m.path ?? null, active, h: rowH }), { key: "main", rowH });

    // ⧉: what this view shows, as a pane (shift: a new tab), like a pane header's split.
    const asPane = !this.show && rows.length ? div().id("main-as-pane").px(3).flex_none().text_color(t.dim).hover((st) => st.text_color(t.accent).bg(`${t.ansi0}66`))
      .tooltip("Open as a pane beside (ctrl-p) · shift: in a new tab (ctrl-shift-p)")
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.openPane(e.modifiers.shift); cx.notify(); })
      .child(svg("mods/workspace-chrome/panel-right.svg").size(11).text_color(t.dim)) : null;

    const base = this.diffBase;
    const extras = base || asPane ? h_flex().gap(8).items_center() : null;
    const withBase = extras && base ? extras.child(div().text_color(t.ansi3).child(`diff mode: ${short(base)} (W)`)) : extras;
    const right = withBase && asPane ? withBase.child(asPane) : withBase;

    const one = panel(t, "main-a", [div().text_color(active ? t.foreground : t.muted).child(m?.title ?? "")], active, body, {
      right,
      onTitle: (_e, cx) => { this.focusMain(); cx.notify(); },
    }).flex_grow(1.4).flex_basis(0);

    const second = m?.second;
    const parts = [one];

    if (second) {
      parts.push(panel(t, "main-b", [div().text_color(t.dim).child(second.title)], false,
        this.mainList(t, "main-second", second.rows, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: m.path ?? null }), { key: "second" })).flex_grow(0.8).flex_basis(0));
    }

    return v_flex().size_full().gap(12).pt(7).children(parts);
  }

  /** A main-view list: windowed like the side lists; the wheel scrolls it. */
  mainList<R extends MainRow>(t: Theme, id: string, rows: readonly R[], draw: (r: R, i: number) => Element, options: MainListOptions = {}) {
    const { follow = null, key = "main", rowH = ROW } = options;
    // As list(): the rows that fit come from the height, at this list's row
    // height (a diff's and the branch log's differ).
    const px = this.mainPx[key];
    const vis = px ? rowWindow(rows.length, 0, px, rowH).vis : 30;
    const staging = this.staging;
    let top = key === "staging" ? (staging?.top ?? 0) : key === "main" ? this.mainTop : (this.otherTop[key] ?? 0);

    if (follow !== null) {
      if (follow < top + 1) top = Math.max(0, follow - 2);

      if (follow >= top + vis - 1) top = follow - vis + 3;
    }

    top = Math.max(0, Math.min(top, Math.max(0, rows.length - vis)));

    const setTop = (v: number) => {
      if (key === "staging") {
        if (this.staging) this.staging.top = v;
      } else if (key === "main") this.mainTop = v;
      else this.otherTop[key] = v;
    };

    setTop(top);

    if (key === "main" || key === "staging") this.mainVis = vis;

    if (key === "main" && this.main?.more && rows === this.main.rows && top + vis >= rows.length - 1) this.more("main");

    const last = rows[rows.length - 1];
    const tail = top + vis >= rows.length - 1 ? logTail(t, last, px ?? 600) : null;

    const list = div().id(id).relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);

        if (h !== this.mainPx[key]) {
          this.mainPx[key] = h;
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => {
        cx.stop_propagation();
        this.mainWheel += unzoom(e.delta.y) / rowH;

        const steps = Math.trunc(this.mainWheel);

        if (!steps) return;

        this.mainWheel -= steps;
        setTop(Math.max(0, Math.min(Math.max(0, rows.length - vis), top - steps)));
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        this.handle?.focus();

        const s = this.staging;

        if (key === "staging" && s) {
          // A click picks the line under the pointer; shift extends a range.
          const y = unzoom(e.local_position?.y ?? 0);
          const i = top + Math.floor(y / rowH);

          if (isChange(s.rows[i])) {
            if (e.modifiers.shift) {
              if (s.anchor === null) s.anchor = s.cur;
            } else s.anchor = null;

            s.cur = i;
          }

          if (e.click_count === 2) act(this, "stage-pick", cx);
        }

        if (this.focus !== "main" && (key === "main" || key === "staging") && rows.length) this.focusMain();

        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();

        if (this.staging || this.focus === "main") this.contextMenu(this.staging ? "staging" : "main");

        cx.notify();
      })
      .child(v_flex().size_full().children(rows.slice(top, top + vis + 1).map((r, k) => draw(r, top + k).id(`${id}-${top + k}`).flex_none()))
        .children(tail ? [tail] : []));

    return rows.length > vis
      ? list.child(div().absolute().right(0).w(2).top(`${Math.round((top / rows.length) * 100)}%`).h(`${Math.max(3, Math.round((vis / rows.length) * 100))}%`).bg(`${t.ansi8}66`))
      : list;
  }

  logPanel(t: Theme) {
    const shown = this.logs.slice(-40);

    const lines = shown.flatMap((e, i) => {
      const title = h_flex().id(`log-t-${i}`).gap(6).text_size(11).child(div().text_color(e.ok === false ? t.ansi1 : t.foreground).child(e.title));

      return [
        e.ok === null ? title.child(div().text_color(t.working).frames(["░", "▒", "▓", "█", "▓", "▒"], 120)) : title,
        div().id(`log-c-${i}`).pl(12).text_size(11).truncate().text_color(e.ok === false ? `${t.ansi1}cc` : t.ansi6).child(e.cmd),
      ];
    });

    const vis = Math.max(1, Math.floor((this.logH - 14) / 15));
    const body = v_flex().size_full().px(10).justify_end().overflow_hidden().children(lines.slice(-vis));

    return panel(t, "panel-log", [div().text_color(t.muted).child("Command log")], false,
      lines.length ? body : body.child(div().text_size(11).text_color(t.dim).child("What git runs shows here (@ for options).")),
      { right: div().text_color(t.dim).child("@") }).size_full();
  }

  mainColumn(t: Theme) {
    const column = v_flex().flex_1().min_w(0).h_full()
      .child(div().flex_1().min_h(0).child(this.mainPanel(t)));

    return this.showLog
      ? column
        .child(this.splitter(t, "split-log", "y", "log", this.logH, (v) => { this.logH = v; }, { min: 50, max: Math.max(60, this.size.height - 200), sign: -1 }))
        .child(div().h(this.logH).flex_none().pt(6).child(this.logPanel(t)))
      : column;
  }

  /** A ctrl-p pane: the one diff, or the review list beside its diff. */
  showBody(t: Theme, show: Show) {
    if (show.kind !== "review") return div().size_full().px(6).pb(4).child(this.mainPanel(t));

    if (this.size.width < NARROW) return div().size_full().px(6).pb(4).child(this.focus === "main" ? this.mainPanel(t) : this.sidePanel(t, "files").size_full().mt(7));

    const sideW = this.sideW ?? Math.round(Math.max(220, Math.min(360, this.size.width * 0.3)));

    return h_flex().size_full().px(6).pb(4)
      .child(div().w(sideW).flex_none().h_full().pt(7).child(this.sidePanel(t, "files").size_full()))
      .child(this.splitter(t, "split-side", "x", "side", sideW, (v) => { this.sideW = v; }, { min: 160, max: this.size.width * 0.7 }))
      .child(div().flex_1().min_w(0).h_full().child(this.mainPanel(t)));
  }

  body(t: Theme) {
    if (this.show) return this.showBody(t, this.show);

    const w = this.size.width;
    const narrow = w < NARROW;

    if (narrow) {
      // One thing at a time: the side panels, or the main view (enter / esc).
      if (this.focus === "main") return div().size_full().px(6).pb(4).child(this.mainPanel(t));

      return div().size_full().px(6).pb(4).child(this.sideColumn(t, PANELS));
    }

    if (this.mode === "full") {
      return div().size_full().px(6).pb(4).pt(7).child(this.focus === "main" ? this.mainPanel(t) : this.sidePanel(t, this.panel, { wide: true }).size_full());
    }

    if (this.mode === "half") {
      const railW = this.railW ?? Math.round(Math.max(230, Math.min(300, w * 0.22)));
      const midW = this.midW ?? Math.round(Math.max(360, Math.min(620, w * 0.38)));
      const rail = PANELS.filter((p) => p !== this.panel);

      return h_flex().size_full().px(6).pb(4)
        .child(div().w(railW).flex_none().h_full().child(this.sideColumn(t, rail, true)))
        .child(this.splitter(t, "split-rail", "x", "rail", railW, (v) => { this.railW = v; }, { min: 180, max: w * 0.4 }))
        .child(div().w(midW).flex_none().h_full().pt(7).child(this.sidePanel(t, this.panel, { wide: true }).size_full()))
        .child(this.splitter(t, "split-mid", "x", "mid", midW, (v) => { this.midW = v; }, { min: 280, max: w * 0.7 }))
        .child(this.mainColumn(t));
    }

    const sideW = this.sideW ?? Math.round(Math.max(280, Math.min(520, w * 0.34)));

    return h_flex().size_full().px(6).pb(4)
      .child(div().w(sideW).flex_none().h_full().child(this.sideColumn(t, PANELS)))
      .child(this.splitter(t, "split-side", "x", "side", sideW, (v) => { this.sideW = v; }, { min: 200, max: w * 0.7 }))
      .child(this.mainColumn(t));
  }

  header(t: Theme) {
    const s = this.data.status;
    const where = this.git ? this.git.root.replace(/^\/(Users|home)\/[^/]+/, "~") : this.folder ?? "";
    const state = this.data.state;

    const head = h_flex().id("git-head").relative().h(34).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
      .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)));

    const flying = this.busyText ? head.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
      .loop("left", { from: 140, to: Math.max(300, this.size.width - 260), period: 9000 })
      .loop("opacity", { from: 0.3, to: 1, period: 800 })) : head;

    const named = flying
      .child(h_flex().relative().flex_none().gap(8).items_center()
        .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
        .child(div().text_color(t.foreground).child("GIT")))
      .child(div().relative().flex_none().max_w(360).truncate().text_color(t.muted).child(this.on ? `${this.on}:${where}` : where));

    const branch = s
      ? named
        .child(div().relative().flex_none().text_color(t.ansi6).child(s.head ?? `(detached ${short(s.oid ?? "")})`))
        .when(s.ahead > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi4).child(`↑${s.ahead}`)))
        .when(s.behind > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi5).child(`↓${s.behind}`)))
      : named;

    const stated = state ? branch.child(h_flex().relative().flex_none().px(5).h(16).items_center().bg(t.ansi3).text_color(t.background).child(`${state.toUpperCase()} · m`)) : branch;
    const backed = this.backTo ? stated.child(chip(t, "git-back", "‹ GitHub", false, () => this.goBack(), t.dim)) : stated;
    const spaced = backed.child(div().flex_1());
    const busy = this.busyText ? spaced.child(div().relative().text_color(t.working).child(this.busyText)) : spaced;

    const keyed = busy
      .child(keysHint(t, "git-keys", this.popups.top?.kind === "keys", () => (this.popups.top?.kind === "keys" ? this.popups.close() : this.openKeys())).mx(4))
      .child(chip(t, "git-refresh", "↻", false, () => this.reload(true)));

    return this.overlay ? keyed.child(chip(t, "git-close", "✕", false, () => this.quit())) : keyed;
  }

  bar(t: Theme) {
    const ctx = this.ctx();

    // The context's keys on the left; the global ones (push, pull) at the
    // right end, and the help key (?) last of all.
    const keys: readonly (readonly [key: string, what: string, global: boolean])[] = this.show && ctx === "main"
      ? [["q", "close", false], ["j/k", "scroll", false], ["J/K", "page", false], ["n/N", "file", false], ["{ }", "context", false], ["?", "keys", true]]
      : ctx === "filter" ? [["enter", "keep", false], ["esc", "clear", false]]
      : (ctx === "keys" ? bindings("global").filter((b) => b.flags.has("bar")) : barKeys(ctx)).map((b) => [keyLabel(b.key), shortLabel(b.label), b.context === "global"] as const);

    const help = keys.find(([k]) => k === "?") ?? null;
    const list = keys.flatMap((x): Hint[] => (x !== help && !x[2] ? [[x[0], x[1]]] : []));
    const ends = keys.flatMap((x): Hint[] => (x !== help && x[2] ? [[x[0], x[1]]] : []));
    const note = this.noteText;

    const right = note ? div().text_color(note.tone === "failed" ? t.blocked : t.done).truncate().max_w(420).child(note.text)
      : this.copied.length ? div().text_color(t.ansi5).child(`${this.copied.length} copied · V paste`)
      : div().text_color(t.dim).child(this.show ? "q closes this pane" : "1-5 panels · + widen");

    return hints(t, [["", "", CONTEXT_NAMES[ctx].toUpperCase()], ...list], right, (key, cx) => {
      if (this.show && ctx === "main" && key === "?") return this.openKeys();

      if (ctx === "keys" || ctx === "filter") return;

      const b = lookup(ctx, key === "esc" ? "escape" : key === "pgup" ? "pageup" : key === "pgdn" ? "pagedown" : key);

      if (b) act(this, b.action, cx);
    }, { ends, help: help ? [help[0], help[1]] : null });
  }

  override render() {
    const t = theme();

    const body = this.state === "loading" ? empty(t, "Reading the repo…", this.folder ?? "", { moon: 3 })
      : this.state === "norepo" ? empty(t, "Not a git repository", `${this.folder ?? "This space has no folder"}: the git window shows the repo of the shown space's folder.`, { moon: 0 })
      : this.body(t);

    const endResize = (cx: Context) => {
      if (this.resizing) {
        this.resizing = null;
        this.saveState();
        cx.notify();
      }
    };

    const root = v_flex().id("git").relative().size_full().bg(t.background);
    const framed = this.overlay ? root.border(1).border_color(t.ansi8) : root;
    const handle = this.handle;
    const r = this.resizing;

    const sized = (handle ? framed.track_focus(handle) : framed)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = size;
          cx.notify();
        }
      });

    const cursor = r ? (r.axis === "x" ? sized.cursor_col_resize() : sized.cursor_row_resize()) : sized;

    const view = cursor
      .on_mouse_move((e, cx) => {
        this.mouse = { x: unzoom(e.local_position.x), y: unzoom(e.local_position.y) };

        const now = this.resizing;

        if (!now) return;

        const moved = unzoom((now.axis === "x" ? e.position.x : e.position.y) - now.at) * now.sign;

        now.set(Math.round(Math.min(now.max, Math.max(now.min, now.from + moved))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => { if (!h) endResize(cx); })
      .child(this.header(t))
      .child(div().id("git-body").relative().flex_1().min_h(0).pt(4)
        .on_mouse_down("left", (_e, cx) => { this.handle?.focus(); cx.stop_propagation(); })
        .child(body))
      .child(this.bar(t));

    const popup = this.popups.open ? this.popups.render(t, this.size) : null;

    return popup ? view.child(popup) : view;
  }
}

/** Contexts whose right-click menu offers ctrl-p (the main view shows a diff for them). */
const PANE_CONTEXTS: ReadonlySet<KeyContext> = new Set<KeyContext>(["files", "review", "commits", "subCommits", "reflog", "commitFiles", "stash", "staging", "main"]);

/** A ctrl-p tab's name. */
function paneName(s: Show) {
  switch (s.kind) {
    case "file": return s.path.split("/").pop() ?? s.path;
    case "review": return s.pr ? `#${s.pr}` : "review";
    case "range": return "diff";
    case "log": return s.ref;
    case "commit": return s.hash.slice(0, 7);
    case "stash": return s.ref.slice(0, 7);
  }
}

/** A review file's status letter and color. */
function reviewLetter(t: Theme, status: DiffFile["status"]): readonly [string, Color] {
  switch (status) {
    case "added": return ["A", t.ansi2];
    case "modified": return ["M", t.ansi3];
    case "deleted": return ["D", t.ansi1];
    case "renamed": return ["R", t.ansi4];
    case "untracked": return ["U", t.ansi5];
  }
}

const T7 = (s: string, c: Color) => div().w(56).flex_none().text_color(c).child(s);

const short = (r: string) => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);

const text = (s: string, color: Ink = "foreground"): MainRow => ({ kind: "text", parts: [[s, color]] });

/** A bar label: the first words before "/" or "…". */
const shortLabel = (s: string) => (s.replace(/ \(.*\)$/, "").replace(/…$/, "").split(" / ")[0]?.split(",")[0]?.split(/ (?:into|the|with|from|to|as|on|of|this|last|all) /)[0] ?? "").toLowerCase();
