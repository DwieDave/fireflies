// Leaving the git window for something else: a program in a terminal floating
// over the tab (an editor on a file or folder), the system's opener, another
// repo (recent ones from the spaces' folders).

import { spaces, panes, run, closeOverlay } from "herdr";
import { start } from "./reads.ts";
import type { default as GitView } from "./main.ts";

/** A program in a terminal floating over the tab (an editor, git's own editor). */
export function terminal(v: GitView, argv: readonly string[], name: string, folder: string | null = v.git?.root ?? null) {
  run("terminal.open", { argv, folder, place: "float", name });

  // lazygit suspends for an editor; the floating window would sit over it.
  if (v.overlay) {
    v.saveState();
    closeOverlay(v.overlay);
  }
}

export function editFile(v: GitView, path: string) {
  terminal(v, ["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} "$1"', "-", path], path.split("/").pop() ?? path);
}

/** $VISUAL / $EDITOR on a folder (a worktree), in a floating terminal there. */
export function editIn(v: GitView, folder: string) {
  terminal(v, ["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} .'], folder.split("/").pop() ?? folder, folder);
}

export function openFile(v: GitView, path: string) {
  const root = v.git?.root ?? "";

  run("preview.open", v.on ? { path: `${root}/${path}`, in: "system", on: v.on } : { path: `${root}/${path}`, in: "system" });
}

export function recentRepos(v: GitView) {
  const seen = new Set([v.git?.root, v.folder]);
  const out: { folder: string; name: string }[] = [];

  for (const s of spaces()) {
    for (const f of [s.folder, ...panes().filter((p) => s.tabs.some((c) => c.id === p.tab)).map((p) => p.cwd)]) {
      if (!f || seen.has(f) || s.machine !== v.on) continue;

      seen.add(f);
      out.push({ folder: f, name: f.split("/").pop() ?? f });
    }
  }

  return out.slice(0, 20);
}

export function switchRepo(v: GitView, folder: string) {
  v.saveState();
  v.folder = folder;
  v.git = null;
  v.state = "loading";
  v.subs = { status: [], files: [], branches: [], commits: [], stash: [] };
  v.sel = {};
  v.top = {};
  v.staging = null;
  v.focus = "side";
  v.main = null;
  v.data.main = null;
  v.review.files = [];
  v.watching = false;
  v.wtPicked = new Set();
  start(v);
}
