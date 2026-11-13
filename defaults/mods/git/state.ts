// The git window's state, its types and guards: the panels, their tabs and
// screen modes, what the window keeps per folder (shared git.state), what
// it's opened with (props), what it reads from the repo and what its main
// view, drill-ins and splitters hold. main.ts's GitView holds these fields.

import type { Element } from "gpui-kit";
import { spaces, panes, focused } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, sharedKey, sharedMapKey } from "./guard.ts";
import type { CommitFile, Env } from "./git.ts";
import type { Graph } from "./graph.ts";
import type { DiffFile, DiffRow } from "./patch.ts";
import type { Branch, Commit, ReflogEntry, Remote, RemoteBranch, RepoState, StashEntry, Status, StatusFile, Tag } from "./parse.ts";
import type { KeyContext } from "./keys.ts";
import type { Checkout } from "./worktrees.ts";
import type { MainRow } from "./draw.ts";
import type { Item } from "./items.ts";

export const WINDOW = "git.window"; // { id, beat }: the open window, for the toggle

/** The open window, for the toggle (nocturne's git.ts reads it). */
export const WINDOW_KEY = sharedKey(WINDOW, nullable(object({ id: isString }, { beat: isNumber, folder: nullable(isString) })));

/** The GitHub window's note (github's main.ts): this window holds its place when opened from it. */
export const GITHUB_WINDOW = sharedKey("github.window", nullable(object({ id: isString }, { beat: isNumber })));

/** The side panels, top to bottom. */
export type Panel = "status" | "files" | "branches" | "commits" | "stash";

export const PANELS: readonly Panel[] = ["status", "files", "branches", "commits", "stash"];

export const isPanel = literal("status", "files", "branches", "commits", "stash");

/** Each tabbed panel's tabs. */
export type FilesTab = "files" | "review" | "worktrees";

export type BranchesTab = "branches" | "remotes" | "tags";

export type CommitsTab = "commits" | "reflog";

export type Tab = FilesTab | BranchesTab | CommitsTab;

/** The tab each tabbed panel shows. */
export interface TabOf {
  files: FilesTab;
  branches: BranchesTab;
  commits: CommitsTab;
}

export const TABS = {
  files: [["files", "Files"], ["review", "Review"], ["worktrees", "Worktrees"]],
  branches: [["branches", "Local branches"], ["remotes", "Remotes"], ["tags", "Tags"]],
  commits: [["commits", "Commits"], ["reflog", "Reflog"]],
} as const satisfies { readonly [P in keyof TabOf]: readonly (readonly [TabOf[P], string])[] };

export const isTabbed = (p: Panel): p is keyof TabOf => p === "files" || p === "branches" || p === "commits";

/** A side panel's screen mode. */
export type Mode = "normal" | "half" | "full";

export const MODES: readonly Mode[] = ["normal", "half", "full"];

export const isMode = literal("normal", "half", "full");

// Where the window was, per folder: its panel, tabs, mode and sizes.
export const isKept = object({}, {
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

export type Kept = Guarded<typeof isKept>;

export const STATE = sharedMapKey("git.state", isKept);

export const ROW = 18, WIDE_ROW = 32, LOG_ROW = 16, NARROW = 640;

// The graph's lane width: the Commits list, its wide rows, the branch log.
export const LANE = 10, WIDE_LANE = 13;

/** Every context the window's keyboard can be in: the key table's, the ? overview, the filter. */
export type ViewContext = KeyContext | "keys" | "filter";

export const CONTEXT_NAMES = {
  status: "status", files: "files", review: "review", worktrees: "worktrees", branches: "branches", remotes: "remotes", remoteBranches: "remote branches",
  tags: "tags", commits: "commits", reflog: "reflog", subCommits: "commits", commitFiles: "commit files", stash: "stash", staging: "staging", main: "main view",
  menu: "menu", confirm: "confirm", prompt: "prompt", commit: "commit", filter: "filter", keys: "keys", global: "global", list: "list",
} as const satisfies { readonly [C in ViewContext]: string };

/** The shown space's folder and machine. */
export function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? panes().find((p) => p.tab === tab && p.cwd);

  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

// ---- what the window is opened with

/** A pane opened from the window (ctrl-p): what it shows. */
export const isShow = oneOf(
  object({ kind: literal("file"), path: isString }),
  object({ kind: literal("commit"), hash: isString }, { path: isString }),
  object({ kind: literal("stash"), ref: isString }, { path: isString }),
  object({ kind: literal("range"), a: isString, b: isString }),
  object({ kind: literal("review"), scope: literal("work", "branch", "pr") }, { pr: isNumber, repo: nullable(isString), path: isString }),
  object({ kind: literal("log"), ref: isString }),
);

export type Show = Guarded<typeof isShow>;

/** The GitHub window to put back (github's main.ts: { mod, props }). */
export const isBack = object({ mod: isString }, { props: object({}) });

export type Back = Guarded<typeof isBack>;

/** Opened for a worktree (the space menu's New / Remove worktree, the sidebar's w, the palette). */
export const isIntent = object({}, { action: literal("new", "open", "remove"), space: isString, branch: isString, tab: isString, argv: arrayOf(isString) });

export type Intent = Guarded<typeof isIntent>;

/** The window's props, the plain fields (show, back and worktrees are read on their own:
 *  one of them in another shape leaves the rest). */
export const isGitProps = object({}, {
  overlay: isString,
  slot: isString,
  folder: nullable(isString),
  on: nullable(isString),
  paneId: isString,
  review: isBoolean,
  pr: isNumber,
  repo: nullable(isString),
  scope: literal("work", "branch", "pr"),
});

/** The props' fields read on their own. */
export const isGroups = object({}, { show: isShow, back: isBack, worktrees: isIntent });

export type GitProps = Guarded<typeof isGitProps>;

export type Groups = Guarded<typeof isGroups>;

export const NO_PROPS: GitProps = {};

export const NO_GROUPS: Groups = {};

// ---- the window's state

/** Everything read from the repo. */
export interface Data {
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
export type Sub =
  | { readonly kind: "subCommits"; readonly ref: string; readonly title: string; items: readonly Commit[]; graph: Graph | null; limit?: number }
  | { readonly kind: "remoteBranches"; readonly remote: string; readonly title: string; items: readonly RemoteBranch[] }
  | { readonly kind: "commitFiles"; readonly hash: string; readonly title: string; readonly stash: boolean; items: readonly CommitFile[] };

/** Each panel's drill-ins, the newest last. */
export interface Subs {
  status: Sub[];
  files: Sub[];
  branches: Sub[];
  commits: Sub[];
  stash: Sub[];
}

/** The main view's lists' measured heights. */
export interface MainHeights {
  main?: number;
  staging?: number;
  other?: number;
  second?: number;
}

/** Where the main view's second lists are scrolled to. */
export interface OtherTops {
  other?: number;
  second?: number;
}

/** What enterSub opens (its items read after). */
export type NewSub =
  | { readonly kind: "subCommits"; readonly ref: string; readonly title: string }
  | { readonly kind: "remoteBranches"; readonly remote: string; readonly title: string }
  | { readonly kind: "commitFiles"; readonly hash: string; readonly title: string; readonly stash: boolean };

/** Staging lines of one file: its side's diff, the cursor, a range's anchor, hunk mode, the other side's rows. */
export interface Staging {
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
export interface MainContent {
  readonly title: string;
  readonly rows: readonly MainRow[];
  readonly path?: string;
  readonly rowH?: number;
  readonly more?: string | null;
  readonly second?: { readonly title: string; readonly rows: readonly MainRow[] } | null;
}

/** A splitter being dragged: what it sets, from where. */
export interface Resizing {
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
export interface ResizeOptions {
  readonly min?: number;
  readonly max?: number;
  readonly sign?: number;
  readonly axis?: "x" | "y";
}

/** A copied commit (C), pasted with V in commit order. */
export interface Copied {
  readonly hash: string;
  readonly subject: string;
  readonly date: number;
}

/** A note on the options bar. */
export interface Note {
  readonly text: string;
  readonly tone: "done" | "failed";
  readonly at: number;
}

/** A history read further when its end comes into view. */
export type More = "commits" | "subCommits" | "main";

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
export interface SpaceOptions {
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
export interface SideOptions {
  readonly wide?: boolean;
  readonly compact?: boolean;
}

/** A main-view list's cursor to keep in sight, which scroll it keeps, its row height. */
export interface MainListOptions {
  readonly follow?: number | null;
  readonly key?: "main" | "staging" | "other" | "second";
  readonly rowH?: number;
}

/** txt's width, or the rest of the row. */
export interface TxtOptions {
  readonly w?: number | null;
  readonly grow?: boolean;
}

/** A list's row drawn: the row, its index, whether it's selected. */
export type DrawRow = (r: Item, i: number, sel: boolean) => Element;
