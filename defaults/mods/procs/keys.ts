// The process deck's keys: onKey's order (? keys, esc, the menu, the
// question, moving, tabs, the find line) and the plain keys a row takes.
// Every one is listed in ? (state.ts deckKeys).

import type { Context, KeyEvent, Modifiers } from "gpui-kit";
import { keysKey } from "./keyhelp.ts";
import type { Item } from "./state.ts";
import { PROW, ROW, TABS } from "./state.ts";
import { moveTo } from "./listing.ts";
import { activate, askKey, begin, copyRow, escapeKey, findKey, foldRow, openPortAt, sortKey, switchTab, toggleAll, toggleFlat } from "./actions.ts";
import { beginIn, copyNumber, goTo, openDatabase, openFolder } from "./menu.ts";
import { menuKey, openMenu } from "./menu-view.ts";
import type { default as ProcsDeck } from "./main.ts";

/** What a plain key did: "done" (draw again), "gone" (the deck closed or handed off), or null (not ours). */
type Took = "done" | "gone" | null;

/** x: a process's or a port's end; a terminal, tab or space: what runs in it. */
function endKey(v: ProcsDeck, item: Item | undefined, tree: boolean): void {
  if (item && !("port" in item) && item.node.kind !== "proc") beginIn(v, item);
  else begin(v, item, tree);
}

/** The keys that act on the cursor's row. */
function rowKey(v: ProcsDeck, k: string, m: Modifiers, items: readonly Item[], i: number, cx: Context): Took {
  const item = items[i];

  if (k === "x") endKey(v, item, m.shift);
  else if (k === "k" && m.shift) begin(v, item, false, true);
  else if (k === "c") copyRow(v, item, cx);
  else if (k === "p" && item) copyNumber(v, item, cx);
  else if (k === "m") openMenu(v, items, i, { x: 40, y: v.selY }, v.selY - (v.tab === "ports" ? PROW : ROW));
  else if (k === "enter") activate(v, items, i);
  else if (k === "o" && v.tab === "ports") {
    openPortAt(v, item);

    return "gone";
  } else if (k === "d" && item && "port" in item) {
    openDatabase(v, item);

    return "gone";
  } else if (k === "t" && item) {
    goTo(v, item);

    return "gone";
  } else if (k === "f" && item) openFolder(v, item, cx);
  else return null;

  return "done";
}

/** The keys outside the find line: moving, folding, tabs, the row's acts, the deck's own. */
function plainKey(v: ProcsDeck, k: string, ch: string, m: Modifiers, cx: Context): Took {
  const items = v.list();
  const i = v.at(items);

  if (k === "j") moveTo(v, items, i + 1);
  else if (k === "k" && !m.shift) moveTo(v, items, i - 1);
  else if (k === "end" || (k === "g" && m.shift)) moveTo(v, items, items.length - 1);
  else if (k === "home" || k === "g") moveTo(v, items, 0);
  else if (k === "h" || k === "left") foldRow(v, items, i, false);
  else if (k === "l" || k === "right") foldRow(v, items, i, true);
  else if (k === "space" || ch === " ") foldRow(v, items, i, null);
  else if (k === "1") switchTab(v, "procs", cx);
  else if (k === "2") switchTab(v, "ports", cx);
  else if (k === "a") toggleAll(v);
  else if (k === "s") sortKey(v, m.shift);
  else if (k === "v" && v.tab === "procs") toggleFlat(v);
  else if (k === "r") v.refresh(cx);
  else if (k === "q") {
    v.dismissDeck();

    return "gone";
  } else if (ch === "?") v.help = true;
  else if (ch === "/" || k === "/") v.typing = true;
  else return rowKey(v, k, m, items, i, cx);

  return "done";
}

/** The keys that work whatever's typed: the arrows, a page, tab. */
function moveKey(v: ProcsDeck, k: string, m: Modifiers, cx: Context): boolean {
  const items = v.list();
  const i = v.at(items);
  const page = Math.max(1, Math.floor(v.listH() / (v.tab === "ports" ? PROW : ROW)) - 1);

  if (k === "down" || k === "up") moveTo(v, items, i + (k === "down" ? 1 : -1));
  else if (k === "pagedown" || k === "pageup") moveTo(v, items, i + (k === "pagedown" ? page : -page));
  else if (k === "tab") switchTab(v, m.shift ? TABS[(TABS.indexOf(v.tab) + TABS.length - 1) % TABS.length] : undefined, cx);
  else return false;

  return true;
}

/** A key in the deck. */
export function deckKey(v: ProcsDeck, e: KeyEvent, cx: Context): void {
  const m = e.modifiers;
  const k = e.key.toLowerCase();
  const ch = e.key_char ?? "";

  const done = (): void => {
    v.follow = true;
    cx.stop_propagation();
    cx.notify();
  };

  if (m.platform || m.control || m.alt) return;

  if (v.help) {
    if (keysKey(e, true) || k === "enter") {
      v.help = false;
      done();
    }

    return;
  }

  if (v.menu) {
    menuKey(v, v.menu, e, cx);

    return;
  }

  if (k === "escape") {
    cx.stop_propagation();
    escapeKey(v, cx);

    return;
  }

  if (v.ask) {
    askKey(v, v.ask, k, m, cx);
    done();

    return;
  }

  if (moveKey(v, k, m, cx)) done();
  else if (v.typing) {
    if (findKey(v, k, ch)) done();
  } else {
    const took = plainKey(v, k, ch, m, cx);

    if (took === "gone") cx.stop_propagation();
    else if (took === "done") done();
  }
}
