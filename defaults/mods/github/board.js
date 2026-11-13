// What the Projects tab knows about GitHub Projects (v2), as plain functions
// over GraphQL's JSON: the queries and mutations it sends, the board it reads
// out of the answers, GitHub's filter syntax (the subset the tab speaks), the
// columns and swimlanes of a view, carrying a card with the keyboard, and the
// optimistic edits laid over the last read. No herdr imports, so scripts/
// tests it.
//
// A board: { project, fields, views, items, repos, total, more, viewer }
//   field  { id, name, type, options?: [{ id, name, color }], iterations?: [{ id, title, startDate, duration, done }] }
//   view   { id, number, name, layout, filter, visible: [fieldId], columnBy, groupBy, sort: [{ field, dir }] }
//   item   { id, db, type, archived, content: { kind, id, number, title, state, url, repo, assignees, labels, milestone }, values: { fieldId: value } }
//   value  { optionId, name } | { iterationId, title, startDate, duration } | { text } | { number } | { date } | { names }

// ---- reading

const OWNER = "owner { __typename ... on User { login } ... on Organization { login } }";
const PROJECT = `id number title url closed shortDescription updatedAt ${OWNER}`;
const ORDER = "orderBy: { field: UPDATED_AT, direction: DESC }";

/** The projects a repo shows: linked to it (and to its parent, for a fork) and its owner's. */
export function projectListQuery(repo) {
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

const slimProject = (p, from) => p?.id ? { id: p.id, number: p.number, title: p.title ?? "", url: p.url ?? null, closed: Boolean(p.closed), owner: p.owner?.login ?? null, about: p.shortDescription || "", updatedAt: p.updatedAt ?? null, from } : null;

/** The picker's projects, open ones first, each once: { viewer, repoId, projects: [{ ..., from: "repo" | "parent" | "owner" }] }. */
export function parseProjectList(data) {
  const seen = new Set(), out = [];
  const add = (nodes, from) => {
    for (const n of nodes ?? []) {
      const p = slimProject(n, from);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
  };
  add(data?.repository?.projectsV2?.nodes, "repo");
  add(data?.parent?.projectsV2?.nodes, "parent");
  add(data?.repository?.owner?.projectsV2?.nodes, "owner");
  const rank = (p) => (p.closed ? 10 : 0) + { repo: 0, parent: 1, owner: 2 }[p.from];
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
export function boardQuery(first = true) {
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

const TYPES = { SINGLE_SELECT: "single", ITERATION: "iteration", TEXT: "text", NUMBER: "number", DATE: "date", MULTI_SELECT: "multi", TITLE: "title", ASSIGNEES: "assignees", LABELS: "labels", REPOSITORY: "repo", MILESTONE: "milestone" };

function parseField(n) {
  if (!n?.id) return null;
  const f = { id: n.id, name: n.name ?? "", type: TYPES[n.dataType] ?? String(n.dataType ?? "").toLowerCase() };
  if (n.options) f.options = n.options.map((o) => ({ id: o.id, name: o.name, color: o.color ?? "GRAY" }));
  if (n.configuration) {
    const it = (x, done) => ({ id: x.id, title: x.title, startDate: x.startDate, duration: x.duration, done });
    f.iterations = [...(n.configuration.completedIterations ?? []).map((x) => it(x, true)), ...(n.configuration.iterations ?? []).map((x) => it(x, false))]
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  }
  return f;
}

function parseView(n) {
  const ids = (c) => (c?.nodes ?? []).map((x) => x?.id).filter(Boolean);
  return {
    id: n.id, number: n.number, name: n.name ?? "", layout: String(n.layout ?? "BOARD_LAYOUT").replace(/_LAYOUT$/, "").toLowerCase(),
    filter: n.filter ?? "", visible: ids(n.fields), columnBy: ids(n.verticalGroupByFields)[0] ?? null, groupBy: ids(n.groupByFields)[0] ?? null,
    sort: (n.sortByFields?.nodes ?? []).filter((s) => s?.field?.id).map((s) => ({ field: s.field.id, dir: s.direction === "DESC" ? -1 : 1 })),
  };
}

/** A project item as the board draws it. */
export function parseItem(n) {
  if (!n?.id) return null;
  const c = n.content ?? {};
  const kind = c.__typename === "PullRequest" ? "pr" : c.__typename === "Issue" ? "issue" : c.__typename === "DraftIssue" ? "draft" : "redacted";
  const values = {};
  for (const v of n.fieldValues?.nodes ?? []) {
    const id = v?.field?.id;
    if (!id) continue;
    if (v.__typename === "ProjectV2ItemFieldSingleSelectValue") values[id] = { optionId: v.optionId, name: v.name };
    else if (v.__typename === "ProjectV2ItemFieldIterationValue") values[id] = { iterationId: v.iterationId, title: v.title, startDate: v.startDate, duration: v.duration };
    else if (v.__typename === "ProjectV2ItemFieldTextValue") values[id] = { text: v.text };
    else if (v.__typename === "ProjectV2ItemFieldNumberValue") values[id] = { number: v.number };
    else if (v.__typename === "ProjectV2ItemFieldDateValue") values[id] = { date: v.date };
    else if (v.__typename === "ProjectV2ItemFieldMultiSelectValue") values[id] = { names: v.value ?? "" };
  }
  return {
    id: n.id, db: n.databaseId ?? null, type: n.type ?? null, archived: Boolean(n.isArchived),
    content: {
      kind, id: c.id ?? null, number: c.number ?? null, title: c.title ?? (kind === "redacted" ? "(no access)" : ""),
      state: kind === "draft" ? "DRAFT" : c.state ?? null, isDraft: Boolean(c.isDraft), url: c.url ?? null, repo: c.repository?.nameWithOwner ?? null,
      assignees: (c.assignees?.nodes ?? []).map((a) => ({ id: a.id ?? null, login: a.login })),
      labels: (c.labels?.nodes ?? []).map((l) => ({ id: l.id ?? null, name: l.name, color: l.color ?? "666666" })),
      milestone: c.milestone?.title ?? null,
    },
    values,
  };
}

/** The first page's answer as a board (later pages go through addPage). */
export function parseBoard(data) {
  const p = data?.node;
  if (!p?.id) return null;
  const board = {
    project: { id: p.id, number: p.number, title: p.title ?? "", url: p.url ?? null, closed: Boolean(p.closed), owner: p.owner?.login ?? null },
    viewer: data.viewer?.login ?? null,
    fields: (p.fields?.nodes ?? []).map(parseField).filter(Boolean),
    views: (p.views?.nodes ?? []).filter((v) => v?.id).map(parseView),
    repos: (p.repositories?.nodes ?? []).map((r) => ({ id: r.id, full: r.nameWithOwner })),
    items: [], total: 0, more: null,
  };
  return addPage(board, data);
}

/** Adds a page of items: { ...board, items, total, more: the next cursor or null }. */
export function addPage(board, data) {
  const c = data?.node?.items;
  const items = [...board.items, ...(c?.nodes ?? []).map(parseItem).filter(Boolean)];
  const more = c?.pageInfo?.hasNextPage && items.length < MAX_ITEMS ? c.pageInfo.endCursor : null;
  return { ...board, items, total: c?.totalCount ?? items.length, more };
}

/** The part of a scope error that says which scope gh's token lacks, with the command that grants it; null otherwise. */
export function scopeProblem(message, write = false) {
  const m = String(message ?? "");
  if (!/INSUFFICIENT_SCOPES|required scopes|read:project|'project'/i.test(m)) return null;
  const need = write || /\['project'\]/.test(m) ? "project" : "read:project";
  return { need, command: `gh auth refresh -s ${need}`, text: `gh's token can't ${need === "project" ? "change" : "read"} projects: run \`gh auth refresh -s ${need}\`.` };
}

/** An item's body and its conversation, for the detail panel. */
export const detailQuery = `query($id: ID!) { node(id: $id) { __typename
  ... on Issue { body url createdAt author { login } comments(last: 30) { totalCount nodes { author { login } body createdAt url } } }
  ... on PullRequest { body url createdAt author { login } comments(last: 30) { totalCount nodes { author { login } body createdAt url } } }
  ... on DraftIssue { body createdAt creator { login } } } }`;

export function parseDetail(data) {
  const n = data?.node;
  if (!n) return null;
  return {
    body: n.body ?? "", url: n.url ?? null, createdAt: n.createdAt ?? null, author: n.author?.login ?? n.creator?.login ?? null,
    comments: (n.comments?.nodes ?? []).map((c) => ({ who: c.author?.login ?? "ghost", body: c.body ?? "", at: c.createdAt, url: c.url })),
    more: Math.max(0, (n.comments?.totalCount ?? 0) - (n.comments?.nodes?.length ?? 0)),
  };
}

/** A repo's labels and the people who can be assigned, for the field menu. */
export function choicesQuery(full) {
  const [owner, name] = String(full).split("/");
  return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { labels(first: 100) { nodes { id name color } } assignableUsers(first: 100) { nodes { id login } } } }`;
}

export function parseChoices(data) {
  const r = data?.repository;
  return { labels: (r?.labels?.nodes ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })), users: (r?.assignableUsers?.nodes ?? []).map((u) => ({ id: u.id, login: u.login })) };
}

// ---- the filter: GitHub's syntax, the part the tab speaks

/** `assignee:@me label:"good first issue",bug -status:Done is:open repo:o/r no:assignee word` ->
 *  { terms: [{ key, values, neg }], words: [] }. Quotes keep spaces; commas are "or"; a leading `-` negates. */
export function parseFilter(text) {
  const terms = [], words = [];
  const re = /(-?)([A-Za-z][\w-]*):((?:"[^"]*"|[^\s"]+)(?:,(?:"[^"]*"|[^\s",]+))*)|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) {
    if (m[2]) {
      const values = [...m[3].matchAll(/"([^"]*)"|([^,]+)/g)].map((v) => (v[1] ?? v[2]).trim()).filter((v) => v !== "");
      terms.push({ key: m[2].toLowerCase(), values, neg: m[1] === "-" });
    } else {
      const w = (m[4] ?? m[5] ?? "").trim();
      if (w) words.push(w.toLowerCase());
    }
  }
  return { terms, words };
}

/** The filter's parts as a person reads them back: [{ text, kind: "key" | "value" | "word" }]. */
export function filterTokens(text) {
  const out = [];
  for (const t of parseFilter(text).terms) out.push({ kind: "key", text: `${t.neg ? "-" : ""}${t.key}:` }, { kind: "value", text: t.values.map((v) => (/\s/.test(v) ? `"${v}"` : v)).join(",") });
  for (const w of parseFilter(text).words) out.push({ kind: "word", text: w });
  return out;
}

const lower = (s) => String(s ?? "").toLowerCase();
// A field by the name a filter gives it: GitHub writes "Target date" as target-date.
const dashed = (s) => lower(s).trim().replace(/\s+/g, "-");
const fieldByName = (board, name) => board.fields.find((f) => dashed(f.name) === dashed(name)) ?? null;

/** Which iteration `@current`, `@next` or `@previous` means today (or null). */
export function iterationAt(field, word, now = Date.now()) {
  const list = field?.iterations ?? [];
  const day = 86400000;
  const i = list.findIndex((it) => { const s = Date.parse(it.startDate); return now >= s && now < s + it.duration * day; });
  const at = i >= 0 ? i : list.findIndex((it) => Date.parse(it.startDate) > now) - 0.5;
  const k = word === "@current" ? at : word === "@next" ? Math.floor(at) + 1 : word === "@previous" ? Math.ceil(at) - 1 : NaN;
  return Number.isInteger(k) ? list[k] ?? null : null;
}

/** An item's words for one field, lowercased (what `field:value` compares against). */
export function valuesOf(board, item, field, now = Date.now()) {
  const c = item.content, v = item.values[field.id];
  switch (field.type) {
    case "title": return [lower(c.title)];
    case "assignees": return c.assignees.map((a) => lower(a.login));
    case "labels": return c.labels.map((l) => lower(l.name));
    case "repo": return c.repo ? [lower(c.repo), lower(c.repo.split("/")[1])] : [];
    case "milestone": return c.milestone ? [lower(c.milestone)] : [];
    case "single": return v ? [lower(v.name)] : [];
    case "iteration": return v ? [lower(v.title)] : [];
    case "text": return v?.text ? [lower(v.text)] : [];
    case "number": return v?.number != null ? [String(v.number)] : [];
    case "date": return v?.date ? [v.date] : [];
    case "multi": return v?.names ? v.names.split(",").map((s) => lower(s.trim())) : [];
    default: return [];
  }
}

function termMatches(board, item, t, ctx) {
  const c = item.content;
  const me = (v) => (v === "@me" && ctx.me ? lower(ctx.me) : lower(v));
  const any = (have, wanted) => wanted.some((w) => have.includes(w));
  switch (t.key) {
    case "is": return t.values.some((v) => {
      v = lower(v);
      if (v === "open") return c.state === "OPEN" || c.kind === "draft";
      if (v === "closed") return c.state === "CLOSED" || c.state === "MERGED";
      if (v === "merged") return c.state === "MERGED";
      if (v === "draft") return c.kind === "draft" || c.isDraft;
      if (v === "issue") return c.kind === "issue";
      if (v === "pr") return c.kind === "pr";
      if (v === "archived") return item.archived;
      return false;
    });
    case "type": return t.values.some((v) => ({ issue: "issue", pr: "pr", pull_request: "pr", draft: "draft", draftissue: "draft" })[lower(v).replace(/[\s_-]/g, "")] === c.kind);
    case "assignee": return any(c.assignees.map((a) => lower(a.login)), t.values.map(me));
    case "label": return any(c.labels.map((l) => lower(l.name)), t.values.map(lower));
    case "repo": return any(c.repo ? [lower(c.repo), lower(c.repo.split("/")[1])] : [], t.values.map(lower));
    case "no": case "has": {
      const has = (v) => {
        const f = fieldByName(board, v) ?? (v === "assignee" ? fieldOfType(board, "assignees") : v === "label" ? fieldOfType(board, "labels") : null);
        if (v === "assignee") return c.assignees.length > 0;
        if (v === "label") return c.labels.length > 0;
        return f ? valuesOf(board, item, f, ctx.now).length > 0 : false;
      };
      return t.values.some((v) => (t.key === "has") === has(lower(v)));
    }
    default: {
      const f = fieldByName(board, t.key);
      if (!f) return true; // unknown qualifiers don't hide anything
      const have = valuesOf(board, item, f, ctx.now);
      return t.values.some((v) => {
        if (f.type === "iteration" && v.startsWith("@")) { const it = iterationAt(f, lower(v), ctx.now); return Boolean(it) && have.includes(lower(it.title)); }
        if (f.type === "number" || f.type === "date") return compare(have[0], v);
        return have.includes(me(v));
      });
    }
  }
}

/** `>3`, `<=2026-01-01`, `1..5` or a plain value against a number or date. */
function compare(have, v) {
  if (have == null) return false;
  const num = (x) => (/^\d{4}-\d\d-\d\d$/.test(x) ? Date.parse(x) : Number(x));
  const h = num(have);
  const range = /^(.+)\.\.(.+)$/.exec(v);
  if (range) return h >= num(range[1]) && h <= num(range[2]);
  const op = /^(>=|<=|>|<)(.+)$/.exec(v);
  if (!op) return h === num(v);
  const x = num(op[2]);
  return op[1] === ">" ? h > x : op[1] === "<" ? h < x : op[1] === ">=" ? h >= x : h <= x;
}

const fieldOfType = (board, type) => board.fields.find((f) => f.type === type) ?? null;

/** Whether an item passes a parsed filter. ctx: { me, now }. */
export function matches(board, item, filter, ctx = {}) {
  for (const t of filter.terms) if (termMatches(board, item, t, { now: Date.now(), ...ctx }) === t.neg) return false;
  if (!filter.words.length) return true;
  const hay = lower([item.content.title, item.content.number != null ? `#${item.content.number}` : "", item.content.repo, ...item.content.labels.map((l) => l.name), ...item.content.assignees.map((a) => a.login)].join(" "));
  return filter.words.every((w) => hay.includes(w));
}

// ---- a view as columns and lanes

/** The field a view's columns come from: its own, else Status, else the first single select. */
export function columnField(board, view) {
  const own = view?.columnBy && board.fields.find((f) => f.id === view.columnBy);
  if (own && (own.type === "single" || own.type === "iteration")) return own;
  return board.fields.find((f) => f.type === "single" && lower(f.name) === "status") ?? board.fields.find((f) => f.type === "single") ?? null;
}

/** The key an item goes under for a field (column or lane); "" when it has none. */
export function groupKey(board, item, field) {
  if (!field) return "";
  const c = item.content, v = item.values[field.id];
  switch (field.type) {
    case "single": return v?.optionId ?? "";
    case "iteration": return v?.iterationId ?? "";
    case "assignees": return c.assignees[0]?.login ?? "";
    case "labels": return c.labels[0]?.name ?? "";
    case "repo": return c.repo ?? "";
    case "milestone": return c.milestone ?? "";
    case "text": return v?.text ?? "";
    case "number": return v?.number != null ? String(v.number) : "";
    case "date": return v?.date ?? "";
    case "multi": return v?.names ?? "";
    default: return "";
  }
}

/** A field's groups in order: [{ key, name, color }], with its empty group ("No Status") first, as GitHub draws them.
 *  Iterations that ended show only when an item still sits in them. */
export function groupsOf(board, field, items) {
  if (!field) return [{ key: "", name: "Items", color: "GRAY" }];
  const none = { key: "", name: `No ${field.name}`, color: "GRAY", none: true };
  if (field.type === "single") return [none, ...field.options.map((o) => ({ key: o.id, name: o.name, color: o.color }))];
  if (field.type === "iteration") {
    const used = new Set(items.map((i) => groupKey(board, i, field)));
    return [none, ...field.iterations.filter((it) => !it.done || used.has(it.id)).map((it) => ({ key: it.id, name: it.title, color: it.done ? "GRAY" : "BLUE", startDate: it.startDate, duration: it.duration, done: it.done }))];
  }
  const keys = [...new Set(items.map((i) => groupKey(board, i, field)).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [none, ...keys.map((k) => ({ key: k, name: k, color: "GRAY" }))];
}

function sortValue(board, item, fieldId) {
  const f = board.fields.find((x) => x.id === fieldId);
  if (!f) return null;
  if (f.type === "single") { const i = f.options.findIndex((o) => o.id === item.values[f.id]?.optionId); return i < 0 ? null : i; }
  if (f.type === "iteration") return item.values[f.id]?.startDate ?? null;
  if (f.type === "number") return item.values[f.id]?.number ?? null;
  if (f.type === "title") return lower(item.content.title);
  const v = valuesOf(board, item, f);
  return v.length ? v[0] : null;
}

/** Items in a view's order: its sort fields, else their project position. Empty values go last. */
export function sortItems(board, items, sort) {
  if (!sort?.length) return items;
  const at = new Map(items.map((x, i) => [x.id, i]));
  return [...items].sort((a, b) => {
    for (const s of sort) {
      const x = sortValue(board, a, s.field), y = sortValue(board, b, s.field);
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : 1) * s.dir;
    }
    return at.get(a.id) - at.get(b.id);
  });
}

/** A view drawn as a board: { field, lane, columns: [{ key, name, color, count, limit, folded, items }],
 *  lanes: [{ key, name, folded, cells: [[item]] }] (one lane, key null, when the view has no group-by), shown, total }.
 *  `text` is the filter bar's, added to the view's own filter; `local` holds what GitHub doesn't keep
 *  for a view (limits, folded columns and lanes). */
export function layout(board, view, text = "", local = {}, ctx = {}) {
  const field = columnField(board, view);
  const laneField = view?.groupBy ? board.fields.find((f) => f.id === view.groupBy && f.id !== field?.id) ?? null : null;
  const filter = parseFilter(`${view?.filter ?? ""} ${text}`);
  const live = board.items.filter((i) => !i.archived);
  const shown = sortItems(board, live.filter((i) => matches(board, i, filter, { me: board.viewer, ...ctx })), view?.sort);
  const folded = new Set(local.folded ?? []), lanesFolded = new Set(local.lanesFolded ?? []), limits = local.limits ?? {};
  const groups = groupsOf(board, field, live);
  // "No Status" shows only when something is in it.
  const columns = groups.map((g) => ({ ...g, items: shown.filter((i) => groupKey(board, i, field) === g.key) }))
    .filter((c) => !c.none || c.items.length)
    .map((c) => ({ ...c, count: c.items.length, limit: Number(limits[c.key]) > 0 ? Number(limits[c.key]) : null, folded: folded.has(c.key) }));
  let lanes;
  if (!laneField) lanes = [{ key: null, name: "", folded: false, cells: columns.map((c) => c.items) }];
  else {
    lanes = groupsOf(board, laneField, live).map((g) => ({ key: g.key, name: g.name, color: g.color, done: g.done,
      cells: columns.map((c) => c.items.filter((i) => groupKey(board, i, laneField) === g.key)) }))
      .filter((l) => l.cells.some((c) => c.length))
      .map((l) => ({ ...l, folded: lanesFolded.has(l.key), count: l.cells.reduce((n, c) => n + c.length, 0) }));
  }
  return { field, lane: laneField, columns, lanes, shown: shown.length, total: live.length, sorted: Boolean(view?.sort?.length) };
}

// ---- moving with the keyboard

/** Each column's items top to bottom across the lanes (folded lanes skipped): what j / k walk through. */
export function grid(lay) {
  return lay.columns.map((_, ci) => lay.lanes.filter((l) => !l.folded).flatMap((l) => l.cells[ci]));
}

/** Where an item is in a grid: { col, row } or null. */
export function find(g, id) {
  for (let c = 0; c < g.length; c++) { const r = g[c].findIndex((i) => i.id === id); if (r >= 0) return { col: c, row: r }; }
  return null;
}

/** The selection moved by a key ("left" "right" "up" "down" "top" "bottom"), skipping folded columns:
 *  { col, row } (row -1 in an empty column). */
export function step(g, at, dir, folded = []) {
  const n = g.length;
  if (!n) return at;
  let { col, row } = at ?? { col: 0, row: 0 };
  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    let c = col + d;
    while (c >= 0 && c < n && folded[c]) c += d;
    if (c < 0 || c >= n) return { col, row };
    return { col: c, row: g[c].length ? Math.min(Math.max(0, row), g[c].length - 1) : -1 };
  }
  const len = g[col]?.length ?? 0;
  if (!len) return { col, row: -1 };
  if (dir === "up") return { col, row: Math.max(0, row - 1) };
  if (dir === "down") return { col, row: Math.min(len - 1, row + 1) };
  if (dir === "top") return { col, row: 0 };
  if (dir === "bottom") return { col, row: len - 1 };
  return { col, row };
}

/** Picks up the selected card: { id, from: { col, row }, col, row } (where it would land now). */
export function pickUp(g, at) {
  const it = g[at?.col]?.[at?.row];
  return it ? { id: it.id, from: { col: at.col, row: at.row }, col: at.col, row: at.row } : null;
}

/** The carried card moved one key: h / l to the next unfolded column (landing at the same height, or the end),
 *  j / k within the column. `sorted`: the view orders cards by a field, so only the column changes. */
export function carry(g, c, dir, { folded = [], sorted = false } = {}) {
  if (!c) return c;
  const rest = (col) => g[col].filter((i) => i.id !== c.id).length;
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
  if (dir === "bottom") return { ...c, row: max };
  return c;
}

/** The grid as it looks while a card is carried: out of its column, into its landing spot. */
export function carried(g, c) {
  if (!c) return g;
  const it = g[c.from.col]?.[c.from.row];
  if (!it) return g;
  const out = g.map((col) => col.filter((i) => i.id !== c.id));
  out[c.col] = [...out[c.col].slice(0, c.row), it, ...out[c.col].slice(c.row)];
  return out;
}

/** What dropping the carried card means: { id, column: the new column key or undefined (same), afterId (undefined:
 *  no reorder, null: first) } or null when nothing changes. `cols` are the layout's columns (for their keys). */
export function drop(g, c, cols, { sorted = false } = {}) {
  if (!c) return null;
  const moved = c.col !== c.from.col, at = carried(g, c)[c.col];
  const i = at.findIndex((x) => x.id === c.id);
  const before = i > 0 ? at[i - 1].id : null;
  const wasBefore = c.from.row > 0 ? g[c.from.col][c.from.row - 1].id : null;
  const reorder = !sorted && (moved || before !== wasBefore);
  if (!moved && !reorder) return null;
  return { id: c.id, ...(moved ? { column: cols[c.col].key } : {}), ...(reorder ? { afterId: before } : {}) };
}

// ---- edits: optimistic, laid over the last read

/** A field value as the board stores it, from what the menu chose. */
export function valueFor(field, choice) {
  if (choice == null || choice === "") return null;
  if (field.type === "single") { const o = field.options.find((x) => x.id === choice); return o ? { optionId: o.id, name: o.name } : null; }
  if (field.type === "iteration") { const it = field.iterations.find((x) => x.id === choice); return it ? { iterationId: it.id, title: it.title, startDate: it.startDate, duration: it.duration } : null; }
  if (field.type === "number") { const n = Number(choice); return Number.isFinite(n) ? { number: n } : null; }
  if (field.type === "date") return /^\d{4}-\d\d-\d\d$/.test(choice) ? { date: choice } : null;
  return { text: String(choice) };
}

/** The board with one edit applied (a new board; the old one is untouched). ops:
 *  { kind: "field", item, field, value } (value null clears), { kind: "position", item, afterId },
 *  { kind: "archive", item }, { kind: "add", item: <a whole item> }, { kind: "content", item, patch } (title, labels, assignees). */
export function apply(board, op) {
  const items = board.items;
  const i = items.findIndex((x) => x.id === op.item || x.id === op.item?.id);
  switch (op.kind) {
    case "add": return i >= 0 ? board : { ...board, items: [...items, op.item] };
    case "archive": return i < 0 ? board : { ...board, items: items.filter((_, k) => k !== i) };
    case "field": {
      if (i < 0) return board;
      const values = { ...items[i].values };
      if (op.value == null) delete values[op.field]; else values[op.field] = op.value;
      return { ...board, items: items.map((x, k) => (k === i ? { ...x, values } : x)) };
    }
    case "content": return i < 0 ? board : { ...board, items: items.map((x, k) => (k === i ? { ...x, content: { ...x.content, ...op.patch } } : x)) };
    case "position": {
      if (i < 0) return board;
      const it = items[i], rest = items.filter((_, k) => k !== i);
      const at = op.afterId == null ? 0 : rest.findIndex((x) => x.id === op.afterId) + 1;
      if (op.afterId != null && at === 0) return board;
      return { ...board, items: [...rest.slice(0, at), it, ...rest.slice(at)] };
    }
    default: return board;
  }
}

/** The board shown: the last read with every edit still on its way laid over it. A failed edit is dropped from
 *  `pending`, which is its rollback; one GitHub took stays until a read after it, which already has it. */
export const overlay = (board, pending) => (pending ?? []).reduce((b, p) => apply(b, p.op), board);

// ---- mutations (literal arguments: gh api's -f only takes strings)

const lit = (v) => JSON.stringify(v);

/** The GraphQL value of a field edit. */
function valueLiteral(field, value) {
  if (field.type === "single") return `{ singleSelectOptionId: ${lit(value.optionId)} }`;
  if (field.type === "iteration") return `{ iterationId: ${lit(value.iterationId)} }`;
  if (field.type === "number") return `{ number: ${Number(value.number)} }`;
  if (field.type === "date") return `{ date: ${lit(value.date)} }`;
  return `{ text: ${lit(value.text ?? "")} }`;
}

export function setFieldMutation(projectId, itemId, field, value) {
  if (value == null) return `mutation { clearProjectV2ItemFieldValue(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}, fieldId: ${lit(field.id)} }) { projectV2Item { id } } }`;
  return `mutation { updateProjectV2ItemFieldValue(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}, fieldId: ${lit(field.id)}, value: ${valueLiteral(field, value)} }) { projectV2Item { id } } }`;
}

export const positionMutation = (projectId, itemId, afterId) =>
  `mutation { updateProjectV2ItemPosition(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)}${afterId ? `, afterId: ${lit(afterId)}` : ""} }) { clientMutationId } }`;

export const archiveMutation = (projectId, itemId) =>
  `mutation { archiveProjectV2Item(input: { projectId: ${lit(projectId)}, itemId: ${lit(itemId)} }) { item { id } } }`;

export const addDraftMutation = (projectId, title) =>
  `mutation { addProjectV2DraftIssue(input: { projectId: ${lit(projectId)}, title: ${lit(title)} }) { projectItem { id databaseId content { ... on DraftIssue { id } } } } }`;

export const convertMutation = (itemId, repoId) =>
  `mutation { convertProjectV2DraftIssueItemToIssue(input: { itemId: ${lit(itemId)}, repositoryId: ${lit(repoId)} }) { item { id content { ... on Issue { id number url } } } } }`;

export const draftMutation = (draftId, { title, assigneeIds } = {}) =>
  `mutation { updateProjectV2DraftIssue(input: { draftIssueId: ${lit(draftId)}${title != null ? `, title: ${lit(title)}` : ""}${assigneeIds ? `, assigneeIds: ${lit(assigneeIds)}` : ""} }) { draftIssue { id } } }`;

/** Labels or assignees added and removed on an issue or pull request (ids). */
export function toggleMutation(contentId, kind, add, remove) {
  const [a, r, key] = kind === "labels" ? ["addLabelsToLabelable", "removeLabelsFromLabelable", "labelIds"] : ["addAssigneesToAssignable", "removeAssigneesFromAssignable", "assigneeIds"];
  const id = kind === "labels" ? "labelableId" : "assignableId";
  const parts = [];
  if (add.length) parts.push(`add: ${a}(input: { ${id}: ${lit(contentId)}, ${key}: ${lit(add)} }) { clientMutationId }`);
  if (remove.length) parts.push(`remove: ${r}(input: { ${id}: ${lit(contentId)}, ${key}: ${lit(remove)} }) { clientMutationId }`);
  return parts.length ? `mutation { ${parts.join(" ")} }` : null;
}

// ---- drawing helpers

/** GitHub's option colors as the theme's ansi slots. */
export const OPTION_ANSI = { GRAY: 8, BLUE: 4, GREEN: 2, YELLOW: 3, ORANGE: 3, RED: 1, PINK: 5, PURPLE: 5 };

/** Up to two letters for a login's square. */
export const initials = (login) => {
  const parts = String(login ?? "?").split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  return ((parts.length > 1 ? parts[0][0] + parts[1][0] : String(login ?? "?").slice(0, 2)) || "?").toUpperCase();
};

/** A login's stable color slot (1..6). */
export function loginSlot(login) {
  let h = 0;
  for (const ch of String(login ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1 + (h % 6);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A field value as a card prints it: "Sprint 4", "P1", "3", "Nov 14". */
export function valueText(field, v) {
  if (!v) return "";
  if (v.name != null) return v.name;
  if (v.title != null) return v.title;
  if (v.number != null) return String(v.number);
  if (v.date) { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(v.date); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : v.date; }
  if (v.names != null) return v.names;
  return v.text ?? "";
}

/** The fields a card shows under its title: the view's visible ones that aren't the title, the columns,
 *  the lanes or drawn elsewhere (assignees, labels, repo). */
export function cardFields(board, view, lay) {
  const skip = new Set(["title", "assignees", "labels", "repo", "linked_pull_requests", "reviewers", "tracks", "tracked_by", "parent_issue", "sub_issues_progress"]);
  const ids = view?.visible?.length ? view.visible : board.fields.map((f) => f.id);
  return ids.map((id) => board.fields.find((f) => f.id === id)).filter((f) => f && !skip.has(f.type) && f.id !== lay.field?.id && f.id !== lay.lane?.id);
}

/** The fields the menu edits, in the board's order. */
export function editableFields(board, item) {
  const kinds = item?.content.kind === "draft" ? ["single", "iteration", "text", "number", "date", "assignees", "title"] : ["single", "iteration", "text", "number", "date", "assignees", "labels"];
  return board.fields.filter((f) => kinds.includes(f.type));
}

/** A title in at most `lines` lines of `width` characters (monospace), the last one cut with an ellipsis. */
export function wrap(text, width, lines = 2) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean), out = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = line ? `${line} ${w}` : w;
    if (next.length <= width) { line = next; continue; }
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

export function slimBoard(b) {
  if (!b) return null;
  return { project: b.project, viewer: b.viewer, fields: b.fields, views: b.views, repos: b.repos, total: b.total, more: null,
    items: b.items.filter((i) => !String(i.id).startsWith("temp-")).map((i) => ({ id: i.id, db: i.db, type: i.type, archived: i.archived, values: i.values,
      content: { ...i.content, assignees: i.content.assignees.map((a) => ({ id: a.id, login: a.login })), labels: i.content.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })) } })) };
}
