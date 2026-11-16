// Markdown in Nocturne's look: the GitHub window's PR bodies and comments,
// the Markdown viewer, and the editor's live preview. github, markdown and
// editor import it (`@fireflies/markdown`), with its parser,
// markdown-parse.ts.
//
// What the app draws natively inside every Markdown text (src/markdown.rs):
// math ($…$, $$…$$, a ```math fence), mermaid diagrams (a ```mermaid fence),
// code fences in tree-sitter colors. What this file adds around it: a document
// cut into blocks that know their source lines (so a preview can follow an
// editor), task lists you can tick, callouts (> [!NOTE], !!! note),
// footnotes, local images, front matter.

import { Array as Arr, Effect, Option, pipe, String as Str } from "effect";
import { div, image } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { appHome } from "herdr";
import type { Theme } from "herdr";
import { execOk, replaceWith } from "@fireflies/kit";
import type { Exec, ExecError, ExitError } from "@fireflies/kit";
import { ExecLive } from "@fireflies/kit/live";
import { blocks, TASK } from "./markdown-parse.ts";

/** The theme colours a callout is drawn in. */
export type CalloutColor = "ansi1" | "ansi2" | "ansi3" | "ansi4" | "ansi5" | "ansi6" | "muted" | "ansi13";

/** A picture on a line of its own: its alt text and its source. */
export interface ImageRef {
  readonly alt: string;
  readonly src: string;
}

/** An item of a list holding tasks: its first line, its indent, its marker,
 *  whether it's ticked (null: not a task), its text (continuations joined). */
export interface TaskItem {
  readonly line: number;
  readonly indent: number;
  readonly marker: string;
  readonly checked: boolean | null;
  readonly text: string;
}

/** A footnote: its id, its number, its anchor (`fn-…`), its text, its lines. */
export interface Footnote {
  readonly id: string;
  readonly n: number;
  readonly anchor: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/** What every block has: its source lines (0-based, inclusive) and the
 *  footnotes referenced in it (`fnref-…`, for the way back). */
export interface Lines {
  readonly from: number;
  readonly to: number;
  readonly anchors?: readonly string[];
}

/** A block before its key. */
export type Unkeyed =
  /** Markdown (every heading starts one; `anchor`: its heading's). */
  | (Lines & { readonly kind: "md"; readonly text: string; readonly anchor?: string })
  /** A line of local images (TextView fetches only web ones). */
  | (Lines & { readonly kind: "images"; readonly images: readonly ImageRef[] })
  /** A list holding task items, tickable. */
  | (Lines & { readonly kind: "tasks"; readonly items: readonly TaskItem[] })
  /** > [!NOTE] and !!! note. */
  | (Lines & { readonly kind: "callout"; readonly type: string; readonly title: string; readonly color: CalloutColor; readonly folded: boolean; readonly text: string })
  /** The footnotes, gathered at the end. */
  | (Lines & { readonly kind: "footnotes"; readonly notes: readonly Footnote[] });

/** A block drawn on its own, with a stable `key` (its kind and text). */
export type Block = Unkeyed & { readonly key: string };

/** What MarkdownDoc.render draws with: link and task clicks, local images
 *  (`image(src)`: its absolute path and its name in the cache, undefined while
 *  copying, null when it can't be), the dither, focus, the text size and width,
 *  the zoom, a redraw, and the block the keyboard's link is in (`chosen`). */
export interface DocOptions {
  readonly onLink?: ((url: string, cx: Context) => void) | undefined;
  readonly onTask?: ((line: number, cx: Context) => void) | undefined;
  readonly onScroll?: ((cx: Context) => void) | undefined;
  readonly image?: ((src: string) => { readonly abs: string | null; readonly name: string | null | undefined }) | undefined;
  readonly onImage?: ((abs: string | null) => void) | undefined;
  readonly dither: (color: Color) => Element;
  readonly focused?: boolean | undefined;
  readonly size?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly unzoom: (px: number) => number;
  readonly notify: (cx: Context) => void;
  readonly chosen?: string | null | undefined;
}

/** Rendered Markdown's options: who takes link clicks, the text size. */
export interface MarkdownOptions {
  readonly onLink?: ((url: string, cx: Context) => void) | undefined;
  readonly size?: number;
}

/** Rendered Markdown in the theme's text, selectable. `onLink(url, cx)`
 *  takes link clicks (without it, web links open as the app opens them). */
export function markdown(t: Theme, id: string, text: string, options: MarkdownOptions = {}): Element {
  const { onLink, size = 12.5 } = options;
  const view = TextView.markdown(id, text).selectable(true);

  return div().text_size(size).text_color(t.foreground).child(onLink === undefined ? view : view.on_link_click(onLink));
}

/** The text as one code block, for a raw view: a fence longer than any inside it. */
export function fenced(text: string): string {
  const longest = Math.max(2, ...Arr.map(Arr.fromIterable(Str.matchAll(/`{3,}/g)(text)), (m) => m[0].length));
  const fence = Str.repeat(longest + 1)("`");

  return `${fence}\n${text}\n${fence}`;
}

/** A heading's anchor, as GitHub makes it: lowercase, links and marks gone,
 *  punctuation dropped (letters, digits, `-` and `_` stay), spaces to `-`. */
export function slug(heading: string): string {
  return pipe(
    heading,
    Str.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"),
    Str.replace(/<[^>]+>/g, ""),
    Str.toLowerCase,
    Str.trim,
    Str.replace(/[^\p{L}\p{N}\p{M} _-]/gu, ""),
    Str.replace(/ /g, "-"),
  );
}

/** Callout colors and names by type (a document names the type): GitHub's five
 *  and Obsidian's / MkDocs' others. */
export const CALLOUTS: ReadonlyMap<string, readonly [color: CalloutColor, name: string]> = new Map<string, readonly [CalloutColor, string]>([
  ["note", ["ansi4", "Note"]], ["info", ["ansi4", "Info"]], ["todo", ["ansi4", "Todo"]],
  ["tip", ["ansi2", "Tip"]], ["hint", ["ansi2", "Hint"]], ["success", ["ansi2", "Success"]], ["check", ["ansi2", "Check"]], ["done", ["ansi2", "Done"]],
  ["important", ["ansi5", "Important"]], ["example", ["ansi13", "Example"]],
  ["warning", ["ansi3", "Warning"]], ["attention", ["ansi3", "Attention"]],
  ["caution", ["ansi1", "Caution"]], ["danger", ["ansi1", "Danger"]], ["error", ["ansi1", "Error"]], ["bug", ["ansi1", "Bug"]], ["failure", ["ansi1", "Failure"]], ["fail", ["ansi1", "Fail"]],
  ["question", ["ansi6", "Question"]], ["help", ["ansi6", "Help"]], ["faq", ["ansi6", "FAQ"]],
  ["abstract", ["ansi6", "Abstract"]], ["summary", ["ansi6", "Summary"]], ["tldr", ["ansi6", "TL;DR"]],
  ["quote", ["muted", "Quote"]], ["cite", ["muted", "Cite"]],
]);

/** Local images inside running text (TextView can't draw them) as links to the file. */
export const imagesAsLinks: (line: string) => string = replaceWith(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+["'(][^)]*["')])?\s*\)/g, (m) => {
  const alt = m[1] ?? "";
  const src = m[2] ?? "";

  if (!isLocalSource(src)) return m[0];

  const name = Arr.lastNonEmpty(Str.split(src, "/"));

  return `[▧ ${Str.isNonEmpty(alt) ? alt : Str.isNonEmpty(name) ? name : src}](${src})`;
});

/** Whether an image source is a file next to the document (not http, data: or another scheme). */
export function isLocalSource(src: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !Str.startsWith("//")(src);
}

/** The edit that ticks or unticks the task on `line` of `text`: the one
 *  character inside its brackets (1-based column), or null. */
export function taskToggle(text: string, line: number): { readonly line: number; readonly col: number; readonly text: string } | null {
  const l = Str.split(Str.replace(/\r\n?/g, "\n")(text), "\n")[line];

  if (l === undefined || Str.isEmpty(l)) return null;

  const m = TASK.exec(l);

  if (m === null) return null;

  const from = (m[1] ?? "").length + (m[2] ?? "").length;
  const col = Option.match(Str.indexOf("[")(Str.slice(from)(l)), { onNone: () => 0, onSome: (at) => from + at + 1 });

  return { line, col, text: m[3] === " " ? "x" : " " };
}

// Exit 3: the picture isn't there; 4: it couldn't be copied.
const IMAGE_COPY = 'mkdir -p "$2" && [ -f "$1" ] || exit 3; s=$(cksum < "$1" | cut -d" " -f1); n="$s.${1##*.}"; [ -f "$2/$n" ] || cp "$1" "$2/$n" || exit 4; printf %s "$n"';

/** Copies a local image into the app's cache, named by its contents (image()
 *  reads only under the app's folder): its name under `cache/<dir>`. */
export const imageCopy = (path: string, dir: string): Effect.Effect<string, ExecError | ExitError, Exec> =>
  Effect.map(execOk("sh", ["-c", IMAGE_COPY, "md-image", path, `${appHome()}/cache/${dir}`]), Str.trim);

/**
 * `imageCopy` for a caller not on Effect yet (the editor's preview, the
 * Markdown viewer): the name, or null when the picture can't be copied. A
 * picture that can't be drawn shows as a link to its file, which is how its
 * failure is seen.
 */
export const cacheImage = (path: string, dir: string): Promise<string | null> =>
  Effect.runPromise(imageCopy(path, dir).pipe(
    Effect.map((name) => (Str.isEmpty(name) ? null : name)),
    Effect.orElseSucceed(() => null),
    Effect.provide(ExecLive),
  ));

/** Each block's top, and the document's height. */
export interface Tops {
  readonly tops: readonly number[];
  readonly total: number;
}

const GAP = 12;
const PAD_TOP = 20;
const PAD_BOTTOM = 44;

// Blocks this far above and below the view are drawn too (and measured).
const OVERDRAW = 1.5;

/** A rendered document that scrolls: its blocks, their measured heights,
 *  where a source line is drawn and which line is at a height. Shared by the
 *  viewer and the editor's preview; each owns one. */
export class MarkdownDoc {
  readonly prefix: string;
  parts: Block[] = [];
  /** Each block's measured height, by key. */
  heights = new Map<string, number>();
  scrollY = 0;
  viewH = 400;
  width = 600;
  /** An anchor to scroll to once measured. */
  want: string | null = null;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  setText(text: string | null | undefined): void {
    this.parts = text === null || text === undefined ? [] : blocks(text);

    const keys = new Set(Arr.map(this.parts, (p) => p.key));

    for (const k of this.heights.keys()) if (!keys.has(k)) this.heights.delete(k);
  }

  /** A block's height: measured, else a guess from its lines. */
  height(p: Block): number {
    const h = this.heights.get(p.key);

    if (h !== undefined) return h;

    if (p.kind === "images") return 200;

    const lines = p.kind === "md" ? Str.split(p.text, "\n").length : p.to - p.from + 1;

    return 22 * lines + 8;
  }

  /** Each block's top (from the document's top, padding included) and the total height. */
  tops(): Tops {
    const tops: number[] = [];
    let y = PAD_TOP;

    for (const p of this.parts) {
      tops.push(y);
      y += this.height(p) + GAP;
    }

    return { tops, total: y - GAP + PAD_BOTTOM };
  }

  contentH(): number {
    return this.tops().total;
  }

  scroll(dy: number): void {
    const max = Math.max(0, this.contentH() - this.viewH);

    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  setScroll(y: number): void {
    this.scrollY = 0;
    this.scroll(y);
  }

  /** The block holding `anchor` (a heading or a footnote) at the top. */
  scrollTo(anchor: string): boolean {
    const found = Arr.findFirstIndex(this.parts, (p) => (p.kind === "md" && p.anchor === anchor) || p.anchors?.includes(anchor) === true || (p.kind === "footnotes" && Arr.some(p.notes, (n) => n.anchor === anchor)));

    if (Option.isNone(found)) {
      this.want = null;

      return false;
    }

    const i = found.value;

    this.want = Arr.some(Arr.take(this.parts, i), (p) => !this.heights.has(p.key)) ? anchor : null;
    this.setScroll((this.tops().tops[i] ?? 0) - 8);

    return true;
  }

  /** Where source line `line` (fractional) is drawn, from the document's top. */
  yOfLine(line: number): number {
    const { tops } = this.tops();
    let best: { readonly top: number; readonly part: Block } | null = null;

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const top = tops[i] ?? 0;

      if (p === undefined || p.kind === "footnotes") continue;

      if (p.from <= line) best = { top, part: p };

      if (p.from <= line && line <= p.to + 1) {
        const span = p.to - p.from + 1;

        return top + this.height(p) * Math.min(1, (line - p.from) / span);
      }
    }

    if (best === null) return 0;

    // Between blocks (blank lines): the gap after the one before.
    return best.top + this.height(best.part) + GAP / 2;
  }

  /** The source line (fractional) drawn at height `y` from the document's top. */
  lineAtY(y: number): number {
    const { tops } = this.tops();
    let prev: { readonly to: number; readonly bottom: number } | null = null;

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const top = tops[i] ?? 0;

      if (p === undefined || p.kind === "footnotes") continue;

      const h = this.height(p);

      if (y < top) {
        // In the gap above it: between the last block's end and this one's start.
        if (prev === null) return p.from;

        const t = (y - prev.bottom) / Math.max(1, top - prev.bottom);

        return prev.to + 1 + Math.max(0, Math.min(1, t)) * Math.max(0, p.from - prev.to - 1);
      }

      if (y <= top + h) return p.from + ((y - top) / Math.max(1, h)) * (p.to - p.from + 1);

      prev = { to: p.to, bottom: top + h };
    }

    return prev === null ? 0 : prev.to + 1;
  }

  /** A block was measured: keep what's on screen in place when a block
   *  above it changes height. Whether anything changed. */
  measured(key: string, h: number): boolean {
    const old = this.heights.get(key);

    if (old !== undefined && Math.abs(old - h) <= 1) return false;

    const i = Arr.findFirstIndex(this.parts, (p) => p.key === key);

    if (Option.isSome(i)) {
      const at = i.value;
      const part = this.parts[at];
      const was = old ?? (part === undefined ? h : this.height(part));

      if ((this.tops().tops[at] ?? 0) + was < this.scrollY && this.want === null) this.scrollY += h - was;
    }

    this.heights.set(key, h);

    if (this.want !== null) this.scrollTo(this.want);

    this.scroll(0);

    return true;
  }

  /** The scrolling document (see DocOptions). */
  render(t: Theme, o: DocOptions): Element {
    const { tops, total } = this.tops();
    const lo = this.scrollY - this.viewH * OVERDRAW;
    const hi = this.scrollY + this.viewH * (1 + OVERDRAW);

    const shown = Arr.flatMap(this.parts, (p, i) => {
      const top = tops[i] ?? 0;

      return top + this.height(p) >= lo && top <= hi ? [{ p, top }] : [];
    });

    const first = shown[0]?.top ?? 0;
    const max = Math.max(1, total - this.viewH);
    const frac = Math.min(1, this.viewH / Math.max(1, total));

    const view = div().id(`${this.prefix}-view`).relative().flex_1().min_h(0).min_w(0).overflow_hidden()
      .on_size_change((size, cx) => {
        const h = o.unzoom(size.height);
        const w = o.unzoom(size.width);

        if (Math.abs(h - this.viewH) > 1 || Math.abs(w - this.width) > 1) {
          this.viewH = h;
          this.width = w;
          this.scroll(0);
          o.notify(cx);
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.scroll(-o.unzoom(e.delta.y));
        o.onScroll?.(cx);
        o.notify(cx);
      })
      .child(h_flex().absolute().left(0).right(0).top(first - this.scrollY).justify_center()
        .child(v_flex().w_full().max_w(o.maxWidth ?? 780).px(24).gap(GAP).children(Arr.map(shown, ({ p }) => {
          const block = div().id(`${this.prefix}-${p.key}`).relative().on_size_change((size, cx) => {
            if (this.measured(p.key, o.unzoom(size.height))) o.notify(cx);
          });

          return (p.key === o.chosen ? block.child(div().absolute().left(-12).top(0).bottom(0).w(2).bg(t.accent)) : block).child(this.part(t, p, o));
        }))));

    if (frac >= 1) return view;

    return view.child(div().absolute().right(1).w(3)
      .top(Math.round((this.scrollY / max) * this.viewH * (1 - frac))).h(Math.max(16, Math.round(this.viewH * frac)))
      .child(o.dither(o.focused === true ? t.accent : t.muted)));
  }

  part(t: Theme, p: Block, o: DocOptions): Element {
    const id = `${this.prefix}-${p.key}`;
    const size = o.size ?? 13;
    const md = (key: string, text: string): Element => markdown(t, key, text, { onLink: o.onLink, size });

    switch (p.kind) {
      case "md": return md(`${id}-md`, p.text);
      case "images": return this.images(t, p.images, id, o);
      case "tasks": return this.tasks(t, p.items, id, o, md);

      case "callout": {
        const color = t[p.color];

        const box = v_flex().relative().pl(14).pr(12).py(8).gap(4)
          .child(div().absolute().inset_0().opacity(0.14).child(o.dither(color)))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
          .child(h_flex().relative().gap(8).items_center()
            .child(div().relative().size(8).flex_none().border(1).border_color(color).child(o.dither(color)))
            .child(div().text_size(size - 1).text_color(color).child(p.title)));

        return Str.isEmpty(Str.trim(p.text)) ? box : box.child(div().relative().child(md(`${id}-md`, p.text)));
      }

      case "footnotes":
        return v_flex().gap(6).pt(4)
          .child(h_flex().gap(10).items_center().text_size(10.5).text_color(t.dim)
            .child(div().child("FOOTNOTES"))
            .child(div().relative().flex_1().h(1).opacity(0.6).child(o.dither(t.muted))))
          .children(Arr.map(p.notes, (n) => h_flex().id(`${id}-${n.anchor}`).gap(8).items_start()
            .child(div().w(22).flex_none().text_size(size - 1).text_color(t.accent).child(`${n.n}.`))
            .child(div().flex_1().min_w(0).child(md(`${id}-${n.anchor}-md`, n.text)))
            .child(div().id(`${id}-${n.anchor}-back`).flex_none().text_color(t.dim).hover((s) => s.text_color(t.accent)).cursor_pointer()
              .on_click((_e, cx) => {
                cx.stop_propagation();
                o.onLink?.(`#fnref-${Str.slice(3)(n.anchor)}`, cx);
              })
              .child("↩"))));
    }
  }

  tasks(t: Theme, items: readonly TaskItem[], id: string, o: DocOptions, md: (key: string, text: string) => Element): Element {
    const base = Math.min(...Arr.map(items, (it) => it.indent));

    return v_flex().gap(3).children(Arr.map(items, (it, j) => {
      const box = it.checked === null
        ? div().w(14).flex_none().text_color(t.dim).child(/^\d/.test(it.marker) ? it.marker : "•")
        : this.tickBox(t, it, `${id}-box-${j}`, o);

      const words = div().flex_1().min_w(0);

      return h_flex().id(`${id}-item-${j}`).gap(8).items_start().pl(Math.max(0, it.indent - base) * 7)
        .child(box)
        .child((it.checked === true ? words.opacity(0.6) : words).child(md(`${id}-item-${j}-md`, Str.isEmpty(it.text) ? " " : it.text)));
    }));
  }

  /** A task's box: a click ticks or unticks it. */
  tickBox(t: Theme, it: TaskItem, id: string, o: DocOptions): Element {
    const box = div().id(id).relative().size(12).mt(3).flex_none().border(1).border_color(it.checked === true ? t.accent : t.muted)
      .cursor_pointer().hover((s) => s.border_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        o.onTask?.(it.line, cx);
      });

    return it.checked === true ? box.child(div().absolute().top(2).left(2).right(2).bottom(2).child(o.dither(t.accent))) : box;
  }

  images(t: Theme, images: readonly ImageRef[], id: string, o: DocOptions): Element {
    return v_flex().gap(6).children(Arr.map(images, (img, j) => {
      const got = o.image?.(img.src) ?? { abs: null, name: null };

      if (got.name !== null && got.name !== undefined && Str.isNonEmpty(got.name)) {
        return div().id(`${id}-imgbox-${j}`).flex().cursor_pointer()
          .on_click((_e, cx) => {
            cx.stop_propagation();
            o.onImage?.(got.abs);
          })
          .child(image(got.name).id(`${id}-img-${j}`).max_w_full().max_h(360));
      }

      const label = got.name === undefined && got.abs !== null && Str.isNonEmpty(got.abs) ? "loading…" : Str.isEmpty(img.alt) ? img.src : img.alt;

      return markdown(t, `${id}-imgalt-${j}`, `[▧ ${Str.replace(/[[\]]/g, "")(label)}](${img.src})`, { onLink: o.onLink }).text_color(t.muted);
    }));
  }
}
