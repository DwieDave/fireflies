// The window's cache on disk: one file in the app's data folder
// (data/nocturne-github/cache.json), read once per opening and written a few
// seconds after new data arrives. Writes are atomic and compare-and-swap
// (writeTextFile), merged with what other windows wrote (cache.js merge).

import { appHome, readTextFile, writeTextFile } from "herdr";
import { parse, merge } from "./cache.js";

const path = () => `${appHome()}/data/nocturne-github/cache.json`;
// Read once and shared by this source version's copies: opening a window again is instant.
let last = null; // { text, doc }

/** The cache document (a blank one if there's none yet or it can't be read). */
export async function load() {
  try {
    const text = await readTextFile(path());
    last = { text, doc: parse(text) };
  } catch {
    last = { text: undefined, doc: parse("") };
  }
  return last.doc;
}

/** The document last read or written by this mod, without reading the disk (null before). */
export const peek = () => last?.doc ?? null;

/** Writes `entry` (the window's repo and its data) into the file. */
export async function save(folder, entry) {
  for (let tries = 0; tries < 3; tries++) {
    let text;
    try { text = await readTextFile(path()); } catch { text = null; }
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
