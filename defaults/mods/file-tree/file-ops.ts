// The files pane's file operations: a new file or folder and renames (the
// name row), moves, cut and paste, delete to the Trash after asking; each
// change recorded for the editors to follow.

import type { Context, KeyEvent } from "gpui-kit";
import { exec, home, shared, setShared } from "herdr";
import { readShared, readSharedList, writeShared } from "./guard.ts";
import type { Clip, CutItem, DraftRow, Moved, NewKind, Row } from "./logic.ts";
import { isHidden, lists, withChanges, cutItems, base, dirOf, join, relTo, resolveName, renameTarget, moveRefusal, stemRange, neighbour, movedFolders, parentsOf, cleanError, PROBE, OPS } from "./logic.ts";
import type { Ask, Outcome } from "./state.ts";
import { messageOf, CHANGES, CUT, tilde, DRAFT } from "./state.ts";
import { clearSearch } from "./search.ts";
import type { default as Files } from "./main.ts";
import { runSet, setOf } from "./drag.ts";

/** Runs one of OPS's operations on this pane's machine: true when it worked;
 *  otherwise the reason is said in the pane and the tree is listed again. */
export async function fileOp(v: Files, args: readonly string[], name: string, cx: Context): Promise<boolean> {
  const r = await runOp(v, args);

  if (r.code === 0) return true;

  v.say(why(v, r, name), cx, { draft: r.code === 3 });
  v.refresh(cx);

  return false;
}

/** One of OPS's operations on this pane's machine: its exit code and stderr. */
export async function runOp(v: Files, args: readonly string[]): Promise<Outcome> {
  try {
    return await exec("sh", ["-c", OPS, "files-op", ...args], { on: v.on });
  } catch (cause: unknown) {
    return { code: -1, stderr: messageOf(cause) };
  }
}

/** Why an operation on `name` failed, in a line. */
export function why(v: Files, r: Outcome, name: string): string {
  return r.code === 3 ? `“${name}” already exists` : r.code === 4 ? `“${name}” isn't there anymore`
    : r.code === 5 ? `“${name}” couldn't go to the Trash` : cleanError(r.stderr);
}

/** Renames, moves and deletes that worked ({ from, to } absolute; `to`
 *  null for a delete; a folder once, with its own paths), appended to the
 *  shared record the editors follow. */
export function recordChanges(v: Files, entries: readonly Moved[]): void {
  if (entries.length) setShared(CHANGES.name, withChanges(readSharedList(shared, CHANGES), entries, v.on, Date.now()));
}

/** After `rel` moved to `to` (relative, or null: out of the tree or
 *  deleted): its unfolded folders follow it, its listings go, a cut of it is used up. */
export function forget(v: Files, rel: string | null, to: string | null, abs: string): void {
  if (rel !== null) {
    v.folders = movedFolders(v.folders, rel, to);

    for (const k of v.entries.keys()) if (k === rel || k.startsWith(`${rel}/`)) v.entries.delete(k);
  }

  const all = cutItems(clipNow(v));
  const left = all.filter((c) => c.abs !== abs && !c.abs.startsWith(`${abs}/`));

  if (clipNow(v) && left.length !== all.length) writeShared(setShared, CUT, left.length ? { on: v.on, items: left } : null);
}

/** The machine's trash tool ("" where there is none: deletes are permanent), asked once. */
export async function trashTool(v: Files): Promise<string> {
  if (v.trash === null) {
    const r = await exec("sh", ["-c", PROBE, "files-trash-probe"], { on: v.on }).catch(() => null);

    v.trash = r?.code === 0 ? r.stdout.trim() : "";
  }

  return v.trash;
}

export function absOf(v: Files, rel: string): string {
  return join(v.root, rel);
}

/** Shows `abs` once the tree is listed again: its folders unfold, the
 *  selection lands on it. Outside the root, or hidden by a filter: said. */
export function landOn(v: Files, abs: string, cx: Context, done: string): string | null {
  // From the search's hits: the search ends, the result shows in the tree.
  if (v.query) clearSearch(v, cx);

  const rel = relTo(v.root, abs);

  if (rel === null) v.say(`${done} ${tilde(abs)}`, cx, { error: false });
  else if (rel && !lists(rel, v.filters, v.ignored)) v.say(`${done} “${base(rel)}”: ${isHidden(rel) ? "dotfiles are hidden (H)" : "ignored files are hidden (I)"}`, cx, { error: false });
  else if (rel) {
    for (const p of parentsOf(rel)) v.folders.add(p);

    v.want = rel;
  }

  v.refresh(cx);

  return rel;
}

/** a / A: an input row for the new file's or folder's name, in the
 *  selected folder (unfolded), beside the selected file, or in the root. */
export function startDraft(v: Files, kind: NewKind, row: Row | null | undefined, cx: Context): void {
  if (v.query) clearSearch(v, cx);

  let dir = "";
  let after: string | null = null;

  if (row?.path) {
    dir = row.dir ? row.path : dirOf(row.path);
    after = row.path;

    for (const p of parentsOf(row.path)) if (!v.folders.has(p)) v.toggle(p, cx);

    if (row.dir && !v.folders.has(row.path)) v.toggle(row.path, cx);
  }

  v.draft = { kind, dir, after, busy: false, shown: false };
  v.msg = null;
  v.nameInput?.set_value("");
  v.nameInput?.focus();
  cx.notify();
}

/** R: the row's name in the input, its stem selected. */
export function startRename(v: Files, row: Row | null | undefined, cx: Context): void {
  if (!row?.path) {
    v.say("The tree's root can't be renamed", cx);

    return;
  }

  const name = base(row.path);

  v.draft = { kind: "rename", path: row.path, dir: row.dir, name, busy: false, shown: false };
  v.sel = row.path;
  v.msg = null;
  v.nameInput?.set_value(name);
  v.nameInput?.focus();
  selectStem(v);
  cx.notify();
}

export function selectStem(v: Files): void {
  const d = v.draft;

  if (d?.kind === "rename" && v.nameInput?.value() === d.name) v.nameInput.set_selected_range(stemRange(d.name, d.dir));
}

/** Closes the input; the keyboard back on the tree. */
export function endDraft(v: Files, cx: Context | null, focus = true): void {
  v.draft = null;

  if (v.msg?.draft) v.msg = null;

  if (focus) v.focus();

  cx?.notify();
}

/** Enter in the input: creates, or renames / moves. A refusal or a failure
 *  leaves the input open to fix the name. */
export function commitDraft(v: Files, cx: Context): void {
  const d = v.draft;

  if (!d || d.busy) return;

  const typed = v.nameInput?.value() ?? "";
  const at = v.on ? null : home();

  if (d.kind === "rename") {
    const src = absOf(v, d.path);
    const t = renameTarget(src, typed, at);

    if (t.error !== undefined) v.say(t.error, cx, { draft: true });
    else if (t.abs === src) v.endDraft(cx);
    else moveEntry(v, src, t.abs, d.path, cx, "Moved to");

    return;
  }

  const r = resolveName(absOf(v, d.dir), typed, at);

  if (r.error !== undefined) {
    v.say(r.error, cx, { draft: true });

    return;
  }

  const folder = d.kind === "folder" || r.folder;

  d.busy = true;
  cx.spawn(async (cx) => {
    const ok = await fileOp(v, [folder ? "folder" : "file", r.abs], base(r.abs), cx);

    d.busy = false;

    if (ok && v.draft === d) v.endDraft(cx);

    if (ok) {
      const rel = landOn(v, r.abs, cx, "Made");

      // A new file opens to be written: its text (a Markdown file with its preview beside).
      if (!folder && rel) v.edit(rel, cx);
    }

    cx.notify();
  });
}

/** Moves `src` to `dst` (absolute; `rel`: src in the tree). Unfolded folders
 *  under it stay unfolded where it lands; a cut of it is used up. */
export function moveEntry(v: Files, src: string, dst: string, rel: string | null, cx: Context, done: string): void {
  const why = moveRefusal(src, dst, v.root);

  if (why) {
    v.say(why, cx, { draft: Boolean(v.draft) });

    return;
  }

  const d = v.draft;

  if (d) d.busy = true;

  cx.spawn(async (cx) => {
    const ok = await fileOp(v, ["move", src, dst], base(dst), cx);

    if (d) d.busy = false;

    if (ok && d && v.draft === d) v.endDraft(cx);

    if (ok) {
      recordChanges(v, [{ from: src, to: dst }]);
      forget(v, rel, relTo(v.root, dst) || null, src);
      landOn(v, dst, cx, done);
    }

    cx.notify();
  });
}

/** What's cut on this pane's machine, or null. */
export function clipNow(v: Files): Clip | null {
  const c = readShared(shared, CUT, null);

  return c && (c.on ?? null) === v.on ? c : null;
}

/** Whether `abs` is cut (on this machine). */
export function isCut(v: Files, abs: string): boolean {
  return cutItems(clipNow(v)).some((c) => c.abs === abs);
}

/** x: cuts the row for P (again on the same row: uncut); with marks, all of them. */
export function cutRow(v: Files, row: Row | null | undefined, cx: Context): void {
  const set = setOf(v, row ?? null);

  if (set.length > 1) {
    const items = set.map((r): CutItem => ({ abs: absOf(v, r.path), dir: r.dir, name: base(r.path) }));

    writeShared(setShared, CUT, { on: v.on, items });
    v.say(`Cut ${items.length} items: P pastes them in the selected folder`, cx, { error: false });

    return;
  }

  if (!row?.path) {
    v.say("The tree's root can't be moved", cx);

    return;
  }

  const abs = absOf(v, row.path);

  if (isCut(v, abs) && cutItems(clipNow(v)).length === 1) {
    writeShared(setShared, CUT, null);

    return;
  }

  writeShared(setShared, CUT, { on: v.on, items: [{ abs, dir: row.dir, name: base(row.path) }] });
  v.say(`Cut “${base(row.path)}”: P pastes it in the selected folder`, cx, { error: false });
}

/** P: moves what's cut into the selected folder (beside a selected file; the root with none). */
export function paste(v: Files, row: Row | null | undefined, cx: Context): void {
  const c = readShared(shared, CUT, null);
  const items = cutItems(c);
  const first = items[0];

  if (!c || !first) {
    v.say("Nothing is cut: x cuts a row", cx);

    return;
  }

  if ((c.on ?? null) !== v.on) {
    v.say("It was cut on another machine", cx);

    return;
  }

  const into = absOf(v, !row?.path ? "" : row.dir ? row.path : dirOf(row.path));

  if (items.length === 1) moveEntry(v, first.abs, join(into, first.name), relTo(v.root, first.abs), cx, "Moved to");
  else v.moveSet(items.map((x) => x.abs), into, cx);
}

/** d: asks first (the item named, a folder's contents, trash or permanently);
 *  with marks, once for all of them (the count and the first names). */
export function askDelete(v: Files, row: Row | null | undefined, cx: Context): void {
  const set = setOf(v, row ?? null);
  const path = row?.path;

  if (set.length <= 1 && !path) {
    v.say("The tree's root can't be deleted", cx);

    return;
  }

  cx.spawn(async (cx) => {
    const trash = await trashTool(v);

    if (set.length > 1) v.ask = { set: set.map((r) => ({ path: r.path, dir: r.dir, name: base(r.path) })), trash };
    else if (row && path) {
      v.ask = { path, dir: row.dir, name: base(path), trash };
      v.sel = path;
    }

    cx.notify();
  });
}

/** The delete question's keys: y or enter deletes, anything else keeps it. */
export function askKey(v: Files, a: Ask, e: KeyEvent, cx: Context): void {
  const k = e.key;
  const m = e.modifiers;

  v.ask = null;

  if (!m.platform && !m.control && !m.alt && (k === "enter" || k === "y")) removeAsked(v, a, cx);

  cx.stop_propagation();
  cx.notify();
}

export function removeAsked(v: Files, a: Ask, cx: Context): void {
  if (a.set) {
    const verb = a.trash ? "Moved" : "Deleted";
    const where = a.trash ? " to the Trash" : "";

    runSet(v, a.set.map((x) => ({ abs: absOf(v, x.path), args: ["delete", a.trash, absOf(v, x.path)], to: null })), cx,
      (n) => `${verb} ${n} ${n === 1 ? "item" : "items"}${where}`);

    return;
  }

  const next = neighbour(v.shown(), a.path);
  const abs = absOf(v, a.path);

  cx.spawn(async (cx) => {
    if (await fileOp(v, ["delete", a.trash, abs], a.name, cx)) {
      recordChanges(v, [{ from: abs, to: null }]);
      forget(v, a.path, null, abs);
      v.want = next;

      // From the search's hits: they're looked up again without it.
      if (v.query.trim()) v.search(cx);

      v.say(a.trash ? `Moved “${a.name}” to the Trash` : `Deleted “${a.name}”`, cx, { error: false });
      v.refresh(cx);
    }

    cx.notify();
  });
}

/** The rows with the new name's input row where it will appear. */
export function withDraft(v: Files, rows: readonly Row[]): readonly Row[] {
  const d = v.draft;

  if (!d || d.kind === "rename") return rows;

  let at = 0;

  if (d.after !== null) {
    const i = rows.findIndex((r) => r.path === d.after);

    at = i >= 0 ? i + 1 : d.dir ? rows.findIndex((r) => r.path === d.dir) + 1 : 0;
  }

  const folder = d.kind === "folder" || (v.nameInput?.value() ?? "").endsWith("/");
  const row: DraftRow = { path: DRAFT, name: "", dir: folder, depth: d.dir ? d.dir.split("/").length : 0, draft: true };

  return [...rows.slice(0, at), row, ...rows.slice(at)];
}
