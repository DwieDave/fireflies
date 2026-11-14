// The palette's "Open" entries and Nocturne's other own rows (palette-entries.ts
// lists them first among its own): the panels, the folder's files pane, the
// script runner and processes, the agents to start, the space's worktree and
// folder, the git window's diff, pins, the dock, the toast and update note, the
// keyboard's ways into the chrome, the picture in picture player.

import { run, shared, setShared, agents, panes } from "herdr";
import { writeShared } from "./guard.ts";
import { isList } from "./guards.ts";
import { focusedPane, panePinnedNow, pinPane, pinKey, movePin, jar, dockPane, dockWeb, dockShell, dockFiles, dockable } from "./kit.ts";
import type { PinTarget } from "./kit.ts";
import { onShelf } from "./pins.ts";
import { panels, here, terminalPane, terminalTab } from "./panels.ts";
import type { Here } from "./panels.ts";
import { toggleDeck, lastFailed } from "./scripts.ts";
import { toggleProcs } from "./procs.ts";
import { gitOpen, openWorktrees } from "./git.ts";
import { openNewMenu, lastKnownAgents } from "./newmenu.ts";
import { NAME_PANE, EDIT_SPACE_KEY } from "./menu.ts";
import { TOASTS, toastKey } from "./toast.ts";
import { updateShown, dismissUpdate } from "./screens.ts";
import type { Entry, EntryArgs } from "./palette-entries.ts";

// The scratchpad is a panel too (panels.ts): its pick runs nocturne.scratchpad(-tab), opened by the sidebar's copy.
const BIND: ReadonlyMap<string, string> = new Map([["files", "nocturne.files"], ["git", "nocturne.git"], ["diff", "nocturne.diff"], ["worktrees", "nocturne.worktrees"], ["github", "nocturne.github"], ["scratchpad", "nocturne.scratchpad"], ["databases", "nocturne.databases"]]);
const BIND_TAB: ReadonlyMap<string, string> = new Map([["scratchpad", "nocturne.scratchpad-tab"]]);

/** An entry with its key bound to `bind` when there is one. */
const bound = (e: Entry, bind: string | undefined): Entry => (bind ? { ...e, bind } : e);

/** Nocturne's panels as palette entries: `go` runs them; `bind` is their key in keys.json's layout section. */
function panelEntries(): Entry[] {
  const out: Entry[] = [];

  for (const p of panels()) {
    const where = p.fixed === "float" ? "floating over the tab" : p.fixed === "edge" ? "down the right edge" : "beside the focused pane";

    // The script runner's window entry is toolEntries' "Run a script…"; the processes' "Processes and ports…".
    if (p.id !== "scripts" && p.id !== "procs") {
      out.push(bound({ name: "nocturne", args: { panel: p.id }, group: "Open", icon: p.icon,
        title: p.open?.() ? `Close ${p.name.toLowerCase()}` : p.name, words: `open ${p.words} ${where}`, go: () => p.pane() }, BIND.get(p.id)));
    }

    const beside = p.beside;

    // Git, GitHub, Scripts, Processes: a normal pane beside the focused one (inpane.ts).
    if (beside) {
      out.push({ name: "nocturne", args: { panel: p.id, in: "pane" }, group: "Open", icon: p.icon,
        title: `${p.name} in a pane`, words: `open ${p.words} pane split beside`, go: () => beside() });
    }

    out.push(bound({ name: "nocturne", args: { panel: p.id, tab: true }, group: "Open", icon: p.icon,
      title: `${p.name} in a new tab`, words: `open ${p.words} tab`, go: () => p.tab() }, BIND_TAB.get(p.id)));
  }

  return out;
}

/** The focused pane's folder as a files pane of its own (files.open), beside it or in a tab; GitHub's forms for it. */
function folderEntries(h: Here): Entry[] {
  const out: Entry[] = [];

  if (h.folder) {
    const at: EntryArgs = { path: h.folder };

    if (h.pane) at.pane = h.pane;

    if (h.on) at.on = h.on;

    const inTab: EntryArgs = { ...at, in: "tab" };

    out.push({ name: "files.open", args: at, group: "Open", icon: "files",
      title: "Files pane of this folder", words: "files tree explorer folder browse split beside new pane", go: () => run("files.open", at) });
    out.push({ name: "files.open", args: inTab, group: "Open", icon: "files",
      title: "Files of this folder in a new tab", words: "files tree explorer folder browse tab", go: () => run("files.open", inTab) });
  }

  if (h.folder) {
    out.push({ name: "nocturne.github-pr", args: {}, group: "Open", icon: "git-branch", bind: "nocturne.github-pr",
      title: "GitHub: new pull request…", words: "github pr pull request create open new gh branch push", go: () => run("nocturne.github-pr") });
    out.push({ name: "nocturne.github-run", args: {}, group: "Open", icon: "terminal", bind: "nocturne.github-run",
      title: "GitHub: run a workflow…", words: "github actions workflow dispatch run trigger manual gh ci deploy", go: () => run("nocturne.github-run") });
  }

  return out;
}

/** The sidebar's fold, the script runner, processes and ports, "+ new". */
function toolEntries(): Entry[] {
  const out: Entry[] = [];

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

  return out;
}

/** The + new menu's agents (the last ones this machine reported): beside the focused pane, or in a tab;
 *  the space's worktree and folder. */
function agentAndSpaceEntries(h: Here): Entry[] {
  const out: Entry[] = [];
  const machine = h.space?.machine ?? "";

  for (const a of lastKnownAgents(machine).filter((x) => x.installed && x.run.length)) {
    out.push({ name: "terminal.open", args: { agent: a.key }, group: "Agent", icon: "terminal",
      title: `Start ${a.name}`, words: `agent new start launch run beside pane ${a.key}`, go: () => terminalPane(a.run) });
    out.push({ name: "tab.new", args: { agent: a.key }, group: "Agent", icon: "terminal",
      title: `Start ${a.name} in a new tab`, words: `agent new start launch run tab ${a.key}`, go: () => terminalTab(a.run, a.name) });
  }

  const space = h.space;

  if (space) {
    out.push({ name: "nocturne", args: { worktree: "new" }, group: "Space", icon: "git-branch", title: "New worktree…",
      words: "git branch checkout folder space worktree add", go: () => openWorktrees({ space: space.id, action: "new" }) });
    out.push({ name: "nocturne", args: { space: "folder" }, group: "Space", icon: "folder", title: "Change this space's folder…",
      words: "space folder directory attach repo cwd", go: () => writeShared(setShared, EDIT_SPACE_KEY, { id: space.id, kind: "folder", at: Date.now() }) });
  }

  return out;
}

/** While the git window is open: what its main view shows, as a pane (its ctrl-p) or a tab
 *  (ctrl-shift-p); gridify. */
function gitAndGridEntries(): Entry[] {
  const out: Entry[] = [];

  if (gitOpen()) {
    out.push({ name: "git.open-pane", args: {}, group: "Open", icon: "panel-right", bind: "git.open-pane",
      title: "Git: open the diff as a pane", words: "git diff pane split beside review patch commit stash", go: () => run("git.open-pane") });
    out.push({ name: "git.open-pane-tab", args: {}, group: "Open", icon: "square", bind: "git.open-pane-tab",
      title: "Git: open the diff in a new tab", words: "git diff tab review patch commit stash", go: () => run("git.open-pane-tab") });
  }

  out.push({ name: "nocturne", args: { gridify: true }, group: "Pane", icon: "mods/equalize-panes/grid.svg", bind: "nocturne.gridify",
    title: "Gridify panes", words: "grid tile arrange rearrange even out equalize layout", go: () => run("nocturne.gridify") });

  return out;
}

/** Pinning the focused pane to the top of the sky, whatever it shows: an agent,
 *  a shell, a web page, an editor (kit.ts pinPane; menu.ts pinItems); its place in the jar. */
function pinEntries(target: PinTarget | null): Entry[] {
  const out: Entry[] = [];

  if (target) {
    const on = panePinnedNow(target);
    const key = pinKey(target);
    const what = target.terminal && agents().some((a) => a.address === target.terminal) ? "agent" : "pane";
    const group = what === "agent" ? "Agent" : "Pane";

    out.push({ name: "nocturne", args: { pin: true }, group, icon: on ? "pin-off" : "pin", bind: "nocturne.pin",
      title: on ? `Unpin this ${what}` : `Pin this ${what} to the top`, words: "pin unpin keep top jar sidebar fireflies watch orchestrator dock web page editor files terminal", go: () => pinPane(target, !on) });

    // Its place in the jar, while it has a neighbor to swap with.
    // A firefly moves up and down in the jar, a pane's tile left and right on its shelf.
    const all = on ? jar() : [];
    const it = all.find((x) => x.key === key);
    const kin = it ? all.filter((x) => onShelf(x) === onShelf(it)) : [];
    const i = it ? kin.indexOf(it) : -1;
    const [up, down] = what === "agent" ? ["up in the jar", "down in the jar"] : ["left on the shelf", "right on the shelf"];

    if (i > 0) {
      out.push({ name: "nocturne.pin-up", args: {}, group, icon: "pin", title: `Move this ${what} ${up}`,
        words: "pin order jar shelf sidebar top left", go: () => movePin(key, -1) });
    }

    if (i >= 0 && i < kin.length - 1) {
      out.push({ name: "nocturne.pin-down", args: {}, group, icon: "pin", title: `Move this ${what} ${down}`,
        words: "pin order jar shelf sidebar bottom right", go: () => movePin(key, 1) });
    }
  }

  return out;
}

/** The dock (dock.ts): a space tied to no folder for panes that belong to no
 *  project; what goes there is pinned to the jar's shelf. The toast and the update note. */
function dockAndNoteEntries(target: PinTarget | null): Entry[] {
  const out: Entry[] = [];

  out.push({ name: "nocturne.dock-web", args: {}, group: "Open", icon: "monitor", bind: "nocturne.dock-web", title: "New web pane in the dock",
    words: "dock web browser page pane default space no folder shelf pin keep", go: () => dockWeb() });

  out.push({ name: "nocturne.dock-shell", args: {}, group: "Open", icon: "terminal", bind: "nocturne.dock-shell", title: "New shell in the dock",
    words: "dock shell terminal default space no folder home shelf pin keep", go: () => dockShell() });
  out.push({ name: "nocturne.dock-files", args: {}, group: "Open", icon: "files", bind: "nocturne.dock-files", title: "New files pane in the dock",
    words: "dock files folder tree home default space no folder shelf pin keep", go: () => dockFiles() });

  const docked = target?.pane ? panes().find((p) => p.pane === target.pane) : undefined;

  if (dockable(docked)) {
    out.push({ name: "nocturne.dock", args: {}, group: "Pane", icon: "archive", bind: "nocturne.dock", title: "Move this pane to the dock",
      words: "dock move keep default space no folder shelf pin", go: () => dockPane(docked) });
  }

  // The newest toast on screen (toast.ts): run what it offers, or dismiss it.
  const toasts = shared(TOASTS);

  if (isList(toasts) && toasts.length) {
    out.push({ name: "nocturne.toast", args: {}, group: "App", icon: "check", title: "Do what the toast offers",
      words: "toast notification act open click newest", go: () => toastKey("toast") });
    out.push({ name: "nocturne.toast-close", args: {}, group: "App", icon: "x", title: "Dismiss the toast",
      words: "toast notification close hide dismiss newest", go: () => toastKey("toast-close") });
  }

  // The update note ("Updated to …", bottom right; screens.ts), while it shows.
  if (updateShown()) {
    out.push({ name: "nocturne.update-close", args: {}, group: "App", icon: "x", title: "Close the update note",
      words: "update updated version note close hide dismiss what changed", go: () => dismissUpdate() });
  }

  return out;
}

/** The notifications, the keyboard into a chrome block (nav.ts), renaming the focused terminal. */
function keyboardEntries(h: Here): Entry[] {
  const out: Entry[] = [];

  out.push({ name: "notifications.open", args: {}, group: "Agent", icon: "layers", title: "Notifications",
    words: "notifications inbox agents waiting needs you permission questions bell overview", go: () => run("notifications.open") });

  // The keyboard into a chrome block: the sidebar, the tab strip, the pane header.
  const chromeKeys: readonly (readonly [string, string, string])[] = [
    ["sidebar", "Keyboard to the sidebar", "focus sky spaces agents navigate"],
    ["tabstrip", "Keyboard to the tab strip", "focus tabs navigate"],
    ["header", "Keyboard to the pane header", "focus header tools navigate"],
  ];

  for (const [cmd, title, words] of chromeKeys) out.push({ name: `nocturne.${cmd}`, args: {}, group: "Window", icon: "square", title, words, go: () => run(`nocturne.${cmd}`) });

  // The focused terminal: its name in the pane header (menu.ts NAME_PANE).
  if (h.terminal) {
    const term = h.terminal;

    out.push({ name: "nocturne", args: { rename: "pane" }, group: "Pane", icon: "square-pen", title: "Rename this pane",
      words: "name title terminal label pane header", go: () => setShared(NAME_PANE, { terminal: term, at: Date.now() }) });
  }

  return out;
}

/** The picture in picture player (pip), while its window is open (or a pane holds it). */
function pipEntries(): Entry[] {
  const out: Entry[] = [];
  const pipWindow = Boolean(shared("pip.player"));
  const pipPane = panes().some((p) => p.mod === "pip");

  if (pipWindow || pipPane) {
    const pip: readonly (readonly [string, string, string, string])[] = [
      ...(pipWindow ? [
        ["pane", "panel-right", "Picture in picture into a pane", "pip video player pane split beside dock"] as const,
        ["park", "archive", "Park picture in picture", "pip video player chip hide minimize"] as const,
      ] : [["out", "square", "Picture in picture out of the pane", "pip video player window float undock"] as const]),
      ["toggle", "square", "Picture in picture: play / pause", "pip video player pause resume"],
      ["keys", "square", "Picture in picture: keys", "pip video player help shortcuts list ? keybindings"],
      ["snap", "square", "Picture in picture: snap to corners on / off", "pip video player magnet snapping corner edge grid align"],
      ["mute", "square", "Picture in picture: sound off / on", "pip video player mute unmute volume audio"],
      ["rewind", "chevron-left", "Picture in picture: back 10 seconds", "pip video player skip rewind seek"],
      ["forward", "chevron-right", "Picture in picture: on 10 seconds", "pip video player skip forward seek"],
      ["back", "monitor", "Picture in picture: back into the page", "pip video player return web page end"],
      ["close", "x", "Close picture in picture", "pip video player stop end quit"],
    ];

    for (const [cmd, icon, title, words] of pip) {
      out.push({ name: `pip.${cmd}`, args: {}, group: "Open", icon, title, words, go: () => run(`pip.${cmd}`) });
    }
  }

  return out;
}

/** Nocturne's own entries: its panels, tools, agents, pins, the dock, the keyboard's
 *  ways in, the player; in the palette's order. */
export function openEntries(): Entry[] {
  const h = here();
  const target = focusedPane();

  return [...panelEntries(), ...folderEntries(h), ...toolEntries(), ...agentAndSpaceEntries(h), ...gitAndGridEntries(),
    ...pinEntries(target), ...dockAndNoteEntries(target), ...keyboardEntries(h), ...pipEntries()];
}
