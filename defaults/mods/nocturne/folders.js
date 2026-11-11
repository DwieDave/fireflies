// Where something opened "here" looks: the folders worth trying, best first.
// No imports, so every opener (picker.js, files.js, panels.js) and its tests
// can use it as is.
//
// A space that isn't attached keeps the folder it was made in, even after
// that folder is moved or deleted; a mod pane (the editor, the web pane) has
// no folder of its own. So the pane's live folder comes first, then the file
// or folder a mod pane shows, then the live folders of the space's
// terminals, and the space's own folder only last.

/** The folder a mod pane shows: the files pane's folder, the editor's or
 *  preview's file's folder. Null for a terminal or a mod without one. */
export function modFolder(pane) {
  const pr = pane?.mod ? pane.props : null;
  if (typeof pr?.folder === "string" && pr.folder) return pr.folder;
  if (typeof pr?.path === "string" && pr.path.startsWith("/")) return pr.path.replace(/\/[^/]*$/, "") || "/";
  return null;
}

/** The folders to try, best first, each once: the space's attached folder
 *  (when `attached`), the pane's live folder, the focused block's, the mod
 *  pane's (modFolder), the live folders of the space's terminals (its shown
 *  tab first), the space's own folder. `all` is panes(). */
export function folderCandidates(space, pane, f, all = [], { attached = true } = {}) {
  const tabs = space?.tabs ?? [];
  const shown = tabs.find((c) => c.active)?.id;
  const mine = new Set(tabs.map((c) => c.id));
  const live = all.filter((p) => mine.has(p.tab) && p.cwd).sort((a, b) => Number(b.tab === shown) - Number(a.tab === shown)).map((p) => p.cwd);
  const list = [attached && space?.attached && space.folder, pane?.cwd, f?.cwd, modFolder(pane), ...live, space?.folder];
  return [...new Set(list.filter((x) => typeof x === "string" && x))];
}
