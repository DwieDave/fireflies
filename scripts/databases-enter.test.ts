// Enter opens a table in the Databases window from every state where a click
// or a double click on its row opens it (Developer's report: "DB: Cant
// enter/view tables on enter often clicking/double clicking works"). The keys
// reach the view the way GPUI hands them out: only while the view's own focus
// handle, or an input it draws, has the keyboard; an input that is no longer
// drawn leaves the keyboard nowhere. Each test drives the view as a person
// does: keys through that model, clicks through the handlers its rows draw.
// Its own process: it stands in for "herdr", "gpui-kit" and "gpui-base".
import { test, expect } from "bun:test";
import { standIn } from "./databases-host.ts";

/** Whatever has the keyboard: the view's handle, an input or the SQL editor. */
let focusNow: unknown = null;
/** The inputs and editors the last render drew (a focused one not among them has lost the keyboard). */
let drawnInputs = new Set<unknown>();

function focusTo(next: unknown): void {
  const was = focusNow;

  if (was === next) return;

  focusNow = next;
  (was as { fire?: (ev: string) => void } | null)?.fire?.("blur");
  (next as { fire?: (ev: string) => void } | null)?.fire?.("focus");
}

const { h, el, cx, until, flush, services } = standIn({
  get Input() { return Input; }, get Editor() { return Editor; }, drawnInput: (state) => { drawnInputs.add(state); },
  focusHandle: () => { const handle = { focus() { focusTo(handle); }, is_focused: () => focusNow === handle, release: () => true }; return handle; },
});
const { execs } = h;
h.platform = "macos";

class Input {
  v = ""; masked = false; on_: Record<string, (() => void)[]> = {};
  constructor(o: any = {}) { this.v = o.value ?? ""; }
  on(ev: string, f: () => void) { (this.on_[ev] ??= []).push(f); return true; }
  fire(ev: string) { for (const f of this.on_[ev] ?? []) f(); }
  value() { return this.v; } set_value(v: string) { this.v = v; } set_masked(m: boolean) { this.masked = m; }
  focus() { focusTo(this); } release() { return true; }
}
class Editor {
  text: string; caret = { line: 0, col: 0 };
  constructor(o: any) { this.text = o.value ?? ""; }
  value() { return this.text; } set_value(v: string) { this.text = v; } on() { return true; }
  cursor() { return this.caret; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  selection() { return { start: this.caret, end: this.caret, text: "" }; } set_diagnostics() {} edit() {}
  focus() { focusTo(this); } focused() { return focusNow === this; } release() { return true; }
}
const { default: Databases } = await import("../defaults/mods/databases/main.ts");
(await import("../defaults/mods/databases/app.ts")).useServices(services);
const { runtime: dbRuntime } = await import("../defaults/mods/databases/app.ts");
const { viewRun } = await import("./databases-host.ts");
const runView = viewRun(dbRuntime);
const { command } = await import("../defaults/mods/databases/opening.ts");


const PG = { id: "pg-1", name: "lantern-dev", kind: "postgres", host: "db", user: "ada", database: "lantern", readonly: false, secret: "ask", origin: "saved" };
const table = (name: string, schema = "public", type = "table") => ({ schema, name, type, rows: 3 });
const TABLES = [table("accounts"), table("lanterns"), table("moths"), table("wicks", "audit"), table("glow", "public", "view")];

/** A window connected to PG with the tables listed, the keyboard on [2]. */
async function connected(): Promise<any> {
  focusNow = null;
  const v: any = new Databases();

  v.init({ folder: "/w", overlay: "w1" }, cx);
  await flush();
  v.saved = [PG];
  v.active = PG;
  v.catalog = { tables: TABLES.map((t) => ({ ...t })), error: null, busy: false };
  v.panel = "tables";
  v.tablesTab = "tables";
  v.tableAt = 0;
  v.focusSelf();

  return v;
}

function render(v: any): [string, any[]][] {
  v.size = { width: 1100, height: 720 };
  h.drawn = [];
  drawnInputs = new Set();
  v.render();

  return h.drawn;
}

/** A key as GPUI hands it out: to the view only while it (or an input it draws) has the keyboard.
 *  False: the key went nowhere. */
function press(v: any, k: string, mods: any = {}): boolean {
  render(v);

  const h = v.handle;

  if (focusNow !== h && !drawnInputs.has(focusNow)) return false;

  v.key({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods }, cx);

  return true;
}

/** A left click (count 1 or 2) on what the last render drew with `id`. */
function click(v: any, id: string, count = 1): void {
  const d = render(v);
  const at = d.findIndex(([m, a]) => m === "id" && a[0] === id);

  expect(at).toBeGreaterThanOrEqual(0);

  const down = d.slice(at).find(([m, a]) => m === "on_mouse_down" && a[0] === "left");

  // A double click is two presses (the first picks the row, the second opens it).
  for (let n = 1; n <= count; n++) down?.[1][1]({ click_count: n, position: { x: 10, y: 10 }, modifiers: {} }, cx);
  // The release: a press that never moved is a click (press.ts).
  v.press = null;
}

/** A chip's click (kit.ts chip: its on_click), or a click on a dialog's dim layer beside its box
 *  (popups.ts dimLayer: its left on_mouse_down). */
function chipClick(v: any, id: string): void {
  const d = render(v);
  const at = d.findIndex(([m, a]) => m === "id" && a[0] === id);

  expect(at).toBeGreaterThanOrEqual(0);

  const chip = id.endsWith("-ok") || id.endsWith("-no");
  const on = d.slice(at).find(([m, a]) => (chip ? m === "on_click" : m === "on_mouse_down" && a[0] === "left"));

  on?.[1].at(-1)({ click_count: 1, position: { x: 10, y: 10 }, modifiers: {} }, cx);
}

const opened = (v: any): string | null => v.rows.browse?.table.name ?? null;

test("the plain case: enter on the cursor's table opens it, as a double click does", async () => {
  const v = await connected();

  press(v, "j");
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("lanterns");

  const w = await connected();

  click(w, "table-2", 2);
  expect(opened(w)).toBe("moths");
});

test("the find line left by enter: the next enter opens the cursor's table (it was swallowed)", async () => {
  const v = await connected();

  press(v, "/");
  expect(v.findTyping).toBe(true);
  v.tableFind.set_value("moth");
  // Enter in the find: the find stays (filtered), the keyboard goes to the list and the match opens.
  press(v, "enter");
  expect(v.findTyping).toBe(false);
  expect(v.tableFind).not.toBe(null);
  expect(opened(v)).toBe("moths");

  v.rows.browse = null;
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("moths");
});

test("the find line left by ↓: enter opens the row the cursor moved to", async () => {
  const v = await connected();

  press(v, "/");
  v.tableFind.set_value("s");
  press(v, "down");
  expect(v.findTyping).toBe(false);
  press(v, "j");
  // accounts, lanterns, moths, wicks match "s": ↓ moved to lanterns, j to moths.
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("moths");
});

test("the find line open, a click on a row: enter opens that row (as its double click does)", async () => {
  const v = await connected();

  press(v, "/");
  v.tableFind.set_value("s");
  click(v, "table-1");
  expect(v.findTyping).toBe(false);
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("lanterns");
});

test("enter while typing in the find opens the first match; esc still closes the find", async () => {
  const v = await connected();

  press(v, "/");
  v.tableFind.set_value("wick");
  press(v, "enter");
  expect(opened(v)).toBe("wicks");

  press(v, "escape");
  expect(v.tableFind).toBe(null);
});

test("the password asked before connecting, given by enter: enter on a table opens it after", async () => {
  const v = await connected();

  v.active = null;
  v.askPassword(PG, false, () => {
    v.active = PG;
    v.catalog = { tables: TABLES.map((t) => ({ ...t })), error: null, busy: false };
    v.panel = "tables";
  });
  expect(press(v, "enter")).toBe(true);
  expect(v.password).toBe(null);
  expect(press(v, "j")).toBe(true);
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("lanterns");
});

test("the password given by its connect chip: enter on a table opens it after", async () => {
  const v = await connected();

  v.askPassword(PG, false, () => { v.panel = "tables"; });
  chipClick(v, "db-pw-ok");
  expect(v.password).toBe(null);
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("accounts");
});

test("the password's cancel chip or a click beside the box: the keyboard comes back to the view", async () => {
  for (const close of ["db-pw-no", "db-password"]) {
    const v = await connected();

    v.askPassword(PG, false);
    chipClick(v, close);
    expect(v.password).toBe(null);
    expect(press(v, "enter")).toBe(true);
    expect(opened(v)).toBe("accounts");
  }
});

test("a query tab's rename left by its chips or a click beside it: the keyboard comes back", async () => {
  for (const close of ["db-rename-no", "db-rename-ok", "db-rename"]) {
    const v = await connected();
    const { startRename } = await import("../defaults/mods/databases/menus.ts");
    const q = v.addQuery("select 1;");

    v.panel = "tables";
    v.mainTab = 0;
    startRename(v, q);
    chipClick(v, close);
    expect(v.rename).toBe(null);
    expect(press(v, "enter")).toBe(true);
    expect(opened(v)).toBe("accounts");
  }
});

test("a destructive ask's second step left by its chip: the keyboard comes back", async () => {
  const v = await connected();
  const { InputState } = await import("gpui-base");
  const input = InputState.new({});

  v.ask = { verdict: { risk: "destructive", target: "moths" }, text: "drop moths", step: 2, input, go: () => {} };
  input.focus();
  chipClick(v, "db-ask-no");
  expect(v.ask).toBe(null);
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("accounts");
});

test("a cell being edited, then a click on a table in [2]: enter opens the table (the edit is kept)", async () => {
  const v = await connected();
  const { InputState } = await import("gpui-base");
  const input = InputState.new({ value: "x" });

  v.cellEdit = { row: 0, col: 0, column: "name", input, isNull: false };
  v.panel = "main";
  input.focus();
  click(v, "table-2");
  expect(v.panel).toBe("tables");
  // The press itself settles the edit: its input goes with the click.
  expect(v.cellEdit).toBe(null);
  // The click moved the keyboard to [2]: enter is the table's, not the cell's (no rows here to
  // stage it on: the edit that can't be kept is dropped, as reading the rows again does).
  expect(press(v, "enter")).toBe(true);
  expect(v.cellEdit).toBe(null);
  expect(opened(v)).toBe("moths");
});

test("a cell being edited, then [2] given the keyboard by a command: enter opens the table", async () => {
  const v = await connected();
  const { InputState } = await import("gpui-base");
  const input = InputState.new({ value: "x" });

  v.cellEdit = { row: 0, col: 0, column: "name", input, isNull: false };
  v.panel = "main";
  input.focus();
  command(v, "databases.panel-tables", cx);
  expect(v.panel).toBe("tables");
  expect(press(v, "j")).toBe(true);
  expect(v.cellEdit).toBe(null);
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("lanterns");
});

test("databases.table:<name> under a picked schema or a find: the cursor is on the table it opened", async () => {
  const v = await connected();

  v.schema = "audit";
  command(v, "databases.table:audit.wicks", cx);
  expect(opened(v)).toBe("wicks");
  v.rows.browse = null;
  press(v, "enter");
  expect(opened(v)).toBe("wicks");

  const w = await connected();

  w.schema = "public";
  command(w, "databases.table:glow", cx);
  expect(w.tablesTab).toBe("views");
  w.rows.browse = null;
  press(w, "enter");
  expect(opened(w)).toBe("glow");
});

test("the list read again with fewer tables: enter opens the last row the cursor now stands on", async () => {
  const v = await connected();

  v.tableAt = 3;
  v.catalog = { tables: TABLES.slice(0, 2).map((t) => ({ ...t })), error: null, busy: false };
  expect(press(v, "enter")).toBe(true);
  expect(opened(v)).toBe("lanterns");
});
