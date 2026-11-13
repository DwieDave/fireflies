// The palette's entries (palette.ts lists and runs them): the focused pane's and
// the open windows' own commands, Find, Nocturne's own (palette-open.ts), the
// app's commands under the palette's names, what's focused or waiting now, every
// layout; the commands that stay out (OUT) and why; the key bound to each.

import { commands, layouts, run, window as win, panes, terminals, updates } from "herdr";
import type { PaneInfo } from "herdr";
import { isString, object } from "./guard.ts";
import { isTerminal } from "./guards.ts";
import { here } from "./panels.ts";
import { gitOpen } from "./git.ts";
import { githubOpen } from "./github.ts";
import { togglePicker } from "./picker.ts";
import type { Binding } from "./keymap.ts";

import { openEntries } from "./palette-open.ts";

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/** A pane's own command: [command, title, words, when?(pane)]. */
type PaneCommand = readonly [string, string, string, ((p: PaneInfo) => boolean)?];

/** A pane's props, as far as Markdown goes: its file. */
const isPathProps = object({}, { path: isString });

/** The pane shows a Markdown file. */
const onMarkdown = (p: PaneInfo): boolean => isPathProps(p.props) && MARKDOWN.test(p.props.path ?? "");

/**
 * The focused pane's own commands (`<mod>.<command>`, its nextCommand()),
 * shown while a pane of that mod is focused: [group, [command, title, words, when?(pane)]].
 * Their keys are the mod's section in keys.json (`mod:<mod>`).
 */
const PANE: ReadonlyMap<string, readonly [string, readonly PaneCommand[]]> = new Map([
  ["editor", ["Editor", [
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
    ["preview", "Markdown: next view", "preview split text rendered cycle", onMarkdown],
    ["preview-split", "Markdown: preview beside the text", "preview split rendered", onMarkdown],
    ["preview-only", "Markdown: preview only", "preview rendered read", onMarkdown],
    ["preview-text", "Markdown: text only", "preview source edit", onMarkdown],
    ["preview-rendered", "Markdown: rendered, typed into", "rendered wysiwyg live edit preview", onMarkdown],
    ["md-menu", "Markdown: the commands' list", "markdown commands format menu cmd-.", onMarkdown],
    ["md-bold", "Markdown: bold", "strong format emphasis **", onMarkdown],
    ["md-italic", "Markdown: italic", "emphasis format _", onMarkdown],
    ["md-code", "Markdown: inline code", "code span backtick format", onMarkdown],
    ["md-link", "Markdown: link", "url href anchor format", onMarkdown],
    ["md-heading-up", "Markdown: heading level up", "heading title bigger # format", onMarkdown],
    ["md-heading-down", "Markdown: heading level down", "heading title smaller # format", onMarkdown],
    ["md-bullets", "Markdown: bullet list", "list unordered items -", onMarkdown],
    ["md-numbers", "Markdown: numbered list", "list ordered items 1.", onMarkdown],
    ["md-task", "Markdown: task box", "todo checkbox task [ ]", onMarkdown],
    ["md-image", "Markdown: image from a file", "picture png jpg insert pick ![]", onMarkdown],
    ["md-image-paste", "Markdown: paste an image", "picture screenshot clipboard png assets insert", onMarkdown],
    ["md-tick", "Markdown: tick or untick a task", "todo checkbox done check [x]", onMarkdown],
    ["md-quote", "Markdown: quote", "blockquote >", onMarkdown],
    ["md-fence", "Markdown: code block", "fence code block ```", onMarkdown],
    ["md-rule", "Markdown: rule", "horizontal rule line separator ---", onMarkdown],
  ]]],
  ["browser", ["Web", [
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
  ]]],
  ["markdown", ["Markdown", [
    ["raw", "Show the source or the rendered page", "raw markdown source text toggle"],
    ["back", "Back to the previous file", "history link"],
    ["top", "Scroll to the top", "start beginning home"],
    ["bottom", "Scroll to the bottom", "end"],
    ["reload", "Reload the file", "refresh disk"],
    ["keys", "Markdown viewer keys", "help shortcuts list ? keybindings"],
  ]]],
  ["preview", ["Preview", [
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
  ]]],
  ["agent-graph", ["Agents", [
    ["follow", "Follow the selected agent", "graph track watch live"],
    ["working", "Next working agent", "graph busy jump follow"],
    ["in", "Zoom in", "graph bigger"],
    ["out", "Zoom out", "graph smaller"],
    ["reset", "Reset the view", "graph zoom pan fit"],
    ["keys", "Agents graph keys", "help shortcuts list ? keybindings"],
  ]]],
  ["usage", ["Usage", [
    ["refresh", "Check usage again", "limits quota refresh reload claude"],
    ["keys", "Usage keys", "help shortcuts list ? keybindings"],
  ]]],
  ["file-tree", ["Files", [
    ["keys", "Files pane keys", "help shortcuts list ? keybindings"],
    ["look", "Show or hide the preview", "preview split quick look peek file viewer space"],
  ]]],
]);

/** A command's arguments, as the palette's entries carry them (the commands they run, and an
 *  entry's id: args that only tell entries apart, like `panel`, never reach a command). */
export type EntryArgs = {
  panel?: string; tab?: true; direction?: string; name?: string; agent?: string; to?: string; terminal?: string; scope?: string; dir?: string;
  section?: string; fold?: true; scripts?: true | "again"; procs?: true | "ports"; worktree?: "new"; space?: "folder"; gridify?: true; pin?: true;
  rename?: "pane"; path?: string; pane?: string; on?: string; in?: "tab" | "pane";
};

/** A row of the palette: a command, its arguments, its group, its words; `go` runs it
 *  (else run(name, args)); `bind` is the action its key is bound to, when not the command. */
export interface Entry {
  readonly name: string;
  readonly args: EntryArgs;
  readonly group: string;
  readonly title: string;
  readonly words: string;
  readonly icon?: string;
  readonly bind?: string;
  readonly go?: () => void;
}

/** The focused pane's own commands, as entries. */
function paneEntries(): Entry[] {
  const h = here();
  const p = h.pane ? panes().find((x) => x.pane === h.pane) : null;
  const mod = p?.mod;
  const own = mod ? PANE.get(mod) : undefined;

  if (!p || !mod || !own) return [];

  const [group, list] = own;

  return list.flatMap(([c, title, words, when]) => {
    if (when && !when(p)) return [];

    const name = `${mod}.${c}`;

    return [{ name, args: {}, group, title, words, go: () => run(name) }];
  });
}

/** The git and GitHub windows' own commands, while they're open. */
function windowEntries(): Entry[] {
  const out: Entry[] = [];
  const add = (name: string, group: string, icon: string, title: string, words: string) => out.push({ name, args: {}, group, icon, title, words, go: () => run(name) });

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

/** The file picker and grep (picker.ts): the space's folder, else the focused pane's. */
function findEntries(): Entry[] {
  return [
    { name: "nocturne.picker", args: {}, group: "Find", icon: "search", title: "Find a file…",
      words: "open file picker fuzzy go to file quick open search name path", go: () => togglePicker("files") },
    { name: "nocturne.grep", args: {}, group: "Find", icon: "search", title: "Grep the project…",
      words: "grep search text in files find content ripgrep rg project folder", go: () => togglePicker("grep") },
  ];
}

const DIRECTIONS = ["left", "right", "up", "down"] as const;

// The palette's names for commands: [command, args, group, title, keywords].
const NAMED: readonly (readonly [string, EntryArgs, string, string, string])[] = [
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
  ...DIRECTIONS.map((d) => ["pane.go", { direction: d }, "Pane", `Focus pane ${d}`, "move go"] as const),
  ...DIRECTIONS.map((d) => ["pane.swap", { direction: d }, "Pane", `Swap pane ${d}`, "move"] as const),
  ...DIRECTIONS.map((d) => ["pane.resize", { direction: d }, "Pane", `Resize pane ${d}`, "size grow shrink bigger smaller wider narrower taller shorter divider step"] as const),
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
  ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }, "App", `Theme: ${n.replace(/-/g, " ")}`, "colors look"] as const),
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
  // Nocturne's own (sky.ts, tabs.ts) and its mods' internal commands.
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
  "databases.save": "saves the Databases window's staged cell changes after a review: w or cmd-s inside the window",
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
  "procs.to-pane": "the processes deck's own ctrl-t or ◧ (into a pane); the palette's \"Processes in a pane\" opens a new one",
  "procs.to-window": "a processes pane's own ctrl-t or ⧉ (back over the tab)",
  "git.back": "the git window's esc (closes its popup)",
  "git.commit-ok": "the git window's enter in its commit popup",
  "git.confirm-yes": "the git window's enter in its confirm popup",
  "git.menu-run": "the git window's enter in its menu",
  "git.prompt-ok": "the git window's enter in its prompt",
  "github.focus": "internal: hands the GitHub window the keyboard",
  "github.to-pane": "the GitHub window's own ctrl-t or ◧ (into a pane); the palette's \"GitHub in a pane\" opens a new one",
  "github.to-window": "a GitHub pane's own ctrl-t or ⧉ (out to a window)",
  "git.to-pane": "the git window's own ctrl-t or ◧ (into a pane); the palette's \"Git in a pane\" opens a new one",
  "git.to-window": "a git pane's own ctrl-t or ⧉ (out to a window)",
  "scripts.to-pane": "the script deck's own ctrl-t or ◧ (into a pane); the palette's \"Scripts in a pane\" opens a new one",
  "scripts.to-window": "a script deck pane's own ctrl-t or ⧉ (back over the tab)",
  "github.new-pr": "the same form as GitHub: new pull request… (nocturne.github-pr)",
  "github.run-workflow": "the same form as GitHub: run a workflow… (nocturne.github-run)",
  "notifications.focus": "internal: hands the overview the keyboard",
  "notifications.refresh": "internal: the bell reads the notifications again",
  "finder.files": "the open picker's switch to files: Find a file… (nocturne.picker) sends it",
  "finder.grep": "the open picker's switch to grep: Grep the project… (nocturne.grep) sends it",
} as const;

// Whole families of mod commands that stay out (the test knows where each one's list lives).
export const OUT_FAMILIES = {
  "git": "the git window's key table (git/keys.ts): each acts on the window's selection; its ? and menus list them",
  "notifications": "the open overview's keys (open.ts COMMAND_KEYS): they act on its selection; its key bar lists them",
} as const;

/** The commands OUT names: what stays out (data looks a command up here). */
const OUT_NAMES: ReadonlySet<string> = new Set(Object.keys(OUT));

/** An entry's group and title. */
interface Titled {
  readonly group: string;
  readonly title: string;
}

/** An entry's group and title from a command's name (one the palette has no words for). */
function titleOf(name: string): Titled {
  const [noun = "", verb = ""] = name.split(".");

  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}

/** Core commands for what's focused or waiting now: the focused pane and
 *  terminal, an update. (The shipped palette has the same; frame/palette.) */
function stateEntries(): Entry[] {
  const out: Entry[] = [];
  const h = here();
  const ps = panes();
  const mine = h.pane ? ps.find((p) => p.pane === h.pane) : null;

  if (mine && ps.filter((p) => p.tab === mine.tab).length > 1) {
    out.push({ name: "pane.move", args: {}, group: "Pane", title: "Move this pane to a new tab", words: "pane move tab own detach break out" });
  }

  const all = terminals().filter((x) => isTerminal(x));
  const term = h.terminal ? all.find((x) => x.address === h.terminal) : null;

  if (term) {
    const toProgram = term.labels?.["herdr.right-click"] === "program";

    out.push({ name: "terminal.right_click", args: { to: toProgram ? "menu" : "program", terminal: term.address }, group: "Terminal",
      title: toProgram ? "Right-clicks open the menu" : "Send right-clicks to the program", words: "mouse right click menu program tmux vim" });

    const parent = term.parent ? all.find((x) => x.address === term.parent) : undefined;

    if (parent) {
      out.push({ name: "terminal.park", args: { terminal: term.address }, group: "Agent",
        title: `Send back to ${parent.name || parent.address}`, words: "sub-agent subagent parent park return pane" });
    }
  }

  const u = updates();

  if (u.app.ready) out.push({ name: "app.update", args: {}, group: "App", title: `Restart into ${u.app.ready}`, words: "update upgrade new version restart" });

  if (u.core.ready && !u.core.managed) out.push({ name: "app.update_core", args: {}, group: "App", title: `Update herdr-core to ${u.core.ready}`, words: "update upgrade core terminals keep running" });

  if (u.checks !== false) out.push({ name: "app.check_updates", args: {}, group: "App", title: "Check for updates", words: "update upgrade new version release" });

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
// "New space" is the folder picker (newspace.ts); next / previous agent walk on
// through the shelf's pinned panes (walk.ts).
const IN_PLACE: ReadonlyMap<string, string> = new Map([["space.next", "nocturne.next"], ["space.prev", "nocturne.prev"], ["space.new", "nocturne.space-new"],
  ["agent.next", "nocturne.agent-next"], ["agent.prev", "nocturne.agent-prev"]]);

/** The shipped layouts' names for people. */
const LAYOUT_NAMES: ReadonlyMap<string, string> = new Map([["main", "Fireflies"], ["terminals", "Terminals"], ["win98", "Fireflies 98"]]);

/** An entry as listed: with its id (its command and arguments). */
export type Listed = Entry & { readonly id: string };

/** Every entry for the state we're in now. */
export function entries(): Listed[] {
  const known = new Set(commands().map((c) => c.name));
  const mac = win().platform === "macos";
  const terminal = Boolean(here().terminal);

  const named = NAMED.flatMap(([name, args, group, title, words]): Entry[] => {
    if (!known.has(name) || (mac && name.startsWith("window.")) || (!mac && MAC_ONLY.has(name)) || (!terminal && NEEDS_TERMINAL.has(name))) return [];

    const instead = IN_PLACE.get(name);

    return [instead ? { name, args, group, title, words, bind: instead, go: () => run(instead) } : { name, args, group, title, words }];
  });

  const list: Entry[] = [...findEntries(), ...paneEntries(), ...windowEntries(), ...openEntries(), ...named, ...stateEntries()];

  for (const l of layouts()) {
    const t = LAYOUT_NAMES.get(l) ?? l.charAt(0).toUpperCase() + l.slice(1);

    list.push({ name: "layout.switch", args: { name: l }, group: "Layout", title: `Layout: ${t}`, words: `look ${l}` });
  }

  // Anything new in the app shows up too, until it gets a better name here.
  const hasWords = new Set(NAMED.map(([n]) => n));

  for (const c of commands()) {
    if (hasWords.has(c.name) || OUT_NAMES.has(c.name) || STATE.has(c.name) || c.args.some((a) => a.required && a.name !== "name")) continue;

    list.push({ name: c.name, args: {}, ...titleOf(c.name), words: c.about });
  }

  return list.map((e) => ({ ...e, id: `${e.name}:${JSON.stringify(e.args)}` }));
}

/** The keys.json sections in force now, strongest first: the focused pane's
 *  mod section (or `terminal` on a terminal), the layout's, then global. */
export function sections(): string[] {
  const h = here();
  const p = h.pane ? panes().find((x) => x.pane === h.pane) : null;
  const own = p?.mod ? `mod:${p.mod}` : h.terminal ? "terminal" : null;

  return own ? [own, "layout:nocturne", "global"] : ["layout:nocturne", "global"];
}

/** Each modifier as the palette spells it: glyphs on a Mac (Departure Mono has ⌘ and ⌥), words elsewhere. */
const MAC_NAMES: ReadonlyMap<string, string> = new Map([["cmd", "⌘"], ["alt", "⌥"], ["shift", "shift-"], ["ctrl", "ctrl-"]]);
const NAMES: ReadonlyMap<string, string> = new Map([["ctrl", "ctrl-"], ["alt", "alt-"], ["shift", "shift-"], ["cmd", "super-"]]);
const HELD = ["ctrl", "alt", "shift", "cmd"] as const;

/** The key bound to an entry (`bind`, else `name` or `name:value` in
 *  keys.json), in macOS glyphs. A key a stronger section binds to something
 *  else isn't this entry's (cmd-p is the file picker in Nocturne, not Fireflies'). */
export function keyOf(e: Pick<Entry, "name" | "args" | "bind">, bound: readonly Binding[], mac: boolean, order: readonly string[] = sections()): string | null {
  const v = Object.values(e.args)[0];
  const want = e.bind ?? (v === undefined ? e.name : `${e.name}:${String(v)}`);
  const rank = (b: Binding) => order.indexOf(b.section);

  const k = bound.find((b) => rank(b) >= 0 && b.action === want
    && !bound.some((o) => rank(o) >= 0 && rank(o) < rank(b) && o.keys.trim() === b.keys.trim() && o.action !== want))?.keys.trim();

  if (!k) return null;

  const names = mac ? MAC_NAMES : NAMES;
  const alias: ReadonlyMap<string, string> = new Map([["secondary", mac ? "cmd" : "ctrl"], ["super", "cmd"], ["win", "cmd"]]);

  return k.split(/\s+/).map((stroke) => {
    const parts = stroke.endsWith("--") ? [...stroke.slice(0, -2).split("-"), "-"] : stroke.split("-");
    let key = parts.pop() ?? "";
    const held = new Set(parts.map((m) => alias.get(m.toLowerCase()) ?? m.toLowerCase()));

    // shift-/ is ?, as the keys lists spell it.
    if (key === "/" && held.has("shift")) {
      key = "?";
      held.delete("shift");
    }

    const label = key.length === 1 ? key.toUpperCase() : key.toLowerCase();

    return [...HELD.flatMap((m) => (held.has(m) ? [names.get(m) ?? m] : [])), label].join("");
  }).join(" ");
}
