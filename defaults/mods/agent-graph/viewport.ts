// The agent graph's viewport: the graph placed on its canvas, panned and
// zoomed (dragged, the wheel), the nodes drawn.

import { div } from "gpui-kit";
import type { Context, Element, Point } from "gpui-kit";
import type { Theme } from "herdr";
import type { GraphNode } from "./graph.ts";
import { place, canvas, sky, dims, ZOOM } from "./graph.ts";
import { stop, PLACEHOLDER } from "./state.ts";
import { pickNode, saveState, zoomTo } from "./navigate.ts";
import type { default as Agents } from "./main.ts";

/** Where the graph sits: dragged there, else at the left, the whole graph centred when it fits, else the session node. */
export function panFor(v: Agents, height: number): Point {
  if (v.pan) return v.pan;

  const vh = v.view.height;
  const y = height <= vh ? (vh - height) / 2 : Math.min(0, Math.max(vh - height, vh / 2 - v.rootY));

  return { x: 0, y: Math.round(y) };
}

/** The graph's window: drag (or scroll) to move it, double-click empty sky to centre it again. */
export function viewport(v: Agents, t: Theme, root: GraphNode): Element {
  const d = dims(v.zoom);
  const probe = place(root, d); // sizes and positions, before drawing

  v.rootY = root.y + root.h / 2;
  v.graphH = probe.height;
  v.layout = probe.nodes;

  const at = panFor(v, probe.height);
  const { el } = canvas(t, root, v.selected, (n, cx) => pickNode(v, n, cx), at.x, at.y, d);

  const end = (cx: Context) => {
    if (v.drag) {
      v.drag = null;
      cx.notify();
    }
  };

  return div().id("ag-graph").relative().flex_1().min_h(0).overflow_hidden()
    .when(Boolean(v.drag), (el) => el.cursor_grabbing()).when(!v.drag, (el) => el.cursor_grab())
    .on_size_change((size, cx) => {
      if (size.width >= PLACEHOLDER && size.height >= PLACEHOLDER) {
        v.view = size;
        cx.notify();
      }
    })
    .on_mouse_down("left", (e, cx) => {
      if (e.click_count === 2) {
        v.pan = null;
        v.drag = null;
        cx.notify();

        return;
      }

      v.handle?.focus();
      v.drag = { x: e.position.x, y: e.position.y, from: panFor(v, probe.height) };
      cx.notify();
    })
    .on_mouse_move((e, cx) => {
      const d = v.drag;

      if (!d) return;

      v.pan = { x: Math.round(d.from.x + e.position.x - d.x), y: Math.round(d.from.y + e.position.y - d.y) };
      cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => end(cx))
    .on_hover((h, cx) => {
      if (!h) end(cx);
    })
    .on_scroll_wheel((e, cx) => {
      if (e.modifiers.platform || e.modifiers.control) {
        // cmd-scroll (or a pinch's ctrl-scroll) zooms around the pointer.
        zoomTo(v, v.zoom * Math.pow(ZOOM.step, e.delta.y / 40), e.local_position);
      } else {
        const p = panFor(v, probe.height);

        v.pan = { x: Math.round(p.x + e.delta.x), y: Math.round(p.y + e.delta.y) };
      }

      cx.notify();
    })
    .child(sky(t, at.x, at.y))
    .child(el)
    .when(Boolean(v.pan), (el) => el.child(div().id("ag-recentre").absolute().right(10).bottom(8).px(6).h(20).flex().items_center()
      .text_size(11).text_color(t.muted).bg(t.background).hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        v.pan = null;
        cx.notify();
      })
      .child("centre")))
    .when(v.zoom !== 1, (el) => el.child(div().id("ag-zoom").absolute().left(10).bottom(8).px(6).h(20).flex().items_center()
      .text_size(11).text_color(t.dim).bg(t.background).hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        v.zoom = 1;
        saveState(v);
        cx.notify();
      })
      .child(`${Math.round(v.zoom * 100)}%`)));
}
