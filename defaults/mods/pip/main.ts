// Nocturne picture in picture: the video a browser pane put in Picture in
// Picture, in a Fireflies window (drag it by its bar or anywhere on its video,
// resize it by its edges and corners: the video keeps its shape) that stays
// over every tab and space. The video is a native view that hands its left
// presses to Fireflies (fireflies-native-view Kind::gives_left_presses): a
// press that moves 4 px drags the window, a click gives the player the keyboard.
// Square, like the rest of Nocturne.
//
//   ↩    back to the pane it came from (it plays on there)
//   «  » 10 seconds back / on (commands pip.rewind / .forward)
//   ❚❚ ▶ pause / play (pip.toggle)
//   🔈   sound off / on (pip.mute)
//   ◧    into a pane: a new pane beside the focused one, in the shown tab
//        (pip.pane); the video plays on there
//   ⤓    park: a chip in the shown tab's parked row (pip.park); the
//        video plays on, unparking the chip brings the window back
//   ⇱    out of Fireflies: a window above every app and space, in the screen's
//        bottom right corner (pip.out; its ⇲ brings it back)
//   magnet  snapping on / off (pip.snap; pip.snap:on / :off set it), in the
//        accent while on, shared `pip.snap` (unset: on; browser opens the
//        window with it too). On, the window snaps to the shown tab's pane
//        grid (OverlaySpec snap, src/window/movable.rs): dragged within 24 px
//        of a corner or an edge's middle it lands exactly there and stays on
//        it as the grid changes; out of Fireflies, to its screen's usable area
//        (native pip.rs). pip.to:<place> (top-left … left, or the next one
//        left / right / up / down) puts the window on one (overlay.snap to).
//   ✕    close: the video goes back to its page, paused (pip.close)
//   ⋯    when the bar is too narrow for them all: the rest, as a menu.
//        Play/pause and close always stay on the bar.
// The bar is in sections, a dithered seam between them: ↩ where it came from ·
// « ❚❚ » 🔈 playback · ◧ ⤓ ⇱ where it goes · magnet ? ✕ the player's own (⋯
// joins these). A section with nothing left on a narrow bar takes its seam along; the
// ⋯ menu lists what went into it in the same sections, a dithered rule between.
// Seams and rules are in seamTone (a step darker than the icons' dim).
// Keys while it has the keyboard (overlay.focus to the window, pane.go to its
// pane, a click on it; its bar's edge turns blue meanwhile):
//   space k  pause / play   ← → (h l)  10 s back / on   m  sound   b  back
//   p  into a pane   P  park   o  out of Fireflies   s  snapping   x q  close
//   ⇧← ⇧→ ⇧↑ ⇧↓ (H L K J)  the window to the next corner or edge middle that way
//   esc  (the window) the keyboard back to the pane (overlay.focus none)
//   ?    these keys (KEYS), keyhelp.ts's overview in a popup: the video is a
//        native view, drawn over the panes and the overlays opened before it
//        (a popup, a dialog or a window raised after it cuts a hole in it and
//        its backdrop dims it); the bar's ? (before ✕) opens it too
// The ⋯ menu: ↑ ↓ (j k) move, enter picks, esc q close. The keys popup: esc q ? close.
//
// Opened by browser (`openOverlay` WINDOW below, props { of: the
// browser's web view key }). As a pane (◧): props { of, pane: true }; the pane
// closes when the video leaves it. Parked (⤓): props { of, pane: true, park:
// true }, a pane made parked (pane.split park: true: never laid out in the tab,
// it runs out of sight and takes the video there); unparking its chip sends it
// `unpark`, and it turns back into the window. The ⋯ menu: this mod as a popup, props { menu }.
// Any site's video works: the page itself moves into the player and its
// video is lifted to fill it (native view `pip`).

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, closeOverlay, openOverlay, run, panes, focused, nextCommand, shared, setShared, window as appWindow } from "herdr";
import type { OverlaySpec, PaneInfo, Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Command, ControlId } from "./commands.ts";
import { KEYS, SKIP, keyControl, menuMove, parseCommand } from "./commands.ts";
import { GLYPH_DROP, lift, mix, seamTone } from "./look.ts";
// keyhelp.ts is one file shared by every nocturne mod (a copy here, byte for byte).
import { keysView, keysKey, keysHeight } from "./keyhelp.ts";

const ID = "pip";
const BAR = 22;
const MOD = "pip";
const ICONS = "mods/pip/icons";

// How the window resizes: the video's shape (16:9 until the video says) under
// a 22 px bar in a 1 px border.
const RESIZE = { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] } satisfies OverlaySpec["resizable"];

// The window, as browser opens it too (its away.ts PLAYER).
const WINDOW = { mod: MOD, kind: "window", key: MOD, frame: "none", width: 384, height: 238, resizable: RESIZE } satisfies OverlaySpec;

// Snapping (on unless set false): the window snaps to the shown tab's pane grid
// (OverlaySpec snap), out of Fireflies to its screen's usable area. Shared with
// browser, which opens the player too and keeps the window out of Fireflies' toggle.
const SNAP = sharedKey("pip.snap", nullable(isBoolean));

/** Whether the player snaps (pip.snap; unset: yes). */
export const snapOn = (): boolean => readShared(shared, SNAP, null) !== false;

/** The window as it opens now: snapping as the mode is. */
const windowSpec = (): OverlaySpec => ({ ...WINDOW, snap: snapOn() });
const ROW = 26;

// The ⋯ menu's rule between two sections.
const RULE = 9;

// The keys popup's width.
const KEYS_W = 340;

/** What this mod is opened with (see the top): anything else in props() is ignored, and props
 *  that aren't these are no props. */
const isPipProps = object({}, {
  of: isString,
  pane: isBoolean,
  park: isBoolean,
  // Popped back in from out of Fireflies by its ◧ or ⤓: on into a pane or a chip.
  after: literal("pane", "park"),
  overlay: isString,
  menu: arrayOf(isString),
  keys: isBoolean,
  playing: isBoolean,
  muted: isBoolean,
  snap: isBoolean,
});

type PipProps = Guarded<typeof isPipProps>;

const NO_PROPS: PipProps = {};

const pipProps = (): PipProps => {
  const p = props();

  return isPipProps(p) ? p : NO_PROPS;
};

const closeOwn = () => {
  const overlay = pipProps().overlay;

  if (overlay !== undefined) closeOverlay(overlay);
};

// The pane a ◧ or ⤓ made: { of, pane, park }, so that pane can find itself (a mod isn't told
// its pane id), and the page's browser knows whether the video went into a pane or a chip.
const isPaneNote = object({ of: isString, pane: isString, park: isBoolean });

const PANE = sharedKey("pip.pane", nullable(isPaneNote));

// The video the player window shows now (the palette offers its commands meanwhile).
const PLAYER = sharedKey("pip.player", nullable(isString));

/** One event of the native view (`nextNativeViewEvent`), the fields read here. */
const isNativeEvent = object({ event: isString }, {
  data: nullable(object({}, { result: isString, muted: isBoolean, width: isNumber, height: isNumber })),
});

/** The view's `state` answer: whether it shows the video now. */
const isPipState = object({}, {
  content: nullable(object({}, { session: nullable(object({}, { showing: isBoolean })) })),
});

type PipSession = { readonly showing: boolean | undefined };

/** What a control's glyph and name depend on. */
interface PlayerState { readonly playing: boolean; readonly muted: boolean; readonly snap: boolean }

/** A glyph or name: fixed, or following the player. */
type Label = string | ((s: PlayerState) => string);

const label = (v: Label, s: PlayerState): string => (isString(v) ? v : v(s));


type Section = "from" | "play" | "to" | "window";

/** One control of the bar (and of its ⋯ menu): a glyph, or one of icons/ by name. */
interface Control {
  readonly id: ControlId;
  readonly section: Section;
  readonly keep: number;
  readonly mark: { readonly glyph: Label } | { readonly icon: (s: PlayerState) => string };
  readonly name: Label;
  /** Only on the window, not in a pane. */
  readonly window?: true;
  /** Its mark in the accent while this holds (a mode that is on). */
  readonly lit?: (s: PlayerState) => boolean;
}

// The bar's controls, in bar order, in four sections with a dithered seam
// between them: where the video came from (from), playback (play), where it
// goes (to), and the player's own (window). `keep`: the lower, the longer it
// stays on a narrow bar (the rest go into ⋯, in the same sections).
const CONTROLS: readonly Control[] = [
  { id: "back", section: "from", keep: 3, mark: { glyph: "↩" }, name: "Back to the page" },
  { id: "rewind", section: "play", keep: 5, mark: { glyph: "«" }, name: `Back ${SKIP} seconds` },
  { id: "toggle", section: "play", keep: 0, mark: { glyph: (s) => (s.playing ? "❚❚" : "▶") }, name: (s) => (s.playing ? "Pause" : "Play") },
  { id: "forward", section: "play", keep: 6, mark: { glyph: "»" }, name: `On ${SKIP} seconds` },
  { id: "mute", section: "play", keep: 2, mark: { icon: (s) => (s.muted ? "volume-x" : "volume") }, name: (s) => (s.muted ? "Sound on" : "Sound off") },
  { id: "pane", section: "to", keep: 7, mark: { glyph: "◧" }, name: "Into a pane", window: true },
  { id: "park", section: "to", keep: 4, mark: { glyph: "⤓" }, name: "Park as a chip" },
  { id: "out", section: "to", keep: 8, mark: { glyph: "⇱" }, name: "Out of Fireflies" },
  { id: "snap", section: "window", keep: 10, mark: { icon: () => "magnet" }, name: (s) => (s.snap ? "Snap to corners: on" : "Snap to corners: off"), lit: (s) => s.snap },
  { id: "keys", section: "window", keep: 9, mark: { glyph: "?" }, name: "Keys" },
  { id: "close", section: "window", keep: 1, mark: { glyph: "✕" }, name: "Close" },
];


/** The keys popup's height: the list in KEYS_W, and its 1 px border. */
const KEYS_H = keysHeight(KEYS, KEYS_W) + 2;

// Not on stock Herdr: the module has no nativeView there.
const available = () => typeof herdr.nativeView !== "undefined";

// The dither fill, as ../nocturne/toolground.ts has it (nocturne's kit.ts passes it on; a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

function dither(color: Color, cell = 1) {
  const zoom = settings().zoom || 1, dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

// The bar keeps this much for its title before controls go into ⋯.
const TITLE = 70;

// A seam between two sections: 1 px of dither, 8 px tall (the icons are
// 12, the bar 21), in SEAM_TONE: half its dots lit, so quieter than the
// icons are. Its place on the bar is 8 px, the seam in the middle.
const SEAM = 8;
const SEAM_H = 8;

/** `list` cut into its sections, in order: [[control, …], …]; none empty. */
export function sections<C extends { readonly section: string }>(list: readonly C[]): C[][] {
  const out: C[][] = [];

  for (const c of list) {
    const last = out.at(-1);

    if (last !== undefined && last[0]?.section === c.section) last.push(c);
    else out.push([c]);
  }

  return out;
}

/** How wide a bar of these controls is (and ⋯, `more`), its title's room too:
 *  a place per control, a seam between sections (⋯ sits in the last one). */
const barWidth = (shown: readonly Control[], more: boolean) => 8 + TITLE + (shown.length + (more ? 1 : 0)) * BAR + Math.max(0, sections(shown).length - 1) * SEAM;

/** The controls a `width` px bar shows, and those for ⋯ (which takes a place
 *  itself, before ✕). The lowest `keep`s stay, two at the least. */
/** The bar's controls at a width: those it shows, those in ⋯. */
interface Fitted {
  readonly shown: readonly Control[];
  readonly more: readonly Control[];
}

export function fit(controls: readonly Control[], width: number): Fitted {
  if (barWidth(controls, false) <= width) return { shown: controls, more: [] };

  const order = [...controls].sort((a, b) => a.keep - b.keep);

  for (let n = controls.length - 1; ; n--) {
    const keep = new Set(order.slice(0, n).map((c) => c.id));
    const shown = controls.filter((c) => keep.has(c.id));

    if (n <= 2 || barWidth(shown, true) <= width) return { shown, more: controls.filter((c) => !keep.has(c.id)) };
  }
}

/** The seam between two sections of the bar: a short, quiet dithered upright. */
function seam(t: Theme) {
  return div().relative().flex_none().w(1).h(SEAM_H).mx((SEAM - 1) / 2).child(dither(seamTone(t), 1));
}


// What the tests read here too.
export { GLYPH_DROP, KEYS, keyControl, lift, menuMove, mix, parseCommand, seamTone };

export default class Pip extends View {
  menu: readonly string[] | null = null;
  keysList = false;
  handle: FocusHandle | null = null;
  playing = true;
  muted = false;
  error: string | null = null;
  width = 384;
  // The control under the pointer: its name shows in the title (a tooltip
  // isn't an overlay: it would be drawn under the video, a native view).
  hover: { readonly id: string; readonly name: string } | null = null;
  aspect: number | null = null;
  inPane = false;
  parks = false;
  closing = false;
  wasParked = false;
  parkAsked = false;
  // The pane intoPane asked for, until it takes the video (`pip.moved`).
  made: { readonly of: string; readonly before: ReadonlySet<string>; readonly park: boolean } | null = null;
  // The ⋯ menu's cursor.
  cursor = 0;

  override init(_props: Props | undefined, cx: AsyncContext) {
    const p = pipProps();

    this.menu = p.menu ?? null;
    this.keysList = p.keys === true;

    if (this.menu !== null || this.keysList) return this.initMenu(cx);

    const handle = cx.focus_handle();

    this.handle = handle;
    this.inPane = p.pane === true;
    this.parks = p.park === true;

    if (!available()) return;

    if (!this.inPane) writeShared(setShared, PLAYER, p.of ?? null);
    cx.spawn(async (cx) => {
      for (;;) {
        let text: string;

        try { text = await herdr.nextNativeViewEvent(); } catch { return; }

        const e = parseJson(text, isNativeEvent);

        if (e === undefined) continue;

        // The video went home (here, in its page or elsewhere), or into
        // another player (a pane, a chip, out of Fireflies): nothing left to show here.
        if (e.event === "pip.moved") this.noteMade();

        if (e.event === "pip.ended" || e.event === "pip.moved") return this.leave();

        const data = e.data;

        if (e.event === "pip.state" && data && data.result !== undefined && data.result !== "none") {
          this.playing = data.result === "playing";

          if (data.muted !== undefined) this.muted = data.muted;
          this.fitVideo(data.width ?? 0, data.height ?? 0);
        }

        cx.notify();
      }
    });
    // How the video is (playing, sound), once the view holds it.
    cx.timer.after(500, () => { try { herdr.nativeViewCall(ID, "pip.sync", {}); } catch { /* the view isn't there yet */ } });
    // Popped back in by the window out of Fireflies' ◧ or ⤓: on into a pane or a chip.
    const after = p.after;

    if (!this.inPane && after !== undefined) cx.timer.after(400, () => this.command(after));

    if (this.inPane) {
      // A pane from an earlier run (it is saved with its tab): no video comes.
      cx.timer.after(1500, () => { if (!this.state()) this.leave(); });
      // A chip: parks once it holds the video; unparked, the window comes back.
      cx.timer.every(250, () => { if (this.parks) this.watchPark(); });
    }

    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^pip\./, "");

        const command = parseCommand(c);

        if (c === "focus") handle.focus();
        // A chip (pane.split park: true) unparked: the window again, which takes the video.
        else if (c === "unpark") this.unpark();
        else if (command !== null) this.command(command);
        cx.notify();
      }
    });
  }

  key(e: KeyEvent, cx: Context) {
    const c = keyControl(e);

    if (!c || ((c === "pane" || c === "unfocus" || c.startsWith("to:")) && this.inPane) || (c === "park" && this.parks)) return;

    if (c === "unfocus") run("overlay.focus", { dir: "none" });
    else this.command(c);
    cx.stop_propagation();
    cx.notify();
  }

  command(c: Command) {
    if (this.menu !== null) return;

    if (c === "toggle") this.call("pip.toggle");
    else if (c === "rewind") this.call("pip.seek", { by: -SKIP });
    else if (c === "forward") this.call("pip.seek", { by: SKIP });
    else if (c === "mute") this.call("pip.mute");
    else if (c === "back") { this.call("pip.back"); this.leave(); }
    else if (c === "close") { this.call("pip.close"); this.leave(); }
    else if (c === "out") this.popOut();
    else if (c === "pane" && !this.inPane) this.intoPane(false);
    else if (c === "park" && !this.parks) this.park();
    else if (c === "keys") this.openKeys();
    else if (c === "snap" || c === "snap:on" || c === "snap:off") this.setSnap(c === "snap" ? !snapOn() : c === "snap:on");
    else if (c.startsWith("to:") && !this.inPane) run("overlay.snap", { id: pipProps().overlay, to: c.slice(3) });
  }

  /** Snapping on or off: the mode for every player (shared), and this window now. */
  setSnap(on: boolean) {
    writeShared(setShared, SNAP, on);

    if (!this.inPane && pipProps().overlay !== undefined) run("overlay.snap", { id: pipProps().overlay, on });
  }

  /** ?: the keys, a popup centred on the player (its window, or its pane), never cut by the app window. */
  openKeys() {
    const over = this.inPane ? this.ownPane()?.pane : pipProps().overlay;
    const spec: OverlaySpec = { mod: MOD, kind: "popup", frame: "none", width: KEYS_W, height: KEYS_H, props: { keys: true } };

    if (over !== undefined) spec.at = { over };
    openOverlay(spec);
  }

  /** The window keeps the video's real shape (`videoWidth` × `videoHeight`). */
  fitVideo(w: number, h: number) {
    if (this.inPane || !(w > 0 && h > 0)) return;

    const aspect = w / h;

    if (this.aspect !== null && Math.abs(this.aspect - aspect) < 0.001) return;
    this.aspect = aspect;
    run("overlay.resizable", { id: pipProps().overlay, resizable: { ...RESIZE, aspect } });
  }

  /** ⤓: a pane parks itself; the window goes into a pane that does. */
  park() {
    if (this.inPane) this.parks = true;
    else this.intoPane(true);
  }

  /** One action on the player's native view; a failure shows in the bar's title. */
  call(action: string, args: Readonly<Record<string, number>> = {}): void {
    try { herdr.nativeViewCall(ID, action, args); }
    catch (err) { this.error = err instanceof Error ? err.message : String(err); }
  }

  /** The session this player shows, if any. */
  state(): PipSession | null {
    try {
      const answer = herdr.nativeViewCall(ID, "state", {});
      const session = isPipState(answer) ? answer.content?.session : null;

      return session ? { showing: session.showing } : null;
    } catch {
      return null;
    }
  }

  /** This copy's pane: the one ◧/⤓ noted, else the only player pane there is. */
  ownPane(): PaneInfo | null {
    const mine = (p: PaneInfo) => p.mod === MOD;
    const noted = readShared(shared, PANE, null);
    const pane = noted !== null && noted.of === pipProps().of ? panes().find((p) => p.pane === noted.pane && mine(p)) : undefined;

    if (pane) return pane;

    const all = panes().filter(mine);

    return all.length === 1 ? all[0] ?? null : null;
  }

  /** The chip unparked (a click on it, pane.unpark): its mod's to answer, as the
   *  app never lays a chip made parked out in the tab. The window opens and takes
   *  the video; this pane then gets `pip.moved` and closes. */
  unpark() {
    if (!this.parks || this.closing) return;

    openOverlay({ ...windowSpec(), props: { of: pipProps().of } });
  }

  /** A parking pane: parks itself once the video is in it; when the chip is
   *  unparked (clicked, dragged back, focused), opens the window again,
   *  which takes the video, and this pane closes (`pip.moved`). */
  watchPark() {
    if (this.closing) return;

    const me = this.ownPane();

    if (!me) return;

    if (me.parked) {
      this.wasParked = true;

      return;
    }

    if (this.wasParked) {
      this.wasParked = false;
      openOverlay({ ...windowSpec(), props: { of: pipProps().of } });

      return;
    }

    if (!this.parkAsked && this.state()?.showing) {
      this.parkAsked = true;
      run("pane.park", { pane: me.pane });
    }
  }

  /** The copy ends (its window or pane closed, by us or by Fireflies). */
  override async close() {
    const of = pipProps().of;

    if (this.menu === null && !this.inPane && readShared(shared, PLAYER, null) === of) writeShared(setShared, PLAYER, null);
  }

  /** This player goes: its window, or its pane. */
  leave() {
    if (!this.inPane) {
      if (readShared(shared, PLAYER, null) === pipProps().of) writeShared(setShared, PLAYER, null);

      return closeOwn();
    }

    if (this.closing) return;
    this.closing = true;

    const pane = this.ownPane();

    if (pane && readShared(shared, PANE, null)?.pane === pane.pane) writeShared(setShared, PANE, null);

    if (pane) run("pane.close", { pane: pane.pane });
  }

  /** Out of Fireflies: the popped-out window takes the video, this player goes. */
  popOut() {
    const t = theme();

    try {
      herdr.nativeViewCall(ID, "pip.popOut", {
        colors: { background: t.background, foreground: t.foreground, dim: t.dim, border: t.border, hover: t.ansi0, accent: t.accent, seam: seamTone(t) },
        snap: snapOn(),
      });
      this.leave();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Into a new pane beside the focused one, in the shown tab (`park`: one
   *  that parks itself, a chip). The new pane's player takes the video;
   *  this one then gets `pip.moved` and goes. */
  intoPane(park: boolean) {
    const of = pipProps().of;

    if (of === undefined) return;

    const before = new Set(panes().map((p) => p.pane));
    const f = focused();
    const args = f?.pane ? { direction: "right", pane: f.pane } : { edge: "right" };

    // A chip is made parked (park: true): it never takes a place in the tab, so
    // no pane shows up among the others for a moment.
    run("pane.split", park ? { ...args, mod: MOD, props: { of, pane: true, park: true }, park: true } : { ...args, mod: MOD, props: { of, pane: true } });
    // Noted when the new pane takes the video (`pip.moved`).
    this.made = { of, before, park };
  }

  /** Notes the pane `intoPane` made, for it to find itself. */
  noteMade() {
    const m = this.made;

    this.made = null;

    const made = m ? panes().find((p) => !m.before.has(p.pane) && p.mod === MOD) : undefined;

    if (m && made) writeShared(setShared, PANE, { of: m.of, pane: made.pane, park: m.park });
  }

  controls(): readonly Control[] {
    return CONTROLS.filter((c) => !(c.window && this.inPane));
  }

  /** A control's mark at text size `size`: its svg, or its glyph lifted onto the middle line (GLYPH_DROP). */
  mark(c: Control, color: Color, s: PlayerState, size = 11): Element {
    if ("icon" in c.mark) return svg(`${ICONS}/${c.mark.icon(s)}.svg`).size(12).text_color(color);

    const glyph = label(c.mark.glyph, s);

    return div().relative().top(-lift(glyph, size)).text_color(color).child(glyph);
  }

  /** Under the pointer: bright on the hover color, its `name` in the title. */
  hovers<E extends Element>(el: E, id: string, name: string): E {
    return el.on_hover((h, cx) => {
      if (h) this.hover = { id, name };
      else if (this.hover?.id === id) this.hover = null;
      cx.notify();
    });
  }

  button(t: Theme, c: Control) {
    const s: PlayerState = { playing: this.playing, muted: this.muted, snap: snapOn() };
    const on = this.hover?.id === c.id;

    return this.hovers(div().id(`pip-${c.id}`).flex_none().w(BAR).h_full().flex().items_center().justify_center()
      .when(on, (el) => el.bg(t.ansi0)), c.id, label(c.name, s))
      // A press on a button isn't a drag of the window.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.command(c.id); cx.notify(); })
      .child(this.mark(c, on ? t.foreground : c.lit?.(s) ? t.accent : t.dim, s));
  }

  /** ⋯: the controls that didn't fit, as a popup under the pointer. */
  more(t: Theme, ids: readonly ControlId[]) {
    const on = this.hover?.id === "more";

    return this.hovers(div().id("pip-more").flex_none().w(BAR).h_full().flex().items_center().justify_center()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.ansi0)), "more", "More")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.openMore(ids); })
      .child("⋯");
  }

  openMore(ids: readonly ControlId[]) {
    const parts = sections(CONTROLS.filter((c) => ids.includes(c.id))).length;

    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: 240, height: ids.length * ROW + Math.max(0, parts - 1) * RULE + 10,
      props: { menu: ids, playing: this.playing, muted: this.muted, snap: snapOn() } });
  }

  bar(t: Theme) {
    const { shown, more } = fit(this.controls(), this.width);
    // Section by section, a seam between; the ⋯ goes before ✕, the last on the bar.
    const items: Element[] = sections(shown).flatMap((part, i) => [...(i ? [seam(t)] : []), ...part.map((c) => this.button(t, c))]);

    if (more.length) items.splice(items.length - 1, 0, this.more(t, more.map((c) => c.id)));

    // The bar's edge turns blue while the player has the keyboard.
    return h_flex().id("pip-bar").h(BAR).flex_none().pl(8).items_center().text_size(11).bg(t.background)
      .border_b(1).border_color(this.handle?.is_focused() ? t.accent : t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(this.error !== null ? t.blocked : this.hover ? t.foreground : t.dim)
        .child(this.error ?? this.hover?.name ?? "picture in picture"))
      .children(items);
  }

  override render() {
    const t = theme();

    if (this.keysList) return this.renderKeys(t);

    if (this.menu !== null) return this.renderMenu(t);

    const of = pipProps().of;

    const body = available() && of !== undefined
      ? herdr.nativeView.new(ID, { kind: "pip", of }).child(div().size_full().bg("#000000"))
      : div().size_full().flex().items_center().justify_center().text_size(11).text_color(t.dim).child("Picture in picture needs native views (macOS).");

    const handle = this.handle;

    return v_flex().id("pip").size_full().bg(t.background).when(!this.inPane, (el) => el.border(1).border_color(t.border))
      .when(handle !== null, (el) => (handle ? el.track_focus(handle).on_key_down((e, cx) => this.key(e, cx)).on_mouse_down("left", () => handle.focus()) : el))
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .child(this.bar(t))
      .child(div().flex_1().min_h(0).relative().child(body));
  }

  // ---- the ⋯ menu (props { menu: control ids, playing, muted })

  initMenu(cx: AsyncContext) {
    this.cursor = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  pick(c: Control) {
    closeOwn();
    // To the player (commands reach the shown copies; this one ignores them).
    run(`pip.${c.id}`);
  }

  /** The keys, keyhelp.ts's overview in a popup: ? esc q close it. A popup is
   *  as tall as what's in it, and the overview fills its host absolutely (it
   *  adds no height): so the host is as tall as the list itself, KEYS_H. */
  renderKeys(t: Theme) {
    const handle = this.handle;
    const view = div().id("pip-keys").relative().w_full().h(KEYS_H).flex_none().bg(t.background).border(1).border_color(t.ansi0);

    return (handle ? view.track_focus(handle) : view)
      .on_key_down((e, cx) => { if (keysKey(e, true)) { cx.stop_propagation(); closeOwn(); } })
      .child(keysView(t, { id: "pip-keys-view", title: "picture in picture", list: KEYS, narrow: true, close: closeOwn }));
  }

  renderMenu(t: Theme) {
    const menu = this.menu ?? [];
    const p = pipProps();
    const s: PlayerState = { playing: p.playing === true, muted: p.muted === true, snap: snapOn() };
    const items = CONTROLS.filter((c) => menu.includes(c.id));

    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1));

    const row = (c: Control, i: number) => {
      const on = i === this.cursor;

      return h_flex().id(`pm-${c.id}`).relative().h(ROW).px(12).gap(10).items_center().flex_none().text_size(12)
        .text_color(on ? t.foreground : t.muted)
        .on_hover((h, cx) => { if (h) { this.cursor = i; cx.notify(); } })
        .on_click(() => this.pick(c))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().w(14).flex_none().flex().items_center().justify_center().child(this.mark(c, on || c.lit?.(s) ? t.accent : t.dim, s, 12)))
        .child(div().relative().flex_1().min_w(0).truncate().child(label(c.name, s)));
    };

    const handle = this.handle;
    const view = v_flex().id("pip-menu").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4);

    return (handle ? view.track_focus(handle) : view)
      .on_key_down((e, cx) => {
        const k = e.key;
        const to = menuMove(k, this.cursor, items.length);

        if (to !== null) {
          this.cursor = to;

          return cx.notify();
        }

        const picked = items[this.cursor];

        if (k === "enter" && picked) return this.pick(picked);

        if (k === "escape" || k === "q") closeOwn();
      })
      .children(sections(items).flatMap((part, n) => [
        // The bar's seam lying down: as quiet, and short of the edges.
        ...(n ? [div().relative().h(RULE).flex_none().mx(24).child(div().absolute().left(0).right(0).top(4).h(1).child(dither(seamTone(t), 1)))] : []),
        ...part.map((c) => row(c, items.indexOf(c))),
      ]));
  }
}
