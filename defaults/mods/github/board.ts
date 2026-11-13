// What the Projects tab knows about GitHub Projects (v2), as plain functions
// over GraphQL's JSON: the queries it sends, the board it reads out of the
// answers, and what of it the cache keeps. Beside it: GitHub's filter syntax
// (board-filter.ts), the columns and swimlanes of a view and carrying a card
// with the keyboard (board-layout.ts), the optimistic edits and the mutations
// (board-edits.ts), what a card shows (board-cards.ts). No herdr imports, so
// scripts/ tests it.
//
// A board: { project, fields, views, items, repos, total, more, viewer }
//   field  { id, name, type, options: [{ id, name, color }] (single), iterations: [{ id, title, startDate, duration, done }] (iteration) }
//   view   { id, number, name, layout, filter, visible: [fieldId], columnBy, groupBy, sort: [{ field, dir }] }
//   item   { id, db, type, archived, content: { kind, id, number, title, state, url, repo, assignees, labels, milestone }, values: fieldId -> value (a Map; an object on disk) }
//   value  { optionId, name } | { iterationId, title, startDate, duration } | { text } | { number } | { date } | { names }

import type { Guard, Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf } from "./guard.ts";
import { isList, mapOf, maybe, toJson, toMap } from "./guards.ts";

export const text = maybe(isString);

/** A list's items that `guard` proves (the others, nulls GitHub sends for what it won't show, left out). */
const proven = <T>(list: readonly unknown[] | null | undefined, guard: Guard<T>): T[] => (list ?? []).filter((x) => guard(x));

/** A GraphQL connection: its nodes, proven one by one where they're read. */
const nodes = maybe(object({}, { nodes: maybe(isList) }));

/** Someone's login (a user, an organization). */
const login = maybe(object({}, { login: text }));

// ---- reading

const OWNER = "owner { __typename ... on User { login } ... on Organization { login } }";
const PROJECT = `id number title url closed shortDescription updatedAt ${OWNER}`;
const ORDER = "orderBy: { field: UPDATED_AT, direction: DESC }";

/** What projectListQuery reads of a repo. */
export interface ListedRepo {
  readonly full: string;
  readonly parent?: string | null | undefined;
}

/** The projects a repo shows: linked to it (and to its parent, for a fork) and its owner's. */
export function projectListQuery(repo: ListedRepo): string {
  const [owner, name] = repo.full.split("/");
  const parent = repo.parent ? repo.parent.split("/") : null;
  const lit = JSON.stringify;

  return `query {
  viewer { login }
  repository(owner: ${lit(owner)}, name: ${lit(name)}) {
    id nameWithOwner
    projectsV2(first: 30, ${ORDER}) { nodes { ${PROJECT} } }
    owner { __typename login
      ... on User { projectsV2(first: 30, ${ORDER}) { nodes { ${PROJECT} } } }
      ... on Organization { projectsV2(first: 30, ${ORDER}) { nodes { ${PROJECT} } } } }
  }${parent ? `
  parent: repository(owner: ${lit(parent[0])}, name: ${lit(parent[1])}) { nameWithOwner projectsV2(first: 30, ${ORDER}) { nodes { ${PROJECT} } } }` : ""}
}`;
}

/** A project node of GitHub's answer. */
const isProjectNode = object({ id: isString }, {
  number: maybe(isNumber), title: text, url: text, closed: maybe(isBoolean), shortDescription: text, updatedAt: text, owner: login,
});

/** projectListQuery's answer: GitHub leaves out (null) what it won't show. */
export const isProjectListAnswer = object({}, {
  viewer: login,
  repository: maybe(object({}, { id: text, projectsV2: nodes, owner: maybe(object({}, { projectsV2: nodes })) })),
  parent: maybe(object({}, { projectsV2: nodes })),
});

export type ProjectListAnswer = Guarded<typeof isProjectListAnswer>;

/** Where the picker found a project. */
export const isFrom = literal("repo", "parent", "owner");

export type From = Guarded<typeof isFrom>;

/** A project as the picker lists it. */
export const isListedProject = object({
  id: isString, number: nullable(isNumber), title: isString, url: nullable(isString), closed: isBoolean, owner: nullable(isString),
  about: isString, updatedAt: nullable(isString), from: isFrom,
});

export type ListedProject = Guarded<typeof isListedProject>;

/** The picker's list: who reads it, the repo's id (to convert drafts into), the projects. */
export const isProjectList = object({ viewer: nullable(isString), repoId: nullable(isString), projects: arrayOf(isListedProject) });

export type ProjectList = Guarded<typeof isProjectList>;

const slimProject = (p: Guarded<typeof isProjectNode>, from: From): ListedProject => ({
  id: p.id, number: p.number ?? null, title: p.title ?? "", url: p.url ?? null, closed: Boolean(p.closed), owner: p.owner?.login ?? null,
  about: p.shortDescription || "", updatedAt: p.updatedAt ?? null, from,
});

const RANK = new Map<From, number>([["repo", 0], ["parent", 1], ["owner", 2]]);

/** The picker's projects, open ones first, each once: { viewer, repoId, projects: [{ ..., from: "repo" | "parent" | "owner" }] }. */
export function parseProjectList(data: ProjectListAnswer | null | undefined): ProjectList {
  const seen = new Set<string>(), out: ListedProject[] = [];

  const add = (list: readonly unknown[] | null | undefined, from: From) => {
    for (const n of proven(list, isProjectNode)) {
      if (seen.has(n.id)) continue;

      seen.add(n.id);
      out.push(slimProject(n, from));
    }
  };

  add(data?.repository?.projectsV2?.nodes, "repo");
  add(data?.parent?.projectsV2?.nodes, "parent");
  add(data?.repository?.owner?.projectsV2?.nodes, "owner");

  const rank = (p: ListedProject) => (p.closed ? 10 : 0) + (RANK.get(p.from) ?? 0);

  out.sort((a, b) => rank(a) - rank(b));

  return { viewer: data?.viewer?.login ?? null, repoId: data?.repository?.id ?? null, projects: out };
}

const F = "field { ... on ProjectV2FieldCommon { id } }";

const ITEM = `id databaseId type isArchived
  fieldValues(first: 30) { nodes { __typename
    ... on ProjectV2ItemFieldSingleSelectValue { optionId name ${F} }
    ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration ${F} }
    ... on ProjectV2ItemFieldTextValue { text ${F} }
    ... on ProjectV2ItemFieldNumberValue { number ${F} }
    ... on ProjectV2ItemFieldDateValue { date ${F} }
    ... on ProjectV2ItemFieldMultiSelectValue { value ${F} } } }
  content { __typename
    ... on DraftIssue { id title assignees(first: 8) { nodes { id login } } }
    ... on Issue { id number title state url repository { nameWithOwner } assignees(first: 8) { nodes { id login } } labels(first: 12) { nodes { id name color } } milestone { title } }
    ... on PullRequest { id number title state isDraft url repository { nameWithOwner } assignees(first: 8) { nodes { id login } } labels(first: 12) { nodes { id name color } } milestone { title } } }`;

const NAMED = "nodes { ... on ProjectV2FieldCommon { id name } }";

export const PAGE = 100;
export const MAX_ITEMS = 600;

/** One page of a board: the project's fields, views and linked repos with the first page of items; later pages only items. */
export function boardQuery(first = true): string {
  const items = `items(first: ${PAGE}, after: $after, orderBy: { field: POSITION, direction: ASC }) { totalCount pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`;

  if (!first) return `query($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { id ${items} } } }`;

  return `query($id: ID!, $after: String) { viewer { login } node(id: $id) { ... on ProjectV2 { ${PROJECT}
  fields(first: 50) { nodes { __typename
    ... on ProjectV2FieldCommon { id name dataType }
    ... on ProjectV2SingleSelectField { options { id name color } }
    ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } } } }
  views(first: 30) { nodes { id number name layout filter
    fields(first: 40) { ${NAMED} }
    groupByFields(first: 2) { ${NAMED} }
    verticalGroupByFields(first: 2) { ${NAMED} }
    sortByFields(first: 5) { nodes { direction field { ... on ProjectV2FieldCommon { id name } } } } } }
  repositories(first: 20) { nodes { id nameWithOwner } }
  ${items} } } }`;
}

// ---- the board's records (as drawn, and as the cache keeps them)

/** An option of a single select field. */
export const isOption = object({ id: isString, name: isString, color: isString });

export type FieldOption = Guarded<typeof isOption>;

/** An iteration of an iteration field: `done` when it's over. */
export const isIteration = object({ id: isString, title: isString, startDate: isString, duration: isNumber, done: isBoolean });

export type Iteration = Guarded<typeof isIteration>;

/** The kinds of field that have no options of their own (GitHub's dataType, lowercased and
 *  shortened; "other": one GitHub added after this list). */
export const isPlainType = literal("text", "number", "date", "multi", "title", "assignees", "labels", "repo", "milestone",
  "linked_pull_requests", "reviewers", "tracks", "tracked_by", "parent_issue", "sub_issues_progress", "issue_type", "other");

export type PlainType = Guarded<typeof isPlainType>;

/** A project field, a union on its type: a single select has its options, an iteration field its iterations. */
export const isField = oneOf(
  object({ id: isString, name: isString, type: literal("single"), options: arrayOf(isOption) }),
  object({ id: isString, name: isString, type: literal("iteration"), iterations: arrayOf(isIteration) }),
  object({ id: isString, name: isString, type: isPlainType }),
);

export type Field = Guarded<typeof isField>;

export type FieldType = Field["type"];

/** A sort of a view: the field, ascending (1) or descending (-1). */
export const isSort = object({ field: isString, dir: literal(1, -1) });

export const isView = object({
  id: isString, number: nullable(isNumber), name: isString, layout: isString, filter: isString, visible: arrayOf(isString),
  columnBy: nullable(isString), groupBy: nullable(isString), sort: arrayOf(isSort),
});

export type View = Guarded<typeof isView>;

/** A single select's value. */
export const isSelectValue = object({ optionId: isString, name: isString });

export const isIterationValue = object({ iterationId: isString, title: isString, startDate: isString, duration: isNumber });

export const isTextValue = object({ text: isString });

export const isNumberValue = object({ number: isNumber });

export const isDateValue = object({ date: isString });

/** A multi select's value: its names, comma separated. */
export const isNamesValue = object({ names: isString });

/** An item's value for a field: which one it is follows from the field's type. */
export const isFieldValue = oneOf(isSelectValue, isIterationValue, isTextValue, isNumberValue, isDateValue, isNamesValue);

export type FieldValue = Guarded<typeof isFieldValue>;

export const isKind = literal("pr", "issue", "draft", "redacted");

export const isAssignee = object({ id: nullable(isString), login: isString });

export type Assignee = Guarded<typeof isAssignee>;

export const isCardLabel = object({ id: nullable(isString), name: isString, color: isString });

export type CardLabel = Guarded<typeof isCardLabel>;

/** What an item is: an issue, a pull request, a draft, or one this login can't see. */
export const isContent = object({
  kind: isKind, id: nullable(isString), number: nullable(isNumber), title: isString, state: nullable(isString), isDraft: isBoolean,
  url: nullable(isString), repo: nullable(isString), assignees: arrayOf(isAssignee), labels: arrayOf(isCardLabel), milestone: nullable(isString),
});

export type Content = Guarded<typeof isContent>;

/** A project item: its content and its values by field id. */
export interface Item {
  readonly id: string;
  readonly db: number | null;
  readonly type: string | null;
  readonly archived: boolean;
  readonly content: Content;
  readonly values: ReadonlyMap<string, FieldValue>;
}

/** The project a board is of. */
export const isBoardProject = object({
  id: isString, number: nullable(isNumber), title: isString, url: nullable(isString), closed: isBoolean, owner: nullable(isString),
});

export type BoardProject = Guarded<typeof isBoardProject>;

export const isBoardRepo = object({ id: isString, full: isString });

/** A board: the project, its fields and views, the repos linked to it, the items read so far
 *  (`total` of them, `more`: the next page's cursor). */
export interface Board {
  readonly project: BoardProject;
  readonly viewer: string | null;
  readonly fields: readonly Field[];
  readonly views: readonly View[];
  readonly repos: readonly Guarded<typeof isBoardRepo>[];
  readonly items: readonly Item[];
  readonly total: number;
  readonly more: string | null;
}

/** An item as the cache file holds it: its values an object by field id. */
const isStoredItem = object({
  id: isString, db: nullable(isNumber), type: nullable(isString), archived: isBoolean, content: isContent, values: mapOf(isFieldValue),
});

/** A board as the cache file holds it (slimBoard). */
export const isStoredBoard = object({
  project: isBoardProject, viewer: nullable(isString), fields: arrayOf(isField), views: arrayOf(isView), repos: arrayOf(isBoardRepo),
  items: arrayOf(isStoredItem), total: isNumber, more: nullable(isString),
});

export type StoredBoard = Guarded<typeof isStoredBoard>;

/** A board read back from the cache. */
export const boardOf = (b: StoredBoard): Board => ({ ...b, items: b.items.map((i) => ({ ...i, values: toMap(i.values) })) });

// ---- GitHub's answers

const isOptionNode = object({ id: isString, name: isString }, { color: text });

const isIterationNode = object({ id: isString, title: isString, startDate: isString, duration: isNumber });

const isFieldNode = object({ id: isString }, {
  name: text, dataType: text, options: maybe(isList),
  configuration: maybe(object({}, { iterations: maybe(isList), completedIterations: maybe(isList) })),
});

const isNamedNode = object({ id: isString });

const isSortNode = object({}, { direction: text, field: maybe(object({}, { id: text })) });

const isViewNode = object({ id: isString }, {
  number: maybe(isNumber), name: text, layout: text, filter: text, fields: nodes, groupByFields: nodes, verticalGroupByFields: nodes, sortByFields: nodes,
});

const isRepoNode = object({ id: isString, nameWithOwner: isString });

const isValueNode = object({}, {
  __typename: text, optionId: text, name: text, iterationId: text, title: text, startDate: text, duration: maybe(isNumber),
  text, number: maybe(isNumber), date: text, value: text, field: maybe(object({}, { id: text })),
});

const isAssigneeNode = object({ login: isString }, { id: text });

const isLabelNode = object({ name: isString }, { id: text, color: text });

const isContentNode = object({}, {
  __typename: text, id: text, number: maybe(isNumber), title: text, state: text, isDraft: maybe(isBoolean), url: text,
  repository: maybe(object({}, { nameWithOwner: text })), assignees: nodes, labels: nodes, milestone: maybe(object({}, { title: text })),
});

/** An item node of GitHub's answer. */
export const isItemNode = object({ id: isString }, {
  databaseId: maybe(isNumber), type: text, isArchived: maybe(isBoolean), fieldValues: nodes, content: maybe(isContentNode),
});

export type ItemNode = Guarded<typeof isItemNode>;

const isItems = maybe(object({}, {
  totalCount: maybe(isNumber), pageInfo: maybe(object({}, { hasNextPage: maybe(isBoolean), endCursor: text })), nodes: maybe(isList),
}));

/** boardQuery's answer, either page: the project (fields, views, repos on the first) and a page of its items. */
export const isBoardAnswer = object({}, {
  viewer: login,
  node: maybe(object({}, {
    id: text, number: maybe(isNumber), title: text, url: text, closed: maybe(isBoolean), owner: login,
    fields: nodes, views: nodes, repositories: nodes, items: isItems,
  })),
});

export type BoardAnswer = Guarded<typeof isBoardAnswer>;

const TYPES = new Map<string, FieldType>([
  ["SINGLE_SELECT", "single"], ["ITERATION", "iteration"], ["TEXT", "text"], ["NUMBER", "number"], ["DATE", "date"], ["MULTI_SELECT", "multi"],
  ["TITLE", "title"], ["ASSIGNEES", "assignees"], ["LABELS", "labels"], ["REPOSITORY", "repo"], ["MILESTONE", "milestone"],
]);

/** The field's kind from GitHub's dataType. */
function fieldType(dataType: string | null | undefined): FieldType {
  const known = TYPES.get(dataType ?? "");

  if (known) return known;

  const lower = (dataType ?? "").toLowerCase();

  return isPlainType(lower) ? lower : "other";
}

function parseField(n: Guarded<typeof isFieldNode>): Field {
  const base = { id: n.id, name: n.name ?? "" };
  const type = fieldType(n.dataType);

  if (type === "single") return { ...base, type, options: proven(n.options, isOptionNode).map((o) => ({ id: o.id, name: o.name, color: o.color ?? "GRAY" })) };

  if (type === "iteration") {
    const it = (x: Guarded<typeof isIterationNode>, done: boolean): Iteration => ({ id: x.id, title: x.title, startDate: x.startDate, duration: x.duration, done });
    const c = n.configuration;

    const iterations = [...proven(c?.completedIterations, isIterationNode).map((x) => it(x, true)), ...proven(c?.iterations, isIterationNode).map((x) => it(x, false))]
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    return { ...base, type, iterations };
  }

  return { ...base, type };
}

function parseView(n: Guarded<typeof isViewNode>): View {
  const ids = (c: Guarded<typeof nodes>) => proven(c?.nodes, isNamedNode).map((x) => x.id);

  return {
    id: n.id, number: n.number ?? null, name: n.name ?? "", layout: (n.layout ?? "BOARD_LAYOUT").replace(/_LAYOUT$/, "").toLowerCase(),
    filter: n.filter ?? "", visible: ids(n.fields), columnBy: ids(n.verticalGroupByFields)[0] ?? null, groupBy: ids(n.groupByFields)[0] ?? null,
    sort: proven(n.sortByFields?.nodes, isSortNode).flatMap((s) => (s.field?.id ? [{ field: s.field.id, dir: s.direction === "DESC" ? -1 : 1 } as const] : [])),
  };
}

/** A field value node as the board keeps it (null: not one it knows, or without its id). */
function parseValue(v: Guarded<typeof isValueNode>): FieldValue | null {
  switch (v.__typename) {
    case "ProjectV2ItemFieldSingleSelectValue":
      return v.optionId ? { optionId: v.optionId, name: v.name ?? "" } : null;
    case "ProjectV2ItemFieldIterationValue":
      return v.iterationId ? { iterationId: v.iterationId, title: v.title ?? "", startDate: v.startDate ?? "", duration: v.duration ?? 0 } : null;
    case "ProjectV2ItemFieldTextValue":
      return { text: v.text ?? "" };
    case "ProjectV2ItemFieldNumberValue":
      return isNumber(v.number) ? { number: v.number } : null;
    case "ProjectV2ItemFieldDateValue":
      return { date: v.date ?? "" };
    case "ProjectV2ItemFieldMultiSelectValue":
      return { names: v.value ?? "" };
    default:
      return null;
  }
}

const KINDS = new Map<string, Content["kind"]>([["PullRequest", "pr"], ["Issue", "issue"], ["DraftIssue", "draft"]]);

/** A project item as the board draws it. */
export function parseItem(n: ItemNode): Item {
  const c = n.content;
  const kind = KINDS.get(c?.__typename ?? "") ?? "redacted";
  const values = new Map<string, FieldValue>();

  for (const v of proven(n.fieldValues?.nodes, isValueNode)) {
    const id = v.field?.id;
    const value = parseValue(v);

    if (id && value) values.set(id, value);
  }

  return {
    id: n.id, db: n.databaseId ?? null, type: n.type ?? null, archived: Boolean(n.isArchived),
    content: {
      kind, id: c?.id ?? null, number: c?.number ?? null, title: c?.title ?? (kind === "redacted" ? "(no access)" : ""),
      state: kind === "draft" ? "DRAFT" : c?.state ?? null, isDraft: Boolean(c?.isDraft), url: c?.url ?? null, repo: c?.repository?.nameWithOwner ?? null,
      assignees: proven(c?.assignees?.nodes, isAssigneeNode).map((a) => ({ id: a.id ?? null, login: a.login })),
      labels: proven(c?.labels?.nodes, isLabelNode).map((l) => ({ id: l.id ?? null, name: l.name, color: l.color ?? "666666" })),
      milestone: c?.milestone?.title ?? null,
    },
    values,
  };
}

/** The first page's answer as a board (later pages go through addPage). */
export function parseBoard(data: BoardAnswer | null | undefined): Board | null {
  const p = data?.node;

  if (!p?.id) return null;

  const board: Board = {
    project: { id: p.id, number: p.number ?? null, title: p.title ?? "", url: p.url ?? null, closed: Boolean(p.closed), owner: p.owner?.login ?? null },
    viewer: data?.viewer?.login ?? null,
    fields: proven(p.fields?.nodes, isFieldNode).map(parseField),
    views: proven(p.views?.nodes, isViewNode).map(parseView),
    repos: proven(p.repositories?.nodes, isRepoNode).map((r) => ({ id: r.id, full: r.nameWithOwner })),
    items: [], total: 0, more: null,
  };

  return addPage(board, data);
}

/** Adds a page of items: { ...board, items, total, more: the next cursor or null }. */
export function addPage(board: Board, data: BoardAnswer | null | undefined): Board {
  const c = data?.node?.items;
  const items = [...board.items, ...proven(c?.nodes, isItemNode).map(parseItem)];
  const more = c?.pageInfo?.hasNextPage && items.length < MAX_ITEMS ? c.pageInfo.endCursor ?? null : null;

  return { ...board, items, total: c?.totalCount ?? items.length, more };
}

/** A scope gh's token lacks: which one, the command that grants it, and what to tell. */
export interface ScopeProblem {
  readonly need: "project" | "read:project";
  readonly command: string;
  readonly text: string;
}

/** The part of a scope error that says which scope gh's token lacks, with the command that grants it; null otherwise. */
export function scopeProblem(message: string | null | undefined, write = false): ScopeProblem | null {
  const m = message ?? "";

  if (!/INSUFFICIENT_SCOPES|required scopes|read:project|'project'/i.test(m)) return null;

  const need = write || /\['project'\]/.test(m) ? "project" : "read:project";

  return { need, command: `gh auth refresh -s ${need}`, text: `gh's token can't ${need === "project" ? "change" : "read"} projects: run \`gh auth refresh -s ${need}\`.` };
}

/** An item's body and its conversation, for the detail panel. */
export const detailQuery = `query($id: ID!) { node(id: $id) { __typename
  ... on Issue { body url createdAt author { login } comments(last: 30) { totalCount nodes { author { login } body createdAt url } } }
  ... on PullRequest { body url createdAt author { login } comments(last: 30) { totalCount nodes { author { login } body createdAt url } } }
  ... on DraftIssue { body createdAt creator { login } } } }`;

const isCommentNode = object({}, { author: login, body: text, createdAt: text, url: text });

/** detailQuery's answer. */
export const isDetailAnswer = object({}, {
  node: maybe(object({}, {
    body: text, url: text, createdAt: text, author: login, creator: login,
    comments: maybe(object({}, { totalCount: maybe(isNumber), nodes: maybe(isList) })),
  })),
});

export type DetailAnswer = Guarded<typeof isDetailAnswer>;

/** A comment in the detail panel. */
export interface DetailComment {
  readonly who: string;
  readonly body: string;
  readonly at: string | null;
  readonly url: string | null;
}

/** An item's body and conversation (`more`: older comments not read). */
export interface Detail {
  readonly body: string;
  readonly url: string | null;
  readonly createdAt: string | null;
  readonly author: string | null;
  readonly comments: readonly DetailComment[];
  readonly more: number;
}

export function parseDetail(data: DetailAnswer | null | undefined): Detail | null {
  const n = data?.node;

  if (!n) return null;

  const comments = proven(n.comments?.nodes, isCommentNode);

  return {
    body: n.body ?? "", url: n.url ?? null, createdAt: n.createdAt ?? null, author: n.author?.login ?? n.creator?.login ?? null,
    comments: comments.map((c) => ({ who: c.author?.login ?? "ghost", body: c.body ?? "", at: c.createdAt ?? null, url: c.url ?? null })),
    more: Math.max(0, (n.comments?.totalCount ?? 0) - (n.comments?.nodes?.length ?? 0)),
  };
}

/** A repo's labels and the people who can be assigned, for the field menu. */
export function choicesQuery(full: string): string {
  const [owner, name] = full.split("/");

  return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { labels(first: 100) { nodes { id name color } } assignableUsers(first: 100) { nodes { id login } } } }`;
}

/** choicesQuery's answer. */
export const isChoicesAnswer = object({}, { repository: maybe(object({}, { labels: nodes, assignableUsers: nodes })) });

export type ChoicesAnswer = Guarded<typeof isChoicesAnswer>;

const isChoiceLabel = object({ id: isString, name: isString }, { color: text });

const isUser = object({ id: isString, login: isString });

/** What the field menu offers to add: a repo's labels and its assignable users. */
export interface Choices {
  readonly labels: readonly { readonly id: string; readonly name: string; readonly color: string | null }[];
  readonly users: readonly { readonly id: string; readonly login: string }[];
}

export function parseChoices(data: ChoicesAnswer | null | undefined): Choices {
  const r = data?.repository;

  return {
    labels: proven(r?.labels?.nodes, isChoiceLabel).map((l) => ({ id: l.id, name: l.name, color: l.color ?? null })),
    users: proven(r?.assignableUsers?.nodes, isUser).map((u) => ({ id: u.id, login: u.login })),
  };
}

// ---- cache: only what the board draws

/** A board as the cache keeps it: no item still on its way (temp-), values as an object. */
export function slimBoard(b: Board | null | undefined): StoredBoard | null {
  if (!b) return null;

  return {
    project: b.project, viewer: b.viewer, fields: b.fields, views: b.views, repos: b.repos, total: b.total, more: null,
    items: b.items.filter((i) => !i.id.startsWith("temp-")).map((i) => ({
      id: i.id, db: i.db, type: i.type, archived: i.archived, values: toJson(i.values),
      content: { ...i.content, assignees: i.content.assignees.map((a) => ({ id: a.id, login: a.login })), labels: i.content.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })) },
    })),
  };
}

