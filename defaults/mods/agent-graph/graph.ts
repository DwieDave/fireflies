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
import { Array as Arr, Option, String as Str } from "effect";
import type { Status, Theme } from "herdr";
import { ART, dither, pip } from "./kit.ts";
import type { Agent, Run, Snapshot } from "./claude.ts";
import { ranFor, span } from "./claude.ts";
import { edge } from "@fireflies/tones";

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
type Tone = "working" | "blocked" | "done" | "muted" | "edge";

/** Status -> theme color name. */
export const TONE = { working: "working", blocked: "blocked", done: "done", failed: "blocked", killed: "muted", stopped: "muted", idle: "muted", waiting: "muted", pending: "edge" } as const satisfies { readonly [S in NodeStatus]: Tone };

/** The color a status is drawn in (TONE's name; "edge": tones.ts's edge). */
export const toneOf = (t: Theme, s: NodeStatus): Color => (TONE[s] === "edge" ? edge(t) : t[TONE[s]]);

export const WORDS = { working: "working", done: "done", failed: "failed", killed: "stopped", stopped: "stopped", idle: "quiet", waiting: "waiting", pending: "not started", blocked: "needs you" } as const satisfies { readonly [S in NodeStatus]: string };

const shortModel = (m: string | null) => Str.replace(/-(\d+)-(\d+)$/, " $1.$2")(Str.replace(/^claude-/, "")(m ?? ""));

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

/** A run's status as a node's: running works, completed is done, failed failed, anything else stopped. */
const RUN_STATUS: ReadonlyMap<string, NodeStatus> = new Map([["running", "working"], ["completed", "done"], ["failed", "failed"]]);

/** A phase's status from its agents, `running` its run's. */
function phaseStatus(inPhase: readonly Agent[], running: boolean): NodeStatus {
  if (inPhase.length === 0) return running ? "pending" : "stopped";

  if (Arr.some(inPhase, (a) => a.status === "working")) return "working";

  if (Arr.every(inPhase, (a) => a.status === "done")) return "done";

  return running ? "waiting" : "stopped";
}

/** The tree for a snapshot at `now`: the session, what it spawned, a run's phases and their agents. */
export function tree(data: Snapshot, main: MainLabel, open: ReadonlySet<string>, now: number): MainNode {
  // Every list of children in the order they started.
  const byStart = (a: { readonly started: number }, b: { readonly started: number }) => a.started - b.started;
  const agents = Arr.fromIterable(data.agents.values()).sort(byStart);

  const agentNode = (a: Agent): AgentNode => ({
    ...UNPLACED, key: a.id, kind: "agent", agent: a, label: a.label, status: a.status, time: span(ranFor(a, now)),
    sub: Arr.join(Arr.filter([a.run === null ? a.type : "", shortModel(a.model), WORDS[a.status]], Str.isNonEmpty), " · "),
    children: Arr.map(Arr.filter(agents, (x) => x.run === null && x.parent === a.id), agentNode),
  });

  const runNode = (r: Run): RunNode => {
    const list = Arr.flatMap(r.agents, (id) => Option.toArray(Option.fromUndefinedOr(data.agents.get(id))));
    const done = Arr.filter(list, (a) => a.status === "done").length;
    const running = r.status === "running";
    const status = RUN_STATUS.get(r.status) ?? "stopped";
    // The phase it's in: the last one with an agent working.
    const current = running ? Option.getOrNull(Arr.findLast(r.phases, (p) => Arr.some(list, (a) => a.phase === p && a.status === "working"))) : null;
    // Running runs and the latest one start open; "-<id>" in `open` folds those, "<id>" opens others.
    const byDefault = running || r.id === Arr.last(data.runs).pipe(Option.map((x) => x.id), Option.getOrNull);
    const show = byDefault ? !open.has(`-${r.id}`) : open.has(r.id);
    const phases = r.phases.length === 1 ? "phase" : "phases";

    return {
      ...UNPLACED, key: r.id, kind: "run", run: r, label: r.name, status, folded: !show, foldKey: byDefault ? `-${r.id}` : r.id,
      time: span((r.ended ?? now) - r.started),
      sub: `${done}/${list.length} done · ${r.phases.length} ${phases}${running ? "" : ` · ${WORDS[status]}`}`,
      children: !show ? [] : Arr.map(r.phases, (p): PhaseNode => {
        const inPhase = Arr.filter(list, (a) => a.phase === p).sort(byStart);
        const doneHere = Arr.filter(inPhase, (a) => a.status === "done").length;

        return { ...UNPLACED, key: `${r.id}/${p}`, kind: "phase", label: p, status: phaseStatus(inPhase, running), now: p === current, run: r,
          sub: inPhase.length > 0 ? `${doneHere}/${inPhase.length}` : "", children: Arr.map(inPhase, agentNode) };
      }),
    };
  };

  const spawned: readonly (Run | Agent)[] = [...data.runs, ...Arr.filter(agents, (a) => a.run === null && a.parent === "main")];

  return {
    ...UNPLACED, key: "main", kind: "main", label: main.label, sub: main.sub, status: main.status,
    // Workflow runs and the session's own subagents, interleaved by start.
    children: Arr.map([...spawned].sort(byStart), (x) => ("phases" in x ? runNode(x) : agentNode(x))),
  };
}

/** Whether something under n (or n itself) is working: where the activity is. */
function live(n: GraphNode): boolean {
  return n.status === "working" || Arr.some(n.children, live);
}

/**
 * The child a parent lines up with, so the line between them is straight:
 * the one leading to the current work, else an opened run (one with
 * children), else the middle one.
 */
function anchor(n: GraphNode): Option.Option<GraphNode> {
  const c = n.children;

  return Arr.findFirst(c, (x) => x.status === "working" && live(x)).pipe(
    Option.orElse(() => Arr.findFirst(c, live)),
    Option.orElse(() => (n.kind === "main" ? Arr.findFirst(c, (x) => x.kind === "run" && x.children.length > 0) : Option.none())),
    Option.orElse(() => Option.fromUndefinedOr(c[Math.floor((c.length - 1) / 2)])),
  );
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

    if (n.children.length === 0) return [[0, n.h]];

    const merged: Outline = []; // children's outline, in the first child's frame
    const offs: number[] = [];

    for (const c of n.children) {
      const outline = lay(c, level + 1);
      let off = 0;

      if (offs.length > 0) {
        off = -Infinity;

        for (let k = 0; k < Math.min(merged.length, outline.length); k++) {
          const m = merged[k], o = outline[k];

          if (m !== undefined && o !== undefined) off = Math.max(off, m[1] + (k === 0 ? d.GAP_Y : GROUP) - o[0]);
        }
      }

      offs.push(off);

      for (const [k, [top, bottom]] of outline.entries()) {
        const m = merged[k];

        merged[k] = m === undefined ? [top + off, bottom + off] : [Math.min(m[0], top + off), Math.max(m[1], bottom + off)];
      }
    }

    // Level with the anchor child: its centre is n's centre.
    const ai = Option.getOrElse(Option.map(anchor(n), (a) => n.children.indexOf(a)), () => 0);
    const base = Math.round(n.h / 2) - ((offs[ai] ?? 0) + Math.round((n.children[ai]?.h ?? 0) / 2));

    for (const [k, c] of n.children.entries()) c.rel = (offs[k] ?? 0) + base;

    return [[0, n.h], ...Arr.map(merged, ([top, bottom]): readonly [number, number] => [top + base, bottom + base])];
  };

  const outline = lay(root, 0);
  const top = Math.min(...Arr.map(outline, (o) => o[0])), bottom = Math.max(...Arr.map(outline, (o) => o[1]));

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
  if (n.children.length === 0) return [];

  const out: Element[] = [];
  const px = n.x + d.NW, py = n.y + Math.round(n.h / 2);
  const mid = px + Math.round(d.GAP_X / 2);
  const live = Arr.some(n.children, (c) => c.status === "working");
  const ys = Arr.map(n.children, (c) => c.y + Math.round(c.h / 2));
  const top = Math.min(py, ...ys), bottom = Math.max(py, ...ys);

  out.push(seg(live ? t.working : t.muted, px, py - 1, mid - px, 2));
  out.push(seg(t.muted, mid - 1, top - 1, 2, bottom - top + 2));

  for (const c of n.children) {
    const cy = c.y + Math.round(c.h / 2);
    const color = toneOf(t, c.status);

    const line = c.status === "working" ? color : t.muted;

    out.push(seg(c.status === "pending" ? edge(t) : line, mid, cy - 1, c.x - mid, 2));

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

/** A phase's name: bright where the run is now, dim not started yet. */
function phaseInk(t: Theme, n: PhaseNode): Color {
  if (n.now) return t.foreground;

  return n.status === "pending" ? t.dim : t.muted;
}

/** A node's mark: Claude's for the session, layers for a run, a pip for an agent. */
function nodeMark(t: Theme, n: GraphNode, color: Color, d: Dims): Element {
  if (n.kind === "main") return svg(`${ART}/logo-claude.svg`).size(d.icon).flex_none().text_color(n.status === "working" ? t.working : t.foreground);

  if (n.kind === "run") return svg("mods/workspace-chrome/layers.svg").size(Math.round(12 * d.z)).flex_none().text_color(color);

  return pip(t, pipStatus(n.status), Math.max(4, Math.round(6 * d.z)));
}

/** One node at zoom d. */
function node(t: Theme, n: GraphNode, selected: string | null, onPick: OnPick, d: Dims): Element {
  const color = toneOf(t, n.status);
  const sel = selected === n.key;

  const box = div().id(`node-${n.key}`).absolute().left(n.x).top(n.y).w(d.NW).h(n.h).bg(t.background)
    .border(1).border_color(sel ? t.accent : n.status === "working" ? color : edge(t))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => onPick(n, cx))
    .hover((s) => s.border_color(t.foreground));

  if (n.kind === "phase") {
    return box.child(h_flex().relative().size_full().px(Math.round(8 * d.z)).gap(6).items_center().text_size(d.small)
      .when(n.now, (el) => el.child(dither(`${t.accent}88`, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(phaseInk(t, n)).child(Str.toUpperCase(n.label)))
      .child(div().relative().flex_none().text_color(n.now ? t.accent : t.dim).child(n.now ? "now" : n.sub)));
  }

  const stripe = div().absolute().left(0).top(0).bottom(0).w(4).child(dither(color, 1));

  const mark = nodeMark(t, n, color, d);

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
          .when(Str.isNonEmpty(time), (el) => el.child(div().flex_none().text_size(d.small).text_color(n.status === "working" ? t.working : t.muted).child(time))))))
      .when(n.kind === "run", (el) => el.child(div().flex_none().text_size(d.small).text_color(t.dim).child(n.kind === "run" && n.folded ? "+" : "−"))));
}

/** The canvas at zoom d, moved by (panX, panY): lines, then nodes. Positions come back for navigation. */
export function canvas(t: Theme, root: GraphNode, selected: string | null, onPick: OnPick, panX: number, panY: number, d: Dims = dims()): Placed & { readonly el: Element } {
  const { nodes, width, height } = place(root, d);

  const el = div().id("graph-canvas").absolute().left(panX).top(panY).w(width).h(height)
    .children(Arr.flatMap(nodes, (n) => edges(t, n, d)))
    .children(Arr.map(nodes, (n) => node(t, n, selected, onPick, d)));

  return { el, width, height, nodes };
}

/**
 * The night behind the graph, kept quiet: two faint star layers drifting
 * very slowly at different speeds (shifted a little with the pan, for
 * depth), dimming a touch out of step, and rarely a faint shooting star.
 */
export function sky(t: Theme, panX: number, panY: number): Element {
  const far = (dx: number, dy: number) => svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(dy).left(dx).text_color(t.muted);

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
    .child(div().absolute().w(28).h(1).child(dither(t.muted, 1)).opacity(0.4)
      .loop("left", { from: -2000, to: 2400, period: 40000, easing: "linear" })
      .loop("top", { from: 30, to: 260, period: 40000, easing: "linear" }));
}
