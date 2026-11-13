// The command palette in Nocturne's look (the layout's palette_mod, on the
// DwieDave fork): the shipped palette's commands, fuzzy ranking and recents,
// drawn square and 1-bit like popup.js. The row under the cursor sits on a
// dithered band with a blue edge; groups are eyebrows; keys are plain glyphs.
// Enter runs, ↑/↓ (ctrl-n/p, ctrl-j/k, page up/down) move, Esc closes. Places (spaces, tabs) stay
// in the picker.
// The "Open" group holds Nocturne's own panels (panels.js): each beside the
// focused pane (or where it always goes) and in a new tab, plus the sidebar fold.
// "Find" is the file picker and grep (picker.js). The focused pane's own
// commands (an editor's, a web pane's, ...) lead the list while it's focused
// (PANE); the git and GitHub windows' while they're open.
// Every command a person can trigger is either an entry here or in OUT with
// the reason it stays out (scripts/nocturne-palette.test.ts holds that line).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { commands, layouts, keys, run, theme, props, closeOverlay, openOverlay, shared, setShared, window as win, agents, panes, terminals, updates, spaces } from "herdr";
import { dither, eyebrow, focusedPane, panePinnedNow, pinPane, pinKey, movePin, jar, dockPane, dockWeb } from "./kit.ts";
import { isDock } from "./dock.ts";
import { onShelf } from "./pins.ts";
import { panels, here, terminalPane, terminalTab } from "./panels.js";
import { toggleDeck, lastFailed } from "./scripts.js";
import { toggleProcs } from "./procs.js";
import { gitOpen, openWorktrees } from "./git.js";
import { githubOpen } from "./github.js";
import { togglePicker } from "./picker.js";
import { openNewMenu } from "./newmenu.js";
import { NAME_PANE, EDIT_SPACE } from "./menu.js";
import { TOASTS, toastKey } from "./toast.js";
import { updateShown, dismissUpdate } from "./screens.js";

// Fixed heights, so the list keeps one height while you move.
const SHOWN = 12;
const ROW_H = 28;
const HEAD_H = 30;
const LIST_H = SHOWN * ROW_H;
const GROUPS = ["Recent", "Editor", "Web", "Markdown", "Preview", "Agents", "Usage", "Files", "Git", "GitHub", "Find", "Open",
  "Tab", "Pane", "Space", "Layout", "Terminal", "Agent", "Window", "App"];
// Each group's mark (mods/workspace-chrome/<icon>.svg).
const ICONS = {
  Recent: "clock", Editor: "file-text", Web: "monitor", Markdown: "file-text", Preview: "image", Agents: "layers", Usage: "clock", Files: "folder",
  Git: "git-compare", GitHub: "mods/nocturne/art/github.svg", Find: "search", Open: "layers", Tab: "square", Pane: "panel-right",
  Space: "folder", Layout: "sidebar", Terminal: "terminal", Agent: "layers", Window: "square", App: "settings",
};
const chrome = (n) => (n.includes("/") ? n : `mods/workspace-chrome/${n}.svg`);

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/**
 * The focused pane's own commands (`<mod>.<command>`, its nextCommand()),
 * shown while a pane of that mod is focused: [group, [command, title, words, when?(pane)]].
 * Their keys are the mod's section in keys.json (`mod:<mod>`).
 */
const PANE = {
  "editor": ["Editor", [
    ["save", "Save the file", "write disk"],
    ["find", "Find in the file…", "search text"],
    ["replace", "Find and replace…", "search substitute text"],
    ["line", "Go to line…", "jump goto line column number"],
    ["definition", "Go to definition", "lsp jump symbol source"],
    ["hover", "Show type and docs here", "hover info lsp card signature"],
    ["next-problem", "Next problem", "error warning diagnostic lsp"],
    ["prev-problem", "Previous problem", "error warning diagnostic lsp"],
    ["problems", "Show or hide the problems list", "errors warnings diagnostics drawer lsp"],
    ["reload", "Reload the file from disk", "revert refresh discard changes"],
    ["vim", "Vim mode on or off", "vim modal keys normal insert"],
    ["wrap", "Word wrap on or off", "soft wrap long lines"],
    ["keys", "Editor keys", "help shortcuts list ? keybindings"],
    ["next-tab", "Next file tab", "tab buffer switch bn gt"],
    ["prev-tab", "Previous file tab", "tab buffer switch bp gT"],
    ["close-tab", "Close the file tab", "tab buffer close bd"],
    ["move-tab-left", "Move the file tab left", "tab buffer order reorder drag tabm"],
    ["move-tab-right", "Move the file tab right", "tab buffer order reorder drag tabm"],
    ["pop-out", "Pop the file tab out into its own pane", "tab buffer split detach own pane popout"],
    ["pop-out-tab", "Pop the file tab out into a new tab", "tab buffer detach window popout"],
    ["pop-in", "Move the file into the editor beside, as a tab", "tab buffer attach merge popin"],
    ["tab-menu", "The file tab's menu", "tab buffer menu actions"],
    ["preview", "Markdown: next view", "preview split text rendered cycle", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["preview-split", "Markdown: preview beside the text", "preview split rendered", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["preview-only", "Markdown: preview only", "preview rendered read", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["preview-text", "Markdown: text only", "preview source edit", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["preview-rendered", "Markdown: rendered, typed into", "rendered wysiwyg live edit preview", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-menu", "Markdown: the commands' list", "markdown commands format menu cmd-.", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-bold", "Markdown: bold", "strong format emphasis **", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-italic", "Markdown: italic", "emphasis format _", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-code", "Markdown: inline code", "code span backtick format", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-link", "Markdown: link", "url href anchor format", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-heading-up", "Markdown: heading level up", "heading title bigger # format", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-heading-down", "Markdown: heading level down", "heading title smaller # format", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-bullets", "Markdown: bullet list", "list unordered items -", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-numbers", "Markdown: numbered list", "list ordered items 1.", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-task", "Markdown: task box", "todo checkbox task [ ]", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-image", "Markdown: image from a file", "picture png jpg insert pick ![]", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-image-paste", "Markdown: paste an image", "picture screenshot clipboard png assets insert", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-tick", "Markdown: tick or untick a task", "todo checkbox done check [x]", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-quote", "Markdown: quote", "blockquote >", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-fence", "Markdown: code block", "fence code block ```", (p) => MARKDOWN.test(p?.props?.path ?? "")],
    ["md-rule", "Markdown: rule", "horizontal rule line separator ---", (p) => MARKDOWN.test(p?.props?.path ?? "")],
  ]],
  "browser": ["Web", [
    ["url", "Go to an address…", "url address bar location navigate open page"],
    ["reload", "Reload the page", "refresh stop"],
    ["back", "Back", "history previous page"],
    ["forward", "Forward", "history next page"],
    ["inspect", "Inspect the page", "web inspector devtools developer console"],
    ["pip", "Picture in picture", "pip video float player"],
    ["zoom_in", "Page zoom in", "bigger larger text"],
    ["zoom_out", "Page zoom out", "smaller text"],
    ["zoom_reset", "Page zoom back to normal", "reset size text"],
    ["tab_new", "New tab", "web browser tab open blank page"],
    ["tab_close", "Close the tab", "web browser tab shut"],
    ["tab_next", "Next tab", "web browser tab right switch"],
    ["tab_prev", "Previous tab", "web browser tab left switch"],
    ["tab_move_left", "Move the tab left", "web browser tab reorder order drag"],
    ["tab_move_right", "Move the tab right", "web browser tab reorder order drag"],
    ["pin_tab", "Pin the tab to the shelf (or unpin it)", "web browser tab pin shelf jar keep unpin"],
    ["tab_menu", "The tab's menu", "web browser tab menu pin move close"],
    ["keys", "Web pane keys", "help shortcuts list ? keybindings"],
  ]],
  "markdown": ["Markdown", [
    ["raw", "Show the source or the rendered page", "raw markdown source text toggle"],
    ["back", "Back to the previous file", "history link"],
    ["top", "Scroll to the top", "start beginning home"],
    ["bottom", "Scroll to the bottom", "end"],
    ["reload", "Reload the file", "refresh disk"],
    ["keys", "Markdown viewer keys", "help shortcuts list ? keybindings"],
  ]],
  "preview": ["Preview", [
    ["fit", "Fit to the pane", "zoom fit whole width"],
    ["actual", "Actual size", "zoom 100% one to one pixels"],
    ["zoom_in", "Zoom in", "bigger magnify"],
    ["zoom_out", "Zoom out", "smaller"],
    ["next", "Next file in the folder", "image picture following"],
    ["prev", "Previous file in the folder", "image picture"],
    ["page_next", "Next page", "pdf document"],
    ["page_prev", "Previous page", "pdf document"],
    ["rotate", "Rotate", "turn image picture"],
    ["background", "Checkerboard behind the picture", "transparency background alpha"],
    ["reload", "Reload the file", "refresh disk"],
    ["keys", "Preview keys", "help shortcuts list ? keybindings"],
  ]],
  "agent-graph": ["Agents", [
    ["follow", "Follow the selected agent", "graph track watch live"],
    ["working", "Next working agent", "graph busy jump follow"],
    ["in", "Zoom in", "graph bigger"],
    ["out", "Zoom out", "graph smaller"],
    ["reset", "Reset the view", "graph zoom pan fit"],
    ["keys", "Agents graph keys", "help shortcuts list ? keybindings"],
  ]],
  "usage": ["Usage", [
    ["refresh", "Check usage again", "limits quota refresh reload claude"],
    ["keys", "Usage keys", "help shortcuts list ? keybindings"],
  ]],
  "file-tree": ["Files", [
    ["keys", "Files pane keys", "help shortcuts list ? keybindings"],
    ["look", "Show or hide the preview", "preview split quick look peek file viewer space"],
  ]],
};

/** The focused pane's own commands, as entries. */
function paneEntries() {
  const h = here();
  const p = h.pane ? panes().find((x) => x.pane === h.pane) : null;
  const own = p?.mod && PANE[p.mod];
  if (!own) return [];
  const [group, list] = own;
  return list.filter(([, , , when]) => !when || when(p)).map(([c, title, words]) => {
    const name = `${p.mod}.${c}`;
    return { name, args: {}, group, title, words, go: () => run(name) };
  });
}

/** The git and GitHub windows' own commands, while they're open. */
function windowEntries() {
  const out = [];
  const add = (name, group, icon, title, words) => out.push({ name, args: {}, group, icon, title, words, go: () => run(name) });
  if (gitOpen()) {
    add("git.refresh", "Git", "git-compare", "Git: refresh", "reload status reread");
    add("git.review", "Git", "eye", "Git: review the changes", "diff review files reviewed");
  }
  if (githubOpen()) {
    const gh = "mods/nocturne/art/github.svg";
    add("github.prs", "GitHub", gh, "GitHub: pull requests", "prs tab list");
    add("github.actions", "GitHub", gh, "GitHub: actions", "workflows runs ci checks tab");
    add("github.projects", "GitHub", gh, "GitHub: projects", "board items issues tab");
    add("github.diff", "GitHub", gh, "GitHub: diff of the selected pull request", "pr changes review files");
    add("github.fork", "GitHub", gh, "GitHub: switch between fork and upstream", "fork upstream origin remote repo");
    add("github.refresh", "GitHub", gh, "GitHub: refresh", "reload fetch again");
    add("github.keys", "GitHub", gh, "GitHub: keys", "help shortcuts list ? keybindings");
  }
  return out;
}

/** The file picker and grep (picker.js): the space's folder, else the focused pane's. */
function findEntries() {
  return [
    { name: "nocturne.picker", args: {}, group: "Find", icon: "search", title: "Find a file…",
      words: "open file picker fuzzy go to file quick open search name path", go: () => togglePicker("files") },
    { name: "nocturne.grep", args: {}, group: "Find", icon: "search", title: "Grep the project…",
      words: "grep search text in files find content ripgrep rg project folder", go: () => togglePicker("grep") },
  ];
}

/** Nocturne's panels as palette entries: `go` runs them; `bind` is their key in keys.json's layout section. */
function openEntries() {
  // The scratchpad is a panel too (panels.js): its pick runs nocturne.scratchpad(-tab), opened by the sidebar's copy.
  const bind = { files: "nocturne.files", git: "nocturne.git", diff: "nocturne.diff", worktrees: "nocturne.worktrees", github: "nocturne.github", scratchpad: "nocturne.scratchpad" };
  const bindTab = { scratchpad: "nocturne.scratchpad-tab" };
  const out = [];
  for (const p of panels()) {
    const where = p.fixed === "float" ? "floating over the tab" : p.fixed === "edge" ? "down the right edge" : "beside the focused pane";
    out.push({ name: "nocturne", args: { panel: p.id }, group: "Open", icon: p.icon, bind: bind[p.id],
      title: p.open?.() ? `Close ${p.name.toLowerCase()}` : p.name, words: `open ${p.words ?? ""} ${where}`, go: () => p.pane() });
    out.push({ name: "nocturne", args: { panel: p.id, tab: true }, group: "Open", icon: p.icon, bind: bindTab[p.id],
      title: `${p.name} in a new tab`, words: `open ${p.words ?? ""} tab`, go: () => p.tab() });
  }
  // The focused pane's folder as a files pane of its own (files.open), beside it or in a tab.
  const h = here();
  if (h.folder) {
    const at = { path: h.folder, ...(h.pane ? { pane: h.pane } : {}), ...(h.on ? { on: h.on } : {}) };
    out.push({ name: "files.open", args: at, group: "Open", icon: "files",
      title: "Files pane of this folder", words: "files tree explorer folder browse split beside new pane", go: () => run("files.open", at) });
    out.push({ name: "files.open", args: { ...at, in: "tab" }, group: "Open", icon: "files",
      title: "Files of this folder in a new tab", words: "files tree explorer folder browse tab", go: () => run("files.open", { ...at, in: "tab" }) });
  }
  if (h.folder) {
    out.push({ name: "nocturne.github-pr", args: {}, group: "Open", icon: "git-branch", bind: "nocturne.github-pr",
      title: "GitHub: new pull request…", words: "github pr pull request create open new gh branch push", go: () => run("nocturne.github-pr") });
    out.push({ name: "nocturne.github-run", args: {}, group: "Open", icon: "terminal", bind: "nocturne.github-run",
      title: "GitHub: run a workflow…", words: "github actions workflow dispatch run trigger manual gh ci deploy", go: () => run("nocturne.github-run") });
  }
  out.push({ name: "nocturne", args: { fold: true }, group: "Open", icon: "sidebar", bind: "nocturne.fold",
    title: "Fold or open the sidebar", words: "toggle sidebar sky rail collapse hide", go: () => run("nocturne.fold") });
  out.push({ name: "nocturne", args: { scripts: true }, group: "Open", icon: "terminal", bind: "nocturne.scripts",
    title: "Run a script…", words: "scripts runner tasks npm bun just make cargo test build dev background stop", go: () => toggleDeck({ centered: true }) });
  out.push({ name: "nocturne", args: { scripts: "again" }, group: "Open", icon: "terminal", bind: "nocturne.scripts-again",
    title: "Run the last script again", words: "scripts runner repeat rerun last again", go: () => toggleDeck({ centered: true, again: true }) });
  out.push({ name: "nocturne", args: { procs: true }, group: "Open", icon: "terminal", bind: "nocturne.procs",
    title: "Processes and ports…", words: "processes tree kill end stop pid ps top activity monitor ports listening server", go: () => toggleProcs({ centered: true }) });
  out.push({ name: "nocturne", args: { procs: "ports" }, group: "Open", icon: "terminal", bind: "nocturne.ports",
    title: "Listening ports…", words: "ports listening localhost server dev open browser copy address kill lsof", go: () => toggleProcs({ centered: true, tab: "ports" }) });
  if (lastFailed()) {
    out.push({ name: "nocturne.scripts-failed", args: {}, group: "Open", icon: "terminal",
      title: "Show the last failed script", words: "scripts runner failed error exit output log", go: () => toggleDeck({ centered: true, focus: "runs", show: lastFailed() }) });
  }
  out.push({ name: "nocturne.new", args: {}, group: "Open", icon: "plus", title: "New…",
    words: "plus new menu create terminal web pane tab agent space worktree", go: () => openNewMenu({ centered: true }) });
  // The + new menu's agents (the last ones this machine reported): beside the focused pane, or in a tab.
  const machine = h.space?.machine ?? "";
  for (const a of (shared("new-menu.agents")?.[machine] ?? []).filter((x) => x?.installed && x.run)) {
    out.push({ name: "terminal.open", args: { agent: a.key }, group: "Agent", icon: "terminal",
      title: `Start ${a.name}`, words: `agent new start launch run beside pane ${a.key}`, go: () => terminalPane(a.run) });
    out.push({ name: "tab.new", args: { agent: a.key }, group: "Agent", icon: "terminal",
      title: `Start ${a.name} in a new tab`, words: `agent new start launch run tab ${a.key}`, go: () => terminalTab(a.run, a.name) });
  }
  if (h.space) {
    out.push({ name: "nocturne", args: { worktree: "new" }, group: "Space", icon: "git-branch", title: "New worktree…",
      words: "git branch checkout folder space worktree add", go: () => openWorktrees({ space: h.space.id, action: "new" }) });
    out.push({ name: "nocturne", args: { space: "folder" }, group: "Space", icon: "folder", title: "Change this space's folder…",
      words: "space folder directory attach repo cwd", go: () => setShared(EDIT_SPACE, { id: h.space.id, kind: "folder", at: Date.now() }) });
  }
  // While the git window is open: what its main view shows, as a pane (its ctrl-p) or a tab (ctrl-shift-p).
  if (gitOpen()) {
    out.push({ name: "git.open-pane", args: {}, group: "Open", icon: "panel-right", bind: "git.open-pane",
      title: "Git: open the diff as a pane", words: "git diff pane split beside review patch commit stash", go: () => run("git.open-pane") });
    out.push({ name: "git.open-pane-tab", args: {}, group: "Open", icon: "square", bind: "git.open-pane-tab",
      title: "Git: open the diff in a new tab", words: "git diff tab review patch commit stash", go: () => run("git.open-pane-tab") });
  }
  out.push({ name: "nocturne", args: { gridify: true }, group: "Pane", icon: "mods/equalize-panes/grid.svg", bind: "nocturne.gridify",
    title: "Gridify panes", words: "grid tile arrange rearrange even out equalize layout", go: () => run("nocturne.gridify") });
  // Pinning the focused pane to the top of the sky, whatever it shows: an agent,
  // a shell, a web page, an editor (kit.js pinPane; menu.js pinItems).
  // (Not named `here`: that is panels.js's, called above.)
  const target = focusedPane();
  if (target) {
    const on = panePinnedNow(target), key = pinKey(target);
    const what = target.terminal && agents().some((a) => a.address === target.terminal) ? "agent" : "pane";
    const group = what === "agent" ? "Agent" : "Pane";
    out.push({ name: "nocturne", args: { pin: true }, group, icon: on ? "pin-off" : "pin", bind: "nocturne.pin",
      title: on ? `Unpin this ${what}` : `Pin this ${what} to the top`, words: "pin unpin keep top jar sidebar fireflies watch orchestrator dock web page editor files terminal", go: () => pinPane(target, !on) });
    // Its place in the jar, while it has a neighbor to swap with.
    // A firefly moves up and down in the jar, a pane's tile left and right on its shelf.
    const all = on ? jar() : [], it = all.find((x) => x.key === key);
    const kin = it ? all.filter((x) => onShelf(x) === onShelf(it)) : [], i = kin.indexOf(it);
    const [up, down] = what === "agent" ? ["up in the jar", "down in the jar"] : ["left on the shelf", "right on the shelf"];
    if (i > 0) out.push({ name: "nocturne.pin-up", args: {}, group, icon: "pin", title: `Move this ${what} ${up}`,
      words: "pin order jar shelf sidebar top left", go: () => movePin(key, -1) });
    if (i >= 0 && i < kin.length - 1) out.push({ name: "nocturne.pin-down", args: {}, group, icon: "pin", title: `Move this ${what} ${down}`,
      words: "pin order jar shelf sidebar bottom right", go: () => movePin(key, 1) });
  }
  // The dock (dock.js): a space tied to no folder for panes that belong to no
  // project; what goes there is pinned to the jar's shelf.
  out.push({ name: "nocturne.dock-web", args: {}, group: "Open", icon: "monitor", bind: "nocturne.dock-web", title: "New web pane in the dock",
    words: "dock web browser page pane default space no folder shelf pin keep", go: () => dockWeb() });
  const docked = target?.pane && panes().find((p) => p.pane === target.pane);
  if (docked && !docked.pane.includes("/") && !isDock(spaces().find((s) => s.tabs.some((c) => c.id === docked.tab)))) {
    out.push({ name: "nocturne.dock", args: {}, group: "Pane", icon: "archive", bind: "nocturne.dock", title: "Move this pane to the dock",
      words: "dock move keep default space no folder shelf pin", go: () => dockPane(docked) });
  }
  // The newest toast on screen (toast.js): run what it offers, or dismiss it.
  if ((Array.isArray(shared(TOASTS)) ? shared(TOASTS) : []).length) {
    out.push({ name: "nocturne.toast", args: {}, group: "App", icon: "check", title: "Do what the toast offers",
      words: "toast notification act open click newest", go: () => toastKey("toast") });
    out.push({ name: "nocturne.toast-close", args: {}, group: "App", icon: "x", title: "Dismiss the toast",
      words: "toast notification close hide dismiss newest", go: () => toastKey("toast-close") });
  }
  // The update note ("Updated to …", bottom right; screens.js), while it shows.
  if (updateShown()) {
    out.push({ name: "nocturne.update-close", args: {}, group: "App", icon: "x", title: "Close the update note",
      words: "update updated version note close hide dismiss what changed", go: () => dismissUpdate() });
  }
  out.push({ name: "notifications.open", args: {}, group: "Agent", icon: "layers", title: "Notifications",
    words: "notifications inbox agents waiting needs you permission questions bell overview", go: () => run("notifications.open") });
  // The keyboard into a chrome block (nav.js): the sidebar, the tab strip, the pane header.
  for (const [cmd, title, words] of [
    ["sidebar", "Keyboard to the sidebar", "focus sky spaces agents navigate"],
    ["tabstrip", "Keyboard to the tab strip", "focus tabs navigate"],
    ["header", "Keyboard to the pane header", "focus header tools navigate"],
  ]) out.push({ name: `nocturne.${cmd}`, args: {}, group: "Window", icon: "square", title, words, go: () => run(`nocturne.${cmd}`) });
  // The focused terminal: its name in the pane header (menu.js NAME_PANE).
  if (h.terminal) {
    const term = h.terminal;
    out.push({ name: "nocturne", args: { rename: "pane" }, group: "Pane", icon: "square-pen", title: "Rename this pane",
      words: "name title terminal label pane header", go: () => setShared(NAME_PANE, { terminal: term, at: Date.now() }) });
  }
  // The picture in picture player (pip), while its window is open (or a pane holds it).
  const pipWindow = Boolean(shared("pip.player")), pipPane = panes().some((p) => p.mod === "pip");
  if (pipWindow || pipPane) {
    for (const [cmd, icon, title, words] of [
      ...(pipWindow ? [
        ["pane", "panel-right", "Picture in picture into a pane", "pip video player pane split beside dock"],
        ["park", "archive", "Park picture in picture", "pip video player chip hide minimize"],
      ] : [["out", "square", "Picture in picture out of the pane", "pip video player window float undock"]]),
      ["toggle", "square", "Picture in picture: play / pause", "pip video player pause resume"],
      ["keys", "square", "Picture in picture: keys", "pip video player help shortcuts list ? keybindings"],
      ["mute", "square", "Picture in picture: sound off / on", "pip video player mute unmute volume audio"],
      ["rewind", "chevron-left", "Picture in picture: back 10 seconds", "pip video player skip rewind seek"],
      ["forward", "chevron-right", "Picture in picture: on 10 seconds", "pip video player skip forward seek"],
      ["back", "monitor", "Picture in picture: back into the page", "pip video player return web page end"],
      ["close", "x", "Close picture in picture", "pip video player stop end quit"],
    ]) {
      out.push({ name: `pip.${cmd}`, args: {}, group: "Open", icon, title, words, go: () => run(`pip.${cmd}`) });
    }
  }
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
  ["pane.split", { direction: "auto" }, "Pane", "Split beside", "auto vertical horizontal new pane longer side"],
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
  ["agent.next", {}, "Agent", "Next agent", "pinned shelf web page dock"],
  ["agent.prev", {}, "Agent", "Previous agent", "pinned shelf web page dock"],
  ["window.minimize", {}, "Window", "Minimize window", ""],
  ["window.maximize", {}, "Window", "Maximize window", "restore"],
  ["window.close", {}, "Window", "Close window", "quit"],
  ["overlay.focus", {}, "Window", "Next window", "focus cycle git github floating terminal keyboard front"],
  ["overlay.focus", { dir: "prev" }, "Window", "Previous window", "focus cycle git github floating terminal keyboard front"],
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

// Commands (and keys.json actions) that stay out of the list, each with why:
// most act on something you point at (ids, indexes, paths). A whole name
// covers its `name:value` keys too.
export const OUT = {
  "space.select": "a place: spaces are in the picker (cmd-p ... ctrl-1..9 pick by position)",
  "tab.select": "a place: tabs are in the picker (cmd-1..9 pick by position)",
  "space.move": "needs a space id and a position: drag it in the sidebar",
  "tab.move": "needs a tab id and a position: drag it in the tab strip",
  "pane.focus": "needs a pane: Focus pane left/right/up/down, or click it",
  "agent.focus": "needs an agent: the sidebar and the picker list them",
  "terminal.keep": "needs a terminal without a pane (a sub-agent): the sidebar's agents",
  "terminal.show": "needs a terminal: the sidebar's agents",
  "terminal.peek": "needs a terminal: the sidebar's agents",
  "terminal.kill": "needs a terminal: Close pane ends the focused one",
  "terminal.pin": "Pin this agent to the top (nocturne.pin) pins the focused agent through it",
  "float.view": "needs a view index: the floating terminal's own tabs",
  "layout.set": "needs a whole layout tree (agents and mods write it)",
  "layout.toggle": "needs a layout node id; the sidebar's is Fold or open the sidebar (nocturne.fold, cmd-b)",
  "layout.show": "needs a layout node id",
  "layout.hide": "needs a layout node id",
  "layout.resize": "needs a layout node id and a size: drag the divider",
  "layout.select": "needs a stack and a child id",
  "layout.focus": "needs a layout block id: Keyboard to the sidebar / tab strip / pane header do it for Nocturne's",
  "mod.open": "needs a mod name; the picker's is Go to space or tab…",
  "overlay.close": "closes the top dialog: esc does it, and the palette is the top dialog until it runs",
  "overlay.move": "needs how far to move: drag the window",
  "overlay.resizable": "needs a window id and its sizing (mods set it)",
  "native.debug": "a report for agents (herdr-app do native.debug): nothing to see from a list",
  "native.call": "needs a native view key and an action (mods call it)",
  "app.palette": "the palette itself",
  "app.theme": "needs a theme name: the Theme: … rows, and Settings: look",
  "app.open_url": "needs a URL: the Web panel's address bar (Go to an address… while a web pane is focused)",
  "editor.open": "needs a path: Find a file… opens files in the editor",
  "markdown.open": "needs a path: Find a file… opens Markdown files",
  "preview.open": "needs a path: Find a file… opens pictures, PDFs and the rest",
  "image.open": "needs a path (the old name of preview.open)",
  "space.folder": "needs a folder: Change this space's folder… asks for it",
  "tab.unsettle": "needs a put-away tab: showing it from the picker brings it back",
  // Nocturne's own (sky.js, tabs.js) and its mods' internal commands.
  "nocturne.focus": "internal: overlay.focus and pane.go hand a block the keyboard with it",
  "nocturne.lazygit": "the old name of nocturne.git (Git)",
  "nocturne.scripts-grant": "the failed nix-darwin toast's click (App Management): nothing to grant otherwise",
  "nocturne.toast-dismiss": "the old name of nocturne.toast-close (Dismiss the toast)",
  "file-tree.focus": "internal: hands the files pane the keyboard",
  "file-tree.take-panel": "internal: the files panel takes the keyboard when its pane is focused",
  "diff.focus": "internal: hands the diff the keyboard",
  "markdown.focus": "internal: hands the viewer the keyboard",
  "markdown.up": "scrolls half a page: a key for the viewer, not a list",
  "markdown.down": "scrolls half a page: a key for the viewer, not a list",
  "preview.focus": "internal: hands the preview the keyboard",
  "editor.focus": "internal: hands the editor the keyboard",
  "editor.hover-more": "acts on the open hover card (ctrl-= while it's up)",
  "editor.hover-less": "acts on the open hover card (ctrl-- while it's up)",
  "browser.focus": "internal: hands the web pane's bar the keyboard",
  "browser.web": "hands the keyboard to the page: click it",
  "browser.open": "a page for a pane by its slot (open:{url, slot}): the editor's links",
  "browser.show": "a tab for a pane by its slot (show:{slot, tab}): a web tab's tile on the shelf",
  "browser.tab_act": "internal: a pick in a web tab's menu (tab_act:{slot, tab, act})",
  "agent-graph.focus": "internal: hands the agents graph the keyboard",
  "usage.focus": "internal: hands the usage pane the keyboard",
  "pip.focus": "internal: hands the player the keyboard",
  "pip.unfocus": "the player's key that hands the keyboard back: esc in the player",
  "git.focus": "internal: hands the git window the keyboard",
  "scripts.focus": "internal: hands the script runner the keyboard",
  "scripts.keys": "the open script runner's ? (cmd-k ? while it filters): it lists its keys in place",
  "procs.focus": "internal: hands the processes and ports manager the keyboard",
  "procs.keys": "the open processes and ports manager's ?: it lists its keys in place",
  "git.back": "the git window's esc (closes its popup)",
  "git.commit-ok": "the git window's enter in its commit popup",
  "git.confirm-yes": "the git window's enter in its confirm popup",
  "git.menu-run": "the git window's enter in its menu",
  "git.prompt-ok": "the git window's enter in its prompt",
  "github.focus": "internal: hands the GitHub window the keyboard",
  "github.new-pr": "the same form as GitHub: new pull request… (nocturne.github-pr)",
  "github.run-workflow": "the same form as GitHub: run a workflow… (nocturne.github-run)",
  "notifications.focus": "internal: hands the overview the keyboard",
  "notifications.refresh": "internal: the bell reads the notifications again",
  "finder.files": "the open picker's switch to files: Find a file… (nocturne.picker) sends it",
  "finder.grep": "the open picker's switch to grep: Grep the project… (nocturne.grep) sends it",
};

// Whole families of mod commands that stay out (the test knows where each one's list lives).
export const OUT_FAMILIES = {
  "git": "the git window's key table (git/keys.js): each acts on the window's selection; its ? and menus list them",
  "notifications": "the open overview's keys (open.js COMMAND_KEYS): they act on its selection; its key bar lists them",
};

function titleOf(name) {
  const [noun, verb] = name.split(".");
  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}

/** Core commands for what's focused or waiting now: the focused pane and
 *  terminal, an update. (The shipped palette has the same; frame/palette.) */
function stateEntries() {
  const out = [];
  const h = here();
  const ps = panes(), mine = h.pane ? ps.find((p) => p.pane === h.pane) : null;
  if (mine && ps.filter((p) => p.tab === mine.tab).length > 1) {
    out.push({ name: "pane.move", args: {}, group: "Pane", title: "Move this pane to a new tab", words: "pane move tab own detach break out" });
  }
  const all = terminals(), term = h.terminal ? all.find((x) => x.address === h.terminal) : null;
  if (term) {
    const toProgram = term.labels?.["herdr.right-click"] === "program";
    out.push({ name: "terminal.right_click", args: { to: toProgram ? "menu" : "program", terminal: term.address }, group: "Terminal",
      title: toProgram ? "Right-clicks open the menu" : "Send right-clicks to the program", words: "mouse right click menu program tmux vim" });
    const parent = term.parent && all.find((x) => x.address === term.parent);
    if (parent) out.push({ name: "terminal.park", args: { terminal: term.address }, group: "Agent",
      title: `Send back to ${parent.name || parent.address}`, words: "sub-agent subagent parent park return pane" });
  }
  const u = updates?.();
  if (u?.app?.ready) out.push({ name: "app.update", args: {}, group: "App", title: `Restart into ${u.app.ready}`, words: "update upgrade new version restart" });
  if (u?.core?.ready && !u.core.managed) out.push({ name: "app.update_core", args: {}, group: "App", title: `Update herdr-core to ${u.core.ready}`, words: "update upgrade core terminals keep running" });
  if (u?.checks !== false) out.push({ name: "app.check_updates", args: {}, group: "App", title: "Check for updates", words: "update upgrade new version release" });
  return out;
}

// stateEntries' commands: only it adds them.
const STATE = new Set(["pane.move", "terminal.right_click", "terminal.park", "app.update", "app.update_core", "app.check_updates"]);
// Commands that need a terminal focused (they fail on a mod pane).
const NEEDS_TERMINAL = new Set(["terminal.copy", "terminal.paste", "terminal.paste_image", "terminal.search", "terminal.scroll",
  "pane.font_bigger", "pane.font_smaller", "pane.font_reset", "pane.float"]);
// macOS only (app.quit too, on every platform the window's close quits).
const MAC_ONLY = new Set(["app.hide", "app.hide_others", "app.show_all"]);
// Nocturne runs these in place of Fireflies': the same key, the sidebar's order;
// "New space" is the folder picker (newspace.js); next / previous agent walk on
// through the shelf's pinned panes (walk.js).
const IN_PLACE = { "space.next": "nocturne.next", "space.prev": "nocturne.prev", "space.new": "nocturne.space-new",
  "agent.next": "nocturne.agent-next", "agent.prev": "nocturne.agent-prev" };

/** Every entry for the state we're in now. */
function entries() {
  const known = new Set(commands().map((c) => c.name));
  const mac = win()?.platform === "macos";
  const terminal = Boolean(here().terminal);
  const list = [...findEntries(), ...paneEntries(), ...windowEntries(), ...openEntries(), ...NAMED.filter(([n]) => known.has(n))
    .filter(([n]) => !(mac && n.startsWith("window.")) && (mac || !MAC_ONLY.has(n)) && (terminal || !NEEDS_TERMINAL.has(n)))
    .map(([name, args, group, title, words]) => IN_PLACE[name]
      ? { name, args, group, title, words, bind: IN_PLACE[name], go: () => run(IN_PLACE[name]) }
      : { name, args, group, title, words }), ...stateEntries()];
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

/** The keys.json sections in force now, strongest first: the focused pane's
 *  mod section (or `terminal` on a terminal), the layout's, then global. */
function sections() {
  const h = here();
  const p = h.pane ? panes().find((x) => x.pane === h.pane) : null;
  return [p?.mod ? `mod:${p.mod}` : h.terminal ? "terminal" : null, "layout:nocturne", "global"].filter(Boolean);
}

/** The key bound to an entry (`bind`, else `name` or `name:value` in
 *  keys.json), in macOS glyphs. A key a stronger section binds to something
 *  else isn't this entry's (cmd-p is the file picker in Nocturne, not Fireflies'). */
export function keyOf(e, bound, mac, order = sections()) {
  const v = Object.values(e.args)[0];
  const want = e.bind ?? (v === undefined ? e.name : `${e.name}:${v}`);
  const rank = (b) => order.indexOf(b.section);
  const k = bound.find((b) => rank(b) >= 0 && b.action === want
    && !bound.some((o) => rank(o) >= 0 && rank(o) < rank(b) && o.keys.trim() === b.keys.trim() && o.action !== want))?.keys?.trim();
  if (!k) return null;
  // Departure Mono has ⌘ and ⌥; shift and control are spelled.
  const names = mac ? { cmd: "⌘", alt: "⌥", shift: "shift-", ctrl: "ctrl-" } : { ctrl: "ctrl-", alt: "alt-", shift: "shift-", cmd: "super-" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.split(/\s+/).map((stroke) => {
    const parts = stroke.endsWith("--") ? [...stroke.slice(0, -2).split("-"), "-"] : stroke.split("-");
    let key = parts.pop();
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    // shift-/ is ?, as the keys lists spell it.
    if (key === "/" && held.has("shift")) { key = "?"; held.delete("shift"); }
    const label = key.length === 1 ? key.toUpperCase() : key.toLowerCase();
    return [...["ctrl", "alt", "shift", "cmd"].filter((m) => held.has(m)).map((m) => names[m]), label].join("");
  }).join(" ");
}

/** Fuzzy score of `q` in `text`, with the matched positions; null: no match.
 *  Tried from each word start too, so "file" finds the word in "Find a file…"
 *  rather than the f of Find. */
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let best = fuzzyFrom(q, t, text.length, 0);
  for (let i = 1; i < t.length; i++) {
    if (t[i] !== q[0] || !/[\s:.\-_/]/.test(t[i - 1])) continue;
    const r = fuzzyFrom(q, t, text.length, i);
    if (r && (!best || r.score > best.score)) best = r;
  }
  return best;
}

function fuzzyFrom(q, t, length, from) {
  let score = 0, at = from, streak = 0;
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
  return { score: score - length * 0.02, hits };
}

function loadRecent() {
  try { return JSON.parse(localStorage.getItem("recent") ?? "[]"); } catch { return []; }
}

export default class Palette {
  init(_props, cx) {
    // A mod that opens the palette itself may hand it a search to start from (props.query).
    this.query = typeof props()?.query === "string" ? props().query : "";
    this.input = InputState.new({ placeholder: "type a command" });
    if (this.query) this.input.set_value(this.query);
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

  /** Where a search that found no command may belong: files, text in files, places. */
  elsewhere(bound, mac, order) {
    const k = (name) => { const key = keyOf({ name, args: {} }, bound, mac, order); return key ? ` (${key})` : ""; };
    return `Files: Find a file…${k("nocturne.picker")}. Text: Grep the project…${k("nocturne.grep")}. Spaces and tabs: Go to space or tab…${k("mod.open:picker")}.`;
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
    const order = sections();
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
      const k = keyOf(r.e, bound, mac, order);
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
        const k = e.key, ctrl = e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt;
        if (k === "escape") { cx.stop_propagation(); return this.close(); }
        // Stops at the ends: wrapping jumps out of sight.
        if (k === "down" || (ctrl && (k === "n" || k === "j"))) this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up" || (ctrl && (k === "p" || k === "k"))) this.at = Math.max(this.at - 1, 0);
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
          .child(div().text_color(t.dim).child(this.elsewhere(bound, mac, order))))
      .child(h_flex().relative().h(26).mt(4).flex_none().px(16).gap(14).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(hint("↑↓ ctrl-n/p", "move")).child(hint("enter", "run")).child(hint("esc", "close"))
        .child(div().flex_1())
        .child(div().text_color(t.dim).child("type to filter")));
  }
}
