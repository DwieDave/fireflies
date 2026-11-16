// @fireflies/look (docs/plain-look.md): the mods' chrome drawn as the layout
// asks. In a dithered layout (nocturne) each primitive draws exactly what the
// mods draw today: proven here by recording both element trees, the mod's own
// code and the primitive, with the same stand-ins. In a plain one (main,
// herdr-app's look, Developer's concept A) the cards, flat fills, line icons.
// Stand-ins for gpui and herdr (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";

/** An element that records every call, children as their own records. */
type Rec = { readonly kind: string; readonly calls: [string, unknown[]][] };
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && "calls" in v && "kind" in v;
const make = (kind: string) => (...a: unknown[]): any => {
  const rec: Rec = { kind: a.length ? `${kind}(${JSON.stringify(a)})` : kind, calls: [] };
  const el: any = new Proxy(rec, {
    get: (o, k) => (k === "calls" || k === "kind" ? (o as any)[k] : (...args: unknown[]) => {
      // a styling callback (hover, when) runs on a recorder of its own, its calls recorded under it
      const shown = args.map((x) => (typeof x === "function" ? `fn(${String(x).length})` : x));
      o.calls.push([String(k), shown]);
      return el;
    }),
  });
  return el;
};
/** A recorded tree as plain data, for comparing two. */
const tree = (v: unknown): unknown => (isRec(v) ? { kind: v.kind, calls: v.calls.map(([k, a]) => [k, a.map(tree)]) } : Array.isArray(v) ? v.map(tree) : v);

let LAYOUT: unknown = null;
let NAME = "nocturne";
const theme: Record<string, string> = {
  background: "#080808", foreground: "#c6c6c6", input: "#323437", border: "#323437", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D",
  canvas: "#080808", popover: "#080808", raised: "#080808", selected: "#1c1c1c", hover: "#1c1c1c",
};

mock.module("gpui-kit", () => ({ div: make("div"), svg: make("svg"), image: make("image"), PathBuilder: { fill: () => make("path")() }, Background: { checkerboard: (...a: unknown[]) => ({ checker: a }) }, View: class {} }));
mock.module("gpui-base", () => ({ h_flex: make("h_flex"), v_flex: make("v_flex") }));
mock.module("herdr", () => ({
  settings: () => ({ zoom: 0.9, ui_font_family: "Departure Mono" }), window: () => ({ platform: "macos" }), theme: () => theme,
  layout: () => LAYOUT, shared: (k: string) => (k === "layout" ? NAME : null),
}));
(globalThis as any).window = { paint_path: (...a: unknown[]) => make("paint_path")(...a.map((x) => (isRec(x) ? x.kind : x))) };

const fs = await import("node:fs");
const shipped = (n: string) => JSON.parse(fs.readFileSync(`${import.meta.dir}/../defaults/layouts/${n}.json`, "utf8"));
const look = await import("@fireflies/look");
const gitDraw = await import("../defaults/mods/git/draw.ts");
const t: any = theme;

const nocturne = () => { LAYOUT = shipped("nocturne"); NAME = `nocturne-${Math.random()}`; };
const main = () => { LAYOUT = shipped("main"); NAME = `main-${Math.random()}`; };

test("in nocturne panel() is git's lazygit panel, call for call (active and not, with a foot and a right chip)", () => {
  nocturne();
  for (const active of [true, false]) {
    const body = make("div")();
    const title = [make("div")("[2] Files")];
    const right = make("div")("⤢");
    const ours = look.panel(t, "p", title, active, body, { foot: "3 of 7", right });
    const git = gitDraw.panel(t, "p", title, active, body, { foot: "3 of 7", right });
    expect(tree(ours)).toEqual(tree(git));
  }
});

test("in nocturne fill() is the mods' dither, rule() their bars' 2 px strip, lit() their band", () => {
  nocturne();
  expect(tree(look.fill("#323437", 1))).toEqual(tree(gitDraw.dither("#323437", 1)));
  const rule = look.rule(t, "bottom");
  expect(tree(rule)).toEqual(tree(make("div")().absolute().left(0).right(0).bottom(0).h(2).child(gitDraw.dither(look.edge(t), 1))));
  const row = () => make("div")("row");
  expect(tree(look.lit(t, row(), true))).toEqual(tree(row().child(gitDraw.dither(look.edge(t), 1)).child(make("div")().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))));
  // and the dimmer band off focus: git's band()'s two layers (git adds them with .children([...]), the same elements)
  const [band, mark] = gitDraw.band(t, false);
  expect(tree(look.lit(t, row(), false))).toEqual(tree(row().child(band).child(mark)));
});

test("in nocturne the icons are the 1-bit art, the glyphs text, the heads caps, the title bar git's plate", () => {
  nocturne();
  expect(look.icon("moon-6", "git-branch")).toBe("mods/nocturne/art/moon-6.svg");
  expect(look.glyph("✕", "x")).toBe("✕");
  expect(tree(look.heading(t, "runs")).calls).toContainEqual(["child", ["RUNS"]]);
  const bar = tree(look.titleBar(t, { id: "git-head", art: "moon-6", plain: "git-branch", title: "Git" }, [])) as any;
  expect(bar.calls.slice(0, 9).map(([k]: [string]) => k)).toEqual(["id", "relative", "h", "flex_none", "overflow_hidden", "pl", "pr", "gap", "items_center"]);
  expect(JSON.stringify(bar)).toContain("\"GIT\"");
  expect(JSON.stringify(bar)).toContain("mods/nocturne/art/moon-6.svg");
  expect(look.TITLE_BAR).toBe(40);
});

test("in main (herdr's default) a panel is a card: rounded, bordered, its title in a header row, the accent border while focused", () => {
  main();
  const card = tree(look.panel(t, "p", [make("div")("Files")], true, make("div")(), { foot: "7" })) as any;
  const calls = card.calls.map(([k, a]: [string, unknown[]]) => [k, a[0]]);
  expect(calls).toContainEqual(["rounded", 8]);
  expect(calls).toContainEqual(["border_color", t.accent]);
  expect(calls).toContainEqual(["bg", t.background]);
  expect(JSON.stringify(card)).not.toContain("checker");
  const quiet = tree(look.panel(t, "q", [], false, make("div")())) as any;
  expect(quiet.calls).toContainEqual(["border_color", [t.border]]);
});

test("in main fills are flat, rules 1 px lines, the chosen row the selected fill, the veil black at 35%, the icons upstream's line icons", () => {
  main();
  expect(JSON.stringify(tree(look.fill("#323437", 1)))).not.toContain("checker");
  expect(JSON.stringify(tree(look.fill("#323437", 8)))).toContain("checker"); // a picture's transparency stays
  expect((tree(look.rule(t, "top")) as any).calls).toContainEqual(["h", [1]]);
  expect((tree(look.lit(t, make("div")(), true)) as any).calls).toContainEqual(["bg", [t.selected]]);
  expect((tree(look.veil("v")) as any).calls).toContainEqual(["bg", ["#00000059"]]);
  expect(look.icon("moon-6", "git-branch")).toBe("mods/nocturne/plain/git-branch.svg");
  expect(look.icon("moon-8", null)).toBe(null);
  expect(look.titleShown(true)).toBe(false);
  expect(look.titleShown(false)).toBe(true);
  expect(look.radius(6)).toBe(6);
  expect(look.pick(11, 12.5)).toBe(12.5);
});

test("the plain line icons look() names are shipped, with Lucide's license", () => {
  const names = fs.readFileSync(`${import.meta.dir}/../defaults/lib/@fireflies/look/icons.ts`, "utf8").match(/"([a-z0-9-]+)"(?= \||;)/g)?.map((s) => s.slice(1, -1)) ?? [];
  expect(names.length).toBeGreaterThan(25);
  for (const n of names) expect([n, fs.existsSync(`${import.meta.dir}/../defaults/mods/nocturne/plain/${n}.svg`)]).toEqual([n, true]);
  expect(fs.existsSync(`${import.meta.dir}/../defaults/mods/nocturne/plain/LICENSE-lucide.txt`)).toBe(true);
});

test("text widths: the pixel font's 7 px a character at 11 px; Geist proportional", () => {
  expect(look.textWidth("abcdefghij", 11, "Departure Mono")).toBe(70);
  expect(look.textWidth("iiii", 12, "Geist")).toBeLessThan(look.textWidth("mmmm", 12, "Geist"));
});
