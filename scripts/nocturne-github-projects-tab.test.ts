// The Projects tab (projects.js) driven by its keys, as the window drives it:
// herdr and gpui are stand-ins, gh answers from the fixtures and records the
// mutations, so moves, edits, adds, archives and their rollbacks run through
// the tab's real code down to the gh call.
import { test, expect, mock, beforeEach } from "bun:test";

const dir = `${import.meta.dir}/fixtures/nocturne-github-projects`;
const fix = async (f: string) => JSON.parse(await Bun.file(`${dir}/${f}`).text());
const FIX: Record<string, any> = {};
for (const f of ["list.json", "board-1.json", "board-2.json", "detail.json", "choices.json"]) FIX[f] = await fix(f);

// ---- stand-ins

let sharedState: Record<string, unknown> = {};
const gh = { mutations: [] as string[], fail: false, noScope: false, reads: 0 };
const answer = (v: unknown, code = 0) => ({ code, stdout: JSON.stringify(v), stderr: "" });
mock.module("herdr", () => ({
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "linux" }), appHome: () => "/home/me/.config/herdr-app",
  shared: (k: string) => sharedState[k] ?? null,
  setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  exec: async (_cmd: string, args: string[]) => {
    const q = (args.find((a) => a.startsWith("query=")) ?? "").slice(6);
    if (gh.noScope) return answer({ errors: [{ type: "INSUFFICIENT_SCOPES", message: "The 'title' field requires one of the following scopes: ['read:project']" }] }, 1);
    if (q.startsWith("mutation")) {
      gh.mutations.push(q);
      if (gh.fail) return answer({ errors: [{ message: "Something went wrong" }] }, 1);
      if (q.includes("addProjectV2DraftIssue")) return answer({ data: { addProjectV2DraftIssue: { projectItem: { id: "PVTI_real", databaseId: 5, content: { id: "DI_real" } } } } });
      return answer({ data: { ok: true } });
    }
    gh.reads++;
    if (q.includes("assignableUsers")) return answer(FIX["choices.json"]);
    if (q.includes("comments(last")) return answer(FIX["detail.json"]);
    if (q.includes("projectsV2(first")) return answer(FIX["list.json"]);
    if (q.includes("views(first")) return answer(FIX["board-1.json"]);
    if (q.includes("items(first")) return answer(FIX["board-2.json"]);
    return answer({ errors: [{ message: "no fixture" }] }, 1);
  },
}));
// Every element method chains; lists draw their rows so cards are built too.
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { handlers: Record<string, Function> = {}; v = ""; constructor(o: any) { this.v = o?.value ?? ""; } on(e: string, f: Function) { this.handlers[e] = f; return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } fire(e: string) { this.handlers[e]?.({}, cx); } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el,
  v_virtual_list: (_id: string, n: number, _s: unknown, key: (i: number) => string, render: Function) => { for (let i = 0; i < n; i++) key(i); render({ start: 0, end: n }, cx); return el; },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el }, TextView: { markdown: () => el },
}));
globalThis.window = { paint_path: () => el } as any;

const work: Promise<unknown>[] = [];
const cx: any = { spawn: (f: Function) => { work.push(Promise.resolve(f(cx))); }, notify() {}, stop_propagation() {} };
const settle = async () => { while (work.length) await work.shift(); };

const { default: Projects } = await import("../defaults/mods/nocturne-github/projects.js");
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

function makeApp() {
  return {
    repo: { owner: "DwieDave", name: "fireflies", full: "DwieDave/fireflies", host: "github.com", root: "/src", on: null, parent: "herdrdev/herdr-app" },
    note: null as any, next: Infinity, asked: null as any, opened: null as any,
    focusSelf() {}, refresh() {}, spawn(c: any, fn: Function) { c.spawn(async () => { try { await fn(); } catch {} }); },
    ask(text: string, go: Function) { this.asked = { text, go }; }, openUrl(url: string) { this.opened = url; },
  };
}

async function open() {
  const app = makeApp();
  const tab = new Projects(app, {});
  await tab.poll({ all: true }, cx);
  return { app, tab };
}
const press = (tab: any, ...keys: string[]) => { for (const k of keys) tab.key(k, { modifiers: {} }, cx); };
const column = (tab: any, name: string) => tab.lay().columns.find((c: any) => c.name === name).items.map((i: any) => i.content.number ?? i.content.title);
const drawn = (tab: any) => tab.render(theme, { width: 1400, height: 800 });

beforeEach(() => { sharedState = {}; gh.mutations = []; gh.fail = false; gh.noScope = false; gh.reads = 0; work.length = 0; });

test("opening reads the projects, picks the repo's, reads every page and draws", async () => {
  const { tab } = await open();
  expect(tab.pick).toBe("PVT_kwHOAAAAAc4A0001");
  expect(tab.board().items.length).toBe(15);
  expect(tab.view().name).toBe("Board");
  expect(() => drawn(tab)).not.toThrow();
  // The selection starts on the first card of the first column.
  expect(tab.current().content.title).toBe("Untriaged idea");
});

test("h j k l walk the board", async () => {
  const { tab } = await open();
  press(tab, "l", "l"); // Ready
  expect(tab.current().content.number).toBe(240);
  press(tab, "j");
  expect(tab.current().content.number).toBe(212);
  press(tab, "right");
  expect(tab.current().content.number).toBe(219); // In progress keeps the height: its second card
  press(tab, "k", "h");
  expect(tab.current().content.number).toBe(240);
});

test("m carries a card across and drops it: shown at once, sent, kept", async () => {
  const { tab, app } = await open();
  press(tab, "l", "l", "j"); // #212 in Ready
  press(tab, "m", "l", "k"); // carry it to the top of In progress
  expect(column(tab, "In progress")).toEqual([226, 219]); // not moved until dropped (the read)
  expect(tab.grid(tab.lay())[3].map((i: any) => i.content.number)).toEqual([212, 226, 219]); // but drawn there while carried
  expect(() => drawn(tab)).not.toThrow();
  press(tab, "enter");
  expect(column(tab, "In progress")).toEqual([212, 226, 219]);
  expect(column(tab, "Ready")).not.toContain(212);
  await settle();
  expect(gh.mutations.length).toBe(2);
  expect(gh.mutations[0]).toContain('singleSelectOptionId: "o_prog"');
  expect(gh.mutations[1]).toContain("updateProjectV2ItemPosition");
  expect(gh.mutations[1]).not.toContain("afterId");
  expect(app.note.text).toBe("Moved #212 to In progress");
  expect(tab.current().content.number).toBe(212);
});

test("a refused move rolls back and says why", async () => {
  const { tab, app } = await open();
  gh.fail = true;
  press(tab, "l", "l", "j", "space", "l", "enter");
  expect(column(tab, "In progress")).toContain(212);
  await settle();
  expect(column(tab, "In progress")).toEqual([226, 219]);
  expect(column(tab, "Ready")).toContain(212);
  expect(app.note.tone).toBe("failed");
  expect(app.note.text).toContain("Something went wrong");
});

test("esc puts a carried card back; nothing is sent", async () => {
  const { tab } = await open();
  press(tab, "l", "l", "m", "l", "l", "escape");
  expect(tab.carrying).toBeNull();
  expect(column(tab, "Ready")[0]).toBe(240);
  await settle();
  expect(gh.mutations).toEqual([]);
});

test("reordering inside a column sends only the position", async () => {
  const { tab } = await open();
  press(tab, "l", "l", "m", "j", "enter"); // #240 below #212
  expect(column(tab, "Ready").slice(0, 2)).toEqual([212, 240]);
  await settle();
  expect(gh.mutations.length).toBe(1);
  expect(gh.mutations[0]).toContain('afterId: "PVTI_005"');
});

test("e edits a field through the menu", async () => {
  const { tab, app } = await open();
  press(tab, "l", "l"); // #240
  press(tab, "e");
  expect(tab.menu.kind).toBe("fields");
  expect(() => drawn(tab)).not.toThrow();
  const names = tab.menu.fields.map((id: string) => tab.board().fields.find((f: any) => f.id === id).name);
  for (let i = 0; i < names.indexOf("Priority"); i++) press(tab, "j");
  press(tab, "l"); // its values, on the current one (P2)
  press(tab, "k", "enter"); // P1
  expect(tab.board().items.find((i: any) => i.content.number === 240).values.F_prio.name).toBe("P1");
  await settle();
  expect(gh.mutations[0]).toContain('singleSelectOptionId: "p1"');
  expect(app.note.text).toBe("Priority: P1");
  press(tab, "escape");
  expect(tab.menu).toBeNull();
});

test("e on a text field asks for the value; labels toggle", async () => {
  const { tab } = await open();
  press(tab, "l", "l", "l"); // In progress, #226
  press(tab, "e");
  const ids = tab.menu.fields;
  const at = (n: string) => ids.findIndex((id: string) => tab.board().fields.find((f: any) => f.id === id).name === n);
  for (let i = 0; i < at("Estimate"); i++) press(tab, "j");
  press(tab, "l", "enter");
  expect(tab.typing).toBe("value");
  tab.valueInput.set_value("8");
  tab.valueInput.fire("submit");
  expect(tab.board().items.find((i: any) => i.content.number === 226).values.F_est).toEqual({ number: 8 });
  await settle();
  expect(gh.mutations.at(-1)).toContain("{ number: 8 }");
  // Labels: the repo's labels, bug is on; enter takes it off.
  press(tab, "h");
  while (tab.menu.at > at("Labels")) press(tab, "k");
  while (tab.menu.at < at("Labels")) press(tab, "j");
  await settle(); // the repo's labels were read
  press(tab, "l");
  const opts = tab.options(tab.board(), tab.current(), tab.board().fields.find((f: any) => f.name === "Labels"));
  tab.menu.opt = opts.findIndex((o: any) => o.label === "bug");
  press(tab, "enter");
  expect(tab.current().content.labels.map((l: any) => l.name)).toEqual(["sidebar"]);
  await settle();
  expect(gh.mutations.at(-1)).toContain('removeLabelsFromLabelable(input: { labelableId: "I_226", labelIds: ["L_bug"] })');
});

test("a adds a draft to the column, then it becomes the real item", async () => {
  const { tab } = await open();
  press(tab, "l", "l", "a");
  expect(tab.typing).toBe("draft");
  tab.draft.set_value("Write the docs");
  tab.draft.fire("submit");
  expect(column(tab, "Ready")).toContain("Write the docs");
  expect(String(tab.sel)).toStartWith("temp-");
  await settle();
  expect(gh.mutations[0]).toContain('addProjectV2DraftIssue(input: { projectId: "PVT_kwHOAAAAAc4A0001", title: "Write the docs" })');
  expect(gh.mutations[1]).toContain('itemId: "PVTI_real"');
  expect(gh.mutations[1]).toContain("o_ready");
  expect(tab.sel).toBe("PVTI_real");
});

test("x asks, then archives", async () => {
  const { tab, app } = await open();
  press(tab, "l", "l", "x");
  expect(app.asked.text).toContain("Archive #240");
  expect(column(tab, "Ready")).toContain(240);
  app.asked.go();
  expect(column(tab, "Ready")).not.toContain(240);
  expect(tab.current().content.number).toBe(212);
  await settle();
  expect(gh.mutations[0]).toContain("archiveProjectV2Item");
});

test("i makes a draft an issue in a repo picked from the menu", async () => {
  const { tab } = await open();
  press(tab, "i"); // the No Status draft
  expect(tab.menu.title).toContain("Untriaged idea");
  expect(tab.menu.rows.map((r: any) => r.label)).toEqual(["DwieDave/fireflies", "herdrdev/herdr-core"]);
  press(tab, "enter");
  await settle();
  expect(gh.mutations[0]).toContain('convertProjectV2DraftIssueItemToIssue(input: { itemId: "PVTI_015", repositoryId: "R_fireflies" })');
});

test("the filter narrows the board; esc clears it", async () => {
  const { tab } = await open();
  press(tab, "/");
  expect(tab.typing).toBe("filter");
  tab.filter.set_value("label:bug");
  tab.filter.fire("change");
  expect(tab.lay().shown).toBe(4);
  tab.filter.fire("submit");
  expect(tab.typing).toBeNull();
  expect(() => drawn(tab)).not.toThrow();
  press(tab, "escape");
  expect(tab.lay().shown).toBe(15);
});

test("v switches views (swimlanes) and p projects; both are remembered", async () => {
  const { tab } = await open();
  press(tab, "v");
  expect(tab.menu.rows.map((r: any) => r.label)).toEqual(["Board", "By sprint", "Bugs", "Everything"]);
  press(tab, "j", "enter");
  expect(tab.view().name).toBe("By sprint");
  expect(tab.lay().lane.name).toBe("Sprint");
  expect(() => drawn(tab)).not.toThrow();
  expect((sharedState["nocturne-github.boards"] as any).projects.PVT_kwHOAAAAAc4A0001.view).toBe("V_sprint");
  press(tab, "p");
  expect(tab.menu.rows.map((r: any) => r.label)).toEqual(["Fireflies roadmap", "Herdr 2", "Reading list", "Old ideas"]);
  press(tab, "j", "enter");
  expect(tab.pick).toBe("PVT_kwDOBBBBBc4B0001");
  expect((sharedState["nocturne-github.boards"] as any).repos["|DwieDave/fireflies"]).toBe("PVT_kwDOBBBBBc4B0001");
});

test("- folds a column, w sets its limit, z folds a lane", async () => {
  const { tab } = await open();
  press(tab, "l", "l", "-");
  expect(tab.lay().columns.find((c: any) => c.name === "Ready").folded).toBe(true);
  expect(tab.current().content.number).toBe(226); // moved off the folded column
  press(tab, "w");
  tab.valueInput.set_value("1");
  tab.valueInput.fire("submit");
  expect(tab.lay().columns.find((c: any) => c.name === "In progress").limit).toBe(1);
  expect(() => drawn(tab)).not.toThrow();
  tab.setView("V_sprint");
  const lanes = () => tab.lay().lanes.filter((l: any) => l.folded).map((l: any) => l.name);
  press(tab, "z");
  expect(lanes()).toEqual(["Sprint 4"]);
});

test("enter docks the detail, reads its body; o opens on GitHub", async () => {
  const { tab, app } = await open();
  press(tab, "l", "l", "l", "enter");
  expect(tab.detailOpen).toBe(true);
  await settle();
  expect(tab.details.get("I_226").d.comments.length).toBe(2);
  expect(() => drawn(tab)).not.toThrow();
  press(tab, "enter");
  expect(tab.focus).toBe("detail");
  press(tab, "o");
  expect(app.opened).toBe("https://github.com/DwieDave/fireflies/issues/226");
  press(tab, "escape");
  expect(tab.detailOpen).toBe(false);
  press(tab, "h", "h", "h", "o"); // the draft: the project's item pane
  expect(app.opened).toBe("https://github.com/users/DwieDave/projects/3/views/1?pane=issue&itemId=9015");
});

test("a token without the project scope gets the command that fixes it", async () => {
  gh.noScope = true;
  const app = makeApp();
  const tab = new Projects(app, {});
  await tab.poll({ all: true }, cx);
  expect(tab.scope.command).toBe("gh auth refresh -s read:project");
  expect(() => drawn(tab)).not.toThrow();
});

test("a mutation refused for scope says to grant project", async () => {
  const { tab, app } = await open();
  gh.noScope = true;
  press(tab, "x");
  app.asked.go();
  await settle();
  expect(app.note.text).toContain("gh auth refresh -s project");
  expect(tab.board().items.length).toBe(15);
});

test("what's cached comes back on the next opening, edits on their way don't", async () => {
  const { tab } = await open();
  gh.fail = false;
  press(tab, "a"); tab.draft.set_value("temp one"); tab.draft.fire("submit");
  const snap = JSON.parse(JSON.stringify(tab.snapshot()));
  await settle();
  const again = new Projects(makeApp(), {});
  again.hydrate(snap);
  expect(again.pick).toBe(null); // nothing remembered yet: the list's first is picked
  again.pick = "PVT_kwHOAAAAAc4A0001";
  expect(again.board().items.length).toBe(15);
  expect(again.list.projects.length).toBe(4);
  expect(() => drawn(again)).not.toThrow();
});
