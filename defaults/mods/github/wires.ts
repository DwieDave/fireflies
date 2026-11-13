// Where the actions graph's boxes and lines go, as plain numbers (no herdr
// imports, so scripts/ tests it; graph.js draws them). Lines run left to
// right through the gap before each column, one group per set of jobs that
// wait for the same jobs: one waited-for job fans out on one bus, many into
// one merge on one bus, and many into many merge on a bus, run on as one
// trunk, and split on a second bus. A needed job that sits further left than
// the column before goes round over or under the columns in between. Needs already
// implied by another need (a job needing `changes` and `build`, where
// `build` needs `changes`) aren't drawn.

import type { Timed, Tone } from "./model.ts";
import { tone } from "./model.ts";

export const NW = 214, NH = 44, GAP_X = 56, GAP_Y = 10, PAD = 18, RW = 170;

// Room in a gap: from each box to the first/last bus, and between buses.
const EDGE = 18, LANE = 14;

// A detour under a column: how far below the lowest box, and between detours.
const UNDER = 14, DETOUR = 8;

/** Drop the needs another need already brings along. `parents`: id -> ids. */
export function reduceNeeds<K>(parents: ReadonlyMap<K, readonly K[]>): Map<K, K[]> {
  const memo = new Map<K, Set<K>>();

  const above = (id: K, seen = new Set<K>()): Set<K> => {
    const known = memo.get(id);

    if (known) return known;

    const out = new Set<K>();

    if (seen.has(id)) return out;

    seen.add(id);

    for (const p of parents.get(id) ?? []) {
      out.add(p);

      for (const q of above(p, seen)) out.add(q);
    }

    memo.set(id, out);

    return out;
  };

  const out = new Map<K, K[]>();

  for (const [id, ps] of parents) {
    const own = [...new Set(ps)].filter((p) => p !== id);

    out.set(id, own.filter((p) => !own.some((q) => q !== p && above(q).has(p))));
  }

  return out;
}

/** How a line is drawn: running, done, or dim (not started, skipped, stopped). */
export type LineTone = "working" | "done" | "dim";

/** A job the graph places: its id and state. */
export type GraphJob = Timed & { readonly id: number };

/** What a job's line comes from: the run, a job left of it, or a job further left by its detour. */
type Source = "run" | number | { readonly via: number };

const isVia = (s: Source): s is { readonly via: number } => typeof s === "object";

const srcKey = (s: Source) => (isVia(s) ? `via:${s.via}` : String(s));

const lineTone = (k: Tone): LineTone => (k === "working" ? "working" : k === "done" ? "done" : "dim");

const groupTone = (tones: readonly Tone[]): LineTone => (tones.includes("working") ? "working"
  : tones.every((k) => k === "queued" || k === "skipped" || k === "stopped") ? "dim" : "done");

/** The run's box. */
export interface RunBox {
  readonly x: number;
  y: number;
  readonly w: number;
  readonly tone: Tone;
}

/** A job's box: its column and row in the graph. */
export interface JobBox<J> extends RunBox {
  readonly job: J;
  readonly col: number;
  readonly row: number;
}

/** A 2 px piece of line. */
export interface Seg {
  readonly x: number;
  y: number;
  readonly w: number;
  readonly h: number;
  readonly tone: LineTone;
}

/** A pulse running into a working job. */
export interface Pulse {
  y: number;
  readonly from: number;
  readonly to: number;
}

/** The graph laid out. */
export interface Routed<J> {
  readonly run: RunBox;
  readonly nodes: readonly JobBox<J>[];
  readonly segs: readonly Seg[];
  readonly pulses: readonly Pulse[];
  readonly width: number;
  readonly height: number;
}

/** A line's end: where it starts and in what tone. */
interface End {
  readonly x: number;
  readonly y: number;
  readonly tone: Tone;
}

/** Targets in one gap that share one set of sources. */
interface Group {
  readonly src: readonly Source[];
  readonly targets: number[];
}

/**
 * The graph: the run's box, every job's box ({ job, col, row, x, y, w,
 * tone }), its size, and the lines: `segs` (2 px rects { x, y, w, h, tone },
 * tone "working" | "done" | "dim") and `pulses` ({ y, from, to }: into a
 * working job). `parents`: job id -> ids it waits for (model.ts jobParents),
 * or null: then each column follows the whole column before it. `runTone`:
 * the run's own (model.ts tone).
 */
export function route<J extends GraphJob>(cols: readonly (readonly J[])[], parents: ReadonlyMap<number, readonly number[]> | null, runTone: Tone = "done"): Routed<J> {
  const colOf = new Map<number, number>();

  cols.forEach((c, ci) => c.forEach((j) => colOf.set(j.id, ci)));

  // What each job is drawn from: ids of jobs left of it, or "run".
  const raw = new Map<number | "run", (number | "run")[]>();

  cols.forEach((c, ci) => c.forEach((j) => {
    if (!parents) {
      raw.set(j.id, ci === 0 ? ["run"] : (cols[ci - 1] ?? []).map((p) => p.id));

      return;
    }

    const ps = (parents.get(j.id) ?? []).filter((p) => (colOf.get(p) ?? Infinity) < ci);

    raw.set(j.id, ps.length ? ps : ci === 0 ? ["run"] : []);
  }));

  const from = parents ? reduceNeeds(raw) : raw;
  const colOfSrc = (s: number | "run") => (s === "run" ? -1 : colOf.get(s));

  // Groups per gap (gap g sits before column g): targets sharing one set of
  // sources. A source from further left comes in as its detour, { via: id }.
  const gaps = cols.map((c, g) => {
    const byKey = new Map<string, Group>();

    for (const j of c) {
      const src = (from.get(j.id) ?? []).map((s): Source => (s !== "run" && (colOfSrc(s) ?? Infinity) < g - 1 ? { via: s } : s));

      if (!src.length) continue;

      const key = src.map(srcKey).sort().join("|");
      const group = byKey.get(key) ?? { src, targets: [] };

      byKey.set(key, group);
      group.targets.push(j.id);
    }

    return [...byKey.values()];
  });

  // Buses per gap: merge buses first, then the split/single ones.
  const gapW = gaps.map((gs) => {
    let lanes = 0;

    for (const gr of gs) lanes += gr.src.length > 1 && gr.targets.length > 1 ? 2 : 1;

    return Math.max(GAP_X, 2 * EDGE + Math.max(0, lanes - 1) * LANE);
  });

  // Boxes: columns side by side, each centered on the tallest.
  const heights = cols.map((c) => c.length * NH + Math.max(0, c.length - 1) * GAP_Y);
  const tall = Math.max(NH, ...heights);
  const colX: number[] = [];
  let x = PAD + RW;

  cols.forEach((_, ci) => {
    x += gapW[ci] ?? GAP_X;
    colX.push(x);
    x += NW;
  });

  const run: RunBox = { x: PAD, y: PAD + Math.round((tall - NH) / 2), w: RW, tone: runTone };
  const nodes: JobBox<J>[] = [];
  const byId = new Map<number, JobBox<J>>();

  cols.forEach((c, ci) => {
    const top = PAD + Math.round((tall - (heights[ci] ?? 0)) / 2);

    c.forEach((job, ri) => {
      const n = { job, col: ci, row: ri, x: colX[ci] ?? 0, y: top + ri * (NH + GAP_Y), w: NW, tone: tone(job.status, job.conclusion) };

      nodes.push(n);
      byId.set(job.id, n);
    });
  });

  const box = (s: number | "run"): RunBox | undefined => (s === "run" ? run : byId.get(s));
  const mid = (b: { readonly y: number }) => b.y + Math.round(NH / 2);
  const gapLeft = (g: number) => (g === 0 ? PAD + RW : (colX[g - 1] ?? 0) + NW);

  const segs: Seg[] = [], pulses: Pulse[] = [];

  const h = (x1: number, x2: number, y: number, k: LineTone) => {
    if (x2 !== x1) segs.push({ x: Math.min(x1, x2), y: y - 1, w: Math.abs(x2 - x1), h: 2, tone: k });
  };

  const v = (vx: number, y1: number, y2: number, k: LineTone) => {
    if (y2 !== y1) segs.push({ x: vx - 1, y: Math.min(y1, y2) - 1, w: 2, h: Math.abs(y2 - y1) + 2, tone: k });
  };

  // Detours: from the needed job's right side, down past the columns in
  // between, to the gap before the job that needs it. One per (job, gap).
  const vias = new Map<string, End | null>();
  const detours: { readonly id: number; readonly g: number }[] = [];

  gaps.forEach((gs, g) => gs.forEach((gr) => gr.src.forEach((s) => {
    if (!isVia(s) || vias.has(`${s.via}@${g}`)) return;

    vias.set(`${s.via}@${g}`, null);
    detours.push({ id: s.via, g });
  })));

  // Over the columns between when the job sits in the top half of its own
  // column (so its line crosses fewer lines out of the jobs below it), else under.
  let over = 0, under = 0;

  for (const d of detours) {
    const p = byId.get(d.id), c = colOfSrc(d.id);

    if (!p || c === undefined) continue;

    const up = p.row < ((cols[c]?.length ?? 1) - 1) / 2;
    const i = up ? over++ : under++;
    let edge = up ? Infinity : 0;

    for (let k = c + 1; k < d.g; k++) {
      for (const j of cols[k] ?? []) {
        const b = byId.get(j.id);

        if (b) edge = up ? Math.min(edge, b.y) : Math.max(edge, b.y + NH);
      }
    }

    const y = up ? edge - UNDER - i * DETOUR : edge + UNDER + i * DETOUR;
    const turn = gapLeft(c + 1) + Math.round(EDGE / 2) - (i % 2) * 4;
    const k = lineTone(p.tone);

    h(p.x + p.w, turn, mid(p), k);
    v(turn, mid(p), y, k);
    h(turn, gapLeft(d.g), y, k);
    vias.set(`${d.id}@${d.g}`, { x: gapLeft(d.g), y, tone: p.tone });
  }

  const midOf = (id: number | undefined) => {
    const n = id === undefined ? undefined : byId.get(id);

    return n ? mid(n) : 0;
  };

  gaps.forEach((gs, g) => {
    const left = gapLeft(g), right = colX[g] ?? left;
    const order = [...gs].sort((a, b) => midOf(a.targets[0]) - midOf(b.targets[0]));
    const merges = order.filter((gr) => gr.src.length > 1 && gr.targets.length > 1);
    const lanes = merges.length + order.length;

    const laneX = (i: number) => (lanes === 1 ? Math.round((left + right) / 2)
      : left + EDGE + Math.round(i * (right - left - 2 * EDGE) / (lanes - 1)));

    for (const gr of order) {
      const srcs = gr.src.flatMap((s): End[] => {
        if (isVia(s)) {
          const d = vias.get(`${s.via}@${g}`);

          return d ? [d] : [];
        }

        const b = box(s);

        return b ? [{ x: b.x + b.w, y: mid(b), tone: b.tone }] : [];
      });

      const tgts = gr.targets.flatMap((id) => {
        const n = byId.get(id);

        return n ? [n] : [];
      });

      const into = groupTone(tgts.map((n) => n.tone));
      const out = laneX(merges.length + order.indexOf(gr));
      const merged = merges.includes(gr);

      for (const s of srcs) h(s.x, merged ? laneX(merges.indexOf(gr)) : out, s.y, lineTone(s.tone));

      const ty = tgts.map(mid);

      if (merged) {
        // Many into many: merge, one trunk, split.
        const inX = laneX(merges.indexOf(gr));
        const sy = srcs.map((s) => s.y);
        const lo = Math.max(Math.min(...sy), Math.min(...ty)), hi = Math.min(Math.max(...sy), Math.max(...ty));
        const centre = Math.round((Math.min(...ty) + Math.max(...ty)) / 2);

        const trunk = lo <= hi ? Math.min(hi, Math.max(lo, nearest(centre, [...ty, ...sy].filter((y) => y >= lo && y <= hi)) ?? centre))
          : Math.round((lo + hi) / 2);

        v(inX, Math.min(...sy, trunk), Math.max(...sy, trunk), into);
        h(inX, out, trunk, into);
        v(out, Math.min(...ty, trunk), Math.max(...ty, trunk), into);
      } else {
        const ys = [...srcs.map((s) => s.y), ...ty];

        v(out, Math.min(...ys), Math.max(...ys), into);
      }

      for (const n of tgts) {
        h(out, n.x, mid(n), groupTone([n.tone]));

        if (n.tone === "working") pulses.push({ y: mid(n), from: out, to: n.x });
      }
    }
  });

  // Detours over the top push everything down; those under make it taller.
  const top = Math.min(PAD, ...segs.map((r) => r.y));
  const shift = PAD - top;

  for (const b of [run, ...nodes, ...segs]) b.y += shift;

  for (const q of pulses) q.y += shift;

  const bottom = Math.max(PAD + tall + shift, ...segs.map((r) => r.y + r.h));

  return { run, nodes, segs, pulses, width: x + PAD, height: bottom + PAD };
}

/** The value in `list` closest to `y` (null for none). */
function nearest(y: number, list: readonly number[]): number | null {
  let best: number | null = null;

  for (const v of list) if (best === null || Math.abs(v - y) < Math.abs(best - y)) best = v;

  return best;
}
