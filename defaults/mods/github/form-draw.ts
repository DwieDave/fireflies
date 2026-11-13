// A GitHub form drawn (form.ts places it): the fields at their places in the
// column (form-layout.ts) over the footer and its buttons, the review of the
// commands, and the open list under its field.

import { div } from "gpui-kit";
import type { Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex, Input, Textarea } from "gpui-base";
import type { Theme } from "herdr";
import { dither, stop, band, sweep, empty, unzoom } from "./kit.ts";
import { submitKey } from "./form-keys.ts";
import type { Cell, Layout, Row as LayoutRow } from "./form-layout.ts";
import { cellOf, pickerHeight, pickerPlace, LABEL, LABEL_GAP, CONTROL, ERROR, TOGGLE, JOIN, FOOTER, PICK_HEAD, PICK_ROW, PICK_ROW_SUB } from "./form-layout.ts";
import type { Choice, Field } from "./form-fields.ts";
import { isText, isList } from "./form-fields.ts";
import type { Form, PickerSpot } from "./form.ts";

/** The fields (scrolled when they don't fit) over the footer with the buttons. */
export function body<R>(f: Form<R>, t: Theme): Element {
  const lay = f.lay();
  const parts: Element[] = [];

  for (const r of lay.rows) {
    if (r.kind === "section") {
      parts.push(section(t, r, lay));

      continue;
    }

    for (const c of r.cells) parts.push(fieldCell(f, t, c, lay));

    const [a] = r.cells;

    if (r.join && r.cells.length === 2 && a) {
      parts.push(div().absolute().left(a.x + a.w).top(r.y + LABEL + LABEL_GAP).w(JOIN).h(CONTROL).flex().items_center().justify_center()
        .text_size(12).text_color(t.dim).child(r.join));
    }
  }

  const view = div().id("form-view").relative().flex_1().min_h(0).overflow_hidden()
    .on_size_change((s, cx) => {
      const h = unzoom(s.height), w = unzoom(s.width);

      if (Math.abs(h - f.viewH) > 1 || Math.abs(w - f.width) > 1) {
        f.viewH = h;
        f.width = w;
        // Scrolled before the panel's size was known: keep the focused stop in view, scrolling no further than the form needs.
        f.scrollY = 0;
        f.reveal();
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      f.scrollY = Math.max(0, Math.min(Math.max(0, f.lay().height - f.viewH), f.scrollY - unzoom(e.delta.y)));
      cx.notify();
    })
    .child(div().id("form-fields").absolute().left(0).right(0).top(-f.scrollY).h(lay.height).children(parts))
    .when(Boolean(f.picker), (el) => el.children(pickerBox(f, t, lay)));

  const foot = footer(f, t, lay.pad, f.spec.summary?.() ?? "", [
    button(t, "form-review", "Review", submitKey(f.stops(), f.at, f.mac), true, (cx) => f.review(cx), false, f.isAt("form-review")),
    button(t, "form-cancel", "Cancel", "esc", false, () => f.cancel(), false, f.isAt("form-cancel")),
  ]);

  return v_flex().size_full().child(view).child(foot);
}

/** The bar on the panel's bottom edge: a dithered horizon (a running sweep while sending), a line of summary, the buttons. */
function footer<R>(f: Form<R>, t: Theme, pad: number, summary: string, buttons: Element[]): Element {
  const sending = f.stage === "sending";

  return h_flex().id("form-foot").relative().h(FOOTER).flex_none().px(pad).gap(8).items_center()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(sending ? t.working : t.ansi0, 1)))
    .when(sending, (el) => el.child(div().absolute().left(0).right(0).top(0).h(2).overflow_hidden().child(sweep(t, t.working, f.width))))
    .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(summary))
    .children(buttons);
}

/** A section's eyebrow over a dithered rule. */
function section(t: Theme, r: LayoutRow<Field> & { readonly kind: "section" }, lay: Layout<Field>): Element {
  return h_flex().absolute().left(lay.pad).top(r.y).w(lay.inner).h(r.h).gap(8).items_center()
    .child(div().flex_none().text_size(10).text_color(t.ansi8).child(r.title.toUpperCase()))
    .child(div().relative().flex_1().h(1).child(dither(t.ansi0, 1)));
}

/** One field at its place in the column: its label line (label, *, hint), the control, what's wrong under it. */
function fieldCell<R>(form: Form<R>, t: Theme, c: Cell<Field>, lay: Layout<Field>): Element {
  const f = c.field, i = c.index;
  const on = i === form.at && form.stage === "edit";
  const err = form.errors.get(f.id) ?? "";
  const edge = err ? t.blocked : on ? t.accent : t.ansi0;

  const click = (_e: MouseButtonEvent, cx: Context) => {
    cx.stop_propagation();
    form.at = i;

    if (f.kind === "toggle") form.flip(f, cx);
    else if (isList(f)) form.openPicker(f, "", cx);

    if (!form.picker) form.focusField(cx);

    cx.notify();
  };

  const errLine = () => div().h(ERROR).pt(3).text_size(10).text_color(t.blocked).truncate().child(err);
  const cell = v_flex().id(`frow-${f.id}`).absolute().left(c.x).top(c.y).w(c.w);

  if (f.kind === "toggle") {
    return cell
      .child(h_flex().id(`ff-${f.id}`).relative().h(TOGGLE).gap(8).items_center().cursor_pointer().on_mouse_down("left", click)
        .child(div().relative().size(12).flex_none().border(1).border_color(on ? t.accent : f.value ? t.foreground : t.ansi8)
          .when(f.value, (el) => el.child(div().absolute().top(2).left(2).size(6).bg(on ? t.accent : t.foreground))))
        .child(div().flex_none().text_size(12).text_color(on || f.value ? t.foreground : t.muted).child(f.label))
        .when(Boolean(f.note), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.note ?? ""))))
      .when(Boolean(err), (el) => el.child(errLine()));
  }

  const label = h_flex().h(LABEL).gap(4).items_center().text_size(11)
    .child(div().flex_none().max_w(Math.max(60, Math.floor(c.w * 0.62))).truncate().text_color(on ? t.foreground : t.muted).child(f.label))
    .when(Boolean(f.required), (el) => el.child(div().flex_none().text_color(on ? t.accent : t.dim).child("*")))
    .child(div().flex_1().min_w(0).pl(8).truncate().text_right().text_size(10).text_color(t.dim).child(f.hint ?? ""));

  let control: Element;

  if (isText(f)) {
    const box = div().id(`ff-${f.id}`).relative().w_full().border(1).border_color(edge).px(7)
      .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        form.at = i;
        form.focusField(cx);
        cx.notify();
      });

    control = f.kind === "area"
      ? box.h(lay.area).py(5).child(Textarea.new(form.areaOf(f)).relative().w_full().h_full().text_size(12).text_color(t.foreground))
      : box.h(CONTROL).flex().items_center().child(Input.new(form.inputOf(f)).relative().w_full().text_size(12).text_color(t.foreground));
  } else {
    const list = f.kind === "multi" ? f.value : null;
    const shownAs = (v: string) => (f.display ? f.display(v) : v);
    const text = f.kind === "multi" ? "" : shownAs(f.value);
    const open = form.picker?.field === f;
    const shown = list?.length ? null : text || f.placeholder || (list ? "none" : "pick one");

    control = h_flex().id(`ff-${f.id}`).relative().w_full().h(CONTROL).px(7).gap(6).items_center().border(1).border_color(open ? t.accent : edge).cursor_pointer()
      .hover((s) => s.border_color(on ? t.accent : t.ansi8))
      .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
      .on_mouse_down("left", click)
      .when(Boolean(list?.length), (el) => el.child(h_flex().relative().flex_1().min_w(0).gap(6).overflow_hidden()
        .children((list ?? []).map((v, k) => chipOf(t, `fc-${f.id}-${k}`, shownAs(v))))))
      .when(shown !== null, (el) => el.child(div().relative().flex_1().min_w(0).truncate().text_size(12)
        .text_color(text ? t.foreground : t.dim).child(shown ?? "")))
      .child(div().relative().flex_none().text_size(10).text_color(on || open ? t.accent : t.dim)
        .child(list ? `${list.length || ""} ▾` : on ? "‹ › ▾" : "▾"));
  }

  return cell.child(label).child(div().h(LABEL_GAP)).child(control).when(Boolean(err), (el) => el.child(errLine()));
}

/** The review, in place of the fields: the exact commands, in order, before they run; Send and Back in the footer. */
export function reviewBody<R>(f: Form<R>, t: Theme): Element {
  const cmds = f.spec.commands?.() ?? [];
  const sending = f.stage === "sending";
  const pad = f.lay().pad;

  const lines = cmds.map((c, i) => v_flex().id(`fc-${i}`).relative().gap(4)
    .child(h_flex().gap(8).text_size(10).text_color(t.ansi8)
      .child(div().flex_none().text_color(t.accent).child(String(i + 1)))
      .child(div().flex_1().min_w(0).truncate().child(c.label)))
    .child(div().relative().px(8).py(6).text_size(11).text_color(t.foreground)
      .child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1)))
      .child(div().relative().child(c.line))));

  const note = f.spec.confirmNote;

  const view = v_flex().id("form-confirm").relative().flex_1().min_h(0).overflow_y_scroll().px(pad).pt(12).pb(12).gap(14)
    .children(lines)
    .when(Boolean(note), (el) => el.child(div().text_size(11).text_color(t.muted).child(note?.() ?? "")))
    .when(Boolean(f.sendError), (el) => el.child(h_flex().gap(8).items_start().text_size(11)
      .child(div().flex_none().text_color(t.blocked).child("failed"))
      .child(div().flex_1().min_w(0).text_color(t.blocked).child(f.sendError))));

  const foot = footer(f, t, pad, sending ? "sending…" : `${cmds.length} command${cmds.length === 1 ? "" : "s"}, in this order`, [
    button(t, "form-send", f.sendError ? "Try again" : f.spec.sendWord ?? "Send", submitKey(f.stops(), f.confirmAt, f.mac), true, (cx) => {
      if (!sending) f.send(cx);
    }, sending, !sending && f.confirmAt === 0),
    button(t, "form-back", "Back", "esc", false, (cx) => f.back(cx), sending, !sending && f.confirmAt === 1),
  ]);

  return v_flex().size_full().child(view).child(foot);
}

/** Where the open list sits and which of its rows show: { rows, n, place, top, end, hOf }, or null. */
export function pickerSpot<R>(f: Form<R>, lay: Layout<Field> = f.lay()): PickerSpot | null {
  const p = f.picker;

  if (!p) return null;

  const field = p.field;
  const rows = f.rows(field, p.query.value());
  const n = rows?.length ?? 0;

  p.at = Math.max(0, Math.min(p.at, n - 1));

  const cell = cellOf(lay, f.fields.indexOf(field));

  if (!cell) return null;

  const place = pickerPlace(cell, { scrollY: f.scrollY, viewH: f.viewH, want: pickerHeight(rows), width: f.width });

  // The rows that fit, scrolled so the one with the keyboard shows.
  const room = place.h - PICK_HEAD - 8;
  const hOf = (r: Choice) => (r.sub ? PICK_ROW_SUB : PICK_ROW);

  const fits = (from: number) => {
    let h = 0, k = from;

    for (let r = rows?.[k]; r && k < n && h + hOf(r) <= room; r = rows?.[k]) {
      h += hOf(r);
      k++;
    }

    return k;
  };

  let top = 0;

  if (n) {
    top = Math.min(p.top, p.at);

    while (fits(top) <= p.at && top < p.at) top++;

    p.top = top;
  }

  return { rows, n, place, top, end: n ? Math.max(fits(top), top + 1) : 0, hOf };
}

/** The open list, under its field at the field's width (form-layout.ts pickerPlace: upward without room below,
 *  never over the footer), over a catcher that closes it on a click outside. */
function pickerBox<R>(form: Form<R>, t: Theme, lay: Layout<Field>): Element[] {
  const spot = pickerSpot(form, lay);
  const p = form.picker;

  if (!spot || !p) return [];

  const f = p.field;
  const { rows, n, place, top, end, hOf } = spot;
  const chosen = (r: Choice) => (f.kind === "multi" ? f.value.includes(r.value) : f.value === r.value);

  const row = (r: Choice, i: number) => h_flex().id(`fp-${i}`).relative().h(hOf(r)).flex_none().px(8).gap(8).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(i === p.at, (el) => el.children(band(t, true)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      p.at = i;
      form.pick(f, r, cx);
      cx.notify();
    })
    .when(f.kind === "multi", (el) => el.child(div().relative().size(10).flex_none().border(1).border_color(chosen(r) ? t.accent : t.ansi8)
      .when(chosen(r), (e2) => e2.child(div().absolute().top(2).left(2).size(4).bg(t.accent)))))
    .child(v_flex().relative().flex_1().min_w(0)
      .child(div().truncate().text_size(12).text_color(i === p.at ? t.foreground : r.typed ? t.accent : t.muted).child(r.label))
      .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? ""))))
    .when(Boolean(r.right) || (f.kind === "choice" && chosen(r)), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(r.right || "current")));

  const body = rows === null ? div().h(60).child(empty(t, "Reading…", null, { small: true }))
    : !n ? div().px(8).py(9).text_size(11).text_color(t.dim).child(f.free ? "Nothing matches: type a name." : "Nothing matches.")
    : v_flex().py(4).children(rows.slice(top, end).map((r, k) => row(r, top + k)));

  const count = f.kind === "multi" ? `${f.value.length} chosen` : rows ? `${n}` : "";

  return [
    div().id("form-picker").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        p.query.release();
        form.picker = null;
        form.focusField(cx);
        cx.notify();
      }),
    v_flex().id("form-picker-box").absolute().left(place.x).top(place.y).w(place.w).h(place.h).overflow_hidden().bg(t.background).border(1).border_color(t.accent)
      .on_mouse_down("left", stop)
      .child(h_flex().relative().h(PICK_HEAD - 1).flex_none().px(8).gap(6).items_center()
        .child(div().text_size(11).text_color(t.accent).child("›"))
        .child(Input.new(p.query).flex_1().h_full().text_size(12).text_color(t.foreground))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(count)))
      .child(div().h(1).flex_none().bg(t.ansi0))
      .child(body),
  ];
}


/** A chosen value in a list field: a small dithered chip. */
function chipOf(t: Theme, id: string, word: string): Element {
  return div().id(id).relative().flex_none().h(18).px(5).flex().items_center().text_size(11).text_color(t.foreground)
    .child(div().absolute().inset_0().child(dither(t.ansi0, 1)))
    .child(div().relative().child(word));
}

/** A form button: the key it answers to beside its word; `main` is the accent one.
 *  `focused` (the keyboard's) wears the dialogs' ring: the main one filled in
 *  the accent, the other on a band with an accent edge. */
export function button(t: Theme, id: string, word: string, key: string, main: boolean, action: (cx: Context) => void, off = false, focused = false): Element {
  const filled = focused && main;

  return h_flex().id(id).relative().h(24).px(10).gap(8).flex_none().items_center().text_size(11).border(1)
    .border_color(off ? t.ansi0 : focused || main ? t.accent : t.ansi8)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.border_color(t.foreground)))
    .when(main && !off && !focused, (el) => el.child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 1))))
    .when(filled, (el) => el.bg(t.accent))
    .when(focused && !main, (el) => el.bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();

      if (!off) action(cx);

      cx.notify();
    })
    .child(div().relative().text_color(off ? t.dim : filled ? t.background : main || focused ? t.foreground : t.muted).child(word))
    .child(div().relative().text_size(10).text_color(off ? t.dim : filled ? t.background : t.accent).child(key));
}
