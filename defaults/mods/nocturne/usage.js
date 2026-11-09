// The sky's usage section, at its foot below the hills (sky.js lifts them to
// make room): the Claude account's limits (limits.js) in two small rows.
//
//   candle   the 5-hour window: its flame (gone once it's out), what's left,
//            a path of what's used, and when the candle is fresh again
//   moon     the weekly window: the moon in the phase of what's left
//   folded   the eyebrow alone, with both numbers beside it; click it (or
//            the chevron) to fold and open. Kept in shared(FOLDED).
//   a row    click: the full usage pane (nocturne-usage) beside the focused
//            pane; again closes it (as + new > Usage does)

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, shared, setShared } from "herdr";
import { ART, dither, eyebrow } from "./kit.js";
import { lastUsage, usageNote, refreshUsage } from "./limits.js";

const FOLDED = "nocturne.usageFolded";
const OWN = "mods/nocturne-usage/art";
const TICK = 30_000;
const stop = (_e, cx) => cx.stop_propagation();
const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const left = (w) => Math.max(0, Math.min(100, Math.round(100 - w.used)));
const tone = (t, used) => (used >= 85 ? t.blocked : used >= 60 ? t.working : t.done);

function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const clock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The usage pane in the shown tab, if it's open. */
export function usagePane() {
  const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
  return panes().find((p) => p.mod === "nocturne-usage" && p.tab === tab) ?? null;
}

/** Opens the usage pane beside the focused pane, or closes it. */
export function toggleUsage() {
  const open = usagePane();
  if (open) return run("pane.close", { pane: open.pane });
  const focused = panes().find((p) => p.focused)?.pane;
  run("pane.split", { direction: "auto", ...(focused ? { pane: focused } : {}), mod: "nocturne-usage", props: {} });
}

export class UsageSection {
  init(cx) {
    this.height = 0; // as last drawn, px
    // Ask when the shared answer is old (whichever copy is shown first asks);
    // the tick also keeps the countdowns moving.
    const tick = (cx) => { cx.spawn(async () => { await refreshUsage(); }); cx.notify(); };
    tick(cx);
    cx.timer.every(TICK, tick);
  }

  get folded() { return Boolean(shared(FOLDED)); }

  /** One window: its mark, the numbers, the path, when it comes back. */
  row(t, id, mark, label, w, back) {
    const r = left(w);
    return h_flex().id(id).relative().px(16).py(4).gap(10).items_center()
      .hover((s) => s.bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); toggleUsage(); })
      .child(div().w(20).h(22).flex_none().flex().items_center().justify_center().child(mark))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_baseline().text_size(11)
          .child(div().flex_none().text_color(t.ansi8).child(label))
          .child(div().flex_1())
          .child(div().flex_none().text_color(r === 0 ? t.blocked : t.foreground).child(`${r}%`))
          .child(div().flex_none().text_color(t.ansi8).child("left")))
        .child(div().relative().h(4).w_full()
          .child(div().absolute().left(0).right(0).top(1).h(2).child(dither(t.ansi8, 1)))
          // The used share, as a fraction of the row: flex weights, not pixels.
          .child(h_flex().absolute().left(0).right(0).top(0).h(4)
            .child(div().h_full().flex_grow(Math.max(0.001, Math.min(100, w.used))).bg(tone(t, w.used)))
            .child(div().h_full().flex_grow(Math.max(0.001, 100 - Math.min(100, w.used))))))
        .when(Boolean(back), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(back))));
  }

  candle(t, w) {
    const out = left(w) === 0;
    return div().relative().w(14).h(22)
      .child(div().absolute().left(4).bottom(0).w(6).h(out ? 4 : 4 + Math.round((left(w) / 100) * 6)).bg(t.ansi7))
      .when(!out, (el) => el.child(svg(`${OWN}/flame-a.svg`).w(7).h(11).absolute().left(3).top(2).text_color(t.working)
        .loop("opacity", { from: 0.35, to: 1, period: 800 })));
  }

  /** The folded rail's usage: the candle and the moon, each over what's left. Click: the usage pane. */
  rail(t) {
    const d = lastUsage();
    const cell = (id, mark, w, label) => v_flex().id(id).w(56).py(4).gap(2).flex_none().items_center()
      .hover((s) => s.bg(t.ansi0))
      .tooltip(`${label}: ${left(w)}% left`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); toggleUsage(); })
      .child(div().h(22).flex().items_center().justify_center().child(mark))
      .child(div().text_size(10).text_color(left(w) === 0 ? t.blocked : t.foreground).child(`${left(w)}%`))
      // What's used, as a thin bar in the tone of how close the limit is.
      .child(h_flex().w(36).h(2)
        .child(div().h_full().flex_grow(Math.max(0.001, Math.min(100, w.used))).bg(tone(t, w.used)))
        .child(div().h_full().flex_grow(Math.max(0.001, 100 - Math.min(100, w.used))).relative().child(dither(t.ansi8, 1))));
    if (!d) return v_flex().id("usage-rail").pb(10).items_center().child(div().text_size(10).text_color(t.dim).child("usage …"));
    return v_flex().id("usage-rail").pb(10).gap(4).flex_none().items_center()
      .child(div().w(24).h(2).mb(2).relative().child(dither(t.ansi8, 1)))
      .when(Boolean(d.session), (el) => el.child(cell("usage-rail-5h", this.candle(t, d.session), d.session, "5-hour window")))
      .when(Boolean(d.week), (el) => el.child(cell("usage-rail-wk", svg(`${ART}/moon-${Math.round((left(d.week) / 100) * 8)}.svg`).size(18).text_color(t.ansi7), d.week, "week")));
  }

  render(t) {
    const d = lastUsage(), note = usageNote();
    const folded = this.folded;
    const nums = d ? [d.session, d.week].filter(Boolean).map((w) => `${left(w)}%`).join(" · ") : "";
    const head = h_flex().id("usage-fold").px(16).pb(4).gap(6).items_center()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); setShared(FOLDED, !folded); })
      .child(div().flex_none().child(eyebrow(t, "usage")))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(folded ? "▸" : "▾"))
      .child(div().flex_1())
      .when(folded && Boolean(nums), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(nums)));
    // Its height lifts the sky's hills (sky.js), so the landscape rests on it.
    const box = v_flex().id("usage").pt(4).pb(8).flex_none().child(head)
      .on_size_change((size, cx) => { if (size.height !== this.height) { this.height = size.height; cx.notify(); } });
    if (folded) return box;
    if (!d) {
      const say = !note ? "asking the moon…" : note.state === "nologin" ? "no Claude login here" : note.state === "expired" ? "the login is napping" : "couldn't reach the moon";
      return box.child(div().px(16).py(4).text_size(11).text_color(t.dim).child(say));
    }
    const now = Date.now();
    const s = d.session, wk = d.week;
    return box
      .when(Boolean(s), (el) => el.child(this.row(t, "usage-5h", this.candle(t, s), "5h", s,
        s.resets ? (left(s) === 0 ? `relit at ${clock(s.resets)}` : `fresh in ${span(s.resets - now)}`) : null)))
      .when(Boolean(wk), (el) => el.child(this.row(t, "usage-wk", svg(`${ART}/moon-${Math.round((left(wk) / 100) * 8)}.svg`).size(20).text_color(t.ansi7), "week", wk,
        wk.resets ? `full ${DAYS[new Date(wk.resets).getDay()]} ${clock(wk.resets)} · in ${span(wk.resets - now)}` : null)));
  }
}
