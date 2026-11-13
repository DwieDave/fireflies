// Opening from the files pane: a file in the editor (the same editor each
// time), $EDITOR in a terminal, Neovim, a viewer pane, the system's app, a
// files pane of a folder; copying paths; closing a pane of its own; what the
// pane shows, for its header.

import type { Context } from "gpui-kit";
import * as herdr from "herdr";
import { editorProps, openInEditor } from "./editor-route.ts";
import { exec, run, panes, terminals, focused, shared, setShared } from "herdr";
import { readShared, readSharedMap, writeSharedMap } from "./guard.ts";
import type { Row } from "./logic.ts";
import { nvimLaunch } from "./logic.ts";
import type { EditorPlace } from "./state.ts";
import { MOD, FROM, isSlotted, isTerminal, isEdit, isMarkdown, viewerFor, editTool, TITLES, PATHS } from "./state.ts";
import { keptFor, liveSlots, rowAt } from "./tree.ts";
import type { default as Files } from "./main.ts";
import { absOf } from "./file-ops.ts";
import { setOf } from "./drag.ts";

/** This copy's own pane (found by its slot). */
export function ownPane(v: Files): herdr.PaneInfo | null {
  const slot = v.slot;

  return slot ? panes().find((p) => p.mod === MOD && isSlotted(p.props) && p.props.slot === slot) ?? null : null;
}

/** The shown tab, and the editor pane this panel opened there (nocturne-edit's terminal). */
export function editorPlace(v: Files): EditorPlace {
  const tab = v.shownTab();
  const ours = new Set(terminals().flatMap((x) => (isTerminal(x) && isEdit(x.argv?.[0]) ? [x.address] : [])));

  return { tab, pane: panes().find((p) => p.tab === tab && p.terminal && ours.has(p.terminal)) ?? null };
}

/** Where files open: beside a pane of its own; from the panel, beside the tab's first other pane. */
export function besidePane(v: Files): herdr.PaneInfo | null {
  if (v.alone) {
    const me = ownPane(v);

    if (me) return me;
  }

  const tab = v.shownTab();

  return panes().find((p) => p.tab === tab && p.mod !== MOD && !p.parked)
    ?? panes().find((p) => p.tab === tab && p.mod === MOD) ?? null;
}

/** Edits a file (relative to the root) in the app's editor (editor),
 *  beside this tab's other panes; a folder, or a file on another machine, in
 *  $EDITOR (terminalEdit). */
export function editPath(v: Files, path: string, cx: Context): void {
  const row = rowAt(v, path);

  if (v.on || !path || row?.dir) {
    terminalEdit(v, path, cx);

    return;
  }

  const beside = besidePane(v);
  // As a tab of the editor this pane sent files to, else the shown tab's
  // editor; with none, a new one beside (editor-route.ts). Markdown edited
  // as text opens with its preview beside it.
  const to = openInEditor(herdr, { path: `${v.root}/${path}`, pane: beside?.pane ?? null, prefer: v.editorSlot, view: isMarkdown(path) ? "split" : viewerFor(path) ? "text" : null });

  if (to) v.editorSlot = editorProps(to).slot ?? null;
}

/** Opens a file to look at it in the editor as a tab, whatever its kind (a
 *  picture, a PDF, a table drawn in its tab, Markdown in the editor's view for it): the
 *  editor this pane sent files to, else the shown tab's; with none, a new
 *  one beside (editor-route.ts). */
export function openLooked(v: Files, path: string): void {
  const beside = besidePane(v);
  const to = openInEditor(herdr, { path: `${v.root}/${path}`, pane: beside?.pane ?? null, prefer: v.editorSlot, look: true });

  if (to) v.editorSlot = editorProps(to).slot ?? null;
}

/** Opens a file or folder (relative to the root; "" is the root) in $EDITOR: in this
 *  tab's nvim when it is listening, else in a new terminal pane to this one's left. */
export function terminalEdit(v: Files, path: string, cx: Context): void {
  const abs = path ? `${v.root}/${path}` : v.root;
  const { tab, pane } = editorPlace(v);
  // One socket per tab; ids from other machines carry a "machine/" prefix.
  const key = (tab ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
  // Left of this pane: the files column stays on the tab's right edge.
  const self = ownPane(v) ?? panes().find((p) => p.tab === tab && p.mod === MOD);
  const argv = [editTool(v.on), "--listen", key, abs];
  const open = (): null => run("terminal.open", self ? { argv, folder: v.root, place: "left", pane: self.pane } : { argv, folder: v.root, place: "left" });

  if (!pane) {
    open();

    return;
  }

  cx.spawn(async () => {
    const r = await exec(editTool(v.on), ["--remote", key, abs], { cwd: v.root, on: v.on }).catch(() => null);

    if (r?.code === 0) run("pane.focus", { pane: pane.pane });
    else open();
  });
}

/** Neovim (the one on PATH) in a new terminal beside: on a file, in its
 *  folder; on a folder (or the root), `nvim .` there. */
export function nvim(v: Files, row: Row | null): void {
  const path = row?.path ?? "";
  const { argv, folder } = nvimLaunch(path ? `${v.root}/${path}` : v.root, !path || Boolean(row?.dir));
  const self = ownPane(v) ?? (v.alone ? null : panes().find((p) => p.tab === editorPlace(v).tab && p.mod === MOD));
  const place = v.alone ? "auto" : "left";

  run("terminal.open", self ? { argv, folder, place, pane: self.pane } : { argv, folder, place });
}

/** A folder (relative to the root) in a new files pane of its own. */
export function openPane(v: Files, path: string): void {
  const beside = besidePane(v);
  const at = path ? `${v.root}/${path}` : v.root;

  run("files.open", { path: at, ...(beside ? { pane: beside.pane } : null), ...(v.on ? { on: v.on } : null) });
}

/** The copied note goes after a moment. */
export function copiedNow(v: Files, cx: Context): void {
  const at = Date.now();

  v.copied = at;
  cx.timer.after(1400, (cx) => {
    if (v.copied === at) {
      v.copied = 0;
      cx.notify();
    }
  });
}

/** y with marks: every marked path, one a line. */
export function copySet(v: Files, cx: Context): void {
  const rows = setOf(v, rowAt(v, v.sel));
  const paths = rows.map((r) => absOf(v, r.path)).map((a) => (v.on ? `${v.on}:${a}` : a));

  cx.write_to_clipboard(paths.join("\n"));
  v.copiedText = `${paths.length} paths copied`;
  copiedNow(v, cx);
}

export function copyPath(v: Files, path: string, cx: Context): void {
  if (v.marked.size && (!path || v.marked.has(path) || path === v.sel)) {
    copySet(v, cx);

    return;
  }

  const abs = path ? `${v.root}/${path}` : v.root;

  cx.write_to_clipboard(v.on ? `${v.on}:${abs}` : abs);
  v.copiedText = null;
  copiedNow(v, cx);
}

/** Closes this pane (the panel too); from the panel, the keyboard goes back where it came from.
 *  Not close(): Fireflies calls that as cleanup once the pane is gone. */
export function closePane(v: Files): void {
  const me = ownPane(v) ?? (v.alone ? null : v.panel());

  if (!me) return;

  const from = readShared(shared, FROM, null);
  const had = focused()?.pane === me.pane;

  run("pane.close", { pane: me.pane });

  if (!v.alone && had && from && from !== me.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
}

/** p: a file in the app's viewer pane for it (the preview, Markdown), on
 *  purpose; others in the editor. */
export function previewRow(v: Files, row: Row | undefined, cx: Context): void {
  if (row && !row.dir && !row.head) openViewer(v, row.path, cx);
}

/** Opens a file as a tab of the editor, whatever its kind: Markdown in its
 *  preview, a picture, PDF or table drawn (look), other text to edit; on
 *  another machine the viewers' panes, as before (the editor's drawn tabs
 *  read this computer's files). `other` (alt-double-click, `e`): Markdown,
 *  tables and patches as text, a picture in the system's app. */
export function openFileAt(v: Files, path: string, cx: Context, other = false): void {
  const viewer = viewerFor(path);

  if (!viewer || (other && viewer.other === "edit")) v.edit(path, cx);
  else if (other) run(viewer.open, { path: `${v.root}/${path}`, in: "system", ...(v.on ? { on: v.on } : null) });
  else if (v.on) openViewer(v, path, cx);
  else openLooked(v, path);
}

/** A file in the app's viewer pane for it (the Markdown viewer, the
 *  preview), beside this tab's editor or its first other pane (else this
 *  one); a file without one in the editor. */
export function openViewer(v: Files, path: string, cx: Context): void {
  const viewer = viewerFor(path);

  if (!viewer) {
    v.edit(path, cx);

    return;
  }

  const beside = (v.alone ? ownPane(v) : null) ?? editorPlace(v).pane ?? besidePane(v);

  run(viewer.open, { path: `${v.root}/${path}`, ...(beside ? { pane: beside.pane } : null), ...(v.on ? { on: v.on } : null) });
}

/** Tells the pane header which folder a pane of its own shows, and the app
 *  (files.open finds the pane already on a folder) where it is rooted. */
export function publish(v: Files): void {
  const slot = v.slot;

  if (!v.alone || !slot) return;

  const live = liveSlots();
  const name = v.root === "/" ? "/" : v.root.split("/").pop() ?? "";

  for (const [key, value] of [[TITLES, name], [PATHS, v.root]] as const) {
    const was = readSharedMap(shared, key);

    if (was.get(slot) === value && [...was.keys()].every((k) => live.has(k) || k === slot)) continue;

    writeSharedMap(setShared, key, keptFor(v, was, slot, value));
  }
}
