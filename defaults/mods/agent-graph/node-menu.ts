// A node's menu: the actions the node already has by key or click (follow
// its newest step G, its oldest gg, fold or open a run enter, ask, focus the
// terminal f), each with its key. Where it stands (@fireflies/menu-place): at
// the press on a right-click, beside the selected node when `m` opens it, in
// the middle when nothing is selected (the session's menu) or the node isn't
// laid out. Drawn inside the graph (an absolute box over it).

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Option } from "effect";
import { lit, menuBox } from "@fireflies/look";
import { inView, placeMenu } from "@fireflies/menu-place";
import type { Anchor, Box, Pt } from "@fireflies/menu-place";
import type { GraphNode } from "./graph.ts";
import { dims } from "./graph.ts";
import type { ClaudePane } from "./state.ts";
import { startFollowing } from "./reading.ts";
import { askAgent, flipRun } from "./navigate.ts";
import { panFor } from "./viewport.ts";
import type { default as Agents } from "./main.ts";

/** One action: the key that does it ("" for one only a click does), what it says, what it does. */
export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly go: () => void;
}

/** An open menu: the node it is for, its entries, the chosen one, where it stands. */
export interface NodeMenu {
  readonly node: string;
  readonly title: string;
  readonly entries: readonly MenuEntry[];
  readonly at: Anchor;
  sel: number;
}

/** What the menu offers for `n`: what its keys and the details' chips do. */
export function menuEntries(v: Agents, n: GraphNode, pane: ClaudePane): readonly MenuEntry[] {
  const out: MenuEntry[] = [];

  if (n.kind === "agent" || n.kind === "main") {
    out.push({ key: "G", label: "Follow its newest step", go: () => startFollowing(v) });
    out.push({
      key: "gg", label: "Its oldest step", go: () => {
        v.follow = false;
        v.feedScroll?.scroll_to_item(0);
      },
    });
  }

  if (n.kind === "run") out.push({ key: "↵", label: n.folded ? "Open the run" : "Fold the run", go: () => flipRun(v, n) });

  if (n.kind !== "main") out.push({ key: "", label: "Ask how it's doing", go: () => askAgent(v, n, pane) });

  out.push({ key: "f", label: "Focus the terminal", go: () => v.focusTerminal(pane) });

  return out;
}

/** The app's zoom (layout px per window px). */
const zoom = (): number => {
  const z = settings().zoom;

  return z > 0 ? z : 1;
};

/** A press's place in the graph's view (layout px), from its window position; none until the view is measured. */
export const pressAt = (v: Agents, position: Pt): Anchor => (v.origin === null ? null : inView(position, v.origin, zoom()));

/** Where `n` stands in the graph's view (layout px); none when it isn't laid out. */
export function nodeAnchor(v: Agents, n: GraphNode): Anchor {
  if (!Arr.some(v.layout ?? [], (x) => x.key === n.key)) return null;

  const p = panFor(v, v.graphH ?? 0);

  return { x: n.x + p.x, y: n.y + p.y, w: dims(v.zoom).NW, h: n.h };
}

/** A menu key: up/down (or j k) choose, enter runs the chosen one, an entry's own key runs it,
 *  escape (or m, q) closes. True when the key was the menu's; `close` before a run or on escape. */
export function menuKey(m: NodeMenu, key: string, typed: string | null, close: () => void): boolean {
  const n = m.entries.length;

  if (key === "escape" || key === "m" || key === "q") {
    close();

    return true;
  }

  if (key === "down" || key === "j" || key === "up" || key === "k") {
    m.sel = (m.sel + (key === "down" || key === "j" ? 1 : -1) + n) % n;

    return true;
  }

  const picked = key === "enter" ? Arr.get(m.entries, m.sel) : Arr.findFirst(m.entries, (e) => e.key !== "" && e.key === typed);

  return Option.match(picked, {
    onNone: () => key === "enter",
    onSome: (entry) => {
      close();
      entry.go();

      return true;
    },
  });
}

const ROW = 24;
const KEY_W = 26;

/** The menu's size (layout px): a row per entry, as wide as its longest label. */
export const menuSize = (m: NodeMenu): Box => ({
  width: Math.max(180, Math.min(320, KEY_W + 36 + Math.max(...Arr.map(m.entries, (e) => e.label.length * 7)))),
  height: 30 + m.entries.length * ROW + 8,
});

/** The menu over the graph's view of `room` (layout px): at its anchor, rows that run on a click,
 *  the one under the pointer chosen. `close` closes it. */
export function menuView(t: Theme, m: NodeMenu, room: Box, close: () => void): Element {
  const size = menuSize(m);
  const { x, y } = placeMenu(size, room, m.at);

  const rows = Arr.map(m.entries, (e, i) => {
    const on = i === m.sel;

    const row = h_flex().id(`ag-mi-${i}`).relative().h(ROW).px(10).gap(8).items_center().cursor_pointer()
      .on_mouse_move((_e, cx) => {
        if (m.sel !== i) {
          m.sel = i;
          cx.notify();
        }
      })
      .on_click((_e, cx: Context) => {
        cx.stop_propagation();
        close();
        e.go();
        cx.notify();
      });

    return (on ? lit(t, row, true) : row)
      .child(div().relative().w(KEY_W).flex_none().text_color(t.accent).child(e.key))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(e.label));
  });

  return menuBox(t, v_flex().id("ag-menu").absolute().left(x).top(y).w(size.width).h(size.height).py(4).text_size(11).overflow_hidden())
    .on_mouse_down_out((_e, cx) => {
      close();
      cx.notify();
    })
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
    .on_scroll_wheel((_e, cx) => cx.stop_propagation())
    .child(div().h(22).px(10).flex().items_center().text_color(t.dim).truncate().child(m.title))
    .children(rows);
}
