// The processes and ports manager, in Nocturne's look: one square popover
// under the tab strip's tree mark (../nocturne/procs.ts), or centered from
// nocturne.procs / nocturne.ports and the palette, or a normal pane
// (nocturne.procs:pane, ctrl-t; place.ts). This machine only.
//
//   head       the tree mark, its two tabs (processes and ports with their
//              counts), and what's listed: "fireflies" (this app's terminals)
//              or "all of <user>'s" (a switches)
//   readings   under the head, always in view (vitals-view.ts): CPU, memory,
//              network and disk as small line graphs over the last two
//              a minute and a half, a reading a second while the deck is open (none while
//              it's closed; never two at once; sys.ts has the sources). The
//              pointer on a graph puts its whole reading in the foot (the GPU
//              and how full the disk is among them). Four across, or two by two
//              in a deck too narrow for four.
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
//   sorting    a click on a column's head sorts by it, again the other way;
//              s steps through the columns, S turns it, v the flat list of
//              every process while a number sorts (sort.ts, heads.ts); kept
//              across opens
//   ports      the TCP ports his processes listen on, those in this app's
//              terminals first: port, process, where it runs; on the cursor's
//              row open ↗ (a web pane), copy (http://localhost:<port>), end
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
//   tab 1 2 processes / ports · a this app's terminals / all of yours
//   x end (a terminal, tab or space: what runs in it) · X end it and
//   everything under it · K force end (kill -9, asks first; on the band:
//   kill what held on) · t go to its terminal, tab or space · f its folder
//   in a files pane · p copy the pid (a port: its number) · d a database's
//   port in Databases · m the row's menu (menu.ts; keys.ts has them all)
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
// A right-click on a row opens its menu at the pointer (menu.ts).

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { closeOverlay, exec, nextCommand, shared, setShared, theme } from "herdr";
import { readShared, writeShared } from "./guard.ts";
import type { Sorts } from "./sort.ts";
import { NO_SORT, SORT } from "./sort.ts";
import { keysView } from "./keyhelp.ts";
import type { Index, Probe, Row, TreeNode } from "./logic.ts";
import { PROBE, parseProbe, index } from "./logic.ts";
import type { Measured, Reading } from "./sys.ts";
import { SYS_PROBE, STEP, parseSys, measure, push } from "./sys.ts";
import type { Fit, History, Point, Vital } from "./vitals.ts";
import { emptyHistory, linePoints, record, stripLayout } from "./vitals.ts";
import type { Tab, Own, Cursors, Scrolls, Drag, Command, Ask, Note, Item } from "./state.ts";
import { deckProps, ESCAPE, CONTEXT, REFRESH, DECK, isTab, COUNT, PORTS_H, LIST_H, FOOT, HEAD, H, W, deckKeys, listH } from "./state.ts";
import { listRows, portList, procCount, procTree, rowAt, tabList } from "./listing.ts";
import { escapeKey } from "./actions.ts";
import type { Menu } from "./menu.ts";
import { dbSeen, withDbCheck } from "./menu.ts";
import { menuBox, rightPress } from "./menu-view.ts";
import { deckKey } from "./keys.ts";
import { actsOnCommands, inPane, saveCopy, takeShown, toPane, toWindow } from "./place.ts";
import { unzoom } from "./paint.ts";
import { dragTo } from "./pointer.ts";
import { procsView } from "./procs-view.ts";
import { vitalsStrip } from "./vitals-view.ts";
import { portsView } from "./ports-view.ts";
import { footBar, headBar } from "./bars.ts";

export default class ProcsDeck extends View {
  static bound = false;
  tab: Tab = "procs";
  // The readings' histories (vitals.ts), the last reading's values, and each process's own.
  sys: History = emptyHistory();
  now: Measured | null = null;
  sysReading: Reading | null = null;
  // The deck's inner width as drawn (layout px): the strip goes two by two when it's narrow;
  // a pane's height as drawn (an overlay is H).
  width = W - 2;
  height = H;
  // The graph under the pointer: its whole reading shows in the foot.
  hoverVital: Vital | null = null;
  // A graph's line over a history, made again only when that history (a new array a reading) or its scale changes.
  pointsCache = new WeakMap<readonly (number | null)[], { sig: string; runs: Point[][] }>();
  hist = new Map<number, Own>();
  all = false;
  // Each tab's sort and the flat view (sort.ts), kept across opens.
  sorts: Sorts = readShared(shared, SORT, null) ?? NO_SORT;
  snap: Probe | null = null;
  ix: Index | null = null;
  failed: string | null = null;
  // A folded node's key → true (one unfolded again: false).
  folds = new Map<string, boolean>();
  query = "";
  typing = false;
  cur: Cursors = { procs: { key: null, at: 0 }, ports: { key: null, at: 0 } };
  scroll: Scrolls = { procs: 0, ports: 0 };
  // The list keeps the cursor in sight until the wheel or the scrollbar moves it away; a key or a click brings it back.
  follow = true;
  drag: Drag | null = null;
  // The detail block's command: its scroll and its drawn height.
  cmd: Command = { pid: null, y: 0, h: 0 };
  ask: Ask | null = null;
  // The row menu (menu.ts), and the row a right press went down on (its handler runs before the deck's).
  menu: Menu | null = null;
  pressed: string | null = null;
  // Where m opens the menu: under the selected row, as last drawn (deck px).
  selY = 120;
  // The Databases mod is installed: a database's port offers "open in Databases".
  dbMod = false;
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

    this.tab = tab === "ports" ? tab : "procs";
    // A move's note, or (a pane) what it showed before a restart (place.ts).
    takeShown(this);

    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();

    // A pane takes the keyboard as panes do (a click, pane.go): no grabbing it back.
    if (!inPane()) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => handle.focus());

    // procs.focus, procs.keys, procs.to-pane, procs.to-window: the window acts while open, else the focused pane.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^procs\./, "");

        if (c === "focus") handle.focus();
        else if (!actsOnCommands()) continue;
        else if (c === "keys") {
          this.help = !this.help;
          cx.notify();
        } else if (c === "to-pane") toPane(this, cx);
        else if (c === "to-window") toWindow(this, cx);
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
    saveCopy(this);

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
        const r = await exec("sh", ["-c", withDbCheck(PROBE)], { timeout: 10000 });
        const snap = parseProbe(r.stdout);

        this.dbMod = dbSeen(r.stdout);

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

  /** A reading for the graphs, when a second has passed since the last began and none is running:
   *  a slow source holds the next one back instead of piling them up. */
  tick(cx: Context, now = Date.now()): void {
    if (!this.sampling && now - (this.sampled ?? 0) >= STEP) this.sample(cx);
  }

  /** A graph's line over `values` (vitals.ts linePoints), kept while they and the scale stay. */
  points(values: readonly (number | null)[], fit: Fit): Point[][] {
    const sig = `${fit.max ?? ""}:${fit.floor ?? ""}:${fit.h ?? ""}`;
    const c = this.pointsCache.get(values);

    if (c?.sig === sig) return c.runs;

    const runs = linePoints(values, fit);

    this.pointsCache.set(values, { sig, runs });

    return runs;
  }

  /** The strip's height, and the lists' under it. */
  stripH(): number {
    return stripLayout(this.width).h;
  }

  listH(): number {
    return listH(this.tab === "ports" ? PORTS_H : LIST_H, this.stripH()) - (H - this.deckH());
  }

  /** One reading for the graphs (sys.ts SYS_PROBE, about a second: iostat measures one). */
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
        this.sys = record(this.sys, m);
      } catch {
        // The graphs keep what they had.
      }

      this.sampling = false;
      cx.notify();
      this.tick(cx);
    });
  }

  /** The overlay closes (after going to a terminal, opening a port …); a pane stays. */
  dismissDeck(): void {
    const id = deckProps().overlay;

    if (id) closeOverlay(id);
  }

  /** The deck's height: a pane's as drawn, else the overlay's. */
  deckH(): number {
    return inPane() && this.height > 0 ? this.height : H;
  }

  /** The overlay or the pane is going, however it goes (a pane keeps what it shows). */
  override close(): void {
    saveCopy(this);

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
    deckKey(this, e, cx);
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

    // Over the tab it draws its frame; a pane has the pane's.
    const root = v_flex().id("procs-deck").size_full().bg(t.background);

    const el = (inPane() ? root : root.border(1).border_color(t.ansi0))
      .key_context(CONTEXT)
      .on_size_change((drawn, cx) => {
        const h = Math.round(unzoom(drawn.height));

        if (inPane() && Math.abs(h - this.height) > 1) {
          this.height = h;
          cx.notify();
        }
      })
      .on_action(ESCAPE, (_e, cx) => escapeKey(this, cx))
      .on_mouse_down("left", () => this.focus())
      .on_mouse_down("right", (e, cx) => rightPress(this, e, cx))
      .on_mouse_move((e, cx) => dragTo(this, e, cx))
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag) {
          this.drag = null;
          cx.notify();
        }
      })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(headBar(this, t, nProcs, ports.length))
      .child(vitalsStrip(this, t))
      .when(this.help, (el) => el.child(div().id("procs-help").relative().h(this.deckH() - 2 - HEAD - this.stripH() - FOOT).flex_none()
        .child(keysView(t, { id: "procs-keys", title: "processes and ports", list: deckKeys(), close: () => {
          this.help = false;
        } }))))
      .when(!this.help && this.tab === "procs", (el) => el.child(procsView(this, t, rows, ci)))
      .when(!this.help && this.tab === "ports", (el) => el.child(portsView(this, t, ports, ci)))
      .child(footBar(this, t, items, ci))
      .children(this.menu ? [menuBox(this, t, this.menu)] : []);

    return this.handle ? el.track_focus(this.handle) : el;
  }
}
