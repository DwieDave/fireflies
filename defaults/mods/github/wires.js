// Where the actions graph's boxes and lines go, as plain numbers (no herdr
// imports, so scripts/ tests it; graph.js draws them). Lines run left to
// right through the gap before each column, one group per set of jobs that
// wait for the same jobs: one waited-for job fans out on one bus, many into
// one merge on one bus, and many into many merge on a bus, run on as one
// trunk, and split on a second bus. A needed job that sits further left than
// the column before goes round over or under the columns in between. Needs already
// implied by another need (a job needing `changes` and `build`, where
// `build` needs `changes`) aren't drawn.

import { tone } from "./model.js";

export const NW = 214, NH = 44, GAP_X = 56, GAP_Y = 10, PAD = 18, RW = 170;
// Room in a gap: from each box to the first/last bus, and between buses.
const EDGE = 18, LANE = 14;
// A detour under a column: how far below the lowest box, and between detours.
const UNDER = 14, DETOUR = 8;

/** Drop the needs another need already brings along. `parents`: id -> ids. */
export function reduceNeeds(parents) {
  const memo = new Map();
  const above = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const out = new Set();
    if (seen.has(id)) return out;
    seen.add(id);
    for (const p of parents.get(id) ?? []) { out.add(p); for (const q of above(p, seen)) out.add(q); }
    memo.set(id, out);
    return out;
  };
  const out = new Map();
  for (const [id, ps] of parents) {
    const own = [...new Set(ps)].filter((p) => p !== id);
    out.set(id, own.filter((p) => !own.some((q) => q !== p && above(q).has(p))));
  }
  return out;
}

const srcKey = (s) => (typeof s === "object" ? `via:${s.via}` : String(s));
const lineTone = (k) => (k === "working" ? "working" : k === "done" ? "done" : "dim");
const groupTone = (tones) => (tones.includes("working") ? "working"
  : tones.every((k) => k === "queued" || k === "skipped" || k === "stopped") ? "dim" : "done");

/**
 * The graph: the run's box, every job's box ({ job, col, row, x, y, w,
 * tone }), its size, and the lines: `segs` (2 px rects { x, y, w, h, tone },
 * tone "working" | "done" | "dim") and `pulses` ({ y, from, to }: into a
 * working job). `parents`: job id -> ids it waits for (model.js jobParents),
 * or null: then each column follows the whole column before it. `runTone`:
 * the run's own (model.js tone).
 */
export function route(cols, parents, runTone = "done") {
  const colOf = new Map();
  cols.forEach((c, ci) => c.forEach((j) => colOf.set(j.id, ci)));
  // What each job is drawn from: ids of jobs left of it, or "run".
  const raw = new Map();
  cols.forEach((c, ci) => c.forEach((j) => {
    if (!parents) { raw.set(j.id, ci === 0 ? ["run"] : cols[ci - 1].map((p) => p.id)); return; }
    const ps = (parents.get(j.id) ?? []).filter((p) => colOf.has(p) && colOf.get(p) < ci);
    raw.set(j.id, ps.length ? ps : ci === 0 ? ["run"] : []);
  }));
  const from = parents ? reduceNeeds(raw) : raw;
  const colOfSrc = (s) => (s === "run" ? -1 : colOf.get(s));

  // Groups per gap (gap g sits before column g): targets sharing one set of
  // sources. A source from further left comes in as its detour, { via: id }.
  const gaps = cols.map((c, g) => {
    const byKey = new Map();
    for (const j of c) {
      const src = (from.get(j.id) ?? []).map((s) => (colOfSrc(s) < g - 1 ? { via: s } : s));
      if (!src.length) continue;
      const key = src.map(srcKey).sort().join("|");
      (byKey.get(key) ?? byKey.set(key, { src, targets: [] }).get(key)).targets.push(j.id);
    }
    return [...byKey.values()];
  });
  // Buses per gap: merge buses first, then the split/single ones.
  const gapW = gaps.map((gs) => {
    const lanes = gs.reduce((n, gr) => n + (gr.src.length > 1 && gr.targets.length > 1 ? 2 : 1), 0);
    return Math.max(GAP_X, 2 * EDGE + Math.max(0, lanes - 1) * LANE);
  });

  // Boxes: columns side by side, each centered on the tallest.
  const heights = cols.map((c) => c.length * NH + Math.max(0, c.length - 1) * GAP_Y);
  const tall = Math.max(NH, ...heights);
  const colX = [];
  let x = PAD + RW;
  cols.forEach((_, ci) => { x += gapW[ci]; colX.push(x); x += NW; });
  const run = { x: PAD, y: PAD + Math.round((tall - NH) / 2), w: RW, tone: runTone };
  const nodes = [];
  const byId = new Map();
  cols.forEach((c, ci) => {
    const top = PAD + Math.round((tall - heights[ci]) / 2);
    c.forEach((job, ri) => {
      const n = { job, col: ci, row: ri, x: colX[ci], y: top + ri * (NH + GAP_Y), w: NW, tone: tone(job.status, job.conclusion) };
      nodes.push(n);
      byId.set(job.id, n);
    });
  });
  const box = (s) => (s === "run" ? run : byId.get(s));
  const mid = (b) => b.y + Math.round(NH / 2);
  const gapLeft = (g) => (g === 0 ? PAD + RW : colX[g - 1] + NW);

  const segs = [], pulses = [];
  const h = (x1, x2, y, k) => { if (x2 !== x1) segs.push({ x: Math.min(x1, x2), y: y - 1, w: Math.abs(x2 - x1), h: 2, tone: k }); };
  const v = (x, y1, y2, k) => { if (y2 !== y1) segs.push({ x: x - 1, y: Math.min(y1, y2) - 1, w: 2, h: Math.abs(y2 - y1) + 2, tone: k }); };

  // Detours: from the needed job's right side, down past the columns in
  // between, to the gap before the job that needs it. One per (job, gap).
  const vias = new Map();
  const detours = [];
  gaps.forEach((gs, g) => gs.forEach((gr) => gr.src.forEach((s) => {
    if (typeof s !== "object" || vias.has(`${s.via}@${g}`)) return;
    vias.set(`${s.via}@${g}`, null);
    detours.push({ id: s.via, g });
  })));
  // Over the columns between when the job sits in the top half of its own
  // column (so its line crosses fewer lines out of the jobs below it), else under.
  let over = 0, under = 0;
  detours.forEach((d) => {
    const p = box(d.id), c = colOfSrc(d.id);
    const up = p.row < (cols[c].length - 1) / 2;
    const i = up ? over++ : under++;
    let edge = up ? Infinity : 0;
    for (let k = c + 1; k < d.g; k++) for (const j of cols[k]) {
      const b = byId.get(j.id);
      edge = up ? Math.min(edge, b.y) : Math.max(edge, b.y + NH);
    }
    const y = up ? edge - UNDER - i * DETOUR : edge + UNDER + i * DETOUR;
    const turn = gapLeft(c + 1) + Math.round(EDGE / 2) - (i % 2) * 4;
    const k = lineTone(p.tone);
    h(p.x + p.w, turn, mid(p), k);
    v(turn, mid(p), y, k);
    h(turn, gapLeft(d.g), y, k);
    vias.set(`${d.id}@${d.g}`, { x: gapLeft(d.g), y, tone: p.tone });
  });

  gaps.forEach((gs, g) => {
    const left = gapLeft(g), right = colX[g];
    const order = [...gs].sort((a, b) => mid(byId.get(a.targets[0])) - mid(byId.get(b.targets[0])));
    const merges = order.filter((gr) => gr.src.length > 1 && gr.targets.length > 1);
    const lanes = merges.length + order.length;
    const laneX = (i) => (lanes === 1 ? Math.round((left + right) / 2)
      : left + EDGE + Math.round(i * (right - left - 2 * EDGE) / (lanes - 1)));
    order.forEach((gr) => {
      const srcs = gr.src.map((s) => {
        if (typeof s === "object") { const d = vias.get(`${s.via}@${g}`); return { x: d.x, y: d.y, tone: d.tone }; }
        const b = box(s);
        return { x: b.x + b.w, y: mid(b), tone: b.tone };
      });
      const tgts = gr.targets.map((id) => byId.get(id));
      const into = groupTone(tgts.map((n) => n.tone));
      const out = laneX(merges.length + order.indexOf(gr));
      for (const s of srcs) h(s.x, merges.includes(gr) ? laneX(merges.indexOf(gr)) : out, s.y, lineTone(s.tone));
      const ty = tgts.map(mid);
      if (merges.includes(gr)) {
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
    });
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
function nearest(y, list) {
  let best = null;
  for (const v of list) if (best === null || Math.abs(v - y) < Math.abs(best - y)) best = v;
  return best;
}
