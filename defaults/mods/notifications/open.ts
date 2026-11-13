// Opening the overview and the question dialog (a centered Nocturne dialog).
// The overview is a drop-down under the bell when the bell is pressed, as the
// script runner's deck hangs under ▶; from a key (cmd-shift-a, the palette,
// the strip's enter on the bell) or a toast it opens centered, as the deck
// does from cmd-shift-r.

import type { AsyncContext, Context, Modifiers, MouseButtonEvent, Size } from "gpui-kit";
import { openOverlay, closeOverlay, shared, setShared, settings } from "herdr";
import type { nextCommand as NextCommand } from "herdr";
import { isNumber, isString, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Item } from "./model.ts";
import type { Question } from "./request.ts";

/** What of ours is open: the overview (and when it last said so), the question dialog. */
const SHOWN = sharedKey("notifications.shown", object({}, { overview: isString, beat: isNumber, ask: isString }));

type Shown = { overview?: string; beat?: number; ask?: string };

// The overview at its biggest (layout px): 880 wide, 900 tall (810 drawn px
// at zoom 0.9: most of a laptop's window). Smaller in a small window: as tall
// as the room below the strip. With a request it takes all of that height;
// with nothing waiting, only its note's.
export const OVERVIEW_W = 880;
export const OVERVIEW_H = 900;

// The window margin a popup keeps (the app's popups snap to 8 px inside it).
const MARGIN = 8;

// A centered dialog fits its content up to this much of the window's height
// (src/window.rs: a dialog without `height`).
const DIALOG_MOST = 0.85;

// The overview renews its note in shared(SHOWN) this often (ms), so a note an
// app restart left behind doesn't swallow a press (overviewOpen).
export const BEAT = 1000;
const STALE = 4000;

function shown(): Shown {
  return { ...readShared(shared, SHOWN, {}) };
}

function remember(kind: "overview" | "ask", id: string | null) {
  const s = shown();

  if (id) s[kind] = id;
  else delete s[kind];

  writeShared(setShared, SHOWN, s);
}

const zoom = () => settings().zoom || 1;

/** The open overview's overlay id, or null. */
export function overviewOpen(): string | null {
  const s = readShared(shared, SHOWN, {});

  return s.overview && Date.now() - (s.beat ?? 0) < STALE ? s.overview : null;
}

/** The open overview says it's still there (every BEAT). */
export function overviewBeat(id: string | undefined) {
  const s = shown();

  if (id && s.overview === id) writeShared(setShared, SHOWN, { ...s, beat: Date.now() });
}

// The window's drawable size as the bell last drew, for the overview's size.
let win: Size | null = null;

/** The bell notes the window's size (window.viewport_size, drawn px) as it draws. */
export function noteWindow(size: Size | null | undefined) {
  if (size && size.width > 0 && size.height > 0) win = { width: size.width, height: size.height };
}

/** Where a press on the bell puts the drop-down's right edge and top (drawn
 *  px), as nocturne/kit.ts dropBelow: its top on the strip's horizon (the
 *  row is 36 px, the bell 24 centered in it), its right edge on the bell's. */
function fromPress(e: MouseButtonEvent | null): { readonly right: number; readonly top: number } | null {
  const b = e?.bounds, l = e?.local_position;

  if (!e || !b || !l) return null;

  const left = e.position.x - l.x, top = e.position.y - l.y;

  return { right: left + b.width, top: top + b.height + 6 * zoom() };
}

/** The overview's size (layout px) and, under the bell, where it hangs (drawn px); without
 *  `at` it opens centered. */
export type OverviewPlace =
  | { readonly width: number; readonly height: number; readonly centered: true }
  | { readonly width: number; readonly height: number; readonly at: { readonly x: number; readonly y: number } };

/** The overview's spec: its size (layout px) and, under the bell, where it
 *  hangs (drawn px). `press`: the bell's mouse-down; without one (a key, a
 *  toast) it's centered: no `at`, as tall as the dialog's most allows. */
export function overviewPlace(press: MouseButtonEvent | null = null): OverviewPlace {
  const z = zoom();
  const p = fromPress(press);
  const width = win ? Math.max(320, Math.min(OVERVIEW_W, Math.floor((win.width - 2 * MARGIN) / z))) : OVERVIEW_W;
  const room = !win ? OVERVIEW_H : p ? (win.height - p.top - MARGIN) / z : (win.height * DIALOG_MOST) / z;
  const height = Math.max(160, Math.min(OVERVIEW_H, Math.floor(room)));

  if (!p) return { width, height, centered: true };

  return { width, height, at: { x: Math.round(Math.max(MARGIN, p.right - width * z)), y: Math.round(p.top) } };
}

/** Opens the overview (on `terminal`'s request, if given), in place of one
 *  already open. A request for a terminal retargets an open overview.
 *  `press`: the bell's mouse-down, to hang right under it (a popup); without
 *  one it opens centered (a dialog that takes the keyboard, its height its
 *  content's, which sets its own: props.most). */
export function openOverview(terminal: string | null = null, press: MouseButtonEvent | null = null) {
  const s = shown();

  if (s.overview) closeOverlay(s.overview);

  if (s.ask) closeOverlay(s.ask);

  const place = overviewPlace(press);
  const props = { role: "overview", terminal, most: place.height };

  const id = "at" in place
    ? openOverlay({ mod: "notifications", kind: "popup", frame: "none", width: place.width, height: place.height, at: place.at, props })
    : openOverlay({ mod: "notifications", kind: "dialog", frame: "none", width: place.width, props });

  writeShared(setShared, SHOWN, { overview: id, beat: Date.now() });
}

/** toggleOverview's options: the bell's mouse-down, and whether the bell was lit when pressed. */
export interface ToggleOptions {
  readonly press?: MouseButtonEvent | null;
  readonly wasOpen?: boolean;
}

/** The bell's press (under it), cmd-shift-a or the strip's enter on the bell
 *  (centered): the overview opens, or closes when it's open, and stays
 *  closed. `wasOpen`: the bell was lit when pressed; the press closed the
 *  drop-down already (a popup closes on any press beside it, and the press
 *  goes on to the bell), or closes it now. */
export function toggleOverview({ press = null, wasOpen = false }: ToggleOptions = {}) {
  const open = overviewOpen();

  if (open) {
    remember("overview", null);
    closeOverlay(open);

    return;
  }

  if (wasOpen) return;

  openOverview(null, press);
}

/** The question dialog's height for a block: its tallest question, so nothing jumps. */
export function askHeight(questions: readonly Question[]): number {
  const most = Math.max(2, ...questions.map((q) => q.options.length + 1));
  const descs = Math.max(0, ...questions.map((q) => q.options.filter((o) => o.description).length));
  const longest = Math.max(0, ...questions.map((q) => q.question.length));

  return Math.min(720, 34 + 34 + 20 + (longest > 52 ? 46 : 28) + 14 + most * 28 + descs * 15 + 18 + 30 + 32);
}

/** Opens the question dialog for a terminal's block of questions. */
export function openAsk(item: Item) {
  const s = shown();

  if (s.overview) {
    closeOverlay(s.overview);
    remember("overview", null);
  }

  if (s.ask) closeOverlay(s.ask);

  const qs = item.request?.type === "question" ? item.request.questions : [];
  const id = openOverlay({ mod: "notifications", kind: "dialog", frame: "none", width: 520, height: askHeight(qs), props: { role: "ask", terminal: item.address } });

  remember("ask", id);
}

/** An overlay of ours closed (its close()), so the next open doesn't try to close it. */
export function forget(kind: "overview" | "ask", id: string | undefined) {
  if (id !== undefined && shown()[kind] === id) remember(kind, null);
}

/** The key a command stands for (shift: with shift). */
interface CommandKey {
  readonly key: string;
  readonly shift?: boolean;
}

/** notifications.<command> for the overview and the question dialog (keys.json, `herdr-app do`): the key it stands for. */
export const COMMAND_KEYS = {
  next: { key: "j" }, prev: { key: "k" }, up: { key: "up" }, down: { key: "down" },
  enter: { key: "enter" }, space: { key: "space" }, tab: { key: "tab" }, back: { key: "tab", shift: true },
  "yes-but": { key: "tab" }, "no-but": { key: "tab", shift: true },
  peek: { key: "p" }, goto: { key: "g" }, "put-away": { key: "x" }, close: { key: "escape" }, keys: { key: "?" },
} as const satisfies { readonly [command: string]: CommandKey };

/** Every command and its key: COMMAND_KEYS and 1-9. */
const COMMANDS: ReadonlyMap<string, CommandKey> = new Map<string, CommandKey>([
  ...Object.entries(COMMAND_KEYS),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): [string, CommandKey] => [String(n), { key: String(n) }]),
]);

/** A key as a key handler here reads it: its name, and the modifiers held. */
export interface KeyInput {
  readonly key: string;
  readonly key_char?: string | undefined;
  readonly modifiers: Pick<Modifiers, "shift" | "control" | "platform" | "alt">;
}

/** What a key handler here does with its context: stop the key, redraw, start a task. */
export type KeyContext = Pick<Context, "stop_propagation" | "notify" | "spawn">;

/** Feeds this copy's commands to its key handler, as if pressed; `focus`
 *  (overlay.focus, a window cycle key) to `onFocus`. */
export function followCommands(cx: AsyncContext, next: typeof NextCommand, handle: (e: KeyInput, cx: KeyContext) => void, onFocus?: () => void) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await next()).replace(/^notifications\./, "");

      if (c === "focus") {
        onFocus?.();

        continue;
      }

      const k = COMMANDS.get(c);

      if (!k) continue;

      const shim: KeyContext = { stop_propagation: () => undefined, notify: () => cx.notify(), spawn: (body, opts) => cx.spawn(body, opts) };

      handle({ key: k.key, modifiers: { shift: Boolean(k.shift), control: false, platform: false, alt: false } }, shim);
      cx.notify();
    }
  });
}
