// Spaces: one row each, the shown one on a dithered band, with inline
// create / rename / delete. Spaces in worktrees of one repo are grouped: the
// space on the repo's main checkout first, its worktree spaces indented under
// it (or under the repo's name when the main checkout has no space).
// nocturne.next / nocturne.prev (keys.json) walk the rows in this order.
//
//   click a row   shows it
//   + new         a name (optional: unnamed, Herdr names it after its folder)
//                 and a folder (optional: home); opens it
//   right-click   a menu (menu.js): show, new tab here, rename, delete
//   rename        inline; an empty name gives it Herdr's name back
//   delete        ends its terminals and agents (asks first, inline, saying
//                 how many); it stays in Herdr's recent spaces
// The menu asks through shared(EDIT_SPACE); on the folded rail Herdr's own
// (Nocturne-skinned) prompt and confirm dialogs do it instead.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, panes, agents, run, exec, home, pickFolder, openOverlay, shared } from "herdr";
import { dither, pip, eyebrow, place } from "./kit.js";
import { chip, field, confirm } from "./inline.js";
import { menuHeight, EDIT_SPACE } from "./menu.js";

const stop = (_e, cx) => cx.stop_propagation();
const tilde = (p) => { const h = home(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };
// How often to look for spaces in folders not yet placed in a repo.
const SCAN = 1500;

export default class Spaces {
  init(cx) {
    this.mode = null; // null | { kind: "new", folder } | { kind: "rename", s } | { kind: "delete", s }
    this.input = InputState.new({ placeholder: "name" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    // folder key -> { main, top } (a git checkout) | null (not one); asked
    // once per folder, so drawing and switching never wait on git.
    this.repos = new Map();
    this.asking = new Set();
    this.scan(cx);
    cx.timer.every(SCAN, (cx) => this.scan(cx));
    // A request from before this sidebar was made is old.
    this.editAsked = shared(EDIT_SPACE)?.at ?? null;
  }

  /** A space's right-click menu. */
  menu(s) {
    const props = { role: "menu", tab: "space", target: { id: s.id } };
    openOverlay({ mod: "nocturne", kind: "popup", frame: "none", width: 220, height: menuHeight(props), props });
  }

  /** Answers the menu's rename / delete, once per request: inline, or with Herdr's dialogs when folded. */
  answer(folded, cx) {
    const ask = shared(EDIT_SPACE);
    if (!ask || ask.at === this.editAsked) return;
    this.editAsked = ask.at;
    const s = spaces().find((x) => x.id === ask.id);
    if (!s) return;
    if (folded) return run(ask.kind === "rename" ? "space.rename" : "space.close", { id: s.id });
    this.start({ kind: ask.kind, s }, cx);
  }

  // ---- repos

  key(s, all) {
    const folder = place(s, all);
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
    const groups = new Map(); // group key -> spaces, in Herdr's order
    for (const s of sp) {
      const r = repoOf(s);
      const g = r ? `${s.machine ?? ""}|${r.main}` : `space|${s.id}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const out = [];
    for (const [g, list] of groups) {
      if (list.length === 1) { out.push({ s: list[0], depth: 0 }); continue; }
      const main = g.slice(g.indexOf("|") + 1);
      const parent = list.find((s) => repoOf(s)?.top === main);
      if (parent) out.push({ s: parent, depth: 0 });
      else out.push({ header: main.split("/").pop(), key: g });
      for (const s of list) if (s !== parent) out.push({ s, depth: 1 });
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
    this.mode = mode;
    if (mode?.kind === "new" || mode?.kind === "rename") {
      this.input.set_value(mode.kind === "rename" && mode.s.named ? mode.s.name : "");
      this.input.focus();
    }
    cx.notify();
  }

  submit(cx) {
    const m = this.mode, name = this.input.value().trim();
    if (m?.kind === "new") run("space.new", { ...(name ? { name } : {}), ...(m.folder ? { folder: m.folder } : {}) });
    else if (m?.kind === "rename") run("space.rename", { id: m.s.id, name });
    this.mode = null;
    cx.notify();
  }

  pick(cx) {
    const m = this.mode;
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Start the new space in" });
      if (folder && this.mode === m) { m.folder = folder; this.input.focus(); cx.notify(); }
    });
  }

  remove(s, cx) {
    run("space.close", { id: s.id, confirmed: true });
    this.mode = null;
    cx.notify();
  }

  // ---- parts

  /** A worktree space's indent: a faint guide line, then the row's own padding. */
  indent(t, depth) {
    if (!depth) return null;
    return div().relative().w(10).h_full().flex_none().ml(-2)
      .child(div().absolute().left(2).top(0).bottom(0).w(1).bg(t.ansi8 + "55"));
  }

  row(t, s, depth) {
    const id = `space-${s.id}`;
    const m = this.mode?.s?.id === s.id ? this.mode : null;
    if (m?.kind === "rename") {
      return h_flex().id(id).h(24).px(16).gap(8).items_center()
        .when(depth > 0, (el) => el.child(this.indent(t, depth)))
        .child(pip(t, s.status))
        .child(field(t, "space-input", this.input, (cx) => this.start(null, cx)))
        .child(chip(t, `${id}-cancel`, "esc", (cx) => this.start(null, cx)));
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
        go: { label: "delete", action: (cx) => this.remove(s, cx) },
        keep: (cx) => this.start(null, cx),
      });
    }
    return h_flex().id(id).relative().h(24).px(16).gap(8).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(s); })
      .on_click(() => run("space.select", { id: s.id }))
      .hover((st) => st.bg(t.ansi0 + "55"))
      .when(s.active, (el) => el.child(dither(t.ansi0, 1)))
      .when(depth > 0, (el) => el.child(this.indent(t, depth)))
      .child(pip(t, s.status))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(s.active ? t.foreground : t.muted).child(s.name))
      .child(div().relative().flex_none().text_color(t.dim).child(String(s.tabs.length)));
  }

  /** A repo whose main checkout has no space: its name over its worktree spaces. */
  header(t, r) {
    return h_flex().id(`repo-${r.key}`).h(22).px(16).gap(8).items_center().text_size(11)
      .child(div().w(6).flex_none())
      .child(div().min_w(0).truncate().text_color(t.ansi8).child(r.header));
  }

  newRow(t) {
    const m = this.mode;
    return v_flex().id("space-new").px(16).gap(2)
      .child(h_flex().h(24).gap(8).items_center()
        .child(div().w(6).flex_none().text_size(11).text_color(t.accent).child("+"))
        .child(field(t, "space-input", this.input, (cx) => this.start(null, cx)))
        .child(chip(t, "space-new-cancel", "esc", (cx) => this.start(null, cx))))
      .child(h_flex().pl(14).h(18).gap(4).items_center().text_size(11)
        .child(div().min_w(0).truncate().text_color(t.dim).child(m.folder ? `in ${tilde(m.folder)}` : "in ~"))
        .child(chip(t, "space-new-folder", m.folder ? "change" : "choose folder", (cx) => this.pick(cx))));
  }

  render(t) {
    return v_flex().id("spaces").pt(22).pb(10).flex_none()
      .child(h_flex().px(16).pb(4).items_center()
        .child(div().flex_1().child(eyebrow(t, "spaces")))
        .when(this.mode?.kind !== "new", (el) => el.child(chip(t, "space-new-start", "+ new", (cx) => this.start({ kind: "new", folder: null }, cx)))))
      .children(this.rows().map((r) => r.s ? this.row(t, r.s, r.depth) : this.header(t, r)))
      .when(this.mode?.kind === "new", (el) => el.child(this.newRow(t)));
  }
}
