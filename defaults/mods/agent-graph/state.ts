// The agent graph's state: its props, the poll's pace, the cached sessions
// and what's remembered per copy, the Claude panes it follows, the shapes it
// holds (a step's keys and pans, the stats and agent picks).

import type { Context, MouseButtonEvent } from "gpui-kit";
import { spaces, panes, terminals, props } from "herdr";
import type { PaneInfo, SpaceInfo, TabInfo, TerminalPaneInfo } from "herdr";
import { Array as Arr, Option, Schema, String as Str } from "effect";
import { listOf, mapOf, sharedKey } from "@fireflies/kit";
import type { Agent, FeedItem, Usage } from "./claude.ts";
import { PackedSnapshotSchema } from "./claude.ts";

/** A terminal of terminals(), the fields read here: its address, the name a person gave it
 *  (Nocturne's "Rename": the nocturne.name label) and the program it runs now. */
export const TerminalSchema = Schema.Struct({
  address: Schema.String,
  labels: Schema.optionalKey(Schema.NullOr(Schema.Struct({ "nocturne.name": Schema.optionalKey(Schema.String) }))),
  foreground: Schema.optionalKey(Schema.NullOr(Schema.Struct({ pid: Schema.optionalKey(Schema.Finite) }))),
});

export type Terminal = typeof TerminalSchema.Type;

/** terminals() read entry by entry (one in another shape is left out; not a list: none). */
export const terminalsOf = (list: ReturnType<typeof terminals>): readonly Terminal[] =>
  Option.getOrElse(Schema.decodeOption(listOf(TerminalSchema))(list), (): readonly Terminal[] => []);

/** The name a person gave a pane's terminal, or none. */
export const givenName = (list: readonly Terminal[], terminal: string): Option.Option<string> =>
  Arr.findFirst(list, (x) => x.address === terminal).pipe(
    Option.flatMap((x) => Option.fromUndefinedOr(x.labels?.["nocturne.name"])),
    Option.filter(Str.isNonEmpty),
  );

/** The process a terminal runs now, or none. */
export const pidOf = (list: readonly Terminal[], terminal: string): Option.Option<number> =>
  Option.flatMap(Arr.findFirst(list, (x) => x.address === terminal), (x) => Option.fromUndefinedOr(x.foreground?.pid));

/** What it is opened with (see the top); other props are no props. */
export const AgentsPropsSchema = Schema.Struct({ terminal: Schema.optionalKey(Schema.String), select: Schema.optionalKey(Schema.String) });

export type AgentsProps = typeof AgentsPropsSchema.Type;

const readProps = Schema.decodeUnknownOption(AgentsPropsSchema);

export const agentsProps = (): AgentsProps => Option.getOrElse(readProps(props()), (): AgentsProps => ({}));

export const POLL = 2500;

// A read that takes longer than this is given up; the next one starts.
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
export const SessionSchema = Schema.Struct({
  pid: Schema.Finite,
  id: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type Session = typeof SessionSchema.Type;

/** One terminal's last read: the session, and the snapshot as JSON-safe values. */
export const CacheEntrySchema = Schema.Struct({ session: Schema.NullOr(SessionSchema), data: Schema.NullOr(PackedSnapshotSchema) });

export type CacheEntry = typeof CacheEntrySchema.Type;

/** The last read of each terminal's session (keyed by terminal), so a pane coming back
 *  draws at once. */
export const CACHE = sharedKey("agent-graph.cache", mapOf(CacheEntrySchema));

/** This copy's remembered zoom and detail height. */
export const RememberedSchema = Schema.Struct({
  zoom: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  detailH: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
});

export type Remembered = typeof RememberedSchema.Type;

const rememberedJson = Schema.fromJsonString(RememberedSchema);
const decodeRemembered = Schema.decodeUnknownOption(rememberedJson);
const encodeRemembered = Schema.encodeOption(rememberedJson);

/** What state.ts uses of localStorage. */
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage when the runtime has it (tests and stock Herdr may not). */
function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** This copy's remembered zoom and detail height; none kept (or a store that refuses): nothing. */
export function remembered(): Remembered {
  let text: string | null = null;

  // localStorage that refuses a read: nothing kept.
  try { text = store()?.getItem("view") ?? null; } catch { /* none, as said */ }

  return text === null ? {} : Option.getOrElse(decodeRemembered(text), (): Remembered => ({}));
}

/** Keeps this copy's zoom and detail height (a store that refuses: not kept). */
export function remember(v: Remembered): void {
  Option.map(encodeRemembered(v), (text) => { try { store()?.setItem("view", text); } catch { /* not kept, as said */ } });
}

/** A Claude Code pane in the shown space (a terminal's), with the name it shows under and its space's machine. */
export interface ClaudePane extends TerminalPaneInfo {
  readonly name: string;
  readonly machine: string | null;
}

const isTerminalPane = (p: PaneInfo): p is TerminalPaneInfo => p.terminal !== undefined;

/** Claude Code panes in the shown space, the shown tab's first. */
export function claudePanesOf(spaceList: readonly SpaceInfo[], paneList: readonly PaneInfo[], terminalList: readonly Terminal[]): readonly ClaudePane[] {
  return Option.match(Arr.findFirst(spaceList, (s) => s.active), {
    onNone: (): readonly ClaudePane[] => [],
    onSome: (space) => {
      const tabs = new Map<string, TabInfo>(Arr.map(space.tabs, (c) => [c.id, c] as const));

      // The shown tab first, then by position.
      const rank = (p: PaneInfo) => {
        const tab = tabs.get(p.tab);

        return (tab?.active === true ? 0 : 1000) + (tab?.index ?? 0);
      };

      return Arr.flatMap(paneList, (p): readonly ClaudePane[] => (isTerminalPane(p) && Str.isNonEmpty(p.terminal) && p.app === "claude-code" && tabs.has(p.tab)
        ? [{ ...p, name: Option.getOrElse(givenName(terminalList, p.terminal), () => p.program.name), machine: space.machine }]
        : []))
        .sort((a, b) => rank(a) - rank(b));
    },
  });
}

/** Claude Code panes in the shown space now (a render's read). */
export const claudePanes = (): readonly ClaudePane[] => claudePanesOf(spaces(), panes(), terminalsOf(terminals()));

/** "12s ago", "4m ago", "2h ago" at `now`. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));

  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

/** "$4.10", "$0.82", "<$0.01"; "≈" when a model had no price. */
export function money(u: Usage): string {
  const c = u.cost;
  const v = c > 0 && c < 0.01 ? "<$0.01" : c >= 100 ? `$${c.toFixed(0)}` : `$${c.toFixed(2)}`;

  return u.unpriced ? `≈${v}` : v;
}

/** A move of the selection: h parent, l first child, j / k down / up the column. */
export const StepSchema = Schema.Literals(["h", "j", "k", "l"]);

export const isStep = Schema.is(StepSchema);

export type Step = typeof StepSchema.Type;

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
