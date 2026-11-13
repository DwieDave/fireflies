// The new-space picker ({ role: "newspace" }): one list of folders, a field
// to filter it or type a path, and enter makes the space there. The same list
// attaches an existing space to another folder (props.space: its id).
//
//   opens     hanging under the sidebar's "+ new" (or the press that asked,
//             `at`: kit.ts dropBelow), or centered from a key
//             (nocturne.space-new), the "+ new" menu, the palette and the
//             folded rail; a space's "Change folder…" hangs it under the row
//             right-clicked
//   list      folderlist.ts: here, spaces, near, recent; then "browse…" (the
//             system's folder browser) and, always last, "no folder" (a space
//             of its own in ~; attaching: "detach", back to ~)
//   typing    filters by the folder's name, then its path; a field starting
//             with ~ or / lists that folder's subfolders instead
//   name      unnamed spaces are called after their folder; cmd-enter on a
//             row asks for a name first, the folder's in the field
//
// The dock (dock.ts) is never attached: its row has no Change folder, and
// asking anyway (the palette's "Change this space's folder…") opens nothing.
// "no folder" here makes an ordinary space in ~, not the dock.
//
// Keys: ↑ ↓ (ctrl-n / ctrl-p) move, wrapping (↑ from the top: "no folder");
// enter makes (attaches); cmd-enter names it first; tab puts the row's path
// in the field and lists inside it; shift-tab goes one folder up; esc leaves
// the name for the list, else closes. A click on a row picks it.

import { div } from "gpui-kit";
import type { AsyncContext, Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex, InputState, ScrollHandle } from "gpui-base";
import type { ScrollHandle as Scroll } from "gpui-base";
import { theme, props, run, exec, home, spaces, panes, focused, shared, setShared, openOverlay, closeOverlay, pickFolder } from "herdr";
import type { ExecResult, SpaceInfo, Theme } from "herdr";
import { isString, nullable, object, readShared, readSharedList, sharedKey, sharedListKey, writeShared } from "./guard.ts";
import { dither, eyebrow, spaceFolder } from "./kit.ts";
import type { DropAt } from "./kit.ts";
import { isDock } from "./dock.ts";
import { tilde, untilde, isPath, splitPath, rank, sources, pathRows, complete, ghost, up, remember, newArgs, nearParents, worktreePaths, checkoutsFrom, folderName, tail } from "./folderlist.ts";
import type { FolderRow, Near, RankedRow, RowFrom } from "./folderlist.ts";
import { FOOT, HEAD, ROW, fieldBox, pickRow, pickerFoot, pickerHead, sayNow } from "./newspace-draw.ts";
import type { PickRow } from "./newspace-draw.ts";

/** shared() key: the folders spaces were made in or attached to here, newest first. */
export const RECENT = "nocturne.recent-folders";
const RECENT_KEY = sharedListKey(RECENT, isString);

/** shared() key: the open picker, { id: its overlay, space: the one it attaches, or null }. */
export const OPEN = "nocturne.newspace-open";
const OPEN_KEY = sharedKey(OPEN, nullable(object({ id: isString }, { space: nullable(isString) })));

// Wide enough for a name, its path and its tag, and the footer's words beside its keys.
export const WIDTH = 520;
const SEC = 24;
const LIST_MAX = 12 * ROW;
const CONTEXT = "NewSpace";
const TAB = "newspace::tab";
const TAB_BACK = "newspace::tab_back";
const ESC = "newspace::escape";

// A folder's subfolders, "::", then the ones that are checkouts (and ./.git when it is one).
export const LIST_SCRIPT = 'cd "$1" 2>/dev/null || exit 1; find -L . -mindepth 1 -maxdepth 1 -type d 2>/dev/null; echo ::; find -L . -mindepth 2 -maxdepth 2 -name .git 2>/dev/null; if [ -e .git ]; then echo ./.git; fi; exit 0';

/** The list's sections' eyebrows, by where their rows come from. */
const SECTIONS: ReadonlyMap<RowFrom, string> = new Map([["here", "here"], ["spaces", "spaces"], ["near", "near"], ["recent", "recent"], ["now", "now"]]);

/** The focused pane's folder now: where "here" starts. */
export function hereFolder(): string | null {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;

  return pane?.cwd || f?.cwd || null;
}

/** How the picker opens (openSpacePicker). */
export interface SpacePickerOpening {
  readonly at?: DropAt | null;
  readonly space?: string | null;
  readonly wasOpen?: boolean;
  readonly replace?: boolean;
}

/** The picker's props. */
type PickerProps = { role: "newspace"; here: string | null; space?: string };

/**
 * Opens the picker: making a space, or (space: an id) attaching that one to
 * another folder. `at`: where it hangs (kit.ts dropBelow); centered without.
 * Open already: closes it (a second key press). `wasOpen`: "+ new" was lit
 * when pressed, so the press closed it already; it stays closed. `replace`:
 * an open one gives way to this one even when it's the same (a menu's ask).
 */
export function openSpacePicker({ at = null, space = null, wasOpen = false, replace = false }: SpacePickerOpening = {}): string | null {
  // The dock (dock.ts) keeps no folder: nothing attaches it, from any menu or palette.
  if (space && isDock(spaces().find((s) => s.id === space))) return null;

  const open = readShared(shared, OPEN_KEY, null);

  if (open?.id) {
    writeShared(setShared, OPEN_KEY, null);
    closeOverlay(open.id);

    // The same picker asked for again: that closes it. Another one replaces it.
    if (!replace && (open.space ?? null) === (space ?? null)) return null;
  }

  if (wasOpen && !space) return null;

  const props: PickerProps = space ? { role: "newspace", here: hereFolder(), space } : { role: "newspace", here: hereFolder() };

  const id = openOverlay(at
    ? { mod: "nocturne", kind: "popup", frame: "none", width: WIDTH, at, height: HEAD + LIST_MAX + 4 * SEC + FOOT + 12, props }
    : { mod: "nocturne", kind: "dialog", frame: "none", width: WIDTH, props });

  writeShared(setShared, OPEN_KEY, { id, space: space ?? null });

  return id;
}

/** A new-space picker is open ("+ new" stays lit; not for one attaching a space). */
export const pickerOpen = (): boolean => {
  const open = readShared(shared, OPEN_KEY, null);

  return Boolean(open?.id) && !open?.space;
};

/** A folder's subfolders (path typing): their names, the checkouts among them, whether it could be listed. */
interface Listing {
  readonly names: string[];
  readonly git: Set<string>;
  readonly ok: boolean;
}

/** What the picker found to list: here, the spaces' folders, the checkouts near them. */
interface Found {
  here: string | null;
  hereBranch: string | null;
  spaces: { readonly path: string; readonly branch: string | null }[];
  near: Near[];
  readonly git: Set<string>;
}

/** The rows for the field as typed: a typed path's (its folder; still asking; nothing there), or the list's. */
interface FolderView {
  readonly path: boolean;
  readonly dir?: string;
  readonly asking?: boolean;
  readonly empty?: boolean;
  readonly rows: RankedRow[];
}

/** The picker's props: the space it attaches, where "here" is, its overlay. */
const isPickerProps = object({}, { space: isString, here: nullable(isString), overlay: isString });

/** This picker's overlay id, if it has one. */
const overlayNow = (): string | undefined => {
  const p = props();

  return isPickerProps(p) ? p.overlay : undefined;
};

/** The list's children, and which of them is the cursor's row (-1: none). */
interface ListItems {
  readonly items: Element[];
  readonly cursorChild: number;
}

export default class NewSpace {
  static bound = false;

  home = "";
  space: SpaceInfo | null = null;
  on: string | null = null;
  cursor = 0;
  naming: { readonly folder: string | null } | null = null; // the row being named (cmd-enter)
  error = "";
  busy = false;
  done = false;
  reveal = false;
  lists = new Map<string, Listing | "asking">(); // folder → its subfolders (path typing), or "asking"
  found: Found = { here: null, hereBranch: null, spaces: [], near: [], git: new Set() };
  query = "";
  input: InputState | null = null;
  nameInput: InputState | null = null;
  scroll: Scroll | null = null;

  init(p: Props | undefined, cx: Context): void {
    const raw = props() ?? p;
    const pr = isPickerProps(raw) ? raw : {};

    this.home = home();
    this.space = pr.space ? (spaces().find((s) => s.id === pr.space) ?? null) : null;
    this.on = this.space?.machine ?? null;

    const input = InputState.new({ placeholder: "a folder, or a path: ~/ /" });
    const nameInput = InputState.new({ placeholder: "name (empty: the folder's)" });

    this.input = input;
    this.nameInput = nameInput;
    input.on("change", (_e, later) => this.changed(later));
    input.on("submit", (e, later) => this.enter(Boolean(e.secondary), later));
    nameInput.on("submit", (_e, later) => this.enter(false, later));
    this.scroll = ScrollHandle.new();
    this.focusField();

    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.focusField());

    if (!NewSpace.bound) {
      try {
        cx.bind_keys([
          { keystroke: "tab", action: TAB, context: CONTEXT },
          { keystroke: "shift-tab", action: TAB_BACK, context: CONTEXT },
          { keystroke: "escape", action: ESC, context: CONTEXT },
        ]);
        NewSpace.bound = true;
      } catch {
        /* the key handler still tries */
      }
    }

    this.seed(pr.here ?? null);
    cx.spawn((later) => this.look(later));
  }

  focusField(): void {
    if (this.done) return; // closed: its inputs are going

    (this.naming ? this.nameInput : this.input)?.focus();
  }

  close(): void {
    this.done = true;

    const overlay = overlayNow();

    if (readShared(shared, OPEN_KEY, null)?.id === overlay) writeShared(setShared, OPEN_KEY, null);

    if (overlay) closeOverlay(overlay);
  }

  /** The overlay is going (esc, a click beside it, a pick). */
  closing(): void {
    if (readShared(shared, OPEN_KEY, null)?.id === overlayNow()) writeShared(setShared, OPEN_KEY, null);
  }

  // ---- the folders

  /** What's known at once: the spaces' folders and branches, the recent list. */
  seed(here: string | null): void {
    const all = panes();

    this.found.here = here && here !== this.home ? here : null;
    this.found.spaces = spaces().filter((s) => (s.machine ?? null) === this.on && s.id !== this.space?.id)
      .flatMap((s) => {
        const path = spaceFolder(s, all);

        return path ? [{ path, branch: s.branch ?? null }] : [];
      });
  }

  /** Asks git and the disk, once: here's checkout, the repos' worktrees, the checkouts beside them. */
  async look(cx: AsyncContext): Promise<void> {
    const on = this.on;

    const run1 = async (cmd: string, args: string[], cwd?: string): Promise<ExecResult> => {
      try {
        return await exec(cmd, args, cwd ? { on, timeout: 4000, cwd } : { on, timeout: 4000 });
      } catch {
        return { code: 1, stdout: "", stderr: "" };
      }
    };

    if (this.found.here) {
      const r = await run1("git", ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], this.found.here);
      const [top, branch] = r.stdout.trim().split("\n");

      if (r.code === 0 && top) {
        this.found.here = top === this.home ? null : top;
        this.found.hereBranch = branch && branch !== "HEAD" ? branch : null;
        this.found.git.add(top);
      }
    }

    const folders = [this.found.here, ...this.found.spaces.map((s) => s.path)].flatMap((f) => (f ? [f] : []));
    const trees: Near[] = [];

    for (const f of [...new Set(folders)].slice(0, 8)) {
      const r = await run1("git", ["worktree", "list", "--porcelain"], f);

      if (r.code !== 0) continue;

      this.found.git.add(f);

      const paths = worktreePaths(r.stdout);

      // The first is the main checkout; the rest are linked worktrees.
      paths.forEach((p, i) => trees.push({ path: p, worktree: i > 0 }));
    }

    const parents = nearParents([...folders, ...trees.flatMap((t) => (t.worktree ? [] : [t.path]))], this.home).slice(0, 6);
    let beside: Near[] = [];

    if (parents.length) {
      const all = await run1("find", [...parents, "-mindepth", "2", "-maxdepth", "2", "-name", ".git"]);
      const files = await run1("find", [...parents, "-mindepth", "2", "-maxdepth", "2", "-name", ".git", "-type", "f"]);

      beside = checkoutsFrom(all.stdout, new Set(files.stdout.split("\n").flatMap((l) => (l.trim() ? [l.trim()] : []))));
    }

    this.found.near = [...trees, ...beside];

    for (const n of this.found.near) this.found.git.add(n.path);

    cx.notify();
  }

  /** The subfolders of `dir` (path typing), asked once and kept. */
  list(dir: string, cx: Context | null): Listing | "asking" {
    const known = this.lists.get(dir);

    if (known) return known;

    if (!cx) return "asking"; // drawing: changed() asks

    this.lists.set(dir, "asking");
    cx.spawn(async (later) => {
      let names: string[] = [];
      let git = new Set<string>();
      let ok = false;

      try {
        const r = await exec("sh", ["-c", LIST_SCRIPT, "sh", dir], { on: this.on, timeout: 4000 });

        ok = r.code === 0;

        const [ds = "", gs = ""] = r.stdout.split("::");

        names = ds.split("\n").flatMap((l) => {
          const n = l.trim().replace(/^\.\//, "");

          return n ? [n] : [];
        });
        git = new Set(gs.split("\n").flatMap((l) => (l.trim() ? [l.trim().replace(/^\.\//, "").replace(/\/?\.git$/, "") || "."] : [])));
      } catch {
        /* an empty list says it */
      }

      this.lists.set(dir, { names, git, ok });
      later.notify();
    });

    return "asking";
  }

  /** The folder rows now, for the field as typed. */
  folderRows(cx: Context | null): FolderView {
    const q = this.query;

    if (isPath(q)) {
      const { dir } = splitPath(q, this.home);
      const got = this.list(dir, cx);

      if (got === "asking") return { path: true, dir, asking: true, rows: [] };

      const rows = got.ok ? pathRows(q, this.home, got.names, got.git).rows : [];
      // Nothing under it: the typed path itself, looked for on enter.
      const typed = untilde(q, this.home);

      if (!rows.length && typed !== this.home) rows.push({ path: typed, name: folderName(typed, this.home), from: "typed", tag: "", hits: [] });

      return { path: true, dir, rows, empty: !got.ok || rows[0]?.from === "typed" };
    }

    const f = this.found;

    const list = sources({
      here: f.here ? { path: f.here, branch: f.hereBranch ?? null } : null,
      spaces: f.spaces, near: f.near, recent: this.space ? [] : readSharedList(shared, RECENT_KEY), home: this.home, git: f.git,
    });

    const now = this.space ? spaceFolder(this.space, panes()) : null;
    const withNow: FolderRow[] = now && now !== this.home ? [{ path: now, name: folderName(now, this.home), from: "now", tag: "now" }, ...list.filter((r) => r.path !== now)] : list;

    return { path: false, rows: rank(withNow, q, this.home) };
  }

  /** Every pickable row in cursor order: the folders, browse, no folder. */
  rows(cx: Context | null): FolderView & { readonly all: PickRow[] } {
    const f = this.folderRows(cx);

    const loose: PickRow = this.space
      ? { id: "loose", kind: "loose", name: "no folder", say: "detach: back to ~, no project" }
      : { id: "loose", kind: "loose", name: "no folder", say: "starts in ~, belongs to no project" };

    return { ...f, all: [...f.rows.map((r): PickRow => ({ ...r, id: r.path, kind: "folder" })), { id: "browse", kind: "browse", name: "browse…", say: "the system's folder browser" }, loose] };
  }

  // ---- acting

  changed(cx: Context): void {
    const v = this.input?.value() ?? "";

    if (v === this.query) return;

    this.query = v;
    this.cursor = 0;
    this.reveal = true;
    this.error = "";

    if (isPath(v)) this.list(splitPath(v, this.home).dir, cx);

    cx.notify();
  }

  /** Sets the field (tab, shift-tab) with the caret at its end. */
  setQuery(v: string, cx: Context): void {
    this.input?.set_value(v);

    try {
      this.input?.set_selected_range({ start: v.length, end: v.length });
    } catch {
      /* the caret stays */
    }

    this.query = v;
    this.cursor = 0;
    this.reveal = true;
    this.error = "";

    if (isPath(v)) this.list(splitPath(v, this.home).dir, cx);

    cx.notify();
  }

  /** Tab: the cursor row's path in the field, listing inside it. Shift-tab: one folder up. */
  tab(back: boolean, cx: Context): void {
    if (this.naming) return;

    if (back) {
      if (isPath(this.query)) this.setQuery(up(this.query), cx);

      return;
    }

    const { all } = this.rows(cx);
    const row = all[this.cursor];

    if (row?.kind === "folder") this.setQuery(complete(row, this.home) ?? "", cx);
    else if (!isPath(this.query)) this.setQuery("~/", cx);
  }

  /** Esc: from the name back to the list, else closed. */
  escape(cx: Context): void {
    if (this.naming) {
      this.naming = null;
      this.error = "";
      this.focusField();
      cx.notify();

      return;
    }

    this.close();
  }

  move(by: number, cx: Context): void {
    const n = this.rows(cx).all.length;

    this.cursor = n ? (((this.cursor + by) % n) + n) % n : 0;
    this.reveal = true; // the render brings its row into view (render: its child's index)
    cx.notify();
  }

  /** Enter (secondary: cmd-enter, name it first). */
  enter(secondary: boolean, cx: Context): void {
    if (this.done || this.busy) return;

    if (this.naming) {
      this.make(this.naming.folder, this.nameInput?.value() ?? "");

      return;
    }

    const { all } = this.rows(cx);
    const row = all[this.cursor];

    if (!row) return;

    if (row.kind === "browse") {
      this.browse(secondary, cx);

      return;
    }

    const folder = row.kind === "folder" ? row.path : null;

    if (secondary && !this.space) this.askName(folder, cx);
    else if (row.kind === "folder" && row.from === "typed") this.checkThen(row.path, () => this.make(folder, ""), cx);
    else this.make(folder, "");
  }

  /** cmd-enter: the folder kept, a name asked for (its folder's in the field). */
  askName(folder: string | null, cx: Context): void {
    this.naming = { folder };
    this.nameInput?.set_value(folder ? folderName(folder, this.home) : "");

    const n = this.nameInput?.value().length ?? 0;

    try {
      this.nameInput?.set_selected_range({ start: 0, end: n });
    } catch {
      /* typing appends */
    }

    this.focusField();
    cx.notify();
  }

  /** A typed folder that isn't there says so in place; one that is goes on. */
  checkThen(folder: string, go: () => void, cx: Context): void {
    this.busy = true;
    cx.spawn(async (later) => {
      let there = true;

      try {
        there = (await exec("test", ["-d", folder], { on: this.on })).code === 0;
      } catch {
        /* go on */
      }

      this.busy = false;

      if (this.done) return;

      if (!there) {
        this.error = `no folder ${tilde(folder, this.home)}`;
        later.notify();

        return;
      }

      go();
    });
  }

  /** Makes the space (or attaches this one) and closes. `folder` null: no folder. */
  make(folder: string | null, name: string): void {
    if (this.done) return;

    if (this.space) {
      if (isDock(this.space)) {
        this.close();

        return;
      }

      run("space.folder", { id: this.space.id, folder: folder ?? this.home });
    } else {
      run("space.new", newArgs(folder, name, this.home));
    }

    if (folder && !this.on) setShared(RECENT, remember(readSharedList(shared, RECENT_KEY), folder));

    this.close();
  }

  browse(secondary: boolean, cx: Context): void {
    this.busy = true;
    cx.spawn(async (later) => {
      const folder = await pickFolder({ prompt: this.space ? `Attach ${this.space.name} to` : "Start the new space in" });

      this.busy = false;

      if (!folder || this.done) {
        later.notify();

        return;
      }

      if (secondary && !this.space) this.askName(folder, later);
      else this.make(folder, "");
    });
  }

  /** A key on the picker (its root's on_key_down): true when it was the picker's. */
  key(e: { readonly key: string; readonly modifiers: { readonly control: boolean; readonly platform: boolean; readonly alt: boolean; readonly shift: boolean } }, cx: Context): boolean {
    const m = e.modifiers;
    const k = e.key;
    const ctrl = m.control && !m.platform && !m.alt;

    if (k === "escape") {
      this.escape(cx);

      return true;
    }

    if (k === "tab" && !m.platform && !m.control && !m.alt) {
      this.tab(m.shift, cx);

      return true;
    }

    if (k === "enter") {
      this.enter(m.platform || m.control, cx);

      return true;
    }

    if (this.naming) return false;

    if (k === "down" || (ctrl && (k === "n" || k === "j"))) {
      this.move(1, cx);

      return true;
    }

    if (k === "up" || (ctrl && (k === "p" || k === "k"))) {
      this.move(-1, cx);

      return true;
    }

    return false;
  }

  // ---- drawing (newspace-draw.ts)

  /** The pointer over row `i` takes the cursor (one resting where the list opens doesn't move). */
  hoverRow(i: number, cx: Context): void {
    if (this.cursor !== i) {
      this.cursor = i;
      cx.notify();
    }
  }

  /** A click on row `i` picks it. */
  pickRow(i: number, cx: Context): void {
    this.cursor = i;
    this.enter(false, cx);
  }

  row(t: Theme, r: PickRow, i: number, on: boolean): Element {
    return pickRow(t, r, i, on, this.home, this);
  }

  /** What enter does now, in words (the footer). */
  say(all: readonly PickRow[]): string {
    return sayNow({ error: this.error, naming: this.naming, name: this.nameInput?.value().trim() ?? "", cursor: this.cursor, query: this.query, space: this.space, home: this.home }, all);
  }

  /** The list's children: the rows with their section heads, the rule before
   *  browse and no folder; and which child the cursor's row is. */
  listItems(t: Theme, view: FolderView & { readonly all: PickRow[] }): ListItems {
    const { all, path, asking } = view;
    const dir = view.dir ?? "";
    const items: Element[] = [];
    let lastFrom: RowFrom | "end" | null = null;
    let cursorChild = -1;

    if (path) items.push(div().id("ns-sec-in").px(12).pt(8).pb(3).flex_none().child(eyebrow(t, `in ${tail(tilde(dir, this.home), 40)}`)));

    all.forEach((r, i) => {
      if (r.kind !== "folder" && lastFrom !== "end") {
        if (asking) items.push(div().id("ns-asking").px(12).h(ROW).flex().items_center().text_size(11).text_color(t.dim).child("looking…"));
        else if (path && view.empty) {
          items.push(div().id("ns-none").px(12).h(ROW).flex().items_center().text_size(11).text_color(t.dim)
            .child(`nothing in ${tail(tilde(dir, this.home), 24)} starts with "${splitPath(this.query, this.home).prefix}"`));
        }

        items.push(div().id("ns-rule").mx(12).my(4).h(2).flex_none().relative().child(dither(t.ansi0, 1)));
        lastFrom = "end";
      }

      if (r.kind === "folder" && !path && !this.query.trim() && r.from !== lastFrom) {
        items.push(div().id(`ns-sec-${r.from}`).px(12).pt(8).pb(3).flex_none().child(eyebrow(t, SECTIONS.get(r.from) ?? r.from)));
        lastFrom = r.from;
      }

      if (i === this.cursor) cursorChild = items.length;

      items.push(this.row(t, r, i, i === this.cursor && !this.naming));
    });

    return { items, cursorChild };
  }

  render(): Element {
    const t = theme();
    const view = this.rows(null);
    const { all } = view;

    this.cursor = Math.min(this.cursor, Math.max(0, all.length - 1));

    const { items, cursorChild } = this.listItems(t, view);

    // The list's children are its rows and its section heads and rule, and
    // scroll_to_item counts children: the cursor's row goes by its child
    // index, whole; on the first row the list's top (its head) shows too.
    if (this.reveal && !this.naming && cursorChild >= 0) {
      this.reveal = false;
      this.scroll?.scroll_to_item(this.cursor === 0 ? 0 : cursorChild);
    }

    const cursorRow = all[this.cursor];
    const full = this.naming || !cursorRow || cursorRow.kind !== "folder" ? (this.naming ? "" : ghost(this.query, null, this.home)) : ghost(this.query, cursorRow, this.home);
    const naming = this.naming;
    const scroll = this.scroll;
    const list = v_flex().id("ns-list").py(2).max_h(LIST_MAX + 4 * SEC).overflow_y_scroll();

    const body = naming
      ? v_flex().id("ns-naming").py(4).child(this.row(t, { id: "in", kind: "folder", name: "in", path: naming.folder ?? this.home, from: "self", tag: "", hits: [] }, 0, false))
      : (scroll ? list.track_scroll(scroll) : list).children(items);

    const escape = (cx: Context) => {
      this.escape(cx);
      cx.notify();
    };

    return v_flex().id("nocturne-newspace").w_full().bg(t.background).border(1).border_color(t.ansi0)
      .key_context(CONTEXT)
      .on_action(TAB, (_e, cx) => {
        this.tab(false, cx);
        cx.notify();
      })
      .on_action(TAB_BACK, (_e, cx) => {
        this.tab(true, cx);
        cx.notify();
      })
      .on_action(ESC, (_e, cx) => escape(cx))
      .on_key_down((e, cx) => {
        if (!this.key(e, cx)) return;

        cx.stop_propagation();
        cx.notify();
      })
      .child(pickerHead(t, this.space ? `attach ${this.space.name} to` : "new space", naming ? fieldBox(t, this.nameInput, "name") : fieldBox(t, this.input, null), escape))
      .child(body)
      .child(pickerFoot(t, { say: this.say(all), error: Boolean(this.error), ghost: full.length > 16 ? `${full.slice(0, 14)}…/` : full, naming: Boolean(naming), attaching: Boolean(this.space) }));
  }
}
