// The editor pane's hover card drawn (card.ts holds its state): its parts,
// code blocks, links, where it sits by the word.

import type EditorPane from "./main.ts";
import { linkTarget, linkWhere } from "./cardlinks.ts";
import type { CardPlace, ColorRun } from "./logic.ts";
import type { Problem } from "./lsp-replies.ts";
import { basename, cardMarkdown, cardPlace, colorRuns, syntaxColors } from "./logic.ts";
import { h_flex, TextView, v_flex } from "gpui-base";
import type { Context, Element } from "gpui-kit";
import { div } from "gpui-kit";
import type { Theme } from "herdr";
import { highlight, languageOf } from "herdr";
import type { Card, CardPart } from "./pane-kit.ts";
import { BAR, codeAndSource, dither, FIND, GUTTER_INSET, HINTS, serverId, serverName, severityColors, stop, zoom } from "./pane-kit.ts";
import { cardOverflows, cardShown, followLink, hoverLevel, waitWords } from "./card.ts";
import { logStep } from "./lsp-client.ts";
import { stripH } from "./pane-bar.ts";

export const CARD_W = 520;

/** Highlighted code, line by line, in the card: colored once per answer
 *  (kept on the part), not at every frame. */
export function codeBlock(ed: EditorPane, t: Theme, part: Extract<CardPart, { code: string }>, lang: string, code: string): Element {
  let lines = part.lines;

  if (!lines) {
    const text = part.code;
    const spans = lang ? highlight(text, lang) : [];
    const colors = ed.colors ?? syntaxColors(t);
    const made: ColorRun[][] = [];
    let at = 0;

    for (const line of text.split("\n")) {
      const end = at + line.length;
      const start = at;
      const mine = spans.flatMap(([s, e, n]): [number, number, string][] => (e > start && s < end ? [[Math.max(s, start) - start, Math.min(e, end) - start, n]] : []));

      made.push(colorRuns(line, mine, colors));
      at = end + 1;
    }

    lines = made;
    part.lines = made;
  }

  return v_flex()
    .px(12)
    .py(8)
    .font_family(code)
    .text_size(12)
    .children(
      lines.slice(0, 200).map((runs, i) =>
        h_flex()
          .id(`card-code-${i}`)
          .flex_wrap()
          .children(
            runs.map(([piece, color], j) =>
              div()
                .id(`card-run-${i}-${j}`)
                .text_color(color ?? t.foreground)
                .child(piece),
            ),
          ),
      ),
    );
}

/** The card's links under its text: an arrow for where it goes (↗ the web,
 *  → a file), its words, and the host or file:line; the ringed one (tab)
 *  wears the dialogs' ring, enter follows it; a click follows any. */
export function cardLinksView(ed: EditorPane, t: Theme, c: Card): Element {
  const list = c.links.slice(0, 12);

  return v_flex()
    .id("card-links")
    .relative()
    .px(8)
    .pt(6)
    .pb(8)
    .gap(1)
    .child(
      h_flex()
        .relative()
        .h(16)
        .px(4)
        .gap(8)
        .items_center()
        .text_size(10)
        .text_color(t.dim)
        .child(div().flex_none().child("LINKS"))
        .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .when(c.links.length > list.length, (el) => el.child(div().flex_none().child(`${list.length} of ${c.links.length}`))),
    )
    .children(
      list.map((l, i) => {
        const to = linkTarget(l.url, ed.path);
        const on = c.link === i;
        const color = to?.kind === "web" ? t.ansi4 : to?.kind === "file" ? t.ansi5 : t.dim;

        return h_flex()
          .id(`card-link-${i}`)
          .relative()
          .h(20)
          .px(4)
          .gap(8)
          .items_center()
          .border(1)
          .border_color(on ? t.accent : t.background)
          .text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.ansi0))
          .hover((s) => s.text_color(t.foreground).border_color(t.ansi0))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => followLink(ed, l.url, cx))
          .child(
            div()
              .flex_none()
              .w(12)
              .text_color(color)
              .child(to?.kind === "web" ? "↗" : to?.kind === "file" ? "→" : "·"),
          )
          .child(div().flex_1().min_w(0).truncate().child(l.label))
          .child(div().flex_none().max_w(200).truncate().text_color(t.dim).child(linkWhere(to)));
      }),
    );
}

/** How far down the pane the text starts: the bar, and whatever lines sit
 *  between it and the text (a conflict, find / replace, vim's ex line). */
export function textTop(ed: EditorPane): number {
  return stripH(ed) + BAR + (ed.asking ? FIND : 0) + (ed.conflict ? FIND : 0) + (ed.mode === "replace" ? 2 * FIND : ed.mode ? FIND : 0) + (ed.vim.ex !== null ? FIND : 0);
}

/** The card's word in pane coordinates (unzoomed), from where the editor
 *  last drew it; null when it's off screen. */
export function cardAnchor(ed: EditorPane, c: Card): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
  const b = ed.editor.bounds({ line: c.line, col: c.col });

  if (!b?.view) return null;

  const z = zoom();
  const x = (b.x - b.view.x) / z;
  const y = (b.y - b.view.y) / z;
  const h = b.height / z;

  // Scrolled out of the text's own box: it waits there until the word is back.
  if (y + h < 0 || y > b.view.height / z) return null;

  return { x: x + GUTTER_INSET, y: y + textTop(ed), w: b.width / z, h };
}

/** The card, at its word: under it, or above it near the pane's foot;
 *  null while there's nothing to show (a pointer's card still waiting) or
 *  its word is off screen. */
export function cardView(ed: EditorPane, t: Theme, code: string): Element | null {
  const c = ed.card;

  if (!c) return null;

  if (!cardShown(ed, c)) return null;

  const anchor = cardAnchor(ed, c);

  if (!anchor) return null;

  if (c.keyboard && !c.drawn) {
    c.drawn = true;
    logStep(ed, `card drawn ${Date.now() - c.opened}ms after it was asked${c.pending ? `, waiting: ${waitWords(ed)}` : ""}`);
  }

  // The pane's size comes in window pixels (zoomed); the card is placed in layout units.
  const z = zoom();
  const place = cardPlace(anchor, { width: ed.size.width / z, height: ed.size.height / z }, { width: CARD_W }, { top: stripH(ed) + BAR, bottom: HINTS });
  const lang = ed.lang === "tsx" ? "typescript" : ed.lang;
  const box = cardBox(ed, t, c, place, cardContent(ed, t, c, code, lang), cardFoot(ed, t, c, lang));

  return place.above ? box.bottom(place.bottom) : box.top(place.top);
}

/** What the card holds: its problems, what it waits for or why there's nothing, and the
 *  server's answer (its parts: Markdown, code); scrolled by its own offset (keys, wheel). */
function cardContent(ed: EditorPane, t: Theme, c: Card, code: string, lang: string): Element {
const parts = c.parts.map((p, i) => {
  if ("code" in p) return codeBlock(ed, t, p, p.lang ? (languageOf(p.lang) ?? lang) : lang, code);

  p.md ??= cardMarkdown(p.text);

  return div()
    .id(`card-text-${i}`)
    .px(12)
    .py(8)
    .text_color(t.muted)
    .child(TextView.markdown(`card-md-${i}`, p.md).on_link_click((url, cx) => followLink(ed, url, cx)));
});

  const note = c.note;

  return v_flex()
    .id("card-content")
    .relative()
    .top(-c.scroll)
    .flex_none()
    .on_size_change((size, cx) => {
      const h = size.height / zoom();

      if (Math.abs((c.contentH ?? -1) - h) > 0.5) {
        c.contentH = h;
        cx.notify();
      }
    })
    .children(c.problems.map((d, i) => problemRow(t, d, i, code)))
    .when(c.pending && c.keyboard, (el) =>
      el.child(
        h_flex()
          .id("card-wait")
          .px(12)
          .py(8)
          .gap(8)
          .items_center()
          .child(div().relative().size(6).flex_none().child(dither(t.ansi3, 1)))
          .child(div().flex_1().min_w(0).text_color(t.dim).child(waitWords(ed))),
      ),
    )
    // No answer to give: what's the case, and what to do about it.
    .when(Boolean(note), (el) =>
      note
        ? el.child(
            v_flex()
              .id("card-note")
              .px(12)
              .py(8)
              .gap(4)
              .child(div().text_color(t.foreground).child(note.text))
              .when(Boolean(note.fix), (e2) => (note.fix ? e2.child(div().text_color(t.dim).child(note.fix)) : e2)),
          )
        : el,
    )
    .children(parts)
    .when(c.links.length > 0, (el) => el.child(cardLinksView(ed, t, c)));;
}

/** A problem on the card: its severity's rule, its message, related places, its severity and code. */
function problemRow(t: Theme, d: Problem, i: number, code: string): Element {
  const sevColor = severityColors(t);

  return (
    v_flex()
          .id(`card-problem-${i}`)
          .relative()
          .border_b(1)
          .border_color(t.ansi0)
          .child(div().absolute().left(0).right(0).top(0).h(3).child(dither(sevColor[d.severity], 1)))
          .child(div().px(12).pt(9).pb(4).text_size(11.5).text_color(t.foreground).font_family(code).child(d.message))
          .when(d.related.length > 0, (el) =>
            el.children(
              d.related.slice(0, 4).map((r, j) =>
                div()
                  .id(`card-rel-${i}-${j}`)
                  .px(12)
                  .text_color(t.dim)
                  .child(`${r.path ? basename(r.path) : ""}:${r.line + 1}  ${r.message}`),
              ),
            ),
          )
          .child(
            h_flex()
              .px(12)
              .pb(8)
              .gap(12)
              .text_size(10)
              .text_color(t.dim)
              .child(div().text_color(sevColor[d.severity]).child(d.severity))
              .child(div().child(codeAndSource(d))),
          )
  );
}

/** The card's box, placed at `place`: its content scrolled inside, its foot; the pointer leaving a pointer's card closes it. */
function cardBox(ed: EditorPane, t: Theme, c: Card, place: CardPlace, content: Element, foot: Element): Element {
  const waiting = c.pending && !c.problems.length;

  return v_flex()
    .id("editor-card")
    .absolute()
    .left(place.left)
    .w(place.width)
    .max_h(place.maxH)
    .bg(t.background)
    .border(1)
    .border_color(waiting ? t.ansi8 : t.ansi0)
    .shadow_lg()
    .overflow_hidden()
    .on_hover((h, cx) => {
      ed.overCard = h;

      if (!h && !c.keyboard) {
        cx.timer.after(250, (cx) => {
          if (!ed.overCard && ed.card === c) {
            ed.card = null;
            cx.notify();
          }
        });
      }
    })
    .on_mouse_down("left", stop)
    .child(
      div()
        .id("card-scroll")
        .relative()
        .min_h(0)
        .overflow_hidden()
        .on_size_change((size, cx) => {
          const h = size.height / zoom();

          if (Math.abs((c.viewH ?? -1) - h) > 0.5) {
            c.viewH = h;
            cx.notify();
          }
        })
        .on_scroll_wheel((e, cx) => {
          if (!cardOverflows(ed)) return;

          c.scroll = Math.max(0, Math.min((c.contentH ?? 0) - (c.viewH ?? 0), c.scroll - e.delta.y / zoom()));
          cx.stop_propagation();
          cx.notify();
        })
        .child(content),
    )
    .child(foot);
}

/** The card's foot: the server's name or the type depth's controls, its keys, how it closes. */
function cardFoot(ed: EditorPane, t: Theme, c: Card, lang: string): Element {
  const footH = 24;
  const expandable = (lang === "typescript" || lang === "javascript") && c.parts.length > 0;

  const ctrl = (id: string, label: string, on: boolean, go: (cx: Context) => void): Element =>
    div()
      .id(id)
      .flex_none()
      .w(18)
      .h(18)
      .flex()
      .items_center()
      .justify_center()
      .border(1)
      .border_color(on ? t.ansi0 : t.background)
      .text_color(on ? t.foreground : t.dim)
      .when(on, (el) =>
        el
          .hover((s) => s.border_color(t.accent))
          .on_click((_e, cx) => {
            go(cx);
            cx.notify();
          }),
      )
      .child(label);

  const key = (k: string, what: string): Element => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().child(what));
  const vim = ed.vimOn();
  const overflow = cardOverflows(ed);

  // Its keys, and how it closes.
  return (
    h_flex()
      .id("card-foot")
      .h(footH)
      .flex_none()
      .px(12)
      .gap(12)
      .items_center()
      .overflow_hidden()
      .border_t(1)
      .border_color(t.ansi0)
      .text_size(10)
      .text_color(t.dim)
      // The server's name, unless the type depth needs the room.
      .when(c.parts.length > 0 && !expandable, (el) => el.child(div().flex_none().child(serverName(ed.server) ?? "")))
      .when(expandable, (el) =>
        el
          .child(ctrl("card-less", "−", c.level > 0, (cx) => hoverLevel(ed, -1, cx)))
          .child(div().flex_none().child(`type depth ${c.level}`))
          .child(ctrl("card-more", "+", c.more, (cx) => hoverLevel(ed, 1, cx)))
          .child(div().flex_none().text_color(t.accent).child("ctrl-−/=")),
      )
      .when(c.parts.length > 0 && serverId(ed.server) !== null, (el) => el.child(key(vim ? "gd" : "cmd-k d", "definition")))
      .when(c.keyboard && c.links.length > 0, (el) => el.child(key("tab", "links")))
      .when(overflow, (el) => el.child(key("ctrl-d ctrl-u", "scroll")))
      .child(div().flex_1())
      .child(key("esc", "close"))
  );
}
