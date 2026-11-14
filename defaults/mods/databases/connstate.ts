// Whether a connection is connected, said one way for every place that shows
// it (the head's mark, its row's pip in [1], its pin's hover). The window
// holds no standing connection: each read is a client run. So "connected"
// means the last run on it answered (any answer, an SQL error too: the server
// spoke), it turns at once when a run finds the connection gone (psql's exit
// 2, MySQL's connect errors, a read past its deadline), and it is checked
// again with one `select 1` when the window gets the focus after a while
// (a forward that died says so, not a lit mark over a dead port).

import type { Color, Context } from "gpui-kit";
import type { Theme } from "herdr";
import type { Conn, Kind } from "./kinds.ts";
import type { Where } from "./dbs.ts";
import { whereNow } from "./dbs.ts";
import { readIn, reading } from "./reads.ts";
import { runOn } from "./session.ts";
import type { default as DbView } from "./main.ts";

/** A connection's state:
 *  off         not the active connection
 *  connecting  being connected (its secret read, its forward started, its tables read the first time)
 *  reading     connected, its tables read again
 *  connected   the last run answered
 *  failed      the last run didn't reach the server (or the connect didn't), with why */
export type ConnState =
  | { readonly kind: "off" }
  | { readonly kind: "connecting"; readonly what: string }
  | { readonly kind: "reading"; readonly since: number; readonly at: number }
  | { readonly kind: "connected"; readonly since: number; readonly at: number }
  | { readonly kind: "failed"; readonly why: string };

/** After how long without an answer the focus coming back checks the connection again. */
export const RECHECK_AFTER = 30000;

/** The state of `c` in this window. */
export function connState(v: DbView, c: Conn | null): ConnState {
  if (!c || v.active?.id !== c.id) return { kind: "off" };

  const a = v.alive?.conn === c.id ? v.alive : null;
  const f = v.forwardAsk?.conn.id === c.id ? v.forwardAsk : null;

  if (f?.starting) return { kind: "connecting", what: "starting its forward" };

  if (f) return { kind: "failed", why: f.why === "gone" ? `its forward's pod isn't there${f.note ? `: ${f.note}` : ""}` : f.why === "taken" ? `another program answers on localhost:${f.local}` : `no forward on localhost:${f.local}` };

  if (v.password?.conn === c.id) return { kind: "connecting", what: "waiting for its password" };

  if (v.catalog.busy) return a?.ok ? { kind: "reading", since: a.since, at: a.at } : { kind: "connecting", what: readIn(v, "tables")?.what ?? "connecting" };

  if (a && !a.ok) return { kind: "failed", why: a.why ?? "it didn't answer" };

  if (a?.ok) return { kind: "connected", since: a.since, at: a.at };

  if (v.catalog.error) return { kind: "failed", why: v.catalog.error };

  return { kind: "connecting", what: readIn(v, "tables")?.what ?? "connecting" };
}

/** The state in a word or two (the head's mark). */
export function stateWord(s: ConnState): string {
  switch (s.kind) {
    case "off": return "not connected";
    case "connecting": return "connecting…";
    case "reading": return "reading…";
    case "connected": return "connected";
    case "failed": return "not connected";
  }
}

/** The state's colour: dim off, the work colour while it connects or reads, green connected, red failed. */
export function stateColor(t: Theme, s: ConnState): Color {
  switch (s.kind) {
    case "off": return t.ansi8;
    case "connecting":
    case "reading": return t.working;
    case "connected": return t.done;
    case "failed": return t.blocked;
  }
}

/** Whether the state's pip breathes (work going on). */
export const breathes = (s: ConnState): boolean => s.kind === "connecting" || s.kind === "reading";

/** A clock time, "14:02:09". */
const clock = (at: number): string => new Date(at).toTimeString().slice(0, 8);

/** Seconds or minutes ago, in words. */
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));

  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** The state's hover: since when, what it means here, why it failed. */
export function stateTip(s: ConnState, w: Where | null, readonly: boolean, now = Date.now()): string {
  const ro = readonly ? " · read only: writes are refused" : "";
  const there = w ? ` · in ${w.database ?? "every database"}${w.fallback ? " (the server's default: none was named)" : ""}${w.user ? ` as ${w.user}` : ""}` : "";

  switch (s.kind) {
    case "off": return "Not connected · enter on a connection in [1] connects";
    case "connecting": return `Connecting: ${s.what}${ro}`;
    case "reading":
    case "connected": return `Connected since ${clock(s.since)}${there} · the last read answered ${ago(s.at, now)} · each read is a client run: it is checked again when the window gets the focus after ${RECHECK_AFTER / 1000} s, and turns at once when a read can't reach the server${ro} · click or C: its menu`;
    case "failed": return `Not connected: ${s.why}${ro} · click or C: reconnect, edit`;
  }
}

/** Whether a client run's exit says the connection itself failed (not a statement): psql exits 2
 *  when it can't connect or loses the connection; MySQL names its connect and auth errors. */
export function lostRun(kind: Kind, code: number, stderr: string): boolean {
  if (kind === "postgres") return code === 2;

  if (kind === "mysql") return code !== 0 && /ERROR (1045|1044|2002|2003|2005|2006|2013|2026|2059)\b/.test(stderr);

  return code !== 0 && /unable to open database|file is not a database/i.test(stderr);
}

/** What a run on `c` says of the connection: an answer (it stands, its time noted) or a lost
 *  connection (failed, with why). Only the active connection is tracked. */
export function heard(v: DbView, c: Conn, ok: boolean, why: string | null, now = Date.now()): void {
  if (v.active?.id !== c.id) return;

  const a = v.alive?.conn === c.id ? v.alive : null;

  if (ok) v.alive = { conn: c.id, ok: true, since: a?.ok ? a.since : now, at: now, why: null };
  else v.alive = { conn: c.id, ok: false, since: a?.since ?? now, at: a?.at ?? now, why };
}

/** The window got the focus: a connection that last answered a while ago is asked once more. */
export function focusArrived(v: DbView, cx: Context, now = Date.now()): void {
  const a = v.alive;

  if (!a?.ok || v.active?.id !== a.conn || now - a.at < RECHECK_AFTER || v.catalog.busy || v.checking) return;

  void recheck(v, cx);
}

/** One `select 1` on the active connection (runOn notes what it says). */
export async function recheck(v: DbView, cx: Context): Promise<void> {
  const c = v.active;

  if (!c) return;

  v.checking = true;

  try {
    const e = await reading(v, "checking it still answers", "conns", cx, (started) => runOn(v, c, [{ text: "select 1", risk: "read" }], started, undefined, "a check that it answers"), 20000);

    if (!("value" in e)) heard(v, c, false, "late" in e ? `no answer after ${Math.round(e.late / 1000)} s` : "the check was stopped");
  } catch (error) {
    heard(v, c, false, error instanceof Error ? error.message : String(error));
  } finally {
    v.checking = false;
    cx.notify();
  }
}

/** Where the active connection is, for the mark (null when it's off). */
export const whereOf = (v: DbView, c: Conn | null): Where | null => (c && v.active?.id === c.id ? whereNow(c, v.catalog.here) : null);
