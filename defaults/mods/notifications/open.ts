// Opening the overview and the question dialog (a centered Nocturne dialog).
// The overview is a drop-down under the bell when the bell is pressed, as the
// script runner's deck hangs under ▶; from a key (cmd-shift-a, the palette,
// the strip's enter on the bell) or a toast it opens centered, as the deck
// does from cmd-shift-r.

import type { Context, Modifiers, MouseButtonEvent, Size } from "gpui-kit";
import { openOverlay, closeOverlay, shared, setShared, settings } from "herdr";
import { Array as Arr, Effect, Option, Record as Rec, Schema, String as Str } from "effect";
import { Commands, readShared, sharedKey, writeShared } from "@fireflies/kit";
import { nowMs } from "./fx.ts";
import type { Item } from "./model.ts";
import type { Question } from "./request.ts";

/** What of ours is open: the overview (and when it last said so), the question dialog. */
const ShownSchema = Schema.Struct({ overview: Schema.optionalKey(Schema.String), beat: Schema.optionalKey(Schema.Finite), ask: Schema.optionalKey(Schema.String) });

type Shown = typeof ShownSchema.Type;

const SHOWN = sharedKey("notifications.shown", ShownSchema);

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

const shown = (): Shown => readShared(shared, SHOWN, {});

const withoutOverview = ({ ask }: Shown): Shown => (ask === undefined ? {} : { ask });

function withoutAsk({ overview, beat }: Shown): Shown {
  if (overview === undefined) return {};

  return beat === undefined ? { overview } : { overview, beat };
}

function remember(kind: "overview" | "ask", id: string | null): void {
  const s = shown();
  const rest: Shown = kind === "overview" ? withoutOverview(s) : withoutAsk(s);

  writeShared(setShared, SHOWN, id === null ? rest : { ...rest, [kind]: id });
}

/** The zoom (1 where the setting isn't a positive number). */
export const zoom = (): number => {
  const z = settings().zoom;

  return z > 0 ? z : 1;
};

/** The open overview's overlay id, or null. */
export function overviewOpen(): string | null {
  const s = shown();
  const id = s.overview ?? "";

  return Str.isNonEmpty(id) && nowMs() - (s.beat ?? 0) < STALE ? id : null;
}

/** An overview opened without openOverview (mod.open, whose mod.json gives
 *  it the role) notes itself as the open one, so the bell lights and a key
 *  closes it. */
export function noteOverview(id: string | undefined): void {
  if (id !== undefined && shown().overview !== id) writeShared(setShared, SHOWN, { ...withoutOverview(shown()), overview: id, beat: nowMs() });
}

/** The open overview says it's still there (every BEAT). */
export function overviewBeat(id: string | undefined): void {
  const s = shown();

  if (id !== undefined && s.overview === id) writeShared(setShared, SHOWN, { ...s, beat: nowMs() });
}

// The window's drawable size as the bell last drew, for the overview's size.
let win: Size | null = null;

/** The bell notes the window's size (window.viewport_size, drawn px) as it draws. */
export function noteWindow(size: Size | null | undefined): void {
  if (size !== null && size !== undefined && size.width > 0 && size.height > 0) win = { width: size.width, height: size.height };
}

/** Where a press on the bell puts the drop-down's right edge and top (drawn
 *  px), as nocturne/kit.ts dropBelow: its top on the strip's horizon (the
 *  row is 36 px, the bell 24 centered in it), its right edge on the bell's. */
function fromPress(e: MouseButtonEvent | null): { readonly right: number; readonly top: number } | null {
  const b = e?.bounds, l = e?.local_position;

  if (e === null || b === undefined || l === undefined) return null;

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
  const width = win === null ? OVERVIEW_W : Math.max(320, Math.min(OVERVIEW_W, Math.floor((win.width - 2 * MARGIN) / z)));
  const room = win === null ? OVERVIEW_H : p === null ? (win.height * DIALOG_MOST) / z : (win.height - p.top - MARGIN) / z;
  const height = Math.max(160, Math.min(OVERVIEW_H, Math.floor(room)));

  if (p === null) return { width, height, centered: true };

  return { width, height, at: { x: Math.round(Math.max(MARGIN, p.right - width * z)), y: Math.round(p.top) } };
}

/** Opens the overview (on `terminal`'s request, if given), in place of one
 *  already open. A request for a terminal retargets an open overview.
 *  `press`: the bell's mouse-down, to hang right under it (a popup); without
 *  one it opens centered (a dialog that takes the keyboard, its height its
 *  content's, which sets its own: props.most). */
export function openOverview(terminal: string | null = null, press: MouseButtonEvent | null = null): void {
  closeShown(shown());

  const place = overviewPlace(press);
  const props = { role: "overview", terminal, most: place.height };

  const id = "at" in place
    ? openOverlay({ mod: "notifications", kind: "popup", frame: "none", width: place.width, height: place.height, at: place.at, props })
    : openOverlay({ mod: "notifications", kind: "dialog", frame: "none", width: place.width, props });

  writeShared(setShared, SHOWN, { overview: id, beat: nowMs() });
}

/** Closes what of ours is open (the overview, the question dialog). */
function closeShown(s: Shown): void {
  if (s.overview !== undefined) closeOverlay(s.overview);

  if (s.ask !== undefined) closeOverlay(s.ask);
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
export function toggleOverview({ press = null, wasOpen = false }: ToggleOptions = {}): void {
  const open = overviewOpen();

  if (open !== null) {
    remember("overview", null);
    closeOverlay(open);

    return;
  }

  if (wasOpen) return;

  openOverview(null, press);
}

/** The question dialog's height for a block: its tallest question, so nothing jumps. */
export function askHeight(questions: readonly Question[]): number {
  const most = Math.max(2, ...Arr.map(questions, (q) => q.options.length + 1));
  const descs = Math.max(0, ...Arr.map(questions, (q) => Arr.filter(q.options, (o) => Str.isNonEmpty(o.description)).length));
  const longest = Math.max(0, ...Arr.map(questions, (q) => q.question.length));

  return Math.min(720, 34 + 34 + 20 + (longest > 52 ? 46 : 28) + 14 + most * 28 + descs * 15 + 18 + 30 + 32);
}

/** Opens the question dialog for a terminal's block of questions. */
export function openAsk(item: Item): void {
  const s = shown();

  closeShown(s);

  if (s.overview !== undefined) remember("overview", null);

  const qs = item.request?.type === "question" ? item.request.questions : [];
  const id = openOverlay({ mod: "notifications", kind: "dialog", frame: "none", width: 520, height: askHeight(qs), props: { role: "ask", terminal: item.address } });

  remember("ask", id);
}

/** An overlay of ours closed (its close()), so the next open doesn't try to close it. */
export function forget(kind: "overview" | "ask", id: string | undefined): void {
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
  peek: { key: "p" }, goto: { key: "g" }, "put-away": { key: "x" }, menu: { key: "m" }, close: { key: "escape" }, keys: { key: "?" },
} as const satisfies { readonly [command: string]: CommandKey };

/** Every command and its key: COMMAND_KEYS and 1-9. */
const COMMANDS: ReadonlyMap<string, CommandKey> = new Map<string, CommandKey>([
  ...Rec.toEntries<string, CommandKey>(COMMAND_KEYS),
  ...Arr.map(Arr.range(1, 9), (n): [string, CommandKey] => [String(n), { key: String(n) }]),
]);

/** A key as a key handler here reads it: its name, and the modifiers held. */
export interface KeyInput {
  readonly key: string;
  readonly key_char?: string | undefined;
  readonly modifiers: Pick<Modifiers, "shift" | "control" | "platform" | "alt">;
}

/** What a key handler here does with its context: stop the key, redraw. */
export type KeyContext = Pick<Context, "stop_propagation" | "notify">;

/** The command as the key it stands for, none for one that isn't a key here. */
const commandKey = (c: string): Option.Option<KeyInput> =>
  Option.map(Option.fromUndefinedOr(COMMANDS.get(c)), (k) => ({ key: k.key, modifiers: { shift: k.shift === true, control: false, platform: false, alt: false } }));

/** Feeds this copy's commands to its key handler, as if pressed; `focus`
 *  (overlay.focus, a window cycle key) to `onFocus`. Run it with the copy's
 *  fx: it ends with the copy. `redraw` is the copy's. */
export const followCommands = (handle: (e: KeyInput, cx: KeyContext) => void, onFocus: () => void, redraw: () => void) => {
  const shim: KeyContext = { stop_propagation: () => undefined, notify: redraw };

  return Effect.forever(Effect.flatMap(Commands.use((x) => x.next), (raw) => Effect.sync(() => {
    const c = Str.replace(/^notifications\./, "")(raw);

    if (c === "focus") onFocus();
    else Option.map(commandKey(c), (k) => handle(k, shim));

    redraw();
  })));
};
