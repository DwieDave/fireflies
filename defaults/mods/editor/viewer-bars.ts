// The viewer's bars: the toolbar (the file's facts, its controls, a PDF's
// pager), the strip under it, the keys, the embedded look's slim bar, and the
// plain lines (a binary, unreadable, reading). Shared like viewer.ts.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { duration, tag, fileSize, count } from "./kinds.ts";
import { percent } from "./image.ts";
import { keyList } from "./keys.ts";
import { keysHint, keysView } from "./keyhelp.ts";
import { fileIcon, iconColor, iconSvg, ICON_SIZE } from "./file-icons.ts";
import { held, lastPart, unzoom, basename, MOD, stop, checker, ART } from "./viewer-state.ts";
import { goTo } from "./viewer-load.ts";
import { actual, copyPath, editable, fit, openInSystem, pageGo, ready, reveal, turn, zoomBy } from "./viewer-pan.ts";
import { openInDatabases } from "./viewer-table.ts";
import type { default as Viewer } from "./viewer.ts";

/** A control on the bar or the strip; tab / shift-tab reach it in drawing order. */
export function chip(v: Viewer, t: Theme, id: string, label: string, action: (cx: Context) => void, on = false): Element {
  v.chips.push({ id, action });

  const ringed = v.ring === id && v.focusedNow;

  const base = h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
    .text_color(on || ringed ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      cx.notify();
    });

  const lit = on ? base.child(checker(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)) : base;
  const framed = ringed ? lit.child(div().absolute().inset_0().border(1).border_color(t.accent)) : lit;

  return framed.child(div().relative().child(label));
}

/** ? keys, the bar's last control (keyhelp.ts); tab rings it like the chips. */
export function keysChip(v: Viewer, t: Theme): Element {
  const toggle = (): void => {
    v.keysShown = !v.keysShown;
  };

  v.chips.push({ id: "img-keys", action: toggle });

  const ringed = v.ring === "img-keys" && v.focusedNow;
  const hint = keysHint(t, "img-keys", v.keysShown || ringed, toggle).relative().h(20).px(4).ml(2);

  return ringed ? hint.child(div().absolute().inset_0().border(1).border_color(t.accent)) : hint;
}

/** `?`: the keys that do something here, in the file's place (keyhelp.ts): a
 *  native view (a PDF, a video) would draw over anything laid on it. */
export function drawKeysStrip(v: Viewer, t: Theme): Element {
  const how = v.how;

  const list = keyList(how?.how ?? null, v.kind, {
    editable: editable(v),
    db: Boolean(v.db),
    paged: how?.how === "raster" && !how.firstOnly && v.pages > 1,
  });

  return div().relative().flex_1().min_h(0)
    .child(keysView(t, {
      id: "preview-keys",
      title: v.kind ?? "preview",
      list,
      close: () => {
        v.keysShown = false;
      },
    }));
}

/** "1920 × 1080 · PNG · 2.4 MB · animated", "12 034 rows × 9 columns · 3.1 MB", "3 files · +120 −40". */
export function factsOf(v: Viewer, w: number): string {
  const i = v.info;

  if (!i) return "";

  const parts: string[] = [];

  const size = (): void => {
    if (w >= 600 && i.bytes >= 0) parts.push(fileSize(i.bytes));
  };

  if (v.kind === "image") {
    if (i.width) parts.push(`${i.width} × ${i.height}`);

    if (w >= 520 && i.format) parts.push(i.format.toUpperCase());

    size();

    if (w >= 680 && i.animated) parts.push(v.still ? "still while turned" : i.frames ? `${i.frames} frames` : "animated");
  } else if (v.grid && v.kind === "table") {
    parts.push(`${count(v.grid.body.length)} rows × ${v.grid.wide || v.grid.cols.length} columns`);

    if (w >= 560 && held(v).sep === ";") parts.push("; separated");

    size();
  } else if (v.kind === "sqlite") {
    if (v.db) parts.push(`${v.db.tables.length} ${v.db.tables.length === 1 ? "table" : "tables"}`);

    size();
  } else if (v.patch) {
    const f = v.patch.files.length;

    parts.push(`${f} ${f === 1 ? "file" : "files"}`);
    size();
  } else if (v.kind === "pdf") {
    const n = v.pdf?.pageCount || v.pages;

    if (n) parts.push(`${n} ${n === 1 ? "page" : "pages"}`);

    size();
  } else if (v.kind === "video" || v.kind === "audio") {
    if (v.media?.duration) parts.push(duration(v.media.duration));

    if (w >= 520) parts.push(lastPart(v.path).toUpperCase());

    size();
  } else if (v.text && !v.text.md) {
    const n = v.text.starts.length;

    parts.push(`${count(n)} ${n === 1 ? "line" : "lines"}`);
    size();
  } else {
    if (i.format) parts.push(i.format.toUpperCase());

    size();
  }

  return parts.join(" · ");
}

/** The kind's own controls in the bar, always in the same places. */
export function drawControls(view: Viewer, t: Theme, w: number, el: Element): Element {
  const how = view.how;

  if (how?.how === "image" || how?.how === "raster") {
    const v = view.view;

    if (!v || !ready(view)) return el;

    const paged = how.how === "raster" && !how.firstOnly && view.pages > 1 ? drawPager(view, t, el, view.page, view.pages) : el;
    const turnLabel = (how.how === "image" && view.note) || (v.rot ? `turn ${v.rot * 90}°` : "turn");

    // The scale, then two chips that each do what they say: one toggle labelled
    // by its state ("fit 21%" zooming to 100%) read backwards and moved under the pointer.
    return paged
      .when(w >= 400, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(v.scale))))
      .child(chip(view, t, "img-fit", "fit", (cx) => fit(view, cx), v.fit))
      .child(chip(view, t, "img-actual", "100%", (cx) => actual(view, cx), !v.fit && Math.abs(v.scale - 1) < 1e-9))
      .when(w >= 380, (e2) => e2.child(chip(view, t, "img-turn", turnLabel, (cx) => turn(view, 1, cx), Boolean(v.rot))))
      .when(w >= 460 && how.how === "image", (e2) => e2.child(chip(view, t, "img-bg", view.checker ? "checker" : "dark", () => {
        view.checker = !view.checker;
      })));
  }

  const p = view.pdf;

  if (how?.how === "native" && view.kind === "pdf" && p?.pageCount) {
    const scale = p.scale ?? 0;

    return drawPager(view, t, el, p.page ?? 1, p.pageCount)
      .when(w >= 400 && scale > 0, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(scale))))
      .child(chip(view, t, "pdf-out", "−", (cx) => zoomBy(view, -1, cx)))
      .child(chip(view, t, "pdf-fit", "fit", (cx) => fit(view, cx), p.autoScales === true))
      .child(chip(view, t, "pdf-in", "+", (cx) => zoomBy(view, 1, cx)));
  }

  return el;
}

/** ‹ 3/12 › for pages. */
export function drawPager(v: Viewer, t: Theme, el: Element, page: number, pages: number): Element {
  return el
    .child(chip(v, t, "page-prev", "‹", (cx) => pageGo(v, "prev", cx)))
    .child(div().flex_none().text_color(t.foreground).child(`p ${page}/${pages}`))
    .child(chip(v, t, "page-next", "›", (cx) => pageGo(v, "next", cx)));
}

export function drawToolbar(v: Viewer, t: Theme): Element {
  const w = unzoom(v.port.width) || 600;
  const index = v.names.indexOf(basename(v.path));
  const many = v.names.length > 1;
  const facts = factsOf(v, w);

  const head = h_flex().id("preview-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
    .when(w >= 320, (e2) => e2.child(div().flex_none().text_color(t.ansi8).child(tag(v.kind, v.path))))
    .child(h_flex().flex_1().min_w(0).gap(8).items_baseline()
      .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(v.path || "Preview")))
      .when(w >= 420 && Boolean(facts), (e2) => e2.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(facts))))
    .when(many && w >= 360, (e2) => e2
      .child(chip(v, t, "img-prev", "‹", (cx) => goTo(v, -1, cx)))
      .child(div().flex_none().text_color(t.dim).child(index >= 0 ? `${index + 1}/${v.names.length}` : `${v.names.length}`))
      .child(chip(v, t, "img-next", "›", (cx) => goTo(v, 1, cx))));

  return drawControls(v, t, w, head)
    .when(Boolean(v.path), (e2) => e2
      .when(w >= 360 && editable(v), (e3) => e3.child(chip(v, t, "img-edit", "edit", () => v.edit())))
      .when(w >= 300, (e3) => e3.child(chip(v, t, "img-files", "files", () => reveal(v))))
      .when(w >= 540 && !v.on, (e3) => e3.child(chip(v, t, "img-open", "open", () => openInSystem(v))))
      .when(w >= 620, (e3) => e3.child(chip(v, t, "img-copy", v.copied ? "copied" : "copy", (cx) => copyPath(v, cx), Boolean(v.copied)))))
    .child(keysChip(v, t))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
}

/** A second strip: a database's tables, or what's left out of a table or patch. */
export function drawStrip(v: Viewer, t: Theme): Element | null {
  const db = v.db;
  const tables = db?.tables ?? [];
  // A picture's note sits on its turn chip.
  const note = v.how?.how === "image" ? null : v.note;

  if (!tables.length && !note) return null;

  const shownAt = db?.at ?? 0;

  return h_flex().id("preview-strip").relative().h(26).flex_none().px(10).gap(2).items_center().text_size(11).overflow_hidden()
    .children(tables.map((x, i) => chip(v, t, `db-table-${i}`, x.type === "view" ? `${x.name} (view)` : x.name, (cx) => {
      if (i !== shownAt) v.pickTable(i, cx);
    }, i === shownAt)))
    .when(Boolean(note), (el) => el.child(div().flex_1().min_w(0).when(tables.length > 0, (e2) => e2.pl(8)).truncate().text_color(t.ansi3).child(note ?? "")))
    // The whole database in the Databases window: its structure, every row, queries.
    .when(v.kind === "sqlite" && v.dbMod, (el) => el.child(div().flex_1()).child(chip(v, t, "db-open", "open in Databases", () => openInDatabases(v.path, "the preview"))))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
}

/** The look's bar: the kind (a language for code), the name, the facts, what's left out. */
export function drawLookBar(v: Viewer, t: Theme): Element {
  const w = unzoom(v.port.width) || 400;
  const lang = v.kind === "text" ? v.text?.lang : null;
  const kind = lang ? lang.toUpperCase() : tag(v.kind, v.path);
  const facts = v.error ? "" : factsOf(v, w);
  const note = v.error || v.busy ? null : v.note;
  const icon = fileIcon(v.path);

  return h_flex().id("look-bar").relative().h(26).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
    // The file's type mark (file-icons.ts; the copies in preview's icons/).
    .child(div().id("look-bar-icon").relative().flex_none().size(ICON_SIZE).child(svg(iconSvg(icon, MOD)).size(ICON_SIZE).text_color(iconColor(icon, t))))
    .child(div().flex_none().text_color(t.ansi8).child(kind))
    .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(basename(v.path)))
    .when(Boolean(facts) && w >= 220, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(facts)))
    .child(div().flex_1())
    .when(Boolean(note) && w >= 260, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.ansi3).child(note ?? "")))
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi0, 1)));
}

/** One plain line (a binary, an unreadable file, reading). */
export function oneLineView(t: Theme, text: string): Element {
  return div().px(12).py(10).text_size(11).text_color(t.dim).child(text);
}

/** What shows under a native view while it loads, or while a menu sets it aside. */
export function standIn(v: Viewer, t: Theme): Element {
  return v_flex().size_full().items_center().justify_center().gap(6).px(16).text_size(11).bg(t.background)
    .child(div().text_color(t.ansi8).child(tag(v.kind, v.path)))
    .child(div().max_w_full().truncate().text_color(t.foreground).child(basename(v.path)));
}

export function emptyView(v: Viewer, t: Theme, title: string, hint: string | null, offer = false): Element {
  return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
    .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
    .child(div().text_color(t.foreground).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint ?? "")))
    .when(offer && !v.on && Boolean(v.path), (el) => el.child(h_flex().pt(4).text_color(t.muted)
      .child(chip(v, t, "empty-open", "open in its app  o", () => openInSystem(v)))));
}
