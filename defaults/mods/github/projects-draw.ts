// The Projects tab drawn (projects.ts's render places the parts): the bar,
// the board's columns and lanes of cards, a folded column's strip, the open
// card's detail and the menus; clicks on the board pick and carry cards.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, Size } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Input } from "gpui-base";
import type { Theme } from "herdr";
import { readAgo, ago } from "./model.ts";
import { markdown } from "./markdown.ts";
import { dither, pip, empty, band, stop, unzoom, ART, ansiColor } from "./kit.ts";
import type { Board, Content, Field, FieldValue, Item } from "./board.ts";
import type { At, Layout, Lane } from "./board-layout.ts";
import { filterTokens, selectOf } from "./board-filter.ts";
import { cardFields, editableFields, initials, loginSlot, valueText, wrap, ansiKey, label, numW } from "./board-cards.ts";
import { choose, menuFields, openProjects, options } from "./projects-menus.ts";
import { flipped, toggleFold } from "./projects-keys.ts";
import type { default as Projects, ColumnRow, Menu } from "./projects.ts";

export const FOLD_W = 28, GAP = 6, DETAIL_W = 340, CHAR = 7.7, LINE = 15, LANE_H = 22;

export const HANDLES = 16;

const ansi = (t: Theme, color: string | null | undefined): Color => ansiColor(t, ansiKey(color));

const KIND_WORD = { issue: "Issue", pr: "Pull request", draft: "Draft", redacted: "Item" } as const satisfies { readonly [K in Content["kind"]]: string };

/** A login as a square of its initials, in its own color. */
function avatar(t: Theme, who: string, i: number): Element {
  return div().id(`pav-${who}-${i}`).relative().size(16).flex_none().flex().items_center().justify_center().text_size(9)
    .bg(ansiColor(t, loginSlot(who))).text_color(t.background).when(i > 0, (el) => el.ml(-3))
    .child(initials(who));
}

function valueColor(t: Theme, f: Field, v: FieldValue): Color {
  if (f.type === "single") {
    const id = selectOf(v)?.optionId;

    return ansi(t, f.options.find((o) => o.id === id)?.color);
  }

  if (f.type === "iteration") return t.ansi6;

  return t.muted;
}

/** The project, its views and the filter. */
export function bar(proj: Projects, t: Theme, b: Board | null, lay: Layout | null): Element {
  const p = proj.list?.projects.find((x) => x.id === proj.pick) ?? b?.project;
  const views = b ? proj.views(b) : [], cur = b ? proj.view(b) : null;

  const viewChips = views.map((v) => h_flex().id(`pv-${v.id}`).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(v.id === cur?.id ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop).on_click((_e, cx) => {
      proj.setView(v.id);
      cx.notify();
    })
    .when(v.id === cur?.id, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(v.name)));

  const tokens = filterTokens(proj.filterText);
  const typing = proj.typing === "filter";

  const filter = h_flex().id("pf-filter").relative().flex_1().min_w(120).h(22).px(8).gap(6).items_center().text_size(11)
    .border(1).border_color(typing ? t.accent : t.ansi0)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      proj.menu = null;
      proj.typing = "filter";
      proj.filter.focus();
      cx.notify();
    })
    .child(div().flex_none().text_color(typing ? t.accent : t.dim).child("/"))
    .child(typing ? Input.new(proj.filter).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
      : h_flex().flex_1().min_w(0).gap(6).overflow_hidden().children(tokens.length ? tokens.map((k, i) => div().id(`tok-${i}`).flex_none().text_color(k.kind === "key" ? t.ansi5 : t.foreground).child(k.text))
        : [div().text_color(t.dim).truncate().child("filter")]))
    .when(lay !== null, (el) => (lay ? el.child(div().flex_none().text_color(t.dim).child(lay.shown === lay.total ? `${lay.total}` : `${lay.shown} of ${lay.total}`)) : el));

  return h_flex().h(30).flex_none().gap(8).items_center().pb(6)
    .child(h_flex().id("pf-project").flex_none().gap(6).items_center().text_size(11).max_w(300)
      .on_mouse_down("left", stop).on_click((_e, cx) => {
        openProjects(proj);
        cx.notify();
      })
      .child(div().text_color(t.accent).child("p"))
      .child(div().truncate().text_color(t.foreground).hover((s) => s.text_color(t.accent)).child(p?.title ?? "Project"))
      .when(Boolean(p?.number), (el) => el.child(div().flex_none().text_color(t.dim).child(`#${p?.number ?? ""}`))))
    .child(div().w(2).h(14).relative().flex_none().child(dither(t.ansi0, 1)))
    .child(h_flex().flex_none().gap(2).children(viewChips))
    .child(filter);
}

/** The rows a column draws: lane headers, cards and the gap that keeps a lane as tall as in the
 *  tallest column, so swimlanes line up across the board ({ lane } | { item } | { pad }). */
export function columnRows(proj: Projects, lay: Layout, ci: number): ColumnRow[] {
  const g = proj.grid(lay)[ci] ?? [];

  if (!lay.lane) return g.map((item) => ({ item }));

  const where = new Map(lay.lanes.flatMap((l) => l.cells.flatMap((c) => c.map((i) => [i.id, l.key] as const))));
  const all = proj.grid(lay), chars = proj.chars, fields = proj.fields;

  const height = (items: readonly Item[]) => {
    let n = 0;

    for (const i of items) n += cardH(proj, i, chars, fields);

    return n;
  };

  const out: ColumnRow[] = [];

  for (const lane of lay.lanes) {
    const inLane = (col: number) => (all[col] ?? []).filter((i) => where.get(i.id) === lane.key);
    const items = inLane(ci);

    out.push({ lane, n: lane.folded ? lane.cells[ci]?.length ?? 0 : items.length });

    if (lane.folded) continue;

    for (const item of items) out.push({ item });

    const tallest = Math.max(0, ...lay.columns.map((c, k) => (c.folded ? 0 : height(inLane(k)))));
    const gap = tallest - height(items);

    if (gap > 0) out.push({ pad: gap, key: lane.key });
  }

  return out;
}

export function columns(proj: Projects, t: Theme, b: Board, lay: Layout, size: Size): Element {
  const avail = size.width - (proj.detailOpen ? DETAIL_W + GAP : 0);
  const cols = lay.columns;

  if (!cols.length) return div().flex_1().h_full().child(empty(t, "This view has no columns", "Its column field has no options yet.", { moon: 0 }));

  const fit = proj.fits(lay);

  proj.first = Math.max(0, Math.min(proj.first, cols.length - 1));

  const shown: number[] = [];
  let open = 0;

  for (let i = proj.first; i < cols.length; i++) {
    if (!cols[i]?.folded) {
      if (open >= fit) break;

      open++;
    }

    shown.push(i);
  }

  const folded = shown.filter((i) => cols[i]?.folded).length;
  const w = Math.max(200, Math.floor((avail - folded * (FOLD_W + GAP) - Math.max(0, open - 1) * GAP) / Math.max(1, open)));
  const a = proj.at(lay), fields = cardFields(b, proj.view(b), lay);
  // Every open column is as wide, so a card is as tall in each (the swimlanes line up).
  const cw = Math.min(w, 480);

  proj.chars = Math.max(8, Math.floor((cw - 24) / CHAR));
  proj.fields = fields;

  const more = (n: number, side: string) => div().id(`pmore-${side}`).flex_none().w(14).h_full().flex().items_center().justify_center().text_size(10).text_color(t.dim).child(`${n}`);
  const last = shown.at(-1) ?? cols.length - 1;

  return h_flex().flex_1().min_w(0).h_full().gap(GAP)
    .when(proj.first > 0, (el) => el.child(more(proj.first, "l")))
    .children(shown.map((ci) => (cols[ci]?.folded ? foldStrip(proj, t, lay, ci) : column(proj, t, b, lay, ci, cw, a, fields))))
    .when(shown.length > 0 && last < cols.length - 1, (el) => el.child(more(cols.length - 1 - last, "r")));
}

export function foldStrip(proj: Projects, t: Theme, lay: Layout, ci: number): Element {
  const c = lay.columns[ci];

  if (!c) return div();

  const letters = Array.from(c.name.slice(0, 14), (ch, i) => div().id(`pfl-${i}`).h(11).text_size(10).text_color(t.dim).child(ch === " " ? " " : ch));

  return v_flex().id(`pfold-${ci}`).w(FOLD_W).flex_none().h_full().items_center().pt(6).gap(6).border(1).border_color(t.ansi0)
    .hover((s) => s.border_color(t.ansi8))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      toggleFold(proj, lay, ci);
      proj.selCol = ci;
      proj.sel = null;
      proj.keepSel();
      proj.app.focusSelf();
      cx.notify();
    })
    .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
    .child(v_flex().items_center().children(letters))
    .child(div().text_size(10).text_color(c.limit && c.count > c.limit ? t.blocked : t.dim).child(String(c.count)));
}

export function column(proj: Projects, t: Theme, b: Board, lay: Layout, ci: number, w: number, a: At, fields: readonly Field[]): Element {
  const c = lay.columns[ci];

  if (!c) return div();

  const active = a.col === ci && proj.focus === "board";
  const over = c.limit !== null && (c.count + (proj.carrying && proj.carrying.col === ci && proj.carrying.from.col !== ci ? 1 : 0)) > c.limit;
  const edge = over ? t.blocked : active ? t.accent : t.ansi0;
  const rows = columnRows(proj, lay, ci);
  const chars = proj.chars;
  const heights = rows.map((r) => ("lane" in r ? LANE_H : "pad" in r ? r.pad : cardH(proj, r.item, chars, fields)));
  const count = c.limit ? `${c.count} / ${c.limit}` : String(c.count);

  const head = h_flex().id(`pch-${ci}`).relative().h(22).flex_none().px(8).gap(7).items_center().text_size(11)
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      proj.selCol = ci;
      proj.sel = proj.grid(lay)[ci]?.[0]?.id ?? null;
      proj.app.focusSelf();
      cx.notify();
    })
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
    .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(c.name))
    .child(div().relative().flex_none().text_color(over ? t.blocked : t.dim).child(count));

  const drafting = proj.typing === "draft" && a.col === ci;
  const handle = proj.handles[ci];

  const keyOf = (i: number) => {
    const r = rows[i];

    if (!r) return String(i);

    return "lane" in r ? `lane-${r.lane.key ?? ""}` : "pad" in r ? `pad-${r.key ?? ""}` : r.item.id;
  };

  const list = !rows.length ? div().flex_1().min_h(0).child(empty(t, proj.filterText || proj.view(b)?.filter ? "Nothing matches" : "Nothing here", proj.carrying ? "enter drops it here" : proj.filterText ? "esc clears the filter" : "a adds a draft · m carries a card here", { moon: ci % 2 ? 0 : 1, small: false }))
    : div().flex_1().min_h(0).pt(2).child(v_virtual_list(`pcol-${b.project.id}-${ci}`, rows.length, heights, keyOf,
      (range) => rows.slice(range.start, range.end).map((r, k) => ("lane" in r ? laneRow(proj, t, r, ci, range.start + k)
        : "pad" in r ? div().id(`ppad-${ci}-${range.start + k}`).h(r.pad).w_full() : card(proj, t, r.item, a, ci, chars, fields))))
      .on_item_click((key, cx) => clicked(proj, lay, ci, key, cx))
      .size_full().when(handle !== undefined, (el) => (handle ? el.track_scroll(handle) : el)));

  return v_flex().id(`pcolumn-${ci}`).w(w).flex_none().h_full().min_h(0).border(1).border_color(edge)
    .on_mouse_down("left", (_e, cx) => {
      proj.app.focusSelf();
      cx.stop_propagation();
    })
    .child(head)
    .when(drafting, (el) => el.child(h_flex().h(26).flex_none().mx(6).mt(4).px(6).gap(6).items_center().border(1).border_color(t.accent)
      .child(div().text_size(11).text_color(t.accent).child("+"))
      .child(Input.new(proj.draft).flex_1().h_full().text_size(11).text_color(t.foreground))))
    .child(list);
}

export function clicked(proj: Projects, lay: Layout, ci: number, key: string, cx: Context): void {
  if (key.startsWith("pad-")) return;

  if (key.startsWith("lane-")) {
    const lane = lay.lanes.find((l) => `lane-${l.key ?? ""}` === key);
    const v = proj.view();
    const k = lane?.key;

    if (k !== undefined && k !== null && v) proj.setLocal((l) => ({ ...l, lanes: new Map(l.lanes).set(v.id, flipped(proj, l.lanes.get(v.id), k)) }));
  } else if (!proj.carrying) {
    const again = proj.sel === key;

    proj.sel = key;
    proj.selCol = ci;
    proj.focus = "board";

    if (again || proj.detailOpen) {
      proj.detailOpen = true;
      proj.scrollY = 0;

      const it = proj.current(lay);

      if (it) void proj.readDetail(it, cx);
    }
  }

  proj.app.focusSelf();
  cx.notify();
}

export function laneRow(proj: Projects, t: Theme, r: { readonly lane: Lane; readonly n: number }, ci: number, i: number): Element {
  return h_flex().id(`plane-${ci}-${i}`).relative().h(LANE_H).px(8).gap(6).items_center().text_size(10)
    .hover((s) => s.bg(`${t.ansi0}55`))
    .child(div().flex_none().text_color(r.lane.done ? t.dim : t.ansi6).child(`${r.lane.folded ? "+" : "−"} ${r.lane.name}`))
    .child(div().flex_none().text_color(t.dim).child(String(r.n)))
    .child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1)));
}

export function cardH(proj: Projects, item: Item, chars: number, fields: readonly Field[]): number {
  const lines = wrap(item.content.title, chars - numW(item)).length;

  return 6 + lines * LINE + (item.content.labels.length ? 20 : 0) + (metaShown(proj, item, fields) ? 17 : 0) + 7;
}

export function metaShown(proj: Projects, item: Item, fields: readonly Field[]): boolean {
  const c = item.content;

  return c.assignees.length > 0 || fields.some((f) => item.values.get(f.id)) || c.kind === "draft" || c.repo !== proj.app.repo?.full || c.state === "CLOSED" || c.state === "MERGED";
}

export function card(proj: Projects, t: Theme, item: Item, a: At, ci: number, chars: number, fields: readonly Field[]): Element {
  const c = item.content;
  const sel = item.id === proj.sel && a.col === ci;
  const lifted = proj.carrying?.id === item.id;
  const active = sel && proj.focus === "board";
  const pending = proj.pending.some((p) => p.state === "sending" && (p.op.kind === "add" ? p.op.item.id : p.op.item) === item.id);
  const lines = wrap(c.title, chars - numW(item));
  const num = c.kind === "draft" ? "draft" : c.number !== null ? `#${c.number}` : "";
  const state = c.state === "MERGED" ? (["merged", t.ansi5] as const) : c.state === "CLOSED" ? (["closed", t.blocked] as const) : null;
  const otherRepo = c.repo && c.repo !== proj.app.repo?.full ? c.repo.split("/")[1] ?? null : null;

  const values = fields.flatMap((f) => {
    const v = item.values.get(f.id);

    return v ? [[f, v] as const] : [];
  });

  const titleColor = lifted || sel ? t.foreground : c.kind === "draft" ? t.dim : t.muted;

  return v_flex().id(`pcard-${item.id}`).relative().w_full().h(cardH(proj, item, chars, fields)).pl(10).pr(8).pt(6).gap(4).flex_none()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(sel && !lifted, (el) => el.children(band(t, active)))
    .when(lifted, (el) => el.border(1).border_color(t.accent).child(dither(`${t.accent}30`, 1)))
    .when(!sel && !lifted, (el) => el.child(div().absolute().left(8).right(8).top(0).h(1).child(dither(t.ansi0, 1))))
    .child(h_flex().relative().gap(7).items_start().text_size(12)
      .when(lifted, (el) => el.child(svg(`${ART}/wings.svg`).w(16).h(6).mt(4).flex_none().text_color(t.working).loop("opacity", { from: 0.3, to: 1, period: 700 })))
      .child(div().flex_none().text_color(sel || lifted ? t.accent : c.kind === "draft" ? t.dim : t.ansi8).child(num))
      .child(v_flex().flex_1().min_w(0).children(lines.map((l, i) => div().id(`pt-${i}`).h(LINE).truncate().text_color(titleColor).child(l)))))
    .when(c.labels.length > 0, (el) => el.child(h_flex().relative().gap(4).pl(2).h(16).overflow_hidden().children(c.labels.slice(0, 4).map((l, i) =>
      div().id(`pl-${i}`).relative().px(5).h(16).flex_none().flex().items_center().text_size(10).text_color(t.foreground)
        .child(dither(`#${l.color}88`, 1)).child(div().relative().child(l.name))))))
    .when(metaShown(proj, item, fields), (el) => el.child(h_flex().relative().h(16).gap(6).pl(2).items_center().text_size(10).text_color(t.dim).overflow_hidden()
      .children(c.assignees.slice(0, 3).map((u, i) => avatar(t, u.login, i)))
      .when(c.assignees.length > 3, (e2) => e2.child(div().flex_none().child(`+${c.assignees.length - 3}`)))
      .when(state !== null, (e2) => (state ? e2.child(div().flex_none().text_color(state[1]).child(state[0])) : e2))
      .when(Boolean(otherRepo), (e2) => e2.child(div().flex_none().truncate().max_w(90).child(otherRepo ?? "")))
      .when(pending, (e2) => e2.child(div().flex_none().loop("opacity", { from: 0.3, to: 1, period: 900 }).child(pip(t, "working", 6))))
      .child(div().flex_1())
      .children(values.map(([f, v], i) => div().id(`pv-${i}`).flex_none().truncate().max_w(110).text_color(valueColor(t, f, v)).child(valueText(f, v))))));
}

/** The card docked right: its fields, its body (markdown) and the conversation. */
export function detail(proj: Projects, t: Theme, b: Board, lay: Layout): Element {
  const item = proj.current(lay), active = proj.focus === "detail";
  const edge = active ? t.accent : t.ansi0;

  const frame = (body: Element, right?: string) => v_flex().id("pdetail").w(DETAIL_W).flex_none().h_full().min_h(0).border(1).border_color(edge)
    .on_mouse_down("left", (_e, cx) => {
      proj.focus = "detail";
      proj.app.focusSelf();
      cx.stop_propagation();
      cx.notify();
    })
    .child(h_flex().relative().h(22).flex_none().px(8).gap(8).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
      .child(div().relative().flex_1().text_color(active ? t.foreground : t.muted).child(item ? KIND_WORD[item.content.kind] : "Item"))
      .child(div().relative().flex_none().text_color(t.dim).child(right ?? "")))
    .child(body);

  if (!item) return frame(empty(t, "Nothing selected", null, { moon: 0, small: true }));

  const c = item.content, kept = c.id ? proj.details.get(c.id) : undefined, d = kept?.d ?? null;

  const rows = editableFields(b, item).flatMap((f): [string, Element][] => {
    if (f.type === "title" || f.type === "labels" || f.type === "assignees") return [];

    const v = item.values.get(f.id);

    return [[f.name, v ? div().text_color(valueColor(t, f, v)).child(valueText(f, v)) : div().text_color(t.dim).child("—")]];
  });

  const assignees: [string, Element] = ["Assignees", c.assignees.length ? h_flex().gap(6).items_center().children(c.assignees.map((u, i) => h_flex().id(`pda-${i}`).gap(4).items_center().child(avatar(t, u.login, 0)).child(div().text_color(t.foreground).child(u.login)))) : div().text_color(t.dim).child("—")];
  const labels: [string, Element][] = c.kind === "draft" ? [] : [["Labels", c.labels.length ? h_flex().flex_wrap().gap(4).children(c.labels.map((l, i) => div().id(`pdl-${i}`).relative().px(5).h(16).flex().items_center().text_size(10).text_color(t.foreground).child(dither(`#${l.color}88`, 1)).child(div().relative().child(l.name)))) : div().text_color(t.dim).child("—")]];

  const grid2 = v_flex().gap(3).text_size(11)
    .children([assignees, ...labels, ...rows].map(([k, v], i) => h_flex().id(`pdf-${i}`).gap(10).items_start().child(div().w(84).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(v))));

  const md = (id: string, text: string | null | undefined) => markdown(t, id, text?.trim() ? text : "_No description._", { size: 12, onLink: (url, cx) => proj.app.openUrl(url, cx) });
  const state = c.state === "MERGED" ? (["merged", t.ansi5] as const) : c.state === "CLOSED" ? (["closed", t.blocked] as const) : c.kind === "draft" ? (["draft", t.dim] as const) : (["open", t.done] as const);
  const comments = d?.comments ?? [];

  const content = v_flex().absolute().left(0).right(0).top(-proj.scrollY).px(14).py(10).gap(8)
    .on_size_change((s, cx) => {
      const h = unzoom(s.height);

      if (Math.abs(h - proj.contentH) > 1) {
        proj.contentH = h;
        proj.scroll(0);
        cx.notify();
      }
    })
    .child(h_flex().gap(8).items_start().text_size(14)
      .when(c.number !== null, (el) => el.child(div().flex_none().text_color(t.accent).child(`#${c.number ?? ""}`)))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(c.title)))
    .child(h_flex().flex_wrap().gap_x(10).gap_y(2).text_size(11).text_color(t.muted)
      .when(Boolean(c.repo), (el) => el.child(div().child(c.repo ?? "")))
      .child(div().text_color(state[1]).child(state[0]))
      .when(Boolean(d?.createdAt), (el) => el.child(div().text_color(t.dim).child(`opened ${ago(d?.createdAt)} ago${d?.author ? ` by ${d.author}` : ""}`))))
    .child(grid2)
    .child(div().relative().h(2).child(dither(t.ansi0, 1)))
    .child(kept?.error ? div().text_size(11).text_color(t.blocked).child(kept.error) : md(`pd-body-${c.id ?? item.id}`, d ? d.body : c.id ? "_Reading…_" : ""))
    .when(comments.length > 0, (el) => el
      .child(h_flex().pt(8).gap(8).items_center().child(div().text_size(10).text_color(t.ansi8).child(`COMMENTS · ${comments.length + (d?.more ?? 0)}`)).child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1))))
      .children(comments.map((cm, i) => v_flex().id(`pdc-${i}`).relative().gap(4).pl(12).py(6)
        .child(div().absolute().left(2).top(6).bottom(6).w(2).child(dither(t.ansi0, 1)))
        .child(h_flex().gap(8).text_size(11).child(div().text_color(t.accent).child(cm.who)).child(div().flex_1()).child(div().text_color(t.dim).child(ago(cm.at))))
        .child(md(`pd-c-${c.id ?? ""}-${i}`, cm.body)))))
    .child(div().h(20));

  const view = div().id("pd-view").relative().flex_1().min_h(0).overflow_hidden()
    .on_size_change((s, cx) => {
      const h = unzoom(s.height);

      if (Math.abs(h - proj.viewH) > 1) {
        proj.viewH = h;
        proj.scroll(0);
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      proj.scroll(-unzoom(e.delta.y));
      cx.notify();
    })
    .child(content);

  return frame(view, kept?.at ? `read ${readAgo(kept.at)}` : c.id ? "reading…" : "");
}

/** The open menu, lazygit's: a framed list over the board. */
export function menuPanel(proj: Projects, t: Theme, b: Board, m: Menu): Element {
  interface RowLook {
    readonly on?: boolean;
    readonly cur?: boolean;
    readonly dim?: boolean;
    readonly color?: Color | null;
    readonly right?: string;
    readonly hex?: string | null;
    readonly toggle?: boolean;
  }

  const row = (id: string, text: string, { on = false, cur = false, dim = false, color = null, right = "", hex = null, toggle = false }: RowLook = {}) =>
    h_flex().id(id).relative().h(20).px(10).gap(7).items_center().text_size(11)
      .text_color(on ? t.foreground : dim ? t.dim : t.muted)
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .when(toggle, (el) => el.child(div().relative().flex_none().w(10).text_color(cur ? t.accent : t.dim).child(cur ? "■" : "□")))
      .when(color !== null, (el) => (color ? el.child(div().relative().child(pip(t, "done", 7).text_color(color))) : el))
      .when(Boolean(hex), (el) => el.child(div().relative().size(8).flex_none().child(dither(`#${hex ?? ""}`, 1))))
      .child(div().relative().flex_1().min_w(0).truncate().child(text))
      .when(Boolean(right) || (cur && !toggle), (el) => el.child(div().relative().flex_none().max_w(220).truncate().text_size(10).text_color(t.dim).child(right || "current")));

  const frame = (title: string, body: Element, w = 380) => v_flex().id("pmenu").absolute().top(36).left(Math.max(0, Math.round((proj.width - w) / 2))).w(w).bg(t.background).border(1).border_color(t.accent)
    .on_mouse_down("left", stop)
    .child(h_flex().relative().h(22).px(8).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.accent, 1)))
      .child(div().relative().truncate().text_color(t.foreground).child(title)))
    .child(body);

  if (m.kind === "value") {
    return frame(m.title, h_flex().h(30).px(8).gap(6).items_center().child(div().text_size(11).text_color(t.accent).child(">"))
      .child(Input.new(proj.valueInput).flex_1().h_full().text_size(12).text_color(t.foreground)));
  }

  if (m.kind === "pick") {
    const top = Math.max(0, Math.min(m.at - 7, m.rows.length - 14));

    return frame(m.title, v_flex().py(4).children(m.rows.slice(top, top + 14).map((r, i) => row(`pm-${top + i}`, r.label, { on: top + i === m.at, dim: r.dim ?? false, right: r.right ?? "" })
      .on_mouse_down("left", stop).on_click((_e, cx) => {
        proj.menu = null;
        r.go(cx);
        proj.app.focusSelf();
        cx.notify();
      }))), 460);
  }

  const item = b.items.find((i) => i.id === m.item);

  if (!item) return div();

  const fields = menuFields(proj, b, m.fields);
  const f = fields[m.at], opts = f ? options(proj, b, item, f) : [];

  const left = v_flex().w(170).flex_none().py(4).border_r(1).border_color(t.ansi0).children(fields.map((x, i) => {
    const v = x.type === "labels" ? String(item.content.labels.length || "") : x.type === "assignees" ? String(item.content.assignees.length || "") : x.type === "title" ? "" : valueText(x, item.values.get(x.id));

    return row(`pmf-${i}`, x.name, { on: i === m.at && m.side === "fields", right: v }).when(i === m.at && m.side !== "fields", (el) => el.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => {
        m.at = i;
        m.side = "opts";
        m.opt = 0;
        cx.notify();
      });
  }));

  const otop = Math.max(0, Math.min(m.opt - 7, opts.length - 14));

  const right = v_flex().flex_1().min_w(0).py(4).children(opts.slice(otop, otop + 14).map((o, i) => row(`pmo-${otop + i}`, o.label, {
    on: m.side === "opts" && otop + i === m.opt, cur: o.on ?? false, dim: o.dim ?? false, right: o.right ?? "", hex: o.hex ?? null, toggle: o.toggle ?? false,
    color: o.color === undefined ? null : ansiColor(t, o.color),
  }).on_mouse_down("left", stop).on_click((_e, cx) => {
    m.side = "opts";
    m.opt = otop + i;

    if (f) choose(proj, item, f, o, cx);

    cx.notify();
  })));

  return frame(`${label(item)} · fields`, h_flex().items_start().child(left).child(right), 460);
}
