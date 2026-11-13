// Spaces: one row each, the shown one on a dithered band, with inline
// create / rename / folder / delete. A space's folder is the one it's attached
// to (kit.ts spaceFolder), else where its first terminal is. Spaces stay top
// level in Fireflies' order; only a space on a linked worktree is indented, under
// the space on its repo's main checkout (or under the repo's name when the
// main checkout has no space).
// nocturne.next / nocturne.prev (keys.json) walk the rows in this order.
//
//   click a row   shows it
//   + new         the new-space picker (newspace.ts) hangs under it: a list
//                 of folders (here, the spaces', the checkouts beside them,
//                 recent ones) and a field to filter it or type a path; enter
//                 makes the space there, called after its folder (cmd-enter
//                 names it first); its last row, "no folder", makes a space
//                 in ~ that belongs to no project
//   right-click   a menu (menu.ts): show, new tab here, rename, change
//                 folder, new worktree (a branch checked out as a new space), delete
//   rename        inline; an empty name gives it Fireflies' name back
//   folder        the same picker, hanging under the row, attaches the space
//                 to another folder (space.folder); "no folder" detaches it
//   delete        ends its terminals and agents (asks first, inline, saying
//                 how many); it stays in Fireflies' recent spaces
// The inline forms (rename, delete) take keys as every form does
// (form-keys.ts): tab / shift-tab walk name → esc (delete: delete ↔ keep),
// wrapping; the focused chip wears the blue ring; enter in a field saves
// (cmd-enter from anywhere), enter / space press a chip, esc cancels.
// The menu asks through shared(EDIT_SPACE); on the folded rail Fireflies' own
// (Nocturne-skinned) prompt and confirm dialogs, and the centered picker, do it instead.

import { div, svg } from "gpui-kit";
import type { Context, Element, KeyEvent, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, panes, agents, run, exec, shared } from "herdr";
import type { PaneInfo, SpaceInfo, Theme } from "herdr";
import { readShared } from "./guard.ts";
import { dither, pip, eyebrow, spaceFolder, navRow, navRing, cornerTicks, dropBelow } from "./kit.ts";
import type { DropAt } from "./kit.ts";
import { chip, field, confirm } from "./inline.ts";
import type { Action } from "./inline.ts";
import { formKey } from "./form-keys.ts";
import type { Stop } from "./form-keys.ts";
import { openSpacePicker, pickerOpen, WIDTH as PICKER_WIDTH } from "./newspace.ts";
import { EDIT_SPACE_KEY, openMenu, newWorktree } from "./menu.ts";
import { isDock } from "./dock.ts";
import type { Nav, NavActs } from "./nav.ts";

// The shown space's plate and its corner ticks: this far in from the sidebar's edges.
export const SHOWN_INSET = 8;

const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

// How often to look for spaces in folders not yet placed in a repo.
const SCAN = 1500;

/** An inline form open on a space: renaming it, or asking before deleting it. */
type Mode = { readonly kind: "rename" | "delete"; readonly s: SpaceInfo };

/** What start() is asked for: an inline form, the picker (new, folder), or nothing (the form closes). */
type Start = Mode | { readonly kind: "new" } | { readonly kind: "folder"; readonly s: SpaceInfo } | null;

/** A folder's repo: its main checkout and the checkout's top. */
interface Repo {
  readonly main: string;
  readonly top: string;
}

/** A sidebar row: a space (indented under its repo's when it's a linked worktree), or a repo's name. */
export type SpaceRow = { readonly s: SpaceInfo; readonly depth: number } | { readonly header: string; readonly key: string };

/** The stops of an inline form. */
type FormStop = Stop & { readonly id: "name" | "cancel" | "go" | "keep" };

/** A press on "+ new": where, and whether the picker was open then. */
interface Press {
  readonly e: MouseButtonEvent;
  readonly open: boolean;
}

/** Where a row was right-clicked a moment ago: "Change folder…" hangs the picker there. */
interface Pressed {
  readonly id: string;
  readonly at: DropAt | null;
  readonly when: number;
}

export default class Spaces {
  mode: Mode | null = null;
  at: FormStop["id"] | null = null; // the inline form's stop with the keyboard (stops())
  input: InputState | null = null;
  pressed: Pressed | null = null;
  press: Press | null = null;
  // folder key -> { main, top } (a git checkout) | null (not one); asked
  // once per folder, so drawing and switching never wait on git.
  repos = new Map<string, Repo | null>();
  asking = new Set<string>();
  editAsked: number | null = null;
  /** The sidebar: back to it once a form closes, and the keyboard to it for a chip. */
  onDone: ((cx: Context) => void) | null = null;
  focusHost: (() => void) | null = null;

  init(cx: Context): void {
    this.mode = null;
    this.at = null;

    const input = InputState.new({ placeholder: "name" });

    this.input = input;
    input.on("submit", (_e, later) => this.submit(later));
    this.pressed = null;
    this.repos = new Map();
    this.asking = new Set();
    this.scan(cx);
    cx.timer.every(SCAN, (later) => this.scan(later));
    // A request from before this sidebar was made is old.
    this.editAsked = readShared(shared, EDIT_SPACE_KEY, null)?.at ?? null;
  }

  /** A space's right-click menu (`centered`: opened from the keyboard). */
  menu(s: SpaceInfo, centered = false, e: MouseButtonEvent | null = null): void {
    this.pressed = e ? { id: s.id, at: dropBelow(e, PICKER_WIDTH), when: Date.now() } : null;
    openMenu({ tab: "space", target: { id: s.id } }, { centered });
  }

  /** The keyboard's verbs on a space row (sky.ts navigation; nav.ts). */
  acts(s: SpaceInfo): NavActs {
    const acts: NavActs = {
      go: () => run("space.select", { id: s.id }),
      menu: () => this.menu(s, true),
      rename: (cx) => this.start({ kind: "rename", s }, cx),
      tab: () => run("tab.new", { space: s.id }),
    };

    // The dock (dock.ts) keeps no folder and isn't deleted by a key.
    return isDock(s) ? acts : { ...acts, folder: () => this.folder(s), delete: (cx) => this.start({ kind: "delete", s }, cx), worktree: () => newWorktree(s.id) };
  }

  /** Answers the menu's rename / delete, once per request: inline, or with Fireflies' dialogs when folded. */
  answer(folded: boolean, cx: Context): void {
    const ask = readShared(shared, EDIT_SPACE_KEY, null);

    if (!ask || ask.at === this.editAsked) return;

    this.editAsked = ask.at;

    const s = spaces().find((x) => x.id === ask.id);

    if (!s) return;

    if (ask.kind === "folder") {
      // Hanging under the row right-clicked for it a moment ago; else centered (a key, the palette).
      const p = this.pressed;

      this.pressed = null;
      this.folder(s, !folded && p?.id === s.id && Date.now() - p.when < 30000 ? p.at : null);

      return;
    }

    if (folded) run(ask.kind === "rename" ? "space.rename" : "space.close", { id: s.id });
    else this.start({ kind: ask.kind, s }, cx);
  }

  // ---- repos

  key(s: SpaceInfo, all: readonly PaneInfo[]): string | null {
    const folder = spaceFolder(s, all);

    return folder ? `${s.machine ?? ""}|${folder}` : null;
  }

  scan(cx: Context): void {
    const all = panes();

    for (const s of spaces()) {
      const k = this.key(s, all);

      if (!k || this.repos.has(k) || this.asking.has(k)) continue;

      this.asking.add(k);

      const folder = k.slice(k.indexOf("|") + 1);

      cx.spawn(async (later) => {
        try {
          const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { cwd: folder, on: s.machine ?? null });
          const [common, top] = r.stdout.trim().split("\n");

          this.repos.set(k, r.code === 0 && common && top ? { main: common.replace(/\/\.git$/, ""), top } : null);
        } catch {
          this.repos.set(k, null);
        }

        this.asking.delete(k);
        later.notify();
      });
    }
  }

  /** The rows in display order: { s, depth } for spaces, { header } for a repo with no main space. */
  rows(): SpaceRow[] {
    const all = panes();
    const sp = spaces();
    const repoOf = (s: SpaceInfo) => this.repos.get(this.key(s, all) ?? "") ?? null;

    const group = (s: SpaceInfo) => {
      const r = repoOf(s);

      return r ? `${s.machine ?? ""}|${r.main}` : null;
    };

    // Only a linked worktree nests; any other space, in a repo or not, is top level.
    const linked = (s: SpaceInfo) => {
      const r = repoOf(s);

      return Boolean(r && r.top !== r.main);
    };

    const mains = new Map<string, SpaceInfo>(); // repo -> the first space on its main checkout
    const kids = new Map<string, SpaceInfo[]>(); // repo -> its worktree spaces, in Fireflies' order

    for (const s of sp) {
      const g = group(s);

      if (!g) continue;

      if (!linked(s)) {
        if (!mains.has(g)) mains.set(g, s);

        continue;
      }

      kids.set(g, [...(kids.get(g) ?? []), s]);
    }

    const out: SpaceRow[] = [];
    const listed = new Set<string>();

    for (const s of sp) {
      const g = group(s);

      if (!g || !linked(s)) {
        out.push({ s, depth: 0 });

        if (g && mains.get(g) === s) for (const k of kids.get(g) ?? []) out.push({ s: k, depth: 1 });

        continue;
      }

      if (mains.has(g) || listed.has(g)) continue; // listed under its repo

      listed.add(g);

      const list = kids.get(g) ?? [];

      if (list.length === 1) {
        out.push({ s, depth: 0 });
        continue;
      }

      out.push({ header: g.slice(g.indexOf("|") + 1).split("/").pop() ?? "", key: g });

      for (const k of list) out.push({ s: k, depth: 1 });
    }

    return out;
  }

  /** nocturne.next / nocturne.prev: the next space down (or up) the rows, wrapping. */
  step(d: number): void {
    const order = this.rows().flatMap((r) => ("s" in r ? [r.s] : []));

    if (!order.length) return;

    const i = order.findIndex((s) => s.active);
    const next = order[(i + d + order.length) % order.length];

    if (next) run("space.select", { id: next.id });
  }

  // ---- editing

  /** A new space: the picker (newspace.ts), hanging under the press that asked (`at`), else centered. */
  create(at: DropAt | null = null, wasOpen = false): string | null {
    this.press = null;

    return openSpacePicker({ at, wasOpen });
  }

  /** Space `s` to another folder: the same picker, attaching. */
  folder(s: SpaceInfo, at: DropAt | null = null): string | null {
    return openSpacePicker({ space: s.id, at, replace: true });
  }

  start(mode: Start, cx: Context): void {
    if (mode?.kind === "new") {
      this.create();

      return;
    }

    if (mode?.kind === "folder") {
      this.folder(mode.s);

      return;
    }

    const was = this.mode;

    this.mode = mode;
    this.at = this.stops()[0]?.id ?? null;

    if (was && !mode) this.onDone?.(cx);

    if (mode?.kind === "rename") {
      this.input?.set_value(mode.s.named ? mode.s.name : "");
      this.input?.focus();
    }

    cx.notify();
  }

  submit(cx: Context): void {
    const m = this.mode;

    if (m?.kind !== "rename") return;

    run("space.rename", { id: m.s.id, name: this.input?.value().trim() ?? "" });
    this.start(null, cx);
  }

  remove(s: SpaceInfo, cx: Context): void {
    run("space.close", { id: s.id, confirmed: true });
    this.start(null, cx);
  }

  /** The inline form's stops in tab order (form-keys.ts). */
  stops(): FormStop[] {
    const k = this.mode?.kind;

    if (k === "rename") return [{ id: "name", kind: "text" }, { id: "cancel", kind: "button" }];

    if (k === "delete") return [{ id: "go", kind: "button", submit: true }, { id: "keep", kind: "button" }];

    return [];
  }

  /** The keyboard to stop `id`: a field's input, or the sidebar (focusHost) for a chip. */
  goStop(id: FormStop["id"]): void {
    this.at = id;

    if (id === "name") this.input?.focus();
    else this.focusHost?.();
  }

  /** Tab / shift-tab in a field (inline.ts field). */
  tab(back: boolean, cx: Context): void {
    const stops = this.stops();
    const i = stops.findIndex((s) => s.id === this.at);
    const next = stops[(((i + (back ? -1 : 1)) % stops.length) + stops.length) % stops.length];

    if (next) this.goStop(next.id);

    cx.notify();
  }

  /** A key while an inline form is open (a field, or a chip with the
   *  keyboard): true when it was the form's. A delete: y deletes, n / q keep. */
  confirmKey(e: Pick<KeyEvent, "key" | "key_char" | "modifiers">, cx: Context): boolean {
    const stops = this.stops();
    const mode = this.mode;

    if (!stops.length || !mode) return false;

    const m = e.modifiers;
    const c = e.key_char ?? null;
    const del = mode.kind === "delete";

    if (del && !m.platform && !m.control && (c === "y" || c === "n" || c === "q")) {
      if (c === "y") this.remove(mode.s, cx);
      else this.start(null, cx);

      return true;
    }

    const i = Math.max(0, stops.findIndex((s) => s.id === this.at));
    const here = stops[i];
    const a = formKey(stops, i, e.key, m, c);

    // A field's own keys; its plain enter is the input's submit.
    if (!here || !a || a.act === "type" || (a.act === "submit" && here.kind === "text" && !m.platform && !m.control)) return false;

    const id = here.id;

    if (a.act === "move") {
      const to = stops[a.to];

      if (to) this.goStop(to.id);
    } else if (a.act === "cancel" || (a.act === "press" && (id === "cancel" || id === "keep"))) this.start(null, cx);
    else if (a.act === "submit" || a.act === "press") {
      if (del) this.remove(mode.s, cx);
      else this.submit(cx);
    }

    return true;
  }

  // ---- parts

  /** An inline form's chip, ringed while the keyboard is on it (stop `stop`). */
  chipAt(t: Theme, at: FormStop["id"], id: string, label: string, action: Action): Element {
    return navRing(t, chip(t, id, label, action), this.at === at);
  }

  /** A worktree space's indent: a faint guide line, then the row's own padding. */
  indent(t: Theme): Element {
    return div().relative().w(10).h_full().flex_none().ml(-2)
      .child(div().absolute().left(2).top(0).bottom(0).w(1).bg(`${t.ansi8}55`));
  }

  row(t: Theme, s: SpaceInfo, depth: number, nav?: Nav): Element {
    const id = `space-${s.id}`;
    const on = nav?.(`space:${s.id}`, "spaces", this.acts(s)) ?? false;
    const m = this.mode?.s.id === s.id ? this.mode : null;
    const input = this.input;

    if (m?.kind === "rename" && input) {
      return h_flex().id(id).h(24).px(16).gap(8).items_center()
        .when(depth > 0, (el) => el.child(this.indent(t)))
        .child(pip(t, s.status))
        .child(field(t, "space-input", input, (cx) => this.start(null, cx), (back, cx) => this.tab(back, cx)))
        .child(this.chipAt(t, "cancel", `${id}-cancel`, "esc", (cx) => this.start(null, cx)));
    }

    if (m?.kind === "delete") {
      const tabs = new Set(s.tabs.map((c) => c.id));
      const terms = panes().filter((p) => tabs.has(p.tab) && p.terminal).length;
      const ags = agents().filter((a) => a.space === s.id).length;
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      const at = this.at === "go" || this.at === "keep" ? this.at : null;

      return confirm(t, id, {
        title: `Delete ${s.name}?`,
        facts: [
          terms ? [ags ? t.blocked : t.ansi8, `ends ${n(terms, "terminal", "terminals")}${ags ? `, ${n(ags, "agent", "agents")} among them` : ""}`]
            : [t.ansi8, "nothing running in it"],
          [t.dim, "its folders and files stay"],
        ],
        go: { label: on ? "delete (y)" : "delete", action: (cx) => this.remove(s, cx) },
        keep: (cx) => this.start(null, cx),
        keepLabel: on ? "keep (n)" : "keep",
        at,
      });
    }

    return h_flex().id(id).relative().h(24).px(16).gap(8).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        this.menu(s, false, e);
      })
      .on_click(() => run("space.select", { id: s.id }))
      .hover((st) => st.bg(`${t.ansi0}55`))
      // Shown: a plate of the ground, in from the sidebar's edges, with the
      // blue corner ticks on its corners, as its initials wear them on the rail.
      .when(s.active, (el) => el.child(div().absolute().top(0).bottom(0).left(SHOWN_INSET).right(SHOWN_INSET)
        .child(dither(t.ansi0, 1)).children(cornerTicks(t, 0))))
      .map((el) => navRow(t, el, on))
      .when(depth > 0, (el) => el.child(this.indent(t)))
      .child(pip(t, s.status))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(s.active || on ? t.foreground : t.muted).child(s.name))
      .when(isDock(s), (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(10).flex_none().text_color(t.dim))) // the dock (dock.ts)
      .child(div().relative().flex_none().text_color(t.dim).child(String(s.tabs.length)));
  }

  /** A repo whose main checkout has no space: its name over its worktree spaces. */
  header(t: Theme, r: { readonly header: string; readonly key: string }): Element {
    return h_flex().id(`repo-${r.key}`).h(22).px(16).gap(8).items_center().text_size(11)
      .child(div().w(6).flex_none())
      .child(div().min_w(0).truncate().text_color(t.ansi8).child(r.header));
  }

  /** `nav` (sky.ts): registers a control with the keyboard's cursor, true while it's on it. */
  render(t: Theme, nav?: Nav): Element {
    const newOn = nav?.("space-new", "spaces", { go: () => this.create() }) ?? false;
    const open = pickerOpen();

    return v_flex().id("spaces").pt(22).pb(10).flex_none()
      .child(h_flex().px(16).pb(4).items_center()
        .child(div().flex_1().child(eyebrow(t, "spaces")))
        .child(navRing(t, chip(t, "space-new-start", "+ new", () => this.create(dropBelow(this.press?.e, PICKER_WIDTH), Boolean(this.press?.open)), open ? t.foreground : undefined)
          // The press: where the picker hangs, and whether it was open (the press closed it: it stays closed).
          .on_mouse_down("left", (e) => {
            this.press = { e, open: pickerOpen() };
          })
          .when(open, (el) => el.bg(t.ansi0)), newOn)))
      .children(this.rows().map((r) => ("s" in r ? this.row(t, r.s, r.depth, nav) : this.header(t, r))));
  }
}
