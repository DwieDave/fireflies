// The graph: a Claude Code session's agents as a constellation, left to
// right: the session, then what it spawned (subagents and workflow runs),
// then a run's phases, then the agents in each. Drag to move it, zoom with
// +/- or cmd-scroll. Lines are dithered; a line
// into something working carries a pulse, working nodes breathe, and the
// phase a running workflow is in sits on a blue band marked "now".
// Older finished runs fold to one node (click twice to open them).

import { div, svg } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Status, Theme } from "herdr";
import { ART, dither, pip } from "./kit.ts";
import type { Agent, Run, Snapshot } from "./claude.ts";
import { ranFor, span } from "./claude.ts";

// Sizes at zoom 1; dims(z) scales them (zooming lays the graph out again,
// text and all, so it stays crisp).
export const ZOOM = { min: 0.5, max: 1.8, step: 1.15 };

/** Layout sizes at zoom z. */
export function dims(z = 1) {
  const r = (v: number) => Math.round(v * z);
  const NW = r(210), GAP_X = r(52);

  return { z, NW, NH: r(34), PH: r(24), GAP_X, GAP_Y: r(10), PAD: 24, COL: NW + GAP_X, text: 11 * z, small: 10 * z, icon: r(14) };
}

export type Dims = ReturnType<typeof dims>;

/** What a node can be doing: an agent's, a run's or a phase's status, or the session's. */
export type NodeStatus = "working" | "blocked" | "done" | "failed" | "killed" | "stopped" | "idle" | "waiting" | "pending";

/** The theme colors a status is drawn in. */
type Tone = "working" | "blocked" | "done" | "ansi8" | "muted" | "ansi0";

/** Status -> theme color name. */
export const TONE = { working: "working", blocked: "blocked", done: "done", failed: "blocked", killed: "ansi8", stopped: "ansi8", idle: "muted", waiting: "muted", pending: "ansi0" } as const satisfies { readonly [S in NodeStatus]: Tone };

export const WORDS = { working: "working", done: "done", failed: "failed", killed: "stopped", stopped: "stopped", idle: "quiet", waiting: "waiting", pending: "not started", blocked: "needs you" } as const satisfies { readonly [S in NodeStatus]: string };

const shortModel = (m: string | null) => (m ?? "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");

/** What every node has; x, y and h are set when it is placed, rel (its top under its
 *  parent's) while it is laid out. */
interface NodeBase {
  readonly key: string;
  readonly label: string;
  readonly sub: string;
  readonly status: NodeStatus;
  readonly children: readonly GraphNode[];
  x: number;
  y: number;
  h: number;
  rel: number;
}

/** The session itself, the graph's root. */
export interface MainNode extends NodeBase {
  readonly kind: "main";
}

/** A subagent. */
export interface AgentNode extends NodeBase {
  readonly kind: "agent";
  readonly agent: Agent;
  readonly time: string;
}

/** A workflow run: folded (its phases hidden) or open; `foldKey` is what `open` holds for it. */
export interface RunNode extends NodeBase {
  readonly kind: "run";
  readonly run: Run;
  readonly folded: boolean;
  readonly foldKey: string;
  readonly time: string;
}

/** A phase of a run; `now` for the one a running workflow is in. */
export interface PhaseNode extends NodeBase {
  readonly kind: "phase";
  readonly run: Run;
  readonly now: boolean;
}

export type GraphNode = MainNode | AgentNode | RunNode | PhaseNode;

/** What the session node says: its name, a line under it, its status. */
export interface MainLabel {
  readonly label: string;
  readonly sub: string;
  readonly status: Status;
}

/** Not placed yet. */
const UNPLACED = { x: 0, y: 0, h: 0, rel: 0 };

/** The tree for a snapshot: the session, what it spawned, a run's phases and their agents. */
export function tree(data: Snapshot, main: MainLabel, open: ReadonlySet<string>): MainNode {
  // Every list of children in the order they started.
  const byStart = (a: { readonly started: number }, b: { readonly started: number }) => a.started - b.started;
  const agents = [...data.agents.values()].sort(byStart);

  const agentNode = (a: Agent): AgentNode => ({
    ...UNPLACED, key: a.id, kind: "agent", agent: a, label: a.label, status: a.status, time: span(ranFor(a)),
    sub: [a.run ? null : a.type, shortModel(a.model), WORDS[a.status]].filter(Boolean).join(" · "),
    children: agents.filter((x) => !x.run && x.parent === a.id).map(agentNode),
  });

  const runNode = (r: Run): RunNode => {
    const list = r.agents.flatMap((id) => data.agents.get(id) ?? []);
    const done = list.filter((a) => a.status === "done").length;
    const status = r.status === "running" ? "working" : r.status === "completed" ? "done" : r.status === "failed" ? "failed" : "stopped";
    // The phase it's in: the last one with an agent working.
    const now = r.status === "running" ? [...r.phases].reverse().find((p) => list.some((a) => a.phase === p && a.status === "working")) : null;
    // Running runs and the latest one start open; "-<id>" in `open` folds those, "<id>" opens others.
    const byDefault = r.status === "running" || r.id === data.runs[data.runs.length - 1]?.id;
    const show = byDefault ? !open.has(`-${r.id}`) : open.has(r.id);

    return {
      ...UNPLACED, key: r.id, kind: "run", run: r, label: r.name, status, folded: !show, foldKey: byDefault ? `-${r.id}` : r.id,
      time: span((r.ended ?? Date.now()) - r.started),
      sub: `${done}/${list.length} done · ${r.phases.length} phase${r.phases.length === 1 ? "" : "s"}${r.status === "running" ? "" : ` · ${WORDS[status]}`}`,
      children: !show ? [] : r.phases.map((p): PhaseNode => {
        const inPhase = list.filter((a) => a.phase === p).sort(byStart);

        const ps = !inPhase.length ? (r.status === "running" ? "pending" : "stopped")
          : inPhase.some((a) => a.status === "working") ? "working"
          : inPhase.every((a) => a.status === "done") ? "done" : r.status === "running" ? "waiting" : "stopped";

        return { ...UNPLACED, key: `${r.id}/${p}`, kind: "phase", label: p, status: ps, now: p === now, run: r,
          sub: inPhase.length ? `${inPhase.filter((a) => a.status === "done").length}/${inPhase.length}` : "", children: inPhase.map(agentNode) };
      }),
    };
  };

  return {
    ...UNPLACED, key: "main", kind: "main", label: main.label, sub: main.sub, status: main.status,
    // Workflow runs and the session's own subagents, interleaved by start.
    children: [...data.runs, ...agents.filter((a) => !a.run && a.parent === "main")].sort(byStart)
      .map((x) => ("phases" in x ? runNode(x) : agentNode(x))),
  };
}

/** Whether something under n (or n itself) is working: where the activity is. */
function live(n: GraphNode): boolean {
  return n.status === "working" || n.children.some(live);
}

/**
 * The child a parent lines up with, so the line between them is straight:
 * the one leading to the current work, else an opened run (one with
 * children), else the middle one.
 */
function anchor(n: GraphNode): GraphNode | undefined {
  const c = n.children;

  return c.find((x) => x.status === "working" && live(x)) ?? c.find(live)
    ?? (n.kind === "main" ? c.find((x) => x.kind === "run" && x.children.length) : undefined)
    ?? c[Math.floor((c.length - 1) / 2)];
}

/** Per level of a subtree: its [top, bottom]. */
type Outline = (readonly [number, number])[];

/** The laid-out graph: every node (placed), and its size. */
export interface Placed {
  readonly nodes: readonly GraphNode[];
  readonly width: number;
  readonly height: number;
}

/**
 * Positions every node at zoom d, a level per column (a contour tree
 * layout). Each node sits level with its anchor child, inside its own bunch
 * of children, so its line only spans its own: whose task is whose stays
 * clear. Sibling subtrees pack as close as their outlines allow, level by
 * level, like grapes: a leaf tucks in beside a sibling's deep subtree
 * instead of below all of it. Bunches of different parents keep a wider gap.
 */
export function place(root: GraphNode, d: Dims = dims()): Placed {
  const GROUP = Math.round(d.GAP_Y * 2.5); // between bunches of different parents
  const nodes: GraphNode[] = [];
  let depth = 0;

  // Lays out n's subtree with n's top at 0; returns its outline: per level
  // below n (0 = n itself), [top, bottom]. Children get c.rel (top, relative to n's).
  const lay = (n: GraphNode, level: number): Outline => {
    depth = Math.max(depth, level);
    n.x = d.PAD + level * d.COL;
    n.h = n.kind === "phase" ? d.PH : d.NH;
    nodes.push(n);

    if (!n.children.length) return [[0, n.h]];

    const merged: Outline = []; // children's outline, in the first child's frame
    const offs: number[] = [];

    for (const c of n.children) {
      const outline = lay(c, level + 1);
      let off = 0;

      if (offs.length) {
        off = -Infinity;

        for (let k = 0; k < Math.min(merged.length, outline.length); k++) {
          const m = merged[k], o = outline[k];

          if (m && o) off = Math.max(off, m[1] + (k === 0 ? d.GAP_Y : GROUP) - o[0]);
        }
      }

      offs.push(off);
      outline.forEach(([top, bottom], k) => {
        const m = merged[k];

        merged[k] = m ? [Math.min(m[0], top + off), Math.max(m[1], bottom + off)] : [top + off, bottom + off];
      });
    }

    // Level with the anchor child: its centre is n's centre.
    const a = anchor(n);
    const ai = a ? n.children.indexOf(a) : 0;
    const base = Math.round(n.h / 2) - ((offs[ai] ?? 0) + Math.round((n.children[ai]?.h ?? 0) / 2));

    n.children.forEach((c, k) => {
      c.rel = (offs[k] ?? 0) + base;
    });

    return [[0, n.h], ...merged.map(([top, bottom]): readonly [number, number] => [top + base, bottom + base])];
  };

  const outline = lay(root, 0);
  const top = Math.min(...outline.map((o) => o[0])), bottom = Math.max(...outline.map((o) => o[1]));

  const put = (n: GraphNode, y: number) => {
    n.y = y;

    for (const c of n.children) put(c, y + c.rel);
  };

  put(root, d.PAD - top);

  return { nodes, width: d.PAD * 2 + depth * d.COL + d.NW, height: bottom - top + d.PAD * 2 };
}

/** A dithered line segment. */
function seg(color: Color, x: number, y: number, w: number, h: number): Element {
  return div().absolute().left(x).top(y).w(Math.max(1, w)).h(Math.max(1, h)).child(dither(color, 1));
}

/** Lines from a parent to its children, elbowed at the gap's middle. */
function edges(t: Theme, n: GraphNode, d: Dims): Element[] {
  if (!n.children.length) return [];

  const out: Element[] = [];
  const px = n.x + d.NW, py = n.y + Math.round(n.h / 2);
  const mid = px + Math.round(d.GAP_X / 2);
  const live = n.children.some((c) => c.status === "working");
  const ys = n.children.map((c) => c.y + Math.round(c.h / 2));
  const top = Math.min(py, ...ys), bottom = Math.max(py, ...ys);

  out.push(seg(live ? t.working : t.ansi8, px, py - 1, mid - px, 2));
  out.push(seg(t.ansi8, mid - 1, top - 1, 2, bottom - top + 2));

  for (const c of n.children) {
    const cy = c.y + Math.round(c.h / 2);
    const color = t[TONE[c.status]];

    out.push(seg(c.status === "pending" ? t.ansi0 : c.status === "working" ? color : t.ansi8, mid, cy - 1, c.x - mid, 2));

    // A pulse running into what's working.
    if (c.status === "working") {
      out.push(div().absolute().top(cy - 2).w(6).h(4).bg(color)
        .loop("left", { from: mid, to: c.x - 6, period: 1100, easing: "linear" }));
    }
  }

  return out;
}

/** What a node's pip shows: the statuses a pip has a color for, else nothing. */
const pipStatus = (s: NodeStatus): Status | null => (s === "working" || s === "done" || s === "blocked" ? s : null);

/** Hands a picked node (and the event's context) on. */
export type OnPick = (n: GraphNode, cx: Context) => void;

/** One node at zoom d. */
function node(t: Theme, n: GraphNode, selected: string | null, onPick: OnPick, d: Dims): Element {
  const color = t[TONE[n.status]];
  const sel = selected === n.key;

  const box = div().id(`node-${n.key}`).absolute().left(n.x).top(n.y).w(d.NW).h(n.h).bg(t.background)
    .border(1).border_color(sel ? t.accent : n.status === "working" ? color : t.ansi0)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => onPick(n, cx))
    .hover((s) => s.border_color(t.foreground));

  if (n.kind === "phase") {
    return box.child(h_flex().relative().size_full().px(Math.round(8 * d.z)).gap(6).items_center().text_size(d.small)
      .when(n.now, (el) => el.child(dither(`${t.accent}88`, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(n.now ? t.foreground : n.status === "pending" ? t.dim : t.muted).child(n.label.toUpperCase()))
      .child(div().relative().flex_none().text_color(n.now ? t.accent : t.dim).child(n.now ? "now" : n.sub)));
  }

  const stripe = div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1));

  const mark = n.kind === "main"
    ? svg(`${ART}/logo-claude.svg`).size(d.icon).flex_none().text_color(n.status === "working" ? t.working : t.foreground)
    : n.kind === "run"
      ? svg("mods/workspace-chrome/layers.svg").size(Math.round(12 * d.z)).flex_none().text_color(color)
      : pip(t, pipStatus(n.status), Math.max(4, Math.round(6 * d.z)));

  // Zoomed far out, only the name fits.
  const compact = d.z < 0.75;
  // How long it ran (the session's own: nothing here).
  const time = n.kind === "main" ? "" : n.time;

  return box
    .when(sel, (el) => el.child(dither(`${t.accent}33`, 1)))
    .child(n.status === "working" ? stripe.loop("opacity", { from: 0.3, to: 1, period: 1300 }) : stripe)
    .child(h_flex().relative().size_full().pl(Math.round(10 * d.z)).pr(6).gap(Math.round(7 * d.z)).items_center()
      .child(div().w(d.icon).flex_none().flex().items_center().justify_center().child(mark))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(d.text).text_color(n.status === "pending" || n.status === "stopped" ? t.muted : t.foreground).child(n.label))
        .when(!compact, (el) => el.child(h_flex().min_w(0).gap(6)
          .child(div().flex_1().min_w(0).truncate().text_size(d.small).text_color(t.dim).child(n.sub))
          // How long it ran (still running: so far, in its status color).
          .when(Boolean(time), (el) => el.child(div().flex_none().text_size(d.small).text_color(n.status === "working" ? t.working : t.muted).child(time))))))
      .when(n.kind === "run", (el) => el.child(div().flex_none().text_size(d.small).text_color(t.dim).child(n.kind === "run" && n.folded ? "+" : "−"))));
}

/** The canvas at zoom d, moved by (panX, panY): lines, then nodes. Positions come back for navigation. */
export function canvas(t: Theme, root: GraphNode, selected: string | null, onPick: OnPick, panX: number, panY: number, d: Dims = dims()): Placed & { readonly el: Element } {
  const { nodes, width, height } = place(root, d);

  const el = div().id("graph-canvas").absolute().left(panX).top(panY).w(width).h(height)
    .children(nodes.flatMap((n) => edges(t, n, d)))
    .children(nodes.map((n) => node(t, n, selected, onPick, d)));

  return { el, width, height, nodes };
}

/**
 * The night behind the graph, kept quiet: two faint star layers drifting
 * very slowly at different speeds (shifted a little with the pan, for
 * depth), dimming a touch out of step, and rarely a faint shooting star.
 */
export function sky(t: Theme, panX: number, panY: number): Element {
  const far = (dx: number, dy: number) => svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(dy).left(dx).text_color(t.ansi8);

  const layer = (k: number, period: number, drift: number, opacity: number, twinkle: number) => {
    const ox = ((panX * k) % 480 + 480) % 480 - 480, oy = ((panY * k) % 900 + 900) % 900 - 900;
    const tiles: Element[] = [];

    for (const dx of [0, 480, 960, 1440]) for (const dy of [0, 900]) tiles.push(far(ox + dx, oy + dy));

    return div().absolute().top(0).w(2400).h(1800)
      .loop("left", { from: 0, to: -drift, period, easing: "linear" })
      .child(div().size_full().opacity(opacity).loop("opacity", { from: opacity * 0.7, to: opacity, period: twinkle }).children(tiles));
  };

  return div().id("graph-sky").absolute().inset_0().overflow_hidden()
    .child(layer(0.1, 240000, 480, 0.2, 7000))
    .child(layer(0.25, 160000, 480, 0.3, 5300))
    .child(div().absolute().w(28).h(1).child(dither(t.ansi8, 1)).opacity(0.4)
      .loop("left", { from: -2000, to: 2400, period: 40000, easing: "linear" })
      .loop("top", { from: 30, to: 260, period: 40000, easing: "linear" }));
}
