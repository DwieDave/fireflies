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

import { spaces, panes, terminals, run, exec, appHome } from "herdr";
import { spaceFolder } from "./kit.ts";

/** How to start Nocturne's lazygit: the wrapper this mod ships, here; on
 *  another machine (`on`) whatever it has on its PATH. */
export const lazygitArgv = (on) => (on ? ["sh", "-c", 'exec "$(command -v nocturne-lazygit || echo lazygit)"'] : [`${appHome()}/mods/nocturne/bin/nocturne-lazygit`]);

/** The pane runs lazygit (Fireflies' program table knows it; the wrapper execs it). */
export const isLazygit = (p) => p?.program?.key === "lazygit";

/** The lazygit pane in the shown tab, if any. */
export function lazygitPane() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs.find((c) => c.active)?.id;
  return panes().find((p) => p.tab === tab && isLazygit(p)) ?? null;
}

/** The lazygit floating over the tab now, if any. */
export const lazygitFloat = () => terminals().find((x) => x.floating && isLazygit(x)) ?? null;

/** Lazygit is shown in this tab: docked as a pane or floating. With `view`,
 *  only when the float shows that view (0 lazygit, 1 diff). */
export function lazygitOpen(view) {
  const f = lazygitFloat();
  if (view != null) return (view === 0 && Boolean(lazygitPane())) || (Boolean(f) && (f.floating_view ?? 0) === view);
  return Boolean(lazygitPane() || f);
}

/** The float's views: lazygit (0) and the diff of the same folder (1). */
const views = (folder, on) => ({ mod: "diff", props: { folder, on }, name: "diff" });

/** Floats lazygit over the tab, in the active space's folder (kit.js spaceFolder), showing `show`
 *  (0 lazygit, 1 the diff; the float's bar switches between them). Again on
 *  the view it shows: closes it; on the other view: switches to it. A float
 *  hidden with the bar's ✕ (still running, no pane) in that folder is shown
 *  again rather than started twice. */
export function toggleLazygit(show = 0) {
  const open = lazygitPane();
  if (open && show === 0) return run("pane.close", { pane: open.pane });
  const float = lazygitFloat();
  if (float) {
    if ((float.floating_view ?? 0) === show) return run("terminal.kill", { terminal: float.address });
    return run("float.view", { index: show });
  }
  const space = spaces().find((s) => s.active);
  const folder = spaceFolder(space, panes()) || undefined;
  const view = views(folder ?? null, space?.machine ?? null);
  const held = new Set(panes().map((p) => p.terminal));
  const hidden = terminals().find((x) => isLazygit(x) && !held.has(x.address) && (x.cwd ?? folder) === folder);
  if (hidden) return run("terminal.peek", { terminal: hidden.address, float: true, view, show });
  run("terminal.open", { argv: lazygitArgv(space?.machine ?? null), ...(folder ? { folder } : {}), place: "float", view, show });
}

/** The diff view of the float (the tab strip's git button, when there are changes). */
export const toggleDiff = () => toggleLazygit(1);

/** Branch, ahead/behind and changed files of a folder's repo, or null. */
export async function gitState(folder, on) {
  const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd: folder, on });
  if (r.code !== 0) return null;
  const s = { branch: null, ahead: 0, behind: 0, changed: 0 };
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) s.branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { s.ahead = +m[1]; s.behind = +m[2]; }
    } else if (line && !line.startsWith("#")) s.changed++;
  }
  return s;
}
