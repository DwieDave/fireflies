// The preview's keys as the `?` strip lists them, per way of showing a file,
// and a key event's name (no herdr imports: bun tests it).

/** A key event's name: the typed character for printable keys ("G", "}",
 *  "?", "+"), else GPUI's key ("space", "enter", "left", "tab"). */
export function keyOf(e) {
  const c = e?.key_char;
  if (typeof c === "string" && c.length === 1 && c.trim()) return c;
  return String(e?.key ?? "");
}

const COMMON = [["n p  ] [", "next / prev file"], ["o", "open in its app"], ["y", "copy path"], ["f", "files"]];
const AFTER = [["tab ⇧tab", "the bar's buttons (⏎ presses)"], ["esc", "out of the bar · keys away"], ["?", "keys"]];

/** [[keys, what]] for the strip, every key main.js's key() takes for it: `how` is
 *  the preview's way of showing it (image, raster, native, table, diff), `kind`
 *  the file's kind. */
export function keyList(how, kind, { editable = false, paged = false, db = false } = {}) {
  const own = [];
  if (how === "image" || how === "raster") {
    own.push(["+ -", "zoom"], ["0", "fit"], ["1", "100%"], ["h j k l  ← ↑ ↓ →", "pan (fitted: h l step)"],
      ["space ⌫  pgdn pgup", paged ? "pages" : "next / prev file"]);
    if (paged) own.push(["g G", "first / last"]);
    own.push(["r R", "turn"], ["b", "background"]);
  } else if (how === "native" && kind === "pdf") {
    own.push(["+ -", "zoom"], ["0", "fit width"], ["← →  h l", "pages"], ["space ⌫  pgdn pgup", "pages"], ["g G", "first / last"], ["esc", "out of the page"]);
  } else if (how === "native" && (kind === "video" || kind === "audio")) {
    own.push(["space k", "play / pause"], ["← →  h l", "5 s"], ["⇧← ⇧→  H L", "30 s"], ["0 home", "start"], ["m", "sound"], ["esc", "out of the player"]);
  } else if (how === "native") {
    own.push(["esc", "out of the view"]);
  } else if (how === "table" || how === "diff") {
    own.push(["j k  ↑ ↓", "rows"], ["J K  pgdn pgup", "pages"], ["g G  home end", "top / bottom"]);
    if (how === "table") own.push(["h l  ← →", "columns"]);
    if (how === "diff") own.push(["} {", "next / prev file"]);
    if (db) own.push(["t T", "tables"]);
  }
  return [...own, ...COMMON, ...(editable ? [["e", "edit"]] : []), ...AFTER];
}

/** The next control in a ring of ids, from `at` (null: none yet), `dir` ±1. */
export function cycle(ids, at, dir) {
  if (!ids.length) return null;
  const i = ids.indexOf(at);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}
