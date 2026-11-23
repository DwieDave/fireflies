// What the agent graph reads: the Claude pane it follows (or the one asked
// for), its session polled (snapshot, feed, usage; kept in the cache), the
// commands sent to it, the newest working agent.

import { focused } from "herdr";
import { Array as Arr, Duration, Effect, Option, Schema } from "effect";
import { Shared, Workspace, redraw } from "@fireflies/kit";
import type { Exec, Files, Redraw } from "@fireflies/kit";
import type { Snapshot } from "./claude.ts";
import { pack, unpack, sessionOf, snapshot, feed, usageOf } from "./claude.ts";
import { ZOOM } from "./graph.ts";
import type { CacheEntry, Session, ClaudePane, Terminal } from "./state.ts";
import { CACHE, CacheEntrySchema, POLL, STALE, STATS, claudePanes, claudePanesOf, isStep, pidOf, terminalsOf } from "./state.ts";
import type { default as Agents } from "./main.ts";
import { reveal, saveState, select, zoomTo } from "./navigate.ts";

/** Which Claude Code to show, of `list`, with `here` the focused pane's terminal: the focused
 *  one unless one was picked, else the one shown, else the first. */
export function targetOf(v: Agents, list: readonly ClaudePane[], here: string | null): ClaudePane | null {
  const mine = (terminal: string | null) => Arr.findFirst(list, (p) => p.terminal === terminal);

  if (!v.pinned) Option.map(mine(here), (p) => { v.terminal = p.terminal; });

  if (Option.isNone(mine(v.terminal))) {
    v.terminal = list[0]?.terminal ?? null;
    v.pinned = false;
  }

  return Option.getOrNull(mine(v.terminal));
}

/** Which Claude Code to show now (a render's read). */
export const targetPane = (v: Agents): ClaudePane | null => targetOf(v, claudePanes(), focused()?.terminal ?? null);

/** What the poll needs of the app. */
type PollApp = Exec | Files | Shared | Workspace | Redraw;

const entryJson = Schema.encodeOption(Schema.fromJsonString(CacheEntrySchema));

/** Keeps this read for the next copy that shows this terminal (only when it changed), and only
 *  terminals that still exist. */
const keepSnapshot = (v: Agents, terminal: string, session: Session, data: Snapshot, live: readonly Terminal[]): Effect.Effect<void, never, Shared> => {
  const entry: CacheEntry = { session, data: pack(data) };
  const json = Option.getOrNull(entryJson(entry));

  if (json === null || json === v.kept) return Effect.void;

  v.kept = json;

  return Effect.gen(function* () {
    const shared = yield* Shared;
    const addresses = new Set(Arr.map(live, (x) => x.address));
    const before = yield* shared.get(CACHE);
    const kept = Option.getOrElse(before, (): ReadonlyMap<string, CacheEntry> => new Map());
    const all = new Map(Arr.filter(Arr.fromIterable(kept), ([k]) => addresses.has(k)));

    all.set(terminal, entry);
    yield* shared.set(CACHE, all);
  });
};

/** The session read: the snapshot kept, the tokens, the selected node's feed. */
const readSession = Effect.fnUntraced(function* (v: Agents, terminal: string, session: Session, live: readonly Terminal[]): Effect.fn.Return<void, never, PollApp> {
  const read = yield* snapshot(session.id).pipe(
    Effect.asSome,
    // No shell to read with: said, and the last read stays on screen.
    Effect.catchTag("ExecError", (e) => Effect.sync(() => {
      v.error = `The session can't be read: ${e.message}`;

      return Option.none<Option.Option<Snapshot>>();
    })),
  );

  if (Option.isNone(read)) return;

  const data = Option.getOrNull(read.value);

  v.data = data;
  v.error = data === null ? "No transcript for this session yet." : "";

  if (data !== null) {
    yield* keepSnapshot(v, terminal, session, data, live);
    // Tokens per transcript (each read again only once it changed).
    const usage = yield* usageOf([{ file: data.main, changed: data.mainChanged }, ...Arr.map(Arr.fromIterable(data.agents.values()), (a) => ({ file: a.file, changed: a.changed }))]);

    v.usage = usage;

    // Opened with props { select: "working" }: start on a working agent, once the graph is laid out.
    if (v.selectWorking && !v.startedOn) {
      v.startedOn = true;
      yield* redraw;
      yield* Effect.sleep(Duration.millis(50));
      toWorking(v);
    }
  }

  const file = selectedFile(v);
  const before = v.detail?.items.length ?? 0;

  const detail = file === null ? Option.none() : yield* feed(file);

  v.detail = Option.getOrNull(detail);

  if (v.follow && v.detail !== null && v.detail.items.length !== before) v.feedScroll?.scroll_to_bottom();
});

/** One read: the Claude pane to follow, its session (from the cache first), then its files. */
export const pollOnce = Effect.fnUntraced(function* (v: Agents): Effect.fn.Return<void, never, PollApp> {
  const w = yield* Workspace;
  const terminals = yield* w.terminals;
  const spaces = yield* w.spaces;
  const panes = yield* w.panes;
  const focused = yield* w.focused;
  const live = terminalsOf(terminals);
  const list = claudePanesOf(spaces, panes, live);
  const here = Option.getOrNull(Option.flatMap(focused, (f) => Option.fromNullishOr(f.terminal)));
  const pane = targetOf(v, list, here);

  if (pane === null) {
    v.data = null;
    v.session = null;

    return;
  }

  if (pane.machine !== null) {
    v.error = "This space is on another machine: only this computer's Claude Code sessions can be read.";
    v.data = null;

    return;
  }

  const pid = Option.getOrNull(pidOf(live, pane.terminal));

  if (v.session?.pid !== pid) {
    const kept = yield* Shared.use((s) => s.get(CACHE));
    const hit = Option.filter(Option.flatMap(kept, (m) => Option.fromUndefinedOr(m.get(pane.terminal))), (h) => h.session !== null && h.session.pid === pid);

    if (Option.isSome(hit)) {
      v.session = hit.value.session;
      v.data = hit.value.data === null ? null : unpack(hit.value.data);
      yield* redraw;
    }
  }

  if (v.session?.pid !== pid) {
    const s = pid === null ? Option.none() : yield* sessionOf(pid);
    const id = Option.getOrNull(Option.map(s, (x) => x.sessionId));

    if ((v.session?.id ?? null) !== id) {
      v.selected = null;
      v.detail = null;
      v.open = new Set();
    }

    v.session = pid === null ? null : Option.getOrNull(Option.map(s, (x): Session => ({ pid, id: x.sessionId, name: x.name ?? null, cwd: x.cwd ?? null })));
  }

  if (v.session === null) {
    v.data = null;
    v.error = pid === null ? "" : "Waiting for Claude Code to write its session…";

    return;
  }

  yield* readSession(v, pane.terminal, v.session, live);
});

/** The poll: a read, a redraw, a pause, for as long as the copy lives. A read that hangs is
 *  given up after STALE (the next one starts). */
export const pollLoop = (v: Agents): Effect.Effect<never, never, PollApp> =>
  Effect.forever(pollOnce(v).pipe(
    Effect.timeoutOption(Duration.millis(STALE)),
    Effect.andThen(redraw),
    Effect.andThen(Effect.sleep(Duration.millis(POLL))),
  ));

/** Follows the selected agent from now on: to its newest step. */
export function startFollowing(v: Agents): void {
  v.follow = true;
  v.feedScroll?.scroll_to_bottom();
  v.pendingBottom = true; // again once the list has drawn with the newest rows
}

/** agent-graph.<command>: the keyboard's moves, for keys.json. */
export function runCommand(v: Agents, c: string): void {
  if (c === "keys") {
    v.help = !v.help;

    return;
  }

  if (isStep(c)) {
    v.step(c);

    return;
  }

  if (c === "in") zoomTo(v, v.zoom * ZOOM.step);
  else if (c === "out") zoomTo(v, v.zoom / ZOOM.step);
  else if (c === "reset") {
    v.zoom = 1;
    v.pan = null;
    saveState(v);
  } else if (c === "follow") startFollowing(v);
  else if (c === "working" && toWorking(v)) v.poll();
}

/** Selects the next working agent (after the selected one, wrapping) and follows it: true when
 *  there was one (the caller reads its steps). */
export function toWorking(v: Agents): boolean {
  const list = Arr.filter(v.layout ?? [], (n) => n.kind === "agent" && n.status === "working").sort((a, b) => a.x - b.x || a.y - b.y);
  const i = Option.getOrElse(Arr.findFirstIndex(list, (n) => n.key === v.selected), () => -1);
  const n = list[(i + 1) % list.length];

  if (n === undefined) return false;

  select(v, n, false);
  reveal(v, n);
  startFollowing(v);

  return true;
}

/** The transcript behind the selected node, if it has one. */
export function selectedFile(v: Agents): string | null {
  if (v.data === null || v.selected === null || v.selected === STATS) return null;

  if (v.selected === "main") return v.data.main;

  return v.data.agents.get(v.selected)?.file ?? null;
}
