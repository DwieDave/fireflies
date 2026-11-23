// Nocturne agents: a pane showing what a Claude Code session has spawned,
// as a dithered, animated graph (graph.ts), from its files under ~/.claude
// (claude.ts). Opened from the tab strip's "agents" or the + menu.
//
//   which session   the focused pane's Claude Code; else the one last shown;
//                   else the first in the shown tab or space. The chips at
//                   the top pick one and keep it.
//   click a node    its details below: an agent's task and its steps, oldest
//                   first (a run: its agents; the session: its own steps)
//   right-click     a node's menu at the pointer: follow, oldest step, fold or
//                   open, ask, focus its terminal (node-menu.ts)
//   follow          keeps the details at the newest step as it works;
//                   scrolling up stops it, scrolling to the bottom (or
//                   clicking it, or G) starts it again
//   drag / scroll   moves the graph; double-click empty sky (or "centre")
//                   puts it back; cmd-scroll zooms around the pointer
//   + / −           click a selected run again to fold or open it (older
//                   finished runs start folded)
//   detail edge     drag the line above the details to resize them
//   stats strip     under the toolbar: every agent of the session together —
//                   how many work, are done or stopped, their summed run time,
//                   the session's wall time, tokens and what they'd cost at API
//                   prices (≈, claude.ts). Click it (or s) for each agent's
//                   share: status, time, tokens, cost, grouped by run
//
// Keys (click the pane, or pane.go onto it):
//   h / l           to the parent / into the first child (l opens a folded run)
//   j / k           down / up the column
//   H J K L         move the graph
//   + / -  0        zoom in / out, back to 100% and centred
//   enter           fold or open the selected run
//   f               focus the Claude Code terminal
//   G / gg          the details' newest step (and follow it) / oldest step
//   w               to the next working agent, following it
//   s               every agent's time, tokens and cost
//   esc             close the details
//   [ ]             the previous / next Claude Code session (the chips)
//   m               the selected node's menu beside it (nothing selected: the
//                   session's, in the middle); j k enter, its keys, esc
//   ?               every key (the bar along the bottom shows the main ones)
//   focus           jump to the Claude Code terminal
//   ask             asks that Claude Code, in its own terminal, how the
//                   selected agent or run is doing
//
// The same moves as agent-graph.<command> for keys.json: h j k l, in, out,
// reset, follow, working, focus.
//
// Props: { terminal?, select?: "working" } (start on that Claude Code / on a working agent).
//
// Reads this machine's files only: a space on another machine shows a note.
// The last read of each terminal's session is kept in shared(CACHE), so a
// pane coming back (another tab, a restart) draws at once, then refreshes.

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, Point, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex, VirtualListScrollHandle } from "gpui-base";
import { theme, shared } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Clock, Duration, Effect, Option, String as Str } from "effect";
import { Commands, readSharedOption, redraw } from "@fireflies/kit";
import type { KeyRow } from "@fireflies/keyhelp";
import { keysView, keysKey, hintBar } from "@fireflies/keyhelp";
import type { Feed, Snapshot, Usage } from "./claude.ts";
import { unpack } from "./claude.ts";
import type { GraphNode } from "./graph.ts";
import { tree, ZOOM, WORDS } from "./graph.ts";
import type { Session, ClaudePane, Step, StatsPick } from "./state.ts";
import { agentsProps, remembered, CACHE, claudePanes, isStep, STATS, PAN, PLACEHOLDER, DETAIL_MIN } from "./state.ts";
import { pollLoop, runCommand, startFollowing, targetPane, toWorking } from "./reading.ts";
import { cycleAgents, flipRun, movePan, saveState, stepGraph, zoomTo } from "./navigate.ts";
import { details, drawToolbar } from "./feed-view.ts";
import { statsStrip } from "./stats-view.ts";
import { viewport } from "./viewport.ts";
import type { AgentsFx } from "./fx.ts";
import { attach, nowMs } from "./fx.ts";
import type { NodeMenu } from "./node-menu.ts";
import { menuEntries, menuKey, nodeAnchor } from "./node-menu.ts";
import type { Anchor, Pt } from "@fireflies/menu-place";

/** What ? lists: every key key() takes, ? keys last. */
export const KEYS: readonly KeyRow[] = [
  ["h l", "parent / first child"], ["j k", "down / up the column"], ["H J K L", "move the graph"],
  ["+ - 0", "zoom in / out / reset"], ["enter space", "fold or open a run"], ["G", "newest step, follow it"],
  ["gg", "oldest step"], ["w", "next working agent"], ["s", "every agent's time, tokens, cost"], ["f", "focus its terminal"],
  ["[ ]", "previous / next session"], ["m", "the selected node's menu"], ["esc", "close the details"], ["?", "keys"],
];

export default class Agents extends View {
  terminal: string | null = null; // the Claude Code shown
  pinned = false;
  session: Session | null = null;
  data: Snapshot | null = null;
  error = "";
  selected: string | null = null; // node key
  detail: Feed | null = null; // feed() result for the selected agent / main
  open = new Set<string>(); // run ids opened (finished ones), "-<id>" for running ones folded
  pan: Point | null = null; // once dragged; until then the graph is kept centred
  drag: { readonly x: number; readonly y: number; readonly from: Point } | null = null; // while dragging
  view: Size = { width: 600, height: 400 };
  zoom = 1;
  detailH: number | null = null; // px; null: half the pane
  resizing: { readonly y: number; readonly from: number } | null = null; // while the detail edge is dragged
  paneH = 600;
  follow = true; // the details stay at the newest step
  feedScroll: VirtualListScrollHandle | null = null;
  lastDrawn = 0; // when the feed last drew its newest step (it's on screen)
  handle: FocusHandle | null = null;
  fx: AgentsFx | null = null;
  now = 0; // the time this render draws at (ms)
  selectWorking = false; // opened with props { select: "working" }
  origin: Pt | null = null; // the graph's view in the window (window px), for a press's place
  menu: NodeMenu | null = null; // a node's open menu
  usage: ReadonlyMap<string, Usage | null> | null = null;
  startedOn = false;
  kept: string | null = null; // the last entry written to the cache, as JSON
  pendingBottom = false;
  help = false;
  gAt = 0;
  layout: readonly GraphNode[] | null = null;
  graphH: number | null = null;
  rootY = 0;

  override init(_props: Props | undefined, cx: AsyncContext) {
    const p = agentsProps();

    this.terminal = p.terminal ?? null;
    this.pinned = this.terminal !== null;
    this.selectWorking = p.select === "working";

    const kept = remembered();
    const zoom = kept.zoom ?? 0;
    const detailH = kept.detailH ?? 0;

    this.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom === 0 ? 1 : zoom));
    this.detailH = detailH === 0 ? null : detailH;
    this.feedScroll = VirtualListScrollHandle.new();

    const handle = cx.focus_handle();

    this.handle = handle;

    // Start from the last read of this terminal's session, if there is one.
    const terminal = this.terminal;

    if (terminal !== null) {
      Option.map(Option.flatMap(readSharedOption(shared, CACHE), (m) => Option.fromUndefinedOr(m.get(terminal))), (hit) => {
        this.session = hit.session;
        this.data = hit.data === null ? null : unpack(hit.data);
      });
    }

    const fx = attach(cx);

    this.fx = fx;
    // Commands: "focus" from pane.go onto this pane (mod.json focusable),
    // and agent-graph.<move> from keys.json.
    fx.run(Effect.forever(Commands.use((c) => c.next).pipe(
      Effect.tap((c) => Effect.sync(() => this.command(c, handle))),
      Effect.andThen(redraw),
    )));
    this.poll();
  }

  /** Its copy closed: the poll and the command loop end. */
  override close(): Promise<void> | undefined {
    return this.fx?.close();
  }

  /** Reads now, and from then on every POLL (a read under way gives way to this one). */
  poll(): void {
    this.fx?.run(pollLoop(this), { key: "poll", redraw: false });
  }

  /** A command for this copy: "focus", else agent-graph.<move>. */
  command(name: string, handle: FocusHandle): void {
    const c = Str.replace(/^agent-graph\./, "")(name);

    if (c === "focus") handle.focus();
    else runCommand(this, c);
  }

  /** Scrolled down in the feed: follows again if the newest step drew just now (it's on screen). */
  followIfAtEnd(): void {
    this.fx?.run(Effect.sleep(Duration.millis(60)).pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.map((now) => {
        if (now - this.lastDrawn < 250) this.follow = true;
      }),
    ), { key: "follow" });
  }

  /** Opens `n`'s menu at `at` (a press, `n`'s place, none: the middle). */
  openMenu(n: GraphNode, at: Anchor): void {
    const pane = this.target();

    if (pane === null) return;

    this.menu = { node: n.key, title: n.kind === "main" ? "the session" : n.label, entries: menuEntries(this, n, pane), at, sel: 0 };
  }

  closeMenu(): void {
    this.menu = null;
  }

  /** m: the selected node's menu beside it; nothing selected (or the stats): the session's, in the middle. */
  menuByKey(): void {
    const nodes = this.layout ?? [];

    Option.match(Arr.findFirst(nodes, (n) => n.key === this.selected), {
      onSome: (n) => this.openMenu(n, nodeAnchor(this, n)),
      onNone: () => Option.map(Arr.findFirst(nodes, (n) => n.kind === "main"), (n) => this.openMenu(n, null)),
    });
  }

  /** Focuses the Claude Code terminal shown. */
  focusTerminal(pane: ClaudePane): void {
    this.fx?.run(Commands.use((c) => c.run("pane.focus", { pane: pane.pane })), { redraw: false });
  }

  /** Which Claude Code to show now. */
  target(): ClaudePane | null {
    return targetPane(this);
  }

  // ---- keyboard, zoom

  /** Moves the selection: h parent, l first child, j / k next / previous in the column. */
  step(dir: Step): void {
    stepGraph(this, dir);
  }

  key(e: KeyEvent, cx: Context) {
    const m = e.modifiers;

    if (m.control || m.platform || m.alt) return;

    const typed = e.key_char !== null && e.key_char !== undefined && e.key_char.length === 1 ? e.key_char : null;
    const help = keysKey(e, this.help);

    if (help !== null) {
      this.help = help === "toggle" ? !this.help : false;
      cx.stop_propagation();
      cx.notify();

      return;
    }

    if (this.help) return;

    if (this.menu !== null) {
      if (menuKey(this.menu, e.key, typed, () => this.closeMenu())) {
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    if (typed === "[" || typed === "]") {
      cycleAgents(this, typed === "]" ? 1 : -1);
      cx.stop_propagation();
      cx.notify();

      return;
    }

    const k = e.key, upper = m.shift || /^[A-Z]$/.test(k), low = Str.toLowerCase(k);
    const pan = upper ? PAN.get(low) : undefined;

    if (pan !== undefined) movePan(this, pan[0], pan[1]);
    else if (isStep(k)) this.step(k);
    else if (k === "+" || k === "=") zoomTo(this, this.zoom * ZOOM.step);
    else if (k === "-" || k === "_") zoomTo(this, this.zoom / ZOOM.step);
    else if (k === "0") {
      this.zoom = 1;
      this.pan = null;
      saveState(this);
    } else if (k === "enter" || k === "space") {
      Option.map(Arr.findFirst(this.layout ?? [], (x) => x.key === this.selected), (n) => {
        if (n.kind === "run") flipRun(this, n);
      });
    } else if (k === "f" && !upper) {
      const pane = this.target();

      if (pane !== null) this.focusTerminal(pane);

      return;
    } else if (low === "g" && upper) startFollowing(this);
    else if (k === "g") {
      // gg (two within half a second): the oldest step, and stop following.
      const now = nowMs();

      if (now - this.gAt < 500) {
        this.gAt = 0;
        this.follow = false;
        this.feedScroll?.scroll_to_item(0);
      } else {
        this.gAt = now;

        return;
      }
    } else if (k === "m" && !upper) this.menuByKey();
    else if (k === "w") {
      if (toWorking(this)) this.poll();
    }
    else if (k === "s") {
      this.selected = this.selected === STATS ? null : STATS;
      this.detail = null;
    } else if (k === "escape") {
      this.selected = null;
      this.detail = null;
    } else return;

    cx.stop_propagation();
    cx.notify();
  }

  // ---- parts

  /** lazygit's options bar: the main keys, ? keys last (keyhelp.ts). */
  hints(t: Theme): Element {
    const list: readonly KeyRow[] = this.help ? [["esc", "close"]]
      : [["hjkl", "move"], ["enter", "fold"], ["G", "follow"], ["w", "working"], ["s", "stats"], ["f", "terminal"], ["[ ]", "session"]];

    return hintBar(t, "ag-hints", list, {
      keys: {
        on: this.help,
        toggle: () => {
          this.help = !this.help;
        },
      },
    });
  }

  /** ?: every key, in the graph's place (keyhelp.ts). */
  helpPanel(t: Theme): Element {
    return keysView(t, {
      id: "ag-help", title: "agents and workflows", list: KEYS, close: () => {
        this.help = false;
      },
    });
  }

  override render() {
    const t = theme();

    this.now = nowMs();
    const list = claudePanes();
    const pane = this.target();

    const endResize = (cx: Context) => {
      if (this.resizing !== null) {
        this.resizing = null;
        saveState(this);
        cx.notify();
      }
    };

    const frame = v_flex().id("agent-graph").relative().size_full().bg(t.background);

    const shell = (this.handle !== null ? frame.track_focus(this.handle) : frame)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => {
        if (size.height >= PLACEHOLDER) {
          this.paneH = size.height;
          cx.notify();
        }
      })
      .when(this.resizing !== null, (el) => el.cursor_row_resize())
      .on_mouse_move((e, cx) => {
        const r = this.resizing;

        if (r === null) return;

        this.detailH = Math.round(Math.min(this.paneH - 34 - 80, Math.max(DETAIL_MIN, r.from - (e.position.y - r.y))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => {
        if (!h) endResize(cx);
      })
      .child(drawToolbar(this, t, list, pane));

    // ?: the keys in the graph's place, the toolbar and the bar stay (keyhelp.ts).
    if (this.help) return shell.child(div().relative().flex_1().min_h(0).child(this.helpPanel(t))).child(this.hints(t));

    const note = (text: string, sub: string) => shell.child(v_flex().flex_1().items_center().justify_center().gap(6).px(16).text_size(11)
      .child(div().text_color(t.foreground).child(text)).child(div().text_center().text_color(t.muted).child(sub)))
      .child(this.hints(t));

    if (pane === null) return note("No Claude Code in this space", "Start one from + new, then its agents and workflows show here.");

    if (Str.isNonEmpty(this.error) && this.data === null) return note(this.error, "");

    const data = this.data;

    if (data === null) return note("Reading the session…", pane.cwd ?? "");

    const sub = Arr.filter([this.session?.name ?? "", WORDS[pane.status ?? "idle"]], Str.isNonEmpty);
    const root = tree(data, { label: pane.name, sub: Arr.join(sub, " · "), status: pane.status ?? "idle" }, this.open, this.now);
    const find = (n: GraphNode): Option.Option<GraphNode> => (n.key === this.selected ? Option.some(n) : Arr.findFirst(n.children, find));
    const stats: StatsPick = { key: STATS, kind: "stats" };
    const sel = this.selected === STATS ? stats : this.selected === null ? undefined : Option.getOrUndefined(find(root));

    return shell
      .when(data.agents.size > 0, (el) => el.child(statsStrip(this, t)))
      .child(viewport(this, t, root))
      .when(this.pendingBottom, (el) => {
        this.pendingBottom = false;
        this.feedScroll?.scroll_to_bottom();

        return el;
      })
      .when(sel !== undefined, (el) => (sel === undefined ? el : el.child(details(this, t, sel, pane, data))))
      .when(root.children.length === 0, (el) => el.child(div().flex_none().px(12).pb(8).text_size(11).text_color(t.muted)
        .child("No subagents or workflows in this session yet.")))
      .child(this.hints(t));
  }
}
