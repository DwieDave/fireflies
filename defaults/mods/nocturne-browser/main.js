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
//            the page's video in the nocturne-pip player, a Fireflies window over
//            every tab and space (command nocturne-browser.pip); the page goes
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
// Tabs (tabs.js has the rules): one pane, several pages, each its own web view
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
// A pinned tab (nocturne's PANES_KEY record with `tab`, tabs.js has the rules)
// is its own tile on the shelf, named from shared nocturne-browser.tab-titles
// ({ [slot]: { [tab]: title } }); the tile sends show:<{ slot, tab }> (or leaves
// nocturne-browser.show for when this pane comes on screen). Closing the tab
// drops its pin; it keeps it across restarts (tab ids are kept).
// A file:// address (an HTML file from the files pane) loads as the file
// (props path, trust "interactive": its folder readable, scripts on).
//
// Several can be open, in one tab or many: each pane is its own mod copy
// (its own view, events and localStorage, when its props carry a `slot`).
// `nocturne-browser.<cmd>` reaches every shown copy, so only one acts on it:
// the focused pane's (found by its `slot`; an inspector pane's is its page's),
// else the one last focused or clicked (a command from the palette or an agent).
//
// Where the keys go (keys.json's mod:nocturne-browser applies while GPUI's
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
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, nextCommand, shared, setShared, run, panes, spaces, focused, openOverlay, closeOverlay, window as appWindow } from "herdr";
import { keysHint, keysView, keysKey } from "./keyhelp.js";
import * as Tabs from "./tabs.js";

const ICONS = "mods/nocturne-browser/icons";
const SEARCH = "https://duckduckgo.com/?q=";
// What `?` lists.
// Every key key() and barKey() take (the cmd ones are keys.json's mod:nocturne-browser), ? keys last.
export const KEYS = [["enter i", "into the page"], ["⌘esc", "back to the bar"], ["o /  ⌘l ⌘p", "address"], ["H L  ⌘[ ⌘]", "back / forward"],
  ["r  ⌘r", "reload"], ["+ - 0", "zoom"], ["p", "picture in picture"], ["d  ⌘⌥i", "inspector"], ["O", "system browser"],
  ["t", "new tab"], ["x", "close the tab"], ["J K", "tab left / right"], ["1-9", "tab 1 to 8, 9 the last"],
  ["< >", "move the tab left / right (or drag it)"], ["m", "the tab's menu: pin it to the shelf, move, close"],
  ["tab ⇧tab", "buttons and tabs (⏎ presses)"], ["esc", "out of the address · keys away"], ["?", "keys"]];
/** A key's name: the typed character for printable keys ("H", "?", "+"), else GPUI's key. */
const keyOf = (e) => (typeof e?.key_char === "string" && e.key_char.length === 1 && e.key_char.trim() ? e.key_char : String(e?.key ?? ""));
// The copy that last had the keyboard or a click: it takes broadcast commands
// while no web pane is focused.
const ACTIVE = "nocturne-browser.active";
// Tab and shift-tab, bound in the browser's own key context (see the top).
const CONTEXT = "NocturneBrowser", TAB = "nocturne_browser::tab", TAB_BACK = "nocturne_browser::tab_back";
/** The key event a bound tab stands for. */
const tabEvent = (shift) => ({ key: "tab", keystroke: shift ? "shift-tab" : "tab", key_char: null, modifiers: { shift, control: false, alt: false, platform: false, function: false } });
// What each web pane shows, for the dock's shelf: { [props.slot]: the shown
// tab's page title (else its host) }, as the viewers keep theirs.
const TITLES = "nocturne-browser.titles";
// Every tab's name, for a tab pinned to the shelf: { [props.slot]: { [tab id]: title } }.
const TAB_TITLES = "nocturne-browser.tab-titles";
// A tab to show once this pane is on screen (nocturne's goToPin): { slot, tab, at }.
const SHOW = "nocturne-browser.show";
// How long such a wish holds (ms): long enough for a tab or space switch.
const SHOW_FOR = 5000;
// The tab's menu: a row's height, the rule between its sections.
const MENU_ROW = 26, MENU_RULE = 9, MENU_W = 250;
// The open inspector panes: { [web view key]: pane id }, one per page.
const INSPECTORS = "nocturne-browser.inspectors";
const INSPECTOR = "inspector";
// The picture in picture player: one window, whichever page's video it shows.
// The picture in picture player window (as nocturne-pip opens it): 16:9 under its bar, resizable.
const PLAYER = { mod: "nocturne-pip", kind: "window", key: "nocturne-pip", frame: "none", width: 384, height: 238,
  resizable: { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] } };
// The pane the player put the video in (nocturne-pip): { of, pane, park }.
const PIP_PANE = "nocturne-pip.pane";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1, dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** The drop marker of a tab drag, as the app's strip (nocturne/tabdrag.js):
 *  a 2 px accent bar capped top and bottom, at the left edge of its box. */
function stake(t) {
  return div().absolute().left(-3).top(3).bottom(2).w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The dragged tab's lift, behind its words: a dither shadow, then a plate
 *  edged in the accent, clear of the horizon. */
function lift(t) {
  return [
    div().absolute().left(5).right(0).top(6).bottom(2).child(dither(t.ansi0, 1)),
    div().absolute().left(2).right(3).top(3).bottom(4).bg(t.background).border(1).border_color(t.accent),
  ];
}

const available = () => typeof herdr.nativeView?.new === "function";

/** What was typed, as a URL: an address as is (https added), anything else searched. */
function target(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  const hostish = !/\s/.test(s) && (/^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) || /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s));
  return hostish ? s : SEARCH + encodeURIComponent(s);
}

/** A load.error in words a person reads, or null when nothing failed: a load
 *  cut short (NSURLErrorDomain -999: the next navigation replaced it, a
 *  redirect, a click while loading; WebKitErrorDomain 102: a download, or a
 *  tab opened instead; 204: a plug-in took it). `url`: the address to retry
 *  (the one that failed, not the page still shown). */
export function loadFailure(d) {
  const code = Number(d?.code), domain = d?.domain ?? null;
  const url = typeof d?.failingUrl === "string" && d.failingUrl ? d.failingUrl : null;
  const web = domain === "WebKitErrorDomain" || (domain == null && code === 102);
  if ((domain === "NSURLErrorDomain" || domain == null) && code === -999) return null;
  if (web && (code === 102 || code === 204)) return null;
  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url ?? d?.href ?? "")?.[1]?.replace(/^www\./, "") ?? "The site";
  const words = domain === "NSURLErrorDomain" || domain == null ? {
    [-1009]: "You're offline.",
    [-1020]: "No network may be used for this.",
    [-1003]: `Can't find ${host}: no such site, or no name server.`,
    [-1004]: `${host} doesn't answer.`,
    [-1001]: `${host} took too long to answer.`,
    [-1005]: "The connection went down.",
    [-1007]: `${host} redirects in a loop.`,
    [-1011]: `${host} answered something unreadable.`,
    [-1202]: `${host}'s certificate isn't trusted.`,
    [-1201]: `${host}'s certificate has expired or isn't valid yet.`,
    [-1200]: `A secure connection to ${host} failed.`,
    [-1206]: `${host} wants a client certificate.`,
    [-1022]: `${host} has to be opened over https.`,
    [-1002]: "This kind of address can't open here.",
    [-1100]: "There's no such file.",
    [-1102]: "That file can't be read.",
  }[code] : web && (code === 100 || code === 101) ? "This page can't be shown here: ↗ opens it in the system's browser." : null;
  const said = String(d?.message ?? "").trim();
  // WebKit's generic "The operation couldn't be completed. (… error N.)" says nothing.
  const vague = !said || /couldn.t be completed|NSURLErrorDomain|WebKitErrorDomain/i.test(said);
  const message = words ?? (vague ? `The page didn't load${Number.isFinite(code) ? ` (error ${code})` : ""}.` : said);
  return { message, url };
}

/** An address split for the bar: host, then the rest. */
function parts(href) {
  const m = /^[a-z]+:\/\/([^/?#]+)(.*)$/i.exec(href ?? "");
  return m ? [m[1].replace(/^www\./, ""), m[2] === "/" ? "" : m[2]] : [href ?? "", ""];
}

export default class Browser extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    // A web tab's menu: this mod as a popup (openTabMenu), props { tabMenu }.
    if (pr.tabMenu) return this.initMenu(pr.tabMenu, cx);
    // An inspector pane: Safari's Web Inspector for another pane's page.
    this.inspect = pr.inspect ? String(pr.inspect) : null;
    if (this.inspect) {
      this.lost = null;
      // pane.go gives it the keyboard; enter puts it into the inspector, cmd+esc takes it out.
      this.handle = cx.focus_handle();
      if (available()) {
        cx.spawn(async (cx) => {
          for (;;) {
            let e;
            try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
            if (e.event === "load.error") { this.lost = e.data?.message ?? "Nothing to inspect."; cx.notify(); }
            if (e.event === "view.escapeKey") this.handle.focus();
          }
        });
      }
      cx.spawn(async (cx) => {
        for (;;) {
          const c = String(await nextCommand()).replace(/^nocturne-browser\./, "");
          if (c === "focus") this.handle.focus();
          cx.notify();
        }
      });
      return;
    }
    // A slot from the props names this copy's pane too (panes() carries its props).
    this.ownSlot = Boolean(pr.slot);
    this.slot = pr.slot ? String(pr.slot) : Math.random().toString(36).slice(2);
    if (!Browser.bound) {
      try {
        cx.bind_keys([{ keystroke: "tab", action: TAB, context: CONTEXT }, { keystroke: "shift-tab", action: TAB_BACK, context: CONTEXT }]);
        Browser.bound = true;
      } catch { /* key() still takes a tab that reaches it */ }
    }
    let saved = null, savedTabs = null, zoom = 0.9;
    try {
      saved = localStorage.getItem("url");
      savedTabs = localStorage.getItem("tabs");
      // Page zoom, per tab: a step under the UI's size by default.
      zoom = Number(localStorage.getItem("zoom")) || 0.9;
    } catch {}
    // The tabs (tabs.js), each its own web view: the ones saved, else one on
    // the props' page, else the page this pane had before it kept tabs. A
    // tab's view is created on its `start`; later pages go through navigate
    // calls (new props would rebuild the view).
    this.tabs = (savedTabs && Tabs.restore(savedTabs, zoom)) || Tabs.single(pr.url ? target(pr.url) : saved, zoom);
    this.publishTitle();
    this.barW = 600;
    // A left press on a tab ({ id, x }), and the drag it became ({ id, gap }: Tabs.dropIndex).
    this.pressed = null;
    this.drag = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "address or search" });
    this.input.on("submit", (_e, cx) => { this.go(this.input.value(), cx); });
    this.input.on("blur", (_e, cx) => { if (this.start) { this.editing = false; cx.notify(); } });
    this.editing = !this.start;
    if (this.editing) cx.timer.after(150, () => this.input.focus());
    // Opened as the focused pane (a link beside a terminal): the bar takes the keyboard.
    else for (const ms of [0, 120, 400]) cx.timer.after(ms, () => { if (this.ownSlot && this.isFocusedPane() && !this.handle.is_focused?.() && !this.editing) { this.claim(); this.handle.focus(); } });
    // The tabs shown lately (newest last, `{ space, tab }`): picture in picture
    // puts this tab away and shows the one before. Polled gently: a mod isn't
    // told when another tab shows.
    this.seen = [];
    cx.timer.every(500, () => { this.noteShown(); this.takeShow(cx); });
    if (available()) {
      cx.spawn(async (cx) => {
        for (;;) {
          let e;
          try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
          this.onEvent(e, cx);
          cx.notify();
        }
      });
    }
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-browser\./, "");
        // "focus" comes to this copy alone (pane.go); the rest to every shown copy.
        // Sent too on a press into the page (it keeps AppKit's keyboard) and when
        // the window focuses this pane any other way (a tab switch, agent.next).
        // A blank pane: the address field it types into keeps the keyboard.
        if (c === "focus") { this.takeShow(cx); this.claim(); if (this.editing && !this.start) this.input.focus(); else this.handle.focus(); }
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

  // The shown tab, and its page, address, zoom, … as the bar acts on them.
  get tab() { this.tabs ??= Tabs.single(null, 0.9); return Tabs.activeTab(this.tabs); }
  get start() { return this.tab.start; }
  set start(v) { this.tab.start = v; }
  get page() { return this.tab.page; }
  set page(v) { this.tab.page = v; }
  get error() { return this.tab.error; }
  set error(v) { this.tab.error = v; }
  /** The page has a <video> (event web.video): ⧉ shows only then. */
  get video() { return this.tab.video; }
  set video(v) { this.tab.video = v; }
  get zoom() { return this.tab.zoom; }
  set zoom(v) { this.tab.zoom = v; }

  /** A call to tab `id`'s view that may find none (a tab not loaded yet). */
  quiet(id, action, args) {
    if (!available()) return null;
    try { return herdr.nativeViewCall(id, action, args ?? {}); } catch { return null; }
  }

  /** The tabs, kept for the next start (and the shown page, as before tabs). */
  saveTabs() {
    try {
      localStorage.setItem("tabs", Tabs.save(this.tabs));
      if (this.page.href) localStorage.setItem("url", this.page.href);
    } catch {}
    this.publishTitle();
  }

  /** The shown tab's name in shared TITLES under this pane's slot (a blank
   *  tab: none, the shelf says the host or "Web"); slots of panes that are
   *  gone go. Written only when something changed. */
  publishTitle() {
    if (!this.ownSlot || this.inspect) return;
    const live = new Set(panes().filter((p) => p.mod === "nocturne-browser").map((p) => p.props?.slot).filter((x) => x != null).map(String));
    this.publishTabTitles(live);
    const was = shared(TITLES) ?? {};
    const name = this.page.href || this.page.title ? Tabs.label(this.tab) : null;
    const stale = Object.keys(was).some((k) => !live.has(k) && k !== this.slot);
    if ((was[this.slot] ?? null) === name && !stale) return;
    const next = Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k) && k !== this.slot));
    if (name) next[this.slot] = name;
    setShared(TITLES, next);
  }

  /** Every tab's name in shared TAB_TITLES under this pane's slot (a tab
   *  pinned to the shelf is named by it); gone panes' entries go. Written
   *  only when something changed. */
  publishTabTitles(live) {
    const was = shared(TAB_TITLES) ?? {};
    const mine = Tabs.tabTitles(this.tabs);
    const same = JSON.stringify(was[this.slot] ?? {}) === JSON.stringify(mine);
    const stale = Object.keys(was).some((k) => !live.has(k) && k !== this.slot);
    if (same && !stale) return;
    const next = Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k) && k !== this.slot));
    if (Object.keys(mine).length) next[this.slot] = mine;
    setShared(TAB_TITLES, next);
  }

  // ---- a tab pinned to the shelf (Tabs.pinTab; nocturne's shelf draws it)

  /** Tab `id` is pinned to the shelf. */
  tabPinned(id) { return this.ownSlot && Tabs.tabPinned(shared(Tabs.PINS), this.slot, id); }

  /** This pane can pin a tab: it has a slot (the shelf finds it again by it) and is found. */
  canPin() { return Boolean(this.ownSlot && this.ownPane()); }

  /** Pins tab `id` to the shelf, or unpins it. */
  togglePin(id) {
    const me = this.ownSlot ? this.ownPane() : null;
    if (!me || !this.tabs.list.some((t) => t.id === id)) return;
    setShared(Tabs.PINS, Tabs.pinTab(shared(Tabs.PINS), me, id, !this.tabPinned(id), Date.now()));
  }

  /** `show:{ slot, tab }` (a tab's tile on the shelf): the pane with that slot shows it. */
  showCommand(value, cx) {
    const a = Tabs.showArgs(value);
    if (!a || !this.ownSlot || a.slot !== this.slot) return;
    const w = shared(SHOW);
    if (w?.slot === this.slot) setShared(SHOW, null);
    this.showTab(a.tab, cx);
    this.claim();
  }

  /** A tab the shelf asked for while this pane wasn't on screen (SHOW): shown now. */
  takeShow(cx) {
    const w = shared(SHOW);
    if (!w || !this.ownSlot || String(w.slot) !== this.slot) return;
    setShared(SHOW, null);
    if (Date.now() - Number(w.at) <= SHOW_FOR) this.showTab(w.tab, cx);
  }

  // ---- the tab's menu: this mod as a popup (props { tabMenu })

  /** Opens tab `id`'s menu: at the pointer (a right-click), or in the middle
   *  from the keyboard (`keyboard`: m in the bar), as Nocturne's menus open. */
  openTabMenu(id, keyboard) {
    const index = Tabs.indexOf(this.tabs, id);
    if (index < 0) return;
    const tab = this.tabs.list[index];
    const menu = { slot: this.ownSlot ? this.slot : null, tab: id, title: Tabs.label(tab), pinned: Boolean(this.tabPinned(id)),
      canPin: this.canPin(), index, count: this.tabs.list.length };
    const rows = Tabs.menuRows(menu);
    const height = rows.flat().length * MENU_ROW + (rows.length - 1) * MENU_RULE + MENU_ROW + 10;
    openOverlay({ mod: "nocturne-browser", kind: keyboard ? "dialog" : "popup", frame: "none", width: MENU_W, height, props: { tabMenu: menu } });
  }

  /** `tab_act:{ slot, tab, act }`: a pick in a tab's menu, for the pane it names. */
  tabAct(value, cx) {
    let a;
    try { a = JSON.parse(value); } catch { return; }
    if (!a || typeof a.tab !== "string" || !(a.slot != null ? this.ownSlot && String(a.slot) === this.slot : this.mine())) return;
    if (!this.tabs.list.some((t) => t.id === a.tab)) return;
    this.claim();
    if (a.act === "pin") this.togglePin(a.tab);
    else if (a.act === "left" || a.act === "right") this.stepTab(a.tab, a.act === "right" ? 1 : -1);
    else if (a.act === "close") this.closeTab(a.tab, cx);
    else if (a.act === "show") this.showTab(a.tab, cx);
  }

  initMenu(menu, cx) {
    this.menu = menu;
    this.rows = Tabs.menuRows(menu).flat();
    this.cursor = Tabs.menuStep(this.rows, -1, 1);
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(120, () => this.handle.focus());
  }

  /** A row picked: to the pane (its copy acts), and the menu goes. */
  pickRow(row) {
    if (!row?.enabled) return;
    closeOverlay(props()?.overlay);
    run(`nocturne-browser.tab_act:${JSON.stringify({ slot: this.menu.slot, tab: this.menu.tab, act: row.act })}`);
  }

  /** The menu's keys: ↑ ↓ j k move (over the rows that can be picked), enter picks, esc q close. */
  menuKey(e, cx) {
    const k = keyOf(e);
    if (k === "down" || k === "j" || k === "up" || k === "k") this.cursor = Tabs.menuStep(this.rows, this.cursor, k === "down" || k === "j" ? 1 : -1);
    else if (k === "enter") this.pickRow(this.rows[this.cursor]);
    else if (k === "escape" || k === "q") closeOverlay(props()?.overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** The menu: the tab's name, then its rows in sections, a dithered rule between. */
  renderMenu(t) {
    const sections = Tabs.menuRows(this.menu);
    let n = 0;
    const row = (r) => {
      const i = n++, on = i === this.cursor && r.enabled;
      return h_flex().id(`tm-${r.act}`).relative().h(MENU_ROW).flex_none().px(12).items_center().text_size(12)
        .text_color(!r.enabled ? t.ansi8 : on ? t.foreground : t.muted)
        .on_hover((h, cx) => { if (h && r.enabled && this.cursor !== i) { this.cursor = i; cx.notify(); } })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.pickRow(r))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().flex_1().min_w(0).truncate().child(r.name));
    };
    return v_flex().id("tab-menu").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.menuKey(e, cx))
      .on_scroll_wheel((e, cx) => { if (Math.abs(e?.delta?.y ?? 0) >= 1) { this.cursor = Tabs.menuStep(this.rows, this.cursor, e.delta.y > 0 ? -1 : 1); cx.notify(); } })
      .child(div().h(MENU_ROW).flex_none().px(12).flex().items_center().text_size(11).text_color(t.dim).truncate().child(this.menu.title ?? "tab"))
      .children(sections.flatMap((part, k) => [
        ...(k ? [div().relative().h(MENU_RULE).flex_none().mx(12).child(div().absolute().left(0).right(0).top(4).h(1).child(dither(t.ansi8, 1)))] : []),
        ...part.map(row),
      ]));
  }

  /** A new tab on `url` (null: blank, its address open). In front unless
   *  `background`; `opener`: the tab whose link opened it. */
  openTab(url, { background = false, opener = null } = {}, cx) {
    const before = this.tabs.active;
    const [next, tab] = Tabs.open(this.tabs, url, { background, opener });
    this.tabs = next;
    if (background) this.saveTabs();
    else this.shown(before, cx);
    return tab;
  }

  /** Shows tab `id` (a click, a key, a command). */
  showTab(id, cx) {
    // A tab closed under the click (its ×): nothing to show.
    if (!id || id === this.tabs.active || !this.tabs.list.some((t) => t.id === id)) return;
    const before = this.tabs.active;
    this.tabs = Tabs.show(this.tabs, id);
    this.shown(before, cx);
  }

  /** After another tab came to the front: the one before steps aside, the
   *  address follows (a blank tab: its field takes the keyboard). */
  shown(before, cx) {
    if (before) this.quiet(before, "setVisible", { visible: false });
    this.tab.live = true;
    this.quiet(this.tab.id, "setVisible", { visible: true });
    this.editing = !this.start;
    if (this.editing) { this.input?.set_value(""); cx?.timer?.after(50, () => this.input.focus()); }
    this.saveTabs();
  }

  /** Closes tab `id` (the shown one by default): its view goes, and its
   *  inspector pane. The last tab leaves a blank one: the pane stays. */
  closeTab(id, cx) {
    const tab = this.tabs.list.find((t) => t.id === (id ?? this.tabs.active));
    if (!tab) return;
    const of = tab.of ?? null;
    const pane = of ? this.inspectorPane(of) : null;
    if (pane) run("pane.close", { pane });
    if (tab.live) this.quiet(tab.id, "dispose");
    // Its pin on the shelf goes with it.
    const pins = this.ownSlot ? Tabs.dropTabPins(shared(Tabs.PINS), this.slot, tab.id) : null;
    if (pins) setShared(Tabs.PINS, pins);
    const was = this.tabs.active;
    [this.tabs] = Tabs.close(this.tabs, tab.id);
    if (this.tabs.active !== was) this.shown(null, cx);
    else this.saveTabs();
  }

  /** `nocturne-browser.open:<{ url, slot? } or a URL>`: the page in a new tab
   *  in front, and this pane takes the keyboard (the editor's links). */
  openCommand(value, cx) {
    const a = Tabs.openArgs(value);
    if (!a || !(a.slot != null ? a.slot === this.slot : this.mine())) return;
    const url = target(a.url);
    if (!url) return;
    this.openTab(url, {}, cx);
    this.claim();
    const me = this.ownPane();
    if (me && focused()?.pane !== me.pane) run("pane.focus", { pane: me.pane });
    this.handle?.focus();
    // Its view comes with the next frame.
    cx?.timer?.after(300, () => this.focusPage());
  }

  /** A click on the bar: this copy's, and not the pane's below. */
  stop(_e, cx) { this.claim(); cx.stop_propagation(); }

  /** This copy takes the broadcast commands from now on. */
  claim() {
    if (shared(ACTIVE) !== this.slot) setShared(ACTIVE, this.slot);
  }

  /** Whether a broadcast command is this copy's: the focused pane's page, else
   *  the copy last focused or clicked (focused: a terminal, the palette's caller). */
  mine() {
    const f = focused()?.pane;
    const pane = f ? panes().find((x) => x.pane === f && x.mod === "nocturne-browser") : null;
    if (pane?.props?.inspect != null) return this.tabs.list.some((t) => this.keyOf(t) === String(pane.props.inspect));
    if (pane?.props?.slot != null) return String(pane.props.slot) === this.slot;
    // A web pane without a slot: not one of the panes that have theirs.
    if (pane && this.ownSlot) return false;
    const a = shared(ACTIVE);
    return a == null || a === this.slot;
  }

  /** Tab `t`'s web view key (an inspector pane's props name it), once it has one. */
  keyOf(t) {
    if (t.of || !t.start || !t.live || !available()) return t.of ?? null;
    try { t.of = herdr.nativeViewCall(t.id, "web.inspect", {})?.of ?? null; } catch { t.of = null; }
    return t.of;
  }

  /** This copy's pane is the window's focused one. */
  isFocusedPane() {
    const mine = this.ownPane();
    return Boolean(mine && focused()?.pane === mine.pane);
  }

  async close() {
    if (this.inspect || this.menu) return;
    if (shared(ACTIVE) === this.slot) setShared(ACTIVE, null);
    // The pane is gone (or the mod reloads: its first titles come back with init).
    for (const key of [TITLES, TAB_TITLES]) {
      const titles = shared(key) ?? {};
      if (this.ownSlot && this.slot in titles) { const { [this.slot]: _gone, ...rest } = titles; setShared(key, rest); }
    }
  }

  /** The page's inspector pane, if one is open. */
  inspectorPane(of) {
    const pane = (shared(INSPECTORS) ?? {})[of];
    return pane && panes().some((x) => x.pane === pane) ? pane : null;
  }

  /** The page's inspector in a split beside this pane, or closes it (the </> button). */
  inspector(cx) {
    const r = this.call("web.inspect");
    if (!r?.of) return;
    const pane = this.inspectorPane(r.of);
    if (!pane) return this.openInspector(r.of, cx);
    const open = { ...(shared(INSPECTORS) ?? {}) };
    delete open[r.of];
    setShared(INSPECTORS, open);
    run("pane.close", { pane });
  }

  /** This copy's pane, as well as a mod can tell (it isn't told its pane id):
   *  the focused browser pane (a click on the bar focuses it), else the only
   *  browser in the shown tab. */
  ownPane() {
    const all = panes().filter((x) => x.mod === "nocturne-browser" && x.props?.inspect == null);
    if (this.ownSlot) return all.find((x) => String(x.props?.slot) === this.slot) ?? null;
    const focused = all.find((x) => x.focused);
    if (focused) return focused;
    const tab = panes().find((x) => x.focused)?.tab;
    const here = all.filter((x) => x.tab === tab);
    return here.length === 1 ? here[0] : null;
  }

  /** Opens an inspector pane for the web view `of`, beside this pane. */
  openInspector(of, cx) {
    if (this.inspectorPane(of)) return;
    const mine = this.ownPane();
    const before = new Set(panes().map((x) => x.pane));
    run("pane.split", { direction: this.barW > 1100 ? "right" : "down", ...(mine ? { pane: mine.pane } : {}), mod: "nocturne-browser", props: { inspect: of } });
    // Remember the new pane, to close it from here again.
    const note = (tries) => {
      const made = panes().find((x) => !before.has(x.pane) && x.mod === "nocturne-browser");
      if (made) setShared(INSPECTORS, { ...(shared(INSPECTORS) ?? {}), [of]: made.pane });
      else if (tries > 0) cx.timer.after(100, () => note(tries - 1));
    };
    note(10);
  }

  onEvent(e, cx) {
    const d = e.data ?? {};
    // Each tab's view says its id; a closed tab's last words go nowhere.
    const tab = e.id == null ? this.tab : this.tabs.list.find((t) => t.id === e.id);
    if (!tab) return;
    // A new window, a middle or Cmd click, the link menu (native view `tabs: true`).
    if (e.event === "web.newTab" && d.url) this.openTab(d.url, { background: Boolean(d.background), opener: tab.id }, cx);
    if (e.event === "web.newTab" && d.url && !d.background) cx?.timer?.after(300, () => this.focusPage());
    if (e.event === "view.click") this.claim();
    // cmd+esc in the page: the keyboard is the bar's again.
    if (e.event === "view.escapeKey") { this.claim(); this.handle.focus(); }
    // Right-click "Inspect Element": WebKit opened the inspector; give it its pane.
    if (e.event === "web.inspector" && d.of) this.openInspector(d.of, cx);
    // ⌥⌘I while the page has the keyboard (it never reaches Fireflies' keys).
    if (e.event === "web.inspectKey") this.inspector(cx);
    // ⌘R while the page has the keyboard: reload (or stop, while it loads).
    if (e.event === "web.reloadKey") this.command("reload");
    // web.location: the address changed without a load too (links in
    // single-page apps, pushState, #fragments, back/forward within a page).
    if ((e.event?.startsWith("load.") && e.event !== "load.error") || e.event === "web.location") {
      tab.page = { ...tab.page, ...d, href: d.href ?? d.url ?? tab.page.href };
      // The next page: the last one's error line goes.
      if (e.event === "load.start" || e.event === "load.commit") { tab.error = null; tab.failed = null; }
      if ((e.event === "load.finish" || e.event === "web.location") && tab.page.href) this.saveTabs();
    }
    // ⧉ shows while the page has a <video> (it comes and goes with the page).
    if (e.event === "web.video") tab.video = Boolean(d.present);
    // A load cut short (another page, a download, a tab instead) isn't one.
    if (e.event === "load.error") {
      tab.page = { ...tab.page, loading: false };
      const f = loadFailure(d);
      if (f) { tab.error = f.message; tab.failed = { url: f.url }; }
    }
    // The page's video goes to the player (⧉), or comes back into Fireflies from
    // its popped-out window: the player shows it. Meanwhile the page is away.
    // From the window out of Fireflies' ◧ / ⤓, `then`: the player goes on into a pane or a chip.
    if ((e.event === "pip.enter" || e.event === "pip.popIn") && d.of) openOverlay({ ...PLAYER, props: { of: d.of, ...(d.then ? { then: d.then } : {}) } });
    if (e.event === "pip.enter") { this.away = true; this.pipOf = d.of; this.hide(); }
    if (e.event === "pip.leave") { this.away = false; this.unhide(true); }
    // The video went into a pane (not a parked chip): the page shows again.
    if (e.event === "pip.moved") {
      cx.timer.after(400, () => {
        const n = shared(PIP_PANE);
        if (n?.of === this.pipOf && !n.park && panes().some((x) => x.pane === n.pane)) this.unhide(false);
      });
    }
    if (e.event === "pip.start" && d.result === "none") this.error = "No video on this page.";
    if (e.event === "pip.start" && d.error) this.error = `Picture in picture: ${d.error}`;
  }

  /** A call to the shown tab's view. */
  call(action, args) {
    try { return herdr.nativeViewCall(this.tab.id, action, args ?? {}); } catch (err) { this.error = String(err?.message ?? err); return null; }
  }

  noteShown() {
    const f = focused();
    if (!f?.tab || this.seen.at(-1)?.tab === f.tab) return;
    this.seen = [...this.seen.filter((x) => x.tab !== f.tab), { space: f.space, tab: f.tab }].slice(-8);
  }

  /** Where to go when tab `away` (of space `space`) is put away: the tab shown
   *  before it, else its neighbor; the only tab of its space: the space shown
   *  before (its tab), else another space. Null: nowhere else to go. */
  elsewhere(away, space) {
    const all = spaces();
    const tabOf = (id) => all.flatMap((s) => (s.tabs ?? []).map((c) => ({ ...c, space: s.id }))).find((c) => c.id === id);
    const open = (c) => c && c.id !== away && !c.settled;
    const here = all.find((s) => s.id === space)?.tabs ?? [];
    const before = [...this.seen].reverse().map((x) => tabOf(x.tab)).filter(open);
    const sameSpace = before.find((c) => c.space === space);
    if (sameSpace) return sameSpace.id;
    const i = here.findIndex((c) => c.id === away);
    const near = [...here.slice(i + 1), ...here.slice(0, Math.max(0, i)).reverse()].find(open);
    if (near) return near.id;
    if (before[0]) return before[0].id;
    const other = all.find((s) => s.id !== space && (s.tabs ?? []).some(open));
    return other ? ((other.tabs ?? []).find((c) => c.active && open(c)) ?? (other.tabs ?? []).find(open)).id : null;
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
    const space = spaces().find((s) => (s.tabs ?? []).some((c) => c.id === me.tab));
    const tab = space?.tabs.find((c) => c.id === me.tab);
    if (!tab || tab.settled) return;
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
  unhide(show) {
    const h = this.hidden;
    this.hidden = null;
    if (h?.pane && panes().find((x) => x.pane === h.pane)?.parked) run("pane.unpark", { pane: h.pane });
    if (!h?.tab) return;
    const tab = spaces().flatMap((s) => s.tabs ?? []).find((c) => c.id === h.tab);
    if (!tab) return;
    // tab.select shows it and takes it out of the settled ones.
    if (show) run("tab.select", { id: h.tab });
    else if (tab.settled) run("tab.unsettle", { id: h.tab });
  }

  go(text, cx) {
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
    if (first) cx?.timer?.after(300, () => this.focusPage());
    else this.focusPage();
    cx?.notify();
  }

  /** After a failed load: that address again (the page shown may be the one
   *  before it), else the page. */
  retry() {
    const url = this.tab.failed?.url;
    this.error = null;
    this.tab.failed = null;
    if (url) { this.call("browser.navigate", { url }); this.page = { ...this.page, loading: true, progress: 0.05 }; }
    else this.call("browser.reload");
  }

  /** The page takes AppKit's keyboard (quietly: no view yet is no error). */
  focusPage() {
    if (!this.start || !available()) return;
    try { herdr.nativeViewCall(this.tab.id, "focus", {}); } catch {}
  }

  /** Out of the address field without going: the page has the keyboard
   *  again (a blank pane: the bar), the mod GPUI's. */
  leaveAddress() {
    this.editing = false;
    this.handle?.focus();
    this.focusPage();
  }

  /** The page in the system's default browser. */
  external(cx) {
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
    this.input.set_value(href);
    // The whole address selected, as a browser's: typing replaces it.
    if (href) this.input.set_selected_range({ start: 0, end: href.length });
    this.input.focus();
  }

  command(c, cx) {
    if (c === "keys") this.keysShown = !this.keysShown;
    else if (c === "url") this.edit();
    else if (c === "inspect") { if (this.start) this.inspector(cx); }
    // Nothing open yet: no page to move (a call would only say there's no view).
    else if ((c === "reload" || c === "back" || c === "forward" || c === "web") && !(this.start && available())) return;
    else if (c === "reload" && this.tab.failed && !this.page.loading) this.retry();
    else if (c === "reload") this.call(this.page.loading ? "browser.stop" : "browser.reload");
    else if (c === "back") this.call("browser.back");
    else if (c === "forward") this.call("browser.forward");
    else if (c === "web") { this.ring = null; this.call("focus"); }
    else if (c === "pip") { if (this.start) this.call("web.pip"); }
    else if (c === "zoom_in" || c === "zoom_out" || c === "zoom_reset") {
      const z = c === "zoom_reset" ? 0.9 : this.zoom + (c === "zoom_in" ? 0.1 : -0.1);
      this.zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 10) / 10;
      // The zoom a new tab starts on, too.
      try { localStorage.setItem("zoom", String(this.zoom)); } catch {}
      this.saveTabs();
    }
    else if (c === "tab_new") this.openTab(null, {}, cx);
    else if (c === "tab_close") this.closeTab(null, cx);
    else if (c === "tab_next" || c === "tab_prev") this.showTab(Tabs.step(this.tabs, c === "tab_next" ? 1 : -1), cx);
    else if (/^tab:\d$/.test(c)) this.showTab(Tabs.nth(this.tabs, Number(c.slice(4))), cx);
    else if (c === "tab_move_left" || c === "tab_move_right") this.stepTab(this.keyTab(), c === "tab_move_right" ? 1 : -1);
    else if (c === "pin_tab") this.togglePin(this.keyTab());
    else if (c === "tab_menu") this.openTabMenu(this.keyTab(), true);
  }

  /** The tab the bar's tab keys act on: the one the ring is on, else the shown one. */
  keyTab() {
    const ringed = this.ring?.startsWith("tab:") ? this.ring.slice(4) : null;
    return ringed && this.tabs.list.some((t) => t.id === ringed) ? ringed : this.tabs.active;
  }

  /** Tab `id` to place `index` (Tabs.move), kept for the next start. */
  moveTab(id, index) {
    const next = Tabs.move(this.tabs, id, index);
    if (next === this.tabs) return;
    this.tabs = next;
    this.saveTabs();
  }

  /** Tab `id` one place left (-1) or right (+1); at the end it stays. */
  stepTab(id, by) {
    const i = Tabs.indexOf(this.tabs, id);
    if (i < 0 || i + by < 0 || i + by >= this.tabs.list.length) return;
    this.moveTab(id, i + by);
  }

  // ---- dragging a tab along the strip (Tabs.dropIndex)

  /** The pointer moved over a gap with a press down on a tab: past
   *  DRAG_START it's a drag, and the gap it's over is where the marker stands. */
  dragOver(gap, e, cx) {
    const p = this.pressed;
    if (!p) return;
    if (!this.drag) {
      if (Math.abs((e?.position?.x ?? p.x) - p.x) < Tabs.DRAG_START) return;
      this.drag = { id: p.id, gap: null };
    }
    if (this.drag.gap?.id === gap.id && this.drag.gap?.after === gap.after) return;
    this.drag.gap = gap;
    cx?.notify();
  }

  /** The press let go in the strip: a drag drops where its marker stands. */
  dropTab(cx) {
    const d = this.drag;
    this.drag = null;
    this.pressed = null;
    if (!d) return;
    const at = Tabs.dropIndex(this.tabs, d.id, d.gap);
    if (at != null) this.moveTab(d.id, at);
    cx?.notify();
  }

  /** The pointer left the strip: the drag ends where it started. */
  cancelDrag(cx) {
    const dragging = Boolean(this.drag);
    this.drag = null;
    this.pressed = null;
    if (dragging) cx?.notify();
  }

  key(e, cx) {
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
  barKey(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return false;
    const k = keyOf(e);
    const ready = Boolean(this.start && available());
    // ? opens the keys in the page's place, ? esc q close them; meanwhile they take every key (keyhelp.js).
    const help = keysKey(e, this.keysShown);
    if (help) { this.keysShown = help === "toggle" ? !this.keysShown : false; return true; }
    if (this.keysShown) return true;
    if (k === "tab") {
      const ids = (this.controls ?? []).filter((c) => c.enabled).map((c) => c.id);
      const i = ids.indexOf(this.ring);
      this.ring = !ids.length ? null : i < 0 ? ids[m.shift ? ids.length - 1 : 0] : ids[(i + (m.shift ? -1 : 1) + ids.length) % ids.length];
    } else if (k === "enter" && this.ring) {
      const c = (this.controls ?? []).find((x) => x.id === this.ring && x.enabled);
      if (c) c.action(cx); else this.ring = null;
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
    else if (k === "O") this.external(cx);
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
  inspectorKey(e, cx) {
    if (keyOf(e) !== "enter" || this.lost) return;
    try { herdr.nativeViewCall(INSPECTOR, "focus", {}); } catch {}
    cx.stop_propagation();
  }

  /** A bar button for tab / enter, in drawing order; `ringed`: the ring is on it. */
  control(id, enabled, action) {
    (this.controls ??= []).push({ id, enabled, action });
    return this.ring === id && this.barFocused;
  }

  // ---- parts

  icon(t, id, name, enabled, action, { focus = false } = {}) {
    const ringed = this.control(id, enabled, action);
    return div().id(id).relative().size(24).flex_none().flex().items_center().justify_center()
      .text_color(ringed ? t.foreground : enabled ? t.muted : t.ansi0)
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .when(enabled, (el) => el.hover((s) => s.text_color(t.foreground).bg(t.ansi0)))
      // focus: the press goes on to the pane too, which Fireflies then focuses.
      .on_mouse_down("left", (e, cx) => (focus ? this.claim() : this.stop(e, cx)))
      .on_click((_e, cx) => { if (enabled) { this.claim(); action(cx); cx.notify(); } })
      .child(svg(`${ICONS}/${name}.svg`).size(13));
  }

  address(t) {
    if (this.editing) {
      return div().id("address-edit").flex_1().min_w(0).h(22).px(6).flex().items_center().border(1).border_color(t.accent)
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .child(Input.new(this.input).w_full().text_size(11).text_color(t.foreground));
    }
    const [host, rest] = parts(this.page.href);
    const ringed = this.control("address", true, () => this.edit());
    return h_flex().id("address").relative().flex_1().min_w(0).h(22).px(6).items_center().gap(0).text_size(11)
      .hover((s) => s.bg(t.ansi0 + "66"))
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .on_mouse_down("left", (e, cx) => this.stop(e, cx))
      .on_click((_e, cx) => { this.edit(); cx.notify(); })
      .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(host || "blank"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(rest));
  }

  bar(t) {
    const p = this.page, loading = p.loading && this.start;
    return h_flex().id("bar").relative().h(32).flex_none().px(6).gap(4).items_center()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.barW) > 1) { this.barW = size.width; cx.notify(); } })
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
        .on_click((_e, cx) => { this.command("zoom_reset"); cx.notify(); })
        .child(`${Math.round(this.zoom * 100)}%`))
      .child(this.icon(t, "zoom-in", "plus", this.zoom < 3, () => this.command("zoom_in")))
      // focus: the press focuses this pane first, so the pane hidden for the player is this one.
      .when(Boolean(this.start && available() && (this.video || this.away)), (el) => el.child(this.icon(t, "pip", "picture-in-picture", true, () => this.command("pip"), { focus: true })))
      .child(this.icon(t, "inspect", "code", Boolean(this.start && available()), (cx) => this.inspector(cx), { focus: true }))
      .child(this.icon(t, "external", "external-link", Boolean(this.start && p.href), (cx) => this.external(cx)))
      .child(this.keysButton(t))
      // Loading: a dithered line along the bar's foot, as far as the page has come.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .when(Boolean(loading), (el) => el.child(div().absolute().left(0).bottom(0).h(2)
        .w(Math.max(8, this.barW * Math.min(1, p.progress || 0.05))).transition("width", 180)
        .child(dither(t.accent, 1))));
  }

  /** What went wrong, under the bar, with "retry" (r too) when a page failed. */
  errorLine(t) {
    const page = Boolean(this.start && available() && this.tab.failed);
    return h_flex().id("error").flex_none().px(10).py(4).gap(10).items_center().text_size(11)
      .child(div().flex_1().min_w(0).text_color(t.blocked).child(this.error))
      .when(page, (el) => el.child(div().id("retry").flex_none().px(4).text_color(t.muted)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .on_click((_e, cx) => { this.retry(); cx.notify(); })
        .child("retry  r")));
  }

  /** ? keys, the bar's last control (keyhelp.js); tab rings it like the others. */
  keysButton(t) {
    const toggle = () => { this.keysShown = !this.keysShown; };
    const ringed = this.control("keys", true, toggle);
    return keysHint(t, "keys", Boolean(this.keysShown) || ringed, toggle).relative().h(24).px(4)
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)));
  }

  /** `?`: every key, in the page's place (keyhelp.js): the page is a native
   *  view, drawn over anything laid on it, so it folds away meanwhile. */
  keysStrip(t) {
    return div().relative().flex_1().min_h(0)
      .child(keysView(t, { id: "browser-keys", title: "web", list: KEYS, close: () => { this.keysShown = false; } }));
  }

  blank(t, title, hint) {
    return v_flex().flex_1().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  render() {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    this.controls = [];
    this.barFocused = Boolean(this.handle?.is_focused?.());
    if (this.inspect) {
      const root = v_flex().id("inspector").size_full().bg(t.background).track_focus(this.handle)
        .on_key_down((e, cx) => this.inspectorKey(e, cx));
      if (this.lost) return root.child(this.blank(t, "Nothing to inspect", this.lost));
      return root
        .child(div().flex_1().min_h(0).relative().child(herdr.nativeView.new(INSPECTOR, { kind: "inspector", of: this.inspect })
          .child(this.blank(t, "Opening the inspector…", null))));
    }
    let body;
    if (!available()) body = this.blank(t, "This Herdr has no native views", "The browser needs the DwieDave/fireflies build (native-view/0).");
    else if (!this.start) body = this.blank(t, "Nothing open", "Type an address or a search, then Enter.");
    else {
      body = div().flex_1().min_h(0).relative().child(this.webView(t, this.tab));
    }
    // The other tabs' pages stay alive (their video, scroll, forms), out of
    // sight: in no room at all, which hides a native view.
    const behind = !available() ? [] : this.tabs.list.filter((x) => x.live && x.start && x.id !== this.tab.id)
      .map((x) => div().h(0).flex_none().overflow_hidden().child(this.webView(t, x)));
    return v_flex().id("browser").size_full().bg(t.background).track_focus(this.handle)
      .key_context(CONTEXT)
      .on_action(TAB, (_e, cx) => this.key(tabEvent(false), cx))
      .on_action(TAB_BACK, (_e, cx) => this.key(tabEvent(true), cx))
      .on_mouse_down("left", () => this.claim())
      .on_key_down((e, cx) => this.key(e, cx))
      .when(this.tabs.list.length > 1, (el) => el.child(this.strip(t)))
      .child(this.bar(t))
      .when(Boolean(this.error), (el) => el.child(this.errorLine(t)))
      .when(Boolean(this.keysShown), (el) => el.child(this.keysStrip(t)))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(body) : body)
      .children(behind);
  }

  /** Tab `tab`'s page: a WebKit view of its own (id: the tab's). The mod's
   *  children sit under it: seen while it loads, or while a Fireflies menu or
   *  dialog makes the view step aside. `tabs`: what would open a window
   *  comes as web.newTab. */
  webView(t, tab) {
    return herdr.nativeView.new(tab.id, { kind: "web", ...Tabs.source(tab.start), persist: true, zoom: tab.zoom, pip: true, tabs: true })
      .child(this.away && tab === this.tab
        ? this.blank(t, "Playing in picture in picture", "↩ in the player brings it back here.")
        : this.blank(t, tab.page.loading ? "Loading…" : "", tab.page.href));
  }

  /** The tabs, over the bar (two or more): number, title, ×, and + at the
   *  end; the shown one bright on a dithered accent line, as the app's tabs.
   *  A click shows a tab, a middle click or × closes it; tab rings them. */
  strip(t) {
    const drag = this.drag;
    const pins = this.ownSlot ? shared(Tabs.PINS) : null;
    const pinned = (id) => Boolean(pins) && Tabs.tabPinned(pins, this.slot, id);
    const stakeAt = drag ? Tabs.stakeBefore(this.tabs, drag.id, Tabs.dropIndex(this.tabs, drag.id, drag.gap)) : undefined;
    const item = (tab, i) => {
      const on = tab.id === this.tabs.active;
      const lifted = drag?.id === tab.id;
      const ringed = this.control(`tab:${tab.id}`, true, (cx) => this.showTab(tab.id, cx));
      return h_flex().id(`webtab-${tab.id}`).relative().flex_1().min_w(0).max_w(200).h_full().pl(8).pr(4).gap(6).items_center()
        .text_size(11).text_color(on || lifted ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        // Dragged: lifted where it is, behind its words.
        .when(lifted, (el) => el.children(lift(t)))
        // A press may become a drag (dragOver); let go without one, it shows the tab.
        .on_mouse_down("left", (e, cx) => { this.stop(e, cx); this.pressed = { id: tab.id, x: e?.position?.x ?? 0 }; })
        .on_mouse_move((e, cx) => this.dragOver(Tabs.gapAt(tab.id, e?.local_position?.x ?? 0, e?.bounds?.width ?? 1), e, cx))
        .on_mouse_up("left", (_e, cx) => { if (!this.drag && this.pressed?.id === tab.id) { this.claim(); this.showTab(tab.id, cx); cx.notify(); } })
        // Middle click closes it, as in a browser; a right-click opens its menu.
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); this.claim(); this.closeTab(tab.id, cx); cx.notify(); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.claim(); this.openTabMenu(tab.id, false); })
        // Pinned to the shelf: a small dithered mark in its corner.
        .when(pinned(tab.id), (el) => el.child(div().absolute().left(2).top(4).size(4).child(dither(t.foreground, 1))))
        .child(div().flex_none().text_color(on || tab.page.loading ? t.accent : t.dim).child(i < 9 ? String(i + 1) : "·"))
        .child(div().flex_1().min_w(0).truncate().child(Tabs.label(tab)))
        .child(div().id(`webtab-x-${tab.id}`).size(16).flex_none().flex().items_center().justify_center().text_color(t.dim)
          .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
          .on_mouse_down("left", (e, cx) => this.stop(e, cx))
          .on_click((_e, cx) => { cx.stop_propagation(); this.claim(); this.closeTab(tab.id, cx); cx.notify(); })
          .child(svg(`${ICONS}/x.svg`).size(10)))
        // Loading: its line runs dim; shown: the accent line it stands on.
        .when(on || tab.page.loading, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(2).child(dither(on ? t.accent : t.ansi8, 1))))
        .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .when(stakeAt === tab.id, (el) => el.child(stake(t)));
    };
    const items = this.tabs.list.map(item);
    const plusRinged = this.control("tab-new", true, (cx) => this.openTab(null, {}, cx));
    const end = (e, cx) => this.dragOver({ id: null, after: false }, e, cx);
    return h_flex().id("webtabs").relative().h(26).flex_none().pl(4).pr(6).gap(1).items_center().overflow_hidden()
      .on_mouse_up("left", (_e, cx) => this.dropTab(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.cancelDrag(cx); })
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      // The horizon the tabs stand on, as the app's tab strip.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .children(items)
      // Past the last tab (+ and the room after it): the gap at the end.
      .child(div().id("webtab-new").relative().size(22).flex_none().flex().items_center().justify_center()
        .on_mouse_move(end)
        .when(stakeAt === null, (el) => el.child(stake(t)))
        .text_color(plusRinged ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .when(plusRinged, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .on_mouse_down("left", (e, cx) => this.stop(e, cx))
        .on_click((_e, cx) => { this.claim(); this.openTab(null, {}, cx); cx.notify(); })
        .child(svg(`${ICONS}/plus.svg`).size(12)))
      .child(div().id("webtab-end").flex_1().min_w(0).h_full().on_mouse_move(end));
  }
}
