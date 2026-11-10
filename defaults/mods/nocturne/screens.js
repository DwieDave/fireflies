// Herdr's own screens in Nocturne's look, drawn for the layout's dialog_mods
// (nocturne.json): square, 1-bit, dithered horizons, a pip for every mark.
// Herdr opens this mod with the shipped screen's props plus `dialog`:
//   welcome    the first-run welcome (a movable window): Fireflies, on herdr-core;
//              records frame.welcomed ("finished" / "skipped") like the shipped one
//   whats_new  this release's notes ({ notes }, a movable window)
//   help       the keys, filterable by typing
//   update     the update note, bottom right ({ label, restart, success, dismissal });
//              × hides it until the next update (shared UPDATE_DISMISSED)
// Colors from theme() only (the moonfly theme).

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, spaces, keys, hc, setShared, shared, presentUpdateNotes, updates } from "herdr";
import { ART, dither, pip } from "./kit.js";

const W = (name) => `mods/workspace-chrome/${name}.svg`;
const stop = (_e, cx) => cx.stop_propagation();
const ASK = "Read ~/.config/herdr-app/AGENTS.md, then tell me what you can change in Fireflies.";

/** shared() key: the update note's `dismissal` someone closed. */
export const UPDATE_DISMISSED = "nocturne.update-dismissed";

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
          .child(div().w(10).flex_none().child("+")).child("add a machine")))
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
        .child(h_flex().child(button(t, "w-copy", this.copied ? "copied" : "copy", this.copied ? t.done : t.accent, !this.copied, (cx) => {
          cx.write_to_clipboard(ASK);
          this.copied = true;
          cx.notify();
        }))))
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
        if (k === "escape") return this.done("skipped");
        if (m.control || m.alt || m.platform) return;
        if (k === "enter" || k === "right") {
          if (last) return k === "enter" ? this.start() : undefined;
          go(this.page + 1, cx);
        } else if (k === "left") go(this.page - 1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(header(t, fly(18), "Fireflies", "beta", () => this.done("skipped")))
      .child(this.hero(t))
      .child(div().id("w-body").flex_1().min_h(0).overflow_y_scroll().on_mouse_down("left", stop)
        .child(div().px(22).pt(18).pb(18).child([this.pageOne, this.pageTwo, this.pageThree][this.page - 1].call(this, t))))
      .child(h_flex().relative().h(48).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(dots)
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
  }

  done() { closeOverlay(props().overlay); }

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
    return v_flex().gap(12)
      .child(h_flex().gap(10).items_center()
        .child(pip(t, "done", 7))
        .child(div().text_size(13).text_color(t.foreground).child(note.version))
        .child(div().text_size(11).text_color(t.dim).child(date)))
      .children(items.filter((i) => !i.fixed).map(card))
      .when(fixes.length > 0, (el) => el.child(v_flex().gap(6).pt(4)
        .child(eyebrow(t, "also fixed"))
        .children(fixes.map((i) => h_flex().gap(10).items_start()
          .child(div().w(8).pt(5).flex_none().child(svg(`${ART}/pip.svg`).size(6).text_color(t.ansi8)))
          .child(div().flex_1().min_w(0).text_size(11).line_height("17px").text_color(t.muted).child([i.headline, i.detail].filter(Boolean).join(" ")))))));
  }

  render() {
    const t = theme();
    const notes = this.notes.map((n) => updates().notes?.find((x) => x.version === n.version) ?? n);
    return frame(t, "nocturne-whatsnew").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" || e.key === "enter") { this.done(); cx.stop_propagation(); } })
      .child(header(t, fly(18), "What's new", null, () => this.done()))
      .child(div().id("wn-body").flex_1().min_h(0).overflow_y_scroll().on_mouse_down("left", stop)
        .child(v_flex().px(22).pt(18).pb(18).gap(26).on_size_change((s, cx) => { if (Math.abs((this.width ?? 0) - (s.width - 44)) > 1) { this.width = s.width - 44; cx.notify(); } })
          .children(notes.map((n) => this.release(t, n)))))
      .child(h_flex().relative().h(46).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(div().flex_1().text_size(11).text_color(t.dim).child("something off? settings › send feedback"))
        .child(button(t, "wn-done", "got it", t.accent, true, () => this.done())));
  }
}

// ---- keys --------------------------------------------------------------------

const GROUPS = [
  ["spaces", /^space\./], ["tabs", /^tab\./], ["panes", /^pane\./], ["agents", /^agent\./],
  ["terminal", /^terminal\.|^send:/], ["window", /./],
];

function keyLabel(action) {
  if (action.startsWith("send:")) return "type " + JSON.stringify(action.slice(5));
  const [name, arg] = action.split(":");
  const words = name.replace(/[._]/g, " ");
  return arg ? `${words} ${arg}` : words;
}

export class Keys {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "type to filter" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  render() {
    const t = theme();
    const f = this.filter.toLowerCase();
    const all = keys().filter((k) => !f || k.keys.includes(f) || keyLabel(k.action).includes(f));
    const seen = new Set();
    const groups = GROUPS.map(([name, re]) => [name, all.filter((k) => !seen.has(k) && re.test(k.action) && (seen.add(k) || true))])
      .filter(([, rows]) => rows.length > 0);
    return frame(t, "nocturne-keys").track_focus(this.handle)
      .on_key_down((e) => { if (e.key === "escape") closeOverlay(props().overlay); })
      .child(h_flex().relative().h(36).flex_none().px(14).gap(10).items_center()
        .child(svg(`${ART}/pip.svg`).size(7).text_color(t.accent))
        .child(div().flex_1().text_size(12).text_color(t.foreground).child("Keys"))
        .child(div().text_size(11).text_color(t.dim).child("esc"))
        .child(horizon(t)))
      .child(div().mx(14).mt(12).h(28).px(8).flex().items_center().flex_none().border(1).border_color(t.accent)
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(div().id("keys-list").flex_1().min_h(0).overflow_y_scroll().px(14).py(10)
        .child(v_flex().gap(12).children(groups.map(([name, rows]) => v_flex()
          .child(div().pb(4).child(eyebrow(t, name)))
          .children(rows.map((k, i) => h_flex().id(`key-${name}-${i}`).relative().h(24).px(6).items_center().text_size(12)
            .hover((s) => s.bg(t.ansi0))
            .child(div().w(200).flex_none().truncate().text_color(t.accent).child(k.keys + (k.section !== "global" ? `  (${k.section})` : "")))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(keyLabel(k.action)))))))));
  }
}

// ---- the update note ---------------------------------------------------------

export class UpdateNote {
  render() {
    const t = theme();
    const p = props() ?? {};
    if (!p.label || shared(UPDATE_DISMISSED) === p.dismissal) return div();
    const link = (id, label, action) => div().id(id).px(6).h_full().flex().items_center().cursor_pointer().text_size(11).text_color(t.accent)
      .hover((s) => s.text_color(t.foreground)).on_click(action).child(label);
    // Hugs the right of its slot (the app's, bottom right); the rest lets clicks through.
    return h_flex().size_full().justify_end().child(h_flex().id("nocturne-update").relative().h_full().gap(6).pr(4).items_center()
      .bg(t.background).border(1).border_color(t.ansi0)
      .child(div().relative().w(6).h_full().flex_none().child(dither(p.success ? t.done : t.accent, 1)))
      .child(div().pl(6).flex_none().child(pip(t, p.success ? "done" : "working", 7)))
      .child(div().pl(2).pr(4).flex_none().text_size(12).text_color(t.foreground).child(p.label))
      .when(Boolean(p.restart), (el) => el.child(button(t, "upd-restart", "restart", t.accent, true, () => run("app.update", {}))))
      .child(link("upd-notes", p.restart || p.success ? "what changed" : "updates", () => run("app.settings", { section: "updates" })))
      .child(div().id("upd-x").size(22).flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_click(() => setShared(UPDATE_DISMISSED, p.dismissal))
        .child(svg(W("x")).size(12))));
  }
}
