// Nocturne browser: a real WebKit view in a pane, on the native-view element
// of the DwieDave/herdr-app fork (stock Herdr has none: the pane says so).
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
//   tab / shift-tab  the bar's buttons (a ring shows which), enter presses it
//   esc  the ring, then the keys strip, away
//   ⧉        (only while the page has a <video>)
//            the page's video in the nocturne-pip player, a Herdr window over
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
// Props: { url?, slot? }: url to open on a page; slot, unique per pane, keeps
// its remembered page and zoom apart from other panes' (the store is per props).
// { inspect }: an inspector pane for the web view with that key.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, nextCommand, shared, setShared, run, panes, spaces, focused, openOverlay, window as appWindow } from "herdr";

const ID = "web";
const ICONS = "mods/nocturne-browser/icons";
const SEARCH = "https://duckduckgo.com/?q=";
// What `?` lists.
// Every key key() and barKey() take (the cmd ones are keys.json's mod:nocturne-browser), ? keys last.
export const KEYS = [["enter i", "into the page"], ["⌘esc", "back to the bar"], ["o /  ⌘l ⌘p", "address"], ["H L  ⌘[ ⌘]", "back / forward"],
  ["r  ⌘r", "reload"], ["+ - 0", "zoom"], ["p", "picture in picture"], ["d  ⌘⌥i", "inspector"], ["O", "system browser"],
  ["tab ⇧tab", "buttons (⏎ presses)"], ["esc", "out of the address · keys away"], ["?", "keys"]];
/** A key's name: the typed character for printable keys ("H", "?", "+"), else GPUI's key. */
const keyOf = (e) => (typeof e?.key_char === "string" && e.key_char.length === 1 && e.key_char.trim() ? e.key_char : String(e?.key ?? ""));
// The copy that last had the keyboard or a click: it takes broadcast commands
// while no web pane is focused.
const ACTIVE = "nocturne-browser.active";
// Tab and shift-tab, bound in the browser's own key context (see the top).
const CONTEXT = "NocturneBrowser", TAB = "nocturne_browser::tab", TAB_BACK = "nocturne_browser::tab_back";
/** The key event a bound tab stands for. */
const tabEvent = (shift) => ({ key: "tab", keystroke: shift ? "shift-tab" : "tab", key_char: null, modifiers: { shift, control: false, alt: false, platform: false, function: false } });
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

const available = () => typeof herdr.nativeView?.new === "function";

/** What was typed, as a URL: an address as is (https added), anything else searched. */
function target(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  const hostish = !/\s/.test(s) && (/^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) || /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s));
  return hostish ? s : SEARCH + encodeURIComponent(s);
}

/** An address split for the bar: host, then the rest. */
function parts(href) {
  const m = /^[a-z]+:\/\/([^/?#]+)(.*)$/i.exec(href ?? "");
  return m ? [m[1].replace(/^www\./, ""), m[2] === "/" ? "" : m[2]] : [href ?? "", ""];
}

export default class Browser extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
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
    let saved = null;
    try { saved = localStorage.getItem("url"); } catch {}
    // The page the view is created on. Later pages go through navigate
    // calls: new props would rebuild the view.
    this.start = pr.url ? target(pr.url) : saved;
    // Page zoom, per pane: a step under the UI's size by default.
    this.zoom = 0.9;
    try { this.zoom = Number(localStorage.getItem("zoom")) || 0.9; } catch {}
    this.page = { href: this.start, title: null, loading: false, progress: 0, canGoBack: false, canGoForward: false };
    this.error = null;
    // The page has a <video> (event web.video): ⧉ shows only then.
    this.video = false;
    this.barW = 600;
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
    cx.timer.every(500, () => this.noteShown());
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
        if (c === "focus") { this.claim(); if (this.editing && !this.start) this.input.focus(); else this.handle.focus(); }
        else if (this.mine()) this.command(c, cx);
        cx.notify();
      }
    });
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
    if (pane?.props?.inspect != null) return String(pane.props.inspect) === this.viewKey();
    if (pane?.props?.slot != null) return String(pane.props.slot) === this.slot;
    // A web pane without a slot: not one of the panes that have theirs.
    if (pane && this.ownSlot) return false;
    const a = shared(ACTIVE);
    return a == null || a === this.slot;
  }

  /** This copy's web view key (an inspector pane's props name it), once it has one. */
  viewKey() {
    if (this.of || !this.start || !available()) return this.of ?? null;
    try { this.of = herdr.nativeViewCall(ID, "web.inspect", {})?.of ?? null; } catch { this.of = null; }
    return this.of;
  }

  /** This copy's pane is the window's focused one. */
  isFocusedPane() {
    const mine = this.ownPane();
    return Boolean(mine && focused()?.pane === mine.pane);
  }

  async close() {
    if (this.inspect) return;
    if (shared(ACTIVE) === this.slot) setShared(ACTIVE, null);
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
    if (e.event === "view.click") this.claim();
    // cmd+esc in the page: the keyboard is the bar's again.
    if (e.event === "view.escapeKey") { this.claim(); this.handle.focus(); }
    // Right-click "Inspect Element": WebKit opened the inspector; give it its pane.
    if (e.event === "web.inspector" && d.of) this.openInspector(d.of, cx);
    // ⌥⌘I while the page has the keyboard (it never reaches Herdr's keys).
    if (e.event === "web.inspectKey") this.inspector(cx);
    // ⌘R while the page has the keyboard: reload (or stop, while it loads).
    if (e.event === "web.reloadKey") this.command("reload");
    // web.location: the address changed without a load too (links in
    // single-page apps, pushState, #fragments, back/forward within a page).
    if ((e.event?.startsWith("load.") && e.event !== "load.error") || e.event === "web.location") {
      this.page = { ...this.page, ...d, href: d.href ?? d.url ?? this.page.href };
      if (e.event === "load.start") this.error = null;
      if ((e.event === "load.finish" || e.event === "web.location") && this.page.href) { try { localStorage.setItem("url", this.page.href); } catch {} }
    }
    // ⧉ shows while the page has a <video> (it comes and goes with the page).
    if (e.event === "web.video") this.video = Boolean(d.present);
    if (e.event === "load.error") { this.page = { ...this.page, loading: false }; this.error = d.message ?? "The page didn't load."; }
    // The page's video goes to the player (⧉), or comes back into Herdr from
    // its popped-out window: the player shows it. Meanwhile the page is away.
    // From the window out of Herdr's ◧ / ⤓, `then`: the player goes on into a pane or a chip.
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

  call(action, args) {
    try { return herdr.nativeViewCall(ID, action, args ?? {}); } catch (err) { this.error = String(err?.message ?? err); return null; }
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
    const first = !this.start;
    if (first) this.start = url; // the view is created on it
    else this.call("browser.navigate", { url });
    this.page = { ...this.page, href: url, loading: true, progress: 0.05 };
    // The keyboard into the page, as a browser does (the first page's view
    // comes with the next frame); the mod keeps GPUI's, for its chords.
    this.handle?.focus();
    if (first) cx?.timer?.after(300, () => this.focusPage());
    else this.focusPage();
    cx?.notify();
  }

  /** The page takes AppKit's keyboard (quietly: no view yet is no error). */
  focusPage() {
    if (!this.start || !available()) return;
    try { herdr.nativeViewCall(ID, "focus", {}); } catch {}
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
    this.input.set_value(this.page.href ?? "");
    this.input.focus();
  }

  command(c, cx) {
    if (c === "keys") this.keysShown = !this.keysShown;
    else if (c === "url") this.edit();
    else if (c === "inspect") { if (this.start) this.inspector(cx); }
    // Nothing open yet: no page to move (a call would only say there's no view).
    else if ((c === "reload" || c === "back" || c === "forward" || c === "web") && !(this.start && available())) return;
    else if (c === "reload") this.call(this.page.loading ? "browser.stop" : "browser.reload");
    else if (c === "back") this.call("browser.back");
    else if (c === "forward") this.call("browser.forward");
    else if (c === "web") { this.ring = null; this.call("focus"); }
    else if (c === "pip") { if (this.start) this.call("web.pip"); }
    else if (c === "zoom_in" || c === "zoom_out" || c === "zoom_reset") {
      const z = c === "zoom_reset" ? 0.9 : this.zoom + (c === "zoom_in" ? 0.1 : -0.1);
      this.zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 10) / 10;
      try { localStorage.setItem("zoom", String(this.zoom)); } catch {}
    }
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
    if (k === "tab") {
      const ids = (this.controls ?? []).filter((c) => c.enabled).map((c) => c.id);
      const i = ids.indexOf(this.ring);
      this.ring = !ids.length ? null : i < 0 ? ids[m.shift ? ids.length - 1 : 0] : ids[(i + (m.shift ? -1 : 1) + ids.length) % ids.length];
    } else if (k === "enter" && this.ring) {
      const c = (this.controls ?? []).find((x) => x.id === this.ring && x.enabled);
      if (c) c.action(cx); else this.ring = null;
    } else if (k === "escape" && this.ring) this.ring = null;
    else if (k === "escape" && this.keysShown) this.keysShown = false;
    else if (k === "?") this.keysShown = !this.keysShown;
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
      // focus: the press goes on to the pane too, which Herdr then focuses.
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

  /** ?: the keys strip. */
  keysButton(t) {
    const ringed = this.control("keys", true, () => { this.keysShown = !this.keysShown; });
    return div().id("keys").relative().size(24).flex_none().flex().items_center().justify_center().text_size(11)
      .text_color(ringed || this.keysShown ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .on_mouse_down("left", (e, cx) => this.stop(e, cx))
      .on_click((_e, cx) => { this.keysShown = !this.keysShown; cx.notify(); })
      .child("?");
  }

  /** `?`: the keys, under the bar. */
  keysStrip(t) {
    return h_flex().id("browser-keys").relative().flex_none().flex_wrap().px(10).py(4).gap_x(12).gap_y(2).items_center().text_size(11)
      .children(KEYS.map(([keys, what], i) => h_flex().id(`browser-key-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(keys))
        .child(div().text_color(t.dim).child(what))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  blank(t, title, hint) {
    return v_flex().flex_1().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  render() {
    const t = theme();
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
    if (!available()) body = this.blank(t, "This Herdr has no native views", "The browser needs the DwieDave/herdr-app build (native-view/0).");
    else if (!this.start) body = this.blank(t, "Nothing open", "Type an address or a search, then Enter.");
    else {
      // The mod's children sit under the native view: seen while it loads,
      // or while a Herdr menu or dialog makes the view step aside.
      body = div().flex_1().min_h(0).relative().child(herdr.nativeView.new(ID, { kind: "web", url: this.start, persist: true, zoom: this.zoom, pip: true })
        .child(this.away
          ? this.blank(t, "Playing in picture in picture", "↩ in the player brings it back here.")
          : this.blank(t, this.page.loading ? "Loading…" : "", this.page.href)));
    }
    return v_flex().id("browser").size_full().bg(t.background).track_focus(this.handle)
      .key_context(CONTEXT)
      .on_action(TAB, (_e, cx) => this.key(tabEvent(false), cx))
      .on_action(TAB_BACK, (_e, cx) => this.key(tabEvent(true), cx))
      .on_mouse_down("left", () => this.claim())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.bar(t))
      .when(Boolean(this.keysShown), (el) => el.child(this.keysStrip(t)))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(10).py(4).text_size(11).text_color(t.blocked).child(this.error)))
      .child(body);
  }
}
