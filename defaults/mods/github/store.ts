// The window's cache on disk: one file in the app's data folder
// (data/github/cache.json), read once per opening and written a few
// seconds after new data arrives, through the kit's `Files`. Writes are
// compare-and-swap: one refused because another window wrote meanwhile
// (`StaleFile`) is merged again with what's there now (cache.ts merge) and
// retried, twice.

import { Effect, Option, Predicate } from "effect";
import { Files } from "@fireflies/kit";
import type { Doc, Entry } from "./cache.ts";
import { parse, merge } from "./cache.ts";

/** The cache file, under the app's folder. */
export const cachePath = (home: string): string => `${home}/data/github/cache.json`;

// Read once and shared by this source version's copies: opening a window again is instant.
let last: { readonly text: string | null; readonly doc: Doc } | null = null;

/** The cache document (a blank one if there's none yet or it isn't in this version's shape).
 *  A file that can't be read is a `FileError` (the window opens without the cache and says so). */
export const load = (path: string) => Effect.gen(function* () {
  const text = yield* Effect.map(Files.use((f) => f.read(path)), Option.getOrNull);
  const doc = parse(text);

  last = { text, doc };

  return doc;
});

/** The document last read or written by this mod, without reading the disk (null before). */
export const peek = (): Doc | null => last?.doc ?? null;

/** Writes `entry` (the window's repo and its data, seen in `folder`) into the file at `now`. */
export const save = (path: string, folder: string | null, entry: Entry, now: number) => Effect.gen(function* () {
  const files = yield* Files;
  const text = yield* Effect.map(files.read(path), Option.getOrNull);
  const next = merge(text ?? "", folder, entry, now);

  yield* files.write(path, next, text);
  last = { text: next, doc: parse(next) };
}).pipe(Effect.retry({ times: 2, while: Predicate.isTagged("StaleFile") }));
