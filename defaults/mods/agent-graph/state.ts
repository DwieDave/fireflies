// The agent graph's state: its props, the poll's pace, the cached sessions
// and what's remembered per terminal, the Claude panes it follows, the
// shapes it holds (a step's keys and pans, the stats and agent picks).

import type { Context, MouseButtonEvent } from "gpui-kit";
import { spaces, panes, terminals, props } from "herdr";
import type { PaneInfo, TabInfo, TerminalPaneInfo } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, parseJson, sharedMapKey } from "./guard.ts";
import type { Agent, FeedItem, Usage } from "./claude.ts";
import { isPackedSnapshot } from "./claude.ts";

/** A terminal of terminals(), for the name a person gave it. */
export const isLabelled = object({ address: isString }, { labels: nullable(object({}, { "nocturne.name": isString })) });

/** A terminal of terminals(), for the program it runs now. */
export const isRunning = object({ address: isString }, { foreground: nullable(object({}, { pid: isNumber })) });

/** The name a person gave a pane's terminal (Nocturne's "Rename": the nocturne.name label), or null. */
export const givenName = (terminal: string | null): string | null => terminals().filter(isLabelled).find((x) => x.address === terminal)?.labels?.["nocturne.name"] || null;

/** What it is opened with (see the top); other props are no props. */
export const isAgentsProps = object({}, { terminal: isString, select: isString });

export type AgentsProps = Guarded<typeof isAgentsProps>;

export const agentsProps = (): AgentsProps => {
  const p = props();

  return isAgentsProps(p) ? p : {};
};

export const POLL = 2500;
export const STALE = 15000;
export const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
export const PAN_STEP = 80;

// Fireflies shows a hidden tab's panes at a placeholder size for a moment before
// their real one; sizes under this are ignored, so the graph doesn't jump.
export const PLACEHOLDER = 120;
export const DETAIL_MIN = 90;

// The selection key of the stats breakdown (no node has it).
export const STATS = "@stats";

/** The Claude Code session a terminal runs: its process, the session id, its name and folder. */
export const isSession = object({ pid: isNumber, id: isString }, { name: nullable(isString), cwd: nullable(isString) });

export type Session = Guarded<typeof isSession>;

/** The last read of each terminal's session (keyed by terminal), so a pane coming back
 *  draws at once: the session, and the snapshot as JSON-safe values. */
export const CACHE = sharedMapKey("agent-graph.cache", object({ session: nullable(isSession), data: nullable(isPackedSnapshot) }));

/** This copy's remembered zoom and detail height. */
export const isRemembered = object({}, { zoom: nullable(isNumber), detailH: nullable(isNumber) });

export type Remembered = Guarded<typeof isRemembered>;

/** This copy's remembered zoom and detail height (localStorage may be missing). */
export function remembered(): Remembered {
  try {
    return parseJson(localStorage.getItem("view") ?? "{}", isRemembered) ?? {};
  } catch {
    return {};
  }
}

export function remember(v: Remembered) {
  try {
    localStorage.setItem("view", JSON.stringify(v));
  } catch {
    /* not kept */
  }
}

/** A Claude Code pane in the shown space (a terminal's), with the name it shows under and its space's machine. */
export interface ClaudePane extends TerminalPaneInfo {
  readonly name: string;
  readonly machine: string | null;
}

/** Claude Code panes in the shown space, the shown tab's first. */
export function claudePanes(): ClaudePane[] {
  const space = spaces().find((s) => s.active);

  if (!space) return [];

  const tabs = new Map<string, TabInfo>(space.tabs.map((c) => [c.id, c]));

  // The shown tab first, then by position.
  const rank = (p: PaneInfo) => {
    const tab = tabs.get(p.tab);

    return (tab?.active ? 0 : 1000) + (tab?.index ?? 0);
  };

  return panes().flatMap((p) => (p.terminal && p.app === "claude-code" && tabs.has(p.tab)
    ? [{ ...p, name: givenName(p.terminal) ?? p.program.name, machine: space.machine }]
    : []))
    .sort((a, b) => rank(a) - rank(b));
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));

  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

/** "$4.10", "$0.82", "<$0.01"; "≈" when a model had no price. */
export function money(u: Usage): string {
  const c = u.cost;
  const v = c > 0 && c < 0.01 ? "<$0.01" : c >= 100 ? `$${c.toFixed(0)}` : `$${c.toFixed(2)}`;

  return u.unpriced ? `≈${v}` : v;
}


/** A move of the selection: h parent, l first child, j / k down / up the column. */
export const isStep = literal("h", "j", "k", "l");

export type Step = Guarded<typeof isStep>;

/** H J K L: which way each moves the graph. */
export const PAN = new Map<string, readonly [number, number]>([["h", [PAN_STEP, 0]], ["l", [-PAN_STEP, 0]], ["k", [0, PAN_STEP]], ["j", [0, -PAN_STEP]]]);

/** The stats breakdown, selected like a node. */
export interface StatsPick {
  readonly key: typeof STATS;
  readonly kind: "stats";
}

/** An agent picked from a list (the stats, a run's agents): its key is its id. */
export interface AgentPick {
  readonly key: string;
  readonly kind: "agent";
}

/** A row of the feed: the task first, then the steps. */
export type FeedRow = FeedItem | { readonly kind: "task"; readonly text: string };

/** A group of the stats breakdown: the session's own subagents, or a run's. */
export interface StatsGroup {
  readonly id: string;
  readonly name: string;
  readonly list: readonly Agent[];
}
