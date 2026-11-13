// The script runner's list drawn: a run's row with its chips, a script's row,
// a section's head, the counts, the empty state.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import { isString } from "./guard.ts";
import type { Row } from "./detect.ts";
import type { Run, Tone } from "./runs.ts";
import { elapsed, tone } from "./runs.ts";
import { hint } from "./keyhelp.ts";
import { short, SECTION, ART, CHIP, CHIPS_W, ICON, OWN, ROW, aside } from "./state.ts";
import type { Asked, Chip, Item, Top } from "./state.ts";
import { dither, eyebrow, toneColor } from "./paint.ts";
import { goTo } from "./found.ts";
import type { default as ScriptsDeck } from "./main.ts";

/** A word that acts on a click (‹ back, cancel): dim, lit under the pointer. */
export function actionChip(t: Theme, id: string, label: string, color: Color | null, go: (cx: Context) => void) {
  return div().id(id).relative().flex_none().px(3).text_size(11).text_color(t.dim).cursor_pointer()
    .hover((s) => s.text_color(color ?? t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
    .child(label);
}

export function pip(color: Color, live: boolean) {
  const el = svg(`${ART}/pip.svg`).size(6).flex_none().text_color(color);

  return live ? el.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : el;
}

export function badge(t: Theme, text: string, on: boolean, w?: number) {
  const el = div().flex_none().h(14).px(4);

  return (w === undefined ? el : el.w(w).justify_center()).flex().items_center()
    .border(1).border_color(on ? t.ansi8 : t.ansi0).text_size(9).text_color(on ? t.muted : t.dim).child(text);
}

export function section(t: Theme, label: string, aside: string | Element | null) {
  const head = h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center()
    .child(eyebrow(t, label))
    .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)));

  if (aside === null || aside === "") return head;

  return head.child(isString(aside) ? div().flex_none().text_size(10).text_color(t.dim).child(aside) : aside);
}

/** The row under the cursor: a dithered band and a blue edge, like Nocturne's menus. */
export function band(el: Element, t: Theme, on: boolean) {
  return on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
}

/**
 * A run's control: a square chip CHIP px tall, its mark and its key, a frame
 * that lights under the pointer (in `color` for remove and stop). Asking
 * ("stop?"), it's filled in that color and says so. A tooltip names it.
 */
export function runChip(t: Theme, id: string, c: Chip, go: (cx: Context) => void) {
  const { mark, key, tip, color = null, asking = false, ask = "" } = c;
  const fill = color ?? t.foreground;

  return h_flex().id(id).relative().flex_none().h(CHIP).px(5).gap(4).items_center().text_size(10)
    .border(1).border_color(asking ? fill : t.ansi0).text_color(asking ? t.background : t.muted)
    .when(asking, (el) => el.bg(fill))
    .hover((s) => (asking ? s : s.border_color(color ?? t.ansi8).text_color(fill).bg(t.ansi0)))
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
    // Asking, the word takes the chip ("stop?"); else its mark and its key.
    .when(!asking, (el) => el.child(svg(mark).size(11).flex_none().text_color(color ?? t.muted)))
    .child(div().flex_none().child(asking ? ask : key));
}

/** The chips on a run's row: watch and again, then set apart remove (stop while it runs). */
export function runChips(v: ScriptsDeck, t: Theme, r: Run, i: number) {
  const asked = (what: Asked) => v.asking?.address === r.address && v.asking.what === what && Date.now() < v.asking.until;

  return h_flex().id(`chips-${i}`).relative().max_w(CHIPS_W).flex_none().gap(4).items_center()
    .child(runChip(t, `w-${i}`, { mark: ICON("eye"), key: "w", tip: r.live ? "Watch it (w, enter)" : "Its output (w, enter)" }, (cx) => v.act("watch", r, cx)))
    .child(runChip(t, `a-${i}`, { mark: OWN("rotate-cw"), key: "R", tip: r.live ? "Run it again: stops this one first (R)" : "Run it again (R)", asking: asked("again"), ask: "again?", color: asked("again") ? t.working : null }, (cx) => v.act("again", r, cx)))
    // Set apart: a gap and a rule, so it isn't hit for its neighbours.
    .child(div().w(1).h(14).mx(4).flex_none().bg(t.ansi0))
    .child(r.live
      ? runChip(t, `s-${i}`, { mark: ICON("square"), key: "x", tip: "Stop it (x, twice)", color: t.blocked, asking: asked("stop"), ask: "stop?" }, (cx) => v.act("stop", r, cx))
      : runChip(t, `d-${i}`, { mark: ICON("x"), key: "x", tip: "Remove it from the list (x)", color: t.blocked }, (cx) => v.act("dismiss", r, cx)));
}

export function runRow(v: ScriptsDeck, t: Theme, r: Run, i: number, on: boolean) {
  const color = toneColor(t, tone(r));
  const show = on || v.hover === `r${i}`;

  return band(h_flex().id(`run-${i}`).relative().h(ROW).flex_none().px(12).gap(6).items_center().text_size(12)
    .text_color(on ? t.foreground : r.live ? t.muted : t.dim)
    .on_hover((h, cx) => {
      const k = h ? `r${i}` : v.hover === `r${i}` ? null : v.hover;

      if (k !== v.hover) { v.hover = k; cx.notify(); }
    })
    .on_click((_e, cx) => { v.cursor = i; v.act("watch", r, cx); }), t, on)
    .child(div().relative().w(8).flex_none().flex().items_center().child(pip(color, r.live)))
    .child(h_flex().relative().flex_1().min_w(0).gap(6).items_center()
      .child(div().min_w(0).truncate().child(r.name))
      .when(Boolean(r.admin), (el) => el.child(lock(t, on))))
    // With its chips showing, they take the runner's badge's place, before
    // the status and the time: those stay in their columns on every row,
    // and only this row's name gives up room.
    .when(Boolean(r.runner) && !show, (el) => el.child(div().relative().child(badge(t, r.runner, on))))
    .when(show, (el) => el.child(runChips(v, t, r, i)))
    .child(div().relative().w(58).flex_none().text_size(11).truncate().text_color(r.reason === "killed" ? t.dim : color).child(r.word))
    .child(div().relative().w(46).flex_none().text_size(11).text_color(t.dim).flex().justify_end().child(elapsed(r)));
}

/** A script's name, the matched letters in blue. */
export function nameCell(t: Theme, text: string, hits: readonly number[], base: Color) {
  if (!hits.length) return div().truncate().text_color(base).child(text);

  const parts: [string, boolean][] = [];
  let cur = "", lit = false;

  [...text].forEach((ch, i) => {
    const h = hits.includes(i);

    if (h !== lit && cur) { parts.push([cur, lit]); cur = ""; }

    lit = h;
    cur += ch;
  });

  if (cur) parts.push([cur, lit]);

  return h_flex().min_w(0).overflow_hidden().children(parts.map(([s, h]) => div().flex_none().text_color(h ? t.accent : base).child(s.replace(/ /g, " "))));
}

export function scriptRow(v: ScriptsDeck, t: Theme, row: Row, i: number, on: boolean, running: boolean) {
  const s = row.s;

  return band(h_flex().id(`sc-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_size(12)
    // Only a pointer that moved takes the cursor: one resting where the deck
    // opened would otherwise steal it from the keys.
    .on_hover((h, cx) => { if (h && v.moved && v.cursor !== i) { v.cursor = i; cx.notify(); } })
    .on_click((e) => { if (!v.gone) { v.gone = true; goTo(v, s, e.modifiers.shift); } }), t, on)
    .child(div().relative().child(badge(t, s.runner, on, 52)))
    .child(h_flex().relative().flex_none().max_w(250).min_w(0).gap(6).items_center()
      .child(nameCell(t, s.name, row.hits, on ? t.foreground : t.muted))
      .when(Boolean(s.admin), (el) => el.child(lock(t, on)))
      .when(Boolean(s.here), (el) => el.child(div().flex_none().text_size(10).text_color(t.accent)
        .child((v.sys.os ?? "").toLowerCase() === "darwin" ? "this mac" : "this machine")))
      .when(running, (el) => el.child(pip(t.working, true))))
    // The name comes first; what it runs takes the room that's left.
    .child(h_flex().relative().flex_1().min_w(0).justify_end()
      .child(div().min_w(0).truncate().text_size(11).text_color(on ? t.muted : t.dim).child(aside(s))));
}

/** Runs as root (asks for a password first): a small pixel lock. */
export function lock(t: Theme, on: boolean) {
  return svg(`${ART}/lock.svg`).size(9).flex_none().text_color(on ? t.working : t.dim);
}

/** A bar entry: the key in the accent, what it does dimmed (keyhelp.ts, as every Nocturne bar). */
export function keyHint(t: Theme, id: string, key: string, what: string) {
  return hint(t, id, key, what);
}

/** The runs header's aside: a pip and a count for each state there is. */
export function tally(v: ScriptsDeck, t: Theme, all: readonly Run[]) {
  const tones: readonly Tone[] = ["running", "failed", "ok", "stopped"];

  const parts = tones.flatMap((k) => {
    const c = all.filter((r) => tone(r) === k).length;

    return c ? [[k, c] as const] : [];
  });

  return h_flex().flex_none().gap(8).items_center().children(parts.map(([k, c]) => h_flex().id(`tally-${k}`).gap(4).items_center()
    .child(pip(toneColor(t, k), false))
    .child(div().text_size(10).text_color(k === "running" ? t.muted : t.dim).child(String(c)))));
}

export function emptyView(v: ScriptsDeck, t: Theme) {
  const say = !v.folder ? "No folder here: open a space or focus a terminal in one."
    : v.failed ? `Couldn't look in ${short(v.folder)}: ${v.failed}`
    : v.looking && !v.scripts ? "looking…"
    : v.query ? `Nothing matches "${v.query}".`
    : `Nothing to run in ${short(v.folder)}: no package.json, justfile, Makefile, Cargo.toml, deno.json, pyproject.toml, Taskfile, mise.toml, composer.json, go.mod, scripts/ or bin/.`;

  return div().px(12).py(12).text_size(11).text_color(t.dim).child(say);
}

/** The rows' places and how far the list scrolls. */
interface Placed {
  readonly tops: readonly Top[];
  readonly max: number;
}

/** Where each script row (and its group's head) sits in the list, the list
 *  scrolled so the cursor's row is in sight. */
export function placeRows(v: ScriptsDeck, rows: readonly Row[], cur: Item | undefined, runs: number, listH: number): Placed {
  // The scripts: each row (and its group's head) at a fixed y, scrolled to keep the cursor in sight.
  const tops: Top[] = [];
  let y = 0;
  rows.forEach((r, i) => {
    const head = !v.query.trim() && (i === 0 || r.head !== rows[i - 1]?.head);
    tops.push({ head, title: y, row: y + (head ? SECTION : 0) });
    y += (head ? SECTION : 0) + ROW;
  });
  const max = Math.max(0, y - listH);
  const sel = cur?.kind === "script" ? tops[v.cursor - runs] : undefined;

  if (sel) {
    const from = sel.head ? sel.title : sel.row;

    if (from < v.scroll) v.scroll = from;

    if (sel.row + ROW > v.scroll + listH) v.scroll = sel.row + ROW - listH;
  }

  v.scroll = Math.max(0, Math.min(v.scroll, max));

  return { tops, max };
}
