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

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { closeOverlay, nextCommand, shared, setShared, theme } from "herdr";
import type { Theme } from "herdr";
import { readShared, readSharedMap, writeShared } from "./guard.ts";
import type { Script } from "./detect.ts";
import { rank } from "./detect.ts";
import type { Sys } from "./nix.ts";
import { NO_SYS } from "./nix.ts";
import type { Run } from "./runs.ts";
import { allRuns } from "./runs.ts";
import type { KeyRow } from "./keyhelp.ts";
import { keysKey } from "./keyhelp.ts";
import { CHORD, deckProps, FOUND, ESCAPE, CONTEXT, DECK, SECTION, ROW, FOOT, RUNS_SHOWN, H, HEAD, INPUT } from "./state.ts";
import type { PasswordBar, Output, Asking, Item, Act } from "./state.ts";
import { lookForScripts, recent } from "./found.ts";
import { enterRow, escapeKey, groups, runAct, showOutput } from "./actions.ts";
import { emptyView, runRow, scriptRow, section, tally, placeRows } from "./rows-view.ts";
import { footBar, helpView, outputView, passwordBar, deckHead, filterLine } from "./bars.ts";
import { outputKey, typedKey } from "./input.ts";

/** What ? lists (`cmd`: ⌘ or ctrl-): every key onKey() takes, the keys entry last. */
export const deckKeys = (cmd: string): KeyRow[] => [
  ["j k ↑ ↓", "move"], ["g G home end", "first / last"], ["pgup pgdn", "a page"], ["tab ⇧tab", "next / previous group"],
  ["enter", "run in the background · watch a run"], ["⇧enter", "run and watch it"], ["/", "filter (esc clears, again: back)"],
  ["w", "watch the run · an ended one's output"], [`x ${cmd}⌫`, "remove an ended run · stop a running one (twice)"], [`R ${cmd}R`, "run it again (a running one: twice)"],
  ["j k pgup pgdn", "a run's output: scroll"], ["g G", "a run's output: top / end"], ["o", "a run's output: the setting it asks for"],
  ["esc ⌫ h ←", "a run's output: back to the list"], ["q esc", "close"], [`? ${CHORD}`, "keys (cmd-k ? while filtering)"],
];

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

    if (shown && !shown.live) showOutput(this, shown, cx);

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
    lookForScripts(this, cx);
  }

  beat() {
    const id = deckProps().overlay;

    if (id !== undefined) writeShared(setShared, DECK, { id, beat: Date.now() });
  }

  dismissDeck() {
    const id = deckProps().overlay;

    if (id !== undefined) closeOverlay(id);
  }

  /** The overlay is going, however it goes. */
  override async close() {
    if (readShared(shared, DECK, null)?.id === deckProps().overlay) writeShared(setShared, DECK, null);
  }

  act(what: Act, r: Run, cx: Context) {
    return runAct(this, what, r, cx);
  }

  // ---- parts

  /** The bar along the bottom: what the cursor is on, quietly, and the keys
   *  that act on it as caps. Never the raw shell line: that's what the
   *  script row's own aside is for. */
  foot(t: Theme, cur: Item | undefined) {
    return footBar(this, t, cur);
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
      if (outputKey(this, o, e, cx)) done();

      return;
    }

    if (k === "down" || k === "up") {
      move(k === "down" ? 1 : -1);

      return done();
    }

    if (k === "enter") {
      cx.stop_propagation();

      return enterRow(this, m.shift, cx);
    }

    if (k === "pagedown" || k === "pageup") {
      move((k === "pagedown" ? 1 : -1) * this.page);

      return done();
    }

    if (k === "tab") {
      const starts = groups(items);
      const next = m.shift ? [...starts].reverse().find((i) => i < this.cursor) : starts.find((i) => i > this.cursor);

      if (next !== undefined) this.cursor = next;

      return done();
    }

    if (this.typing) {
      if (typedKey(this, e, cx)) done();

      return;
    }

    if (k === "escape") {
      cx.stop_propagation();

      return escapeKey(this, cx);
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
  helpView(t: Theme, h: number): Element {
    return helpView(this, t, h);
  }

  override render() {
    const t = theme();

    if (this.bar) return passwordBar(t, this.bar);

    const all = allRuns();
    const rows = this.scripts ? rank(this.scripts, this.query, recent(this)) : [];
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

    const { tops, max } = placeRows(this, rows, cur, all.length, listH);

    const list: Element[] = [];

    rows.forEach((r, i) => {
      const top = tops[i];

      if (!top) return;

      const { head, title, row } = top;
      const vis = (a: number, b: number) => b > this.scroll && a < this.scroll + listH;
      const at = (el: Element, a: number, b: number) => el.absolute().left(0).right(0).top(a - this.scroll).h(b - a);

      if (head && vis(title, row)) {
        const runner = r.head === "recent" ? null : r.s.runner;

        list.push(at(div().id(`h-${i}`), title, row).child(section(t, r.head ?? "", runner)));
      }

      if (vis(row, row + ROW)) list.push(at(div().id(`r-${i}`), row, row + ROW).child(scriptRow(this, t, r, all.length + i, this.cursor === all.length + i, runningIds.has(r.s.id))));
    });

    const handle = this.handle;
    const deck = v_flex().id("scripts-deck").size_full().bg(t.background).border(1).border_color(t.ansi0);

    return (handle ? deck.track_focus(handle) : deck)
      .key_context(CONTEXT)
      .on_action(ESCAPE, (_e, cx) => escapeKey(this, cx))
      // A click anywhere in it (a row too) leaves the keyboard here.
      .on_mouse_down("left", () => handle?.focus())
      .on_mouse_move(() => { this.moved = true; })
      .on_key_down((e, cx) => this.onKey(e, cx, items))
      .child(deckHead(this, t))
      .when(all.length > 0, (el) => el
        .child(section(t, "runs", tally(this, t, all)))
        .child(v_flex().id("runs").h(Math.min(all.length, RUNS_SHOWN) * ROW).flex_none().overflow_y_scroll()
          .children(all.map((r, i) => runRow(this, t, r, i, this.cursor === i))))
        .child(div().h(4).flex_none()))
      .when(this.help, (el) => el.child(this.helpView(t, INPUT + 4 + listH)))
      .when(!this.help && o !== null, (el) => (o ? el.child(outputView(this, t, INPUT + 4 + listH, o)) : el))
      .when(!this.help && !o, (el) => el.child(filterLine(this, t, rows.length)))
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
        : v_flex().h(listH).flex_none().mt(4).child(emptyView(this, t)))
      .child(this.foot(t, cur));
  }
}
