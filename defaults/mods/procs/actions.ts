// What the process deck does: end a process (asks first; X takes what's
// under it, K kills what held on), copy, open a port, show a terminal, fold,
// switch tabs, all of yours or this app's, esc.

import type { Context, Modifiers } from "gpui-kit";
import { exec, focused, panes, run, setShared } from "herdr";
import { writeShared } from "./guard.ts";
import type { PortCol, ProcCol, Sorts } from "./sort.ts";
import { PORT_COLS, PROC_COLS, SORT, clickSort, stepSort, turnSort } from "./sort.ts";
import type { Row } from "./logic.ts";
import { targets, guardOf, endGently, signal, address, terminalOf, openPort } from "./logic.ts";
import type { Tab, Note, Item, Ask } from "./state.ts";
import { GRACE, TABS, printable } from "./state.ts";
import { byPid, moveTo, procOf, termPids } from "./listing.ts";
import type { default as ProcsDeck } from "./main.ts";

export function say(v: ProcsDeck, text: string, tone: Note["tone"] = "done"): void {
  v.note = { text, tone, until: Date.now() + 3000 };
}

/** x / X / K: ask before ending the cursor's process (with what's under it; `force`: KILL at
 *  once), or a port's. */
export function begin(v: ProcsDeck, item: Item | undefined, tree: boolean, force = false): void {
  const snap = v.snap;

  if (!item || !snap) return;

  const pid = "port" in item ? item.pid : item.node.kind === "proc" ? item.node.pid : null;

  if (pid === null) {
    say(v, "a process ends, not a group: move onto one", "dim");

    return;
  }

  const p = procOf(v, pid);

  // A port's process that started after ps ran (lsof runs after it): nothing to end yet.
  if (!p) {
    say(v, `${"port" in item ? item.name : ""} (${pid}): not in the last reading, r reads again`, "dim");

    return;
  }

  const why = guardOf(p, snap.me);

  if (why) {
    say(v, `${p.name}: ${why}, not ended from here`, "dim");

    return;
  }

  const pids = targets(pid, { tree, byPid: byPid(v), kids: v.ix?.kids ?? new Map(), me: snap.me });
  const ports = snap.ports.flatMap((x) => (pids.includes(x.pid) ? [x.port] : []));

  v.ask = { pids, key: item.key, tab: v.tab, tree, force, phase: "ask", left: [], name: p.name, pid, ports: [...new Set(ports)] };
}

/** enter on the band: TERM, the grace, then KILL is offered for the ones left; a force end
 *  KILLs at once. */
export function confirm(v: ProcsDeck, cx: Context): void {
  const a = v.ask;

  if (!a || a.phase !== "ask") return;

  if (a.force) {
    v.ask = null;
    void signal(a.pids, "KILL", exec).then(() => {
      say(v, `killed ${a.name}`);
      v.refresh(cx);
      cx.notify();
    });

    return;
  }

  a.phase = "ending";
  cx.spawn(async (cx) => {
    const left = await endGently(a.pids, { exec, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())), grace: GRACE });

    if (v.ask !== a) return;

    if (left.length) {
      a.phase = "held";
      a.left = left;
    } else {
      v.ask = null;
      say(v, a.pids.length > 1 ? `ended ${a.name} and ${a.pids.length - 1} under it` : `ended ${a.name}`);
    }

    v.refresh(cx);
    cx.notify();
  });
}

/** K on a band that held on: KILL them. */
export function killHard(v: ProcsDeck, cx: Context): void {
  const a = v.ask;

  if (!a || a.phase !== "held") return;

  void signal(a.left, "KILL", exec).then(() => {
    say(v, `killed ${a.left.length > 1 ? `${a.left.length} processes` : a.name}`);
    v.refresh(cx);
    cx.notify();
  });
  v.ask = null;
}

/** c: the port's address, or a process's command line. */
export function copyRow(v: ProcsDeck, item: Item | undefined, cx: Context): void {
  let text: string | null = null;

  if (!item) return;

  if ("port" in item) text = v.tab === "ports" ? address(item.port) : null;
  else if (item.node.kind === "proc") text = procOf(v, item.node.pid)?.cmd ?? null;
  else if (item.node.kind === "term") text = item.node.address;

  if (!text) return;

  cx.write_to_clipboard(text);
  say(v, `copied ${text.length > 48 ? `${text.slice(0, 47)}…` : text}`);
}

/** o / enter on a port: a web pane on it; the deck closes. */
export function openPortAt(v: ProcsDeck, item: Item | undefined): void {
  if (!item || !("port" in item)) return;

  openPort(item.port, { panes: panes(), focused: focused(), run });
  v.dismissDeck();
}

/** enter on a process or terminal: its terminal's pane, focused; the deck closes. */
export function showTerminal(v: ProcsDeck, item: Row): void {
  const n = item.node;
  const addr = n.kind === "term" ? n.address : n.kind === "proc" ? terminalOf(n.pid, byPid(v), termPids()) : null;

  if (!addr) {
    say(v, "not in one of this app's terminals", "dim");

    return;
  }

  if (!panes().some((p) => p.terminal === addr)) {
    say(v, `${addr} has no pane`, "dim");

    return;
  }

  run("pane.focus", { terminal: addr });
  v.dismissDeck();
}

/** h / l: fold or unfold the cursor's row, else step to its parent / first child. */
export function foldRow(v: ProcsDeck, items: readonly Item[], i: number, open: boolean | null): void {
  const r = items[i];

  if (!r || "port" in r || v.tab !== "procs") return;

  if (open === null) {
    if (r.open !== null) v.folds.set(r.key, r.open);

    return;
  }

  if (open) {
    if (r.open === false) v.folds.set(r.key, false);
    else if (r.open && items[i + 1]) moveTo(v, items, i + 1);

    return;
  }

  if (r.open) {
    v.folds.set(r.key, true);

    return;
  }

  for (let j = i - 1; j >= 0; j--) {
    const up = items[j];

    if (up && !("port" in up) && up.depth < r.depth) {
      moveTo(v, items, j);

      return;
    }
  }
}

export function switchTab(v: ProcsDeck, to: Tab | undefined, cx: Context | null = null): void {
  v.tab = to ?? TABS[(TABS.indexOf(v.tab) + 1) % TABS.length] ?? "procs";
  v.ask = null;
  v.follow = true;
  v.beat();

  if (cx) v.tick(cx);
}

/** a, or a click on "fireflies" / "all of …": this app's terminals or every process of yours. */
export function toggleAll(v: ProcsDeck): void {
  v.all = !v.all;
  v.cur.procs = { key: v.cur.procs.key, at: 0 };
  v.follow = true;
}

/** enter, or a double click: a port opens, a process or terminal shows its pane, a group folds. */
export function activate(v: ProcsDeck, items: readonly Item[], i: number): void {
  const item = items[i];

  if (!item) return;

  if ("port" in item) {
    if (v.tab === "ports") openPortAt(v, item);

    return;
  }

  if (item.kind === "proc" || item.kind === "term") {
    showTerminal(v, item);

    return;
  }

  foldRow(v, items, i, null);
}

export function escapeKey(v: ProcsDeck, cx: Context): void {
  if (v.menu) v.menu = null;
  else if (v.help) v.help = false;
  else if (v.ask) v.ask = null;
  else if (v.typing && v.query) v.query = "";
  else if (v.typing) v.typing = false;
  else if (v.query) v.query = "";
  else {
    v.dismissDeck();

    return;
  }

  cx.notify();
}

/** A key while the question is up: y / enter ends it (TERM), K or enter kills
 *  what held on (-9), n or q lets it be. */
export function askKey(v: ProcsDeck, a: Ask, k: string, m: Modifiers, cx: Context): void {
  if (a.phase === "ask" && (k === "enter" || k === "y")) confirm(v, cx);
  else if (a.phase === "held" && ((k === "k" && m.shift) || k === "enter")) killHard(v, cx);
  else if (k === "n" || k === "q") v.ask = null;
}

/** A key while the find line types: backspace, enter ends it, printable text
 *  goes in. True when it was used. */
export function findKey(v: ProcsDeck, k: string, ch: string): boolean {
  if (k === "backspace") v.query = [...v.query].slice(0, -1).join("");
  else if (k === "enter") v.typing = false;
  else if (ch.length && printable(ch)) v.query += ch;
  else return false;

  return true;
}

// ---- sorting (sort.ts)

/** The sorts changed: the cursor follows its row into sight, and they're kept for the next open. */
function setSorts(v: ProcsDeck, next: Sorts): void {
  v.sorts = next;
  v.follow = true;
  writeShared(setShared, SORT, next);
}

/** A click on a process column's head: by it, or the other way. */
export function sortProcsBy(v: ProcsDeck, col: ProcCol): void {
  setSorts(v, { ...v.sorts, procs: clickSort(v.sorts.procs, col) });
}

/** A click on a port column's head. */
export function sortPortsBy(v: ProcsDeck, col: PortCol): void {
  setSorts(v, { ...v.sorts, ports: clickSort(v.sorts.ports, col) });
}

/** s: the shown tab's next column (after the last, no sort); S: the other way. */
export function sortKey(v: ProcsDeck, turn: boolean): void {
  if (v.tab === "ports") setSorts(v, { ...v.sorts, ports: turn ? turnSort(v.sorts.ports) : stepSort(v.sorts.ports, PORT_COLS) });
  else setSorts(v, { ...v.sorts, procs: turn ? turnSort(v.sorts.procs) : stepSort(v.sorts.procs, PROC_COLS) });
}

/** v: the processes as a tree or one flat list (while a number column sorts). */
export function toggleFlat(v: ProcsDeck): void {
  setSorts(v, { ...v.sorts, flat: !v.sorts.flat });
}
