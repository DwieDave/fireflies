// Where something opened "here" looks: the folders worth trying, best first.
// No herdr imports at run time, so every opener (picker.ts, files.ts,
// panels.ts) and its tests can use it as is.
//
// A space that isn't attached keeps the folder it was made in, even after
// that folder is moved or deleted; a mod pane (the editor, the web pane) has
// no folder of its own. So the pane's live folder comes first, then the file
// or folder a mod pane shows, then the live folders of the space's
// terminals, and the space's own folder only last.

import type { PaneInfo, SpaceInfo } from "herdr";
import { isString, object } from "./guard.ts";

/** A mod pane's props, as far as its folder goes: the files pane's folder, a file's path. */
const isFolderProps = object({}, { folder: isString, path: isString });

/** The folder a mod pane shows: the files pane's folder, the editor's or
 *  preview's file's folder. Null for a terminal or a mod without one. */
export function modFolder(pane: Pick<PaneInfo, "mod" | "props"> | null | undefined): string | null {
  const pr = pane?.mod ? pane.props : null;

  if (!isFolderProps(pr)) return null;

  if (pr.folder) return pr.folder;

  if (pr.path?.startsWith("/")) return pr.path.replace(/\/[^/]*$/, "") || "/";

  return null;
}

/** The folders to try, best first, each once: the space's attached folder
 *  (when `attached`), the pane's live folder, the focused block's, the mod
 *  pane's (modFolder), the live folders of the space's terminals (its shown
 *  tab first), the space's own folder. `all` is panes(). */
export function folderCandidates(
  space: Pick<SpaceInfo, "tabs" | "attached" | "folder"> | null | undefined,
  pane: Pick<PaneInfo, "cwd" | "mod" | "props"> | null | undefined,
  f: { readonly cwd: string | null } | null | undefined,
  all: readonly Pick<PaneInfo, "tab" | "cwd">[] = [],
  { attached = true }: { readonly attached?: boolean } = {},
): string[] {
  const tabs = space?.tabs ?? [];
  const shown = tabs.find((c) => c.active)?.id;
  const mine = new Set(tabs.map((c) => c.id));
  const live = all.filter((p) => mine.has(p.tab) && p.cwd).sort((a, b) => Number(b.tab === shown) - Number(a.tab === shown)).map((p) => p.cwd);
  const list = [attached && space?.attached ? space.folder : null, pane?.cwd, f?.cwd, modFolder(pane), ...live, space?.folder];

  return [...new Set(list.flatMap((x) => (x ? [x] : [])))];
}
