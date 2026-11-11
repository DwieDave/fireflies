// Spaces: one row each, the shown one on a dithered band, with inline
// create / rename / folder / delete. A space's folder is the one it's attached
// to (kit.js spaceFolder), else where its first terminal is. Spaces stay top
// level in Herdr's order; only a space on a linked worktree is indented, under
// the space on its repo's main checkout (or under the repo's name when the
// main checkout has no space).
// nocturne.next / nocturne.prev (keys.json) walk the rows in this order.
//
//   click a row   shows it
//   + new         a name (optional: unnamed, Herdr names it after its folder)
//                 and the folder it's attached to (typed, or "browse";
//                 empty: home); opens it
//   right-click   a menu (menu.js): show, new tab here, rename, change
//                 folder, new worktree (a branch checked out as a new space), delete
//   rename        inline; an empty name gives it Herdr's name back
//   folder        inline; attaches the space to another folder (space.folder)
//   delete        ends its terminals and agents (asks first, inline, saying
//                 how many); it stays in Herdr's recent spaces
// The inline forms (new, rename, folder, delete) take keys as every form does
// (form-keys.js): tab / shift-tab walk name → folder → browse → esc (delete:
// delete ↔ keep), wrapping; the focused chip wears the blue ring; enter in a
// field saves (cmd-enter from anywhere), enter / space press a chip, esc cancels.
// The menu asks through shared(EDIT_SPACE); on the folded rail Herdr's own
// (Nocturne-skinned) prompt and confirm dialogs, and the folder picker, do it instead.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, panes, agents, run, exec, home, pickFolder, openOverlay, shared } from "herdr";
import { dither, pip, eyebrow, spaceFolder, navRow, navRing } from "./kit.js";
import { chip, field, confirm } from "./inline.js";
import { formKey } from "./form-keys.js";
import { EDIT_SPACE, openMenu, newWorktree } from "./menu.js";

const stop = (_e, cx) => cx.stop_propagation();
const tilde = (p) => { const h = home(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };
// A typed folder as a path: ~ is home, a relative one is under home.
const untilde = (p) => { const h = home(); return p === "~" ? h : p.startsWith("~/") ? h + p.slice(1) : p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${h}/${p}`; };
// How often to look for spaces in folders not yet placed in a repo.
const SCAN = 1500;

export default class Spaces {
  init(cx) {
    this.mode = null; // null | { kind: "new" } | { kind: "rename" | "folder" | "delete", s }
    this.error = ""; // why the last new / folder didn't go
    this.at = null; // the inline form's stop with the keyboard (stops())
    this.input = InputState.new({ placeholder: "name" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.folderInput = InputState.new({ placeholder: "folder (empty: ~)" });
    this.folderInput.on("submit", (_e, cx) => this.submit(cx));
    this.folderInput.on("change", (_e, cx) => { if (this.error) { this.error = ""; cx.notify(); } });
    // folder key -> { main, top } (a git checkout) | null (not one); asked
    // once per folder, so drawing and switching never wait on git.
    this.repos = new Map();
    this.asking = new Set();
    this.scan(cx);
    cx.timer.every(SCAN, (cx) => this.scan(cx));
    // A request from before this sidebar was made is old.
    this.editAsked = shared(EDIT_SPACE)?.at ?? null;
  }

  /** A space's right-click menu (`centered`: opened from the keyboard). */
  menu(s, centered = false) {
    openMenu({ tab: "space", target: { id: s.id } }, { centered });
  }

  /** The keyboard's verbs on a space row (sky.js navigation; nav.js). */
  acts(s) {
    return {
      go: () => run("space.select", { id: s.id }),
      menu: () => this.menu(s, true),
      rename: (cx) => this.start({ kind: "rename", s }, cx),
      folder: (cx) => this.start({ kind: "folder", s }, cx),
      delete: (cx) => this.start({ kind: "delete", s }, cx),
      tab: () => run("tab.new", { space: s.id }),
      worktree: () => newWorktree(s.id),
    };
  }

  /** Answers the menu's rename / delete, once per request: inline, or with Herdr's dialogs when folded. */
  answer(folded, cx) {
    const ask = shared(EDIT_SPACE);
    if (!ask || ask.at === this.editAsked) return;
    this.editAsked = ask.at;
    const s = spaces().find((x) => x.id === ask.id);
    if (!s) return;
    if (folded && ask.kind === "folder") return this.pick(cx, s);
    if (folded) return run(ask.kind === "rename" ? "space.rename" : "space.close", { id: s.id });
    this.start({ kind: ask.kind, s }, cx);
  }

  // ---- repos

  key(s, all) {
    const folder = spaceFolder(s, all);
    return folder ? `${s.machine ?? ""}|${folder}` : null;
  }

  scan(cx) {
    const all = panes();
    for (const s of spaces()) {
      const k = this.key(s, all);
      if (!k || this.repos.has(k) || this.asking.has(k)) continue;
      this.asking.add(k);
      const folder = k.slice(k.indexOf("|") + 1);
      cx.spawn(async (cx) => {
        try {
          const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { cwd: folder, on: s.machine ?? null });
          const [common, top] = r.stdout.trim().split("\n");
          this.repos.set(k, r.code === 0 && common && top ? { main: common.replace(/\/\.git$/, ""), top } : null);
        } catch {
          this.repos.set(k, null);
        }
        this.asking.delete(k);
        cx.notify();
      });
    }
  }

  /** The rows in display order: { s, depth } for spaces, { header } for a repo with no main space. */
  rows() {
    const all = panes(), sp = spaces();
    const repoOf = (s) => this.repos.get(this.key(s, all)) ?? null;
    const group = (s) => { const r = repoOf(s); return r ? `${s.machine ?? ""}|${r.main}` : null; };
    // Only a linked worktree nests; any other space, in a repo or not, is top level.
    const linked = (s) => { const r = repoOf(s); return Boolean(r && r.top !== r.main); };
    const mains = new Map(); // repo -> the first space on its main checkout
    const kids = new Map(); // repo -> its worktree spaces, in Herdr's order
    for (const s of sp) {
      const g = group(s);
      if (!g) continue;
      if (!linked(s)) { if (!mains.has(g)) mains.set(g, s); continue; }
      if (!kids.has(g)) kids.set(g, []);
      kids.get(g).push(s);
    }
    const out = [], listed = new Set();
    for (const s of sp) {
      const g = group(s);
      if (!linked(s)) {
        out.push({ s, depth: 0 });
        if (mains.get(g) === s) for (const k of kids.get(g) ?? []) out.push({ s: k, depth: 1 });
        continue;
      }
      if (mains.has(g) || listed.has(g)) continue; // listed under its repo
      listed.add(g);
      const list = kids.get(g);
      if (list.length === 1) { out.push({ s, depth: 0 }); continue; }
      out.push({ header: g.slice(g.indexOf("|") + 1).split("/").pop(), key: g });
      for (const k of list) out.push({ s: k, depth: 1 });
    }
    return out;
  }

  /** nocturne.next / nocturne.prev: the next space down (or up) the rows, wrapping. */
  step(d) {
    const order = this.rows().filter((r) => r.s).map((r) => r.s);
    if (!order.length) return;
    const i = order.findIndex((s) => s.active);
    run("space.select", { id: order[(i + d + order.length) % order.length].id });
  }

  // ---- editing

  start(mode, cx) {
    const was = this.mode;
    this.mode = mode;
    this.error = "";
    this.at = this.stops()[0]?.id ?? null;
    if (was && !mode) this.onDone?.(cx);
    if (mode?.kind === "new" || mode?.kind === "rename") {
      this.input.set_value(mode.kind === "rename" && mode.s.named ? mode.s.name : "");
      this.input.focus();
    }
    if (mode?.kind === "new") this.folderInput.set_value("");
    if (mode?.kind === "folder") {
      const f = spaceFolder(mode.s, panes());
      this.folderInput.set_value(f ? tilde(f) : "");
      this.folderInput.focus();
    }
    cx.notify();
  }

  submit(cx) {
    const m = this.mode;
    if (m?.kind === "rename") {
      run("space.rename", { id: m.s.id, name: this.input.value().trim() });
      return this.start(null, cx);
    }
    if (m?.kind !== "new" && m?.kind !== "folder") return;
    if (m.busy) return;
    const name = this.input.value().trim();
    const typed = this.folderInput.value().trim();
    const folder = typed ? untilde(typed) : home();
    const on = m.kind === "folder" ? m.s.machine ?? null : null;
    m.busy = true;
    cx.spawn(async (cx) => {
      // A folder that isn't there would leave the space nowhere: say so in place.
      let there = true;
      try { there = (await exec("test", ["-d", folder], { on })).code === 0; } catch {}
      m.busy = false;
      if (this.mode !== m) return;
      if (!there) { this.error = `no folder ${tilde(folder)}`; return cx.notify(); }
      if (m.kind === "new") run("space.new", { ...(name ? { name } : {}), folder, machine: "" });
      else run("space.folder", { id: m.s.id, folder });
      this.start(null, cx);
    });
  }

  /** The folder picker: into the form's folder field, or (s: the folded rail) straight onto that space. */
  pick(cx, s) {
    const m = this.mode;
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: s || m?.kind === "folder" ? "Attach the space to" : "Start the new space in" });
      if (!folder) return;
      if (s) return run("space.folder", { id: s.id, folder });
      if (this.mode !== m) return;
      this.folderInput.set_value(tilde(folder));
      this.error = "";
      this.folderInput.focus();
      cx.notify();
    });
  }

  remove(s, cx) {
    run("space.close", { id: s.id, confirmed: true });
    this.start(null, cx);
  }

  /** The inline form's stops in tab order (form-keys.js). */
  stops() {
    const k = this.mode?.kind;
    if (k === "new") return [{ id: "name", kind: "text" }, { id: "folder", kind: "text" }, { id: "browse", kind: "button" }, { id: "cancel", kind: "button" }];
    if (k === "folder") return [{ id: "folder", kind: "text" }, { id: "browse", kind: "button" }, { id: "cancel", kind: "button" }];
    if (k === "rename") return [{ id: "name", kind: "text" }, { id: "cancel", kind: "button" }];
    if (k === "delete") return [{ id: "go", kind: "button", submit: true }, { id: "keep", kind: "button" }];
    return [];
  }

  /** The keyboard to stop `id`: a field's input, or the sidebar (focusHost) for a chip. */
  goStop(id) {
    this.at = id;
    if (id === "name") this.input.focus();
    else if (id === "folder") this.folderInput.focus();
    else this.focusHost?.();
  }

  /** Tab / shift-tab in a field (inline.js field). */
  tab(back, cx) {
    const stops = this.stops(), i = stops.findIndex((s) => s.id === this.at);
    this.goStop(stops[((i + (back ? -1 : 1)) % stops.length + stops.length) % stops.length].id);
    cx?.notify?.();
  }

  /** A key while an inline form is open (a field, or a chip with the
   *  keyboard): true when it was the form's. A delete: y deletes, n / q keep. */
  confirmKey(e, cx) {
    const stops = this.stops();
    if (!stops.length) return false;
    const m = e.modifiers ?? {}, c = e.key_char;
    const del = this.mode.kind === "delete";
    if (del && !m.platform && !m.control && (c === "y" || c === "n" || c === "q")) {
      if (c === "y") this.remove(this.mode.s, cx); else this.start(null, cx);
      return true;
    }
    const i = Math.max(0, stops.findIndex((s) => s.id === this.at));
    const a = formKey(stops, i, e.key, m, c);
    // A field's own keys; its plain enter is the input's submit.
    if (!a || a.act === "type" || (a.act === "submit" && stops[i].kind === "text" && !m.platform && !m.control)) return false;
    const id = stops[i].id;
    if (a.act === "move") this.goStop(stops[a.to].id);
    else if (a.act === "cancel" || (a.act === "press" && (id === "cancel" || id === "keep"))) this.start(null, cx);
    else if (a.act === "press" && id === "browse") this.pick(cx);
    else if (a.act === "submit" || a.act === "press") del ? this.remove(this.mode.s, cx) : this.submit(cx);
    return true;
  }

  // ---- parts

  /** An inline form's chip, ringed while the keyboard is on it (stop `stop`). */
  chipAt(t, stop, id, label, action) {
    return navRing(t, chip(t, id, label, action), this.at === stop);
  }

  /** A worktree space's indent: a faint guide line, then the row's own padding. */
  indent(t, depth) {
    if (!depth) return null;
    return div().relative().w(10).h_full().flex_none().ml(-2)
      .child(div().absolute().left(2).top(0).bottom(0).w(1).bg(t.ansi8 + "55"));
  }

  row(t, s, depth, nav) {
    const id = `space-${s.id}`;
    const on = nav?.(`space:${s.id}`, "spaces", this.acts(s)) ?? false;
    const m = this.mode?.s?.id === s.id ? this.mode : null;
    if (m?.kind === "rename") {
      return h_flex().id(id).h(24).px(16).gap(8).items_center()
        .when(depth > 0, (el) => el.child(this.indent(t, depth)))
        .child(pip(t, s.status))
        .child(field(t, "space-input", this.input, (cx) => this.start(null, cx), (back, cx) => this.tab(back, cx)))
        .child(this.chipAt(t, "cancel", `${id}-cancel`, "esc", (cx) => this.start(null, cx)));
    }
    if (m?.kind === "folder") {
      return v_flex().id(id).px(16).gap(2)
        .child(h_flex().h(24).gap(8).items_center()
          .when(depth > 0, (el) => el.child(this.indent(t, depth)))
          .child(pip(t, s.status))
          .child(div().min_w(0).max_w(90).truncate().text_size(11).text_color(t.muted).child(s.name))
          .child(field(t, "space-folder-input", this.folderInput, (cx) => this.start(null, cx), (back, cx) => this.tab(back, cx)))
          .child(this.chipAt(t, "browse", `${id}-browse`, "browse", (cx) => this.pick(cx)))
          .child(this.chipAt(t, "cancel", `${id}-cancel`, "esc", (cx) => this.start(null, cx))))
        .when(Boolean(this.error), (el) => el.child(div().pl(14).text_size(11).text_color(t.blocked).child(this.error)));
    }
    if (m?.kind === "delete") {
      const tabs = new Set(s.tabs.map((c) => c.id));
      const terms = panes().filter((p) => tabs.has(p.tab) && p.terminal).length;
      const ags = agents().filter((a) => a.space === s.id).length;
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
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
        at: this.at,
      });
    }
    return h_flex().id(id).relative().h(24).px(16).gap(8).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(s); })
      .on_click(() => run("space.select", { id: s.id }))
      .hover((st) => st.bg(t.ansi0 + "55"))
      .when(s.active, (el) => el.child(dither(t.ansi0, 1)))
      .map((el) => navRow(t, el, on))
      .when(depth > 0, (el) => el.child(this.indent(t, depth)))
      .child(pip(t, s.status))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(s.active || on ? t.foreground : t.muted).child(s.name))
      .child(div().relative().flex_none().text_color(t.dim).child(String(s.tabs.length)));
  }

  /** A repo whose main checkout has no space: its name over its worktree spaces. */
  header(t, r) {
    return h_flex().id(`repo-${r.key}`).h(22).px(16).gap(8).items_center().text_size(11)
      .child(div().w(6).flex_none())
      .child(div().min_w(0).truncate().text_color(t.ansi8).child(r.header));
  }

  newRow(t) {
    return v_flex().id("space-new").px(16).gap(2)
      .child(h_flex().h(24).gap(8).items_center()
        .child(div().w(6).flex_none().text_size(11).text_color(t.accent).child("+"))
        .child(field(t, "space-input", this.input, (cx) => this.start(null, cx), (back, cx) => this.tab(back, cx)))
        .child(this.chipAt(t, "cancel", "space-new-cancel", "esc", (cx) => this.start(null, cx))))
      .child(h_flex().pl(14).h(24).gap(4).items_center().text_size(11)
        .child(div().flex_none().text_color(t.dim).child("in"))
        .child(field(t, "space-new-folder-input", this.folderInput, (cx) => this.start(null, cx), (back, cx) => this.tab(back, cx)))
        .child(this.chipAt(t, "browse", "space-new-folder", "browse", (cx) => this.pick(cx))))
      .when(Boolean(this.error), (el) => el.child(div().pl(14).text_size(11).text_color(t.blocked).child(this.error)));
  }

  /** `nav` (sky.js): registers a control with the keyboard's cursor, true while it's on it. */
  render(t, nav) {
    const startNew = (cx) => this.start({ kind: "new" }, cx);
    const newOn = this.mode?.kind !== "new" && (nav?.("space-new", "spaces", { go: startNew }) ?? false);
    return v_flex().id("spaces").pt(22).pb(10).flex_none()
      .child(h_flex().px(16).pb(4).items_center()
        .child(div().flex_1().child(eyebrow(t, "spaces")))
        .when(this.mode?.kind !== "new", (el) => el.child(navRing(t, chip(t, "space-new-start", "+ new", startNew), newOn))))
      .children(this.rows().map((r) => r.s ? this.row(t, r.s, r.depth, nav) : this.header(t, r)))
      .when(this.mode?.kind === "new", (el) => el.child(this.newRow(t)));
  }
}
