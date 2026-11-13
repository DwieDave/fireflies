// Even out panes, in Nocturne's look: a small square popup over a pane with
//
//   ▦  All panes     every row and column of the tab gets an even share
//   ▥  This row      the panes side by side with this one
//   ▤  This column   the panes stacked with it
//   ▦  As a grid     every pane of the tab rearranged into an even grid
//                    (nocturne.gridify; Nocturne's sky runs it)
//
// Each is pane.equalize {scope, pane}; fixed widths (a px size) stay. The
// row under the cursor sits on a dithered band with a blue edge, like
// Nocturne's menus. a / r / c / g pick, ↑/↓ (j / k, tab) move, Enter or
// Space runs, Esc closes.
//
// Opened by the nocturne pane header's ▦ button and the pane menu's
// "Even out panes…" (props { pane, overlay }); without a pane it works on the
// focused one. The palette and keys run pane.equalize directly.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Element, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, keys, panes, props, run, settings, theme, window as appWindow } from "herdr";
import type { Guarded } from "./guard.ts";
import { isString, object } from "./guard.ts";
import type { ScopeRow } from "./scopes.ts";
import { rows, shortcut } from "./scopes.ts";

const ROW = 26;
const HERE = "mods/equalize-panes";

/** What it is opened with (see the top); other props are no props. */
const isEqualizeProps = object({}, { pane: isString, overlay: isString });

type EqualizeProps = Guarded<typeof isEqualizeProps>;

const equalizeProps = (): EqualizeProps => {
  const p = props();

  return isEqualizeProps(p) ? p : {};
};

// The dither fill, copied from ../nocturne/kit.js (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** The pane the popup works on (null: none) and how many panes its tab has. */
interface Target {
  readonly pane: string | null;
  readonly count: number;
}

export default class EqualizePanes extends View {
  cursor = 0;
  handle: FocusHandle | null = null;

  override init(_p: Props | undefined, cx: AsyncContext) {
    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();
  }

  /** The pane it's for: the one it was opened on, else the focused one. */
  target(): Target {
    const all = panes();
    const wanted = equalizeProps().pane;
    const p = all.find((x) => x.pane === wanted) ?? all.find((x) => x.focused);

    return { pane: p?.pane ?? null, count: p ? all.filter((x) => x.tab === p.tab).length : 0 };
  }

  override close() {
    const id = equalizeProps().overlay;

    if (id) closeOverlay(id);
  }

  pick(row: ScopeRow | undefined) {
    if (!row || row.off) return;

    this.close();
    run(row.command, row.args);
  }

  override render() {
    const t = theme();
    const { pane, count } = this.target();
    const list = rows(pane, count);
    const bound = keys();
    const live = list.filter((r) => !r.off);

    this.cursor = Math.min(this.cursor, Math.max(0, live.length - 1));

    const current = live[this.cursor];

    const row = (r: ScopeRow) => {
      const on = r === current;
      const hint = shortcut(bound, r.scope) || r.key;

      return h_flex().id(`eq-${r.scope}`).relative().h(ROW).px(12).gap(10).items_center().flex_none().text_size(12)
        .text_color(r.off ? t.dim : on ? t.foreground : t.muted)
        .when(!r.off, (el) => el.on_hover((h, cx) => {
          if (h) {
            this.cursor = live.indexOf(r);
            cx.notify();
          }
        }))
        .on_click(() => this.pick(r))
        .when(on, (el) => el
          .child(dither(t.ansi0, 1))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(svg(`${HERE}/${r.icon}.svg`).relative().size(14).flex_none().text_color(r.off ? t.dim : t.accent))
        .child(div().relative().flex_1().min_w(0).truncate().child(r.name))
        .child(div().relative().flex_none().text_size(11).text_color(on && !r.off ? t.accent : t.dim).child(hint));
    };

    const root = v_flex().id("nocturne-equalize").size_full().bg(t.background).border(1).border_color(t.ansi0).pb(4);

    return (this.handle ? root.track_focus(this.handle) : root)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;

        const k = e.key, shift = e.modifiers.shift;
        const down = k === "down" || k === "j" || (k === "tab" && !shift), up = k === "up" || k === "k" || (k === "tab" && shift);

        if ((down || up) && live.length) {
          this.cursor = (this.cursor + (down ? 1 : -1) + live.length) % live.length;
          cx.stop_propagation();
          cx.notify();

          return;
        }

        if (k === "enter" || k === "space") {
          this.pick(current);

          return;
        }

        if (k === "escape") {
          this.close();

          return;
        }

        this.pick(live.find((r) => r.key === k));
      })
      .child(h_flex().relative().h(26).mb(2).flex_none().px(12).items_center()
        .child(div().relative().text_size(11).text_color(t.foreground).child("Even out"))
        .child(div().flex_1())
        .child(div().relative().text_size(11).text_color(t.dim).child(count < 2 ? "one pane" : `${count} panes`))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .children(list.map(row))
      .child(div().px(12).pt(4).flex_none().text_size(10).text_color(t.dim).child("fixed widths stay"));
  }
}
