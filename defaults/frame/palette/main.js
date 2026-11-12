// The frame's command palette: everything you can do, by name, with its key.
// Places (spaces, tabs) stay in the picker. Fuzzy: your letters in
// order, word starts and runs rank higher. Empty: recent first, then every
// group. Choices are entries of their own ("Layout: Zen"); commands that need
// a name ask for it. Enter runs, ↑/↓ move, Esc closes.
// Every app command is an entry or in OUT with the reason it stays out
// (scripts/palette-commands.test.ts holds that line); a layout's own mod
// commands belong in its palette_mod (Nocturne's: mods/nocturne/palette.js).
// The app's own mod: rewritten from the binary on every start.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { commands, layouts, keys, run, theme, props, closeOverlay, openOverlay, shared, window as win, focused, panes, terminals, agents, updates, layout, spaces, pickFolder } from "herdr";

// The list keeps one height while you move: rows and group titles have fixed
// heights, and the window shows as many as fit in LIST_H.
// 10 rows: with the search line it fits the popup (at most 85% of the
// window) down to ~580 px windows at zoom 1.3.
const SHOWN = 10;
const ROW_H = 32;
const HEAD_H = 26;
const LIST_H = SHOWN * ROW_H;
const GROUPS = ["Recent", "Tab", "Pane", "Space", "Layout", "Terminal", "Agent", "Window", "App"];

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
  ["pane.park", {}, "Pane", "Park pane", "minimize dock bottom chip hide"],
  ["pane.unpark", {}, "Pane", "Unpark pane", "restore dock bottom chip show"],
  ...["left", "right", "up", "down"].map((d) => ["pane.go", { direction: d }, "Pane", `Focus pane ${d}`, "move go"]),
  ...["left", "right", "up", "down"].map((d) => ["pane.swap", { direction: d }, "Pane", `Swap pane ${d}`, "move"]),
  ...["left", "right", "up", "down"].map((d) => ["pane.resize", { direction: d }, "Pane", `Resize pane ${d}`, "size grow shrink bigger smaller wider narrower taller shorter divider step"]),
  ["pane.equalize", { scope: "all" }, "Pane", "Equalize panes", "even out balance same size grid all"],
  ["pane.equalize", { scope: "row" }, "Pane", "Equalize this row", "even out balance same width side by side"],
  ["pane.equalize", { scope: "column" }, "Pane", "Equalize this column", "even out balance same height stacked"],
  ["pane.float", {}, "Pane", "Float this pane over the tab", "floating overlay detach popup"],
  ["pane.font_bigger", {}, "Pane", "Bigger text in this pane", "font size zoom larger terminal"],
  ["pane.font_smaller", {}, "Pane", "Smaller text in this pane", "font size zoom terminal"],
  ["pane.font_reset", {}, "Pane", "Pane text back to normal size", "font size zoom reset terminal"],
  ["tab.settle", {}, "Tab", "Put this tab away", "settle hide keep running background out of the list"],
  ["space.new", {}, "Space", "New space", "workspace"],
  ["space.rename", {}, "Space", "Rename space", "workspace"],
  ["space.close", {}, "Space", "Close space", "workspace kill"],
  ["space.next", {}, "Space", "Next space", "workspace"],
  ["space.prev", {}, "Space", "Previous space", "workspace"],
  ["layout.switch", {}, "Layout", "Next layout", "look switch"],
  ["layout.reset", {}, "Layout", "Reset layout", "new version default restore fireflies'"],
  ["layout.clone", {}, "Layout", "Duplicate layout", "clone copy customize"],
  ["mod.clone", {}, "Layout", "Duplicate mod", "clone copy customize"],
  ["terminal.open", {}, "Terminal", "New terminal", "shell"],
  ["terminal.copy", {}, "Terminal", "Copy", "clipboard"],
  ["terminal.paste", {}, "Terminal", "Paste", "clipboard"],
  ["terminal.paste_image", {}, "Terminal", "Paste the clipboard image", "clipboard picture screenshot file ctrl-v"],
  ["terminal.search", {}, "Terminal", "Find in the terminal…", "search scrollback history text"],
  ["terminal.scroll", { to: "top" }, "Terminal", "Scroll to the top of the history", "scrollback oldest start beginning"],
  ["terminal.scroll", { to: "bottom" }, "Terminal", "Scroll back to the live screen", "scrollback bottom end newest"],
  ["agent.next", {}, "Agent", "Next agent", ""],
  ["agent.prev", {}, "Agent", "Previous agent", ""],
  ["window.minimize", {}, "Window", "Minimize window", ""],
  ["window.maximize", {}, "Window", "Maximize window", "restore"],
  ["window.close", {}, "Window", "Close window", "quit"],
  ["overlay.focus", {}, "Window", "Next window", "focus cycle floating terminal keyboard front"],
  ["overlay.focus", { dir: "prev" }, "Window", "Previous window", "focus cycle floating terminal keyboard front"],
  ["app.settings", {}, "App", "Settings", "preferences options config look font theme sound"],
  ["app.settings", { section: "look" }, "App", "Settings: look", "preferences theme font size colors appearance"],
  ["app.settings", { section: "alerts" }, "App", "Settings: alerts", "preferences sounds notifications"],
  ["app.settings", { section: "editor" }, "App", "Settings: editor", "preferences vim tabs indent lsp"],
  ["app.settings", { section: "machines" }, "App", "Settings: machines", "preferences ssh remote hosts servers"],
  ["app.settings", { section: "updates" }, "App", "Settings: updates", "preferences version release"],
  ["app.help", {}, "App", "Keys", "keybindings shortcuts help"],
  ["app.welcome", {}, "App", "Welcome", "intro start onboarding"],
  ["app.whats_new", {}, "App", "What's new", "release changes news update"],
  ["app.reset", {}, "App", "Reset to the default screen", "escape hatch broken restore"],
  ["app.zoom_in", {}, "App", "Zoom in", "bigger font size"],
  ["app.zoom_out", {}, "App", "Zoom out", "smaller font size"],
  ["app.zoom_reset", {}, "App", "Reset zoom", "font size"],
  ["app.feedback", {}, "App", "Send feedback…", "bug report issue github idea problem"],
  ["app.hide", {}, "App", "Hide Fireflies", "macos minimize away"],
  ["app.hide_others", {}, "App", "Hide other apps", "macos"],
  ["app.show_all", {}, "App", "Show all apps", "macos unhide"],
  ["app.quit", {}, "App", "Quit Fireflies", "exit"],
  ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }, "App", `Theme: ${n.replace(/-/g, " ")}`, "colors look"]),
];

// Commands that stay out of the list, each with why: most act on something
// you point at (ids, indexes, paths). A whole name covers its `name:value` keys too.
export const OUT = {
  "space.select": "a place: spaces are in the picker (ctrl-1..9 pick by position)",
  "tab.select": "a place: tabs are in the picker (cmd-1..9 pick by position)",
  "space.move": "needs a space id and a position: drag it in the sidebar",
  "tab.move": "needs a tab id and a position: drag it in the tab bar",
  "pane.focus": "needs a pane: Focus pane left/right/up/down, or click it",
  "agent.focus": "needs an agent: the agents list and the picker",
  "terminal.keep": "needs a terminal without a pane (a sub-agent): the agents list",
  "terminal.show": "needs a terminal: the agents list",
  "terminal.peek": "needs a terminal: the agents list",
  "terminal.kill": "needs a terminal: Close pane ends the focused one",
  "float.view": "needs a view index: the floating terminal's own tabs",
  "layout.set": "needs a whole layout tree (agents and mods write it)",
  "layout.show": "needs a layout node id",
  "layout.hide": "needs a layout node id",
  "layout.resize": "needs a layout node id and a size: drag the divider",
  "layout.select": "needs a stack and a child id",
  "layout.focus": "needs a layout block id",
  "mod.open": "needs a mod name; the picker's is Go to space or tab…",
  "overlay.close": "closes the top dialog: esc does it, and the palette is the top dialog until it runs",
  "overlay.move": "needs how far to move: drag the window",
  "overlay.resizable": "needs a window id and its sizing (mods set it)",
  "native.debug": "a report for agents (herdr-app do native.debug): nothing to see from a list",
  "native.call": "needs a native view key and an action (mods call it)",
  "app.palette": "the palette itself",
  "app.theme": "needs a theme name: the Theme: … rows, and Settings: look",
  "app.open_url": "needs a URL (links open it)",
  "editor.open": "needs a path (a layout's file picker opens files: Nocturne's Find a file…)",
  "markdown.open": "needs a path (a layout's file picker opens files)",
  "preview.open": "needs a path (a layout's file picker opens files)",
  "image.open": "needs a path (the old name of preview.open)",
  "files.open": "needs a path (Nocturne's palette opens the focused folder's)",
  "tab.unsettle": "needs a put-away tab: showing it from the picker brings it back",
};

function titleOf(name) {
  const [noun, verb] = name.split(".");
  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}

/** A layout node by id, anywhere in the shown layout. */
function hasNode(node, id) {
  if (!node || typeof node !== "object") return false;
  if (node.id === id) return true;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some((c) => hasNode(c, id)) : v && typeof v === "object" && hasNode(v, id)));
}

// Core commands for what's focused or waiting now: only stateEntries adds them.
const STATE = new Set(["pane.move", "terminal.right_click", "terminal.park", "terminal.pin", "layout.toggle", "space.folder",
  "app.update", "app.update_core", "app.check_updates"]);

/** The focused pane and terminal, the shown space and layout, an update. */
function stateEntries() {
  const out = [];
  const f = focused();
  const ps = panes(), mine = f?.pane ? ps.find((p) => p.pane === f.pane) : null;
  if (mine && ps.filter((p) => p.tab === mine.tab).length > 1) {
    out.push({ name: "pane.move", args: {}, group: "Pane", title: "Move this pane to a new tab", words: "pane move tab own detach break out" });
  }
  const all = terminals(), term = f?.terminal ? all.find((x) => x.address === f.terminal) : null;
  if (term) {
    const toProgram = term.labels?.["herdr.right-click"] === "program";
    out.push({ name: "terminal.right_click", args: { to: toProgram ? "menu" : "program", terminal: term.address }, group: "Terminal",
      title: toProgram ? "Right-clicks open the menu" : "Send right-clicks to the program", words: "mouse right click menu program tmux vim" });
    const parent = term.parent && all.find((x) => x.address === term.parent);
    if (parent) out.push({ name: "terminal.park", args: { terminal: term.address }, group: "Agent",
      title: `Send back to ${parent.name || parent.address}`, words: "sub-agent subagent parent park return pane" });
    const agent = agents().find((a) => a.address === term.address);
    if (agent) {
      const on = Boolean(agent.pinned);
      out.push({ name: "terminal.pin", args: { terminal: term.address, pinned: !on }, group: "Agent",
        title: on ? "Unpin this agent" : "Pin this agent to the top", words: "pin unpin keep top agents list" });
    }
  }
  if (hasNode(layout(), "sidebar")) {
    out.push({ name: "layout.toggle", args: { id: "sidebar" }, group: "Layout", title: "Show or hide the sidebar", words: "toggle sidebar collapse hide" });
  }
  const space = spaces().find((s) => s.active);
  if (space && !space.machine) {
    out.push({ name: "space.folder", args: { id: space.id }, group: "Space", title: "Change this space's folder…", words: "space folder directory attach repo cwd",
      go: async () => { const folder = await pickFolder({ prompt: "The space's folder" }); if (folder) run("space.folder", { id: space.id, folder }); } });
  }
  const u = updates();
  if (u?.app?.ready) out.push({ name: "app.update", args: {}, group: "App", title: `Restart into ${u.app.ready}`, words: "update upgrade new version restart" });
  if (u?.core?.ready && !u.core.managed) out.push({ name: "app.update_core", args: {}, group: "App", title: `Update herdr-core to ${u.core.ready}`, words: "update upgrade core terminals keep running" });
  if (u?.checks !== false) out.push({ name: "app.check_updates", args: {}, group: "App", title: "Check for updates", words: "update upgrade new version release" });
  return out;
}

// Commands that need a terminal focused (they fail on a mod pane).
const NEEDS_TERMINAL = new Set(["terminal.copy", "terminal.paste", "terminal.paste_image", "terminal.search", "terminal.scroll",
  "pane.font_bigger", "pane.font_smaller", "pane.font_reset", "pane.float"]);
const MAC_ONLY = new Set(["app.hide", "app.hide_others", "app.show_all"]);

// Every entry for the state we're in now.
function entries() {
  const known = new Set(commands().map((c) => c.name));
  const mac = win()?.platform === "macos";
  const terminal = Boolean(focused()?.terminal);
  const list = [...NAMED.filter(([n]) => known.has(n))
    .filter(([n]) => !(mac && n.startsWith("window.")) && (mac || !MAC_ONLY.has(n)) && (terminal || !NEEDS_TERMINAL.has(n)))
    .map(([name, args, group, title, words]) => ({ name, args, group, title, words })), ...stateEntries().filter((e) => known.has(e.name))];
  for (const l of layouts()) {
    const t = { main: "Fireflies", terminals: "Terminals", win98: "Fireflies 98" }[l] ?? l.charAt(0).toUpperCase() + l.slice(1);
    list.push({ name: "layout.switch", args: { name: l }, group: "Layout", title: `Layout: ${t}`, words: `look ${l}` });
  }
  // Anything new in the app shows up too, until it gets a better name here.
  const named = new Set(NAMED.map(([n]) => n));
  for (const c of commands()) {
    if (named.has(c.name) || c.name in OUT || STATE.has(c.name) || c.args.some((a) => a.required && a.name !== "name")) continue;
    list.push({ name: c.name, args: {}, ...titleOf(c.name), words: c.about });
  }
  return list.map((e) => ({ ...e, id: `${e.name}:${JSON.stringify(e.args)}` }));
}

// The key bound to an entry: `name` or `name:value` in keys.json, global or
// (for the terminal's commands) the terminal section.
export function keyOf(e, bound) {
  const v = Object.values(e.args)[0];
  const want = v === undefined ? e.name : `${e.name}:${v}`;
  const k = bound.find((b) => b.section === "global" && b.action === want) ?? bound.find((b) => b.section === "terminal" && b.action === want);
  return k ? k.keys : null;
}

// "ctrl-shift-p" -> ["ctrl", "shift", "p"]; "ctrl--" -> ["ctrl", "-"].
function keyParts(k) {
  return k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-");
}

// Fuzzy score of `q` in `text`, with the matched positions; null: no match.
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0;
  let at = 0;
  let run = 0;
  const hits = [];
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1]);
    run = i === at && hits.length ? run + 1 : 0;
    score += 1 + (start ? 6 : 0) + run * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

export default class Palette extends View {
  init(_props, cx) {
    this.query = "";
    this.input = InputState.new({ placeholder: "Type a command…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]?.e));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = 0;
    // How far the list is scrolled, px.
    this.scroll = 0;
    this.recent = JSON.parse(localStorage.getItem("recent") ?? "[]");
    this.handle = cx.focus_handle();
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(e) {
    if (!e) return;
    this.recent = [e.id, ...this.recent.filter((r) => r !== e.id)].slice(0, 20);
    localStorage.setItem("recent", JSON.stringify(this.recent));
    this.close();
    if (e.go) return e.go();
    if (e.name === "mod.clone") {
      openOverlay({ mod: "prompt", kind: "dialog", width: 380, props: {
        title: "Duplicate mod", hint: "Mod to copy; creates <name>-copy",
        command: { name: "mod.clone", args: {} },
      } });
    } else {
      run(e.name, e.name === "layout.clone" ? { name: shared("layout") ?? "main" } : e.args);
    }
  }

  // The rows to show: grouped when empty, ranked while typing.
  rows() {
    const all = entries();
    const q = this.query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) {
      const recent = this.recent.map((id) => all.find((e) => e.id === id)).filter(Boolean).slice(0, 5);
      const rest = GROUPS.slice(1).flatMap((g) => all.filter((e) => e.group === g && !recent.includes(e)));
      const others = all.filter((e) => !GROUPS.includes(e.group) && !recent.includes(e));
      return [...recent.map((e) => ({ e, head: "Recent" })), ...[...rest, ...others].map((e) => ({ e, head: e.group }))];
    }
    const rank = (e) => this.recent.indexOf(e.id);
    return all
      .map((e) => {
        const title = fuzzy(q, e.title);
        const more = fuzzy(q, `${e.group} ${e.title} ${e.name} ${e.words}`);
        const best = title ?? (more && { score: more.score - 4, hits: [] });
        return best && { e, score: best.score, hits: best.hits };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || (rank(a.e) < 0 ? 99 : rank(a.e)) - (rank(b.e) < 0 ? 99 : rank(b.e)));
  }

  title(t, text, hits, on) {
    if (!hits?.length) return div().text_color(on ? t.foreground : t.muted).child(text);
    const parts = [];
    let cur = "";
    let lit = false;
    [...text].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) {
        parts.push([cur, lit]);
        cur = "";
      }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);
    return h_flex().children(parts.map(([s, h]) => div().text_color(h ? t.accent : on ? t.foreground : t.muted).when(h, (d) => d.font_semibold()).child(s.replace(/ /g, "\u00a0"))));
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const bound = keys();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    // One continuous strip: each row (and the group title before it) at a
    // fixed y. Scrolling moves the strip in pixels, only as far as it takes to
    // keep the selected row (and its group's title, if it opens one) in view.
    const tops = [];
    let y = 0;
    rows.forEach((r, i) => {
      const head = !this.query && (i === 0 || r.head !== rows[i - 1].head);
      tops.push({ head, title: y, row: y + (head ? HEAD_H : 0) });
      y += (head ? HEAD_H : 0) + ROW_H;
    });
    const total = y;
    const fixed = total > LIST_H;
    this.maxScroll = Math.max(0, total - LIST_H);
    const sel = tops[this.at];
    if (sel) {
      const from = sel.head ? sel.title : sel.row;
      if (from < this.scroll) this.scroll = from;
      if (sel.row + ROW_H > this.scroll + LIST_H) this.scroll = sel.row + ROW_H - LIST_H;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    const key = (k) =>
      h_flex().gap(3).children(keyParts(k).map((p) => div().px(5).rounded(4).border_1().border_color(t.border).bg(t.raised).text_size(11).text_color(t.dim).child(p)));
    // In a scrolling list each item is placed at its edges from the model
    // above, not stacked: GPUI rounds every height to whole pixels, and a
    // stack of rounded heights drifts away from the model (19 px at zoom 1.3
    // by row 40, cutting the selection off). Edges from the model can't add up.
    const place = (el, start, end) =>
      fixed
        ? el.absolute().left(0).right(0).top(start - this.scroll).bottom(LIST_H - (end - this.scroll))
        : el.flex_none().h(end - start);
    const visible = (start, end) => !fixed || (end > this.scroll && start < this.scroll + LIST_H);
    const list = [];
    rows.forEach((r, i) => {
      const { head, title, row } = tops[i];
      if (head && visible(title, row)) list.push(place(h_flex(), title, row).px(14).pb(4).items_end().text_size(11).font_semibold().text_color(t.dim).child(r.head));
      if (!visible(row, row + ROW_H)) return;
      const on = i === this.at;
      const k = keyOf(r.e, bound);
      list.push(
        place(h_flex(), row, row + ROW_H)
          .id(`pl-${i}`)
          .mx(6)
          .px(10)
          .gap(10)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .text_size(12.8)
          .when(on, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r.e))
          .child(div().flex_1().min_w(0).child(this.title(t, r.e.title, r.hits, on)))
          .when(Boolean(this.query), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(r.e.group)))
          .when(Boolean(k), (el) => el.child(key(k))),
      );
    });
    return v_flex()
      .id("palette")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
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
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(10)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg(win()?.platform === "macos" ? "frame/palette/command.svg" : "mods/workspace-chrome/search.svg").size(16).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        rows.length
          ? div()
              .id("palette-rows")
              .relative()
              .mb(6)
              .when(fixed, (el) => el.h(LIST_H).overflow_hidden())
              .on_scroll_wheel((e, cx) => {
                // The event bridge converts both wheel and touchpad deltas to pixels.
                this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, this.maxScroll));
                // The selection stays on screen, so the next frame doesn't scroll back to it.
                // A row that opens a group is shown with its title, so the title counts.
                while (this.at < rows.length - 1 && (tops[this.at].head ? tops[this.at].title : tops[this.at].row) < this.scroll) this.at++;
                while (this.at > 0 && tops[this.at].row + ROW_H > this.scroll + LIST_H) this.at--;
                cx.notify();
              })
              .children(fixed ? list : [v_flex().children(list)])
          : div().px(16).py(14).text_size(13).text_color(t.dim).child(`Nothing matches "${this.query}". Places are in the picker.`),
      );
  }
}
