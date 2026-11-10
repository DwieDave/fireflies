// Writes the Projects fixtures (GraphQL answers as GitHub shapes them): bun scripts/fixtures/nocturne-github-projects/generate.ts <this folder>
const out = process.argv[2];
const P = "PVT_kwHOAAAAAc4A0001";
const owner = { __typename: "User", login: "DwieDave" };
const proj = (id: string, number: number, title: string, extra = {}) => ({ id, number, title, url: `https://github.com/users/DwieDave/projects/${number}`, closed: false, shortDescription: "", updatedAt: "2026-11-09T10:00:00Z", owner, ...extra });

const list = { data: {
  viewer: { login: "DwieDave" },
  repository: { id: "R_fireflies", nameWithOwner: "DwieDave/fireflies",
    projectsV2: { nodes: [proj(P, 3, "Fireflies roadmap")] },
    owner: { __typename: "User", login: "DwieDave", projectsV2: { nodes: [proj(P, 3, "Fireflies roadmap"), proj("PVT_kwHOAAAAAc4A0002", 1, "Reading list"), proj("PVT_kwHOAAAAAc4A0003", 2, "Old ideas", { closed: true })] } } },
  parent: { nameWithOwner: "herdrdev/herdr-app", projectsV2: { nodes: [{ ...proj("PVT_kwDOBBBBBc4B0001", 1, "Herdr 2"), owner: { __typename: "Organization", login: "herdrdev" }, url: "https://github.com/orgs/herdrdev/projects/1" }] } },
} };

const opt = (id: string, name: string, color: string) => ({ id, name, color });
const status = { __typename: "ProjectV2SingleSelectField", id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [opt("o_backlog", "Backlog", "GRAY"), opt("o_ready", "Ready", "BLUE"), opt("o_prog", "In progress", "YELLOW"), opt("o_review", "In review", "PURPLE"), opt("o_done", "Done", "GREEN")] };
const prio = { __typename: "ProjectV2SingleSelectField", id: "F_prio", name: "Priority", dataType: "SINGLE_SELECT", options: [opt("p0", "P0", "RED"), opt("p1", "P1", "ORANGE"), opt("p2", "P2", "BLUE"), opt("p3", "P3", "GRAY")] };
const size = { __typename: "ProjectV2SingleSelectField", id: "F_size", name: "Size", dataType: "SINGLE_SELECT", options: [opt("s_xs", "XS", "GRAY"), opt("s_s", "S", "GRAY"), opt("s_m", "M", "GRAY"), opt("s_l", "L", "GRAY"), opt("s_xl", "XL", "GRAY")] };
const sprint = { __typename: "ProjectV2IterationField", id: "F_sprint", name: "Sprint", dataType: "ITERATION", configuration: {
  iterations: [{ id: "it4", title: "Sprint 4", startDate: "2026-11-10", duration: 14 }, { id: "it5", title: "Sprint 5", startDate: "2026-11-24", duration: 14 }],
  completedIterations: [{ id: "it3", title: "Sprint 3", startDate: "2026-10-27", duration: 14 }, { id: "it2", title: "Sprint 2", startDate: "2026-10-13", duration: 14 }] } };
const common = (id: string, name: string, dataType: string) => ({ __typename: "ProjectV2Field", id, name, dataType });
const fields = [common("F_title", "Title", "TITLE"), common("F_assignees", "Assignees", "ASSIGNEES"), status, common("F_labels", "Labels", "LABELS"), common("F_repo", "Repository", "REPOSITORY"), common("F_ms", "Milestone", "MILESTONE"), prio, size, common("F_est", "Estimate", "NUMBER"), common("F_target", "Target date", "DATE"), sprint, common("F_notes", "Notes", "TEXT"), common("F_lpr", "Linked pull requests", "LINKED_PULL_REQUESTS")];
const named = (ids: string[]) => ({ nodes: ids.map((id) => ({ id, name: fields.find((f) => f.id === id)!.name })) });
const views = { nodes: [
  { id: "V_board", number: 1, name: "Board", layout: "BOARD_LAYOUT", filter: "", fields: named(["F_title", "F_assignees", "F_status", "F_labels", "F_prio", "F_size", "F_sprint", "F_target"]), groupByFields: { nodes: [] }, verticalGroupByFields: named(["F_status"]), sortByFields: { nodes: [] } },
  { id: "V_sprint", number: 2, name: "By sprint", layout: "BOARD_LAYOUT", filter: "is:open", fields: named(["F_title", "F_assignees", "F_status", "F_prio", "F_est"]), groupByFields: named(["F_sprint"]), verticalGroupByFields: named(["F_status"]), sortByFields: { nodes: [{ direction: "ASC", field: { id: "F_prio", name: "Priority" } }] } },
  { id: "V_bugs", number: 3, name: "Bugs", layout: "BOARD_LAYOUT", filter: "label:bug -status:Done", fields: named(["F_title", "F_assignees", "F_labels", "F_prio"]), groupByFields: { nodes: [] }, verticalGroupByFields: named(["F_prio"]), sortByFields: { nodes: [] } },
  { id: "V_table", number: 4, name: "Everything", layout: "TABLE_LAYOUT", filter: "", fields: named(["F_title", "F_status", "F_assignees"]), groupByFields: { nodes: [] }, verticalGroupByFields: { nodes: [] }, sortByFields: { nodes: [] } },
] };

const people: Record<string, string> = { DwieDave: "U_dave", ogulcancelik: "U_can", "cg-night": "U_cg" };
const labels: Record<string, [string, string]> = { bug: ["L_bug", "d73a4a"], enhancement: ["L_enh", "a2eeef"], sidebar: ["L_side", "0075ca"], "good first issue": ["L_gfi", "7057ff"] };
let n = 0;
type Spec = { t: string; kind?: "issue" | "pr" | "draft"; num?: number; repo?: string; st?: string; who?: string[]; lab?: string[]; pr?: string; sz?: string; sp?: string; est?: number; date?: string; notes?: string; state?: string; ms?: string };
const fv = (s: Spec) => {
  const nodes: any[] = [];
  const sel = (fid: string, field: any, oid?: string) => { if (oid) nodes.push({ __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: oid, name: field.options.find((o: any) => o.id === oid).name, field: { id: fid } }); };
  sel("F_status", status, s.st); sel("F_prio", prio, s.pr); sel("F_size", size, s.sz);
  if (s.sp) { const it = [...sprint.configuration.iterations, ...sprint.configuration.completedIterations].find((x) => x.id === s.sp)!; nodes.push({ __typename: "ProjectV2ItemFieldIterationValue", iterationId: it.id, title: it.title, startDate: it.startDate, duration: it.duration, field: { id: "F_sprint" } }); }
  if (s.est != null) nodes.push({ __typename: "ProjectV2ItemFieldNumberValue", number: s.est, field: { id: "F_est" } });
  if (s.date) nodes.push({ __typename: "ProjectV2ItemFieldDateValue", date: s.date, field: { id: "F_target" } });
  if (s.notes) nodes.push({ __typename: "ProjectV2ItemFieldTextValue", text: s.notes, field: { id: "F_notes" } });
  nodes.push({ __typename: "ProjectV2ItemFieldTextValue", text: s.t, field: { id: "F_title" } });
  return { nodes };
};
const item = (s: Spec) => {
  n++;
  const kind = s.kind ?? "issue";
  const assignees = { nodes: (s.who ?? []).map((l) => ({ id: people[l], login: l })) };
  const repo = s.repo ?? "DwieDave/fireflies";
  const content = kind === "draft" ? { __typename: "DraftIssue", id: `DI_${n}`, title: s.t, assignees }
    : { __typename: kind === "pr" ? "PullRequest" : "Issue", id: `${kind === "pr" ? "PR" : "I"}_${s.num}`, number: s.num, title: s.t, state: s.state ?? "OPEN", ...(kind === "pr" ? { isDraft: false } : {}), url: `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${s.num}`, repository: { nameWithOwner: repo }, assignees,
      labels: { nodes: (s.lab ?? []).map((l) => ({ id: labels[l][0], name: l, color: labels[l][1] })) }, milestone: s.ms ? { title: s.ms } : null };
  return { id: `PVTI_${String(n).padStart(3, "0")}`, databaseId: 9000 + n, type: kind === "pr" ? "PULL_REQUEST" : kind === "draft" ? "DRAFT_ISSUE" : "ISSUE", isArchived: false, fieldValues: fv(s), content };
};
const specs1: Spec[] = [
  { t: "Sidebar remembers collapsed spaces", num: 231, st: "o_backlog", who: ["DwieDave"], lab: ["enhancement"], sz: "s_s", pr: "p2" },
  { t: "Sidebar: drag spaces between machines?", kind: "draft", st: "o_backlog" },
  { t: "Sidebar search ignores worktrees", num: 198, repo: "herdrdev/herdr-core", st: "o_backlog", lab: ["bug"], pr: "p1" },
  { t: "Sidebar badges for waiting agents", num: 240, st: "o_ready", who: ["cg-night"], sp: "it4", sz: "s_m", pr: "p2", est: 5 },
  { t: "Sidebar width survives restarts", num: 212, st: "o_ready", who: ["DwieDave"], lab: ["bug"], sp: "it4", sz: "s_s", pr: "p1", est: 2 },
  { t: "Sidebar keyboard nav skips hidden tabs", num: 226, st: "o_prog", who: ["DwieDave", "ogulcancelik"], lab: ["bug", "sidebar"], sp: "it4", pr: "p1", est: 3, date: "2026-11-14", notes: "repro in the nocturne layout" },
  { t: "Sidebar scroll jank on 120Hz", kind: "pr", num: 219, st: "o_prog", who: ["DwieDave"], sz: "s_xs", sp: "it4", pr: "p0" },
  { t: "Drag tabs between spaces", num: 211, st: "o_review", who: ["DwieDave"], sz: "s_l", sp: "it4", pr: "p2" },
  { t: "herdr-core: resize storms", kind: "pr", num: 207, repo: "herdrdev/herdr-core", st: "o_review", sp: "it3", pr: "p1" },
];
const specs2: Spec[] = [
  { t: "Projects tab in the GitHub window", num: 244, st: "o_ready", who: ["DwieDave"], sp: "it5", pr: "p1", sz: "s_xl", est: 8, ms: "2.1" },
  { t: "Spotlight on Linux only", num: 238, st: "o_review", sp: "it5", pr: "p3", lab: ["good first issue"] },
  { t: "Remember the board's scroll", kind: "draft", st: "o_ready", sp: "it5" },
  { t: "Old crash on wake", num: 150, st: "o_done", who: ["ogulcancelik"], state: "CLOSED", lab: ["bug"], sp: "it2" },
  { t: "Ship the nocturne layout", kind: "pr", num: 160, st: "o_done", state: "MERGED", sp: "it3" },
  { t: "Untriaged idea", kind: "draft" },
];
const page = (specs: Spec[], next: string | null, first: boolean) => ({ data: { ...(first ? { viewer: { login: "DwieDave" } } : {}), node: {
  ...(first ? { ...proj(P, 3, "Fireflies roadmap"), fields: { nodes: fields }, views, repositories: { nodes: [{ id: "R_fireflies", nameWithOwner: "DwieDave/fireflies" }, { id: "R_core", nameWithOwner: "herdrdev/herdr-core" }] } } : { id: P }),
  items: { totalCount: specs1.length + specs2.length, pageInfo: { hasNextPage: Boolean(next), endCursor: next }, nodes: specs.map(item) } } } });
const p1 = page(specs1, "CURSOR_1", true);
const p2 = page(specs2, null, false);
const detail = { data: { node: { __typename: "Issue", body: "With a tab hidden by its space, `j`/`k` lands on the next visible tab but the focus ring stays on the hidden one.\n\n**Expected:** the ring follows.", url: "https://github.com/DwieDave/fireflies/issues/226", createdAt: "2026-11-07T09:00:00Z", author: { login: "DwieDave" },
  comments: { totalCount: 2, nodes: [{ author: { login: "ogulcancelik" }, body: "Same with the palette open.", createdAt: "2026-11-08T09:00:00Z", url: "https://github.com/DwieDave/fireflies/issues/226#issuecomment-1" }, { author: { login: "DwieDave" }, body: "Looking at it in `sidebar.js`.", createdAt: "2026-11-09T09:00:00Z", url: "https://github.com/DwieDave/fireflies/issues/226#issuecomment-2" }] } } } };
const choices = { data: { repository: { labels: { nodes: Object.entries(labels).map(([name, [id, color]]) => ({ id, name, color })) }, assignableUsers: { nodes: Object.entries(people).map(([login, id]) => ({ id, login })) } } } };
for (const [f, v] of Object.entries({ "list.json": list, "board-1.json": p1, "board-2.json": p2, "detail.json": detail, "choices.json": choices })) await Bun.write(`${out}/${f}`, JSON.stringify(v, null, 1) + "\n");
console.log("ok");
