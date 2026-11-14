// Pinned connections: the saved ones (connections.json under the app's data
// folder, one list for the machine: every Databases window and pane, in every
// space, after every restart). A sent or found one is pinned with P (s too):
// a cluster's secret is kept as its place (read again at each connect) and the
// port-forward it came from as its facts (kube.ts), never a value. A change is
// made to the file as it is now (another window may have changed it) and
// noticed in shared state (PINNED_KEY); every other open window reads the file
// again on its next tick. The active connection's object is never swapped by
// a re-read: a read going on keeps its answer.

import type { Context } from "gpui-kit";
import { setShared, shared } from "herdr";
import type { Conn } from "./kinds.ts";
import { readShared, writeShared } from "./guard.ts";
import { PINNED_KEY, changeConnections, readConnections } from "./store.ts";
import { IO, dataHome } from "./session.ts";
import { saveFound } from "./conns.ts";
import { confirmRemove } from "./menus.ts";
import type { default as DbView } from "./main.ts";

/** Changes the pinned list (on the file as it is now), then tells the other windows. Null when
 *  the file refused (said in the bar). */
export async function changePinned(v: DbView, change: (list: Conn[]) => Conn[], cx: Context): Promise<Conn[] | null> {
  try {
    const next = await changeConnections(IO, dataHome(), change);

    v.saved = keepActive(v, next);
    v.pinnedAt = Date.now();
    writeShared(setShared, PINNED_KEY, { at: v.pinnedAt, by: v.me });
    cx.notify();

    return next;
  } catch (error) {
    v.say(`the pinned connections weren't changed: ${error instanceof Error ? error.message : String(error)}`, "failed");
    cx.notify();

    return null;
  }
}

/** The list with the active connection's own object where it is in it (same id, same fields):
 *  a read going on compares objects. */
function keepActive(v: DbView, list: Conn[]): Conn[] {
  const a = v.active;

  return a ? list.map((c) => (c.id === a.id && JSON.stringify(c) === JSON.stringify(a) ? a : c)) : list;
}

/** P: a pinned one asks to be unpinned (every window drops it); another is pinned. */
export function togglePin(v: DbView, c: Conn, cx: Context): void {
  if (c.origin === "saved") confirmRemove(v, c, cx);
  else void saveFound(v, c, cx);
}

/** Reads the pinned list again when another window changed it (the window's tick). */
export async function syncPinned(v: DbView, cx: Context): Promise<void> {
  const n = readShared(shared, PINNED_KEY, null);

  if (!n || n.at <= v.pinnedAt || n.by === v.me) return;

  v.pinnedAt = n.at;

  const at = v.saved[v.connAt]?.id ?? null;
  const list = await readConnections(IO, dataHome());

  v.saved = keepActive(v, list);
  // A pinned one also listed as found or sent here: the pinned one stands.
  v.sent = v.sent.filter((s) => !list.some((p) => p.id === s.id));

  const again = at ? v.saved.findIndex((c) => c.id === at) : -1;

  if (again >= 0) v.connAt = again;

  cx.notify();
}
