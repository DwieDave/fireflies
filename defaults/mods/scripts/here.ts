// The folder the deck reads scripts from when its opener gave none: `mod.open
// {name: "scripts"}` (the palette's Scripts in any layout) and a scripts pane
// (`pane.split {mod: "scripts"}`) carry no props, where nocturne's opener
// passes the folder it found (nocturne/scripts.ts scriptsFolder). The same
// rule: the shown space's own folder (one chosen for it), else the focused
// terminal's, else a terminal's in the shown tab, else the space's folder.

import { focused, panes, spaces } from "herdr";
import type { PaneInfo } from "herdr";

/** Where scripts come from: a folder and its machine. */
export interface Here {
  readonly folder: string | null;
  readonly on: string | null;
}

/** A pane's live folder (a terminal's), or null (a mod's pane has none). */
const cwdOf = (p: PaneInfo | undefined): string | null => (p === undefined || p.terminal === null ? null : p.cwd);

/** The folder and machine of what's shown now, by the rule above. */
export function shownFolder(): Here {
  const space = spaces().find((s) => s.active) ?? null;

  if (space === null) return { folder: focused()?.cwd ?? null, on: null };

  const on = space.machine;

  if (space.attached && space.folder !== "") return { folder: space.folder, on };

  const tab = space.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const shown = panes().filter((p) => p.tab === tab);
  const candidates = [cwdOf(shown.find((p) => p.pane === f?.pane)), f?.cwd ?? null, ...shown.map(cwdOf), space.folder === "" ? null : space.folder];

  return { folder: candidates.find((c) => c !== null && c !== "") ?? null, on };
}
