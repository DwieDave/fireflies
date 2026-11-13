// The web pane's tabs, as data: every function takes the list and gives a new
// one, so main.ts keeps no rules of its own about where a tab goes or which
// one shows. main.ts draws them and keeps one web view per tab.
//
//   tabs    { list: [tab], active: id, next: n }   n: the next tab's number
//   tab     { id, start, page, error, failed, video, zoom, live, opener, of }
//           id      the native view's id: "web" for the first, then "web-2", …
//           start   the address the view is created on (null: a blank tab,
//                   its address field open); later pages are navigations
//           page    { href, title, loading, progress, canGoBack, canGoForward }
//           failed  { url }: its last load failed (error says how); r retries url
//           live    its view exists: a restored tab gets one when first shown
//           opener  the tab whose link opened it (it goes after its siblings)

import type { PaneInfo } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNull, isNumber, isString, nullable, object, oneOf, parseJson, sharedKey, sharedListKey } from "./guard.ts";

// ---- JSON: what a mod pane's props are, and the shelf's records carry

/** A JSON value (a mod pane's props: its mod wrote them, keys and all). Carried as it is
 *  (a pin keeps its pane's props to find the pane again), never read by key here. */
export type Json = string | number | boolean | null | readonly Json[] | JsonObject;

/** A JSON object: its keys are data (see Json). */
export interface JsonObject {
  readonly [key: string]: Json;
}

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A plain object (not an array, not null) whose every value is JSON. */
const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !isList(value) && Object.keys(value).every((key) => isJson(Object.getOwnPropertyDescriptor(value, key)?.value));

/** A JSON value, at every depth. */
export const isJson = (value: unknown): value is Json =>
  value === null || isString(value) || isNumber(value) || isBoolean(value) || (isList(value) && value.every((item) => isJson(item))) || isJsonObject(value);

// ---- the tabs

/** What a tab's page is at: its address, title, and the bar's state. */
export interface Page {
  readonly href: string | null;
  readonly title: string | null;
  readonly loading: boolean;
  readonly progress: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** A tab (see the top). */
export interface Tab {
  readonly id: string;
  start: string | null;
  page: Page;
  error: string | null;
  failed: { readonly url: string | null } | null;
  video: boolean;
  zoom: number;
  live: boolean;
  opener: string | null;
  of: string | null;
}

/** A pane's tabs: the list in strip order, the shown one, the next tab's number. */
export interface Tabs {
  readonly list: readonly Tab[];
  readonly active: string;
  readonly next: number;
}

/** The native view id of tab number n. */
export const tabId = (n: number): string => (n <= 1 ? "web" : `web-${n}`);

/** makeTab's options. */
export interface TabOptions {
  readonly title?: string | null;
  readonly live?: boolean;
  readonly opener?: string | null;
}

/** A tab on `url` (null: blank). */
export function makeTab(id: string, url: string | null | undefined, zoom: number, { title = null, live = true, opener = null }: TabOptions = {}): Tab {
  return { id, start: url ?? null, page: { href: url ?? null, title, loading: false, progress: 0, canGoBack: false, canGoForward: false },
    error: null, failed: null, video: false, zoom, live, opener, of: null };
}

/** One tab on `url`. */
export function single(url: string | null | undefined, zoom: number): Tabs {
  return { list: [makeTab(tabId(1), url, zoom)], active: tabId(1), next: 2 };
}

/** The shown tab (else the first; undefined only for an empty list, which close() never leaves). */
export const activeTab = (m: Tabs): Tab | undefined => m.list.find((t) => t.id === m.active) ?? m.list[0];

export const indexOf = (m: Tabs, id: string | null): number => m.list.findIndex((t) => t.id === id);

/** open's options: behind the shown tab, the tab whose link opened it, its zoom. */
export interface OpenOptions {
  readonly background?: boolean;
  readonly opener?: string | null;
  readonly zoom?: number;
}

/** A new tab on `url` (null: blank). From a link (`opener`): after the shown
 *  tab and the tabs it opened already, as a browser does; else at the end.
 *  `background`: the shown tab stays. Returns `[tabs, tab]`. */
export function open(m: Tabs, url: string | null, { background = false, opener = null, zoom }: OpenOptions = {}): [Tabs, Tab] {
  const from = activeTab(m);
  const tab = makeTab(tabId(m.next), url, zoom ?? from?.zoom ?? 0.9, { opener });
  let at = m.list.length;

  if (opener) {
    at = indexOf(m, opener) + 1;

    while (at < m.list.length && m.list[at]?.opener === opener) at++;
  }

  const list = [...m.list.slice(0, at), tab, ...m.list.slice(at)];

  return [{ list, active: background ? m.active : tab.id, next: m.next + 1 }, tab];
}

/** Closes tab `id`. The shown one: its right neighbor shows, else its left.
 *  The last tab: a blank one takes its place (the pane stays). Returns
 *  `[tabs, closed]`; closed is null when there was no such tab. */
export function close(m: Tabs, id: string): [Tabs, Tab | null] {
  const i = indexOf(m, id);
  const closed = m.list[i];

  if (!closed) return [m, null];

  const list = m.list.filter((t) => t.id !== id)
    // Its opened tabs now hang off nothing (they stay where they are).
    .map((t) => (t.opener === id ? { ...t, opener: null } : t));

  const after = list[i] ?? list[i - 1];

  if (!after) {
    const fresh = makeTab(tabId(m.next), null, closed.zoom);

    return [{ list: [fresh], active: fresh.id, next: m.next + 1 }, closed];
  }

  const active = m.active !== id ? m.active : after.id;

  return [{ ...m, list, active }, closed];
}

/** Shows tab `id`; it gets its view now, if it had none. */
export function show(m: Tabs, id: string): Tabs {
  if (indexOf(m, id) < 0) return m;

  // Shown another tab, the tab shown before starts a fresh row of links
  // (a link opened from it later goes right after it again).
  const was = id === m.active ? null : m.active;

  return { ...m, active: id, list: m.list.map((t) => ({ ...t, live: t.live || t.id === id, opener: t.opener && t.opener === was ? null : t.opener })) };
}

/** The tab `by` steps from the shown one (wrapping); null for no tabs. */
export function step(m: Tabs, by: number): string | null {
  const n = m.list.length;
  const i = Math.max(0, indexOf(m, m.active));

  return m.list[(((i + by) % n) + n) % n]?.id ?? null;
}

/** The tab a number key names: 1–8 the nth, 9 the last (as a browser). Null: none. */
export function nth(m: Tabs, n: number): string | null {
  if (!(n >= 1 && n <= 9)) return null;

  return (n === 9 ? m.list.at(-1) : m.list[n - 1])?.id ?? null;
}

/** Tab `id` moved to place `index` (0-based: where it ends up, clamped). It
 *  was put there by hand, so it leaves its row of links (opener). */
export function move(m: Tabs, id: string, index: number): Tabs {
  const tab = m.list[indexOf(m, id)];

  if (!tab) return m;

  const to = Math.max(0, Math.min(m.list.length - 1, index || 0));

  if (to === indexOf(m, id)) return m;

  const rest = m.list.filter((t) => t.id !== id);

  return { ...m, list: [...rest.slice(0, to), { ...tab, opener: null }, ...rest.slice(to)] };
}

// ---- dragging a tab along the strip (as the app's own strip, nocturne/tabdrag.ts)

/** How far (window px) a press moves before it's a drag rather than a click. */
export const DRAG_START = 4;

/** A gap in the strip: before tab `id` or after it; `id` null: the strip's end. */
export interface Gap {
  readonly id: string | null;
  readonly after: boolean;
}

/** The gap the pointer is over: before tab `id`, or after it (its right
 *  half); `id` null: the strip's end. `x`, `width`: the pointer's place in the tab. */
export const gapAt = (id: string | null, x: number, width: number): Gap => ({ id, after: id !== null && x >= width / 2 });

/** Where `dragged` ends up (move's index) dropped into `gap`, or null when the
 *  drop leaves it where it is (over itself, or its own gaps). A gap after a
 *  tab and the gap before the next one are the same place. */
export function dropIndex(m: Tabs, dragged: string, gap: Gap | null): number | null {
  const i = indexOf(m, dragged);

  if (!gap || i < 0) return null;

  const rest = m.list.map((t) => t.id).filter((x) => x !== dragged);
  let at;

  if (gap.id === null) at = rest.length;
  else {
    const j = rest.indexOf(gap.id);

    if (j < 0) return null;

    at = j + (gap.after ? 1 : 0);
  }

  return at === i ? null : at;
}

/** The tab the drop marker stands before for a drop at `index` (dropIndex's):
 *  its left edge; null: the strip's end. Undefined: no marker. */
export function stakeBefore(m: Tabs, dragged: string, index: number | null): string | null | undefined {
  if (index === null) return undefined;

  const rest = m.list.map((t) => t.id).filter((x) => x !== dragged);

  return rest[index] ?? null;
}

/** What survives a restart: each tab's address, title and zoom. */
export function save(m: Tabs): string {
  return JSON.stringify({ active: m.active, next: m.next,
    tabs: m.list.map((t) => ({ id: t.id, href: t.page.href ?? t.start ?? null, title: t.page.title ?? null, zoom: t.zoom })) });
}

/** The saved tabs as save() wrote them (a tab in another shape is left out). */
const isSaved = object({}, { active: isString, next: isNumber, tabs: isList });

const isSavedTab = object({ id: isString }, { href: nullable(isString), title: nullable(isString), zoom: nullable(isNumber) });

/** The saved tabs, or null. Only the shown tab gets its view at once; the
 *  others load when first shown. */
export function restore(text: string, zoom: number): Tabs | null {
  const s = parseJson(text, isSaved);
  const saved = s?.tabs?.filter((t) => isSavedTab(t)) ?? [];
  const first = saved[0];

  if (!s || !first) return null;

  const active = saved.some((t) => t.id === s.active) ? s.active ?? first.id : first.id;
  const list = saved.map((t) => makeTab(t.id, t.href ?? null, t.zoom || zoom, { title: t.title ?? null, live: t.id === active }));
  const top = Math.max(1, ...saved.map((t) => Number(/^web-(\d+)$/.exec(t.id)?.[1] ?? 1)));

  return { list, active, next: Math.max(s.next || 0, top + 1) };
}

/** A file:// address's path (decoded), or null for any other address. */
export function filePath(url: string | null | undefined): string | null {
  const path = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(url ?? "")?.[1];

  if (path === undefined) return null;

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Where a tab's view loads from (see source()). */
export type Source = { readonly url: string } | { readonly path: string; readonly trust: "interactive" };

/** Where a tab's view loads from: an http(s) address as `url`; a file://
 *  one (an HTML file from the files pane) as the file itself, with its
 *  folder readable (css, scripts, images beside it) and its scripts on. The
 *  native view takes no file:// `url`. */
export function source(url: string): Source {
  const path = filePath(url);

  return path ? { path, trust: "interactive" } : { url };
}

/** A tab's name in the strip: its page's title, else its host (a file: its
 *  name), else "new tab". */
export function label(tab: Tab): string {
  const title = tab.page.title?.trim();

  if (title) return title;

  const href = tab.page.href ?? tab.start ?? "";
  const file = filePath(href);

  if (file) return file.split("/").filter(Boolean).at(-1) ?? file;

  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(href)?.[1];

  return host === undefined ? "new tab" : host.replace(/^www\./, "");
}

/** A slot as a command's JSON names it: a string (a number reads as one), or none. */
const isSlotValue = oneOf(isString, isNumber, isNull);

const slotText = (slot: string | number | null | undefined): string | null => (slot === null || slot === undefined ? null : String(slot));

/** A page for a pane: its address, and the pane's slot (null: whichever pane takes the rest). */
export interface OpenArgs {
  readonly url: string;
  readonly slot: string | null;
}

const isOpenValue = object({ url: isString }, { slot: isSlotValue });

/** A `browser.open:<value>` value: JSON `{ url, slot? }`, or a bare URL. */
export function openArgs(value: string): OpenArgs | null {
  const v = value.trim();

  if (!v) return null;

  if (v.startsWith("{")) {
    const o = parseJson(v, isOpenValue);

    return o?.url.trim() ? { url: o.url.trim(), slot: slotText(o.slot) } : null;
  }

  return { url: v, slot: null };
}

// ---- one tab pinned to the shelf (nocturne's pins.ts reads these records)
//
// Nocturne keeps the shelf's pins in shared PINS: [{ pane, mod, props, at, tab? }].
// A record with `tab` pins that one tab of a web pane: the shelf names it by the
// tab's title (TAB_TITLES), and going to it focuses the pane and shows the tab
// (command show:{ slot, tab }, or SHOW when the pane comes on screen later).
// A web pane finds its records by its props' slot (its pane id may change
// across a restart; nocturne's tidy() keeps `pane` current).

export const PINS = "nocturne.pinned-panes";

/** A record of PINS, as nocturne writes it (pins.ts: its fields as nocturne
 *  reads them, so a record nocturne keeps is kept here too). */
const isPinRecord = object({ pane: isString }, { mod: nullable(isString), props: isJson, at: oneOf(isNumber, isString, isNull), tab: isString });

export type PinRecord = Guarded<typeof isPinRecord>;

/** PINS, read entry by entry (a record in another shape is left out, as nocturne leaves it out). */
export const PINS_LIST = sharedListKey(PINS, isPinRecord);

/** PINS, written whole. */
export const PINS_KEY = sharedKey(PINS, arrayOf(isPinRecord));

/** Props with a slot (a pane's own, kept apart from other panes'). */
const isSlotted = object({ slot: oneOf(isString, isNumber) });

/** A pin's props' slot, as text (a number reads as one), or null. */
const propSlot = (props: Json | undefined): string | null => (isSlotted(props) ? String(props.slot) : null);

const ofSlot = (r: PinRecord, slot: string | null) => r.mod === "browser" && propSlot(r.props) !== null && propSlot(r.props) === slot;

/** Tab `tab` of the pane with this slot is pinned to the shelf. */
export const tabPinned = (records: readonly PinRecord[], slot: string, tab: string): boolean => records.some((r) => ofSlot(r, slot) && r.tab === tab);

/** A browser pane as a pin names it: its id and its props (with its slot). */
export interface PinnedPane {
  readonly pane: string;
  readonly props: Json;
}

/** The records with tab `tab` of `pane` pinned (at `now`) or not. */
export function pinTab(records: readonly PinRecord[], pane: PinnedPane, tab: string, on: boolean, now: number): PinRecord[] {
  const slot = propSlot(pane.props);
  const rest = records.filter((r) => !(ofSlot(r, slot) && r.tab === tab));

  return on ? [...rest, { pane: pane.pane, mod: "browser", props: pane.props, at: now, tab }] : rest;
}

/** The records without the pins of tab `tab` of the pane with this slot (it
 *  closed), or null when it had none. */
export function dropTabPins(records: readonly PinRecord[], slot: string, tab: string): PinRecord[] | null {
  const rest = records.filter((r) => !(ofSlot(r, slot) && r.tab === tab));

  return rest.length === records.length ? null : rest;
}

/** A web pane's props, the fields read here: its slot, or the page it inspects. */
const isWebProps = object({}, { slot: isSlotValue, inspect: isSlotValue });

/** A browser pane's slot (from its props, as text), or null. */
export const paneSlot = (p: PaneInfo): string | null => (isWebProps(p.props) ? slotText(p.props.slot) : null);

/** The web view an inspector pane inspects (from its props, as text), or null: not an inspector. */
export const paneInspects = (p: PaneInfo): string | null => (isWebProps(p.props) ? slotText(p.props.inspect) : null);

/** A pane's props as JSON (a pin keeps them), or null. */
export const paneProps = (p: PaneInfo): Json | null => (isJsonObject(p.props) ? p.props : null);

/** A tab for a pane: the tab, and the pane's slot. */
export interface ShowArgs {
  readonly slot: string | null;
  readonly tab: string;
}

const isShowValue = object({ tab: isString }, { slot: isSlotValue });

/** A `show:` value (JSON `{ slot, tab }`), or null. */
export function showArgs(value: string): ShowArgs | null {
  const o = parseJson(value, isShowValue);

  return o?.tab ? { slot: slotText(o.slot), tab: o.tab } : null;
}

/** Each tab's name for the shelf, by tab id; blank tabs have none. */
export const tabTitles = (m: Tabs): ReadonlyMap<string, string> => new Map(m.list.flatMap((t) => (t.page.href || t.page.title || t.start ? [[t.id, label(t)] as const] : [])));

// ---- the tab's menu (a right-click on it, m in the bar): its rows in sections

/** What a menu row does. */
export type MenuAct = "pin" | "left" | "right" | "close";

export interface MenuRow {
  readonly act: MenuAct;
  readonly name: string;
  readonly enabled: boolean;
}

/** What the menu's rows depend on. */
export interface MenuState {
  readonly pinned?: boolean;
  readonly canPin?: boolean;
  readonly index?: number;
  readonly count?: number;
}

/** The menu's sections for a tab: `{ pinned, canPin, index, count }` →
 *  [[{ act, name, enabled }], …]. */
export function menuRows({ pinned = false, canPin = true, index = 0, count = 1 }: MenuState = {}): MenuRow[][] {
  return [
    [{ act: "pin", name: pinned ? "Unpin this tab from the shelf" : "Pin this tab to the shelf", enabled: canPin }],
    [{ act: "left", name: "Move the tab left", enabled: index > 0 }, { act: "right", name: "Move the tab right", enabled: index < count - 1 }],
    [{ act: "close", name: "Close the tab", enabled: true }],
  ];
}

/** The next enabled row from `at` going `by` (wrapping), or `at`. */
export function menuStep(rows: readonly MenuRow[], at: number, by: number): number {
  const n = rows.length;

  for (let k = 1; k <= n; k++) {
    const i = (((at + by * k) % n) + n) % n;

    if (rows[i]?.enabled) return i;
  }

  return at;
}
