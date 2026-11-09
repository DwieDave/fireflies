// Nocturne's panels: everything the "+ new" menu (newmenu.js) and the command
// palette (palette.js) can open, and where each one lands.
//
//   dest "pane"  beside the focused pane (across from its split, "auto")
//   dest "tab"   a new tab of its own in the shown space
//   fixed        a panel that always lands in one place: lazygit, the diff
//                and GitHub float over the tab, files runs down the tab's right edge
//
// A panel that is open in the shown tab and has no other place to go closes
// instead (the menus say "Close …").

import { spaces, panes, focused, run } from "herdr";
import { filesPane, toggleFiles } from "./files.js";
import { usagePane, toggleUsage } from "./usage.js";
import { lazygitOpen, toggleLazygit, toggleDiff, lazygitArgv } from "./lazygit.js";
import { githubOpen, toggleGithub } from "./github.js";

/** Where things would open now: the shown space and tab, the focused pane and its folder. */
export function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? (f?.pane ? panes().find((p) => p.pane === f.pane) : null);
  const folder = pane?.cwd || f?.cwd || space?.folder || null;
  return { space, tab, pane: pane?.pane ?? null, terminal: pane?.terminal ?? null, folder, on: space?.machine ?? null };
}

/** A mod pane of `mod` in the shown tab, if any (Nocturne's own: the worktrees, its only pane role). */
export const modPane = (mod) => {
  const { tab } = here();
  return panes().find((p) => p.mod === mod && p.tab === tab) ?? null;
};

// Each copy of the web pane keeps its page and zoom by its slot.
const slot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A terminal (or an agent's argv) beside the focused pane, in its folder. */
export function terminalPane(argv) {
  const h = here();
  run("terminal.open", { place: "auto", ...(h.pane ? { pane: h.pane } : {}), ...(h.folder ? { folder: h.folder } : {}), ...(argv ? { argv } : {}) });
}

/** A terminal (or an agent) in a new tab of the shown space. */
export function terminalTab(argv, name) {
  const h = here();
  run("tab.new", { ...(h.space ? { space: h.space.id } : {}), ...(h.folder ? { folder: h.folder } : {}), ...(argv ? { argv } : {}), ...(name ? { name } : {}) });
}

/** A mod beside the focused pane. */
function modBeside(mod, props) {
  const h = here();
  run("pane.split", { direction: "auto", ...(h.pane ? { pane: h.pane } : {}), mod, props });
}

/** A mod in a tab of its own. */
function modTab(mod, props, name) {
  const h = here();
  run("tab.new", { ...(h.space ? { space: h.space.id } : {}), name, mod, props });
}

/** Opens `mod` beside the focused pane, or closes the one in the shown tab. */
function toggleBeside(mod, props) {
  const open = modPane(mod);
  if (open) return run("pane.close", { pane: open.pane });
  modBeside(mod, props);
}

/**
 * The panels, in menu order. Each: { id, name, icon (workspace-chrome), key,
 *   open() (shown in this tab: the pane / float), fixed? ("float" | "edge"),
 *   pane(), tab() } — `pane` toggles where a panel lives once per tab.
 */
export function panels() {
  const h = here();
  const agentsProps = () => (h.terminal ? { terminal: h.terminal } : {});
  return [
    { id: "terminal", name: "Terminal", icon: "terminal", key: "t", words: "shell new",
      pane: () => terminalPane(), tab: () => terminalTab() },
    { id: "web", name: "Web", icon: "monitor", key: "w", words: "browser page url",
      pane: () => modBeside("nocturne-browser", { slot: slot() }), tab: () => modTab("nocturne-browser", { slot: slot() }, "web") },
    { id: "app", name: "App", icon: "square", key: "o", words: "application program window open launch",
      pane: () => modBeside("nocturne-app", { slot: slot() }), tab: () => modTab("nocturne-app", { slot: slot() }, "app") },
    { id: "files", name: "Files", icon: "files", key: "f", words: "tree explorer folder", fixed: "edge", open: filesPane,
      pane: toggleFiles, tab: () => modTab("nocturne-files", { folder: h.folder, on: h.on }, "files") },
    { id: "agents", name: "Agents", icon: "layers", key: "a", words: "graph subagents workflows claude", open: () => modPane("nocturne-agents"),
      pane: () => toggleBeside("nocturne-agents", agentsProps()), tab: () => modTab("nocturne-agents", agentsProps(), "agents") },
    { id: "usage", name: "Usage", icon: "clock", key: "u", words: "limits claude quota", open: usagePane,
      pane: toggleUsage, tab: () => modTab("nocturne-usage", {}, "usage") },
    { id: "worktrees", name: "Worktrees", icon: "git-branch", key: "g", words: "git branches", open: () => modPane("nocturne"),
      pane: () => toggleBeside("nocturne", { role: "worktrees" }), tab: () => modTab("nocturne", { role: "worktrees" }, "worktrees") },
    { id: "lazygit", name: "Lazygit", icon: "git-compare", key: "l", words: "git stage commit", fixed: "float", open: () => lazygitOpen(0),
      pane: () => toggleLazygit(), tab: () => terminalTab(lazygitArgv(h.on), "lazygit") },
    { id: "diff", name: "Diff", icon: "git-compare", key: "d", words: "git changes review", fixed: "float", open: () => lazygitOpen(1),
      pane: () => toggleDiff(), tab: () => modTab("nocturne-diff", { folder: h.folder, on: h.on }, "diff") },
    { id: "github", name: "GitHub", icon: "git-branch", key: "h", words: "pull requests prs actions ci runs checks workflows", fixed: "float", open: () => Boolean(githubOpen()),
      pane: () => toggleGithub(), tab: () => modTab("nocturne-github", { folder: h.folder, on: h.on }, "github") },
  ];
}
