// The bell: a quiet mark in the tab strip, and the engine behind it.
//
//   nothing waits   a 9 px pixel bell (art/bell.svg, drawn like the strip's
//                   ▶), muted like the strip's tools; blue while open
//   requests wait   the bell in pink, blinking, and how many permissions and
//                   questions wait, in a filled chip; agents that need a
//                   look (an error, waiting for input) as a dim "+n" beside it
//   a look only     the bell in the working yellow and a dim count
// Click opens the overview, hanging under the bell like the script runner's
// deck under ▶; notifications.open (a key, the palette, a toast)
// opens it centered, as cmd-shift-r the deck. Again closes it, and the
// bell is lit (a dithered band, a blue foot) while it's open. A toast's
// request for one terminal opens it on that one. Nocturne's tab strip walks
// to it with the keyboard (its row's last control): a blue ring while its
// cursor is here (shared CHROME), enter opens or closes the overview.
//
// The bell's block is as wide as the bell plus END: it ends where the panes
// below end, with no blank after it. It sizes its own block (layout.resize)
// when the bell grows or shrinks. Nocturne's layout puts "+ new" after it
// (props.end 0: that block keeps the room at the end).

import { div, svg } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex } from "gpui-base";
import { theme, nextCommand, shared, keys, layout, run, settings, props } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, nullable, object, readShared, sharedKey } from "./guard.ts";
import { Engine, items, OPEN_KEY, terminalsNow } from "./engine.ts";
import { counts } from "./model.ts";
import { openOverview, toggleOverview, overviewOpen, noteWindow } from "./open.ts";
import { ART, dither, stop, toolGround, toolHover } from "./kit.ts";

const POLL = 1500;

// Room after the bell, layout px: the main block's side padding, so its edge
// lines up with the panes' right edge; props.end when a block follows.
const END = 8;

/** The bell's props: the room after it (layout px). */
const isBellProps = object({}, { end: isNumber });

const end = (): number => {
  const p = props();
  const e = isBellProps(p) ? p.end : undefined;

  return e !== undefined && e >= 0 ? e : END;
};

// Nocturne's keyboard cursor outside its tab strip (nocturne/nav.js CURSOR).
const CHROME = sharedKey("nocturne.chrome", nullable(object({}, { region: nullable(isString) })));

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A block of the shown layout (layout()), the fields read here. */
const isLayoutNode = object({}, {
  id: isString,
  content: nullable(object({}, { mod: nullable(isString), props: nullable(object({}, { role: nullable(isString) })) })),
  children: isList,
  size: nullable(object({}, { px: nullable(isNumber) })),
});

type LayoutNode = Guarded<typeof isLayoutNode>;

/** This bell's layout block: the one showing notifications as a bell. */
function bellNode(n: LayoutNode): LayoutNode | null {
  if (n.content?.mod === "notifications" && (n.content.props?.role ?? "bell") === "bell") return n;

  for (const c of n.children ?? []) {
    const f = isLayoutNode(c) ? bellNode(c) : null;

    if (f) return f;
  }

  return null;
}

/** Sizes the bell's block to `width` (drawn px, zoomed) plus END, when it isn't. */
function fit(width: number) {
  const root = layout();
  const node = isLayoutNode(root) ? bellNode(root) : null;

  if (!node?.id || !(width > 0)) return;

  const px = Math.round(width / (settings().zoom || 1)) + end();

  if (Math.abs((node.size?.px ?? 0) - px) >= 1) run("layout.resize", { id: node.id, px });
}

/** "⌘⇧A" for the key bound to open the overview, if any. */
function shortcut(): string {
  const k = keys().find((x) => x.action === "notifications.open")?.keys;

  if (!k) return "";

  return k.replace(/cmd-/g, "⌘").replace(/shift-/g, "⇧").replace(/alt-/g, "⌥").replace(/ctrl-/g, "⌃").toUpperCase();
}

/** The bell's mark in `color`; `blink` for what needs the person. */
export function mark(color: Color, blink = false): Element {
  const el = svg(`${ART}/bell.svg`).size(9).flex_none().text_color(color);

  return blink ? el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }) : el;
}

export default class Bell {
  engine = new Engine();
  seen = "";
  // The toast's request last opened (shared OPEN's `at`): each opens once.
  asked: number | null = null;
  // The press on the bell, and whether the overview was open then.
  press: { readonly e: MouseButtonEvent; readonly open: boolean } | null = null;

  init(_props: Props | undefined, cx: AsyncContext) {
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^notifications\./, "");

        if (c === "open") {
          // A toast asks for one terminal's request through shared(OPEN),
          // fresh and once: that opens (or retargets) the overview; else open
          // toggles it.
          const o = readShared(shared, OPEN_KEY, null);

          if (o?.terminal && o.at !== this.asked && Date.now() - (o.at ?? 0) < 5000) {
            this.asked = o.at ?? null;
            openOverview(o.terminal);
          } else toggleOverview();
        } else if (c === "refresh") this.refresh(cx);

        cx.notify();
      }
    });
  }

  refresh(cx: Context) {
    cx.spawn(async (cx) => {
      try {
        if (await this.engine.refresh()) cx.notify();
      } catch (cause: unknown) {
        console.log(`notifications: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    });
  }

  render(cx: Context): Element {
    const t = theme();
    // A status changed: read again now rather than at the next poll.
    const sig = terminalsNow().map((x) => `${x.address}:${x.report?.state ?? x.status}:${x.status_ms ?? ""}`).join(",");

    if (sig !== this.seen) {
      this.seen = sig;
      this.refresh(cx);
    }

    const c = counts(items());
    const parts = [c.permission && `${c.permission} permission${c.permission > 1 ? "s" : ""}`, c.question && `${c.question} question${c.question > 1 ? "s" : ""}`, c.other && `${c.other} to look at`].filter(Boolean);
    const key = shortcut();
    const tip = (parts.length ? `Waiting on you: ${parts.join(" · ")}` : "Nothing waits on you") + (key ? ` (${key})` : "");
    const ring = readShared(shared, CHROME, null)?.region === "bell";
    const open = Boolean(overviewOpen());

    // How big the overview can be (open.ts overviewPlace).
    try {
      noteWindow(window.viewport_size());
    } catch {
      /* not drawing: the last size stays */
    }

    return h_flex().id("notify-bell").relative().size_full().pr(end()).items_center().justify_start().bg(t.background)
      // The toolbar's ground continues under the bell (kit.ts toolGround).
      .children(toolGround(t))
      .child(h_flex().id("bell").relative().flex_none().h(24).px(7).gap(6).items_center().text_size(11).text_color(open ? t.foreground : t.muted).cursor_pointer()
        .on_size_change((size) => fit(size.width))
        .hover((s) => s.bg(toolHover(t)).text_color(t.foreground))
        // No tooltip while open: it would sit on the drop-down.
        .when(!open, (el) => el.tooltip(tip))
        // As the strip's buttons (nocturne/tabs.js tool): the click goes by
        // whether the bell was lit when pressed, since the press itself
        // closes an open drop-down before the click comes.
        .on_mouse_down("left", (e, cx) => {
          stop(e, cx);
          this.press = { e, open };
        })
        .on_click(() => toggleOverview({ press: this.press?.e ?? null, wasOpen: Boolean(this.press?.open) }))
        // Open: the strip's open look, a dithered band and a blue foot.
        .when(open, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
        .when(c.needs > 0, (el) => el
          .child(mark(t.blocked, true))
          .child(div().h(15).px(4).flex().items_center().bg(t.blocked).text_color(t.background).child(String(c.needs))))
        .when(c.needs === 0 && c.other > 0, (el) => el.child(mark(t.working)))
        .when(c.needs === 0 && !c.other, (el) => el.child(mark(open ? t.accent : t.muted)))
        .when(c.other > 0, (el) => el.child(div().text_color(t.dim).child(c.needs > 0 ? `+${c.other}` : String(c.other))))
        .when(ring, (el) => el.text_color(t.foreground).child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent))));
  }
}
