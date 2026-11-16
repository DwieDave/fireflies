// The fork's mods follow the theme a person picks (defaults/AGENTS.md, "Your
// own theme reaches the mods"): they draw with theme() colors by name, the
// edge tone (tones.ts) where the theme names none, and no color of their own,
// so moonfly, paper or a person's themes/<name>.json reach every surface.
// These fail when a converted mod gains a color literal, draws a UI tone with
// a terminal slot (ansi0, ansi8: they equal border and muted only in moonfly),
// or a mod carries a copy of tones.ts again (it's the @fireflies/tones library).
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NOCTURNE_MODS } from "./nocturne-mods.ts";
import { edge, over, tone } from "@fireflies/tones";
import { importLibrary } from "./mod-source.ts";

const MODS = `${import.meta.dir}/../defaults/mods`;
const LIB = `${import.meta.dir}/../defaults/lib/@fireflies`;
const CONVERTED = ["nocturne", ...NOCTURNE_MODS];

/** Literals a converted mod may keep, file by file: art and what is the same in every theme. */
const ALLOWED: Record<string, readonly string[]> = {
  // the veil under an in-window popup: black dims under any theme, as the layout's scrim does
  "databases/kit.ts": ["#0000008c"],
  "github/kit.ts": ["#0000008c"],
  "git/draw.ts": ["#0000008c"],
  // letterbox black behind the native video
  "pip/main.ts": ["#000000"],
  // a PDF page's paper
  "preview/viewer-views.ts": ["#ffffff"],
  "editor/viewer-views.ts": ["#ffffff"],
  "file-tree/viewer-views.ts": ["#ffffff"],
};

/** Art that brings its own colors (the rest of the art is one color, tinted by text_color). */
const ART = ["nocturne/art/fireflies.svg"];

/** Files under a mod's folder, by path from defaults/mods. */
function files(dir: string): string[] {
  return readdirSync(join(MODS, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(MODS, rel)).isDirectory() ? files(rel) : [rel];
  });
}

const sources = CONVERTED.flatMap((m) => files(m)).filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"));

/** A source without its comments (a comment may name the hex a tone lands on). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|["'`]#[0-9a-fA-F]{3}["'`]|\b(?:rgba?|hsla?)\(/g;

test("a converted mod has no color literal of its own (ALLOWED: art and what every theme shares)", () => {
  const found = sources.flatMap((f) => [...code(readFileSync(join(MODS, f), "utf8")).matchAll(LITERAL)]
    .map((m) => m[0].replace(/["'`]/g, ""))
    .filter((lit) => !(ALLOWED[f] ?? []).includes(lit))
    .map((lit) => `${f}: ${lit}`));
  expect(found).toEqual([]);
});

test("the allow list names only literals that are still there", () => {
  for (const [f, lits] of Object.entries(ALLOWED)) for (const lit of lits) expect([f, readFileSync(join(MODS, f), "utf8").includes(lit)]).toEqual([f, true]);
});

test("UI tones come from theme names, not the terminal's ansi0 / ansi8 (github's CI log keeps its ANSI codes)", () => {
  const found = sources.flatMap((f) => code(readFileSync(join(MODS, f), "utf8")).split("\n")
    .filter((l) => /\.ansi(0|8)\b|["']ansi(0|8)["']/.test(l))
    .filter((l) => !(f === "github/kit.ts" && /case 0: return t\.ansi0;|default: return t\.ansi8;/.test(l)))
    .map((l) => `${f}: ${l.trim()}`));
  expect(found).toEqual([]);
});

test("art brings its own colors only where listed: the rest is one color, tinted by the theme", () => {
  const svgs = CONVERTED.flatMap((m) => files(m)).filter((f) => f.endsWith(".svg"));
  const colored = svgs.filter((f) => /(?:fill|stroke|stop-color)="#|(?:fill|stroke):#/.test(readFileSync(join(MODS, f), "utf8")));
  expect(colored).toEqual(ART);
});

test("no mod carries a copy of tones.ts: every converted mod that draws a tone imports @fireflies/tones", () => {
  expect(readdirSync(MODS).filter((m) => files(m).includes(`${m}/tones.ts`))).toEqual([]);
  const importers = sources.filter((f) => readFileSync(join(MODS, f), "utf8").includes('from "@fireflies/tones"'));
  expect(importers.length).toBeGreaterThan(20);
  expect(sources.filter((f) => readFileSync(join(MODS, f), "utf8").includes('from "./tones.ts"'))).toEqual([]);
});

// ---- the tones land where the mods were designed in moonfly, and follow other themes

const moonfly = JSON.parse(readFileSync(`${import.meta.dir}/../defaults/themes/moonfly.json`, "utf8"));
const MOONFLY: any = { ...moonfly.colors, background: moonfly.background };

test("in moonfly the edge is ansi0's #323437 and the grid's tones are its old hex: nocturne looks as it did", () => {
  expect(edge(MOONFLY)).toBe(moonfly.ansi[0].toLowerCase());
  expect(edge(MOONFLY)).toBe("#323437");
  expect(MOONFLY.muted).toBe(moonfly.ansi[8]); // ansi8 became muted: the same
  expect(tone(MOONFLY, 0.12)).toBe("#0d0d0e"); // databases' zebra row
  expect(tone(MOONFLY, 0.48)).toBe("#1c1d1f"); // databases' cell rule
});

test("a theme with a translucent input (Fireflies' derived ones) gets an opaque edge between its background and text", () => {
  const paper: any = { background: "#ffffff", input: "#00000026", foreground: "#1b1b1e" };
  const graphite: any = { background: "#1c1d20", input: "#ffffff24", foreground: "#eeeeef" };
  expect(edge(paper)).toBe("#d9d9d9");
  expect(edge(graphite)).toMatch(/^#[0-9a-f]{6}$/);
  expect(edge(graphite)).not.toBe(graphite.background);
  // opaque, so a mod can add its own alpha
  expect(`${edge(paper)}55`).toMatch(/^#[0-9a-f]{8}$/);
  // not a hex color: as it is
  expect(over("border" as any, "#000000")).toBe("border");
});

test("the nocturne layout names theme colors, not moonfly's hex (its scrim dims in black under any theme)", () => {
  const text = readFileSync(`${import.meta.dir}/../defaults/layouts/nocturne.json`, "utf8");
  const layout = JSON.parse(text);
  expect([...text.matchAll(/"#[0-9a-fA-F]{3,8}"/g)].map((m) => m[0])).toEqual(['"#000000"']);
  expect(layout.scrim.color).toBe("#000000");
  expect(layout.theme).toBe("moonfly");
});

// ---- which shipped themes a person is offered (Developer: "not too keen on" upstream's;
// graphite stays as herdr-app's default look, paper as the light one)

const ROOT = `${import.meta.dir}/..`;
const OFFERED = ["moonfly", "graphite", "paper"];
const UNOFFERED = ["ink", "moss", "atom-one-dark"];
const pickerNames = (file: string) => {
  const text = readFileSync(join(ROOT, file), "utf8");
  // the menu's rows ({ name: "…" } after "app.theme") and the palettes' [name, label, words] rows
  const rows = [...text.matchAll(/"app\.theme", \{ name: "([\w-]+)" \}/g)].map((m) => m[1]);
  const listed = [...text.matchAll(/\["([\w-]+)", "[^"]*\(?[^"]*", "[^"]*"\]/g)].map((m) => m[1]).filter((n) => [...OFFERED, ...UNOFFERED].includes(n!));
  return [...rows, ...listed];
};

test("the theme pickers offer moonfly, graphite (herdr-app's default look) and paper, not ink, moss or atom-one-dark", () => {
  for (const file of ["defaults/frame/palette/main.js", "defaults/mods/nocturne/palette-entries.ts", "defaults/mods/menu/main.js"]) {
    expect([file, pickerNames(file).sort()]).toEqual([file, [...OFFERED].sort()]);
    expect([file, readFileSync(join(ROOT, file), "utf8").includes("graphite (herdr-app default)")]).toEqual([file, true]);
  }
  const settings = readFileSync(join(ROOT, "defaults/frame/settings/main.js"), "utf8");
  expect(/const UNOFFERED_THEMES = \[([^\]]*)\]/.exec(settings)?.[1]?.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual(UNOFFERED);
  expect(settings).toContain('.filter((x) => !UNOFFERED_THEMES.includes(x.name) || x.name === current)');
});

test("a settings.json or layout naming ink, moss or atom-one-dark still loads: the presets and the shipped file stay", () => {
  const rust = readFileSync(join(ROOT, "src/settings.rs"), "utf8");
  const presets = /pub const PRESETS: &\[&str\] = &\[([^\]]*)\]/.exec(rust)?.[1] ?? "";
  for (const n of ["graphite", "ink", "moss", "paper"]) expect(presets).toContain(`"${n}"`);
  expect(rust).toContain('("atom-one-dark", include_str!("../defaults/themes/atom-one-dark.json"))');
  const atom = JSON.parse(readFileSync(join(ROOT, "defaults/themes/atom-one-dark.json"), "utf8"));
  expect(atom.ansi).toHaveLength(16);
});

// ---- the look beyond colors (@fireflies/layout-look): Nocturne's dithered, square one where
// the layout says so (its scrim dithered, its corners square), plain elsewhere: the
// herdr default layout (main), whose look is upstream herdr-app's

/** An element stand-in that records its calls. */
const element = (): any => {
  const calls: [string, unknown[]][] = [];
  const el: any = new Proxy({ calls }, { get: (o, k) => (k === "calls" ? calls : (...a: unknown[]) => { calls.push([String(k), a]); return el; }) });
  return el;
};

/** @fireflies/layout-look loaded for real, with the shown layout `root` named `name`. */
async function lookWith(root: () => unknown, name: () => unknown = () => "x") {
  return importLibrary("@fireflies/layout-look", { herdr: { layout: root, shared: (k: string) => (k === "layout" ? name() : null) }, "gpui-kit": { div: element } });
}

const shippedLayout = (n: string) => JSON.parse(readFileSync(`${import.meta.dir}/../defaults/layouts/${n}.json`, "utf8"));

test("no mod carries a copy of layout-look.ts: the mods import @fireflies/layout-look", () => {
  expect(readdirSync(MODS).filter((m) => files(m).includes(`${m}/layout-look.ts`))).toEqual([]);
  expect(sources.filter((f) => readFileSync(join(MODS, f), "utf8").includes('from "./layout-look.ts"'))).toEqual([]);
});

test("the shipped layouts' looks: nocturne dithered and square, main (herdr's default) plain and round", async () => {
  const look = await lookWith(() => null);
  expect(look.lookOf(shippedLayout("nocturne"))).toEqual({ dithered: true, square: true });
  expect(look.lookOf(shippedLayout("main"))).toEqual({ dithered: false, square: false });
});

test("in nocturne every dither stays a dither: flat() gives nothing, radius 0", async () => {
  const look = await lookWith(() => shippedLayout("nocturne"), () => "nocturne");
  expect(look.flat("#323437", 1)).toBe(null);
  expect(look.radius(6)).toBe(0);
});

test("in main a fine dither becomes a flat layer at half strength; a coarse checker (a picture's transparency) stays", async () => {
  const look = await lookWith(() => shippedLayout("main"), () => "main");
  const el = look.flat("#323437", 1);
  expect(el.calls).toContainEqual(["bg", ["#323437"]]);
  expect(el.calls).toContainEqual(["opacity", [0.5]]);
  expect(look.flat("#323437", 8)).toBe(null);
  expect(look.radius(6)).toBe(6);
});

test("the look follows a switch of layout (by name); a layout that can't be read looks like nocturne", async () => {
  let shown = shippedLayout("main");
  let name = "main";
  const look = await lookWith(() => shown, () => name);
  expect(look.dithered()).toBe(false);
  shown = shippedLayout("nocturne");
  name = "nocturne";
  expect(look.dithered()).toBe(true);
  const broken = await lookWith(() => { throw new Error("no layout"); });
  expect(broken.dithered()).toBe(true);
});

test("every dither in a converted mod asks @fireflies/layout-look first", () => {
  // procs' vitals draw their sparklines in dots: a chart's art, not a fill (left to the art step)
  // The libraries the mods import (@fireflies/keyhelp, …) paint dithers too.
  const libs = readdirSync(LIB).flatMap((l) => readdirSync(join(LIB, l)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).map((f) => `../lib/@fireflies/${l}/${f}`));
  // @fireflies/look's fill() is the switch itself: it branches on dithered() (look.test.ts proves both looks).
  const painters = [...sources, ...libs].filter((f) => f !== "procs/vitals-view.ts" && !f.startsWith("../lib/@fireflies/look/") && /Background\.checkerboard\(color\b/.test(readFileSync(join(MODS, f), "utf8")));
  // (a floor: the mods' own painters, and one per library; keyhelp was 14 copies once)
  expect(painters.length).toBeGreaterThan(15);
  for (const f of painters) {
    const text = readFileSync(join(MODS, f), "utf8");
    expect([f, /import \{ flat \} from "@fireflies\/layout-look";/.test(text) && text.includes("const plain = flat(color, cell);")]).toEqual([f, true]);
  }
});

// ---- Fireflies' windows open in any layout: `mod.open {name}` reads the window from the
// mod's mod.json (nocturne's commands exist only in the nocturne layout)

const modJson = (m: string) => JSON.parse(readFileSync(join(MODS, m, "mod.json"), "utf8"));

test("git's and github's mod.json open the window nocturne opens (same kind, key, size, frame)", () => {
  for (const [m, file] of [["git", "git.ts"], ["github", "github.ts"]] as const) {
    const opener = readFileSync(join(MODS, "nocturne", file), "utf8");
    const spec = modJson(m).overlay;
    expect([m, spec.kind, spec.key, spec.frame, spec.scrim]).toEqual([m, "window", m, "none", true]);
    expect(opener).toContain(`openOverlay({ mod: "${m}", kind: "window", key: "${m}", frame: "none", scrim: true, width: ${spec.width}, height: ${spec.height}, resizable: { min: [${spec.resizable.min.join(", ")}] }`);
  }
});

test("the frame palette's window rows open mods that say how their window opens", () => {
  const palette = readFileSync(`${import.meta.dir}/../defaults/frame/palette/main.js`, "utf8");
  const opened = [...palette.matchAll(/\["mod\.open", \{ name: "([\w-]+)" \}, "Window"/g)].map((m) => m[1]!);
  expect(opened.sort()).toEqual(["databases", "git", "github", "procs", "scripts"]);
  for (const m of opened) expect([m, Boolean(modJson(m).overlay)]).toEqual([m, true]);
});
