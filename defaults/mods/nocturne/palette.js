// The command palette in Nocturne's look (the layout's palette_mod, on the
// DwieDave fork): the shipped palette's commands, fuzzy ranking and recents,
// drawn square and 1-bit like popup.js. The row under the cursor sits on a
// dithered band with a blue edge; groups are eyebrows; keys are plain glyphs.
// Enter runs, ↑/↓ (page up/down) move, Esc closes. Places (spaces, tabs) stay
// in the picker.
// The "Open" group holds Nocturne's own panels (panels.js): each beside the
// focused pane (or where it always goes) and in a new tab, plus the sidebar fold.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { commands, layouts, keys, run, theme, props, closeOverlay, openOverlay, shared, window as win } from "herdr";
import { dither, eyebrow } from "./kit.js";
import { panels } from "./panels.js";

// Fixed heights, so the list keeps one height while you move.
const SHOWN = 12;
const ROW_H = 28;
const HEAD_H = 30;
const LIST_H = SHOWN * ROW_H;
const GROUPS = ["Recent", "Open", "Tab", "Pane", "Space", "Layout", "Terminal", "Agent", "Window", "App"];
// Each group's mark (mods/workspace-chrome/<icon>.svg).
const ICONS = {
  Recent: "clock", Open: "layers", Tab: "square", Pane: "panel-right", Space: "folder", Layout: "sidebar",
  Terminal: "terminal", Agent: "layers", Window: "square", App: "settings",
};
const chrome = (n) => `mods/workspace-chrome/${n}.svg`;

/** Nocturne's panels as palette entries: `go` runs them; `bind` is their key in keys.json's layout section. */
function openEntries() {
  const bind = { files: "nocturne.files", lazygit: "nocturne.lazygit", github: "nocturne.github" };
  const out = [];
  for (const p of panels()) {
    const where = p.fixed === "float" ? "floating over the tab" : p.fixed === "edge" ? "down the right edge" : "beside the focused pane";
    out.push({ name: "nocturne", args: { panel: p.id }, group: "Open", icon: p.icon, bind: bind[p.id],
      title: p.open?.() ? `Close ${p.name.toLowerCase()}` : p.name, words: `open ${p.words ?? ""} ${where}`, go: () => p.pane() });
    out.push({ name: "nocturne", args: { panel: p.id, tab: true }, group: "Open", icon: p.icon,
      title: `${p.name} in a new tab`, words: `open ${p.words ?? ""} tab`, go: () => p.tab() });
  }
  out.push({ name: "nocturne", args: { fold: true }, group: "Open", icon: "sidebar", bind: "nocturne.fold",
    title: "Fold or open the sidebar", words: "toggle sidebar sky rail collapse hide", go: () => run("nocturne.fold") });
  return out;
}

// The palette's names for commands: [command, args, group, title, keywords].
const NAMED = [
  ["tab.new", {}, "Tab", "New tab", "tab agent new task"],
  ["mod.open", { name: "picker" }, "Tab", "Go to space or tab…", "switch jump find"],
  ["tab.rename", {}, "Tab", "Rename tab", "tab"],
  ["tab.close", {}, "Tab", "Close tab", "tab kill"],
  ["tab.next", {}, "Tab", "Next tab", "tab"],
  ["tab.prev", {}, "Tab", "Previous tab", "tab"],
  ["pane.split", { direction: "right" }, "Pane", "Split right", "vertical"],
  ["pane.split", { direction: "down" }, "Pane", "Split down", "horizontal"],
  ["pane.close", {}, "Pane", "Close pane", "kill"],
  ["pane.zoom", {}, "Pane", "Zoom pane", "maximize fullscreen"],
  ...["left", "right", "up", "down"].map((d) => ["pane.go", { direction: d }, "Pane", `Focus pane ${d}`, "move go"]),
  ...["left", "right", "up", "down"].map((d) => ["pane.swap", { direction: d }, "Pane", `Swap pane ${d}`, "move"]),
  ["space.new", {}, "Space", "New space", "workspace"],
  ["space.rename", {}, "Space", "Rename space", "workspace"],
  ["space.close", {}, "Space", "Close space", "workspace kill"],
  ["space.next", {}, "Space", "Next space", "workspace"],
  ["space.prev", {}, "Space", "Previous space", "workspace"],
  ["layout.switch", {}, "Layout", "Next layout", "look switch"],
  ["layout.reset", {}, "Layout", "Reset layout", "new version default restore herdr's"],
  ["layout.clone", {}, "Layout", "Duplicate layout", "clone copy customize"],
  ["mod.clone", {}, "Layout", "Duplicate mod", "clone copy customize"],
  ["terminal.open", {}, "Terminal", "New terminal", "shell"],
  ["terminal.copy", {}, "Terminal", "Copy", "clipboard"],
  ["terminal.paste", {}, "Terminal", "Paste", "clipboard"],
  ["agent.next", {}, "Agent", "Next agent", ""],
  ["agent.prev", {}, "Agent", "Previous agent", ""],
  ["window.minimize", {}, "Window", "Minimize window", ""],
  ["window.maximize", {}, "Window", "Maximize window", "restore"],
  ["window.close", {}, "Window", "Close window", "quit"],
  ["app.settings", {}, "App", "Settings", "preferences options config look font theme sound"],
  ["app.help", {}, "App", "Keys", "keybindings shortcuts help"],
  ["app.welcome", {}, "App", "Welcome", "intro start onboarding"],
  ["app.whats_new", {}, "App", "What's new", "release changes news update"],
  ["app.reset", {}, "App", "Reset to the default screen", "escape hatch broken restore"],
  ["app.zoom_in", {}, "App", "Zoom in", "bigger font size"],
  ["app.zoom_out", {}, "App", "Zoom out", "smaller font size"],
  ["app.zoom_reset", {}, "App", "Reset zoom", "font size"],
  ["app.quit", {}, "App", "Quit Herdr", "exit"],
  ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }, "App", `Theme: ${n.replace(/-/g, " ")}`, "colors look"]),
];

// Commands that act on something you point at (ids, terminals): not for a list.
const HIDDEN = new Set([
  "space.move", "tab.move", "space.select", "tab.select", "pane.focus", "terminal.keep",
  "terminal.park", "terminal.kill", "terminal.show", "agent.focus", "layout.set", "layout.toggle",
  "layout.show", "layout.hide", "layout.resize", "layout.select", "mod.open", "overlay.close",
  "tab.settle", "tab.unsettle",
  "app.palette", "app.hide", "app.hide_others", "app.show_all", "app.theme", "app.settings",
]);

function titleOf(name) {
  const [noun, verb] = name.split(".");
  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}

/** Every entry for the state we're in now. */
function entries() {
  const known = new Set(commands().map((c) => c.name));
  const mac = win()?.platform === "macos";
  const list = [...openEntries(), ...NAMED.filter(([n]) => known.has(n))
    .filter(([n]) => !(mac && n.startsWith("window.")))
    .map(([name, args, group, title, words]) => ({ name, args, group, title, words }))];
  for (const l of layouts()) {
    const t = { main: "Herdr", terminals: "Terminals", win98: "Herdr 98" }[l] ?? l.charAt(0).toUpperCase() + l.slice(1);
    list.push({ name: "layout.switch", args: { name: l }, group: "Layout", title: `Layout: ${t}`, words: `look ${l}` });
  }
  // Anything new in the app shows up too, until it gets a better name here.
  const named = new Set(NAMED.map(([n]) => n));
  for (const c of commands()) {
    if (named.has(c.name) || HIDDEN.has(c.name) || c.args.some((a) => a.required && a.name !== "name")) continue;
    list.push({ name: c.name, args: {}, ...titleOf(c.name), words: c.about });
  }
  return list.map((e) => ({ ...e, id: `${e.name}:${JSON.stringify(e.args)}` }));
}

/** The key bound to an entry (`name` or `name:value` in keys.json), in macOS glyphs. */
function keyOf(e, bound, mac) {
  const v = Object.values(e.args)[0];
  const want = e.bind ?? (v === undefined ? e.name : `${e.name}:${v}`);
  const k = bound.find((b) => (b.section === "global" || b.section === "layout:nocturne") && b.action === want)?.keys?.trim();
  if (!k) return null;
  // Departure Mono has ⌘ and ⌥; shift and control are spelled.
  const names = mac ? { cmd: "⌘", alt: "⌥", shift: "shift-", ctrl: "ctrl-" } : { ctrl: "ctrl-", alt: "alt-", shift: "shift-", cmd: "super-" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.split(/\s+/).map((stroke) => {
    const parts = stroke.endsWith("--") ? [...stroke.slice(0, -2).split("-"), "-"] : stroke.split("-");
    const key = parts.pop();
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    const label = key.length === 1 ? key.toUpperCase() : key.toLowerCase();
    return [...["ctrl", "alt", "shift", "cmd"].filter((m) => held.has(m)).map((m) => names[m]), label].join("");
  }).join(" ");
}

/** Fuzzy score of `q` in `text`, with the matched positions; null: no match. */
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0, at = 0, streak = 0;
  const hits = [];
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1]);
    streak = i === at && hits.length ? streak + 1 : 0;
    score += 1 + (start ? 6 : 0) + streak * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

function loadRecent() {
  try { return JSON.parse(localStorage.getItem("recent") ?? "[]"); } catch { return []; }
}

export default class Palette {
  init(_props, cx) {
    this.query = "";
    this.input = InputState.new({ placeholder: "type a command" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]?.e));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = 0;
    this.scroll = 0; // how far the list is scrolled, px
    this.recent = loadRecent();
    this.handle = cx.focus_handle();
  }

  close() { closeOverlay(props().overlay); }

  go(e) {
    if (!e) return;
    this.recent = [e.id, ...this.recent.filter((r) => r !== e.id)].slice(0, 20);
    try { localStorage.setItem("recent", JSON.stringify(this.recent)); } catch { /* recents are a nicety */ }
    this.close();
    if (e.go) return e.go();
    if (e.name === "mod.clone") {
      openOverlay({ mod: "nocturne", kind: "dialog", frame: "none", width: 380, props: {
        role: "prompt", title: "Duplicate mod", hint: "the mod to copy; makes <name>-copy",
        command: { name: "mod.clone", args: {} },
      } });
    } else {
      run(e.name, e.name === "layout.clone" ? { name: shared("layout") ?? "main" } : e.args);
    }
  }

  /** The rows to show: grouped when empty, ranked while typing. */
  rows() {
    const all = entries();
    const q = this.query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) {
      const recent = this.recent.map((id) => all.find((e) => e.id === id)).filter(Boolean).slice(0, 5);
      const rest = GROUPS.slice(1).flatMap((g) => all.filter((e) => e.group === g && !recent.includes(e)));
      const others = all.filter((e) => !GROUPS.includes(e.group) && !recent.includes(e));
      return [...recent.map((e) => ({ e, head: "Recent" })), ...[...rest, ...others].map((e) => ({ e, head: e.group }))];
    }
    const rank = (e) => { const i = this.recent.indexOf(e.id); return i < 0 ? 99 : i; };
    return all
      .map((e) => {
        const title = fuzzy(q, e.title);
        const more = fuzzy(q, `${e.group} ${e.title} ${e.name} ${e.words}`);
        const best = title ?? (more && { score: more.score - 4, hits: [] });
        return best && { e, score: best.score, hits: best.hits };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || rank(a.e) - rank(b.e));
  }

  /** A row's title, the matched letters in blue. */
  title(t, text, hits, on) {
    const base = on ? t.foreground : t.muted;
    if (!hits?.length) return div().truncate().text_color(base).child(text);
    const parts = [];
    let cur = "", lit = false;
    [...text].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) { parts.push([cur, lit]); cur = ""; }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);
    return h_flex().min_w(0).children(parts.map(([s, h]) => div().text_color(h ? t.accent : base).child(s.replace(/ /g, " "))));
  }

  /** A key as a small square cap, one per stroke. */
  keycap(t, k, on) {
    return h_flex().flex_none().gap(3).children(k.split(" ").map((stroke, i) =>
      div().id(`kc-${i}`).h(18).px(5).flex().items_center().text_size(10)
        .border(1).border_color(on ? t.accent : t.ansi0).text_color(on ? t.accent : t.dim).child(stroke)));
  }

  /** A group's head: its mark, the eyebrow, a dithered hairline, how many it holds. */
  groupHead(t, name, count) {
    return h_flex().px(16).pb(6).gap(8).items_end()
      .child(svg(chrome(ICONS[name] ?? "square")).size(11).flex_none().text_color(t.ansi8))
      .child(div().flex_none().child(eyebrow(t, name)))
      .child(div().flex_1().h(1).mb(5).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(String(count)));
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const bound = keys();
    const mac = win()?.platform === "macos";
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    // One strip: each row (and the group title before it) at a fixed y. The
    // strip scrolls only as far as it takes to keep the selected row in view.
    const tops = [];
    const counts = new Map();
    let y = 0;
    rows.forEach((r, i) => {
      const head = !this.query && (i === 0 || r.head !== rows[i - 1].head);
      tops.push({ head, title: y, row: y + (head ? HEAD_H : 0) });
      y += (head ? HEAD_H : 0) + ROW_H;
      counts.set(r.head, (counts.get(r.head) ?? 0) + 1);
    });
    const fixed = y > LIST_H;
    this.maxScroll = Math.max(0, y - LIST_H);
    const sel = tops[this.at];
    if (sel) {
      const from = sel.head ? sel.title : sel.row;
      if (from < this.scroll) this.scroll = from;
      if (sel.row + ROW_H > this.scroll + LIST_H) this.scroll = sel.row + ROW_H - LIST_H;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    // Rows are placed at their edges from the model, not stacked: rounded
    // heights would drift away from it over a long list.
    const place = (el, start, end) => fixed
      ? el.absolute().left(0).right(0).top(start - this.scroll).h(end - start)
      : el.flex_none().h(end - start);
    const visible = (start, end) => !fixed || (end > this.scroll && start < this.scroll + LIST_H);
    const list = [];
    rows.forEach((r, i) => {
      const { head, title, row } = tops[i];
      if (head && visible(title, row)) list.push(place(v_flex().id(`pl-h-${i}`), title, row).justify_end().child(this.groupHead(t, r.head, counts.get(r.head))));
      if (!visible(row, row + ROW_H)) return;
      const on = i === this.at;
      const k = keyOf(r.e, bound, mac);
      const icon = r.e.icon ?? ICONS[r.e.group] ?? "square";
      // Placed last: an absolute row is its own anchor for the band; .relative() after it would undo it.
      list.push(place(h_flex().id(`pl-${i}`).relative(), row, row + ROW_H).px(16).gap(10).items_center().text_size(12)
        .on_hover((h, cx) => { if (h && this.at !== i) { this.at = i; cx.notify(); } })
        .on_click(() => this.go(r.e))
        .when(on, (el) => el
          .child(dither(t.ansi0, 1))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(svg(chrome(icon)).size(13).flex_none().relative().text_color(on ? t.accent : t.ansi8))
        .child(div().relative().flex_1().min_w(0).child(this.title(t, r.e.title, r.hits, on)))
        .when(Boolean(this.query), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(r.e.group.toLowerCase())))
        .when(Boolean(k), (el) => el.child(div().relative().child(this.keycap(t, k, on)))));
    });
    const hint = (key, what) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(key)).child(div().text_color(t.dim).child(what));
    return v_flex().id("nocturne-palette").track_focus(this.handle).w_full().min_h(0)
      .bg(t.background).border(1).border_color(t.ansi0)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        // Stops at the ends: wrapping jumps out of sight.
        if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + SHOWN, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - SHOWN, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      // The search line on the horizon: the prompt sits on a dithered block, like a cursor.
      .child(h_flex().relative().h(48).flex_none().px(16).gap(12).items_center()
        .child(div().relative().size(20).flex_none().flex().items_center().justify_center()
          .child(dither(t.accent, 1).opacity(0.35))
          .child(div().relative().text_size(13).text_color(t.foreground).child(">")))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(this.query ? `${rows.length} found` : `${rows.length} commands`))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .child(rows.length
        ? div().id("palette-rows").relative().pt(4)
          .when(fixed, (el) => el.h(LIST_H + 4).overflow_hidden())
          .on_scroll_wheel((e, cx) => {
            this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, this.maxScroll));
            // The selection stays on screen, so the next frame doesn't scroll back to it.
            while (this.at < rows.length - 1 && tops[this.at].row < this.scroll) this.at++;
            while (this.at > 0 && tops[this.at].row + ROW_H > this.scroll + LIST_H) this.at--;
            cx.notify();
          })
          .children(fixed ? [div().relative().h(LIST_H).children(list)] : [v_flex().children(list)])
        : v_flex().px(16).py(14).gap(4).text_size(11)
          .child(div().text_color(t.muted).child(`Nothing matches "${this.query}".`))
          .child(div().text_color(t.dim).child("Spaces and tabs are in the picker (⌘P).")))
      .child(h_flex().relative().h(26).mt(4).flex_none().px(16).gap(14).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(hint("↑↓", "move")).child(hint("enter", "run")).child(hint("esc", "close"))
        .child(div().flex_1())
        .child(div().text_color(t.dim).child("type to filter")));
  }
}
