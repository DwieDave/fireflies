// The tab strip's scroll (tabs.ts): more tabs than fit the strip scroll
// sideways under its ends, and every tab stays reachable.
//   - The wheel and the trackpad scroll the strip while it overflows (GPUI's
//     own scroll, a vertical wheel turned sideways); while everything fits,
//     the wheel steps tabs as before (tabs.ts).
//   - The shown tab is always brought into view, clear of the fades: after a
//     switch (key, click, wheel, command), a new tab, a closed one, a move,
//     and when the strip changes width. Scrolling by hand doesn't snap back:
//     only those events ask for it.
//   - A cut-off end says so: the tabs dissolve into the night under its fade
//     (seamFade: the right one always stands before the seam, the left one
//     while the strip is scrolled off its start), and a mark on it counts
//     those beyond: ‹ n, n › (as the editor's file tabs). A click on a mark
//     brings in the next tab that way.
//   - A tab dragged onto a cut-off end scrolls the strip a tab at a time
//     (EDGE_MS), its stake standing by the tab that came in.
// The strip's children: a lead-in (LEAD px, so a stake before the first tab
// isn't cut, and scrolling to it is scrolling to the start), the tabs, then
// the end, never narrower than a fade (so the last tab clears it). Where
// things are comes from their on_bounds_change, in window px (the zoom is in
// them, so the fade's width is scaled to match).

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { ScrollHandle as Scroll } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import { dither, TOOL_LOOK } from "./kit.ts";
import type { ToolLook } from "@fireflies/toolground";
import type { Gap } from "./tabdrag.ts";

// Where the tabs end and the tools begin (kit.ts toolGround, TOOL_LOOK): the
// tabs dissolve into the night under the seam in SEAM[look].steps dithered
// bands of SEAM.band px, then the seam itself, and the tools (with the bell
// and "+ new", blocks of their own) stand on their own ground to the strip's
// right edge. "ledge": a gap of night that cuts the tabs' horizon, then a
// raised, lit ledge. "plate": a dithered band the strip's height, then a plate.
export const SEAM = { band: 8, ledge: { steps: 5, gap: 12 }, plate: { steps: 6, band: 6 } } as const;

/** How much of the night covers band `i` of `n` (0..1, the last all). */
export const fadeCover = (i: number, n: number): number => (i + 1) / n;

/** A fade's width, layout px. */
export const fadeWidth = (look: ToolLook = TOOL_LOOK): number => SEAM.band * SEAM[look].steps;

/** The strip's lead-in before its first tab, layout px. */
export const LEAD = 4;

/** How often a drag held on a cut-off end brings in the next tab, ms. */
export const EDGE_MS = 350;

/**
 * The tabs' fade at an end of the tab area: the night (the background) over
 * them, thickening outwards in dithered steps, as much of it as fadeCover
 * says: a checker of the night (half) at an opacity below a half, the checker
 * plus the solid night above it. The right one stands under the seam: over
 * the tab area's end it shows nothing (the night on the night); over
 * overflowing tabs they dissolve into it rather than run into the tools. The
 * left one, while the strip is scrolled, over the tabs gone past its start.
 * It takes no pointer: a press goes through to the tab under it. The horizon stays.
 */
export function seamFade(t: Theme, look: ToolLook = TOOL_LOOK, side: "left" | "right" = "right"): Element {
  const n = SEAM[look].steps;

  const band = (i: number) => {
    const c = fadeCover(side === "right" ? i : n - 1 - i, n);
    const el = div().absolute().top(0).bottom(0).left(i * SEAM.band).w(SEAM.band);

    if (c >= 1) return el.bg(t.background);

    if (c <= 0.5) return el.opacity(c * 2).child(dither(t.background, 1));

    // over half: the checker, and the solid night over the rest
    return el.child(dither(t.background, 1)).child(div().absolute().top(0).left(0).size_full().bg(t.background).opacity((c - 0.5) * 2));
  };

  const el = div().id(side === "right" ? "tab-fade" : "tab-fade-left").absolute().top(0).bottom(2).w(fadeWidth(look));

  return (side === "right" ? el.right(0) : el.left(0)).children(Array.from({ length: n }, (_, i) => band(i)));
}

// ---- where the tabs stand (pure)

/** A thing's place across the strip, window px. */
export interface Span {
  readonly x: number;
  readonly width: number;
}

/** The strip's ends: how many tabs are cut off at each (partly under its fade
 *  or past it), and whether it is scrolled off its start. */
export interface Cut {
  readonly left: number;
  readonly right: number;
  readonly scrolled: boolean;
}

const EPS = 0.5;

/** Where the clear part of the strip starts and ends, window px. */
export interface Clear {
  readonly left: number;
  readonly right: number;
}

/** The clear part of the strip, between its fades (the left one only while scrolled). */
export function clearOf(view: Span, fade: number, scrolled: boolean): Clear {
  return { left: view.x + (scrolled ? fade : 0), right: view.x + view.width - fade };
}

/** The tabs cut off at each end; `tabs` in strip order, unknown places skipped. */
export function cutOff(view: Span, tabs: readonly (Span | undefined)[], fade: number, scrolled: boolean): Cut {
  const c = clearOf(view, fade, scrolled);
  let left = 0;
  let right = 0;

  for (const t of tabs) {
    if (!t) continue;

    if (scrolled && t.x < c.left - EPS) left += 1;
    else if (t.x + t.width > c.right + EPS) right += 1;
  }

  return { left, right, scrolled };
}

/**
 * The strip's child (0 the lead-in, i + 1 tab i, then the end) to scroll to
 * (ScrollHandle.scroll_to_item: the least scroll that shows it) so that tab
 * `i` at `tab` stands clear of the fades, or null when it does: cut on the
 * left, the one before it to the strip's start; on the right, the one after
 * it (or the end) to the strip's end. A tab wider than the clear part: itself.
 */
export function revealChild(view: Span, tab: Span, i: number, fade: number, scrolled: boolean): number | null {
  const c = clearOf(view, fade, scrolled);

  if (tab.x < c.left - EPS) return i;

  if (tab.x + tab.width > c.right + EPS) return tab.width > c.right - c.left ? i + 1 : i + 2;

  return null;
}

/** The next tab to bring in from beyond an end (`dir` 1 the right, -1 the left), or null. */
export function nextCut(view: Span, tabs: readonly (Span | undefined)[], fade: number, scrolled: boolean, dir: 1 | -1): number | null {
  const c = clearOf(view, fade, scrolled);

  if (dir > 0) {
    const k = tabs.findIndex((t) => t !== undefined && t.x + t.width > c.right + EPS);

    return k < 0 ? null : k;
  }

  if (!scrolled) return null;

  let k: number | null = null;

  tabs.forEach((t, i) => {
    if (t && t.x < c.left - EPS) k = i;
  });

  return k;
}

const spanOf = (b: { readonly x: number; readonly width: number }): Span => ({ x: b.x, width: b.width });

// ---- the strip's scroll

/** A drag held on a cut-off end: which way, and the timer stepping it. */
interface Edge {
  readonly dir: 1 | -1;
  readonly task: { cancel(): void };
}

export class StripScroll {
  handle: Scroll | null = null; // made in the strip's init (tabs.ts)
  view: Span | null = null; // the strip, as last laid out
  boxes = new Map<string, Span>(); // each shown tab, as last laid out
  ids: string[] = []; // the shown tabs, strip order
  cut: Cut = { left: 0, right: 0, scrolled: false };
  key = ""; // the shown tab and the shown tabs' order, as last drawn
  seq = 0; // bumped whenever the shown tab should be brought into view
  seen = -1; // the seq last brought into view
  edge: Edge | null = null;

  /** A fade's width, window px. */
  fade(): number {
    return fadeWidth() * (settings().zoom || 1);
  }

  scrolled(): boolean {
    return (this.handle?.offset().x ?? 0) < -EPS;
  }

  /** Each render: the shown tabs and the shown one. Another shown tab, or a tab
   *  added, closed or moved, asks for the shown one to be brought into view. */
  frame(ids: readonly string[], active: string | null): void {
    const key = `${active ?? ""}|${ids.join(",")}`;

    if (key !== this.key) {
      this.key = key;
      this.seq += 1;
    }

    this.ids = [...ids];

    for (const id of this.boxes.keys()) if (!ids.includes(id)) this.boxes.delete(id);
  }

  /** Whether the strip takes a wheel at window x: it overflows and x is over it. */
  owns(x: number): boolean {
    const v = this.view;
    const c = this.cut;

    if (!v) return false;

    return x >= v.x && x <= v.x + v.width && (c.left > 0 || c.right > 0 || c.scrolled);
  }

  /** The cut-off counts again; a change redraws the marks. */
  recount(cx: Context): void {
    if (!this.view) return;

    const c = cutOff(this.view, this.ids.map((id) => this.boxes.get(id)), this.fade(), this.scrolled());

    if (c.left === this.cut.left && c.right === this.cut.right && c.scrolled === this.cut.scrolled) return;

    this.cut = c;
    cx.notify();
  }

  /** Brings shown tab `i` clear of the fades (where it isn't known yet: plainly into view). */
  reveal(i: number): void {
    if (i < 0) return;

    const tab = this.boxes.get(this.ids[i] ?? "");

    if (!this.view || !tab) {
      this.handle?.scroll_to_item(i + 1);

      return;
    }

    const k = revealChild(this.view, tab, i, this.fade(), this.scrolled());

    if (k !== null) this.handle?.scroll_to_item(k);
  }

  /** Brings in the next tab beyond an end: the gap by it (for a drag's stake), or null with none. */
  step(dir: 1 | -1): Gap | null {
    if (!this.view) return null;

    const k = nextCut(this.view, this.ids.map((id) => this.boxes.get(id)), this.fade(), this.scrolled(), dir);
    const id = k === null ? undefined : this.ids[k];

    if (k === null || id === undefined) return null;

    this.handle?.scroll_to_item(dir > 0 ? k + 2 : k);

    return { id, after: dir > 0 };
  }

  /** A drag over the strip at window x: on a cut-off end, the strip steps that
   *  way every EDGE_MS (`moved` gets the gap by each tab brought in); elsewhere it stops. */
  dragAt(x: number, cx: Context, moved: (gap: Gap) => void): void {
    const v = this.view;
    const f = this.fade();
    const dir = !v ? 0 : x > v.x + v.width - f && this.cut.right > 0 ? 1 : x < v.x + f && this.cut.scrolled ? -1 : 0;

    if (dir === (this.edge?.dir ?? 0)) return;

    this.stopEdge();

    if (dir === 0) return;

    const task = cx.timer.every(EDGE_MS, (later) => {
      const gap = this.step(dir);

      if (gap) moved(gap);
      else this.stopEdge();

      later.notify();
    });

    this.edge = { dir, task };
  }

  stopEdge(): void {
    this.edge?.task.cancel();
    this.edge = null;
  }

  /** A shown tab's element: it reports where it is; the shown one also
   *  carries the marker that brings it into view once laid out (a new id per
   *  ask: on_bounds_change fires first for it, then never again for that ask). */
  tab(el: Element, id: string, active: boolean): Element {
    const seq = this.seq;

    return el.on_bounds_change((b, cx) => {
      this.boxes.set(id, spanOf(b));
      this.recount(cx);
    }).when(active, (e) => e.child(div().id(`tab-reveal-${seq}`).absolute().top(0).left(0).size_full().on_bounds_change((b, cx) => {
      if (this.seen === seq) return;

      this.seen = seq;
      this.boxes.set(id, spanOf(b));
      this.reveal(this.ids.indexOf(id));
      cx.notify();
    })));
  }

  /** The strip: it scrolls (the handle), reports its place (a new width asks
   *  for the shown tab again), and holds the lead-in, the tabs and the end. */
  strip(el: Element, tabs: readonly Element[], end: Element): Element {
    const h = this.handle;

    return el.overflow_x_scroll().when(Boolean(h), (e) => (h ? e.track_scroll(h) : e))
      .on_bounds_change((b, cx) => {
        const wider = !this.view || Math.abs(this.view.width - b.width) > EPS;

        this.view = spanOf(b);
        this.recount(cx);

        if (!wider) return;

        this.seq += 1;
        cx.notify();
      })
      .child(div().id("tab-lead").flex_none().w(LEAD).h_full())
      .children([...tabs])
      .child(end.min_w(fadeWidth()));
  }

  /** Over the tab area: the left fade while scrolled, and the ‹ n / n › marks of a cut-off end. */
  marks(t: Theme): Element[] {
    const c = this.cut;

    const mark = (id: string, text: string, dir: 1 | -1) => {
      const el = h_flex().id(id).absolute().top(0).bottom(2).px(4).items_center().bg(t.background)
        .text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        // Its own press: not the tab under it.
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          this.step(dir);
          cx.notify();
        })
        .child(text);

      return dir > 0 ? el.right(0) : el.left(0);
    };

    return [
      ...(c.scrolled ? [seamFade(t, TOOL_LOOK, "left")] : []),
      ...(c.left > 0 ? [mark("tab-more-left", `‹ ${c.left}`, -1)] : []),
      ...(c.right > 0 ? [mark("tab-more-right", `${c.right} ›`, 1)] : []),
    ];
  }
}
