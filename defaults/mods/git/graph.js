// The commit graph's lanes, lazygit's way: commits top (newest) to bottom,
// each in a lane; a lane carries one line of history down to the next commit
// it expects. Pure (tested in scripts/git.test.ts); draw.js turns a
// row into dithered segments.
//
// For every commit a row says:
//   col       the lane its node sits in
//   color     that lane's color index (kept while the lane carries one chain)
//   before    the lanes running through the row's top half (color or null)
//   after     the lanes running through its bottom half
//   joins     lanes that end in this commit (a branch that forked off here),
//             drawn from their lane across to the node at the row's middle
//   forks     a merge's other parents: from the node across to their lane,
//             and down from there
//   merge     more than one parent

export const LANE_COLORS = 8;

/** Lanes for commits in log order (parents after children). Parents the list
 *  doesn't hold (history cut at a limit) keep their lane to the bottom. */
export function layoutGraph(commits) {
  const lanes = []; // the hash each lane waits for, or null when free
  const colorOf = [];
  let next = 0;
  const rows = [];
  for (const c of commits) {
    const before = lanes.map((h, i) => (h ? colorOf[i] : null));
    let col = lanes.indexOf(c.hash);
    if (col < 0) {
      // A new head (a branch tip nothing below has pointed at yet).
      col = lanes.indexOf(null);
      if (col < 0) col = lanes.length;
      colorOf[col] = next++ % LANE_COLORS;
    }
    const joins = [];
    lanes.forEach((h, i) => {
      if (h === c.hash && i !== col) { joins.push({ from: i, color: colorOf[i] }); lanes[i] = null; }
    });
    const color = colorOf[col];
    const [first, ...others] = c.parents ?? [];
    lanes[col] = first ?? null;
    const forks = [];
    for (const p of others) {
      let k = lanes.indexOf(p);
      const fresh = k < 0;
      if (fresh) {
        k = lanes.findIndex((h, i) => h === null && i > col);
        if (k < 0) k = Math.max(lanes.length, col + 1);
        lanes[k] = p;
        colorOf[k] = next++ % LANE_COLORS;
      }
      forks.push({ to: k, color: colorOf[k], fresh });
    }
    // A first parent another lane already waits for: this lane ends here and
    // joins that one lower down (two children of one commit); keep both lines.
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
    const after = [];
    for (let i = 0; i < lanes.length; i++) after[i] = lanes[i] ? colorOf[i] : null;
    rows.push({ col, color, before, after, joins, forks, merge: (c.parents?.length ?? 0) > 1 });
  }
  const width = rows.reduce((w, r) => Math.max(w, r.before.length, r.after.length, r.col + 1, ...r.forks.map((f) => f.to + 1)), 1);
  return { rows, width };
}

/** The segments of one row, in lane units: vertical lines { lane, from, to }
 *  (0 = top, 0.5 = middle, 1 = bottom) and horizontal ones { from, to } at
 *  the middle, each with a color; the node { lane, color, merge }. draw.js
 *  scales them to pixels. */
export function segments(r) {
  const v = [], h = [];
  const joined = new Set(r.joins.map((j) => j.from));
  const forkedFresh = new Set(r.forks.filter((f) => r.before[f.to] == null).map((f) => f.to));
  r.before.forEach((c, i) => {
    if (c == null) return;
    if (i === r.col) v.push({ lane: i, from: 0, to: 0.5, color: r.color });
    else if (joined.has(i)) v.push({ lane: i, from: 0, to: 0.5, color: c });
    else if (r.after[i] != null) v.push({ lane: i, from: 0, to: 1, color: c });
    else v.push({ lane: i, from: 0, to: 0.5, color: c });
  });
  r.after.forEach((c, i) => {
    if (c == null) return;
    if (i === r.col) v.push({ lane: i, from: 0.5, to: 1, color: c });
    else if (forkedFresh.has(i)) v.push({ lane: i, from: 0.5, to: 1, color: c });
    else if (r.before[i] == null || joined.has(i)) v.push({ lane: i, from: 0.5, to: 1, color: c });
  });
  for (const j of r.joins) h.push({ from: Math.min(j.from, r.col), to: Math.max(j.from, r.col), color: j.color });
  for (const f of r.forks) h.push({ from: Math.min(f.to, r.col), to: Math.max(f.to, r.col), color: f.color });
  return { v, h, node: { lane: r.col, color: r.color, merge: r.merge } };
}

/** The lanes one row really draws in (empty lanes on the right left out). */
export function usedWidth(r) {
  const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i + 1; return 0; };
  return Math.max(1, last(r.before), last(r.after), r.col + 1, ...r.forks.map((f) => f.to + 1), ...r.joins.map((j) => j.from + 1));
}

/** The lanes rows a..b (exclusive) draw in: the graph column of the rows in
 *  view, so a wide stretch elsewhere in history doesn't push the text right. */
export function widthOf(rows, a = 0, b = rows.length) {
  let w = 1;
  for (let i = Math.max(0, a); i < Math.min(rows.length, b); i++) w = Math.max(w, usedWidth(rows[i]));
  return w;
}
