// The files pane's bars: the toolbar (back, forward, the folder, the preview
// chip), the filter line (the lens with its filters and + new), and the
// footer's hint line and keys strip.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import type { Theme } from "herdr";
import { h_flex, v_flex, Input } from "gpui-base";
import type { NewKind } from "./logic.ts";
import { parent, lensLayout, toolbarFit, KEYS, ADDS, lookSide, deleteManyQuestion, base, deleteQuestion } from "./logic.ts";
import { keysHint, keysView, SECTION } from "./keyhelp.ts";
import { MOD, PER_FOLDER, TOTAL, tilde, ICONS } from "./state.ts";
import { stop, dither, ring } from "./paint.ts";
import { toggleLook } from "./look.ts";
import { addNew, startFind } from "./search.ts";
import { closePane, copySet } from "./opening.ts";
import { askDelete, commitDraft, cutRow, removeAsked } from "./file-ops.ts";
import { dragLabel, markedRows } from "./drag.ts";
import type { default as Files } from "./main.ts";

export function toolChip(v: Files, t: Theme, id: string, label: string, action: (cx: Context) => void, on = true): Element {
  return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
    .text_color(on ? t.muted : t.ansi0).when(on, (el) => el.hover((s) => s.text_color(t.foreground)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      if (on) action(cx);

      cx.notify();
    })
    .child(div().relative().child(label));
}

export function drawToolbar(v: Files, t: Theme, w: number, focused: boolean): Element {
  let changed = 0;

  for (const m of v.marks.values()) if (m !== "•") changed++;

  const name = v.root === "/" ? "/" : v.root.split("/").pop() ?? "";
  const fit = toolbarFit(w, { alone: v.alone, branch: v.branch, changed, name });
  const branch = v.branch;

  return h_flex().id("nf-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
    .when(fit.eyebrow, (el) => el.child(div().flex_none().text_color(focused ? t.accent : t.ansi8).child("FILES")))
    .child(toolChip(v, t, "nf-back", "‹", (cx) => v.back(cx), v.root !== "/" || v.nav.past.length > 0))
    .child(toolChip(v, t, "nf-forward", "›", (cx) => v.forward(cx), v.nav.future.length > 0))
    .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
      .child(div().flex_shrink(1).min_w(fit.name).truncate().text_color(t.foreground).child(name))
      .when(fit.path, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(parent(v.root))))))
    .children(fit.branch && branch ? [div().flex_none().max_w(140).truncate().text_color(t.ansi2).child(branch)] : [])
    .when(fit.changed, (el) => el.child(div().flex_none().text_color(t.ansi3).child(`±${changed}`)))
    .when(fit.look, (el) => el.child(lookChip(v, t)))
    .when(fit.edit, (el) => el.child(toolChip(v, t, "nf-edit", "edit", (cx) => v.edit("", cx))))
    .when(fit.close, (el) => el.child(h_flex().id("nf-close").relative().size(20).flex_none().items_center().justify_center()
      .text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click(() => closePane(v))
      .child(svg(`${ICONS}/x.svg`).size(12))))
    // The keyboard is here: the rule under the toolbar lights up.
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(focused ? t.accent : t.ansi0, 1)));
}

/** The preview split's switch: where it opens (right or bottom), lit while it's on. */
export function lookChip(v: Files, t: Theme): Element {
  const on = v.lookState.on;
  const side = v.side ?? lookSide(v.size);

  return h_flex().id("nf-look-chip").relative().size(20).flex_none().items_center().justify_center()
    .text_color(on ? t.accent : t.muted).hover((s) => s.text_color(on ? t.accent : t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      toggleLook(v, cx);
      cx.notify();
    })
    .child(svg(`mods/${MOD}/look-${side}.svg`).relative().size(12));
}

/** A filter's switch: an open eye while that kind is listed; a shut one,
 *  the label struck through and how many it leaves out, while it's hidden. */
export function filterChip(v: Files, t: Theme, id: string, label: string, on: boolean, cut: number, action: (cx: Context) => void, ringed = false): Element {
  return h_flex().id(id).relative().h(20).px(4).gap(4).flex_none().items_center()
    .when(ringed, (el) => el.child(ring(t)))
    .hover((s) => s.bg(`${t.ansi0}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => action(cx))
    .child(svg(on ? `${ICONS}/eye.svg` : `mods/${MOD}/eye-off.svg`).relative().size(11).flex_none().text_color(on ? t.dim : t.ansi3))
    .when(Boolean(label), (el) => el.child(div().relative().text_color(t.muted).when(!on, (el) => el.line_through()).child(label)))
    .when(!on && cut > 0, (el) => el.child(div().relative().text_color(t.ansi3).child(String(cut))));
}

/** + file / + folder (or a bare +): `a` / `A`'s name row; the accent +, a muted word. */
export function addChip(v: Files, t: Theme, kind: NewKind, label: string, ringed: boolean): Element {
  const word = label.replace(/^\+\s*/, "");

  return h_flex().id(`nf-add-${kind}`).relative().h(20).px(4).gap(7).flex_none().items_center().text_color(t.muted)
    .hover((s) => s.bg(`${t.ansi0}55`).text_color(t.foreground))
    .when(ringed, (el) => el.child(ring(t)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      addNew(v, kind, cx);
      cx.notify();
    })
    .child(div().relative().text_color(t.accent).child("+"))
    .when(Boolean(word), (el) => el.child(div().relative().child(word)));
}

/** The line under the toolbar: the filter as you type, the two switches,
 *  the new-item chips and ? keys. Narrow (the docked panel), two rows
 *  (logic.ts lensLayout): the filter at full width, a click anywhere on its
 *  row starts it; the switches and chips on the row under it. */
export function drawLens(v: Files, t: Theme, w: number, found: number): Element {
  const live = v.typing || v.finding || Boolean(v.query);
  const cut = v.cut;
  const searching = Boolean(v.query.trim());
  // What fits this width: the placeholder shortens, then the switches' labels; then two rows.
  const fit = lensLayout(w, { cut: { hidden: v.filters.hidden ? 0 : cut.hidden, ignored: v.filters.ignored ? 0 : cut.ignored }, count: searching ? found : null });
  const [hLabel, iLabel] = fit.labels;

  v.lensAdd = fit.add;
  v.lensRows = fit.rows;

  const at = v.stop;
  const row = (id: string): Element => h_flex().id(id).relative().h(26).flex_none().pl(10).pr(6).gap(6).items_center().text_size(11).overflow_hidden();

  const find = h_flex().id("nf-find").relative().flex_1().min_w(0).h_full().items_center().overflow_hidden()
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      startFind(v, cx);
    })
    .child(live && v.input
      ? Input.new(v.input).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
      : h_flex().min_w(0).gap(5).text_color(t.dim)
        .child(div().flex_none().text_color(t.accent).child("/"))
        .when(Boolean(fit.find), (el) => el.child(div().min_w(0).truncate().child(fit.find))));

  const icon = svg(`${ICONS}/search.svg`).relative().size(11).flex_none().text_color(v.typing ? t.accent : t.dim);
  const count = searching && fit.count ? [div().flex_none().text_color(t.dim).child(`${found}`)] : [];
  const adds: readonly (readonly [NewKind, string])[] = ADDS[fit.add];

  const chips = [
    filterChip(v, t, "nf-hidden", hLabel, v.filters.hidden, fit.cuts ? cut.hidden : 0, (cx) => v.setFilter("hidden", cx), at === "hidden"),
    filterChip(v, t, "nf-ignored", iLabel, v.filters.ignored, fit.cuts ? cut.ignored : 0, (cx) => v.setFilter("ignored", cx), at === "ignored"),
    ...adds.map(([kind, label]) => addChip(v, t, kind, label, at === `add-${kind}`)),
  ];

  // ? keys: the line's last item (keyhelp.ts).
  const keys = keysHint(t, "nf-keys", v.keysShown, () => {
    v.keysShown = !v.keysShown;
  }).relative().h(20).px(4)
    .when(at === "keys", (el) => el.child(ring(t)));

  const rule = (): Element => div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1));

  if (fit.rows === 1) return row("nf-lens").child(icon).child(find).children(count).children(chips).child(keys).child(rule());

  // Two rows: the filter's own row takes a click anywhere (the icon, the gap, the count too).
  return v_flex().id("nf-lens").relative().flex_none()
    .child(row("nf-lens-find").cursor_text()
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        startFind(v, cx);
      })
      // Typing: the field's own frame, so it reads as a place to type.
      .when(live, (el) => el.child(div().absolute().left(4).right(4).top(3).bottom(3).border(1).border_color(v.typing ? t.accent : t.ansi0)))
      .child(icon).child(find).children(count)
      .when(Boolean(v.query), (el) => el.child(div().flex_none().text_color(t.dim).child("esc clears")))
      .child(div().absolute().left(10).right(10).bottom(0).h(1).opacity(0.5).child(dither(t.ansi0, 1))))
    .child(row("nf-lens-chips").children(chips).child(div().flex_1()).child(keys).child(rule()));
}

/** `?`: every key, in the list's place (keyhelp.ts); one column at the panel's width. */
export function drawKeysStrip(v: Files, t: Theme, width = v.size.width): Element {
  return keysView(t, { id: "nf-keys-strip", title: "files", list: KEYS, narrow: width < 2 * SECTION, close: () => {
    v.keysShown = false;
  } });
}

/** A key and what it does in the hint line, clickable. */
export function hintKey(v: Files, t: Theme, id: string, key: string, label: string, action: (cx: Context) => void): Element {
  return h_flex().id(id).relative().flex_none().gap(4).items_center()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      action(cx);
      cx.notify();
    })
    .child(div().text_color(t.accent).child(key))
    .child(div().text_color(t.muted).child(label));
}

/** The hint line at the bottom: the delete question, the name input's keys,
 *  what an operation said, else the copy, search and listing notes. */
export function footer(v: Files, t: Theme, searching: boolean): Element | null {
  const line = (): Element => v_flex().id("nf-foot").flex_none().px(10).py(4).gap(3).text_size(10).text_color(t.dim).border_t(1).border_color(t.ansi0);
  const keys = (...ks: Element[]): Element => h_flex().flex_wrap().gap_x(12).gap_y(2).children(ks);
  const d = v.drag;

  if (d) {
    return line().child(div().text_color(d.ok ? t.foreground : t.dim)
      .child(d.into === null ? `Drop on a folder, or below the rows for ${tilde(v.root)} · esc cancels`
        : d.ok ? `Drop: ${dragLabel(v, d)} into ${d.into ? `${base(d.into)}/` : tilde(v.root)}${d.moving.length < d.paths.length ? ` (${d.paths.length - d.moving.length} already there)` : ""}`
        : d.why ?? ""));
  }

  const a = v.ask;

  if (a) {
    return line()
      .child(div().text_color(a.trash ? t.foreground : t.ansi1).child(a.set ? deleteManyQuestion(a.set, Boolean(a.trash)) : deleteQuestion(a.name, a.dir, Boolean(a.trash))))
      .child(keys(
        hintKey(v, t, "nf-ask-yes", "y", a.trash ? "move to the Trash" : "delete", (cx) => {
          v.ask = null;
          removeAsked(v, a, cx);
        }),
        hintKey(v, t, "nf-ask-no", "esc", "keep it", () => {
          v.ask = null;
        })));
  }

  const draft = v.draft;

  if (draft) {
    const rename = draft.kind === "rename";

    const what = draft.kind === "rename" ? `Rename “${draft.name}”: a path moves it`
      : `New ${draft.kind} in ${draft.dir ? `${base(draft.dir)}/` : tilde(v.root)}${draft.kind === "file" ? ": end with / for a folder" : ""}`;

    const msg = v.msg;

    return line()
      .children(msg ? [div().text_color(msg.error ? t.ansi1 : t.foreground).child(msg.text)] : [])
      .child(div().text_color(t.foreground).child(what))
      .child(keys(
        hintKey(v, t, "nf-draft-ok", "enter", rename ? "rename" : "create", (cx) => commitDraft(v, cx)),
        hintKey(v, t, "nf-draft-no", "esc", "cancel", (cx) => v.endDraft(cx))));
  }

  const text = v.msg ? v.msg.text : v.copied ? v.copiedText ?? "path copied" : searching && v.note ? v.note
    : v.limited ? `Listing cut at ${PER_FOLDER} per folder, ${TOTAL} in all` : null;

  // Marks: how many, and what acts on them.
  if (!text && v.marked.size) {
    const n = v.marked.size;

    return line()
      .child(div().text_color(t.accent).child(`${n} marked${v.range ? " · marking a range (V ends)" : ""}`))
      .child(keys(
        hintKey(v, t, "nf-set-d", "d", "delete", (cx) => askDelete(v, markedRows(v)[0], cx)),
        hintKey(v, t, "nf-set-x", "x", "cut", (cx) => cutRow(v, markedRows(v)[0], cx)),
        hintKey(v, t, "nf-set-y", "y", "copy paths", (cx) => copySet(v, cx)),
        hintKey(v, t, "nf-set-esc", "esc", "unmark", () => v.unmark())));
  }

  if (!text) return null;

  return line().child(div().text_color(v.msg?.error ? t.ansi1 : t.dim).child(text));
}
