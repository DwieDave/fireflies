// The viewer's actions on what it shows: reveal, the system's app, edit,
// copy the path, a PDF's pages, and a picture's zoom, fit, turns and panning.
// Shared like viewer.ts.

import type { Context, Point } from "gpui-kit";
import { run, panes } from "herdr";
import type { Size, View as Look } from "./image.ts";
import { fitted, fitScale, clampPan, zoomTo, step, panBy, rotate, sharpness, turned } from "./image.ts";
import { dirname, dpr, MOD, slotOf } from "./viewer-state.ts";
import { maxScroll } from "./viewer-text.ts";
import { scrollBy } from "./viewer-table.ts";
import { pdfDo, pdfLater } from "./viewer-native.ts";
import type { default as Viewer } from "./viewer.ts";

export function reveal(v: Viewer): void {
  run("pane.split", { edge: "right", px: 280, mod: "file-tree", props: { folder: dirname(v.path), on: v.on } });
}

export function openInSystem(v: Viewer): void {
  if (!v.on) run("preview.open", { path: v.path, in: "system" });
}

/** Text shown as something else (a table, a patch, an SVG): edit it as
 *  text in the editor (editor), beside this preview. */
export function editable(v: Viewer): boolean {
  return !v.on && /\.(csv|tsv|diff|patch|svg)$/i.test(v.path);
}

export function editFile(v: Viewer): void {
  if (!editable(v)) return;

  const me = v.slot ? panes().find((p) => p.mod === MOD && slotOf(p) === v.slot) : undefined;

  run("editor.open", me ? { path: v.path, pane: me.pane } : { path: v.path });
}

export function copyPath(v: Viewer, cx: Context): void {
  cx.write_to_clipboard(v.on ? `${v.on}:${v.path}` : v.path);

  const at = Date.now();

  v.copied = at;
  cx.timer.after(1400, (cx) => {
    if (v.copied === at) {
      v.copied = 0;
      cx.notify();
    }
  });
}

export function pageGo(v: Viewer, n: "next" | "prev" | number, cx: Context): void {
  const how = v.how;

  if (how?.how === "native") {
    if (n === "next") pdfDo(v, "pdf.next");
    else if (n === "prev") pdfDo(v, "pdf.previous");
    else if (v.pdf?.pageCount) pdfDo(v, "pdf.goToPage", { page: Math.max(1, Math.min(v.pdf.pageCount, n)) });

    return;
  }

  if (how?.how !== "raster" || how.firstOnly) return;

  const to = n === "next" ? v.page + 1 : n === "prev" ? v.page - 1 : n;
  const page = Math.max(1, Math.min(v.pages || 1, to));

  if (page === v.page) return;

  v.page = page;

  const gen = v.gen;

  cx.spawn(async (cx) => v.rasterPage(cx, gen));
}

/** The picture's size as shown. */
export function imgOf(v: Viewer): Size {
  return { width: v.info?.width || 1, height: v.info?.height || 1 };
}

/** A vector: fit may enlarge it. */
export function vector(v: Viewer): boolean {
  return v.copy?.format === "svg";
}

export function pictured(v: Viewer): boolean {
  return v.how?.how === "image" || v.how?.how === "raster";
}

export function ready(v: Viewer): boolean {
  return Boolean(pictured(v) && v.info?.width && v.port.width && v.src);
}

/** The view, fitted the first time the picture and the pane's size are both known. */
export function current(v: Viewer): Look | null {
  if (!v.view && pictured(v) && v.info?.width && v.port.width) v.view = fitted(v.img(), v.port, 0, vector(v));

  return pictured(v) ? v.view : null;
}

/** Sets the view; a vector redraws sharper (or lighter) when its scale crosses a step. */
export function setView(gv: Viewer, view: Look, cx: Context): void {
  const before = gv.view;
  const k = (v: Look | null): number => sharpness(gv.img(), v?.scale ?? 1, dpr());

  gv.view = view;

  if (before?.rot !== view.rot || (vector(gv) && k(before) !== k(view))) void gv.draw(cx);
}

export function zoomBy(view: Viewer, dir: number, cx: Context, point?: Point | null): void {
  if (view.how?.how === "native" && view.kind === "pdf") {
    pdfDo(view, dir > 0 ? "pdf.zoomIn" : "pdf.zoomOut");

    return;
  }

  const v = current(view);

  if (v) setView(view, zoomTo(v, step(v.scale, dir), view.img(), view.port, point), cx);
}

export function fit(view: Viewer, cx: Context): void {
  if (view.how?.how === "native" && view.kind === "pdf") {
    pdfDo(view, "pdf.fitWidth");

    return;
  }

  const v = current(view);

  if (v) setView(view, fitted(view.img(), view.port, v.rot, vector(view)), cx);
}

export function actual(view: Viewer, cx: Context, point?: Point | null): void {
  const v = current(view);

  if (v) setView(view, zoomTo(v, 1, view.img(), view.port, point), cx);
}

export function turn(view: Viewer, dir: number, cx: Context): void {
  const v = current(view);

  if (!v) return;

  if (view.how?.how !== "raster" || !view.how.firstOnly) view.note = null;

  setView(view, rotate(v, dir, view.img(), view.port, vector(view)), cx);
}

/** Whether part of the picture is out of view (so keys pan rather than step). */
export function pannable(view: Viewer): boolean {
  const v = current(view);

  if (!v) return false;

  const { width, height } = turned(view.img(), v.rot);

  return width * v.scale > view.port.width + 1 || height * v.scale > view.port.height + 1;
}

export function panPicture(view: Viewer, dx: number, dy: number, cx: Context): void {
  const v = current(view);

  if (v) setView(view, panBy(v, dx, dy, view.img(), view.port), cx);
}

export function resized(view: Viewer, size: Size, cx: Context): void {
  const port = { width: size.width, height: size.height };

  if (Math.abs(port.width - view.port.width) <= 1 && Math.abs(port.height - view.port.height) <= 1) return;

  view.port = port;

  const v = view.view;

  if (v && pictured(view)) setView(view, v.fit ? { ...v, scale: fitScale(view.img(), port, v.rot, vector(view)) } : clampPan(v, view.img(), port), cx);

  if (view.text) view.sy = Math.min(view.sy, maxScroll(view));
  else scrollBy(view, 0, 0);

  pdfLater(view, cx);
  cx.notify();
}
