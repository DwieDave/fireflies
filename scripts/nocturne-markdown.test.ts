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
    .replace(/^import [\s\S]*? from "[^"]+";\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, ...extra, window: globalThis.window };
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

const md = await load("nocturne-markdown/markdown.js");
const { markdown, fenced, slug, blocks, imagesAsLinks, imageLine, taskToggle, footnoteRefs, MarkdownDoc } = md;
const { follow, join, dirname, basename, tilde } = await load("nocturne-markdown/paths.js");

test("the GitHub window, the viewer and the editor ship the same markdown.js (and the editor the viewer's paths.js)", async () => {
  const read = (mod: string, file = "markdown.js") => readFile(new URL(`../defaults/mods/${mod}/${file}`, import.meta.url), "utf8");
  expect(await read("nocturne-github")).toBe(await read("nocturne-markdown"));
  expect(await read("nocturne-editor")).toBe(await read("nocturne-markdown"));
  expect(await read("nocturne-editor", "paths.js")).toBe(await read("nocturne-markdown", "paths.js"));
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
  expect(parts.map((p: any) => p.kind)).toEqual(["md", "images", "md", "md", "md", "images", "md"]);
  expect(parts.map((p: any) => [p.from, p.to])).toEqual([[0, 0], [2, 2], [4, 4], [5, 9], [10, 10], [11, 11], [12, 13]]);
  expect(parts[1].images).toEqual([{ alt: "logo", src: "img/logo.png" }]);
  expect(parts[2].anchor).toBe("one");
  expect(parts[3].text).toContain("# not a heading");
  expect(parts[3].text).toContain("![x](y.png)");
  // Reference definitions go into every run, so [text][ref] resolves in each.
  expect(parts[0].text).toContain("[ref]: https://example.org");
  expect(parts[4].anchor).toBe("one-1");
  expect(parts[5].images).toEqual([{ alt: "pic", src: "a b.png" }]);
  // Web images stay in the text (TextView fetches those); local inline ones become links.
  expect(parts[6].text).toContain("![web](https://x.com/a.png)");
  expect(parts[6].text).toContain("[▧ i](i.png)");
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

test("blocks: blank lines end blocks, but not inside fences, $$ math, list items or indented continuations", () => {
  const doc = [
    "para one", "still one", "", "para two", "", "- a", "", "- b", "  more of b", "", "$$", "x", "", "y", "$$", "", "Title", "=====", "", "```", "a", "", "b", "```",
  ].join("\n");
  const parts = blocks(doc);
  expect(parts.map((p: any) => [p.kind, p.from, p.to])).toEqual([
    ["md", 0, 1], ["md", 3, 3], ["md", 5, 8], ["md", 10, 14], ["md", 16, 17], ["md", 19, 23],
  ]);
  expect(parts[4].anchor).toBe("title");
  // Same text, same key (the preview keeps what it measured); repeats are told apart.
  expect(blocks(doc).map((p: any) => p.key)).toEqual(parts.map((p: any) => p.key));
  const twice = blocks("same\n\nsame");
  expect(twice[0].key).not.toBe(twice[1].key);
});

test("front matter shows as a YAML block", () => {
  const [fm, body] = blocks("---\ntitle: x\n---\n# Hi");
  expect(fm).toMatchObject({ kind: "md", from: 0, to: 2 });
  expect(fm.text).toBe("```yaml\ntitle: x\n```");
  expect(body.anchor).toBe("hi");
});

test("task lists: items with their lines, ticks and nesting; a tick is one character in the text", () => {
  const text = "# Todo\n\n- [ ] write it\n- [x] test **it**\n  - [ ] nested\n  more text\n- plain item\n1. [X] numbered";
  const [, tasks] = blocks(text);
  expect(tasks.kind).toBe("tasks");
  expect(tasks.items.map((i: any) => [i.line, i.indent, i.checked])).toEqual([[2, 0, false], [3, 0, true], [4, 2, false], [6, 0, null], [7, 0, true]]);
  expect(tasks.items[2].text).toBe("nested\nmore text");
  expect(taskToggle(text, 2)).toEqual({ line: 2, col: 3, text: "x" });
  expect(taskToggle(text, 4)).toEqual({ line: 4, col: 5, text: "x" });
  expect(taskToggle(text, 7)).toEqual({ line: 7, col: 4, text: " " });
  expect(taskToggle(text, 6)).toBeNull();
  expect(taskToggle(text, 99)).toBeNull();
});

test("callouts: GitHub's > [!NOTE], titles, folds, and MkDocs' !!! admonitions", () => {
  const [note, warn, adm, other] = blocks("> [!NOTE]\n> Read **this**.\n\n> [!warning]- Careful now\n> body\n\n!!! tip \"Pro tip\"\n    indented body\n\n    second para\n\n> [!custom]\n> x");
  expect(note).toMatchObject({ kind: "callout", type: "note", title: "Note", color: "ansi4", folded: false });
  expect(note.text).toBe("Read **this**.");
  expect(warn).toMatchObject({ type: "warning", title: "Careful now", color: "ansi3", folded: true });
  expect(adm).toMatchObject({ kind: "callout", type: "tip", title: "Pro tip", color: "ansi2" });
  expect(adm.text).toBe("indented body\n\nsecond para");
  expect(other).toMatchObject({ type: "custom", title: "Custom", color: "ansi4" });
  // A plain quote stays a quote.
  expect(blocks("> just a quote")[0].kind).toBe("md");
});

test("footnotes: numbered superscript links where they're used, gathered at the end with a way back", () => {
  const text = "Fact[^b] and more[^a], code `[^a]` stays.\n\n[^a]: First *note*.\n[^b]: Second note\n    continued.\n\nAfter.";
  const parts = blocks(text);
  expect(parts.map((p: any) => p.kind)).toEqual(["md", "md", "footnotes"]);
  expect(parts[0].text).toBe("Fact[¹](#fn-b) and more[²](#fn-a), code `[^a]` stays.");
  expect(parts[0].anchors).toEqual(["fnref-b", "fnref-a"]);
  expect(parts[1].text).toBe("After.");
  expect(parts[2].notes.map((n: any) => [n.n, n.anchor, n.text, n.from, n.to])).toEqual([
    [1, "fn-b", "Second note\ncontinued.", 3, 4], [2, "fn-a", "First *note*.", 2, 2],
  ]);
  expect(footnoteRefs("x[^10]", () => 12)).toBe("x[¹²](#fn-10)");
});

test("the document view: source lines to heights and back, anchors, and measuring keeps the view still", () => {
  const doc = new MarkdownDoc("t");
  doc.setText("# A\n\none\ntwo\n\n# B\n\nthree");
  const [a, body, b, three] = doc.parts;
  for (const [p, h] of [[a, 30], [body, 40], [b, 30], [three, 20]] as const) doc.heights.set(p.key, h);
  // Tops: 20, 62, 114, 156 (padding 20, gaps 12).
  expect(doc.yOfLine(0)).toBe(20);
  expect(doc.yOfLine(2)).toBe(62);
  expect(doc.yOfLine(3)).toBe(82);
  expect(doc.lineAtY(82)).toBe(3);
  expect(doc.lineAtY(doc.yOfLine(5))).toBe(5);
  doc.viewH = 50;
  expect(doc.scrollTo("b")).toBe(true);
  expect(doc.scrollY).toBe(106);
  expect(doc.scrollTo("nope")).toBe(false);
  // A block above the view grows: the view moves with it.
  doc.setScroll(120);
  doc.measured(a.key, 50);
  expect(doc.scrollY).toBe(140);
  // The text changes: blocks keep their measured heights by key.
  doc.setText("# A\n\none\ntwo\n\n# B\n\nthree\n\nfour");
  expect(doc.heights.get(a.key)).toBe(50);
});

test("the editor's Markdown preview: ticks edit the text, links go where they point, the view switch cycles", async () => {
  const extra = {
    ...(await load("nocturne-editor/logic.js")), ...(await load("nocturne-editor/vim.js")), ...md, ...(await load("nocturne-editor/paths.js")),
    languageOf: (p: string) => (/\.(rs|ts|md)$/.test(p) ? "x" : null), lspStart() {}, lspRequest() {}, lspNotify() {}, lspNextMessage() {}, lspRelease() {},
    setUnsaved() {}, notify() {}, writeTextFile: async () => {}, highlight: () => [], InputState: {}, Input: {}, appWindow: () => ({ platform: "macos" }),
  };
  const { default: EditorPane } = await load("nocturne-editor/main.js", extra);
  const view: any = Object.create(EditorPane.prototype);
  const edits: any[] = [];
  const text = "# Plan\n\n- [ ] one\n- [x] two\n\n## Next";
  Object.assign(view, {
    path: "/repo/docs/plan.md", on: null, slot: "s1", markdown: true, view: "split", text, saved: text, messages: [],
    preview: new MarkdownDoc("pv"), images: new Map(), previewHandle: { focus() {}, is_focused: () => false },
    editor: { edit: (e: any) => edits.push(e), value: () => text, focus() {}, set_cursor() {}, scroll_to_line() {} },
  });
  view.preview.setText(text);
  view.changed = () => {};
  const cx = { notify() {}, timer: { after: (_ms: number, f: any) => f(cx) } };

  view.tick(2, cx);
  view.tick(3, cx);
  view.tick(0, cx);
  expect(edits).toEqual([
    [{ start: { line: 2, col: 3 }, end: { line: 2, col: 4 }, text: "x" }],
    [{ start: { line: 3, col: 3 }, end: { line: 3, col: 4 }, text: " " }],
  ]);

  world.panes = [{ pane: "pe", mod: "nocturne-editor", props: { slot: "s1" } }];
  commands.length = 0;
  view.previewLink("other.md#x", cx);
  view.previewLink("../src/main.rs", cx);
  view.previewLink("shot.png", cx);
  view.previewLink("https://example.org", cx);
  expect(commands).toEqual([
    ["editor.open", { path: "/repo/docs/other.md", pane: "pe" }],
    ["editor.open", { path: "/repo/src/main.rs", pane: "pe" }],
    ["preview.open", { path: "/repo/docs/shot.png", pane: "pe" }],
    ["app.open_url", { url: "https://example.org" }],
  ]);
  // An anchor scrolls the preview (and the text to the heading).
  const lines: number[] = [];
  view.editor.scroll_to_line = (l: number) => lines.push(l);
  view.previewLink("#next", cx);
  expect(lines).toEqual([5]);

  const seen: string[] = [];
  view.say = (m: string) => seen.push(m);
  for (let i = 0; i < 3; i++) { view.command("preview", cx); seen.push(view.view); }
  expect(seen.filter((s) => !s.includes(" "))).toEqual(["preview", "text", "split"]);
  view.markdown = false;
  view.command("preview-only", cx);
  expect(view.view).toBe("split");
  expect(seen.at(-1)).toBe("the preview is for Markdown files");
});
