// The files pane's preview split: the viewer mounted beside the tree, on and
// off, kept per slot, following the selection after it rests, a folder's look,
// its scroll and size.

import type { Context } from "gpui-kit";
import { shared, setShared } from "herdr";
import { readSharedMap, writeSharedMap } from "./guard.ts";
import type { Entry, LookState } from "./logic.ts";
import { lookSide, clampShare, LOOK_STEP, join, cleanError, lookSize } from "./logic.ts";
import Viewer from "./viewer.ts";
import type { ViewerProps } from "./viewer.ts";
import type { LookTarget, Geo } from "./state.ts";
import { LOOK, directory, byName, messageOf, REST } from "./state.ts";
import { keptFor, rowAt } from "./tree.ts";
import type { default as Files } from "./main.ts";

/** The viewer (the preview pane's, viewer.ts), made once: a nested view, so
 *  its reading and drawing redraw only it, never the tree. */
export function mountLook(v: Files, cx: Context): void {
  if (!v.look) v.look = cx.new(Viewer, v.lookProps);
}

/** space, the toolbar's switch, the menu's entry: the split on or off. */
export function toggleLook(v: Files, cx: Context): void {
  const on = !v.lookState.on;

  saveLook(v, { ...v.lookState, on });
  v.lookAt = null;
  v.lookDir = null;

  if (on) mountLook(v, cx);
  else {
    v.natives("dispose");
    setLook(v, { ...v.lookProps, path: null });
  }

  cx.notify();
}

/** Keeps this pane's split (on, shares) by slot, as its filters; panes that are gone drop out. */
export function saveLook(v: Files, next: LookState): void {
  v.lookState = next;

  if (!v.slot) return;

  writeSharedMap(setShared, LOOK, keptFor(v, readSharedMap(shared, LOOK), v.slot, next));
}

/** New props for the viewer (it applies them on its next render). */
export function setLook(v: Files, next: ViewerProps): void {
  v.lookProps = next;
  v.look?.set_props(next);
}

/** What the preview shows: the selected row, else the root. */
export function lookTarget(v: Files): LookTarget {
  const row = rowAt(v, v.sel);

  if (!row) return { abs: v.root, rel: "", dir: true };

  return { abs: join(v.root, row.path), rel: row.path, dir: Boolean(row.dir || row.head) };
}

/** From render: once the selection rests REST ms on a row, the preview
 *  shows it. Stepping on cancels the wait, so only the row rested on loads. */
export function followSelection(v: Files, cx: Context): void {
  const target = lookTarget(v);
  const key = `${target.dir ? "d" : "f"}:${target.abs}`;

  if (key === v.lookAt) return;

  v.lookAt = key;
  cx.timer.after(REST, (cx) => {
    if (v.lookAt === key && v.lookState.on) {
      showLook(v, target, cx);
      cx.notify();
    }
  });
}

/** A file to the viewer; a folder: its summary, drawn here (the viewer lets go of what it showed). */
export function showLook(v: Files, target: LookTarget, cx: Context): void {
  if (!target.dir) {
    v.lookDir = null;
    setLook(v, { ...v.lookProps, path: target.abs, on: v.on });

    return;
  }

  v.natives("dispose");
  setLook(v, { ...v.lookProps, path: null });

  const listed = v.entries.get(target.rel);

  v.lookDir = { abs: target.abs, rel: target.rel, entries: listed ?? null, error: null };

  if (listed) return;

  cx.spawn(async (cx) => {
    let entries: Entry[] | null = null;
    let error: string | null = null;

    try {
      entries = (await directory(target.abs, v.on)).sort(byName);
    } catch (cause: unknown) {
      error = cleanError(messageOf(cause));
    }

    if (v.lookDir?.abs !== target.abs) return;

    v.lookDir = { abs: target.abs, rel: target.rel, entries, error };
    cx.notify();
  });
}

/** The folder changed on disk: the preview reads its file again (unchanged ones stay as they are). */
export function reloadLook(v: Files): void {
  if (v.lookState.on && v.lookProps.path) setLook(v, { ...v.lookProps, reload: ++v.lookN });
}

/** J / K: the preview scrolls, the keyboard stays in the tree. */
export function scrollLookBy(v: Files, dir: number): void {
  if (v.lookState.on && v.lookProps.path) setLook(v, { ...v.lookProps, scroll: { n: ++v.lookN, dir } });
}

/** < / >: the preview smaller or bigger, both parts keeping their least. */
export function resizeLook(v: Files, dir: number): void {
  if (!v.lookState.on) return;

  const side = v.side ?? lookSide(v.size);
  const f = clampShare(v.size, side, v.lookState[side] + dir * LOOK_STEP);

  if (f !== null) saveLook(v, side === "right" ? { ...v.lookState, right: f } : { ...v.lookState, bottom: f });
}

/** Where the preview split goes now (logic.ts lookSide, lookSize), the viewer following
*  the selection; a native view set aside while the menu is open. */
export function placeLook(v: Files, cx: Context): Geo {
  // The preview split: its side follows the pane's shape; no room for both parts, no split.
  const side = v.lookState.on && v.look ? lookSide(v.size, v.side) : null;

  if (side) v.side = side;

  const px = side ? lookSize(v.size, side, v.dragged ?? v.lookState[side]) : null;

  if (px !== null) followSelection(v, cx);

  v.geo = { side, px };

  // A native view (PDF, clip, font) would cover the menu: set aside while it's open.
  const aside = Boolean(v.menu) && px !== null;

  if (aside !== v.aside) {
    v.aside = aside;
    cx.timer.after(0, () => v.natives("setVisible", { visible: !aside }));
  }


  return { side, px };
}
