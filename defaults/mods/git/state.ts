// The git window's state, its types and guards: the panels, their tabs and
// screen modes, what the window keeps per folder (shared git.state), what
// it's opened with (props), what it reads from the repo and what its main
// view, drill-ins and splitters hold. main.ts's GitView holds these fields.

import type { Element } from "gpui-kit";
import { Option, Schema } from "effect";
import type { Props } from "gpui-shell";
import { spaces, panes, focused, props } from "herdr";
import { hereOf, mapOf, sharedKey } from "@fireflies/kit";
import type { CommitFile, Env } from "./git.ts";
import { ScopeSchema } from "./git.ts";
import type { Graph } from "./graph.ts";
import type { DiffFile, DiffRow } from "./patch.ts";
import type { Branch, Commit, ReflogEntry, Remote, RemoteBranch, RepoState, StashEntry, Status, StatusFile, Tag } from "./parse.ts";
import type { KeyContext } from "./keys.ts";
import type { Checkout } from "./worktrees.ts";
import type { MainRow } from "./draw.ts";
import type { Item } from "./items.ts";

export const WINDOW = "git.window"; // { id, beat }: the open window, for the toggle

/** The open window, for the toggle (nocturne's git.ts reads it). */
export const WindowNoteSchema = Schema.Struct({ id: Schema.String, beat: Schema.optionalKey(Schema.Finite), folder: Schema.optionalKey(Schema.NullOr(Schema.String)) });

export const WINDOW_KEY = sharedKey(WINDOW, Schema.NullOr(WindowNoteSchema));

/** The GitHub window's note (github's main.ts): this window holds its place when opened from it. */
export const GITHUB_WINDOW = sharedKey("github.window", Schema.NullOr(Schema.Struct({ id: Schema.String, beat: Schema.optionalKey(Schema.Finite) })));

/** The side panels, top to bottom. */
export const PanelSchema = Schema.Literals(["status", "files", "branches", "commits", "stash"]);

export type Panel = typeof PanelSchema.Type;

export const PANELS: readonly Panel[] = PanelSchema.literals;

/** Each tabbed panel's tabs. */
export const FilesTabSchema = Schema.Literals(["files", "review", "worktrees"]);

export const BranchesTabSchema = Schema.Literals(["branches", "remotes", "tags"]);

export const CommitsTabSchema = Schema.Literals(["commits", "reflog"]);

export type FilesTab = typeof FilesTabSchema.Type;

export type BranchesTab = typeof BranchesTabSchema.Type;

export type CommitsTab = typeof CommitsTabSchema.Type;

export type Tab = FilesTab | BranchesTab | CommitsTab;

/** The tab each tabbed panel shows. */
export interface TabOf {
  files: FilesTab;
  branches: BranchesTab;
  commits: CommitsTab;
}

/** A kept TabOf: each panel's tab, where one was kept. */
export const TabOfSchema = Schema.Struct({ files: Schema.optionalKey(FilesTabSchema), branches: Schema.optionalKey(BranchesTabSchema), commits: Schema.optionalKey(CommitsTabSchema) });

export const TABS = {
  files: [["files", "Files"], ["review", "Review"], ["worktrees", "Worktrees"]],
  branches: [["branches", "Local branches"], ["remotes", "Remotes"], ["tags", "Tags"]],
  commits: [["commits", "Commits"], ["reflog", "Reflog"]],
} as const satisfies { readonly [P in keyof TabOf]: readonly (readonly [TabOf[P], string])[] };

export const isTabbed = (p: Panel): p is keyof TabOf => p === "files" || p === "branches" || p === "commits";

/** A side panel's screen mode. */
export const ModeSchema = Schema.Literals(["normal", "half", "full"]);

export type Mode = typeof ModeSchema.Type;

export const MODES: readonly Mode[] = ModeSchema.literals;

// Where the window was, per folder: its panel, tabs, mode and sizes.
export const KeptSchema = Schema.Struct({
  panel: Schema.optionalKey(PanelSchema),
  tabOf: Schema.optionalKey(TabOfSchema),
  mode: Schema.optionalKey(ModeSchema),
  tree: Schema.optionalKey(Schema.Boolean),
  showLog: Schema.optionalKey(Schema.Boolean),
  sideW: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  railW: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  midW: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  logH: Schema.optionalKey(Schema.Finite),
});

export type Kept = typeof KeptSchema.Type;

export const STATE = sharedKey("git.state", mapOf(KeptSchema));

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

/** A folder and the machine it's on (null: this computer). */
export interface Here {
  readonly folder: string | null;
  readonly on: string | null;
}

/** The folder for a window opened without one: the kit's one rule (hereOf). */
export function here(): Here {
  const h = hereOf({ spaces: spaces(), panes: panes(), focused: focused() });

  return { folder: Option.getOrNull(h.folder), on: h.on };
}

// ---- what the window is opened with

/** A pane opened from the window (ctrl-p): what it shows. */
export const ShowSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("commit"), hash: Schema.String, path: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("stash"), ref: Schema.String, path: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("range"), a: Schema.String, b: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("review"), scope: ScopeSchema, pr: Schema.optionalKey(Schema.Finite), repo: Schema.optionalKey(Schema.NullOr(Schema.String)), path: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("log"), ref: Schema.String }),
]);

export type Show = typeof ShowSchema.Type;

/** The GitHub window to put back (github's main.ts: { mod, props }), its props kept whole. */
export const BackSchema = Schema.Struct({ mod: Schema.String, props: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)) });

export type Back = typeof BackSchema.Type;

/** Opened for a worktree (the space menu's New / Remove worktree, the sidebar's w, the palette). */
export const IntentSchema = Schema.Struct({
  action: Schema.optionalKey(Schema.Literals(["new", "open", "remove"])),
  space: Schema.optionalKey(Schema.String),
  branch: Schema.optionalKey(Schema.String),
  tab: Schema.optionalKey(Schema.String),
  argv: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type Intent = typeof IntentSchema.Type;

/** The window's props, the plain fields (show, back and worktrees are read on their own:
 *  one of them in another shape leaves the rest). */
export const GitPropsSchema = Schema.Struct({
  overlay: Schema.optionalKey(Schema.String),
  slot: Schema.optionalKey(Schema.String),
  folder: Schema.optionalKey(Schema.NullOr(Schema.String)),
  on: Schema.optionalKey(Schema.NullOr(Schema.String)),
  paneId: Schema.optionalKey(Schema.String),
  review: Schema.optionalKey(Schema.Boolean),
  pr: Schema.optionalKey(Schema.Finite),
  repo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  scope: Schema.optionalKey(ScopeSchema),
});

export type GitProps = typeof GitPropsSchema.Type;

/** Whether a value (a pane's props) is the window's props. */
export const isGitProps = Schema.is(GitPropsSchema);

/** The props' fields read on their own: each one in another shape is left out alone. */
export interface Groups {
  show?: Show;
  back?: Back;
  worktrees?: Intent;
}

// Each group read from the props on its own: one in another shape is left out alone.
const decodeShow = Schema.decodeUnknownOption(Schema.Struct({ show: ShowSchema }));
const decodeBack = Schema.decodeUnknownOption(Schema.Struct({ back: BackSchema }));
const decodeIntent = Schema.decodeUnknownOption(Schema.Struct({ worktrees: IntentSchema }));

/** The window's props as read: the plain fields and the groups. */
export interface Opened {
  readonly plain: GitProps;
  readonly groups: Groups;
}

/** What the window is opened with: its plain fields (none of them when
 *  they aren't in the window's shape), and show, back and worktrees, each
 *  read on its own. The app's props win over `init`'s (a restart). */
export function openedWith(p: Props | undefined): Opened {
  const given = props() ?? p ?? null;
  const groups: Groups = {};

  Option.map(decodeShow(given), ({ show }) => { groups.show = show; });
  Option.map(decodeBack(given), ({ back }) => { groups.back = back; });
  Option.map(decodeIntent(given), ({ worktrees }) => { groups.worktrees = worktrees; });

  return { plain: Option.getOrElse(Schema.decodeUnknownOption(GitPropsSchema)(given), () => NO_PROPS), groups };
}

export const NO_PROPS: GitProps = {};

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
