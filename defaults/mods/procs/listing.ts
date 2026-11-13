// What the process deck lists: this app's terminals and their processes as a
// tree (cached while the reading and the folds stay), the rows it shows, the
// ports, the row under the cursor.

import { panes, spaces, terminals } from "herdr";
import type { Index, Row, Terminal, TreeNode } from "./logic.ts";
import { buildTree, flatten, place, guardOf, terminalOf, whereIs, count, isTerminal, isLocal } from "./logic.ts";
import type { PortItem, Item } from "./state.ts";
import { NO_PIDS } from "./state.ts";
import type { default as ProcsDeck } from "./main.ts";

/** The app's terminals, those herdr-core lists in a form the deck reads. */
export function ownTerminals(): Terminal[] {
  return terminals().filter((t) => isTerminal(t));
}

/** Live local terminals' pids: pid -> address. */
export function termPids(): Map<number, string> {
  return new Map(ownTerminals().flatMap((t): [number, string][] => (t.pid && isLocal(t) ? [[t.pid, t.address]] : [])));
}

export function byPid(v: ProcsDeck): Index["byPid"] {
  return v.ix?.byPid ?? NO_PIDS;
}

/** The tree, built again only when a refresh, a or the app's spaces, tabs and terminals
 *  change it: a frame has 50 ms, and building it over every process of a Mac's takes more. */
export function procTree(v: ProcsDeck): readonly TreeNode[] {
  const snap = v.snap;

  if (!snap) return [];

  const ctx = { terminals: ownTerminals(), panes: panes(), spaces: spaces() };

  // What buildTree reads, no more: an agent's terminal carries its whole brief in argv.
  const sig = JSON.stringify([v.all,
    ctx.terminals.map((t) => [t.address, t.pid, t.state, t.labels?.["nocturne.name"], t.name, t.argv?.[0], t.cwd, t.status]),
    ctx.panes.map((p) => [p.tab, p.terminal, p.status, p.cwd, p.program?.name, p.title]),
    ctx.spaces.map((x) => [x.id, x.name, x.folder, x.machine, x.tabs.map((tab) => [tab.id, tab.index, tab.name])])]);

  const c = v.treeCache;

  if (c?.snap === snap && c.sig === sig) return c.tree;

  const tree = buildTree(v.ix ? { procs: snap.procs, me: snap.me, ix: v.ix, all: v.all, ...ctx } : { procs: snap.procs, me: snap.me, all: v.all, ...ctx });
  let n = 0;

  for (const node of tree) n += count(node);

  v.treeCache = { snap, sig, tree, n };

  return tree;
}

/** How many processes the tree holds (the processes tab's count). */
export function procCount(v: ProcsDeck): number {
  if (!v.snap) return 0;

  procTree(v);

  return v.treeCache?.n ?? 0;
}

/** The rows on screen, made again only when the tree, a fold or the query changes. */
export function listRows(v: ProcsDeck, tree: readonly TreeNode[] = procTree(v)): Row[] {
  if (!v.snap) return [];

  const sig = JSON.stringify([[...v.folds], v.query]);
  const c = v.rowsCache;

  if (c?.tree === tree && c.sig === sig) return c.rows;

  const rows = flatten(tree, { folds: v.folds, query: v.query, byPid: byPid(v) });

  v.rowsCache = { tree, sig, rows };

  return rows;
}

/** The ports, those in this app's terminals first: { key, port, pid, name, hosts, term, where, guard }. */
export function portList(v: ProcsDeck): PortItem[] {
  const snap = v.snap;

  if (!snap) return [];

  const tp = termPids();
  const ctx = { panes: panes(), spaces: spaces() };
  const q = v.query.trim().toLowerCase();

  return snap.ports.flatMap((x): PortItem[] => {
    const term = terminalOf(x.pid, byPid(v), tp);
    const p = byPid(v).get(x.pid);
    const name = p?.name ?? x.name;

    if (q && !`${x.port} ${name}`.toLowerCase().includes(q)) return [];

    return [{ key: `${x.port}:${x.pid}`, ...x, name, term, where: term ? whereIs(term, ctx) : null, guard: guardOf(p, snap.me) }];
  })
    .sort((a, b) => Number(Boolean(b.term)) - Number(Boolean(a.term)) || a.port - b.port);
}

export function tabList(v: ProcsDeck): readonly Item[] {
  return v.tab === "ports" ? portList(v) : v.rows();
}

/** The cursor's index in `items`, kept on its key. */
export function rowAt(v: ProcsDeck, items: readonly Item[]): number {
  const c = v.cur[v.tab];
  const i = place(items, c.key, c.at);

  c.at = Math.max(0, i);
  c.key = items[i]?.key ?? null;

  return i;
}

export function moveTo(v: ProcsDeck, items: readonly Item[], i: number): void {
  if (!items.length) return;

  const c = v.cur[v.tab];

  c.at = Math.max(0, Math.min(items.length - 1, i));
  c.key = items[c.at]?.key ?? null;
  v.follow = true;
}

export function procOf(v: ProcsDeck, pid: number): ReturnType<Index["byPid"]["get"]> | null {
  return byPid(v).get(pid) ?? null;
}
