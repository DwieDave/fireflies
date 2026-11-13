// The files pane's filter line: the search as you type (fff's findFiles, or
// the folders listed so far elsewhere), its hits, a hit shown in the tree,
// enter on a row, the line's stops (tab), a page in the browser.

import type { Context } from "gpui-kit";
import { run, panes, findFiles } from "herdr";
import type { Found, Range } from "./logic.ts";
import { lists, fuzzy, grouped, isHtml, fileUrl, webOpen, base } from "./logic.ts";
import { HITS } from "./state.ts";
import { rowAt } from "./tree.ts";
import type { default as Files } from "./main.ts";
import { ownPane } from "./opening.ts";
import { startDraft } from "./file-ops.ts";
import type { NewKind, Stop } from "./fit.ts";

/** Hits for the query, under their folders: fff's index of the root
 *  (findFiles); where it can't go (home, /, another machine), the folders
 *  listed so far. */
export function runSearch(v: Files, cx: Context): void {
  const q = v.query.trim();
  const seq = ++v.seq;

  if (!q) {
    v.hits = null;
    v.note = null;
    cx.notify();

    return;
  }

  const root = v.root;

  const done = (files: readonly Found[], note: string | null): void => {
    if (seq !== v.seq) return;

    const hits = grouped(files.filter((f) => lists(f.path, v.filters, v.ignored)).slice(0, HITS));
    const i = hits.findIndex((r) => !r.head);

    v.hits = hits;
    v.note = note;
    v.sel = hits[i]?.path ?? null;

    if (i >= 0) v.scroll?.scroll_to_item(i);

    cx.notify();
  };

  if (v.on) {
    done(loaded(v, q), "searching the folders listed so far");

    return;
  }

  cx.spawn(async (cx) => {
    try {
      const r = await findFiles(root, q, { limit: HITS });

      if (seq !== v.seq || root !== v.root) return;

      done(r.files, r.scanning ? "indexing the folder… (hits grow)" : null);

      if (r.scanning) {
        cx.timer.after(800, (cx) => {
          if (seq === v.seq) v.search(cx);
        });
      }
    } catch {
      done(loaded(v, q), "searching the folders listed so far");
    }
  });
}

/** Files listed so far that match `q` fuzzily, closest first. */
export function loaded(v: Files, q: string): Found[] {
  const out: { readonly path: string; readonly ranges: readonly Range[] }[] = [];

  for (const [prefix, entries] of v.entries) {
    for (const e of entries) {
      if (e.dir) continue;

      const path = prefix ? `${prefix}/${e.name}` : e.name;
      const ranges = fuzzy(q, path);

      if (ranges) out.push({ path, ranges });
    }
  }

  const spread = (f: { readonly path: string; readonly ranges: readonly Range[] }): number => f.ranges.length * 100 + f.path.length;

  return out.sort((a, b) => spread(a) - spread(b));
}

/** `/` and a click on the filter line: draws the filter's input, then gives
 *  it the keyboard. An input that isn't drawn can't take the focus (and its
 *  "focus" event, which turns `typing` on and so draws it, never comes), so
 *  the focus waits for the frames after this one. */
export function startFind(v: Files, cx: Context): void {
  v.finding = true;

  for (const ms of [16, 60, 200]) {
    cx.timer.after(ms, () => {
      if (v.finding && !v.typing) v.input?.focus();
    });
  }

  cx.notify();
}

/** w, the menu's "Open in a web pane": an HTML file (relative to the root) as
 *  a page in the web pane (logic.ts webOpen): a new front tab in the shown
 *  tab's one, else a new one beside this pane. Enter keeps opening it as before. */
export function openWeb(v: Files, path: string, cx: Context): void {
  if (!isHtml(path)) {
    v.say(`w opens HTML pages in a web pane: “${base(path)}” isn't one`, cx);

    return;
  }

  if (v.on) {
    v.say("A page on another machine can't open in the web pane", cx);

    return;
  }

  const tab = v.shownTab();
  const browsers = panes().filter((p) => p.tab === tab && p.mod === "browser");
  const from = (ownPane(v) ?? (v.alone ? null : v.panel()))?.pane ?? null;
  const slot = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const [name, args] = webOpen(fileUrl(`${v.root}/${path}`), { browsers, from, slot });

  if (args === undefined) run(name);
  else run(name, args);
}

/** The filter line's stop `stop` pressed (enter / space on its ring). */
export function pressStop(v: Files, stop: Stop, cx: Context): void {
  if (stop === "hidden" || stop === "ignored") v.setFilter(stop, cx);
  else if (stop === "keys") v.keysShown = !v.keysShown;
  else addNew(v, stop === "add-file" ? "file" : "folder", cx);
}

/** + file / + folder (the filter line's chips, the empty folder's line):
 *  `a` / `A`'s name row, in the selected folder (beside a selected file),
 *  in the root with nothing selected. */
export function addNew(v: Files, kind: NewKind, cx: Context): void {
  v.stop = null;

  const row = v.shown().find((r) => r.path === v.sel && !r.head) ?? null;

  startDraft(v, kind, row, cx);
}

export function clearSearch(v: Files, cx: Context | null): void {
  v.query = "";
  v.hits = null;
  v.note = null;
  v.seq++;
  v.finding = false;
  v.input?.set_value("");
  v.focus();
  cx?.notify();
}

/** Shows a folder from the hits in the tree: the search ends, it unfolds there. */
export function reveal(v: Files, path: string, cx: Context): void {
  clearSearch(v, cx);

  const parts = path.split("/");

  for (let n = 1; n <= parts.length; n++) {
    const p = parts.slice(0, n).join("/");

    if (!v.folders.has(p)) v.toggle(p, cx);
  }

  v.want = path;
}

/** Enter: a hit opens (a folder shows in the tree); in the tree, a file opens and a folder folds. */
export function enterRow(v: Files, cx: Context): void {
  const row = rowAt(v, v.sel);

  if (!row) return;

  if (row.head) reveal(v, row.path, cx);
  else if (row.dir) v.toggle(row.path, cx);
  else v.openFile(row.path, cx);
}
