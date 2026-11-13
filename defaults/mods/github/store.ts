// The window's cache on disk: one file in the app's data folder
// (data/github/cache.json), read once per opening and written a few
// seconds after new data arrives. Writes are atomic and compare-and-swap
// (writeTextFile), merged with what other windows wrote (cache.ts merge).

import { appHome, readTextFile, writeTextFile } from "herdr";
import type { Doc, Written } from "./cache.ts";
import { parse, merge } from "./cache.ts";

const path = () => `${appHome()}/data/github/cache.json`;

// Read once and shared by this source version's copies: opening a window again is instant.
let last: { readonly text: string | null; readonly doc: Doc } | null = null;

/** The cache document (a blank one if there's none yet or it can't be read). */
export async function load(): Promise<Doc> {
  let text: string | null = null;

  try {
    text = await readTextFile(path());
  } catch {
    text = null;
  }

  const doc = parse(text);

  last = { text, doc };

  return doc;
}

/** The document last read or written by this mod, without reading the disk (null before). */
export const peek = (): Doc | null => last?.doc ?? null;

/** Writes `entry` (the window's repo and its data) into the file. */
export async function save(folder: string | null, entry: Written): Promise<boolean> {
  for (let tries = 0; tries < 3; tries++) {
    let text: string | null;

    try {
      text = await readTextFile(path());
    } catch {
      text = null;
    }

    const next = merge(text ?? "", folder, entry);

    try {
      await writeTextFile(path(), next, text ?? null);
      last = { text: next, doc: parse(next) };

      return true;
    } catch {
      // Another window wrote in between: read and merge again.
    }
  }

  return false;
}
