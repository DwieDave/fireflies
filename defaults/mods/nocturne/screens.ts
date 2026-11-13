// Fireflies' own screens in Nocturne's look, drawn for the layout's dialog_mods
// (nocturne.json): square, 1-bit, dithered horizons, a pip for every mark.
// Fireflies opens this mod with the shipped screen's props plus `dialog`:
//   welcome    the first-run welcome (a movable window): Fireflies, on herdr-core;
//              records frame.welcomed ("finished" / "skipped") like the shipped one.
//              → / enter next, ← back, a adds a machine (page 2), c copies (page 3), esc or q skips
//   whats_new  this release's notes ({ notes }, a movable window); ↑↓ / j k /
//              space step through them, enter / esc / q close
//   help       the keys, as a map (keymap.ts): every binding in plain words,
//              grouped, the core's own keys and what works in each block that
//              takes the keyboard (enter or a click unfolds a block's keys);
//              typing filters by key and words; ↑↓ / ctrl-n ctrl-p / page up
//              and down move through the list, esc closes
//   update     the update note, bottom right ({ label, restart, success, dismissal });
//              × (or nocturne.update-close, or nocturne.toast-close with no toast
//              on show) hides it until the next update (shared UPDATE_DISMISSED)
// Colors from theme() only (the moonfly theme).

import { div, svg, image } from "gpui-kit";
import type { ClickEvent, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import type { ScrollHandle as Scroll } from "gpui-base";
import { theme, props, closeOverlay, run, spaces, keys, commands, hc, setShared, shared, presentUpdateNotes, updates, nextCommand } from "herdr";
import type { Status, Theme } from "herdr";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { rows } from "./keymap.ts";
import type { KeyEntry, MapRow } from "./keymap.ts";
import { ART, dither, pip, tracked } from "./kit.ts";
import { keysHint, keysView, keysKey } from "./keyhelp.ts";
import type { HelpLine } from "./nav.ts";

const W = (name: string) => `mods/workspace-chrome/${name}.svg`;
const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
const ASK = "Read ~/.config/herdr-app/AGENTS.md, then tell me what you can change in Fireflies.";

/** shared() key: the update note's `dismissal` someone closed. */
export const UPDATE_DISMISSED = "nocturne.update-dismissed";
const DISMISSED = sharedKey(UPDATE_DISMISSED, nullable(isString));

/** shared() key: the `dismissal` of the update note on show, for its key (dismissUpdate). */
const UPDATE_SHOWN = sharedKey("nocturne.update-shown", nullable(isString));

/** Whether an update note is on show (not closed yet). */
export const updateShown = (): boolean => {
  const shown = readShared(shared, UPDATE_SHOWN, null);

  return Boolean(shown) && readShared(shared, DISMISSED, null) !== shown;
};

/** Closes the update note on show (nocturne.update-close, or nocturne.toast-close with no toast). */
export function dismissUpdate(): boolean {
  const d = readShared(shared, UPDATE_SHOWN, null);

  if (!d || readShared(shared, DISMISSED, null) === d) return false;

  writeShared(setShared, DISMISSED, d);

  return true;
}

/** A square button: `strong` fills on hover in its color, the other is a quiet chip. */
function button(t: Theme, id: string, label: string, color: Color, strong: boolean, action: (cx: Context) => void): Element {
  return div().id(id).flex_none().h(26).px(12).flex().items_center().text_size(12)
    .border(1).border_color(strong ? color : t.ansi0).text_color(strong ? color : t.muted)
    .hover((s) => (strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(t.ansi0)))
    .cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e: ClickEvent, cx: Context) => {
      cx.stop_propagation();
      action(cx);
    })
    .child(label);
}

/** The horizon under a header: a 2 px dithered line. */
const horizon = (t: Theme, color?: Color) => div().absolute().left(0).right(0).bottom(0).h(2).child(dither(color ?? t.ansi0, 1));

/** A screen's frame: square, a 1 px edge, the night behind. */
function frame(t: Theme, id: string): Element {
  return v_flex().id(id).size_full().relative().overflow_hidden().bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground);
}

/** The header a window drags by: the mark, the title, "esc" or ×. */
function header(t: Theme, mark: Element, title: string, note: string | null, close: () => void): Element {
  return h_flex().relative().h(40).flex_none().pl(14).pr(8).gap(10).items_center().cursor_grab()
    .child(mark)
    .child(div().text_size(13).text_color(t.foreground).child(title))
    .when(Boolean(note), (el) => el.child(div().px(5).h(16).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.dim).child(note ?? "")))
    .child(div().flex_1())
    .child(div().id("scr-close").size(24).flex().items_center().justify_center().text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop).on_click(() => close()).child(svg(W("x")).size(13)))
    .child(horizon(t));
}

const fly = (size: number) => image(`${ART}/fireflies.svg`).size(size).flex_none();

/** A line with a status pip in front: what a firefly's glow means. */
function bullet(t: Theme, status: Status | null, title: string, body: string): Element {
  return h_flex().gap(12).items_start()
    .child(div().w(14).pt(5).flex_none().flex().justify_center().child(status ? pip(t, status, 7) : svg(`${ART}/pip.svg`).size(7).text_color(t.accent)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(12).text_color(t.foreground).child(title))
      .child(div().text_size(11).line_height("17px").text_color(t.muted).child(body)));
}

/** What the welcome's ? lists: every key its handler takes. */
export const WELCOME_KEYS: readonly HelpLine[] = [["→ l  ⏎", "next"], ["← h", "back"], ["a", "add a machine (page 2)"], ["c", "copy the line (page 3)"],
  ["⏎", "done (page 3)"], ["esc q", "skip · keys away"], ["?", "keys"]];

/** What's new's ? list. */
export const WHATS_NEW_KEYS: readonly HelpLine[] = [["j k  ↑ ↓", "step through the notes"], ["space  pgdn pgup", "step"], ["g home  end", "top / end"],
  ["⏎ esc q", "close (esc q: keys away first)"], ["?", "keys"]];

const para = (t: Theme, text: string) => div().text_size(12).line_height("19px").text_color(t.muted).child(text);
const eyebrow = (t: Theme, text: string) => div().text_size(10).text_color(t.ansi8).child(text.toUpperCase());

/** A screen's overlay, from its props. */
const isOverlayProps = object({ overlay: isString });

/** Closes this screen's overlay. */
const closeMe = (): void => {
  const p = props();

  if (isOverlayProps(p)) closeOverlay(p.overlay);
};

// ---- welcome ---------------------------------------------------------------

const PAGES = 3;

/** A machine as `hc machine ls --json` lists it, as far as the welcome reads it. */
const isMachine = object({ name: isString }, { state: nullable(isString), temporary: isBoolean });

type Machine = Guarded<typeof isMachine>;

/** `hc machine ls --json`'s answer. */
const isMachineList = object({}, { machines: arrayOf(isMachine) });

export class Welcome {
  page = 1;
  machines: readonly Machine[] = [];
  copied = false;
  keysShown = false;
  handle: FocusHandle | null = null;

  init(_props: Props | undefined, cx: Context): void {
    this.page = 1;
    this.machines = [];
    this.copied = false;

    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();
    // It opens while the window is still starting, which takes the keyboard back.
    cx.timer.after(600, () => handle.focus());

    const load = (later: Context) => later.spawn(async (soon) => {
      const r = await hc(["machine", "ls", "--json"]).catch(() => null);
      const list = r?.code === 0 ? parseJson(r.stdout, isMachineList) : undefined;

      this.machines = (list?.machines ?? []).filter((m) => !m.temporary);
      soon.notify();
    });

    load(cx);
    cx.timer.every(3000, (later) => {
      if (this.page === 2) load(later);
    });
  }

  copy(cx: Context): void {
    cx.write_to_clipboard(ASK);
    this.copied = true;
    cx.notify();
  }

  done(outcome: "finished" | "skipped"): void {
    writeShared(setShared, WELCOMED, outcome);
    closeMe();
  }

  start(): void {
    this.done("finished");

    if (spaces().length === 0) run("space.new");
  }

  /** The moonlit strip on top: stars, the hills, the firefly. */
  hero(t: Theme): Element {
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

  pageOne(t: Theme): Element {
    return v_flex().gap(16)
      .child(eyebrow(t, "your agents glow in the dark"))
      .child(para(t, "The terminals and agents you open here don't live in this window. They run in herdr-core, a small program in the background. Close Fireflies, update it, or let it crash: your agents keep working, and everything is where you left it when you come back."))
      .child(bullet(t, "working", "A firefly breathes while its agent works", "Every agent is a firefly in the sidebar's meadow, glowing in its status."))
      .child(bullet(t, "blocked", "It blinks when it needs you", "An agent asking something is first in the list; a toast says so too."))
      .child(bullet(t, "done", "It shines steady when it's done", "Then it settles, and the moon waxes as more of them rest."))
      .child(bullet(t, null, "Helpers follow their agent", "Sub-agents show under the agent that started them. Click one to peek."));
  }

  machineRow(t: Theme, name: string, note: string, ok: boolean): Element {
    return h_flex().relative().h(34).px(10).gap(10).items_center()
      .child(div().w(10).flex_none().child(ok ? pip(t, "done", 7) : svg(`${ART}/pip.svg`).size(7).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
      .child(div().text_size(11).text_color(t.dim).child(note))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.ansi0));
  }

  pageTwo(t: Theme): Element {
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

  pageThree(t: Theme): Element {
    const key = (action: string) => keys().find((b) => b.section === "global" && b.action === action)?.keys;

    const row = (k: string | undefined, what: string) => h_flex().h(24).gap(12).items_center()
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

  /** The page shown now. */
  body(t: Theme): Element {
    return this.page === 1 ? this.pageOne(t) : this.page === 2 ? this.pageTwo(t) : this.pageThree(t);
  }

  render(): Element {
    const t = theme();

    const go = (page: number, cx: Context) => {
      this.page = Math.max(1, Math.min(PAGES, page));
      cx.notify();
    };

    const dots = h_flex().gap(6).items_center()
      .children(Array.from({ length: PAGES }, (_, i) => i + 1).map((p) => (p === this.page
        ? pip(t, "done", 8) : svg(`${ART}/pip.svg`).size(6).flex_none().text_color(t.ansi0))));

    const last = this.page === PAGES;

    return tracked(frame(t, "nocturne-welcome"), this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers;
        // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
        const help = keysKey(e, this.keysShown);

        if (help || this.keysShown) {
          if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;

          if (help || !(m.control || m.alt || m.platform)) {
            cx.stop_propagation();
            cx.notify();
          }

          return;
        }

        if (m.control || m.alt || m.platform) return;

        // q skips, as esc does.
        if (k === "escape" || (k === "q" && !m.shift)) {
          this.done("skipped");

          return;
        }

        if (k === "enter" || k === "right" || k === "l") {
          if (last) {
            if (k === "enter") this.start();

            return;
          }

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
          .child(div().px(22).pt(18).pb(18).child(this.body(t))))
        .when(this.keysShown, (el) => el.child(keysView(t, { id: "w-keys-strip", title: "welcome", list: WELCOME_KEYS, close: () => { this.keysShown = false; } }))))
      .child(h_flex().relative().h(48).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(dots)
        .child(div().pl(8).text_size(11).text_color(t.dim).child("← → move · esc skip ·"))
        .child(keysHint(t, "w-keys", this.keysShown, () => { this.keysShown = !this.keysShown; }))
        .child(div().flex_1())
        .when(this.page > 1, (el) => el.child(button(t, "w-back", "back", t.muted, false, (cx) => go(this.page - 1, cx))))
        .child(last
          ? button(t, "w-start", spaces().length ? "done" : "open a space", t.accent, true, () => this.start())
          : button(t, "w-next", this.page === 2 && !this.machines.length ? "not now →" : "next →", t.accent, true, (cx) => go(this.page + 1, cx))));
  }
}

/** shared() key: how the welcome ended, as the shipped one records it. */
const WELCOMED = sharedKey("frame.welcomed", literal("finished", "skipped"));

// ---- what's new --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A release's notes, as updates() has them (and Fireflies opens what's new with). */
type ReleaseNote = ReturnType<typeof updates>["notes"][number];

/** A picture in a note. */
const isMedia = object({ path: isString, width: isNumber, height: isNumber });

/** A release's notes, as they come in the screen's props (a missing field reads as empty). */
const isReleaseNote = object({ version: isString }, {
  date: isString, items: arrayOf(object({}, { headline: isString, detail: isString, fixed: isBoolean, media: arrayOf(isMedia) })), spotlight: isBoolean,
});

/** A release's notes as handed over, every field there. */
function noteOf(n: Guarded<typeof isReleaseNote>): ReleaseNote {
  const items = (n.items ?? []).map((i) => ({ headline: i.headline ?? "", detail: i.detail ?? "", fixed: i.fixed ?? false, media: [...(i.media ?? [])] }));

  return { version: n.version, date: n.date ?? "", items, spotlight: n.spotlight ?? false };
}

/** What's new's props: the releases to show. */
const isNotesProps = object({}, { notes: arrayOf(isReleaseNote) });

export class WhatsNew {
  notes: readonly ReleaseNote[] = [];
  handle: FocusHandle | null = null;
  scroll: Scroll | null = null;
  at = 0; // the block the keyboard last scrolled to
  blocks = 1;
  width: number | null = null;
  keysShown = false;

  init(_props: Props | undefined, cx: Context): void {
    const p = props();

    this.notes = ((isNotesProps(p) ? p.notes : undefined) ?? []).map((n) => noteOf(n));
    presentUpdateNotes(this.notes.flatMap((n) => (n.spotlight ? [n.version] : [])));

    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();
    cx.timer.after(600, () => handle.focus());
    this.scroll = ScrollHandle.new();
    this.at = 0;
    this.blocks = 1;
  }

  done(): void {
    closeMe();
  }

  key(e: KeyEvent, cx: Context): void {
    const k = e.key;
    const m = e.modifiers;

    if (m.control || m.platform || m.alt) return;

    const n = this.blocks;
    // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
    const help = keysKey(e, this.keysShown);

    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;

      cx.stop_propagation();
      cx.notify();

      return;
    }

    if (k === "escape" || k === "enter" || (k === "q" && !m.shift)) this.done();
    else if (k === "down" || k === "j" || k === "space" || k === "pagedown") this.at = Math.min(n - 1, this.at + 1);
    else if (k === "up" || k === "k" || k === "pageup") this.at = Math.max(0, this.at - 1);
    else if (k === "home" || k === "g") this.at = 0;
    else if (k === "end") this.at = n - 1;
    else return;

    this.scroll?.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  release(t: Theme, note: ReleaseNote): Element[] {
    const [y, m, d] = note.date.split("-");
    const month = MONTHS[Number(m) - 1];
    const date = y && month && Number(d) ? `${month} ${Number(d)}` : note.date;
    const items = note.items;
    const width = this.width ?? 600;

    const card = (item: ReleaseNote["items"][number]) => h_flex().relative().items_stretch().border(1).border_color(t.ansi0)
      .child(div().relative().w(4).flex_none().child(dither(t.accent, 1)))
      .child(v_flex().flex_1().min_w(0)
        .children(item.media.map((media) => image(media.path).w_full().h(Math.max(1, width - 6) * media.height / media.width).flex_none()))
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

  render(): Element {
    const t = theme();
    const notes = this.notes.map((n) => updates().notes.find((x) => x.version === n.version) ?? n);
    // One flat list of blocks (a release's head, its cards, its fixes), gaps as padding.
    const blocks = notes.flatMap((n, r) => this.release(t, n).map((b, i): readonly [Element, number] => [b, r > 0 && i === 0 ? 26 : i === 0 ? 0 : 12]));
    const scroll = this.scroll;
    const body = div().id("wn-body").size_full().overflow_y_scroll();

    this.blocks = Math.max(1, blocks.length);
    this.at = Math.min(this.at, this.blocks - 1);

    return tracked(frame(t, "nocturne-whatsnew"), this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(header(t, fly(18), "What's new", null, () => this.done()))
      .child(div().relative().flex_1().min_h(0)
        .child((scroll ? body.track_scroll(scroll) : body).on_mouse_down("left", stop)
          .on_size_change((s: Size, cx: Context) => {
            if (Math.abs((this.width ?? 0) - (s.width - 44)) > 1) {
              this.width = s.width - 44;
              cx.notify();
            }
          })
          .children(blocks.map(([b, gap], i) => div().px(22).pt(i === 0 ? 18 : gap).when(i === blocks.length - 1, (el) => el.pb(18)).child(b))))
        .when(this.keysShown, (el) => el.child(keysView(t, { id: "wn-keys-strip", title: "what's new", list: WHATS_NEW_KEYS, close: () => { this.keysShown = false; } }))))
      .child(h_flex().relative().h(46).flex_none().px(16).gap(8).items_center().on_mouse_down("left", stop)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("↑↓ read · something off? settings › send feedback ·"))
        .child(keysHint(t, "wn-keys", this.keysShown, () => { this.keysShown = !this.keysShown; }))
        .child(button(t, "wn-done", "got it", t.accent, true, () => this.done())));
  }
}

// ---- keys --------------------------------------------------------------------

/** A row the keyboard walks (a binding or a block), and its index among the list's children. */
interface Walked {
  readonly x: KeyEntry;
  readonly child: number;
}

/** The row is a key's (not an eyebrow, not one of a block's unfolded keys). */
const isKeyEntry = (x: MapRow): x is KeyEntry => !("head" in x) && !("line" in x);

export class Keys {
  filter = "";
  input: InputState | null = null;
  handle: FocusHandle | null = null;
  at = 0; // the row under the keyboard
  rows: Walked[] = [];
  open = new Set<string>(); // the blocks (keymap.ts SURFACES) whose keys are unfolded
  scroll: Scroll | null = null;

  init(_props: Props | undefined, cx: Context): void {
    this.filter = "";

    const input = InputState.new({ placeholder: "type to filter: a key, or what it does" });

    this.input = input;
    input.on("change", (_e, later) => {
      this.filter = input.value();
      this.at = 0;
      later.notify();
    });
    input.focus();
    cx.timer.after(600, () => input.focus());
    this.handle = cx.focus_handle();
    this.at = 0;
    this.rows = [];
    this.open = new Set();
    this.scroll = ScrollHandle.new();
    // By command, for an agent showing someone a key (every nocturne.* command
    // reaches this copy too): nocturne.keys-filter.<words, - for spaces> fills
    // the filter, nocturne.keys-open.<block> unfolds a block (sidebar, tabstrip, header,
    // parked, toasts, menus, panes).
    cx.spawn(async (later) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^nocturne\./, "");
        const f = /^keys-filter\.(.*)$/.exec(c)?.[1];
        const o = /^keys-open\.(.+)$/.exec(c)?.[1];

        if (f !== undefined) {
          this.filter = f.replace(/-/g, " ");
          input.set_value(this.filter);
          this.at = 0;
        } else if (o !== undefined) this.toggle(o);
        else continue;

        later.notify();
      }
    });
  }

  /** A block's row: its keys unfolded under it, or folded again. */
  toggle(id: string): void {
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
  }

  key(e: KeyEvent, cx: Context): void {
    const k = e.key;
    const m = e.modifiers;
    const ctrl = m.control && !m.platform && !m.alt;
    const n = this.rows.length;
    let d = 0;

    if (k === "escape") {
      cx.stop_propagation();
      closeMe();

      return;
    }

    if (k === "enter") {
      const surface = this.rows[this.at]?.x.surface;

      if (surface) {
        this.toggle(surface);
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    if (k === "down" || (ctrl && k === "n")) d = 1;
    else if (k === "up" || (ctrl && k === "p")) d = -1;
    else if (k === "pagedown") d = 10;
    else if (k === "pageup") d = -10;
    else return;

    this.at = Math.max(0, Math.min(n - 1, this.at + d));

    // The list's children are the eyebrows, the rows and unfolded lines: reveal the row's own.
    const walked = this.rows[this.at];

    if (walked) this.scroll?.scroll_to_item(walked.child);

    cx.stop_propagation();
    cx.notify();
  }

  render(): Element {
    const t = theme();
    const list = rows(keys(), { commands: commands(), filter: this.filter, open: this.open });

    // The rows the keyboard walks (bindings and blocks; `child`: the index in the list).
    this.rows = list.flatMap((x, child) => (isKeyEntry(x) ? [{ x, child }] : []));
    this.at = Math.min(this.at, Math.max(0, this.rows.length - 1));

    const under = this.rows[this.at]?.x;
    const keyCol = (text: string, color: Color) => div().relative().w(190).flex_none().truncate().text_color(color).child(text);

    const row = (x: MapRow, j: number): Element => {
      if ("head" in x) return div().id(`key-head-${x.head}`).pb(4).when(j > 0, (el) => el.pt(12)).child(eyebrow(t, x.head));

      if ("line" in x) {
        return h_flex().id(`key-line-${x.of}-${j}`).relative().min_h(20).pl(22).pr(6).items_center().text_size(11)
          .child(keyCol(x.k.shown, t.muted).w(172))
          .child(div().relative().flex_1().min_w(0).text_color(t.dim).child(x.label));
      }

      const on = x === under;
      const surface = x.surface;

      return h_flex().id(`key-${j}`).relative().h(24).px(6).items_center().text_size(12)
        .hover((s) => s.bg(t.ansi0))
        .when(Boolean(surface), (el) => el.cursor_pointer().on_click((_e, cx) => {
          if (surface) this.toggle(surface);

          cx.notify();
        }))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(keyCol(x.k.shown, t.accent))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.label))
        .when(Boolean(surface), (el) => el.child(div().relative().flex_none().pl(8).text_size(11).text_color(on ? t.accent : t.dim)
          .child(x.open ? "▾" : on ? "⏎ ▸" : "▸")));
    };

    const input = this.input;
    const scroll = this.scroll;
    const listBox = div().id("keys-list").flex_1().min_h(0).overflow_y_scroll();

    return tracked(frame(t, "nocturne-keys"), this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().relative().h(36).flex_none().px(14).gap(10).items_center()
        .child(svg(`${ART}/pip.svg`).size(7).text_color(t.accent))
        .child(div().flex_1().text_size(12).text_color(t.foreground).child("Keys"))
        .child(div().text_size(11).text_color(t.dim).child("esc"))
        .child(horizon(t)))
      .child(div().mx(14).mt(12).h(28).px(8).flex().items_center().flex_none().border(1).border_color(t.accent)
        .when(Boolean(input), (el) => (input ? el.child(Input.new(input).flex_1().h_full().text_size(12).text_color(t.foreground)) : el)))
      .child((scroll ? listBox.track_scroll(scroll) : listBox).px(14).py(10)
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

/** The update note's props from Fireflies (src/window.rs): its words, whether a restart is
 *  waiting, whether it's a success, and the key closing it is remembered by. */
const isUpdateProps = object({}, { label: isString, restart: isBoolean, success: isBoolean, dismissal: isString });

export class UpdateNote {
  render(): Element {
    const t = theme();
    const raw = props();
    const p = isUpdateProps(raw) ? raw : {};
    const dismissal = p.dismissal ?? null;

    if (!p.label || readShared(shared, DISMISSED, null) === dismissal) return div();

    if (readShared(shared, UPDATE_SHOWN, null) !== dismissal) writeShared(setShared, UPDATE_SHOWN, dismissal);

    const link = (id: string, label: string, action: () => void) => div().id(id).px(6).h_full().flex().items_center().cursor_pointer().text_size(11).text_color(t.accent)
      .hover((s) => s.text_color(t.foreground)).on_click(() => action()).child(label);

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
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          writeShared(setShared, DISMISSED, dismissal);
        })
        .child(svg(W("x")).size(12))));
  }
}
