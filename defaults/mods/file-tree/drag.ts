// Several rows at once in the files pane (marks, ranges) and drag and drop:
// the row under the pointer, the target folder, unfolding and scrolling while
// dragging, the drop as one set of moves, the ghost under the pointer.

import { div, svg } from "gpui-kit";
import type { Context, Element, MouseButtonEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { h_flex } from "gpui-base";
import type { Row } from "./logic.ts";
import { parent, rangePaths, topLevel, dropRefusal, treeTop, ROW_H, rowIndexAt, base, dirOf } from "./logic.ts";
import type { Drag, TreeBox, Hit, SetOp } from "./state.ts";
import { tilde, DRAFT, SLOP, UNFOLD, EDGE } from "./state.ts";
import { zoom } from "./paint.ts";
import { rowAt } from "./tree.ts";
import { absOf, forget, moveEntry, recordChanges, runOp, why } from "./file-ops.ts";
import type { default as Files } from "./main.ts";
import { endDivider } from "./list-view.ts";
import { rootRow } from "./menu.ts";
import type { At } from "./split-size.ts";
import { DIVIDER, dragShare } from "./split-size.ts";
import { join, relTo } from "./ops.ts";

/** The marked rows in the tree's order (none: []). */
export function markedRows(v: Files): Row[] {
  if (!v.marked.size) return [];

  return v.shown().filter((r) => v.marked.has(r.path) && !r.head && !r.draft);
}

/** The rows an action on `row` covers: every marked one (a folder's
 *  contents go with it) when there are marks and `row` is one of them or the
 *  keyboard's; else `row` alone. */
export function setOf(v: Files, row: Row | null): Row[] {
  const marked = markedRows(v);

  if (!marked.length || (row?.path && !v.marked.has(row.path) && row.path !== v.sel)) return row?.path ? [row] : [];

  const keep = new Set(topLevel(marked.map((r) => r.path)));

  return marked.filter((r) => keep.has(r.path));
}

/** t, cmd-click: marks or unmarks a row. */
export function markToggle(v: Files, path: string): void {
  if (!path || path === DRAFT) return;

  const next = new Set(v.marked);

  if (next.has(path)) next.delete(path);
  else next.add(path);

  v.marked = next;
  v.anchor = path;
}

/** Marks the rows from the range's start to the keyboard's row (the marks before it kept). */
export function markRange(v: Files, to: string | null): void {
  const r = v.range;
  const rows = v.shown();

  if (!r) return;

  const a = rows.findIndex((x) => x.path === r.anchor);
  const b = rows.findIndex((x) => x.path === to);

  if (a < 0 || b < 0) return;

  v.marked = new Set([...r.base, ...rangePaths(rows, a, b)]);
}

/** esc: the marks and a range go. */
export function unmark(v: Files): void {
  v.marked = new Set();
  v.range = null;
}

/** Moves the set (absolute paths) into `into`, each tried; what failed is
 *  said afterwards with its reason. Nothing is overwritten. */
export function moveSet(v: Files, paths: readonly string[], into: string, cx: Context): void {
  const items = topLevel(paths).filter((p) => parent(p) !== into);
  const why = dropRefusal(topLevel(paths), into);

  if (why) {
    v.say(why, cx);

    return;
  }

  runSet(v, items.map((abs) => ({ abs, args: ["move", abs, join(into, base(abs))], to: join(into, base(abs)) })), cx, (n) => `Moved ${n} ${n === 1 ? "item" : "items"} to ${tilde(into)}`);
}

/** Where the rows are in the pane (px): under the header, left of a preview at the right, above one at the bottom. */
export function treeBox(v: Files): TreeBox {
  const g = v.geo;

  return {
    top: treeTop(v.lensRows) - 4,
    bottom: v.size.height - (g.side === "bottom" && g.px !== null ? g.px + DIVIDER : 0),
    right: v.size.width - (g.side === "right" && g.px !== null ? g.px + DIVIDER : 0),
  };
}

/** How far the list is scrolled (layout px down). */
export function scrolled(v: Files): number {
  return -(v.scroll?.offset().y ?? 0) / zoom();
}

/** What's under the pointer `at` (pane px): a row ({ row }), the empty
 *  space below the rows ({ root }), or nothing. Rows are ROW_H px each,
 *  from the list's scroll offset (VirtualListScrollHandle.offset). */
export function hitAt(v: Files, at: At | null): Hit | null {
  const box = treeBox(v);

  if (!at || v.keysShown || at.y < box.top || at.y > box.bottom || at.x > box.right) return null;

  const list = v.listed;
  const i = rowIndexAt(at.y, scrolled(v), treeTop(v.lensRows));
  const row = list[i];

  if (i >= 0 && row) return { row };

  return i >= list.length ? { root: true } : null;
}

/** A left press (no cmd / shift / alt) on a row: a drag starts once it moves SLOP px. */
export function pressAt(v: Files, e: MouseButtonEvent): void {
  v.press = null;

  const m = e.modifiers;

  if (m.platform || m.shift || m.alt || v.draft || v.typing || !e.local_position || !v.scroll) return;

  const at = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
  const hit = v.hitAt(at);

  if (hit && "row" in hit && hit.row.path !== DRAFT && !hit.row.head) v.press = { path: hit.row.path, at };
}

/** The pointer moved with the button held: the drag starts, or aims. A
 *  press on a marked row drags every marked row. */
export function dragMove(v: Files, at: At, cx: Context): void {
  const press = v.press;

  if (!press) return;

  let d = v.drag;

  if (!d) {
    if (Math.hypot(at.x - press.at.x, at.y - press.at.y) < SLOP) return;

    const p = press.path;
    const paths = v.marked.has(p) ? topLevel(markedRows(v).map((r) => r.path)) : [p];

    d = { paths, into: null, ok: false, why: null, at, moving: [] };
    v.drag = d;
    v.menu = null;
  }

  d.at = at;
  aim(v, d, v.hitAt(at), cx);
  edgeScroll(v, at, cx);
  cx.notify();
}

/** The drop target under the pointer: a folder row, or the root below the
 *  rows; lit when the drop is allowed (dropRefusal). A closed folder
 *  unfolds after resting UNFOLD ms under it. */
export function aim(v: Files, d: Drag, hit: Hit | null, cx: Context): void {
  const row = hit && "row" in hit ? hit.row : null;
  const into = hit && "root" in hit ? "" : row?.dir ? row.path : null;

  if (into === d.into) return;

  d.into = into;

  if (into === null) {
    d.ok = false;
    d.why = null;

    return;
  }

  d.why = dropRefusal(d.paths.map((p) => absOf(v, p)), absOf(v, into));
  d.ok = !d.why;
  // What a drop here really moves: the rows already in the target stay.
  d.moving = d.paths.filter((p) => dirOf(p) !== into);

  if (into && row && !row.head && !v.folders.has(into)) {
    cx.timer.after(UNFOLD, (cx) => {
      if (v.drag?.into === into && !v.folders.has(into)) {
        v.toggle(into, cx);
        cx.notify();
      }
    });
  }
}

/** Near the rows' top or bottom edge, the list scrolls a row at a time while the drag stays there. */
export function edgeScroll(v: Files, at: At, cx: Context): void {
  const box = treeBox(v);
  const dir = at.y < box.top + EDGE ? -1 : at.y > box.bottom - EDGE ? 1 : 0;

  if (dir === v.edging) return;

  v.edging = dir;

  if (!dir) return;

  const step = (cx: Context): void => {
    const d = v.drag;

    if (!d || v.edging !== dir) return;

    const first = Math.floor(scrolled(v) / ROW_H);
    const shown = Math.max(1, Math.floor((box.bottom - box.top) / ROW_H) - 1);
    const to = dir < 0 ? first - 1 : first + shown;

    if (to >= 0 && to < v.listed.length) v.scroll?.scroll_to_item(to);

    aim(v, d, v.hitAt(d.at), cx);
    cx.notify();
    cx.timer.after(90, step);
  };

  step(cx);
}

/** The release: an allowed drop moves the dragged rows into the target; anything else cancels. */
export function dragEnd(v: Files, cx: Context): boolean {
  const d = v.drag;

  v.press = null;

  if (!d) return false;

  cancelDrag(v);

  if (!d.ok || d.into === null) return true;

  const into = absOf(v, d.into);
  const only = d.paths.length === 1 ? d.paths[0] : undefined;

  if (only !== undefined) {
    const src = absOf(v, only);

    moveEntry(v, src, join(into, base(src)), only, cx, "Moved to");
  } else v.moveSet(d.paths.map((p) => absOf(v, p)), into, cx);

  return true;
}

/** esc, the pointer leaving the pane, a release where nothing takes it: the drag ends, nothing moves. */
export function cancelDrag(v: Files): void {
  v.drag = null;
  v.press = null;
  v.edging = 0;
}

/** Runs the set's operations one by one: what worked is recorded and
 *  forgotten in the tree; failures are listed once all are tried. */
export function runSet(v: Files, ops: readonly SetOp[], cx: Context, said: (n: number) => string): void {
  cx.spawn(async (cx) => {
    const done: SetOp[] = [];
    const failed: string[] = [];

    for (const op of ops) {
      const r = await runOp(v, op.args);

      if (r.code === 0) done.push(op);
      else failed.push(`“${base(op.abs)}”: ${why(v, r, base(op.abs)).replace(/^“[^”]*” /, "")}`);
    }

    recordChanges(v, done.map((op) => ({ from: op.abs, to: op.to })));

    for (const op of done) forget(v, relTo(v.root, op.abs), op.to ? relTo(v.root, op.to) || null : null, op.abs);

    v.unmark();

    const ok = said(done.length);

    v.say(failed.length ? `${ok}; ${failed.length} failed: ${failed.join(" · ")}` : ok, cx, { error: failed.length > 0 });

    if (v.query.trim()) v.search(cx);

    v.refresh(cx);
    cx.notify();
  });
}

/** What a drag carries, as said: the name, or how many (over a target: how many it would move). */
export function dragLabel(v: Files, d: Drag): string {
  const list = d.ok ? d.moving : d.paths;

  return list.length === 1 ? `“${base(list[0] ?? "")}”` : `${list.length} items`;
}

/** The dragged rows' label at the pointer: the name, or how many. */
export function ghost(v: Files, t: Theme, d: Drag): Element {
  const list = d.ok ? d.moving : d.paths;
  const n = list.length;
  const first = list[0] ?? "";
  const x = Math.min(d.at.x + 14, Math.max(0, v.size.width - 160));
  const y = d.at.y + 10;

  return h_flex().id("nf-ghost").absolute().left(x).top(y).max_w(200).h(20).px(8).gap(6).items_center().text_size(11)
    .bg(t.background).border_1().border_color(d.ok ? t.accent : t.ansi8)
    .child(svg(`mods/files/${n === 1 && !rowAt(v, first)?.dir ? "file" : "folder"}.svg`).relative().size(11).flex_none().text_color(d.ok ? t.accent : t.dim))
    .child(div().min_w(0).truncate().text_color(d.ok ? t.foreground : t.muted).child(n === 1 ? base(first) : `${n} items`));
}

/** The pane's pointer: a press (a row's, the divider's), the menu on a right press,
*  moving (the divider, a drag), the release, leaving, a new size. */
export function withPointer(v: Files, el: Element): Element {
  return el
      // A row's click comes after v: alt-double-click opens a Markdown file as text.
      .on_mouse_down("left", (e, cx) => {
        if (endDivider(v)) cx.notify();

        v.alt = e.modifiers.alt;
        // A row's click comes after v: cmd and shift mark rather than open.
        v.mods = e.modifiers;
        pressAt(v, e);

        // A click in the name's input keeps it (a click on another row ends it: pick).
        if (!v.draft) v.focus();

        // A click elsewhere keeps what the delete question was about.
        if (v.ask) {
          v.ask = null;
          cx.notify();
        }
      })
      .on_mouse_down("right", (e, cx) => {
        if (e.local_position) v.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };

        const row = v.pressed ?? rootRow(v);

        v.pressed = null;
        v.openMenu(row, cx);
      })
      .on_mouse_move((e, cx) => {
        v.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };

        // The divider follows the pointer while it's held.
        if (v.dragging) {
          const f = dragShare(v.size, v.dragging, v.mouse);

          if (f !== null && f !== v.dragged) {
            v.dragged = f;
            cx.notify();
          }
        } else if (v.press) dragMove(v, v.mouse, cx);
        // A row held and moved: dragged.
      })
      .on_mouse_up("left", (_e, cx) => {
        const ended = endDivider(v);

        if (dragEnd(v, cx) || ended) cx.notify();
      })
      .on_hover((over, cx) => {
        if (over) return;

        const ended = endDivider(v);

        if (ended || v.drag) {
          cancelDrag(v);
          cx.notify();
        }
      })
      .on_size_change((size, cx) => {
        const s = { width: size.width / zoom(), height: size.height / zoom() };

        if (Math.abs(s.width - v.size.width) > 1 || Math.abs(s.height - v.size.height) > 1) {
          v.size = s;
          cx.notify();
        }
      });
}
