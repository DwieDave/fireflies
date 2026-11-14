// The folded sidebar (sky.ts folds it): the rail with the moon and the hour,
// a row per space, the fireflies' marks, the jar's glass, the resting ones'
// ground and the usage meters.

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run } from "herdr";
import type { AgentInfo, SpaceInfo, Theme } from "herdr";
import { ART, WORD, atRest, dither, pip, hash, givenName, navRing, cornerTicks } from "./kit.ts";
import type { JarItem } from "./pins.ts";
import { calm, flash } from "./flight.ts";
import { stop, moonPhase, RAIL_RIDGE, RAIL_GROUND_ONE, RAIL_GROUND_MAX, RAIL_NECK, BODY, RAIL_REACH, PAIR_REACH, BOARD, RAIL_TILE, RAIL_TILE_GAP } from "./sky-plan.ts";
import type { RailReach } from "./sky-plan.ts";
import { flyActs, railActs } from "./sky-keys.ts";
import { doneBadge, railGlass } from "./meadow.ts";
import { flyMark } from "./winged.ts";
import { pinTile } from "./shelf.ts";
import type Sky from "./sky.ts";

/** The rail's name for a space: its first letter, and the next one small ("Mo"). */
export function initials(name: string): string {
  const chars = name.match(/[\p{L}\p{N}]/gu) ?? [];
  const first = chars[0];

  return first ? first.toUpperCase() + (chars[1] ?? "").toLowerCase() : "·";
}

/** The rail's » : a bordered key, filled and bright under the pointer. */
export function openKey(sky: Sky, t: Theme): Element {
  const on = sky.nav("fold", "top", { go: (cx) => sky.fold(cx) });

  return div().id("fold").relative().flex_none().w(28).h(20).flex().items_center().justify_center()
    .map((el) => navRing(t, el, on))
    .border(1).border_color(t.ansi0).text_size(11).text_color(t.muted)
    .hover((s) => s.text_color(t.foreground).bg(t.ansi0).border_color(t.ansi8))
    .tooltip("Open the sidebar (⌘B)")
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      sky.fold(cx);
    })
    .child("»");
}

/** A space's rail row: its initials on a dotted thread down the rail's
 *  middle that runs only between spaces (`at`: its place, of `count`). The
 *  shown one has blue corner ticks; the one under the pointer a grey plate;
 *  one that wants attention its status pip beside the initials. */
export function railSpace(sky: Sky, t: Theme, s: SpaceInfo, at: number, count: number): Element {
  const hot = sky.railHover === s.id || sky.nav(`space:${s.id}`, "spaces", railActs(sky, s));

  const thread = count > 1 ? div().absolute().left(0).right(0).top(at === 0 ? 13 : 0).bottom(at === count - 1 ? 13 : 0).flex().justify_center()
    .child(div().relative().w(1).h_full().child(dither(`${t.ansi8}99`, 1))) : null;

  return div().id(`rail-space-${s.id}`).relative().w_full().h(26).flex_none().flex().items_center().justify_center().text_size(11)
    .tooltip(s.name)
    .on_hover((h, cx) => {
      if (h ? sky.railHover !== s.id : sky.railHover === s.id) {
        sky.railHover = h ? s.id : null;
        cx.notify();
      }
    })
    .on_mouse_down("left", stop)
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      sky.spaces.menu(s);
    })
    .on_click(() => run("space.select", { id: s.id }))
    .when(Boolean(thread), (el) => (thread ? el.child(thread) : el))
    // On a plate of the night's ground (the list is on it too, so no star
    // lands beside a letter like a stray mark), so the thread stops at the letters.
    .child(div().relative().px(3).py(1).bg(hot ? t.ansi0 : t.background).text_color(s.active || hot ? t.foreground : t.muted)
      .child(initials(s.name))
      .when(s.active, (el) => el.children(cornerTicks(t)))
      .when(Boolean(s.status) && s.status !== "idle", (el) => el.child(div().absolute().right(-13).top(5).child(pip(t, s.status)))));
}

/** A firefly on the rail: its mark in a 32 px cell, glowing in its rhythm
 *  (flight.ts); a working one rises and falls a pixel or two. */
export function railFly(sky: Sky, t: Theme, a: AgentInfo, size = 32, reach: RailReach = RAIL_REACH): Element {
  const h = hash(a.address);
  const on = sky.nav(`fly:${a.address}`, "flies", flyActs(sky, a));
  const color = a.status === "idle" ? t.muted : t[a.status];
  const awake = a.status !== "idle";
  const mark = div().relative().child(flyMark(a, color));
  const plate = (size - 16) / 2;

  return div().id(`rail-fly-${a.address}`).relative().size(size).flex_none().flex().items_center().justify_center()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .tooltip(`${givenName(a.address) ?? a.program.name ?? a.title ?? a.address}${a.space_name ? ` · ${a.space_name}` : ""} · ${WORD[a.status]}`)
    // Pressed anywhere on the cell and the padding around it (`reach`), not only the mark.
    .child(div().id(`rail-hit-${a.address}`).absolute().left(-reach.x).top(-reach.y).w(size + 2 * reach.x).h(size + 2 * reach.y)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        sky.flyMenu(a);
      })
      .on_click(() => run("agent.focus", { terminal: a.address })))
    // Focused: a plate of the ground, the corner ticks on its corners.
    .when(a.focused, (el) => el.child(dither(t.ansi0, 1)).children(cornerTicks(t, 0)))
    .when(awake, (el) => el
      .child(flash(svg(`${ART}/glow.svg`).size(size).absolute().top(0).left(0).text_color(color), a.status, h))
      .child(div().absolute().top(plate).left(plate).size(16).bg(t.background)))
    .child(a.status === "working" && !calm() ? mark.loop("top", { from: -1, to: 1, period: 1900 + (h % 700) }) : mark)
    .when(a.status === "done", (el) => el.child(doneBadge(t).absolute().bottom(size > 28 ? 2 : 0).right(size > 28 ? 2 : 0)))
    .map((el) => navRing(t, el, on));
}

/** The rail's ground: fireflies at rest (done, then resting) stacked at its
 *  foot on the hills, as the open sky's are. Crowded: smaller cells, two
 *  abreast, then a count. Always above the usage, never behind it. */
export function railGround(sky: Sky, t: Theme, resting: readonly AgentInfo[]): Element | null {
  if (!resting.length) return null;

  const pairs = resting.length > RAIL_GROUND_ONE;
  const cell = pairs ? 28 : 30;
  const room = pairs ? RAIL_GROUND_MAX : resting.length;
  const shown = resting.length > room ? resting.slice(0, room - 1) : resting;
  const more = resting.length - shown.length;

  // The count takes the last cell, so the stack keeps its shape above the hills.
  const marks = [...shown.map((a) => railFly(sky, t, a, cell, pairs ? PAIR_REACH : RAIL_REACH)),
    ...(more > 0 ? [div().id("rail-ground-more").relative().size(cell).flex_none().flex().items_center().justify_center()
      .map((el) => navRing(t, el, sky.nav("more", "flies", { go: () => run("agent.next") })))
      .text_size(10).text_color(t.ansi8).hover((s) => s.text_color(t.foreground).bg(`${t.ansi0}55`))
      .tooltip(`${more} more at rest`)
      .on_mouse_down("left", stop).on_click(() => run("agent.next"))
      .child(`+${more}`)] : [])];

  const body = pairs
    ? v_flex().gap(2).items_center().children(Array.from({ length: Math.ceil(marks.length / 2) }, (_, i) =>
      h_flex().gap(2).children(marks.slice(i * 2, i * 2 + 2))))
    : v_flex().gap(1).items_center().children(marks);

  return v_flex().id("rail-ground").w_full().flex_none().items_center().pt(6).pb(RAIL_RIDGE).child(body);
}

/** Folded: the moon and the hour, », a row per space (sidebar order), every firefly's mark, the usage. */
export function railView(sky: Sky, t: Theme, list: readonly AgentInfo[], jarred: readonly AgentInfo[] = [], kept: readonly JarItem[] = []): Element {
  const rows = sky.spaces.rows().flatMap((r) => ("s" in r ? [r] : []));
  const inJar = new Set(jarred.map((a) => a.address));
  const free = list.filter((a) => !inJar.has(a.address));

  // Made top to bottom, as the keyboard walks them (sky.nav lists each as it's
  // made): the jar's fireflies, its tiles, then the awake ones under the jar.
  // The pinned ones' marks for their small jar, resting ones lit a little.
  const jarCells = jarred.map((a) => div().relative().size(32).flex_none()
    .when(a.status === "idle", (el) => el.child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(32).text_color(t.muted).opacity(0.45))
      .child(div().absolute().top(8).left(8).size(16).bg(t.background)))
    .child(div().absolute().top(0).left(0).child(railFly(sky, t, a))));

  // The pinned panes that aren't agents: smaller tiles two abreast on a board under them.
  sky.tileOn = null;

  const tiles = kept.map((it) => pinTile(sky, t, it, RAIL_TILE));

  const shelf = kept.length ? v_flex().id("rail-shelf").flex_none().items_center().gap(RAIL_TILE_GAP).pt(jarred.length ? 2 : 0)
    .when(jarred.length > 0, (el) => el.child(div().relative().w(40).h(BOARD).opacity(0.7).child(dither(t.ansi8, 1))))
    .children(Array.from({ length: Math.ceil(tiles.length / 2) }, (_, i) => h_flex().gap(RAIL_TILE_GAP).children(tiles.slice(i * 2, i * 2 + 2)))) : null;

  // The pinned ones' marks in a small jar of their own.
  const jar = jarred.length || kept.length ? v_flex().id("rail-jar").relative().w(48).flex_none().items_center().pt(BODY + 2).pb(4).gap(2).mb(6)
    .child(railGlass(sky, t, jarred, RAIL_NECK))
    .children(jarCells)
    .when(Boolean(shelf), (el) => (shelf ? el.child(shelf) : el)) : null;

  // Awake ones under the jar at the top; those at rest on the ground at the foot (railGround).
  const flies = free.flatMap((a) => (atRest(a) ? [] : [railFly(sky, t, a)]));
  const ground = railGround(sky, t, free.filter(atRest));
  const rule = () => div().w(28).h(2).flex_none().relative().child(dither(t.ansi8, 1));
  const glowList = sky.glowList;
  const spacesList = v_flex().id("rail-spaces").relative().overflow_hidden().w_full().flex_none().bg(t.background);

  return v_flex().w_full().flex_1().min_h(0).pt(48).items_center()
    .child(v_flex().id("rail-clock").flex_none().items_center().tooltip(sky.clock.date).on_size_change(sky.railMeasure("clock"))
      .child(svg(`${ART}/moon-${moonPhase(list)}.svg`).size(32).flex_none().text_color(t.ansi7))
      .child(div().pt(4).text_size(11).text_color(t.foreground).child(sky.clock.time)))
    .child(div().id("rail-key").pt(10).pb(14).flex_none().on_size_change(sky.railMeasure("key")).child(openKey(sky, t)))
    .child((glowList ? spacesList.child(glowList) : spacesList).children(rows.map(({ s }, i) => railSpace(sky, t, s, i, rows.length))))
    .child(div().py(12).flex_none().child(rule()))
    .child(v_flex().id("rail-flies").w_full().flex_1().min_h(0).gap(2).items_center().overflow_y_scroll().when(Boolean(jar), (el) => (jar ? el.child(jar) : el)).children(flies))
    .when(Boolean(ground), (el) => (ground ? el.child(ground) : el))
    .child(sky.usage.rail(t, sky.nav));
}
