import { test, expect } from "bun:test";
import { route, reduceNeeds, NW, NH } from "../defaults/mods/github/wires.js";
import { jobColumns, jobParents, needsFromWorkflow } from "../defaults/mods/github/model.js";

type Seg = { x: number; y: number; w: number; h: number; tone: string };
type Box = { x: number; y: number; w: number };

const done = (id: number, name: string) => ({ id, name, status: "completed", conclusion: "success", started_at: null, completed_at: null });

// The run in the recording: detect, seven builds (a matrix), three jobs that
// each need both detect and the builds.
const DOCKER = `name: Build and Publish Images
on: push
jobs:
  changes:
    name: Detect changed services
    runs-on: x
  build-images:
    name: Build \${{ matrix.service }}
    needs: changes
  trigger-gitops:
    name: Update GitOps manifests (prod)
    needs:
      - changes
      - build-images
  trigger-gitops-staging:
    name: Update GitOps manifests (staging)
    needs:
      - changes
      - build-images
  trigger-preview:
    name: Deploy PR preview environment
    needs:
      - changes
      - build-images
`;
const BUILDS = ["api", "workflow", "plenty-stock-sync", "web", "plenty-sync", "worker", "scanner"];
const JOBS = [
  done(1, "Detect changed services"),
  ...BUILDS.map((b, i) => done(10 + i, `Build ${b}`)),
  done(20, "Update GitOps manifests (prod) / Build and publish manifests"),
  { ...done(21, "Update GitOps manifests (staging)"), conclusion: "skipped" },
  { ...done(22, "Deploy PR preview environment"), conclusion: "skipped" },
];

const touches = (a: Seg, b: Seg) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const mid = (b: { y: number }) => b.y + NH / 2;
/** The segment that leaves box `b` on its right, and the one entering it on its left. */
const outOf = (segs: Seg[], b: Box) => segs.find((s) => s.h === 2 && s.x === b.x + b.w && s.y === mid(b) - 1);
const into = (segs: Seg[], b: Box) => segs.find((s) => s.h === 2 && s.x + s.w === b.x && s.y === mid(b) - 1);
/** Whether two segments are joined through touching segments. */
function joined(segs: Seg[], a: Seg, b: Seg) {
  const seen = new Set([a]);
  const todo = [a];
  while (todo.length) {
    const s = todo.pop()!;
    if (s === b) return true;
    for (const o of segs) if (!seen.has(o) && touches(s, o)) { seen.add(o); todo.push(o); }
  }
  return false;
}
/** No line runs under a box (a line may only end on its edge). */
function clearOfBoxes(segs: Seg[], boxes: { x: number; y: number; w: number }[]) {
  for (const s of segs) for (const b of boxes) {
    const overlapX = s.x < b.x + b.w && b.x < s.x + s.w;
    const overlapY = s.y < b.y + NH && b.y < s.y + s.h;
    if (overlapX && overlapY) return false;
  }
  return true;
}
const verticals = (segs: Seg[], x0: number, x1: number) => segs.filter((s) => s.w === 2 && s.h > 2 && s.x >= x0 && s.x <= x1);

function recorded() {
  const needs = needsFromWorkflow(DOCKER);
  const cols = jobColumns(JOBS, needs);
  return { cols, g: route(cols, jobParents(JOBS, needs)) };
}

test("the recording's run lays out 1 -> 7 -> 3", () => {
  const { cols } = recorded();
  expect(cols.map((c) => c.length)).toEqual([1, 7, 3]);
});

test("needs another need already brings along aren't drawn", () => {
  const p = new Map<number, number[]>([[1, []], [2, [1]], [3, [1, 2]], [4, [1, 2, 3]]]);
  expect(Object.fromEntries(reduceNeeds(p))).toEqual({ 1: [], 2: [1], 3: [2], 4: [3] });
  // Two separate needs both stay.
  expect(reduceNeeds(new Map([[1, []], [2, []], [3, [1, 2]]])).get(3)).toEqual([1, 2]);
});

test("detect fans out on one bus into every build", () => {
  const { g } = recorded();
  const detect = g.nodes.find((n) => n.job.id === 1)!;
  const builds = g.nodes.filter((n) => n.col === 1);
  const from = outOf(g.segs, detect)!;
  expect(from).toBeDefined();
  expect(verticals(g.segs, detect.x + NW, builds[0].x)).toHaveLength(1);
  for (const b of builds) {
    const end = into(g.segs, b)!;
    expect(end).toBeDefined();
    expect(joined(g.segs, from, end)).toBe(true);
  }
});

test("seven builds merge into one trunk that splits into the three after them", () => {
  const { g } = recorded();
  const builds = g.nodes.filter((n) => n.col === 1);
  const after = g.nodes.filter((n) => n.col === 2);
  const gapL = builds[0].x + NW, gapR = after[0].x;
  // Two buses in the gap: the merge, then the split.
  const buses = verticals(g.segs, gapL, gapR).sort((a, b) => a.x - b.x);
  expect(buses).toHaveLength(2);
  const [merge, split] = buses;
  expect(merge.x).toBeLessThan(split.x);
  // The merge bus spans every build; the split bus every job after them.
  for (const b of builds) expect(merge.y <= mid(b) - 1 && merge.y + merge.h >= mid(b) + 1).toBe(true);
  for (const a of after) expect(split.y <= mid(a) - 1 && split.y + split.h >= mid(a) + 1).toBe(true);
  // One trunk between them.
  const trunks = g.segs.filter((s) => s.h === 2 && s.x === merge.x + 1 && s.x + s.w === split.x + 1);
  expect(trunks).toHaveLength(1);
  // Every build's line ends on the merge bus; every line out starts on the split bus.
  for (const b of builds) {
    const s = outOf(g.segs, b)!;
    expect(s.x + s.w).toBe(merge.x + 1);
  }
  for (const a of after) {
    const s = into(g.segs, a)!;
    expect(s.x).toBe(split.x + 1);
    for (const b of builds) expect(joined(g.segs, outOf(g.segs, b)!, s)).toBe(true);
  }
  // Nothing runs from detect past the builds, and no line runs under a box.
  expect(g.segs.filter((s) => s.h === 2 && s.x < gapL && s.x + s.w > gapL)).toHaveLength(0);
  expect(clearOfBoxes(g.segs, [g.run, ...g.nodes])).toBe(true);
});

test("lines into skipped jobs are dim, into the one that ran lit", () => {
  const { g } = recorded();
  const tones = g.nodes.filter((n) => n.col === 2).map((n) => into(g.segs, n)!.tone);
  expect(tones).toEqual(["done", "dim", "dim"]);
});

test("without needs, each column merges and splits into the next the same way", () => {
  const cols = [[done(1, "a")], BUILDS.map((b, i) => done(10 + i, b)), [done(20, "x"), done(21, "y"), done(22, "z")]];
  const g = route(cols, null);
  const builds = g.nodes.filter((n) => n.col === 1), after = g.nodes.filter((n) => n.col === 2);
  expect(verticals(g.segs, builds[0].x + NW, after[0].x)).toHaveLength(2);
  expect(into(g.segs, g.nodes[0])).toBeDefined(); // the run into the first column
  for (const a of after) for (const b of builds) expect(joined(g.segs, outOf(g.segs, b)!, into(g.segs, a)!)).toBe(true);
  expect(clearOfBoxes(g.segs, [g.run, ...g.nodes])).toBe(true);
});

test("a need from further left goes round the column between, over or under", () => {
  // lint and build first; test needs build; deploy needs test and lint.
  const cols = [[done(1, "lint"), done(2, "build")], [done(3, "test")], [done(4, "deploy")]];
  const parents = new Map([[1, []], [2, []], [3, [2]], [4, [3, 1]]]);
  const g = route(cols, parents);
  const [lint, , test_, deploy] = [1, 2, 3, 4].map((id) => g.nodes.find((n) => n.job.id === id)!);
  expect(joined(g.segs, outOf(g.segs, lint)!, into(g.segs, deploy)!)).toBe(true);
  expect(joined(g.segs, outOf(g.segs, test_)!, into(g.segs, deploy)!)).toBe(true);
  expect(clearOfBoxes(g.segs, [g.run, ...g.nodes])).toBe(true);
  expect(Math.max(...g.segs.map((s) => s.y + s.h))).toBeLessThanOrEqual(g.height);
});

test("separate groups in one gap get their own buses", () => {
  // a -> x, b -> y, a and b -> z.
  const cols = [[done(1, "a"), done(2, "b")], [done(3, "x"), done(4, "y"), done(5, "z")]];
  const g = route(cols, new Map([[1, []], [2, []], [3, [1]], [4, [2]], [5, [1, 2]]]));
  const [a, b, x, y, z] = [1, 2, 3, 4, 5].map((id) => g.nodes.find((n) => n.job.id === id)!);
  expect(joined(g.segs, outOf(g.segs, a)!, into(g.segs, x)!)).toBe(true);
  expect(joined(g.segs, outOf(g.segs, b)!, into(g.segs, y)!)).toBe(true);
  expect(joined(g.segs, outOf(g.segs, b)!, into(g.segs, z)!)).toBe(true);
  const xs = verticals(g.segs, a.x + NW, x.x).map((s) => s.x);
  expect(new Set(xs).size).toBe(xs.length);
  expect(clearOfBoxes(g.segs, [g.run, ...g.nodes])).toBe(true);
});
