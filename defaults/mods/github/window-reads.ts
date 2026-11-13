// The GitHub window's reads (main.ts calls them): the shown tab read now,
// one read at a time; the other tab read behind it; what's shown written to
// the cache (store.ts).

import type { Context } from "gpui-kit";
import type { Entry } from "./cache.ts";
import { entryFor, slimRepo } from "./cache.ts";
import * as store from "./store.ts";
import type { ReadOptions } from "./host.ts";
import type { default as GitHub } from "./main.ts";

/** The cache is written at most this often. */
export const SAVE_EVERY = 10000;

/** Reads the shown tab now (`force`: true, or { all, fresh }); one read at a time, another asked meanwhile runs after it. */
export function refresh(v: GitHub, cx: Context, force: boolean | ReadOptions = false): void {
  if (!v.repo) return;

  const opts: ReadOptions = force === true ? { all: true, fresh: true } : force || {};

  if (v.busy) {
    v.again = true;

    if (opts.all) v.againOpts = opts;

    return;
  }

  v.busy = true;
  v.next = Infinity; // the tick doesn't queue another read behind this one

  const tab = v.shown();
  // Worth a word in the bar: asked for, or what's shown is old (a cached opening).
  const at = tab.readAt();

  v.loud = Boolean(opts.all) || !at || Date.now() - at > Math.max(2 * tab.interval(), 30000);

  const gen = ++v.gen;

  cx.spawn(async (cx) => {
    try {
      await tab.warming;
      await tab.poll(opts, cx);

      if (gen !== v.gen) return;

      v.stale = "";
      v.dirty = true;
    } catch (err) {
      if (gen === v.gen) v.stale = err instanceof Error ? err.message : String(err);
    } finally {
      if (!v.closed && gen === v.gen) {
        v.busy = false;
        v.loud = false;
        // A failed read waits a little longer, so a dropped network doesn't spin.
        v.next = Date.now() + (v.stale ? Math.max(15000, tab.interval()) : tab.interval());
        v.save();

        if (v.dirty && Date.now() - v.savedAt >= SAVE_EVERY) void persist(v);

        if (!v.stale) warm(v, cx);

        cx.notify();

        if (v.again) {
          const o = v.againOpts ?? false;

          v.again = false;
          v.againOpts = null;
          refresh(v, cx, o);
        }
      }
    }
  });
}

/** Once the shown tab is read, the other one is read behind it, so switching shows fresh data. */
export function warm(v: GitHub, cx: Context): void {
  const other = v.tab === "prs" ? v.actions : v.prs;

  if (v.warmed?.has(other) || other.warming) return;

  v.warmed ??= new Set();
  v.warmed.add(other);

  const repo = v.repo;

  const warming = (async () => {
    try {
      await other.poll({}, null);

      if (v.repo === repo) v.dirty = true;
    } catch {
      /* the tab's own read says it */
    }
  })();

  other.warming = warming;
  cx.spawn(async (cx) => {
    await warming;
    other.warming = null;

    if (!v.closed) cx.notify();
  });
}

/** Writes what's shown to the cache (store.ts), at most every SAVE_EVERY. */
export function persist(v: GitHub): Promise<boolean> | null {
  if (!v.repo || v.saving || v.state !== "ready") return v.saving;

  v.dirty = false;
  v.savedAt = Date.now();

  const entry: Entry = { ...entryFor(v.repo), repo: slimRepo(v.repo), prs: v.prs.snapshot(), actions: v.actions.snapshot(), projects: v.projects.snapshot() };

  const saving = store.save(v.folder, entry).catch(() => false).finally(() => {
    v.saving = null;
  });

  v.saving = saving;

  return saving;
}
