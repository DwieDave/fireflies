// The Actions log's groups, folded as GitHub draws them: a `##[group]` title
// stands for its lines up to `##[endgroup]` (or the next group) until it's
// opened. Line numbers stay GitHub's: a folded group's lines keep theirs.
import type { LogLine } from "./model.ts";
import { logLine } from "./model.ts";

/** A group title's fold: its line number, how many lines it holds, open or not. */
export interface Fold {
  readonly at: number;
  readonly size: number;
  readonly open: boolean;
}

/** A drawn log line: its number among the step's lines, and a group title's fold. */
export interface ShownLine extends LogLine {
  readonly n: number;
  readonly group?: Fold | undefined;
}

/** A step's lines as drawn, and how many it has in all (the folded ones too). */
export interface FoldedLog {
  readonly lines: readonly ShownLine[];
  readonly total: number;
}

/** A step's raw lines (splitLog's) folded: each group shut unless `open(at)`, `at` its title's number. */
export function foldLog(raw: readonly string[], open: (at: number) => boolean): FoldedLog {
  const items: (LogLine | "end")[] = [];

  for (const r of raw) {
    if (r.startsWith("##[endgroup]")) items.push("end");
    else {
      const l = logLine(r);

      if (l) items.push(l);
    }
  }

  const body = (it: LogLine | "end" | undefined) => it !== undefined && it !== "end" && it.kind !== "group";
  const lines: ShownLine[] = [];
  let n = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];

    if (it === undefined || it === "end") continue;

    n++;

    if (it.kind !== "group") {
      lines.push({ ...it, n });
      continue;
    }

    let size = 0;

    while (body(items[i + 1 + size])) size++;

    const shown = size === 0 || open(n);

    lines.push({ ...it, n, group: { at: n, size, open: shown } });

    if (!shown) {
      n += size;
      i += size;
    }
  }

  return { lines, total: n };
}

/** enter: the first group title from the view's top line down, if any. */
export function groupAt(lines: readonly ShownLine[], top: number): Fold | null {
  return lines.slice(Math.max(0, top)).find((l) => l.group && l.group.size > 0)?.group ?? null;
}

/** Opens or folds one group (its title's number) in `opened`, or with "all" every group: open while any is shut. */
export function toggleFold(opened: Set<string>, prefix: string, lines: readonly ShownLine[], at: number | "all"): void {
  if (at !== "all") {
    const key = `${prefix}${at}`;

    if (!opened.delete(key)) opened.add(key);

    return;
  }

  const groups = lines.flatMap((l) => (l.group && l.group.size > 0 ? [l.group] : []));
  const shut = groups.some((g) => !g.open);

  for (const g of groups) {
    if (shut) opened.add(`${prefix}${g.at}`);
    else opened.delete(`${prefix}${g.at}`);
  }
}
