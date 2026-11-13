// The agent graph's toolbar and its details panel: the selected agent's feed
// (a virtual list kept at the newest step) and its resizable edge.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list } from "gpui-base";
import { run } from "herdr";
import type { Theme } from "herdr";
import { dither, pip } from "./kit.ts";
import type { Feed, Snapshot } from "./claude.ts";
import { ranFor, span } from "./claude.ts";
import type { GraphNode } from "./graph.ts";
import { TONE, WORDS } from "./graph.ts";
import type { ClaudePane, FeedRow, StatsPick } from "./state.ts";
import { stop, ago } from "./state.ts";
import { chip } from "./paint.ts";
import { poll, startFollowing } from "./reading.ts";
import { askAgent, pickNode } from "./navigate.ts";
import type { default as Agents } from "./main.ts";
import { statsBody, tokens } from "./stats-view.ts";

export function drawToolbar(v: Agents, t: Theme, list: readonly ClaudePane[], pane: ClaudePane | null): Element {
  const counts = v.data ? [...v.data.agents.values()].filter((a) => a.status === "working").length : 0;

  return h_flex().id("ag-toolbar").relative().h(34).flex_none().px(12).gap(6).items_center().text_size(11)
    .child(div().flex_none().pr(4).text_color(t.ansi8).child("AGENTS"))
    .child(h_flex().id("ag-sessions").flex_1().min_w(0).gap(2).items_center().overflow_x_scroll()
      .children(list.map((p) => {
        const on = p.terminal === pane?.terminal;

        return h_flex().id(`ag-s-${p.terminal}`).relative().flex_none().h(20).px(6).gap(6).items_center()
          .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            v.terminal = p.terminal;
            v.pinned = true;
            v.session = null;
            v.busy = 0;
            poll(v, cx);
            cx.notify();
          })
          .when(on, (el) => el.child(dither(t.ansi0, 1)))
          .child(div().relative().child(pip(t, p.status, 5)))
          .child(div().relative().max_w(140).truncate().child(p.name));
      })))
    .when(counts > 0, (el) => el.child(div().flex_none().text_color(t.working).child(`${counts} working`)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/**
 * The selected agent's steps, oldest first, newest at the bottom (where
 * follow keeps it). A virtual list, so the scroll handle can move it: rows
 * get fixed heights, text wrapping to at most a few lines (cut off past them).
 */
export function feedList(v: Agents, t: Theme, f: Feed | null): Element {
  if (!f) return div().id("ag-feed").flex_1().px(12).py(6).text_size(11).text_color(t.dim).child("reading…");

  const rows: FeedRow[] = [...(f.task ? [{ kind: "task", text: f.task } as const] : []), ...f.items.slice(-150)];
  // Roughly how many characters fit on a line (Departure Mono: ~0.6em wide).
  const perLine = Math.max(20, Math.floor((v.view.width - 24) / 6.6));
  const lines = (text: string, max: number) => Math.min(max, Math.max(1, Math.ceil(text.length / perLine)));
  const LINE = 15;

  const height = (x: FeedRow) => x.kind === "task" ? 20 + lines(x.text, 5) * LINE
    : x.kind === "tool" ? 19 : x.kind === "result" ? 17 : 6 + lines(x.text, 4) * LINE;

  const row = (x: FeedRow, i: number): Element => {
    const box = div().id(`f-${i}`).h(height(x)).overflow_hidden();

    if (x.kind === "task") {
      return box.px(12).pt(4).child(div().text_size(10).text_color(t.ansi8).child("TASK"))
        .child(div().text_size(11).text_color(t.muted).child(x.text));
    }

    if (x.kind === "tool") {
      return box.child(h_flex().h_full().px(12).gap(6).items_center().text_size(11)
        .child(div().flex_none().text_color(t.accent).child(`▸ ${x.name}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.text)));
    }

    if (x.kind === "result") {
      return box.pl(24).pr(12).truncate().text_size(10).text_color(x.error ? t.blocked : t.dim).child(`↳ ${x.text || "(no output)"}`);
    }

    return box.px(12).pt(3).text_size(11).text_color(x.kind === "prompt" ? t.muted : t.foreground).child(x.text);
  };

  const last = rows.length - 1;

  const list = v_virtual_list("ag-feed", rows.length, rows.map(height), (i) => `${i}`, (range) => {
    if (range.end - 1 >= last) v.lastDrawn = Date.now();

    const out: Element[] = [];

    for (let i = range.start; i < range.end; i++) {
      const x = rows[i];

      if (x) out.push(row(x, i));
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
        cx.timer.after(60, (cx) => {
          if (Date.now() - v.lastDrawn < 250) {
            v.follow = true;
            cx.notify();
          }
        });
      }
    })
    .child(v.feedScroll ? list.track_scroll(v.feedScroll) : list);
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
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1))), statsBody(v, t, data));
  }

  const color = t[TONE[n.status]];

  const head = h_flex().id("ag-detail-head").relative().h(30).flex_none().px(12).gap(8).items_center().text_size(11)
    .child(div().flex_none().w(8).h(8).relative().child(dither(color, 1)))
    .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(n.label))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim)
      .child([n.kind === "main" ? "session" : n.kind, WORDS[n.status], v.detail?.model?.replace(/^claude-/, ""),
        n.kind === "agent" ? `${n.status === "working" ? "for" : "ran"} ${span(ranFor(n.agent))}` : n.kind === "main" && data.mainStarted ? `started ${ago(data.mainStarted)}` : null,
        n.kind === "agent" && n.agent.changed && n.status !== "working" ? ago(n.agent.changed) : null,
        tokens(v, n.kind === "main" ? data.main : n.kind === "agent" ? n.agent.file : null)].filter(Boolean).join(" · ")))
    .when(n.kind === "agent" || n.kind === "main", (el) => el.child(chip(t, "ag-follow", v.follow ? "● follow" : "○ follow",
      (cx) => {
        if (v.follow) v.follow = false;
        else startFollowing(v);

        cx.notify();
      }, v.follow ? t.accent : t.dim)))
    .child(chip(t, "ag-focus", "focus", () => run("pane.focus", { pane: pane.pane })))
    .when(n.kind !== "main", (el) => (n.kind === "main" ? el : el.child(chip(t, "ag-ask", "ask", () => askAgent(n, pane), t.accent))))
    .child(chip(t, "ag-close", "×", (cx) => {
      v.selected = null;
      v.detail = null;
      cx.notify();
    }))
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

  if (n.kind === "run" || n.kind === "phase") {
    const r = n.run;
    const ids = n.kind === "run" ? r.agents : r.agents.filter((id) => data.agents.get(id)?.phase === n.label);

    const body = v_flex().id("ag-run").flex_1().min_h(0).px(12).py(6).gap(3).overflow_y_scroll().text_size(11)
      .when(n.kind === "run" && Boolean(r.summary), (el) => el.child(div().pb(4).text_color(t.muted).child(r.summary)))
      .when(n.kind === "run", (el) => el.child(div().pb(4).text_color(t.dim).child(`phases: ${r.phases.join(" → ") || "-"}`)))
      .children(ids.flatMap((id) => data.agents.get(id) ?? []).map((a) =>
        h_flex().id(`ag-r-${a.id}`).gap(8).items_center().hover((s) => s.bg(`${t.ansi0}55`))
          .on_click((_e, cx) => pickNode(v, { key: a.id, kind: "agent" }, cx))
          .child(div().w(6).h(6).flex_none().relative().child(dither(t[TONE[a.status]], 1)))
          .child(div().w(54).flex_none().truncate().text_color(t.dim).child(a.phase ?? ""))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.label))
          .child(div().flex_none().text_color(t.dim).child(tokens(v, a.file) ?? ""))
          .child(div().w(64).flex_none().text_color(a.status === "working" ? t.working : t.muted).child(span(ranFor(a))))
          .child(div().w(54).flex_none().text_color(t[TONE[a.status]]).child(WORDS[a.status]))));

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
    .child(div().absolute().left(0).right(0).top(3).h(1).when(Boolean(v.resizing), (el) => el.bg(t.accent)));

  const panel = v_flex().id("ag-detail").relative().flex_none().bg(t.background).child(head).child(body).child(edge);

  return v.detailH ? panel.h(v.detailH) : panel.h_1_2();
}
