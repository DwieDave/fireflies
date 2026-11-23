// The fireflies' machine filter (item 33): above the sky's fireflies, one row
// of chips, "all" and one per machine (herdr machines(), this one first);
// choosing one shows only that machine's fireflies, in the meadow, the jar
// and on the rail. The choice is kept in shared state (MACHINE_KEY) across
// restarts; a chosen machine that's gone shows all again, its choice kept.
// With one machine the row isn't drawn. In "all", each firefly's name wears a
// small square tag with its machine's initial (machineTags); with one chosen
// it says nothing new, so it's left out. An agent's machine is its space's,
// looked up in the draw's one spaces() list: no request per row.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import { setShared, shared, window as appWindow } from "herdr";
import * as herdrAll from "herdr";
import type { AgentInfo, SpaceInfo, Theme } from "herdr";
import { isString, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import { dither, navRing } from "./kit.ts";
import type { Nav } from "./nav.ts";

/** The chosen machine: { machine } (null: this one); absent: all of them. */
export const MACHINE_KEY = sharedKey("nocturne.machine", nullable(object({ machine: nullable(isString) })));

/** A machine's name (null: this one). */
export type Machine = string | null;

/** What the sky draws from the filter in one draw. */
export interface MachineView {
  /** Every machine, this one first; one or none: no bar. */
  readonly names: readonly Machine[];
  /** The chosen one, or undefined for all. */
  readonly chosen: Machine | undefined;
  /** An agent's machine. */
  readonly of: (a: Pick<AgentInfo, "space">) => Machine;
  /** An agent's tag on its row, or null (one machine, or one chosen). */
  readonly tag: (a: Pick<AgentInfo, "space">) => string | null;
}

/** The machines to offer: this one, then each machines() lists and each an agent is on, once. */
export function machineNames(listed: readonly { readonly name: Machine }[], agentMachines: Iterable<Machine>): Machine[] {
  const names: Machine[] = [null];

  for (const m of [...listed.map((x) => x.name), ...agentMachines]) if (!names.includes(m)) names.push(m);

  return names;
}

/** This machine's chip. */
export const localName = (): string => (appWindow().platform === "macos" ? "this mac" : "this machine");

/** Each machine's tag: this one "~" (home), the others the shortest start of
 *  their name (up to 3 letters, upper case) no other machine's shares. */
export function machineTags(names: readonly Machine[]): Map<Machine, string> {
  const others = names.filter((n): n is string => n !== null);
  const tags = new Map<Machine, string>([[null, "~"]]);

  for (const n of others) {
    let len = 1;

    while (len < 3 && others.some((o) => o !== n && o.slice(0, len).toLowerCase() === n.slice(0, len).toLowerCase())) len++;

    tags.set(n, n.slice(0, len).toUpperCase());
  }

  return tags;
}

/** The stored choice if that machine is offered, else undefined (all). */
export function chosenMachine(names: readonly Machine[]): Machine | undefined {
  const kept = readShared(shared, MACHINE_KEY, null);

  return kept && names.includes(kept.machine) ? kept.machine : undefined;
}

/** Chooses a machine (undefined: all). */
export function chooseMachine(machine: Machine | undefined): void {
  writeShared(setShared, MACHINE_KEY, machine === undefined ? null : { machine });
}

/** The filter as this draw sees it, from the draw's spaces and agents (no other request than machines()). */
export function machineView(sp: readonly SpaceInfo[], list: readonly AgentInfo[]): MachineView {
  const bySpace = new Map(sp.map((s): readonly [string, Machine] => [s.id, s.machine ?? null]));
  const of = (a: Pick<AgentInfo, "space">): Machine => bySpace.get(a.space) ?? null;
  // A Herdr without machines() (as sky-plan.ts asks of nativeView) has only this one.
  const names = machineNames("machines" in herdrAll ? herdrAll.machines() : [], list.map(of));
  const chosen = names.length > 1 ? chosenMachine(names) : undefined;
  const tags = names.length > 1 && chosen === undefined ? machineTags(names) : null;

  return { names, chosen, of, tag: (a) => tags?.get(of(a)) ?? null };
}

/** The sky's agents (kit.ts sortedAgents) on the chosen machine, and the filter that chose them. */
export function shownAgents(sp: readonly SpaceInfo[], sorted: { readonly pinned: readonly AgentInfo[]; readonly all: readonly AgentInfo[] }) {
  const view = machineView(sp, sorted.all);

  return { view, jarred: onMachine(view, sorted.pinned), list: onMachine(view, sorted.all) };
}

/** Adds the bar (machineBar) to the sky's column, if it's drawn. */
export function withMachineBar(el: Element, t: Theme, v: MachineView, nav: Nav, redraw: () => void): Element {
  const bar = machineBar(t, v, nav, redraw);

  return bar ? el.child(bar) : el;
}

/** Agents on the chosen machine (all of them while none is chosen). */
export const onMachine = <A extends Pick<AgentInfo, "space">>(v: MachineView, list: readonly A[]): A[] =>
  (v.chosen === undefined ? [...list] : list.filter((a) => v.of(a) === v.chosen));

/** A firefly's machine tag: its letters in a small square, dim. */
export function machineTag(t: Theme, tag: string): Element {
  return div().flex_none().h(12).min_w(12).px(2).flex().items_center().justify_center()
    .border(1).border_color(t.muted).text_size(8).text_color(t.dim).child(tag);
}

/** The bar: "all" and a chip per machine in one row, the chosen one lit with
 *  a dithered foot; long rows are cut at the edge, never wrapped. Null with one machine. */
export function machineBar(t: Theme, v: MachineView, nav: Nav, redraw: () => void): Element | null {
  if (v.names.length < 2) return null;

  const chip = (key: string, label: string, machine: Machine | undefined) => {
    const lit = v.chosen === machine;

    const choose = () => {
      chooseMachine(machine);
      redraw();
    };

    const on = nav(`machine:${key}`, "flies", { go: choose });

    return div().id(`machine-${key}`).relative().flex_none().max_w(110).px(6).h(18).flex().items_center()
      .text_size(11).text_color(lit || on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        choose();
      })
      .child(div().truncate().child(label))
      .when(lit, (el) => el.child(div().absolute().left(4).right(4).bottom(0).h(2).child(dither(t.accent, 1))))
      .map((el) => navRing(t, el, on));
  };

  return h_flex().id("machines").px(10).pt(4).flex_none().w_full().overflow_hidden().gap(2).items_center()
    .child(chip("all", "all", undefined))
    .children(v.names.map((m) => chip(m ?? "~", m ?? localName(), m)));
}
