// The Worktrees view's git and spaces work (the Files panel's third tab):
// what the worktree dialog and Nocturne's worktrees pane did, here. Every
// checkout of the repo, the main one first, then by their branch's last
// commit; which spaces show each one and which agents work in it; new ones
// go to <home>/.herdr/worktrees/<repo>/<branch> on the repo's machine and
// open as a space; removing closes the spaces in it first, says what would
// be lost (uncommitted changes, submodules, commits in them pushed nowhere)
// and can take the branch along.

import { Array as Arr, Effect, Option, Order, Schema, String as Str } from "effect";
import { home, spaces, panes, agents } from "herdr";
import type { AgentInfo, ExecResult, PaneInfo, SpaceInfo } from "herdr";
import { Exec, ExitError } from "@fireflies/kit";
import type { ExecError } from "@fireflies/kit";
import type { Git, GitError } from "./git.ts";
import { nonBlank } from "./git.ts";
import type { Worktree } from "./parse.ts";
import { WorktreeFields, baseName, parseWorktrees } from "./parse.ts";

/** Where new checkouts go: <ROOT>/<repo>/<branch, slashes as dashes>. */
export const ROOT = (userHome: string): string => `${userHome}/.herdr/worktrees`;

export const slug = (branch: string): string => Str.replace(/^-+|-+$/g, "")(Str.replace(/[^A-Za-z0-9._-]+/g, "-")(branch));

/** `p` is `dir` or under it. */
export const inside = (p: string | null | undefined, dir: string | null | undefined): boolean => {
  if (p === null || p === undefined || dir === null || dir === undefined || Str.isEmpty(p) || Str.isEmpty(dir)) return false;

  return p === dir || Str.startsWith(Str.replace(/\/+$/, "")(dir) + "/")(p);
};

export const tilde = (p: string, userHome: string | null): string => (userHome !== null && Str.isNonEmpty(userHome) && Str.isNonEmpty(p) && (p === userHome || Str.startsWith(userHome + "/")(p)) ? `~${Str.slice(userHome.length)(p)}` : p);

export const label = (w: Pick<Worktree, "branch" | "path">): string => w.branch ?? baseName(w.path);

/** A git command's outcome, trimmed. */
interface Outcome {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

const trimmed = (r: ExecResult): Outcome => ({ ok: r.code === 0, out: Str.trim(r.stdout), err: Str.trim(Str.isEmpty(r.stderr) ? r.stdout : r.stderr) });

/** git in `cwd` (another checkout than the window's), its outcome whatever the exit. */
function git(cwd: string, args: readonly string[], on: string | null, timeout?: number): Effect.Effect<Outcome, ExecError, Exec> {
  return Effect.map(Exec.use((x) => x.run("git", args, timeout === undefined ? { cwd, on } : { cwd, on, timeout })), trimmed);
}

/** The home folder `script` printed, with / separators; none when it ran but printed nothing. */
const printedHome = (r: ExecResult): Option.Option<string> => (r.code === 0 && Str.isNonEmpty(Str.trim(r.stdout)) ? Option.some(Str.replace(/\\/g, "/")(Str.trim(r.stdout))) : Option.none());

/** The home folder on `on` (this computer's when null), with / separators:
 *  a POSIX shell's $HOME, else PowerShell's. An ExitError when neither says. */
export function userHomeOn(on: string | null): Effect.Effect<string, GitError, Exec> {
  if (on === null) return Effect.sync(() => home());

  return Effect.gen(function* () {
    const exec = yield* Exec;
    // Not a POSIX shell (a Windows machine): its refusal or its failure to run sends us to PowerShell.
    const sh = yield* Effect.option(exec.run("sh", ["-c", 'printf %s "$HOME"'], { on }));
    const posix = Option.flatMap(sh, printedHome);

    if (Option.isSome(posix)) return posix.value;

    const ps = yield* exec.run("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on });

    return yield* Effect.fromOption(printedHome(ps)).pipe(
      Effect.mapError(() => ExitError.make({ command: "powershell.exe", code: ps.code, stderr: ps.stderr, message: "Could not find the remote home folder." })),
    );
  });
}

/** A space's folder: the one it's attached to (home holds no repo), else
 *  where its first terminal is now, else where it was made. */
export function spaceFolder(s: SpaceInfo | null | undefined, all: readonly PaneInfo[] = panes()): string | null {
  if (s === null || s === undefined) return null;

  const folder = s.folder ?? "";

  if (s.attached && Str.isNonEmpty(folder) && !(s.machine === null && Str.replace(/\/+$/, "")(folder) === home())) return folder;

  const tabs = new Set(Arr.map(s.tabs, (c) => c.id));
  const cwd = Option.flatMap(Arr.findFirst(all, (p) => tabs.has(p.tab) && Str.isNonEmpty(p.cwd ?? "")), (p) => Option.fromNullishOr(p.cwd));

  return Option.getOrElse(cwd, () => (Str.isEmpty(folder) ? null : folder));
}

/** The longest path first. */
const deepest = <W extends { readonly path: string }>(): Order.Order<W> => Order.flip(Order.mapInput(Order.Number, (w: W) => w.path.length));

/** The deepest checkout holding a folder (worktrees can live inside the main one). */
export function owner<W extends { readonly path: string }>(list: readonly W[], folder: string | null | undefined): W | null {
  if (folder === null || folder === undefined || Str.isEmpty(folder)) return null;

  const f = Str.replace(/\\/g, "/")(folder);

  return Option.getOrNull(Arr.head(Arr.sort(Arr.filter(list, (w) => inside(f, w.path)), deepest<W>())));
}

/** A checkout in the Worktrees view: the main one, and when its branch last had a commit. */
export const CheckoutSchema = Schema.Struct({ ...WorktreeFields, main: Schema.Boolean, at: Schema.Finite });

export type Checkout = typeof CheckoutSchema.Type;

/** The main checkout first, then the most recently committed branch. */
const MAIN_FIRST: Order.Order<Checkout> = Order.combine(Order.flip(Order.mapInput(Order.Boolean, (c: Checkout) => c.main)), Order.flip(Order.mapInput(Order.Number, (c: Checkout) => c.at)));

/** Every checkout of the repo: `git worktree list`, bare entries left out,
 *  the main one first, then the most recently committed branch. Each:
 *  { path, branch, head, detached, locked, prunable, main, at }. */
export function listWorktrees(g: Git): Effect.Effect<Checkout[], GitError, Exec> {
  return Effect.gen(function* () {
    const listed = yield* g.out(["worktree", "list", "--porcelain"]);
    const list = Arr.filter(parseWorktrees(listed), (w) => !w.bare);
    const refs = yield* g.out(["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"]);

    const when = new Map(Arr.map(nonBlank(refs), (l) => {
      const [b, at] = Str.split(l, "\t");
      const n = Number(at ?? "");

      return [b, Number.isFinite(n) ? n : 0] as const;
    }));

    return Arr.sort(Arr.map(list, (w, i): Checkout => ({ ...w, main: i === 0, at: w.branch === null ? 0 : (when.get(w.branch) ?? 0) })), MAIN_FIRST);
  });
}

/** Who is in a checkout: the spaces showing it, the agents working in it. */
export interface Occupants {
  readonly spaces: SpaceInfo[];
  readonly agents: AgentInfo[];
}

/** What occupancy reads, when not herdr's own lists (tests). */
export interface Lists {
  readonly spaceList?: readonly SpaceInfo[];
  readonly paneList?: readonly PaneInfo[];
  readonly agentList?: readonly AgentInfo[];
}

/** Per checkout: the spaces showing it and the agents working in it. */
export function occupancy(list: readonly { readonly path: string }[], on: string | null, lists: Lists = {}): Map<string, Occupants> {
  const { spaceList = spaces(), paneList = panes(), agentList = agents() } = lists;
  const occ = new Map<string, Occupants>(Arr.map(list, (w) => [w.path, { spaces: [], agents: [] }] as const));

  const add = (folder: string | null | undefined, put: (o: Occupants) => void) => {
    const w = owner(list, folder);

    if (w !== null) Option.map(Option.fromUndefinedOr(occ.get(w.path)), put);
  };

  for (const s of spaceList) if (s.machine === on) add(spaceFolder(s, paneList), (o) => o.spaces.push(s));

  for (const a of agentList) {
    const p = Arr.findFirst(paneList, (x) => x.pane === a.pane);
    const s = Option.flatMap(p, (pane) => Arr.findFirst(spaceList, (x) => Arr.some(x.tabs, (c) => c.id === pane.tab)));

    if (Option.isSome(s) && s.value.machine !== on) continue;

    add(Option.getOrNull(Option.flatMap(p, (pane) => Option.fromNullishOr(pane.cwd))), (o) => o.agents.push(a));
  }

  return occ;
}

/** What removing a checkout would take with it. */
export interface Loss {
  /** Files with uncommitted changes. */
  readonly dirty: number;
  /** Submodules git counts. */
  readonly subs: number;
  /** Submodules with commits on no remote (and not the pinned one). */
  readonly unpushed: readonly string[];
}

/** A worktree's own git dir holds submodule repositories (<gitdir>/modules).
 *  `test` that can't run counts as "none": git worktree remove then refuses
 *  if there are some, and says so, nothing is lost. */
function keepsModules(gitDir: string, on: string | null): Effect.Effect<boolean, never, Exec> {
  return Exec.use((x) => x.run("test", ["-d", `${gitDir}/modules`], { on })).pipe(
    Effect.map((r) => r.code === 0),
    Effect.orElseSucceed(() => false),
  );
}

/** The submodules of a worktree whose repos hold commits that exist nowhere
 *  else: on no remote, and not the commit the parent pins (fetched by hash,
 *  often on no branch). */
function unpushedModules(w: { readonly path: string }, gitDir: string, on: string | null): Effect.Effect<string[], ExecError, Exec> {
  return Effect.gen(function* () {
    const keys = yield* git(w.path, ["config", "--file", ".gitmodules", "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
    const out: string[] = [];

    for (const record of keys.ok ? Arr.filter(Str.split(keys.out, "\0"), Str.isNonEmpty) : []) {
      const at = Option.getOrElse(Str.indexOf("\n")(record), () => record.length);
      const name = Str.slice("submodule.".length, at - ".path".length)(record);
      const dir = `${gitDir}/modules/${name}`;

      if (!(yield* git(w.path, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue;

      const pinned = yield* git(w.path, ["rev-parse", `HEAD:${Str.slice(at + 1)(record)}`], on);
      const local = yield* git(w.path, ["--git-dir", dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(pinned.ok && Str.isNonEmpty(pinned.out) ? [pinned.out] : [])], on);

      if (local.ok && Str.isNonEmpty(local.out)) out.push(name);
    }

    return out;
  });
}

/** What removing a checkout would take with it: { dirty (files), subs
 *  (submodules git counts), unpushed (submodules with commits on no remote
 *  and not the pinned one) }. git refuses a worktree whose own git dir holds
 *  submodule repositories (<gitdir>/modules) even when `submodule status`
 *  calls them uninitialized, so those count too. */
export function inspect(w: { readonly path: string }, on: string | null): Effect.Effect<Loss, ExecError, Exec> {
  return Effect.gen(function* () {
    const [st, sub, gd] = yield* Effect.all([
      git(w.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on),
      git(w.path, ["submodule", "status"], on),
      git(w.path, ["rev-parse", "--absolute-git-dir"], on),
    ], { concurrency: "unbounded" });

    const lines = sub.ok ? nonBlank(sub.out) : [];
    const checkedOut = Arr.filter(lines, (l) => !Str.startsWith("-")(l)).length;
    const kept = gd.ok && /\/worktrees\/[^/]+$/.test(gd.out) ? yield* keepsModules(gd.out, on) : false;
    const unpushed = gd.ok ? yield* unpushedModules(w, gd.out, on) : [];

    return {
      dirty: st.ok ? nonBlank(st.out).length : 0,
      subs: kept ? Math.max(checkedOut, lines.length, 1) : checkedOut,
      unpushed,
    };
  });
}

/** The main checkout's folder (the one holding .git). */
export function mainOf(g: Git): Effect.Effect<string, GitError, Exec> {
  return Effect.map(g.out(["rev-parse", "--path-format=absolute", "--git-common-dir"]), (out) => {
    const common = Str.trim(out);

    return Str.isEmpty(common) ? g.root : Str.replace(/\/\.git\/?$/, "")(common);
  });
}

/** Where a new checkout of `branch` goes. */
export function pathFor(g: Git, branch: string): Effect.Effect<string, GitError, Exec> {
  return Effect.gen(function* () {
    const main = yield* mainOf(g);
    const userHome = yield* userHomeOn(g.on);

    return `${ROOT(userHome)}/${baseName(main)}/${slug(branch)}`;
  });
}

/** Where `create` checks a branch out from (HEAD by default). */
export interface CreateOptions {
  readonly base?: string | null;
}

/** A new checkout (`created`: its branch is new too), or why there's none. */
export type Created = { readonly path: string; readonly created: boolean } | { readonly error: string };

/** Checks out `branch` (an existing one; else a new one from `base`, HEAD
 *  by default) in a new worktree; { path } or { error }. */
export function create(g: Git, branch: string | null, options: CreateOptions = {}): Effect.Effect<Created, GitError, Exec> {
  const { base = null } = options;
  const name = Str.trim(branch ?? "");

  if (Str.isEmpty(name)) return Effect.succeed({ error: "Type a branch name." });

  return Effect.gen(function* () {
    const path = yield* pathFor(g, name);
    const exists = (yield* g.read(["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;
    const args = exists ? ["worktree", "add", path, name] : ["worktree", "add", "-b", name, path, base ?? "HEAD"];
    const r = yield* g.run("New worktree", args, { timeout: 600000 });

    return r.ok ? { path, created: !exists } : { error: Str.isEmpty(r.err) ? "git worktree add failed." : r.err };
  });
}

/** What a removal takes: what inspect found, the spaces to close, and what was picked. */
export interface Removal extends Partial<Loss> {
  readonly spaces?: readonly SpaceInfo[];
  /** Take its submodules out first. */
  readonly clearSubs?: boolean;
  /** Delete its branch too. */
  readonly branch?: boolean;
}

/** How removeOne closes a space, and says where it is. */
export interface RemoveHooks {
  readonly closeSpace?: (s: SpaceInfo) => void;
  readonly step?: (text: string) => void;
}

/** Takes a worktree's submodules out (deinit, and the repositories under its own git dir): "" or what failed. */
function clearSubmodules(g: Git, w: Pick<Worktree, "path">): Effect.Effect<string, ExecError, Exec> {
  return Effect.gen(function* () {
    const d = yield* g.run("Remove submodules", ["-C", w.path, "submodule", "deinit", "--all", "--force"]);

    if (!d.ok) return Str.isEmpty(d.err) ? "git submodule deinit failed." : d.err;

    const gd = yield* git(w.path, ["rev-parse", "--absolute-git-dir"], g.on);

    if (!gd.ok || !/\/worktrees\/[^/]+$/.test(gd.out)) return "";

    const rm = yield* Exec.use((x) => x.run("rm", ["-rf", "--", `${gd.out}/modules`], { on: g.on }));

    return rm.code === 0 ? "" : Str.isEmpty(Str.trim(rm.stderr)) ? "Couldn't remove the submodules' repositories." : Str.trim(rm.stderr);
  });
}

/** Removes one checkout: closes the spaces showing it (a shell sitting in
 *  the folder keeps it busy), takes its submodules out first when asked
 *  (`clearSubs`), forces past uncommitted changes when `dirty` was shown,
 *  and deletes the branch when `branch`. "" or an error. */
export function removeOne(g: Git, w: Pick<Worktree, "path" | "branch">, opts: Removal, hooks: RemoveHooks = {}): Effect.Effect<string, ExecError, Exec> {
  const { closeSpace, step = () => {} } = hooks;
  const subs = (opts.subs ?? 0) > 0;

  return Effect.gen(function* () {
    for (const s of opts.spaces ?? []) closeSpace?.(s);

    if (subs && opts.clearSubs === true) {
      step("removing its submodules");

      const failed = yield* clearSubmodules(g, w);

      if (Str.isNonEmpty(failed)) return failed;
    }

    step("removing the worktree");

    const force = (opts.dirty ?? 0) > 0 || (subs && opts.clearSubs !== true) || (opts.unpushed ?? []).length > 0;
    const r = yield* g.run("Remove worktree", ["worktree", "remove", ...(force ? ["--force"] : []), w.path], { timeout: 600000 });

    if (!r.ok) return Str.isEmpty(r.err) ? "git worktree remove failed." : r.err;

    if (opts.branch === true && w.branch !== null) {
      step("deleting the branch");

      const b = yield* g.run("Delete branch", ["branch", "-D", w.branch]);

      if (!b.ok) return b.err;
    }

    return "";
  });
}

/** The branches merged into `base` (the main checkout's branch). */
export function merged(g: Git, base: string): Effect.Effect<ReadonlySet<string>, GitError, Exec> {
  return Effect.map(g.out(["branch", "--merged", base, "--format=%(refname:short)"]), (out) => new Set(nonBlank(out)));
}
