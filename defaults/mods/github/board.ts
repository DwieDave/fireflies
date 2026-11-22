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

import { Array as Arr, Predicate, Record as Rec, Schema } from "effect";
import type { Codec } from "@fireflies/kit";
import { maybe } from "./model.ts";

export const text = maybe(Schema.String);

/** A list's items that `schema` reads (the others, nulls GitHub sends for what it won't show, left out). */
const proven = <A, I>(list: readonly unknown[] | null | undefined, schema: Codec<A, I>): A[] => Arr.getSomes(Arr.map(list ?? [], (x) => Schema.decodeUnknownOption(schema)(x)));

/** A GraphQL connection: its nodes, read one by one where they're read. */
const nodes = maybe(Schema.Struct({ nodes: maybe(Schema.Array(Schema.Unknown)) }));

/** Someone's login (a user, an organization). */
const login = maybe(Schema.Struct({ login: text }));

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
const ProjectNodeSchema = Schema.Struct({ id: Schema.String, number: maybe(Schema.Finite), title: text, url: text, closed: maybe(Schema.Boolean), shortDescription: text, updatedAt: text, owner: login });

/** projectListQuery's answer: GitHub leaves out (null) what it won't show. */
export const ProjectListAnswerSchema = Schema.Struct({ viewer: login,
  repository: maybe(Schema.Struct({ id: text, projectsV2: nodes, owner: maybe(Schema.Struct({ projectsV2: nodes })) })),
  parent: maybe(Schema.Struct({ projectsV2: nodes })) });

export type ProjectListAnswer = typeof ProjectListAnswerSchema.Type;

/** Where the picker found a project. */
export const FromSchema = Schema.Literals(["repo", "parent", "owner"]);

export type From = typeof FromSchema.Type;

/** A project as the picker lists it. */
export const ListedProjectSchema = Schema.Struct({ id: Schema.String, number: Schema.NullOr(Schema.Finite), title: Schema.String, url: Schema.NullOr(Schema.String), closed: Schema.Boolean, owner: Schema.NullOr(Schema.String),
  about: Schema.String, updatedAt: Schema.NullOr(Schema.String), from: FromSchema });

export type ListedProject = typeof ListedProjectSchema.Type;

/** The picker's list: who reads it, the repo's id (to convert drafts into), the projects. */
export const ProjectListSchema = Schema.Struct({ viewer: Schema.NullOr(Schema.String), repoId: Schema.NullOr(Schema.String), projects: Schema.Array(ListedProjectSchema) });

export type ProjectList = typeof ProjectListSchema.Type;

const slimProject = (p: typeof ProjectNodeSchema.Type, from: From): ListedProject => ({
  id: p.id, number: p.number ?? null, title: p.title ?? "", url: p.url ?? null, closed: Boolean(p.closed), owner: p.owner?.login ?? null,
  about: p.shortDescription || "", updatedAt: p.updatedAt ?? null, from,
});

const RANK = new Map<From, number>([["repo", 0], ["parent", 1], ["owner", 2]]);

/** The picker's projects, open ones first, each once: { viewer, repoId, projects: [{ ..., from: "repo" | "parent" | "owner" }] }. */
export function parseProjectList(data: ProjectListAnswer | null | undefined): ProjectList {
  const seen = new Set<string>(), out: ListedProject[] = [];

  const add = (list: readonly unknown[] | null | undefined, from: From) => {
    for (const n of proven(list, ProjectNodeSchema)) {
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
export const OptionSchema = Schema.Struct({ id: Schema.String, name: Schema.String, color: Schema.String });

export type FieldOption = typeof OptionSchema.Type;

/** An iteration of an iteration field: `done` when it's over. */
export const IterationSchema = Schema.Struct({ id: Schema.String, title: Schema.String, startDate: Schema.String, duration: Schema.Finite, done: Schema.Boolean });

export type Iteration = typeof IterationSchema.Type;

/** The kinds of field that have no options of their own (GitHub's dataType, lowercased and
 *  shortened; "other": one GitHub added after this list). */
export const PlainTypeSchema = Schema.Literals(["text", "number", "date", "multi", "title", "assignees", "labels", "repo", "milestone", "linked_pull_requests", "reviewers", "tracks", "tracked_by", "parent_issue", "sub_issues_progress", "issue_type", "other"]);

export type PlainType = typeof PlainTypeSchema.Type;

/** A project field, a union on its type: a single select has its options, an iteration field its iterations. */
export const FieldSchema = Schema.Union([Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.Literals(["single"]), options: Schema.Array(OptionSchema) }), Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.Literals(["iteration"]), iterations: Schema.Array(IterationSchema) }), Schema.Struct({ id: Schema.String, name: Schema.String, type: PlainTypeSchema })]);

export type Field = typeof FieldSchema.Type;

export type FieldType = Field["type"];

/** A sort of a view: the field, ascending (1) or descending (-1). */
export const SortSchema = Schema.Struct({ field: Schema.String, dir: Schema.Literals([1, -1]) });

export const ViewSchema = Schema.Struct({ id: Schema.String, number: Schema.NullOr(Schema.Finite), name: Schema.String, layout: Schema.String, filter: Schema.String, visible: Schema.Array(Schema.String),
  columnBy: Schema.NullOr(Schema.String), groupBy: Schema.NullOr(Schema.String), sort: Schema.Array(SortSchema) });

export type View = typeof ViewSchema.Type;

/** A single select's value. */
export const SelectValueSchema = Schema.Struct({ optionId: Schema.String, name: Schema.String });

export const IterationValueSchema = Schema.Struct({ iterationId: Schema.String, title: Schema.String, startDate: Schema.String, duration: Schema.Finite });

export const TextValueSchema = Schema.Struct({ text: Schema.String });

export const NumberValueSchema = Schema.Struct({ number: Schema.Finite });

export const DateValueSchema = Schema.Struct({ date: Schema.String });

/** A multi select's value: its names, comma separated. */
export const NamesValueSchema = Schema.Struct({ names: Schema.String });

/** An item's value for a field: which one it is follows from the field's type. */
export const FieldValueSchema = Schema.Union([SelectValueSchema, IterationValueSchema, TextValueSchema, NumberValueSchema, DateValueSchema, NamesValueSchema]);

export type FieldValue = typeof FieldValueSchema.Type;

export const KindSchema = Schema.Literals(["pr", "issue", "draft", "redacted"]);

export const AssigneeSchema = Schema.Struct({ id: Schema.NullOr(Schema.String), login: Schema.String });

export type Assignee = typeof AssigneeSchema.Type;

export const CardLabelSchema = Schema.Struct({ id: Schema.NullOr(Schema.String), name: Schema.String, color: Schema.String });

export type CardLabel = typeof CardLabelSchema.Type;

/** What an item is: an issue, a pull request, a draft, or one this login can't see. */
export const ContentSchema = Schema.Struct({ kind: KindSchema, id: Schema.NullOr(Schema.String), number: Schema.NullOr(Schema.Finite), title: Schema.String, state: Schema.NullOr(Schema.String), isDraft: Schema.Boolean,
  url: Schema.NullOr(Schema.String), repo: Schema.NullOr(Schema.String), assignees: Schema.Array(AssigneeSchema), labels: Schema.Array(CardLabelSchema), milestone: Schema.NullOr(Schema.String) });

export type Content = typeof ContentSchema.Type;

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
export const BoardProjectSchema = Schema.Struct({ id: Schema.String, number: Schema.NullOr(Schema.Finite), title: Schema.String, url: Schema.NullOr(Schema.String), closed: Schema.Boolean, owner: Schema.NullOr(Schema.String) });

export type BoardProject = typeof BoardProjectSchema.Type;

export const BoardRepoSchema = Schema.Struct({ id: Schema.String, full: Schema.String });

/** A board: the project, its fields and views, the repos linked to it, the items read so far
 *  (`total` of them, `more`: the next page's cursor). */
export interface Board {
  readonly project: BoardProject;
  readonly viewer: string | null;
  readonly fields: readonly Field[];
  readonly views: readonly View[];
  readonly repos: readonly typeof BoardRepoSchema.Type[];
  readonly items: readonly Item[];
  readonly total: number;
  readonly more: string | null;
}

/** An item as the cache file holds it: its values an object by field id. */
const StoredItemSchema = Schema.Struct({ id: Schema.String, db: Schema.NullOr(Schema.Finite), type: Schema.NullOr(Schema.String), archived: Schema.Boolean, content: ContentSchema, values: Schema.Record(Schema.String, FieldValueSchema) });

/** A board as the cache file holds it (slimBoard). */
export const StoredBoardSchema = Schema.Struct({ project: BoardProjectSchema, viewer: Schema.NullOr(Schema.String), fields: Schema.Array(FieldSchema), views: Schema.Array(ViewSchema), repos: Schema.Array(BoardRepoSchema),
  items: Schema.Array(StoredItemSchema), total: Schema.Finite, more: Schema.NullOr(Schema.String) });

export type StoredBoard = typeof StoredBoardSchema.Type;

/** A board read back from the cache. */
export const boardOf = (b: StoredBoard): Board => ({ ...b, items: b.items.map((i) => ({ ...i, values: new Map(Rec.toEntries(i.values)) })) });

// ---- GitHub's answers

const OptionNodeSchema = Schema.Struct({ id: Schema.String, name: Schema.String, color: text });

const IterationNodeSchema = Schema.Struct({ id: Schema.String, title: Schema.String, startDate: Schema.String, duration: Schema.Finite });

const FieldNodeSchema = Schema.Struct({ id: Schema.String, name: text, dataType: text, options: maybe(Schema.Array(Schema.Unknown)),
  configuration: maybe(Schema.Struct({ iterations: maybe(Schema.Array(Schema.Unknown)), completedIterations: maybe(Schema.Array(Schema.Unknown)) })) });

const NamedNodeSchema = Schema.Struct({ id: Schema.String });

const SortNodeSchema = Schema.Struct({ direction: text, field: maybe(Schema.Struct({ id: text })) });

const ViewNodeSchema = Schema.Struct({ id: Schema.String, number: maybe(Schema.Finite), name: text, layout: text, filter: text, fields: nodes, groupByFields: nodes, verticalGroupByFields: nodes, sortByFields: nodes });

const RepoNodeSchema = Schema.Struct({ id: Schema.String, nameWithOwner: Schema.String });

const ValueNodeSchema = Schema.Struct({ __typename: text, optionId: text, name: text, iterationId: text, title: text, startDate: text, duration: maybe(Schema.Finite),
  text, number: maybe(Schema.Finite), date: text, value: text, field: maybe(Schema.Struct({ id: text })) });

const AssigneeNodeSchema = Schema.Struct({ login: Schema.String, id: text });

const LabelNodeSchema = Schema.Struct({ name: Schema.String, id: text, color: text });

const ContentNodeSchema = Schema.Struct({ __typename: text, id: text, number: maybe(Schema.Finite), title: text, state: text, isDraft: maybe(Schema.Boolean), url: text,
  repository: maybe(Schema.Struct({ nameWithOwner: text })), assignees: nodes, labels: nodes, milestone: maybe(Schema.Struct({ title: text })) });

/** An item node of GitHub's answer. */
export const ItemNodeSchema = Schema.Struct({ id: Schema.String, databaseId: maybe(Schema.Finite), type: text, isArchived: maybe(Schema.Boolean), fieldValues: nodes, content: maybe(ContentNodeSchema) });

export type ItemNode = typeof ItemNodeSchema.Type;

const ItemsSchema = maybe(Schema.Struct({ totalCount: maybe(Schema.Finite), pageInfo: maybe(Schema.Struct({ hasNextPage: maybe(Schema.Boolean), endCursor: text })), nodes: maybe(Schema.Array(Schema.Unknown)) }));

/** boardQuery's answer, either page: the project (fields, views, repos on the first) and a page of its items. */
export const BoardAnswerSchema = Schema.Struct({ viewer: login,
  node: maybe(Schema.Struct({ id: text, number: maybe(Schema.Finite), title: text, url: text, closed: maybe(Schema.Boolean), owner: login,
    fields: nodes, views: nodes, repositories: nodes, items: ItemsSchema })) });

export type BoardAnswer = typeof BoardAnswerSchema.Type;

const TYPES = new Map<string, FieldType>([
  ["SINGLE_SELECT", "single"], ["ITERATION", "iteration"], ["TEXT", "text"], ["NUMBER", "number"], ["DATE", "date"], ["MULTI_SELECT", "multi"],
  ["TITLE", "title"], ["ASSIGNEES", "assignees"], ["LABELS", "labels"], ["REPOSITORY", "repo"], ["MILESTONE", "milestone"],
]);

/** The field's kind from GitHub's dataType. */
function fieldType(dataType: string | null | undefined): FieldType {
  const known = TYPES.get(dataType ?? "");

  if (known) return known;

  const lower = (dataType ?? "").toLowerCase();

  return Schema.is(PlainTypeSchema)(lower) ? lower : "other";
}

function parseField(n: typeof FieldNodeSchema.Type): Field {
  const base = { id: n.id, name: n.name ?? "" };
  const type = fieldType(n.dataType);

  if (type === "single") return { ...base, type, options: proven(n.options, OptionNodeSchema).map((o) => ({ id: o.id, name: o.name, color: o.color ?? "GRAY" })) };

  if (type === "iteration") {
    const it = (x: typeof IterationNodeSchema.Type, done: boolean): Iteration => ({ id: x.id, title: x.title, startDate: x.startDate, duration: x.duration, done });
    const c = n.configuration;

    const iterations = [...proven(c?.completedIterations, IterationNodeSchema).map((x) => it(x, true)), ...proven(c?.iterations, IterationNodeSchema).map((x) => it(x, false))]
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    return { ...base, type, iterations };
  }

  return { ...base, type };
}

function parseView(n: typeof ViewNodeSchema.Type): View {
  const ids = (c: typeof nodes.Type) => proven(c?.nodes, NamedNodeSchema).map((x) => x.id);

  return {
    id: n.id, number: n.number ?? null, name: n.name ?? "", layout: (n.layout ?? "BOARD_LAYOUT").replace(/_LAYOUT$/, "").toLowerCase(),
    filter: n.filter ?? "", visible: ids(n.fields), columnBy: ids(n.verticalGroupByFields)[0] ?? null, groupBy: ids(n.groupByFields)[0] ?? null,
    sort: proven(n.sortByFields?.nodes, SortNodeSchema).flatMap((s) => (s.field?.id ? [{ field: s.field.id, dir: s.direction === "DESC" ? -1 : 1 } as const] : [])),
  };
}

/** A field value node as the board keeps it (null: not one it knows, or without its id). */
function parseValue(v: typeof ValueNodeSchema.Type): FieldValue | null {
  switch (v.__typename) {
    case "ProjectV2ItemFieldSingleSelectValue":
      return v.optionId ? { optionId: v.optionId, name: v.name ?? "" } : null;
    case "ProjectV2ItemFieldIterationValue":
      return v.iterationId ? { iterationId: v.iterationId, title: v.title ?? "", startDate: v.startDate ?? "", duration: v.duration ?? 0 } : null;
    case "ProjectV2ItemFieldTextValue":
      return { text: v.text ?? "" };
    case "ProjectV2ItemFieldNumberValue":
      return Predicate.isNumber(v.number) ? { number: v.number } : null;
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

  for (const v of proven(n.fieldValues?.nodes, ValueNodeSchema)) {
    const id = v.field?.id;
    const value = parseValue(v);

    if (id && value) values.set(id, value);
  }

  return {
    id: n.id, db: n.databaseId ?? null, type: n.type ?? null, archived: Boolean(n.isArchived),
    content: {
      kind, id: c?.id ?? null, number: c?.number ?? null, title: c?.title ?? (kind === "redacted" ? "(no access)" : ""),
      state: kind === "draft" ? "DRAFT" : c?.state ?? null, isDraft: Boolean(c?.isDraft), url: c?.url ?? null, repo: c?.repository?.nameWithOwner ?? null,
      assignees: proven(c?.assignees?.nodes, AssigneeNodeSchema).map((a) => ({ id: a.id ?? null, login: a.login })),
      labels: proven(c?.labels?.nodes, LabelNodeSchema).map((l) => ({ id: l.id ?? null, name: l.name, color: l.color ?? "666666" })),
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
    fields: proven(p.fields?.nodes, FieldNodeSchema).map(parseField),
    views: proven(p.views?.nodes, ViewNodeSchema).map(parseView),
    repos: proven(p.repositories?.nodes, RepoNodeSchema).map((r) => ({ id: r.id, full: r.nameWithOwner })),
    items: [], total: 0, more: null,
  };

  return addPage(board, data);
}

/** Adds a page of items: { ...board, items, total, more: the next cursor or null }. */
export function addPage(board: Board, data: BoardAnswer | null | undefined): Board {
  const c = data?.node?.items;
  const items = [...board.items, ...proven(c?.nodes, ItemNodeSchema).map(parseItem)];
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

const CommentNodeSchema = Schema.Struct({ author: login, body: text, createdAt: text, url: text });

/** detailQuery's answer. */
export const DetailAnswerSchema = Schema.Struct({ node: maybe(Schema.Struct({ body: text, url: text, createdAt: text, author: login, creator: login,
    comments: maybe(Schema.Struct({ totalCount: maybe(Schema.Finite), nodes: maybe(Schema.Array(Schema.Unknown)) })) })) });

export type DetailAnswer = typeof DetailAnswerSchema.Type;

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

  const comments = proven(n.comments?.nodes, CommentNodeSchema);

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
export const ChoicesAnswerSchema = Schema.Struct({ repository: maybe(Schema.Struct({ labels: nodes, assignableUsers: nodes })) });

export type ChoicesAnswer = typeof ChoicesAnswerSchema.Type;

const ChoiceLabelSchema = Schema.Struct({ id: Schema.String, name: Schema.String, color: text });

const UserSchema = Schema.Struct({ id: Schema.String, login: Schema.String });

/** What the field menu offers to add: a repo's labels and its assignable users. */
export interface Choices {
  readonly labels: readonly { readonly id: string; readonly name: string; readonly color: string | null }[];
  readonly users: readonly { readonly id: string; readonly login: string }[];
}

export function parseChoices(data: ChoicesAnswer | null | undefined): Choices {
  const r = data?.repository;

  return {
    labels: proven(r?.labels?.nodes, ChoiceLabelSchema).map((l) => ({ id: l.id, name: l.name, color: l.color ?? null })),
    users: proven(r?.assignableUsers?.nodes, UserSchema).map((u) => ({ id: u.id, login: u.login })),
  };
}

// ---- cache: only what the board draws

/** A board as the cache keeps it: no item still on its way (temp-), values as an object. */
export function slimBoard(b: Board | null | undefined): StoredBoard | null {
  if (!b) return null;

  return {
    project: b.project, viewer: b.viewer, fields: b.fields, views: b.views, repos: b.repos, total: b.total, more: null,
    items: b.items.filter((i) => !i.id.startsWith("temp-")).map((i) => ({
      id: i.id, db: i.db, type: i.type, archived: i.archived, values: Rec.fromEntries(i.values),
      content: { ...i.content, assignees: i.content.assignees.map((a) => ({ id: a.id, login: a.login })), labels: i.content.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })) },
    })),
  };
}


// ---- as tests of a value's shape: for the cache's pieces (projects.ts) and the tests

export const isStoredBoard = Schema.is(StoredBoardSchema);
export const isListedProject = Schema.is(ListedProjectSchema);
export const isItemNode = Schema.is(ItemNodeSchema);
export const isBoardAnswer = Schema.is(BoardAnswerSchema);
export const isProjectListAnswer = Schema.is(ProjectListAnswerSchema);
export const isDetailAnswer = Schema.is(DetailAnswerSchema);
export const isChoicesAnswer = Schema.is(ChoicesAnswerSchema);
