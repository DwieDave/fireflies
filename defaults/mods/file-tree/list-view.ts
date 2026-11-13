// The files pane's list drawn: a row (indent, fold, type mark, name with its
// matched letters, its git or cut mark), a folder's look, the split between
// the tree and the preview, the empty states; the cursor moving through rows.

import { div, svg } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import type { Theme } from "herdr";
import { h_flex, v_flex, Input, v_virtual_list, Scrollbar } from "gpui-base";
import type { Range, Row } from "./logic.ts";
import { lists, marks, base } from "./logic.ts";
import type { LookDir } from "./state.ts";
import { ROW, ART, tilde } from "./state.ts";
import { stop, dither, typeMark, markColor } from "./paint.ts";
import { saveLook } from "./look.ts";
import { addNew } from "./search.ts";
import { absOf, isCut } from "./file-ops.ts";
import type { default as Files } from "./main.ts";
import type { Side } from "./split-size.ts";
import { folderFacts, DIVIDER } from "./split-size.ts";

export function drawRow(v: Files, t: Theme, r: Row, focused: boolean): Element {
  // The name's input (a new item's row, or the row being renamed) in place of the name.
  const editing = Boolean(r.draft) || (v.draft?.kind === "rename" && v.draft.path === r.path);
  const sel = editing || (r.path === v.sel && !v.draft);
  const open = r.dir && v.folders.has(r.path);
  const cut = !r.draft && isCut(v, absOf(v, r.path));
  const ask = v.ask;
  const doomed = ask ? (ask.set ? ask.set.some((x) => x.path === r.path) : ask.path === r.path) : false;
  // Marked (t, cmd-click, a range); dragged; the folder a drop would land in.
  const marked = v.marked.has(r.path);
  const dragged = Boolean(v.drag?.paths.includes(r.path));
  const target = Boolean(v.drag?.ok) && v.drag?.into === r.path && r.path !== "";
  const mark = cut ? "cut" : r.hit ? (r.git && markColor(t, r.git) ? r.git : null) : v.marks.get(`${v.root}/${r.path}`) ?? null;
  const hidden = r.name.startsWith(".");
  const tinted = mark && mark !== "•" ? markColor(t, mark) : null;
  const color = doomed ? t.ansi1 : cut ? t.dim : sel ? t.foreground : tinted ?? (hidden || r.ignored ? t.dim : r.dir ? t.foreground : t.muted);
  const input = v.nameInput;

  const name = editing && input ? Input.new(input).flex_1().min_w(0).h(ROW).text_size(12).text_color(t.foreground)
    : r.hit ? matched(v, t, `nf-m-${r.path}`, r.name, r.ranges, cut ? t.dim : color)
    : div().relative().flex_1().min_w(0).truncate().text_color(r.head || dragged ? t.dim : marked ? t.accent : color).child(r.name);

  return h_flex().id(`nf-${r.path}`).relative().h(ROW).w_full().pl(8 + r.depth * 14).pr(10).gap(6).items_center()
    .hover((s) => s.bg(`${t.ansi0}55`))
    // A marked row: a light accent dither and a dotted accent edge on the left.
    .when(marked && !sel, (el) => el.child(dither(`${t.accent}30`, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).child(dither(t.accent, 1))))
    .when(sel, (el) => el.child(dither(focused ? t.ansi0 : `${t.ansi0}88`, 1))
      .when(marked, (el) => el.child(dither(`${t.accent}30`, 1)))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : t.ansi8)))
    // The folder a drop goes into: framed in the accent.
    .when(target, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)).child(dither(`${t.accent}40`, 1)))
    // Indent guides: one dotted rule per level.
    .children(Array.from({ length: r.depth }, (_, d) => div().absolute().top(0).bottom(0).left(14 + d * 14).w(1).opacity(0.5).child(dither(t.ansi0, 1))))
    .child(r.head ? div().w(10).flex_none() : r.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).relative().size(10).flex_none().text_color(t.dim) : div().w(10).flex_none())
    .child(r.dir ? svg("mods/files/folder.svg").relative().size(12).flex_none().text_color(open ? t.accent : t.ansi4) : typeMark(t, r.name, `nf-icon-${r.path}`))
    .child(name)
    .children(mark && !editing ? [div().relative().flex_none().when(mark !== "cut", (el) => el.w(8))
      .text_color(mark === "•" || mark === "cut" ? t.ansi3 : markColor(t, mark) ?? t.ansi3).child(mark)] : []);
}

/** Text with the matched characters in the accent. */
export function matched(v: Files, t: Theme, id: string, text: string, ranges: readonly Range[], color: Color): Element {
  return h_flex().relative().flex_1().min_w(0).overflow_hidden()
    .children(marks(text, ranges).map(([piece, hit], j) => div().id(`${id}-${j}`).flex_none().text_color(hit ? t.accent : color).child(piece)));
}

/** A folder in the preview: its name, what it holds (as the filters list it), its first entries. */
export function drawFolderView(v: Files, t: Theme, d: LookDir): Element {
  const entries = (d.entries ?? []).filter((e) => lists(d.rel ? `${d.rel}/${e.name}` : e.name, v.filters, v.ignored));
  const facts = d.error ? "" : d.entries ? folderFacts(entries) : "listing…";

  const bar = h_flex().id("nf-look-bar").relative().h(26).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
    .child(div().flex_none().text_color(t.ansi8).child("DIR"))
    .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(d.abs === "/" ? "/" : base(d.abs)))
    .when(Boolean(facts), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(facts)))
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)));

  const list = v_flex().flex_1().min_h(0).overflow_hidden().py(4).text_size(12)
    .children(d.error ? [div().px(12).py(6).text_size(11).text_color(t.dim).child(d.error)] : [])
    .children(entries.slice(0, 120).map((e, i) => h_flex().id(`nf-lk-${i}`).h(20).flex_none().px(12).gap(6).items_center()
      .child(e.dir ? svg("mods/files/folder.svg").relative().size(12).flex_none().text_color(t.ansi4) : typeMark(t, e.name, `nf-lk-icon-${i}`))
      .child(div().min_w(0).truncate().text_color(e.dir ? t.foreground : t.muted).child(e.name))));

  return v_flex().id("nf-look-dir").size_full().bg(t.background).child(bar).child(list);
}

/** The tree (with its hint line) and the preview, split along `side`; the
 *  preview `px` along it. The divider drags; its line lights while it does. */
export function drawSplit(v: Files, t: Theme, side: Side, px: number, list: Element, foot: Element | null): Element {
  const right = side === "right";

  // h_flex centers its items: the tree's column is stretched to the split's height by hand.
  const tree = v_flex().id("nf-treecol").relative().flex_1().min_w(0).min_h(0).when(right, (el) => el.h_full())
    .child(list).children(foot ? [foot] : []);

  // At rest a dotted rule; under the pointer or held, a lit band the width of the grab area.
  const lit = Boolean(v.dragging) || v.dividerHover;
  const band = lit ? DIVIDER - 2 : 1;
  const at = Math.floor((DIVIDER - band) / 2);
  const line = dither(lit ? t.accent : t.ansi8, 1);

  const divider = div().id("nf-divider").relative().flex_none()
    .when(right, (el) => el.w(DIVIDER).h_full().cursor_col_resize().child(div().absolute().top(0).bottom(0).left(at).w(band).child(line)))
    .when(!right, (el) => el.h(DIVIDER).w_full().cursor_row_resize().child(div().absolute().left(0).right(0).top(at).h(band).child(line)))
    .on_hover((over, cx) => {
      if (over !== v.dividerHover) {
        v.dividerHover = over;
        cx.notify();
      }
    })
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.dragging = side;
      v.focus();
      cx.notify();
    });

  const shown = v.lookDir ? v.folderView(t, v.lookDir) : v.look;

  const look = div().id("nf-look").relative().flex_none().overflow_hidden()
    .when(right, (el) => el.w(px).h_full()).when(!right, (el) => el.h(px).w_full())
    // A right-click here isn't a row's: no menu.
    .on_mouse_down("right", stop)
    .children(shown ? [shown] : []);

  return (right ? h_flex() : v_flex()).id("nf-split").relative().flex_1().min_h(0).min_w(0).child(tree).child(divider).child(look);
}

export function emptyView(v: Files, t: Theme, title: string, hint: string | null, add = false): Element {
  return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16).text_size(11)
    .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
    .child(div().text_color(t.foreground).child(title))
    .children(hint ? [div().text_center().text_color(t.ansi8).child(hint)] : [])
    // An empty folder: its first file, as a / + file make it.
    .when(add, (el) => el.child(h_flex().id("nf-empty-add").relative().h(20).px(6).gap(7).items_center().text_color(t.muted)
      .hover((s) => s.bg(`${t.ansi0}55`).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        addNew(v, "file", cx);
        cx.notify();
      })
      .child(div().text_color(t.accent).child("+")).child(div().child("new file")).child(div().text_color(t.ansi8).child("a"))));
}

/** The divider's drag ends: its share is kept. */
export function endDivider(v: Files): boolean {
  const side = v.dragging;

  if (!side) return false;

  if (v.dragged !== null) saveLook(v, side === "right" ? { ...v.lookState, right: v.dragged } : { ...v.lookState, bottom: v.dragged });

  v.dragging = null;
  v.dragged = null;

  return true;
}

export function selectRow(v: Files, rows: readonly Row[], i: number): void {
  if (!rows.length) return;

  const n = Math.max(0, Math.min(rows.length - 1, i));

  v.sel = rows[n]?.path ?? null;
  v.scroll?.scroll_to_item(n);
}

/** One step through the hits while typing (folder lines skipped). */
export function stepRow(v: Files, d: number): void {
  const rows = v.shown();
  let i = rows.findIndex((r) => r.path === v.sel);

  do i += d; while (rows[i]?.head);

  if (rows[i]) selectRow(v, rows, i);
}

/** Where the selection goes once the rows are there: after going up, the folder
 *  it came from; a row asked for once it shows; none when its row went. */
export function settleSelection(v: Files, rows: readonly Row[]): void {
  if (v.pendingSel && rows.length) {
    const back = v.pendingSel.startsWith(`${v.root}/`) ? v.pendingSel.slice(v.root.length + 1).split("/")[0] : null;

    v.pendingSel = null;

    if (back) {
      const i = rows.findIndex((r) => r.path === back);

      if (i >= 0) selectRow(v, rows, i);
    }
  }

  if (v.want) {
    const i = rows.findIndex((r) => r.path === v.want);

    if (i >= 0) {
      v.want = null;
      selectRow(v, rows, i);
    }
  }

  if (v.sel && !v.want && !rows.some((r) => r.path === v.sel)) v.sel = null;
}

/** The rows drawn: the tree or the hits with the name row; marks on rows no
*  longer shown drop out; the name row is scrolled to once. */
export function listOf(v: Files, rows: readonly Row[]): readonly Row[] {
  // The new item's input row where it will appear, put on screen once.
  const list = v.withDraft(rows);

  v.listed = list;

  // Marks on rows no longer shown (folded away, filtered out, gone) drop out.
  if (v.marked.size && !v.drag) {
    const shownNow = new Set(rows.map((r) => r.path));

    if ([...v.marked].some((p) => !shownNow.has(p))) v.marked = new Set([...v.marked].filter((p) => shownNow.has(p)));
  }

  const draft = v.draft;

  if (draft && !draft.shown) {
    const i = list.findIndex((r) => r.draft || (draft.kind === "rename" && r.path === draft.path));

    if (i >= 0) {
      draft.shown = true;
      v.scroll?.scroll_to_item(i);
    }
  }


  return list;
}

/** The list's place: the rows (a virtual list), or why there are none. */
export function listBody(v: Files, t: Theme, rows: readonly Row[], list: readonly Row[], focused: boolean): Element {
  const searching = Boolean(v.query.trim());
  let body: Element;

  if (searching && v.hits && !rows.length) body = emptyView(v, t, "No files match", v.note ?? `“${v.query.trim()}” under ${tilde(v.root)}`);
  else if (searching && !v.hits) body = emptyView(v, t, "Searching…", null);
  else if (v.error && !list.length) body = emptyView(v, t, "Can't read v folder", v.error);
  else if (!list.length) body = emptyView(v, t, v.loading ? "Listing files…" : "Nothing here", v.loading ? null : tilde(v.root), !v.loading);
  else {
    const rowsList = v_virtual_list("nf-rows", list.length, ROW, (i) => list[i]?.path ?? "",
      (range) => list.slice(range.start, range.end).map((r) => v.row(t, r, focused)))
      .on_item_click((path, cx) => v.pick(path, cx))
      // The pane's own right press comes after v and opens the menu for the row.
      .on_item_secondary_click((path) => {
        v.pressed = rows.find((r) => r.path === path) ?? null;
      })
      .size_full();

    body = div().id("nf-tree").relative().flex_1().min_h(0).py(4).text_size(12)
      // A drop below the rows goes into the root: the list framed in the accent.
      .when(Boolean(v.drag?.ok) && v.drag?.into === "", (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .child(v.scroll ? rowsList.track_scroll(v.scroll) : rowsList)
      .child(Scrollbar.vertical("nf-rows").absolute().inset_0());
  }


  return body;
}
