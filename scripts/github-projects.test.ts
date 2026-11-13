import { test, expect } from "bun:test";
import { projectListQuery, parseProjectList, boardQuery, parseBoard, addPage, parseItem, scopeProblem, parseDetail, parseChoices, slimBoard, MAX_ITEMS, isItemNode, isBoardAnswer, isProjectListAnswer, isDetailAnswer, isChoicesAnswer, isStoredBoard, boardOf } from "../defaults/mods/github/board.ts";
import { parseFilter, filterTokens, matches, iterationAt } from "../defaults/mods/github/board-filter.ts";
import { layout, columnField, grid, find, step, pickUp, carry, carried, drop } from "../defaults/mods/github/board-layout.ts";
import { apply, overlay, valueFor, setFieldMutation, positionMutation, archiveMutation, addDraftMutation, convertMutation, toggleMutation } from "../defaults/mods/github/board-edits.ts";
import { cardFields, editableFields, initials, valueText } from "../defaults/mods/github/board-cards.ts";
import { merge, parse, prune, fit, entryFor, LIMITS, VERSION } from "../defaults/mods/github/cache.ts";

const dir = `${import.meta.dir}/fixtures/github-projects`;
const load = async (f: string) => JSON.parse(await Bun.file(`${dir}/${f}`).text()).data;
const board = async () => addPage(parseBoard(await load("board-1.json")), await load("board-2.json"));
const view = (b: any, name: string) => b.views.find((v: any) => v.name === name);
const NOW = Date.parse("2026-11-12T12:00:00Z");
const ids = (items: any[]) => items.map((i) => i.content.number ?? i.content.title);

// ---- reading

test("GitHub's answers (the fixtures) pass the guards gh.ts reads them with", async () => {
  expect(isProjectListAnswer(await load("list.json"))).toBe(true);
  expect(isBoardAnswer(await load("board-1.json"))).toBe(true);
  expect(isBoardAnswer(await load("board-2.json"))).toBe(true);
  expect(isDetailAnswer(await load("detail.json"))).toBe(true);
  expect(isChoicesAnswer(await load("choices.json"))).toBe(true);
  // A node GitHub nulls out (one this login can't see) doesn't refuse the answer.
  expect(isBoardAnswer({ node: { id: "P", items: { nodes: [null, { id: "x" }] } } })).toBe(true);
});

test("the picker lists the repo's projects, its parent's, then the owner's, each once, open first", async () => {
  const l = parseProjectList(await load("list.json"));
  expect(l.viewer).toBe("DwieDave");
  expect(l.repoId).toBe("R_fireflies");
  expect(l.projects.map((p) => [p.title, p.from])).toEqual([["Fireflies roadmap", "repo"], ["Herdr 2", "parent"], ["Reading list", "owner"], ["Old ideas", "owner"]]);
  expect(l.projects[3].closed).toBe(true);
  expect(l.projects[1].owner).toBe("herdrdev");
});

test("a fork's list query asks for its parent too", () => {
  expect(projectListQuery({ full: "o/r" })).not.toContain("parent:");
  const q = projectListQuery({ full: "me/r", parent: "up/r" });
  expect(q).toContain('parent: repository(owner: "up", name: "r")');
  expect(q).toContain('repository(owner: "me", name: "r")');
  expect(boardQuery(false)).not.toContain("views");
  expect(boardQuery(true)).toContain("verticalGroupByFields");
});

test("a board reads fields, views (filter, sort, group-by, columns), iterations and items across pages", async () => {
  const b = await board();
  expect(b.project).toMatchObject({ id: "PVT_kwHOAAAAAc4A0001", number: 3, title: "Fireflies roadmap", owner: "DwieDave" });
  expect(b.items.length).toBe(15);
  expect(b.total).toBe(15);
  expect(b.more).toBeNull();
  expect(parseBoard(await load("board-1.json")).more).toBe("CURSOR_1");
  expect(b.fields.find((f: any) => f.name === "Status").options.map((o: any) => o.name)).toEqual(["Backlog", "Ready", "In progress", "In review", "Done"]);
  const sprint = b.fields.find((f: any) => f.type === "iteration");
  expect(sprint.iterations.map((i: any) => [i.title, i.done])).toEqual([["Sprint 2", true], ["Sprint 3", true], ["Sprint 4", false], ["Sprint 5", false]]);
  const v = view(b, "By sprint");
  expect(v).toMatchObject({ layout: "board", filter: "is:open", columnBy: "F_status", groupBy: "F_sprint", sort: [{ field: "F_prio", dir: 1 }] });
  expect(view(b, "Everything").layout).toBe("table");
  expect(b.repos.map((r: any) => r.full)).toEqual(["DwieDave/fireflies", "herdrdev/herdr-core"]);
});

test("items: issues, pull requests and drafts with their values", async () => {
  const b = await board();
  const issue = b.items.find((i: any) => i.content.number === 226);
  expect(issue.content).toMatchObject({ kind: "issue", repo: "DwieDave/fireflies", state: "OPEN" });
  expect(issue.content.assignees.map((a: any) => a.login)).toEqual(["DwieDave", "lanternmoth"]);
  expect(issue.content.labels.map((l: any) => l.name)).toEqual(["bug", "sidebar"]);
  expect(issue.values.get("F_status")).toEqual({ optionId: "o_prog", name: "In progress" });
  expect(issue.values.get("F_sprint")).toMatchObject({ iterationId: "it4", title: "Sprint 4" });
  expect(issue.values.get("F_est")).toEqual({ number: 3 });
  expect(issue.values.get("F_target")).toEqual({ date: "2026-11-14" });
  expect(issue.values.get("F_notes")).toEqual({ text: "repro in the nocturne layout" });
  const pr = b.items.find((i: any) => i.content.number === 219);
  expect(pr.content.kind).toBe("pr");
  const draft = b.items.find((i: any) => i.content.kind === "draft");
  expect(draft.content).toMatchObject({ state: "DRAFT", number: null, url: null });
  expect(parseItem({ id: "x", content: null }).content.kind).toBe("redacted");
  // A node that isn't an item (null, no id) is left out where the page is read.
  expect([isItemNode(null), isItemNode({ content: {} })]).toEqual([false, false]);
});

test("a board stops reading pages at the cap", async () => {
  const b = parseBoard(await load("board-1.json"));
  const many = { node: { items: { totalCount: 5000, pageInfo: { hasNextPage: true, endCursor: "C" }, nodes: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: `n${i}`, content: { __typename: "DraftIssue", title: "x" } })) } } };
  expect(addPage(b, many).more).toBeNull();
});

test("a missing scope says which command grants it", () => {
  const read = scopeProblem("Your token has not been granted the required scopes to execute this query. The 'title' field requires one of the following scopes: ['read:project']");
  expect(read).toMatchObject({ need: "read:project", command: "gh auth refresh -s read:project" });
  expect(scopeProblem("... requires one of the following scopes: ['project'] ...")?.need).toBe("project");
  expect(scopeProblem("INSUFFICIENT_SCOPES", true)?.command).toBe("gh auth refresh -s project");
  expect(scopeProblem("Could not resolve to a node")).toBeNull();
});

test("detail and choices", async () => {
  const d = parseDetail(await load("detail.json"));
  expect(d.author).toBe("DwieDave");
  expect(d.comments.map((c: any) => c.who)).toEqual(["lanternmoth", "DwieDave"]);
  expect(d.more).toBe(0);
  const c = parseChoices(await load("choices.json"));
  expect(c.labels.find((l: any) => l.name === "bug").id).toBe("L_bug");
  expect(c.users.map((u: any) => u.login)).toContain("cg-night");
});

// ---- filter

test("the filter reads qualifiers, quotes, commas, negation and words", () => {
  expect(parseFilter('assignee:@me label:"good first issue",bug -status:Done is:open repo:o/r sidebar "two words"')).toEqual({
    terms: [
      { key: "assignee", values: ["@me"], neg: false },
      { key: "label", values: ["good first issue", "bug"], neg: false },
      { key: "status", values: ["Done"], neg: true },
      { key: "is", values: ["open"], neg: false },
      { key: "repo", values: ["o/r"], neg: false },
    ],
    words: ["sidebar", "two words"],
  });
  expect(parseFilter("")).toEqual({ terms: [], words: [] });
  expect(parseFilter('status:"In progress"').terms[0].values).toEqual(["In progress"]);
  expect(filterTokens('-label:"a b" x').map((t) => t.text)).toEqual(["-label:", '"a b"', "x"]);
});

test("filters match like GitHub's", async () => {
  const b = await board();
  const hit = (q: string) => ids(b.items.filter((i: any) => matches(b, i, parseFilter(q), { me: "DwieDave", now: NOW })));
  expect(hit("assignee:@me is:issue is:open")).toEqual([231, 212, 226, 211, 244]);
  expect(hit("label:bug -status:Done")).toEqual([198, 212, 226]);
  expect(hit('status:"In review"')).toEqual([211, 207, 238]);
  expect(hit("repo:herdrdev/herdr-core")).toEqual([198, 207]);
  expect(hit("repo:herdr-core is:pr")).toEqual([207]);
  expect(hit("is:closed")).toEqual([150, 160]);
  expect(hit("is:merged")).toEqual([160]);
  expect(hit("is:draft")).toEqual(["Sidebar: drag spaces between machines?", "Remember the board's scroll", "Untriaged idea"]);
  expect(hit("no:assignee is:issue")).toEqual([198, 238]);
  expect(hit("no:status")).toEqual(["Untriaged idea"]);
  expect(hit("priority:P0,P1 sidebar")).toEqual([198, 212, 226, 219]);
  expect(hit("sprint:@current")).toEqual([240, 212, 226, 219, 211]);
  expect(hit("sprint:@next")).toEqual([244, 238, "Remember the board's scroll"]);
  expect(hit("sprint:@previous")).toEqual([207, 160]);
  expect(hit("estimate:>=3")).toEqual([240, 226, 244]);
  expect(hit("target-date:<2026-12-01")).toEqual([226]);
  expect(hit("#226")).toEqual([226]);
  expect(hit("bogus:thing worktrees")).toEqual([198]); // an unknown qualifier hides nothing
});

test("@current is the iteration running today, @next the one after", async () => {
  const f = (await board()).fields.find((x: any) => x.type === "iteration");
  expect(iterationAt(f, "@current", NOW)?.title).toBe("Sprint 4");
  expect(iterationAt(f, "@next", NOW)?.title).toBe("Sprint 5");
  expect(iterationAt(f, "@previous", NOW)?.title).toBe("Sprint 3");
  expect(iterationAt(f, "@current", Date.parse("2027-06-01"))).toBeNull();
});

// ---- layout

test("a view's columns follow its column field, with No Status only when used", async () => {
  const b = await board();
  const lay = layout(b, view(b, "Board"), "", {}, { now: NOW });
  expect(lay.field.name).toBe("Status");
  expect(lay.columns.map((c: any) => [c.name, c.count])).toEqual([["No Status", 1], ["Backlog", 3], ["Ready", 4], ["In progress", 2], ["In review", 3], ["Done", 2]]);
  expect(ids(lay.columns[2].items)).toEqual([240, 212, 244, "Remember the board's scroll"]);
  expect(lay.lanes.length).toBe(1);
  expect(lay.total).toBe(15);
});

test("a view's own filter, the bar's text and local limits and folds", async () => {
  const b = await board();
  const lay = layout(b, view(b, "Board"), "assignee:@me", { limits: new Map([["o_prog", 1]]), folded: ["o_done"] }, { now: NOW });
  expect(lay.shown).toBe(6);
  const prog = lay.columns.find((c: any) => c.key === "o_prog");
  expect(prog).toMatchObject({ count: 2, limit: 1 });
  expect(lay.columns.find((c: any) => c.key === "o_done").folded).toBe(true);
  const bugs = layout(b, view(b, "Bugs"), "", {}, { now: NOW });
  expect(bugs.field.name).toBe("Priority");
  expect(bugs.columns.map((c: any) => [c.name, ids(c.items)])).toEqual([["P0", []], ["P1", [198, 212, 226]], ["P2", []], ["P3", []]]);
});

test("group-by draws swimlanes; sort orders within them", async () => {
  const b = await board();
  const lay = layout(b, view(b, "By sprint"), "", { lanesFolded: ["it5"] }, { now: NOW });
  expect(lay.lane.name).toBe("Sprint");
  expect(lay.sorted).toBe(true);
  expect(lay.lanes.map((l: any) => [l.name, l.count, l.folded])).toEqual([["No Sprint", 4], ["Sprint 3", 1], ["Sprint 4", 5], ["Sprint 5", 3]].map(([n, c]) => [n, c, n === "Sprint 5"]));
  const s4 = lay.lanes.find((l: any) => l.name === "Sprint 4");
  const prog = lay.columns.findIndex((c: any) => c.key === "o_prog");
  expect(ids(s4.cells[prog])).toEqual([219, 226]); // P0 before P1
  // The grid skips folded lanes.
  const g = grid(lay);
  expect(g[lay.columns.findIndex((c: any) => c.key === "o_ready")].map((i: any) => i.content.number)).toEqual([212, 240]);
});

test("a view without its own column field falls back to Status", async () => {
  const b = await board();
  expect(columnField(b, view(b, "Everything"))?.name).toBe("Status");
  expect(columnField(b, { ...view(b, "Board"), columnBy: "F_sprint" })?.name).toBe("Sprint");
  expect(columnField(b, { ...view(b, "Board"), columnBy: "F_notes" })?.name).toBe("Status");
});

test("cards show the view's visible fields, minus the column, lane and what's drawn elsewhere", async () => {
  const b = await board();
  const v = view(b, "Board");
  expect(cardFields(b, v, layout(b, v)).map((f: any) => f.name)).toEqual(["Priority", "Size", "Sprint", "Target date"]);
  const s = view(b, "By sprint");
  expect(cardFields(b, s, layout(b, s)).map((f: any) => f.name)).toEqual(["Priority", "Estimate"]);
  const draft = b.items.find((i: any) => i.content.kind === "draft");
  expect(editableFields(b, draft).map((f: any) => f.type)).toContain("title");
  expect(editableFields(b, b.items[0]).map((f: any) => f.type)).toContain("labels");
});

// ---- carrying a card

const mini = () => {
  const it = (id: string) => ({ id });
  return [[it("a"), it("b"), it("c")], [], [it("d")], [it("e"), it("f")]] as any[][];
};
const cols = [{ key: "c0" }, { key: "c1" }, { key: "c2" }, { key: "c3" }];

test("h j k l move the selection, skipping folded columns and landing in empty ones", () => {
  const g = mini();
  expect(step(g, { col: 0, row: 2 }, "right")).toEqual({ col: 1, row: -1 });
  expect(step(g, { col: 0, row: 2 }, "right", [false, true])).toEqual({ col: 2, row: 0 });
  expect(step(g, { col: 3, row: 1 }, "right")).toEqual({ col: 3, row: 1 });
  expect(step(g, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 1 });
  expect(step(g, { col: 0, row: 2 }, "down")).toEqual({ col: 0, row: 2 });
  expect(step(g, { col: 0, row: 0 }, "up")).toEqual({ col: 0, row: 0 });
  expect(step(g, { col: 0, row: 0 }, "bottom")).toEqual({ col: 0, row: 2 });
  expect(find(g, "f")).toEqual({ col: 3, row: 1 });
  expect(find(g, "zz")).toBeNull();
});

test("carrying: pick up, move across and down, drop says column and the card above", () => {
  const g = mini();
  let c = pickUp(g, { col: 0, row: 1 }); // b
  expect(c).toMatchObject({ id: "b", col: 0, row: 1 });
  c = carry(g, c, "right"); // into the empty column
  expect(c).toMatchObject({ col: 1, row: 0 });
  c = carry(g, c, "right");
  expect(c).toMatchObject({ col: 2, row: 0 }); // at the same height: above d
  expect(carried(g, c)[2].map((i) => i.id)).toEqual(["b", "d"]);
  expect(carried(g, c)[0].map((i) => i.id)).toEqual(["a", "c"]);
  expect(drop(g, c, cols)).toEqual({ id: "b", column: "c2", afterId: null });
  c = carry(g, c, "down");
  expect(drop(g, c, cols)).toEqual({ id: "b", column: "c2", afterId: "d" });
});

test("carrying within a column reorders; back where it was is no change", () => {
  const g = mini();
  let c = pickUp(g, { col: 0, row: 0 }); // a
  c = carry(g, c, "down");
  expect(drop(g, c, cols)).toEqual({ id: "a", afterId: "b" });
  c = carry(g, c, "bottom");
  expect(drop(g, c, cols)).toEqual({ id: "a", afterId: "c" });
  c = carry(g, c, "top");
  expect(drop(g, c, cols)).toBeNull();
  // Over and back: nothing.
  c = carry(g, carry(g, c, "right"), "left");
  expect(drop(g, c, cols)).toBeNull();
});

test("carrying skips folded columns, and a sorted view only changes the column", () => {
  const g = mini();
  let c = pickUp(g, { col: 0, row: 2 });
  c = carry(g, c, "right", { folded: [false, true, false, false] });
  expect(c.col).toBe(2);
  const s = carry(g, pickUp(g, { col: 3, row: 0 }), "down", { sorted: true });
  expect(s.row).toBe(0);
  const m = carry(g, pickUp(g, { col: 3, row: 1 }), "left", { sorted: true });
  expect(drop(g, m, cols, { sorted: true })).toEqual({ id: "f", column: "c2" });
  expect(pickUp(g, { col: 1, row: -1 })).toBeNull();
});

// ---- optimistic edits

test("edits apply to a copy; a failed one rolls back by leaving pending", async () => {
  const b = await board();
  const status = b.fields.find((f: any) => f.name === "Status");
  const item = b.items.find((i: any) => i.content.number === 212);
  const pending = [
    { id: 1, op: { kind: "field", item: item.id, field: "F_status", value: valueFor(status, "o_prog") } },
    { id: 2, op: { kind: "position", item: item.id, afterId: null } },
  ];
  const shown = overlay(b, pending);
  expect(shown.items[0].id).toBe(item.id);
  expect(shown.items[0].values.get("F_status").name).toBe("In progress");
  expect(b.items.find((i: any) => i.id === item.id).values.get("F_status").name).toBe("Ready"); // the read is untouched
  const lay = layout(shown, view(shown, "Board"), "", {}, { now: NOW });
  expect(ids(lay.columns.find((c: any) => c.key === "o_prog").items)).toEqual([212, 226, 219]);
  // The move failed: dropped from pending, the card is back.
  const back = overlay(b, pending.filter((p) => p.id !== 1 && p.id !== 2));
  expect(layout(back, view(back, "Board")).columns.find((c: any) => c.key === "o_ready").items.map((i: any) => i.content.number)).toContain(212);
});

test("each kind of edit", async () => {
  const b = await board();
  const id = b.items[0].id;
  expect(apply(b, { kind: "archive", item: id }).items.length).toBe(b.items.length - 1);
  expect(apply(b, { kind: "field", item: id, field: "F_prio", value: null }).items[0].values.get("F_prio")).toBeUndefined();
  expect(apply(b, { kind: "content", item: id, patch: { title: "New" } }).items[0].content.title).toBe("New");
  const draft = { id: "temp-1", values: new Map(), content: { kind: "draft", title: "x", assignees: [], labels: [] } };
  const added = apply(b, { kind: "add", item: draft });
  expect(added.items.at(-1).id).toBe("temp-1");
  expect(apply(added, { kind: "add", item: draft }).items.length).toBe(added.items.length);
  const last = b.items.at(-1).id;
  expect(apply(b, { kind: "position", item: id, afterId: last }).items.at(-1).id).toBe(id);
  expect(apply(b, { kind: "position", item: id, afterId: "missing" })).toBe(b);
  expect(apply(b, { kind: "field", item: "missing", field: "x", value: null })).toBe(b);
});

test("values from the menu", async () => {
  const b = await board();
  const by = (n: string) => b.fields.find((f: any) => f.name === n);
  expect(valueFor(by("Sprint"), "it5")).toMatchObject({ iterationId: "it5", title: "Sprint 5" });
  expect(valueFor(by("Estimate"), "2.5")).toEqual({ number: 2.5 });
  expect(valueFor(by("Estimate"), "x")).toBeNull();
  expect(valueFor(by("Target date"), "2026-12-01")).toEqual({ date: "2026-12-01" });
  expect(valueFor(by("Target date"), "soon")).toBeNull();
  expect(valueFor(by("Notes"), "hi")).toEqual({ text: "hi" });
  expect(valueFor(by("Status"), "")).toBeNull();
  expect(valueText(by("Target date"), { date: "2026-11-14" })).toBe("Nov 14");
});

test("mutations carry their arguments as literals", async () => {
  const b = await board();
  const by = (n: string) => b.fields.find((f: any) => f.name === n);
  expect(setFieldMutation("P", "I", by("Status"), { optionId: "o_done" })).toContain('value: { singleSelectOptionId: "o_done" }');
  expect(setFieldMutation("P", "I", by("Sprint"), { iterationId: "it5" })).toContain('{ iterationId: "it5" }');
  expect(setFieldMutation("P", "I", by("Estimate"), { number: 3 })).toContain("{ number: 3 }");
  expect(setFieldMutation("P", "I", by("Notes"), { text: 'say "hi"\n' })).toContain('{ text: "say \\"hi\\"\\n" }');
  expect(setFieldMutation("P", "I", by("Notes"), null)).toContain("clearProjectV2ItemFieldValue");
  expect(positionMutation("P", "I", null)).not.toContain("afterId");
  expect(positionMutation("P", "I", "J")).toContain('afterId: "J"');
  expect(archiveMutation("P", "I")).toContain("archiveProjectV2Item");
  expect(addDraftMutation("P", "A title")).toContain('title: "A title"');
  expect(convertMutation("I", "R")).toContain('repositoryId: "R"');
  expect(toggleMutation("I_1", "labels", ["L_a"], [])).toBe('mutation { add: addLabelsToLabelable(input: { labelableId: "I_1", labelIds: ["L_a"] }) { clientMutationId } }');
  expect(toggleMutation("I_1", "assignees", [], ["U"])).toContain("removeAssigneesFromAssignable");
  expect(toggleMutation("I_1", "labels", [], [])).toBeNull();
});

test("initials", () => {
  expect(initials("DwieDave")).toBe("DD");
  expect(initials("lanternmoth")).toBe("LA");
  expect(initials("cg-night")).toBe("CN");
});

// ---- cache

test("boards are cached slim, the last few per repo, and fit the budget", async () => {
  const b = await board();
  const slim = slimBoard(apply(b, { kind: "add", item: { id: "temp-9", values: new Map(), content: { kind: "draft", title: "x", assignees: [], labels: [] } } }));
  expect(slim.items.length).toBe(b.items.length); // edits on their way aren't kept
  expect(JSON.parse(JSON.stringify(slim))).toEqual(slim);
  // What the cache keeps passes its guard and reads back as the board it was (its values a Map again).
  expect(isStoredBoard(JSON.parse(JSON.stringify(slim)))).toBe(true);
  expect(boardOf(JSON.parse(JSON.stringify(slim))).items).toEqual(b.items);
  const repo = { owner: "o", name: "r", full: "o/r", root: "/src", on: null };
  const boards = new Map<string, { at: number }>();
  for (let i = 0; i < LIMITS.boards + 2; i++) boards.set(`P${i}`, { board: slim, at: i } as any);
  const doc = parse(merge("", "/src", { ...entryFor(repo), projects: { list: { projects: [], at: 1 }, boards } }, 100));
  const e: any = doc.repos.get("|o/r");
  expect([...e.projects.boards.keys()].sort()).toEqual(["P2", "P3", "P4"]);
  expect(e.projects.list.at).toBe(1);
  // Old entries without projects stay as they were.
  expect(prune({ v: VERSION, folders: new Map(), repos: new Map([["k", { at: 1, prs: {}, actions: {} }]]) }).repos.get("k")?.projects).toBeUndefined();
  // Over the budget, boards go before the repo does.
  const text = fit(doc, 30000, "|o/r");
  expect(parse(text).repos.get("|o/r")).toBeDefined();
});
