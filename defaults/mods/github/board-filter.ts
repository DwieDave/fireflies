// The Projects tab's filter (board.ts's board, projects.ts types it): GitHub's
// filter syntax, the part the tab speaks, parsed and matched against a card;
// a field's value read by what it is. No herdr imports, so scripts/ tests it.

import { Array as Arr, Option, String as Str } from "effect";
import type { Board, Content, Field, FieldValue, Item, Iteration } from "./board.ts";

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

  for (const [, neg, key, list, quoted, word] of Str.matchAll(re)(text ?? "")) {
    if (key !== undefined && key !== "") {
      const values = Arr.filter(Arr.map(Arr.fromIterable(Str.matchAll(/"([^"]*)"|([^,]+)/g)(list ?? "")), (v) => Str.trim(v[1] ?? v[2] ?? "")), Str.isNonEmpty);

      terms.push({ key: Str.toLowerCase(key), values, neg: neg === "-" });
    } else {
      const w = Str.trim(quoted ?? word ?? "");

      if (w !== "") words.push(Str.toLowerCase(w));
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

  for (const t of f.terms) out.push({ kind: "key", text: `${t.neg ? "-" : ""}${t.key}:` }, { kind: "value", text: Arr.join(Arr.map(t.values, (v) => (/\s/.test(v) ? `"${v}"` : v)), ",") });

  for (const w of f.words) out.push({ kind: "word", text: w });

  return out;
}

export const lower = (s: string | null | undefined): string => Str.toLowerCase(s ?? "");

// A field by the name a filter gives it: GitHub writes "Target date" as target-date.
const dashed = (s: string) => Str.replace(/\s+/g, "-")(Str.trim(lower(s)));
const fieldByName = (board: Board, name: string) => Option.getOrNull(Arr.findFirst(board.fields, (f) => dashed(f.name) === dashed(name)));

// ---- a field's value, by what it is

export const selectOf = (v: FieldValue | undefined) => (v !== undefined && "optionId" in v ? v : null);

export const iterationOf = (v: FieldValue | undefined) => (v !== undefined && "iterationId" in v ? v : null);

export const textOf = (v: FieldValue | undefined) => (v !== undefined && "text" in v ? v.text : null);

export const numberOf = (v: FieldValue | undefined) => (v !== undefined && "number" in v ? v.number : null);

export const dateOf = (v: FieldValue | undefined) => (v !== undefined && "date" in v ? v.date : null);

export const namesOf = (v: FieldValue | undefined) => (v !== undefined && "names" in v ? v.names : null);

/** Where `word` (`@current`, `@next`, `@previous`) points from `at`, the index of the iteration running now
 *  (half way between two when none runs); NaN for another word. */
function iterationStep(word: string, at: number): number {
  switch (word) {
    case "@current": return at;
    case "@next": return Math.floor(at) + 1;
    case "@previous": return Math.ceil(at) - 1;
    default: return NaN;
  }
}

/** The index of the first iteration `test` takes, or -1. */
const indexOf = (list: readonly Iteration[], test: (it: Iteration) => boolean): number => Option.getOrElse(Arr.findFirstIndex(list, test), () => -1);

/** Which iteration `@current`, `@next` or `@previous` means at `now` (ms), or null. */
export function iterationAt(field: Field | null | undefined, word: string, now: number): Iteration | null {
  const list = field?.type === "iteration" ? field.iterations : [];
  const day = 86400000;

  const i = indexOf(list, (it) => {
    const s = Date.parse(it.startDate);

    return now >= s && now < s + it.duration * day;
  });

  const k = iterationStep(word, i >= 0 ? i : indexOf(list, (it) => Date.parse(it.startDate) > now) - 0.5);

  return Number.isInteger(k) ? list[k] ?? null : null;
}

/** An item's words for one field, lowercased (what `field:value` compares against). */
export function valuesOf(_board: Board, item: Item, field: Field): string[] {
  const c = item.content, v = item.values.get(field.id);

  switch (field.type) {
    case "title": return [lower(c.title)];
    case "assignees": return Arr.map(c.assignees, (a) => lower(a.login));
    case "labels": return Arr.map(c.labels, (l) => lower(l.name));
    case "repo": return repoWords(c.repo);
    case "milestone": return c.milestone === null || c.milestone === "" ? [] : [lower(c.milestone)];
    case "single": {
      const s = selectOf(v);

      return s === null ? [] : [lower(s.name)];
    }

    case "iteration": {
      const it = iterationOf(v);

      return it === null ? [] : [lower(it.title)];
    }

    case "text": {
      const t = textOf(v);

      return t === null || t === "" ? [] : [lower(t)];
    }

    case "number": {
      const n = numberOf(v);

      return n === null ? [] : [String(n)];
    }

    case "date": {
      const d = dateOf(v);

      return d === null || d === "" ? [] : [d];
    }

    case "multi": {
      const names = namesOf(v);

      return names === null || names === "" ? [] : Arr.map(Str.split(names, ","), (s) => lower(Str.trim(s)));
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

/** A repo's words: owner/name and the name alone. */
const repoWords = (repo: string | null): string[] => (repo === null || repo === "" ? [] : [lower(repo), lower(Str.split(repo, "/")[1])]);

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

function termMatches(board: Board, item: Item, t: Term, me: string | null, now: number | null): boolean {
  const c = item.content;
  const mine = (v: string) => (v === "@me" && me !== null && me !== "" ? lower(me) : lower(v));
  const any = (have: readonly string[], wanted: readonly string[]) => Arr.some(wanted, (w) => have.includes(w));

  switch (t.key) {
    case "is": return Arr.some(t.values, (v) => isWord(item, v));
    // GitHub's own spelling is pull_request; underscores, dashes and spaces are dropped before the lookup.
    case "type": return Arr.some(t.values, (v) => TYPE_WORDS.get(Str.replace(/[\s_-]/g, "")(lower(v))) === c.kind);
    case "assignee": return any(Arr.map(c.assignees, (a) => lower(a.login)), Arr.map(t.values, mine));
    case "label": return any(Arr.map(c.labels, (l) => lower(l.name)), Arr.map(t.values, lower));
    case "repo": return any(repoWords(c.repo), Arr.map(t.values, lower));
    case "no": case "has": {
      const has = (v: string) => {
        if (v === "assignee") return c.assignees.length > 0;

        if (v === "label") return c.labels.length > 0;

        const f = fieldByName(board, v);

        return f === null ? false : valuesOf(board, item, f).length > 0;
      };

      return Arr.some(t.values, (v) => (t.key === "has") === has(lower(v)));
    }

    default: {
      const f = fieldByName(board, t.key);

      if (f === null) return true; // unknown qualifiers don't hide anything

      const have = valuesOf(board, item, f);

      return Arr.some(t.values, (v) => {
        if (f.type === "iteration" && Str.startsWith("@")(v)) {
          // Without the time, no iteration is the current one.
          const it = now === null ? null : iterationAt(f, lower(v), now);

          return it !== null && have.includes(lower(it.title));
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

  if (range !== null) return h >= num(range[1] ?? "") && h <= num(range[2] ?? "");

  const op = /^(>=|<=|>|<)(.+)$/.exec(v);

  if (op === null) return h === num(v);

  const x = num(op[2] ?? "");

  switch (op[1]) {
    case ">": return h > x;
    case "<": return h < x;
    case ">=": return h >= x;
    default: return h <= x;
  }
}

/** Whether an item passes a parsed filter. ctx: { me, now } (without `now`, `@current` and its kin match nothing). */
export function matches(board: Board, item: Item, filter: Filter, ctx: FilterContext = {}): boolean {
  const me = ctx.me ?? null, now = ctx.now ?? null;

  for (const t of filter.terms) if (termMatches(board, item, t, me, now) === t.neg) return false;

  if (filter.words.length === 0) return true;

  const c = item.content;
  const hay = lower(Arr.join([c.title, c.number === null ? "" : `#${c.number}`, c.repo ?? "", ...Arr.map(c.labels, (l) => l.name), ...Arr.map(c.assignees, (a) => a.login)], " "));

  return Arr.every(filter.words, (w) => Str.includes(w)(hay));
}
