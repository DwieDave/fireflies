// The script runner's deck, in Nocturne's look: one square popover under the
// tab strip's ▶ (../nocturne/scripts.ts), or centered from cmd-shift-r.
//
//   head     ▶ Scripts and the folder they come from: the space's own
//            folder, else the focused pane's (props { folder, on })
//   runs     every run (runs.ts), running first, a pip and a count per
//            state in the header; each row a pip in its state's color, name, runner, running / ok / exit N / stopped, how long; the row
//            under the cursor or pointer shows three chips (runChips): watch
//            (w), again (R) and, set apart, remove (x) or stop (x) while it
//            runs; ending a running one (stop, again) asks first (ask)
//   filter   type to fuzzy-match; ↑↓ move through runs and scripts alike
//   scripts  what the folder can run (detect.ts), grouped by manifest with
//            the runner as a badge; the last ones run here come first
//   foot     what the cursor is on and its keys, as caps
//
// The list has the keyboard (the deck's own focus handle) from the moment it
// opens: up/down or j/k move, enter runs a script in the background (a
// terminal with no pane) and closes the deck, shift-enter runs it and floats
// its terminal to watch. On a run: enter watches, cmd/ctrl-backspace stops
// (or dismisses), cmd/ctrl-r runs it again. "/" goes to the filter (only "/":
// letters are the list's keys); there up/down still move and enter runs, and
// esc clears the filter, then gives the keyboard back to the list. Esc on the
// list closes (an ended run's output: back first). props.focus "runs" starts
// the cursor on the runs.
//
// More keys on the list: g / G (home / end) the first / last row, pgup /
// pgdn a page, tab / shift-tab the next / previous group (the runs, then each
// manifest's scripts); on a run w watches, x stops (or dismisses), R runs it
// again; q closes; ? lists every key. An ended run's output scrolls with j/k
// ↑↓, pgup/pgdn and g/G; o opens the App Management setting when its hint
// shows. scripts.focus gives the deck the keyboard back.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, hc, home, nextCommand, notify, props, settings, shared, setShared, theme, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, parseJson, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import { isRecord } from "./guards.ts";
import type { Row, Script } from "./detect.ts";
import { PROBE, parseProbe, detect, isScript, rank } from "./detect.ts";
import type { Sys } from "./nix.ts";
import { FLAKE_SHOW, NO_SYS, nixScripts, oldId, APP_MANAGEMENT, needsAppManagement } from "./nix.ts";
import type { Run, Tone } from "./runs.ts";
import { allRuns, elapsed, isControl, tone, start, watch, stop, dismiss, restart } from "./runs.ts";
import type { KeyRow } from "./keyhelp.ts";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.ts";

const ART = "mods/nocturne/art";

/** What the deck is opened with: by the tab strip ({ folder, on, focus,
 *  show?, again? }, ../nocturne/scripts.ts toggleDeck), or as the bar of a
 *  switch's password window ({ password: address, name }, ../nocturne/prompt.ts). */
const isDeckProps = object({}, {
  overlay: isString,
  folder: nullable(isString),
  on: nullable(isString),
  focus: isString,
  show: isString,
  again: isBoolean,
  password: isString,
  name: isString,
});

type DeckProps = Guarded<typeof isDeckProps>;

const NO_PROPS: DeckProps = {};

const deckProps = (): DeckProps => {
  const p = props();

  return isDeckProps(p) ? p : NO_PROPS;
};

// The tab strip's note that the deck is open (../nocturne/scripts.ts DECK).
const DECK = sharedKey("scripts.deck", nullable(object({ id: isString, beat: isNumber })));

// The switch password windows ../nocturne/prompt.ts opens, by run: this copy
// is the bar of one when props has { password: address, name }. Each is
// { id } (the window, null while it opens) or { closed: true } (cancelled here).
const PROMPTS = sharedMapKey("scripts.prompts", oneOf(object({ id: nullable(isString) }), object({ closed: literal(true) })));

// The deck's key context and its esc (init).
const CONTEXT = "NocturneScriptsDeck";
const ESCAPE = "nocturne_scripts_escape";

// The last scripts run per folder, newest first: { "<machine>:<folder>": [id] }.
const RECENT = sharedMapKey("scripts.recent", arrayOf(isString));

// What each folder had last time, shown at once while it's looked at again.
const FOUND = sharedMapKey("scripts.found", arrayOf(isScript));

// Each flake's last `nix flake show --json`: { "<machine>:<folder>": { at, show } }.
const FLAKE = sharedMapKey("scripts.flake", object({ show: isRecord }, { at: isNumber }));

// A flake evaluated this recently isn't evaluated again on the next open.
const FLAKE_FRESH = 30000;

const H = 470;
const HEAD = 36, SECTION = 24, ROW = 26, INPUT = 32, FOOT = 26, RUNS_SHOWN = 5;

// A run's chips (runChips): their height, the most room they take (asking
// "again?" the widest), and how long a "stop?" / "again?" waits for the
// second press (ms).
export const CHIP = 20, CHIPS_W = 140, ASK_MS = 3000;

const ICON = (n: string) => `mods/workspace-chrome/${n}.svg`;
const OWN = (n: string) => `mods/scripts/${n}.svg`;

/** The keys entry where ? types (the filter): cmd-k then ?, as in the editor. */
const CHORD = "cmd-k ?";

/** A run's state in the theme's colors. */
function toneColor(t: Theme, k: Tone): Color {
  switch (k) {
    case "running": return t.working;
    case "ok": return t.done;
    case "failed": return t.blocked;
    case "stopped": return t.dim;
  }
}

// The dither fill, copied from ../nocturne/kit.ts (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

const eyebrow = (t: Theme, text: string) => div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());

function short(folder: string | null) {
  if (!folder) return "";

  const h = home();

  return folder === h ? "~" : folder.startsWith(h + "/") ? "~" + folder.slice(h.length) : folder;
}

/** What a script row says beside its name: what it runs (package.json's
 *  line, a recipe's parameters), else its command when that says more than
 *  "<runner> <name>". */
function aside(s: Script) {
  if (s.hint) return s.hint;

  const plain = [`${s.runner} ${s.name}`, `${s.runner} run ${s.name}`, `${s.runner} task ${s.name}`];

  return plain.includes(s.cmd) ? "" : s.cmd;
}

/** `line` without its terminal escapes (ESC [ … a letter). */
function plain(line: string) {
  let out = "";

  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\u001b" && line[i + 1] === "[") {
      let j = i + 2;

      while (/[0-9;?]/.test(line[j] ?? "")) j++;

      if (/[A-Za-z]/.test(line[j] ?? "")) { i = j; continue; }
    }

    out += line[i] ?? "";
  }

  return out;
}

/** What ? lists (`cmd`: ⌘ or ctrl-): every key onKey() takes, the keys entry last. */
export const deckKeys = (cmd: string): KeyRow[] => [
  ["j k ↑ ↓", "move"], ["g G home end", "first / last"], ["pgup pgdn", "a page"], ["tab ⇧tab", "next / previous group"],
  ["enter", "run in the background · watch a run"], ["⇧enter", "run and watch it"], ["/", "filter (esc clears, again: back)"],
  ["w", "watch the run · an ended one's output"], [`x ${cmd}⌫`, "remove an ended run · stop a running one (twice)"], [`R ${cmd}R`, "run it again (a running one: twice)"],
  ["j k pgup pgdn", "a run's output: scroll"], ["g G", "a run's output: top / end"], ["o", "a run's output: the setting it asks for"],
  ["esc ⌫ h ←", "a run's output: back to the list"], ["q esc", "close"], [`? ${CHORD}`, "keys (cmd-k ? while filtering)"],
];

/** What a run's chips and keys do. */
type Act = "watch" | "stop" | "dismiss" | "again";

/** The presses that ask first on a running one (ASK_MS). */
type Asked = "stop" | "again";

/** A press asked for: the same one again on the same run before `until` does it. */
interface Asking {
  readonly what: Asked;
  readonly address: string;
  readonly until: number;
}

/** An ended run's output, shown in place of the scripts. */
interface Output {
  readonly r: Run;
  /** Its last lines; null while they're read. */
  lines: string[] | null;
  /** Lines scrolled back from the end. */
  back: number;
  /** It failed for want of App Management (nix.ts APP_MANAGEMENT). */
  grant: boolean;
  /** Lines that fit (outputView); null before its first draw. */
  shown: number | null;
  /** The cursor was put on its run. */
  placed: boolean;
}

/** One row the cursor moves over: a run, then the scripts. */
type Item = { readonly kind: "run"; readonly r: Run } | { readonly kind: "script"; readonly row: Row };

/** A run's control (chip). */
interface Chip {
  readonly mark: string;
  readonly key: string;
  readonly tip: string;
  readonly color?: Color | null;
  readonly asking?: boolean;
  readonly ask?: string;
}

/** The bar of a switch's password window: its run and its name. */
interface PasswordBar {
  readonly address: string;
  readonly name: string;
}

/** Where a script row and its group's head sit in the list. */
interface Top {
  readonly head: boolean;
  readonly title: number;
  readonly row: number;
}

export default class ScriptsDeck extends View {
  /** The deck's esc is bound once, for every copy. */
  static bound = false;

  bar: PasswordBar | null = null;
  folder: string | null = null;
  on: string | null = null;
  key = ":";
  scripts: readonly Script[] | null = null;
  base: Script[] | null = null;
  sys: Sys = NO_SYS;
  looking = true;
  failed: string | null = null;
  nix: "evaluating" | "failed" | "missing" | null = null;
  query = "";
  cursor = -1; // -1: the first script, once there are any
  output: Output | null = null; // an ended run's output, shown in place of the scripts
  again = false;
  hover: string | null = null;
  scroll = 0;
  help = false; // ? lists the keys in place of the scripts
  page = 8; // rows in a page (render)
  // The filter is typed through the deck's own key handler ("/" starts it),
  // not a text input: an input's own bindings take up, down, enter and esc
  // before any handler around it sees them.
  typing = false;
  handle: FocusHandle | null = null;
  asking: Asking | null = null;
  items: Item[] = [];
  moved = false;
  gone = false;
  chord = 0;

  override init(_p: Props | undefined, cx: AsyncContext) {
    const p = deckProps();

    if (p.password !== undefined) {
      this.bar = { address: p.password, name: p.name ?? "switch" };

      return;
    }

    this.folder = p.folder ?? null;
    this.on = p.on ?? null;
    this.key = `${this.on ?? ""}:${this.folder ?? ""}`;
    this.scripts = readSharedMap(shared, FOUND).get(this.key) ?? null;
    this.cursor = p.focus === "runs" ? 0 : -1;
    // Opened by nocturne.scripts-again: runs this folder's last script once it's found.
    this.again = p.again ?? false;

    // Opened from a failure's toast: straight to that run's output.
    const shown = p.show === undefined ? undefined : allRuns().find((r) => r.address === p.show);

    if (shown && !shown.live) this.showOutput(shown, cx);

    // The deck has the keyboard, again a moment later in case the overlay's
    // frame took it back while the deck loaded.
    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();

    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => handle.focus());

    // scripts.focus (overlay.focus hands it): the keyboard back here.
    // scripts.keys: its ? list, as ? (or cmd-k ?) shows it.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^scripts\./, "");

        if (c === "focus") handle.focus();
        else if (c === "keys") { this.help = !this.help; cx.notify(); }
      }
    });

    // Esc is the overlay's (it closes it) before any key handler sees it:
    // bound to an action in the deck's key context, it's the deck's.
    if (!ScriptsDeck.bound) {
      try {
        cx.bind_keys([{ keystroke: "escape", action: ESCAPE, context: CONTEXT }]);
        ScriptsDeck.bound = true;
      } catch { /* esc then closes the deck, as the overlay's */ }
    }

    this.beat();
    // Elapsed times tick; the strip learns the deck is still open.
    cx.timer.every(1000, (cx) => {
      this.beat();

      if (allRuns().some((r) => r.live)) cx.notify();
    });
    this.look(cx);
  }

  beat() {
    const id = deckProps().overlay;

    if (id !== undefined) writeShared(setShared, DECK, { id, beat: Date.now() });
  }

  /** Reads the folder's manifests (one probe) and keeps what it found. */
  look(cx: AsyncContext) {
    const folder = this.folder;

    if (!folder) {
      this.looking = false;

      return;
    }

    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", PROBE], { cwd: folder, on: this.on, timeout: 15000 });
        const probe = parseProbe(r.stdout);

        this.sys = probe.sys;
        this.base = detect(probe);
        this.failed = null;
        this.merge();

        if (probe.ls.has("flake.nix")) this.evalFlake(cx, folder);

        this.runAgain();
      } catch (cause: unknown) {
        this.failed = cause instanceof Error ? cause.message : String(cause);
      }

      this.looking = false;
      cx.notify();
    });
  }

  /** nocturne.scripts-again: the last script picked here, picked again. */
  runAgain() {
    if (!this.again) return;

    this.again = false;

    const last = this.recent()[0];
    const s = this.scripts?.find((x) => x.id === last);

    if (s) this.go(s, false);
    else notify({ title: "nothing to run again", body: `no script picked in ${short(this.folder)} yet`, level: "info" });
  }

  /** The folder's scripts and its flake's (the last evaluation), each group
   *  together in the order it first shows up; kept for the next open. */
  merge() {
    const show = readSharedMap(shared, FLAKE).get(this.key)?.show;
    const all = [...(this.base ?? []), ...(show ? nixScripts(show, this.sys) : [])];
    // A group holding this machine's own configuration leads.
    const groups = [...new Set(all.map((s) => s.group))];
    const mine = new Set(all.flatMap((s) => (s.here ? [s.group] : [])));
    const order = [...groups.filter((g) => mine.has(g)), ...groups.filter((g) => !mine.has(g))];
    const scripts = order.flatMap((g) => all.filter((s) => s.group === g));
    const found = new Map(readSharedMap(shared, FOUND));

    this.scripts = scripts;
    found.delete(this.key);
    // The last dozen folders, the newest last.
    writeSharedMap(setShared, FOUND, new Map([...[...found].slice(-11), [this.key, scripts]]));
  }

  /** `nix flake show` in the background: the picker shows the last result
   *  meanwhile, and keeps it when nix is missing or the evaluation fails. */
  evalFlake(cx: AsyncContext, folder: string) {
    const last = readSharedMap(shared, FLAKE).get(this.key);

    if (last && Date.now() - (last.at ?? 0) < FLAKE_FRESH) return;

    this.nix = "evaluating";
    cx.spawn(async (cx) => {
      try {
        const r = await exec("nix", FLAKE_SHOW, { cwd: folder, on: this.on, timeout: 180000 });
        const show = r.code === 0 ? parseJson(r.stdout, isRecord) : undefined;

        if (show) {
          const all = new Map(readSharedMap(shared, FLAKE));

          all.delete(this.key);
          writeSharedMap(setShared, FLAKE, new Map([...[...all].slice(-11), [this.key, { at: Date.now(), show }]]));
          this.nix = null;
          this.merge();
        } else this.nix = "failed";
      } catch {
        this.nix = "missing";
      }

      cx.notify();
    });
  }

  dismissDeck() {
    const id = deckProps().overlay;

    if (id !== undefined) closeOverlay(id);
  }

  /** The overlay is going, however it goes. */
  override async close() {
    if (readShared(shared, DECK, null)?.id === deckProps().overlay) writeShared(setShared, DECK, null);
  }

  recent() {
    return (readSharedMap(shared, RECENT).get(this.key) ?? []).map(oldId);
  }

  /** Runs a script in the background; `look`: float its terminal too. The
   *  strip does the starting (runs.ts start queues it), so the deck can close
   *  at once without taking the start with it. */
  go(s: Script, look: boolean) {
    const ids = [s.id, ...this.recent().filter((x) => x !== s.id)].slice(0, 20);

    writeSharedMap(setShared, RECENT, new Map([...readSharedMap(shared, RECENT), [this.key, ids]]));
    start(s, this.folder, this.on, look);
    this.dismissDeck();
  }

  act(what: Act, r: Run, cx: Context) {
    // A run that ended has no terminal to float: its output shows here instead.
    if (what === "watch" && !r.live) return this.showOutput(r, cx);

    if (what === "watch") {
      this.dismissDeck();

      return watch(r);
    }

    // Ending a running one (stop, or again: it's stopped first) asks: the
    // same press again within ASK_MS does it.
    if (r.live && (what === "stop" || what === "again") && !this.asked(what, r)) return this.ask(what, r, cx);

    this.asking = null;

    // Queued for the strip (runs.ts), like a start: closing the deck can't cut them short.
    if (what === "stop") stop(r);
    else if (what === "dismiss") dismiss(r);
    else if (what === "again") restart(r);

    cx.notify();
  }

  /** The press `what` on `r` was asked for and is still fresh. */
  asked(what: Asked, r: Run) {
    const a = this.asking;

    return a !== null && a.what === what && a.address === r.address && Date.now() < a.until;
  }

  /** Asks before ending a running one: its chip says "stop?" / "again?" for ASK_MS. */
  ask(what: Asked, r: Run, cx: Context) {
    this.asking = { what, address: r.address, until: Date.now() + ASK_MS };
    cx.timer.after(ASK_MS + 50, (cx) => {
      if (this.asking && Date.now() >= this.asking.until) { this.asking = null; cx.notify(); }
    });
    cx.notify();
  }

  /** Shows an ended run's last output lines in place of the scripts (esc: back). */
  showOutput(r: Run, cx: Context) {
    this.output = { r, lines: null, back: 0, grant: false, shown: null, placed: false };
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await hc(["read", r.address, "--lines", "300"]).catch(() => null);

      const now = this.output;

      if (now === null || now.r.address !== r.address) return;

      const text = res?.code === 0 ? res.stdout : null;

      now.lines = text === null ? ["(its output is gone)"] : text.replace(/\s+$/, "").split("\n");
      now.grant = needsAppManagement(r, text);
      cx.notify();
    });
  }

  /** The output panel: the run's state, then its lines, the last ones at the bottom. */
  outputView(t: Theme, h: number, o: Output) {
    const { r, lines, back, grant } = o;
    const LINE = 15, HINT = 88;
    const shown = Math.max(1, Math.floor((h - SECTION - 12 - (grant ? HINT : 0)) / LINE));
    const all = lines ?? ["reading…"];
    const end = Math.max(0, all.length - back);
    const view = all.slice(Math.max(0, end - shown), end);

    o.shown = shown;

    return v_flex().id("output").h(h).flex_none()
      .on_scroll_wheel((e, cx) => {
        const step = Math.round(-e.delta.y / LINE);

        if (!step) return;

        o.back = Math.max(0, Math.min(all.length - shown, back - step));
        cx.notify();
      })
      .child(h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center().text_size(11)
        .child(this.action(t, "out-back", "‹ back", null, (cx) => { this.output = null; cx.notify(); }))
        .child(div().flex_none().text_color(t.foreground).child(r.name))
        .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().flex_none().text_color(t.dim).child(back ? `${back} lines up` : "the end")))
      .when(grant, (el) => el.child(this.grantHint(t, r, HINT)))
      .child(v_flex().flex_1().min_h(0).overflow_hidden().px(12).pt(6).pb(6).justify_end()
        .children(view.map((l, i) => div().id(`ol-${i}`).h(LINE).flex_none().text_size(11).text_color(t.muted).truncate()
          .child(plain(l).replace(/ /g, " ") || " "))));
  }

  /** Why a nix-darwin switch couldn't update its apps, and the way to fix it
   *  (nix.ts APP_MANAGEMENT): open the setting and show Herdr Core in Finder. */
  grantHint(t: Theme, r: Run, h: number) {
    return v_flex().id("grant").h(h).flex_none().mx(12).mt(6).px(10).py(6).gap(4)
      .border(1).border_color(t.blocked)
      .child(h_flex().h(22).flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child("Couldn't update Nix Apps"))
        .child(div().id("grant-open").flex_none().h(22).px(8).flex().items_center().text_size(11)
          .bg(t.ansi0).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.ansi8))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); openGrant(r); })
          .child("Open settings")))
      .child(div().text_size(11).line_height("15px").text_color(t.foreground).child(`${APP_MANAGEMENT.hint}.`));
  }

  // ---- parts

  /** A word that acts on a click (‹ back, cancel): dim, lit under the pointer. */
  action(t: Theme, id: string, label: string, color: Color | null, go: (cx: Context) => void) {
    return div().id(id).relative().flex_none().px(3).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(color ?? t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
      .child(label);
  }

  pip(color: Color, live: boolean) {
    const el = svg(`${ART}/pip.svg`).size(6).flex_none().text_color(color);

    return live ? el.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : el;
  }

  badge(t: Theme, text: string, on: boolean, w?: number) {
    const el = div().flex_none().h(14).px(4);

    return (w === undefined ? el : el.w(w).justify_center()).flex().items_center()
      .border(1).border_color(on ? t.ansi8 : t.ansi0).text_size(9).text_color(on ? t.muted : t.dim).child(text);
  }

  section(t: Theme, label: string, aside: string | Element | null) {
    const head = h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center()
      .child(eyebrow(t, label))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)));

    if (aside === null || aside === "") return head;

    return head.child(isString(aside) ? div().flex_none().text_size(10).text_color(t.dim).child(aside) : aside);
  }

  /** The row under the cursor: a dithered band and a blue edge, like Nocturne's menus. */
  band(el: Element, t: Theme, on: boolean) {
    return on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
  }

  /**
   * A run's control: a square chip CHIP px tall, its mark and its key, a frame
   * that lights under the pointer (in `color` for remove and stop). Asking
   * ("stop?"), it's filled in that color and says so. A tooltip names it.
   */
  chip(t: Theme, id: string, c: Chip, go: (cx: Context) => void) {
    const { mark, key, tip, color = null, asking = false, ask = "" } = c;
    const fill = color ?? t.foreground;

    return h_flex().id(id).relative().flex_none().h(CHIP).px(5).gap(4).items_center().text_size(10)
      .border(1).border_color(asking ? fill : t.ansi0).text_color(asking ? t.background : t.muted)
      .when(asking, (el) => el.bg(fill))
      .hover((s) => (asking ? s : s.border_color(color ?? t.ansi8).text_color(fill).bg(t.ansi0)))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
      // Asking, the word takes the chip ("stop?"); else its mark and its key.
      .when(!asking, (el) => el.child(svg(mark).size(11).flex_none().text_color(color ?? t.muted)))
      .child(div().flex_none().child(asking ? ask : key));
  }

  /** The chips on a run's row: watch and again, then set apart remove (stop while it runs). */
  runChips(t: Theme, r: Run, i: number) {
    const asked = (what: Asked) => this.asking?.address === r.address && this.asking.what === what && Date.now() < this.asking.until;

    return h_flex().id(`chips-${i}`).relative().max_w(CHIPS_W).flex_none().gap(4).items_center()
      .child(this.chip(t, `w-${i}`, { mark: ICON("eye"), key: "w", tip: r.live ? "Watch it (w, enter)" : "Its output (w, enter)" }, (cx) => this.act("watch", r, cx)))
      .child(this.chip(t, `a-${i}`, { mark: OWN("rotate-cw"), key: "R", tip: r.live ? "Run it again: stops this one first (R)" : "Run it again (R)", asking: asked("again"), ask: "again?", color: asked("again") ? t.working : null }, (cx) => this.act("again", r, cx)))
      // Set apart: a gap and a rule, so it isn't hit for its neighbours.
      .child(div().w(1).h(14).mx(4).flex_none().bg(t.ansi0))
      .child(r.live
        ? this.chip(t, `s-${i}`, { mark: ICON("square"), key: "x", tip: "Stop it (x, twice)", color: t.blocked, asking: asked("stop"), ask: "stop?" }, (cx) => this.act("stop", r, cx))
        : this.chip(t, `d-${i}`, { mark: ICON("x"), key: "x", tip: "Remove it from the list (x)", color: t.blocked }, (cx) => this.act("dismiss", r, cx)));
  }

  runRow(t: Theme, r: Run, i: number, on: boolean) {
    const color = toneColor(t, tone(r));
    const show = on || this.hover === `r${i}`;

    return this.band(h_flex().id(`run-${i}`).relative().h(ROW).flex_none().px(12).gap(6).items_center().text_size(12)
      .text_color(on ? t.foreground : r.live ? t.muted : t.dim)
      .on_hover((h, cx) => {
        const k = h ? `r${i}` : this.hover === `r${i}` ? null : this.hover;

        if (k !== this.hover) { this.hover = k; cx.notify(); }
      })
      .on_click((_e, cx) => { this.cursor = i; this.act("watch", r, cx); }), t, on)
      .child(div().relative().w(8).flex_none().flex().items_center().child(this.pip(color, r.live)))
      .child(h_flex().relative().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().child(r.name))
        .when(Boolean(r.admin), (el) => el.child(this.lock(t, on))))
      // With its chips showing, they take the runner's badge's place, before
      // the status and the time: those stay in their columns on every row,
      // and only this row's name gives up room.
      .when(Boolean(r.runner) && !show, (el) => el.child(div().relative().child(this.badge(t, r.runner, on))))
      .when(show, (el) => el.child(this.runChips(t, r, i)))
      .child(div().relative().w(58).flex_none().text_size(11).truncate().text_color(r.reason === "killed" ? t.dim : color).child(r.word))
      .child(div().relative().w(46).flex_none().text_size(11).text_color(t.dim).flex().justify_end().child(elapsed(r)));
  }

  /** A script's name, the matched letters in blue. */
  name(t: Theme, text: string, hits: readonly number[], base: Color) {
    if (!hits.length) return div().truncate().text_color(base).child(text);

    const parts: [string, boolean][] = [];
    let cur = "", lit = false;

    [...text].forEach((ch, i) => {
      const h = hits.includes(i);

      if (h !== lit && cur) { parts.push([cur, lit]); cur = ""; }

      lit = h;
      cur += ch;
    });

    if (cur) parts.push([cur, lit]);

    return h_flex().min_w(0).overflow_hidden().children(parts.map(([s, h]) => div().flex_none().text_color(h ? t.accent : base).child(s.replace(/ /g, " "))));
  }

  scriptRow(t: Theme, row: Row, i: number, on: boolean, running: boolean) {
    const s = row.s;

    return this.band(h_flex().id(`sc-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_size(12)
      // Only a pointer that moved takes the cursor: one resting where the deck
      // opened would otherwise steal it from the keys.
      .on_hover((h, cx) => { if (h && this.moved && this.cursor !== i) { this.cursor = i; cx.notify(); } })
      .on_click((e) => { if (!this.gone) { this.gone = true; this.go(s, e.modifiers.shift); } }), t, on)
      .child(div().relative().child(this.badge(t, s.runner, on, 52)))
      .child(h_flex().relative().flex_none().max_w(250).min_w(0).gap(6).items_center()
        .child(this.name(t, s.name, row.hits, on ? t.foreground : t.muted))
        .when(Boolean(s.admin), (el) => el.child(this.lock(t, on)))
        .when(Boolean(s.here), (el) => el.child(div().flex_none().text_size(10).text_color(t.accent)
          .child((this.sys.os ?? "").toLowerCase() === "darwin" ? "this mac" : "this machine")))
        .when(running, (el) => el.child(this.pip(t.working, true))))
      // The name comes first; what it runs takes the room that's left.
      .child(h_flex().relative().flex_1().min_w(0).justify_end()
        .child(div().min_w(0).truncate().text_size(11).text_color(on ? t.muted : t.dim).child(aside(s))));
  }

  /** Runs as root (asks for a password first): a small pixel lock. */
  lock(t: Theme, on: boolean) {
    return svg(`${ART}/lock.svg`).size(9).flex_none().text_color(on ? t.working : t.dim);
  }

  /** A bar entry: the key in the accent, what it does dimmed (keyhelp.ts, as every Nocturne bar). */
  hint(t: Theme, id: string, key: string, what: string) {
    return hint(t, id, key, what);
  }

  /** The bar along the bottom: what the cursor is on, quietly, and the keys
   *  that act on it as caps. Never the raw shell line: that's what the
   *  script row's own aside is for. */
  foot(t: Theme, cur: Item | undefined) {
    const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

    const left = (...kids: Element[]) => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids);
    const keys = (...caps: (Element | null)[]) => h_flex().flex_none().gap(10).items_center().children(caps.flatMap((c) => (c === null ? [] : [c])));
    // Every bar ends with the keys entry: ?, or cmd-k ? while the filter takes what's typed.
    const help = keysHint(t, "k-help", this.help, () => { this.help = !this.help; }, this.typing ? CHORD : "?");

    if (this.help) return bar.child(left(div().text_color(t.dim).child("every key"))).child(keys(this.hint(t, "k-esc", "esc", "back"), help));

    if (this.output) {
      const r = this.output.r;

      return bar
        .child(left(div().flex_none().text_color(t.accent).child("↳"),
          this.badge(t, r.runner || "run", false),
          div().flex_none().text_color(toneColor(t, tone(r))).child(r.word),
          div().flex_none().text_color(t.dim).child(`after ${elapsed(r)}`)))
        .child(keys(this.output.grant ? this.hint(t, "k-grant", "o", "settings") : null, this.hint(t, "k-scroll", "j k", "scroll"), this.hint(t, "k-esc", "esc", "back"), help));
    }

    if (this.typing) {
      return bar
        .child(left(div().flex_none().text_color(t.accent).child("/"), div().min_w(0).truncate().text_color(t.muted).child(this.query ? `filtering "${this.query}"` : "type to filter")))
        .child(keys(this.hint(t, "k-enter", "enter", cur?.kind === "run" ? "watch" : "run"), this.hint(t, "k-esc", "esc", this.query ? "clear" : "list"), help));
    }

    if (!cur) return bar.child(left(div().truncate().text_color(t.dim).child(this.folder ? "" : "no folder here"))).child(keys(help));

    if (cur.kind === "run") {
      const r = cur.r;

      return bar
        .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted).child(r.name)))
        .child(keys(this.hint(t, "k-enter", "enter", r.live ? "watch" : "output"),
          this.hint(t, "k-stop", "x", this.asked("stop", r) ? "x: stop it" : r.live ? "stop" : "remove"),
          this.hint(t, "k-again", "R", "again"), help));
    }

    return bar
      .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted)
        .child(cur.row.s.admin ? "asks for your password" : "in the background")))
      .child(keys(this.hint(t, "k-run", "enter", "run"), this.hint(t, "k-watch", "⇧enter", "& watch"), help));
  }

  /** The runs header's aside: a pip and a count for each state there is. */
  tally(t: Theme, all: readonly Run[]) {
    const tones: readonly Tone[] = ["running", "failed", "ok", "stopped"];

    const parts = tones.flatMap((k) => {
      const c = all.filter((r) => tone(r) === k).length;

      return c ? [[k, c] as const] : [];
    });

    return h_flex().flex_none().gap(8).items_center().children(parts.map(([k, c]) => h_flex().id(`tally-${k}`).gap(4).items_center()
      .child(this.pip(toneColor(t, k), false))
      .child(div().text_size(10).text_color(k === "running" ? t.muted : t.dim).child(String(c)))));
  }

  empty(t: Theme) {
    const say = !this.folder ? "No folder here: open a space or focus a terminal in one."
      : this.failed ? `Couldn't look in ${short(this.folder)}: ${this.failed}`
      : this.looking && !this.scripts ? "looking…"
      : this.query ? `Nothing matches "${this.query}".`
      : `Nothing to run in ${short(this.folder)}: no package.json, justfile, Makefile, Cargo.toml, deno.json, pyproject.toml, Taskfile, mise.toml, composer.json, go.mod, scripts/ or bin/.`;

    return div().px(12).py(12).text_size(11).text_color(t.dim).child(say);
  }

  /** Enter (shift: and watch) on the cursor's item. */
  enter(shift: boolean, cx: Context) {
    const cur = this.items[this.cursor];

    if (!cur || this.gone) return;

    if (cur.kind === "run") return this.act("watch", cur.r, cx);

    this.gone = true;
    this.go(cur.row.s, shift);
  }

  /** Esc, one step at a time: the filter's text, the filter, an ended run's
   *  output, then the deck. */
  escape(cx: Context) {
    if (this.typing && this.query) this.filter("");
    else if (this.typing) this.typing = false;
    else if (this.output) this.output = null;
    else return this.dismissDeck();

    cx.notify();
  }

  /** The filter changed: the cursor starts over on what matches. */
  filter(q: string) {
    this.query = q;
    this.cursor = -1;
    this.scroll = 0;
  }

  /** Scrolls an ended run's output `d` lines (+: back, toward its start). */
  scrollOutput(o: Output, d: number) {
    const n = o.lines?.length ?? 0;

    o.back = Math.max(0, Math.min(Math.max(0, n - (o.shown ?? 1)), o.back + d));
  }

  /** Where each group starts in `items`: the runs, then each manifest's scripts. */
  groups(items: readonly Item[]) {
    return items.flatMap((it, i) => {
      const prev = items[i - 1];

      return prev === undefined || it.kind !== prev.kind || (it.kind === "script" && prev.kind === "script" && it.row.head !== prev.row.head) ? [i] : [];
    });
  }

  // Not `key`: that's the folder's cache key (init), and a method by that
  // name was shadowed by it, so no key ever reached here.
  onKey(e: KeyEvent, cx: Context, items: readonly Item[]) {
    const m = e.modifiers;
    const k = e.key.toLowerCase();
    const ch = e.key_char ?? "";
    const n = items.length;
    const cur = items[this.cursor];
    const cmd = m.platform || m.control;
    const move = (d: number) => { if (n) this.cursor = Math.max(0, Math.min(n - 1, this.cursor + d)); };
    const done = () => { cx.stop_propagation(); cx.notify(); };

    // cmd-k ?: the keys from anywhere, the filter too (where ? types), as the editor's.
    if (cmd && !m.alt && k === "k") {
      this.chord = Date.now();

      return done();
    }

    if (this.chord && Date.now() - this.chord < 2000 && ch === "?") {
      this.chord = 0;
      this.help = !this.help;

      return done();
    }

    this.chord = 0;

    if (this.help) {
      if (keysKey(e, true) || k === "enter") {
        this.help = false;

        return done();
      }

      return;
    }

    const o = this.output;

    if (o && !this.typing && !cmd && !m.alt) {
      const page = Math.max(1, (o.shown ?? 10) - 1);

      if (k === "down" || k === "j") this.scrollOutput(o, m.shift ? -page : -1);
      else if (k === "up" || k === "k") this.scrollOutput(o, m.shift ? page : 1);
      else if (k === "pagedown") this.scrollOutput(o, -page);
      else if (k === "pageup") this.scrollOutput(o, page);
      else if (k === "end" || (k === "g" && m.shift)) this.scrollOutput(o, -1e9);
      else if (k === "home" || k === "g") this.scrollOutput(o, 1e9);
      else if (k === "o" && o.grant) openGrant(o.r);
      else if (k === "escape" || k === "backspace" || k === "h" || k === "left") this.output = null;
      else if (k === "q") {
        cx.stop_propagation();

        return this.dismissDeck();
      }
      else if (ch === "?") this.help = true;
      else if (k === "/") { this.output = null; this.typing = true; }
      else return;

      return done();
    }

    if (k === "down" || k === "up") {
      move(k === "down" ? 1 : -1);

      return done();
    }

    if (k === "enter") {
      cx.stop_propagation();

      return this.enter(m.shift, cx);
    }

    if (k === "pagedown" || k === "pageup") {
      move((k === "pagedown" ? 1 : -1) * this.page);

      return done();
    }

    if (k === "tab") {
      const starts = this.groups(items);
      const next = m.shift ? [...starts].reverse().find((i) => i < this.cursor) : starts.find((i) => i > this.cursor);

      if (next !== undefined) this.cursor = next;

      return done();
    }

    if (this.typing) {
      if (k === "backspace") {
        this.filter(cmd || m.alt ? "" : [...this.query].slice(0, -1).join(""));

        return done();
      }

      if (!cmd && ch.length && ![...ch].some(isControl)) {
        this.filter(this.query + ch);

        return done();
      }

      if (k === "escape") {
        cx.stop_propagation();

        return this.escape(cx);
      }

      return;
    }

    if (k === "escape") {
      cx.stop_propagation();

      return this.escape(cx);
    }

    if (cmd && k === "backspace" && cur?.kind === "run") this.act(cur.r.live ? "stop" : "dismiss", cur.r, cx);
    // cmd-r; cmd-shift-r is the deck's own key (nocturne.scripts): it closes the deck.
    else if (cmd && k === "r" && !m.shift && cur?.kind === "run") this.act("again", cur.r, cx);
    else if (cmd || m.alt) return;
    else if (k === "j") move(1);
    else if (k === "k") move(-1);
    else if (k === "end" || (k === "g" && m.shift)) move(n);
    else if (k === "home" || k === "g") move(-n);
    else if (k === "w" && cur?.kind === "run") this.act("watch", cur.r, cx);
    else if (k === "x" && cur?.kind === "run") this.act(cur.r.live ? "stop" : "dismiss", cur.r, cx);
    else if (k === "r" && m.shift && cur?.kind === "run") this.act("again", cur.r, cx);
    else if (k === "q") {
      cx.stop_propagation();

      return this.dismissDeck();
    }
    else if (ch === "?") this.help = true;
    else if (k === "/" || ch === "/") { this.output = null; this.typing = true; }
    else return;

    done();
  }

  /** ? : every key of the deck, in place of the scripts (keyhelp.ts). */
  helpView(t: Theme, h: number) {
    const rows = deckKeys(appWindow().platform === "macos" ? "⌘" : "ctrl-");

    return div().id("deck-help").relative().h(h).flex_none()
      .child(keysView(t, { id: "deck-keys", title: "scripts", list: rows, close: () => { this.help = false; } }));
  }

  /** The bar of a switch's password window (../nocturne/prompt.ts): its name,
   *  and cancel, which presses ctrl-c in the run (it ends "cancelled"). */
  passwordBar(t: Theme, bar: PasswordBar) {
    const { address, name } = bar;

    const cancel = () => {
      writeSharedMap(setShared, PROMPTS, new Map([...readSharedMap(shared, PROMPTS), [address, { closed: true }]]));
      hc(["keys", address, "ctrl+c"]).catch(() => null);

      const overlay = deckProps().overlay;

      if (overlay !== undefined) closeOverlay(overlay);
    };

    return h_flex().id("pw-bar").size_full().px(12).gap(8).items_center().text_size(12)
      .child(svg(`${ART}/lock.svg`).size(9).flex_none().text_color(t.working))
      .child(div().flex_none().text_color(t.foreground).child(name))
      .child(div().flex_none().text_color(t.dim).child("· password"))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("type it, enter · ctrl-c cancels"))
      .child(this.action(t, "pw-cancel", "cancel", t.blocked, cancel));
  }

  override render() {
    const t = theme();

    if (this.bar) return this.passwordBar(t, this.bar);

    const all = allRuns();
    const rows = this.scripts ? rank(this.scripts, this.query, this.recent()) : [];
    const items: Item[] = [...all.map((r) => ({ kind: "run" as const, r })), ...rows.map((row) => ({ kind: "script" as const, row }))];

    // The cursor starts on the first script that needs no password: a stray
    // enter shouldn't ask for one.
    if (this.cursor < 0 || this.cursor >= items.length) {
      const safe = rows.findIndex((r) => !r.s.admin);

      this.cursor = rows.length ? all.length + Math.max(0, safe) : Math.max(0, Math.min(this.cursor, items.length - 1));
    }

    // The run whose output shows keeps the cursor.
    const o = this.output;

    if (o && !o.placed) {
      const i = all.findIndex((r) => r.address === o.r.address);

      if (i >= 0) this.cursor = i;

      o.placed = true;
    }

    this.items = items;

    const cur = items[this.cursor];
    const runningIds = new Set(all.flatMap((r) => (r.live && r.folder === this.folder ? [r.id] : [])));

    // The runs: up to RUNS_SHOWN rows tall; the rest scroll.
    const runsH = all.length ? SECTION + Math.min(all.length, RUNS_SHOWN) * ROW + 4 : 0;
    const listH = H - 2 - HEAD - runsH - INPUT - FOOT - 4;

    this.page = Math.max(1, Math.floor(listH / ROW) - 1);

    // The scripts: each row (and its group's head) at a fixed y, scrolled to keep the cursor in sight.
    const tops: Top[] = [];
    let y = 0;

    rows.forEach((r, i) => {
      const head = !this.query.trim() && (i === 0 || r.head !== rows[i - 1]?.head);

      tops.push({ head, title: y, row: y + (head ? SECTION : 0) });
      y += (head ? SECTION : 0) + ROW;
    });

    const max = Math.max(0, y - listH);
    const sel = cur?.kind === "script" ? tops[this.cursor - all.length] : undefined;

    if (sel) {
      const from = sel.head ? sel.title : sel.row;

      if (from < this.scroll) this.scroll = from;

      if (sel.row + ROW > this.scroll + listH) this.scroll = sel.row + ROW - listH;
    }

    this.scroll = Math.max(0, Math.min(this.scroll, max));

    const list: Element[] = [];

    rows.forEach((r, i) => {
      const top = tops[i];

      if (!top) return;

      const { head, title, row } = top;
      const vis = (a: number, b: number) => b > this.scroll && a < this.scroll + listH;
      const at = (el: Element, a: number, b: number) => el.absolute().left(0).right(0).top(a - this.scroll).h(b - a);

      if (head && vis(title, row)) {
        const runner = r.head === "recent" ? null : r.s.runner;

        list.push(at(div().id(`h-${i}`), title, row).child(this.section(t, r.head ?? "", runner)));
      }

      if (vis(row, row + ROW)) list.push(at(div().id(`r-${i}`), row, row + ROW).child(this.scriptRow(t, r, all.length + i, this.cursor === all.length + i, runningIds.has(r.s.id))));
    });

    const handle = this.handle;
    const deck = v_flex().id("scripts-deck").size_full().bg(t.background).border(1).border_color(t.ansi0);

    return (handle ? deck.track_focus(handle) : deck)
      .key_context(CONTEXT)
      .on_action(ESCAPE, (_e, cx) => this.escape(cx))
      // A click anywhere in it (a row too) leaves the keyboard here.
      .on_mouse_down("left", () => handle?.focus())
      .on_mouse_move(() => { this.moved = true; })
      .on_key_down((e, cx) => this.onKey(e, cx, items))
      .child(h_flex().relative().h(HEAD).flex_none().px(12).gap(10).items_center()
        .child(svg(`${ART}/play.svg`).size(9).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(12).text_color(t.foreground).child("Scripts"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).flex().justify_end().child(short(this.folder) + (this.on ? ` on ${this.on}` : "")))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .when(all.length > 0, (el) => el
        .child(this.section(t, "runs", this.tally(t, all)))
        .child(v_flex().id("runs").h(Math.min(all.length, RUNS_SHOWN) * ROW).flex_none().overflow_y_scroll()
          .children(all.map((r, i) => this.runRow(t, r, i, this.cursor === i))))
        .child(div().h(4).flex_none()))
      .when(this.help, (el) => el.child(this.helpView(t, INPUT + 4 + listH)))
      .when(!this.help && o !== null, (el) => (o ? el.child(this.outputView(t, INPUT + 4 + listH, o)) : el))
      .when(!this.help && !o, (el) => el.child(h_flex().relative().h(INPUT).flex_none().mx(12).gap(8).items_center()
        .on_mouse_down("left", (_e, cx) => { this.typing = true; cx.notify(); })
        .child(div().flex_none().text_size(12).text_color(this.typing ? t.accent : t.dim).child("/"))
        .child(h_flex().flex_1().min_w(0).h_full().items_center().text_size(12)
          .when(Boolean(this.query), (el) => el.child(div().flex_none().text_color(t.foreground).child(this.query.replace(/ /g, " "))))
          .when(this.typing, (el) => el.child(div().flex_none().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 })))
          .when(!this.query && !this.typing, (el) => el.child(div().text_color(t.dim).child("filter"))))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(this.nix === "evaluating" ? "nix…" : this.looking && this.scripts ? "looking…"
          : this.nix === "failed" ? `nix eval failed · ${rows.length}` : rows.length ? `${rows.length}` : ""))
        .child(div().absolute().left(0).right(0).bottom(0).h(1).opacity(0.6).child(dither(t.ansi8, 1)))))
      .child(rows.length
        ? div().id("scripts").relative().h(listH).flex_none().overflow_hidden().mt(4)
          .on_scroll_wheel((e, cx) => {
            this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, max));

            const first = all.length;

            while (this.cursor >= first && this.cursor < items.length - 1 && (tops[this.cursor - first]?.row ?? Infinity) < this.scroll) this.cursor++;

            while (this.cursor > first && (tops[this.cursor - first]?.row ?? -Infinity) + ROW > this.scroll + listH) this.cursor--;

            cx.notify();
          })
          .children(list)
        : v_flex().h(listH).flex_none().mt(4).child(this.empty(t)))
      .child(this.foot(t, cur));
  }
}

/** Opens the App Management setting and shows Herdr Core in Finder, on the run's machine. */
function openGrant(r: Run) {
  const on = { on: r.on };

  exec("sh", ["-c", APP_MANAGEMENT.open], on).catch(() => null);
}
