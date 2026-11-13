// The process deck's readings strip, free of the view
// (defaults/mods/procs/vitals.ts): Developer: "instead of the system tab
// show the most important graphs as dithered line graphs not balken in the
// top of the tooltip pane". Each graph's history, the line's points over a
// history (empty, one reading, a full window, a gap), the strip's layout wide
// and narrow at zoom 0.9 and 1.0, the short numbers a cell has room for.
import { test, expect, mock } from "bun:test";
import { VITALS, emptyHistory, record, linePoints, areaOf, topOf, stripLayout, layoutWidth, compact, diskRate, cellText, vitalLine, CELL_MIN, STRIP_ROW, STRIP_BOTTOM } from "../defaults/mods/procs/vitals.ts";
import { KEEP, parseSys, measure } from "../defaults/mods/procs/sys.ts";
import { SYS, SYS_NONE } from "./fixtures/procs.ts";

// state.ts reads herdr's home and props: stand-ins (mock.module is process-wide: this file runs alone).
mock.module("herdr", () => ({ home: () => "/home/dev", props: () => ({}) }));
const { W, STRIP_H, LIST_H, PORTS_H, H, HEAD, COLS, FOOT } = await import("../defaults/mods/procs/state.ts");

const first = measure(parseSys(SYS, 10000));
const second = measure(parseSys(SYS.replace("12944968792", "12946968792"), 11000), parseSys(SYS, 10000));

test("which graphs: CPU, memory, network and disk, in that order", () => {
  expect([...VITALS]).toEqual(["cpu", "mem", "net", "disk"]);
});

test("the history: a reading a point; the network has none on its first reading, and none at all where netstat printed nothing", () => {
  let h = record(emptyHistory(), first);
  expect(h).toEqual({ cpu: [80], mem: [h.mem[0]], rx: [null], tx: [null], disk: [h.disk[0]] });
  expect(Math.round(h.mem[0] ?? 0)).toBe(82);
  expect(h.disk[0]).toBeCloseTo(28.66);
  h = record(h, second);
  expect(h.rx).toEqual([null, 2000000]);
  // A Linux box: nothing read, a null point each (no zero), the network not at all.
  const none = record(emptyHistory(), measure(parseSys(SYS_NONE)));
  expect(none).toEqual({ cpu: [null], mem: [null], rx: [], tx: [], disk: [null] });
});

test("the history keeps the newest KEEP (90 readings at a second: a minute and a half)", () => {
  let h = emptyHistory();
  for (let i = 0; i < KEEP + 7; i++) h = record(h, { ...first, cpu: { pct: i, us: 0, sy: 0 } });
  expect(KEEP).toBe(90);
  expect(h.cpu.length).toBe(KEEP);
  expect(h.cpu[0]).toBe(7);
  expect(h.cpu.at(-1)).toBe(KEEP + 6);
});

test("the line: nothing for an empty history", () => {
  expect(linePoints([])).toEqual([]);
  expect(linePoints([null, null])).toEqual([]);
});

test("the line: one reading is a step one slot wide at the right edge", () => {
  const slot = Math.round((100 - 100 / (KEEP - 1)) * 1000) / 1000;
  const runs = linePoints([50], { max: 100, h: 22, pad: 1 });
  expect(runs.length).toBe(1);
  expect(runs[0]).toEqual([{ x: slot, y: 50 }, { x: 100, y: 50 }]);
  // Its fill: the step down to the baseline.
  expect(areaOf(runs[0]!)).toEqual([{ x: slot, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: slot, y: 100 }]);
});

test("the line: a full window spans the box, the newest at the right, 100 % a pixel under the top", () => {
  const values = Array.from({ length: KEEP }, (_, i) => (i % 2 ? 100 : 0));
  const [run] = linePoints(values, { max: 100, h: 22, pad: 1 });
  expect(run!.length).toBe(KEEP);
  expect(run![0]!.x).toBe(0);
  expect(run!.at(-1)!.x).toBe(100);
  // 0 sits a pixel over the baseline, 100 a pixel under the top: a 1 px line never clips.
  expect(run![0]!.y).toBeCloseTo((21 / 22) * 100, 2);
  expect(run![1]!.y).toBeCloseTo((1 / 22) * 100, 2);
  // A part of the window: the readings sit at the right, a slot apart.
  const [part] = linePoints([10, 20, 30], { max: 100 });
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  expect(part!.map((p) => p.x)).toEqual([r3(100 - 2 * (100 / (KEEP - 1))), r3(100 - 100 / (KEEP - 1)), 100]);
});

test("the line: a missing reading breaks it into two runs; a rate scales to its own peak, at least its floor", () => {
  const runs = linePoints([1, 2, null, 4], { floor: 1 });
  expect(runs.map((r) => r.length)).toEqual([2, 2]);
  expect(runs[1]![1]!.y).toBeCloseTo((1 / 24) * 100, 2); // the peak, at the top (the default box is 24 px)
  expect(topOf([0.1, 0.2], { floor: 1 })).toBe(1);
  expect(topOf([5, null, 3], { floor: 1 })).toBe(5);
  expect(topOf([5], { max: 100 })).toBe(100);
});

test("the layout: four across in the deck's width, at zoom 0.9 and 1.0 alike", () => {
  // The deck is W layout px wide whatever the zoom; measured in device px it's W * zoom.
  for (const zoom of [0.9, 1]) {
    const w = layoutWidth((W - 2) * zoom, zoom);
    expect(w).toBe(W - 2);
    const lay = stripLayout(w);
    expect(lay.cols).toBe(4);
    expect(lay.rows).toBe(1);
    expect(lay.cell).toBeGreaterThanOrEqual(CELL_MIN);
    // Four cells, three gaps and the sides fit the width: nothing clips.
    expect(4 * lay.cell + 3 * 12 + 2 * 12).toBeLessThanOrEqual(w);
    expect(lay.h).toBe(STRIP_ROW + STRIP_BOTTOM);
  }
  expect(STRIP_H).toBe(stripLayout(W - 2).h);
  expect(LIST_H).toBe(H - 2 - HEAD - STRIP_H - COLS - FOOT);
  expect(PORTS_H).toBe(H - 2 - HEAD - STRIP_H - COLS - FOOT); // the ports have column heads too
});

test("the layout: a narrow deck wraps two by two, never clips; the strip grows a row", () => {
  for (const zoom of [0.9, 1]) {
    const lay = stripLayout(layoutWidth(300 * zoom, zoom));
    expect(lay).toMatchObject({ cols: 2, rows: 2 });
    expect(2 * lay.cell + 12 + 2 * 12).toBeLessThanOrEqual(300);
    expect(lay.h).toBe(2 * STRIP_ROW + STRIP_BOTTOM);
  }
  // The edge: four just fit at four cells of CELL_MIN.
  expect(stripLayout(4 * CELL_MIN + 3 * 12 + 2 * 12).cols).toBe(4);
  expect(stripLayout(4 * CELL_MIN + 3 * 12 + 2 * 12 - 1).cols).toBe(2);
});

test("the short numbers: a cell's rates fit in a few characters", () => {
  expect([compact(null), compact(512), compact(80_400), compact(1_240_000), compact(3_100_000_000)]).toEqual(["", "512", "80K", "1.2M", "3.1G"]);
  expect([diskRate(null), diskRate(28.66), diskRate(140.2)]).toEqual(["", "28.7M/s", "140M/s"]);
});

test("a cell's name and number: reading…, none where the machine lacks it, the memory pressure's word", () => {
  expect(cellText("cpu", null)).toEqual({ name: "cpu", value: "…", flag: null });
  expect(cellText("cpu", first)).toEqual({ name: "cpu", value: "80%", flag: null });
  expect(cellText("mem", first)).toEqual({ name: "mem", value: "82%", flag: null });
  expect(cellText("mem", { ...first, mem: { ...first.mem!, pressure: "warning" } }).flag).toBe("warn");
  expect(cellText("mem", { ...first, mem: { ...first.mem!, pressure: "critical" } }).flag).toBe("crit");
  expect(cellText("net", first).value).toBe("…"); // no rate on the first reading
  expect(cellText("net", second).value).toBe("↓2.0M ↑0");
  expect(cellText("disk", first).value).toBe("28.7M/s");
  const none = measure(parseSys(SYS_NONE));
  expect(VITALS.map((k) => cellText(k, none).value)).toEqual(["none", "none", "none", "none"]);
});

test("the foot's line for a graph under the pointer: the whole reading, the GPU and the disk's fullness among it", () => {
  expect(vitalLine("cpu", first, 10)).toBe("cpu 80%: user 62% · system 18% · 10 cores · gpu 53%");
  expect(vitalLine("mem", first)).toBe("memory 26.4G of 32.0G · 82% · pressure normal");
  expect(vitalLine("net", first)).toBe("network: measuring…");
  expect(vitalLine("net", second)).toBe("network ↓ 2.0MB/s in (the line) · ↑ 0B/s out (dotted)");
  expect(vitalLine("disk", first)).toBe("disk 28.7 MB/s · the startup disk is 21% full");
  expect(vitalLine("cpu", null)).toBe("reading…");
  expect(vitalLine("cpu", measure(parseSys(SYS_NONE)))).toBe("no CPU reading on this machine");
});
