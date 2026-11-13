// The viewer's keys and commands: the bar's, the kind's (a clip, a PDF, a
// picture, a table), the common ones, the wheel. Shared like viewer.ts.

import type { Context, KeyEvent, Modifiers, ScrollWheelEvent } from "gpui-kit";
import { zoomTo, panBy } from "./image.ts";
import { keyOf, cycle } from "./keys.ts";
import { keysKey } from "./keyhelp.ts";
import type { How } from "./viewer-state.ts";
import { unzoom, SEEK_FAR, SEEK, SHOVE, NUDGE, pointOf } from "./viewer-state.ts";
import { goTo, loadPath } from "./viewer-load.ts";
import { maxScroll } from "./viewer-text.ts";
import { rowKey, scrollBy } from "./viewer-table.ts";
import { actNative, mediaState } from "./viewer-native.ts";
import { actual, copyPath, current, fit, openInSystem, pageGo, panPicture, pannable, reveal, setView, turn, zoomBy } from "./viewer-pan.ts";
import type { default as Viewer } from "./viewer.ts";

/** tab / shift-tab, enter, esc: the bar's controls. */
export function barKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  if (k === "tab") v.ring = cycle(v.chips.map((c) => c.id), v.ring, m.shift ? -1 : 1);
  else if (k === "enter" && v.ring) {
    const c = v.chips.find((x) => x.id === v.ring);

    if (!c) {
      v.ring = null;

      return false;
    }

    c.action(cx);
  } else if (k === "escape" && v.ring) v.ring = null;
  else return false;

  return true;
}

/** Audio and video: play / pause, seek, sound. */
export function mediaKey(v: Viewer, k: string, m: Modifiers): boolean {
  const s = mediaState(v);
  const by = m.shift ? SEEK_FAR : SEEK;
  const length = s.duration ?? 0;
  const seek = (t: number): void => actNative(v, "media.seek", { time: Math.max(0, length > 0 ? Math.min(length, t) : t) });

  if (k === "space" || k === "k") actNative(v, (s.rate ?? 0) > 0 ? "media.pause" : "media.play");
  else if (k === "right" || k === "l" || k === "L") seek((s.time ?? 0) + by);
  else if (k === "left" || k === "h" || k === "H") seek((s.time ?? 0) - by);
  else if (k === "0" || k === "home") seek(0);
  else if (k === "m") actNative(v, "media.setMuted", { muted: !s.muted });
  else return false;

  return true;
}

/** A PDF in its native view: zoom, fit, pages. */
export function pdfKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  if (k === "+" || k === "=") zoomBy(v, 1, cx);
  else if (k === "-" || k === "_") zoomBy(v, -1, cx);
  else if (k === "0") fit(v, cx);
  else if (k === "right" || k === "l" || k === "pagedown" || k === "space") pageGo(v, "next", cx);
  else if (k === "left" || k === "h" || k === "pageup" || k === "backspace") pageGo(v, "prev", cx);
  else if (k === "g" && !m.shift) pageGo(v, 1, cx);
  else if (k === "G" || k === "g") pageGo(v, v.pdf?.pageCount ?? 1, cx);
  else return false;

  return true;
}

/** A picture, or a PDF page drawn as one: zoom, fit, pan, turn, step, the background. */
export function pictureKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  const pan = pannable(v);
  const paged = v.how?.how === "raster" && !v.how.firstOnly;
  const d = m.shift ? SHOVE : NUDGE;
  // Fitted, nothing to pan: ← → step through the folder (a PDF: its pages).
  const sideways = (dir: number): void => (paged ? pageGo(v, dir > 0 ? "next" : "prev", cx) : goTo(v, dir, cx));

  if (k === "+" || k === "=") zoomBy(v, 1, cx);
  else if (k === "-" || k === "_") zoomBy(v, -1, cx);
  else if (k === "0") fit(v, cx);
  else if (k === "1") actual(v, cx);
  else if (k === "pagedown" || k === "space") sideways(1);
  else if (k === "pageup" || k === "backspace") sideways(-1);
  else if (paged && k === "g" && !m.shift) pageGo(v, 1, cx);
  else if (paged && (k === "G" || k === "g")) pageGo(v, v.pages, cx);
  else if ((k === "h" || k === "left") && !pan) sideways(-1);
  else if ((k === "l" || k === "right") && !pan) sideways(1);
  else if (k === "h" || k === "left") panPicture(v, d, 0, cx);
  else if (k === "l" || k === "right") panPicture(v, -d, 0, cx);
  else if (k === "k" || k === "up") panPicture(v, 0, d, cx);
  else if (k === "j" || k === "down") panPicture(v, 0, -d, cx);
  else if (k === "r" || k === "R") turn(v, m.shift || k === "R" ? -1 : 1, cx);
  else if (k === "b") v.checker = !v.checker;
  else return false;

  return true;
}

export function keyDown(v: Viewer, e: KeyEvent, cx: Context): void {
  const k = keyOf(e);
  const m = e.modifiers;

  if (m.platform || m.control || m.alt) return;

  const how = v.how?.how;
  // ? opens the keys in the file's place, ? esc q close them; meanwhile they take every key (keyhelp.ts).
  const help = keysKey(e, v.keysShown);

  if (help || v.keysShown) {
    if (help) v.keysShown = help === "toggle" ? !v.keysShown : false;

    cx.stop_propagation();
    cx.notify();

    return;
  }

  if (!commonKey(v, k, m, cx) && !kindKey(v, how ?? null, k, m, cx)) return;

  cx.stop_propagation();
  cx.notify();
}

/** The keys every way of showing takes: the bar's, open, edit, copy, files, next / previous. */
export function commonKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  if (barKey(v, k, m, cx)) return true;

  if (k === "o") openInSystem(v);
  else if (k === "e") v.edit();
  else if (k === "y") copyPath(v, cx);
  else if (k === "f") reveal(v);
  else if (k === "n" || k === "]") goTo(v, 1, cx);
  else if (k === "p" || k === "[") goTo(v, -1, cx);
  else return false;

  return true;
}

/** The keys of the way the file is shown. */
export function kindKey(v: Viewer, how: How["how"] | null, k: string, m: Modifiers, cx: Context): boolean {
  if (how === "table" || how === "diff") return rowKey(v, k, m, cx);

  if (how === "native" && v.kind === "pdf") return pdfKey(v, k, m, cx);

  if (how === "image" || how === "raster") return pictureKey(v, k, m, cx);

  if (how === "native" && (v.kind === "video" || v.kind === "audio")) return mediaKey(v, k, m);

  return false;
}

/** `preview.<command>` (keys.json, `herdr-app do`): every shown preview takes it. */
export function runCommand(v: Viewer, c: string, cx: Context): void {
  if (c === "keys") v.keysShown = !v.keysShown;
  else if (c === "zoom_in") zoomBy(v, 1, cx);
  else if (c === "zoom_out") zoomBy(v, -1, cx);
  else if (c === "fit") fit(v, cx);
  else if (c === "actual") actual(v, cx);
  else if (c === "next") goTo(v, 1, cx);
  else if (c === "prev") goTo(v, -1, cx);
  else if (c === "page_next") pageGo(v, "next", cx);
  else if (c === "page_prev") pageGo(v, "prev", cx);
  else if (c === "rotate") turn(v, 1, cx);
  else if (c === "background") v.checker = !v.checker;
  else if (c === "reload") {
    v.copy = null;
    v.stamp = null;
    loadPath(v, cx);
  }
}

export function wheelBy(view: Viewer, e: ScrollWheelEvent, cx: Context): void {
  const m = e.modifiers;
  const dy = e.delta.y;
  const dx = e.delta.x;
  const how = view.how?.how;

  if (how === "text" || how === "markdown") {
    view.sy = Math.max(0, Math.min(maxScroll(view), view.sy - unzoom(dy)));
    cx.notify();

    return;
  }

  if (how === "table" || how === "diff") {
    // Shift turns a mouse wheel sideways; a trackpad scrolls both ways at once.
    if (m.shift && !dx) scrollBy(view, -unzoom(dy), 0);
    else scrollBy(view, -unzoom(dx), -unzoom(dy));

    cx.notify();

    return;
  }

  const v = current(view);

  if (!v) return;

  if (m.platform || m.control) {
    const k = Math.exp(Math.max(-1, Math.min(1, dy / 240)));

    setView(view, zoomTo(v, v.scale * k, view.img(), view.port, pointOf(e)), cx);
  } else if (pannable(view)) setView(view, panBy(v, dx, dy, view.img(), view.port), cx);
  else return;

  cx.notify();
}
