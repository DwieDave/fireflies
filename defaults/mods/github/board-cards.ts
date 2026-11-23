// What a Projects card shows (projects.ts draws it): option colours, a
// person's initials and slot, a value in words, the fields a card and its
// editor list, text wrapped to the card. No herdr imports, so scripts/ tests it.

import { Array as Arr, Option, String as Str } from "effect";
import type { Layout } from "./board-layout.ts";
import type { Board, Field, FieldType, FieldValue, Item, View } from "./board.ts";

// ---- drawing helpers

/** GitHub's option colors as the theme's ansi slots. */
export const OPTION_ANSI = new Map<string, number>([["GRAY", 8], ["BLUE", 4], ["GREEN", 2], ["YELLOW", 3], ["ORANGE", 3], ["RED", 1], ["PINK", 5], ["PURPLE", 5]]);

/** Up to two letters for a login's square. */
export const initials = (who: string | null | undefined): string => {
  const name = who ?? "?";
  const parts = Arr.filter(Str.split(name, /[-_.\s]+|(?<=[a-z])(?=[A-Z])/), Str.isNonEmpty);
  const [first, second] = parts;
  const two = parts.length > 1 && first !== undefined && second !== undefined ? Str.slice(0, 1)(first) + Str.slice(0, 1)(second) : Str.slice(0, 2)(name);

  return Str.toUpperCase(two === "" ? "?" : two);
};

/** A login's stable color slot (1..6). */
export function loginSlot(who: string | null | undefined): number {
  let h = 0;

  for (const ch of who ?? "") h = (h * 31 + Option.getOrElse(Str.charCodeAt(ch, 0), () => 0)) >>> 0;

  return 1 + (h % 6);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A field value as a card prints it: "Sprint 4", "P1", "3", "Nov 14". */
export function valueText(_field: Field | null, v: FieldValue | null | undefined): string {
  if (v === null || v === undefined) return "";

  if ("name" in v) return v.name;

  if ("title" in v) return v.title;

  if ("number" in v) return String(v.number);

  if ("date" in v) {
    if (v.date === "") return "";

    const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(v.date);

    return m === null ? v.date : `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}`;
  }

  if ("names" in v) return v.names;

  return v.text;
}

const SKIP = new Set<FieldType>(["title", "assignees", "labels", "repo", "linked_pull_requests", "reviewers", "tracks", "tracked_by", "parent_issue", "sub_issues_progress"]);

/** The fields a card shows under its title: the view's visible ones that aren't the title, the columns,
 *  the lanes or drawn elsewhere (assignees, labels, repo). */
export function cardFields(board: Board, view: View | null | undefined, lay: Layout): Field[] {
  const ids = view !== null && view !== undefined && view.visible.length > 0 ? view.visible : Arr.map(board.fields, (f) => f.id);

  return Arr.flatMap(ids, (id) => Arr.filter(Arr.fromOption(Arr.findFirst(board.fields, (x) => x.id === id)),
    (f) => !SKIP.has(f.type) && f.id !== lay.field?.id && f.id !== lay.lane?.id));
}

/** The fields the menu edits, in the board's order. */
export function editableFields(board: Board, item: Item | null | undefined): Field[] {
  const kinds: readonly FieldType[] = item?.content.kind === "draft"
    ? ["single", "iteration", "text", "number", "date", "assignees", "title"]
    : ["single", "iteration", "text", "number", "date", "assignees", "labels"];

  return Arr.filter(board.fields, (f) => kinds.includes(f.type));
}

/** A title in at most `lines` lines of `width` characters (monospace), the last one cut with an ellipsis. */
export function wrap(text: string | null | undefined, width: number, lines = 2): string[] {
  const words = Arr.filter(Str.split(text ?? "", /\s+/), Str.isNonEmpty), out: string[] = [];
  let line = "";

  for (const [i, w] of words.entries()) {
    const next = line === "" ? w : `${line} ${w}`;

    if (next.length <= width) {
      line = next;

      continue;
    }

    if (line !== "") out.push(line);

    line = w.length > width ? Str.slice(0, width)(w) : w;

    if (out.length === lines - 1) {
      const rest = Arr.join([line, ...Arr.drop(words, i + 1)], " ");

      out.push(rest.length > width ? `${Str.slice(0, Math.max(1, width - 1))(rest)}…` : rest);

      return out;
    }
  }

  if (line !== "") out.push(line);

  return out.length > 0 ? out : [""];
}

// ---- a card's words (projects.ts and its parts)

/** A card's option color as an ansi slot (OPTION_ANSI; gray when it has none). */
export const ansiKey = (color: string | null | undefined) => OPTION_ANSI.get(color ?? "") ?? 8;

/** How a card is named in a note: its number, or "the draft". */
export const label = (item: Item | undefined): string => (item?.content.number !== null && item?.content.number !== undefined ? `#${item.content.number}` : "the draft");

/** How wide a card's number is, in characters (its # and a space). */
export const numW = (item: Item): number => (item.content.kind === "draft" ? 6 : item.content.number !== null ? String(item.content.number).length + 2 : 0);

/** Where o opens a card: its issue or PR, or the draft in the project's view. */
export function itemUrl(b: Board, view: View | null, item: Item): string | null {
  if (item.content.url !== null && item.content.url !== "") return item.content.url;

  const n = view?.number ?? null;
  const base = `${b.project.url ?? ""}${n === null || n === 0 ? "" : `/views/${n}`}`;

  return item.db === null || item.db === 0 ? base : `${base}?pane=issue&itemId=${item.db}`;
}
