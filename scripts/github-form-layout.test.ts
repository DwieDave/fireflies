// Where the GitHub window's form fields sit (form-layout.js): the column's
// width beside the side panel, sections, pairs and halves, the body growing
// into free room, and where a field's list opens (under it, or upward
// without room, never over the footer).
import { test, expect } from "bun:test";
import { columns, layout, cellOf, pickerHeight, pickerPlace, COLUMN, WIDE, AREA_MIN, AREA_MAX, CONTROL, LABEL, LABEL_GAP } from "../defaults/mods/github/form-layout.ts";

const PR = [
  { id: "base", kind: "choice", group: "branches", pair: true, join: "←" },
  { id: "head", kind: "choice" },
  { id: "title", kind: "text", group: "pull request" },
  { id: "body", kind: "area" },
  { id: "draft", kind: "toggle", group: "options" },
  { id: "push", kind: "toggle" },
  { id: "reviewers", kind: "multi", group: "people and tags", half: true },
  { id: "assignees", kind: "multi", half: true },
  { id: "labels", kind: "multi", half: true },
  { id: "milestone", kind: "choice", half: true },
];

const shape = (lay: any) => lay.rows.map((r: any) => (r.kind === "section" ? `§${r.title}` : r.cells.map((c: any) => c.field.id).join("+")));

test("the form is a column beside the side panel, and the whole body when narrow", () => {
  expect(columns(1600)).toEqual({ form: COLUMN, side: 1600 - COLUMN - 6 });
  expect(columns(WIDE)).toEqual({ form: COLUMN, side: WIDE - COLUMN - 6 });
  expect(columns(WIDE - 1)).toEqual({ form: WIDE - 1, side: 0 });
});

test("sections, the branch pair and the halves, in tab order", () => {
  const lay = layout(PR, { width: 638 });
  expect(shape(lay)).toEqual(["§branches", "base+head", "§pull request", "title", "body", "§options", "draft+push", "§people and tags", "reviewers+assignees", "labels+milestone"]);
  // Every field once, in the order tab walks them.
  expect(lay.rows.flatMap((r: any) => r.cells?.map((c: any) => c.index) ?? [])).toEqual(PR.map((_f, i) => i));
  const pair = lay.rows.find((r: any) => r.join);
  expect(pair.join).toBe("←");
  const [a, b] = pair.cells;
  expect(a.x).toBe(lay.pad);
  expect(b.x + b.w).toBe(lay.pad + lay.inner); // the pair spans the column
  // Rows go down without overlapping.
  for (let i = 1; i < lay.rows.length; i++) expect(lay.rows[i].y).toBeGreaterThanOrEqual(lay.rows[i - 1].y + lay.rows[i - 1].h);
});

test("narrow, pairs and halves stack; a field outside a group keeps its own row", () => {
  const lay = layout(PR, { width: 380 });
  expect(shape(lay)).toEqual(["§branches", "base", "head", "§pull request", "title", "body", "§options", "draft", "push", "§people and tags", "reviewers", "assignees", "labels", "milestone"]);
  expect(lay.pad).toBe(14);
  for (const r of lay.rows) for (const c of r.cells ?? []) expect(c.w).toBe(lay.inner);
});

test("a lone half takes the whole row; a pair doesn't reach into the next section", () => {
  const lay = layout([
    { id: "a", kind: "choice", group: "one", pair: true },
    { id: "b", kind: "choice", group: "two" },
    { id: "c", kind: "number", half: true },
  ], { width: 638 });
  expect(shape(lay)).toEqual(["§one", "a", "§two", "b", "c"]);
  const c = cellOf(lay, 2)!;
  expect(c.w).toBe(lay.inner);
});

test("the body grows into the room the column leaves, up to a limit", () => {
  const tight = layout(PR, { width: 638, viewH: 300 });
  expect(tight.area).toBe(AREA_MIN);
  const roomy = layout(PR, { width: 638, viewH: 700 });
  expect(roomy.area).toBeGreaterThan(AREA_MIN);
  expect(roomy.area).toBeLessThanOrEqual(AREA_MAX);
  expect(roomy.height).toBeLessThanOrEqual(700);
  const huge = layout(PR, { width: 638, viewH: 3000 });
  expect(huge.area).toBe(AREA_MAX);
  // A form without a body doesn't grow.
  expect(layout(PR.filter((f) => f.kind !== "area"), { width: 638, viewH: 3000 }).area).toBe(AREA_MIN);
});

test("an error adds its line under the field", () => {
  const ok = cellOf(layout(PR, { width: 638 }), 2)!;
  const bad = cellOf(layout(PR, { width: 638, errors: new Map([["title", "A pull request needs a title."]]) }), 2)!;
  expect(bad.h).toBe(ok.h + 16);
  expect(ok.controlY).toBe(ok.y + LABEL + LABEL_GAP);
  expect(ok.controlH).toBe(CONTROL);
});

test("a list opens under its field at the field's width, as tall as its rows", () => {
  const lay = layout(PR, { width: 638, viewH: 700 });
  const head = cellOf(lay, 1)!;
  const rows = [{ label: "a", sub: "x" }, { label: "b" }];
  const want = pickerHeight(rows);
  const p = pickerPlace(head, { viewH: 700, want, width: 638 });
  expect(p.up).toBe(false);
  expect(p.y).toBeGreaterThan(head.controlY + head.controlH - 1);
  expect(p.x).toBe(head.x);
  expect(p.w).toBe(head.w);
  expect(p.h).toBe(want);
  // Short lists are short; long ones stop at a dozen rows.
  expect(pickerHeight([{ label: "a" }])).toBeLessThan(pickerHeight(Array.from({ length: 5 }, () => ({ label: "a" }))));
  expect(pickerHeight(Array.from({ length: 40 }, () => ({ label: "a" })))).toBe(pickerHeight(Array.from({ length: 12 }, () => ({ label: "a" }))));
});

test("a list without room below opens upward, never over the footer; with room on neither side it takes the larger and scrolls", () => {
  const lay = layout(PR, { width: 638, viewH: 560 });
  const labels = cellOf(lay, 8)!;
  const want = pickerHeight([{ label: "bug", sub: "x" }, { label: "docs", sub: "x" }, { label: "nocturne", sub: "x" }, { label: "needs review" }]);
  const p = pickerPlace(labels, { viewH: 560, want, width: 638 });
  expect(p.up).toBe(true);
  expect(p.y + p.h).toBeLessThanOrEqual(labels.controlY); // ends above the field
  expect(p.y).toBeGreaterThanOrEqual(0);
  // Scrolled: the field moved up, so the list fits under it again.
  const scrolled = pickerPlace(labels, { scrollY: labels.controlY - 20, viewH: 560, want, width: 638 });
  expect(scrolled.up).toBe(false);
  expect(scrolled.y + scrolled.h).toBeLessThanOrEqual(560);
  // A tiny room: the larger side, cut to fit (the list scrolls inside).
  const mid = { y: 100, h: 48, x: 20, w: 300, controlY: 120, controlH: 28 };
  const cut = pickerPlace(mid, { viewH: 200, want: 400, width: 638 });
  expect(cut.up).toBe(true);
  expect(cut.y).toBeGreaterThanOrEqual(0);
  expect(cut.h).toBeLessThan(400);
  const low = pickerPlace({ ...mid, controlY: 20 }, { viewH: 200, want: 400, width: 638 });
  expect(low.up).toBe(false);
  expect(low.y + low.h).toBeLessThanOrEqual(200);
});

test("a narrow field's list is at least wide enough to read, and stays in the panel", () => {
  const narrow = { y: 0, h: 48, x: 400, w: 120, controlY: 20, controlH: 28 };
  const p = pickerPlace(narrow, { viewH: 600, want: 100, width: 520 });
  expect(p.w).toBe(280);
  expect(p.x + p.w).toBeLessThanOrEqual(520 - 4);
});
