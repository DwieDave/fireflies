// What a Projects card shows (projects.ts draws it): option colours, a
// person's initials and slot, a value in words, the fields a card and its
// editor list, text wrapped to the card. No herdr imports, so scripts/ tests it.

import type { Layout } from "./board-layout.ts";
import type { Board, Field, FieldType, FieldValue, Item, View } from "./board.ts";

// ---- drawing helpers

/** GitHub's option colors as the theme's ansi slots. */
export const OPTION_ANSI = new Map<string, number>([["GRAY", 8], ["BLUE", 4], ["GREEN", 2], ["YELLOW", 3], ["ORANGE", 3], ["RED", 1], ["PINK", 5], ["PURPLE", 5]]);

/** Up to two letters for a login's square. */
export const initials = (who: string | null | undefined): string => {
  const name = who ?? "?";
  const parts = name.split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  const [first, second] = parts;

  return ((parts.length > 1 && first && second ? (first[0] ?? "") + (second[0] ?? "") : name.slice(0, 2)) || "?").toUpperCase();
};

/** A login's stable color slot (1..6). */
export function loginSlot(who: string | null | undefined): number {
  let h = 0;

  for (const ch of who ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;

  return 1 + (h % 6);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A field value as a card prints it: "Sprint 4", "P1", "3", "Nov 14". */
export function valueText(_field: Field | null, v: FieldValue | null | undefined): string {
  if (!v) return "";

  if ("name" in v) return v.name;

  if ("title" in v) return v.title;

  if ("number" in v) return String(v.number);

  if ("date" in v) {
    if (!v.date) return "";

    const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(v.date);

    return m ? `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}` : v.date;
  }

  if ("names" in v) return v.names;

  return v.text;
}

const SKIP = new Set<FieldType>(["title", "assignees", "labels", "repo", "linked_pull_requests", "reviewers", "tracks", "tracked_by", "parent_issue", "sub_issues_progress"]);

/** The fields a card shows under its title: the view's visible ones that aren't the title, the columns,
 *  the lanes or drawn elsewhere (assignees, labels, repo). */
export function cardFields(board: Board, view: View | null | undefined, lay: Layout): Field[] {
  const ids = view?.visible.length ? view.visible : board.fields.map((f) => f.id);

  return ids.flatMap((id) => {
    const f = board.fields.find((x) => x.id === id);

    return f && !SKIP.has(f.type) && f.id !== lay.field?.id && f.id !== lay.lane?.id ? [f] : [];
  });
}

/** The fields the menu edits, in the board's order. */
export function editableFields(board: Board, item: Item | null | undefined): Field[] {
  const kinds: readonly FieldType[] = item?.content.kind === "draft"
    ? ["single", "iteration", "text", "number", "date", "assignees", "title"]
    : ["single", "iteration", "text", "number", "date", "assignees", "labels"];

  return board.fields.filter((f) => kinds.includes(f.type));
}

/** A title in at most `lines` lines of `width` characters (monospace), the last one cut with an ellipsis. */
export function wrap(text: string | null | undefined, width: number, lines = 2): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean), out: string[] = [];
  let line = "";

  for (const [i, w] of words.entries()) {
    const next = line ? `${line} ${w}` : w;

    if (next.length <= width) {
      line = next;

      continue;
    }

    if (line) out.push(line);

    line = w.length > width ? w.slice(0, width) : w;

    if (out.length === lines - 1) {
      const rest = [line, ...words.slice(i + 1)].join(" ");

      out.push(rest.length > width ? `${rest.slice(0, Math.max(1, width - 1))}…` : rest);

      return out;
    }
  }

  if (line) out.push(line);

  return out.length ? out : [""];
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
  if (item.content.url) return item.content.url;

  const base = `${b.project.url ?? ""}${view?.number ? `/views/${view.number}` : ""}`;

  return item.db ? `${base}?pane=issue&itemId=${item.db}` : base;
}
