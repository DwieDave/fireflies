// Staging lines of one file in the git window's main view: its side's diff
// read, the cursor by change line or hunk, the lines picked, the other side,
// the next file.

import { Array as Arr, Effect, Option } from "effect";
import { rows as diffRows, isChange, hunkKeys } from "./patch.ts";
import type { GitError } from "./git.ts";
import type { GitServices } from "./fx.ts";
import type { StatusFile } from "./parse.ts";
import type { default as GitView } from "./main.ts";
import { moveBy } from "./navigate.ts";

/** Starts staging lines of `file`: its unstaged side first when it has one. */
export function startStaging(v: GitView, file: StatusFile): void {
  v.staging = { file, side: file.unstaged ? "unstaged" : "staged", diff: null, rows: [], cur: 0, anchor: null, hunkMode: false, other: null };
  v.focus = "main";
  v.read(loadStaging(v, true));
}

/** Leaves staging lines: back to the side panel. */
function leave(v: GitView): void {
  v.staging = null;
  v.focus = "side";
}

/** The staged file's diffs read again (its side, the other side), the cursor kept on a change line. */
export function loadStaging(v: GitView, first = false): Effect.Effect<void, GitError, GitServices> {
  return Effect.gen(function* () {
    const s = v.staging, g = v.git;

    if (s === null || g === null) return;

    const found = Arr.findFirst(v.data.status?.files ?? [], (f) => f.path === s.file.path);

    // The file has no changes any more: nothing left to stage.
    if (Option.isNone(found)) return leave(v);

    const now = found.value;

    s.file = now;

    if (s.side === "unstaged" && !now.unstaged) s.side = "staged";

    if (s.side === "staged" && !now.staged) s.side = "unstaged";

    const [mine, other] = yield* Effect.all([
      g.fileDiff(now, { cached: s.side === "staged", context: v.context, ws: false }),
      (s.side === "staged" ? now.unstaged : now.staged) ? g.fileDiff(now, { cached: s.side !== "staged", context: v.context }) : Effect.succeed(null),
    ], { concurrency: "unbounded" });

    if (v.staging !== s) return;

    s.diff = mine;
    s.rows = mine === null ? [] : diffRows(mine);
    s.other = other === null ? null : diffRows(other);

    if (!Arr.isReadonlyArrayNonEmpty(s.rows)) return leave(v);

    const changes = Arr.flatMap(s.rows, (r, i) => (isChange(r) ? [i] : []));
    const from = first ? 0 : s.cur;

    if (first || !isChange(s.rows[s.cur])) s.cur = Option.getOrElse(Arr.findFirst(changes, (i) => i >= from), () => Option.getOrElse(Arr.last(changes), () => 0));

    s.top = Math.min(s.top ?? 0, s.cur);
  });
}

/** The picked lines' keys ("hunk:line"): the cursor's, a range's, or the cursor's hunk in hunk mode. */
export function pickedKeys(v: GitView): Set<string> {
  const s = v.staging;

  if (s === null) return new Set();

  const r = s.rows[s.cur];

  if (r === undefined) return new Set();

  if (s.hunkMode) return new Set(s.diff === null ? [] : hunkKeys(s.diff, r.hunk));

  const [a, b] = s.anchor === null ? [s.cur, s.cur] : [Math.min(s.anchor, s.cur), Math.max(s.anchor, s.cur)];

  return new Set(Arr.flatMap(Arr.take(Arr.drop(s.rows, a), b - a + 1), (x) => (isChange(x) && x.line !== null ? [`${x.hunk}:${x.line}`] : [])));
}

/** Moves the cursor `d` change lines (a hunk in hunk mode). */
export function stepLine(v: GitView, d: number): void {
  const s = v.staging;

  if (s === null) return;

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

/** Moves the cursor to the next (previous) hunk's first change; without staging, scrolls the main view. */
export function stepHunk(v: GitView, d: number): void {
  const s = v.staging;

  if (s === null) {
    v.scrollMain(d);

    return;
  }

  const h = s.rows[s.cur]?.hunk ?? 0;
  const target = Math.max(0, Math.min((s.diff?.hunks.length ?? 0) - 1, h + d));

  Option.map(Arr.findFirstIndex(s.rows, (r) => r.hunk === target && isChange(r)), (i) => { s.cur = i; });
}

/** Tab: the other side (staged / unstaged), when it has changes. */
export function switchSide(v: GitView): void {
  const s = v.staging;

  if (s === null || s.other === null) return;

  s.side = s.side === "staged" ? "unstaged" : "staged";
  s.anchor = null;
  s.cur = 0;
  v.read(loadStaging(v, true));
}

/** The next (previous) file: staging its lines, or in a multi-file diff its next file's head. */
export function stepFile(v: GitView, d: number): void {
  const st = v.staging;

  if (st === null) {
    // The main view of a multi-file diff: jump between its files.
    const starts = Arr.flatMap(v.main?.rows ?? [], (r, i) => (r.kind === "file" ? [i] : []));
    const next = d > 0 ? Arr.findFirst(starts, (i) => i > v.mainTop) : Arr.findLast(starts, (i) => i < v.mainTop);

    if (Option.isSome(next)) v.mainTop = next.value;
    else if (v.ctxOf(v.panel) === "review") moveBy(v, d);

    return;
  }

  const files = v.data.status?.files ?? [];
  const i = Option.getOrElse(Arr.findFirstIndex(files, (f) => f.path === st.file.path), () => -1);
  const f = files[(i + d + files.length) % files.length];

  if (f !== undefined) startStaging(v, f);
}
