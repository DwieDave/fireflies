// The processes and ports manager, in Nocturne's look: one square popover
// under the tab strip's tree mark (../nocturne/procs.ts), or centered from
// nocturne.procs / nocturne.ports and the palette. This machine only.
//
//   head       the tree mark, its three tabs (processes and ports with their
//              counts, system with the CPU now), and what's listed:
//              "fireflies" (this app's terminals) or "all of <user>'s" (a switches)
//   processes  a tree: space › tab › terminal › the terminal's process and
//              everything it started (shells, agents, dev servers, builds);
//              terminals without a pane under "no pane"; spaces on another
//              machine as a note. With a, every process of Developer's, each
//              whose parent isn't his (launchd's children) a root. Each row:
//              name, arguments (cut), the ports it listens on, cpu, memory,
//              how long it has run, pid. The selected row opens a detail
//              block, set apart with air above and below, a fainter dither
//              of its own and a dithered rule where it ends: the whole
//              command line (up to three lines; the wheel scrolls a longer
//              one), then pid and parent with show / copy / end / end
//              tree, then its cpu and memory. Rows above it never move as the
//              selection does; the ones below make room.
//   ports      the TCP ports his processes listen on, those in this app's
//              terminals first: port, process, where it runs; on the cursor's
//              row open ↗ (a web pane), copy (http://localhost:<port>), end
//   system     live graphs, dithered, the last minute and a half (a reading
//              a second while this tab shows, every 2 s behind the others,
//              none while the deck is closed; never two at once):
//              CPU, GPU, memory, disk and network, each with its value now
//              (sys.ts has the sources); a source this machine lacks says so
//   foot       what the cursor is on and its keys
//
// The selected process's detail block carries its own CPU and memory over
// the readings since the deck opened, as two small graphs.
//
// Ending asks first, in the deck: a red band under the row names what ends
// (and what's under it, for X). enter sends TERM; two seconds on, the ones
// still running are named and K sends KILL (esc leaves them). The app
// itself, herdr-core, its holders, launchd and other users' processes carry a
// shield and can't be ended from here (logic.ts guardOf).
//
// It reads everything once a refresh (logic.ts PROBE: ps and lsof), every
// 2 s while open; the cursor stays on its pid (or port) across refreshes.
//
// Keys (the deck has the keyboard from the moment it opens):
//   j k ↑ ↓ move · g G home end first / last · pgup pgdn a page
//   h ← fold, or up to the parent · l → unfold, or into the first child
//   space fold or unfold · enter: a group folds, a process or terminal shows
//   its terminal's pane, a port opens
//   tab 1 2 3 processes / ports / system · a this app's terminals / all of yours
//   x end · X end it and everything under it · K kill -9 what held on
//   o open the port in a web pane · c copy the address (a process: its
//   command line) · r read again now · / find (esc clears, again: back)
//   ? keys · q esc close
// procs.focus gives the deck the keyboard back; procs.keys
// shows its keys.
//
// By pointer, everything the keys do: the wheel scrolls the processes and the
// ports (a mouse's lines a row each, a trackpad's pixels as far as the
// fingers), and the cursor stays on its row (a key brings it back into sight);
// over a long command in the detail block it scrolls the command first. A
// click selects a row, a double click does what enter does, a click on a fold
// arrow folds. The scrollbar along a long list's right edge drags, and a
// press beside its thumb jumps there. The tabs and "fireflies" / "all of …"
// switch on a click, every key in the foot is a button (x end, X tree,
// / find, the find field itself, enter / esc on the ending band), and a port
// row shows open ↗ / copy / end while selected or under the pointer. The
// tree mark in the strip opens and closes the deck; a click outside closes it.

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { closeOverlay, exec, nextCommand, shared, setShared, theme } from "herdr";
import { readShared, writeShared } from "./guard.ts";
import { keysView, keysKey } from "./keyhelp.ts";
import type { Index, Probe, Row, TreeNode } from "./logic.ts";
import { PROBE, parseProbe, index } from "./logic.ts";
import type { Measured, Reading } from "./sys.ts";
import { SYS_PROBE, STEP, STEP_SHOWN, parseSys, measure, push } from "./sys.ts";
import type { Tab, History, Own, Cursors, Scrolls, Drag, Command, Ask, Note, Item } from "./state.ts";
import { deckProps, ESCAPE, CONTEXT, REFRESH, DECK, isTab, COUNT, TABS, PORTS_H, PROW, LIST_H, ROW, FOOT, HEAD, H, deckKeys } from "./state.ts";
import { listRows, moveTo, portList, procCount, procTree, rowAt, tabList } from "./listing.ts";
import { activate, begin, copyRow, escapeKey, foldRow, openPortAt, switchTab, toggleAll, askKey, findKey } from "./actions.ts";
import { dragTo } from "./pointer.ts";
import { procsView } from "./procs-view.ts";
import { systemView } from "./system-view.ts";
import { portsView } from "./ports-view.ts";
import { footBar, headBar } from "./bars.ts";

export default class ProcsDeck extends View {
  static bound = false;
  tab: Tab = "procs";
  // The system graphs' histories (sys.ts), the last reading's values, and each process's own.
  sys: History = { cpu: [], gpu: [], mem: [], disk: [], rx: [], tx: [] };
  now: Measured | null = null;
  sysReading: Reading | null = null;
  hist = new Map<number, Own>();
  all = false;
  snap: Probe | null = null;
  ix: Index | null = null;
  failed: string | null = null;
  // A folded node's key → true (one unfolded again: false).
  folds = new Map<string, boolean>();
  query = "";
  typing = false;
  cur: Cursors = { procs: { key: null, at: 0 }, ports: { key: null, at: 0 }, system: { key: null, at: 0 } };
  scroll: Scrolls = { procs: 0, ports: 0 };
  // The list keeps the cursor in sight until the wheel or the scrollbar moves it away; a key or a click brings it back.
  follow = true;
  drag: Drag | null = null;
  // The detail block's command: its scroll and its drawn height.
  cmd: Command = { pid: null, y: 0, h: 0 };
  ask: Ask | null = null;
  note: Note | null = null;
  help = false;
  hover: string | null = null;
  handle: FocusHandle | null = null;
  reading = false;
  sampling = false;
  sampled: number | null = null;
  treeCache: { snap: Probe; sig: string; tree: TreeNode[]; n: number } | null = null;
  rowsCache: { tree: readonly TreeNode[]; sig: string; rows: Row[] } | null = null;

  override init(_p: Props | undefined, cx: AsyncContext): void {
    const tab = deckProps().tab;

    this.tab = tab === "ports" || tab === "system" ? tab : "procs";

    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();

    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => handle.focus());

    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^procs\./, "");

        if (c === "focus") handle.focus();
        else if (c === "keys") {
          this.help = !this.help;
          cx.notify();
        }
      }
    });

    if (!ProcsDeck.bound) {
      try {
        cx.bind_keys([{ keystroke: "escape", action: ESCAPE, context: CONTEXT }]);
        ProcsDeck.bound = true;
      } catch {
        // esc then closes the deck, as the overlay's.
      }
    }

    this.beat();
    this.refresh(cx);
    this.sample(cx);
    cx.timer.every(REFRESH, (cx) => {
      this.beat();
      this.refresh(cx);
    });
    // Checked every quarter second, and as each reading ends: the next starts once its pace has
    // passed since the last began (the probe itself takes a second, so a plain timer would skip beats).
    cx.timer.every(250, (cx) => this.tick(cx));
  }

  focus(): void {
    this.handle?.focus();
  }

  /** The strip learns the deck is open (and which tab); a tab the strip asked for (nocturne.ports) is taken. */
  beat(): void {
    const id = deckProps().overlay;

    if (!id) return;

    const d = readShared(shared, DECK, null);

    if (d?.id === id && d.want && d.want !== this.tab && isTab(d.want)) {
      this.tab = d.want;
      this.ask = null;
    }

    writeShared(setShared, DECK, { id, tab: this.tab, beat: Date.now() });
  }

  /** One probe; the cursor stays on its row's key. */
  refresh(cx: Context): void {
    if (this.reading) return;

    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", PROBE], { timeout: 10000 });
        const snap = parseProbe(r.stdout);

        this.snap = snap;
        this.ix = index(snap.procs);
        this.track(snap.procs);
        this.failed = snap.procs.length ? null : (r.stderr || "ps printed nothing").trim();
        writeShared(setShared, COUNT, { at: Date.now(), n: portList(this).filter((x) => x.term).length });
      } catch (cause: unknown) {
        this.failed = cause instanceof Error ? cause.message : String(cause);
      }

      this.reading = false;
      cx.notify();
    });
  }

  /** Each process's cpu and memory, a reading a refresh (the gone ones forgotten). */
  track(procs: Probe["procs"]): void {
    const next = new Map<number, Own>();

    for (const p of procs) {
      const h = this.hist.get(p.pid);

      next.set(p.pid, { cpu: push(h?.cpu, p.cpu, 30), rss: push(h?.rss, p.rss, 30) });
    }

    this.hist = next;
  }

  /** The system readings' pace: a second while the system tab shows, else 2 s. */
  pace(): number {
    return this.tab === "system" ? STEP_SHOWN : STEP;
  }

  /** A system reading, when its pace has passed since the last began and none is running:
   *  a slow source holds the next one back instead of piling them up. */
  tick(cx: Context, now = Date.now()): void {
    if (!this.sampling && now - (this.sampled ?? 0) >= this.pace()) this.sample(cx);
  }

  /** One system reading (sys.ts SYS_PROBE, about a second: iostat measures one). */
  sample(cx: Context): void {
    if (this.sampling) return;

    this.sampling = true;
    this.sampled = Date.now();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SYS_PROBE], { timeout: 10000 });
        const reading = parseSys(r.stdout);
        const m = measure(reading, this.sysReading);

        this.sysReading = reading;
        this.now = m;

        const s = this.sys;

        s.cpu = push(s.cpu, m.cpu?.pct ?? null);
        s.gpu = push(s.gpu, m.gpu?.pct ?? null);
        s.mem = push(s.mem, m.mem?.pct ?? null);
        s.disk = push(s.disk, m.disk?.mbps ?? null);

        if (m.netSeen) {
          s.rx = push(s.rx, m.net?.rx ?? null);
          s.tx = push(s.tx, m.net?.tx ?? null);
        }
      } catch {
        // The graphs keep what they had.
      }

      this.sampling = false;
      cx.notify();
      this.tick(cx);
    });
  }

  dismissDeck(): void {
    const id = deckProps().overlay;

    if (id) closeOverlay(id);
  }

  /** The overlay is going, however it goes. */
  override close(): void {
    if (readShared(shared, DECK, null)?.id === deckProps().overlay) writeShared(setShared, DECK, null);
  }

  // ---- what's listed

  /** The rows on screen, made again only when the tree, a fold or the query changes. */
  rows(tree: readonly TreeNode[] = procTree(this)): Row[] {
    return listRows(this, tree);
  }

  list(): readonly Item[] {
    return tabList(this);
  }

  /** The cursor's index in `items`, kept on its key. */
  at(items: readonly Item[]): number {
    return rowAt(this, items);
  }

  // ---- actions

  onKey(e: KeyEvent, cx: Context): void {
    const m = e.modifiers;
    const k = e.key.toLowerCase();
    const ch = e.key_char ?? "";

    const done = (): void => {
      this.follow = true;
      cx.stop_propagation();
      cx.notify();
    };

    if (m.platform || m.control || m.alt) return;

    if (this.help) {
      if (keysKey(e, true) || k === "enter") {
        this.help = false;
        done();
      }

      return;
    }

    if (k === "escape") {
      cx.stop_propagation();
      escapeKey(this, cx);

      return;
    }

    if (this.ask) {
      askKey(this, this.ask, k, m, cx);
      done();

      return;
    }

    const items = this.list();
    const i = this.at(items);
    const item = items[i];
    const page = Math.max(1, Math.floor((this.tab === "ports" ? PORTS_H / PROW : LIST_H / ROW)) - 1);

    if (k === "down" || k === "up") {
      moveTo(this, items, i + (k === "down" ? 1 : -1));
      done();

      return;
    }

    if (k === "pagedown" || k === "pageup") {
      moveTo(this, items, i + (k === "pagedown" ? page : -page));
      done();

      return;
    }

    if (k === "tab") {
      switchTab(this, m.shift ? TABS[(TABS.indexOf(this.tab) + 2) % 3] : undefined, cx);
      done();

      return;
    }

    if (this.typing) {
      if (findKey(this, k, ch)) done();

      return;
    }

    if (k === "j") moveTo(this, items, i + 1);
    else if (k === "k" && !m.shift) moveTo(this, items, i - 1);
    else if (k === "end" || (k === "g" && m.shift)) moveTo(this, items, items.length - 1);
    else if (k === "home" || k === "g") moveTo(this, items, 0);
    else if (k === "h" || k === "left") foldRow(this, items, i, false);
    else if (k === "l" || k === "right") foldRow(this, items, i, true);
    else if (k === "space" || ch === " ") foldRow(this, items, i, null);
    else if (k === "enter") activate(this, items, i);
    else if (k === "1") switchTab(this, "procs", cx);
    else if (k === "2") switchTab(this, "ports", cx);
    else if (k === "3") switchTab(this, "system", cx);
    else if (k === "a") toggleAll(this);
    else if (k === "x") begin(this, item, m.shift);
    else if (k === "o" && this.tab === "ports") {
      cx.stop_propagation();
      openPortAt(this, item);

      return;
    } else if (k === "c") copyRow(this, item, cx);
    else if (k === "r") this.refresh(cx);
    else if (k === "q") {
      cx.stop_propagation();
      this.dismissDeck();

      return;
    } else if (ch === "?") this.help = true;
    else if (ch === "/" || k === "/") this.typing = true;
    else return;

    done();
  }

  // ---- parts

  override render(): Element {
    const t = theme();
    const tree = procTree(this);
    const ports = portList(this);
    const rows = this.tab === "ports" ? [] : this.rows(tree);
    const items: readonly Item[] = this.tab === "ports" ? ports : rows;
    const ci = this.at(items);
    const nProcs = procCount(this);

    const el = v_flex().id("procs-deck").size_full().bg(t.background).border(1).border_color(t.ansi0)
      .key_context(CONTEXT)
      .on_action(ESCAPE, (_e, cx) => escapeKey(this, cx))
      .on_mouse_down("left", () => this.focus())
      .on_mouse_move((e, cx) => dragTo(this, e, cx))
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag) {
          this.drag = null;
          cx.notify();
        }
      })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(headBar(this, t, nProcs, ports.length))
      .when(this.help, (el) => el.child(div().id("procs-help").relative().h(H - 2 - HEAD - FOOT).flex_none()
        .child(keysView(t, { id: "procs-keys", title: "processes and ports", list: deckKeys(), close: () => {
          this.help = false;
        } }))))
      .when(!this.help && this.tab === "procs", (el) => el.child(procsView(this, t, rows, ci)))
      .when(!this.help && this.tab === "ports", (el) => el.child(portsView(this, t, ports, ci)))
      .when(!this.help && this.tab === "system", (el) => el.child(systemView(this, t)))
      .child(footBar(this, t, items, ci));

    return this.handle ? el.track_focus(this.handle) : el;
  }
}
