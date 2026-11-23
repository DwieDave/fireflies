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
import { theme, shared, keys, layout, run, props } from "herdr";
import { Array as Arr, Duration, Effect, Option, Queue, Schema, String as Str } from "effect";
import { Commands, readShared, sharedKey } from "@fireflies/kit";
import { edge, fill, icon, pick, radius } from "@fireflies/look";
import { Engine, items, openRequest, terminalsNow } from "./engine.ts";
import { counts } from "./model.ts";
import { openOverview, toggleOverview, overviewOpen, noteWindow, zoom } from "./open.ts";
import { blinking, stop, toolGround, toolHover } from "./kit.ts";
import { attach, nowMs, runtime } from "./fx.ts";
import type { NotifyFx } from "./fx.ts";

const POLL = Duration.millis(1500);

// A toast's request for one terminal opens the overview only this soon after it was made.
const FRESH_MS = 5000;

// Room after the bell, layout px: the main block's side padding, so its edge
// lines up with the panes' right edge; props.end when a block follows.
const END = 8;

/** The bell's props: the room after it (layout px). */
const readBellProps = Schema.decodeUnknownOption(Schema.Struct({ end: Schema.optionalKey(Schema.Finite) }));

const end = (): number => {
  const e = Option.getOrUndefined(Option.flatMapNullishOr(readBellProps(props()), (p) => p.end));

  return e !== undefined && e >= 0 ? e : END;
};

// Nocturne's keyboard cursor outside its tab strip (nocturne/nav.ts CURSOR).
const CHROME = sharedKey("nocturne.chrome", Schema.NullOr(Schema.Struct({ region: Schema.optionalKey(Schema.NullOr(Schema.String)) })));

/** A block of the shown layout (layout()), the fields read here. */
interface LayoutNode {
  readonly id?: string;
  readonly content?: { readonly mod?: string | null; readonly props?: { readonly role?: string | null } | null } | null;
  readonly children?: readonly LayoutNode[];
  readonly size?: { readonly px?: number | null } | null;
}

const LayoutNodeSchema: Schema.Codec<LayoutNode> = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    mod: Schema.optionalKey(Schema.NullOr(Schema.String)),
    props: Schema.optionalKey(Schema.NullOr(Schema.Struct({ role: Schema.optionalKey(Schema.NullOr(Schema.String)) }))),
  }))),
  children: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Codec<LayoutNode> => LayoutNodeSchema))),
  size: Schema.optionalKey(Schema.NullOr(Schema.Struct({ px: Schema.optionalKey(Schema.NullOr(Schema.Finite)) }))),
});

const readLayout = Schema.decodeUnknownOption(LayoutNodeSchema);

/** This bell's layout block: the one showing notifications as a bell. */
function bellNode(n: LayoutNode): LayoutNode | null {
  if (n.content?.mod === "notifications" && (n.content.props?.role ?? "bell") === "bell") return n;

  for (const c of n.children ?? []) {
    const f = bellNode(c);

    if (f !== null) return f;
  }

  return null;
}

/** Sizes the bell's block to `width` (drawn px, zoomed) plus END, when it isn't. */
function fit(width: number): void {
  const node = Option.getOrNull(Option.map(readLayout(layout()), bellNode));
  const id = node?.id ?? "";

  if (node === null || Str.isEmpty(id) || !(width > 0)) return;

  const px = Math.round(width / zoom()) + end();

  if (Math.abs((node.size?.px ?? 0) - px) >= 1) run("layout.resize", { id, px });
}

/** "⌘⇧A" for the key bound to open the overview, if any. */
function shortcut(): string {
  const k = Option.getOrElse(Option.map(Arr.findFirst(keys(), (x) => x.action === "notifications.open"), (x) => x.keys), () => "");

  return Str.toUpperCase(Str.replace(/ctrl-/g, "⌃")(Str.replace(/alt-/g, "⌥")(Str.replace(/shift-/g, "⇧")(Str.replace(/cmd-/g, "⌘")(k)))));
}

/** The bell's mark in `color` (nocturne's 9 px pixel bell, a line bell in a plain layout); `blink` for what needs the person. */
export function mark(color: Color, blink = false): Element {
  const el = svg(icon("bell", "bell")).size(pick(9, 13)).flex_none().text_color(color);

  return blink ? blinking(el) : el;
}

/** "2 permissions", "1 question", "3 to look at": what waits, in words. */
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

export default class Bell {
  engine = new Engine();
  seen = "";
  // The toast's request last opened (shared OPEN's `at`): each opens once.
  asked: number | null = null;
  // The press on the bell, and whether the overview was open then.
  press: { readonly e: MouseButtonEvent; readonly open: boolean } | null = null;
  /** A read asked for now (a status changed, notifications.refresh): the poll reads at once instead of at its next turn. */
  poke = runtime.now(Queue.sliding<void>(1));
  /** This bell's effects (the engine's poll, its commands): interrupted in closing(). */
  fx: NotifyFx | null = null;

  init(_props: Props | undefined, cx: AsyncContext) {
    const fx = attach(cx);

    this.fx = fx;

    const poke = this.poke;

    // Read, then wait for the next poll or a poke: one read at a time, ended with the copy.
    fx.run(Effect.forever(this.engine.refresh.pipe(
      Effect.tap((changed) => Effect.sync(() => {
        if (changed) cx.notify();
      })),
      Effect.andThen(Effect.race(Effect.sleep(POLL), Queue.take(poke))),
    )), { redraw: false });
    fx.run(Effect.forever(Effect.flatMap(Commands.use((x) => x.next), (raw) => Effect.sync(() => {
      const c = Str.replace(/^notifications\./, "")(raw);

      if (c === "open") this.open();
      else if (c === "refresh") this.refresh();

      cx.notify();
    }))));
  }

  /** The block closed (main.ts close()): the engine stops. */
  closing(): Promise<void> | undefined {
    return this.fx?.close();
  }

  /** notifications.open: a toast asks for one terminal's request through
   *  shared(OPEN), fresh and once: that opens (or retargets) the overview;
   *  else open toggles it. */
  open(): void {
    const o = Option.getOrNull(Option.filter(openRequest(), (x) => Str.isNonEmpty(x.terminal) && x.at !== this.asked && nowMs() - (x.at ?? 0) < FRESH_MS));

    if (o === null) toggleOverview();
    else {
      this.asked = o.at ?? null;
      openOverview(o.terminal);
    }
  }

  /** Reads again now rather than at the next poll. */
  refresh(): void {
    Queue.offerUnsafe(this.poke, undefined);
  }

  render(_cx: Context): Element {
    const t = theme();
    // A status changed: read again now rather than at the next poll.
    const sig = Arr.join(Arr.map(runtime.now(terminalsNow), (x) => `${x.address}:${x.report?.state ?? x.status ?? ""}:${x.status_ms ?? ""}`), ",");

    if (sig !== this.seen) {
      this.seen = sig;
      this.refresh();
    }

    const c = counts(items());

    const parts = Arr.filter([
      c.permission > 0 ? plural(c.permission, "permission", "permissions") : "",
      c.question > 0 ? plural(c.question, "question", "questions") : "",
      c.other > 0 ? `${c.other} to look at` : "",
    ], Str.isNonEmpty);

    const key = shortcut();
    const tip = (parts.length > 0 ? `Waiting on you: ${Arr.join(parts, " · ")}` : "Nothing waits on you") + (Str.isEmpty(key) ? "" : ` (${key})`);
    const ring = readShared(shared, CHROME, null)?.region === "bell";
    const open = overviewOpen() !== null;

    // How big the overview can be (open.ts overviewPlace); not drawing, the last size stays.
    noteWindow(Option.getOrNull(Option.liftThrowable(() => window.viewport_size())()));

    return h_flex().id("notify-bell").relative().size_full().pr(end()).items_center().justify_start().bg(t.background)
      // The toolbar's ground continues under the bell (kit.ts toolGround).
      .children(toolGround(t))
      .child(h_flex().id("bell").relative().flex_none().h(24).px(7).gap(6).items_center().text_size(11).text_color(open ? t.foreground : t.muted).cursor_pointer().rounded(radius(6))
        .on_size_change((size) => fit(size.width))
        .hover((s) => s.bg(toolHover(t)).text_color(t.foreground))
        // No tooltip while open: it would sit on the drop-down.
        .when(!open, (el) => el.tooltip(tip))
        // As the strip's buttons (nocturne/tabs.ts tool): the click goes by
        // whether the bell was lit when pressed, since the press itself
        // closes an open drop-down before the click comes.
        .on_mouse_down("left", (e, cx) => {
          stop(e, cx);
          this.press = { e, open };
        })
        .on_click(() => toggleOverview({ press: this.press?.e ?? null, wasOpen: this.press?.open === true }))
        // Open: the strip's open look, a dithered band and a blue foot (a plain layout: the band flat).
        .when(open, (el) => el.child(fill(edge(t), 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
        .when(c.needs > 0, (el) => el
          .child(mark(t.blocked, true))
          .child(div().h(15).px(4).flex().items_center().rounded(radius(4)).bg(t.blocked).text_color(t.background).child(String(c.needs))))
        .when(c.needs === 0 && c.other > 0, (el) => el.child(mark(t.working)))
        .when(c.needs === 0 && c.other === 0, (el) => el.child(mark(open ? t.accent : t.muted)))
        .when(c.other > 0, (el) => el.child(div().text_color(t.dim).child(c.needs > 0 ? `+${c.other}` : String(c.other))))
        .when(ring, (el) => el.text_color(t.foreground).child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent).rounded(radius(6)))));
  }
}
