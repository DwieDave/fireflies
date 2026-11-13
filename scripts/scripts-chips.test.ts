// The script runner's run rows (scripts main.js runChips): Developer:
// "the watch re-run and delete ui is a bit too small and hard to use". Each
// control is a chip (its mark and its key) on the cursor's row and the hovered
// one: watch (w), again (R) and, set apart, remove (x) or stop (x) while it
// runs. Ending a running one (stop, again) asks first. Every chip's click and
// key, and the row's widths in the deck. Stand-ins for gpui and herdr
// (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { find, texts, theme, cx as mkcx } from "./dialog-stubs.ts";

const st: any = {};
mock.module("herdr", () => ({
  props: () => st.props, theme: () => theme, settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "macos" }),
  shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; },
  run: (name: string, args?: any) => { st.runs.push([name, args]); return null; },
  closeOverlay: (id: unknown) => { st.closed.push(id); }, openOverlay: () => "o9", notify: () => null,
  keys: () => [], spaces: () => [], panes: () => [], terminals: () => st.terms, agents: () => [], focused: () => null,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/h", appHome: () => "/tmp/none", exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  nextCommand: () => new Promise(() => {}), readTextFile: async () => null, writeTextFile: async () => null, layout: () => null,
}));

const term = (address: string, name: string, live: boolean, extra: any = {}) => ({
  address, state: live ? "running" : "finished", exit_code: live ? undefined : 0, created_ms: Date.now() - 15000, finished_ms: live ? null : Date.now(),
  labels: { "nocturne.script": `nix:${name}`, "nocturne.script.name": name, "nocturne.script.runner": "nix", "nocturne.script.cmd": `run ${name}`, "nocturne.script.folder": "/src" }, ...extra,
});
beforeEach(() => {
  Object.assign(st, { shared: {}, runs: [], closed: [], props: { overlay: "d1" },
    terms: [term("t1", "build", true), term("t2", "switch homelab", false)] });
});

const deck = await import("../defaults/mods/scripts/main.js");
const { default: Deck, CHIP, CHIPS_W, ASK_MS } = deck;
const { JOBS } = await import("../defaults/mods/scripts/runs.js");

function open() {
  const d: any = new Deck();
  const c = mkcx();
  c.timer = { after() {}, every() {} };
  d.init({}, c);
  d.scripts = [];
  d.looking = false;
  const draw = () => d.render();
  draw();
  return { d, c, draw };
}
const k = (name: string, mods: any = {}) => ({ key: name, key_char: name.length === 1 ? name : null, modifiers: { shift: false, control: false, platform: false, alt: false, ...mods } });
const press = (o: any, name: string, mods: any = {}) => { o.draw(); o.d.onKey(k(name, mods), o.c, o.d.items); };
const click = (o: any, id: string) => { const el: any = find(o.draw(), id); expect(el).toBeDefined(); el.calls.on_click[0]({}, o.c); };
const jobs = () => (st.shared[JOBS] ?? []).map((j: any) => j.steps.map((s: any) => s.hc[0]).join("+"));

// ---- the chips

test("the cursor's row shows three chips: watch, again, and set apart stop (a running one)", () => {
  const o = open();
  o.d.cursor = 0; // t1, running
  const r = o.draw();
  for (const id of ["w-0", "a-0", "s-0"]) {
    const chip: any = find(r, id);
    expect(chip.calls.h?.[0]).toBe(CHIP);
    expect(chip.calls.border?.[0]).toBe(1); // a frame: a target, not a bare glyph
    expect(chip.calls.tooltip?.[0]).toBeTruthy();
  }
  expect(texts(find(r, "w-0"))).toContain("w");
  expect(texts(find(r, "a-0"))).toContain("R");
  expect(texts(find(r, "s-0"))).toContain("x");
  // stop comes after a rule: set apart from the other two
  const chips: any = find(r, "chips-0");
  const ids = chips.nodes.map((n: any) => n?.calls?.id?.[0] ?? (n?.calls?.w?.[0] === 1 ? "rule" : "?"));
  expect(ids).toEqual(["w-0", "a-0", "rule", "s-0"]);
  // the other row shows none and keeps its whole room for its name
  expect(find(r, "chips-1")).toBeUndefined();
  expect(find(r, "d-1")).toBeUndefined();
});

test("an ended run's last chip is remove; a hovered row shows its chips too", () => {
  const o = open();
  o.d.cursor = 0;
  let r: any = o.draw();
  find(r, "run-1")!.calls.on_hover[0](true, o.c);
  r = o.draw();
  expect(find(r, "d-1")).toBeDefined();
  expect(texts(find(r, "d-1"))).toContain("x");
  expect(find(r, "chips-1")!.calls.max_w?.[0]).toBe(CHIPS_W);
});

test("watch: a running one floats its terminal (click and w); an ended one shows its output", () => {
  let o = open();
  o.d.cursor = 0;
  click(o, "w-0");
  expect(st.runs).toEqual([["terminal.peek", { terminal: "t1", float: true }]]);
  o = open(); o.d.cursor = 0;
  press(o, "w");
  expect(st.runs.at(-1)).toEqual(["terminal.peek", { terminal: "t1", float: true }]);
  o = open(); o.d.cursor = 1;
  click(o, "w-1");
  expect(o.d.output?.r?.address).toBe("t2");
});

test("remove: an ended run goes at once (click, x, cmd-⌫)", () => {
  for (const how of ["click", "x", "cmd-backspace"]) {
    st.shared = {};
    const o = open();
    o.d.cursor = 1;
    if (how === "click") click(o, "d-1");
    else if (how === "x") press(o, "x");
    else press(o, "backspace", { platform: true });
    expect(jobs()).toEqual(["rm"]);
  }
});

test("stop asks first: the chip says stop?, a second press stops it (click or x), another run's press doesn't count", () => {
  for (const how of ["click", "x", "cmd-backspace"]) {
    st.shared = {};
    const o = open();
    o.d.cursor = 0;
    const go = () => (how === "click" ? click(o, "s-0") : how === "x" ? press(o, "x") : press(o, "backspace", { platform: true }));
    go();
    expect(jobs()).toEqual([]);
    const r: any = o.draw();
    expect(texts(find(r, "s-0"))).toContain("stop?");
    expect(texts(r).join(" ")).toContain("x: stop it"); // the key bar says what the second press does
    go();
    expect(jobs()).toEqual(["kill"]);
  }
});

test("the question lapses after ASK_MS: a late second press asks again", () => {
  const real = Date.now;
  try {
    let now = real();
    Date.now = () => now;
    const o = open();
    o.d.cursor = 0;
    press(o, "x");
    now += ASK_MS + 1;
    press(o, "x");
    expect(jobs()).toEqual([]);
    expect(texts(find(o.draw(), "s-0"))).toContain("stop?");
    press(o, "x");
    expect(jobs()).toEqual(["kill"]);
  } finally { Date.now = real; }
});

test("again: an ended run starts again at once (click, R, cmd-r); a running one asks, as it's stopped first", () => {
  for (const how of ["click", "R", "cmd-r"]) {
    st.shared = {};
    const o = open();
    o.d.cursor = 1;
    if (how === "click") click(o, "a-1");
    else if (how === "R") press(o, "r", { shift: true });
    else press(o, "r", { platform: true });
    expect(jobs()).toEqual(["rm+run"]);
  }
  st.shared = {};
  const o = open();
  o.d.cursor = 0;
  press(o, "r", { shift: true });
  expect(jobs()).toEqual([]);
  expect(texts(find(o.draw(), "a-0"))).toContain("again?");
  press(o, "r", { shift: true });
  expect(jobs()).toEqual(["kill+rm+run"]);
});

test("the ? list and the key bar name the chips' keys: w, x (remove · stop twice), R", () => {
  const list = deck.deckKeys("⌘").map(([a, b]: string[]) => `${a} ${b}`).join("\n");
  expect(list).toMatch(/^w watch/m);
  expect(list).toMatch(/^x ⌘⌫ remove an ended run · stop a running one \(twice\)/m);
  expect(list).toMatch(/^R ⌘R run it again/m);
  const o = open();
  o.d.cursor = 1;
  const bar = texts(o.draw()).join(" ");
  expect(bar).toContain("remove");
  expect(bar).toContain("again");
});

// ---- the row's layout in the deck (420 px, fixed)

test("in the 420 px deck: the chips fit their room, the status and time keep their columns, the names keep room", () => {
  const W = 420, PAD = 12, GAP = 6, PIP = 8, WORD = 58, TIME = 46, BADGE = 30, LOCK = 9;
  // Departure Mono's advance, measured in the scratch app's shot: 0.63 em
  const ch = (n: number, size: number) => n * size * 0.63;
  const chip = (asking?: string) => 2 + 10 + (asking ? ch(asking.length, 10) : 11 + 4 + ch(1, 10));
  const rule = 1 + 8;
  const plain = chip() + 4 + chip() + 4 + rule + 4 + chip();
  const worst = Math.max(chip() + 4 + chip("again?") + 4 + rule + 4 + chip(), chip() + 4 + chip() + 4 + rule + 4 + chip("stop?"));
  expect(worst).toBeLessThanOrEqual(CHIPS_W);
  const room = W - 2 - 2 * PAD - PIP - WORD - TIME;
  // Developer's run ("switch homelab", its lock) whole on the row showing its chips (they take the badge's place)
  expect(room - plain - 4 * GAP).toBeGreaterThanOrEqual(ch("switch homelab".length, 12) + GAP + LOCK);
  // rows without chips: their name has the room the badge leaves
  expect(room - BADGE - 4 * GAP).toBeGreaterThanOrEqual(ch(28, 12));
  // the status and time columns: fixed widths, last in every row, chips or not
  const o = open();
  o.d.cursor = 0;
  const r: any = o.draw();
  for (const id of ["run-0", "run-1"]) {
    const kids = find(r, id)!.nodes.filter((n: any) => n?.calls);
    const [word, time] = kids.slice(-2);
    expect([word.calls.w?.[0], time.calls.w?.[0]]).toEqual([WORD, TIME]);
    expect(word.calls.flex_none && time.calls.flex_none).toBeDefined();
  }
  // the chips sit before them, where the badge was
  const row0 = find(r, "run-0")!.nodes.filter((n: any) => n?.calls).map((n: any) => n.calls.id?.[0] ?? "");
  expect(row0.indexOf("chips-0")).toBe(row0.length - 3);
});
