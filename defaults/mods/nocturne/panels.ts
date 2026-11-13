// Nocturne's panels: everything the "+ new" menu (newmenu.ts) and the command
// palette (palette.ts) can open, and where each one lands.
//
//   dest "pane"  beside the focused pane (across from its split, "auto")
//   dest "tab"   a new tab of its own in the shown space
//   fixed        a panel that always lands in one place: Git (git:
//                lazygit's views and the review that was the diff), GitHub and
//                Scripts float over the tab, files runs down the tab's right edge
//   beside       Git, GitHub and Scripts also open as a normal pane beside
//                the focused pane, or a tab of their own (inpane.ts)
//   scratchpad   the repository's note in the editor (scratchpad.ts), through
//                its command: the menus that pick it close before git answers
//
// A panel that is open in the shown tab and has no other place to go closes
// instead (the menus say "Close …").

import { spaces, panes, focused, run, home } from "herdr";
import type { PaneInfo, SpaceInfo } from "herdr";
import { folderCandidates } from "./folders.ts";
import { ART } from "./kit.ts";
import { filesPane, toggleFiles, filesSlot } from "./files.ts";
import { usagePane, toggleUsage } from "./usage.ts";
import { gitOpen, toggleGit, openWorktrees } from "./git.ts";
import type { WorktreesAsk } from "./git.ts";
import { githubOpen, toggleGithub } from "./github.ts";
import { askScratchpad } from "./scratchpad.ts";
import { deckOpen, toggleDeck } from "./scripts.ts";
import { procsOpen, toggleProcs } from "./procs.ts";
import { openAs } from "./inpane.ts";
import { launcherPanels } from "./launchers.ts";

/** Where things would open now. */
export interface Here {
  readonly space: SpaceInfo | null;
  readonly tab: string | null;
  readonly pane: string | null;
  readonly terminal: string | null;
  readonly folder: string | null;
  readonly on: string | null;
}

/** Where things would open now: the shown space and tab, the focused pane and its folder. */
export function here(): Here {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? (f?.pane ? panes().find((p) => p.pane === f.pane) : null);
  // Its live folder, else the mod pane's, the space's terminals', the space's (folders.ts).
  const folder = folderCandidates(space, pane, f, panes(), { attached: false })[0] ?? null;

  return { space, tab, pane: pane?.pane ?? null, terminal: pane?.terminal ?? null, folder, on: space?.machine ?? null };
}

/** A mod pane of `mod` in the shown tab, if any. */
export const modPane = (mod: string): PaneInfo | null => {
  const { tab } = here();

  return panes().find((p) => p.mod === mod && p.tab === tab) ?? null;
};

// Each copy of the web pane keeps its page and zoom by its slot.
const slot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** terminal.open's arguments here. */
type TerminalOpen = { place: "auto"; pane?: string; folder?: string; argv?: readonly string[] };

/** A terminal (or an agent's argv) beside the focused pane, in its folder. */
export function terminalPane(argv?: readonly string[] | null): void {
  const h = here();
  const args: TerminalOpen = { place: "auto" };

  if (h.pane) args.pane = h.pane;

  if (h.folder) args.folder = h.folder;

  if (argv) args.argv = argv;

  run("terminal.open", args);
}

/** tab.new's arguments for a terminal tab. */
type TerminalTab = { space?: string; folder?: string; argv?: readonly string[]; name?: string };

/** A terminal (or an agent) in a new tab of the shown space. */
export function terminalTab(argv?: readonly string[] | null, name?: string | null): void {
  const h = here();
  const args: TerminalTab = {};

  if (h.space) args.space = h.space.id;

  if (h.folder) args.folder = h.folder;

  if (argv) args.argv = argv;

  if (name) args.name = name;

  run("tab.new", args);
}

/** files.open's arguments. */
type FilesOpen = { path: string; in?: "tab"; pane?: string; on?: string };

/** A files pane of its own (`files.open`, not the panel docked down the tab's
 *  edge) at the folder a terminal would open in: beside the focused pane, or
 *  `inTab` in a tab of its own. */
export function filesHere(inTab = false): void {
  const h = here();
  const args: FilesOpen = { path: h.folder ?? h.space?.folder ?? home() };

  if (inTab) args.in = "tab";
  else if (h.pane) args.pane = h.pane;

  if (h.on) args.on = h.on;

  run("files.open", args);
}

/** The props this file opens mods with: a web pane's or files pane's slot, a
 *  folder and its machine, the agent graph's terminal, the git window's tab. */
type ModProps = { slot?: string; folder?: string | null; on?: string | null; terminal?: string; review?: true; worktrees?: WorktreesAsk };

/** A mod beside the focused pane. */
function modBeside(mod: string, props: ModProps): void {
  const h = here();

  run("pane.split", h.pane ? { direction: "auto", pane: h.pane, mod, props } : { direction: "auto", mod, props });
}

/** A mod in a tab of its own. */
function modTab(mod: string, props: ModProps, name: string): void {
  const h = here();

  run("tab.new", h.space ? { space: h.space.id, name, mod, props } : { name, mod, props });
}

/** Opens `mod` beside the focused pane, or closes the one in the shown tab. */
function toggleBeside(mod: string, props: ModProps): void {
  const open = modPane(mod);

  if (open) run("pane.close", { pane: open.pane });
  else modBeside(mod, props);
}

/** A panel: what "+ new" and the palette open. */
export interface Panel {
  readonly id: string;
  readonly name: string;
  /** A workspace-chrome icon's name, or an svg path. */
  readonly icon: string;
  readonly key: string;
  readonly words: string;
  /** Its own command in keys.json, when it has one. */
  readonly bind?: string;
  /** It always lands in one place: floating over the tab, or down its edge. */
  readonly fixed?: "float" | "edge";
  /** It's shown in this tab now (the pane, the float). */
  readonly open?: () => boolean;
  /** Opens it where it lives (toggles it, once per tab), or in a tab of its own. */
  readonly pane: () => void;
  /** A panel that floats (Git, GitHub, Scripts) as a normal pane beside the focused one (inpane.ts). */
  readonly beside?: () => void;
  readonly tab: () => void;
}

/**
 * The panels, in menu order. Each: { id, name, icon (a workspace-chrome name, or an svg path), key,
 *   open() (shown in this tab: the pane / float), fixed? ("float" | "edge"),
 *   pane(), tab() } — `pane` toggles where a panel lives once per tab.
 */
export function panels(): Panel[] {
  const h = here();
  const agentsProps = (): ModProps => (h.terminal ? { terminal: h.terminal } : {});

  return [
    { id: "terminal", name: "Terminal", icon: "terminal", key: "t", words: "shell new",
      pane: () => terminalPane(), tab: () => terminalTab() },
    { id: "web", name: "Web", icon: "monitor", key: "w", words: "browser page url",
      pane: () => modBeside("browser", { slot: slot() }), tab: () => modTab("browser", { slot: slot() }, "web") },
    { id: "files", name: "Files", icon: "files", key: "f", words: "tree explorer folder", fixed: "edge", open: () => Boolean(filesPane()),
      pane: toggleFiles, tab: () => modTab("file-tree", { folder: h.folder, on: h.on, slot: filesSlot() }, "files") },
    { id: "agents", name: "Agents", icon: "layers", key: "a", words: "graph subagents workflows claude", open: () => Boolean(modPane("agent-graph")),
      pane: () => toggleBeside("agent-graph", agentsProps()), tab: () => modTab("agent-graph", agentsProps(), "agents") },
    { id: "usage", name: "Usage", icon: "clock", key: "u", words: "limits claude quota", open: () => Boolean(usagePane()),
      pane: toggleUsage, tab: () => modTab("usage", {}, "usage") },
    { id: "scratchpad", name: "Scratchpad", icon: `${ART}/scratchpad.svg`, key: "s", words: "note notes scratch pad markdown repository repo jot todo memo", bind: "nocturne.scratchpad",
      pane: () => askScratchpad(), tab: () => askScratchpad(true) },
    { id: "worktrees", name: "Worktrees", icon: "git-branch", key: "g", words: "git branches checkouts", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => (gitOpen() ? toggleGit() : openWorktrees()), tab: () => modTab("git", { folder: h.folder, on: h.on, worktrees: { action: "open" } }, "worktrees") },
    { id: "git", name: "Git", icon: "git-compare", key: "l", words: "git lazygit stage commit branches log graph rebase stash", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => toggleGit(), tab: () => openAs("git", { as: "tab" }), beside: () => openAs("git", { as: "pane" }) },
    { id: "diff", name: "Diff", icon: "git-compare", key: "d", words: "git changes review reviewed", fixed: "float", open: () => Boolean(gitOpen()),
      pane: () => toggleGit({ review: true }), tab: () => modTab("git", { folder: h.folder, on: h.on, review: true }, "diff") },
    { id: "github", name: "GitHub", icon: `${ART}/github.svg`, key: "h", words: "pull requests prs actions ci runs checks workflows", fixed: "float", open: () => Boolean(githubOpen()),
      pane: () => toggleGithub(), tab: () => openAs("github", { as: "tab" }), beside: () => openAs("github", { as: "pane" }) },
    { id: "scripts", name: "Scripts", icon: `${ART}/play.svg`, key: "r", words: "script runner run tasks npm bun just make cargo test build dev nix", bind: "nocturne.scripts", fixed: "float", open: () => Boolean(deckOpen()),
      pane: () => toggleDeck({ centered: true }), tab: () => openAs("scripts", { as: "tab" }), beside: () => openAs("scripts", { as: "pane" }) },
    { id: "procs", name: "Processes", icon: `${ART}/tree.svg`, key: "p", words: "processes ports tree kill end pid ps top activity monitor cpu memory graphs", fixed: "float", open: () => Boolean(procsOpen()),
      pane: () => toggleProcs({ centered: true }), tab: () => openAs("procs", { as: "tab" }), beside: () => openAs("procs", { as: "pane" }) },
    // Mods Nocturne doesn't ship that declare a launcher in their mod.json (launchers.ts).
    ...launcherPanels(),
  ];
}
