// The file picker and grep (the finder mod): cmd-p (nocturne.picker)
// and cmd-shift-f (nocturne.grep) open it over the window, searching the
// space's folder (else the focused pane's). The same key again closes it; the
// other one switches the open picker to its mode in place, the query kept.

import { spaces, panes, focused, openOverlay, closeOverlay, shared, setShared, run } from "herdr";
import { isString, literal, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { folderCandidates } from "./folders.ts";

/** The picker's two modes: files, or grep. */
const isPickerMode = literal("files", "grep");

export type PickerMode = Guarded<typeof isPickerMode>;

/** shared(): the open picker, { id, mode }, or null. */
const KEY = sharedKey("nocturne.picker-open", nullable(object({ id: isString, mode: isPickerMode })));

/** Where the picker searches (pickerFolder). */
export interface PickerFolder {
  readonly folder: string | null;
  readonly folders: string[];
  readonly space: string | null;
  readonly on: string | null;
}

/** The folders to search, best first (folderCandidates): the picker searches
 *  the first one that's there, as one that was moved or deleted can still
 *  be a space's folder. `folder`: the first; `space`: the space's own, which
 *  the picker names when none is there. */
export function pickerFolder(): PickerFolder {
  const space = spaces().find((s) => s.active);
  const f = focused();
  const all = panes();

  const pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const folders = folderCandidates(space, pane, f, all);

  return { folder: folders[0] ?? null, folders, space: space?.folder || null, on: space?.machine ?? null };
}

/** Opens the picker in `mode` ("files" | "grep"); closes it when it's open
 *  in that mode, switches it when it's open in the other. Most of the window
 *  (a share of it): the list beside a preview that fills its height. */
export function togglePicker(mode: PickerMode): void {
  const open = readShared(shared, KEY, null);

  if (open?.id) {
    if (open.mode !== mode) {
      // The picker hears it on nextCommand() and keeps the note's mode current.
      run(`finder.${mode}`);
      writeShared(setShared, KEY, { ...open, mode });

      return;
    }

    closeOverlay(open.id);
    writeShared(setShared, KEY, null);

    return;
  }

  const { folder, folders, space, on } = pickerFolder();

  const id = openOverlay({ mod: "finder", kind: "dialog", frame: "none", width: 0.92, height: 0.88,
    props: { mode, folder, folders, space, on } });

  writeShared(setShared, KEY, { id, mode });
}
