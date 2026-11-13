// The files pane's tree: rooting it, listing folders (capped), reading it
// again on changes, folding, and the rows it shows (the tree, or the search's
// hits; the name row of a new file among them).

import type { Context } from "gpui-kit";
import { exec, panes, watchFolder } from "herdr";
import type { Row, TreeRow } from "./logic.ts";
import { parent, parseIgnored, isIgnored, isHidden, lists } from "./logic.ts";
import { MOD, directory, PER_FOLDER, TOTAL, byName, messageOf, isSlotted } from "./state.ts";
import type { default as Files } from "./main.ts";
import { reloadLook } from "./look.ts";
import { clearSearch } from "./search.ts";

export function reroot(v: Files, folder: string, cx: Context): void {
  v.root = folder;
  v.gen++;
  v.entries = new Map();
  v.folders = new Set();
  v.pending = new Set();
  v.marks = new Map();
  v.ignored = new Set();
  v.error = null;
  v.limited = false;
  v.sel = null;
  v.marked = new Set();
  v.range = null;
  v.anchor = null;
  v.watched = null;

  if (v.query) clearSearch(v, cx);

  v.refresh(cx);
}

export async function loadFolderOf(v: Files, path: string, gen: number): Promise<void> {
  const entries = await directory(path ? `${v.root}/${path}` : v.root, v.on);

  if (gen !== v.gen || (path && !v.folders.has(path))) return;

  let used = 0;

  for (const [p, e] of v.entries) if (p !== path) used += e.length;

  const room = Math.max(0, Math.min(PER_FOLDER, TOTAL - used));

  if (entries.length > room) v.limited = true;

  v.entries.set(path, entries.slice(0, room).sort(byName));
}

export function refreshTree(v: Files, cx: Context): void {
  if (v.loading) {
    v.again = true;

    return;
  }

  const gen = v.gen;
  const root = v.root;
  const on = v.on;

  v.loading = true;
  v.limited = false;
  cx.spawn(async (cx) => {
    try {
      for (const path of ["", ...v.folders]) {
        if (gen !== v.gen) return;

        await v.loadFolder(path, gen);
      }

      const marks = new Map<string, string>();
      let ignored = new Set<string>();
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(() => null);

      if (top?.code === 0) {
        // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would fire again.
        const st = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on }).catch(() => null);
        const base = top.stdout.trim();

        if (st?.code === 0) {
          for (const entry of st.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            const abs = `${base}/${entry.slice(3)}`;

            marks.set(abs, mark);

            // A folder carries a dot when anything under it changed.
            for (let d = parent(abs); d.length > base.length && !marks.has(d); d = parent(d)) marks.set(d, "•");
          }
        }

        // What git ignores here, relative to the root (an ignored folder once, not its files).
        const ig = await exec("git", ["--no-optional-locks", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: root, on }).catch(() => null);

        if (ig?.code === 0) ignored = parseIgnored(ig.stdout);

        v.branch = (await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null))?.stdout.trim() || null;
      } else v.branch = null;

      if (gen !== v.gen) return;

      v.marks = marks;
      v.ignored = ignored;
      v.error = null;
      v.watch(cx);
    } catch (cause: unknown) {
      if (gen === v.gen) v.error = messageOf(cause);
    } finally {
      v.loading = false;
      cx.notify();

      if (v.again) {
        v.again = false;
        v.refresh(cx);
      }
    }
  });
}

export function watchTree(v: Files, cx: Context): void {
  if (v.on || v.watched === v.root) return;

  const root = v.root;

  v.watched = root;
  cx.spawn(async (cx) => {
    try {
      while (v.watched === root) {
        await watchFolder(root);

        if (v.watched === root) {
          v.refresh(cx);
          reloadLook(v);
        }
      }
    } catch {
      if (v.watched === root) v.watched = null;
    }
  });
}

export function toggleFolder(v: Files, path: string, cx: Context): void {
  if (v.folders.has(path)) {
    for (const f of v.folders) {
      if (f === path || f.startsWith(`${path}/`)) {
        v.folders.delete(f);
        v.entries.delete(f);
      }
    }
  } else {
    v.folders.add(path);

    if (!v.entries.has(path) && !v.pending.has(path)) {
      const gen = v.gen;

      v.pending.add(path);
      cx.spawn(async (cx) => {
        try {
          await v.loadFolder(path, gen);
        } catch (cause: unknown) {
          if (gen === v.gen) v.error = messageOf(cause);
        } finally {
          v.pending.delete(path);
          cx.notify();
        }
      });
    }
  }

  cx.notify();
}

/** The visible rows, depth-first: { path, name, dir, depth, ignored }; what
 *  the filters leave out is counted in `this.cut`. */
export function treeRows(v: Files): TreeRow[] {
  const out: TreeRow[] = [];
  const cut = { hidden: 0, ignored: 0 };

  const walk = (prefix: string, depth: number): void => {
    if (out.length >= TOTAL || depth > 40) return;

    for (const e of v.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;

      const path = prefix ? `${prefix}/${e.name}` : e.name;

      if (!lists(path, v.filters, v.ignored)) {
        if (!v.filters.hidden && isHidden(path)) cut.hidden++;
        else cut.ignored++;

        continue;
      }

      out.push({ path, name: e.name, dir: e.dir, depth, ignored: isIgnored(path, v.ignored) });

      if (e.dir && v.folders.has(path)) walk(path, depth + 1);
    }
  };

  walk("", 0);
  v.cut = cut;

  return out;
}

/** What the list shows: the search's hits while there's a query, else the tree. */
export function shownRows(v: Files): readonly Row[] {
  return v.query.trim() && v.hits ? v.hits : v.rows();
}

/** The row at `path` in the list. */
export function rowAt(v: Files, path: string | null): Row | null {
  return path === null ? null : v.shown().find((r) => r.path === path) ?? null;
}

/** The slots of the files panes there are now (a kept entry of another is dropped). */
export function liveSlots(): Set<string> {
  return new Set(panes().flatMap((p) => (p.mod === MOD && isSlotted(p.props) && p.props.slot ? [p.props.slot] : [])));
}

/** `map` with this pane's `value` under its slot, the panes that are gone left out. */
export function keptFor<T>(view: Files, map: ReadonlyMap<string, T>, slot: string, value: T): Map<string, T> {
  const live = liveSlots();
  const out = new Map<string, T>();

  for (const [k, v] of map) if (live.has(k)) out.set(k, v);

  out.set(slot, value);

  return out;
}
