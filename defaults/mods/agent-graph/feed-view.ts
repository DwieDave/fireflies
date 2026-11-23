// The agent graph's toolbar and its details panel: the selected agent's feed
// (a virtual list kept at the newest step) and its resizable edge.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list } from "gpui-base";
import type { Theme } from "herdr";
import { Array as Arr, Option, String as Str } from "effect";
import { pip } from "./kit.ts";
import { dithered, fill, pick, rule } from "@fireflies/look";
import type { Feed, Snapshot } from "./claude.ts";
import { ranFor, span } from "./claude.ts";
import type { GraphNode } from "./graph.ts";
import { toneOf, WORDS } from "./graph.ts";
import type { ClaudePane, FeedRow, StatsPick } from "./state.ts";
import { stop, ago } from "./state.ts";
import { chip } from "./paint.ts";
import { startFollowing } from "./reading.ts";
import { askAgent, pickNode, showSession } from "./navigate.ts";
import type { default as Agents } from "./main.ts";
import { statsBody, tokens } from "./stats-view.ts";
import { edge as edgeTone } from "@fireflies/tones";

export function drawToolbar(v: Agents, t: Theme, list: readonly ClaudePane[], pane: ClaudePane | null): Element {
  const counts = v.data === null ? 0 : Arr.filter(Arr.fromIterable(v.data.agents.values()), (a) => a.status === "working").length;

  return h_flex().id("ag-toolbar").relative().h(34).flex_none().px(12).gap(6).items_center().text_size(11)
    .child(div().flex_none().pr(4).text_color(pick(t.muted, t.dim)).child(pick("AGENTS", "Agents")))
    .child(h_flex().id("ag-sessions").flex_1().min_w(0).gap(2).items_center().overflow_x_scroll()
      .children(Arr.map(list, (p) => {
        const on = p.terminal === pane?.terminal;

        return h_flex().id(`ag-s-${p.terminal}`).relative().flex_none().h(20).px(6).gap(6).items_center()
          .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            showSession(v, p.terminal);
            cx.notify();
          })
          .when(on, (el) => (dithered() ? el.child(fill(edgeTone(t), 1)) : el.bg(t.selected).rounded(6)))
          .child(div().relative().child(pip(t, p.status, 5)))
          .child(div().relative().max_w(140).truncate().child(p.name));
      })))
    .when(counts > 0, (el) => el.child(div().flex_none().text_color(t.working).child(`${counts} working`)))
    .child(rule(t, "bottom"));
}

/**
 * The selected agent's steps, oldest first, newest at the bottom (where
 * follow keeps it). A virtual list, so the scroll handle can move it: rows
 * get fixed heights, text wrapping to at most a few lines (cut off past them).
 */
export function feedList(v: Agents, t: Theme, f: Feed | null): Element {
  if (f === null) return div().id("ag-feed").flex_1().px(12).py(6).text_size(11).text_color(t.dim).child("reading…");

  const task: readonly FeedRow[] = Str.isNonEmpty(f.task) ? [{ kind: "task", text: f.task }] : [];
  const rows: readonly FeedRow[] = [...task, ...f.items.slice(-150)];
  // Roughly how many characters fit on a line (Departure Mono: ~0.6em wide; the plain look's UI font a little narrower).
  const perLine = Math.max(20, Math.floor((v.view.width - 24) / pick(6.6, 6)));
  const lines = (text: string, max: number) => Math.min(max, Math.max(1, Math.ceil(text.length / perLine)));
  const LINE = 15;

  const height = (x: FeedRow): number => {
    if (x.kind === "task") return 20 + lines(x.text, 5) * LINE;

    if (x.kind === "tool") return 19;

    return x.kind === "result" ? 17 : 6 + lines(x.text, 4) * LINE;
  };

  const row = (x: FeedRow, i: number): Element => {
    const box = div().id(`f-${i}`).h(height(x)).overflow_hidden();

    if (x.kind === "task") {
      return box.px(12).pt(4).child(div().text_size(10).text_color(pick(t.muted, t.dim)).child(pick("TASK", "Task")))
        .child(div().text_size(11).text_color(t.muted).child(x.text));
    }

    if (x.kind === "tool") {
      return box.child(h_flex().h_full().px(12).gap(6).items_center().text_size(11)
        .child(div().flex_none().text_color(t.accent).child(`▸ ${x.name}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.text)));
    }

    if (x.kind === "result") {
      return box.pl(24).pr(12).truncate().text_size(10).text_color(x.error ? t.blocked : t.dim).child(`↳ ${Str.isNonEmpty(x.text) ? x.text : "(no output)"}`);
    }

    return box.px(12).pt(3).text_size(11).text_color(x.kind === "prompt" ? t.muted : t.foreground).child(x.text);
  };

  const last = rows.length - 1;

  const list = v_virtual_list("ag-feed", rows.length, Arr.map(rows, height), (i) => `${i}`, (range) => {
    if (range.end - 1 >= last) v.lastDrawn = v.now;

    const out: Element[] = [];

    for (let i = range.start; i < range.end; i++) {
      const x = rows[i];

      if (x !== undefined) out.push(row(x, i));
    }

    return out;
  }).size_full();

  return div().id("ag-feed-box").relative().flex_1().min_h(0)
    .on_scroll_wheel((e, cx) => {
      const dy = e.delta.y;

      if (dy > 0 && v.follow) {
        v.follow = false;
        cx.notify();
      } else if (dy < 0 && !v.follow) {
        // Scrolled down to the newest step: follow again.
        v.followIfAtEnd();
      }
    })
    .child(v.feedScroll !== null ? list.track_scroll(v.feedScroll) : list);
}

/** The transcript behind a node: the session's, an agent's; none for a run or a phase. */
function transcriptOf(n: GraphNode, data: Snapshot): string | null {
  if (n.kind === "main") return data.main;

  return n.kind === "agent" ? n.agent.file : null;
}

/** What the selected node is: a run's or phase's agents, else its transcript. */
export function details(v: Agents, t: Theme, n: GraphNode | StatsPick, pane: ClaudePane, data: Snapshot): Element {
  if (n.kind === "stats") {
    return drawPanel(v, t, h_flex().id("ag-detail-head").relative().h(30).flex_none().px(12).gap(8).items_center().text_size(11)
      .child(div().flex_none().text_color(t.foreground).child("Every agent"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child("time, tokens and cost, by run"))
      .child(chip(t, "ag-close", "×", (cx) => {
        v.selected = null;
        cx.notify();
      }))
      .child(rule(t, "top")), statsBody(v, t, data));
  }

  const color = toneOf(t, n.status);

  const said = Arr.filter([
    n.kind === "main" ? "session" : n.kind, WORDS[n.status], Str.replace(/^claude-/, "")(v.detail?.model ?? ""),
    n.kind === "agent" ? `${n.status === "working" ? "for" : "ran"} ${span(ranFor(n.agent, v.now))}` : "",
    n.kind === "main" && data.mainStarted !== 0 ? `started ${ago(data.mainStarted, v.now)}` : "",
    n.kind === "agent" && n.agent.changed !== 0 && n.status !== "working" ? ago(n.agent.changed, v.now) : "",
    tokens(v, transcriptOf(n, data)) ?? "",
  ], Str.isNonEmpty);

  const head = h_flex().id("ag-detail-head").relative().h(30).flex_none().px(12).gap(8).items_center().text_size(11)
    .child(div().flex_none().w(8).h(8).relative().child(fill(color, 1)))
    .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(n.label))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(Arr.join(said, " · ")))
    .when(n.kind === "agent" || n.kind === "main", (el) => el.child(chip(t, "ag-follow", v.follow ? "● follow" : "○ follow",
      (cx) => {
        if (v.follow) v.follow = false;
        else startFollowing(v);

        cx.notify();
      }, v.follow ? t.accent : t.dim)))
    .child(chip(t, "ag-focus", "focus", () => v.focusTerminal(pane)))
    .when(n.kind !== "main", (el) => (n.kind === "main" ? el : el.child(chip(t, "ag-ask", "ask", () => askAgent(v, n, pane), t.accent))))
    .child(chip(t, "ag-close", "×", (cx) => {
      v.selected = null;
      v.detail = null;
      cx.notify();
    }))
    .child(rule(t, "top"));

  if (n.kind === "run" || n.kind === "phase") {
    const r = n.run;
    const ids = n.kind === "run" ? r.agents : Arr.filter(r.agents, (id) => data.agents.get(id)?.phase === n.label);

    const body = v_flex().id("ag-run").flex_1().min_h(0).px(12).py(6).gap(3).overflow_y_scroll().text_size(11)
      .when(n.kind === "run" && Str.isNonEmpty(r.summary), (el) => el.child(div().pb(4).text_color(t.muted).child(r.summary)))
      .when(n.kind === "run", (el) => el.child(div().pb(4).text_color(t.dim).child(`phases: ${r.phases.length === 0 ? "-" : Arr.join(r.phases, " → ")}`)))
      .children(Arr.map(Arr.flatMap(ids, (id) => Option.toArray(Option.fromUndefinedOr(data.agents.get(id)))), (a) =>
        h_flex().id(`ag-r-${a.id}`).gap(8).items_center().hover((s) => s.bg(`${edgeTone(t)}55`))
          .on_click((_e, cx) => {
            pickNode(v, { key: a.id, kind: "agent" });
            cx.notify();
          })
          .child(div().w(6).h(6).flex_none().relative().child(fill(toneOf(t, a.status), 1)))
          .child(div().w(54).flex_none().truncate().text_color(t.dim).child(a.phase ?? ""))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.label))
          .child(div().flex_none().text_color(t.dim).child(tokens(v, a.file) ?? ""))
          .child(div().w(64).flex_none().text_color(a.status === "working" ? t.working : t.muted).child(span(ranFor(a, v.now))))
          .child(div().w(54).flex_none().text_color(toneOf(t, a.status)).child(WORDS[a.status]))));

    return drawPanel(v, t, head, body);
  }

  return drawPanel(v, t, head, feedList(v, t, v.detail));
}

/** The details panel: a head, a body, and the edge above them that resizes it. */
export function drawPanel(v: Agents, t: Theme, head: Element, body: Element): Element {
  // The edge above the details: drag it to resize them.
  const edge = div().id("ag-detail-edge").absolute().left(0).right(0).top(-3).h(7).cursor_row_resize()
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      v.resizing = { y: e.position.y, from: v.detailH ?? Math.round(v.paneH / 2) };
      cx.notify();
    })
    .child(div().absolute().left(0).right(0).top(3).h(1).when(v.resizing !== null, (el) => el.bg(t.accent)));

  const panel = v_flex().id("ag-detail").relative().flex_none().bg(t.background).child(head).child(body).child(edge);

  return v.detailH === null ? panel.h_1_2() : panel.h(v.detailH);
}
