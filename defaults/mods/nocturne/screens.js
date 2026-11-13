// Fireflies' own screens in Nocturne's look, drawn for the layout's dialog_mods
// (nocturne.json): square, 1-bit, dithered horizons, a pip for every mark.
// Fireflies opens this mod with the shipped screen's props plus `dialog`:
//   welcome    the first-run welcome (a movable window): Fireflies, on herdr-core;
//              records frame.welcomed ("finished" / "skipped") like the shipped one.
//              → / enter next, ← back, a adds a machine (page 2), c copies (page 3), esc skips
//   whats_new  this release's notes ({ notes }, a movable window); ↑↓ / j k /
//              space step through them, enter / esc close
//   help       the keys, as a map (keymap.js): every binding in plain words,
//              grouped, the core's own keys and what works in each block that
//              takes the keyboard (enter or a click unfolds a block's keys);
//              typing filters by key and words; ↑↓ / ctrl-n ctrl-p / page up
//              and down move through the list, esc closes
//   update     the update note, bottom right ({ label, restart, success, dismissal });
//              × (or nocturne.update-close, or nocturne.toast-close with no toast
//              on show) hides it until the next update (shared UPDATE_DISMISSED)
// Colors from theme() only (the moonfly theme).

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { theme, props, closeOverlay, run, spaces, keys, commands, hc, setShared, shared, presentUpdateNotes, updates, nextCommand } from "herdr";
import { rows } from "./keymap.ts";
import { ART, dither, pip } from "./kit.ts";
import { keysHint, keysView, keysKey } from "./keyhelp.ts";

const W = (name) => `mods/workspace-chrome/${name}.svg`;
const stop = (_e, cx) => cx.stop_propagation();
const ASK = "Read ~/.config/herdr-app/AGENTS.md, then tell me what you can change in Fireflies.";

/** shared() key: the update note's `dismissal` someone closed. */
export const UPDATE_DISMISSED = "nocturne.update-dismissed";
/** shared() key: the `dismissal` of the update note on show, for its key (dismissUpdate). */
const UPDATE_SHOWN = "nocturne.update-shown";

/** Whether an update note is on show (not closed yet). */
export const updateShown = () => Boolean(shared(UPDATE_SHOWN)) && shared(UPDATE_DISMISSED) !== shared(UPDATE_SHOWN);

/** Closes the update note on show (nocturne.update-close, or nocturne.toast-close with no toast). */
export function dismissUpdate() {
  const d = shared(UPDATE_SHOWN);
  if (!d || shared(UPDATE_DISMISSED) === d) return false;
  setShared(UPDATE_DISMISSED, d);
  return true;
}

/** A square button: `strong` fills on hover in its color, the other is a quiet chip. */
function button(t, id, label, color, strong, action) {
  return div().id(id).flex_none().h(26).px(12).flex().items_center().text_size(12)
    .border(1).border_color(strong ? color : t.ansi0).text_color(strong ? color : t.muted)
    .hover((s) => strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(t.ansi0))
    .cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(label);
}

/** The horizon under a header: a 2 px dithered line. */
const horizon = (t, color) => div().absolute().left(0).right(0).bottom(0).h(2).child(dither(color ?? t.ansi0, 1));

/** A screen's frame: square, a 1 px edge, the night behind. */
function frame(t, id) {
  return v_flex().id(id).size_full().relative().overflow_hidden().bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground);
}

/** The header a window drags by: the mark, the title, "esc" or ×. */
function header(t, mark, title, note, close) {
  return h_flex().relative().h(40).flex_none().pl(14).pr(8).gap(10).items_center().cursor_grab()
    .child(mark)
    .child(div().text_size(13).text_color(t.foreground).child(title))
    .when(Boolean(note), (el) => el.child(div().px(5).h(16).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.dim).child(note)))
    .child(div().flex_1())
    .child(div().id("scr-close").size(24).flex().items_center().justify_center().text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop).on_click(close).child(svg(W("x")).size(13)))
    .child(horizon(t));
}

const fly = (size) => image(`${ART}/fireflies.svg`).size(size).flex_none();

/** A line with a status pip in front: what a firefly's glow means. */
function bullet(t, status, title, body) {
  return h_flex().gap(12).items_start()
    .child(div().w(14).pt(5).flex_none().flex().justify_center().child(status ? pip(t, status, 7) : svg(`${ART}/pip.svg`).size(7).text_color(t.accent)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(12).text_color(t.foreground).child(title))
      .child(div().text_size(11).line_height("17px").text_color(t.muted).child(body)));
}

/** What the welcome's ? lists: every key its handler takes. */
export const WELCOME_KEYS = [["→ l  ⏎", "next"], ["← h", "back"], ["a", "add a machine (page 2)"], ["c", "copy the line (page 3)"],
  ["⏎", "done (page 3)"], ["esc", "skip · keys away"], ["?", "keys"]];
/** What's new's ? list. */
export const WHATS_NEW_KEYS = [["j k  ↑ ↓", "step through the notes"], ["space  pgdn pgup", "step"], ["g home  end", "top / end"],
  ["⏎ esc", "close (esc: keys away first)"], ["?", "keys"]];

const para = (t, text) => div().text_size(12).line_height("19px").text_color(t.muted).child(text);
const eyebrow = (t, text) => div().text_size(10).text_color(t.ansi8).child(text.toUpperCase());

// ---- welcome ---------------------------------------------------------------

const PAGES = 3;

export class Welcome {
  init(_props, cx) {
    this.page = 1;
    this.machines = [];
    this.copied = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // It opens while the window is still starting, which takes the keyboard back.
    cx.timer.after(600, () => this.handle.focus());
    const load = (cx) => cx.spawn(async (cx) => {
      const r = await hc(["machine", "ls", "--json"]).catch(() => null);
      try { this.machines = r?.code === 0 ? (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary) : []; } catch { this.machines = []; }
      cx.notify();
    });
    load(cx);
    cx.timer.every(3000, (cx) => { if (this.page === 2) load(cx); });
  }

  copy(cx) {
    cx.write_to_clipboard(ASK);
    this.copied = true;
    cx.notify();
  }

  done(outcome) {
    setShared("frame.welcomed", outcome);
    closeOverlay(props().overlay);
  }

  start() {
    this.done("finished");
    if (spaces().length === 0) run("space.new");
  }

  /** The moonlit strip on top: stars, the hills, the firefly. */
  hero(t) {
    return div().relative().h(150).flex_none().overflow_hidden()
      .child(svg(`${ART}/stars.svg`).w(660).h(1240).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.6))
      .child(svg(`${ART}/hills-rim.svg`).w(660).h(196).absolute().bottom(-110).left(0).text_color(t.ansi8).opacity(0.45))
      .child(h_flex().absolute().left(22).bottom(18).gap(16).items_end()
        .child(fly(72))
        .child(v_flex().gap(4).pb(4)
          .child(div().text_size(20).text_color(t.foreground).child("Welcome to Fireflies"))
          .child(div().text_size(11).text_color(t.muted).child("a night meadow for your agents · runs on herdr-core"))))
      .child(horizon(t));
  }

  pageOne(t) {
    return v_flex().gap(16)
      .child(eyebrow(t, "your agents glow in the dark"))
      .child(para(t, "The terminals and agents you open here don't live in this window. They run in herdr-core, a small program in the background. Close Fireflies, update it, or let it crash: your agents keep working, and everything is where you left it when you come back."))
      .child(bullet(t, "working", "A firefly breathes while its agent works", "Every agent is a firefly in the sidebar's meadow, glowing in its status."))
      .child(bullet(t, "blocked", "It blinks when it needs you", "An agent asking something is first in the list; a toast says so too."))
      .child(bullet(t, "done", "It shines steady when it's done", "Then it settles, and the moon waxes as more of them rest."))
      .child(bullet(t, null, "Helpers follow their agent", "Sub-agents show under the agent that started them. Click one to peek."));
  }

  machineRow(t, name, note, ok) {
    return h_flex().relative().h(34).px(10).gap(10).items_center()
      .child(div().w(10).flex_none().child(ok ? pip(t, "done", 7) : svg(`${ART}/pip.svg`).size(7).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
      .child(div().text_size(11).text_color(t.dim).child(note))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.ansi0));
  }

  pageTwo(t) {
    return v_flex().gap(14)
      .child(eyebrow(t, "other meadows"))
      .child(para(t, "A server or a Mac mini runs its own herdr-core, so its agents keep going while this laptop sleeps. Add one from your ssh config: it gets its own spaces in the sidebar."))
      .child(v_flex().border(1).border_color(t.ansi0)
        .child(this.machineRow(t, "this computer", "here", true))
        .children(this.machines.map((m) => this.machineRow(t, m.name, m.state === "connected" ? "connected" : (m.state ?? "offline").replace(/_/g, " "), m.state === "connected")))
        .child(h_flex().id("w-add-machine").h(34).px(10).gap(10).items_center().cursor_pointer().text_size(12).text_color(t.accent)
          .hover((s) => s.bg(t.ansi0))
          .on_mouse_down("left", stop)
          .on_click(() => run("mod.open", { name: "machine-add" }))
          .child(div().w(10).flex_none().child("+")).child(div().flex_1().child("add a machine")).child(div().text_size(11).text_color(t.dim).child("a"))))
      .child(para(t, "Not now? Settings › Machines adds one later."));
  }

  pageThree(t) {
    const key = (action) => keys().find((b) => b.section === "global" && b.action === action)?.keys;
    const row = (k, what) => h_flex().h(24).gap(12).items_center()
      .child(div().w(120).flex_none().text_size(11).text_color(t.accent).child(k ?? "—"))
      .child(div().text_size(12).text_color(t.foreground).child(what));
    return v_flex().gap(14)
      .child(eyebrow(t, "a few keys"))
      .child(v_flex()
        .child(row(key("app.palette"), "every command by name"))
        .child(row(key("tab.new"), "a new tab"))
        .child(row(key("app.help"), "all the keys"))
        .child(row(key("app.settings"), "settings")))
      .child(eyebrow(t, "make it yours"))
      .child(para(t, "Every part of this window is a layout or a mod: plain files your agent can change. Give it this line to start:"))
      .child(v_flex().relative().gap(8).p(10).border(1).border_color(t.ansi0)
        .child(div().text_size(12).line_height("19px").text_color(t.foreground).child(ASK))
        .child(h_flex().gap(8).items_center()
          .child(button(t, "w-copy", this.copied ? "copied" : "copy", this.copied ? t.done : t.accent, !this.copied, (cx) => this.copy(cx)))
          .child(div().text_size(11).text_color(t.dim).child("c"))))
      .child(para(t, "In any terminal, hc ls lists everything running in herdr-core and hc attach t3 jumps into one."));
  }

  render() {
    const t = theme();
    const go = (page, cx) => { this.page = Math.max(1, Math.min(PAGES, page)); cx.notify(); };
    const dots = h_flex().gap(6).items_center()
      .children([...Array(PAGES)].map((_, i) => i + 1).map((p) => p === this.page
        ? pip(t, "done", 8) : svg(`${ART}/pip.svg`).size(6).flex_none().text_color(t.ansi0)));
    const last = this.page === PAGES;
    return frame(t, "nocturne-welcome").track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key, m = e.modifiers;
        // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
        const help = keysKey(e, this.keysShown);
        if (help || this.keysShown) {
          if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
          if (help || !(m.control || m.alt || m.platform)) { cx.stop_propagation(); return cx.notify(); }
          return;
        }
        if (k === "escape") return this.done("skipped");
        if (m.control || m.alt || m.platform) return;
        if (k === "enter" || k === "right" || k === "l") {
          if (last) return k === "enter" ? this.start() : undefined;
          go(this.page + 1, cx);
        } else if (k === "left" || k === "h") go(this.page - 1, cx);
        else if (k === "a" && this.page === 2) run("mod.open", { name: "machine-add" });
        else if (k === "c" && last) this.copy(cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(header(t, fly(18), "Fireflies", "beta", () => this.done("skipped")))
      .child(this.hero(t))
      .child(div().relative().flex_1().min_h(0)
        .child(div().id("w-body").size_full().overflow_y_scroll().on_mouse_down("left", stop)
          .child(div().px(22).pt(18).pb(18).child([this.pageOne, this.pageTwo, this.pageThree][this.page - 1].call(this, t))))
        .when(Boolean(this.keysShown), (el) => el.child(keysView(t, { id: "w-keys-strip", title: "welcome", list: WELCOME_KEYS, close: () => { this.keysShown = false; } }))))
      .child(h_flex().relative().h(48).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(dots)
        .child(div().pl(8).text_size(11).text_color(t.dim).child("← → move · esc skip ·"))
        .child(keysHint(t, "w-keys", Boolean(this.keysShown), () => { this.keysShown = !this.keysShown; }))
        .child(div().flex_1())
        .when(this.page > 1, (el) => el.child(button(t, "w-back", "back", t.muted, false, (cx) => go(this.page - 1, cx))))
        .child(last
          ? button(t, "w-start", spaces().length ? "done" : "open a space", t.accent, true, () => this.start())
          : button(t, "w-next", this.page === 2 && !this.machines.length ? "not now →" : "next →", t.accent, true, (cx) => go(this.page + 1, cx))));
  }
}

// ---- what's new --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export class WhatsNew {
  init(_props, cx) {
    this.notes = props()?.notes ?? [];
    presentUpdateNotes(this.notes.filter((n) => n.spotlight).map((n) => n.version));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());
    this.scroll = ScrollHandle.new();
    this.at = 0; // the block the keyboard last scrolled to
    this.blocks = 1;
  }

  done() { closeOverlay(props().overlay); }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.control || m.platform || m.alt) return;
    const n = this.blocks;
    // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
    const help = keysKey(e, this.keysShown);
    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
      cx.stop_propagation(); return cx.notify();
    }
    if (k === "escape" || k === "enter") this.done();
    else if (k === "down" || k === "j" || k === "space" || k === "pagedown") this.at = Math.min(n - 1, this.at + 1);
    else if (k === "up" || k === "k" || k === "pageup") this.at = Math.max(0, this.at - 1);
    else if (k === "home" || k === "g") this.at = 0;
    else if (k === "end") this.at = n - 1;
    else return;
    this.scroll.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  release(t, note) {
    const [y, m, d] = (note.date ?? "").split("-");
    const date = y && MONTHS[Number(m) - 1] && Number(d) ? `${MONTHS[Number(m) - 1]} ${Number(d)}` : note.date ?? "";
    const items = note.items ?? [];
    const width = (this.width ?? 600) / 1;
    const card = (item) => h_flex().relative().items_stretch().border(1).border_color(t.ansi0)
      .child(div().relative().w(4).flex_none().child(dither(t.accent, 1)))
      .child(v_flex().flex_1().min_w(0)
        .children((item.media ?? []).map((media) => image(media.path).w_full().h(Math.max(1, width - 6) * media.height / media.width).flex_none()))
        .child(v_flex().p(12).gap(4)
          .when(Boolean(item.headline), (el) => el.child(div().text_size(13).text_color(t.foreground).child(item.headline)))
          .when(Boolean(item.detail), (el) => el.child(div().text_size(12).line_height("19px").text_color(t.muted).child(item.detail)))));
    const fixes = items.filter((i) => i.fixed);
    // Blocks, each a direct child of the scroll area so the keys can step to it.
    return [
      h_flex().gap(10).items_center()
        .child(pip(t, "done", 7))
        .child(div().text_size(13).text_color(t.foreground).child(note.version))
        .child(div().text_size(11).text_color(t.dim).child(date)),
      ...items.filter((i) => !i.fixed).map(card),
      ...(fixes.length > 0 ? [v_flex().gap(6).pt(4)
        .child(eyebrow(t, "also fixed"))
        .children(fixes.map((i) => h_flex().gap(10).items_start()
          .child(div().w(8).pt(5).flex_none().child(svg(`${ART}/pip.svg`).size(6).text_color(t.ansi8)))
          .child(div().flex_1().min_w(0).text_size(11).line_height("17px").text_color(t.muted).child([i.headline, i.detail].filter(Boolean).join(" ")))))] : []),
    ];
  }

  render() {
    const t = theme();
    const notes = this.notes.map((n) => updates().notes?.find((x) => x.version === n.version) ?? n);
    // One flat list of blocks (a release's head, its cards, its fixes), gaps as padding.
    const blocks = notes.flatMap((n, r) => this.release(t, n).map((b, i) => [b, r > 0 && i === 0 ? 26 : i === 0 ? 0 : 12]));
    this.blocks = Math.max(1, blocks.length);
    this.at = Math.min(this.at, this.blocks - 1);
    return frame(t, "nocturne-whatsnew").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(header(t, fly(18), "What's new", null, () => this.done()))
      .child(div().relative().flex_1().min_h(0)
        .child(div().id("wn-body").size_full().overflow_y_scroll().track_scroll(this.scroll).on_mouse_down("left", stop)
          .on_size_change((s, cx) => { if (Math.abs((this.width ?? 0) - (s.width - 44)) > 1) { this.width = s.width - 44; cx.notify(); } })
          .children(blocks.map(([b, gap], i) => div().px(22).pt(i === 0 ? 18 : gap).when(i === blocks.length - 1, (d) => d.pb(18)).child(b))))
        .when(Boolean(this.keysShown), (el) => el.child(keysView(t, { id: "wn-keys-strip", title: "what's new", list: WHATS_NEW_KEYS, close: () => { this.keysShown = false; } }))))
      .child(h_flex().relative().h(46).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("↑↓ read · something off? settings › send feedback ·"))
        .child(keysHint(t, "wn-keys", Boolean(this.keysShown), () => { this.keysShown = !this.keysShown; }))
        .child(button(t, "wn-done", "got it", t.accent, true, () => this.done())));
  }
}

// ---- keys --------------------------------------------------------------------

export class Keys {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "type to filter: a key, or what it does" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.at = 0; // the row under the keyboard
    this.rows = [];
    this.open = new Set(); // the blocks (keymap.js SURFACES) whose keys are unfolded
    this.scroll = ScrollHandle.new();
    // By command, for an agent showing someone a key (every nocturne.* command
    // reaches this copy too): nocturne.keys-filter.<words, - for spaces> fills
    // the filter, nocturne.keys-open.<block> unfolds a block (sidebar, tabstrip, header,
    // parked, toasts, menus, panes).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne\./, "");
        const f = /^keys-filter\.(.*)$/.exec(c), o = /^keys-open\.(.+)$/.exec(c);
        if (f) { this.filter = f[1].replace(/-/g, " "); this.input.set_value(this.filter); this.at = 0; }
        else if (o) this.toggle(o[1]);
        else continue;
        cx.notify();
      }
    });
  }

  /** A block's row: its keys unfolded under it, or folded again. */
  toggle(id) {
    if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    const ctrl = m.control && !m.platform && !m.alt;
    const n = this.rows.length;
    let d = 0;
    if (k === "escape") { cx.stop_propagation(); return closeOverlay(props().overlay); }
    if (k === "enter") {
      const r = this.rows[this.at]?.x;
      if (r?.surface) { this.toggle(r.surface); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (k === "down" || (ctrl && k === "n")) d = 1;
    else if (k === "up" || (ctrl && k === "p")) d = -1;
    else if (k === "pagedown") d = 10;
    else if (k === "pageup") d = -10;
    else return;
    this.at = Math.max(0, Math.min(n - 1, this.at + d));
    // The list's children are the eyebrows, the rows and unfolded lines: reveal the row's own.
    if (n) this.scroll.scroll_to_item(this.rows[this.at].child);
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const list = rows(keys(), { commands: commands(), filter: this.filter, open: this.open });
    // The rows the keyboard walks (bindings and blocks; `child`: the index in the list).
    this.rows = list.map((x, child) => ({ x, child })).filter(({ x }) => !x.head && !x.line);
    this.at = Math.min(this.at, Math.max(0, this.rows.length - 1));
    const under = this.rows[this.at]?.x;
    const keyCol = (text, color) => div().relative().w(190).flex_none().truncate().text_color(color).child(text);
    const row = (x, j) => {
      if (x.head) return div().id(`key-head-${x.head}`).pb(4).when(j > 0, (el) => el.pt(12)).child(eyebrow(t, x.head));
      if (x.line) return h_flex().id(`key-line-${x.of}-${j}`).relative().min_h(20).pl(22).pr(6).items_center().text_size(11)
        .child(keyCol(x.k.shown, t.muted).w(172))
        .child(div().relative().flex_1().min_w(0).text_color(t.dim).child(x.label));
      const on = x === under;
      return h_flex().id(`key-${j}`).relative().h(24).px(6).items_center().text_size(12)
        .hover((s) => s.bg(t.ansi0))
        .when(Boolean(x.surface), (el) => el.cursor_pointer().on_click((_e, cx) => { this.toggle(x.surface); cx.notify(); }))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(keyCol(x.k.shown, t.accent))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.label))
        .when(Boolean(x.surface), (el) => el.child(div().relative().flex_none().pl(8).text_size(11).text_color(on ? t.accent : t.dim)
          .child(x.open ? "▾" : on ? "⏎ ▸" : "▸")));
    };
    return frame(t, "nocturne-keys").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().relative().h(36).flex_none().px(14).gap(10).items_center()
        .child(svg(`${ART}/pip.svg`).size(7).text_color(t.accent))
        .child(div().flex_1().text_size(12).text_color(t.foreground).child("Keys"))
        .child(div().text_size(11).text_color(t.dim).child("esc"))
        .child(horizon(t)))
      .child(div().mx(14).mt(12).h(28).px(8).flex().items_center().flex_none().border(1).border_color(t.accent)
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(div().id("keys-list").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll).px(14).py(10)
        .children(list.length ? list.map(row) : [div().pt(8).text_size(12).text_color(t.dim).child("no key does that")]))
      .child(h_flex().relative().h(26).flex_none().px(14).gap(14).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("↑↓")).child(div().text_color(t.dim).child("move")))
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("⏎")).child(div().text_color(t.dim).child("a block's keys")))
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("type")).child(div().text_color(t.dim).child("filter")))
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("close"))));
  }
}

// ---- the update note ---------------------------------------------------------

export class UpdateNote {
  render() {
    const t = theme();
    const p = props() ?? {};
    if (!p.label || shared(UPDATE_DISMISSED) === p.dismissal) return div();
    if (shared(UPDATE_SHOWN) !== p.dismissal) setShared(UPDATE_SHOWN, p.dismissal);
    const link = (id, label, action) => div().id(id).px(6).h_full().flex().items_center().cursor_pointer().text_size(11).text_color(t.accent)
      .hover((s) => s.text_color(t.foreground)).on_click(action).child(label);
    // Hugs the right of its slot (the app's, bottom right); the rest lets clicks through.
    // A press on the note stays with it: what's under it (a terminal starting a
    // selection, whose release would never reach the ×) doesn't see it.
    return h_flex().size_full().justify_end().child(h_flex().id("nocturne-update").relative().h_full().gap(6).items_center()
      .on_mouse_down("left", stop)
      .bg(t.background).border(1).border_color(t.ansi0)
      .child(div().relative().w(6).h_full().flex_none().child(dither(p.success ? t.done : t.accent, 1)))
      .child(div().pl(6).flex_none().child(pip(t, p.success ? "done" : "working", 7)))
      .child(div().pl(2).pr(4).flex_none().text_size(12).text_color(t.foreground).child(p.label))
      .when(Boolean(p.restart), (el) => el.child(button(t, "upd-restart", "restart", t.accent, true, () => run("app.update", {}))))
      .child(link("upd-notes", p.restart || p.success ? "what changed" : "updates", () => run("app.settings", { section: "updates" })))
      // The ×: the note's full height, 30 wide; closes on the press itself.
      .child(div().id("upd-x").w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); setShared(UPDATE_DISMISSED, p.dismissal); })
        .child(svg(W("x")).size(12))));
  }
}
