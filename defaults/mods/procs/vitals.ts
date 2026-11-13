// The deck's readings strip, free of the view (tested in
// scripts/procs-vitals.test.ts): which readings it graphs, each one's
// history, the line's points over a history, the strip's layout at a width,
// the short numbers a narrow cell has room for.
//
// Four graphs, always in view above the lists: CPU, memory (its line in the
// pressure's colour), network (in as a line with its dithered fill, out as a
// dotted line on the same scale) and disk (MB/s). Left out as graphs: the
// GPU (its percent is in the CPU graph's line in the foot) and how full the
// startup disk is (in the disk graph's line); the load average isn't read.

import type { Measured } from "./sys.ts";
import { KEEP, push } from "./sys.ts";

/** The readings the strip graphs, in its order. */
export const VITALS = ["cpu", "mem", "net", "disk"] as const;

export type Vital = (typeof VITALS)[number];

/** Each graph's history, the newest last (null: that reading had nothing). */
export interface History {
  cpu: (number | null)[];
  mem: (number | null)[];
  rx: (number | null)[];
  tx: (number | null)[];
  disk: (number | null)[];
}

export const emptyHistory = (): History => ({ cpu: [], mem: [], rx: [], tx: [], disk: [] });

/** A reading appended to every history (KEEP each). The network has no rate on the first
 *  reading, and none at all where netstat printed nothing: no point then, not a zero. */
export function record(h: History, m: Measured): History {
  return {
    cpu: push(h.cpu, m.cpu?.pct ?? null),
    mem: push(h.mem, m.mem?.pct ?? null),
    rx: m.netSeen ? push(h.rx, m.net?.rx ?? null) : h.rx,
    tx: m.netSeen ? push(h.tx, m.net?.tx ?? null) : h.tx,
    disk: push(h.disk, m.disk?.mbps ?? null),
  };
}

/** A point of a graph's line, in percent of its box (x from the left, y from the top). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How a series scales: against `max` (a percent's 100), else its own peak, at least `floor`. */
export interface Fit {
  readonly max?: number | null;
  readonly floor?: number;
  /** The box's height in layout px: the line keeps `pad` px off its top and bottom. */
  readonly h?: number;
  readonly pad?: number;
  /** How many readings the box spans: the newest sits at the right edge, the window fills leftwards. */
  readonly keep?: number;
}

/** The top a series scales against: `max`, else its peak, at least `floor`. */
export function topOf(values: readonly (number | null)[], { max = null, floor = 1 }: Fit = {}): number {
  return max ?? Math.max(floor, ...values.flatMap((v) => (v === null ? [] : [v])));
}

/** A percent to a thousandth: a point's place, short in the path and free of float dust. */
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** The line over a history: runs of points (a null reading breaks the line), the newest at
 *  x 100 %, each reading a (keep - 1)th of the width to the left of the next. A run of one
 *  reading is drawn as a step one slot wide, so a single reading still shows. */
export function linePoints(values: readonly (number | null)[], fit: Fit = {}): Point[][] {
  const { h = 24, pad = 1, keep = KEEP } = fit;
  const top = topOf(values, fit);
  const n = values.length;
  const slot = 100 / Math.max(1, keep - 1);
  const yOf = (v: number): number => ((pad + (1 - Math.max(0, Math.min(1, v / top))) * (h - 2 * pad)) / h) * 100;
  const runs: Point[][] = [];
  let run: Point[] = [];

  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);

      run = [];

      return;
    }

    run.push({ x: round(Math.max(0, 100 - (n - 1 - i) * slot)), y: round(yOf(v)) });
  });

  if (run.length) runs.push(run);

  return runs.map((r) => {
    const only = r[0];

    return r.length === 1 && only ? [{ x: round(Math.max(0, only.x - slot)), y: only.y }, only] : r;
  });
}

/** The area under a run, down to the baseline (y 100 %): the polygon its dithered fill takes. */
export function areaOf(run: readonly Point[]): Point[] {
  const first = run[0];
  const last = run.at(-1);

  return first && last ? [...run, { x: last.x, y: 100 }, { x: first.x, y: 100 }] : [];
}

// ---- the strip's layout

/** A cell's least width (layout px): its name and its short number on one line. */
export const CELL_MIN = 92;
export const STRIP_PAD = 12;
export const STRIP_GAP = 12;

/** A row of graphs: the name line, the graph, air. */
export const STRIP_TOP = 8;
export const NAME_H = 14;
export const GRAPH_GAP = 4;
export const LINE_H = 22;
export const STRIP_BOTTOM = 8;
export const STRIP_ROW = STRIP_TOP + NAME_H + GRAPH_GAP + LINE_H;

/** How the strip sits in a deck `width` layout px wide: four across while each keeps
 *  CELL_MIN, else two by two; its height with them. */
export interface StripLayout {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly h: number;
}

export function stripLayout(width: number): StripLayout {
  const room = (cols: number): number => (width - 2 * STRIP_PAD - (cols - 1) * STRIP_GAP) / cols;
  const cols = room(VITALS.length) >= CELL_MIN ? VITALS.length : 2;
  const rows = Math.ceil(VITALS.length / cols);

  return { cols, rows, cell: Math.floor(room(cols)), h: rows * STRIP_ROW + STRIP_BOTTOM };
}

/** The deck's width in layout px from a size measured in device px at `zoom`. */
export const layoutWidth = (device: number, zoom: number): number => Math.round(device / (zoom || 1));

// ---- short numbers for a cell

/** "1.2G", "820M", "80K", "0" from bytes (a second): a network cell's two numbers. */
export function compact(bytes: number | null): string {
  if (bytes === null) return "";

  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}G`;

  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}M`;

  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}K`;

  return `${Math.round(bytes)}`;
}

/** "28.7M/s", "120M/s" from MB a second. */
export const diskRate = (mbps: number | null): string => (mbps === null ? "" : `${mbps >= 100 ? Math.round(mbps) : mbps.toFixed(1)}M/s`);

// ---- what a cell says

/** What a cell shows: its name, its number now, the memory pressure's word (warn, crit). */
export interface CellText {
  readonly name: string;
  readonly value: string;
  readonly flag: string | null;
}

const pct = (v: number | null | undefined): string => (v === null || v === undefined ? "" : `${Math.round(v)}%`);

/** A cell's name and short number (before the first reading: "…"; a source this machine
 *  lacks: "none"). */
export function cellText(k: Vital, m: Measured | null): CellText {
  const name = { cpu: "cpu", mem: "mem", net: "net", disk: "disk" }[k];
  const none = (has: boolean, v: () => string): string => (m === null ? "…" : has ? v() : "none");

  switch (k) {
    case "cpu": return { name, value: none(Boolean(m?.cpu), () => pct(m?.cpu?.pct)), flag: null };
    case "mem": {
      const p = m?.mem?.pressure;

      return { name, value: none(Boolean(m?.mem), () => pct(m?.mem?.pct)), flag: p === "warning" ? "warn" : p === "critical" ? "crit" : null };
    }

    case "net": {
      if (m && !m.netSeen) return { name, value: "none", flag: null };

      return { name, value: m?.net ? `↓${compact(m.net.rx)} ↑${compact(m.net.tx)}` : "…", flag: null };
    }

    case "disk": return { name, value: none(m?.disk?.mbps !== null && m?.disk?.mbps !== undefined, () => diskRate(m?.disk?.mbps ?? null)), flag: null };
  }
}

/** The long line the foot shows while the pointer is on a cell: everything the reading has. */
export function vitalLine(k: Vital, m: Measured | null, cores: number | null = null): string {
  if (m === null) return "reading…";

  const lacks = (what: string): string => `no ${what} reading on this machine`;

  switch (k) {
    case "cpu":
      return m.cpu ? [`cpu ${pct(m.cpu.pct)}: user ${m.cpu.us}% · system ${m.cpu.sy}%`, ...(cores ? [`${cores} cores`] : []), ...(m.gpu ? [`gpu ${pct(m.gpu.pct)}`] : [])].join(" · ") : lacks("CPU");
    case "mem":
      return m.mem ? `memory ${gib(m.mem.used)} of ${gib(m.mem.total)} · ${pct(m.mem.pct)}${m.mem.pressure ? ` · pressure ${m.mem.pressure}` : ""}` : lacks("memory");
    case "net":
      if (!m.netSeen) return lacks("network");

      return m.net ? `network ↓ ${compact(m.net.rx)}B/s in (the line) · ↑ ${compact(m.net.tx)}B/s out (dotted)` : "network: measuring…";
    case "disk":
      if (!m.disk) return lacks("disk");

      return [`disk ${m.disk.mbps === null ? "–" : `${m.disk.mbps.toFixed(1)} MB/s`}`, ...(m.disk.full === null ? [] : [`the startup disk is ${m.disk.full}% full`])].join(" · ");
  }
}

/** "26.4G" from bytes. */
const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}G`;
