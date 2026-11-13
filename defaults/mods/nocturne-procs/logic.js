// The processes and ports manager's logic, free of the view (tested in
// scripts/nocturne-procs.test.ts): what one probe reads, how it parses, the
// tree the deck draws, which rows a fold or a search leaves, where the cursor
// lands after a refresh, what a kill may touch and how it ends a process.
//
// One probe a refresh (PROBE, this machine only): who Developer is, every
// process's executable (`ps -o comm`: a path that may hold spaces), every
// process's row (`ps -o pid,ppid,pgid,user,etime,pcpu,rss,command`, the
// command cut at 2000 bytes: an agent's argv can carry a whole brief), and
// the TCP ports his processes listen on (`lsof -F pcn`). LC_ALL=C keeps
// ps's decimals points (a German Mac prints 0,4).

export const SEP = "@@nocturne-procs@@";
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

/** `etime` ([[dd-]hh:]mm:ss) in seconds; null when it isn't one. */
export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/** A process's name: its executable's last path part (an app bundle's binary too). */
export const baseName = (path) => String(path ?? "").replace(/\/+$/, "").split("/").pop() || String(path ?? "");

/** `ps -o pid=,comm=` lines: { pid: executable path }. */
export function parseComm(text) {
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/** `ps -axww -o pid=,ppid=,pgid=,user=,etime=,pcpu=,rss=,command=` lines, with
 *  the executables `comm` gave (parseComm), as
 *  { pid, ppid, pgid, user, secs, cpu, rss (KiB), cmd, name, args }.
 *  The name comes from the executable, so a path with spaces stays whole;
 *  args is the command after it. Decimal commas read as points. */
export function parsePs(text, comm = new Map()) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[8].trim();
    const exe = comm.get(pid);
    let name, args;
    if (exe && cmd.startsWith(exe)) { name = baseName(exe); args = cmd.slice(exe.length).trim(); }
    else {
      const first = cmd.split(/\s+/)[0] ?? "";
      // A login shell's argv[0] is "-zsh".
      name = baseName(first.replace(/^-/, "")) || baseName(exe ?? "");
      args = cmd.slice(first.length).trim();
    }
    out.push({ pid, ppid: Number(m[2]), pgid: Number(m[3]), user: m[4], secs: parseEtime(m[5]),
      cpu: Number(m[6].replace(",", ".")) || 0, rss: Number(m[7]), cmd, name, args });
  }
  return out;
}

/** `lsof -F pcn` (listening TCP): one { pid, name, port, hosts } per process
 *  and port, IPv4 and IPv6 together, sorted by port. */
export function parseLsof(text) {
  const by = new Map();
  let pid = null, name = "";
  for (const line of String(text ?? "").split("\n")) {
    const tag = line[0], v = line.slice(1);
    if (tag === "p") { pid = Number(v); name = ""; }
    else if (tag === "c") name = v;
    else if (tag === "n" && pid != null) {
      const m = /^(.*):(\d+)$/.exec(v);
      if (!m) continue;
      const port = Number(m[2]);
      const host = m[1];
      const key = `${pid}:${port}`;
      const e = by.get(key) ?? { pid, name, port, hosts: [] };
      if (!e.hosts.includes(host)) e.hosts.push(host);
      by.set(key, e);
    }
  }
  return [...by.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** The probe's output: { me, procs, ports }. */
export function parseProbe(text) {
  const [me = "", comm = "", ps = "", lsof = ""] = String(text ?? "").split(SEP + "\n").map((s) => s.replace(new RegExp(`${SEP}\\s*$`), ""));
  return { me: me.trim(), procs: parsePs(ps, parseComm(comm)), ports: parseLsof(lsof) };
}

/** Why a process can't be ended from here, or null: the app itself, the
 *  core that runs every terminal, a holder of terminals, launchd, another
 *  user's. `me`: Developer's user name. */
export function guardOf(p, me) {
  if (!p) return null;
  if (p.pid <= 1) return "system";
  if (me && p.user !== me) return "not yours";
  if (p.name === "herdr-core") return /^hold\b/.test(p.args) ? "holds terminals" : "runs every terminal";
  if (p.name === "Fireflies" || p.name === "herdr-app" || /\/Fireflies\.app\/Contents\/MacOS\//.test(p.cmd)) return "the app itself";
  return null;
}

/** byPid and kids (ppid -> pids, oldest first) of a process list. */
export function index(procs) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of procs) {
    if (p.ppid === p.pid || !byPid.has(p.ppid)) continue;
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  for (const list of kids.values()) list.sort((a, b) => a - b);
  return { byPid, kids };
}

/** Every pid under `pid` (not itself), depth first. */
export function descendants(pid, kids) {
  const out = [], seen = new Set([pid]);
  const walk = (q) => { for (const c of kids.get(q) ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); walk(c); } };
  walk(pid);
  return out;
}

/** A process and everything under it as tree nodes. */
function procNode(pid, ix, seen = new Set()) {
  seen.add(pid);
  return { key: `p:${pid}`, kind: "proc", pid, kids: (ix.kids.get(pid) ?? []).filter((c) => !seen.has(c)).map((c) => procNode(c, ix, seen)) };
}

/** Number of processes in a node and below it. */
export function count(node) {
  return (node.kind === "proc" ? 1 : 0) + node.kids.reduce((n, k) => n + count(k), 0);
}

/** A terminal's display name: the name given it, its agent's or program's, its title. */
const termName = (t, pane) => t?.labels?.["nocturne.name"] || pane?.program?.name || t?.name || pane?.title || t?.argv?.[0] || "terminal";

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
export function buildTree(ctx) {
  const { procs = [], me = "", terminals = [], panes = [], spaces = [], all = false } = ctx;
  const ix = index(procs);
  const local = terminals.filter((t) => t?.address && !String(t.address).includes("/") && t.state !== "finished");
  if (all) {
    const mine = procs.filter((p) => !me || p.user === me);
    const roots = mine.filter((p) => { const up = ix.byPid.get(p.ppid); return !up || up.pid === p.pid || (me && up.user !== me); });
    roots.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.pid - b.pid);
    return roots.map((p) => procNode(p.pid, ix));
  }
  const byAddr = new Map(local.map((t) => [t.address, t]));
  const used = new Set();
  const termNode = (t, pane) => {
    used.add(t.address);
    const pid = Number(t.pid);
    return { key: `x:${t.address}`, kind: "term", address: t.address, name: termName(t, pane), cwd: pane?.cwd ?? t.cwd ?? null,
      status: pane?.status ?? t.status ?? null, kids: ix.byPid.has(pid) ? [procNode(pid, ix)] : [] };
  };
  const out = [];
  for (const s of spaces) {
    if (s.machine) { out.push({ key: `s:${s.id}`, kind: "space", name: s.name, machine: s.machine, folder: s.folder, kids: [] }); continue; }
    const tabs = [];
    for (const tab of s.tabs ?? []) {
      const terms = panes.filter((p) => p.tab === tab.id && p.terminal && byAddr.has(p.terminal) && !used.has(p.terminal))
        .map((p) => termNode(byAddr.get(p.terminal), p));
      if (terms.length) tabs.push({ key: `t:${tab.id}`, kind: "tab", n: tab.index, name: tab.name, kids: terms });
    }
    if (tabs.length) out.push({ key: `s:${s.id}`, kind: "space", name: s.name, folder: s.folder, kids: tabs });
  }
  const loose = local.filter((t) => !used.has(t.address)).map((t) => termNode(t, null));
  if (loose.length) out.push({ key: "s:~", kind: "space", name: "no pane", folder: null, kids: loose });
  return out;
}

/** What a node shows that matches `q` (name, arguments, pid; any case). */
function matches(node, q, byPid) {
  if (node.kind === "proc") {
    const p = byPid.get(node.pid);
    return Boolean(p) && (`${p.name} ${p.args}`.toLowerCase().includes(q) || String(p.pid).startsWith(q));
  }
  return String(node.name ?? "").toLowerCase().includes(q) || String(node.address ?? "").toLowerCase() === q;
}

/**
 * The rows a tree leaves on screen: each { key, kind, depth, node, open }
 * (open: null for a leaf). `folds`: key -> true for a folded node (every
 * node starts open). With a query, only the matching rows and those above
 * them, unfolded.
 */
export function flatten(tree, { folds = {}, query = "", byPid = new Map() } = {}) {
  const q = query.trim().toLowerCase();
  const rows = [];
  const keep = new Map();
  const mark = (n) => { const k = matches(n, q, byPid) | n.kids.reduce((m, c) => mark(c) | m, 0); keep.set(n, Boolean(k)); return k; };
  if (q) tree.forEach(mark);
  const walk = (n, depth) => {
    if (q && !keep.get(n)) return;
    const leaf = !n.kids.length;
    const open = leaf ? null : q ? true : !folds[n.key];
    rows.push({ key: n.key, kind: n.kind, depth, node: n, open });
    if (open) for (const c of n.kids) walk(c, depth + 1);
  };
  tree.forEach((n) => walk(n, 0));
  return rows;
}

/** Where the cursor goes after the rows changed: on the same key if it's
 *  still there (a process keeps its pid), else at the index it was on. */
export function place(rows, key, at) {
  const i = key == null ? -1 : rows.findIndex((r) => r.key === key);
  if (i >= 0) return i;
  return rows.length ? Math.max(0, Math.min(rows.length - 1, at ?? 0)) : -1;
}

/** The pids a kill of `pid` reaches: just it, or with `tree` everything
 *  under it too; never a guarded process nor anything under one. Empty when
 *  `pid` itself is guarded. */
export function targets(pid, { tree = false, byPid, kids, me }) {
  const root = byPid.get(pid);
  if (!root || guardOf(root, me)) return [];
  if (!tree) return [pid];
  const out = [pid];
  const walk = (q) => {
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

/** Of `pids`, the ones still running (`ps -p`; a zombie counts as ended). */
export async function alive(pids, exec) {
  if (!pids.length) return [];
  const r = await exec("ps", ["-o", "pid=,stat=", "-p", pids.join(",")], { timeout: 5000 }).catch(() => null);
  const live = new Set();
  for (const line of String(r?.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (m && !m[2].startsWith("Z")) live.add(Number(m[1]));
  }
  return pids.filter((p) => live.has(p));
}

/** Sends `signal` (TERM, KILL) to `pids`. */
export function signal(pids, sig, exec) {
  if (!pids.length) return Promise.resolve(null);
  return exec("kill", [`-${sig}`, ...pids.map(String)], { timeout: 5000 }).catch(() => null);
}

/** TERM, a moment, and the ones that held on: the deck then offers KILL for those. */
export async function endGently(pids, { exec, wait = (ms) => new Promise((r) => setTimeout(r, ms)), grace = 2000 }) {
  await signal(pids, "TERM", exec);
  await wait(grace);
  return alive(pids, exec);
}

/** The address a port opens and copies as. */
export const address = (port) => `http://localhost:${port}`;

/** The terminal a process runs in: the nearest terminal pid at or above it. */
export function terminalOf(pid, byPid, termPids) {
  const seen = new Set();
  for (let p = byPid.get(pid); p && !seen.has(p.pid); p = byPid.get(p.ppid)) {
    seen.add(p.pid);
    if (termPids.has(p.pid)) return termPids.get(p.pid);
  }
  return null;
}

/** Where a terminal is: "2 api › t7", or "no pane · t7", or just its address. */
export function whereIs(address, { panes = [], spaces = [] }) {
  const pane = panes.find((p) => p.terminal === address);
  if (!pane) return `no pane · ${address}`;
  for (const s of spaces) {
    const tab = (s.tabs ?? []).find((t) => t.id === pane.tab);
    if (tab) return `${spaces.length > 1 ? `${s.name} › ` : ""}${tab.index} ${tab.name} › ${address}`;
  }
  return address;
}

/** Opens a port in a web pane: a new tab in the focused tab's web pane
 *  (nocturne-browser.open with its slot) if there is one, else a web pane
 *  beside the focused pane, as a clicked link opens (app.open_url in app). */
export function openPort(port, { panes = [], focused = null, run }) {
  const url = address(port);
  const tab = focused?.tab ?? panes.find((p) => p.focused)?.tab ?? null;
  const web = panes.filter((p) => p.tab === tab && p.mod === "nocturne-browser" && p.props?.slot != null)
    .sort((a, b) => Number(b.focused) - Number(a.focused))[0];
  if (web) return run(`nocturne-browser.open:${JSON.stringify({ url, slot: String(web.props.slot) })}`);
  return run("app.open_url", { url, in: "app" });
}

/** "1:12:04", "3:41", "2d 4h": how long a process has run. */
export function uptime(secs) {
  if (secs == null) return "";
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "412M", "1.9G", "88K": resident memory from KiB. */
export function memory(kib) {
  if (kib == null) return "";
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)}G`;
  if (kib >= 1024) return `${Math.round(kib / 1024)}M`;
  return `${kib}K`;
}

/** A command line for one row: newlines (an agent's brief) as ⏎, runs of space as one. */
export const oneLine = (s) => String(s ?? "").replace(/\\012|\n/g, " ⏎ ").replace(/\s+/g, " ").trim();

/**
 * How far a wheel event moves a list, in layout px (more: toward the end).
 * A mouse wheel reports lines: each moves one `row`. A trackpad reports
 * pixels (momentum included): they move as far as the fingers, taken back
 * out of the window's `zoom` (at 0.9 a window pixel is 1/0.9 of a layout one).
 */
export function wheelDelta(e, row, zoom = 1) {
  const lines = Number(e?.delta_lines?.y);
  if (Number.isFinite(lines) && lines !== 0) return -lines * row;
  return -(Number(e?.delta?.y) || 0) / (Number(zoom) || 1);
}

/** A scroll offset moved by `by`, kept within 0 and `max`. */
export const scrollBy = (offset, by, max) => Math.max(0, Math.min(Math.max(0, max), offset + by));
