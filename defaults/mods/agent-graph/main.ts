// Nocturne agents: a pane showing what a Claude Code session has spawned,
// as a dithered, animated graph (graph.ts), from its files under ~/.claude
// (claude.ts). Opened from the tab strip's "agents" or the + menu.
//
//   which session   the focused pane's Claude Code; else the one last shown;
//                   else the first in the shown tab or space. The chips at
//                   the top pick one and keep it.
//   click a node    its details below: an agent's task and its steps, oldest
//                   first (a run: its agents; the session: its own steps)
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
import { theme, run, nextCommand, shared } from "herdr";
import type { Theme } from "herdr";
import { readSharedMap } from "./guard.ts";
import type { KeyRow } from "./keyhelp.ts";
import { keysView, keysKey, hintBar } from "./keyhelp.ts";
import type { Feed, Snapshot, Usage } from "./claude.ts";
import { unpack } from "./claude.ts";
import type { GraphNode } from "./graph.ts";
import { tree, ZOOM, WORDS } from "./graph.ts";
import type { Session, ClaudePane, Step, StatsPick } from "./state.ts";
import { agentsProps, remembered, CACHE, POLL, claudePanes, isStep, STATS, PAN, PLACEHOLDER, DETAIL_MIN } from "./state.ts";
import { poll, runCommand, startFollowing, targetPane, toWorking } from "./reading.ts";
import { cycleAgents, flipRun, movePan, saveState, stepGraph, zoomTo } from "./navigate.ts";
import { details, drawToolbar } from "./feed-view.ts";
import { statsStrip } from "./stats-view.ts";
import { viewport } from "./viewport.ts";

/** What ? lists: every key key() takes, ? keys last. */
export const KEYS: readonly KeyRow[] = [
  ["h l", "parent / first child"], ["j k", "down / up the column"], ["H J K L", "move the graph"],
  ["+ - 0", "zoom in / out / reset"], ["enter space", "fold or open a run"], ["G", "newest step, follow it"],
  ["gg", "oldest step"], ["w", "next working agent"], ["s", "every agent's time, tokens, cost"], ["f", "focus its terminal"],
  ["[ ]", "previous / next session"], ["esc", "close the details"], ["?", "keys"],
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
  busy = 0; // when the running poll started
  gen = 0;
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
    this.terminal = agentsProps().terminal ?? null;
    this.pinned = Boolean(this.terminal);

    const kept = remembered();

    this.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, Number(kept.zoom) || 1));
    this.detailH = Number(kept.detailH) || null;
    this.feedScroll = VirtualListScrollHandle.new();

    const handle = cx.focus_handle();

    this.handle = handle;

    // Start from the last read of this terminal's session, if there is one.
    const hit = this.terminal ? readSharedMap(shared, CACHE).get(this.terminal) : undefined;

    if (hit) {
      this.session = hit.session;
      this.data = hit.data && unpack(hit.data);
    }

    // Commands: "focus" from pane.go onto this pane (mod.json focusable),
    // and agent-graph.<move> from keys.json.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^agent-graph\./, "");

        if (c === "focus") handle.focus();
        else runCommand(this, c, cx);

        cx.notify();
      }
    });
    poll(this, cx);
    cx.timer.every(POLL, (cx) => poll(this, cx));
  }

  /** Which Claude Code to show now. */
  target(): ClaudePane | null {
    return targetPane(this);
  }

  // ---- keyboard, zoom

  /** Moves the selection: h parent, l first child, j / k next / previous in the column. */
  step(dir: Step, cx: Context) {
    return stepGraph(this, dir, cx);
  }

  key(e: KeyEvent, cx: Context) {
    const m = e.modifiers;

    if (m.control || m.platform || m.alt) return;

    const typed = e.key_char && e.key_char.length === 1 ? e.key_char : null;
    const help = keysKey(e, this.help);

    if (help) {
      this.help = help === "toggle" ? !this.help : false;
      cx.stop_propagation();
      cx.notify();

      return;
    }

    if (this.help) return;

    if (typed === "[" || typed === "]") {
      cycleAgents(this, typed === "]" ? 1 : -1, cx);
      cx.stop_propagation();
      cx.notify();

      return;
    }

    const k = e.key, upper = m.shift || /^[A-Z]$/.test(k), low = k.toLowerCase();
    const pan = upper ? PAN.get(low) : undefined;

    if (pan) movePan(this, pan[0], pan[1]);
    else if (isStep(k)) {
      this.step(k, cx);

      return;
    } else if (k === "+" || k === "=") zoomTo(this, this.zoom * ZOOM.step);
    else if (k === "-" || k === "_") zoomTo(this, this.zoom / ZOOM.step);
    else if (k === "0") {
      this.zoom = 1;
      this.pan = null;
      saveState(this);
    } else if (k === "enter" || k === "space") {
      const n = (this.layout ?? []).find((x) => x.key === this.selected);

      if (n?.kind === "run") flipRun(this, n);
    } else if (k === "f" && !upper) {
      const pane = this.target();

      if (pane) run("pane.focus", { pane: pane.pane });

      return;
    } else if (low === "g" && upper) startFollowing(this);
    else if (k === "g") {
      // gg (two within half a second): the oldest step, and stop following.
      if (Date.now() - this.gAt < 500) {
        this.gAt = 0;
        this.follow = false;
        this.feedScroll?.scroll_to_item(0);
      } else {
        this.gAt = Date.now();

        return;
      }
    } else if (k === "w") toWorking(this, cx);
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
    const list = claudePanes();
    const pane = this.target();

    const endResize = (cx: Context) => {
      if (this.resizing) {
        this.resizing = null;
        saveState(this);
        cx.notify();
      }
    };

    const frame = v_flex().id("agent-graph").relative().size_full().bg(t.background);

    const shell = (this.handle ? frame.track_focus(this.handle) : frame)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => {
        if (size.height >= PLACEHOLDER) {
          this.paneH = size.height;
          cx.notify();
        }
      })
      .when(Boolean(this.resizing), (el) => el.cursor_row_resize())
      .on_mouse_move((e, cx) => {
        const r = this.resizing;

        if (!r) return;

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
      .child(div().text_color(t.foreground).child(text)).child(div().text_center().text_color(t.ansi8).child(sub)))
      .child(this.hints(t));

    if (!pane) return note("No Claude Code in this space", "Start one from + new, then its agents and workflows show here.");

    if (this.error && !this.data) return note(this.error, "");

    const data = this.data;

    if (!data) return note("Reading the session…", pane.cwd ?? "");

    const root = tree(data, { label: pane.name, sub: [this.session?.name, WORDS[pane.status ?? "idle"]].filter(Boolean).join(" · "), status: pane.status ?? "idle" }, this.open);
    const find = (n: GraphNode): GraphNode | undefined => n.key === this.selected ? n : n.children.map(find).find(Boolean);
    const stats: StatsPick = { key: STATS, kind: "stats" };
    const sel = this.selected === STATS ? stats : this.selected ? find(root) : undefined;

    return shell
      .when(data.agents.size > 0, (el) => el.child(statsStrip(this, t)))
      .child(viewport(this, t, root))
      .when(this.pendingBottom, (el) => {
        this.pendingBottom = false;
        this.feedScroll?.scroll_to_bottom();

        return el;
      })
      .when(sel !== undefined, (el) => (sel ? el.child(details(this, t, sel, pane, data)) : el))
      .when(!root.children.length, (el) => el.child(div().flex_none().px(12).pb(8).text_size(11).text_color(t.ansi8)
        .child("No subagents or workflows in this session yet.")))
      .child(this.hints(t));
  }
}
