// Staging lines of one file in the git window's main view: its side's diff
// read, the cursor by change line or hunk, the lines picked, the other side,
// the next file.

import { rows as diffRows, isChange, hunkKeys } from "./patch.ts";
import type { StatusFile } from "./parse.ts";
import type { default as GitView } from "./main.ts";
import { moveBy } from "./navigate.ts";

export function startStaging(v: GitView, file: StatusFile) {
  v.staging = { file, side: file.unstaged ? "unstaged" : "staged", diff: null, rows: [], cur: 0, anchor: null, hunkMode: false, other: null };
  v.focus = "main";
  v.reads.push(async () => { await loadStaging(v, true); });
}

export async function loadStaging(v: GitView, first = false) {
  const s = v.staging, g = v.git;

  if (!s || !g) return;

  const now = (v.data.status?.files ?? []).find((f) => f.path === s.file.path);

  if (!now) {
    v.staging = null;
    v.focus = "side";

    return;
  }

  s.file = now;

  if (s.side === "unstaged" && !now.unstaged) s.side = "staged";

  if (s.side === "staged" && !now.staged) s.side = "unstaged";

  const [mine, other] = await Promise.all([
    g.fileDiff(now, { cached: s.side === "staged", context: v.context, ws: false }),
    (s.side === "staged" ? now.unstaged : now.staged) ? g.fileDiff(now, { cached: s.side !== "staged", context: v.context }) : Promise.resolve(null),
  ]);

  if (v.staging !== s) return;

  s.diff = mine;
  s.rows = mine ? diffRows(mine) : [];
  s.other = other ? diffRows(other) : null;

  if (!s.rows.length) {
    v.staging = null;
    v.focus = "side";

    return;
  }

  const changes = s.rows.flatMap((r, i) => (isChange(r) ? [i] : []));

  if (first || !isChange(s.rows[s.cur])) s.cur = changes.find((i) => i >= (first ? 0 : s.cur)) ?? changes[changes.length - 1] ?? 0;

  s.top = Math.min(s.top ?? 0, s.cur);
}

export function pickedKeys(v: GitView): Set<string> {
  const s = v.staging;

  if (!s) return new Set();

  const r = s.rows[s.cur];

  if (!r) return new Set();

  if (s.hunkMode) return new Set(s.diff ? hunkKeys(s.diff, r.hunk) : []);

  const [a, b] = s.anchor === null ? [s.cur, s.cur] : [Math.min(s.anchor, s.cur), Math.max(s.anchor, s.cur)];

  return new Set(s.rows.slice(a, b + 1).flatMap((x) => (isChange(x) && x.line !== null ? [`${x.hunk}:${x.line}`] : [])));
}

export function stepLine(v: GitView, d: number) {
  const s = v.staging;

  if (!s) return;

  if (s.hunkMode) return stepHunk(v, d > 0 ? 1 : -1);

  let i = s.cur;
  const n = Math.abs(d), dir = Math.sign(d);

  for (let k = 0; k < n; k++) {
    let j = i + dir;

    while (j >= 0 && j < s.rows.length && !isChange(s.rows[j])) j += dir;

    if (j < 0 || j >= s.rows.length) break;

    i = j;
  }

  s.cur = i;
}

export function stepHunk(v: GitView, d: number) {
  const s = v.staging;

  if (!s) {
    v.scrollMain(d);

    return;
  }

  const h = s.rows[s.cur]?.hunk ?? 0;
  const target = Math.max(0, Math.min((s.diff?.hunks.length ?? 0) - 1, h + d));
  const i = s.rows.findIndex((r) => r.hunk === target && isChange(r));

  if (i >= 0) s.cur = i;
}

export function switchSide(v: GitView) {
  const s = v.staging;

  if (!s?.other) return;

  s.side = s.side === "staged" ? "unstaged" : "staged";
  s.anchor = null;
  s.cur = 0;
  v.reads.push(async () => { await loadStaging(v, true); });
}

export function stepFile(v: GitView, d: number) {
  const st = v.staging;

  if (!st) {
    // The main view of a multi-file diff: jump between its files.
    const rows = v.main?.rows ?? [];
    const starts = rows.flatMap((r, i) => (r.kind === "file" ? [i] : []));
    const next = d > 0 ? starts.find((i) => i > v.mainTop) : [...starts].reverse().find((i) => i < v.mainTop);

    if (next !== undefined) v.mainTop = next;
    else if (v.ctxOf(v.panel) === "review") moveBy(v, d);

    return;
  }

  const files = v.data.status?.files ?? [];
  const i = files.findIndex((f) => f.path === st.file.path);
  const f = files[(i + d + files.length) % files.length];

  if (f) startStaging(v, f);
}
