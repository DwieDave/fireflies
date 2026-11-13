// The Worktrees view's git and spaces work (the Files panel's third tab):
// what the worktree dialog and Nocturne's worktrees pane did, here. Every
// checkout of the repo, the main one first, then by their branch's last
// commit; which spaces show each one and which agents work in it; new ones
// go to <home>/.herdr/worktrees/<repo>/<branch> on the repo's machine and
// open as a space; removing closes the spaces in it first, says what would
// be lost (uncommitted changes, submodules, commits in them pushed nowhere)
// and can take the branch along.

import { exec, home, spaces, panes, agents } from "herdr";
import type { AgentInfo, ExecResult, PaneInfo, SpaceInfo } from "herdr";
import type { Git } from "./git.ts";
import type { Worktree } from "./parse.ts";
import { parseWorktrees } from "./parse.ts";

/** Where new checkouts go: <ROOT>/<repo>/<branch, slashes as dashes>. */
export const ROOT = (userHome: string) => `${userHome}/.herdr/worktrees`;

export const slug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export const inside = (p: string | null | undefined, dir: string | null | undefined) => Boolean(p && dir) && (p === dir || Boolean(p?.startsWith((dir ?? "").replace(/\/+$/, "") + "/")));

export const tilde = (p: string, userHome: string | null) => (userHome && p && (p === userHome || p.startsWith(userHome + "/")) ? `~${p.slice(userHome.length)}` : p);

export const label = (w: Pick<Worktree, "branch" | "path">) => w.branch ?? w.path.split("/").pop() ?? w.path;

/** A git command's outcome, trimmed. */
interface Outcome {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

async function git(cwd: string, args: readonly string[], on: string | null, timeout?: number): Promise<Outcome> {
  const r = await exec("git", [...args], timeout === undefined ? { cwd, on } : { cwd, on, timeout });

  return { ok: r.code === 0, out: r.stdout.trim(), err: (r.stderr || r.stdout).trim() };
}

/** The home folder on `on` (this computer's when null), with / separators. */
export async function userHomeOn(on: string | null) {
  if (!on) return home();

  let r: ExecResult | null = null;

  try { r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on }); } catch { /* not a POSIX shell: PowerShell next */ }

  if (!r || r.code !== 0 || !r.stdout.trim()) r = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on });

  if (r.code !== 0 || !r.stdout.trim()) throw new Error("Could not find the remote home folder.");

  return r.stdout.trim().replace(/\\/g, "/");
}

/** A space's folder: the one it's attached to (home holds no repo), else
 *  where its first terminal is now, else where it was made. */
export function spaceFolder(s: SpaceInfo | null | undefined, all: readonly PaneInfo[] = panes()) {
  if (!s) return null;

  if (s.attached && s.folder && !(s.machine === null && s.folder.replace(/\/+$/, "") === home())) return s.folder;

  const tabs = new Set(s.tabs.map((c) => c.id));

  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

/** The deepest checkout holding a folder (worktrees can live inside the main one). */
export function owner<W extends { readonly path: string }>(list: readonly W[], folder: string | null | undefined): W | null {
  if (!folder) return null;

  const f = folder.replace(/\\/g, "/");

  return list.filter((w) => inside(f, w.path)).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

/** A checkout in the Worktrees view: the main one, and when its branch last had a commit. */
export interface Checkout extends Worktree {
  readonly main: boolean;
  readonly at: number;
}

/** Every checkout of the repo: `git worktree list`, bare entries left out,
 *  the main one first, then the most recently committed branch. Each:
 *  { path, branch, head, detached, locked, prunable, main, at }. */
export async function listWorktrees(g: Git): Promise<Checkout[]> {
  const list = parseWorktrees(await g.text(["worktree", "list", "--porcelain"])).filter((w) => !w.bare);
  const refs = await g.text(["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"]);

  const when = new Map(refs.split("\n").filter(Boolean).map((l) => {
    const [b = "", at] = l.split("\t");

    return [b, Number(at) || 0];
  }));

  const out = list.map((w, i) => ({ ...w, main: i === 0, at: w.branch ? (when.get(w.branch) ?? 0) : 0 }));

  return out.sort((a, b) => Number(b.main) - Number(a.main) || b.at - a.at);
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
  const occ = new Map<string, Occupants>(list.map((w) => [w.path, { spaces: [], agents: [] }]));

  for (const s of spaceList) {
    if (s.machine !== on) continue;

    const w = owner(list, spaceFolder(s, paneList));

    if (w) occ.get(w.path)?.spaces.push(s);
  }

  for (const a of agentList) {
    const p = paneList.find((x) => x.pane === a.pane);
    const s = spaceList.find((x) => x.tabs.some((c) => c.id === p?.tab));

    if (s && s.machine !== on) continue;

    const w = owner(list, p?.cwd);

    if (w) occ.get(w.path)?.agents.push(a);
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

/** What removing a checkout would take with it: { dirty (files), subs
 *  (submodules git counts), unpushed (submodules with commits on no remote
 *  and not the pinned one) }. git refuses a worktree whose own git dir holds
 *  submodule repositories (<gitdir>/modules) even when `submodule status`
 *  calls them uninitialized, so those count too. */
export async function inspect(w: { readonly path: string }, on: string | null): Promise<Loss> {
  const [st, sub, gd] = await Promise.all([
    git(w.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on),
    git(w.path, ["submodule", "status"], on),
    git(w.path, ["rev-parse", "--absolute-git-dir"], on),
  ]);

  const lines = sub.ok ? sub.out.split("\n").filter((l) => l.trim()) : [];
  const checkedOut = lines.filter((l) => !l.startsWith("-")).length;

  const kept = gd.ok && /\/worktrees\/[^/]+$/.test(gd.out)
    && (await exec("test", ["-d", `${gd.out}/modules`], { on }).catch(() => ({ code: 1 }))).code === 0;

  const unpushed: string[] = [];

  if (gd.ok) {
    // Submodule repos with commits that exist nowhere else: on no remote, and
    // not the commit the parent pins (fetched by hash, often on no branch).
    const keys = await git(w.path, ["config", "--file", ".gitmodules", "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);

    for (const record of keys.ok ? keys.out.split("\0").filter(Boolean) : []) {
      const at = record.indexOf("\n");
      const name = record.slice("submodule.".length, at - ".path".length);
      const dir = `${gd.out}/modules/${name}`;

      if (!(await git(w.path, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue;

      const pinned = await git(w.path, ["rev-parse", `HEAD:${record.slice(at + 1)}`], on);
      const local = await git(w.path, ["--git-dir", dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(pinned.ok && pinned.out ? [pinned.out] : [])], on);

      if (local.ok && local.out) unpushed.push(name);
    }
  }

  return {
    dirty: st.ok ? st.out.split("\n").filter(Boolean).length : 0,
    subs: kept ? Math.max(checkedOut, lines.length, 1) : checkedOut,
    unpushed,
  };
}

/** Where a new checkout of `branch` goes. */
export async function pathFor(g: Git, branch: string) {
  const main = await mainOf(g);

  return `${ROOT(await userHomeOn(g.on))}/${main.split("/").pop() ?? main}/${slug(branch)}`;
}

/** The main checkout's folder (the one holding .git). */
export async function mainOf(g: Git) {
  const common = (await g.text(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();

  return common ? common.replace(/\/\.git\/?$/, "") : g.root;
}

/** Where `create` checks a branch out from (HEAD by default). */
export interface CreateOptions {
  readonly base?: string | null;
}

/** A new checkout (`created`: its branch is new too), or why there's none. */
export type Created = { readonly path: string; readonly created: boolean } | { readonly error: string };

/** Checks out `branch` (an existing one; else a new one from `base`, HEAD
 *  by default) in a new worktree; resolves { path } or { error }. */
export async function create(g: Git, branch: string | null, options: CreateOptions = {}): Promise<Created> {
  const { base = null } = options;
  const name = (branch ?? "").trim();

  if (!name) return { error: "Type a branch name." };

  const path = await pathFor(g, name);
  const exists = (await g.read(["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;
  const args = exists ? ["worktree", "add", path, name] : ["worktree", "add", "-b", name, path, base ?? "HEAD"];
  const r = await g.run("New worktree", args, { timeout: 600000 });

  return r.ok ? { path, created: !exists } : { error: r.err || "git worktree add failed." };
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

/** Removes one checkout: closes the spaces showing it (a shell sitting in
 *  the folder keeps it busy), takes its submodules out first when asked
 *  (`clearSubs`), forces past uncommitted changes when `dirty` was shown,
 *  and deletes the branch when `branch`. Resolves "" or an error. */
export async function removeOne(g: Git, w: Pick<Worktree, "path" | "branch">, opts: Removal, hooks: RemoveHooks = {}) {
  const { closeSpace, step = () => {} } = hooks;

  for (const s of opts.spaces ?? []) closeSpace?.(s);

  if (opts.subs && opts.clearSubs) {
    step("removing its submodules");

    const d = await g.run("Remove submodules", ["-C", w.path, "submodule", "deinit", "--all", "--force"]);

    if (!d.ok) return d.err || "git submodule deinit failed.";

    const gd = await git(w.path, ["rev-parse", "--absolute-git-dir"], g.on);

    if (gd.ok && /\/worktrees\/[^/]+$/.test(gd.out)) {
      const rm = await exec("rm", ["-rf", "--", `${gd.out}/modules`], { on: g.on });

      if (rm.code !== 0) return rm.stderr.trim() || "Couldn't remove the submodules' repositories.";
    }
  }

  step("removing the worktree");

  const force = opts.dirty || (opts.subs && !opts.clearSubs) || opts.unpushed?.length;
  const r = await g.run("Remove worktree", ["worktree", "remove", ...(force ? ["--force"] : []), w.path], { timeout: 600000 });

  if (!r.ok) return r.err || "git worktree remove failed.";

  if (opts.branch && w.branch) {
    step("deleting the branch");

    const b = await g.run("Delete branch", ["branch", "-D", w.branch]);

    if (!b.ok) return b.err;
  }

  return "";
}

/** The branches merged into `base` (the main checkout's branch). */
export async function merged(g: Git, base: string) {
  const out = await g.text(["branch", "--merged", base, "--format=%(refname:short)"]);

  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}
