// Opening the overview (a drop-down under the bell, as the script runner's
// deck hangs under ▶) and the question dialog (a centered Nocturne dialog).

import { openOverlay, closeOverlay, shared, setShared, settings } from "herdr";

const SHOWN = "nocturne-notifications.shown"; // { overview?: id, beat?: ms, ask?: id }
// The overview at its biggest (layout px): 880 wide, 900 tall (810 drawn px
// at zoom 0.9: most of a laptop's window). Smaller in a small window: as tall
// as the room below the strip. With a request it takes all of that height;
// with nothing waiting, only its note's.
export const OVERVIEW_W = 880;
export const OVERVIEW_H = 900;
// The tab strip's row (layout px): the drop-down's top sits on its horizon.
const ROW = 36;
// Far right: the popup snaps back inside the window, its right edge 8 px in.
export const FAR_RIGHT = 100000;
// The window margin a popup keeps (the app's popups snap to 8 px inside it).
const MARGIN = 8;
// The overview renews its note in shared(SHOWN) this often (ms), so a note an
// app restart left behind doesn't swallow a press (overviewOpen).
export const BEAT = 1000;
const STALE = 4000;

function shown() { return { ...(shared(SHOWN) ?? {}) }; }
function remember(kind, id) { const s = shown(); if (id) s[kind] = id; else delete s[kind]; setShared(SHOWN, s); }
const zoom = () => Number(settings()?.zoom) || 1;

/** The open overview's overlay id, or null. */
export function overviewOpen() {
  const s = shared(SHOWN);
  return s?.overview && Date.now() - (s.beat ?? 0) < STALE ? s.overview : null;
}

/** The open overview says it's still there (every BEAT). */
export function overviewBeat(id) {
  const s = shown();
  if (id && s.overview === id) setShared(SHOWN, { ...s, beat: Date.now() });
}

// For a drop-down opened without a press on the bell (a key, a toast): the
// window's drawable size as the bell last drew (for the size), and the
// strip's horizon from the bell's last press (else the row's height down).
// It goes far right, where the popup snaps 8 px inside the window's edge:
// the bell's right edge (bell.js END in), whatever size the window is now.
let win = null;
let horizon = null;

/** The bell notes the window's size (window.viewport_size, drawn px) as it draws. */
export function noteWindow(size) {
  if (size?.width > 0 && size?.height > 0) win = { width: size.width, height: size.height };
}

/** Where a press on the bell puts the drop-down's right edge and top (drawn
 *  px), as nocturne/kit.js dropBelow: its top on the strip's horizon (the
 *  row is 36 px, the bell 24 centered in it), its right edge on the bell's. */
function fromPress(e) {
  const b = e?.bounds, l = e?.local_position;
  if (!b || !l || !e.position) return null;
  const left = e.position.x - l.x, top = e.position.y - l.y;
  return { right: left + b.width, top: top + b.height + 6 * zoom() };
}

/** The overview's spec: its size (layout px) and where it hangs (drawn px). */
export function overviewPlace(press = null) {
  const z = zoom();
  const p = fromPress(press);
  if (p) horizon = p.top;
  const top = p?.top ?? horizon ?? ROW * z;
  const width = win ? Math.max(320, Math.min(OVERVIEW_W, Math.floor((win.width - 2 * MARGIN) / z))) : OVERVIEW_W;
  const height = win ? Math.max(160, Math.min(OVERVIEW_H, Math.floor((win.height - top - MARGIN) / z))) : OVERVIEW_H;
  const x = p ? Math.round(Math.max(MARGIN, p.right - width * z)) : FAR_RIGHT;
  return { width, height, at: { x, y: Math.round(top) } };
}

/** Opens the overview hanging under the bell (on `terminal`'s request, if
 *  given), in place of one already open. A request for a terminal retargets
 *  an open overview; `press`: the bell's mouse-down, to hang right under it. */
export function openOverview(terminal = null, press = null) {
  const s = shown();
  if (s.overview) closeOverlay(s.overview);
  if (s.ask) closeOverlay(s.ask);
  const { width, height, at } = overviewPlace(press);
  const id = openOverlay({ mod: "nocturne-notifications", kind: "popup", frame: "none", width, height, at, props: { role: "overview", terminal, most: height } });
  setShared(SHOWN, { overview: id, beat: Date.now() });
}

/** The bell's press, cmd-shift-a, the strip's enter on the bell: the overview
 *  opens, or closes when it's open, and stays closed. `wasOpen`: the bell was
 *  lit when pressed; the press closed the drop-down already (a popup closes
 *  on any press beside it, and the press goes on to the bell), or closes it now. */
export function toggleOverview({ press = null, wasOpen = false } = {}) {
  const open = overviewOpen();
  if (open) { remember("overview", null); closeOverlay(open); return; }
  if (wasOpen) return;
  openOverview(null, press);
}

/** The question dialog's height for a block: its tallest question, so nothing jumps. */
export function askHeight(questions) {
  const most = Math.max(2, ...questions.map((q) => q.options.length + 1));
  const descs = Math.max(0, ...questions.map((q) => q.options.filter((o) => o.description).length));
  const longest = Math.max(0, ...questions.map((q) => q.question.length));
  return Math.min(720, 34 + 34 + 20 + (longest > 52 ? 46 : 28) + 14 + most * 28 + descs * 15 + 18 + 30 + 32);
}

/** Opens the question dialog for a terminal's block of questions. */
export function openAsk(item) {
  const s = shown();
  if (s.overview) { closeOverlay(s.overview); remember("overview", null); }
  if (s.ask) closeOverlay(s.ask);
  const qs = item?.request?.questions ?? [];
  const id = openOverlay({ mod: "nocturne-notifications", kind: "dialog", frame: "none", width: 520, height: askHeight(qs), props: { role: "ask", terminal: item.address } });
  remember("ask", id);
}

/** An overlay of ours closed (its close()), so the next open doesn't try to close it. */
export function forget(kind, id) {
  if (shown()[kind] === id) remember(kind, null);
}

/** nocturne-notifications.<command> for the overview and the question dialog (keys.json, `herdr-app do`): the key it stands for. */
export const COMMAND_KEYS = {
  next: { key: "j" }, prev: { key: "k" }, up: { key: "up" }, down: { key: "down" },
  enter: { key: "enter" }, space: { key: "space" }, tab: { key: "tab" }, back: { key: "tab", shift: true },
  "yes-but": { key: "tab" }, "no-but": { key: "tab", shift: true },
  peek: { key: "p" }, goto: { key: "g" }, "put-away": { key: "x" }, close: { key: "escape" }, keys: { key: "?" },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), { key: String(n) }])),
};

/** Feeds this copy's commands to its key handler, as if pressed; `focus`
 *  (overlay.focus, a window cycle key) to `onFocus`. */
export function followCommands(cx, nextCommand, handle, onFocus) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await nextCommand()).replace(/^nocturne-notifications\./, "");
      if (c === "focus") { onFocus?.(); continue; }
      const k = COMMAND_KEYS[c];
      if (!k) continue;
      const shim = { stop_propagation() {}, notify: () => cx.notify(), spawn: (f) => cx.spawn(f) };
      handle({ key: k.key, modifiers: { shift: Boolean(k.shift), control: false, platform: false, alt: false } }, shim);
      cx.notify();
    }
  });
}
