// The reads the window runs for its panels (the cluster's secret, the
// folder's environment, the tables, a table's structure, a page of rows, a
// test): each is listed while it runs, so its panel says what runs and for
// how long ("reading the tables… 4 s · esc stops it"), and each ends, by
// itself, at its deadline, or stopped (esc, the stop chip): a client's run is
// interrupted by its nonce (runner.ts cancel); anything else (a kubectl call)
// is left to finish unheard. The engine has no setTimeout: the window's tick
// (every second) ends the reads past their deadline (overdue).

import type { Context } from "gpui-kit";
import { exec, writeTextFile } from "herdr";
import { cancel } from "./runner.ts";
import type { default as DbView } from "./main.ts";

/** The panel a read is for (where its words and stop chip are drawn). */
export type ReadPanel = "tables" | "structure" | "rows" | "conns";

/** A read going on. */
export interface Read {
  readonly id: number;
  /** What it does, in words ("reading the tables"). */
  readonly what: string;
  readonly panel: ReadPanel;
  readonly at: number;
  /** When it gives up (ms since the epoch), or null: only a stop ends it. */
  readonly until: number | null;
  /** The client run's nonce once it started (for the stop). */
  nonce: string | null;
  /** Ends it: stopped (esc, the chip) or late (its deadline). */
  readonly end: (how: "stopped" | "late") => void;
}

/** How a read ended: its value, stopped, or late (past its deadline, after `ms`). */
export type Ended<T> = { readonly value: T } | { readonly stopped: true } | { readonly late: number };

let ids = 0;

/** Runs `work` as a read of `panel`: listed while it runs; `started(nonce)` makes it stoppable by
 *  interrupting the client. A throw in `work` comes back as a thrown error, the read unlisted. */
export async function reading<T>(v: DbView, what: string, panel: ReadPanel, cx: Context, work: (started: (nonce: string) => void) => Promise<T>, deadline: number | null = null): Promise<Ended<T>> {
  cx = v.held(cx);

  let settle: (e: Ended<T>) => void = () => {};

  const ended = new Promise<Ended<T>>((resolve) => {
    settle = resolve;
  });

  const at = Date.now();

  const read: Read = {
    id: ++ids, what, panel, at, until: deadline === null ? null : at + deadline, nonce: null,
    end: (how) => {
      if (!v.reads.includes(read)) return;

      v.reads = v.reads.filter((r) => r !== read);
      settle(how === "stopped" ? { stopped: true } : { late: deadline ?? Date.now() - at });

      if (read.nonce && v.dir) void cancel({ exec, writeTextFile }, v.dir, read.nonce);
    },
  };

  v.reads = [...v.reads, read];
  cx.notify();

  const done = work((n) => {
    read.nonce = n;
  }).then((value): Ended<T> => ({ value }));

  try {
    return await Promise.race([done, ended]);
  } finally {
    v.reads = v.reads.filter((r) => r !== read);
    cx.notify();
  }
}

/** The read shown in a panel (the newest), or null. */
export const readIn = (v: DbView, panel: ReadPanel): Read | null => v.reads.filter((r) => r.panel === panel).at(-1) ?? null;

/** A read's words with its seconds: "reading the tables… 4 s". */
export function readWords(r: Read, now = Date.now()): string {
  const s = Math.floor((now - r.at) / 1000);

  return `${r.what}… ${s} s`;
}

/** Stops every read (esc while one runs; the stop chip): true when there was one. */
export function stopReads(v: DbView, panel: ReadPanel | null = null): boolean {
  const list = v.reads.filter((r) => panel === null || r.panel === panel);

  for (const r of list) r.end("stopped");

  return list.length > 0;
}

/** Ends the reads past their deadline (the window's tick). */
export function overdue(v: DbView, now = Date.now()): void {
  for (const r of v.reads) if (r.until !== null && now >= r.until) r.end("late");
}

/** Why a read gave no value, in words, or null when it has one. */
export function endWords<T>(e: Ended<T>, what: string): string | null {
  if ("stopped" in e) return `${what}: stopped · r reads again`;

  if ("late" in e) return `${what}: no answer after ${Math.round(e.late / 1000)} s · r tries again`;

  return null;
}
