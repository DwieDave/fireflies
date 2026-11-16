// The sky's usage section, at its foot below the hills (sky.ts lifts them to
// make room): the picked provider's limits (limits.ts) in two small rows.
//
//   the switch   the providers' logos in the eyebrow (Claude, Codex); the lit
//                one is shown here and in the usage pane. Click one to pick it.
//   hourglass    the short window (5 hours): the sand in the top bulb is
//                what's left, a path of what's used, and when it's turned
//   moon         the weekly window: the moon in the phase of what's left
//   the plus     on each path: where the clock is in the window, so ahead or
//                behind pace reads at a glance (as in the usage pane)
//   the rail     (the folded sky) one small meter per window, nothing else
//   folded       the eyebrow alone, with both numbers beside it; click it (or
//                the chevron) to fold and open. Kept in shared(FOLDED).
//   a row        click: the full usage pane (usage) beside the
//                focused pane; again closes it (as + new > Usage does)

import { div, svg } from "gpui-kit";
import type { AsyncContext, ClickEvent, Color, Context, Element, MouseButtonEvent, Size } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, shared, setShared } from "herdr";
import type { PaneInfo, Theme } from "herdr";
import { Array as Arr, Clock, Effect, Option, String as Str } from "effect";
import { localTime, redraw } from "@fireflies/kit";
import type { ViewFx } from "@fireflies/kit";
import { toast } from "@fireflies/kit/live";
import { isBoolean, readShared, sharedKey, writeShared } from "./guard.ts";
import { ART, dither, eyebrow, navRow, navRing } from "./kit.ts";
import type { Nav } from "./nav.ts";
import { runtime } from "./fx.ts";
import { PROVIDERS, provider, pickProvider, lastUsage, usageNote, refreshUsage, windowName } from "./limits.ts";
import type { ProviderId, Usage, UsageServices, UsageWindow } from "./limits.ts";
import { edge } from "./tones.ts";

const FOLDED = sharedKey("nocturne.usageFolded", isBoolean);
const TICK = "30 seconds";

/** The first read, this long after the section first draws. */
const FIRST = "1 second";
const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
const pad = (n: number) => Str.padStart(2, "0")(String(n));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const left = (w: UsageWindow) => Math.max(0, Math.min(100, Math.round(100 - w.used)));
const used = (w: UsageWindow) => Math.max(0, Math.min(100, w.used));
const tone = (t: Theme, u: number): Color => (u >= 85 ? t.blocked : u >= 60 ? t.working : t.done);

/** Eighths of what's left: the moon's phase, the hourglass's sand. */
const eighths = (w: UsageWindow) => Math.round((left(w) / 100) * 8);

const HOUR = 3600_000;

/** The picked provider's last answer, its windows' lengths filled in where it gave none (5 h and 7 d, as the usage pane takes them). */
function reading(): Usage | null {
  const d = runtime.now(lastUsage());

  if (d === null) return null;

  const sized = (w: UsageWindow | null, length: number): UsageWindow | null => (w === null ? null : { ...w, length: w.length ?? length });

  return { ...d, session: sized(d.session, 5 * HOUR), week: sized(d.week, 168 * HOUR) };
}

/** How far through its window the clock is at `now`, 0–1 (null without a reset time or length). */
function elapsed(w: UsageWindow, now: number): number | null {
  if (w.resets === null || w.length === null || w.length <= 0) return null;

  return Math.max(0, Math.min(1, 1 - (w.resets - now) / w.length));
}

/** The time a render draws at (ms). */
const nowMs = () => runtime.now(Clock.currentTimeMillis);

function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));

  if (m < 60) return `${m}m`;

  const h = Math.floor(m / 60);

  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const clock = (ms: number) => {
  const d = localTime(ms);

  return `${pad(d.hours)}:${pad(d.minutes)}`;
};

/** The usage pane in the shown tab, if it's open. */
export function usagePane(): PaneInfo | null {
  const tab = Option.getOrUndefined(Option.flatMap(Arr.findFirst(spaces(), (s) => s.active), (s) => Option.map(Arr.findFirst(s.tabs, (c) => c.active), (c) => c.id)));

  return Option.getOrNull(Arr.findFirst(panes(), (p) => p.mod === "usage" && p.tab === tab));
}

/** Opens the usage pane beside the focused pane, or closes it. */
export function toggleUsage(): void {
  const open = usagePane();

  if (open !== null) {
    run("pane.close", { pane: open.pane });

    return;
  }

  const focused = Arr.findFirst(panes(), (p) => p.focused);

  run("pane.split", Option.match(focused, {
    onNone: () => ({ direction: "auto", mod: "usage", props: {} }),
    onSome: (p) => ({ direction: "auto", pane: p.pane, mod: "usage", props: {} }),
  }));
}

export class UsageSection {
  height = 0; // as last drawn, px
  railHeight = 0; // the rail's, as last drawn
  /** The section's effects (@fireflies/kit): its first read and its tick. */
  fx: ViewFx<UsageServices> | null = null;

  init(cx: AsyncContext): void {
    this.height = 0;
    this.railHeight = 0;
    this.fx = runtime.attach(cx, toast("Usage"));

    // The first read after the first frame (drawing never waits on, or runs, the machine's cache
    // script); then every TICK it asks when the shared answer is old (whichever copy is shown
    // first asks), and the countdowns and the clock's plus move.
    this.fx.run(Effect.andThen(Effect.sleep(FIRST), refreshUsage()).pipe(
      Effect.andThen(redraw),
      Effect.andThen(Effect.forever(Effect.sleep(TICK).pipe(Effect.andThen(refreshUsage()), Effect.andThen(redraw)))),
    ));
  }

  /** Picks provider `id` and asks it for its usage if its answer is old. */
  pick(id: ProviderId): void {
    runtime.now(pickProvider(id));
    this.fx?.run(refreshUsage("open", id), { key: "pick" });
  }

  get folded(): boolean {
    return readShared(shared, FOLDED, false);
  }

  /** The path: what's used in the tone of how close the limit is, and the plus where the clock is. */
  path(t: Theme, w: UsageWindow, width: number | null = null): Element {
    const u = used(w);
    const now = elapsed(w, nowMs());
    const el = div().relative().h(6).flex_none();

    return (width === null ? el.w_full() : el.w(width))
      .child(div().absolute().left(0).right(0).top(2).h(2).child(dither(t.muted, 1)))
      // Shares of the row as flex weights, not pixels.
      .child(h_flex().absolute().left(0).right(0).top(1).h(4)
        .child(div().h_full().flex_grow(Math.max(0.001, u)).bg(tone(t, u)))
        .child(div().h_full().flex_grow(Math.max(0.001, 100 - u))))
      .when(now != null, (row) => row.child(h_flex().absolute().left(0).right(0).top(0).h(6)
        .child(div().flex_grow(Math.max(0.001, now ?? 0)))
        .child(svg(`${ART}/pip.svg`).size(6).flex_none().text_color(t.foreground))
        .child(div().flex_grow(Math.max(0.001, 1 - (now ?? 0))))));
  }

  /** One window: its mark, the numbers, the path, when it comes back. */
  row(t: Theme, id: string, mark: Element, label: string, w: UsageWindow, back: string | null, nav?: Nav): Element {
    const r = left(w);
    const on = nav?.(id, "usage", { go: () => toggleUsage() }) ?? false;

    return h_flex().id(id).relative().px(16).py(4).gap(10).items_center()
      .map((el) => navRow(t, el, on))
      .hover((s) => s.bg(edge(t)))
      .on_mouse_down("left", stop)
      .on_click((_e: ClickEvent, cx: Context) => {
        cx.stop_propagation();
        toggleUsage();
      })
      .child(div().relative().w(20).h(22).flex_none().flex().items_center().justify_center().child(mark))
      .child(v_flex().relative().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_baseline().text_size(11)
          .child(div().flex_none().text_color(t.muted).child(label))
          .child(div().flex_1())
          .child(div().flex_none().text_color(r === 0 ? t.blocked : t.foreground).child(`${r}%`))
          .child(div().flex_none().text_color(t.muted).child("left")))
        .child(this.path(t, w))
        .when(Boolean(back), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(back ?? ""))));
  }

  /** The hourglass: its glass, and sand in the top bulb by what's left. */
  hourglass(t: Theme, w: UsageWindow): Element {
    return div().relative().w(18).h(22).flex_none()
      .child(svg(`${ART}/hourglass-glass.svg`).w(18).h(22).absolute().top(0).left(0).text_color(t.muted))
      .child(svg(`${ART}/hourglass-${eighths(w)}.svg`).w(18).h(22).absolute().top(0).left(0).text_color(left(w) === 0 ? t.blocked : t.ansi7));
  }

  moon(t: Theme, w: UsageWindow, size: number): Element {
    return svg(`${ART}/moon-${eighths(w)}.svg`).size(size).text_color(t.ansi7);
  }

  /** The providers' logos; the picked one lit. */
  switcher(t: Theme, nav?: Nav): Element {
    const on = runtime.now(provider).id;

    return h_flex().id("usage-providers").flex_none().gap(2).items_center()
      .children(Arr.map(PROVIDERS, (p) => div().id(`usage-provider-${p.id}`).relative().p(2).flex_none()
        .map((el) => navRing(t, el, nav?.(`usage-provider-${p.id}`, "usage", { go: () => this.pick(p.id) }) ?? false))
        .tooltip(p.id === on ? `${p.name} usage` : `Show ${p.name} usage`)
        .when(p.id !== on, (el) => el.hover((s) => s.bg(edge(t))))
        .on_mouse_down("left", stop)
        .on_click((_e: ClickEvent, cx: Context) => {
          cx.stop_propagation();
          this.pick(p.id);
        })
        .child(svg(`${ART}/logo-${p.logo}.svg`).size(12).text_color(p.id === on ? t.foreground : t.muted))));
  }

  /** The folded rail's usage: one small meter per window (its name, what's
   *  left, the path with the clock's plus). No art and no provider switch:
   *  those live in the open sidebar; the tooltip names the provider. Click:
   *  the usage pane. Its height lifts the rail's hills (sky.ts). */
  rail(t: Theme, nav?: Nav): Element {
    const d = reading();

    const meter = (id: string, w: UsageWindow, label: string) => v_flex().id(id).relative().w_full().px(14).py(4).gap(3).flex_none()
      .map((el) => navRing(t, el, nav?.(id, "usage", { go: () => toggleUsage() }) ?? false))
      .hover((s) => s.bg(edge(t)))
      .tooltip(`${runtime.now(provider).name} ${label}: ${left(w)}% left`)
      .on_mouse_down("left", stop)
      .on_click((_e: ClickEvent, cx: Context) => {
        cx.stop_propagation();
        toggleUsage();
      })
      .child(h_flex().items_baseline().text_size(10)
        .child(div().flex_none().text_color(t.muted).child(Str.toUpperCase(label)))
        .child(div().flex_1())
        .child(div().flex_none().text_color(left(w) === 0 ? t.blocked : t.foreground).child(`${left(w)}%`)))
      .child(this.path(t, w));

    const box = v_flex().id("usage-rail").w_full().pt(2).pb(10).gap(2).flex_none().items_center()
      .on_size_change((size: Size, cx: Context) => {
        if (size.height !== this.railHeight) {
          this.railHeight = size.height;
          cx.notify();
        }
      })
      .child(div().w(28).h(2).mb(6).relative().child(dither(t.muted, 1)));

    if (d === null) return box.child(div().py(4).text_size(10).text_color(t.dim).child("usage …"));

    const s = d.session;
    const wk = d.week;
    const withSession = s === null ? box : box.child(meter("usage-rail-5h", s, windowName(s, "5h")));

    return wk === null ? withSession : withSession.child(meter("usage-rail-wk", wk, windowName(wk, "week")));
  }

  /** `nav` (sky.ts): registers a control with the keyboard's cursor, true while it's on it. */
  render(t: Theme, nav?: Nav): Element {
    const d = reading();
    const note = runtime.now(usageNote());
    const who = runtime.now(provider);
    const folded = this.folded;
    const fold = () => writeShared(setShared, FOLDED, !folded);
    const foldOn = nav?.("usage-fold", "usage", { go: fold }) ?? false;
    const nums = d === null ? "" : Arr.join(Arr.flatMap([d.session, d.week], (w) => (w === null ? [] : [`${left(w)}%`])), " · ");

    const head = h_flex().id("usage-head").px(16).pb(4).gap(6).items_center()
      .child(h_flex().id("usage-fold").relative().flex_1().gap(6).items_center()
        .map((el) => navRing(t, el, foldOn))
        .on_mouse_down("left", stop)
        .on_click((_e: ClickEvent, cx: Context) => {
          cx.stop_propagation();
          fold();
        })
        .child(div().flex_none().child(eyebrow(t, "usage")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(folded ? "▸" : "▾"))
        .child(div().flex_1())
        .when(folded && Boolean(nums), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(nums))))
      .child(this.switcher(t, nav));

    // Its height lifts the sky's hills (sky.ts), so the landscape rests on it.
    const box = v_flex().id("usage").pt(4).pb(8).flex_none().child(head)
      .on_size_change((size: Size, cx: Context) => {
        if (size.height !== this.height) {
          this.height = size.height;
          cx.notify();
        }
      });

    if (folded) return box;

    if (d === null) {
      const say = note === null ? "asking the moon…" : note.state === "off" ? "usage is off in a scratch app" : note.state === "nologin" ? `no ${who.name} login here` : note.state === "expired" ? "the login is napping" : "couldn't reach the moon";

      return box.child(div().px(16).py(4).text_size(11).text_color(t.dim).child(say));
    }

    const now = nowMs();
    const s = d.session;
    const wk = d.week;

    const turned = (w: UsageWindow, at: number) => (left(w) === 0 ? `turned at ${clock(at)}` : `fresh in ${span(at - now)}`);
    const full = (at: number) => `full ${DAYS[localTime(at).weekday] ?? ""} ${clock(at)} · in ${span(at - now)}`;

    const withSession = s === null
      ? box
      : box.child(this.row(t, "usage-5h", this.hourglass(t, s), windowName(s, "5h"), s, s.resets === null ? null : turned(s, s.resets), nav));

    const withWeek = wk === null
      ? withSession
      : withSession.child(this.row(t, "usage-wk", this.moon(t, wk, 20), windowName(wk, "week"), wk, wk.resets === null ? null : full(wk.resets), nav));

    // Backing off (limits.ts): the numbers stay, with their age.
    return note !== null && (note.until ?? 0) > now
      ? withWeek.child(div().id("usage-stale").px(16).pt(2).text_size(10).text_color(t.dim)
        .child(`${note.state === "busy" ? "rate limited" : "couldn't read"} · from ${span(now - d.at)} ago`))
      : withWeek;
  }
}
