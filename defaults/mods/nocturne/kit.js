// Shared pieces: art paths, the dither fill, status words and pips.
// Every color comes from theme() (the moonfly theme), never a literal.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow, terminals, hc, home, run, agents, focused, panes, shared, setShared, spaces } from "herdr";
import { isDock, toDock, newSlot } from "./dock.js";
import { AT_LABEL, isPinned, sortAgents, PANES_KEY, paneRecords, panePinned, pinPaneRecord, pinTabRecord, paneKey, isPaneKey, jarItems, reorder, retime } from "./pins.js";

export const ART = "mods/nocturne/art";
export const FONT = "Departure Mono";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares.
 *  The checkerboard counts device pixels; herdr exposes no scale factor, so
 *  macOS is taken as Retina (2x). */
export function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

// ---- the toolbar's ground (the same in ../nocturne/kit.js and
// ../notifications/kit.js: the tools, the bell and "+ new" are
// blocks of their own, and the ground runs under all of them to the strip's
// right edge, each block drawing its stretch)

/** The toolbar's look: "ledge" (the tools on a raised, lit ledge of the
 *  horizon) or "plate" (the tools on a dithered plate the strip's height). */
export const TOOL_LOOK = "plate";

/** The ground under a block of the toolbar (layers filling it, behind its
 *  controls), in place of the tabs' plain horizon. */
export function toolGround(t, look = TOOL_LOOK) {
  const layer = () => div().absolute().left(0).right(0);
  if (look === "plate") return [
    layer().top(0).bottom(0).opacity(0.55).child(dither(t.ansi0, 1)), // the plate
    layer().bottom(0).h(2).child(dither(t.ansi8, 1)), // its foot: the horizon, lit
  ];
  return [
    layer().bottom(0).h(4).child(dither(t.ansi8, 1)), // the ledge, dithered
    layer().bottom(4).h(1).bg(t.ansi8).opacity(0.8), // its lit edge
  ];
}

/** Two "#rrggbb" colors mixed, `k` of the way from `a` to `b`; `a` when either isn't one. */
export function mix(a, b, k) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = hex(a), y = hex(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** A tool's plate under the pointer: on the plate a step brighter than it
 *  (ansi0 lifted toward ansi8, the text still reads on it); on the ledge ansi0. */
export function toolHover(t, look = TOOL_LOOK) {
  return look === "plate" ? mix(t.ansi0, t.ansi8, 0.3) : t.ansi0;
}

/** Where a drop-down opened by a press on a tab-strip button goes: its top
 *  on the strip's horizon (the row is 36 px, the button 24 centered in it),
 *  its right edge on the button's, so it hangs under the button without
 *  covering it (a second press then lands on the button and closes it).
 *  `width`: the drop-down's, in layout px. Null when the press has no bounds. */
export function dropBelow(e, width) {
  const b = e?.bounds, l = e?.local_position;
  if (!b || !l || !e.position) return null;
  const zoom = Number(settings()?.zoom) || 1;
  const left = e.position.x - l.x, top = e.position.y - l.y;
  return { x: Math.round(Math.max(8, left + b.width - width * zoom)), y: Math.round(top + b.height + 6 * zoom) };
}

/** The label holding the name a person gave a pane's terminal (the pane menu's
 *  and a firefly's "Rename"). It lives on the terminal, so the name follows it
 *  to another pane or tab, and ends with it. */
export const NAME_LABEL = "nocturne.name";

/** The name a person gave this terminal (an address), or null. */
export function givenName(terminal) {
  return (terminal && terminals().find((x) => x.address === terminal)?.labels?.[NAME_LABEL]) || null;
}

/** Names a terminal; "" takes the name away, so it goes by its program's again. */
export function nameTerminal(terminal, name) {
  return hc(["label", terminal, `${NAME_LABEL}=${name.trim()}`]).catch(() => {});
}

/** A terminal's labels (an address), {} if it's gone. */
export const labelsOf = (terminal) => terminals().find((x) => x.address === terminal)?.labels ?? {};

/** Pinned to the jar at the top of the sky (pins.js: Fireflies' herdr.pinned label). */
export const pinned = (terminal) => isPinned(labelsOf(terminal));

/** Pins a terminal (an agent's, or a plain shell's) to the top of the sky, or
 *  unpins it: Fireflies' terminal.pin, and the time it joined the jar (its order there). */
export function pin(terminal, on = !pinned(terminal)) {
  if (!terminal) return;
  run("terminal.pin", { terminal, pinned: on });
  hc(["label", terminal, `${AT_LABEL}=${on ? Date.now() : ""}`]).catch(() => {});
}

/** The sidebar's agent order (pins.js sortAgents): { pinned, rest, all }. */
export const sortedAgents = () => sortAgents([...agents()], agentRank, labelsOf);

/** The mod panes' pins (pins.js PANES_KEY), as stored. */
export const paneRecordsNow = () => paneRecords(shared(PANES_KEY));

/** Everything in the jar, in its order (pins.js jarItems): agents, plain terminals, mod panes. */
export const jar = () => jarItems({ agents: [...agents()], terminals: terminals(), panes: panes(), records: paneRecordsNow() });

/** A pane's key in the jar: its terminal's address, or "pane:<id>" for a mod pane.
 *  `p`: { pane, terminal } (a PaneInfo, or a menu's target). */
export const pinKey = (p) => (p?.terminal ?? (p?.pane ? paneKey(p.pane) : null));

/** A pane (`p`: { pane, terminal }) is in the jar. */
export function panePinnedNow(p) {
  if (p?.terminal) return pinned(p.terminal);
  return Boolean(p?.pane) && panePinned(paneRecordsNow(), p.pane);
}

/** Pins any pane (`p`: { pane, terminal }) to the top of the sky, or unpins it:
 *  a terminal through its labels (pin), a mod pane in PANES_KEY. */
export function pinPane(p, on = !panePinnedNow(p)) {
  if (p?.terminal) return pin(p.terminal, on);
  const info = p?.pane && panes().find((x) => x.pane === p.pane);
  if (!info) return;
  setShared(PANES_KEY, pinPaneRecord(paneRecordsNow(), info, on, Date.now()));
}

/** Moves a pin (its jar key: a terminal's address or "pane:<id>") one step up
 *  (-1) or down (+1) in the jar, past pins of any kind. */
export function movePin(key, dir) {
  if (!key) return;
  const times = reorder(jar(), key, dir, Date.now());
  if (!times.length) return;
  for (const [k, at] of times) if (!isPaneKey(k)) hc(["label", k, `${AT_LABEL}=${at}`]).catch(() => {});
  if (times.some(([k]) => isPaneKey(k))) setShared(PANES_KEY, retime(paneRecordsNow(), times));
}

/** The focused pane's terminal (keys and the palette pin it). */
export const focusedTerminal = () => focused()?.terminal ?? null;

/** The focused pane as a pin target, { pane, terminal }: a mod pane has no
 *  terminal; a terminal shown in a layout block has no pane. Null: none. */
export function focusedPane() {
  const f = focused();
  if (!f) return null;
  if (f.pane) {
    const p = panes().find((x) => x.pane === f.pane);
    if (p) return { pane: p.pane, terminal: p.terminal ?? null };
  }
  return f.terminal ? { pane: null, terminal: f.terminal } : null;
}

/** nocturne.pin: pins the focused pane (any kind), or unpins it. */
export function pinFocused() {
  const p = focusedPane();
  if (p) pinPane(p);
}

/** nocturne.pin-up / pin-down: moves the focused pane's pin in the jar. */
export function moveFocused(dir) {
  movePin(pinKey(focusedPane()), dir);
}

// A web tab to show once its pane is on screen: { slot, tab, at } (goToPin).
// Commands reach only the copies on screen, and a pane in another tab or space
// comes there only after pane.focus: the web pane takes this up when it shows.
export const WEB_SHOW = "browser.show";

/** Goes to a pin of any kind (a jar item, pins.js jarItems): in whatever tab
 *  and space it is; a parked pane comes back (pane.focus). A web tab's pin
 *  (`it.tab`): its pane, then that tab (browser.show). */
export function goToPin(it) {
  if (it.kind === "pane" && it.tab) {
    const want = { slot: it.pane.props?.slot ?? null, tab: it.tab };
    setShared(WEB_SHOW, { ...want, at: Date.now() });
    run("pane.focus", { pane: it.pane.pane });
    return run(`browser.show:${JSON.stringify(want)}`);
  }
  if (it.kind === "pane" || (it.kind === "terminal" && it.pane)) return run("pane.focus", { pane: it.pane.pane });
  run("agent.focus", { terminal: it.key });
}

/** Takes a jar item out of the jar (a web tab's pin: that tab's alone). */
export function unpin(it) {
  if (it.kind === "pane" && it.tab) return setShared(PANES_KEY, pinTabRecord(paneRecordsNow(), it.pane, it.tab, false, Date.now()));
  if (it.kind === "pane") return pinPane({ pane: it.pane.pane, terminal: null }, false);
  pin(it.key, false);
}

/** Moves a pane into the dock (dock.js: a tab of its own in the space tied to
 *  no folder) and pins it to the shelf, so its tile goes to it from anywhere. */
export function dockPane(p) {
  const info = p?.pane && panes().find((x) => x.pane === p.pane);
  if (!info) return;
  if (toDock({ kind: "move", pane: info.pane }) && !panePinnedNow(info)) pinPane(info, true);
}

/** nocturne.dock: the focused pane into the dock (dockPane), if it's a local pane outside it. */
export function dockFocused() {
  const f = focusedPane();
  const p = f?.pane && panes().find((x) => x.pane === f.pane);
  if (p && !p.pane.includes("/") && !isDock(spaces().find((s) => s.tabs.some((c) => c.id === p.tab)))) dockPane(p);
}

/** A new web pane in the dock, pinned to the shelf: its pin is written by its
 *  props (a fresh slot), so it's found once the pane is there (pins.js findPane). */
export function dockWeb(url) {
  const slot = newSlot(), props = { slot, ...(url ? { url } : {}) };
  if (!toDock({ kind: "web", slot, ...(url ? { url } : {}) })) return;
  setShared(PANES_KEY, [...paneRecordsNow(), { pane: `new:${slot}`, mod: "browser", props, at: Date.now() }]);
}

/** Program keys with a dithered logo in art/logo-*.svg. */
export const LOGO = { claude: "claude", "claude-code": "claude", opencode: "opencode", pi: "pi", codex: "codex" };

/** Where a space is now: its first terminal's live folder, else where it was made. */
export function place(s, all) {
  const tabs = new Set(s.tabs.map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

/** A space's folder: the one it's attached to (space.new folder, space.folder),
 *  else where it is now (place). Its repo, GitHub and lazygit go by this. Home
 *  holds no repo: a space attached there goes by where it is now too. */
export function spaceFolder(s, all) {
  // The dock (dock.js) is tied to no folder: no repo there, wherever its shells are.
  if (!s || isDock(s)) return null;
  const mine = s.attached && s.folder && !(s.machine == null && s.folder.replace(/\/+$/, "") === home());
  return (mine && s.folder) || place(s, all);
}

export const WORD = { working: "working", blocked: "needs you", done: "done", idle: "resting" };

/** Status order: what needs the person first, then what's busy, then what's at rest. */
export const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };

/** At rest: done or resting. Both sidebars set these on the ground by the
 *  hills, below the awake ones (needs you, working, running a command). */
export const atRest = (a) => a.status === "idle" || a.status === "done";

/** An agent's place in every list: needs you, working, running a command it
 *  started (working, but waiting on a shell), done, resting. */
export const agentRank = (a) => (a.status === "working" ? (a.command ? 1.5 : 1) : RANK[a.status] ?? 3);

/** A small dithered diamond in the status color; working breathes, blocked blinks. */
export function pip(t, status, size = 6) {
  if (!status || status === "idle") return div().size(size).flex_none();
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(t[status]);
  if (status === "working") return el.loop("opacity", { from: 0.3, to: 1, period: 1600 });
  if (status === "blocked") return el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });
  return el;
}

/** Uppercase eyebrow label. */
export function eyebrow(t, text) {
  return div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());
}

/** A stable small number from a string, for per-agent drift. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---- the keyboard cursor (nav.js): one look across the chrome

/** On a row (a space, a firefly, a usage window): the popup's current-row
 *  look, a dithered band with a blue edge. `el` must be relative. */
export function navRow(t, el, on) {
  return on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
}

/** On a button or a chip: a square blue ring around it. `el` must be relative. */
export function navRing(t, el, on) {
  return on ? el.child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent)) : el;
}

// The open sky's firefly square: the dots of art/glow.svg span 8..34 of its
// 40 px; the ticks sit 2 px off them.
export const GLOW_SQUARE = { at: 8, size: 26 };
export const TICK_OUT = 2;

/** The blue corner ticks: a 4 px corner in the accent at a thing's top left
 *  and one at its bottom right, `out` px outside its box (0: on its corners).
 *  What's shown wears them: the shown space (its row in the open sidebar, its
 *  initials on the rail) and the focused agent (its firefly's square in the
 *  open sky, its cell on the rail). */
export function cornerTicks(t, out = 3) {
  const tick = (pos) => div().absolute().size(4).border_color(t.accent)
    .when(pos === "top", (el) => el.left(-out).top(-out).border_t(1).border_l(1))
    .when(pos === "bottom", (el) => el.right(-out).bottom(-out).border_b(1).border_r(1));
  return [tick("top"), tick("bottom")];
}
