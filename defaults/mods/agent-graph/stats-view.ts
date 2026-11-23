// The agent graph's stats: the tokens and cost of a session's agents, their
// totals, the strip over the graph and the stats node's body.

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { Array as Arr, Option, String as Str } from "effect";
import { dither } from "./kit.ts";
import type { Agent, Snapshot, Usage } from "./claude.ts";
import { ranFor, span, count, emptyUsage, addUsage } from "./claude.ts";
import { toneOf, WORDS } from "./graph.ts";
import type { StatsGroup } from "./state.ts";
import { STATS, stop, money } from "./state.ts";
import { pickNode } from "./navigate.ts";
import type { default as Agents } from "./main.ts";
import { edge } from "@fireflies/tones";

/** "41.2k tok · $0.82" for a transcript, once its tokens are known. */
export function tokens(v: Agents, file: string | null): string | null {
  const u = file === null ? null : v.usage?.get(file) ?? null;

  if (u === null || u.tokens === 0) return null;

  return `${count(u.tokens)} tok · ${money(u)}`;
}

/** Every agent of the session together, and the session itself. */
export function totals(v: Agents) {
  const list = v.data === null ? [] : Arr.fromIterable(v.data.agents.values());
  const by = (st: Agent["status"]) => Arr.filter(list, (a) => a.status === st).length;
  const sub = emptyUsage(), all = emptyUsage();

  for (const a of list) addUsage(sub, v.usage?.get(a.file));

  addUsage(all, sub);

  if (v.data !== null) addUsage(all, v.usage?.get(v.data.main));

  return {
    n: list.length, working: by("working"), done: by("done"), stopped: by("stopped") + by("idle"),
    time: Arr.reduce(list, 0, (k, a) => k + ranFor(a, v.now)),
    wall: v.data === null || v.data.mainStarted === 0 ? 0 : v.now - v.data.mainStarted,
    sub, all,
  };
}

/** The strip under the toolbar: counts, time, tokens, cost. Click: each agent's share. */
export function statsStrip(v: Agents, t: Theme): Element {
  const s = totals(v);
  const on = v.selected === STATS;
  const part = (color: Color, text: string) => div().flex_none().text_color(color).child(text);
  const sep = () => div().flex_none().text_color(edge(t)).child("│");

  return h_flex().id("ag-stats").relative().h(26).flex_none().px(12).gap(8).items_center().text_size(11).overflow_hidden()
    .hover((st) => st.bg(`${edge(t)}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      v.selected = on ? null : STATS;
      v.detail = null;
      cx.notify();
    })
    .when(on, (el) => el.child(dither(edge(t), 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
    .child(div().relative().flex_none().text_color(t.muted).child("ALL"))
    .child(part(t.foreground, `${s.n} agent${s.n === 1 ? "" : "s"}`).relative())
    .when(s.working > 0, (el) => el.child(part(t.working, `${s.working} working`).relative()))
    .when(s.done > 0, (el) => el.child(part(t.done, `${s.done} done`).relative()))
    .when(s.stopped > 0, (el) => el.child(part(t.muted, `${s.stopped} stopped`).relative()))
    .child(sep().relative())
    .child(part(t.muted, `Σ ${span(s.time)}`).relative().tooltip("the agents' run times added up"))
    .when(s.wall > 0, (el) => el.child(part(t.dim, `wall ${span(s.wall)}`).relative().tooltip("since the session started")))
    .when(s.all.tokens > 0, (el) => el.child(sep().relative())
      .child(part(t.muted, `${count(s.all.tokens)} tok`).relative()
        .tooltip(`in ${count(s.all.input)} · out ${count(s.all.output)} · cache write ${count(s.all.cache5m + s.all.cache1h)} · cache read ${count(s.all.cacheRead)}`))
      .child(part(t.foreground, money(s.all)).relative().tooltip("at Anthropic's API list prices; the session and every agent")))
    .child(div().flex_1())
    .child(div().relative().flex_none().text_color(on ? t.accent : t.dim).child(on ? "× close" : "s · breakdown"))
    .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(edge(t)));
}

/** A transcript's tokens and cost cells ("–" until it has any). */
const priced = (u: Usage | null | undefined): readonly string[] => (u === null || u === undefined || u.tokens === 0 ? ["–", "–"] : [count(u.tokens), money(u)]);

/** Each agent's share, grouped by run (the session's own first), with totals. */
export function statsBody(v: Agents, t: Theme, d: Snapshot): Element {
  const s = totals(v);

  const cols = (id: string, color: Color, cells: readonly (Element | string)[]) => h_flex().id(id).h(20).flex_none().gap(8).items_center().text_color(color)
    .child(div().flex_1().min_w(0).truncate().child(cells[0] ?? ""))
    .child(div().w(70).flex_none().child(cells[1] ?? ""))
    .child(div().w(64).flex_none().child(cells[2] ?? ""))
    .child(div().w(64).flex_none().child(cells[3] ?? ""))
    .child(div().w(56).flex_none().child(cells[4] ?? ""));

  const row = (a: Agent) => {
    const u = v.usage?.get(a.file);

    return h_flex().id(`ag-st-${a.id}`).gap(6).items_center().hover((st) => st.bg(`${edge(t)}55`))
      .on_click((_e, cx) => {
        pickNode(v, { key: a.id, kind: "agent" });
        cx.notify();
      })
      .child(div().w(6).h(6).flex_none().relative().child(dither(toneOf(t, a.status), 1)))
      .child(div().flex_1().min_w(0).child(cols(`ag-stc-${a.id}`, t.muted, [
        div().truncate().text_color(t.foreground).child(a.label),
        div().text_color(toneOf(t, a.status)).child(WORDS[a.status]),
        div().text_color(a.status === "working" ? t.working : t.muted).child(span(ranFor(a, v.now))),
        ...priced(u)])));
  };

  const agents = Arr.fromIterable(d.agents.values()).sort((a, b) => a.started - b.started);
  const own = Arr.filter(agents, (a) => a.run === null);
  const ownGroup: readonly StatsGroup[] = own.length > 0 ? [{ id: "own", name: "the session's subagents", list: own }] : [];

  const groups: readonly StatsGroup[] = [
    ...ownGroup,
    ...Arr.map(d.runs, (r) => ({ id: r.id, name: `${r.name} · ${span((r.ended ?? v.now) - r.started)}`, list: Arr.flatMap(r.agents, (id) => Option.toArray(Option.fromUndefinedOr(d.agents.get(id)))) })),
  ];

  const head = (g: StatsGroup) => h_flex().id(`ag-stg-${g.id}`).pt(6).pb(2).gap(8).items_center()
    .child(div().flex_none().text_size(10).text_color(t.muted).child(Str.toUpperCase(g.name)))
    .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.muted, 1)));

  const main = v.usage?.get(d.main);

  return v_flex().id("ag-stats-body").flex_1().min_h(0).px(12).py(6).gap(2).overflow_y_scroll().text_size(11)
    .child(h_flex().gap(6).pl(12).child(div().flex_1().child(cols("ag-st-head", t.muted, ["agent", "status", "time", "tokens", "cost"]))))
    .child(h_flex().id("ag-st-main").gap(6).items_center()
      .child(div().w(6).h(6).flex_none())
      .child(div().flex_1().min_w(0).child(cols("ag-stc-main", t.muted, [
        div().truncate().text_color(t.foreground).child("the session itself"), "", s.wall === 0 ? "–" : span(s.wall),
        ...priced(main)]))))
    .children(Arr.flatMap(groups, (g) => [head(g), ...Arr.map(g.list, row)]))
    .child(div().h(2).mt(6).relative().child(dither(edge(t), 1)))
    .child(h_flex().gap(6).pl(12).child(div().flex_1().child(cols("ag-st-sum", t.foreground, [
      `${s.n} agents · ${s.working} working · ${s.done} done · ${s.stopped} stopped`, "", span(s.time), count(s.all.tokens), money(s.all)]))))
    .child(div().pt(4).text_size(10).text_color(t.dim).child(`agents alone: ${count(s.sub.tokens)} tok · ${money(s.sub)} · costs at API list prices${s.all.unpriced ? "; a model without a price is left out" : ""}`));
}
