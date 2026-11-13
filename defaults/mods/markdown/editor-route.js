// Which editor pane takes a file, as tabs (editor's tabs). The same
// file sits in editor, file-tree, finder and
// markdown (a mod can't import another's files);
// scripts/editor-tabs.test.ts fails when the copies differ: edit one,
// copy it to the others.
//
// An editor already showing the file in the shown tab shows it (its tab);
// a tab popped into a pane of its own takes no other files; else the editor the caller prefers (the one it sent files to before), the
// focused one, the one that last had the keyboard, the tab's first: the file
// opens there as a new tab (never in a scratchpad's pane), through shared `editor.open`
// { slot, path, line?, col?, view?, look?, n } (the editor whose slot it names
// opens it, n counts up). Every kind of file goes: a picture, a PDF, a table
// is drawn in its tab; `look` (opened to be looked at, not edited) starts a
// new tab drawn (Markdown takes the editor's view for it). With no editor in the shown
// tab, `editor.open` opens one beside the pane, as before; a `view` or `look`
// then waits for it in the same record with slot null.

export const EDITOR = "editor";
export const OPEN = "editor.open";
// The editor that last had the keyboard (its slot).
export const LAST = "editor.last";
// Every editor's files by slot (its tabs), for the app's `editor.open` too.
export const PATHS = "editor.paths";
// A tab popped out into a pane of its own, or moved into another editor:
// { slot, path, text?, saved?, caret, top, view, wrap, look, at } for the
// editor whose slot it names (its text with unsaved changes, where it was).
export const HANDOVER = "editor.handover";

/** A scratchpad's editor (it opened on a note under the app's folder,
 *  `…/scratchpad/<name>-<hash>.md`, editor/scratch.js): a pane of its
 *  own that other files don't go to. */
export function isScratchpad(pane) {
  return /\/scratchpad\/[^/]+-[0-9a-f]{8}\.md$/.test(String(pane?.props?.path ?? ""));
}

/** The files an editor pane holds: what it noted, else its props' file. */
export function filesOf(pane, paths) {
  const noted = paths?.[pane.props?.slot];
  return Array.isArray(noted) ? noted : typeof noted === "string" ? [noted] : pane.props?.path ? [pane.props.path] : [];
}

/** The editor pane in tab `tab` that takes `path` (on machine `on`), or null.
 *  `panes`: herdr's panes(); `focused`: the focused pane's id; `prefer`: a
 *  slot the caller sent files to; `last`: shared LAST; `paths`: shared PATHS.
 *  A tab popped into a pane of its own (props.popped) keeps its file there,
 *  but other files don't go to it. */
export function editorFor({ panes, tab, focused = null, prefer = null, last = null, paths = null, path, on = null }) {
  const all = (panes ?? []).filter((p) => p.mod === EDITOR && p.tab === tab && !p.parked && p.props?.slot && (p.props?.on ?? null) === (on ?? null) && !isScratchpad(p));
  const holder = all.find((p) => filesOf(p, paths).includes(path));
  if (holder) return holder;
  const eds = all.filter((p) => !p.props?.popped);
  if (!eds.length) return null;
  return eds.find((p) => p.props.slot === prefer)
    ?? eds.find((p) => p.pane === focused)
    ?? eds.find((p) => p.props.slot === last)
    ?? eds[0];
}

/** The shown tab's id, from herdr's spaces(). */
export function shownTab(spaces) {
  return (spaces ?? []).find((s) => s.active)?.tabs?.find((c) => c.active)?.id ?? null;
}

/** Opens `path` in the shown tab's editor as a tab, else in a new editor
 *  through `editor.open` beside `pane`. `h`: herdr's { run, panes, spaces,
 *  focused, shared, setShared }. -> the editor pane it went to, or null (a
 *  new one). */
export function openInEditor(h, { path, line = null, col = null, on = null, pane = null, prefer = null, view = null, look = false }) {
  const tab = shownTab(h.spaces());
  const target = editorFor({ panes: h.panes(), tab, focused: h.focused?.()?.pane ?? null, prefer, last: h.shared(LAST), paths: h.shared(PATHS), path, on });
  const n = (h.shared(OPEN)?.n ?? 0) + 1;
  const place = line ? { line, col: col ?? 1 } : {};
  if (target) {
    h.setShared(OPEN, { slot: target.props.slot, path, ...place, ...(view ? { view } : {}), ...(look ? { look: true } : {}), n, at: Date.now() });
    h.run("pane.focus", { pane: target.pane });
    return target;
  }
  if (view || look) h.setShared(OPEN, { slot: null, path, ...(view ? { view } : {}), ...(look ? { look: true } : {}), n, at: Date.now() });
  h.run("editor.open", { path, ...place, ...(pane ? { pane } : {}), ...(on ? { on } : {}), ...(look ? { look: true } : {}) });
  return null;
}
