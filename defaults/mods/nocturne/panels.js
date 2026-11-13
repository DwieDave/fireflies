// Nocturne's panels: everything the "+ new" menu (newmenu.js) and the command
// palette (palette.js) can open, and where each one lands.
//
//   dest "pane"  beside the focused pane (across from its split, "auto")
//   dest "tab"   a new tab of its own in the shown space
//   fixed        a panel that always lands in one place: Git (nocturne-git:
//                lazygit's views and the review that was the diff) and GitHub
//                float over the tab, files runs down the tab's right edge
//   scratchpad   the repository's note in the editor (scratchpad.js), through
//                its command: the menus that pick it close before git answers
//
// A panel that is open in the shown tab and has no other place to go closes
// instead (the menus say "Close …").

import { spaces, panes, focused, run, home } from "herdr";
import { folderCandidates } from "./folders.js";
import { ART } from "./kit.js";
import { filesPane, toggleFiles, filesSlot } from "./files.js";
import { usagePane, toggleUsage } from "./usage.js";
import { gitOpen, toggleGit, openWorktrees } from "./git.js";
import { githubOpen, toggleGithub } from "./github.js";
import { askScratchpad } from "./scratchpad.js";

/** Where things would open now: the shown space and tab, the focused pane and its folder. */
export function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? (f?.pane ? panes().find((p) => p.pane === f.pane) : null);
  // Its live folder, else the mod pane's, the space's terminals', the space's (folders.js).
  const folder = folderCandidates(space, pane, f, panes(), { attached: false })[0] ?? null;
  return { space, tab, pane: pane?.pane ?? null, terminal: pane?.terminal ?? null, folder, on: space?.machine ?? null };
}

/** A mod pane of `mod` in the shown tab, if any. */
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

/** A files pane of its own (`files.open`, not the panel docked down the tab's
 *  edge) at the folder a terminal would open in: beside the focused pane, or
 *  `inTab` in a tab of its own. */
export function filesHere(inTab = false) {
  const h = here();
  const path = h.folder ?? h.space?.folder ?? home();
  run("files.open", { path, ...(inTab ? { in: "tab" } : h.pane ? { pane: h.pane } : {}), ...(h.on ? { on: h.on } : {}) });
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
 * The panels, in menu order. Each: { id, name, icon (a workspace-chrome name, or an svg path), key,
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
    { id: "files", name: "Files", icon: "files", key: "f", words: "tree explorer folder", fixed: "edge", open: filesPane,
      pane: toggleFiles, tab: () => modTab("nocturne-files", { folder: h.folder, on: h.on, slot: filesSlot() }, "files") },
    { id: "agents", name: "Agents", icon: "layers", key: "a", words: "graph subagents workflows claude", open: () => modPane("nocturne-agents"),
      pane: () => toggleBeside("nocturne-agents", agentsProps()), tab: () => modTab("nocturne-agents", agentsProps(), "agents") },
    { id: "usage", name: "Usage", icon: "clock", key: "u", words: "limits claude quota", open: usagePane,
      pane: toggleUsage, tab: () => modTab("nocturne-usage", {}, "usage") },
    { id: "scratchpad", name: "Scratchpad", icon: `${ART}/scratchpad.svg`, key: "s", words: "note notes scratch pad markdown repository repo jot todo memo", bind: "nocturne.scratchpad",
      pane: () => askScratchpad(), tab: () => askScratchpad(true) },
    { id: "worktrees", name: "Worktrees", icon: "git-branch", key: "g", words: "git branches checkouts", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => (gitOpen() ? toggleGit() : openWorktrees()), tab: () => modTab("nocturne-git", { folder: h.folder, on: h.on, worktrees: { action: "open" } }, "worktrees") },
    { id: "git", name: "Git", icon: "git-compare", key: "l", words: "git lazygit stage commit branches log graph rebase stash", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => toggleGit(), tab: () => modTab("nocturne-git", { folder: h.folder, on: h.on }, "git") },
    { id: "diff", name: "Diff", icon: "git-compare", key: "d", words: "git changes review reviewed", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => toggleGit({ review: true }), tab: () => modTab("nocturne-git", { folder: h.folder, on: h.on, review: true }, "diff") },
    { id: "github", name: "GitHub", icon: `${ART}/github.svg`, key: "h", words: "pull requests prs actions ci runs checks workflows", fixed: "float", open: () => Boolean(githubOpen()),
      pane: () => toggleGithub(), tab: () => modTab("nocturne-github", { folder: h.folder, on: h.on }, "github") },
  ];
}
