// The rendered view's drawn units (rendered-column.ts places them): each
// unit's body by its kind (a list item or task with its mark or box, a
// callout, pictures, a rule, reference definitions, front matter, Markdown)
// in a frame that measures it and shows its "+" on hover; an empty block's
// kinds; the "add a block" line under the last one; an empty note's words.

import type { Element } from "gpui-kit";
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { ItemParts, Unit } from "./live.ts";
import { itemParts, quoteBody } from "./live.ts";
import { markdown, CALLOUTS, imagesAsLinks, fenced } from "./markdown.ts";
import type { Rendered, Row, ViewOptions } from "./rendered.ts";
import { addAfter } from "./rendered-keys.ts";

export const GAP = 10;
export const ADD_H = 30; // the "add a block" line under the last unit
export const KINDS_H = 26; // an empty block's row of kinds
const PLUS = "mods/workspace-chrome/plus.svg";
const IMAGE_H = 560; // the tallest a picture is drawn (it keeps its shape, the column's width at most)

/** A kind an empty block offers: [Markdown command (mdedit.ts), word, its letter after cmd-.]. */
export type BlockKind = readonly [command: string, word: string, letter: string];

/** The kinds an empty block offers: [Markdown command (mdedit.ts), word, its letter after cmd-.]. */
export const KINDS: readonly BlockKind[] = [["heading-1", "heading", "1"], ["bullets", "list", "l"], ["task", "task", "t"], ["quote", "quote", "q"], ["fence", "code", "c"], ["rule", "rule", "r"], ["image", "image", "p"]];

/** A unit's Markdown drawn under a key. */
type Md = (key: string, text: string) => Element;

/** An empty block's kinds: a click runs one; cmd-. (vim: space .) and its letter do too. */
export function kindsView(v: Rendered, o: ViewOptions): Element {
  const { t } = o;
  const lead = v.host.vim?.() ? "space ." : "cmd-.";

  return h_flex()
    .id("rendered-kinds")
    .h(KINDS_H)
    .flex_none()
    .gap(4)
    .items_center()
    .text_size(11)
    .child(div().flex_none().pr(4).text_color(t.dim).child("make it"))
    .children(
      KINDS.map(([name, word, letter]) =>
        h_flex()
          .id(`rendered-kind-${name}`)
          .relative()
          .flex_none()
          .h(18)
          .px(6)
          .gap(5)
          .items_center()
          .border(1)
          .border_color(t.ansi0)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((s) => s.border_color(t.accent).text_color(t.foreground))
          .tooltip(`${lead} ${letter}`)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            v.host.mdRun?.(name, cx);
          })
          .child(div().relative().child(word))
          .child(div().relative().text_size(10).text_color(t.dim).child(letter)),
      ),
    )
    .child(div().flex_1())
    .child(div().flex_none().text_color(t.dim).child(`${lead} more`));
}

/** The line under the last block: "add a block" (an empty paragraph after it). */
export function addView(v: Rendered, o: ViewOptions, after: Unit | null): Element {
  const { t } = o;

  return h_flex()
    .id("rendered-add")
    .relative()
    .h(ADD_H)
    .mt(GAP)
    .ml(-22)
    .flex_none()
    .gap(8)
    .items_center()
    .cursor_pointer()
    .text_color(t.dim)
    .hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      addAfter(v, after, cx);
    })
    .child(div().relative().size(14).flex_none().border(1).border_color(t.ansi8).flex().items_center().justify_center().child(svg(PLUS).size(10).text_color(t.accent)))
    .child(div().flex_none().text_size(11.5).child("add a block"))
    .child(div().relative().flex_1().h(1).opacity(0.5).child(v.host.dither(t.ansi8)))
    .child(div().flex_none().text_size(10.5).child("or enter at a block's end"));
}

export function emptyView(v: Rendered, t: Theme, empty: NonNullable<ViewOptions["empty"]>): Element {
  return v_flex()
    .id("rendered-empty")
    .items_center()
    .gap(8)
    .pt(30)
    .pb(22)
    .text_center()
    .child(div().relative().size(44).opacity(0.55).child(v.host.moon?.(t) ?? div()))
    .child(div().text_color(t.foreground).text_size(12).child(empty.title))
    .child(div().text_color(t.muted).child(empty.detail))
    .child(div().text_color(t.dim).child(empty.hint ?? ""));
}

/** An image block: each picture fits the column and keeps its shape (drawn from its cached
 *  copy: decoded once, not per key); one on the web is drawn by the Markdown view; one that
 *  can't be found says so. */
function imagesView(v: Rendered, u: Extract<Unit, { kind: "image" }>, id: string, o: ViewOptions, md: (key: string, text: string) => Element): Element {
  const { t } = o;

  return v_flex()
    .gap(8)
    .children(
      u.images.map((im, j) => {
        const got = v.host.image?.(im.src) ?? { abs: null, name: null };

        if (got.name) {
          return div().id(`${id}-img-${j}`).flex().child(image(got.name).id(`${id}-pic-${j}`).max_w_full().max_h(IMAGE_H));
        }

        if (!got.abs) return md(`${id}-web-${j}`, `![${im.alt}](${im.src})`);

        const missing = got.name === null;
        const color = missing ? t.ansi1 : t.dim;

        return h_flex()
          .id(`${id}-img-${j}`)
          .relative()
          .h(56)
          .px(14)
          .gap(10)
          .items_center()
          .child(div().absolute().inset_0().opacity(0.12).child(v.host.dither(color)))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
          .child(div().relative().size(10).flex_none().border(1).border_color(color))
          .child(
            v_flex()
              .relative()
              .min_w(0)
              .child(div().text_color(missing ? t.ansi1 : t.muted).child(missing ? "picture not found" : "loading the picture…"))
              .child(div().truncate().text_size(11).text_color(t.dim).child(im.src)),
          );
      }),
    );
}

/** A drawn unit: its body, measured as drawn (its height kept by its key), the "+" beside it
 *  while the pointer is over it; a click lights it up. */
export function unitView(v: Rendered, r: Row, o: ViewOptions): Element {
  const { t } = o;
  const u = r.u;
  const id = `rd-${r.key}`;
  const size = 13;
  const md = (key: string, text: string): Element => markdown(t, key, text, { onLink: (url, cx) => v.host.link(url, cx), size });

  const body = unitBody(v, u, id, o, md);

  const hovered = v.hover === r.key;

  return div()
    .id(id)
    .relative()
    .flex_none()
    .on_size_change((box, cx) => {
      const h = o.unzoom(box.height);
      const was = v.heights.get(r.key);

      if (was === undefined || Math.abs(was - h) > 1) {
        v.heights.set(r.key, h);
        v.host.notify(cx);
      }
    })
    .on_hover((on, cx) => {
      const next = on ? r.key : v.hover === r.key ? null : v.hover;

      if (next !== v.hover) {
        v.hover = next;
        v.host.notify(cx);
      }
    })
    .cursor_text()
    .on_click((_e, cx) => v.clickUnit(u, cx, false))
    .child(body)
    // Its "+": an empty paragraph after it (shown while the pointer is over it).
    .when(hovered, (el) =>
      el.child(
        div()
          .id(`${id}-add`)
          .absolute()
          .left(-24)
          .top(1)
          .size(16)
          .flex()
          .items_center()
          .justify_center()
          .border(1)
          .border_color(t.ansi8)
          .bg(t.background)
          .cursor_pointer()
          .hover((s) => s.border_color(t.accent))
          .tooltip("add a block after this one")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            v.hover = null;
            addAfter(v, u, cx);
          })
          .child(svg(PLUS).size(10).text_color(t.accent)),
      ),
    );
}

/** A drawn unit's body by its kind: a list item or task (its mark, its box), a callout, pictures,
 *  a rule, reference definitions, front matter, else its Markdown. */
function unitBody(v: Rendered, u: Unit, id: string, o: ViewOptions, md: Md): Element {
  const src = v.src(u);
  const local = { from: 0, to: u.to - u.from };
  const { t } = o;

  if (u.kind === "item") return itemBody(v, u, itemParts(src, local), id, o, md);

  if (u.kind === "quote" && u.callout) return calloutBody(v, u.callout, quoteBody(src, local), id, o, md);

  if (u.kind === "image") return imagesView(v, u, id, o, md);

  if (u.kind === "rule") return div().relative().h(13).flex().items_center().child(div().relative().w_full().h(1).opacity(0.6).child(v.host.dither(t.ansi8)));

  if (u.kind === "ref") return div().text_color(t.dim).font_family(v.host.font).text_size(11.5).child(src);

  if (u.kind === "front") {
    return md(
      `${id}-md`,
      fenced(src.split("\n").slice(1, -1).join("\n")).replace(/^`+/, (m) => m + "yaml"),
    );
  }

  return md(`${id}-md`, u.kind === "fence" ? src : withRefs(v, imagesAsLinks(src)));
}

/** A list item: its bullet or number, or a task's box (a click ticks it); its body's Markdown. */
function itemBody(v: Rendered, u: Extract<Unit, { kind: "item" }>, p: ItemParts, id: string, o: ViewOptions, md: Md): Element {
  const { t } = o;

  const mark = u.task
    ? div()
        .id(`${id}-box`)
        .relative()
        .size(12)
        .mt(4)
        .flex_none()
        .border(1)
        .border_color(u.checked ? t.accent : t.ansi8)
        .cursor_pointer()
        .hover((s) => s.border_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          o.onTask(u.from, cx);
        })
        .when(u.checked, (el) => el.child(div().absolute().top(2).left(2).right(2).bottom(2).child(v.host.dither(t.accent))))
    : div()
        .w(18)
        .flex_none()
        .text_color(t.dim)
        .child(/^\d/.test(p.marker) ? p.marker : "•");

  return h_flex()
    .gap(8)
    .items_start()
    .pl(u.indent * 7)
    .child(mark)
    .child(
      div()
        .flex_1()
        .min_w(0)
        .when(u.checked, (el) => el.opacity(0.6))
        .child(md(`${id}-md`, withRefs(v, imagesAsLinks(p.body)) || " ")),
    );
}

/** A callout (> [!note]): its kind's colour on a dithered ground, its title, its body. */
function calloutBody(v: Rendered, callout: string, quoted: string, id: string, o: ViewOptions, md: Md): Element {
  const { t } = o;
  const size = 13;
  const lines = quoted.split("\n");
  const head = /^\[![A-Za-z-]+\][+-]?\s*(.*)$/.exec(lines[0] ?? "");
  const [ck, name] = CALLOUTS.get(callout) ?? ["ansi4", callout];
  const color = t[ck];
  const rest = lines.slice(1).join("\n");

  return v_flex()
    .relative()
    .pl(14)
    .pr(12)
    .py(8)
    .gap(4)
    .child(div().absolute().inset_0().opacity(0.14).child(v.host.dither(color)))
    .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
    .child(
      h_flex()
        .relative()
        .gap(8)
        .items_center()
        .child(div().relative().size(8).flex_none().border(1).border_color(color).child(v.host.dither(color)))
        .child(
          div()
            .text_size(size - 1)
            .text_color(color)
            .child(head?.[1] || name),
        ),
    )
    .when(Boolean(rest.trim()), (el) => el.child(div().relative().child(md(`${id}-md`, withRefs(v, rest)))));
}

/** A unit's text with the reference definitions under it (so [text][ref] resolves). */
function withRefs(v: Rendered, text: string): string {
  const rf = v.refsOf();

  return rf ? `${text}\n\n${rf}` : text;
}
