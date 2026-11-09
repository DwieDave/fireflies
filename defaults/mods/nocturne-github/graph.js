// A workflow run as a constellation, left to right: the run, then its jobs
// in columns (model.js jobColumns: by `needs:`, else by time). Drawn like
// nocturne-agents' graph (its dithered elbow lines, the pulse running into
// what works, breathing stripes; copied, since mods can't share files),
// and each job carries a strip of its steps, one dithered cell per step in
// its color, so a run's progress reads at a glance.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { dither, pip, toneColor, stop, ART } from "./kit.js";
import { tone, duration } from "./model.js";

export const NW = 214, NH = 44, GAP_X = 56, GAP_Y = 10, PAD = 18, RW = 170;

/** Positions: the run node and each job's { x, y, col, row }. */
export function layout(cols) {
  const heights = cols.map((c) => c.length * NH + Math.max(0, c.length - 1) * GAP_Y);
  const tall = Math.max(NH, ...heights);
  const nodes = [];
  cols.forEach((c, ci) => {
    const top = PAD + Math.round((tall - heights[ci]) / 2);
    c.forEach((job, ri) => nodes.push({ job, col: ci, row: ri, x: PAD + RW + GAP_X + ci * (NW + GAP_X), y: top + ri * (NH + GAP_Y) }));
  });
  const run = { x: PAD, y: PAD + Math.round((tall - NH) / 2) };
  return { run, nodes, width: PAD * 2 + RW + cols.length * (NW + GAP_X), height: PAD * 2 + tall };
}

const seg = (color, x, y, w, h) => div().absolute().left(x).top(y).w(Math.max(1, w)).h(Math.max(1, h)).child(dither(color, 1));

/** Lines from one column (or the run) into the next, through a bus at the gap's middle. */
function edges(t, from, to) {
  if (!to.length) return [];
  const out = [];
  const right = from[0].x + from[0].w;
  const mid = right + Math.round(GAP_X / 2);
  const ys = [...from, ...to].map((n) => n.y + Math.round(NH / 2));
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const live = to.some((n) => n.tone === "working");
  out.push(seg(live ? t.working : t.ansi8, mid - 1, top - 1, 2, bottom - top + 2));
  for (const n of from) out.push(seg(n.tone === "done" ? t.ansi8 : toneColor(t, n.tone === "working" ? "working" : "stopped"), right, n.y + Math.round(NH / 2) - 1, mid - right, 2));
  for (const n of to) {
    const cy = n.y + Math.round(NH / 2);
    const color = toneColor(t, n.tone);
    out.push(seg(n.tone === "queued" || n.tone === "skipped" ? t.ansi0 : n.tone === "working" ? color : t.ansi8, mid, cy - 1, n.x - mid, 2));
    if (n.tone === "working") {
      out.push(div().absolute().top(cy - 2).w(6).h(4).bg(color).loop("left", { from: mid, to: n.x - 6, period: 1000, easing: "linear" }));
    }
  }
  return out;
}

/** The strip of a job's steps: a cell per step, the running one breathing. */
function strip(t, steps, w) {
  if (!steps?.length) return div().h(3);
  const cell = Math.max(2, Math.floor((w - (steps.length - 1)) / steps.length));
  return h_flex().h(3).gap(1).overflow_hidden().children(steps.map((s, i) => {
    const k = tone(s.status, s.conclusion);
    const el = div().id(`st-${i}`).relative().w(cell).h(3).flex_none().child(dither(k === "queued" ? t.ansi0 : toneColor(t, k), 1));
    return k === "working" ? el.loop("opacity", { from: 0.3, to: 1, period: 900 }) : el;
  }));
}

/** One job. */
function jobNode(t, n, sel, focused, onPick) {
  const color = toneColor(t, n.tone);
  const steps = n.job.steps ?? [];
  const done = steps.filter((s) => s.status === "completed").length;
  const time = duration(n.job.started_at, n.job.completed_at);
  const stripe = div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1));
  return div().id(`job-${n.job.id}`).absolute().left(n.x).top(n.y).w(NW).h(NH).bg(t.background)
    .border(1).border_color(sel ? (focused ? t.accent : t.foreground) : n.tone === "working" ? color : n.tone === "failed" ? color + "aa" : t.ansi0)
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => onPick(n, cx))
    .hover((s) => s.border_color(t.foreground))
    .when(sel, (el) => el.child(dither(t.accent + "30", 1)))
    .child(n.tone === "working" ? stripe.loop("opacity", { from: 0.3, to: 1, period: 1300 }) : stripe)
    .child(v_flex().relative().size_full().pl(12).pr(7).pt(5).gap(3)
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(pip(t, n.tone, 7))
        .child(div().flex_1().min_w(0).truncate().text_color(n.tone === "skipped" || n.tone === "queued" ? t.muted : t.foreground).child(n.job.name)))
      .child(h_flex().gap(6).text_size(10)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(steps.length ? `${done}/${steps.length} steps` : n.tone === "queued" ? "waiting for a runner" : ""))
        .child(div().flex_none().text_color(n.tone === "working" ? t.working : t.muted).child(time)))
      .child(strip(t, steps, NW - 20)));
}

/** The run's own node, where the lines start. */
function runNode(t, r, x, y) {
  const k = tone(r.status, r.conclusion), color = toneColor(t, k);
  return div().id("run-node").absolute().left(x).top(y).w(RW).h(NH).bg(t.background).border(1).border_color(k === "working" ? color : t.ansi0)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1)))
    .child(v_flex().relative().size_full().pl(12).pr(7).justify_center().gap(2)
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(svg(`${ART}/wings.svg`).size(12).flex_none().text_color(k === "working" ? t.working : t.foreground)
          .when(k === "working", (el) => el.loop("opacity", { from: 0.4, to: 1, period: 700 })))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.name ?? "run")))
      .child(div().text_size(10).text_color(t.dim).truncate().child(`#${r.run_number} · ${r.event} · ${duration(r.run_started_at, k === "working" || k === "queued" ? null : r.updated_at)}`)));
}

/** The canvas: lines under nodes. `sel` is the selected job id. */
export function canvas(t, run, cols, sel, focused, onPick, panX, panY) {
  const g = layout(cols);
  const byCol = cols.map((_, ci) => g.nodes.filter((n) => n.col === ci));
  for (const n of g.nodes) { n.tone = tone(n.job.status, n.job.conclusion); n.w = NW; }
  const runN = { ...g.run, w: RW, tone: tone(run.status, run.conclusion) };
  const lines = byCol.flatMap((c, ci) => edges(t, ci === 0 ? [runN] : byCol[ci - 1], c));
  const el = div().id("run-canvas").absolute().left(panX).top(panY).w(g.width).h(g.height)
    .children(lines)
    .child(runNode(t, run, g.run.x, g.run.y))
    .children(g.nodes.map((n) => jobNode(t, n, n.job.id === sel, focused, onPick)));
  return { el, ...g };
}
