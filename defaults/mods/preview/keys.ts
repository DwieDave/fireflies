// The preview's keys as the `?` strip lists them, per way of showing a file,
// and a key event's name (no herdr imports: bun tests it).

import type { KeyRow } from "./keyhelp.ts";
import type { LookKind } from "./kinds.ts";

/** A key as keyOf reads it (GPUI's KeyEvent has these and more). */
export interface NamedKey {
  readonly key?: string | undefined;
  readonly key_char?: string | null | undefined;
}

/** How the preview shows a file, as keyList tells them apart. */
export type ShownAs = "image" | "raster" | "native" | "table" | "diff" | "markdown" | "text" | "none";

/** What the strip says beside the way of showing: a text file the editor can
 *  edit, pages to step through, a database's tables. */
export interface KeyListOptions {
  readonly editable?: boolean;
  readonly paged?: boolean;
  readonly db?: boolean;
}

/** A key event's name: the typed character for printable keys ("G", "}",
 *  "?", "+"), else GPUI's key ("space", "enter", "left", "tab"). */
export function keyOf(e: NamedKey | null | undefined): string {
  const c = e?.key_char;

  if (c && c.length === 1 && c.trim()) return c;

  return e?.key ?? "";
}

const COMMON: readonly KeyRow[] = [["n p  ] [", "next / prev file"], ["o", "open in its app"], ["y", "copy path"], ["f", "files"]];
const AFTER: readonly KeyRow[] = [["tab ⇧tab", "the bar's buttons (⏎ presses)"], ["esc", "out of the bar · keys away"], ["?", "keys"]];

/** The keys of one way of showing a file. */
function ownKeys(how: ShownAs | null, kind: LookKind | null, options: KeyListOptions): KeyRow[] {
  const { paged = false, db = false } = options;

  if (how === "image" || how === "raster") {
    return [["+ -", "zoom"], ["0", "fit"], ["1", "100%"], ["h j k l  ← ↑ ↓ →", "pan (fitted: h l step)"],
      ["space ⌫  pgdn pgup", paged ? "pages" : "next / prev file"], ...(paged ? [["g G", "first / last"] as const] : []), ["r R", "turn"], ["b", "background"]];
  }

  if (how === "native" && kind === "pdf") {
    return [["+ -", "zoom"], ["0", "fit width"], ["← →  h l", "pages"], ["space ⌫  pgdn pgup", "pages"], ["g G", "first / last"], ["esc", "out of the page"]];
  }

  if (how === "native" && (kind === "video" || kind === "audio")) {
    return [["space k", "play / pause"], ["← →  h l", "5 s"], ["⇧← ⇧→  H L", "30 s"], ["0 home", "start"], ["m", "sound"], ["esc", "out of the player"]];
  }

  if (how === "native") return [["esc", "out of the view"]];

  if (how === "table" || how === "diff") {
    const rows: KeyRow[] = [["j k  ↑ ↓", "rows"], ["J K  pgdn pgup", "pages"], ["g G  home end", "top / bottom"]];

    if (how === "table") rows.push(["h l  ← →", "columns"]);

    if (how === "diff") rows.push(["} {", "next / prev file"]);

    if (db) rows.push(["t T", "tables"]);

    return rows;
  }

  return [];
}

/** [[keys, what]] for the strip, every key main.ts's key() takes for it: `how` is
 *  the preview's way of showing it (image, raster, native, table, diff), `kind`
 *  the file's kind. */
export function keyList(how: ShownAs | null, kind: LookKind | null, options: KeyListOptions = {}): KeyRow[] {
  return [...ownKeys(how, kind, options), ...COMMON, ...(options.editable ? [["e", "edit"] as const] : []), ...AFTER];
}

/** The next control in a ring of ids, from `at` (null: none yet), `dir` ±1. */
export function cycle(ids: readonly string[], at: string | null, dir: number): string | null {
  if (!ids.length) return null;

  const i = at === null ? -1 : ids.indexOf(at);

  if (i < 0) return (dir > 0 ? ids[0] : ids[ids.length - 1]) ?? null;

  return ids[(i + dir + ids.length) % ids.length] ?? null;
}
