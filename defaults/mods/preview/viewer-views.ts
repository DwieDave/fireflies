// The viewer's place for the file, drawn the way its kind is: a picture on
// its rails, a native view, a patch's rows. Shared like viewer.ts.

import { div, image } from "gpui-kit";
import type { Context, Element, Point } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as herdr from "herdr";
import { home } from "herdr";
import type { Theme } from "herdr";
import { noun } from "./kinds.ts";
import type { View as Look } from "./image.ts";
import { placed } from "./image.ts";
import type { Patch, PatchRow } from "./diff.ts";
import { unzoom, ROW, pointOf, checker, tilde, code } from "./viewer-state.ts";
import { mdView, textView } from "./viewer-text.ts";
import { rowCount, shownRange, tableView, rowRails } from "./viewer-table.ts";
import { nativeId } from "./viewer-native.ts";
import { actual, current, fit, pannable } from "./viewer-pan.ts";
import { emptyView, oneLineView, standIn } from "./viewer-bars.ts";
import type { default as Viewer } from "./viewer.ts";

/** Where the view is when part of the picture is out of it: dithered rails on the
 *  right and bottom edges, as the Markdown viewer's scrollbar. */
export function rails(v: Viewer, t: Theme, box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }, focused: boolean): Element[] {
  const port = v.port;
  const out: Element[] = [];
  const color = focused ? t.accent : t.ansi8;

  if (box.height > port.height + 1) {
    const shown = port.height / box.height;
    const top = (-box.top / box.height) * port.height;

    out.push(div().absolute().right(1).w(3).top(unzoom(top)).h(unzoom(Math.max(16, port.height * shown))).child(checker(color, 1)));
  }

  if (box.width > port.width + 1) {
    const shown = port.width / box.width;
    const left = (-box.left / box.width) * port.width;

    out.push(div().absolute().bottom(1).h(3).left(unzoom(left)).w(unzoom(Math.max(16, port.width * shown))).child(checker(color, 1)));
  }

  return out;
}

export function pictureView(gv: Viewer, t: Theme, v: Look, focused: boolean): Element[] {
  const box = placed(v, gv.img(), gv.port);
  const l = unzoom(box.left);
  const tp = unzoom(box.top);
  const w = unzoom(box.width);
  const h = unzoom(box.height);
  const paper = gv.how?.how === "raster";
  const under = div().absolute().left(l).top(tp).w(w).h(h).overflow_hidden().bg(paper ? "#ffffff" : gv.checker ? t.hover : t.background);

  return [
    // The checker sits under the picture only: transparency reads, the pane stays dark.
    // A PDF page is paper: white under it.
    gv.checker && !paper ? under.child(checker(t.ansi0, 8)) : under,
    image(gv.src ?? "").id(`img-${gv.slot ?? "view"}`).absolute().left(l).top(tp).w(w).h(h),
    ...rails(gv, t, box, focused),
  ];
}

/** The macOS view for a PDF, a font or a clip; under it, what shows while it loads. */
export function nativeView(v: Viewer, t: Theme, view: "pdf" | "quicklook" | "media"): Element[] {
  const path = v.local ?? v.path;

  return [herdr.nativeView.new(nativeId(v), v.rev ? { kind: view, path, rev: v.rev } : { kind: view, path })
    .child(v.embedded ? standIn(v, t) : emptyView(v, t, view === "media" ? "Opening the player…" : "Opening…", tilde(v.path, home())))];
}

/** One row of a patch. */
export function patchRow(t: Theme, row: PatchRow, wide: boolean): Element {
  const font = code();
  const num = (n: number | null, w: number): Element => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n === null ? "" : String(n));

  if (row.kind === "file") {
    const el = h_flex().h(ROW).w_full().relative().items_center().px(10).gap(10).text_size(11)
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi0, 1)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(row.old ? `${row.old} → ${row.path}` : row.path || "(no name)"));

    return (row.binary ? el.child(div().flex_none().text_color(t.dim).child("binary")) : el)
      .child(div().flex_none().text_color(t.ansi2).child(`+${row.add}`))
      .child(div().flex_none().text_color(t.ansi1).child(`-${row.del}`));
  }

  if (row.kind === "@") {
    const el = h_flex().h(ROW).w_full().relative().items_center().px(8).gap(10).text_size(11)
      .child(checker(t.ansi0, 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(wide ? row.range : row.range.replace(/^@@ | @@$/g, "")));

    return row.text ? el.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)) : el;
  }

  if (row.kind === "note") return h_flex().h(ROW).w_full().items_center().px(10).font_family(font).text_size(12).child(div().min_w(0).truncate().text_color(t.dim).child(row.text || " "));

  const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
  const o = "o" in row ? row.o : null;
  const n = "n" in row ? row.n : null;
  const line = h_flex().h(ROW).w_full().relative().items_center().font_family(font).text_size(12);
  const edge = div().w(3).h_full().flex_none().relative();

  return (tint ? line.bg(`${tint}16`) : line)
    .child(tint ? edge.child(checker(tint, 1)) : edge)
    .children(wide ? [num(o, 38), num(n, 38)] : [num(n ?? o, 34)])
    .child(div().w(wide ? 14 : 12).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
    .child(div().flex_1().min_w(0).truncate().pr(8)
      .text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground).child(row.text || " "));
}

/** A patch, as diff draws one, with each file's name over its part. */
export function diffView(v: Viewer, t: Theme, p: Patch, focused: boolean): Element[] {
  const wide = unzoom(v.port.width) >= 560;
  const [first, last] = shownRange(v);
  const rows: Element[] = [];

  for (let r = first; r < last; r++) {
    const row = p.rows[r];

    if (!row) continue;

    const place = div().absolute().left(0).right(0).top(r * ROW - v.sy).h(ROW);

    rows.push((r === v.cursor && focused ? place.child(div().absolute().left(0).top(0).bottom(0).w(1).bg(t.accent)) : place).child(patchRow(t, row, wide)));
  }

  const body = !p.rows.length ? [div().absolute().left(16).top(12).text_size(11).text_color(t.dim).child("Nothing in it")] : rows;

  return [div().absolute().inset_0().children([...body, ...rowRails(v, t, focused, 0, unzoom(v.port.height), 0, 0)])];
}

/** The file's place: what's read, drawn the way its kind is shown. */
export function innerView(view: Viewer, t: Theme, focused: boolean): Element[] {
  const how = view.how;
  const text = view.text;
  const v = current(view);

  if (view.embedded && !view.path) return [];

  if (view.embedded && view.error) return [oneLineView(t, view.error)];

  if (view.embedded && view.busy) return [oneLineView(t, view.busy)];

  if (view.embedded && how?.how === "text" && text) return textView(view, t, text);

  if (view.embedded && how?.how === "markdown" && text) return mdView(view, t, text);

  if (view.error) return [emptyView(view, t, `Can't preview this ${noun(view.kind)}`, view.error, true)];

  if (view.busy) return [emptyView(view, t, view.busy, tilde(view.path, home()))];

  if (how?.how === "native") return nativeView(view, t, how.view);

  if (how?.how === "table" && view.db && !view.db.tables.length) return [emptyView(view, t, "No tables", "This database is empty.")];

  if (how?.how === "table" && view.grid) return tableView(view, t, view.grid, focused);

  if (how?.how === "diff" && view.patch) return diffView(view, t, view.patch, focused);

  if (!view.src) return [emptyView(view, t, "Reading…", tilde(view.path, home()))];

  return v ? pictureView(view, t, v, focused) : [];
}

/** A press on the file: a table's or a patch's row, a double click fits or
 *  shows 100%, else a drag that pans starts. */
export function pressAt(view: Viewer, e: { readonly click_count: number; readonly local_position?: Point | undefined }, cx: Context): void {
  const how = view.how?.how;
  const at = pointOf(e);

  // Embedded: the keyboard stays in the tree.
  if (!view.embedded) view.handle?.focus();

  if ((how === "table" || how === "diff") && at) {
    const head = how === "table" ? ROW : 0;
    const r = Math.floor((unzoom(at.y) - head + view.sy) / ROW);

    if (unzoom(at.y) >= head && r >= 0 && r < rowCount(view)) {
      view.cursor = r;
      cx.notify();
    }

    return;
  }

  const v = current(view);

  if (e.click_count === 2 && at && v) {
    if (v.fit) actual(view, cx, at);
    else fit(view, cx);

    view.drag = null;
    cx.notify();

    return;
  }

  if (at && v && pannable(view)) {
    view.drag = { from: at, x: v.x, y: v.y };
    cx.notify();
  }
}
