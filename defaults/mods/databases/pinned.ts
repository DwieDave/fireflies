// Pinned connections: the saved ones (connections.json under the app's data
// folder, one list for the machine: every Databases window and pane, in every
// space, after every restart). A sent or found one is pinned with P (s too):
// a cluster's secret is kept as its place (read again at each connect) and the
// port-forward it came from as its facts (kube.ts), never a value. A change is
// made to the file as it is now (another window may have changed it) and
// noticed in shared state (PINNED_KEY); every other open window reads the file
// again on its next tick. The active connection's object is never swapped by
// a re-read: a read going on keeps its answer.

import { Array as Arr, Clock, Effect, Equal, Option, String as Str } from "effect";
import { Shared, redraw } from "@fireflies/kit";
import type { Conn } from "./kinds.ts";
import { PINNED_KEY, changeConnections, readConnections } from "./store.ts";
import { dataHome } from "./session.ts";
import { saveFound } from "./conns.ts";
import { confirmRemove } from "./menus.ts";
import type { default as DbView } from "./main.ts";
import type { DbRun } from "./app.ts";

/** Changes the pinned list (on the file as it is now), then tells the other windows. Null when
 *  the file refused (said in the bar). */
export const changePinned = (v: DbView, change: (list: Conn[]) => Conn[]): Effect.Effect<Conn[] | null, never, DbRun> => changeConnections(dataHome(), change).pipe(
  Effect.tap((next) => Effect.gen(function* () {
    v.saved = keepActive(v, next);
    v.pinnedAt = yield* Clock.currentTimeMillis;
    yield* Shared.use((s) => s.set(PINNED_KEY, { at: v.pinnedAt, by: v.me }));
  })),
  Effect.catch((error) => Effect.as(Effect.sync(() => v.say(`the pinned connections weren't changed: ${error.message}`, "failed")), null)),
  Effect.ensuring(redraw),
);

/** The list with the active connection's own object where it is in it (same id, same fields):
 *  a read going on compares objects. */
function keepActive(v: DbView, list: Conn[]): Conn[] {
  const a = v.active;

  return a !== null ? Arr.map(list, (c) => (c.id === a.id && Equal.equals(c, a) ? a : c)) : list;
}

/** P: a pinned one asks to be unpinned (every window drops it); another is pinned. */
export function togglePin(v: DbView, c: Conn): void {
  if (c.origin === "saved") confirmRemove(v, c);
  else v.run(saveFound(v, c));
}

/** Reads the pinned list again when another window changed it (the window's tick). A file that
 *  can't be read leaves the list as it is (the next change tries again). */
export const syncPinned = (v: DbView): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const n = Option.getOrNull(yield* Shared.use((s) => s.get(PINNED_KEY)));

  if (n === null || n.at <= v.pinnedAt || n.by === v.me) return;

  v.pinnedAt = n.at;

  const at = v.saved[v.connAt]?.id ?? null;
  const list = yield* readConnections(dataHome());

  v.saved = keepActive(v, list);
  // A pinned one also listed as found or sent here: the pinned one stands.
  v.sent = Arr.filter(v.sent, (s) => !Arr.some(list, (p) => p.id === s.id));

  const again = at !== null && Str.isNonEmpty(at) ? Option.getOrElse(Arr.findFirstIndex(v.saved, (c) => c.id === at), () => -1) : -1;

  if (again >= 0) v.connAt = again;

  yield* redraw;
}).pipe(Effect.catch((error) => Effect.sync(() => v.say(`the pinned connections couldn't be read again: ${error.message}`, "failed"))));
