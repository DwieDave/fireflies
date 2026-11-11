import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The mods import the app's modules; stand-ins record what they're asked.
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor() {
    return new Proxy(this, {
      get: (target, key: string, proxy) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else target.calls.push([key, args]);
        return proxy;
      },
    });
  }
}
const call = (el: any, name: string) => el.calls.find(([k]: [string]) => k === name)?.[1];
const commands: [string, any][] = [];
const world: { panes: any[]; spaces: any[] } = { panes: [], spaces: [] };
const herdr = {
  props: () => ({}), theme: () => ({}), settings: () => ({ zoom: 1 }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[], shared: () => null, setShared() {},
  readTextFile: async () => null, watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  focused: () => null, home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", window: () => ({ platform: "linux" }),
};
const kit = { View: class {}, div: () => new Element(), svg: () => new Element(), image: () => new Element(), PathBuilder: {}, Background: {} };
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({}) }, Editor: { new: () => new Element() }, EditorState: { new: () => ({}) },
  TextView: { markdown: (id: string, text: string) => Object.assign(new Element(), { kind: "markdown", id, text }) },
};

/** A shipped mod file run with stand-ins for the app's modules (imports
 *  dropped, exports returned), the way picker.test.ts does it: no module mocks,
 *  which would leak into the other test files of the same run. */
async function load(path: string, extra: Record<string, unknown> = {}): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, ...extra, window: extra.window ?? globalThis.window };
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

const { markdown, fenced, slug, blocks, imagesAsLinks, imageLine, isLocalSource } = await load("nocturne-markdown/markdown.js");
const { follow, join, dirname, basename, tilde } = await load("nocturne-markdown/paths.js");

test("the GitHub window and the viewer ship the same markdown.js", async () => {
  const read = (mod: string) => readFile(new URL(`../defaults/mods/${mod}/markdown.js`, import.meta.url), "utf8");
  expect(await read("nocturne-github")).toBe(await read("nocturne-markdown"));
});

test("markdown() draws selectable Markdown in the theme's text and routes links", () => {
  const onLink = () => {};
  const el: any = markdown({ foreground: "#fff" }, "body-1", "# hi", { onLink });
  expect(call(el, "text_size")).toEqual([12.5]);
  expect(call(el, "text_color")).toEqual(["#fff"]);
  const view = el.nodes[0];
  expect([view.kind, view.id, view.text]).toEqual(["markdown", "body-1", "# hi"]);
  expect(call(view, "selectable")).toEqual([true]);
  expect(call(view, "on_link_click")).toEqual([onLink]);
  const plain: any = markdown({ foreground: "#fff" }, "x", "text", { size: 13 });
  expect(call(plain, "text_size")).toEqual([13]);
  expect(call(plain.nodes[0], "on_link_click")).toBeUndefined();
});

test("the GitHub window renders PR bodies and comments through the shared module", async () => {
  const prs = await readFile(new URL("../defaults/mods/nocturne-github/prs.js", import.meta.url), "utf8");
  expect(prs).toContain('import { markdown } from "./markdown.js"');
  expect(prs).not.toContain("TextView");
});

test("raw view fences the text longer than any fence inside it", () => {
  expect(fenced("a")).toBe("```\na\n```");
  expect(fenced("```js\nx\n```")).toBe("````\n```js\nx\n```\n````");
});

test("anchors are made the way GitHub makes them", () => {
  expect(slug("Task list")).toBe("task-list");
  expect(slug("What's `new` in [v2](http://x)?")).toBe("whats-new-in-v2");
  expect(slug("snake_case and-dash")).toBe("snake_case-and-dash");
  expect(slug("Über Größe")).toBe("über-größe");
});

test("a document is cut at headings and lines of local images, keeping fences whole", () => {
  const doc = [
    "intro", "", "![logo](img/logo.png)", "", "# One", "text [ref]", "```", "# not a heading", "![x](y.png)", "```",
    "## One", "<p align=\"center\"><img src=\"a b.png\" alt=\"pic\"></p>", "![web](https://x.com/a.png)", "inline ![i](i.png) here", "",
    "[ref]: https://example.org",
  ].join("\n");
  const parts = blocks(doc);
  expect(parts.map((p: any) => p.kind)).toEqual(["md", "images", "md", "md", "images", "md"]);
  expect(parts[1].images).toEqual([{ alt: "logo", src: "img/logo.png" }]);
  expect(parts[2].anchor).toBe("one");
  expect(parts[2].text).toContain("# not a heading");
  expect(parts[2].text).toContain("![x](y.png)");
  // Reference definitions go into every run, so [text][ref] resolves in each.
  expect(parts[0].text).toContain("[ref]: https://example.org");
  expect(parts[3].anchor).toBe("one-1");
  expect(parts[4].images).toEqual([{ alt: "pic", src: "a b.png" }]);
  // Web images stay in the text (TextView fetches those); local inline ones become links.
  expect(parts[5].text).toContain("![web](https://x.com/a.png)");
  expect(parts[5].text).toContain("[▧ i](i.png)");
});

test("image lines and inline images", () => {
  expect(imageLine("[![b](badge.svg)](https://ci)")).toEqual([{ alt: "b", src: "badge.svg" }]);
  expect(imageLine("text ![a](a.png)")).toBeNull();
  expect(imagesAsLinks("see ![](docs/shot.png) and ![w](https://x/y.png)")).toBe("see [▧ shot.png](docs/shot.png) and ![w](https://x/y.png)");
});

test("links: web, anchors, other Markdown (relative, spaces, ..), files, file:// and other schemes", () => {
  const file = "/repo/docs/README.md";
  expect(follow("https://example.com/a", file)).toEqual({ kind: "web", url: "https://example.com/a" });
  expect(follow("#Task-List", file)).toEqual({ kind: "anchor", anchor: "task-list" });
  expect(follow("#", file)).toBeNull();
  expect(follow("guide.md", file)).toEqual({ kind: "markdown", path: "/repo/docs/guide.md" });
  expect(follow("../CHANGELOG.md#v1", file)).toEqual({ kind: "markdown", path: "/repo/CHANGELOG.md", anchor: "v1" });
  expect(follow("sub%20dir/My%20Notes.markdown", file)).toEqual({ kind: "markdown", path: "/repo/docs/sub dir/My Notes.markdown" });
  expect(follow("<sub dir/x.md>".slice(1, -1), file)).toEqual({ kind: "markdown", path: "/repo/docs/sub dir/x.md" });
  expect(follow("./README.md#install", file)).toEqual({ kind: "markdown", path: "/repo/docs/README.md", anchor: "install" });
  expect(follow("/etc/notes.md", file)).toEqual({ kind: "markdown", path: "/etc/notes.md" });
  expect(follow("file:///tmp/a%20b.md", file)).toEqual({ kind: "markdown", path: "/tmp/a b.md" });
  expect(follow("file://localhost/tmp/x.png", file)).toEqual({ kind: "file", path: "/tmp/x.png" });
  expect(follow("../src/main.rs", file)).toEqual({ kind: "file", path: "/repo/src/main.rs" });
  expect(follow("mailto:me@x.org", file)).toEqual({ kind: "other", url: "mailto:me@x.org" });
  expect(follow("", file)).toBeNull();
});

test("path helpers", () => {
  expect(join("/a/b", "../c/./d.md")).toBe("/a/c/d.md");
  expect(join("/a", "/x/../y")).toBe("/y");
  expect(dirname("/a/b.md")).toBe("/a");
  expect(dirname("/b.md")).toBe("/");
  expect(basename("/a/b c.md")).toBe("b c.md");
  expect(tilde("/home/me/x/y.md", "/home/me")).toBe("~/x/y.md");
  expect(tilde("/homework/y.md", "/home/me")).toBe("/homework/y.md");
});

test("nocturne-files opens Markdown in the viewer beside the editor; alt-click and e open it as text", async () => {
  const { default: Files, isMarkdown } = await load("nocturne-files/main.js", await load("nocturne-files/logic.js"));
  expect([isMarkdown("a.md"), isMarkdown("B.MARKDOWN"), isMarkdown("a.mdx"), isMarkdown("md")]).toEqual([true, true, false, false]);
  world.spaces = [{ active: true, tabs: [{ id: "tab1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "tab1", terminal: "t1" }, { pane: "pf", tab: "tab1", mod: "nocturne-files" }];
  const view: any = Object.create(Files.prototype);
  Object.assign(view, { root: "/repo", on: null, handle: { focus() {} }, folders: new Set(), lastClick: null });
  view.rows = () => [{ path: "docs/My Plan.md", dir: false, depth: 1 }, { path: "main.rs", dir: false, depth: 0 }];
  const edits: string[] = [];
  view.edit = (path: string) => edits.push(path);
  const cx = { notify() {}, stop_propagation() {} };

  commands.length = 0;
  view.pick("docs/My Plan.md", cx);
  expect(commands).toEqual([["markdown.open", { path: "/repo/docs/My Plan.md", pane: "p1" }]]);
  expect(edits).toEqual([]);

  view.alt = true;
  view.pick("docs/My Plan.md", cx);
  view.alt = false;
  view.pick("main.rs", cx);
  view.sel = "docs/My Plan.md";
  view.key({ key: "e" }, cx);
  expect(edits).toEqual(["docs/My Plan.md", "main.rs", "docs/My Plan.md"]);
  expect(commands.length).toBe(1);

  view.key({ key: "enter" }, cx);
  expect(commands.at(-1)).toEqual(["markdown.open", { path: "/repo/docs/My Plan.md", pane: "p1" }]);
  view.on = "box";
  view.openFile("docs/My Plan.md", cx);
  expect(commands.at(-1)).toEqual(["markdown.open", { path: "/repo/docs/My Plan.md", pane: "p1", on: "box" }]);
});

test("the files mod opens Markdown in the viewer; alt-click previews it as text", async () => {
  const { default: Files } = await load("files/main.js");
  const view: any = Object.create(Files.prototype);
  Object.assign(view, { root: "/repo", on: null });
  const shown: string[] = [];
  view.show = (path: string) => shown.push(path);
  commands.length = 0;
  view.pick("README.md", {}, false);
  view.pick("README.md", {}, true);
  view.pick("notes.txt", {}, false);
  expect(commands).toEqual([["markdown.open", { path: "/repo/README.md" }]]);
  expect(shown).toEqual(["README.md", "notes.txt"]);
});

// ---- the viewer by keys

const walk = (el: any): any[] => (el && typeof el === "object" && Array.isArray(el.nodes) ? [el, ...el.nodes.flatMap(walk)] : []);

const linkLogic = await load("nocturne-markdown/links.js");
const { linksOf, documentLinks, nextLink, nextHeading } = linkLogic;

test("links in reading order: inline, reference, autolinks, bare addresses; none in code", () => {
  const text = [
    "See [the guide](docs/guide.md \"Guide\") and [**bold** ref][r], then <https://a.example/x>.",
    "Bare https://b.example/y. and www.c.example, `[not](code.md)`, ![pic](p.png), [short].",
    "```", "[fenced](no.md)", "```",
    "[r]: https://ref.example", "[short]: #top",
  ].join("\n");
  expect(linksOf(text)).toEqual([
    { text: "the guide", href: "docs/guide.md" },
    { text: "bold ref", href: "https://ref.example" },
    { text: "https://a.example/x", href: "https://a.example/x" },
    { text: "https://b.example/y", href: "https://b.example/y" },
    { text: "www.c.example", href: "https://www.c.example" },
    { text: "short", href: "#top" },
  ]);
  // [x] without a definition is text (a task box, a citation).
  expect(linksOf("- [x] done [nothing]")).toEqual([]);
});

test("document links carry their block; tab starts from the blocks in view and wraps; headings step", () => {
  const parts = blocks("# A\n[one](1.md)\n\n![shot](s.png)\n\n## B\n[two](2.md) [three](#a)");
  const links = documentLinks(parts);
  expect(links.map((l: any) => [l.text, l.part, Boolean(l.image)])).toEqual([["one", 0, false], ["shot", 1, true], ["two", 2, false], ["three", 2, false]]);
  expect([nextLink(links, null, 1, 0), nextLink(links, null, 1, 2), nextLink(links, null, -1, 1), nextLink(links, 3, 1), nextLink(links, 0, -1), nextLink([], null, 1)]).toEqual([0, 2, 1, 0, 3, null]);
  expect([nextHeading(parts, 0, 1), nextHeading(parts, 2, -1), nextHeading(parts, 2, 1)]).toEqual([2, 0, null]);
});

test("the viewer: tab marks a link's block and shows where it goes, enter follows, ] [ headings, f y ?, esc backs out", async () => {
  const { default: Markdown } = await load("nocturne-markdown/main.js", { markdown, fenced, blocks, isLocalSource, follow, dirname, basename, join, tilde, ...linkLogic, appWindow: herdr.window, window: { paint_path: () => new Element() }, PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) } });
  const view: any = Object.create(Markdown.prototype);
  const text = "# Top\nRead [next](next.md).\n\n![shot](shot.png)\n\n## Later\nSee [web](https://x.example).";
  const parts = blocks(text);
  Object.assign(view, {
    path: "/d/a.md", on: null, slot: "m1", handle: { focus() {}, is_focused: () => true }, raw: false, history: [], images: new Map(),
    text, error: null, parts, links: documentLinks(parts), sel: null, heights: [100, 200, 100], scrollY: 0, viewH: 150, width: 700, gen: 1,
  });
  const opened: string[] = [];
  view.open = (p: string) => { opened.push(p); view.sel = null; };
  let clip = "";
  const cx = { notify() {}, stop_propagation() {}, write_to_clipboard: (s: string) => { clip = s; } };
  const key = (k: string, extra: any = {}) => view.key({ key: k, modifiers: {}, ...extra }, cx);
  commands.length = 0;
  key("tab");
  expect(view.sel).toBe(0);
  const strings = (el: any) => walk(el).flatMap((e: any) => e.nodes.filter((n: any) => typeof n === "string"));
  expect(strings(view.render())).toEqual(expect.arrayContaining(["enter", "next", "next.md", "1/3"]));
  key("tab");
  expect(view.sel).toBe(1);
  // The picture's block is lower down: it scrolls into view.
  expect(view.scrollY).toBeGreaterThan(0);
  key("enter");
  expect(commands.at(-1)).toEqual(["preview.open", { path: "/d/shot.png" }]);
  // Nothing chosen: shift-tab starts from the last link in view.
  key("tab", { modifiers: { shift: true } });
  expect(view.sel).toBe(1);
  key("escape");
  expect(view.sel).toBe(null);
  key("tab", { modifiers: { shift: true } });
  key("tab", { modifiers: { shift: true } });
  expect(view.sel).toBe(0);
  key("enter");
  expect(opened).toEqual(["/d/next.md"]);
  // ] goes to the next heading.
  view.scrollY = 0;
  key("]", { key_char: "]" });
  expect(view.scrollY).toBeGreaterThan(200);
  key("[", { key_char: "[" });
  // The first heading, where an #anchor puts it.
  expect(view.scrollY).toBe(16);
  key("f");
  expect(commands.at(-1)).toEqual(["pane.split", { edge: "right", px: 280, mod: "nocturne-files", props: { folder: "/d", on: null } }]);
  key("y");
  expect(clip).toBe("/d/a.md");
  key("/", { key_char: "?", modifiers: { shift: true } });
  expect(strings(view.render())).toEqual(expect.arrayContaining(["tab ⇧tab", "links", "] [", "headings"]));
  key("escape");
  expect(view.keysShown).toBe(false);
});
