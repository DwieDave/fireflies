// The process deck's row menu: a right-click on a row (or m on the selected
// one) opens it at the pointer (under the row by key). Its entries are what
// one does to that row, each with its key beside it, and every key works
// without the menu too:
//
//   process   enter go to its terminal · f open its folder · p copy pid ·
//             c copy command line · space fold / unfold its children ·
//             x end (TERM) · K force end (KILL) · X end the tree under it
//   terminal  enter go to it · f open its folder · space fold ·
//   tab space t go to it · space fold · x end what runs in it
//   port      enter open in a web pane · d open in Databases (a database's
//             port, when the Databases mod is installed) · p copy the port ·
//             c copy the address · t go to its terminal · x end the process
//             that holds it
//
// The ends ask in the deck first, as x always has (the menu's entry, then
// enter on the band). A shielded process (logic.ts guardOf) has no end.
// "What runs in" a terminal: what its shell started, or the program itself
// where the terminal runs one directly (an agent).

import type { Context } from "gpui-kit";
import { appHome, exec, focused, openOverlay, panes, run, shared } from "herdr";
import type { Index, ProcNode, Row, TreeNode } from "./logic.ts";
import { guardOf, targets, terminalOf } from "./logic.ts";
import type { Item, PortItem } from "./state.ts";
import { byPid, procOf, termPids } from "./listing.ts";
import { begin, copyRow, foldRow, openPortAt, say, showTerminal } from "./actions.ts";
import type { default as ProcsDeck } from "./main.ts";

/** What an entry does. */
export type MenuAct = "go" | "folder" | "pid" | "cmd" | "fold" | "end" | "kill" | "tree" | "end-in" | "open" | "port" | "address" | "db";

/** A menu entry: its key (shown beside it, and pressed in or out of the menu), its words, what it does. */
export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly act: MenuAct;
  readonly danger?: boolean;
}

/** A place in the deck, in layout px from its top left. */
export interface At {
  readonly x: number;
  readonly y: number;
}

/** The open menu: its row, its entries, where it hangs (deck px; `above`: where its foot sits
 *  when it opens upward, too low in the deck to open down), the entry under the cursor. */
export interface Menu {
  readonly key: string;
  readonly entries: readonly MenuEntry[];
  readonly at: At;
  readonly above: number;
  n: number;
}

/** The shells a terminal runs: what runs in one is what the shell started. */
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "elvish", "tcsh", "csh", "ksh", "xonsh", "pwsh"]);

const isShell = (name: string | undefined): boolean => SHELLS.has((name ?? "").replace(/^-/, ""));

/** The terminals under a node (itself, a tab's, a space's). */
export function termsUnder(node: TreeNode): TreeNode[] {
  if (node.kind === "term") return [node];

  if (node.kind === "proc") return [];

  return node.kids.flatMap((k) => termsUnder(k));
}

/** What runs in a terminal, tab or space, as pids to end: in each terminal, what its shell
 *  started (each with what's under it), or the program itself where it runs one directly;
 *  never a shielded process. */
export function runningIn(node: TreeNode, ix: Pick<Index, "byPid" | "kids">, me: string | null): number[] {
  const out: number[] = [];

  const add = (pids: readonly number[]): void => {
    for (const p of pids) if (!out.includes(p)) out.push(p);
  };

  for (const term of termsUnder(node)) {
    const top: ProcNode | undefined = term.kind === "term" ? term.kids[0] : undefined;

    if (!top) continue;

    const roots = isShell(ix.byPid.get(top.pid)?.name) ? top.kids.map((k) => k.pid) : [top.pid];

    for (const pid of roots) add(targets(pid, { tree: true, byPid: ix.byPid, kids: ix.kids, me }));
  }

  return out;
}

/** Where a row's "go to" goes: a terminal's address, a tab's or space's id; null: nowhere here. */
export function goal(v: ProcsDeck, item: Item): { readonly terminal: string } | { readonly tab: string } | { readonly space: string } | null {
  const shown = (addr: string | null): { terminal: string } | null => (addr && panes().some((p) => p.terminal === addr) ? { terminal: addr } : null);

  if ("port" in item) return shown(item.term);

  const n = item.node;

  if (n.kind === "proc") return shown(terminalOf(n.pid, byPid(v), termPids()));

  if (n.kind === "term") return shown(n.address);

  if (n.kind === "tab") return { tab: n.key.slice(2) };

  return n.machine || n.key === "s:~" ? null : { space: n.key.slice(2) };
}

const entry = (key: string, label: string, act: MenuAct, danger = false): MenuEntry => ({ key, label, act, danger });

/** A port row's entries. */
function portEntries(v: ProcsDeck, x: PortItem): MenuEntry[] {
  return [entry("enter", "open in a web pane", "open"), ...(v.dbMod && dbKind(x) ? [entry("d", "open in Databases", "db")] : []),
    entry("p", "copy the port", "port"), entry("c", "copy the address", "address"),
    ...(goal(v, x) ? [entry("t", "go to its terminal", "go")] : []),
    ...(x.guard ? [] : [entry("x", "end the process that holds it", "end", true)])];
}

/** A process row's entries. */
function procEntries(v: ProcsDeck, r: Row, n: ProcNode): MenuEntry[] {
  const p = procOf(v, n.pid);
  const guard = guardOf(p, v.snap?.me);

  return [...(goal(v, r) ? [entry("enter", "go to its terminal", "go")] : []),
    entry("f", "open its folder", "folder"), entry("p", "copy pid", "pid"), entry("c", "copy command line", "cmd"),
    ...(r.open === null ? [] : [entry("space", r.open ? "fold its children" : "unfold its children", "fold")]),
    ...(guard ? [] : [entry("x", "end (TERM)", "end", true), entry("K", "force end (KILL)", "kill", true)]),
    ...(guard || !n.kids.length ? [] : [entry("X", "end the tree under it", "tree", true)])];
}

/** The menu's entries for a row. */
export function menuEntries(v: ProcsDeck, item: Item): MenuEntry[] {
  if ("port" in item) return portEntries(v, item);

  const n = item.node;

  if (n.kind === "proc") return procEntries(v, item, n);

  const ends = v.ix && v.snap && runningIn(n, v.ix, v.snap.me).length > 0;

  return [...(goal(v, item) ? [entry(n.kind === "term" ? "enter" : "t", "go to it", "go")] : []),
    ...(n.kind === "term" && n.cwd ? [entry("f", "open its folder", "folder")] : []),
    ...(item.open === null ? [] : [entry("space", item.open ? "fold" : "unfold", "fold")]),
    ...(ends ? [entry("x", "end what runs in it", "end-in", true)] : [])];
}

/** The pid a row stands for: a process's, a port's holder; null for a group. */
const pidOf = (item: Item): number | null => ("port" in item ? item.pid : item.node.kind === "proc" ? item.node.pid : null);

/** Its row's "go to": a terminal's pane, a tab, a space; the deck closes. */
export function goTo(v: ProcsDeck, item: Item): void {
  const g = goal(v, item);

  if (!g) {
    if (!("port" in item)) showTerminal(v, item);
    else say(v, "not in one of this app's terminals", "dim");

    return;
  }

  if ("terminal" in g) run("pane.focus", { terminal: g.terminal });
  else if ("tab" in g) run("tab.select", { id: g.tab });
  else run("space.select", { id: g.space });

  v.dismissDeck();
}

/** A process's working folder (lsof's cwd), or null. */
export async function cwdOf(pid: number): Promise<string | null> {
  const r = await exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { timeout: 5000 }).catch(() => null);
  const line = (r?.stdout ?? "").split("\n").find((l) => l.startsWith("n/"));

  return line ? line.slice(1) : null;
}

/** Its folder in a files pane beside the focused pane (`files.open`); the deck closes. */
export function openFolder(v: ProcsDeck, item: Item, cx: Context): void {
  const n = "port" in item ? null : item.node;

  const at = (path: string): void => {
    const pane = focused()?.pane;

    run("files.open", pane ? { path, pane } : { path });
    v.dismissDeck();
  };

  if (n?.kind === "term") {
    if (n.cwd) at(n.cwd);

    return;
  }

  const pid = pidOf(item);

  if (pid === null) return;

  cx.spawn(async (cx) => {
    const path = await cwdOf(pid);

    if (path) at(path);
    else say(v, `${procOf(v, pid)?.name ?? pid}: its folder can't be read`, "dim");

    cx.notify();
  });
}

/** p: the pid, a port's number. */
export function copyNumber(v: ProcsDeck, item: Item, cx: Context): void {
  const text = "port" in item ? String(item.port) : item.node.kind === "proc" ? String(item.node.pid) : null;

  if (!text) return;

  cx.write_to_clipboard(text);
  say(v, `copied ${text}`);
}

/** x on a terminal, tab or space: ask before ending what runs in it. */
export function beginIn(v: ProcsDeck, item: Item): void {
  if ("port" in item || item.node.kind === "proc" || !v.ix || !v.snap) return;

  const pids = runningIn(item.node, v.ix, v.snap.me);
  const first = pids[0];

  if (first === undefined) {
    say(v, `nothing runs in ${item.node.kind === "term" ? item.node.address : item.node.name} but its shell`, "dim");

    return;
  }

  const names = [...new Set(pids.map((p) => procOf(v, p)?.name ?? String(p)))];
  const where = item.node.kind === "term" ? item.node.address : item.node.name;
  const ports = v.snap.ports.flatMap((x) => (pids.includes(x.pid) ? [x.port] : []));
  const list = names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ");

  v.ask = { pids, key: item.key, tab: v.tab, tree: true, phase: "ask", left: [], name: `what runs in ${where}`, pid: first,
    ports: [...new Set(ports)], what: `what runs in ${where} (${list})` };
}

/** An entry's act on its row. */
export function runAct(v: ProcsDeck, act: MenuAct, item: Item, items: readonly Item[], cx: Context): void {
  const i = items.indexOf(item);

  switch (act) {
    case "go": goTo(v, item); break;
    case "folder": openFolder(v, item, cx); break;
    case "pid": case "port": copyNumber(v, item, cx); break;
    case "cmd": case "address": copyRow(v, item, cx); break;
    case "fold": foldRow(v, items, i, null); break;
    case "end": begin(v, item, false); break;
    case "kill": begin(v, item, false, true); break;
    case "tree": begin(v, item, true); break;
    case "end-in": beginIn(v, item); break;
    case "open": openPortAt(v, item); break;
    case "db": if ("port" in item) openDatabase(v, item); break;
  }
}

// ---- a database's port, in the Databases mod (its contract: nocturne.databases / its window's props.connect)

/** The Databases mod's kinds the deck can tell from a port. */
export type DbKind = "postgres" | "mysql" | "libsql";

/** A port that looks like a database's: postgres (5432, a postgres process), mysql (3306,
 *  mysqld or mariadbd), libsql (a sqld or libsql server); else null. */
export function dbKind(x: Pick<PortItem, "port" | "name">): DbKind | null {
  const n = x.name.toLowerCase();

  if (x.port === 5432 || /^postgres|^postmaster/.test(n)) return "postgres";

  if (x.port === 3306 || /^(mysqld|mariadbd|mariadb)$/.test(n)) return "mysql";

  if (/^(sqld|libsql|libsql-server)$/.test(n)) return "libsql";

  return null;
}

/** Where the Databases mod lives when it's installed: the deck offers its entry only then. */
export const dbModPath = (): string => `${appHome()}/mods/databases/mod.json`;

/** What the Databases window opens on (the Databases mod's contract; no secret: it asks for the password). */
export interface DbConnect {
  readonly kind: DbKind | "sqlite";
  readonly name?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
  readonly path?: string;
  readonly url?: string;
  readonly readonly?: boolean;
  readonly from?: string;
}

/** What the Databases window opens on for a port. */
export function dbArgs(x: PortItem): DbConnect | null {
  const kind = dbKind(x);

  if (!kind) return null;

  const from = `port :${x.port} (${x.name}${x.where ? ` in ${x.where}` : ""})`;
  const base: DbConnect = { kind, name: `${x.name} :${x.port}`, host: "127.0.0.1", port: x.port, from };

  return kind === "libsql" ? { ...base, url: `http://127.0.0.1:${x.port}` } : base;
}

/** d on a database's port: the Databases window on it (nocturne.databases in the nocturne
 *  layout, else its window as an overlay); the deck closes. */
export function openDatabase(v: ProcsDeck, x: PortItem): void {
  const args = dbArgs(x);

  if (!args || !v.dbMod) return;

  if (shared("layout") === "nocturne") run(`nocturne.databases:${JSON.stringify(args)}`);
  else openOverlay({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { connect: args } });

  v.dismissDeck();
}
