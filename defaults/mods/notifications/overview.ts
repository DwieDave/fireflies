// The overview: every request, grouped down the left (permissions,
// questions, other), the selected one in full on the right. A drop-down
// under the bell, or centered from a key (open.ts). With a request it is the popup's most
// (props.most: the room below the strip, up to open.ts OVERVIEW_H), so the
// list and the request have room; with nothing waiting, as tall as its note
// and EMPTY_H at the least.
// It sets its own height: a popup is as tall as its content, and a scroll
// area has none of its own, so without that the list and the request would
// be nothing. It measures its parts (on_size_change) for the empty note and
// the key bar.
//
//   j / k, [ / ]      the next / previous request
//   up / down         the permission's options (as its terminal lists them)
//   enter, 1-9        answer with that option; a question block: answer it
//                     (the question dialog); needs a look: go to the agent
//   tab / shift-tab   "yes, but…" / "no, but…": a line that goes with the
//                     answer, as the agent's next instruction (enter sends)
//   p / g             peek at its terminal / go to it
//   x                 put an error away
//   up / down         on a question or a needs-a-look: the next / previous request
//   esc q             close (from the note's line: back to the options)
//   ?                 these keys, over the requests (? or esc hides them)


import { div, svg } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Duration, Effect, Match, Number as Num, Option, Schema, String as Str } from "effect";
import { boxed, edge, frameBox, icon, lit, radius, rule } from "@fireflies/look";
import { items, dismiss } from "./engine.ts";
import { group, age, headline, summary, where, TYPES } from "./model.ts";
import type { Item, ItemType } from "./model.ts";
import type { PermissionGoal } from "./claude.ts";
import { answer } from "./drive.ts";
import { openAsk, forget, followCommands, noteOverview, noteWindow, overviewBeat, overviewPlace, zoom, BEAT } from "./open.ts";
import type { KeyContext, KeyInput } from "./open.ts";
import { fill, pip, logo, horizon, button, stop, TYPE_COLOR } from "./kit.ts";
import { attach, nowMs } from "./fx.ts";
import type { NotifyFx } from "./fx.ts";
import type { KeyRow } from "@fireflies/keyhelp";
import { hint as barHint, keysHint, keysView, keysKey } from "@fireflies/keyhelp";
import type { OptionKind, PermissionRequest, QuestionRequest } from "./request.ts";

// How tall it is at the least with nothing waiting (layout px, up to the
// popup's most): a center, not a sliver around its note.
export const EMPTY_H = 560;

/** What ? lists, ? keys last. */
export const KEYS: readonly KeyRow[] = [["j k [ ]", "requests"], ["↑↓", "options / requests"], ["↵ 1-9", "answer"], ["⇥ ⇧⇥", "yes, but… / no, but…"],
  ["p", "peek"], ["g", "go to"], ["x", "put an error away"], ["esc q", "close"], ["?", "keys"]];

// The key bar's hints in the order a narrow drop-down leaves them out (the ?
// list has them all); esc close goes last.
const BAR_DROP = ["⇥ but…", "g go to", "p peek", "x put away", "↑↓ choose", "j k requests", "1-9 answer", "↵ answer", "↵ go to", "esc close"];

const TITLE = { permission: "Permissions", question: "Questions", other: "Needs a look" } as const satisfies { readonly [K in ItemType]: string };
const KIND_COLOR = { yes: "done", always: "accent", auto: "working", no: "blocked" } as const satisfies { readonly [K in OptionKind]: keyof Theme };
const HOOK_DOC = "Claude Code's hook: see ~/.config/herdr-app/AGENTS.md, Notifications";

/** `text`, or `otherwise` when it says nothing. */
const orSay = (text: string, otherwise: string): string => (Str.isEmpty(text) ? otherwise : text);

/** The overview's props: the terminal it opens on, its most height, its overlay. */
const OverviewPropsSchema = Schema.Struct({ terminal: Schema.optionalKey(Schema.NullOr(Schema.String)), most: Schema.optionalKey(Schema.Finite), overlay: Schema.optionalKey(Schema.String) });

const readOverviewProps = Schema.decodeUnknownOption(OverviewPropsSchema);

const overviewProps = (given?: Props): typeof OverviewPropsSchema.Type => Option.getOrElse(readOverviewProps(props() ?? given), () => ({}));

/** How long after opening it takes the keyboard (its window is up by then). */
const FOCUS_LATER = "400 millis";

/** An item that is a permission this mod can answer, with its request. */
type Answerable = Item & { readonly request: PermissionRequest };

const permissionOf = (it: Item | null): Answerable | null => (it?.type === "permission" && it.answerable && it.request?.type === "permission" ? { ...it, request: it.request } : null);

/** An item that is a block of questions this mod can answer, with its request. */
const questionsOf = (it: Item | null): QuestionRequest | null => (it?.type === "question" && it.answerable && it.request?.type === "question" ? it.request : null);

/** answerWith()'s options: the option to answer with, the note to send with it. */
interface AnswerOptions {
  readonly option?: number;
  readonly amend?: string;
}

export default class Overview {
  want: string | null = null; // open on this terminal's request
  sel: string | null = null; // the selected item's id
  cursor = 0;
  but: "yes" | "no" | null = null; // the note's line is open
  busy: { readonly id: string; readonly text: string } | null = null;
  note: { readonly id: string; readonly text: string; readonly bad?: boolean } | null = null;
  sizes = new Map<string, number>(); // measured parts, layout px (measure)
  input: InputState | null = null;
  handle: FocusHandle | null = null;
  keysShown = false;
  seen = false;
  barHints: string[] | null = null;
  fx: NotifyFx | null = null;
  /** The time this render draws at (ms): one clock read per render, so every age agrees. */
  now = 0;

  init(p: Props | undefined, cx: AsyncContext) {
    const fx = attach(cx);

    const input = InputState.new({ placeholder: "what it should do instead / next" });
    const handle = cx.focus_handle();
    const focus = () => (this.but === null ? handle.focus() : input.focus());

    this.fx = fx;
    this.want = overviewProps(p).terminal ?? null;
    noteOverview(overviewProps(p).overlay);
    this.input = input;
    this.handle = handle;
    input.on("submit", (_e, cx) => this.answerWith(cx, { amend: input.value() }));
    handle.focus();
    fx.run(followCommands((e, cx) => this.key(e, cx), focus, () => cx.notify()));
    fx.run(Effect.andThen(Effect.sleep(FOCUS_LATER), Effect.sync(focus)), { redraw: false });
    // The bell learns the drop-down is still open (open.ts overviewOpen), every BEAT while it is.
    fx.run(Effect.forever(Effect.andThen(Effect.sync(() => overviewBeat(overviewProps().overlay)), Effect.sleep(Duration.millis(BEAT)))), { redraw: false });
  }

  /** The overlay closed (main.ts close()): no longer ours to close, its effects end. */
  closing(): Promise<void> | undefined {
    forget("overview", overviewProps().overlay);

    return this.fx?.close();
  }

  close() {
    const id = overviewProps().overlay;

    if (id !== undefined) closeOverlay(id);
  }

  list(): Item[] {
    const g = group(items());

    return Arr.flatMap(TYPES, (k) => g[k]);
  }

  current(list: readonly Item[]): Item | null {
    const want = this.want;

    if (want !== null) {
      Option.map(Arr.findFirst(list, (x) => x.address === want), (it) => {
        this.sel = it.id;
        this.want = null;
      });
    }

    const found = Option.getOrNull(Arr.findFirst(list, (x) => x.id === this.sel));
    const first = list[0];

    if (found === null && first !== undefined) {
      // Gone (answered): the next one in its place.
      this.sel = first.id;
      this.cursor = 0;
      this.but = null;

      return first;
    }

    return found;
  }

  select(list: readonly Item[], dir: number) {
    const i = Option.getOrElse(Arr.findFirstIndex(list, (x) => x.id === this.sel), () => -1);
    const it = list[(i + dir + list.length) % list.length];

    if (it === undefined) return;

    this.sel = it.id;
    this.cursor = 0;
    this.closeBut();
  }

  openBut(kind: "yes" | "no", item: Item) {
    const it = permissionOf(item);

    if (it === null || !it.request.canAmend) return;

    const opts = it.request.options;
    const t = kind === "yes" ? 0 : Option.getOrElse(Arr.findFirstIndex(opts, (o) => o.kind === "no"), () => -1);

    if (t < 0) return;

    this.cursor = t;
    this.but = kind;
    this.input?.focus();
  }

  closeBut() {
    this.but = null;
    this.input?.set_value("");
    this.handle?.focus();
  }

  peek(it: Item) {
    this.close();
    run("terminal.peek", { terminal: it.address });
  }

  goTo(it: Item) {
    this.close();
    run("agent.focus", { terminal: it.address });
  }

  /** Answers the selected permission: the option under the cursor, with the note when the line is open. */
  answerWith(cx: KeyContext, { option, amend }: AnswerOptions = {}) {
    const it = permissionOf(this.current(this.list()));

    if (it === null || this.busy !== null) return;

    const o = option ?? it.request.options[this.cursor]?.n;

    if (o === undefined) return;

    const note = this.but !== null && amend !== undefined ? Str.trim(amend) : null;

    if (note === "") return;

    const goal: PermissionGoal = note === null ? { type: "permission", request: it.request, option: o } : { type: "permission", request: it.request, option: o, amend: note };

    this.busy = { id: it.id, text: "answering" };
    this.note = null;
    cx.notify();
    this.fx?.run(answer(it, goal, (text) => {
      this.busy = { id: it.id, text };
      cx.notify();
    }).pipe(
      Effect.tap((r) => Effect.sync(() => {
        if (r.ok) {
          this.closeBut();
          this.note = { id: it.id, text: "answered" };
        } else this.note = { id: it.id, text: r.reason, bad: true };

        run("notifications.refresh");
      })),
      // Whatever ends it (an answer, a failure, the overview closing), it isn't answering any more.
      Effect.ensuring(Effect.sync(() => {
        this.busy = null;
      })),
    ), { key: "answer" });
  }

  key(e: KeyInput, cx: KeyContext) {
    const list = this.list();
    const it = this.current(list);
    const k = e.key;
    const m = e.modifiers;

    if (this.but !== null) {
      if (k === "escape") {
        this.closeBut();
        cx.stop_propagation();
        cx.notify();
      }

      return; // the input has the rest
    }

    if (m.control || m.platform || m.alt) return;

    let handled = true;
    const help = keysKey(e, this.keysShown);
    const perm = permissionOf(it);

    if (help !== null) this.keysShown = help === "toggle" ? !this.keysShown : false;
    else if (this.keysShown) handled = true; // the keys are over the requests: nothing else acts
    else if (k === "escape" || k === "q") this.close();
    else if (k === "j" || k === "]") this.select(list, 1);
    else if (k === "k" || k === "[") this.select(list, -1);
    else if ((k === "down" || k === "up") && perm !== null) {
      const n = perm.request.options.length;

      this.cursor = (this.cursor + (k === "down" ? 1 : -1) + n) % n;
    } else if (k === "down" || k === "up") this.select(list, k === "down" ? 1 : -1);
    else if (k === "tab" && it !== null) this.openBut(m.shift ? "no" : "yes", it);
    else if (k === "enter" && it !== null) {
      if (perm !== null) this.answerWith(cx);
      else if (questionsOf(it) === null) this.goTo(it);
      else openAsk(it);
    } else if (/^[1-9]$/.test(k) && perm !== null) {
      Option.map(Arr.findFirstIndex(perm.request.options, (o) => o.n === Number(k)), (i) => {
        this.cursor = i;
        this.answerWith(cx, { option: Number(k) });
      });
    } else if (k === "p" && it !== null) this.peek(it);
    else if (k === "g" && it !== null) this.goTo(it);
    else if (k === "x" && it?.type === "other" && it.status === "error") dismiss(it.id);
    else handled = false;

    if (handled) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  /** A part's height (or `dim`) as drawn, kept in layout px; a change draws again. */
  measure(key: string, dim: "height" | "width" = "height") {
    return (size: Size, cx: Context) => {
      const h = size[dim] / zoom();

      if (Math.abs((this.sizes.get(key) ?? -1) - h) < 0.5) return;

      this.sizes.set(key, h);
      cx.notify();
    };
  }

  /** Whether every part its height and its key bar depend on has measured
   *  (the list, the request or the empty note, the bar). Until then it draws
   *  unseen: its first seen frame has its real height and bar, not the
   *  popup's most for a frame and then its own (a jump as it opens). Once
   *  seen it stays seen: a request coming in resizes it in view. */
  measured(it: Item | null): boolean {
    const m = this.sizes;

    this.seen ||= m.has("list") && m.has("bar") && (it === null ? m.has("empty") : m.has("top") && m.has("detail"));

    return this.seen;
  }

  /** Its height (layout px): with a request, the popup's most (all the room
   *  it has). With nothing waiting, the taller of the list and the empty note
   *  as they measured, and the key bar under both (with the ? list when
   *  open), EMPTY_H at the least, up to the most; the most until they have. */
  height(it: Item | null): number {
    // Opened by mod.open (no most given): as tall as a centered one opened by a key.
    const given = overviewProps().most ?? 0;
    const most = given > 0 ? given : overviewPlace(null).height;

    if (it !== null) return most;

    const list = this.sizes.get("list"), main = this.sizes.get("empty");

    if (list === undefined || main === undefined) return most;

    const bar = 30;
    // With its keys open, tall enough for them (keyhelp.ts: a 26 px head, 20 px rows).
    const keys = this.keysShown ? 26 + 22 + KEYS.length * 20 : 0;

    return Math.min(most, Math.max(EMPTY_H, Math.ceil(Math.max(34 + list + 8, main, keys) + bar)));
  }

  render(): Element {
    const t = theme();
    const list = this.list();
    const it = this.current(list);

    this.now = nowMs();
    // The window's size, for the most a mod.open overview takes (none while not drawing: the last stays).
    noteWindow(Option.getOrNull(Option.liftThrowable(() => window.viewport_size())()));

    const root = frameBox(t, v_flex().id("notify-overview").w_full().h(this.height(it)).bg(t.background).text_color(t.foreground).text_size(11))
      .when(!this.measured(it), (el) => el.opacity(0));

    // The key bar (and the ? list) spans the drop-down, under both columns.
    return (this.handle === null ? root : root.track_focus(this.handle))
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().relative().flex_1().min_h(0)
        .child(this.side(t, list, it))
        .child(this.main(t, it))
        .when(this.keysShown, (el) => el.child(this.keysStrip(t))))
      .child(this.footer(t, it));
  }

  // ---- the list

  side(t: Theme, list: readonly Item[], it: Item | null): Element {
    const g = group(list);

    const head = h_flex().relative().h(34).flex_none().px(12).items_center()
      .child(div().flex_1().text_size(12).child("Waiting on you"))
      .child(div().text_color(t.dim).child("esc"))
      .child(horizon(t));

    // "Needs a look" only when something does: no empty header.
    const groups = Arr.map(Arr.filter(TYPES, (k) => k !== "other" || g[k].length > 0), (k) => {
      const color = t[TYPE_COLOR[k]];
      const n = g[k].length;
      const urgent = k !== "other";

      return v_flex().flex_none()
        .child(h_flex().h(30).mt(4).px(12).gap(8).items_center().flex_none()
          .child(pip(n > 0 ? color : edge(t), 6))
          .child(div().flex_1().text_color(n > 0 ? t.foreground : t.dim).child(TITLE[k]))
          .child(n > 0 && urgent
            ? div().h(15).px(5).flex().items_center().rounded(radius(4)).bg(color).text_color(t.background).child(String(n))
            : div().text_color(t.dim).child(String(n))))
        .children(Arr.map(g[k], (x) => this.entry(t, x, x.id === it?.id)));
    });

    return v_flex().w(280).h_full().flex_none().border_r_1().border_color(edge(t))
      .child(head)
      .child(v_flex().id("notify-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar()
        .child(v_flex().id("notify-list-body").flex_none().on_size_change(this.measure("list")).children(groups)));
  }

  entry(t: Theme, x: Item, on: boolean): Element {
    const second = x.type === "other"
      ? div().truncate().text_color(x.status === "error" ? t.ansi1 : t.working).child(summary(x))
      : div().truncate().text_color(t.dim).child(summary(x));

    const row = v_flex().id(`entry-${x.id}`).relative().h(42).px(12).pl(14).justify_center().gap(3).flex_none().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.sel = x.id;
        this.cursor = 0;
        this.closeBut();
        cx.notify();
      });

    return (on ? lit(t, row, true) : row)
      .child(h_flex().relative().gap(7).items_center().text_color(on ? t.foreground : t.muted)
        .child(logo(x.logo, on ? t.foreground : t.muted, 12))
        .child(div().flex_1().min_w(0).truncate().child(x.name))
        .child(div().flex_none().text_color(t.dim).child(age(x.since, this.now))))
      .child(h_flex().relative().pl(19).child(second));
  }

  // ---- the request in full

  main(t: Theme, it: Item | null): Element {
    if (it === null) return this.empty(t);

    const color = t[it.type === "other" ? (it.status === "error" ? "ansi1" : "working") : TYPE_COLOR[it.type]];
    const place = where(it);
    const waited = it.since === 0 ? "" : `${it.type === "other" && it.status !== "blocked" ? "" : "waiting "}${age(it.since, this.now)}`;
    const sub = Arr.join(Arr.filter([it.program, place, waited], Str.isNonEmpty), " · ");

    const hero = h_flex().relative().px(20).pt(18).pb(14).gap(14).items_start().flex_none()
      .child(div().relative().size(44).flex_none().flex().items_center().justify_center()
        .child(div().absolute().top(0).left(0).size_full().opacity(0.55).child(fill(color, 2)))
        .child(logo(it.logo, t.foreground, 20).relative()))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child(`${it.name} ${headline(it)}`))
        .child(div().text_color(t.dim).truncate().child(sub)))
      .child(h_flex().gap(6).flex_none()
        .child(button(t, "ov-peek", "p peek", t.muted, false, () => this.peek(it)))
        .child(button(t, "ov-go", "g go to", t.muted, false, () => this.goTo(it))));

    const body = Match.value(it.type).pipe(
      Match.when("permission", () => this.permission(t, it)),
      Match.when("question", () => this.questions(t, it)),
      Match.orElse(() => this.other(t, it)),
    );

    const note = this.note?.id === it.id && this.note.bad === true ? this.note.text : null;

    return v_flex().flex_1().min_w(0).h_full()
      .child(v_flex().id("notify-top").flex_none().on_size_change(this.measure("top"))
        .child(hero)
        .when(note !== null, (el) => el.child(boxed(t, h_flex().mx(20).mb(10).px(10).py(6).gap(8).items_start(), t.blocked).flex_none()
          .child(div().pt(3).child(pip(t.blocked, 6)))
          .child(div().flex_1().min_w(0).text_color(t.blocked).child(`Not sent. ${note ?? ""}`)))))
      .child(v_flex().id("notify-detail").flex_1().min_h(0).overflow_y_scrollbar().pb(12)
        .child(v_flex().id("notify-detail-body").flex_none().on_size_change(this.measure("detail")).child(body)));
  }

  plate(t: Theme, kids: readonly Element[]): Element {
    return v_flex().relative().mx(20).px(12).py(10).gap(4).flex_none()
      .child(div().absolute().top(0).left(0).size_full().opacity(0.9).child(fill(edge(t), 1)))
      .children(Arr.map(kids, (k) => k.relative()));
  }

  /** The end of the agent's screen, for anything without a structured request. */
  screenTail(t: Theme, it: Item): Element {
    if (it.tail === null || Str.isEmpty(it.tail)) return div();

    const ls = Arr.takeRight(Str.split(it.tail, "\n"), 12);

    return boxed(t, v_flex().mx(20).mt(10).px(10).py(8).gap(1)).flex_none()
      .children(Arr.map(ls, (l) => div().truncate().text_color(t.muted).child(Str.isEmpty(l) ? " " : l)));
  }

  permission(t: Theme, item: Item): Element {
    const it = permissionOf(item);

    if (it === null) {
      return v_flex().gap(0)
        .child(this.plate(t, [div().text_color(t.foreground).child(orSay(item.msg, "It waits for a permission."))]))
        .child(this.screenTail(t, item))
        .child(div().mx(20).mt(10).text_color(t.dim).child("Answer it in its terminal: p peeks, g goes to it."));
    }

    const r = it.request;
    const preview: string[] = [];
    const input = r.input ?? {};
    const head = (text: string, n: number): string[] => Arr.take(Str.split(text, "\n"), n);

    if (input.content !== undefined && input.content !== null) preview.push(...head(input.content, 6));

    if (input.old_string !== undefined && input.old_string !== null) preview.push(...Arr.map(head(input.old_string, 3), (l) => `- ${l}`), ...Arr.map(head(input.new_string ?? "", 3), (l) => `+ ${l}`));

    const plate = this.plate(t, [
      div().text_color(t.muted).child(r.tool),
      ...Arr.map(head(orSay(r.line, r.title), 4), (l) => div().text_color(t.foreground).child(l)),
      ...Arr.map(preview, (l) => div().truncate().text_color(Str.startsWith("+ ")(l) ? t.done : Str.startsWith("- ")(l) ? t.ansi1 : t.dim).child(Str.isEmpty(l) ? " " : l)),
    ]);

    const busy = this.busy?.id === it.id ? this.busy.text : null;

    const opts = v_flex().mt(14).flex_none().children(Arr.map(r.options, (o, i) => {
      const on = i === this.cursor;
      const c: Color = t[KIND_COLOR[o.kind]];

      const row = h_flex().id(`opt-${o.n}`).relative().min_h(28).py(5).px(20).gap(12).items_center().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.cursor = i;

          if (this.but === null) this.answerWith(cx, { option: o.n });

          cx.notify();
        });

      return (on ? lit(t, row, true, { mark: c }) : row)
        .child(div().relative().w(14).flex_none().text_color(on ? c : t.dim).child(String(o.n)))
        .child(div().relative().flex_1().min_w(0).child(o.label))
        .child(div().relative().flex_none().text_color(t.dim).child(on ? (busy ?? (this.but === null ? "enter" : "")) : ""));
    }));

    return v_flex()
      .child(plate)
      .when(Str.isNonEmpty(r.description), (el) => el.child(div().mx(20).mt(10).text_color(t.muted).child(`“${r.description}”`)))
      .child(opts)
      .when(r.canAmend, (el) => el.child(this.butBox(t, it)));
  }

  butBox(t: Theme, it: Item): Element {
    const input = this.input;

    const tab = (kind: "yes" | "no", label: string, color: Color) => {
      const on = this.but === kind;

      return h_flex().id(`but-${kind}`).relative().h(26).px(10).items_center().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          if (on) this.closeBut();
          else this.openBut(kind, it);

          cx.notify();
        })
        .child(div().relative().child(label))
        .when(on, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(4).child(fill(color, 2))));
    };

    return boxed(t, v_flex().mx(20).mt(12)).flex_none()
      .child(h_flex().relative().h(26).items_center()
        .child(tab("yes", "yes, but…", t.done))
        .child(tab("no", "no, but…", t.blocked))
        .child(div().flex_1())
        .child(div().px(10).text_color(t.dim).child(this.but === null ? "tab · shift-tab" : "enter sends · esc"))
        .child(horizon(t)))
      .child(h_flex().h(30).px(10).items_center()
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();

          if (this.but === null) this.openBut("yes", it);

          cx.notify();
        })
        .when(this.but !== null && input !== null, (el) => (input === null ? el : el.child(Input.new(input).flex_1().h_full().text_size(11).text_color(t.foreground))))
        .when(this.but === null, (el) => el.child(div().text_color(t.dim).child("a line for the agent with your answer"))));
  }

  questions(t: Theme, it: Item): Element {
    const r = questionsOf(it);

    if (r === null) {
      return v_flex()
        .child(this.plate(t, [div().text_color(t.foreground).child(orSay(it.msg, "It asks a question."))]))
        .child(this.screenTail(t, it))
        .child(div().mx(20).mt(10).text_color(t.dim).child(it.adapter === "claude" ? `Answer it in its terminal (p, g), or turn on ${HOOK_DOC} to answer here.` : "Answer it in its terminal: p peeks, g goes to it."));
    }

    const q = (x: QuestionRequest["questions"][number], i: number) => v_flex().mx(20).mt(i > 0 ? 12 : 0).gap(4).flex_none()
      .child(h_flex().gap(8).items_center()
        .child(boxed(t, div().h(15).px(4).flex().items_center()).text_color(t.muted).child(orSay(x.header, String(i + 1))))
        .child(div().text_color(t.dim).child(x.multiSelect ? "pick any" : "pick one")))
      .child(div().text_size(12).text_color(t.foreground).child(x.question))
      .child(div().text_color(t.dim).child(Arr.join([...Arr.map(x.options, (o) => o.label), "other"], " · ")));

    return v_flex()
      .children(Arr.map(r.questions, q))
      .child(h_flex().mx(20).mt(16).gap(8).items_center()
        .child(button(t, "ov-answer", "answer ↵", t.accent, true, () => openAsk(it)))
        .child(div().text_color(t.dim).child(r.questions.length > 1 ? "one at a time, then a review sends them together" : "")));
  }

  other(t: Theme, it: Item): Element {
    const words = orSay(it.msg, it.status === "error" ? "It stopped with an error." : "It waits for your input.");

    return v_flex()
      .child(div().mx(20).text_color(it.status === "error" ? t.ansi1 : t.muted).child(words))
      .child(this.screenTail(t, it))
      .child(h_flex().mx(20).mt(14).gap(6)
        .child(button(t, "ov-goto", "go to ↵", t.accent, true, () => this.goTo(it)))
        .when(it.status === "error", (el) => el.child(button(t, "ov-dismiss", "x put away", t.muted, false, () => dismiss(it.id)))));
  }

  empty(t: Theme): Element {
    const measure = this.measure("empty");
    const sized = (size: Size, cx: Context) => measure({ width: size.width, height: size.height + 72 * zoom() }, cx);
    const art = icon("fireflies", null);

    return v_flex().flex_1().h_full().items_center().justify_center().px(40)
      .child(v_flex().id("notify-empty").flex_none().items_center().gap(10).on_size_change(sized)
        .when(art !== null, (el) => el.child(svg(art ?? "").size(48)))
        .child(div().text_size(12).text_color(t.foreground).child("Nothing waits on you"))
        .child(div().text_color(t.dim).max_w(380).child("Permissions, questions and agents that need a look, from every agent in every space and machine, gather here."))
        .child(div().text_color(t.dim).max_w(380).child(`For Claude Code's exact requests and its questions: ${HOOK_DOC}.`)));
  }

  footer(t: Theme, it: Item | null): Element {
    const note = this.note?.id === it?.id ? this.note : null;
    // Too narrow for every hint: the least needed go first (barDrop); ? keys stays.
    const busy = it !== null && this.busy?.id === it.id ? this.busy.text : null;
    const drop = this.barDrop(note !== null || busy !== null);
    const shown: string[] = [];

    const hint = (k: string, w: string) => {
      shown.push(`${k} ${w}`);

      // Left out: out of the row's flow (absolute), so it takes no gap either.
      return drop.has(`${k} ${w}`) ? div().absolute() : barHint(t, `ov-hint-${k} ${w}`, k, w).on_size_change(this.measure(`hint:${k} ${w}`, "width"));
    };

    const perm = permissionOf(it), asks = questionsOf(it);

    const bar = h_flex().id("ov-bar").relative().h(30).flex_none().px(20).gap(14).items_center().on_size_change(this.measure("bar", "width"))
      .child(rule(t, "top"))
      .child(hint("j k", "requests"))
      .when(perm !== null, (el) => el.child(hint("↑↓", "choose")).child(hint("1-9", "answer")).child(hint("⇥", "but…")))
      .when(asks !== null, (el) => el.child(hint("↵", "answer")))
      .when(it?.type === "other", (el) => el.child(hint("↵", "go to")).when(it?.status === "error", (e2) => e2.child(hint("x", "put away"))))
      .when(it !== null, (el) => el.child(hint("p", "peek")).when(it?.type !== "other", (e2) => e2.child(hint("g", "go to"))))
      .child(hint("esc", "close"))
      .child(div().flex_1())
      .when(note !== null, (el) => el.child(div().max_w(320).truncate().text_color(note?.bad === true ? t.blocked : t.done).child(note?.bad === true ? "not sent" : note?.text ?? "")))
      .when(note === null && busy !== null, (el) => el.child(div().text_color(t.working).child(`${busy ?? ""}…`)))
      // ? keys: the bar's last item, after the note.
      .child(keysHint(t, "ov-keys", this.keysShown, () => {
        this.keysShown = !this.keysShown;
      }).on_size_change(this.measure("keys-entry", "width")));

    this.barHints = shown;

    return bar;
  }

  /** The hints left out of the key bar so the rest fits its width, as they
   *  measured last (layout px): the least needed first (BAR_DROP). `note`: a
   *  note or a busy word sits before ? keys. */
  barDrop(note: boolean): Set<string> {
    const m = this.sizes;
    const out = new Set<string>();
    const barW = m.get("bar");

    if (barW === undefined || this.barHints === null) return out;

    const hints = Arr.filter(this.barHints, (h) => m.has(`hint:${h}`));
    const room = barW - 40 - (m.get("keys-entry") ?? 50) - 14 - (note ? 80 + 14 : 0) - 2;
    const used = () => Num.sumAll(Arr.map(Arr.filter(hints, (h) => !out.has(h)), (h) => (m.get(`hint:${h}`) ?? 0) + 14));

    for (const h of BAR_DROP) if (used() > room && Arr.contains(hints, h)) out.add(h);

    return out;
  }

  /** `?`: every key, over the requests (keyhelp.ts). */
  keysStrip(t: Theme): Element {
    return keysView(t, {
      id: "notify-keys", title: "waiting on you", list: KEYS, close: () => {
        this.keysShown = false;
      },
    });
  }
}
