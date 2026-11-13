// The Projects tab's keys (projects.ts's key hands them over): typing in
// the filter, a draft or a value; a card in hand; the detail; the board.

import type { Context, KeyEvent } from "gpui-kit";
import type { Board, Item } from "./board.ts";
import type { Dir, Layout } from "./board-layout.ts";
import { grid, step, pickUp, carry } from "./board-layout.ts";
import { itemUrl } from "./board-cards.ts";
import { menuKey, openConvert, openFields, openLimit, openProjects, openViews } from "./projects-menus.ts";
import { archive, dropCard } from "./projects-edits.ts";
import type { default as Projects } from "./projects.ts";

const DIRS = new Map<string, Dir>([
  ["h", "left"], ["left", "left"], ["l", "right"], ["right", "right"], ["k", "up"], ["up", "up"], ["j", "down"], ["down", "down"],
  ["g", "top"], ["home", "top"], ["G", "bottom"], ["end", "bottom"],
]);

/** Keys while this tab shows; true when one was used ("typing": an Input's). */
export function key(proj: Projects, k: string, e: KeyEvent, cx: Context): boolean | "typing" {
  if (proj.typing) return typingKey(proj, k);

  if (proj.menu) return menuKey(proj, proj.menu, k, e, cx);

  const b = proj.board(), lay = proj.lay(b);

  if (!b || !lay) {
    if (k === "p" && proj.list?.projects.length) {
      openProjects(proj);

      return true;
    }

    return false;
  }

  if (proj.carrying) return carryKey(proj, lay, k, cx);

  if (proj.focus === "detail" && detailKey(proj, k)) return true;

  return boardKey(proj, b, lay, k, cx);
}

/** A card in hand: the arrows carry it, enter / space / m drop it, esc puts it back; nothing else meanwhile. */
function carryKey(proj: Projects, lay: Layout, k: string, cx: Context): boolean {
  const dir = DIRS.get(k);

  if (dir) {
    proj.carrying = carry(grid(lay), proj.carrying, dir, { folded: proj.foldedCols(lay), sorted: lay.sorted });
    proj.follow(lay, proj.at(lay));
  } else if (k === "enter" || k === "space" || k === "m") dropCard(proj, cx);
  else if (k === "escape") proj.carrying = null;

  return true; // nothing else while a card is in hand
}

/** The open card's detail: j / k scroll it, h / tab go back to the board, esc closes it. */
function detailKey(proj: Projects, k: string): boolean {
  if (k === "j" || k === "down") {
    proj.scroll(60);

    return true;
  }

  if (k === "k" || k === "up") {
    proj.scroll(-60);

    return true;
  }

  if (k === "h" || k === "left" || k === "tab") {
    proj.focus = "board";

    return true;
  } // shift-tab too

  if (k === "escape") {
    proj.focus = "board";
    proj.detailOpen = false;

    return true;
  }

  return false;
}

/** The board's own keys: move, scroll, open, pick up, edit, add, filter, views, projects, links, fold. */
function boardKey(proj: Projects, b: Board, lay: Layout, k: string, cx: Context): boolean {
  const a = proj.at(lay), item = proj.current(lay);
  const dir = DIRS.get(k);

  if (dir) {
    const next = step(proj.grid(lay), a, dir, proj.foldedCols(lay));

    if (next) proj.select(lay, next, cx);
  } else if (k === "J" || k === "pagedown") proj.scroll(Math.max(80, proj.viewH / 2));
  else if (k === "K" || k === "pageup") proj.scroll(-Math.max(80, proj.viewH / 2));
  else if (k === "enter" && item) {
    if (proj.detailOpen && proj.focus === "board") proj.focus = "detail";
    else {
      proj.detailOpen = true;
      proj.focus = "board";
      proj.scrollY = 0;
      void proj.readDetail(item, cx);
    }
  } else if (k === "tab" && proj.detailOpen) proj.focus = "detail";
  else if (k === "escape" && proj.detailOpen) {
    proj.detailOpen = false;
    proj.focus = "board";
  } else if ((k === "space" || k === "m") && item) proj.carrying = pickUp(grid(lay), a);
  else if (k === "e" && item) openFields(proj, item, cx);
  else if (k === "a") {
    proj.typing = "draft";
    proj.draft.set_value("");
    proj.draft.focus();
  } else if (k === "/") {
    proj.typing = "filter";
    proj.filter.focus();
  } else if (k === "v") openViews(proj, b);
  else if (k === "p") openProjects(proj);
  else if (k === "o") {
    const url = item ? itemUrl(b, proj.view(b), item) : b.project.url;

    if (url) proj.app.openUrl(url, cx);
  } else if (k === "x" && item) archive(proj, item, cx);
  else if (k === "i" && item?.content.kind === "draft") openConvert(proj, b, item);
  else if (k === "-") toggleFold(proj, lay, a.col);
  else if (k === "z" && lay.lane) toggleLane(proj, lay, item);
  else if (k === "w" && lay.columns[a.col]) openLimit(proj, lay, a.col);
  else if (k === "escape" && proj.filterText) {
    proj.filter.set_value("");
    proj.filterText = "";
    proj.keepSel();
  } else return false;

  return true;
}

export function typingKey(proj: Projects, k: string): boolean | "typing" {
  if (k === "escape") {
    if (proj.typing === "filter" && !proj.filter.value()) proj.filterText = "";

    if (proj.typing === "draft") proj.draft.set_value("");

    if (proj.typing === "value") proj.menu = proj.menu?.kind === "value" ? proj.menu.back ?? null : null;

    proj.typing = null;
    proj.app.focusSelf();

    return true;
  }

  if (k === "enter") return "typing"; // the Input's submit does it

  if (proj.typing === "filter" && (k === "down" || k === "tab")) {
    proj.typing = null;
    proj.app.focusSelf();

    return true;
  }

  return "typing";
}

/** `key` in or out of a list of keys. */
export function flipped(proj: Projects, list: readonly string[] | undefined, key: string): string[] {
  const f = new Set(list ?? []);

  if (f.has(key)) f.delete(key);
  else f.add(key);

  return [...f];
}

export function toggleFold(proj: Projects, lay: Layout, col: number): void {
  const c = lay.columns[col], v = proj.view();

  if (!c || !v) return;

  proj.setLocal((l) => ({ ...l, folded: new Map(l.folded).set(v.id, flipped(proj, l.folded.get(v.id), c.key)) }));

  if (!c.folded) {
    const next = step(proj.grid(lay), { col, row: 0 }, "right", lay.columns.map((x, i) => x.folded || i === col));
    const now = proj.lay();

    if (next && now && next.col !== col) proj.select(now, next, null);
  }
}

export function toggleLane(proj: Projects, lay: Layout, item: Item | null): void {
  const v = proj.view();
  const lane = item ? lay.lanes.find((l) => l.cells.some((c) => c.some((i) => i.id === item.id))) : lay.lanes.find((l) => l.folded);
  const key = lane?.key;

  if (key === undefined || key === null || !v) return;

  proj.setLocal((l) => ({ ...l, lanes: new Map(l.lanes).set(v.id, flipped(proj, l.lanes.get(v.id), key)) }));
  proj.keepSel();
}
