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
// favicon (favicons.ts; the web pane's mark until one is cached), title, ×
// (a middle click closes too), + a blank tab. Drag a tab along it to
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
// browser.show for when this pane comes on screen), its mark the tab's favicon
// from shared browser.tab-icons ({ [slot]: { [tab]: "cache/browser-icons/<host>" }};
// browser.icons: { [slot]: the shown tab's }). Closing the tab
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

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import type { InputState } from "gpui-base";
import * as herdr from "herdr";
import { theme, shared, setShared, panes, focused } from "herdr";
import type { PaneInfo, Theme } from "herdr";
import { readShared, writeShared } from "./guard.ts";
import type { KeyRow } from "./keyhelp.ts";
import { keysView, keysKey } from "./keyhelp.ts";
import * as Tabs from "./tabs.ts";
import type { Gap, MenuRow, Page, Tab } from "./tabs.ts";
import { parseEvent, onEvent } from "./page-events.ts";
import type { WebEvent } from "./page-events.ts";
import { openTab, showTab, shownTab, closeTab, stepTab, keyTab } from "./tab-ops.ts";
import { barView, errorLine, blankPage, webView } from "./bar.ts";
import { TITLES, TAB_TITLES, PAGE_ICONS, TAB_ICONS, saveTabs, publishTitle, listIcons, dropSlot } from "./publish.ts";
import { tabPinned, togglePin, takeShow, openTabMenu, tabAct, initMenu, renderMenu } from "./tab-menu.ts";
import { goTo, retry, focusPage, leaveAddress, external, editAddress } from "./address.ts";
import { stripView } from "./strip.ts";
import { INSPECTOR, isInspected, initInspector, toggleInspector, inspectorKey } from "./inspector.ts";
import { unhide } from "./away.ts";
import type { Hidden } from "./away.ts";
import { restoreTabs, addressInput, listen } from "./startup.ts";
import { keyOf, ACTIVE, CONTEXT, TAB, TAB_BACK, tabEvent, browserProps, available } from "./props.ts";
import type { TabMenu, CallArgs, Control } from "./props.ts";

/** A part's own arguments: its function's, after the view. */
type Rest<F> = F extends (view: Browser, ...rest: infer R) => void ? R : never;

// What `?` lists.
// Every key key() and barKey() take (the cmd ones are keys.json's mod:browser), ? keys last.
export const KEYS: readonly KeyRow[] = [["enter i", "into the page"], ["⌘esc", "back to the bar"], ["o /  ⌘l ⌘p", "address"], ["H L  ⌘[ ⌘]", "back / forward"],
  ["r  ⌘r", "reload"], ["+ - 0", "zoom"], ["p", "picture in picture"], ["d  ⌘⌥i", "inspector"], ["O", "system browser"],
  ["t", "new tab"], ["x", "close the tab"], ["J K", "tab left / right"], ["1-9", "tab 1 to 8, 9 the last"],
  ["< >", "move the tab left / right (or drag it)"], ["m", "the tab's menu: pin it to the shelf, move, close"],
  ["tab ⇧tab", "buttons and tabs (⏎ presses)"], ["esc", "out of the address · keys away"], ["?", "keys"]];

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
  // The origins whose favicon is in the cache folder (Favicons.originOf's key), the ones
  // asked for this run (fetched once at most), and the listing of the folder at start.
  icons = new Set<string>();
  iconAsked = new Set<string>();
  iconsListed: Promise<void> = Promise.resolve();
  // Closed: what finishes later (an icon fetched) publishes nothing.
  gone = false;

  override init(p: Props | undefined, cx: AsyncContext) {
    const pr = browserProps(p);

    // A web tab's menu: this mod as a popup (openTabMenu), props { tabMenu }.
    if (pr.tabMenu) {
      initMenu(this, pr.tabMenu, cx);

      return;
    }

    // An inspector pane: Safari's Web Inspector for another pane's page.
    this.inspect = pr.inspect ? String(pr.inspect) : null;

    if (this.inspect) {
      initInspector(this, cx);

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

    restoreTabs(this, pr.url);
    this.publishTitle();
    listIcons(this, cx);
    addressInput(this, cx);
    listen(this, cx);
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

    this.gone = true;

    if (readShared(shared, ACTIVE, null) === this.slot) writeShared(setShared, ACTIVE, null);

    // The pane is gone (or the mod reloads: its first titles come back with init).
    dropSlot(this, TITLES);
    dropSlot(this, TAB_TITLES);
    dropSlot(this, PAGE_ICONS);
    dropSlot(this, TAB_ICONS);
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

  /** A call to the shown tab's view (its answer isn't read); a failure goes to the error line. */
  call(action: string, args?: CallArgs) {
    try {
      herdr.nativeViewCall(this.tab.id, action, args ?? {});
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  command(c: string, cx?: Context) {
    if (c === "keys") this.keysShown = !this.keysShown;
    else if (c === "url") this.edit();
    else if (c === "inspect") {
      if (this.start) this.inspector(cx);
    }
    // Nothing open yet: no page to move (a call would only say there's no view).
    else if ((c === "reload" || c === "back" || c === "forward" || c === "web") && !(this.start && available())) return;
    else if (c === "reload" && this.tab.failed && !this.page.loading) retry(this);
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
    else if (c === "tab_move_left" || c === "tab_move_right") stepTab(this, keyTab(this), c === "tab_move_right" ? 1 : -1);
    else if (c === "pin_tab") this.togglePin(keyTab(this));
    else if (c === "tab_menu") this.openTabMenu(keyTab(this), true);
  }

  key(e: KeyEvent, cx: Context) {
    this.claim();

    const k = e.keystroke;

    if (k === "cmd-p" || k === "cmd-l") this.command("url");
    else if (k === "escape" && this.editing) leaveAddress(this);
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

  /** A bar button for tab / enter, in drawing order; true: the ring is on it. */
  control(id: string, enabled: boolean, action: (cx: Context) => void): boolean {
    this.controls.push({ id, enabled, action });

    return this.ring === id && this.barFocused;
  }

  // ---- parts

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

  /** On the view for its callers and tests: publish.ts saveTabs. */
  saveTabs(...args: Rest<typeof saveTabs>): ReturnType<typeof saveTabs> {
    return saveTabs(this, ...args);
  }

  /** On the view for its callers and tests: publish.ts publishTitle. */
  publishTitle(...args: Rest<typeof publishTitle>): ReturnType<typeof publishTitle> {
    return publishTitle(this, ...args);
  }

  /** On the view for its callers and tests: tab-menu.ts tabPinned. */
  tabPinned(...args: Rest<typeof tabPinned>): ReturnType<typeof tabPinned> {
    return tabPinned(this, ...args);
  }

  /** On the view for its callers and tests: tab-menu.ts togglePin. */
  togglePin(...args: Rest<typeof togglePin>): ReturnType<typeof togglePin> {
    return togglePin(this, ...args);
  }

  /** On the view for its callers and tests: tab-menu.ts takeShow. */
  takeShow(...args: Rest<typeof takeShow>): ReturnType<typeof takeShow> {
    return takeShow(this, ...args);
  }

  /** On the view for its callers and tests: tab-menu.ts openTabMenu. */
  openTabMenu(...args: Rest<typeof openTabMenu>): ReturnType<typeof openTabMenu> {
    return openTabMenu(this, ...args);
  }

  /** On the view for its callers and tests: tab-menu.ts tabAct. */
  tabAct(...args: Rest<typeof tabAct>): ReturnType<typeof tabAct> {
    return tabAct(this, ...args);
  }

  /** On the view for its callers and tests: tab-ops.ts openTab. */
  openTab(...args: Rest<typeof openTab>): ReturnType<typeof openTab> {
    return openTab(this, ...args);
  }

  /** On the view for its callers and tests: tab-ops.ts showTab. */
  showTab(...args: Rest<typeof showTab>): ReturnType<typeof showTab> {
    return showTab(this, ...args);
  }

  /** On the view for its callers and tests: tab-ops.ts shownTab. */
  shown(...args: Rest<typeof shownTab>): ReturnType<typeof shownTab> {
    return shownTab(this, ...args);
  }

  /** On the view for its callers and tests: tab-ops.ts closeTab. */
  closeTab(...args: Rest<typeof closeTab>): ReturnType<typeof closeTab> {
    return closeTab(this, ...args);
  }

  /** On the view for its callers and tests: inspector.ts toggleInspector. */
  inspector(...args: Rest<typeof toggleInspector>): ReturnType<typeof toggleInspector> {
    return toggleInspector(this, ...args);
  }

  /** On the view for its callers and tests: inspector.ts inspectorKey. */
  inspectorKey(...args: Rest<typeof inspectorKey>): ReturnType<typeof inspectorKey> {
    return inspectorKey(this, ...args);
  }

  /** On the view for its callers and tests: away.ts unhide. */
  unhide(...args: Rest<typeof unhide>): ReturnType<typeof unhide> {
    return unhide(this, ...args);
  }

  /** On the view for its callers and tests: page-events.ts onEvent. */
  onEvent(...args: Rest<typeof onEvent>): ReturnType<typeof onEvent> {
    return onEvent(this, ...args);
  }

  /** On the view for its callers and tests: address.ts goTo. */
  go(...args: Rest<typeof goTo>): ReturnType<typeof goTo> {
    return goTo(this, ...args);
  }

  /** On the view for its callers and tests: address.ts focusPage. */
  focusPage(...args: Rest<typeof focusPage>): ReturnType<typeof focusPage> {
    return focusPage(this, ...args);
  }

  /** On the view for its callers and tests: address.ts external. */
  external(...args: Rest<typeof external>): ReturnType<typeof external> {
    return external(this, ...args);
  }

  /** On the view for its callers and tests: address.ts editAddress. */
  edit(...args: Rest<typeof editAddress>): ReturnType<typeof editAddress> {
    return editAddress(this, ...args);
  }

  /** On the view for its callers and tests: bar.ts barView. */
  bar(...args: Rest<typeof barView>): ReturnType<typeof barView> {
    return barView(this, ...args);
  }

  /** On the view for its callers and tests: bar.ts blankPage. */
  blank(...args: Rest<typeof blankPage>): ReturnType<typeof blankPage> {
    return blankPage(this, ...args);
  }

  /** On the view for its callers and tests: strip.ts stripView. */
  strip(...args: Rest<typeof stripView>): ReturnType<typeof stripView> {
    return stripView(this, ...args);
  }

  override render() {
    const t = theme();

    if (this.menu) return renderMenu(this, t, this.menu);

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
      : div().flex_1().min_h(0).relative().child(webView(this, t, this.tab, start));

    // The other tabs' pages stay alive (their video, scroll, forms), out of
    // sight: in no room at all, which hides a native view.
    const shownId = this.tab.id;

    const behind = !available() ? [] : this.tabs.list.flatMap((x) => (x.live && x.start && x.id !== shownId
      ? [div().h(0).flex_none().overflow_hidden().child(webView(this, t, x, x.start))]
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
      .when(Boolean(this.error), (el) => el.child(errorLine(this, t)))
      .when(this.keysShown, (el) => el.child(this.keysStrip(t)))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(body) : body)
      .children(behind);
  }

}
