// A workflow run as a constellation, left to right: the run, then its jobs
// in columns (model.ts jobColumns: by `needs:`, else by time). Drawn like
// agent-graph' graph (its dithered elbow lines, the pulse running into
// what works, breathing stripes; copied, since mods can't share files),
// and each job carries a strip of its steps, one dithered cell per step in
// its color, so a run's progress reads at a glance. Lines follow each job's
// own `needs:` (model.ts jobParents) when the workflow is known, routed in
// wires.ts: shared needs merge on one bus and split on another.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { dither, pip, toneColor, stop, ART } from "./kit.ts";
import type { Job, Run, Step } from "./model.ts";
import { tone, duration } from "./model.ts";
import type { JobBox, Routed } from "./wires.ts";
import { route, NW, NH, RW } from "./wires.ts";

export { NW, NH, GAP_X, GAP_Y, PAD, RW } from "./wires.ts";

/** Which jobs each job waits for (model.ts jobParents), or null. */
export type Parents = ReadonlyMap<number, readonly number[]> | null;

/** Positions and lines (wires.ts route): `parents` as canvas takes them. */
export function layout(cols: readonly (readonly Job[])[], parents: Parents = null, run: Run | null = null): Routed<Job> {
  return route(cols, parents, run ? tone(run.status, run.conclusion) : "done");
}

/** The lines, under the boxes: dithered, a pulse running into what works. */
function lines(t: Theme, g: Routed<Job>): Element[] {
  const color = { working: t.working, done: t.ansi8, dim: t.dim } as const;

  return [
    ...g.segs.map((s) => div().absolute().left(s.x).top(s.y).w(s.w).h(s.h).child(dither(color[s.tone], 1))),
    ...g.pulses.map((p) => div().absolute().top(p.y - 2).w(6).h(4).bg(t.working).loop("left", { from: p.from, to: p.to - 6, period: 1000, easing: "linear" })),
  ];
}

/** The strip of a job's steps: a cell per step, the running one breathing. */
function strip(t: Theme, steps: readonly Step[], w: number): Element {
  if (!steps.length) return div().h(3);

  const cell = Math.max(2, Math.floor((w - (steps.length - 1)) / steps.length));

  return h_flex().h(3).gap(1).overflow_hidden().children(steps.map((s, i) => {
    const k = tone(s.status, s.conclusion);
    const el = div().id(`st-${i}`).relative().w(cell).h(3).flex_none().child(dither(k === "queued" ? t.ansi0 : toneColor(t, k), 1));

    return k === "working" ? el.loop("opacity", { from: 0.3, to: 1, period: 900 }) : el;
  }));
}

/** What a press on a job does. */
export type OnPick = (n: JobBox<Job>, cx: Context) => void;

/** One job. */
function jobNode(t: Theme, n: JobBox<Job>, sel: boolean, focused: boolean, onPick: OnPick): Element {
  const color = toneColor(t, n.tone);
  const steps = n.job.steps ?? [];
  const done = steps.filter((s) => s.status === "completed").length;
  const time = duration(n.job.started_at, n.job.completed_at);
  const stripe = div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1));

  return div().id(`job-${n.job.id}`).absolute().left(n.x).top(n.y).w(NW).h(NH).bg(t.background)
    .border(1).border_color(sel ? (focused ? t.accent : t.foreground) : n.tone === "working" ? color : n.tone === "failed" ? `${color}aa` : t.ansi0)
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => onPick(n, cx))
    .hover((s) => s.border_color(t.foreground))
    .when(sel, (el) => el.child(dither(`${t.accent}30`, 1)))
    .child(n.tone === "working" ? stripe.loop("opacity", { from: 0.3, to: 1, period: 1300 }) : stripe)
    .child(v_flex().relative().size_full().pl(12).pr(7).pt(5).gap(3)
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(pip(t, n.tone, 7))
        .child(div().flex_1().min_w(0).truncate().text_color(n.tone === "skipped" || n.tone === "queued" ? t.muted : t.foreground).child(n.job.name ?? "")))
      .child(h_flex().gap(6).text_size(10)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(steps.length ? `${done}/${steps.length} steps` : n.tone === "queued" ? "waiting for a runner" : ""))
        .child(div().flex_none().text_color(n.tone === "working" ? t.working : t.muted).child(time)))
      .child(strip(t, steps, NW - 20)));
}

/** The run's own node, where the lines start. */
function runNode(t: Theme, r: Run, x: number, y: number): Element {
  const k = tone(r.status, r.conclusion), color = toneColor(t, k);

  return div().id("run-node").absolute().left(x).top(y).w(RW).h(NH).bg(t.background).border(1).border_color(k === "working" ? color : t.ansi0)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1)))
    .child(v_flex().relative().size_full().pl(12).pr(7).justify_center().gap(2)
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(svg(`${ART}/wings.svg`).size(12).flex_none().text_color(k === "working" ? t.working : t.foreground)
          .when(k === "working", (el) => el.loop("opacity", { from: 0.4, to: 1, period: 700 })))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.name ?? "run")))
      .child(div().text_size(10).text_color(t.dim).truncate().child(`#${r.run_number ?? ""} · ${r.event ?? ""} · ${duration(r.run_started_at, k === "working" || k === "queued" ? null : r.updated_at)}`)));
}

/** The drawn canvas and where its boxes are. */
export type Canvas = Routed<Job> & { readonly el: Element };

/** The canvas: lines under nodes. `sel` is the selected job id; `parents`
 *  (model.ts jobParents) says which jobs each waits for, or null: then each
 *  column follows the whole column before it. */
export function canvas(t: Theme, run: Run, cols: readonly (readonly Job[])[], parents: Parents, sel: number | null, focused: boolean, onPick: OnPick, panX: number, panY: number): Canvas {
  const g = layout(cols, parents, run);

  const el = div().id("run-canvas").absolute().left(panX).top(panY).w(g.width).h(g.height)
    .children(lines(t, g))
    .child(runNode(t, run, g.run.x, g.run.y))
    .children(g.nodes.map((n) => jobNode(t, n, n.job.id === sel, focused, onPick)));

  return { el, ...g };
}
