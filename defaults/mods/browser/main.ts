// Nocturne browser: a real WebKit view in a pane, on the native-view element
// of the DwieDave/fireflies fork (stock Herdr has none: the pane says so).
//
//   bar      back, forward, reload / stop, the address (host bright, path dim)
//   cmd+p    edit the address (also cmd+l, or click it); Enter goes, Esc
//            cancels. Text that isn't an address is searched.
//   cmd+r    reload, also while the page has the keyboard
//   cmd+[ / cmd+]   back / forward
//   cmd+alt+i  the inspector (the </> button)
//   cmd+esc  out of the page: the keyboard back to the bar (the page keeps esc)
// Keys while the bar has the keyboard (its pane focused: a click, pane.go, a tab switch, cmd+esc):
//   enter / i  into the page        o  /   the address
//   H L  back / forward   r  reload   + - 0  zoom   p  picture in picture
//   d  the inspector   O  the system's browser   ?  the keys, under the bar
//   t  new tab   x  close the tab   J K  the tab left / right   1-9  a tab (9 the last)
//   < >  move the tab (the ring's, else the shown one) left / right   m  its menu
//   tab / shift-tab  the tabs and the bar's buttons (a ring shows which), enter presses it
//   esc  the ring, then the keys strip, away
//   ⧉        (only while the page has a <video>)
//            the page's video in the pip player, a Fireflies window over
//            every tab and space (command browser.pip); the page goes
//            with it, and comes back with ↩ or ✕ (or ⧉ again). Meanwhile this
//            pane is parked, and shown again when the video comes back or goes
//            into a pane. The tab's only pane: the whole tab is put away
//            (settled) and the tab shown before it shows; ↩ or ✕ shows the tab
//            again, into a pane only brings it back to the tab bar. The only
//            tab of its space: the space shown before it shows; the only tab
//            of the only space stays.
//   ↗        the page in the system's default browser
//   </>      Safari's Web Inspector for the page, in a pane split beside it
//            (again: closes it). That pane is this mod with props
//            { inspect }: the inspector alone, no bar.
//
// Tabs (tabs.ts has the rules): one pane, several pages, each its own web view
// (id "web", "web-2", …) kept alive while another shows, in no room at all
// (which hides a native view). From two on, a strip over the bar: number,
// title, × (a middle click closes too), + a blank tab. Drag a tab along it to
// move it: it lifts where it is and a marker stands in the gap it drops into
// (the pointer's half of the tab under it; past the last tab, the end). The
// view is made with `tabs: true`, so what would open a window comes as web.newTab: a middle or
// Cmd click on a link and the link menu's "Open Link in New Tab" behind (Shift:
// in front), target=_blank / window.open in front, each after its page's
// earlier links. The bar, zoom, picture in picture and the inspector act on the
// shown tab. Closing the last tab leaves a blank one. Kept in localStorage
// "tabs" (addresses, titles, zoom): after a restart only the shown tab loads,
// the others when first shown, in the order last left. Commands tab_new,
// tab_close, tab_next, tab_prev, tab_move_left, tab_move_right, pin_tab,
// tab_menu, tab:<n>, tab_act:<{ slot, tab, act }> (the tab menu's picks), and
// open:<{ url, slot? } as JSON, or a URL> (the editor's links): the copy
// whose slot it names opens it in front and its pane takes the keyboard.
// A tab's menu (a right-click on it; m in the bar, for the ringed tab else the
// shown one): pin it to the shelf or unpin it, move it left / right, close it.
// It is this mod as a popup (props { tabMenu }); its picks come back as tab_act.
// A pinned tab (nocturne's PANES_KEY record with `tab`, tabs.ts has the rules)
// is its own tile on the shelf, named from shared browser.tab-titles
// ({ [slot]: { [tab]: title } }); the tile sends show:<{ slot, tab }> (or leaves
// browser.show for when this pane comes on screen). Closing the tab
// drops its pin; it keeps it across restarts (tab ids are kept).
// A file:// address (an HTML file from the files pane) loads as the file
// (props path, trust "interactive": its folder readable, scripts on).
//
// Several can be open, in one tab or many: each pane is its own mod copy
// (its own view, events and localStorage, when its props carry a `slot`).
// `browser.<cmd>` reaches every shown copy, so only one acts on it:
// the focused pane's (found by its `slot`; an inspector pane's is its page's),
// else the one last focused or clicked (a command from the palette or an agent).
//
// Where the keys go (keys.json's mod:browser applies while GPUI's
// keyboard is inside this mod):
//   the bar     the bar keys above, and the mod's section, over the layout's
//               (cmd-p is the address here, not the picker; cmd-[ / cmd-] are
//               history, not agents)
//   the address the field's own keys; the section's chords; esc into the page
//   the page    a click into it gives this mod GPUI's keyboard too (focus), so
//               the chords the page leaves come back to the section; ⌘R / ⌥⌘I /
//               ⌘esc are taken before the page sees them (the native view's
//               web.reloadKey / web.inspectKey / view.escapeKey)
// Tab never reaches an on_key_down (GPUI's root binds it to moving focus): the
// root binds tab / shift-tab in its own key context and hands them to key().
// Logins persist: the view keeps its own WebKit store (persist: true), never
// Safari's or Chrome's. A new pane starts on a blank sky with the address
// field focused, so nothing loads until you type.
// Props: { url?, slot? }: url to open on a page (saved tabs win over it); slot,
// unique per pane, keeps its remembered tabs apart from other panes' (the store
// is per props).
// { inspect }: an inspector pane for the web view with that key.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent, Point } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, nextCommand, shared, setShared, run, panes, spaces, focused, openOverlay, closeOverlay, window as appWindow } from "herdr";
import type { OverlaySpec, PaneInfo, TabInfo, Theme } from "herdr";
import type { Guarded, SharedMapKey } from "./guard.ts";
import { isBoolean, isNull, isNumber, isString, literal, nullable, object, oneOf, parseJson, readShared, readSharedList, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { KeyRow } from "./keyhelp.ts";
import { keysHint, keysView, keysKey } from "./keyhelp.ts";
import * as Tabs from "./tabs.ts";
import type { Gap, MenuRow, Page, Tab } from "./tabs.ts";

const ICONS = "mods/browser/icons";
const SEARCH = "https://duckduckgo.com/?q=";

// What `?` lists.
// Every key key() and barKey() take (the cmd ones are keys.json's mod:browser), ? keys last.
export const KEYS: readonly KeyRow[] = [["enter i", "into the page"], ["⌘esc", "back to the bar"], ["o /  ⌘l ⌘p", "address"], ["H L  ⌘[ ⌘]", "back / forward"],
  ["r  ⌘r", "reload"], ["+ - 0", "zoom"], ["p", "picture in picture"], ["d  ⌘⌥i", "inspector"], ["O", "system browser"],
  ["t", "new tab"], ["x", "close the tab"], ["J K", "tab left / right"], ["1-9", "tab 1 to 8, 9 the last"],
  ["< >", "move the tab left / right (or drag it)"], ["m", "the tab's menu: pin it to the shelf, move, close"],
  ["tab ⇧tab", "buttons and tabs (⏎ presses)"], ["esc", "out of the address · keys away"], ["?", "keys"]];

/** A key's name: the typed character for printable keys ("H", "?", "+"), else GPUI's key. */
const keyOf = (e: KeyEvent): string => (isString(e.key_char) && e.key_char.length === 1 && e.key_char.trim() ? e.key_char : e.key);

// The copy that last had the keyboard or a click: it takes broadcast commands
// while no web pane is focused.
const ACTIVE = sharedKey("browser.active", nullable(isString));

// Tab and shift-tab, bound in the browser's own key context (see the top).
const CONTEXT = "NocturneBrowser", TAB = "nocturne_browser::tab", TAB_BACK = "nocturne_browser::tab_back";

/** The key event a bound tab stands for. */
const tabEvent = (shift: boolean): KeyEvent => ({ key: "tab", keystroke: shift ? "shift-tab" : "tab", modifiers: { shift, control: false, alt: false, platform: false, function: false } });

// What each web pane shows, for the dock's shelf: { [props.slot]: the shown
// tab's page title (else its host) }, as the viewers keep theirs.
const TITLES = sharedMapKey("browser.titles", isString);

// Every tab's name, for a tab pinned to the shelf: { [props.slot]: { [tab id]: title } }.
// Its entries as stored: an object keyed by tab id, every value a title. Read into maps
// (tabTitlesNow), written back from them.
interface StoredTitles {
  readonly [tab: string]: string;
}

const isStoredTitles = (value: unknown): value is StoredTitles =>
  isPlainObject(value) && Object.keys(value).every((tab) => isString(Object.getOwnPropertyDescriptor(value, tab)?.value));

const TAB_TITLES = sharedMapKey("browser.tab-titles", isStoredTitles);

/** Every pane's tab titles, by slot, then by tab. */
const tabTitlesNow = (): ReadonlyMap<string, ReadonlyMap<string, string>> =>
  new Map([...readSharedMap(shared, TAB_TITLES)].map(([slot, titles]) => [slot, new Map(Object.entries(titles))]));

/** Writes every pane's tab titles (by slot, then by tab) as stored. */
const writeTabTitles = (all: ReadonlyMap<string, ReadonlyMap<string, string>>) =>
  writeSharedMap(setShared, TAB_TITLES, new Map([...all].map(([slot, titles]) => [slot, Object.fromEntries(titles)])));

/** Same titles, in the same order. */
const sameTitles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) =>
  a.size === b.size && [...a].every(([k, v], i) => [...b.keys()][i] === k && b.get(k) === v);

// A tab to show once this pane is on screen (nocturne's goToPin): { slot, tab, at }.
const SHOW = sharedKey("browser.show", nullable(object({ tab: isString }, { slot: oneOf(isString, isNumber, isNull), at: isNumber })));

// How long such a wish holds (ms): long enough for a tab or space switch.
const SHOW_FOR = 5000;

// The tab's menu: a row's height, the rule between its sections.
const MENU_ROW = 26, MENU_RULE = 9, MENU_W = 250;

// The open inspector panes: { [web view key]: pane id }, one per page.
const INSPECTORS = sharedMapKey("browser.inspectors", isString);
const INSPECTOR = "inspector";

// The picture in picture player: one window, whichever page's video it shows.
// The picture in picture player window (as pip opens it): 16:9 under its bar, resizable.
const PLAYER = { mod: "pip", kind: "window", key: "pip", frame: "none", width: 384, height: 238,
  resizable: { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] } } satisfies OverlaySpec;

// The pane the player put the video in (pip): { of, pane, park }.
const PIP_PANE = sharedKey("pip.pane", nullable(object({ of: isString, pane: isString, park: isBoolean })));

/** An object (not an array, not null): its fields still to be proven. */
const isPlainObject = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** A tab's menu, as the popup copy is opened with it (props { tabMenu }). */
const isTabMenu = object({ tab: isString, title: isString, pinned: isBoolean, canPin: isBoolean, index: isNumber, count: isNumber }, { slot: nullable(isString) });

type TabMenu = Guarded<typeof isTabMenu>;

/** What it is opened with (see the top): other props are no props. */
const isBrowserProps = object({}, {
  url: nullable(isString),
  slot: oneOf(isString, isNumber, isNull),
  inspect: oneOf(isString, isNumber, isNull),
  tabMenu: isTabMenu,
  overlay: isString,
});

type BrowserProps = Guarded<typeof isBrowserProps>;

/** This copy's props (the app's, else what init was given). */
const browserProps = (given?: Props): BrowserProps => {
  const p = props() ?? given;

  return isBrowserProps(p) ? p : {};
};

/** Closes the popup this copy is (a tab's menu). */
const closeOwn = () => {
  const id = browserProps().overlay;

  if (id !== undefined) closeOverlay(id);
};

// ---- the web view's events (nextNativeViewEvent) and answers (nativeViewCall)

/** web.newTab: what would open a window. */
const isNewTab = object({ url: isString }, { background: isBoolean });

/** web.inspector, pip.enter, pip.popIn: the web view meant. */
const isOfData = object({ of: isString });

type OfData = Guarded<typeof isOfData>;

const isAfter = literal("pane", "park");

/** pip.popIn's `then`: the player goes on into a pane or a chip (null: it stays a window).
 *  Read from its descriptor, as guard.ts reads fields: a `then` field written in a guard
 *  of our own would make that object a thenable. */
const thenOf = (d: OfData): "pane" | "park" | null => {
  const then = Object.getOwnPropertyDescriptor(d, "then")?.value;

  return isAfter(then) ? then : null;
};

/** load.* and web.location: the page's state (fields left out keep theirs). */
const isPageState = object({}, {
  href: nullable(isString),
  url: nullable(isString),
  title: nullable(isString),
  loading: isBoolean,
  progress: isNumber,
  canGoBack: isBoolean,
  canGoForward: isBoolean,
});

/** load.error: what failed, and where. */
const isLoadError = object({}, { code: isNumber, domain: nullable(isString), failingUrl: nullable(isString), href: nullable(isString), message: nullable(isString) });

type LoadError = Guarded<typeof isLoadError>;

/** No data read. */
const isNoData = object({});

/** The view an event came from: a tab's id (none: the shown tab's). */
const FROM = { id: nullable(isString) };

/** One event of the web views (nextNativeViewEvent), a union on its name: the events read
 *  here with their data proven; any other is skipped where it comes in (parseEvent). */
const isWebEvent = oneOf(
  object({ event: literal("web.newTab"), data: isNewTab }, FROM),
  object({ event: literal("web.inspector", "pip.enter", "pip.popIn"), data: isOfData }, FROM),
  object({ event: literal("load.start", "load.commit", "load.finish", "web.location"), data: isPageState }, FROM),
  object({ event: literal("load.error"), data: isLoadError }, FROM),
  object({ event: literal("web.video") }, { ...FROM, data: object({}, { present: isBoolean }) }),
  object({ event: literal("pip.start") }, { ...FROM, data: object({}, { result: isString, error: isString }) }),
  object({ event: literal("view.click", "view.escapeKey", "web.inspectKey", "web.reloadKey", "pip.leave", "pip.moved") }, { ...FROM, data: isNoData }),
);

export type WebEvent = Guarded<typeof isWebEvent>;

/** A web view's event (nextNativeViewEvent's text), or undefined: not one read here. */
export const parseEvent = (text: string): WebEvent | undefined => parseJson(text, isWebEvent);

/** web.inspect's answer: the key an inspector names the view by. */
const isInspected = object({ of: isString });

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1, dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** The drop marker of a tab drag, as the app's strip (nocturne/tabdrag.js):
 *  a 2 px accent bar capped top and bottom, at the left edge of its box. */
function stake(t: Theme): Element {
  return div().absolute().left(-3).top(3).bottom(2).w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The dragged tab's lift, behind its words: a dither shadow, then a plate
 *  edged in the accent, clear of the horizon. */
function lift(t: Theme): Element[] {
  return [
    div().absolute().left(5).right(0).top(6).bottom(2).child(dither(t.ansi0, 1)),
    div().absolute().left(2).right(3).top(3).bottom(4).bg(t.background).border(1).border_color(t.accent),
  ];
}

// Not on stock Herdr: the module has no nativeView there.
const available = () => typeof herdr.nativeView !== "undefined";

/** What was typed, as a URL: an address as is (https added), anything else searched. */
function target(text: string): string | null {
  const s = text.trim();

  if (!s) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;

  const hostish = !/\s/.test(s) && (/^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) || /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s));

  return hostish ? s : SEARCH + encodeURIComponent(s);
}

/** A failed load in words, and the address to retry. */
export interface Failure {
  readonly message: string;
  readonly url: string | null;
}

/** A load.error in words a person reads, or null when nothing failed: a load
 *  cut short (NSURLErrorDomain -999: the next navigation replaced it, a
 *  redirect, a click while loading; WebKitErrorDomain 102: a download, or a
 *  tab opened instead; 204: a plug-in took it). `url`: the address to retry
 *  (the one that failed, not the page still shown). */
export function loadFailure(d: LoadError): Failure | null {
  const code = d.code ?? Number.NaN, domain = d.domain ?? null;
  const url = d.failingUrl || null;
  const web = domain === "WebKitErrorDomain" || (domain === null && code === 102);

  if ((domain === "NSURLErrorDomain" || domain === null) && code === -999) return null;

  if (web && (code === 102 || code === 204)) return null;

  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url ?? d.href ?? "")?.[1]?.replace(/^www\./, "") ?? "The site";

  const words = domain === "NSURLErrorDomain" || domain === null ? new Map<number, string>([
    [-1009, "You're offline."],
    [-1020, "No network may be used for this."],
    [-1003, `Can't find ${host}: no such site, or no name server.`],
    [-1004, `${host} doesn't answer.`],
    [-1001, `${host} took too long to answer.`],
    [-1005, "The connection went down."],
    [-1007, `${host} redirects in a loop.`],
    [-1011, `${host} answered something unreadable.`],
    [-1202, `${host}'s certificate isn't trusted.`],
    [-1201, `${host}'s certificate has expired or isn't valid yet.`],
    [-1200, `A secure connection to ${host} failed.`],
    [-1206, `${host} wants a client certificate.`],
    [-1022, `${host} has to be opened over https.`],
    [-1002, "This kind of address can't open here."],
    [-1100, "There's no such file."],
    [-1102, "That file can't be read."],
  ]).get(code) ?? null : web && (code === 100 || code === 101) ? "This page can't be shown here: ↗ opens it in the system's browser." : null;

  const said = (d.message ?? "").trim();
  // WebKit's generic "The operation couldn't be completed. (… error N.)" says nothing.
  const vague = !said || /couldn.t be completed|NSURLErrorDomain|WebKitErrorDomain/i.test(said);
  const message = words ?? (vague ? `The page didn't load${Number.isFinite(code) ? ` (error ${code})` : ""}.` : said);

  return { message, url };
}

/** An address split for the bar: host, then the rest. */
function parts(href: string | null): readonly [string, string] {
  const m = /^[a-z]+:\/\/([^/?#]+)(.*)$/i.exec(href ?? "");
  const host = m?.[1], rest = m?.[2];

  return host !== undefined && rest !== undefined ? [host.replace(/^www\./, ""), rest === "/" ? "" : rest] : [href ?? "", ""];
}

/** What a call to a web view is given: a page to go to, whether it shows, or nothing. */
type CallArgs = { readonly url: string } | { readonly visible: boolean } | Readonly<Record<never, never>>;

/** A bar button tab and enter reach: its id, whether it can be pressed, what it does. */
interface Control {
  readonly id: string;
  readonly enabled: boolean;
  readonly action: (cx: Context) => void;
}

/** A space's tab, with its space. */
interface SpaceTab extends TabInfo {
  readonly space: string;
}

/** What picture in picture put away: this pane (parked) or its whole tab (settled). */
type Hidden = { readonly pane: string } | { readonly tab: string };

export default class Browser extends View {
  /** tab / shift-tab are bound once, for every copy. */
  static bound = false;

  // An inspector pane: the web view it inspects, and why there's nothing to.
  inspect: string | null = null;
  lost: string | null = null;
  // A tab's menu: what it is for, its rows, the one under the cursor.
  menu: TabMenu | null = null;
  rows: readonly MenuRow[] = [];
  cursor = 0;
  // A web pane: its slot (from its props, else made up), its tabs.
  ownSlot = false;
  slot = "";
  tabs: Tabs.Tabs = Tabs.single(null, 0.9);
  barW = 600;
  // A left press on a tab ({ id, x }), and the drag it became ({ id, gap }: Tabs.dropIndex).
  pressed: { readonly id: string; readonly x: number } | null = null;
  drag: { readonly id: string; gap: Gap | null } | null = null;
  handle: FocusHandle | null = null;
  input: InputState | null = null;
  editing = false;
  // The tabs shown lately (newest last): picture in picture puts this tab away and shows the one before.
  seen: { readonly space: string | null; readonly tab: string }[] = [];
  // The page's video is in the player meanwhile, from this view.
  away = false;
  pipOf: string | null = null;
  hidden: Hidden | null = null;
  keysShown = false;
  // The bar's buttons as last drawn, the one the ring is on, and whether the bar has the keyboard.
  controls: Control[] = [];
  ring: string | null = null;
  barFocused = false;

  override init(p: Props | undefined, cx: AsyncContext) {
    const pr = browserProps(p);

    // A web tab's menu: this mod as a popup (openTabMenu), props { tabMenu }.
    if (pr.tabMenu) {
      this.initMenu(pr.tabMenu, cx);

      return;
    }

    // An inspector pane: Safari's Web Inspector for another pane's page.
    this.inspect = pr.inspect ? String(pr.inspect) : null;

    if (this.inspect) {
      this.initInspector(cx);

      return;
    }

    // A slot from the props names this copy's pane too (panes() carries its props).
    this.ownSlot = Boolean(pr.slot);
    this.slot = pr.slot ? String(pr.slot) : Math.random().toString(36).slice(2);

    if (!Browser.bound) {
      try {
        cx.bind_keys([{ keystroke: "tab", action: TAB, context: CONTEXT }, { keystroke: "shift-tab", action: TAB_BACK, context: CONTEXT }]);
        Browser.bound = true;
      } catch {
        /* key() still takes a tab that reaches it */
      }
    }

    let saved: string | null = null, savedTabs: string | null = null, zoom = 0.9;

    try {
      saved = localStorage.getItem("url");
      savedTabs = localStorage.getItem("tabs");
      // Page zoom, per tab: a step under the UI's size by default.
      zoom = Number(localStorage.getItem("zoom")) || 0.9;
    } catch {
      /* none kept */
    }

    // The tabs (tabs.ts), each its own web view: the ones saved, else one on
    // the props' page, else the page this pane had before it kept tabs. A
    // tab's view is created on its `start`; later pages go through navigate
    // calls (new props would rebuild the view).
    this.tabs = (savedTabs && Tabs.restore(savedTabs, zoom)) || Tabs.single(pr.url ? target(pr.url) : saved, zoom);
    this.publishTitle();

    const handle = cx.focus_handle();
    const input = InputState.new({ placeholder: "address or search" });

    this.handle = handle;
    this.input = input;
    input.on("submit", (_e, cx) => {
      this.go(input.value(), cx);
    });
    input.on("blur", (_e, cx) => {
      if (this.start) {
        this.editing = false;
        cx.notify();
      }
    });
    this.editing = !this.start;

    if (this.editing) cx.timer.after(150, () => input.focus());
    // Opened as the focused pane (a link beside a terminal): the bar takes the keyboard.
    else {
      for (const ms of [0, 120, 400]) {
        cx.timer.after(ms, () => {
          if (this.ownSlot && this.isFocusedPane() && !handle.is_focused() && !this.editing) {
            this.claim();
            handle.focus();
          }
        });
      }
    }

    // The tabs shown lately (newest last, `{ space, tab }`): picture in picture
    // puts this tab away and shows the one before. Polled gently: a mod isn't
    // told when another tab shows.
    cx.timer.every(500, (cx) => {
      this.noteShown();
      this.takeShow(cx);
    });

    if (available()) {
      cx.spawn(async (cx) => {
        for (;;) {
          const e = await this.nextEvent();

          if (e === null) return;

          if (e) this.onEvent(e, cx);

          cx.notify();
        }
      });
    }

    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^browser\./, "");

        // "focus" comes to this copy alone (pane.go); the rest to every shown copy.
        // Sent too on a press into the page (it keeps AppKit's keyboard) and when
        // the window focuses this pane any other way (a tab switch, agent.next).
        // A blank pane: the address field it types into keeps the keyboard.
        if (c === "focus") {
          this.takeShow(cx);
          this.claim();

          if (this.editing && !this.start) input.focus();
          else handle.focus();
        }
        // A tab pinned to the shelf: the pane named by its slot shows it.
        else if (c.startsWith("show:")) this.showCommand(c.slice(5), cx);
        // A pick in a tab's menu (the menu is another copy): { slot, tab, act }.
        else if (c.startsWith("tab_act:")) this.tabAct(c.slice(8), cx);
        // open names its pane by slot (else the one that takes the rest).
        else if (c === "open" || c.startsWith("open:")) this.openCommand(c.slice(5), cx);
        else if (this.mine()) this.command(c, cx);

        cx.notify();
      }
    });
  }

  /** The next event of this copy's views: null when there are none (the stream ended),
   *  undefined for one that isn't an event (skipped). */
  async nextEvent(): Promise<WebEvent | null | undefined> {
    let text: string;

    try {
      text = await herdr.nextNativeViewEvent();
    } catch {
      return null;
    }

    return parseEvent(text);
  }

  /** An inspector pane: pane.go gives it the keyboard; enter puts it into the inspector, cmd+esc takes it out. */
  initInspector(cx: AsyncContext) {
    const handle = cx.focus_handle();

    this.handle = handle;

    if (available()) {
      cx.spawn(async (cx) => {
        for (;;) {
          const e = await this.nextEvent();

          if (e === null) return;

          if (e?.event === "load.error") {
            this.lost = e.data.message ?? "Nothing to inspect.";
            cx.notify();
          }

          if (e?.event === "view.escapeKey") handle.focus();
        }
      });
    }

    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^browser\./, "");

        if (c === "focus") handle.focus();

        cx.notify();
      }
    });
  }

  // The shown tab, and its page, address, zoom, … as the bar acts on them.
  get tab(): Tab {
    const shown = Tabs.activeTab(this.tabs);

    if (shown) return shown;

    // No tabs (close() always leaves one): a blank one.
    this.tabs = Tabs.single(null, 0.9);

    return Tabs.activeTab(this.tabs) ?? Tabs.makeTab(Tabs.tabId(1), null, 0.9);
  }

  get start(): string | null {
    return this.tab.start;
  }

  set start(v: string | null) {
    this.tab.start = v;
  }

  get page(): Page {
    return this.tab.page;
  }

  set page(v: Page) {
    this.tab.page = v;
  }

  get error(): string | null {
    return this.tab.error;
  }

  set error(v: string | null) {
    this.tab.error = v;
  }

  /** The page has a <video> (event web.video): ⧉ shows only then. */
  get video(): boolean {
    return this.tab.video;
  }

  set video(v: boolean) {
    this.tab.video = v;
  }

  get zoom(): number {
    return this.tab.zoom;
  }

  set zoom(v: number) {
    this.tab.zoom = v;
  }

  /** A call to tab `id`'s view that may find none (a tab not loaded yet). */
  quiet(id: string, action: string, args?: CallArgs): void {
    if (!available()) return;

    try {
      herdr.nativeViewCall(id, action, args ?? {});
    } catch {
      /* no view yet */
    }
  }

  /** The tabs, kept for the next start (and the shown page, as before tabs). */
  saveTabs() {
    try {
      localStorage.setItem("tabs", Tabs.save(this.tabs));

      if (this.page.href) localStorage.setItem("url", this.page.href);
    } catch {
      /* not kept */
    }

    this.publishTitle();
  }

  /** The browser panes' slots (their pins and titles are kept by them). */
  liveSlots(): Set<string> {
    return new Set(panes().flatMap((p) => {
      const slot = p.mod === "browser" ? Tabs.paneSlot(p) : null;

      return slot === null ? [] : [slot];
    }));
  }

  /** The shown tab's name in shared TITLES under this pane's slot (a blank
   *  tab: none, the shelf says the host or "Web"); slots of panes that are
   *  gone go. Written only when something changed. */
  publishTitle() {
    if (!this.ownSlot || this.inspect) return;

    const live = this.liveSlots();

    this.publishTabTitles(live);

    const was = readSharedMap(shared, TITLES);
    const name = this.page.href || this.page.title ? Tabs.label(this.tab) : null;
    const stale = [...was.keys()].some((k) => !live.has(k) && k !== this.slot);

    if ((was.get(this.slot) ?? null) === name && !stale) return;

    const next = new Map([...was].filter(([k]) => live.has(k) && k !== this.slot));

    if (name) next.set(this.slot, name);

    writeSharedMap(setShared, TITLES, next);
  }

  /** Every tab's name in shared TAB_TITLES under this pane's slot (a tab
   *  pinned to the shelf is named by it); gone panes' entries go. Written
   *  only when something changed. */
  publishTabTitles(live: ReadonlySet<string>) {
    const was = tabTitlesNow();
    const mine = Tabs.tabTitles(this.tabs);
    const same = sameTitles(was.get(this.slot) ?? new Map(), mine);
    const stale = [...was.keys()].some((k) => !live.has(k) && k !== this.slot);

    if (same && !stale) return;

    const next = new Map([...was].filter(([k]) => live.has(k) && k !== this.slot));

    if (mine.size) next.set(this.slot, mine);

    writeTabTitles(next);
  }

  // ---- a tab pinned to the shelf (Tabs.pinTab; nocturne's shelf draws it)

  /** Tab `id` is pinned to the shelf. */
  tabPinned(id: string): boolean {
    return this.ownSlot && Tabs.tabPinned(readSharedList(shared, Tabs.PINS_LIST), this.slot, id);
  }

  /** This pane can pin a tab: it has a slot (the shelf finds it again by it) and is found. */
  canPin(): boolean {
    return Boolean(this.ownSlot && this.ownPane());
  }

  /** Pins tab `id` to the shelf, or unpins it. */
  togglePin(id: string) {
    const me = this.ownSlot ? this.ownPane() : null;
    const props = me ? Tabs.paneProps(me) : null;

    if (!me || !props || !this.tabs.list.some((t) => t.id === id)) return;

    writeShared(setShared, Tabs.PINS_KEY, Tabs.pinTab(readSharedList(shared, Tabs.PINS_LIST), { pane: me.pane, props }, id, !this.tabPinned(id), Date.now()));
  }

  /** `show:{ slot, tab }` (a tab's tile on the shelf): the pane with that slot shows it. */
  showCommand(value: string, cx: Context) {
    const a = Tabs.showArgs(value);

    if (!a || !this.ownSlot || a.slot !== this.slot) return;

    const w = readShared(shared, SHOW, null);

    if (w?.slot === this.slot) writeShared(setShared, SHOW, null);

    this.showTab(a.tab, cx);
    this.claim();
  }

  /** A tab the shelf asked for while this pane wasn't on screen (SHOW): shown now. */
  takeShow(cx: Context) {
    const w = readShared(shared, SHOW, null);

    if (!w || !this.ownSlot || String(w.slot) !== this.slot) return;

    writeShared(setShared, SHOW, null);

    if (Date.now() - (w.at ?? Number.NaN) <= SHOW_FOR) this.showTab(w.tab, cx);
  }

  // ---- the tab's menu: this mod as a popup (props { tabMenu })

  /** Opens tab `id`'s menu: at the pointer (a right-click), or in the middle
   *  from the keyboard (`keyboard`: m in the bar), as Nocturne's menus open. */
  openTabMenu(id: string, keyboard: boolean) {
    const index = Tabs.indexOf(this.tabs, id);
    const tab = this.tabs.list[index];

    if (!tab) return;

    const menu: TabMenu = { slot: this.ownSlot ? this.slot : null, tab: id, title: Tabs.label(tab), pinned: this.tabPinned(id),
      canPin: this.canPin(), index, count: this.tabs.list.length };

    const rows = Tabs.menuRows(menu);
    const height = rows.flat().length * MENU_ROW + (rows.length - 1) * MENU_RULE + MENU_ROW + 10;

    openOverlay({ mod: "browser", kind: keyboard ? "dialog" : "popup", frame: "none", width: MENU_W, height, props: { tabMenu: menu } });
  }

  /** `tab_act:{ slot, tab, act }`: a pick in a tab's menu, for the pane it names. */
  tabAct(value: string, cx: Context) {
    const a = parseJson(value, object({ tab: isString }, { slot: oneOf(isString, isNumber, isNull), act: isString }));

    if (!a || !(a.slot !== null && a.slot !== undefined ? this.ownSlot && String(a.slot) === this.slot : this.mine())) return;

    if (!this.tabs.list.some((t) => t.id === a.tab)) return;

    this.claim();

    if (a.act === "pin") this.togglePin(a.tab);
    else if (a.act === "left" || a.act === "right") this.stepTab(a.tab, a.act === "right" ? 1 : -1);
    else if (a.act === "close") this.closeTab(a.tab, cx);
    else if (a.act === "show") this.showTab(a.tab, cx);
  }

  initMenu(menu: TabMenu, cx: AsyncContext) {
    const handle = cx.focus_handle();

    this.menu = menu;
    this.rows = Tabs.menuRows(menu).flat();
    this.cursor = Tabs.menuStep(this.rows, -1, 1);
    this.handle = handle;
    handle.focus();
    cx.timer.after(120, () => handle.focus());
  }

  /** A row picked: to the pane (its copy acts), and the menu goes. */
  pickRow(row: MenuRow | undefined) {
    const menu = this.menu;

    if (!row?.enabled || !menu) return;

    closeOwn();
    run(`browser.tab_act:${JSON.stringify({ slot: menu.slot, tab: menu.tab, act: row.act })}`);
  }

  /** The menu's keys: ↑ ↓ j k move (over the rows that can be picked), enter picks, esc q close. */
  menuKey(e: KeyEvent, cx: Context) {
    const k = keyOf(e);

    if (k === "down" || k === "j" || k === "up" || k === "k") this.cursor = Tabs.menuStep(this.rows, this.cursor, k === "down" || k === "j" ? 1 : -1);
    else if (k === "enter") this.pickRow(this.rows[this.cursor]);
    else if (k === "escape" || k === "q") closeOwn();
    else return;

    cx.stop_propagation();
    cx.notify();
  }

  /** The menu: the tab's name, then its rows in sections, a dithered rule between. */
  renderMenu(t: Theme, menu: TabMenu): Element {
    const sections = Tabs.menuRows(menu);
    let n = 0;

    const row = (r: MenuRow) => {
      const i = n++, on = i === this.cursor && r.enabled;

      return h_flex().id(`tm-${r.act}`).relative().h(MENU_ROW).flex_none().px(12).items_center().text_size(12)
        .text_color(!r.enabled ? t.ansi0 : on ? t.foreground : t.muted)
        .on_hover((h, cx) => {
          if (h && r.enabled && this.cursor !== i) {
            this.cursor = i;
            cx.notify();
          }
        })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.pickRow(r))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().flex_1().min_w(0).truncate().child(r.name));
    };

    const root = v_flex().id("tab-menu").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4);

    return (this.handle ? root.track_focus(this.handle) : root)
      .on_key_down((e, cx) => this.menuKey(e, cx))
      .on_scroll_wheel((e, cx) => {
        if (Math.abs(e.delta.y) >= 1) {
          this.cursor = Tabs.menuStep(this.rows, this.cursor, e.delta.y > 0 ? -1 : 1);
          cx.notify();
        }
      })
      .child(div().h(MENU_ROW).flex_none().px(12).flex().items_center().text_size(11).text_color(t.dim).truncate().child(menu.title))
      .children(sections.flatMap((part, k) => [
        ...(k ? [div().relative().h(MENU_RULE).flex_none().mx(12).child(div().absolute().left(0).right(0).top(4).h(1).child(dither(t.ansi8, 1)))] : []),
        ...part.map(row),
      ]));
  }

  /** A new tab on `url` (null: blank, its address open). In front unless
   *  `background`; `opener`: the tab whose link opened it. */
  openTab(url: string | null, { background = false, opener = null }: Tabs.OpenOptions, cx?: Context): Tab {
    const before = this.tabs.active;
    const [next, tab] = Tabs.open(this.tabs, url, { background, opener });

    this.tabs = next;

    if (background) this.saveTabs();
    else this.shown(before, cx);

    return tab;
  }

  /** Shows tab `id` (a click, a key, a command). */
  showTab(id: string | null, cx?: Context) {
    // A tab closed under the click (its ×): nothing to show.
    if (!id || id === this.tabs.active || !this.tabs.list.some((t) => t.id === id)) return;

    const before = this.tabs.active;

    this.tabs = Tabs.show(this.tabs, id);
    this.shown(before, cx);
  }

  /** After another tab came to the front: the one before steps aside, the
   *  address follows (a blank tab: its field takes the keyboard). */
  shown(before: string | null, cx?: Context) {
    if (before) this.quiet(before, "setVisible", { visible: false });

    this.tab.live = true;
    this.quiet(this.tab.id, "setVisible", { visible: true });
    this.editing = !this.start;

    if (this.editing) {
      const input = this.input;

      input?.set_value("");
      cx?.timer.after(50, () => input?.focus());
    }

    this.saveTabs();
  }

  /** Closes tab `id` (the shown one by default): its view goes, and its
   *  inspector pane. The last tab leaves a blank one: the pane stays. */
  closeTab(id: string | null, cx?: Context) {
    const tab = this.tabs.list.find((t) => t.id === (id ?? this.tabs.active));

    if (!tab) return;

    const pane = tab.of ? this.inspectorPane(tab.of) : null;

    if (pane) run("pane.close", { pane });

    if (tab.live) this.quiet(tab.id, "dispose");

    // Its pin on the shelf goes with it.
    const pins = this.ownSlot ? Tabs.dropTabPins(readSharedList(shared, Tabs.PINS_LIST), this.slot, tab.id) : null;

    if (pins) writeShared(setShared, Tabs.PINS_KEY, pins);

    const was = this.tabs.active;

    [this.tabs] = Tabs.close(this.tabs, tab.id);

    if (this.tabs.active !== was) this.shown(null, cx);
    else this.saveTabs();
  }

  /** `browser.open:<{ url, slot? } or a URL>`: the page in a new tab
   *  in front, and this pane takes the keyboard (the editor's links). */
  openCommand(value: string, cx: Context) {
    const a = Tabs.openArgs(value);

    if (!a || !(a.slot !== null ? a.slot === this.slot : this.mine())) return;

    const url = target(a.url);

    if (!url) return;

    this.openTab(url, {}, cx);
    this.claim();

    const me = this.ownPane();

    if (me && focused()?.pane !== me.pane) run("pane.focus", { pane: me.pane });

    this.handle?.focus();
    // Its view comes with the next frame.
    cx.timer.after(300, () => this.focusPage());
  }

  /** A click on the bar: this copy's, and not the pane's below. */
  stop(_e: MouseButtonEvent, cx: Context) {
    this.claim();
    cx.stop_propagation();
  }

  /** This copy takes the broadcast commands from now on. */
  claim() {
    if (readShared(shared, ACTIVE, null) !== this.slot) writeShared(setShared, ACTIVE, this.slot);
  }

  /** Whether a broadcast command is this copy's: the focused pane's page, else
   *  the copy last focused or clicked (focused: a terminal, the palette's caller). */
  mine(): boolean {
    const f = focused()?.pane;
    const pane = f ? panes().find((x) => x.pane === f && x.mod === "browser") : undefined;
    const inspects = pane ? Tabs.paneInspects(pane) : null;

    if (inspects !== null) return this.tabs.list.some((t) => this.keyOf(t) === inspects);

    const slot = pane ? Tabs.paneSlot(pane) : null;

    if (slot !== null) return slot === this.slot;

    // A web pane without a slot: not one of the panes that have theirs.
    if (pane && this.ownSlot) return false;

    const a = readShared(shared, ACTIVE, null);

    return a === null || a === this.slot;
  }

  /** Tab `t`'s web view key (an inspector pane's props name it), once it has one. */
  keyOf(t: Tab): string | null {
    if (t.of || !t.start || !t.live || !available()) return t.of ?? null;

    try {
      const r = herdr.nativeViewCall(t.id, "web.inspect", {});

      t.of = isInspected(r) ? r.of : null;
    } catch {
      t.of = null;
    }

    return t.of;
  }

  /** This copy's pane is the window's focused one. */
  isFocusedPane(): boolean {
    const mine = this.ownPane();

    return Boolean(mine && focused()?.pane === mine.pane);
  }

  override async close() {
    if (this.inspect || this.menu) return;

    if (readShared(shared, ACTIVE, null) === this.slot) writeShared(setShared, ACTIVE, null);

    // The pane is gone (or the mod reloads: its first titles come back with init).
    this.dropSlot(TITLES);
    this.dropSlot(TAB_TITLES);
  }

  /** This pane's entry out of a record keyed by slot. */
  dropSlot<T>(key: SharedMapKey<T>) {
    const titles = readSharedMap(shared, key);

    if (!this.ownSlot || !titles.has(this.slot)) return;

    const rest = new Map(titles);

    rest.delete(this.slot);
    writeSharedMap(setShared, key, rest);
  }

  /** The page's inspector pane, if one is open. */
  inspectorPane(of: string): string | null {
    const pane = readSharedMap(shared, INSPECTORS).get(of);

    return pane && panes().some((x) => x.pane === pane) ? pane : null;
  }

  /** The page's inspector in a split beside this pane, or closes it (the </> button). */
  inspector(cx?: Context) {
    const of = this.inspected();

    if (of === null) return;

    const pane = this.inspectorPane(of);

    if (!pane) {
      this.openInspector(of, cx);

      return;
    }

    const open = new Map(readSharedMap(shared, INSPECTORS));

    open.delete(of);
    writeSharedMap(setShared, INSPECTORS, open);
    run("pane.close", { pane });
  }

  /** This copy's pane, as well as a mod can tell (it isn't told its pane id):
   *  the focused browser pane (a click on the bar focuses it), else the only
   *  browser in the shown tab. */
  ownPane(): PaneInfo | null {
    const all = panes().filter((x) => x.mod === "browser" && Tabs.paneInspects(x) === null);

    if (this.ownSlot) return all.find((x) => Tabs.paneSlot(x) === this.slot) ?? null;

    const focusedOne = all.find((x) => x.focused);

    if (focusedOne) return focusedOne;

    const tab = panes().find((x) => x.focused)?.tab;
    const here = all.filter((x) => x.tab === tab);

    return here.length === 1 ? here[0] ?? null : null;
  }

  /** Opens an inspector pane for the web view `of`, beside this pane. */
  openInspector(of: string, cx?: Context) {
    if (this.inspectorPane(of)) return;

    const mine = this.ownPane();
    const before = new Set(panes().map((x) => x.pane));
    const direction = this.barW > 1100 ? "right" : "down";

    run("pane.split", mine ? { direction, pane: mine.pane, mod: "browser", props: { inspect: of } } : { direction, mod: "browser", props: { inspect: of } });

    // Remember the new pane, to close it from here again.
    const note = (tries: number) => {
      const made = panes().find((x) => !before.has(x.pane) && x.mod === "browser");

      if (made) writeSharedMap(setShared, INSPECTORS, new Map([...readSharedMap(shared, INSPECTORS), [of, made.pane]]));
      else if (tries > 0) cx?.timer.after(100, () => note(tries - 1));
    };

    note(10);
  }

  onEvent(e: WebEvent, cx: Context) {
    // Each tab's view says its id; a closed tab's last words go nowhere.
    const tab = e.id === null || e.id === undefined ? this.tab : this.tabs.list.find((t) => t.id === e.id);

    if (!tab) return;

    switch (e.event) {
      // A new window, a middle or Cmd click, the link menu (native view `tabs: true`).
      case "web.newTab":
        if (!e.data.url) return;

        this.openTab(e.data.url, { background: Boolean(e.data.background), opener: tab.id }, cx);

        if (!e.data.background) cx.timer.after(300, () => this.focusPage());

        return;
      case "view.click":
        this.claim();

        return;
      // cmd+esc in the page: the keyboard is the bar's again.
      case "view.escapeKey":
        this.claim();
        this.handle?.focus();

        return;
      // Right-click "Inspect Element": WebKit opened the inspector; give it its pane.
      case "web.inspector":
        this.openInspector(e.data.of, cx);

        return;
      // ⌥⌘I while the page has the keyboard (it never reaches Fireflies' keys).
      case "web.inspectKey":
        this.inspector(cx);

        return;
      // ⌘R while the page has the keyboard: reload (or stop, while it loads).
      case "web.reloadKey":
        this.command("reload");

        return;
      // web.location: the address changed without a load too (links in
      // single-page apps, pushState, #fragments, back/forward within a page).
      case "load.start":
      case "load.commit":
      case "load.finish":
      case "web.location": {
        const s = e.data, was = tab.page;

        tab.page = {
          href: s.href ?? s.url ?? was.href,
          title: s.title === undefined ? was.title : s.title,
          loading: s.loading ?? was.loading,
          progress: s.progress ?? was.progress,
          canGoBack: s.canGoBack ?? was.canGoBack,
          canGoForward: s.canGoForward ?? was.canGoForward,
        };

        // The next page: the last one's error line goes.
        if (e.event === "load.start" || e.event === "load.commit") {
          tab.error = null;
          tab.failed = null;
        }

        if ((e.event === "load.finish" || e.event === "web.location") && tab.page.href) this.saveTabs();

        return;
      }

      // ⧉ shows while the page has a <video> (it comes and goes with the page).
      case "web.video":
        tab.video = Boolean(e.data?.present);

        return;
      // A load cut short (another page, a download, a tab instead) isn't one.
      case "load.error": {
        tab.page = { ...tab.page, loading: false };

        const f = loadFailure(e.data);

        if (f) {
          tab.error = f.message;
          tab.failed = { url: f.url };
        }

        return;
      }

      // The page's video goes to the player (⧉), or comes back into Fireflies from
      // its popped-out window: the player shows it. Meanwhile the page is away.
      // From the window out of Fireflies' ◧ / ⤓, `then`: the player goes on into a pane or a chip.
      case "pip.enter":
      case "pip.popIn": {
        const after = thenOf(e.data);

        openOverlay({ ...PLAYER, props: after ? { of: e.data.of, after } : { of: e.data.of } });

        if (e.event === "pip.enter") {
          this.away = true;
          this.pipOf = e.data.of;
          this.hide();
        }

        return;
      }

      case "pip.leave":
        this.away = false;
        this.unhide(true);

        return;
      // The video went into a pane (not a parked chip): the page shows again.
      case "pip.moved":
        cx.timer.after(400, () => {
          const n = readShared(shared, PIP_PANE, null);

          if (n?.of === this.pipOf && !n.park && panes().some((x) => x.pane === n.pane)) this.unhide(false);
        });

        return;
      case "pip.start":
        if (e.data?.result === "none") this.error = "No video on this page.";

        if (e.data?.error) this.error = `Picture in picture: ${e.data.error}`;
    }
  }

  /** A call to the shown tab's view (its answer isn't read); a failure goes to the error line. */
  call(action: string, args?: CallArgs) {
    try {
      herdr.nativeViewCall(this.tab.id, action, args ?? {});
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /** web.inspect on the shown tab's view: the key an inspector names the view by, or null
   *  (a failure goes to the error line). */
  inspected(): string | null {
    try {
      const r = herdr.nativeViewCall(this.tab.id, "web.inspect", {});

      return isInspected(r) ? r.of : null;
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause);

      return null;
    }
  }

  noteShown() {
    const f = focused();
    const tab = f?.tab;

    if (!f || !tab || this.seen.at(-1)?.tab === tab) return;

    this.seen = [...this.seen.filter((x) => x.tab !== tab), { space: f.space, tab }].slice(-8);
  }

  /** Where to go when tab `away` (of space `space`) is put away: the tab shown
   *  before it, else its neighbor; the only tab of its space: the space shown
   *  before (its tab), else another space. Null: nowhere else to go. */
  elsewhere(away: string, space: string): string | null {
    const all = spaces();
    const tabOf = (id: string): SpaceTab | undefined => all.flatMap((s) => s.tabs.map((c) => ({ ...c, space: s.id }))).find((c) => c.id === id);
    const open = <T extends TabInfo>(c: T | undefined): c is T => c !== undefined && c.id !== away && !c.settled;
    const here = all.find((s) => s.id === space)?.tabs ?? [];
    const before = [...this.seen].reverse().map((x) => tabOf(x.tab)).filter(open);
    const sameSpace = before.find((c) => c.space === space);

    if (sameSpace) return sameSpace.id;

    const i = here.findIndex((c) => c.id === away);
    const near = [...here.slice(i + 1), ...here.slice(0, Math.max(0, i)).reverse()].find(open);

    if (near) return near.id;

    if (before[0]) return before[0].id;

    const other = all.find((s) => s.id !== space && s.tabs.some(open));

    return other ? (other.tabs.find((c) => c.active && open(c)) ?? other.tabs.find(open))?.id ?? null : null;
  }

  /** While the video is in the player, this pane is out of the way: parked;
   *  the tab's only pane, its whole tab put away (settled: Nocturne lists no
   *  settled tab but the shown one, so another tab shows first). The only tab
   *  of the only space stays as it is: there's nothing else to show. */
  hide() {
    if (this.hidden) return;

    const me = this.ownPane();

    if (!me || me.parked) return;

    const placed = panes().filter((x) => x.tab === me.tab && !x.parked);

    if (placed.length > 1) {
      this.hidden = { pane: me.pane };
      run("pane.park", { pane: me.pane });

      return;
    }

    const space = spaces().find((s) => s.tabs.some((c) => c.id === me.tab));
    const tab = space?.tabs.find((c) => c.id === me.tab);

    if (!space || !tab || tab.settled) return;

    const shown = space.active && tab.active;
    const to = shown ? this.elsewhere(me.tab, space.id) : null;

    if (shown && !to) return;

    // Show another first: settling the shown tab would keep it on the tab bar.
    if (to) run("tab.select", { id: to });

    this.hidden = { tab: me.tab };
    run("tab.settle", { id: me.tab });
  }

  /** Undoes `hide`, unless the person brought it back already. `show`: the
   *  tab shows again (↩, ✕), else it is only back in the tab bar (into a pane). */
  unhide(show: boolean) {
    const h = this.hidden;

    this.hidden = null;

    if (!h) return;

    if ("pane" in h) {
      if (panes().find((x) => x.pane === h.pane)?.parked) run("pane.unpark", { pane: h.pane });

      return;
    }

    const tab = spaces().flatMap((s) => s.tabs).find((c) => c.id === h.tab);

    if (!tab) return;

    // tab.select shows it and takes it out of the settled ones.
    if (show) run("tab.select", { id: h.tab });
    else if (tab.settled) run("tab.unsettle", { id: h.tab });
  }

  go(text: string, cx?: Context) {
    const url = target(text);

    if (!url) return;

    this.editing = false;
    this.error = null;
    this.tab.failed = null;

    const first = !this.start;

    if (first) this.start = url; // the view is created on it
    // A file (file://): the view's source changes (it loads the file in
    // place); navigate takes http(s) only.
    else if (Tabs.filePath(url)) this.start = url;
    else this.call("browser.navigate", { url });

    this.page = { ...this.page, href: url, loading: true, progress: 0.05 };
    // The keyboard into the page, as a browser does (the first page's view
    // comes with the next frame); the mod keeps GPUI's, for its chords.
    this.handle?.focus();

    if (first) cx?.timer.after(300, () => this.focusPage());
    else this.focusPage();

    cx?.notify();
  }

  /** After a failed load: that address again (the page shown may be the one
   *  before it), else the page. */
  retry() {
    const url = this.tab.failed?.url;

    this.error = null;
    this.tab.failed = null;

    if (url) {
      this.call("browser.navigate", { url });
      this.page = { ...this.page, loading: true, progress: 0.05 };
    } else this.call("browser.reload");
  }

  /** The page takes AppKit's keyboard (quietly: no view yet is no error). */
  focusPage() {
    if (!this.start) return;

    this.quiet(this.tab.id, "focus", {});
  }

  /** Out of the address field without going: the page has the keyboard
   *  again (a blank pane: the bar), the mod GPUI's. */
  leaveAddress() {
    this.editing = false;
    this.handle?.focus();
    this.focusPage();
  }

  /** The page in the system's default browser. */
  external() {
    const url = this.page.href;

    if (!url) return;

    // cx.open_url would come back here as a new web pane (settings `links`).
    run("app.open_url", { url, in: "system" });
  }

  edit() {
    // The page may hold AppKit's keyboard: typing would go on to it.
    if (this.start && available()) this.call("blur");

    this.editing = true;

    const href = this.page.href ?? "";

    this.input?.set_value(href);

    // The whole address selected, as a browser's: typing replaces it.
    if (href) this.input?.set_selected_range({ start: 0, end: href.length });

    this.input?.focus();
  }

  command(c: string, cx?: Context) {
    if (c === "keys") this.keysShown = !this.keysShown;
    else if (c === "url") this.edit();
    else if (c === "inspect") {
      if (this.start) this.inspector(cx);
    }
    // Nothing open yet: no page to move (a call would only say there's no view).
    else if ((c === "reload" || c === "back" || c === "forward" || c === "web") && !(this.start && available())) return;
    else if (c === "reload" && this.tab.failed && !this.page.loading) this.retry();
    else if (c === "reload") this.call(this.page.loading ? "browser.stop" : "browser.reload");
    else if (c === "back") this.call("browser.back");
    else if (c === "forward") this.call("browser.forward");
    else if (c === "web") {
      this.ring = null;
      this.call("focus");
    } else if (c === "pip") {
      if (this.start) this.call("web.pip");
    } else if (c === "zoom_in" || c === "zoom_out" || c === "zoom_reset") {
      const z = c === "zoom_reset" ? 0.9 : this.zoom + (c === "zoom_in" ? 0.1 : -0.1);

      this.zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 10) / 10;

      // The zoom a new tab starts on, too.
      try {
        localStorage.setItem("zoom", String(this.zoom));
      } catch {
        /* not kept */
      }

      this.saveTabs();
    } else if (c === "tab_new") this.openTab(null, {}, cx);
    else if (c === "tab_close") this.closeTab(null, cx);
    else if (c === "tab_next" || c === "tab_prev") this.showTab(Tabs.step(this.tabs, c === "tab_next" ? 1 : -1), cx);
    else if (/^tab:\d$/.test(c)) this.showTab(Tabs.nth(this.tabs, Number(c.slice(4))), cx);
    else if (c === "tab_move_left" || c === "tab_move_right") this.stepTab(this.keyTab(), c === "tab_move_right" ? 1 : -1);
    else if (c === "pin_tab") this.togglePin(this.keyTab());
    else if (c === "tab_menu") this.openTabMenu(this.keyTab(), true);
  }

  /** The tab the bar's tab keys act on: the one the ring is on, else the shown one. */
  keyTab(): string {
    const ringed = this.ring?.startsWith("tab:") ? this.ring.slice(4) : null;

    return ringed && this.tabs.list.some((t) => t.id === ringed) ? ringed : this.tabs.active;
  }

  /** Tab `id` to place `index` (Tabs.move), kept for the next start. */
  moveTab(id: string, index: number) {
    const next = Tabs.move(this.tabs, id, index);

    if (next === this.tabs) return;

    this.tabs = next;
    this.saveTabs();
  }

  /** Tab `id` one place left (-1) or right (+1); at the end it stays. */
  stepTab(id: string, by: number) {
    const i = Tabs.indexOf(this.tabs, id);

    if (i < 0 || i + by < 0 || i + by >= this.tabs.list.length) return;

    this.moveTab(id, i + by);
  }

  // ---- dragging a tab along the strip (Tabs.dropIndex)

  /** The pointer moved over a gap with a press down on a tab: past
   *  DRAG_START it's a drag, and the gap it's over is where the marker stands. */
  dragOver(gap: Gap, at: Point, cx: Context) {
    const p = this.pressed;

    if (!p) return;

    if (!this.drag) {
      if (Math.abs(at.x - p.x) < Tabs.DRAG_START) return;

      this.drag = { id: p.id, gap: null };
    }

    if (this.drag.gap?.id === gap.id && this.drag.gap.after === gap.after) return;

    this.drag.gap = gap;
    cx.notify();
  }

  /** The press let go in the strip: a drag drops where its marker stands. */
  dropTab(cx: Context) {
    const d = this.drag;

    this.drag = null;
    this.pressed = null;

    if (!d) return;

    const at = Tabs.dropIndex(this.tabs, d.id, d.gap);

    if (at !== null) this.moveTab(d.id, at);

    cx.notify();
  }

  /** The pointer left the strip: the drag ends where it started. */
  cancelDrag(cx: Context) {
    const dragging = Boolean(this.drag);

    this.drag = null;
    this.pressed = null;

    if (dragging) cx.notify();
  }

  key(e: KeyEvent, cx: Context) {
    this.claim();

    const k = e.keystroke;

    if (k === "cmd-p" || k === "cmd-l") this.command("url");
    else if (k === "escape" && this.editing) this.leaveAddress();
    else if (k === "cmd-r") this.command("reload");
    else if (k === "cmd-[") this.command("back");
    else if (k === "cmd-]") this.command("forward");
    else if (k === "cmd-alt-i") this.command("inspect", cx);
    else if (this.editing || !this.barKey(e, cx)) return;

    cx.stop_propagation();
    cx.notify();
  }

  /** Plain keys while the bar has the keyboard (not the address field, not the page). */
  barKey(e: KeyEvent, cx: Context): boolean {
    const m = e.modifiers;

    if (m.platform || m.control || m.alt) return false;

    const k = keyOf(e);
    const ready = Boolean(this.start && available());
    // ? opens the keys in the page's place, ? esc q close them; meanwhile they take every key (keyhelp.ts).
    const help = keysKey(e, this.keysShown);

    if (help) {
      this.keysShown = help === "toggle" ? !this.keysShown : false;

      return true;
    }

    if (this.keysShown) return true;

    if (k === "tab") {
      const ids = this.controls.filter((c) => c.enabled).map((c) => c.id);
      const i = this.ring === null ? -1 : ids.indexOf(this.ring);

      this.ring = (i < 0 ? ids[m.shift ? ids.length - 1 : 0] : ids[(i + (m.shift ? -1 : 1) + ids.length) % ids.length]) ?? null;
    } else if (k === "enter" && this.ring) {
      const c = this.controls.find((x) => x.id === this.ring && x.enabled);

      if (c) c.action(cx);
      else this.ring = null;
    } else if (k === "escape" && this.ring) this.ring = null;
    else if ((k === "enter" || k === "i") && ready) this.command("web");
    else if (k === "o" || k === "/") this.command("url");
    else if (k === "H") this.command("back");
    else if (k === "L") this.command("forward");
    else if (k === "r" && this.start) this.command("reload");
    else if (k === "+" || k === "=") this.command("zoom_in");
    else if (k === "-") this.command("zoom_out");
    else if (k === "0") this.command("zoom_reset");
    else if (k === "p" && ready && (this.video || this.away)) this.command("pip");
    else if (k === "d" && ready) this.inspector(cx);
    else if (k === "O") this.external();
    else if (k === "t") this.command("tab_new", cx);
    else if (k === "x") this.command("tab_close", cx);
    else if (k === "J") this.command("tab_prev", cx);
    else if (k === "K") this.command("tab_next", cx);
    else if (/^[1-9]$/.test(k)) this.command(`tab:${k}`, cx);
    else if (k === "m") this.command("tab_menu", cx);
    else if (k === "<") this.command("tab_move_left", cx);
    else if (k === ">") this.command("tab_move_right", cx);
    else return false;

    return true;
  }

  /** The inspector pane's keys: enter puts the keyboard into it. */
  inspectorKey(e: KeyEvent, cx: Context) {
    if (keyOf(e) !== "enter" || this.lost) return;

    this.quiet(INSPECTOR, "focus", {});
    cx.stop_propagation();
  }

  /** A bar button for tab / enter, in drawing order; true: the ring is on it. */
  control(id: string, enabled: boolean, action: (cx: Context) => void): boolean {
    this.controls.push({ id, enabled, action });

    return this.ring === id && this.barFocused;
  }

  // ---- parts

  /** A bar button; `focus`: the press goes on to the pane too, which Fireflies then focuses. */
  icon(t: Theme, id: string, name: string, enabled: boolean, action: (cx: Context) => void, focus = false): Element {
    const ringed = this.control(id, enabled, action);

    return div().id(id).relative().size(24).flex_none().flex().items_center().justify_center()
      .text_color(ringed ? t.foreground : enabled ? t.muted : t.ansi0)
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .when(enabled, (el) => el.hover((s) => s.text_color(t.foreground).bg(t.ansi0)))
      .on_mouse_down("left", (e, cx) => (focus ? this.claim() : this.stop(e, cx)))
      .on_click((_e, cx) => {
        if (enabled) {
          this.claim();
          action(cx);
          cx.notify();
        }
      })
      .child(svg(`${ICONS}/${name}.svg`).size(13));
  }

  address(t: Theme): Element {
    if (this.editing && this.input) {
      return div().id("address-edit").flex_1().min_w(0).h(22).px(6).flex().items_center().border(1).border_color(t.accent)
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .child(Input.new(this.input).w_full().text_size(11).text_color(t.foreground));
    }

    const [host, rest] = parts(this.page.href);
    const ringed = this.control("address", true, () => this.edit());

    return h_flex().id("address").relative().flex_1().min_w(0).h(22).px(6).items_center().gap(0).text_size(11)
      .hover((s) => s.bg(`${t.ansi0}66`))
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .on_mouse_down("left", (e, cx) => this.stop(e, cx))
      .on_click((_e, cx) => {
        this.edit();
        cx.notify();
      })
      .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(host || "blank"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(rest));
  }

  bar(t: Theme): Element {
    const p = this.page, loading = p.loading && Boolean(this.start);

    return h_flex().id("bar").relative().h(32).flex_none().px(6).gap(4).items_center()
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.barW) > 1) {
          this.barW = size.width;
          cx.notify();
        }
      })
      .child(this.icon(t, "back", "arrow-left", p.canGoBack, () => this.command("back")))
      .child(this.icon(t, "forward", "arrow-right", p.canGoForward, () => this.command("forward")))
      .child(this.icon(t, "reload", loading ? "x" : "rotate-cw", Boolean(this.start), () => this.command("reload")))
      .child(this.address(t))
      .child(this.icon(t, "zoom-out", "minus", this.zoom > 0.5, () => this.command("zoom_out")))
      .child(div().id("zoom").relative().flex_none().w(34).text_center().text_size(11)
        .text_color(this.control("zoom", true, () => this.command("zoom_reset")) ? t.foreground : t.dim)
        .when(this.ring === "zoom" && this.barFocused, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .on_click((_e, cx) => {
          this.command("zoom_reset");
          cx.notify();
        })
        .child(`${Math.round(this.zoom * 100)}%`))
      .child(this.icon(t, "zoom-in", "plus", this.zoom < 3, () => this.command("zoom_in")))
      // focus: the press focuses this pane first, so the pane hidden for the player is this one.
      .when(Boolean(this.start && available() && (this.video || this.away)), (el) => el.child(this.icon(t, "pip", "picture-in-picture", true, () => this.command("pip"), true)))
      .child(this.icon(t, "inspect", "code", Boolean(this.start && available()), (cx) => this.inspector(cx), true))
      .child(this.icon(t, "external", "external-link", Boolean(this.start && p.href), () => this.external()))
      .child(this.keysButton(t))
      // Loading: a dithered line along the bar's foot, as far as the page has come.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .when(loading, (el) => el.child(div().absolute().left(0).bottom(0).h(2)
        .w(Math.max(8, this.barW * Math.min(1, p.progress || 0.05))).transition("width", 180)
        .child(dither(t.accent, 1))));
  }

  /** What went wrong, under the bar, with "retry" (r too) when a page failed. */
  errorLine(t: Theme): Element {
    const page = Boolean(this.start && available() && this.tab.failed);

    return h_flex().id("error").flex_none().px(10).py(4).gap(10).items_center().text_size(11)
      .child(div().flex_1().min_w(0).text_color(t.blocked).child(this.error ?? ""))
      .when(page, (el) => el.child(div().id("retry").flex_none().px(4).text_color(t.muted)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .on_click((_e, cx) => {
          this.retry();
          cx.notify();
        })
        .child("retry  r")));
  }

  /** ? keys, the bar's last control (keyhelp.ts); tab rings it like the others. */
  keysButton(t: Theme): Element {
    const toggle = () => {
      this.keysShown = !this.keysShown;
    };

    const ringed = this.control("keys", true, toggle);

    return keysHint(t, "keys", this.keysShown || ringed, toggle).relative().h(24).px(4)
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)));
  }

  /** `?`: every key, in the page's place (keyhelp.ts): the page is a native
   *  view, drawn over anything laid on it, so it folds away meanwhile. */
  keysStrip(t: Theme): Element {
    return div().relative().flex_1().min_h(0)
      .child(keysView(t, {
        id: "browser-keys", title: "web", list: KEYS, close: () => {
          this.keysShown = false;
        },
      }));
  }

  blank(t: Theme, title: string, hint: string | null): Element {
    return v_flex().flex_1().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint ?? "")));
  }

  override render() {
    const t = theme();

    if (this.menu) return this.renderMenu(t, this.menu);

    this.controls = [];
    this.barFocused = this.handle?.is_focused() ?? false;

    if (this.inspect) {
      const frame = v_flex().id("inspector").size_full().bg(t.background);

      const root = (this.handle ? frame.track_focus(this.handle) : frame)
        .on_key_down((e, cx) => this.inspectorKey(e, cx));

      if (this.lost) return root.child(this.blank(t, "Nothing to inspect", this.lost));

      return root
        .child(div().flex_1().min_h(0).relative().child(herdr.nativeView.new(INSPECTOR, { kind: "inspector", of: this.inspect })
          .child(this.blank(t, "Opening the inspector…", null))));
    }

    const start = this.start;

    const body = !available() ? this.blank(t, "This Herdr has no native views", "The browser needs the DwieDave/fireflies build (native-view/0).")
      : !start ? this.blank(t, "Nothing open", "Type an address or a search, then Enter.")
      : div().flex_1().min_h(0).relative().child(this.webView(t, this.tab, start));

    // The other tabs' pages stay alive (their video, scroll, forms), out of
    // sight: in no room at all, which hides a native view.
    const shownId = this.tab.id;

    const behind = !available() ? [] : this.tabs.list.flatMap((x) => (x.live && x.start && x.id !== shownId
      ? [div().h(0).flex_none().overflow_hidden().child(this.webView(t, x, x.start))]
      : []));

    const frame = v_flex().id("browser").size_full().bg(t.background);

    return (this.handle ? frame.track_focus(this.handle) : frame)
      .key_context(CONTEXT)
      .on_action(TAB, (_e, cx) => this.key(tabEvent(false), cx))
      .on_action(TAB_BACK, (_e, cx) => this.key(tabEvent(true), cx))
      .on_mouse_down("left", () => this.claim())
      .on_key_down((e, cx) => this.key(e, cx))
      .when(this.tabs.list.length > 1, (el) => el.child(this.strip(t)))
      .child(this.bar(t))
      .when(Boolean(this.error), (el) => el.child(this.errorLine(t)))
      .when(this.keysShown, (el) => el.child(this.keysStrip(t)))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(body) : body)
      .children(behind);
  }

  /** Tab `tab`'s page: a WebKit view of its own (id: the tab's), on `start`. The mod's
   *  children sit under it: seen while it loads, or while a Fireflies menu or
   *  dialog makes the view step aside. `tabs`: what would open a window
   *  comes as web.newTab. */
  webView(t: Theme, tab: Tab, start: string): Element {
    return herdr.nativeView.new(tab.id, { kind: "web", ...Tabs.source(start), persist: true, zoom: tab.zoom, pip: true, tabs: true })
      .child(this.away && tab === this.tab
        ? this.blank(t, "Playing in picture in picture", "↩ in the player brings it back here.")
        : this.blank(t, tab.page.loading ? "Loading…" : "", tab.page.href));
  }

  /** The tabs, over the bar (two or more): number, title, ×, and + at the
   *  end; the shown one bright on a dithered accent line, as the app's tabs.
   *  A click shows a tab, a middle click or × closes it; tab rings them. */
  strip(t: Theme): Element {
    const drag = this.drag;
    const pins = this.ownSlot ? readSharedList(shared, Tabs.PINS_LIST) : null;
    const pinned = (id: string) => pins !== null && Tabs.tabPinned(pins, this.slot, id);
    const stakeAt = drag ? Tabs.stakeBefore(this.tabs, drag.id, Tabs.dropIndex(this.tabs, drag.id, drag.gap)) : undefined;

    const item = (tab: Tab, i: number) => {
      const on = tab.id === this.tabs.active;
      const lifted = drag?.id === tab.id;
      const ringed = this.control(`tab:${tab.id}`, true, (cx) => this.showTab(tab.id, cx));

      return h_flex().id(`webtab-${tab.id}`).relative().flex_1().min_w(0).max_w(200).h_full().pl(8).pr(4).gap(6).items_center()
        .text_size(11).text_color(on || lifted ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        // Dragged: lifted where it is, behind its words.
        .when(lifted, (el) => el.children(lift(t)))
        // A press may become a drag (dragOver); let go without one, it shows the tab.
        .on_mouse_down("left", (e, cx) => {
          this.stop(e, cx);
          this.pressed = { id: tab.id, x: e.position.x };
        })
        .on_mouse_move((e, cx) => this.dragOver(Tabs.gapAt(tab.id, e.local_position.x, e.bounds.width), e.position, cx))
        .on_mouse_up("left", (_e, cx) => {
          if (!this.drag && this.pressed?.id === tab.id) {
            this.claim();
            this.showTab(tab.id, cx);
            cx.notify();
          }
        })
        // Middle click closes it, as in a browser; a right-click opens its menu.
        .on_mouse_down("middle", (_e, cx) => {
          cx.stop_propagation();
          this.claim();
          this.closeTab(tab.id, cx);
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.claim();
          this.openTabMenu(tab.id, false);
        })
        // Pinned to the shelf: a small square in its corner, as the shelf's tiles.
        .when(pinned(tab.id), (el) => el.child(div().absolute().left(2).top(4).size(4).bg(on ? t.foreground : t.muted)))
        .child(div().flex_none().text_color(on || tab.page.loading ? t.accent : t.dim).child(i < 9 ? String(i + 1) : "·"))
        .child(div().flex_1().min_w(0).truncate().child(Tabs.label(tab)))
        .child(div().id(`webtab-x-${tab.id}`).size(16).flex_none().flex().items_center().justify_center().text_color(t.dim)
          .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
          .on_mouse_down("left", (e, cx) => this.stop(e, cx))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.claim();
            this.closeTab(tab.id, cx);
            cx.notify();
          })
          .child(svg(`${ICONS}/x.svg`).size(10)))
        // Loading: its line runs dim; shown: the accent line it stands on.
        .when(on || tab.page.loading, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(2).child(dither(on ? t.accent : t.ansi8, 1))))
        .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .when(stakeAt === tab.id, (el) => el.child(stake(t)));
    };

    const items = this.tabs.list.map(item);
    const plusRinged = this.control("tab-new", true, (cx) => this.openTab(null, {}, cx));
    const end = (at: Point, cx: Context) => this.dragOver({ id: null, after: false }, at, cx);

    return h_flex().id("webtabs").relative().h(26).flex_none().pl(4).pr(6).gap(1).items_center().overflow_hidden()
      .on_mouse_up("left", (_e, cx) => this.dropTab(cx))
      .on_hover((hovered, cx) => {
        if (!hovered) this.cancelDrag(cx);
      })
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      // The horizon the tabs stand on, as the app's tab strip.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .children(items)
      // Past the last tab (+ and the room after it): the gap at the end.
      .child(div().id("webtab-new").relative().size(22).flex_none().flex().items_center().justify_center()
        .on_mouse_move((e, cx) => end(e.position, cx))
        .when(stakeAt === null, (el) => el.child(stake(t)))
        .text_color(plusRinged ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .when(plusRinged, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .on_click((_e, cx) => {
          this.claim();
          this.openTab(null, {}, cx);
          cx.notify();
        })
        .child(svg(`${ICONS}/plus.svg`).size(12)))
      .child(div().id("webtab-end").flex_1().min_w(0).h_full().on_mouse_move((e, cx) => end(e.position, cx)));
  }
}
