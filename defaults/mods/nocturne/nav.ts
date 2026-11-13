// Keyboard navigation of Nocturne's chrome: the sidebar (sky.js) and the tab
// strip (tabs.js, which also walks the focused pane's header, the parked chips
// the bell and "+ new"). Both are layout blocks the keyboard reaches with pane.go
// (cmd-alt-arrows) or layout.focus (nocturne.sidebar / nocturne.tabstrip /
// nocturne.header); focused().block then names the block that has it.
//
// Pure: no herdr at run time. A key becomes a verb (keyVerb); the view moves its cursor
// (move, moveSection, moveRow) and acts on the verb itself.

import type { Context, KeyEvent } from "gpui-kit";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, sharedKey } from "./guard.ts";
import type { Guarded } from "./guard.ts";

/** shared() key: where the tab strip's cursor is when it's outside the strip,
 *  so that copy draws the ring: { region: "head" | "parked" | "bell" | "new", pane?, item }. */
export const CURSOR = "nocturne.chrome";

/** The strip's cursor outside it (CURSOR): which row ("head", "parked"), the bell or "+ new", on which pane, on which control. */
export const CURSOR_KEY = sharedKey(CURSOR, nullable(object({ region: literal("head", "parked", "bell", "new") }, { pane: nullable(isString), item: nullable(isString) })));

export type ChromeCursor = NonNullable<Guarded<typeof CURSOR_KEY.guard>>;

/** A block of the layout tree (layout()), as far as Nocturne reads it. */
export interface LayoutNode {
  readonly id?: string;
  readonly hidden?: boolean;
  readonly content?: { readonly mod?: string; readonly props?: { readonly role?: string } };
  readonly size?: { readonly px?: number };
  readonly children?: readonly LayoutNode[];
}

/** layout()'s tree: every node with the fields above right where they're there. */
export function isLayoutNode(value: unknown): value is LayoutNode {
  return object({}, { id: isString, hidden: isBoolean, content: object({}, { mod: isString, props: object({}, { role: isString }) }), size: object({}, { px: isNumber }), children: arrayOf(isLayoutNode) })(value);
}

/** The layout block showing nocturne with `role` (sky, tabs), from layout(). */
export function blockOf(node: LayoutNode | null | undefined, role: string): string | null {
  if (!node) return null;

  if (node.content?.mod === "nocturne" && node.content.props?.role === role) return node.id ?? null;

  for (const c of node.children ?? []) {
    const f = blockOf(c, role);

    if (f) return f;
  }

  return null;
}

/** A shown layout block in `node` (layout()) shows `mod`. */
export function hasMod(node: LayoutNode | null | undefined, mod: string): boolean {
  if (!node || node.hidden) return false;

  if (node.content?.mod === mod) return true;

  return (node.children ?? []).some((c) => hasMod(c, mod));
}

/** What a key does in the chrome. */
export type Verb =
  | "down" | "up" | "left" | "right" | "first" | "last" | "next" | "prev" | "go" | "menu" | "rename" | "back" | "help"
  | "new" | "folder" | "delete" | "tab" | "worktree" | "pin" | "pin-down" | "pin-up" | "close" | "move-left" | "move-right";

/** A digit key: select that tab. */
export type DigitVerb = "n1" | "n2" | "n3" | "n4" | "n5" | "n6" | "n7" | "n8" | "n9";

/** A keymap: key (as keyVerb spells it) -> verb. Keys are what people press: data. */
export type Keymap = ReadonlyMap<string, Verb>;

// Keys shared by both: moving, acting, leaving.
const COMMON: readonly (readonly [string, Verb])[] = [
  ["down", "down"], ["j", "down"], ["up", "up"], ["k", "up"],
  ["left", "left"], ["h", "left"], ["right", "right"], ["l", "right"],
  ["home", "first"], ["g", "first"], ["end", "last"], ["G", "last"],
  ["tab", "next"], ["shift-tab", "prev"],
  ["enter", "go"], ["space", "go"],
  ["m", "menu"], ["shift-f10", "menu"], [".", "menu"],
  ["r", "rename"], ["f2", "rename"],
  ["escape", "back"], ["q", "back"],
  ["?", "help"],
];

/** The sidebar's own verbs on top of COMMON (h / ← lead nowhere there: the sidebar is the leftmost block). */
export const SIDEBAR_KEYS: Keymap = new Map([
  ...COMMON.filter(([k]) => k !== "left" && k !== "h"),
  ["n", "new"], ["f", "folder"], ["d", "delete"], ["t", "tab"], ["w", "worktree"], ["p", "pin"], ["J", "pin-down"], ["K", "pin-up"],
]);

/** The tab strip's own verbs on top of COMMON. */
export const STRIP_KEYS: Keymap = new Map([...COMMON, ["x", "close"], ["n", "new"], ["H", "move-left"], ["L", "move-right"]]);

/** What a control does for each verb the keyboard gives it (the sidebar's nav). */
export interface NavActs {
  readonly go?: (cx: Context) => void;
  readonly menu?: (cx: Context) => void;
  readonly rename?: (cx: Context) => void;
  readonly folder?: (cx: Context) => void;
  readonly delete?: (cx: Context) => void;
  readonly tab?: (cx: Context) => void;
  readonly worktree?: (cx: Context) => void;
  readonly new?: (cx: Context) => void;
  readonly pin?: (cx: Context) => void;
  readonly "pin-up"?: (cx: Context) => void;
  readonly "pin-down"?: (cx: Context) => void;
}

/** Registers a control (`id`, in section `sec`) with the keyboard's cursor as it's drawn,
 *  and what it does; true while the cursor is on it (sky.js nav). */
export type Nav = (id: string, sec: string, acts?: NavActs) => boolean;

/** A ? list's line: [keys, what]. */
export type HelpLine = readonly [string, string];

/** A ? list's line, as handed on in a dialog's props. */
export const isHelpLine = (value: unknown): value is HelpLine => Array.isArray(value) && value.length === 2 && isString(value[0]) && isString(value[1]);

// The ? lists: [keys, what] per line, every key its keymap takes, ? keys last.
// The keys dialog (screens.js, keymap.js) shows them too.
export const SIDEBAR_HELP: readonly HelpLine[] = [
  ["j k  ↑ ↓", "move"], ["tab  ⇧tab", "next / previous section"], ["g G  home end", "first / last"],
  ["⏎  space", "open: show the space, focus the agent, press the button"],
  ["m  .", "the row's menu"], ["r", "rename"], ["n", "new space"], ["t", "new tab in the space"],
  ["f", "change the space's folder"], ["w", "new worktree"], ["d", "delete the space (asks)"],
  ["p", "pin / unpin the agent or pane"], ["J K", "move it in the jar / on the shelf"],
  ["l  →", "to the panes"], ["esc  q", "back to the pane"], ["?", "keys"],
];

export const STRIP_HELP: readonly HelpLine[] = [
  ["h l  ← →", "move along the row (h past the first tab: the sidebar)"], ["j k  ↓ ↑", "tabs · the pane's header · parked panes · the pane"],
  ["tab  ⇧tab", "every control in turn"], ["g G  home end", "first / last"],
  ["⏎  space", "select the tab, press the button"], ["1 … 9", "select that tab"],
  ["m  .", "the tab's menu (on a button: its menu)"], ["r", "rename the tab"],
  ["x", "close the tab"], ["n", "new tab"], ["H L", "move the tab left / right"],
  ["esc  q", "back to the pane"], ["?", "keys"],
];

/** The focused pane's header: the strip's second row (nocturne.header goes straight there). */
export const HEADER_HELP: readonly HelpLine[] = [
  ["h l  ← →", "walk its controls: name, text size, float, splits, even out, gridify, park, zoom, ⋯, close"],
  ["⏎  space", "press the control"], ["tab  ⇧tab", "every control in turn"], ["g G  home end", "first / last"],
  ["m  .", "the pane's menu"], ["r", "rename the pane"], ["x", "close the pane"],
  ["k  ↑", "up to the tabs"], ["j  ↓", "down to the parked panes, then the pane"],
  ["1 … 9", "select that tab"], ["n", "new tab"], ["esc  q", "back to the pane"], ["?", "keys"],
];

/** The shown tab's parked chips: the strip's third row. */
export const PARKED_HELP: readonly HelpLine[] = [
  ["h l  ← →", "walk the chips"], ["⏎  space", "put the pane back"], ["tab  ⇧tab", "every control in turn"],
  ["g G  home end", "first / last"], ["m  .", "the pane's menu"], ["x", "close the pane"],
  ["k  ↑", "up to the pane's header"], ["j  ↓", "back to the pane"],
  ["1 … 9", "select that tab"], ["n", "new tab"], ["esc  q", "back to the pane"], ["?", "keys"],
];

/** Every popup menu (popup.js): right-click menus, the git menu, these key lists. */
export const MENU_HELP: readonly HelpLine[] = [
  ["j k  ↑ ↓", "move"], ["ctrl-n ctrl-p", "move"], ["tab  ⇧tab", "move"], ["home end", "first / last"],
  ["⏎  space", "pick the row"], ["a row's letter", "pick that row"], ["esc  q", "close"],
];

/** A digit's verb. */
const DIGITS: ReadonlyMap<string, DigitVerb> = new Map([["1", "n1"], ["2", "n2"], ["3", "n3"], ["4", "n4"], ["5", "n5"], ["6", "n6"], ["7", "n7"], ["8", "n8"], ["9", "n9"]]);

/** What a key event means in `keymap`, or null (not ours: let it go). Keys with
 *  cmd, ctrl or alt are never ours (they're the app's and the window's). */
export function keyVerb(e: Pick<KeyEvent, "key" | "key_char" | "modifiers">, keymap: Keymap): Verb | DigitVerb | null {
  const m = e.modifiers;

  if (m.control || m.platform || m.alt) return null;

  const typed = e.key_char && e.key_char.length === 1 && e.key_char !== " " ? e.key_char : null;
  const key = e.key;
  // Named keys first (shift-tab, shift-f10), then what the key types (?, J, .).
  const named = m.shift ? `shift-${key}` : key;
  const byName = keymap.get(named);

  if (byName && (named.length > 1 || !typed)) return byName;

  const byChar = typed ? keymap.get(typed) : undefined;

  if (byChar) return byChar;

  const plain = m.shift ? undefined : keymap.get(key);

  if (plain) return plain;

  return (typed && DIGITS.get(typed)) || null;
}

/** An item the cursor walks: its id. */
interface Item {
  readonly id: string;
}

/** The id `d` steps from `cursor` in `items` ([{ id }]), held at the ends. Unknown cursor: the first. */
export function move(items: readonly Item[], cursor: string | null, d: number): string | null {
  const i = items.findIndex((x) => x.id === cursor);

  return items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + d))]?.id ?? null;
}

/** Tab / shift-tab: the first item of the next / previous section (`sec`), wrapping. */
export function moveSection(items: readonly (Item & { readonly sec: string })[], cursor: string | null, d: number): string | null {
  if (!items.length) return null;

  const secs = [...new Set(items.map((x) => x.sec))];
  const at = items.find((x) => x.id === cursor)?.sec;
  const i = at === undefined ? -1 : secs.indexOf(at);
  const next = secs[i < 0 ? 0 : (i + d + secs.length) % secs.length];

  return items.find((x) => x.sec === next)?.id ?? null;
}

/** The cursor kept on a live item: the same id, else the nearest by index, else the first. */
export function keep(items: readonly Item[], cursor: string | null, lastIndex = 0): string | null {
  if (items.some((x) => x.id === cursor)) return cursor;

  return items[Math.max(0, Math.min(items.length - 1, lastIndex))]?.id ?? null;
}
