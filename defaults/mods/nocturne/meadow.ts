// The sky's fireflies (sky.ts draws the rest): each agent's firefly, its mark,
// wings and glow, landing at rest; the jar of pinned ones at the top, its glass
// (open and on the rail) and its glint; the meadow that places them all.

import { div, svg } from "gpui-kit";
import { flyMark, wingedMark } from "./winged.ts";
import type { Beat } from "./winged.ts";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { terminals, run, hc, settings } from "herdr";
import type { AgentInfo, Theme } from "herdr";
import { isTerminal } from "./guards.ts";
import { ART, WORD, dither, hash, givenName, navRing, cornerTicks, GLOW_SQUARE, TICK_OUT } from "./kit.ts";
import { stamps } from "./pins.ts";
import type { JarItem } from "./pins.ts";
import { field } from "./inline.ts";
import { calm, flash, dust, fly as flyPath } from "./flight.ts";
import { stop, laneReach, meadowPlan, MORE_H, CHECK, SWEEP, FLAP, LAND, JAR, JAR_SIDE, JAR_INSET, NECK, RAIL_NECK, BODY, LID, JAR_BODY, GLINT, heldKey } from "./sky-plan.ts";
import type { Reach, Landing } from "./sky-plan.ts";
import { flyActs } from "./sky-keys.ts";
import { shelfView } from "./shelf.ts";
import type Sky from "./sky.ts";

/** A 12 px check on a dark plate, set on a done firefly's mark. */
export function doneBadge(t: Theme): Element {
  return div().size(12).flex().items_center().justify_center().bg(t.background).border(1).border_color(t.done)
    .child(svg(CHECK).size(8).text_color(t.done));
}

/** How the sidebar's wings beat (sky-plan.ts FLAP): by status, a landing one
 *  as a working one; 3 cells deep; resting ones and a calm sky hold them still. */
function beatOf(a: AgentInfo, h: number, landing: Landing | undefined): Beat | null {
  const beat = calm() ? undefined : landing ? FLAP.get("working") : FLAP.get(a.status);

  return beat ? { period: beat + (h % 60), fold: 3 } : null;
}

/** Notes agents that just went to rest; they're `landing` for LAND ms. */
export function noteLandings(sky: Sky, t: Theme, list: readonly AgentInfo[], cx: Context): void {
  const now = Date.now();

  for (const a of list) {
    const was = sky.seen.get(a.address);

    if (was && was !== "idle" && a.status === "idle") {
      sky.landing.set(a.address, { color: t[was], until: now + LAND });
      cx.timer.after(LAND + 50, (later) => later.notify());
    } else if (a.status !== "idle") sky.landing.delete(a.address);

    sky.seen.set(a.address, a.status);
  }

  for (const [k, v] of sky.landing) if (v.until <= now) sky.landing.delete(k);
}

export function firefly(sky: Sky, t: Theme, a: AgentInfo, y: number, lane: number, w: number, reach: Reach = { up: 0, down: 0 }): Element {
  const h = hash(a.address);
  const on = sky.nav(`fly:${a.address}`, "flies", flyActs(sky, a));
  const x = 6; // the halo's edge lines up with the eyebrow; every mark in one column
  const color = a.status === "idle" ? t.muted : t[a.status];
  const glow = svg(`${ART}/glow.svg`).w(40).h(40).absolute().top(0).left(0).text_color(color);
  const landing = sky.landing.get(a.address);
  const still = calm();
  // Landing: the last awake glow and mark fade out over the resting mark
  // (a loop's first half, removed once it's out).
  const fade = (el: Element) => el.loop("opacity", { from: 1, to: 0, period: LAND * 2, easing: "ease-out" });
  // Every firefly glows in its own rhythm (flight.ts): working ones flash,
  // blocked ones fast and bright, done ones breathe dimly, resting ones blink faintly.
  const halo = landing ? fade(glow.text_color(landing.color)) : flash(glow, a.status, h);
  const sweep = SWEEP.get(a.status);

  // The firefly's body is its agent's mark, on a dark plate so the halo's
  // dots don't run into it.
  const body0 = div().relative().size(40).flex_none()
    .child(halo).child(div().absolute().top(10).left(10).size(20).bg(t.background))
    // The winged mark (winged.ts, as the agent's tab and pane header wear it):
    // its mark at 12..28, the wings' roots on its shoulders.
    .child(div().absolute().top(10).left(8).child(wingedMark(a, color, 16, beatOf(a, h, landing))))
    .child(div().absolute().top(12).left(12).size(16).overflow_hidden()
      .when(Boolean(landing), (el) => (landing ? el.child(fade(div().absolute().top(0).left(0).size(16).child(flyMark(a, landing.color)))) : el))
      // Alive: a band of night-colored dither sweeps across the mark. Over
      // the plate it vanishes, so only the mark's own pixels darken, like a
      // scanline over a sprite. Working sweeps slowly, blocked fast.
      .when(sweep != null && !still, (el) => el.child(div().absolute().top(0).h(16).w(6)
        .loop("left", { from: -6, to: 16, period: (sweep ?? 0) + (h % 400), easing: "linear" })
        .child(dither(t.background, 1)))))
    // Done says so by shape too, not only by its green: a check on the mark.
    .when(a.status === "done", (el) => el.child(doneBadge(t).absolute().top(22).left(22)));

  // Only the firefly flies (flight.ts), in its slot, leaving dust; its name stays put.
  // The focused one's square wears the corner ticks: the glow's dotted
  // square (art/glow.svg, 8..34 of its 40 px) where its slot holds still as it flies.
  const fly = div().relative().size(40).flex_none()
    .children(dust(a.status, h, () => div().child(dither(color, 1))))
    .when(a.focused, (el) => el.child(div().absolute().left(GLOW_SQUARE.at).top(GLOW_SQUARE.at).size(GLOW_SQUARE.size)
      .children(cornerTicks(t, TICK_OUT))))
    .child(flyPath(body0, a.status, h, sky.naming === a.address || Boolean(landing)));

  // The pane's name leads (the agent's own when nobody named it). Only
  // what the halo doesn't already say follows: its space when that isn't
  // the shown one; awake ones add their status on a second line, resting
  // ones keep to one. The focused one stands in a moonlit path: a dithered band
  // behind its name that thins out in three steps, and only its name is bright;
  // its firefly's square wears the corner ticks, as its cell does on the rail.
  const title = givenName(a.address) ?? (a.program.agent ? a.program.name : a.title || a.program.name || a.address);
  const naming = sky.naming === a.address;
  const resting = a.status === "idle" || lane < 32;
  const elsewhere = a.space_name && a.space !== sky.shownSpace ? a.space_name : null;
  const whereColor = a.focused || on ? t.foreground : a.status === "blocked" ? t.blocked : t.muted;
  const sub = [elsewhere, a.status === "idle" ? null : WORD[a.status]].flatMap((x) => (x ? [x] : [])).join(" · ");

  // A press, a right-click or a double-click (naming) anywhere on the lane:
  // its full width and half the gap to each neighbour (`reach`), not only
  // the firefly and its name. While naming, the name's field keeps them.
  const press = (el: Element) => el
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();

      if (e.click_count === 2) sky.startNaming(a, cx);
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      sky.flyMenu(a);
    })
    .on_click((e) => {
      if (e.click_count < 2) run("agent.focus", { terminal: a.address });
    });

  const hit = div().id(`hit-${a.address}`).absolute().left(0).w(w).top(-reach.up).h(lane + reach.up + reach.down).map(press);
  const input = sky.nameInput;

  const body = h_flex().id(`fly-${a.address}`).absolute().top(0).left(x).h(lane).items_center()
    .when(naming, press)
    .child(fly)
    .child(naming && input
      ? h_flex().ml(-2).w(w - x - 50).gap(4).items_center()
        .child(field(t, `name-${a.address}`, input, (cx) => {
          sky.naming = null;
          cx.notify();
        }))
      : v_flex().ml(-2).max_w(w - x - 44).min_w(0).relative().pl(6).pr(4).py(1).gap(1)
        .child(resting
          ? h_flex().min_w(0).gap(6).items_baseline()
            .child(div().flex_none().max_w(w - x - 54).truncate().text_size(11).text_color(whereColor).child(title))
            .when(Boolean(elsewhere), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(elsewhere ?? "")))
          : div().truncate().text_size(11).text_color(whereColor).child(title))
        .when(!resting && Boolean(sub), (el) => el.child(a.status === "done"
          // Done reads at a glance: a check and the word, bright, not dim.
          ? h_flex().min_w(0).gap(4).items_center()
            .child(svg(CHECK).size(10).flex_none().text_color(t.done))
            .child(div().truncate().text_size(11).text_color(t.foreground).child(sub))
          : div().truncate().text_size(11).text_color(t.dim).child(sub))));

  const step = (o: number) => div().flex_1().h_full().relative().opacity(o).child(dither(t.ansi0, 1));

  const path = h_flex().absolute().top(4).bottom(4).left(x + 36).right(0).gap(2)
    .child(step(1).flex_grow(3)).child(step(0.6)).child(step(0.3));

  // The lane holds still (only the firefly in it flies), so it can move to
  // a new spot (to rest, say) on its own transition.
  const inner = div().absolute().top(0).left(0).w(w).h(lane).when(!naming, (el) => el.child(hit)).child(body);

  return div().id(`lane-${a.address}`).absolute().left(0).w(w).h(lane).top(y)
    .transition("top", { duration: LAND, easing: "ease-in-out" })
    .when(a.focused || on, (el) => el.child(path))
    .when(on, (el) => el.child(div().absolute().left(0).top(4).bottom(4).w(2).bg(t.accent)))
    .child(inner);
}

/**
 * The folded rail's jar, filling its (relative) parent: a lid, a neck, 2 px
 * dithered walls and a faint moonlit fill, square like everything here.
 * When a pinned firefly needs you the glass breathes in its color, slower
 * than the firefly's own blink; just after one flies in, it glints.
 */
export function railGlass(sky: Sky, t: Theme, jarred: readonly AgentInfo[], n = RAIL_NECK): Element {
  const needs = jarred.some((a) => a.status === "blocked");
  const tone = needs ? t.blocked : t.ansi8;
  const strip = (el: Element) => el.absolute().child(dither(tone, 1));
  // A mason jar, symmetric around its middle, square pixels only: a screw
  // band lid wider than the neck, the neck, shoulders stepping out in two
  // stairs, then the body's walls and base. `n`: the neck's inset.
  const half = Math.round(n / 2);
  // The same piece on the left and, mirrored, on the right (`side(el, x)` places it x in).
  const pair = (mk: (side: (el: Element, x: number) => Element) => Element) => [mk((el, x) => el.left(x)), mk((el, x) => el.right(x))];

  const frame = div().absolute().top(0).left(0).size_full()
    .child(div().absolute().top(0).left(n - 4).right(n - 4).h(4).bg(tone)) // the lid
    .child(strip(div().top(4).left(n - 4).right(n - 4).h(2)).opacity(0.6)) // its band
    .children(pair((side) => strip(side(div().top(6).w(2).h(6), n)))) // the neck
    .children(pair((side) => strip(side(div().top(12).w(n - half + 2).h(2), half)))) // upper shoulders
    .children(pair((side) => strip(side(div().top(14).w(half + 2).h(2), 0)))) // lower shoulders
    .children(pair((side) => strip(side(div().top(BODY).bottom(0).w(2), 0)))) // the walls
    .child(strip(div().bottom(0).left(0).right(0).h(2))); // the base

  const glinting = sky.glintUntil > Date.now();

  // The glass: the body and the neck, faintly moonlit (or red while one needs you).
  const fill = (c: Color, o: number) => [
    div().absolute().top(BODY).left(2).right(2).bottom(2).opacity(o).child(dither(c, 1)),
    div().absolute().top(6).left(n + 2).right(n + 2).h(6).opacity(o).child(dither(c, 1)),
    div().absolute().top(12).left(half + 2).right(half + 2).h(4).opacity(o).child(dither(c, 1)),
  ];

  return div().absolute().top(0).left(0).size_full()
    .children(fill(needs ? t.blocked : t.ansi4, needs ? 0.16 : 0.1))
    .when(glinting, (el) => el.child(div().absolute().top(0).left(0).size_full()
      .loop("opacity", { from: 0.35, to: 0, period: GLINT * 2, easing: "ease-out" }).children(fill(t.foreground, 1))))
    .child(needs ? frame.loop("opacity", { from: 0.5, to: 1, period: 2400 }) : frame.opacity(0.85));
}

/**
 * The jar in the open sky, filling its (relative) parent: a mason jar,
 * square pixels only. A lid with a rim and a screw thread, a clear neck,
 * shoulders in a quarter round, walls drawn crisp outside and dithered
 * inside (the glass's thickness), round foot corners and a thick base, a
 * sheen down the left of the glass and a faint moonlit fill. When a pinned
 * firefly needs you the glass breathes in its color; just after one flies
 * in, it glints.
 */
export function glass(sky: Sky, t: Theme, jarred: readonly AgentInfo[], n = NECK): Element {
  const needs = jarred.some((a) => a.status === "blocked");
  const tone = needs ? t.blocked : t.ansi8;
  const strip = (el: Element, c: Color = tone) => el.absolute().child(dither(c, 1));
  const solid = (el: Element, c: Color = tone) => el.absolute().bg(c);
  const pair = (mk: (side: (el: Element, x: number) => Element) => Element) => [mk((el, x) => el.left(x)), mk((el, x) => el.right(x))];
  // The shoulders: a quarter round from the neck (n in) down to the walls,
  // in 2 px rows, square pixels: each row's edge, x in from the side.
  const SH = JAR_BODY - LID - 4;
  const rows = SH / 2;
  const edge = (k: number) => Math.round(n * (1 - Math.sin((Math.PI / 2) * (k + 1) / rows)));
  const shoulders: Element[] = [];

  for (let k = 0; k < rows; k++) {
    const x = edge(k);
    const prev = k ? edge(k - 1) : n;

    shoulders.push(...pair((side) => solid(side(div().top(LID + 4 + 2 * k).w(Math.max(1, prev - x + 1)).h(k === rows - 1 ? 2 : 1), x))));
    shoulders.push(...pair((side) => solid(side(div().top(LID + 4 + 2 * k).w(1).h(2), x))));
  }

  // J1, a mason jar: a lid with a rim and a screw thread, a clear neck,
  // round shoulders, walls drawn crisp outside and dithered inside (the
  // glass's thickness), round foot corners, a sheen down the left.
  const frame = div().absolute().top(0).left(0).size_full()
    .child(solid(div().top(0).left(n - 6).right(n - 6).h(2))) // the lid's rim
    .children([3, 5, 7].map((y) => solid(div().top(y).left(n - 5).right(n - 5).h(1)).opacity(0.65))) // its thread
    .children(pair((side) => solid(side(div().top(0).w(1).h(LID), n - 6)))) // the lid's sides
    .child(solid(div().top(LID - 1).left(n - 6).right(n - 6).h(1)))
    .children(pair((side) => solid(side(div().top(LID).w(1).h(4), n)))) // the neck
    .children(shoulders)
    .children(pair((side) => solid(side(div().top(JAR_BODY).bottom(4).w(1), 0)))) // the walls
    .children(pair((side) => strip(side(div().top(JAR_BODY).bottom(5).w(2), 1)).opacity(0.5))) // their thickness
    .children(pair((side) => solid(side(div().bottom(2).w(2).h(2), 1)))) // the foot's corners
    .child(solid(div().bottom(0).left(3).right(3).h(2))) // the base
    .child(strip(div().bottom(2).left(3).right(3).h(3)).opacity(0.5));

  const sheen = div().absolute().top(0).left(0).size_full()
    .child(strip(div().top(JAR_BODY + 4).left(4).w(2).bottom(20), t.foreground).opacity(0.5))
    .child(strip(div().bottom(10).left(4).w(2).h(4), t.foreground).opacity(0.35))
    .child(strip(div().top(LID + 6).left(Math.round(n / 3) + 2).w(4).h(2), t.foreground).opacity(0.45));

  const inner = div();
  const glinting = sky.glintUntil > Date.now();

  const fill = (c: Color, o: number) => [
    div().absolute().top(JAR_BODY).left(2).right(2).bottom(3).opacity(o).child(dither(c, 1)),
    div().absolute().top(LID).left(n + 1).right(n + 1).h(SH + 4).opacity(o).child(dither(c, 1)),
    div().absolute().top(LID + 4 + SH / 2).left(Math.round(n / 3)).right(Math.round(n / 3)).h(SH / 2).opacity(o).child(dither(c, 1)),
  ];

  return div().absolute().top(0).left(0).size_full()
    .child(inner)
    .children(fill(needs ? t.blocked : t.ansi4, needs ? 0.16 : 0.12))
    .when(glinting, (el) => el.child(div().absolute().top(0).left(0).size_full()
      .loop("opacity", { from: 0.35, to: 0, period: GLINT * 2, easing: "ease-out" }).children(fill(t.foreground, 1))))
    .child(sheen)
    .child(needs ? frame.loop("opacity", { from: 0.55, to: 1, period: 2400 }) : frame.opacity(0.95));
}

/** The jar in the open sky, behind its fireflies' lanes. */
export function jarGlass(sky: Sky, t: Theme, jarred: readonly AgentInfo[], h: number, w: number): Element {
  return div().id("jar").absolute().top(JAR.at).left(JAR_SIDE).w(w - 2 * JAR_SIDE).h(h - JAR.at).child(glass(sky, t, jarred));
}

/** Inside the jar even a resting firefly glows a little: a soft halo
 *  behind its lane (awake ones have their own), on the dark plate. */
export function jarGlow(sky: Sky, t: Theme, a: AgentInfo, y: number, lane: number): Element {
  // Not while it flies in (its plate would wait there before it), nor while landing.
  if (a.status !== "idle" || sky.landing.has(a.address) || sky.arriving?.has(a.address)) return div();

  const top = y + Math.round((lane - 40) / 2);

  return div().id(`jar-glow-${a.address}`).absolute().left(JAR_INSET + 6).top(top).size(40)
    .transition("top", { duration: LAND, easing: "ease-in-out" })
    .child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(40).text_color(t.muted).opacity(0.45))
    .child(div().absolute().top(10).left(10).size(20).bg(t.background));
}

/** Notes fireflies that just flew into the jar: its glass glints for GLINT ms. */
export function glint(sky: Sky, jarred: readonly (AgentInfo | JarItem)[], cx: Context): void {
  const now = new Set(jarred.map((a) => heldKey(a)));
  const seen = sky.jarSeen;
  const fresh = seen ? jarred.filter((a) => !seen.has(heldKey(a))) : [];

  if (Date.now() >= sky.glintUntil) sky.arriving = null;

  if (fresh.length) {
    sky.glintUntil = Date.now() + GLINT;
    sky.arriving = new Set([...(sky.arriving ?? []), ...fresh.map((a) => heldKey(a))]);
    cx.timer.after(GLINT + 50, (later) => later.notify());
  }

  sky.jarSeen = now;
}

/** Pins made elsewhere get their place in the jar; an unpin's leftover time goes (pins.ts stamps). Once per value. */
export function stamp(sky: Sky): void {
  const now = Date.now();

  for (const [k, v] of sky.stamped) if (now - v > 5000) sky.stamped.delete(k);

  for (const [terminal, kv] of stamps(terminals().filter((x) => isTerminal(x)), now)) {
    const key = `${terminal} ${kv.replace(/=.*/, "")}`;

    if (sky.stamped.has(key)) continue;

    sky.stamped.set(key, now);
    hc(["label", terminal, kv]).catch(() => {});
  }
}

// Awake fireflies (blocked, working, running a command) spread through the
// sky above the grass; those at rest (done, then resting: kit.ts atRest)
// sit in a stack on the near ridge, as on the rail.
// Pinned ones (pins.ts) live in a glass jar at the top, in the order
// pinned; the rest keep this order below it. Lanes are placed in one space,
// so a firefly being pinned flies up into the jar (and back out). Pinned
// panes that aren't agents (`kept`) sit on the shelf at the jar's foot.
export function meadowView(sky: Sky, t: Theme, list: readonly AgentInfo[], jarred: readonly AgentInfo[] = [], kept: readonly JarItem[] = []): Element {
  // Measured sizes come back as drawn (zoomed); lengths here are layout px.
  const zoom = settings().zoom || 1;
  const w = sky.field.width / zoom;
  const hgt = sky.field.height / zoom;
  const inJar = new Set(jarred.map((a) => a.address));
  const shelfW = w - 2 * JAR_INSET;
  const { placed, jarH, shelfY, more, moreY } = meadowPlan(list, jarred, kept.length, w, hgt);

  const jarLanes = placed.filter(([a]) => inJar.has(a.address));
  const reaches = laneReach(placed.map(([a, y, l]) => ({ y, h: l, jar: inJar.has(a.address) })));

  return div().id("meadow").relative().flex_1().min_h(0).w_full()
    .on_size_change((size, cx) => {
      sky.field = size;
      cx.notify();
    })
    .when(jarH > 0, (el) => el.child(jarGlass(sky, t, jarred, jarH, w)).children(jarLanes.map(([a, y, l]) => jarGlow(sky, t, a, y, l))))
    // The jar's lanes sit inside its walls, the same margin on both sides.
    .children(placed.map(([a, y, l], i) => (inJar.has(a.address)
      ? firefly(sky, t, a, y, l, w - 2 * JAR_INSET, reaches[i]).left(JAR_INSET)
      : firefly(sky, t, a, y, l, w, reaches[i]))))
    .when(kept.length > 0, (el) => el.child(div().absolute().left(JAR_INSET).top(shelfY).w(shelfW).child(shelfView(sky, t, kept, shelfW))))
    .when(more > 0, (el) => el.child(div().id("more").absolute().left(50).top(moreY).h(MORE_H).flex().items_center()
      .map((m) => navRing(t, m, sky.nav("more", "flies", { go: () => run("agent.next") })))
      .text_size(11).text_color(t.ansi8).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(() => run("agent.next"))
      .child(`+${more} more in the grass`)));
}

// ---- the shelf: pinned panes that aren't agents (pins.ts onShelf)
