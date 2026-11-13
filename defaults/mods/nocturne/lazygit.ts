// The lazygit pane: lazygit floating over the tab (terminal.open place
// "float", DwieDave fork); its float bar can dock it as a split beside the
// focused pane, which then gets the header below. It's
// started through this mod's bin/nocturne-lazygit, which layers Nocturne's
// skin (lazygit.yml) over the lazygit config: moonfly colors, square 1-bit
// borders, a dither spinner and moonfly git colors. A space on another
// machine runs plain `nocturne-lazygit` from its PATH (else lazygit).
// Docked, it's a terminal pane whose header (header.js) gives it the
// dithered Nocturne chrome.
// Nothing opens it any more (the git window, git.js, took its place); a lazygit
// pane or float started by hand still gets its header and float bar.

import { spaces, panes, run, exec, appHome } from "herdr";
import type { PaneInfo } from "herdr";
import { spaceFolder, terminalsNow } from "./kit.ts";
import type { Terminal } from "./guards.ts";

/** How to start Nocturne's lazygit: the wrapper this mod ships, here; on
 *  another machine (`on`) whatever it has on its PATH. */
export const lazygitArgv = (on: string | null): string[] => (on ? ["sh", "-c", 'exec "$(command -v nocturne-lazygit || echo lazygit)"'] : [`${appHome()}/mods/nocturne/bin/nocturne-lazygit`]);

/** The pane runs lazygit (Fireflies' program table knows it; the wrapper execs it). */
export const isLazygit = (p: { readonly program?: { readonly key: string } | undefined } | null | undefined): boolean => p?.program?.key === "lazygit";

/** The lazygit pane in the shown tab, if any. */
export function lazygitPane(): PaneInfo | null {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs.find((c) => c.active)?.id;

  return panes().find((p) => p.tab === tab && isLazygit(p)) ?? null;
}

/** The lazygit floating over the tab now, if any. */
export const lazygitFloat = (): Terminal | null => terminalsNow().find((x) => x.floating && isLazygit(x)) ?? null;

/** Lazygit is shown in this tab: docked as a pane or floating. With `view`,
 *  only when the float shows that view (0 lazygit, 1 diff). */
export function lazygitOpen(view?: number | null): boolean {
  const f = lazygitFloat();

  if (view != null) return (view === 0 && Boolean(lazygitPane())) || (Boolean(f) && (f?.floating_view ?? 0) === view);

  return Boolean(lazygitPane() || f);
}

/** The float's views: lazygit (0) and the diff of the same folder (1). */
const views = (folder: string | null, on: string | null) => ({ mod: "diff", props: { folder, on }, name: "diff" });

/** Floats lazygit over the tab, in the active space's folder (kit.ts spaceFolder), showing `show`
 *  (0 lazygit, 1 the diff; the float's bar switches between them). Again on
 *  the view it shows: closes it; on the other view: switches to it. A float
 *  hidden with the bar's ✕ (still running, no pane) in that folder is shown
 *  again rather than started twice. */
export function toggleLazygit(show = 0): void {
  const open = lazygitPane();

  if (open && show === 0) {
    run("pane.close", { pane: open.pane });

    return;
  }

  const float = lazygitFloat();

  if (float) {
    if ((float.floating_view ?? 0) === show) run("terminal.kill", { terminal: float.address });
    else run("float.view", { index: show });

    return;
  }

  const space = spaces().find((s) => s.active);
  const folder = spaceFolder(space, panes()) || undefined;
  const view = views(folder ?? null, space?.machine ?? null);
  const held = new Set(panes().map((p) => p.terminal));
  const hidden = terminalsNow().find((x) => isLazygit(x) && !held.has(x.address) && (x.cwd ?? folder) === folder);

  if (hidden) {
    run("terminal.peek", { terminal: hidden.address, float: true, view, show });

    return;
  }

  const argv = lazygitArgv(space?.machine ?? null);

  run("terminal.open", folder ? { argv, folder, place: "float", view, show } : { argv, place: "float", view, show });
}

/** The diff view of the float (the tab strip's git button, when there are changes). */
export const toggleDiff = (): void => toggleLazygit(1);

/** A folder's repo: its branch, ahead/behind and changed files. */
export interface GitState {
  branch: string | null;
  ahead: number;
  behind: number;
  changed: number;
}

/** Branch, ahead/behind and changed files of a folder's repo, or null. */
export async function gitState(folder: string, on: string | null): Promise<GitState | null> {
  const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd: folder, on });

  if (r.code !== 0) return null;

  const s: GitState = { branch: null, ahead: 0, behind: 0, changed: 0 };

  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) s.branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);

      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (line && !line.startsWith("#")) s.changed++;
  }

  return s;
}
