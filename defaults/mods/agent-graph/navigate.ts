// Moving around the agent graph: picking a node, folding a run, zoom and pan
// (kept per copy), h j k l through the graph, revealing the selection,
// cycling the sessions, asking an agent.

import type { Point } from "gpui-kit";
import { Array as Arr, Match, Option } from "effect";
import { hcOk } from "@fireflies/kit";
import type { AgentNode as AgentNodeOf, GraphNode, PhaseNode, RunNode } from "./graph.ts";
import { dims, ZOOM } from "./graph.ts";
import type { ClaudePane, AgentPick, Step } from "./state.ts";
import { claudePanes, remember } from "./state.ts";
import type { default as Agents } from "./main.ts";
import { panFor } from "./viewport.ts";

/** Folds or opens a run. */
export function flipRun(v: Agents, n: RunNode) {
  if (v.open.has(n.foldKey)) v.open.delete(n.foldKey);
  else v.open.add(n.foldKey);
}

/** Selects `n` (its details: from the next read). `again`: a second click on a run folds or opens it. */
export function select(v: Agents, n: GraphNode | AgentPick, again: boolean): void {
  v.handle?.focus();

  if (again && n.kind === "run" && v.selected === n.key) flipRun(v, n);

  if (v.selected !== n.key) v.follow = true;

  v.selected = n.key;
  v.detail = null;
}

/** Selects `n` and reads its steps now. */
export function pickNode(v: Agents, n: GraphNode | AgentPick, again = true): void {
  select(v, n, again);
  v.poll();
}

/** What `ask` sends about `n`. */
export function askText(n: AgentNodeOf | RunNode | PhaseNode): string {
  const what = Match.value(n).pipe(
    Match.discriminatorsExhaustive("kind")({
      run: (x) => `the workflow run ${x.run.name} (${x.run.id})`,
      phase: (x) => `the ${x.label} phase of the workflow ${x.run.name} (${x.run.id})`,
      agent: (x) => `the subagent "${x.label}" (${x.key})`,
    }),
  );

  return `How is ${what} doing? Brief status, anything blocked or worth my attention.`;
}

/** Asks that Claude Code, in its own terminal, how `n` is doing (a send that fails: a toast says why). */
export function askAgent(v: Agents, n: AgentNodeOf | RunNode | PhaseNode, pane: ClaudePane): void {
  v.fx?.run(hcOk(["send", pane.terminal, askText(n)]), { redraw: false });
}

export function saveState(v: Agents): void {
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
export function stepGraph(v: Agents, dir: Step): void {
  const nodes = v.layout ?? [];

  const next = Option.match(Arr.findFirst(nodes, (n) => n.key === v.selected), {
    onNone: () => Arr.findFirst(nodes, (n) => n.kind === "main"),
    onSome: (cur): Option.Option<GraphNode> => {
      if (dir === "h") return Arr.findFirst(nodes, (n) => n.children.includes(cur));

      if (dir === "l") {
        if (cur.kind === "run" && cur.folded) {
          flipRun(v, cur);

          return Option.none();
        }

        return Arr.head(cur.children);
      }

      const col = Arr.filter(nodes, (n) => n.x === cur.x).sort((a, b) => a.y - b.y);

      return Option.fromUndefinedOr(col[col.indexOf(cur) + (dir === "j" ? 1 : -1)]);
    },
  });

  Option.map(next, (n) => {
    pickNode(v, n, false);
    reveal(v, n);
  });
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

  if (dx !== 0 || dy !== 0) movePan(v, dx, dy);
}

/** [ / ]: the previous / next session in the toolbar's chips, kept. */
export function cycleAgents(v: Agents, d: number): void {
  const list = claudePanes(), cur = v.target();
  const i = Option.getOrElse(Arr.findFirstIndex(list, (p) => p.terminal === cur?.terminal), () => -1);
  const p = list[(i + d + list.length) % list.length];

  if (p === undefined) return;

  showSession(v, p.terminal);
}

/** Shows the Claude Code in `terminal` from now on (kept), read now. */
export function showSession(v: Agents, terminal: string): void {
  v.terminal = terminal;
  v.pinned = true;
  v.session = null;
  v.poll();
}
