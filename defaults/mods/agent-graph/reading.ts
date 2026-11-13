// What the agent graph reads: the Claude pane it follows (or the one asked
// for), its session polled (snapshot, feed, usage; kept in the cache), the
// commands sent to it, the newest working agent, the file a step names.

import type { Context } from "gpui-kit";
import { focused, terminals, shared, setShared } from "herdr";
import { readSharedMap, writeSharedMap } from "./guard.ts";
import type { Snapshot } from "./claude.ts";
import { pack, unpack, sessionOf, snapshot, feed, usageOf } from "./claude.ts";
import { ZOOM } from "./graph.ts";
import type { Session, ClaudePane } from "./state.ts";
import { agentsProps, CACHE, claudePanes, STALE, isRunning, isLabelled, isStep, STATS } from "./state.ts";
import type { default as Agents } from "./main.ts";
import { pickNode, reveal, saveState, zoomTo } from "./navigate.ts";

/** Which Claude Code to show now. */
export function targetPane(v: Agents): ClaudePane | null {
  const list = claudePanes();
  const f = focused();
  const here = f?.terminal ? list.find((p) => p.terminal === f.terminal) : undefined;

  if (here && !v.pinned) v.terminal = here.terminal;

  if (!list.some((p) => p.terminal === v.terminal)) {
    v.terminal = list[0]?.terminal ?? null;
    v.pinned = false;
  }

  return list.find((p) => p.terminal === v.terminal) ?? null;
}

export function poll(v: Agents, cx: Context) {
  if (v.busy && Date.now() - v.busy < STALE) return;

  const pane = v.target();

  if (!pane) {
    if (v.data || v.session) {
      v.data = null;
      v.session = null;
      cx.notify();
    }

    return;
  }

  if (pane.machine) {
    v.error = "This space is on another machine: only this computer's Claude Code sessions can be read.";
    v.data = null;
    cx.notify();

    return;
  }

  const pid = terminals().filter(isRunning).find((x) => x.address === pane.terminal)?.foreground?.pid ?? null;
  const gen = (v.gen += 1);

  v.busy = Date.now();
  cx.spawn(async (cx) => {
    try {
      if (v.session?.pid !== pid) {
        const hit = readSharedMap(shared, CACHE).get(pane.terminal);

        if (hit && hit.session?.pid === pid) {
          v.session = hit.session;
          v.data = hit.data && unpack(hit.data);
          cx.notify();
        }
      }

      if (v.session?.pid !== pid) {
        const s = await sessionOf(pid);

        if (gen !== v.gen) return;

        if (v.session?.id !== s?.sessionId) {
          v.selected = null;
          v.detail = null;
          v.open = new Set();
        }

        v.session = s && pid !== null ? { pid, id: s.sessionId, name: s.name ?? null, cwd: s.cwd ?? null } : null;
      }

      if (!v.session) {
        v.data = null;
        v.error = pid ? "Waiting for Claude Code to write its session…" : "";

        return;
      }

      const data = await snapshot(v.session.id);

      if (gen !== v.gen) return;

      v.data = data;
      v.error = data ? "" : "No transcript for this session yet.";

      if (data) {
        keepSnapshot(v, pane.terminal, v.session, data);
        // Tokens per transcript (each read again only once it changed).
        v.usage = await usageOf([{ file: data.main, changed: data.mainChanged }, ...[...data.agents.values()].map((a) => ({ file: a.file, changed: a.changed }))]);

        // Opened with props { select: "working" }: start on a working agent, once the graph is laid out.
        if (agentsProps().select === "working" && !v.startedOn) {
          v.startedOn = true;
          cx.timer.after(50, (cx) => {
            toWorking(v, cx);
            cx.notify();
          });
        }
      }

      const file = selectedFile(v);
      const before = v.detail?.items.length ?? 0;

      v.detail = file ? await feed(file) : null;

      if (v.follow && v.detail && v.detail.items.length !== before) v.feedScroll?.scroll_to_bottom();
    } catch (cause: unknown) {
      v.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (gen === v.gen) v.busy = 0;

      cx.notify();
    }
  });
}

/** Keeps this read for the next copy that shows this terminal (only when it changed). */
export function keepSnapshot(v: Agents, terminal: string, session: Session, data: Snapshot) {
  const entry = { session, data: pack(data) };
  const json = JSON.stringify(entry);

  if (json === v.kept) return;

  v.kept = json;

  // Only terminals that still exist.
  const live = new Set(terminals().filter(isLabelled).map((x) => x.address));
  const all = new Map([...readSharedMap(shared, CACHE)].filter(([k]) => live.has(k)));

  all.set(terminal, entry);
  writeSharedMap(setShared, CACHE, all);
}

/** Follows the selected agent from now on: to its newest step. */
export function startFollowing(v: Agents) {
  v.follow = true;
  v.feedScroll?.scroll_to_bottom();
  v.pendingBottom = true; // again once the list has drawn with the newest rows
}

/** agent-graph.<command>: the keyboard's moves, for keys.json. */
export function runCommand(v: Agents, c: string, cx: Context) {
  if (c === "keys") {
    v.help = !v.help;

    return;
  }

  if (isStep(c)) {
    v.step(c, cx);

    return;
  }

  if (c === "in") zoomTo(v, v.zoom * ZOOM.step);
  else if (c === "out") zoomTo(v, v.zoom / ZOOM.step);
  else if (c === "reset") {
    v.zoom = 1;
    v.pan = null;
    saveState(v);
  } else if (c === "follow") startFollowing(v);
  else if (c === "working") toWorking(v, cx);
}

/** Selects the next working agent (after the selected one, wrapping) and follows it. */
export function toWorking(v: Agents, cx: Context) {
  const list = (v.layout ?? []).filter((n) => n.kind === "agent" && n.status === "working").sort((a, b) => a.x - b.x || a.y - b.y);
  const i = list.findIndex((n) => n.key === v.selected);
  const n = list[(i + 1) % list.length];

  if (!n) return;

  pickNode(v, n, cx, false);
  reveal(v, n);
  startFollowing(v);
}

/** The transcript behind the selected node, if it has one. */
export function selectedFile(v: Agents): string | null {
  if (!v.data || !v.selected || v.selected === STATS) return null;

  if (v.selected === "main") return v.data.main;

  return v.data.agents.get(v.selected)?.file ?? null;
}
