// cmd+click (ctrl+click off macOS) in the editor and in the rendered view's block.
// The editor's own press has put the caret under the pointer already (gpui-base
// places it, then the press goes on to the pane around it): a link there (a
// Markdown link's address, a web address, a path) opens as the hover card's links
// do, else the code editor goes to the definition at the caret, as cmd-k d / gd do.

import type EditorPane from "./main.ts";
import { followLink } from "./card.ts";
import { definition } from "./lsp-client.ts";
import { links } from "./md-inline.ts";
import type { Context, MouseButtonEvent } from "gpui-kit";
import { window } from "herdr";

/** Whether a press is the go-to click: cmd on macOS, ctrl elsewhere, nothing else held. */
export function isGoClick(e: MouseButtonEvent): boolean {
  const m = e.modifiers;
  const main = window().platform === "macos" ? m.platform && !m.control : m.control && !m.platform;

  return main && !m.alt && !m.shift && e.click_count === 1;
}

/** The link column `col` of `line` is on: a Markdown link's address, a web (or mailto:)
 *  address, or a path (`/…`, `~/…`, `./…`, `../…`, or with a `/` and a file's extension,
 *  maybe `:line:col` after it); null on anything else (a word, a symbol). */
export function linkAt(line: string, col: number): string | null {
  for (const l of links(line)) if (col >= l.from && col <= l.to) return line.slice(l.url[0], l.url[1]);

  const word = /[^\s"'`<>()[\]{},;]+/g;

  for (let m = word.exec(line); m; m = word.exec(line)) {
    if (col < m.index || col > m.index + m[0].length) continue;

    const w = m[0].replace(/[.:]+$/, "");

    if (/^[a-z][a-z0-9+.-]*:\/\/\S/i.test(w) || /^mailto:\S/i.test(w)) return w;

    if (/^(~\/|\.{1,2}\/|\/\w)/.test(w) || /\/[^/]*\.\w+(:\d+(:\d+)?)?$/.test(w)) return w;

    return null;
  }

  return null;
}

/** The code editor pressed: on the go-to click, the link at the caret opens, else
 *  go to definition there. */
export function editorPress(ed: EditorPane, e: MouseButtonEvent, cx: Context): void {
  if (!isGoClick(e)) return;

  const at = ed.editor.cursor();
  const url = linkAt(ed.editor.value().split("\n")[at.line] ?? "", at.col);

  cx.stop_propagation();

  if (url) followLink(ed, url, cx);
  else void definition(ed, cx);
}
