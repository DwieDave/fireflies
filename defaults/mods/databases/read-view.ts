// What a panel shows while one of its reads runs (reads.ts: the words, the
// seconds, "esc stops it", a stop chip), and a missing client's message with
// the line to copy for this machine's setup (clients.ts installLine).

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Kind } from "./kinds.ts";
import { ART, chip } from "./kit.ts";
import { NIX_NOTE, PROGRAMS, installHow, installLine } from "./clients.ts";
import type { Read } from "./reads.ts";
import { readWords } from "./reads.ts";
import type { default as DbView } from "./main.ts";

/** A read going on, in the middle of its panel: the moon, what runs and for how long, its stop. */
export function readingView(t: Theme, id: string, r: Read): Element {
  return v_flex().size_full().items_center().justify_center().gap(8).px(16).text_size(11)
    .child(svg(`${ART}/moon-4.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6).loop("opacity", { from: 0.3, to: 0.8, period: 1600 }))
    .child(div().text_center().text_color(t.muted).child(readWords(r)))
    .child(h_flex().gap(8).items_center()
      .child(div().text_color(t.dim).child("esc stops it"))
      .child(chip(t, `${id}-stop`, "■ stop", false, () => r.end("stopped"), t.blocked)));
}

/** A missing client: its name, where it was looked for, the line for this machine to copy (a
 *  click copies it) and where that line goes. */
export function missingView(t: Theme, v: DbView, id: string, kind: Kind, where: string): Element {
  const line = installLine(kind, v.setup);
  const note = NIX_NOTE[kind];

  return v_flex().size_full().items_center().justify_center().gap(8).px(16).text_size(11)
    .child(svg(`${ART}/moon-1.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6))
    .child(div().text_center().text_color(t.muted).child(`${PROGRAMS[kind].join(" or ")} isn't here`))
    .child(div().text_center().text_color(t.dim).child(where))
    .when(note !== null, (el) => el.child(div().text_center().text_color(t.dim).child(note ?? "")))
    .child(v_flex().id(`${id}-copy`).w_full().max_w(420).gap(2).px(8).py(4).cursor_pointer().border(1).border_color(t.ansi0)
      .hover((s) => s.border_color(t.accent))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.write_to_clipboard(line);
        v.say(`copied: ${line}`, "done");
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_color(t.ansi3).child(line))
        .child(div().flex_none().text_color(t.accent).child("copy")))
      .child(div().text_size(10).text_color(t.dim).child(installHow(v.setup))));
}
