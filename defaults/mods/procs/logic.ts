// The processes and ports manager's logic, free of the view (tested in
// scripts/procs.test.ts): what one probe reads, how it parses, the
// tree the deck draws, which rows a fold or a search leaves, where the cursor
// lands after a refresh, what a kill may touch and how it ends a process.
//
// One probe a refresh (PROBE, this machine only): who Developer is, every
// process's executable (`ps -o comm`: a path that may hold spaces), every
// process's row (`ps -o pid,ppid,pgid,user,etime,pcpu,rss,command`, the
// command cut at 2000 bytes: an agent's argv can carry a whole brief), and
// the TCP ports his processes listen on (`lsof -F pcn`). LC_ALL=C keeps
// ps's decimals points (a German Mac prints 0,4).

import type { ScrollWheelEvent } from "gpui-kit";
import type { exec as Exec, ExecResult, PaneInfo, SpaceInfo, focused as Focused, run as Run } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, nullable, object, oneOf } from "./guard.ts";

export const SEP = "@@procs@@";

export const PROBE = [
  "id -un",
  `echo '${SEP}'`,
  "LC_ALL=C ps -axo pid=,comm=",
  `echo '${SEP}'`,
  "LC_ALL=C ps -axww -o pid=,ppid=,pgid=,user=,etime=,pcpu=,rss=,command= | cut -c1-2000",
  `echo '${SEP}'`,
  "lsof -nP -iTCP -sTCP:LISTEN -F pcn 2>/dev/null",
  "true",
].join("; ");

/** One process, as ps lists it: its name and arguments split off its command line by its
 *  executable, cpu in percent, resident memory in KiB, how long it has run in seconds. */
export interface Proc {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly user: string;
  readonly secs: number | null;
  readonly cpu: number;
  readonly rss: number;
  readonly cmd: string;
  readonly name: string;
  readonly args: string;
}

/** A TCP port a process listens on, on these hosts (IPv4 and IPv6 together). */
export interface Port {
  readonly pid: number;
  readonly name: string;
  readonly port: number;
  readonly hosts: readonly string[];
}

/** One probe: who Developer is, every process, the listening ports. */
export interface Probe {
  readonly me: string;
  readonly procs: readonly Proc[];
  readonly ports: readonly Port[];
}

/** `etime` ([[dd-]hh:]mm:ss) in seconds; null when it isn't one. */
export function parseEtime(s: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());

  if (!m) return null;

  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/** A process's name: its executable's last path part (an app bundle's binary too). */
export const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** `ps -o pid=,comm=` lines: { pid: executable path }. */
export function parseComm(text: string): Map<number, string> {
  const out = new Map<number, string>();

  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);

    if (m?.[2] !== undefined) out.set(Number(m[1]), m[2]);
  }

  return out;
}

/** `ps -axww -o pid=,ppid=,pgid=,user=,etime=,pcpu=,rss=,command=` lines, with
 *  the executables `comm` gave (parseComm), as
 *  { pid, ppid, pgid, user, secs, cpu, rss (KiB), cmd, name, args }.
 *  The name comes from the executable, so a path with spaces stays whole;
 *  args is the command after it. Decimal commas read as points. */
export function parsePs(text: string, comm: ReadonlyMap<number, string> = new Map()): Proc[] {
  const out: Proc[] = [];

  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s(.*)$/.exec(line);

    if (!m) continue;

    const [, pidText = "", ppid = "", pgid = "", user = "", etime = "", pcpu = "", rss = "", command = ""] = m;
    const pid = Number(pidText);
    const cmd = command.trim();
    const exe = comm.get(pid);
    let name: string;
    let args: string;

    if (exe && cmd.startsWith(exe)) {
      name = baseName(exe);
      args = cmd.slice(exe.length).trim();
    } else {
      const first = cmd.split(/\s+/)[0] ?? "";

      // A login shell's argv[0] is "-zsh".
      name = baseName(first.replace(/^-/, "")) || baseName(exe ?? "");
      args = cmd.slice(first.length).trim();
    }

    out.push({ pid, ppid: Number(ppid), pgid: Number(pgid), user, secs: parseEtime(etime),
      cpu: Number(pcpu.replace(",", ".")) || 0, rss: Number(rss), cmd, name, args });
  }

  return out;
}

/** `lsof -F pcn` (listening TCP): one { pid, name, port, hosts } per process
 *  and port, IPv4 and IPv6 together, sorted by port. */
export function parseLsof(text: string): Port[] {
  const by = new Map<string, { pid: number; name: string; port: number; hosts: string[] }>();
  let pid: number | null = null;
  let name = "";

  for (const line of text.split("\n")) {
    const tag = line[0];
    const v = line.slice(1);

    if (tag === "p") {
      pid = Number(v);
      name = "";
    } else if (tag === "c") name = v;
    else if (tag === "n" && pid !== null) {
      const m = /^(.*):(\d+)$/.exec(v);

      if (!m) continue;

      const port = Number(m[2]);
      const host = m[1] ?? "";
      const key = `${pid}:${port}`;
      const e = by.get(key) ?? { pid, name, port, hosts: [] };

      if (!e.hosts.includes(host)) e.hosts.push(host);

      by.set(key, e);
    }
  }

  return [...by.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** The probe's output: { me, procs, ports }. */
export function parseProbe(text: string): Probe {
  const [me = "", comm = "", ps = "", lsof = ""] = text.split(`${SEP}\n`).map((s) => s.replace(new RegExp(`${SEP}\\s*$`), ""));

  return { me: me.trim(), procs: parsePs(ps, parseComm(comm)), ports: parseLsof(lsof) };
}

/** Why a process can't be ended from here, or null: the app itself, the
 *  core that runs every terminal, a holder of terminals, launchd, another
 *  user's. `me`: Developer's user name. */
export function guardOf(p: Proc | null | undefined, me: string | null | undefined): string | null {
  if (!p) return null;

  if (p.pid <= 1) return "system";

  if (me && p.user !== me) return "not yours";

  if (p.name === "herdr-core") return /^hold\b/.test(p.args) ? "holds terminals" : "runs every terminal";

  if (p.name === "Fireflies" || p.name === "herdr-app" || /\/Fireflies\.app\/Contents\/MacOS\//.test(p.cmd)) return "the app itself";

  return null;
}

/** A process list by pid, and each pid's children (oldest first). */
export interface Index {
  readonly byPid: ReadonlyMap<number, Proc>;
  readonly kids: ReadonlyMap<number, readonly number[]>;
}

/** byPid and kids (ppid -> pids, oldest first) of a process list. */
export function index(procs: readonly Proc[]): Index {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map<number, number[]>();

  for (const p of procs) {
    if (p.ppid === p.pid || !byPid.has(p.ppid)) continue;

    const list = kids.get(p.ppid);

    if (list) list.push(p.pid);
    else kids.set(p.ppid, [p.pid]);
  }

  for (const list of kids.values()) list.sort((a, b) => a - b);

  return { byPid, kids };
}

/** Every pid under `pid` (not itself), depth first. */
export function descendants(pid: number, kids: Index["kids"]): number[] {
  const out: number[] = [];
  const seen = new Set([pid]);

  const walk = (q: number): void => {
    for (const c of kids.get(q) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
        walk(c);
      }
    }
  };

  walk(pid);

  return out;
}

// ---- the tree

/** A process and what it started. */
export interface ProcNode {
  readonly key: string;
  readonly kind: "proc";
  readonly pid: number;
  readonly kids: readonly ProcNode[];
}

/** A terminal of this app's, and its process. */
export interface TermNode {
  readonly key: string;
  readonly kind: "term";
  readonly address: string;
  readonly name: string;
  readonly cwd: string | null;
  readonly status: string | null;
  readonly kids: readonly ProcNode[];
}

/** A tab and its terminals. */
export interface TabNode {
  readonly key: string;
  readonly kind: "tab";
  readonly n: number;
  readonly name: string;
  readonly kids: readonly TermNode[];
}

/** A space: its tabs; "no pane": the terminals without one; another machine's: a note. */
export interface SpaceNode {
  readonly key: string;
  readonly kind: "space";
  readonly name: string;
  readonly folder: string | null;
  readonly machine?: string;
  readonly kids: readonly (TabNode | TermNode)[];
}

/** A node of the deck's tree. */
export type TreeNode = ProcNode | TermNode | TabNode | SpaceNode;

/** A process and everything under it as tree nodes. */
function procNode(pid: number, ix: Index, seen = new Set<number>()): ProcNode {
  seen.add(pid);

  return { key: `p:${pid}`, kind: "proc", pid, kids: (ix.kids.get(pid) ?? []).flatMap((c) => (seen.has(c) ? [] : [procNode(c, ix, seen)])) };
}

/** Number of processes in a node and below it. */
export function count(node: TreeNode): number {
  let n = node.kind === "proc" ? 1 : 0;

  for (const k of node.kids) n += count(k);

  return n;
}

/** A terminal of herdr-core's listing (`terminals()`), the fields the deck reads: its
 *  address (another machine's has a "/" in it), its process, state, the name the sidebar
 *  gave it (label nocturne.name), its own name, argv, folder and status. */
export const isTerminal = object({ address: isString }, {
  pid: nullable(isNumber),
  state: nullable(isString),
  labels: nullable(object({}, { "nocturne.name": isString })),
  name: nullable(isString),
  argv: nullable(arrayOf(isString)),
  cwd: nullable(isString),
  status: nullable(isString),
});

export type Terminal = Guarded<typeof isTerminal>;

/** A live terminal on this machine (not another's, not finished). */
export const isLocal = (t: Terminal): boolean => !t.address.includes("/") && t.state !== "finished";

/** A terminal's display name: the name given it, its agent's or program's, its title. */
const termName = (t: Terminal, pane: PaneInfo | null): string => t.labels?.["nocturne.name"] || pane?.program?.name || t.name || pane?.title || t.argv?.[0] || "terminal";

/** What the tree is built from: the probe, the app's terminals, panes and spaces, and whether
 *  it lists every process of Developer's (`all`) or this app's terminals. */
export interface TreeFrom {
  readonly procs?: readonly Proc[];
  readonly me?: string;
  readonly terminals?: readonly Terminal[];
  readonly panes?: readonly PaneInfo[];
  readonly spaces?: readonly SpaceInfo[];
  readonly all?: boolean;
  readonly ix?: Index;
}

/**
 * The tree the deck shows.
 *  here (all false): this app's terminals on this machine, grouped
 *    space › tab › terminal › its process and what that started; terminals
 *    without a pane (script runs, hidden ones) under "no pane"; spaces on
 *    another machine as one note each.
 *  all: every process of Developer's, each one whose parent isn't his
 *    (launchd's children, mostly) a root, by name; a terminal's process is
 *    tagged with its address.
 * `ctx`: { procs, me, terminals, panes, spaces, all }.
 */
export function buildTree(ctx: TreeFrom): TreeNode[] {
  const { procs = [], me = "", terminals = [], panes = [], spaces = [], all = false } = ctx;
  const ix = ctx.ix ?? index(procs);
  const local = terminals.filter((t) => isLocal(t));

  if (all) {
    const mine = procs.filter((p) => !me || p.user === me);

    const roots = mine.filter((p) => {
      const up = ix.byPid.get(p.ppid);

      return !up || up.pid === p.pid || (me && up.user !== me);
    });

    // By name, any case, then pid: keys made once (localeCompare in the sort cost a frame's whole budget).
    const keyed = roots.map((p): [string, number] => [p.name.toLowerCase(), p.pid]);

    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

    return keyed.map(([, pid]) => procNode(pid, ix));
  }

  const byAddr = new Map(local.map((t) => [t.address, t]));
  const used = new Set<string>();

  const termNode = (t: Terminal, pane: PaneInfo | null): TermNode => {
    used.add(t.address);

    const pid = Number(t.pid);

    return { key: `x:${t.address}`, kind: "term", address: t.address, name: termName(t, pane), cwd: pane?.cwd ?? t.cwd ?? null,
      status: pane?.status ?? t.status ?? null, kids: ix.byPid.has(pid) ? [procNode(pid, ix)] : [] };
  };

  const out: SpaceNode[] = [];

  for (const s of spaces) {
    if (s.machine) {
      out.push({ key: `s:${s.id}`, kind: "space", name: s.name, machine: s.machine, folder: s.folder, kids: [] });
      continue;
    }

    const tabs: TabNode[] = [];

    for (const tab of s.tabs) {
      const terms = panes.flatMap((p) => {
        const t = p.tab === tab.id && p.terminal && !used.has(p.terminal) ? byAddr.get(p.terminal) : undefined;

        return t ? [termNode(t, p)] : [];
      });

      if (terms.length) tabs.push({ key: `t:${tab.id}`, kind: "tab", n: tab.index, name: tab.name, kids: terms });
    }

    if (tabs.length) out.push({ key: `s:${s.id}`, kind: "space", name: s.name, folder: s.folder, kids: tabs });
  }

  const loose = local.flatMap((t) => (used.has(t.address) ? [] : [termNode(t, null)]));

  if (loose.length) out.push({ key: "s:~", kind: "space", name: "no pane", folder: null, kids: loose });

  return out;
}

/** What a node shows that matches `q` (name, arguments, pid; any case). */
function matches(node: TreeNode, q: string, byPid: Index["byPid"]): boolean {
  if (node.kind === "proc") {
    const p = byPid.get(node.pid);

    return Boolean(p) && (`${p?.name} ${p?.args}`.toLowerCase().includes(q) || String(p?.pid).startsWith(q));
  }

  return node.name.toLowerCase().includes(q) || (node.kind === "term" && node.address.toLowerCase() === q);
}

/** A row on screen: its node, how deep, and whether it's open (null: a leaf). */
export interface Row {
  readonly key: string;
  readonly kind: TreeNode["kind"];
  readonly depth: number;
  readonly node: TreeNode;
  readonly open: boolean | null;
}

/** What a tree's rows leave out: the folded nodes (key → true), a search, the processes. */
export interface FlattenOptions {
  readonly folds?: ReadonlyMap<string, boolean>;
  readonly query?: string;
  readonly byPid?: Index["byPid"];
}

/**
 * The rows a tree leaves on screen: each { key, kind, depth, node, open }
 * (open: null for a leaf). `folds`: key -> true for a folded node (every
 * node starts open). With a query, only the matching rows and those above
 * them, unfolded.
 */
export function flatten(tree: readonly TreeNode[], { folds = new Map(), query = "", byPid = new Map() }: FlattenOptions = {}): Row[] {
  const q = query.trim().toLowerCase();
  const rows: Row[] = [];
  const keep = new Map<TreeNode, boolean>();

  // Every node is marked (its kids before it answers), not only up to the first match.
  const mark = (n: TreeNode): boolean => {
    let k = matches(n, q, byPid);

    for (const c of n.kids) k = mark(c) || k;

    keep.set(n, k);

    return k;
  };

  if (q) tree.forEach(mark);

  const walk = (n: TreeNode, depth: number): void => {
    if (q && !keep.get(n)) return;

    const leaf = !n.kids.length;
    const open = leaf ? null : q ? true : !folds.get(n.key);

    rows.push({ key: n.key, kind: n.kind, depth, node: n, open });

    if (open) for (const c of n.kids) walk(c, depth + 1);
  };

  tree.forEach((n) => walk(n, 0));

  return rows;
}

/** Where the cursor goes after the rows changed: on the same key if it's
 *  still there (a process keeps its pid), else at the index it was on. */
export function place(rows: readonly { readonly key: string }[], key: string | null, at: number | null): number {
  const i = key === null ? -1 : rows.findIndex((r) => r.key === key);

  if (i >= 0) return i;

  return rows.length ? Math.max(0, Math.min(rows.length - 1, at ?? 0)) : -1;
}

/** What a kill reaches: the processes, and with `tree` what's under it too. */
export interface Reach extends Index {
  readonly tree?: boolean;
  readonly me: string | null;
}

/** The pids a kill of `pid` reaches: just it, or with `tree` everything
 *  under it too; never a guarded process nor anything under one. Empty when
 *  `pid` itself is guarded. */
export function targets(pid: number, { tree = false, byPid, kids, me }: Reach): number[] {
  const root = byPid.get(pid);

  if (!root || guardOf(root, me)) return [];

  if (!tree) return [pid];

  const out = [pid];

  const walk = (q: number): void => {
    for (const c of kids.get(q) ?? []) {
      const p = byPid.get(c);

      if (!p || guardOf(p, me) || out.includes(c)) continue;

      out.push(c);
      walk(c);
    }
  };

  walk(pid);

  return out;
}

/** herdr's exec, as the kill flow calls it (a fake in the tests). */
export type Execute = typeof Exec;

/** Of `pids`, the ones still running (`ps -p`; a zombie counts as ended). */
export async function alive(pids: readonly number[], exec: Execute): Promise<number[]> {
  if (!pids.length) return [];

  const r = await exec("ps", ["-o", "pid=,stat=", "-p", pids.join(",")], { timeout: 5000 }).catch(() => null);
  const live = new Set<number>();

  for (const line of (r?.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);

    if (m && !m[2]?.startsWith("Z")) live.add(Number(m[1]));
  }

  return pids.filter((p) => live.has(p));
}

/** Sends `signal` (TERM, KILL) to `pids`. */
export function signal(pids: readonly number[], sig: "TERM" | "KILL", exec: Execute): Promise<ExecResult | null> {
  if (!pids.length) return Promise.resolve(null);

  return exec("kill", [`-${sig}`, ...pids.map(String)], { timeout: 5000 }).catch(() => null);
}

/** How a gentle end runs: exec, the caller's timer, the grace (ms) before asking who's left. */
export interface Gently {
  readonly exec: Execute;
  readonly wait: (ms: number) => Promise<void>;
  readonly grace?: number;
}

/** TERM, a moment, and the ones that held on: the deck then offers KILL for those.
 *  `wait(ms)` is the caller's timer (cx.timer.after): the engine has no setTimeout
 *  (a stub that throws), so there is no default for it. */
export async function endGently(pids: readonly number[], { exec, wait, grace = 2000 }: Gently): Promise<number[]> {
  // A JavaScript caller may leave it out (the type can't stop that).
  if (!isFunction(wait)) throw new TypeError("endGently needs wait(ms): the engine has no setTimeout, use cx.timer.after");

  await signal(pids, "TERM", exec);
  await wait(grace);

  return alive(pids, exec);
}

/** The wait a caller passed is a function. */
function isFunction(value: unknown): value is (ms: number) => Promise<void> {
  return typeof value === "function";
}

/** The address a port opens and copies as. */
export const address = (port: number): string => `http://localhost:${port}`;

/** The terminal a process runs in: the nearest terminal pid at or above it. */
export function terminalOf(pid: number, byPid: Index["byPid"], termPids: ReadonlyMap<number, string>): string | null {
  const seen = new Set<number>();

  for (let p = byPid.get(pid); p && !seen.has(p.pid); p = byPid.get(p.ppid)) {
    seen.add(p.pid);

    const t = termPids.get(p.pid);

    if (t !== undefined) return t;
  }

  return null;
}

/** The app's panes and spaces, to say where a terminal is. */
export interface Places {
  readonly panes?: readonly PaneInfo[];
  readonly spaces?: readonly SpaceInfo[];
}

/** Where a terminal is: "2 api › t7", or "no pane · t7", or just its address. */
export function whereIs(address: string, { panes = [], spaces = [] }: Places): string {
  const pane = panes.find((p) => p.terminal === address);

  if (!pane) return `no pane · ${address}`;

  for (const s of spaces) {
    const tab = s.tabs.find((t) => t.id === pane.tab);

    if (tab) return `${spaces.length > 1 ? `${s.name} › ` : ""}${tab.index} ${tab.name} › ${address}`;
  }

  return address;
}

/** A web pane's props: its slot (browser.open's target). */
const isSlotted = object({ slot: oneOf(isString, isNumber) });

/** Where a port opens: the app's panes, the focus, herdr's run. */
export interface PortHost {
  readonly panes?: readonly PaneInfo[];
  readonly focused?: Pick<NonNullable<ReturnType<typeof Focused>>, "tab"> | null;
  readonly run: typeof Run;
}

/** Opens a port in a web pane: a new tab in the focused tab's web pane
 *  (browser.open with its slot) if there is one, else a web pane
 *  beside the focused pane, as a clicked link opens (app.open_url in app). */
export function openPort(port: number, { panes = [], focused = null, run }: PortHost): null {
  const url = address(port);
  const tab = focused?.tab ?? panes.find((p) => p.focused)?.tab ?? null;

  const web = panes.flatMap((p) => (p.tab === tab && p.mod === "browser" && isSlotted(p.props) ? [{ focused: p.focused, slot: p.props.slot }] : []))
    .sort((a, b) => Number(b.focused) - Number(a.focused))[0];

  if (web) return run(`browser.open:${JSON.stringify({ url, slot: String(web.slot) })}`);

  return run("app.open_url", { url, in: "app" });
}

/** "1:12:04", "3:41", "2d 4h": how long a process has run. */
export function uptime(secs: number | null): string {
  if (secs === null) return "";

  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;

  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const two = (n: number): string => String(n).padStart(2, "0");

  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "412M", "1.9G", "88K": resident memory from KiB. */
export function memory(kib: number | null): string {
  if (kib === null) return "";

  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)}G`;

  if (kib >= 1024) return `${Math.round(kib / 1024)}M`;

  return `${kib}K`;
}

/** A command line for one row: newlines (an agent's brief) as ⏎, runs of space as one. */
export const oneLine = (s: string): string => s.replace(/\\012|\n/g, " ⏎ ").replace(/\s+/g, " ").trim();

/** What a wheel event says of its move: lines (a mouse) or pixels (a trackpad). */
export type Wheel = Pick<ScrollWheelEvent, "delta"> & Partial<Pick<ScrollWheelEvent, "delta_lines">>;

/**
 * How far a wheel event moves a list, in layout px (more: toward the end).
 * A mouse wheel reports lines: each moves one `row`. A trackpad reports
 * pixels (momentum included): they move as far as the fingers, taken back
 * out of the window's `zoom` (at 0.9 a window pixel is 1/0.9 of a layout one).
 */
export function wheelDelta(e: Wheel, row: number, zoom = 1): number {
  const lines = Number(e.delta_lines?.y);

  if (Number.isFinite(lines) && lines !== 0) return -lines * row;

  return -(Number(e.delta.y) || 0) / (Number(zoom) || 1);
}

/** A scroll offset moved by `by`, kept within 0 and `max`. */
export const scrollBy = (offset: number, by: number, max: number): number => Math.max(0, Math.min(Math.max(0, max), offset + by));
