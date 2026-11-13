// The keys dialog's map (screens.js Keys): every binding keys() lists, in
// plain words, grouped so the dialog reads as a map of the window, plus the
// keys Fireflies' core handles outside keys.json and what works once the
// keyboard is in the sidebar, the tab strip, a pane's header, the parked
// chips, the toasts or a menu (nav.js's ? lists).
//
// Pure: no herdr. rows() takes keys() and commands() and gives the dialog's
// list: { head } eyebrows and { k, label, group, lines? } rows.

import { SIDEBAR_HELP, STRIP_HELP, HEADER_HELP, PARKED_HELP, MENU_HELP } from "./nav.js";

/** The dialog's groups, in order. */
export const GROUPS = [
  "keyboard focus", "spaces", "tabs", "panes", "agents", "windows and panels",
  "in a terminal", "in the editor", "in the web pane", "app", "more",
];

const PLACE = { left: "to the left", right: "to the right", up: "above", down: "below" };
const NTH = (what) => (n) => `${what} ${n}`;

/** Plain words for every shipped binding (and Nocturne's unbound commands). */
const WORDS = {
  "app.quit": "Quit Fireflies",
  "app.hide": "Hide the window",
  "app.hide_others": "Hide the other apps",
  "app.show_all": "Show all apps",
  "app.help": "These keys",
  "app.palette": "Command palette: every command by name",
  "app.settings": "Settings",
  "app.zoom_in": "Make everything bigger",
  "app.zoom_out": "Make everything smaller",
  "app.zoom_reset": "Everything back to normal size",
  "app.reset": "Escape hatch: the default layout and keys back",
  "app.welcome": "The welcome again",
  "app.whats_new": "What's new in this release",
  "app.feedback": "Send feedback",
  "window.close": "Close the window",
  "window.minimize": "Minimize the window",
  "window.maximize": "Maximize the window, or back",
  "layout.switch": "Next layout",
  "layout.toggle:sidebar": "Show or hide the sidebar",
  "mod.open:picker": "Find a file",
  "agent.next": "Next agent, in the sidebar's order",
  "agent.prev": "Previous agent",
  "space.new": "New space",
  "space.close": "Close the space",
  "space.next": "Next space",
  "space.prev": "Previous space",
  "space.rename": "Rename the space",
  "space.select": NTH("Space"),
  "tab.new": "New tab",
  "tab.close": "Close the tab",
  "tab.next": "Next tab",
  "tab.prev": "Previous tab",
  "tab.rename": "Rename the tab",
  "tab.select": NTH("Tab"),
  "tab.settle": "Put the tab away (it keeps running)",
  "pane.split:right": "Split the pane: a terminal to the right",
  "pane.split:down": "Split the pane: a terminal below",
  "pane.split:left": "Split the pane: a terminal to the left",
  "pane.split:up": "Split the pane: a terminal above",
  "pane.split:auto": "Split the pane: below one beside others, else to the right",
  "pane.close": "Close the pane",
  "pane.zoom": "Zoom the pane, or show all panes again",
  "pane.park": "Park the pane as a chip under the tabs (it keeps running)",
  "pane.unpark": "Put the last parked pane back",
  "pane.float": "Float the pane's terminal over the tab",
  "pane.go": (d) => ({ left: "Focus the pane to the left (from the leftmost: the sidebar)", right: "Focus the pane to the right",
    up: "Focus the pane above (from the top: the tab strip)", down: "Focus the pane below" })[d] ?? `Focus the pane ${d}`,
  "pane.swap": (d) => `Swap the pane with the one ${PLACE[d] ?? d}`,
  "pane.resize": (d) => `Resize the pane: its divider a step ${d}`,
  "pane.font_bigger": "Bigger text in this pane",
  "pane.font_smaller": "Smaller text in this pane",
  "pane.font_reset": "This pane's text back to the app's size",
  "pane.equalize:all": "Even out the tab's panes",
  "pane.equalize:row": "Even out the panes side by side with this one",
  "pane.equalize:column": "Even out the panes stacked with this one",
  "terminal.search": "Search the terminal's screen and scrollback",
  "terminal.copy": "Copy the selection (nothing selected: the key goes to the program)",
  "terminal.paste": "Paste",
  "terminal.paste_image": "Paste the clipboard's image as a file (a terminal on another machine)",
  "overlay.focus": "Focus the next floating window: Git, GitHub, a floating terminal",
  "overlay.focus:prev": "Focus the previous floating window",
  "overlay.focus:none": "The keyboard back from a floating window to the pane",
  "overlay.close": "Close the window or dialog in front",
  "send:\u001bb": "Back a word",
  "send:\u001bf": "Forward a word",
  "send:\u0017": "Delete the word before the cursor",
  "send:\u0001": "To the line's start",
  "send:\u0005": "To the line's end",
  "send:\u0015": "Delete to the line's start",
  "terminal": "Goes to the program (Fireflies leaves it alone here)",
  // Nocturne (layout:nocturne, sky.js's command loop).
  "nocturne.sidebar": "Focus the sidebar (again: back to the pane)",
  "nocturne.focus": "Focus the sidebar",
  "nocturne.tabstrip": "Focus the tab strip (again: back to the pane)",
  "nocturne.header": "Focus the pane's header (again: back to the pane)",
  "nocturne.toast": "Act on the newest toast: go to its agent, open its request",
  "nocturne.toast-close": "Dismiss the newest toast (none: the update note)",
  "nocturne.toast-dismiss": "Dismiss the newest toast (none: the update note)",
  "nocturne.update-close": "Close the update note (\"Updated to …\")",
  "nocturne.next": "Next space, in the sidebar's order",
  "nocturne.prev": "Previous space, in the sidebar's order",
  "nocturne.space-new": "New space: pick its folder",
  "nocturne.fold": "Fold the sidebar into a rail, or open it",
  "nocturne.new": "New: a terminal, an agent or a panel, as a tab or a pane",
  "nocturne.git": "Git window",
  "nocturne.lazygit": "Git window",
  "nocturne.diff": "Git window, on its review",
  "nocturne.worktrees": "Git window, on its worktrees",
  "nocturne.github": "GitHub window",
  "nocturne.github-pr": "GitHub window, on a new pull request",
  "nocturne.github-run": "GitHub window, running a workflow",
  "nocturne.scripts": "Script runner",
  "nocturne.scripts-again": "Run the folder's last script again",
  "nocturne.scripts-failed": "The last failed script's output",
  "nocturne.procs": "Processes and ports",
  "nocturne.ports": "Processes and ports, on the ports",
  "nocturne.files": "Files pane, with the keyboard in it",
  "nocturne.picker": "Find a file",
  "nocturne.grep": "Search in the files",
  "nocturne.scratchpad": "Scratchpad: this repository's note, kept out of it",
  "nocturne.gridify": "Arrange the tab's panes in an even grid",
  "nocturne.pin": "Pin the focused pane (an agent, a web page, an editor...) to the top, or unpin it",
  "nocturne.pin-up": "Move the pinned agent up in the jar, a pinned pane left on its shelf",
  "nocturne.pin-down": "Move the pinned agent down in the jar, a pinned pane right on its shelf",
  "nocturne.agent-next": "Next agent, then on through the shelf's pinned panes (web pages, editors...)",
  "nocturne.agent-prev": "Previous agent, or back through the shelf's pinned panes",
  "nocturne.dock": "Move the focused pane to the dock (a space tied to no folder) and pin it to the shelf",
  "nocturne.dock-web": "New web pane in the dock, pinned to the shelf",
  "nocturne-notifications.open": "Notifications: what your agents ask, answered from one place",
  // The editor (mod:nocturne-editor).
  "nocturne-editor.save": "Save",
  "nocturne-editor.find": "Find",
  "nocturne-editor.replace": "Find and replace",
  "nocturne-editor.line": "Go to a line",
  "nocturne-editor.next-problem": "Next problem",
  "nocturne-editor.prev-problem": "Previous problem",
  "nocturne-editor.problems": "The problems list, open or closed",
  "nocturne-editor.definition": "Go to the definition",
  "nocturne-editor.hover": "What's under the cursor: its type and docs",
  "nocturne-editor.hover-more": "Hover: say more",
  "nocturne-editor.hover-less": "Hover: say less",
  "nocturne-editor.reload": "Read the file again from disk",
  "nocturne-editor.vim": "Vim keys on or off",
  "nocturne-editor.wrap": "Word wrap on or off",
  "nocturne-editor.keys": "The editor's keys",
  "nocturne-editor.preview": "Markdown preview on or off",
  "nocturne-editor.next-tab": "Next file tab",
  "nocturne-editor.prev-tab": "Previous file tab",
  "nocturne-editor.close-tab": "Close the file tab",
  // The web pane (mod:nocturne-browser).
  "nocturne-browser.url": "The address bar",
  "nocturne-browser.reload": "Reload the page",
  "nocturne-browser.back": "Back a page",
  "nocturne-browser.forward": "Forward a page",
  "nocturne-browser.inspect": "The web inspector",
  "nocturne-browser.tab_new": "New web tab",
  "nocturne-browser.tab_close": "Close the web tab",
  "nocturne-browser.tab_next": "Next web tab",
  "nocturne-browser.tab_prev": "Previous web tab",
};

// A group's rows in this order (keys() comes sorted by key): the blocks first in
// keyboard focus, then the order WORDS lists them; directions left, right, up, down.
const FIRST = ["nocturne.sidebar", "nocturne.focus", "nocturne.tabstrip", "nocturne.header", "nocturne.toast", "nocturne.toast-close", "nocturne.toast-dismiss"];
const ORDER = [...FIRST, ...Object.keys(WORDS).filter((a) => !FIRST.includes(a))];
const ARG = { left: 0, right: 1, up: 2, down: 3 };
function rank(action) {
  const name = String(action).split(":")[0], arg = String(action).split(":")[1] ?? "";
  const i = ORDER.indexOf(action) >= 0 ? ORDER.indexOf(action) : ORDER.indexOf(name);
  return [i < 0 ? ORDER.length : i, ARG[arg] ?? (Number(arg) || 0)];
}
const byRank = (a, b) => { const x = rank(a.k.action), y = rank(b.k.action); return x[0] - y[0] || x[1] - y[1]; };

/** The group for an action (its section decides first: a terminal's, a mod's). */
function groupOf(section, action) {
  if (section === "terminal" || action.startsWith("send:")) return "in a terminal";
  if (section === "mod:nocturne-editor") return "in the editor";
  if (section === "mod:nocturne-browser") return "in the web pane";
  if (section.startsWith("mod:")) return `in ${section.slice(4)}`;
  const name = action.split(":")[0];
  if (/^nocturne\.(sidebar|focus|tabstrip|header|toast)/.test(name) || name === "pane.go" || name.startsWith("overlay.")) return "keyboard focus";
  if (/^space\./.test(name) || /^nocturne\.(next|prev|space-new)$/.test(name)) return "spaces";
  if (/^tab\./.test(name) || name === "nocturne.new") return "tabs";
  if (/^pane\./.test(name) || name === "nocturne.gridify") return "panes";
  if (/^agent\./.test(name) || /^nocturne\.pin/.test(name)) return "agents";
  if (/^terminal\./.test(name)) return "in a terminal";
  if (/^nocturne(-notifications)?\./.test(name) || /^app\.(help|palette|settings)$/.test(name) || /^layout\./.test(name) || /^mod\.open/.test(name)) return "windows and panels";
  if (/^(app|window)\./.test(name)) return "app";
  return "more";
}

/** The first plain sentence of a command's `about` (commands()): a user's own binding's label. */
function fromAbout(about) {
  const s = String(about ?? "").split(/(?<=[.:;])\s|\s\(/)[0].replace(/[.:;]$/, "").trim();
  return s || null;
}

/** An action in plain words: shipped ones by hand, a user's by its command's own about, else its name. */
export function keyLabel(action, commands = []) {
  if (typeof action !== "string") return "";
  if (action.startsWith("{")) {
    try { const o = JSON.parse(action); return keyLabel(o.command, commands) + (o.args ? ` ${JSON.stringify(o.args)}` : ""); } catch { return action; }
  }
  if (WORDS[action] && typeof WORDS[action] === "string") return WORDS[action];
  if (action.startsWith("send:")) return "Types " + JSON.stringify(action.slice(5));
  const [name, arg] = [action.split(":")[0], action.split(":").slice(1).join(":")];
  const w = WORDS[name];
  if (typeof w === "function") return w(arg);
  if (typeof w === "string") return arg ? `${w}: ${arg}` : w;
  const about = fromAbout(commands.find((c) => c.name === name)?.about);
  if (about) return arg ? `${about}: ${arg}` : about;
  const words = name.replace(/[._-]/g, " ");
  return arg ? `${words} ${arg}` : words;
}

/** Has the action a hand-written label (the shipped keys all do: a test says so)? */
export function hasWords(action) {
  if (WORDS[action] && typeof WORDS[action] === "string") return true;
  return typeof WORDS[action.split(":")[0]] === "function";
}

/** A key as the dialog shows it: keys.json's spelling, "shift-/" as "?". */
export const pretty = (keys) => String(keys).replace(/shift-\//g, "?");

/** Keys Fireflies' core handles itself, outside keys.json. */
export const CORE = [
  { keys: "escape", action: "overlay.close", section: "core", group: "windows and panels", label: "Close the floating window or dialog in front" },
  { keys: "escape", action: "pane.drag", section: "core", group: "panes", label: "Stop dragging a pane (it stays where it was)" },
  { keys: "escape", action: "terminal.search", section: "core", group: "in a terminal", label: "Close the terminal's search" },
];

/** What works once a block has the keyboard: the dialog's rows that open into their lists.
 *  `entry`: the command that gets the keyboard there (its key is shown). */
export const SURFACES = [
  { id: "sidebar", entry: "nocturne.sidebar", label: "In the sidebar", lines: SIDEBAR_HELP },
  { id: "tabstrip", entry: "nocturne.tabstrip", label: "In the tab strip", lines: STRIP_HELP },
  { id: "header", entry: "nocturne.header", label: "In a pane's header", lines: HEADER_HELP },
  { id: "parked", entry: null, keys: "j from the header", label: "On the parked panes", lines: PARKED_HELP },
  { id: "toasts", entry: "nocturne.toast", label: "Toasts", lines: [
    ["nocturne.toast", "act on the newest: go to its agent, open its request"], ["nocturne.toast-close", "dismiss the newest"],
    ["click", "act on that one"]] },
  { id: "menus", entry: null, keys: "in a menu", label: "In a menu (right-click, ⋯, the new menu)", lines: MENU_HELP },
  { id: "panes", entry: null, keys: "?", label: "In a pane or window: its own keys on ? (the editor: cmd-k ?, vim: space ?)", lines: [
    ["?", "the pane's or window's keys: files, Markdown, preview, web, agents, usage, Git, GitHub, scripts, notifications, picture in picture"],
    ["cmd-k ?", "the editor's keys (vim's normal mode: space ?), and where ? would type: the scripts' filter"],
    ["esc", "the keys away again"]] },
];

/** A line's keys: a command's binding as keys.json spells it, else the line's own text. */
function lineKeys(k, bindings) {
  if (!/^[a-z-]+\.[a-z-]+$/.test(k)) return k;
  return pretty(bindings.find((b) => b.action === k)?.keys ?? "not bound");
}

/** The bindings that apply in `layout`: another layout's section is left out, and a
 *  global key the layout binds again shows the layout's (cmd-b folds Nocturne's sidebar). */
export function shown(bindings, layout = "nocturne") {
  const own = `layout:${layout}`;
  const rebound = new Set(bindings.filter((b) => b.section === own).map((b) => b.keys));
  return bindings.filter((b) => b.section === "global" ? !rebound.has(b.keys) : !b.section.startsWith("layout:") || b.section === own);
}

/** The dialog's list for `bindings` (keys()), filtered by `filter` (every word must match
 *  the key, its words or its group). `open`: the surface ids whose lines show. */
export function rows(bindings, { commands = [], filter = "", open = new Set(), layout = "nocturne" } = {}) {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => words.every((w) => text.toLowerCase().includes(w));
  const all = [
    ...shown(bindings, layout).map((k) => ({ k: { ...k, shown: pretty(k.keys) }, label: keyLabel(k.action, commands), group: groupOf(k.section, k.action) })),
    ...CORE.map((c) => ({ k: { ...c, shown: pretty(c.keys) }, label: c.label, group: c.group })),
  ];
  const surfaces = SURFACES.map((s) => ({ id: s.id, entry: s.entry, keys: s.keys, label: s.label,
    lines: s.lines.map(([k, what]) => [lineKeys(k, bindings), what]) }));
  // A block's rows: its lines unfolded under it while open, or while the filter finds them.
  const unfold = (row, s, self) => {
    const lines = s.lines.filter(([k, what]) => self || hit(`${k} ${what} ${s.label}`));
    if (!self && !lines.length) return null;
    const open_ = open.has(s.id) || (words.length > 0 && !self);
    return [{ ...row, surface: s.id, open: open_ },
      ...(open_ ? (self ? s.lines : lines) : []).map(([k, what]) => ({ line: true, of: s.id, k: { keys: k, shown: k }, label: what }))];
  };
  const list = [];
  for (const g of GROUPS.concat([...new Set(all.map((r) => r.group))].filter((g) => !GROUPS.includes(g)))) {
    const text = (r) => `${r.k.keys} ${r.k.shown} ${r.label} ${r.k.action} ${g}`;
    const out = [];
    const used = new Set();
    for (const r of all.filter((r) => r.group === g).sort(byRank)) {
      // The command that gives a block the keyboard opens into that block's keys (its first binding only).
      const s = g === "keyboard focus" && surfaces.find((x) => x.entry === r.k.action && !used.has(x.id));
      if (s) {
        used.add(s.id);
        const rows_ = unfold(r, s, hit(text(r)));
        if (rows_) out.push(...rows_);
      } else if (hit(text(r))) out.push(r);
    }
    // The blocks with no command of their own (the parked chips, menus, panes) end the group.
    if (g === "keyboard focus") {
      for (const s of surfaces.filter((x) => !used.has(x.id))) {
        const keys = s.entry ? lineKeys(s.entry, bindings) : s.keys;
        const r = { k: { keys, shown: keys, action: s.entry ?? "", section: "nocturne" }, label: s.label, group: g };
        const rows_ = unfold(r, s, hit(`${r.k.keys} ${s.label} ${g}`));
        if (rows_) out.push(...rows_);
      }
    }
    if (out.length) list.push({ head: g }, ...out);
  }
  return list;
}
