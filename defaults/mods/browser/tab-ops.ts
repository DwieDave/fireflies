// What the tabs do: open, show, close, move by key or drag, and the shown
// tab's view going quiet while another shows.

import type { Context, Point } from "gpui-kit";
import { shared, setShared, run } from "herdr";
import { readSharedList, writeShared } from "./guard.ts";
import * as Tabs from "./tabs.ts";
import type { Gap, Tab } from "./tabs.ts";
import { saveTabs } from "./publish.ts";
import { inspectorPane } from "./inspector.ts";
import type Browser from "./main.ts";

/** A new tab on `url` (null: blank, its address open). In front unless
 *  `background`; `opener`: the tab whose link opened it. */
export function openTab(view: Browser, url: string | null, { background = false, opener = null }: Tabs.OpenOptions, cx?: Context): Tab {
  const before = view.tabs.active;
  const [next, tab] = Tabs.open(view.tabs, url, { background, opener });

  view.tabs = next;

  if (background) saveTabs(view);
  else shownTab(view, before, cx);

  return tab;
}

/** Shows tab `id` (a click, a key, a command). */
export function showTab(view: Browser, id: string | null, cx?: Context) {
  // A tab closed under the click (its ×): nothing to show.
  if (!id || id === view.tabs.active || !view.tabs.list.some((t) => t.id === id)) return;

  const before = view.tabs.active;

  view.tabs = Tabs.show(view.tabs, id);
  shownTab(view, before, cx);
}

/** After another tab came to the front: the one before steps aside, the
 *  address follows (a blank tab: its field takes the keyboard). */
export function shownTab(view: Browser, before: string | null, cx?: Context) {
  if (before) view.quiet(before, "setVisible", { visible: false });

  view.tab.live = true;
  view.quiet(view.tab.id, "setVisible", { visible: true });
  view.editing = !view.start;

  if (view.editing) {
    const input = view.input;

    input?.set_value("");
    cx?.timer.after(50, () => input?.focus());
  }

  saveTabs(view);
}

/** Closes tab `id` (the shown one by default): its view goes, and its
 *  inspector pane. The last tab leaves a blank one: the pane stays. */
export function closeTab(view: Browser, id: string | null, cx?: Context) {
  const tab = view.tabs.list.find((t) => t.id === (id ?? view.tabs.active));

  if (!tab) return;

  const pane = tab.of ? inspectorPane(view, tab.of) : null;

  if (pane) run("pane.close", { pane });

  if (tab.live) view.quiet(tab.id, "dispose");

  // Its pin on the shelf goes with it.
  const pins = view.ownSlot ? Tabs.dropTabPins(readSharedList(shared, Tabs.PINS_LIST), view.slot, tab.id) : null;

  if (pins) writeShared(setShared, Tabs.PINS_KEY, pins);

  const was = view.tabs.active;

  [view.tabs] = Tabs.close(view.tabs, tab.id);

  if (view.tabs.active !== was) shownTab(view, null, cx);
  else saveTabs(view);
}

/** Tab `id` to place `index` (Tabs.move), kept for the next start. */
export function moveTab(view: Browser, id: string, index: number) {
  const next = Tabs.move(view.tabs, id, index);

  if (next === view.tabs) return;

  view.tabs = next;
  saveTabs(view);
}

/** Tab `id` one place left (-1) or right (+1); at the end it stays. */
export function stepTab(view: Browser, id: string, by: number) {
  const i = Tabs.indexOf(view.tabs, id);

  if (i < 0 || i + by < 0 || i + by >= view.tabs.list.length) return;

  moveTab(view, id, i + by);
}

// ---- dragging a tab along the strip (Tabs.dropIndex)

/** The tab the bar's tab keys act on: the one the ring is on, else the shown one. */
export function keyTab(view: Browser): string {
  const ringed = view.ring?.startsWith("tab:") ? view.ring.slice(4) : null;

  return ringed && view.tabs.list.some((t) => t.id === ringed) ? ringed : view.tabs.active;
}

/** The pointer moved over a gap with a press down on a tab: past
 *  DRAG_START it's a drag, and the gap it's over is where the marker stands. */
export function dragOver(view: Browser, gap: Gap, at: Point, cx: Context) {
  const p = view.pressed;

  if (!p) return;

  if (!view.drag) {
    if (Math.abs(at.x - p.x) < Tabs.DRAG_START) return;

    view.drag = { id: p.id, gap: null };
  }

  if (view.drag.gap?.id === gap.id && view.drag.gap.after === gap.after) return;

  view.drag.gap = gap;
  cx.notify();
}

/** The press let go in the strip: a drag drops where its marker stands. */
export function dropTab(view: Browser, cx: Context) {
  const d = view.drag;

  view.drag = null;
  view.pressed = null;

  if (!d) return;

  const at = Tabs.dropIndex(view.tabs, d.id, d.gap);

  if (at !== null) moveTab(view, d.id, at);

  cx.notify();
}

/** The pointer left the strip: the drag ends where it started. */
export function cancelDrag(view: Browser, cx: Context) {
  const dragging = Boolean(view.drag);

  view.drag = null;
  view.pressed = null;

  if (dragging) cx.notify();
}
