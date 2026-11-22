// The GitHub window's reads (main.ts calls them): the shown tab read now,
// one read at a time; the other tab read behind it; what's shown written to
// the cache (store.ts).

import { Effect } from "effect";
import type { Context } from "gpui-kit";
import type { Entry } from "./cache.ts";
import { entryFor, slimRepo } from "./cache.ts";
import { saveCache } from "./gh-await.ts";
import type { ReadOptions } from "./host.ts";
import type { default as GitHub } from "./main.ts";

/** A tab as the window reads it. */
type Tab = ReturnType<GitHub["shown"]>;

/** The cache is written at most this often. */
export const SAVE_EVERY = 10000;

/** The shown tab was read (gen: the read's place; a newer read or another repo dropped it): the bar's word, the
 *  next read's time, the cache, the other tab behind it, and a read asked for meanwhile. */
function finish(v: GitHub, cx: Context, tab: Tab, gen: number): void {
  if (v.closed || gen !== v.gen) return;

  v.busy = false;
  v.loud = false;
  // A failed read waits a little longer, so a dropped network doesn't spin.
  v.next = v.now() + (v.stale === "" ? tab.interval() : Math.max(15000, tab.interval()));
  v.save();

  if (v.dirty && v.now() - v.savedAt >= SAVE_EVERY) void persist(v);

  if (v.stale === "") warm(v, cx);

  cx.notify();

  if (v.again) {
    const o = v.againOpts ?? false;

    v.again = false;
    v.againOpts = null;
    refresh(v, cx, o);
  }
}

/** A tab's read, one at a time (the shown tab's waits for the read behind it, and the other way round). */
const readTab = (tab: Tab, opts: ReadOptions) => tab.reading.withPermits(1)(tab.read(opts));

/** Reads the shown tab now (`force`: true, or { all, fresh }); one read at a time, another asked meanwhile runs after it.
 *  The read is a run on the window: closing it ends the read. */
export function refresh(v: GitHub, cx: Context, force: boolean | ReadOptions = false): void {
  if (v.repo === null) return;

  const opts: ReadOptions = force === true ? { all: true, fresh: true } : force === false ? {} : force;

  if (v.busy) {
    v.again = true;

    if (opts.all === true) v.againOpts = opts;

    return;
  }

  v.busy = true;
  v.next = Infinity; // the tick doesn't queue another read behind this one

  const tab = v.shown();
  // Worth a word in the bar: asked for, or what's shown is old (a cached opening).
  const at = tab.readAt();

  v.loud = opts.all === true || at === 0 || v.now() - at > Math.max(2 * tab.interval(), 30000);

  const gen = ++v.gen;

  v.run(Effect.matchEffect(readTab(tab, opts), {
    onSuccess: () => Effect.sync(() => {
      if (gen !== v.gen) return;

      v.stale = "";
      v.dirty = true;
    }),
    onFailure: (e) => Effect.sync(() => {
      if (gen === v.gen) v.stale = e.message;
    }),
  }).pipe(Effect.ensuring(Effect.sync(() => finish(v, cx, tab, gen)))), { redraw: false });
}

/** Once the shown tab is read, the other one is read behind it, so switching shows fresh data. Its failure is
 *  its own read's to say once it's shown. */
export function warm(v: GitHub, _cx: Context): void {
  const other = v.tab === "prs" ? v.actions : v.prs;

  if (v.warmed?.has(other) === true) return;

  v.warmed ??= new Set();
  v.warmed.add(other);

  const repo = v.repo;

  v.run(Effect.ignore(Effect.tap(readTab(other, {}), () => Effect.sync(() => {
    if (v.repo === repo) v.dirty = true;
  }))));
}

/** Writes what's shown to the cache (store.ts), at most every SAVE_EVERY. */
export function persist(v: GitHub): Promise<boolean> | null {
  if (!v.repo || v.saving || v.state !== "ready") return v.saving;

  v.dirty = false;
  v.savedAt = Date.now();

  const entry: Entry = { ...entryFor(v.repo), repo: slimRepo(v.repo), prs: v.prs.snapshot(), actions: v.actions.snapshot(), projects: v.projects.snapshot() };

  const saving = saveCache(v.folder, entry).finally(() => {
    v.saving = null;
  });

  v.saving = saving;

  return saving;
}
