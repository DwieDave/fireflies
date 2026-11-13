// The process deck's Processes tab drawn: the tree's rows (fold arrows,
// agents' badges, the numbers), the selected process's detail block (its
// command line, scrolled), the question band.

import { div, svg, Background } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Row } from "./logic.ts";
import { guardOf, terminalOf, uptime, memory, oneLine, count, wheelDelta, scrollBy } from "./logic.ts";
import type { Ask, ProcRow, Rect } from "./state.ts";
import { LIST_H, ROW, ART, IND, short, CMD_LINE, CHAR_W, W, D_LEFT, D_RIGHT, CMD_SHOWN, D_TOP, D_GAP, D_LINE, D_LINES_GAP, D_FOOT, D_AFTER, CONFIRM, isProcRow, COLS } from "./state.ts";
import { zoom, unzoom, dither, toneOf, dotCell } from "./paint.ts";
import { byPid, moveTo, procOf, termPids } from "./listing.ts";
import { begin, confirm, copyRow, killHard, showTerminal } from "./actions.ts";
import { clickRow, scrollbar, wheelList } from "./pointer.ts";
import type { default as ProcsDeck } from "./main.ts";
import { spark, layer } from "./system-view.ts";
import { emptyView } from "./bars.ts";

export function pip(v: ProcsDeck, color: Color, live = false): Element {
  const el = svg(`${ART}/pip.svg`).size(6).flex_none().text_color(color);

  return live ? el.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : el;
}

export function badge(v: ProcsDeck, t: Theme, text: string, on: boolean): Element {
  return div().flex_none().h(14).px(4).flex().items_center().border(1).border_color(on ? t.ansi8 : t.ansi0).text_size(9).text_color(on ? t.muted : t.dim).child(text);
}

/** The row under the cursor: a dithered band and a blue edge, like Nocturne's menus. */
export function band(v: ProcsDeck, el: Element, t: Theme, on: boolean, edge: Color = t.accent): Element {
  return el.when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(edge)));
}

export function actionChip(v: ProcsDeck, t: Theme, id: string, label: string, color: Color | null, go: (cx: Context) => void): Element {
  return div().id(id).relative().flex_none().px(3).text_size(11).text_color(t.dim).cursor_pointer()
    .hover((s) => s.text_color(color ?? t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      go(cx);
      cx.notify();
    })
    .child(label);
}

export function numCell(v: ProcsDeck, t: Theme, w: number, text: string, color: Color | null = null): Element {
  return div().relative().w(w).flex_none().flex().justify_end().text_size(11).text_color(color ?? t.dim).child(text);
}

/** The fold arrow; a click on it (a few px around it count) folds or unfolds its row. */
export function foldArrow(v: ProcsDeck, t: Theme, r: Row, i: number): Element {
  const box = div().relative().w(6).flex_none().flex().items_center();

  if (r.open === null) return box;

  const open = r.open;

  return box.child(svg(`${ART}/${open ? "fold-open" : "fold-shut"}.svg`).size(6).text_color(t.dim))
    .child(div().id(`fold-${i}`).absolute().left(-5).right(-5).top(-4).bottom(-4).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        moveTo(v, v.list(), i);
        v.folds.set(r.key, open);
        v.focus();
        cx.notify();
      }));
}

/** One tree row (its depth's guides are the list's, procsView). */
export function treeRow(v: ProcsDeck, t: Theme, r: Row, i: number, on: boolean, ports: ReadonlyMap<number, readonly number[]>, tp: ReadonlyMap<number, string>): Element {
  const n = r.node;

  const row = h_flex().id(`row-${i}`).relative().h(ROW).flex_none().pl(12 + r.depth * IND).pr(12).gap(7).items_center().text_size(12)
    .text_color(on ? t.foreground : t.muted)
    .cursor_pointer()
    .on_click((e, cx) => clickRow(v, e, i, cx))
    .on_hover((h, cx) => {
      const k = h ? r.key : v.hover === r.key ? null : v.hover;

      if (k !== v.hover) {
        v.hover = k;
        cx.notify();
      }
    });

  const el = band(v, row, t, on).child(foldArrow(v, t, r, i));

  if (n.kind === "space") {
    if (n.machine) {
      return el.child(pip(v, t.dim)).child(div().relative().flex_none().text_color(t.muted).child(n.name))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`on ${n.machine} · this machine only for now`));
    }

    return el.child(pip(v, t.accent)).child(div().relative().flex_none().text_size(11).text_color(t.foreground).child(n.name))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(short(n.folder)))
      .child(numCell(v, t, 40, String(count(n))));
  }

  if (n.kind === "tab") {
    return el.child(div().relative().flex_none().text_size(11).text_color(t.dim).child(String(n.n)))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(on ? t.foreground : t.muted).child(n.name))
      .child(numCell(v, t, 40, String(count(n))));
  }

  if (n.kind === "term") {
    const tone = toneOf(t, n.status);

    return el.child(div().relative().child(badge(v, t, n.address, on)))
      .child(div().relative().flex_none().max_w(160).truncate().text_color(on ? t.foreground : t.muted).child(n.name))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(short(n.cwd)))
      .children(tone ? [div().relative().child(pip(v, tone, n.status === "working"))] : []);
  }

  const p = procOf(v, n.pid);

  if (!p) return el;

  const guard = guardOf(p, v.snap?.me);
  const mine = ports.get(p.pid);
  const addr = v.all ? tp.get(p.pid) : undefined;

  return el
    .child(div().relative().flex_none().max_w(130).truncate().text_color(guard ? t.dim : on ? t.foreground : t.muted).child(p.name))
    .when(Boolean(guard), (el) => el.child(svg(`${ART}/shield.svg`).size(8).flex_none().text_color(t.dim)))
    .children(addr === undefined ? [] : [div().relative().child(badge(v, t, addr, on))])
    .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(oneLine(p.args)))
    .children(mine ? [div().relative().flex_none().text_size(11).text_color(t.ansi6).child(mine.map((x) => `:${x}`).join(" "))] : [])
    .child(numCell(v, t, 34, p.cpu.toFixed(1), p.cpu >= 20 ? t.working : null))
    .child(numCell(v, t, 44, memory(p.rss)))
    .child(numCell(v, t, 54, uptime(p.secs)))
    .child(numCell(v, t, 44, String(p.pid), t.ansi8));
}

/** How many lines the command takes in the block (1 to CMD_SHOWN): as drawn once it has been,
 *  else guessed from its length. */
export function cmdLines(v: ProcsDeck, pid: number, full: string): number {
  const drawn = v.cmd.pid === pid && v.cmd.h > 0 ? Math.round(v.cmd.h / CMD_LINE) : 0;
  const guess = Math.ceil((full.length * CHAR_W) / (W - 2 - D_LEFT - D_RIGHT));

  return Math.max(1, Math.min(CMD_SHOWN, drawn || guess));
}

/** The detail block's height under the selected process's row. */
export function blockH(v: ProcsDeck, pid: number): number {
  const p = procOf(v, pid);
  const lines = p ? cmdLines(v, pid, oneLine(p.cmd)) : 1;

  return D_TOP + lines * CMD_LINE + D_GAP + D_LINE + D_LINES_GAP + D_LINE + D_FOOT + D_AFTER;
}

/** Under the selected process, set apart from the rows around it: a ground of its own (the
 *  row's dither, fainter), its whole command line, then its pid and parent with what a click
 *  can do to it, its own cpu and memory, and a dithered rule where it ends. */
export function detail(view: ProcsDeck, t: Theme, item: ProcRow): Element {
  const pid = item.node.pid;
  const h = blockH(view, pid);
  const p = procOf(view, pid);

  if (!p) return div().h(h);

  const up = procOf(view, p.ppid);
  const guard = guardOf(p, view.snap?.me);
  const full = oneLine(p.cmd);
  const here = terminalOf(pid, byPid(view), termPids());
  const meta = (k: string, v: string, c: Color | null = null): Element => h_flex().flex_none().gap(5).child(div().text_color(t.dim).child(k)).child(div().text_color(c ?? t.muted).child(v));

  return div().id(`detail-${pid}`).relative().h(h).flex_none().text_size(11)
    .child(v_flex().id("block").absolute().left(0).right(0).top(0).bottom(D_AFTER).pl(D_LEFT).pr(D_RIGHT).pt(D_TOP)
      .child(div().absolute().left(0).right(0).top(0).bottom(0).opacity(0.45).child(dither(t.ansi0, 1)))
      .child(div().absolute().left(0).top(0).bottom(0).w(1).opacity(0.7).child(dither(t.accent, 1)))
      .child(div().absolute().left(12).right(D_RIGHT).bottom(0).h(1).child(dither(t.ansi8, 1)))
      .child(command(view, t, pid, full, cmdLines(view, pid, full) * CMD_LINE))
      .child(h_flex().id("facts").relative().h(D_LINE).mt(D_GAP).flex_none().gap(14).items_center()
        .child(meta("pid", String(p.pid), t.ansi8))
        .children(up ? [meta("parent", `${up.name} ${up.pid}`)] : [])
        .child(div().flex_1())
        .when(Boolean(here), (el) => el.child(actionChip(view, t, "d-show", "show", null, () => showTerminal(view, item))))
        .child(actionChip(view, t, "d-copy", "copy", null, (cx) => copyRow(view, item, cx)))
        .when(!guard, (el) => el.child(actionChip(view, t, "d-end", "end", t.blocked, () => begin(view, item, false))))
        .when(!guard && item.node.kids.length > 0, (el) => el.child(actionChip(view, t, "d-tree", "end tree", t.blocked, () => begin(view, item, true)))))
      .child(h_flex().id("live").relative().h(D_LINE).mt(D_LINES_GAP).flex_none().gap(8).items_center()
        .child(meta("cpu", `${p.cpu.toFixed(1)}%`, p.cpu >= 20 ? t.working : null).w(78))
        .child(spark(view, t, "sp-cpu", view.hist.get(pid)?.cpu, t.working, 100))
        .child(div().w(10).flex_none())
        .child(meta("mem", memory(p.rss)).w(62))
        .child(spark(view, t, "sp-mem", view.hist.get(pid)?.rss, t.accent, null))
        .children(guard ? [div().flex_1(), h_flex().flex_none().gap(4).items_center()
          .child(svg(`${ART}/shield.svg`).size(8).text_color(t.dim)).child(div().text_color(t.dim).child(guard))] : [])));
}

/** The detail block's whole command line in `box` px; one that runs longer scrolls under the
 *  wheel (a thin thumb says so), and once it's at its end the wheel scrolls the list again. */
export function command(v: ProcsDeck, t: Theme, pid: number, full: string, box: number): Element {
  if (v.cmd.pid !== pid) v.cmd = { pid, y: 0, h: 0 };

  const c = v.cmd;
  const room = Math.max(0, c.h - box);

  c.y = Math.min(c.y, room);

  return div().id("cmd").relative().h(box).flex_none().overflow_hidden()
    .on_scroll_wheel((e, cx) => {
      const to = scrollBy(c.y, wheelDelta(e, CMD_LINE, zoom()), Math.max(0, c.h - box));

      if (to === c.y) return;

      cx.stop_propagation();
      c.y = to;
      cx.notify();
    })
    .child(div().id("cmd-text").absolute().left(0).right(0).top(-c.y).line_height(`${CMD_LINE}px`).text_color(t.muted)
      .on_size_change((size, cx) => {
        const h = Math.round(unzoom(size.height));

        if (h !== c.h) {
          c.h = h;
          cx.notify();
        }
      })
      .child(full))
    .when(room > 0, (el) => el.child(div().absolute().right(0).w(1).h(Math.max(6, Math.round((box * box) / c.h))).top(Math.round((c.y / room) * (box - Math.max(6, Math.round((box * box) / c.h)))))
      .child(dither(t.ansi8, 1))));
}

/** The band that asks before ending, then tells what held on. */
export function confirmBand(v: ProcsDeck, t: Theme, a: Ask): Element {
  const btn = (id: string, label: string, hot: boolean, go: (cx: Context) => void): Element => div().id(id).flex_none().h(20).px(8).flex().items_center().border(1).border_color(hot ? t.blocked : t.ansi0)
    .text_size(11).text_color(hot ? t.blocked : t.muted).cursor_pointer().hover((s) => s.bg(t.ansi0))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      go(cx);
      cx.notify();
    }).child(label);

  const others = a.pids.length - 1;

  const title = a.phase === "held" ? `${a.left.length > 1 ? `${a.left.length} processes are` : `${a.name} (${a.left[0]}) is`} still running.`
    : a.phase === "ending" ? `ending ${a.name}…`
    : others ? `End ${a.name} (${a.pid}) and the ${others} under it?` : `End ${a.name} (${a.pid})?`;

  const why = a.phase === "held" ? "It didn't end on TERM. Kill -9 ends it at once, without cleanup."
    : a.phase === "ending" ? "TERM sent; a moment for it to clean up."
    : [...(a.ports.length ? [`It serves ${a.ports.map((p) => `:${p}`).join(" ")}.`] : []), "TERM first: it can clean up."].join(" ");

  return v_flex().id("confirm").relative().h(CONFIRM).flex_none().px(12).py(8).gap(5)
    .child(div().absolute().left(0).top(0).right(0).bottom(0).opacity(0.22).child(dither(t.blocked, 1)))
    .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.blocked))
    .child(div().relative().text_size(12).text_color(t.blocked).truncate().child(title))
    .child(div().relative().text_size(11).text_color(t.muted).truncate().child(why))
    .child(h_flex().relative().gap(8)
      .when(a.phase === "ask", (el) => el.child(btn("c-yes", "enter · end it", true, (cx) => confirm(v, cx))).child(btn("c-no", "esc · keep", false, () => {
        v.ask = null;
      })))
      .when(a.phase === "held", (el) => el.child(btn("c-kill", "K · kill -9", true, (cx) => killHard(v, cx))).child(btn("c-leave", "esc · leave it", false, () => {
        v.ask = null;
      }))));
}

/** The processes tab: column heads, then the rows at fixed y's, scrolled to keep the cursor and its block in sight. */
export function procsView(v: ProcsDeck, t: Theme, items: readonly Row[], ci: number): Element {
  const ports = new Map<number, number[]>();

  for (const x of v.snap?.ports ?? []) {
    const list = ports.get(x.pid) ?? [];

    if (!list.includes(x.port)) list.push(x.port);

    ports.set(x.pid, list);
  }

  const tp = termPids();
  const sel = items[ci];
  const ask = v.ask;
  const extra = (r: Row): number => (ask && ask.tab === "procs" && ask.key === r.key ? CONFIRM : r === sel && isProcRow(r) ? blockH(v, r.node.pid) : 0);
  const tops: number[] = [];
  let y = 0;

  for (const r of items) {
    tops.push(y);
    y += ROW + extra(r);
  }

  const top = tops[ci];

  if (sel && top !== undefined && v.follow) {
    const b = top + ROW + extra(sel);

    if (top < v.scroll.procs) v.scroll.procs = top;

    if (b > v.scroll.procs + LIST_H) v.scroll.procs = b - LIST_H;
  }

  const max = Math.max(0, y - LIST_H);

  v.scroll.procs = Math.max(0, Math.min(v.scroll.procs, max));

  const s = v.scroll.procs;
  const kids: Element[] = [];
  // The depth guides of every row in sight as one 1 px dithered path over the rows (one
  // element for the list, not two a level a row).
  const guides: Rect[] = [];

  items.forEach((r, i) => {
    const top = tops[i] ?? 0;
    const h = ROW + extra(r);

    if (top + h <= s || top >= s + LIST_H) return;

    for (let g = 0; g < r.depth; g++) guides.push({ x: 12 + g * IND + 3, y: top - s, w: 1, h: ROW });

    const on = i === ci;
    const under = h > ROW ? (ask?.key === r.key ? confirmBand(v, t, ask) : isProcRow(r) ? detail(v, t, r) : null) : null;

    kids.push(v_flex().id(`slot-${r.key}`).absolute().left(0).right(0).top(top - s).h(h)
      .child(treeRow(v, t, r, i, on, ports, tp))
      .children(under ? [under] : []));
  });

  const head = (w: number, text: string): Element => div().w(w).flex_none().flex().justify_end().child(text);

  return v_flex().id("procs").h(COLS + LIST_H).flex_none()
    .child(h_flex().h(COLS).flex_none().px(12).gap(7).items_center().text_size(9).text_color(t.ansi8).opacity(0.8)
      .child(div().flex_1().child(v.all ? `ALL OF ${(v.snap?.me ?? "").toUpperCase()}'S` : "THIS APP'S TERMINALS"))
      .child(head(34, "CPU")).child(head(44, "MEM")).child(head(54, "UP")).child(head(44, "PID")))
    .child(items.length
      ? div().id("procs-list").relative().h(LIST_H).flex_none().overflow_hidden()
        .on_scroll_wheel((e, cx) => wheelList(v, "procs", e, ROW, max, cx))
        .children(kids)
        .children([...layer(v, guides, Background.checkerboard(t.ansi0, dotCell()).opacity(0.9), W - 2, LIST_H), ...scrollbar(v, t, "procs", y, LIST_H)])
      : emptyView(v, t, LIST_H));
}
