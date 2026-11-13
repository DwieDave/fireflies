// The Projects tab's filter (board.ts's board, projects.ts types it): GitHub's
// filter syntax, the part the tab speaks, parsed and matched against a card;
// a field's value read by what it is. No herdr imports, so scripts/ tests it.

import type { Board, Content, Field, FieldType, FieldValue, Item, Iteration } from "./board.ts";

// ---- the filter: GitHub's syntax, the part the tab speaks

/** A `key:values` part of a filter, `neg` when it starts with `-`. */
export interface Term {
  readonly key: string;
  readonly values: readonly string[];
  readonly neg: boolean;
}

/** A parsed filter: its terms and its loose words (lowercased). */
export interface Filter {
  readonly terms: readonly Term[];
  readonly words: readonly string[];
}

/** `assignee:@me label:"good first issue",bug -status:Done is:open repo:o/r no:assignee word` ->
 *  { terms: [{ key, values, neg }], words: [] }. Quotes keep spaces; commas are "or"; a leading `-` negates. */
export function parseFilter(text: string | null | undefined): Filter {
  const terms: Term[] = [], words: string[] = [];
  const re = /(-?)([A-Za-z][\w-]*):((?:"[^"]*"|[^\s"]+)(?:,(?:"[^"]*"|[^\s",]+))*)|"([^"]*)"|(\S+)/g;

  for (const [, neg, key, list, quoted, word] of (text ?? "").matchAll(re)) {
    if (key) {
      const values = [...(list ?? "").matchAll(/"([^"]*)"|([^,]+)/g)].flatMap((v) => {
        const value = (v[1] ?? v[2] ?? "").trim();

        return value === "" ? [] : [value];
      });

      terms.push({ key: key.toLowerCase(), values, neg: neg === "-" });
    } else {
      const w = (quoted ?? word ?? "").trim();

      if (w) words.push(w.toLowerCase());
    }
  }

  return { terms, words };
}

/** A part of a filter as a person reads it back. */
export interface FilterToken {
  readonly kind: "key" | "value" | "word";
  readonly text: string;
}

/** The filter's parts as a person reads them back: [{ text, kind: "key" | "value" | "word" }]. */
export function filterTokens(text: string | null | undefined): FilterToken[] {
  const out: FilterToken[] = [];
  const f = parseFilter(text);

  for (const t of f.terms) out.push({ kind: "key", text: `${t.neg ? "-" : ""}${t.key}:` }, { kind: "value", text: t.values.map((v) => (/\s/.test(v) ? `"${v}"` : v)).join(",") });

  for (const w of f.words) out.push({ kind: "word", text: w });

  return out;
}

export const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

// A field by the name a filter gives it: GitHub writes "Target date" as target-date.
const dashed = (s: string) => lower(s).trim().replace(/\s+/g, "-");
const fieldByName = (board: Board, name: string) => board.fields.find((f) => dashed(f.name) === dashed(name)) ?? null;

// ---- a field's value, by what it is

export const selectOf = (v: FieldValue | undefined) => (v && "optionId" in v ? v : null);

export const iterationOf = (v: FieldValue | undefined) => (v && "iterationId" in v ? v : null);

export const textOf = (v: FieldValue | undefined) => (v && "text" in v ? v.text : null);

export const numberOf = (v: FieldValue | undefined) => (v && "number" in v ? v.number : null);

export const dateOf = (v: FieldValue | undefined) => (v && "date" in v ? v.date : null);

export const namesOf = (v: FieldValue | undefined) => (v && "names" in v ? v.names : null);

/** Which iteration `@current`, `@next` or `@previous` means today (or null). */
export function iterationAt(field: Field | null | undefined, word: string, now = Date.now()): Iteration | null {
  const list = field?.type === "iteration" ? field.iterations : [];
  const day = 86400000;

  const i = list.findIndex((it) => {
    const s = Date.parse(it.startDate);

    return now >= s && now < s + it.duration * day;
  });

  const at = i >= 0 ? i : list.findIndex((it) => Date.parse(it.startDate) > now) - 0.5;
  const k = word === "@current" ? at : word === "@next" ? Math.floor(at) + 1 : word === "@previous" ? Math.ceil(at) - 1 : NaN;

  return Number.isInteger(k) ? list[k] ?? null : null;
}

/** An item's words for one field, lowercased (what `field:value` compares against). */
export function valuesOf(_board: Board, item: Item, field: Field, _now = Date.now()): string[] {
  const c = item.content, v = item.values.get(field.id);

  switch (field.type) {
    case "title": return [lower(c.title)];
    case "assignees": return c.assignees.map((a) => lower(a.login));
    case "labels": return c.labels.map((l) => lower(l.name));
    case "repo": return c.repo ? [lower(c.repo), lower(c.repo.split("/")[1])] : [];
    case "milestone": return c.milestone ? [lower(c.milestone)] : [];
    case "single": {
      const s = selectOf(v);

      return s ? [lower(s.name)] : [];
    }

    case "iteration": {
      const it = iterationOf(v);

      return it ? [lower(it.title)] : [];
    }

    case "text": {
      const t = textOf(v);

      return t ? [lower(t)] : [];
    }

    case "number": {
      const n = numberOf(v);

      return n === null ? [] : [String(n)];
    }

    case "date": {
      const d = dateOf(v);

      return d ? [d] : [];
    }

    case "multi": {
      const names = namesOf(v);

      return names ? names.split(",").map((s) => lower(s.trim())) : [];
    }

    default: return [];
  }
}

/** Who `@me` is and when now is, for a filter. */
export interface FilterContext {
  readonly me?: string | null | undefined;
  readonly now?: number | undefined;
}

const TYPE_WORDS = new Map<string, Content["kind"]>([["issue", "issue"], ["pr", "pr"], ["pullrequest", "pr"], ["draft", "draft"], ["draftissue", "draft"]]);

const fieldOfType = (board: Board, type: FieldType) => board.fields.find((f) => f.type === type) ?? null;

function isWord(item: Item, word: string): boolean {
  const c = item.content;
  const v = lower(word);

  if (v === "open") return c.state === "OPEN" || c.kind === "draft";

  if (v === "closed") return c.state === "CLOSED" || c.state === "MERGED";

  if (v === "merged") return c.state === "MERGED";

  if (v === "draft") return c.kind === "draft" || c.isDraft;

  if (v === "issue") return c.kind === "issue";

  if (v === "pr") return c.kind === "pr";

  if (v === "archived") return item.archived;

  return false;
}

function termMatches(board: Board, item: Item, t: Term, me: string | null, now: number): boolean {
  const c = item.content;
  const mine = (v: string) => (v === "@me" && me ? lower(me) : lower(v));
  const any = (have: readonly string[], wanted: readonly string[]) => wanted.some((w) => have.includes(w));

  switch (t.key) {
    case "is": return t.values.some((v) => isWord(item, v));
    // GitHub's own spelling is pull_request; underscores, dashes and spaces are dropped before the lookup.
    case "type": return t.values.some((v) => TYPE_WORDS.get(lower(v).replace(/[\s_-]/g, "")) === c.kind);
    case "assignee": return any(c.assignees.map((a) => lower(a.login)), t.values.map(mine));
    case "label": return any(c.labels.map((l) => lower(l.name)), t.values.map(lower));
    case "repo": return any(c.repo ? [lower(c.repo), lower(c.repo.split("/")[1])] : [], t.values.map(lower));
    case "no": case "has": {
      const has = (v: string) => {
        const f = fieldByName(board, v) ?? (v === "assignee" ? fieldOfType(board, "assignees") : v === "label" ? fieldOfType(board, "labels") : null);

        if (v === "assignee") return c.assignees.length > 0;

        if (v === "label") return c.labels.length > 0;

        return f ? valuesOf(board, item, f, now).length > 0 : false;
      };

      return t.values.some((v) => (t.key === "has") === has(lower(v)));
    }

    default: {
      const f = fieldByName(board, t.key);

      if (!f) return true; // unknown qualifiers don't hide anything

      const have = valuesOf(board, item, f, now);

      return t.values.some((v) => {
        if (f.type === "iteration" && v.startsWith("@")) {
          const it = iterationAt(f, lower(v), now);

          return Boolean(it) && have.includes(lower(it?.title));
        }

        if (f.type === "number" || f.type === "date") return compare(have[0], v);

        return have.includes(mine(v));
      });
    }
  }
}

/** `>3`, `<=2026-01-01`, `1..5` or a plain value against a number or date. */
function compare(have: string | undefined, v: string): boolean {
  if (have === undefined) return false;

  const num = (x: string) => (/^\d{4}-\d\d-\d\d$/.test(x) ? Date.parse(x) : Number(x));
  const h = num(have);
  const range = /^(.+)\.\.(.+)$/.exec(v);

  if (range) return h >= num(range[1] ?? "") && h <= num(range[2] ?? "");

  const op = /^(>=|<=|>|<)(.+)$/.exec(v);

  if (!op) return h === num(v);

  const x = num(op[2] ?? "");

  return op[1] === ">" ? h > x : op[1] === "<" ? h < x : op[1] === ">=" ? h >= x : h <= x;
}

/** Whether an item passes a parsed filter. ctx: { me, now }. */
export function matches(board: Board, item: Item, filter: Filter, ctx: FilterContext = {}): boolean {
  const me = ctx.me ?? null, now = ctx.now ?? Date.now();

  for (const t of filter.terms) if (termMatches(board, item, t, me, now) === t.neg) return false;

  if (!filter.words.length) return true;

  const c = item.content;
  const hay = lower([c.title, c.number === null ? "" : `#${c.number}`, c.repo, ...c.labels.map((l) => l.name), ...c.assignees.map((a) => a.login)].join(" "));

  return filter.words.every((w) => hay.includes(w));
}
