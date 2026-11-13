// What the Projects tab knows about GitHub Projects (v2), as plain functions
// over GraphQL's JSON: the queries and mutations it sends, the board it reads
// out of the answers, GitHub's filter syntax (the subset the tab speaks), the
// columns and swimlanes of a view, carrying a card with the keyboard, and the
// optimistic edits laid over the last read. No herdr imports, so scripts/
// tests it.
//
// A board: { project, fields, views, items, repos, total, more, viewer }
//   field  { id, name, type, options: [{ id, name, color }] (single), iterations: [{ id, title, startDate, duration, done }] (iteration) }
//   view   { id, number, name, layout, filter, visible: [fieldId], columnBy, groupBy, sort: [{ field, dir }] }
//   item   { id, db, type, archived, content: { kind, id, number, title, state, url, repo, assignees, labels, milestone }, values: fieldId -> value (a Map; an object on disk) }
//   value  { optionId, name } | { iterationId, title, startDate, duration } | { text } | { number } | { date } | { names }

import type { Guard, Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf } from "./guard.ts";
import type { JsonMap } from "./guards.ts";
import { isList, mapOf, maybe, toJson, toMap } from "./guards.ts";

const text = maybe(isString);

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

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

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

// ---- a view as columns and lanes

/** The field a view's columns come from: its own, else Status, else the first single select. */
export function columnField(board: Board, view: View | null | undefined): Field | null {
  const own = view?.columnBy ? board.fields.find((f) => f.id === view.columnBy) : undefined;

  if (own && (own.type === "single" || own.type === "iteration")) return own;

  return board.fields.find((f) => f.type === "single" && lower(f.name) === "status") ?? board.fields.find((f) => f.type === "single") ?? null;
}

/** The key an item goes under for a field (column or lane); "" when it has none. */
export function groupKey(_board: Board, item: Item, field: Field | null | undefined): string {
  if (!field) return "";

  const c = item.content, v = item.values.get(field.id);

  switch (field.type) {
    case "single": return selectOf(v)?.optionId ?? "";
    case "iteration": return iterationOf(v)?.iterationId ?? "";
    case "assignees": return c.assignees[0]?.login ?? "";
    case "labels": return c.labels[0]?.name ?? "";
    case "repo": return c.repo ?? "";
    case "milestone": return c.milestone ?? "";
    case "text": return textOf(v) ?? "";
    case "number": {
      const n = numberOf(v);

      return n === null ? "" : String(n);
    }

    case "date": return dateOf(v) ?? "";
    case "multi": return namesOf(v) ?? "";
    default: return "";
  }
}

/** A column or lane: its key ("" for the items without a value), its name and colour; an
 *  iteration's dates and whether it's over; `none`: the empty group. */
export interface Group {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly none?: true;
  readonly startDate?: string;
  readonly duration?: number;
  readonly done?: boolean;
}

/** A field's groups in order: [{ key, name, color }], with its empty group ("No Status") first, as GitHub draws them.
 *  Iterations that ended show only when an item still sits in them. */
export function groupsOf(board: Board, field: Field | null | undefined, items: readonly Item[]): Group[] {
  if (!field) return [{ key: "", name: "Items", color: "GRAY" }];

  const none: Group = { key: "", name: `No ${field.name}`, color: "GRAY", none: true };

  if (field.type === "single") return [none, ...field.options.map((o) => ({ key: o.id, name: o.name, color: o.color }))];

  if (field.type === "iteration") {
    const used = new Set(items.map((i) => groupKey(board, i, field)));

    return [none, ...field.iterations.flatMap((it) => (!it.done || used.has(it.id)
      ? [{ key: it.id, name: it.title, color: it.done ? "GRAY" : "BLUE", startDate: it.startDate, duration: it.duration, done: it.done }]
      : []))];
  }

  const keys = [...new Set(items.flatMap((i) => {
    const key = groupKey(board, i, field);

    return key ? [key] : [];
  }))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return [none, ...keys.map((k) => ({ key: k, name: k, color: "GRAY" }))];
}

function sortValue(board: Board, item: Item, fieldId: string): string | number | null {
  const f = board.fields.find((x) => x.id === fieldId);

  if (!f) return null;

  const v = item.values.get(f.id);

  if (f.type === "single") {
    const id = selectOf(v)?.optionId;
    const i = f.options.findIndex((o) => o.id === id);

    return i < 0 ? null : i;
  }

  if (f.type === "iteration") return iterationOf(v)?.startDate ?? null;

  if (f.type === "number") return numberOf(v);

  if (f.type === "title") return lower(item.content.title);

  return valuesOf(board, item, f)[0] ?? null;
}

/** -1 when `x` sorts before `y`, 1 after (one field's values are all numbers or all text). */
const before = (x: string | number, y: string | number): number => (isNumber(x) && isNumber(y) ? (x < y ? -1 : 1) : String(x) < String(y) ? -1 : 1);

/** Items in a view's order: its sort fields, else their project position. Empty values go last. */
export function sortItems(board: Board, items: readonly Item[], sort: View["sort"] | null | undefined): readonly Item[] {
  if (!sort?.length) return items;

  const at = new Map(items.map((x, i) => [x.id, i]));

  return [...items].sort((a, b) => {
    for (const s of sort) {
      const x = sortValue(board, a, s.field), y = sortValue(board, b, s.field);

      if (x === y) continue;

      if (x === null) return 1;

      if (y === null) return -1;

      return before(x, y) * s.dir;
    }

    return (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0);
  });
}

/** What GitHub doesn't keep for a view: the folded columns and lanes, each column's limit. */
export interface Local {
  readonly folded?: readonly string[];
  readonly lanesFolded?: readonly string[];
  readonly limits?: ReadonlyMap<string, number>;
}

/** A column of a drawn view: its group, its items, their count, its limit and whether it's folded. */
export interface Column extends Group {
  readonly items: readonly Item[];
  readonly count: number;
  readonly limit: number | null;
  readonly folded: boolean;
}

/** A swimlane: its group's key (null: the one lane of a view without group-by), each column's items. */
export interface Lane {
  readonly key: string | null;
  readonly name: string;
  readonly color?: string;
  readonly done?: boolean | undefined;
  readonly folded: boolean;
  readonly cells: readonly (readonly Item[])[];
  readonly count?: number;
}

/** A view drawn as a board. */
export interface Layout {
  readonly field: Field | null;
  readonly lane: Field | null;
  readonly columns: readonly Column[];
  readonly lanes: readonly Lane[];
  readonly shown: number;
  readonly total: number;
  readonly sorted: boolean;
}

/** A view drawn as a board: { field, lane, columns: [{ key, name, color, count, limit, folded, items }],
 *  lanes: [{ key, name, folded, cells: [[item]] }] (one lane, key null, when the view has no group-by), shown, total }.
 *  `text` is the filter bar's, added to the view's own filter; `local` holds what GitHub doesn't keep
 *  for a view (limits, folded columns and lanes). */
export function layout(board: Board, view: View | null | undefined, text = "", local: Local = {}, ctx: FilterContext = {}): Layout {
  const field = columnField(board, view);
  const laneField = view?.groupBy ? board.fields.find((f) => f.id === view.groupBy && f.id !== field?.id) ?? null : null;
  const filter = parseFilter(`${view?.filter ?? ""} ${text}`);
  const live = board.items.filter((i) => !i.archived);
  const shown = sortItems(board, live.filter((i) => matches(board, i, filter, { me: board.viewer, ...ctx })), view?.sort);
  const folded = new Set(local.folded ?? []), lanesFolded = new Set(local.lanesFolded ?? []), limits = local.limits ?? new Map<string, number>();
  const groups = groupsOf(board, field, live);

  // "No Status" shows only when something is in it.
  const columns = groups.flatMap((g): Column[] => {
    const items = shown.filter((i) => groupKey(board, i, field) === g.key);
    const limit = limits.get(g.key) ?? 0;

    return !g.none || items.length ? [{ ...g, items, count: items.length, limit: limit > 0 ? limit : null, folded: folded.has(g.key) }] : [];
  });

  const lanes: readonly Lane[] = !laneField
    ? [{ key: null, name: "", folded: false, cells: columns.map((c) => c.items) }]
    : groupsOf(board, laneField, live).flatMap((g): Lane[] => {
      const cells = columns.map((c) => c.items.filter((i) => groupKey(board, i, laneField) === g.key));

      return cells.some((c) => c.length)
        ? [{ key: g.key, name: g.name, color: g.color, done: g.done, cells, folded: lanesFolded.has(g.key), count: cells.reduce((n, c) => n + c.length, 0) }]
        : [];
    });

  return { field, lane: laneField, columns, lanes, shown: shown.length, total: live.length, sorted: Boolean(view?.sort.length) };
}

// ---- moving with the keyboard

/** Each column's items top to bottom (what j / k walk through). */
export type Grid = readonly (readonly Item[])[];

/** A place in a grid (row -1: an empty column). */
export interface At {
  readonly col: number;
  readonly row: number;
}

/** A card being carried: its id, where it was picked up, where it would land now. */
export interface Carry extends At {
  readonly id: string;
  readonly from: At;
}

/** A key's way: a direction, or to the top or bottom. */
export type Dir = "left" | "right" | "up" | "down" | "top" | "bottom";

/** Each column's items top to bottom across the lanes (folded lanes skipped): what j / k walk through. */
export function grid(lay: Layout): Grid {
  return lay.columns.map((_, ci) => lay.lanes.filter((l) => !l.folded).flatMap((l) => l.cells[ci] ?? []));
}

/** Where an item is in a grid: { col, row } or null. */
export function find(g: Grid, id: string | null | undefined): At | null {
  for (const [c, col] of g.entries()) {
    const r = col.findIndex((i) => i.id === id);

    if (r >= 0) return { col: c, row: r };
  }

  return null;
}

/** The selection moved by a key ("left" "right" "up" "down" "top" "bottom"), skipping folded columns:
 *  { col, row } (row -1 in an empty column). */
export function step(g: Grid, at: At | null, dir: Dir, folded: readonly boolean[] = []): At | null {
  const n = g.length;

  if (!n) return at;

  const { col, row } = at ?? { col: 0, row: 0 };

  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    let c = col + d;

    while (c >= 0 && c < n && folded[c]) c += d;

    const len = g[c]?.length;

    if (len === undefined) return { col, row };

    return { col: c, row: len ? Math.min(Math.max(0, row), len - 1) : -1 };
  }

  const len = g[col]?.length ?? 0;

  if (!len) return { col, row: -1 };

  if (dir === "up") return { col, row: Math.max(0, row - 1) };

  if (dir === "down") return { col, row: Math.min(len - 1, row + 1) };

  if (dir === "top") return { col, row: 0 };

  return { col, row: len - 1 };
}

/** Picks up the selected card: { id, from: { col, row }, col, row } (where it would land now). */
export function pickUp(g: Grid, at: At | null): Carry | null {
  const it = at ? g[at.col]?.[at.row] : undefined;

  return at && it ? { id: it.id, from: { col: at.col, row: at.row }, col: at.col, row: at.row } : null;
}

/** How a carried card moves: past folded columns, and whether the view sorts it. */
export interface CarryOptions {
  readonly folded?: readonly boolean[];
  readonly sorted?: boolean;
}

/** The carried card moved one key: h / l to the next unfolded column (landing at the same height, or the end),
 *  j / k within the column. `sorted`: the view orders cards by a field, so only the column changes. */
export function carry(g: Grid, c: Carry | null, dir: Dir, { folded = [], sorted = false }: CarryOptions = {}): Carry | null {
  if (!c) return c;

  const rest = (col: number) => (g[col] ?? []).filter((i) => i.id !== c.id).length;

  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    let col = c.col + d;

    while (col >= 0 && col < g.length && folded[col]) col += d;

    if (col < 0 || col >= g.length) return c;

    return { ...c, col, row: sorted ? 0 : Math.min(c.row, rest(col)) };
  }

  if (sorted) return c;

  const max = rest(c.col);

  if (dir === "up") return { ...c, row: Math.max(0, c.row - 1) };

  if (dir === "down") return { ...c, row: Math.min(max, c.row + 1) };

  if (dir === "top") return { ...c, row: 0 };

  return { ...c, row: max };
}

/** The grid as it looks while a card is carried: out of its column, into its landing spot. */
export function carried(g: Grid, c: Carry | null): Grid {
  if (!c) return g;

  const it = g[c.from.col]?.[c.from.row];

  if (!it) return g;

  return g.map((col, i) => {
    const kept = col.filter((x) => x.id !== c.id);

    return i === c.col ? [...kept.slice(0, c.row), it, ...kept.slice(c.row)] : kept;
  });
}

/** A drop: the card, its new column's key (absent: the same column), the card it now follows
 *  (absent: no reorder, null: first). */
export interface Dropped {
  readonly id: string;
  column?: string;
  afterId?: string | null;
}

/** What dropping the carried card means: { id, column: the new column key or undefined (same), afterId (undefined:
 *  no reorder, null: first) } or null when nothing changes. `cols` are the layout's columns (for their keys). */
export function drop(g: Grid, c: Carry | null, cols: readonly Group[], { sorted = false }: CarryOptions = {}): Dropped | null {
  if (!c) return null;

  const moved = c.col !== c.from.col, at = carried(g, c)[c.col] ?? [];
  const i = at.findIndex((x) => x.id === c.id);
  const before = i > 0 ? at[i - 1]?.id ?? null : null;
  const wasBefore = c.from.row > 0 ? g[c.from.col]?.[c.from.row - 1]?.id ?? null : null;
  const reorder = !sorted && (moved || before !== wasBefore);

  if (!moved && !reorder) return null;

  const out: Dropped = { id: c.id };
  const column = cols[c.col]?.key;

  if (moved && column !== undefined) out.column = column;

  if (reorder) out.afterId = before;

  return out;
}

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

export type { JsonMap };
