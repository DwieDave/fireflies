// Nocturne usage: how much of the night is left on the picked provider's
// account (Claude or Codex, picked here or in the sidebar's usage section), in
// the sky's dithered look (limits.ts reads it). Opened from + new > Usage, or
// a row of the sidebar's usage section.
//
//   the candle   the short (5-hour) window: the wax burns down as it's used, the
//                flame flickers while any is left; out, it smokes and says
//                when it's relit
//   the moon     the weekly window: a full moon is a fresh week, it wanes
//                with use (Nocturne's own moon phases); a weekly limit
//                scoped to one model gets a small moon of its own
//   the path     under each: the used share as a trodden path, and a star
//                where the clock is in the window, so ahead or behind pace
//                reads at a glance (and in words: galloping / trotting /
//                grazing)
//   the sheep    grazes while there's plenty, gets drowsy, and sleeps
//                (z z z) once either limit runs out
//
// It fills its pane: the two cards sit side by side or stacked, each figure
// beside or above its words, at the largest scale (1x to 4x, whole steps so
// the pixel art stays crisp) where everything fits. Below 1x it scrolls.
//
// Keys (click the pane, or pane.go onto it): KEYS below; ? shows them in a
// strip under the toolbar, whose last item is the ? chip.

import { View, div, svg } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent } from "gpui-kit";
import type { LoopPolicy, Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import { theme, nextCommand } from "herdr";
import type { Theme } from "herdr";
import { ART, OWN, dither } from "./kit.ts";
import { PROVIDERS, provider, pickProvider, lastUsage, usageNote, refreshUsage, asking } from "./limits.ts";
import type { Note, ProviderId, ScopedWindow, Usage, UsageWindow, Why } from "./limits.ts";
// keyhelp.ts is one file shared by every nocturne mod (a copy here, byte for byte).
import { keysHint, keysView, keysKey } from "./keyhelp.ts";

const TICK = 30_000; // countdowns, and asking again once the answer is old
const FIRST = 1000; // the first read, this long after the pane first draws (ms)
const SESSION_MS = 5 * 3600_000;
const WEEK_MS = 7 * 86400_000;

/** A window's length as the card's small print: "5 h", "7 d". */
function lengthName(length: number) {
  return length < 86400_000 ? `${Math.round(length / 3600_000)} h` : `${Math.round(length / 86400_000)} d`;
}

const BAR = 34; // the toolbar

/** What ? lists: every key key() takes, ? keys last. */
export const KEYS: readonly (readonly [string, string])[] = [["r", "read again now"], ["p", "the next provider"], ["esc", "keys away"], ["?", "keys"]];
const GAP = 12;
const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const left = (w: UsageWindow) => Math.max(0, Math.min(100, Math.round(100 - w.used)));

/** "2h 14m", "3d 5h", "40s". */
function span(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));

  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);

  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);

  if (h < 24) return `${h}h ${pad(m % 60)}m`;

  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const clock = (ms: number) => {
  const d = new Date(ms);

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const day = (ms: number) => `${DAYS[new Date(ms).getDay()] ?? ""} ${clock(ms)}`;

/** How far through its window the clock is, 0–1 (null without a reset time). */
function elapsed(w: UsageWindow, length: number) {
  if (!w?.resets) return null;

  return Math.max(0, Math.min(1, 1 - (w.resets - Date.now()) / length));
}

/** Words for the remaining share, from a list of [at least, words]. */
const pick = (n: number, table: Words) => table.find(([min]) => n >= min)?.[1] ?? "";

/** [at least this much left, what to say], most first. */
type Words = readonly (readonly [number, string])[];

const CANDLE: Words = [
  [70, "a tall candle and a quiet night"],
  [40, "plenty of wax for a few more spells"],
  [15, "the wick's getting short. tread softly"],
  [1, "embers only. maybe brew some tea"],
  [0, "the candle's out. the sheep insist you rest"],
];

const MOON: Words = [
  [75, "a fat round moon, all yours"],
  [50, "gibbous and generous"],
  [25, "half a moon to wander by"],
  [4, "a thin crescent. save it for the good stuff"],
  [0, "new moon. the stars will have to do"],
];

// ---- sizes at a scale s (1..4)

/** Type sizes: the big number, and everything else. */
const big = (s: number) => 18 + 10 * s;
const small = (s: number) => 10 + s;

/** The figure (candle or moon with its stars) is a square this wide. */
const fig = (s: number) => 104 * s;

/** The words beside or under a figure: about how wide they want to be, how tall they are. */
const textW = (s: number) => 230 + 70 * s;
const textH = (s: number) => big(s) + 6 * small(s) * 1.5 + 24 + 10 * s;

/**
 * The best way to lay a card out in a w x h box: the largest scale where the
 * figure and words fit, beside each other if they can, else stacked.
 * `extra`: rows below (the scoped moons), in px at 1x.
 */
/** A card's layout: its scale, figure beside or above its words, and whether it scrolls. */
interface CardFit {
  readonly s: number;
  readonly beside: boolean;
  readonly scroll?: true;
}

function fitCard(w: number, h: number, extra: number): CardFit {
  for (const s of [4, 3, 2, 1]) {
    const inW = w - 2 * 12 * s, inH = h - 24 * s - (small(s) + 10 * s) - extra * Math.min(s, 2);

    if (fig(s) + 16 * s + textW(s) <= inW && Math.max(fig(s), textH(s)) <= inH) return { s, beside: true };

    if (Math.max(fig(s), textW(s)) <= inW && fig(s) + 12 * s + textH(s) <= inH) return { s, beside: false };
  }

  return { s: 1, beside: w >= 420, scroll: true };
}

/** Side by side or stacked, whichever gives the cards the larger scale (ties: what the box is shaped like). */
/** The cards' layout: side by side or stacked, and each card's. */
interface Arrangement extends CardFit {
  readonly side: boolean;
}

function arrange(width: number, height: number, extra: number, foot: number): Arrangement {
  const W = width - 2 * GAP, H = height - BAR - 2 * GAP - foot;
  const side = fitCard((W - GAP) / 2, H, extra);
  const stacked = fitCard(W, (H - GAP) / 2, extra);
  const s = side.scroll ? 0 : side.s, t = stacked.scroll ? 0 : stacked.s;

  if (s > t || (s === t && W >= H * 1.4)) return { side: true, ...side };

  return { side: false, ...stacked };
}

/** The two paths a pane draws. */
type PathId = "session" | "week";

export default class UsagePane extends View {
  size = { width: 600, height: 500 };
  // Each path's width (px), as last laid out.
  paths = new Map<PathId, number>();
  handle: FocusHandle | null = null;
  keysShown = false;

  override init(_props: Props | undefined, cx: AsyncContext) {
    const handle = cx.focus_handle();

    this.handle = handle;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^usage\./, "");

        if (c === "focus") handle.focus();
        else if (c === "refresh") this.read(cx, "force");
        else if (c === "keys") this.keysShown = !this.keysShown;
        cx.notify();
      }
    });
    // The first read after the first frame (drawing never runs the machine's cache script).
    cx.spawn(async (cx) => { await cx.sleep(FIRST); await refreshUsage("open"); cx.notify(); });
    cx.timer.every(TICK, (cx) => { this.read(cx); cx.notify(); });
  }

  /** Asks again when it's due (limits.ts due: "tick", "open", "force"); shared() redraws every copy. */
  read(cx: Context, why: Why | boolean = "tick") {
    cx.spawn(async (cx) => { await refreshUsage(why); cx.notify(); });
    cx.notify();
  }

  key(e: KeyEvent, cx: Context) {
    const m = e.modifiers;

    if (m.platform || m.control || m.alt) return;
    const help = keysKey(e, this.keysShown);

    if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
    else if (this.keysShown) return;
    else if (e.keystroke === "r") this.read(cx, "force");
    else if (e.keystroke === "p") {
      const i = PROVIDERS.findIndex((p) => p.id === provider().id);
      this.pick((PROVIDERS[(i + 1) % PROVIDERS.length] ?? PROVIDERS[0]).id, cx);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** ?: every key, under the toolbar (keyhelp.ts). */
  keysStrip(t: Theme) {
    return keysView(t, { id: "us-keys", title: "usage", list: KEYS, close: () => { this.keysShown = false; } });
  }


  /** Shows provider `id` here and in the sidebar, asking it if its answer is old. */
  pick(id: ProviderId, cx: Context) {
    pickProvider(id);
    this.read(cx, "open");
  }

  /** Color for how much of a window is used. */
  tone(t: Theme, used: number) { return used >= 85 ? t.blocked : used >= 60 ? t.working : t.done; }

  // ---- the pieces, drawn at scale s

  /** The candle: wax by what's left, a flickering flame, or smoke once it's out. */
  candle(t: Theme, w: UsageWindow, s: number) {
    const r = left(w);
    const wax = (6 + Math.round((r / 100) * 64)) * s;
    const base = 4 * s, top = base + wax; // the wax's top, from the figure's bottom
    const box = fig(s), x0 = (box - 44 * s) / 2; // the candle is 44 wide at 1x, centered
    const at = (n: number) => x0 + n * s;

    const f = div().relative().size(box).flex_none()
      // The dish.
      .child(div().absolute().bottom(0).left(at(2)).w(40 * s).h(2 * s).bg(t.ansi8))
      .child(div().absolute().bottom(2 * s).left(at(6)).w(32 * s).h(2 * s).child(dither(t.ansi8, s)))
      // Wax, shaded on its right, with a drip down the left.
      .child(div().absolute().bottom(base).left(at(15)).w(14 * s).h(wax).bg(t.ansi7)
        .child(div().absolute().top(0).right(0).w(5 * s).h_full().child(dither(t.ansi8, s))))
      .when(wax > 14 * s, (el) => el.child(div().absolute().bottom(top - 10 * s).left(at(13)).w(2 * s).h(8 * s).bg(t.ansi7)))
      .child(div().absolute().bottom(top).left(at(21)).w(2 * s).h(4 * s).bg(t.ansi8));

    if (r > 0) {
      const y = top + 2 * s;
      const flame = (file: string, color: Theme["working"], o: LoopPolicy) => svg(`${OWN}/${file}.svg`).w(14 * s).h(22 * s).absolute().left(at(15)).bottom(y).text_color(color).loop("opacity", o);

      return f
        .child(svg(`${ART}/glow.svg`).size(40 * s).absolute().left(at(2)).bottom(y - 10 * s).text_color(t.working)
          .loop("opacity", { from: 0.12, to: 0.4, period: 1900 }))
        .child(flame("flame-a", t.working, { from: 0.25, to: 1, period: 700 }))
        .child(flame("flame-b", t.working, { from: 1, to: 0.2, period: 1150 }))
        .child(flame("flame-core", t.ansi15, { from: 0.55, to: 1, period: 430 }));
    }

    // Out: two wisps of smoke drifting up from the wick.
    const wisp = (x: number, period: number, ch: string) => div().absolute().left(at(x)).text_size(small(s)).text_color(t.ansi8).child(ch)
      .loop("top", { from: box - top - 16 * s, to: box - top - 44 * s, period, easing: "linear" })
      .loop("opacity", { from: 0.9, to: 0, period, easing: "linear" });

    return f.child(wisp(19, 2600, "~")).child(wisp(23, 3400, "°"));
  }

  /** The moon in the phase of what's left, with a few stars blinking around it. */
  moon(t: Theme, w: UsageWindow, s: number, bare = false) {
    const phase = Math.round((left(w) / 100) * 8);
    const size = bare ? 20 * s : 88 * s, pad = bare ? 0 : 8 * s;

    const star = (x: number, y: number, period: number) => svg(`${ART}/pip.svg`).size(6 * s).absolute().left(x * s).top(y * s).text_color(t.ansi7)
      .loop("opacity", { from: 0.1, to: 0.9, period });

    return div().relative().size(size + 2 * pad).flex_none()
      .child(svg(`${ART}/moon-${phase}.svg`).size(size).absolute().left(pad).top(pad).text_color(t.ansi7))
      .when(!bare, (el) => el.child(star(0, 6, 2300)).child(star(96, 20, 3100)).child(star(86, 96, 1700)));
  }

  /**
   * The path under a window: what's used, trodden in its color; a star where
   * the clock is in the window; and how the two compare, in sheep's words.
   */
  path(t: Theme, id: PathId, w: UsageWindow, length: number, s: number) {
    const width = this.paths.get(id) ?? 160;
    const used = Math.max(0, Math.min(100, w.used));
    const now = elapsed(w, length);
    const lead = now === null ? 0 : used - now * 100;
    const words = now === null ? "" : lead > 12 ? "galloping ahead of the clock" : lead < -12 ? "grazing slowly, loads of night left" : "trotting right along with the clock";
    const star = 8 * Math.min(s, 2);

    return v_flex().gap(4 * s).w_full()
      // The star sits centred on the path; the box is tall enough for both.
      .child(div().id(`path-${id}`).relative().h(star + 4 * s).w_full()
        .on_size_change((z, cx) => { if (Math.abs((this.paths.get(id) ?? 0) - z.width) > 1) { this.paths.set(id, z.width); cx.notify(); } })
        .child(div().absolute().left(0).right(0).top(star / 2 + s).h(2 * s).child(dither(t.ansi8, s)))
        .child(div().absolute().left(0).top(star / 2).h(4 * s).w(Math.round((used / 100) * width)).bg(this.tone(t, used)))
        .when(now !== null, (el) => el.child(svg(`${ART}/pip.svg`).size(star).absolute().top(2 * s)
          .left(Math.max(0, Math.min(width - star, Math.round((now ?? 0) * width) - star / 2))).text_color(t.foreground))))
      .when(Boolean(words), (el) => el.child(div().text_size(small(s)).text_color(lead > 12 ? this.tone(t, 90) : t.dim).child(words)));
  }

  /** Big number, what it means, when it comes back. */
  figures(t: Theme, w: UsageWindow, words: string, back: string | null, s: number, center: boolean) {
    const r = left(w);

    return v_flex().gap(3 * s).min_w(0).when(center, (el) => el.items_center())
      .child(h_flex().gap(6 * s).items_end()
        .child(div().text_size(big(s)).line_height(`${big(s)}px`).text_color(r === 0 ? t.blocked : t.foreground).child(`${r}%`))
        .child(div().pb(s).text_size(small(s)).text_color(t.muted).child("left")))
      .child(div().text_size(small(s)).text_color(t.foreground).when(center, (el) => el.text_center()).child(words))
      .when(back !== null, (el) => el.child(div().text_size(small(s)).text_color(t.dim).child(back ?? "")));
  }

  /** A card: eyebrow, then the figure beside or above its words and path, centered in whatever room it has. */
  card(t: Theme, id: string, title: string, sub: string, figure: Element, words: Element, path: Element, fit: CardFit, below: Element | null = null) {
    const { s, beside } = fit;

    const text = v_flex().gap(10 * s).min_w(0).max_w(textW(s) + 80 * s)
      .when(beside, (el) => el.flex_1())
      .when(!beside, (el) => el.w_full().items_center())
      .child(words).child(path);

    return v_flex().id(id).relative().flex_1().min_w(0).min_h(0).p(12 * s).gap(10 * s).bg(t.background).border(1).border_color(t.ansi0)
      .child(h_flex().gap(8 * s).items_baseline().text_size(small(s))
        .child(div().text_color(t.ansi8).child(title.toUpperCase()))
        .child(div().text_color(t.dim).child(sub)))
      .child((beside ? h_flex().gap(16 * s) : v_flex().gap(12 * s)).flex_1().min_h(0).items_center().justify_center()
        .child(figure).child(text))
      .when(below !== null, (el) => (below ? el.child(below) : el));
  }

  session(t: Theme, w: UsageWindow, fit: CardFit) {
    const { s, beside } = fit;
    const length = w.length ?? SESSION_MS;
    const back = w.resets ? (left(w) === 0 ? `relit at ${clock(w.resets)}, in ${span(w.resets - Date.now())}` : `fresh candle in ${span(w.resets - Date.now())} · ${clock(w.resets)}`) : null;

    return this.card(t, "candle", "tonight's candle", lengthName(length), this.candle(t, w, s),
      this.figures(t, w, pick(left(w), CANDLE), back, s, !beside), this.path(t, "session", w, length, s), fit);
  }

  week(t: Theme, w: UsageWindow, scoped: readonly ScopedWindow[], fit: CardFit) {
    const { s, beside } = fit;
    const length = w.length ?? WEEK_MS;
    const k = Math.min(s, 2);
    const back = w.resets ? `full again ${day(w.resets)} · in ${span(w.resets - Date.now())}` : null;

    const below = scoped.length ? v_flex().gap(4 * k).children(scoped.map((x) => h_flex().gap(8 * k).items_center().text_size(small(k))
      .child(this.moon(t, x, k, true))
      .child(div().text_color(t.foreground).child(x.name))
      .child(div().min_w(0).truncate().text_color(t.dim).child(left(x) === 100 ? "a whole moon of its own" : `${left(x)}% of its own moon left`)))) : null;

    return this.card(t, "moon", "this week's moon", lengthName(length), this.moon(t, w, s),
      this.figures(t, w, pick(left(w), MOON), back, s, !beside), this.path(t, "week", w, length, s), fit, below);
  }

  /** The sheep in the meadow: grazing, drowsy, or asleep, with something to say. */
  sheep(t: Theme, d: Usage, k: number) {
    const windows = [d.session, d.week].flatMap((w) => (w ? [w] : []));
    const least = Math.min(...windows.map(left));
    const asleep = least === 0;
    const drowsy = !asleep && least < 15;
    const out = windows.flatMap((w) => (left(w) === 0 && w.resets ? [w.resets] : []));

    const says = asleep ? `z z z … wakes ${out.length ? clock(Math.max(...out)) : "soon"}`
      : drowsy ? "baa… getting sleepy" : least < 40 ? "baa. pacing myself" : "baa! the meadow is wide open";

    const kind = asleep ? "asleep" : "awake";

    const body = div().relative().w(38 * k).h(24 * k).flex_none()
      .child(svg(`${OWN}/sheep-${kind}-wool.svg`).w(38 * k).h(24 * k).absolute().top(0).left(0).text_color(t.ansi7))
      .child(svg(`${OWN}/sheep-${kind}-face.svg`).w(38 * k).h(24 * k).absolute().top(0).left(0).text_color(t.ansi8));

    const z = (x: number, period: number, rise: number) => div().absolute().left(x * k).text_size(small(k)).text_color(t.ansi4).child("z")
      .loop("top", { from: 8 * k, to: -rise * k, period, easing: "linear" })
      .loop("opacity", { from: 1, to: 0, period, easing: "linear" });

    const sheep = div().relative().w(60 * k).h(40 * k).flex_none()
      .child(asleep
        ? div().absolute().left(0).bottom(0).child(body)
        : div().absolute().left(drowsy ? 6 * k : 0).bottom(0).child(body)
          .loop("left", { from: 0, to: (drowsy ? 2 : 10) * k, period: drowsy ? 6000 : 4200 }))
      .when(asleep, (el) => el.child(z(34, 2400, 18)).child(z(42, 3100, 24)));

    return h_flex().absolute().left(16 * k).bottom(20 * k).gap(4 * k).items_end()
      .child(sheep)
      .child(div().mb(20 * k).px(6).py(2).text_size(small(k)).bg(t.background).border(1).border_color(t.ansi0).text_color(asleep ? t.ansi4 : t.muted).child(says));
  }

  toolbar(t: Theme, d: Usage | null, note: Note | null) {
    const busy = asking();
    const read = d ? `read ${span(Date.now() - d.at)} ago` : "";

    const status = busy ? "asking the moon…"
      : note && (note.state === "busy" || (note.until ?? 0) > Date.now())
        ? `${note.state === "busy" ? "rate limited" : "couldn't read"}${d ? ` · ${read}` : ""} · next try in ${span(Math.max(0, (note.until ?? 0) - Date.now()))}`
        : read;

    const plan = d?.plan ?? null;

    return h_flex().id("us-toolbar").relative().h(BAR).flex_none().px(12).gap(8).items_center().text_size(11)
      .child(div().flex_none().text_color(t.ansi8).child("USAGE"))
      .child(this.providers(t))
      .when(plan !== null, (el) => el.child(div().flex_none().relative().px(6).h(20).flex().items_center().text_color(t.muted)
        .child(dither(t.ansi0, 1)).child(div().relative().child(plan ?? ""))))
      .child(div().flex_1())
      .child(div().id("us-read").flex_none().px(6).h(20).flex().items_center().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.read(cx, true); })
        .child(busy ? div().child("·").frames(["·", "✦", "✧", "·"], 220) : "↻")
        .child(div().ml(6).child(status)))
      // ? keys: the toolbar's last item (keyhelp.ts).
      .child(keysHint(t, "us-keys-chip", this.keysShown, () => { this.keysShown = !this.keysShown; }).ml(6))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /** The providers, the shown one lit: click one to show it (here and in the sidebar). */
  providers(t: Theme) {
    const on = provider().id;

    return h_flex().flex_none().gap(2).items_center()
      .children(PROVIDERS.map((p) => h_flex().id(`us-provider-${p.id}`).flex_none().px(6).h(20).gap(5).items_center()
        .text_color(p.id === on ? t.foreground : t.ansi8)
        .when(p.id === on, (el) => el.bg(t.ansi0))
        .when(p.id !== on, (el) => el.hover((s) => s.text_color(t.muted).bg(t.ansi0)))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.pick(p.id, cx); })
        .child(svg(`${ART}/logo-${p.logo}.svg`).size(12).flex_none().text_color(p.id === on ? t.foreground : t.ansi8))
        .child(div().child(p.name.toLowerCase()))));
  }

  /** What to say when there's no answer to draw. */
  message(t: Theme, n: Note | null) {
    const who = provider();

    const [title, sub] = !n ? ["asking the moon how much night is left…", ""]
      : n.state === "off" ? ["usage is off in a scratch app", "it would ask with this machine's login; HERDR_APP_USAGE=1 turns it on"]
      : n.state === "nologin" ? [`no ${who.name} login on this machine`, `sign in to ${who.agent} and the moon will know you`]
      : n.state === "expired" ? ["the login is napping", `${who.agent} wakes it the next time it runs; this pane only reads it`]
      : n.state === "busy" ? ["the moon asked us to wait a moment", `rate limited · trying again in ${span(Math.max(0, (n.until ?? Date.now()) - Date.now()))}`]
      : ["couldn't reach the moon", n.state === "error" ? n.message : ""];

    return v_flex().flex_1().items_center().justify_center().gap(6).px(16).pb(120).text_size(11)
      .child(div().text_color(t.foreground).child(title))
      .child(div().text_center().text_color(t.ansi8).child(sub));
  }

  override render() {
    return this.page();
  }

  /** The pane: the toolbar, then the candle and the moon (or a note). */
  page() {
    const t = theme();
    const d = lastUsage(), note = usageNote();
    const { width, height } = this.size;
    // Nocturne's sky behind it all, in 480px tiles across the pane: stars,
    // moonlight haze, the hills.
    const tiles = [...Array(Math.max(1, Math.ceil(width / 480))).keys()].map((i) => i * 480);

    const layer = (file: string, h: number, color: Theme["background"], opacity: number, top = false) => tiles.map((x) => {
      const el = svg(`${ART}/${file}.svg`).w(480).h(h).absolute().left(x).text_color(color).opacity(opacity);

      return top ? el.top(0) : el.bottom(0);
    });

    const handle = this.handle;
    const base = v_flex().id("usage").relative().size_full().overflow_hidden().bg(t.background);

    const root = (handle ? base.track_focus(handle) : base)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .children(layer("stars", 900, t.ansi8, 0.55, true))
      .children(layer("haze", 1400, t.ansi4, 0.2))
      .children(layer("hills-fill", 144, t.background, 1))
      .children(layer("hills-rim", 144, t.ansi8, 0.5))
      .child(this.toolbar(t, d, note));

    // ?: the keys in the meadow's place, the toolbar stays (keyhelp.ts).
    if (this.keysShown) return root.child(div().relative().flex_1().min_h(0).child(this.keysStrip(t)));

    if (!d) return root.child(this.message(t, note));
    // The meadow keeps the bottom for the sheep; a short pane gives it up.
    const meadow = height >= 340;
    const k = height >= 900 && width >= 900 ? 2 : 1; // the sheep's scale
    const foot = meadow ? 70 * k : 0;
    const scoped = d.scoped;
    const fit = arrange(width, height, scoped.length * 28, foot);

    const cards = [
      ...(d.session ? [this.session(t, d.session, fit)] : []),
      ...(d.week ? [this.week(t, d.week, scoped, fit)] : []),
    ];

    // At least the pane's height, so the cards stretch to fill it; taller
    // (when even 1x doesn't fit) scrolls.
    const body = (fit.side ? h_flex().items_stretch() : v_flex()).gap(GAP).p(GAP).pb(GAP + foot).w_full().min_h(Math.max(0, height - BAR));

    return root
      .child(div().id("us-body").flex_1().min_h(0).overflow_y_scroll().child(body.children(cards)))
      .when(note !== null && note.state !== "busy", (el) => el.child(div().absolute().right(12).bottom(12).text_size(11).text_color(t.ansi8)
        .child(note?.state === "expired" ? "login napping, showing the last read" : "couldn't read just now, showing the last read")))
      .when(meadow, (el) => el.child(this.sheep(t, d, k)));
  }
}
