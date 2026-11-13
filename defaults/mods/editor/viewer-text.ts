// The viewer's text: a text file's head read and highlighted, the embedded
// look (text, code, Markdown), wrapping, scrolling, drawn with its rail.
// Shared like viewer.ts.

import { div } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, TextView } from "gpui-base";
import { highlight, languageOf } from "herdr";
import type { Theme } from "herdr";
import type { Run } from "./kinds.ts";
import { fileSize, syntaxColors, lineStarts, lineRuns, wrapRows, rowLine, sliceRuns } from "./kinds.ts";
import { MAX_BYTES, MAX_ROWS, separator, parse as parseTable, table, wholeLines, shownNote } from "./table.ts";
import { parse as parsePatch } from "./diff.ts";
import type { TextLook, Wrapped } from "./viewer-state.ts";
import { held, sh, blank, lastPart, TEXT_HEAD, LOOK_MD_BYTES, LOOK_BYTES, LOOK_HEAD, unzoom, LINE, CH, ROW, zoom, checker, code } from "./viewer-state.ts";
import { failWith, failed } from "./viewer-load.ts";
import type { default as Viewer } from "./viewer.ts";
import { rowCount, scrollBy } from "./viewer-table.ts";
import { pageGo, panPicture, pannable, pictured } from "./viewer-pan.ts";

/** CSV, TSV, patches: the first MAX_BYTES as text. */
export async function loadText(v: Viewer, cx: Context, gen: number): Promise<void> {
  const r = await sh(TEXT_HEAD, [v.path], v.on);

  if (gen !== v.gen) return;

  if (r.code !== 0) {
    const e = failed(r);

    if (e !== v.error) failWith(v, cx, e);

    return;
  }

  const nl1 = r.stdout.indexOf("\n");
  const nl2 = r.stdout.indexOf("\n", nl1 + 1);
  const bytes = Number(r.stdout.slice(0, nl1).trim());
  const lines = Number(r.stdout.slice(nl1 + 1, nl2).trim());
  const body = r.stdout.slice(nl2 + 1);
  const stamp = `${bytes}:${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;

  if (v.stamp === stamp && !v.error) return;

  v.stamp = stamp;

  const partial = bytes > MAX_BYTES;
  const text = wholeLines(body, partial);

  v.info = blank(bytes);

  if (v.kind === "diff") {
    v.patch = parsePatch(text);
    v.how = { how: "diff" };
    v.note = partial ? `first ${fileSize(MAX_BYTES)} of ${fileSize(bytes)}` : null;
  } else {
    const sep = separator(text, lastPart(v.path));
    const { rows, cut } = parseTable(text, sep);

    if (rows.length > MAX_ROWS + 1) rows.length = MAX_ROWS + 1;

    const grid = table(rows);
    const shown = grid.body.length;

    v.grid = grid;
    held(v).sep = sep;
    v.how = { how: "table" };
    // wc counts line breaks; quoted ones inside cells make it a little high, so "about".
    v.note = shownNote({ shown, total: Math.max(shown, lines - 1), partial: partial || cut, wide: grid.wide, cols: grid.cols.length }) || null;
  }

  v.cursor = Math.min(v.cursor, Math.max(0, rowCount(v) - 1));
  v.error = null;
  v.busy = null;
  cx.notify();
}

/** Embedded: code, Markdown and other text, its first LOOK_BYTES (Markdown:
 *  LOOK_MD_BYTES); a binary or a file that can't be read says why. */
export async function loadLook(v: Viewer, cx: Context, gen: number): Promise<void> {
  const md = v.kind === "markdown";
  const cap = md ? LOOK_MD_BYTES : LOOK_BYTES;
  const r = await sh(LOOK_HEAD, [v.path, String(cap)], v.on);

  if (gen !== v.gen) return;

  if (r.code !== 0) {
    const e = r.code === 5 ? "Can't read it: no permission" : r.code === 6 ? "Not a regular file" : failed(r);

    if (e !== v.error) failWith(v, cx, e);

    return;
  }

  const nl1 = r.stdout.indexOf("\n");
  const nl2 = r.stdout.indexOf("\n", nl1 + 1);
  const bytes = Number(r.stdout.slice(0, nl1).trim());
  const nuls = Number(r.stdout.slice(nl1 + 1, nl2).trim());

  v.info = blank(bytes);

  if (nuls > 0) {
    v.text = null;
    failWith(v, cx, `A binary file (${fileSize(bytes)}): nothing to preview`);

    return;
  }

  const body = r.stdout.slice(nl2 + 1);
  const stamp = `${bytes}:${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;

  if (v.stamp === stamp && !v.error) return;

  v.stamp = stamp;

  const partial = bytes > cap;
  const text = wholeLines(body, partial);
  const lang = md ? null : languageOf(v.path);
  let spans: readonly (readonly [number, number, string])[] = [];

  if (lang) {
    try {
      spans = highlight(text, lang);
    } catch {
      spans = [];
    }
  }

  v.text = { body: text, starts: lineStarts(text), spans, lang, md, runs: new Map(), height: 0, wrap: null };
  v.note = partial ? `first ${fileSize(text.length)} of ${fileSize(bytes)}` : null;
  v.how = md ? { how: "markdown" } : { how: "text" };
  v.sy = Math.min(v.sy, maxScroll(v));
  v.error = null;
  v.busy = null;
  cx.notify();
}

/** Text: line `n` in its colors, worked out once. */
export function runsOf(x: TextLook, n: number, colors: ReadonlyMap<string, Color>): Run[] {
  const was = x.runs.get(n);

  if (was) return was;

  const runs = lineRuns(x.body, x.starts, x.spans, n, colors);

  x.runs.set(n, runs);

  return runs;
}

/** How far text or Markdown scrolls (element px). */
export function maxScroll(v: Viewer): number {
  const x = v.text;
  const room = unzoom(v.port.height);

  if (!x) return 0;

  const total = x.md ? x.height + 24 : v.wrapped(x).rows * LINE + 12;

  return Math.max(0, total - room);
}

/** Text: the line numbers' column, and the lines soft-wrapped to the view's
 *  width (a narrow panel shows whole lines, no sideways scrolling). */
export function wrappedRows(v: Viewer, x: TextLook): Wrapped & { readonly rows: number } {
  const gutter = Math.max(30, String(x.starts.length).length * CH + 16);
  const cols = Math.max(8, Math.floor(((unzoom(v.port.width) || 600) - gutter - 14) / CH));
  const wrap = x.wrap?.cols === cols ? x.wrap : { cols, gutter, at: wrapRows(x.body, x.starts, cols) };

  x.wrap = wrap;

  return { ...wrap, rows: wrap.at[wrap.at.length - 1] ?? 0 };
}

/** Embedded: J / K in the tree. Text, Markdown, tables and patches move
 *  half a view; a PDF a page; a picture larger than the view pans. */
export function scrollLook(v: Viewer, dir: number, cx: Context): void {
  const how = v.how;
  const half = Math.max(LINE, Math.round(unzoom(v.port.height) / 2));

  if (how?.how === "text" || how?.how === "markdown") v.sy = Math.max(0, Math.min(maxScroll(v), v.sy + dir * half));
  else if (how?.how === "table" || how?.how === "diff") {
    const rows = Math.max(1, Math.floor(v.visibleRows() / 2));

    scrollBy(v, 0, dir * rows * ROW);
    v.cursor = Math.max(0, Math.min(rowCount(v) - 1, Math.ceil(v.sy / ROW)));
  } else if (how?.how === "native" && v.kind === "pdf") pageGo(v, dir > 0 ? "next" : "prev", cx);
  else if (how?.how === "raster" && !how.firstOnly) pageGo(v, dir > 0 ? "next" : "prev", cx);
  else if (pictured(v) && pannable(v)) panPicture(v, 0, -dir * half * zoom(), cx);
}

/** Text: the lines in view, numbered, in the editor's colors. */
export function textView(v: Viewer, t: Theme, x: TextLook): Element[] {
  const colors = v.colors ?? syntaxColors(t);

  v.colors = colors;

  const room = unzoom(v.port.height) || 400;
  const { cols, gutter, at, rows: total } = v.wrapped(x);
  const first = Math.max(0, Math.floor(v.sy / LINE));
  const last = Math.min(total, first + Math.ceil(room / LINE) + 2);
  const rows: Element[] = [];

  for (let r = first; r < last; r++) {
    // A wrapped row: its line's number on the first one only.
    const [n, k] = rowLine(at, r);
    const runs = sliceRuns(runsOf(x, n, colors), k * cols, (k + 1) * cols);

    rows.push(h_flex().absolute().left(0).right(0).top(6 + r * LINE - v.sy).h(LINE).items_center()
      .child(div().w(gutter).flex_none().text_right().pr(10).text_color(t.dim).child(k ? "" : String(n + 1)))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().pr(8)
        .children(runs.map(([piece, color]) => div().flex_none().whitespace_nowrap().text_color(color ?? t.foreground).child(piece)))));
  }

  return [div().absolute().inset_0().font_family(code()).text_size(12).children(rows), ...textRail(v, t, total * LINE + 12)];
}

/** Markdown, rendered as the viewer renders it; its measured height bounds the scroll. */
export function mdView(v: Viewer, t: Theme, x: TextLook): Element[] {
  return [
    div().absolute().left(0).right(0).top(-v.sy).px(14).pt(10).pb(14).text_size(12.5).text_color(t.foreground)
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);

        if (Math.abs(h - x.height) > 1) {
          x.height = h;
          cx.notify();
        }
      })
      .child(TextView.markdown("look-md", x.body)),
    ...textRail(v, t, x.height + 24),
  ];
}

/** Where the view is in a long text: the dithered rail on the right. */
export function textRail(v: Viewer, t: Theme, total: number): Element[] {
  const room = unzoom(v.port.height);

  if (!(total > room + 1) || !room) return [];

  const h = Math.max(16, room * (room / total));
  const y = (v.sy / Math.max(1, total - room)) * (room - h);

  return [div().absolute().right(1).w(3).top(y).h(h).child(checker(t.ansi8, 1))];
}
