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


import { div, image } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, nextCommand, settings } from "herdr";
import type { Theme } from "herdr";
import { isNumber, isString, nullable, object } from "./guard.ts";
import { items, dismiss } from "./engine.ts";
import { group, age, headline, summary, where, TYPES } from "./model.ts";
import type { Item, ItemType } from "./model.ts";
import type { PermissionGoal } from "./claude.ts";
import { answer } from "./drive.ts";
import { openAsk, forget, followCommands, overviewBeat, BEAT, OVERVIEW_H } from "./open.ts";
import type { KeyContext, KeyInput } from "./open.ts";
import { dither, pip, logo, horizon, button, stop, TYPE_COLOR } from "./kit.ts";
import type { KeyRow } from "./keyhelp.ts";
import { hint as barHint, keysHint, keysView, keysKey } from "./keyhelp.ts";
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

/** The overview's props: the terminal it opens on, its most height, its overlay. */
const isOverviewProps = object({}, { terminal: nullable(isString), most: isNumber, overlay: isString });

const overviewProps = (given?: Props) => {
  const p = props() ?? given;

  return isOverviewProps(p) ? p : {};
};

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

  init(p: Props | undefined, cx: AsyncContext) {
    const input = InputState.new({ placeholder: "what it should do instead / next" });
    const handle = cx.focus_handle();

    this.want = overviewProps(p).terminal ?? null;
    this.input = input;
    this.handle = handle;
    input.on("submit", (_e, cx) => this.answerWith(cx, { amend: input.value() }));
    handle.focus();
    followCommands(cx, nextCommand, (e, cx) => this.key(e, cx), () => (this.but ? input.focus() : handle.focus()));
    cx.timer.after(400, () => (this.but ? input.focus() : handle.focus()));
    // The bell learns the drop-down is still open (open.ts overviewOpen).
    cx.timer.every(BEAT, () => overviewBeat(overviewProps().overlay));
  }

  closing() {
    forget("overview", overviewProps().overlay);
  }

  close() {
    const id = overviewProps().overlay;

    if (id !== undefined) closeOverlay(id);
  }

  list(): Item[] {
    const g = group(items());

    return TYPES.flatMap((k) => g[k]);
  }

  current(list: readonly Item[]): Item | null {
    if (this.want) {
      const it = list.find((x) => x.address === this.want);

      if (it) {
        this.sel = it.id;
        this.want = null;
      }
    }

    let it = list.find((x) => x.id === this.sel);

    if (!it && list[0]) {
      // Gone (answered): the next one in its place.
      it = list[0];
      this.sel = it.id;
      this.cursor = 0;
      this.but = null;
    }

    return it ?? null;
  }

  select(list: readonly Item[], dir: number) {
    const i = list.findIndex((x) => x.id === this.sel);
    const it = list[(i + dir + list.length) % list.length];

    if (!it) return;

    this.sel = it.id;
    this.cursor = 0;
    this.closeBut();
  }

  openBut(kind: "yes" | "no", item: Item) {
    const it = permissionOf(item);

    if (!it || !it.request.canAmend) return;

    const opts = it.request.options;
    const t = kind === "yes" ? 0 : opts.findIndex((o) => o.kind === "no");

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

    if (!it || this.busy) return;

    const o = option ?? it.request.options[this.cursor]?.n;

    if (o === undefined) return;

    const note = this.but && amend !== undefined ? amend.trim() : null;

    if (note === "") return;

    const goal: PermissionGoal = note === null ? { type: "permission", request: it.request, option: o } : { type: "permission", request: it.request, option: o, amend: note };

    this.busy = { id: it.id, text: "answering" };
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await answer(cx, it, goal, (text) => {
        this.busy = { id: it.id, text };
        cx.notify();
      }).catch((cause: unknown) => ({ ok: false, reason: String(cause) } as const));

      this.busy = null;

      if (r.ok) {
        this.closeBut();
        this.note = { id: it.id, text: "answered" };
      } else this.note = { id: it.id, text: r.reason, bad: true };

      run("notifications.refresh");
      cx.notify();
    });
  }

  key(e: KeyInput, cx: KeyContext) {
    const list = this.list();
    const it = this.current(list);
    const k = e.key;
    const m = e.modifiers;

    if (this.but) {
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

    if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
    else if (this.keysShown) handled = true; // the keys are over the requests: nothing else acts
    else if (k === "escape" || k === "q") this.close();
    else if (k === "j" || k === "]") this.select(list, 1);
    else if (k === "k" || k === "[") this.select(list, -1);
    else if ((k === "down" || k === "up") && perm) {
      const n = perm.request.options.length;

      this.cursor = (this.cursor + (k === "down" ? 1 : -1) + n) % n;
    } else if (k === "down" || k === "up") this.select(list, k === "down" ? 1 : -1);
    else if (k === "tab" && it) this.openBut(m.shift ? "no" : "yes", it);
    else if (k === "enter" && it) {
      if (perm) this.answerWith(cx);
      else if (questionsOf(it)) openAsk(it);
      else this.goTo(it);
    } else if (/^[1-9]$/.test(k) && perm) {
      const i = perm.request.options.findIndex((o) => o.n === Number(k));

      if (i >= 0) {
        this.cursor = i;
        this.answerWith(cx, { option: Number(k) });
      }
    } else if (k === "p" && it) this.peek(it);
    else if (k === "g" && it) this.goTo(it);
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
      const h = size[dim] / (settings().zoom || 1);

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

    this.seen ||= m.has("list") && m.has("bar") && (it ? m.has("top") && m.has("detail") : m.has("empty"));

    return this.seen;
  }

  /** Its height (layout px): with a request, the popup's most (all the room
   *  it has). With nothing waiting, the taller of the list and the empty note
   *  as they measured, and the key bar under both (with the ? list when
   *  open), EMPTY_H at the least, up to the most; the most until they have. */
  height(it: Item | null): number {
    const most = overviewProps().most || OVERVIEW_H;

    if (it) return most;

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

    const root = v_flex().id("notify-overview").w_full().h(this.height(it)).bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground).text_size(11)
      .when(!this.measured(it), (el) => el.opacity(0));

    // The key bar (and the ? list) spans the drop-down, under both columns.
    return (this.handle ? root.track_focus(this.handle) : root)
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
    const groups = TYPES.filter((k) => k !== "other" || g[k].length).map((k) => {
      const color = t[TYPE_COLOR[k]];
      const n = g[k].length;
      const urgent = k !== "other";

      return v_flex().flex_none()
        .child(h_flex().h(30).mt(4).px(12).gap(8).items_center().flex_none()
          .child(pip(n ? color : t.ansi0, 6))
          .child(div().flex_1().text_color(n ? t.foreground : t.dim).child(TITLE[k]))
          .child(n && urgent
            ? div().h(15).px(5).flex().items_center().bg(color).text_color(t.background).child(String(n))
            : div().text_color(t.dim).child(String(n))))
        .children(g[k].map((x) => this.entry(t, x, x.id === it?.id)));
    });

    return v_flex().w(280).h_full().flex_none().border_r_1().border_color(t.ansi0)
      .child(head)
      .child(v_flex().id("notify-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar()
        .child(v_flex().id("notify-list-body").flex_none().on_size_change(this.measure("list")).children(groups)));
  }

  entry(t: Theme, x: Item, on: boolean): Element {
    const second = x.type === "other"
      ? div().truncate().text_color(x.status === "error" ? t.ansi1 : t.working).child(summary(x))
      : div().truncate().text_color(t.dim).child(summary(x));

    return v_flex().id(`entry-${x.id}`).relative().h(42).px(12).pl(14).justify_center().gap(3).flex_none().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.sel = x.id;
        this.cursor = 0;
        this.closeBut();
        cx.notify();
      })
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(h_flex().relative().gap(7).items_center().text_color(on ? t.foreground : t.muted)
        .child(logo(x.logo, on ? t.foreground : t.muted, 12))
        .child(div().flex_1().min_w(0).truncate().child(x.name))
        .child(div().flex_none().text_color(t.dim).child(age(x.since))))
      .child(h_flex().relative().pl(19).child(second));
  }

  // ---- the request in full

  main(t: Theme, it: Item | null): Element {
    if (!it) return this.empty(t);

    const color = t[it.type === "other" ? (it.status === "error" ? "ansi1" : "working") : TYPE_COLOR[it.type]];
    const place = where(it);
    const sub = [it.program, place, it.since && `${it.type === "other" && it.status !== "blocked" ? "" : "waiting "}${age(it.since)}`].filter(Boolean).join(" · ");

    const hero = h_flex().relative().px(20).pt(18).pb(14).gap(14).items_start().flex_none()
      .child(div().relative().size(44).flex_none().flex().items_center().justify_center()
        .child(div().absolute().top(0).left(0).size_full().opacity(0.55).child(dither(color, 2)))
        .child(logo(it.logo, t.foreground, 20).relative()))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child(`${it.name} ${headline(it)}`))
        .child(div().text_color(t.dim).truncate().child(sub)))
      .child(h_flex().gap(6).flex_none()
        .child(button(t, "ov-peek", "p peek", t.muted, false, () => this.peek(it)))
        .child(button(t, "ov-go", "g go to", t.muted, false, () => this.goTo(it))));

    const body = it.type === "permission" ? this.permission(t, it) : it.type === "question" ? this.questions(t, it) : this.other(t, it);
    const note = this.note?.id === it.id && this.note.bad ? this.note.text : null;

    return v_flex().flex_1().min_w(0).h_full()
      .child(v_flex().id("notify-top").flex_none().on_size_change(this.measure("top"))
        .child(hero)
        .when(Boolean(note), (el) => el.child(h_flex().mx(20).mb(10).px(10).py(6).gap(8).items_start().border(1).border_color(t.blocked).flex_none()
          .child(div().pt(3).child(pip(t.blocked, 6)))
          .child(div().flex_1().min_w(0).text_color(t.blocked).child(`Not sent. ${note ?? ""}`)))))
      .child(v_flex().id("notify-detail").flex_1().min_h(0).overflow_y_scrollbar().pb(12)
        .child(v_flex().id("notify-detail-body").flex_none().on_size_change(this.measure("detail")).child(body)));
  }

  plate(t: Theme, kids: readonly Element[]): Element {
    return v_flex().relative().mx(20).px(12).py(10).gap(4).flex_none()
      .child(div().absolute().top(0).left(0).size_full().opacity(0.9).child(dither(t.ansi0, 1)))
      .children(kids.map((k) => k.relative()));
  }

  /** The end of the agent's screen, for anything without a structured request. */
  screenTail(t: Theme, it: Item): Element {
    if (!it.tail) return div();

    const ls = it.tail.split("\n").slice(-12);

    return v_flex().mx(20).mt(10).px(10).py(8).gap(1).border(1).border_color(t.ansi0).flex_none()
      .children(ls.map((l) => div().truncate().text_color(t.muted).child(l || " ")));
  }

  permission(t: Theme, item: Item): Element {
    const it = permissionOf(item);

    if (!it) {
      return v_flex().gap(0)
        .child(this.plate(t, [div().text_color(t.foreground).child(item.msg || "It waits for a permission.")]))
        .child(this.screenTail(t, item))
        .child(div().mx(20).mt(10).text_color(t.dim).child("Answer it in its terminal: p peeks, g goes to it."));
    }

    const r = it.request;
    const preview: string[] = [];
    const input = r.input ?? {};

    if (isString(input.content)) preview.push(...input.content.split("\n").slice(0, 6));

    if (isString(input.old_string)) preview.push(...input.old_string.split("\n").slice(0, 3).map((l) => `- ${l}`), ...(input.new_string ?? "").split("\n").slice(0, 3).map((l) => `+ ${l}`));

    const plate = this.plate(t, [
      div().text_color(t.muted).child(r.tool),
      ...(r.line || r.title).split("\n").slice(0, 4).map((l) => div().text_color(t.foreground).child(l)),
      ...preview.map((l) => div().truncate().text_color(l.startsWith("+ ") ? t.done : l.startsWith("- ") ? t.ansi1 : t.dim).child(l || " ")),
    ]);

    const busy = this.busy?.id === it.id ? this.busy.text : null;

    const opts = v_flex().mt(14).flex_none().children(r.options.map((o, i) => {
      const on = i === this.cursor;
      const c: Color = t[KIND_COLOR[o.kind]];

      return h_flex().id(`opt-${o.n}`).relative().min_h(28).py(5).px(20).gap(12).items_center().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.cursor = i;

          if (!this.but) this.answerWith(cx, { option: o.n });

          cx.notify();
        })
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(c)))
        .child(div().relative().w(14).flex_none().text_color(on ? c : t.dim).child(String(o.n)))
        .child(div().relative().flex_1().min_w(0).child(o.label))
        .child(div().relative().flex_none().text_color(t.dim).child(on ? (busy ?? (this.but ? "" : "enter")) : ""));
    }));

    return v_flex()
      .child(plate)
      .when(Boolean(r.description), (el) => el.child(div().mx(20).mt(10).text_color(t.muted).child(`“${r.description}”`)))
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
        .when(on, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(4).child(dither(color, 2))));
    };

    return v_flex().mx(20).mt(12).border(1).border_color(t.ansi0).flex_none()
      .child(h_flex().relative().h(26).items_center()
        .child(tab("yes", "yes, but…", t.done))
        .child(tab("no", "no, but…", t.blocked))
        .child(div().flex_1())
        .child(div().px(10).text_color(t.dim).child(this.but ? "enter sends · esc" : "tab · shift-tab"))
        .child(horizon(t)))
      .child(h_flex().h(30).px(10).items_center()
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();

          if (!this.but) this.openBut("yes", it);

          cx.notify();
        })
        .when(Boolean(this.but && input), (el) => (input ? el.child(Input.new(input).flex_1().h_full().text_size(11).text_color(t.foreground)) : el))
        .when(!this.but, (el) => el.child(div().text_color(t.dim).child("a line for the agent with your answer"))));
  }

  questions(t: Theme, it: Item): Element {
    const r = questionsOf(it);

    if (!r) {
      return v_flex()
        .child(this.plate(t, [div().text_color(t.foreground).child(it.msg || "It asks a question.")]))
        .child(this.screenTail(t, it))
        .child(div().mx(20).mt(10).text_color(t.dim).child(it.adapter === "claude" ? `Answer it in its terminal (p, g), or turn on ${HOOK_DOC} to answer here.` : "Answer it in its terminal: p peeks, g goes to it."));
    }

    const q = (x: QuestionRequest["questions"][number], i: number) => v_flex().mx(20).mt(i ? 12 : 0).gap(4).flex_none()
      .child(h_flex().gap(8).items_center()
        .child(div().h(15).px(4).flex().items_center().border(1).border_color(t.ansi0).text_color(t.muted).child(x.header || String(i + 1)))
        .child(div().text_color(t.dim).child(x.multiSelect ? "pick any" : "pick one")))
      .child(div().text_size(12).text_color(t.foreground).child(x.question))
      .child(div().text_color(t.dim).child([...x.options.map((o) => o.label), "other"].join(" · ")));

    return v_flex()
      .children(r.questions.map(q))
      .child(h_flex().mx(20).mt(16).gap(8).items_center()
        .child(button(t, "ov-answer", "answer ↵", t.accent, true, () => openAsk(it)))
        .child(div().text_color(t.dim).child(r.questions.length > 1 ? "one at a time, then a review sends them together" : "")));
  }

  other(t: Theme, it: Item): Element {
    const words = it.status === "error" ? (it.msg || "It stopped with an error.") : (it.msg || "It waits for your input.");

    return v_flex()
      .child(div().mx(20).text_color(it.status === "error" ? t.ansi1 : t.muted).child(words))
      .child(this.screenTail(t, it))
      .child(h_flex().mx(20).mt(14).gap(6)
        .child(button(t, "ov-goto", "go to ↵", t.accent, true, () => this.goTo(it)))
        .when(it.status === "error", (el) => el.child(button(t, "ov-dismiss", "x put away", t.muted, false, () => dismiss(it.id)))));
  }

  empty(t: Theme): Element {
    const measure = this.measure("empty");
    const sized = (size: Size, cx: Context) => measure({ width: size.width, height: size.height + 72 * (settings().zoom || 1) }, cx);

    return v_flex().flex_1().h_full().items_center().justify_center().px(40)
      .child(v_flex().id("notify-empty").flex_none().items_center().gap(10).on_size_change(sized)
        .child(image("mods/nocturne/art/fireflies.svg").size(48))
        .child(div().text_size(12).text_color(t.foreground).child("Nothing waits on you"))
        .child(div().text_color(t.dim).max_w(380).child("Permissions, questions and agents that need a look, from every agent in every space and machine, gather here."))
        .child(div().text_color(t.dim).max_w(380).child(`For Claude Code's exact requests and its questions: ${HOOK_DOC}.`)));
  }

  footer(t: Theme, it: Item | null): Element {
    const note = this.note?.id === it?.id ? this.note : null;
    // Too narrow for every hint: the least needed go first (barDrop); ? keys stays.
    const busy = it !== null && this.busy?.id === it.id ? this.busy.text : null;
    const drop = this.barDrop(Boolean(note) || busy !== null);
    const shown: string[] = [];

    const hint = (k: string, w: string) => {
      shown.push(`${k} ${w}`);

      // Left out: out of the row's flow (absolute), so it takes no gap either.
      return drop.has(`${k} ${w}`) ? div().absolute() : barHint(t, `ov-hint-${k} ${w}`, k, w).on_size_change(this.measure(`hint:${k} ${w}`, "width"));
    };

    const perm = permissionOf(it), asks = questionsOf(it);

    const bar = h_flex().id("ov-bar").relative().h(30).flex_none().px(20).gap(14).items_center().on_size_change(this.measure("bar", "width"))
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(hint("j k", "requests"))
      .when(perm !== null, (el) => el.child(hint("↑↓", "choose")).child(hint("1-9", "answer")).child(hint("⇥", "but…")))
      .when(asks !== null, (el) => el.child(hint("↵", "answer")))
      .when(it?.type === "other", (el) => el.child(hint("↵", "go to")).when(it?.status === "error", (e2) => e2.child(hint("x", "put away"))))
      .when(it !== null, (el) => el.child(hint("p", "peek")).when(it?.type !== "other", (e2) => e2.child(hint("g", "go to"))))
      .child(hint("esc", "close"))
      .child(div().flex_1())
      .when(note !== null, (el) => el.child(div().max_w(320).truncate().text_color(note?.bad ? t.blocked : t.done).child(note?.bad ? "not sent" : note?.text ?? "")))
      .when(!note && busy !== null, (el) => el.child(div().text_color(t.working).child(`${busy ?? ""}…`)))
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

    if (barW === undefined || !this.barHints) return out;

    const hints = this.barHints.filter((h) => m.has(`hint:${h}`));
    const room = barW - 40 - (m.get("keys-entry") ?? 50) - 14 - (note ? 80 + 14 : 0) - 2;
    const used = () => hints.filter((h) => !out.has(h)).reduce((a, h) => a + (m.get(`hint:${h}`) ?? 0) + 14, 0);

    for (const h of BAR_DROP) if (used() > room && hints.includes(h)) out.add(h);

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
