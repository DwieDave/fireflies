// The sky's usage section, at its foot below the hills (sky.js lifts them to
// make room): the picked provider's limits (limits.js) in two small rows.
//
//   the switch   the providers' logos in the eyebrow (Claude, Codex); the lit
//                one is shown here and in the usage pane. Click one to pick it.
//   hourglass    the short window (5 hours): the sand in the top bulb is
//                what's left, a path of what's used, and when it's turned
//   moon         the weekly window: the moon in the phase of what's left
//   the plus     on each path: where the clock is in the window, so ahead or
//                behind pace reads at a glance (as in the usage pane)
//   folded       the eyebrow alone, with both numbers beside it; click it (or
//                the chevron) to fold and open. Kept in shared(FOLDED).
//   a row        click: the full usage pane (nocturne-usage) beside the
//                focused pane; again closes it (as + new > Usage does)

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, shared, setShared } from "herdr";
import { ART, dither, eyebrow } from "./kit.js";
import { PROVIDERS, provider, pickProvider, lastUsage, usageNote, refreshUsage, windowName } from "./limits.js";

const FOLDED = "nocturne.usageFolded";
const TICK = 30_000;
const stop = (_e, cx) => cx.stop_propagation();
const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const left = (w) => Math.max(0, Math.min(100, Math.round(100 - w.used)));
const used = (w) => Math.max(0, Math.min(100, w.used));
const tone = (t, u) => (u >= 85 ? t.blocked : u >= 60 ? t.working : t.done);
/** Eighths of what's left: the moon's phase, the hourglass's sand. */
const eighths = (w) => Math.round((left(w) / 100) * 8);

const HOUR = 3600_000;
/** The picked provider's last answer, its windows' lengths filled in (answers saved before they had them were Claude's 5 h and 7 d). */
function reading() {
  const d = lastUsage();
  if (!d) return null;
  const sized = (w, length) => w && { length, ...w };
  return { ...d, session: sized(d.session, 5 * HOUR), week: sized(d.week, 168 * HOUR) };
}

/** How far through its window the clock is, 0–1 (null without a reset time or length). */
function elapsed(w) {
  if (!w?.resets || !w.length) return null;
  return Math.max(0, Math.min(1, 1 - (w.resets - Date.now()) / w.length));
}

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

/** Picks provider `id` and asks it for its usage if its answer is old. */
function pick(id, cx) {
  pickProvider(id);
  cx.spawn(async () => { await refreshUsage(false, id); });
}

export class UsageSection {
  init(cx) {
    this.height = 0; // as last drawn, px
    // Ask when the shared answer is old (whichever copy is shown first asks);
    // the tick also keeps the countdowns and the clock's plus moving.
    const tick = (cx) => { cx.spawn(async () => { await refreshUsage(); }); cx.notify(); };
    tick(cx);
    cx.timer.every(TICK, tick);
  }

  get folded() { return Boolean(shared(FOLDED)); }

  /** The path: what's used in the tone of how close the limit is, and the plus where the clock is. */
  path(t, w, width = null) {
    const u = used(w), now = elapsed(w);
    const el = div().relative().h(6).flex_none();
    return (width ? el.w(width) : el.w_full())
      .child(div().absolute().left(0).right(0).top(2).h(2).child(dither(t.ansi8, 1)))
      // Shares of the row as flex weights, not pixels.
      .child(h_flex().absolute().left(0).right(0).top(1).h(4)
        .child(div().h_full().flex_grow(Math.max(0.001, u)).bg(tone(t, u)))
        .child(div().h_full().flex_grow(Math.max(0.001, 100 - u))))
      .when(now != null, (el) => el.child(h_flex().absolute().left(0).right(0).top(0).h(6)
        .child(div().flex_grow(Math.max(0.001, now)))
        .child(svg(`${ART}/pip.svg`).size(6).flex_none().text_color(t.foreground))
        .child(div().flex_grow(Math.max(0.001, 1 - now)))));
  }

  /** One window: its mark, the numbers, the path, when it comes back. */
  row(t, id, mark, label, w, back) {
    const r = left(w);
    return h_flex().id(id).relative().px(16).py(4).gap(10).items_center()
      .hover((s) => s.bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); toggleUsage(); })
      .child(div().w(20).h(22).flex_none().flex().items_center().justify_center().child(mark))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_baseline().text_size(11)
          .child(div().flex_none().text_color(t.ansi8).child(label))
          .child(div().flex_1())
          .child(div().flex_none().text_color(r === 0 ? t.blocked : t.foreground).child(`${r}%`))
          .child(div().flex_none().text_color(t.ansi8).child("left")))
        .child(this.path(t, w))
        .when(Boolean(back), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(back))));
  }

  /** The hourglass: its glass, and sand in the top bulb by what's left. */
  hourglass(t, w) {
    return div().relative().w(18).h(22).flex_none()
      .child(svg(`${ART}/hourglass-glass.svg`).w(18).h(22).absolute().top(0).left(0).text_color(t.ansi8))
      .child(svg(`${ART}/hourglass-${eighths(w)}.svg`).w(18).h(22).absolute().top(0).left(0).text_color(left(w) === 0 ? t.blocked : t.ansi7));
  }

  moon(t, w, size) {
    return svg(`${ART}/moon-${eighths(w)}.svg`).size(size).text_color(t.ansi7);
  }

  /** The providers' logos; the picked one lit. `stack`: one above the other (the rail). */
  switcher(t, stack = false) {
    const on = provider().id;
    return (stack ? v_flex() : h_flex()).id("usage-providers").flex_none().gap(2).items_center()
      .children(PROVIDERS.map((p) => div().id(`usage-provider-${p.id}`).p(2).flex_none()
        .tooltip(p.id === on ? `${p.name} usage` : `Show ${p.name} usage`)
        .when(p.id !== on, (el) => el.hover((s) => s.bg(t.ansi0)))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); pick(p.id, cx); })
        .child(svg(`${ART}/logo-${p.logo}.svg`).size(12).text_color(p.id === on ? t.foreground : t.ansi8))));
  }

  /** The folded rail's usage: the hourglass and the moon, each over what's left. Click: the usage pane. */
  rail(t) {
    const d = reading();
    const cell = (id, mark, w, label) => v_flex().id(id).w(56).py(4).gap(2).flex_none().items_center()
      .hover((s) => s.bg(t.ansi0))
      .tooltip(`${provider().name} ${label}: ${left(w)}% left`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); toggleUsage(); })
      .child(div().h(22).flex().items_center().justify_center().child(mark))
      .child(div().text_size(10).text_color(left(w) === 0 ? t.blocked : t.foreground).child(`${left(w)}%`))
      .child(this.path(t, w, 36));
    const top = v_flex().id("usage-rail").pb(10).gap(4).flex_none().items_center()
      .child(div().w(24).h(2).mb(2).relative().child(dither(t.ansi8, 1)))
      .child(this.switcher(t, true));
    if (!d) return top.child(div().text_size(10).text_color(t.dim).child("usage …"));
    return top
      .when(Boolean(d.session), (el) => el.child(cell("usage-rail-5h", this.hourglass(t, d.session), d.session, windowName(d.session, "5h"))))
      .when(Boolean(d.week), (el) => el.child(cell("usage-rail-wk", this.moon(t, d.week, 18), d.week, windowName(d.week, "week"))));
  }

  render(t) {
    const d = reading(), note = usageNote(), who = provider();
    const folded = this.folded;
    const nums = d ? [d.session, d.week].filter(Boolean).map((w) => `${left(w)}%`).join(" · ") : "";
    const head = h_flex().id("usage-head").px(16).pb(4).gap(6).items_center()
      .child(h_flex().id("usage-fold").flex_1().gap(6).items_center()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); setShared(FOLDED, !folded); })
        .child(div().flex_none().child(eyebrow(t, "usage")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(folded ? "▸" : "▾"))
        .child(div().flex_1())
        .when(folded && Boolean(nums), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(nums))))
      .child(this.switcher(t));
    // Its height lifts the sky's hills (sky.js), so the landscape rests on it.
    const box = v_flex().id("usage").pt(4).pb(8).flex_none().child(head)
      .on_size_change((size, cx) => { if (size.height !== this.height) { this.height = size.height; cx.notify(); } });
    if (folded) return box;
    if (!d) {
      const say = !note ? "asking the moon…" : note.state === "nologin" ? `no ${who.name} login here` : note.state === "expired" ? "the login is napping" : "couldn't reach the moon";
      return box.child(div().px(16).py(4).text_size(11).text_color(t.dim).child(say));
    }
    const now = Date.now();
    const s = d.session, wk = d.week;
    return box
      .when(Boolean(s), (el) => el.child(this.row(t, "usage-5h", this.hourglass(t, s), windowName(s, "5h"), s,
        s.resets ? (left(s) === 0 ? `turned at ${clock(s.resets)}` : `fresh in ${span(s.resets - now)}`) : null)))
      .when(Boolean(wk), (el) => el.child(this.row(t, "usage-wk", this.moon(t, wk, 20), windowName(wk, "week"), wk,
        wk.resets ? `full ${DAYS[new Date(wk.resets).getDay()]} ${clock(wk.resets)} · in ${span(wk.resets - now)}` : null)));
  }
}
