// Shared pieces: art paths, the dither fill, status words and pips.
// Every color comes from theme() (the moonfly theme), never a literal.

import { div, svg } from "gpui-kit";
import type { Element, FocusHandle, MouseButtonEvent } from "gpui-kit";
import { settings, terminals, hc, home, run, agents, focused, panes, shared, setShared, spaces } from "herdr";
import type { AgentInfo, ExecResult, PaneInfo, SpaceInfo, Status, Theme } from "herdr";
import { isNumber, isString, nullable, object, sharedKey, writeShared } from "./guard.ts";
import { isTerminal } from "./guards.ts";
import type { JsonMap, Labels, Terminal } from "./guards.ts";
import { isDock, toDock, newSlot } from "./dock.ts";
import { AT_LABEL, isPinned, sortAgents, paneRecords, storedRecords, panePinned, pinPaneRecord, pinTabRecord, paneKey, isPaneKey, jarItems, reorder, retime, PANES_KEY } from "./pins.ts";
import type { JarItem, PaneRecord, SortedAgents } from "./pins.ts";
// The toolbar's ground and the dither fill: toolground.ts (the same file in
// ../nocturne and ../notifications).
import { dither } from "./toolground.ts";

export { dither, TOOL_LOOK, toolGround, mix, toolHover } from "./toolground.ts";

export const ART = "mods/nocturne/art";
export const FONT = "Departure Mono";

/** The tab strip's icon button (tabs.ts tool): its id, lit or not, a tooltip
 *  (null: none), what a press does (the press, and whether it was lit then), its contents. */
export type ToolButton = (t: Theme, id: string, on: boolean, tip: string | null, action: (e: MouseButtonEvent | undefined, wasOpen: boolean) => void, ...kids: Element[]) => Element;

/** Where a drop-down goes (window px). */
export interface DropAt {
  readonly x: number;
  readonly y: number;
}

/** Where a drop-down opened by a press on a tab-strip button goes: its top
 *  on the strip's horizon (the row is 36 px, the button 24 centered in it),
 *  its right edge on the button's, so it hangs under the button without
 *  covering it (a second press then lands on the button and closes it).
 *  `width`: the drop-down's, in layout px. Null when the press has no bounds. */
export function dropBelow(e: Pick<MouseButtonEvent, "position" | "local_position" | "bounds"> | null | undefined, width: number): DropAt | null {
  const b = e?.bounds;
  const l = e?.local_position;

  if (!e || !b || !l) return null;

  const zoom = settings().zoom || 1;
  const left = e.position.x - l.x;
  const top = e.position.y - l.y;

  return { x: Math.round(Math.max(8, left + b.width - width * zoom)), y: Math.round(top + b.height + 6 * zoom) };
}

/** The label holding the name a person gave a pane's terminal (the pane menu's
 *  and a firefly's "Rename"). It lives on the terminal, so the name follows it
 *  to another pane or tab, and ends with it. */
export const NAME_LABEL = "nocturne.name";

/** Every terminal herdr-core lists, as Nocturne reads them (the listing parsed). */
export const terminalsNow = (): Terminal[] => terminals().filter((t) => isTerminal(t));

/** A terminal (an address) as listed now, or undefined. */
const terminalAt = (terminal: string | null | undefined): Terminal | undefined => (terminal ? terminalsNow().find((x) => x.address === terminal) : undefined);

/** The name a person gave this terminal (an address), or null. */
export function givenName(terminal: string | null | undefined): string | null {
  return terminalAt(terminal)?.labels?.[NAME_LABEL] || null;
}

/** Names a terminal; "" takes the name away, so it goes by its program's again. */
export function nameTerminal(terminal: string, name: string): Promise<ExecResult | void> {
  return hc(["label", terminal, `${NAME_LABEL}=${name.trim()}`]).catch(() => {});
}

/** A terminal's labels (an address), {} if it's gone. */
export const labelsOf = (terminal: string | null | undefined): Labels => terminalAt(terminal)?.labels ?? {};

/** Pinned to the jar at the top of the sky (pins.ts: Fireflies' herdr.pinned label). */
export const pinned = (terminal: string | null | undefined): boolean => isPinned(labelsOf(terminal));

/** Pins a terminal (an agent's, or a plain shell's) to the top of the sky, or
 *  unpins it: Fireflies' terminal.pin, and the time it joined the jar (its order there). */
export function pin(terminal: string | null | undefined, on = !pinned(terminal)): void {
  if (!terminal) return;

  run("terminal.pin", { terminal, pinned: on });
  hc(["label", terminal, `${AT_LABEL}=${on ? Date.now() : ""}`]).catch(() => {});
}

/** The sidebar's agent order (pins.ts sortAgents): { pinned, rest, all }. */
export const sortedAgents = (): SortedAgents<AgentInfo> => sortAgents([...agents()], agentRank, labelsOf);

/** The mod panes' pins (pins.ts PANES_KEY), as stored. */
export const paneRecordsNow = (): PaneRecord[] => paneRecords(shared);

/** Everything in the jar, in its order (pins.ts jarItems): agents, plain terminals, mod panes. */
export const jar = (): JarItem[] => jarItems({ agents: [...agents()], terminals: terminalsNow(), panes: panes(), records: paneRecordsNow() });

/** A pane as a pin's target: a PaneInfo, or a menu's target. A mod pane has
 *  no terminal; a terminal shown in a layout block has no pane. */
export interface PinTarget {
  readonly pane: string | null;
  readonly terminal: string | null;
}

/** A pane's key in the jar: its terminal's address, or "pane:<id>" for a mod pane. */
export const pinKey = (p: PinTarget | null | undefined): string | null => p?.terminal ?? (p?.pane ? paneKey(p.pane) : null);

/** A pane is in the jar. */
export function panePinnedNow(p: PinTarget | null | undefined): boolean {
  if (p?.terminal) return pinned(p.terminal);

  return Boolean(p?.pane) && panePinned(paneRecordsNow(), p?.pane ?? "");
}

/** The PaneInfo of a pane id, if it's there. */
const paneInfo = (pane: string | null | undefined): PaneInfo | undefined => (pane ? panes().find((x) => x.pane === pane) : undefined);

/** Stores the mod panes' pins. */
const storeRecords = (records: readonly PaneRecord[]) => setShared(PANES_KEY, storedRecords(records));

/** Pins any pane to the top of the sky, or unpins it: a terminal through its
 *  labels (pin), a mod pane in PANES_KEY. */
export function pinPane(p: PinTarget | null | undefined, on = !panePinnedNow(p)): void {
  if (p?.terminal) {
    pin(p.terminal, on);

    return;
  }

  const info = paneInfo(p?.pane);

  if (!info) return;

  storeRecords(pinPaneRecord(paneRecordsNow(), info, on, Date.now()));
}

/** Moves a pin (its jar key: a terminal's address or "pane:<id>") one step up
 *  (-1) or down (+1) in the jar, past pins of any kind. */
export function movePin(key: string | null | undefined, dir: number): void {
  if (!key) return;

  const times = reorder(jar(), key, dir, Date.now());

  if (!times.length) return;

  for (const [k, at] of times) if (!isPaneKey(k)) hc(["label", k, `${AT_LABEL}=${at}`]).catch(() => {});

  if (times.some(([k]) => isPaneKey(k))) storeRecords(retime(paneRecordsNow(), times));
}

/** The focused pane's terminal (keys and the palette pin it). */
export const focusedTerminal = (): string | null => focused()?.terminal ?? null;

/** The focused pane as a pin target. Null: none. */
export function focusedPane(): PinTarget | null {
  const f = focused();

  if (!f) return null;

  const p = paneInfo(f.pane);

  if (p) return { pane: p.pane, terminal: p.terminal ?? null };

  return f.terminal ? { pane: null, terminal: f.terminal } : null;
}

/** nocturne.pin: pins the focused pane (any kind), or unpins it. */
export function pinFocused(): void {
  const p = focusedPane();

  if (p) pinPane(p);
}

/** nocturne.pin-up / pin-down: moves the focused pane's pin in the jar. */
export function moveFocused(dir: number): void {
  movePin(pinKey(focusedPane()), dir);
}

// A web tab to show once its pane is on screen: { slot, tab, at } (goToPin).
// Commands reach only the copies on screen, and a pane in another tab or space
// comes there only after pane.focus: the web pane takes this up when it shows.
export const WEB_SHOW = "browser.show";

/** The browser's record of a tab to show (WEB_SHOW): the browser reads it. */
const WEB_SHOW_KEY = sharedKey(WEB_SHOW, object({ slot: nullable(isString), tab: isString, at: isNumber }));

/** A web pane's props, as far as a tab pin reads them: its slot. */
const isWebProps = object({}, { slot: isString });

/** Goes to a pin of any kind (a jar item, pins.ts jarItems): in whatever tab
 *  and space it is; a parked pane comes back (pane.focus). A web tab's pin
 *  (`it.tab`): its pane, then that tab (browser.show). */
export function goToPin(it: JarItem): void {
  if (it.kind === "pane" && it.tab) {
    const props = it.pane.props;
    const want = { slot: (isWebProps(props) ? props.slot : undefined) ?? null, tab: it.tab };

    writeShared(setShared, WEB_SHOW_KEY, { ...want, at: Date.now() });
    run("pane.focus", { pane: it.pane.pane });
    run(`browser.show:${JSON.stringify(want)}`);

    return;
  }

  if (it.kind === "pane" || (it.kind === "terminal" && it.pane)) {
    run("pane.focus", { pane: it.pane?.pane });

    return;
  }

  run("agent.focus", { terminal: it.key });
}

/** Takes a jar item out of the jar (a web tab's pin: that tab's alone). */
export function unpin(it: JarItem): void {
  if (it.kind === "pane" && it.tab) storeRecords(pinTabRecord(paneRecordsNow(), it.pane, it.tab, false, Date.now()));
  else if (it.kind === "pane") pinPane({ pane: it.pane.pane, terminal: null }, false);
  else pin(it.key, false);
}

/** Moves a pane into the dock (dock.ts: a tab of its own in the space tied to
 *  no folder) and pins it to the shelf, so its tile goes to it from anywhere. */
export function dockPane(p: PinTarget | null | undefined): void {
  const info = paneInfo(p?.pane);

  if (!info) return;

  if (toDock({ kind: "move", pane: info.pane }) && !panePinnedNow(info)) pinPane(info, true);
}

/** nocturne.dock: the focused pane into the dock (dockPane), if it's a local pane outside it. */
export function dockFocused(): void {
  const p = paneInfo(focusedPane()?.pane);

  if (p && !p.pane.includes("/") && !isDock(spaces().find((s) => s.tabs.some((c) => c.id === p.tab)))) dockPane(p);
}

/** A new web pane in the dock, pinned to the shelf: its pin is written by its
 *  props (a fresh slot), so it's found once the pane is there (pins.ts findPane). */
export function dockWeb(url?: string): void {
  const slot = newSlot();
  const props: JsonMap = new Map(url ? [["slot", slot], ["url", url]] : [["slot", slot]]);

  if (!toDock(url ? { kind: "web", slot, url } : { kind: "web", slot })) return;

  storeRecords([...paneRecordsNow(), { pane: `new:${slot}`, mod: "browser", props, at: Date.now() }]);
}

/** Program keys with a dithered logo in art/logo-*.svg (keys are programs' own: data). */
export const LOGO: ReadonlyMap<string, string> = new Map([["claude", "claude"], ["claude-code", "claude"], ["opencode", "opencode"], ["pi", "pi"], ["codex", "codex"]]);

/** Where a space is now: its first terminal's live folder, else where it was made. */
export function place(s: SpaceInfo, all: readonly PaneInfo[]): string | null {
  const tabs = new Set(s.tabs.map((c) => c.id));

  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

/** A space's folder: the one it's attached to (space.new folder, space.folder),
 *  else where it is now (place). Its repo, GitHub and lazygit go by this. Home
 *  holds no repo: a space attached there goes by where it is now too. */
export function spaceFolder(s: SpaceInfo | null | undefined, all: readonly PaneInfo[]): string | null {
  // The dock (dock.ts) is tied to no folder: no repo there, wherever its shells are.
  if (!s || isDock(s)) return null;

  const mine = s.attached && s.folder && !(s.machine == null && s.folder.replace(/\/+$/, "") === home());

  return (mine && s.folder) || place(s, all);
}

export const WORD = { working: "working", blocked: "needs you", done: "done", idle: "resting" } as const satisfies { readonly [S in Status]: string };

/** Status order: what needs the person first, then what's busy, then what's at rest. */
export const RANK = { blocked: 0, working: 1, done: 2, idle: 3 } as const satisfies { readonly [S in Status]: number };

/** At rest: done or resting. Both sidebars set these on the ground by the
 *  hills, below the awake ones (needs you, working, running a command). */
export const atRest = (a: { readonly status: Status | null }): boolean => a.status === "idle" || a.status === "done";

/** An agent's place in every list: needs you, working, running a command it
 *  started (working, but waiting on a shell), done, resting. */
export const agentRank = (a: Pick<AgentInfo, "status" | "command">): number => (a.status === "working" ? (a.command ? 1.5 : 1) : RANK[a.status]);

/** A small dithered diamond in the status color; working breathes, blocked blinks. */
export function pip(t: Theme, status: Status | null | undefined, size = 6): Element {
  if (!status || status === "idle") return div().size(size).flex_none();

  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(t[status]);

  if (status === "working") return el.loop("opacity", { from: 0.3, to: 1, period: 1600 });

  if (status === "blocked") return el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });

  return el;
}

/** Uppercase eyebrow label. */
export function eyebrow(t: Theme, text: string): Element {
  return div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());
}

/** A stable small number from a string, for per-agent drift. */
export function hash(s: string): number {
  let h = 2166136261;

  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);

  return h >>> 0;
}

/** `el` tracking `handle` once there is one (a view makes it in init). */
export const tracked = <E extends Element>(el: E, handle: FocusHandle | null): E => (handle ? el.track_focus(handle) : el);

// ---- the keyboard cursor (nav.ts): one look across the chrome

/** On a row (a space, a firefly, a usage window): the popup's current-row
 *  look, a dithered band with a blue edge. `el` must be relative. */
export function navRow<E extends Element>(t: Theme, el: E, on: boolean): E {
  return on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
}

/** On a button or a chip: a square blue ring around it. `el` must be relative. */
export function navRing<E extends Element>(t: Theme, el: E, on: boolean): E {
  return on ? el.child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent)) : el;
}

// The open sky's firefly square: the dots of art/glow.svg span 8..34 of its
// 40 px; the ticks sit 2 px off them.
export const GLOW_SQUARE = { at: 8, size: 26 } as const;
export const TICK_OUT = 2;

/** The blue corner ticks: a 4 px corner in the accent at a thing's top left
 *  and one at its bottom right, `out` px outside its box (0: on its corners).
 *  What's shown wears them: the shown space (its row in the open sidebar, its
 *  initials on the rail) and the focused agent (its firefly's square in the
 *  open sky, its cell on the rail). */
export function cornerTicks(t: Theme, out = 3): Element[] {
  const tick = (pos: "top" | "bottom") => div().absolute().size(4).border_color(t.accent)
    .when(pos === "top", (el) => el.left(-out).top(-out).border_t(1).border_l(1))
    .when(pos === "bottom", (el) => el.right(-out).bottom(-out).border_b(1).border_r(1));

  return [tick("top"), tick("bottom")];
}
