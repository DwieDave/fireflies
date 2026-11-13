// Changing a Projects board (board.ts's): the optimistic edits laid over the
// last read, and the GraphQL mutations that make them on GitHub. No herdr
// imports, so scripts/ tests it.

import { isNumber, isString, object } from "./guard.ts";
import { maybe } from "./guards.ts";
import { dateOf, iterationOf, numberOf, selectOf, textOf } from "./board-filter.ts";
import type { Board, Content, Field, FieldValue, Item } from "./board.ts";
import { text } from "./board.ts";

// ---- edits: optimistic, laid over the last read

/** A field value as the board stores it, from what the menu chose. */
export function valueFor(field: Field, choice: string | number | null | undefined): FieldValue | null {
  if (choice === null || choice === undefined || choice === "") return null;

  if (field.type === "single") {
    const o = field.options.find((x) => x.id === choice);

    return o ? { optionId: o.id, name: o.name } : null;
  }

  if (field.type === "iteration") {
    const it = field.iterations.find((x) => x.id === choice);

    return it ? { iterationId: it.id, title: it.title, startDate: it.startDate, duration: it.duration } : null;
  }

  if (field.type === "number") {
    const n = Number(choice);

    return Number.isFinite(n) ? { number: n } : null;
  }

  if (field.type === "date") return isString(choice) && /^\d{4}-\d\d-\d\d$/.test(choice) ? { date: choice } : null;

  return { text: String(choice) };
}

/** An edit to lay over the board (see apply). */
export type Op =
  | { readonly kind: "field"; readonly item: string; readonly field: string; readonly value: FieldValue | null }
  | { readonly kind: "position"; readonly item: string; readonly afterId: string | null }
  | { readonly kind: "archive"; readonly item: string }
  | { readonly kind: "add"; readonly item: Item }
  | { readonly kind: "content"; readonly item: string; readonly patch: Partial<Content> };

/** The board with one edit applied (a new board; the old one is untouched). ops:
 *  { kind: "field", item, field, value } (value null clears), { kind: "position", item, afterId },
 *  { kind: "archive", item }, { kind: "add", item: <a whole item> }, { kind: "content", item, patch } (title, labels, assignees). */
export function apply(board: Board, op: Op): Board {
  const items = board.items;
  const id = op.kind === "add" ? op.item.id : op.item;
  const i = items.findIndex((x) => x.id === id);

  switch (op.kind) {
    case "add": return i >= 0 ? board : { ...board, items: [...items, op.item] };
    case "archive": return i < 0 ? board : { ...board, items: items.filter((_, k) => k !== i) };
    case "field": {
      if (i < 0) return board;

      return {
        ...board,
        items: items.map((x, k) => {
          if (k !== i) return x;

          const values = new Map(x.values);

          if (op.value === null) values.delete(op.field);
          else values.set(op.field, op.value);

          return { ...x, values };
        }),
      };
    }

    case "content": return i < 0 ? board : { ...board, items: items.map((x, k) => (k === i ? { ...x, content: { ...x.content, ...op.patch } } : x)) };
    case "position": {
      const it = items[i];

      if (!it) return board;

      const rest = items.filter((_, k) => k !== i);
      const at = op.afterId === null ? 0 : rest.findIndex((x) => x.id === op.afterId) + 1;

      if (op.afterId !== null && at === 0) return board;

      return { ...board, items: [...rest.slice(0, at), it, ...rest.slice(at)] };
    }
  }
}

/** An edit on its way to GitHub. */
export interface Pending {
  readonly op: Op;
}

/** The board shown: the last read with every edit still on its way laid over it. A failed edit is dropped from
 *  `pending`, which is its rollback; one GitHub took stays until a read after it, which already has it. */
export const overlay = (board: Board, pending: readonly Pending[] | null | undefined): Board => {
  let shown = board;

  for (const p of pending ?? []) shown = apply(shown, p.op);

  return shown;
};

// ---- mutations (literal arguments: gh api's -f only takes strings)

const lit = (v: string | readonly string[]) => JSON.stringify(v);

/** The GraphQL value of a field edit. */
function valueLiteral(field: Field, value: FieldValue): string {
  if (field.type === "single") return `{ singleSelectOptionId: ${lit(selectOf(value)?.optionId ?? "")} }`;

  if (field.type === "iteration") return `{ iterationId: ${lit(iterationOf(value)?.iterationId ?? "")} }`;

  if (field.type === "number") return `{ number: ${Number(numberOf(value))} }`;

  if (field.type === "date") return `{ date: ${lit(dateOf(value) ?? "")} }`;

  return `{ text: ${lit(textOf(value) ?? "")} }`;
}

export function setFieldMutation(projectId: string, itemId: string, field: Field, value: FieldValue | null | undefined): string {
  if (!value) return `mutation { clearProjectV2ItemFieldValue(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}, fieldId: ${lit(field.id)} }) { projectV2Item { id } } }`;

  return `mutation { updateProjectV2ItemFieldValue(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}, fieldId: ${lit(field.id)}, value: ${valueLiteral(field, value)} }) { projectV2Item { id } } }`;
}

export const positionMutation = (projectId: string, itemId: string, afterId: string | null | undefined): string =>
  `mutation { updateProjectV2ItemPosition(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}${afterId ? `, afterId: ${lit(afterId)}` : ""} }) { clientMutationId } }`;

export const archiveMutation = (projectId: string, itemId: string): string =>
  `mutation { archiveProjectV2Item(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)} }) { item { id } } }`;

export const addDraftMutation = (projectId: string, title: string): string =>
  `mutation { addProjectV2DraftIssue(input: { projectId: ${lit(projectId)}, title: ${lit(title)} }) { projectItem { id databaseId content { ... on DraftIssue { id } } } } }`;

/** addDraftMutation's answer: the new item's id. */
export const isAddedDraft = object({}, {
  addProjectV2DraftIssue: maybe(object({}, { projectItem: maybe(object({}, { id: text, databaseId: maybe(isNumber), content: maybe(object({}, { id: text })) })) })),
});

export const convertMutation = (itemId: string, repoId: string): string =>
  `mutation { convertProjectV2DraftIssueItemToIssue(input: { itemId: ${lit(itemId)}, repositoryId: ${lit(repoId)} }) { item { id content { ... on Issue { id number url } } } } }`;

/** A draft's changes: its title, its assignees (ids). */
export interface DraftPatch {
  readonly title?: string | null;
  readonly assigneeIds?: readonly string[] | null;
}

export const draftMutation = (draftId: string, { title, assigneeIds }: DraftPatch = {}): string =>
  `mutation { updateProjectV2DraftIssue(input: { draftIssueId: ${lit(draftId)}${isString(title) ? `, title: ${lit(title)}` : ""}${assigneeIds ? `, assigneeIds: ${lit(assigneeIds)}` : ""} }) { draftIssue { id } } }`;

/** Labels or assignees added and removed on an issue or pull request (ids). */
export function toggleMutation(contentId: string, kind: "labels" | "assignees", add: readonly string[], remove: readonly string[]): string | null {
  const [a, r, key] = kind === "labels" ? ["addLabelsToLabelable", "removeLabelsFromLabelable", "labelIds"] : ["addAssigneesToAssignable", "removeAssigneesFromAssignable", "assigneeIds"];
  const id = kind === "labels" ? "labelableId" : "assignableId";
  const parts: string[] = [];

  if (add.length) parts.push(`add: ${a}(input: { ${id}: ${lit(contentId)}, ${key}: ${lit(add)} }) { clientMutationId }`);

  if (remove.length) parts.push(`remove: ${r}(input: { ${id}: ${lit(contentId)}, ${key}: ${lit(remove)} }) { clientMutationId }`);

  return parts.length ? `mutation { ${parts.join(" ")} }` : null;
}
