// Moving around the agent graph: picking a node, folding a run, zoom and pan
// (kept per session), h j k l through the graph, revealing the selection,
// cycling the working agents, asking an agent.

import type { Context, Point } from "gpui-kit";
import { hc } from "herdr";
import type { AgentNode as AgentNodeOf, GraphNode, PhaseNode, RunNode } from "./graph.ts";
import { dims, ZOOM } from "./graph.ts";
import type { ClaudePane, AgentPick, Step } from "./state.ts";
import { claudePanes, remember } from "./state.ts";
import { poll } from "./reading.ts";
import type { default as Agents } from "./main.ts";
import { panFor } from "./viewport.ts";

/** Folds or opens a run. */
export function flipRun(v: Agents, n: RunNode) {
  if (v.open.has(n.foldKey)) v.open.delete(n.foldKey);
  else v.open.add(n.foldKey);
}

export function pickNode(v: Agents, n: GraphNode | AgentPick, cx: Context, again = true) {
  v.handle?.focus();

  // A second click folds or opens it.
  if (again && n.kind === "run" && v.selected === n.key) flipRun(v, n);

  if (v.selected !== n.key) v.follow = true;

  v.selected = n.key;
  v.detail = null;
  v.busy = 0;
  poll(v, cx);
  cx.notify();
}

export function askAgent(n: AgentNodeOf | RunNode | PhaseNode, pane: ClaudePane) {
  const what = n.kind === "run" ? `the workflow run ${n.run.name} (${n.run.id})`
    : n.kind === "phase" ? `the ${n.label} phase of the workflow ${n.run.name} (${n.run.id})`
    : `the subagent "${n.label}" (${n.key})`;

  hc(["send", pane.terminal, `How is ${what} doing? Brief status, anything blocked or worth my attention.`]).catch(() => null);
}

export function saveState(v: Agents) {
  remember({ zoom: v.zoom, detailH: v.detailH });
}

/** Zooms to z keeping the graph point under `at` (view px; default its centre) where it is. */
export function zoomTo(v: Agents, to: number, at?: Point) {
  const z = Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(to * 100) / 100));

  if (z === v.zoom) return;

  const a = at ?? { x: v.view.width / 2, y: v.view.height / 2 };
  const p = panFor(v, v.graphH ?? 0);
  const k = z / v.zoom;

  v.pan = { x: Math.round(a.x - (a.x - p.x) * k), y: Math.round(a.y - (a.y - p.y) * k) };
  v.zoom = z;
  saveState(v);
}

export function movePan(v: Agents, dx: number, dy: number) {
  const p = panFor(v, v.graphH ?? 0);

  v.pan = { x: p.x + dx, y: p.y + dy };
}

/** Moves the selection: h parent, l first child, j / k next / previous in the column. */
export function stepGraph(v: Agents, dir: Step, cx: Context) {
  const nodes = v.layout ?? [];

  if (!nodes.length) return;

  const cur = nodes.find((n) => n.key === v.selected);
  let next: GraphNode | undefined;

  if (!cur) next = nodes.find((n) => n.kind === "main");
  else if (dir === "h") next = nodes.find((n) => n.children.includes(cur));
  else if (dir === "l") {
    if (cur.kind === "run" && cur.folded) {
      flipRun(v, cur);
      cx.notify();

      return;
    }

    next = cur.children[0];
  } else {
    const col = nodes.filter((n) => n.x === cur.x).sort((a, b) => a.y - b.y);

    next = col[col.indexOf(cur) + (dir === "j" ? 1 : -1)];
  }

  if (!next) return;

  pickNode(v, next, cx, false);
  reveal(v, next);
}

/** Moves the graph so `n` is in view, if it isn't. */
export function reveal(v: Agents, n: GraphNode) {
  const p = panFor(v, v.graphH ?? 0), d = dims(v.zoom), m = 24;
  const x = n.x + p.x, y = n.y + p.y;
  let dx = 0, dy = 0;

  if (x < m) dx = m - x;
  else if (x + d.NW > v.view.width - m) dx = v.view.width - m - x - d.NW;

  if (y < m) dy = m - y;
  else if (y + n.h > v.view.height - m) dy = v.view.height - m - y - n.h;

  if (dx || dy) movePan(v, dx, dy);
}

/** [ / ]: the previous / next session in the toolbar's chips, kept. */
export function cycleAgents(v: Agents, d: number, cx: Context) {
  const list = claudePanes(), cur = v.target();
  const i = list.findIndex((p) => p.terminal === cur?.terminal);
  const p = list[(i + d + list.length) % list.length];

  if (!p) return;

  v.terminal = p.terminal;
  v.pinned = true;
  v.session = null;
  v.busy = 0;
  poll(v, cx);
}
