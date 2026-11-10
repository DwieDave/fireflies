// Nocturne GitHub: a floating window over the tab (cmd-shift-g, or
// "+ new" > GitHub) with the space's repo on GitHub: its pull requests
// (prs.js) and its Actions (actions.js), in Nocturne's 1-bit night look,
// moved through lazygit's way (hjkl, panels, a key bar; ? lists every key).
//
//   1 2 [ ]     Pull requests / Actions
//   r           read everything again now
//   drag        the gaps between panels resize them (kept per tab)
//
// keys.json can bind nocturne-github.prs / .actions / .refresh / .diff (to a shown window).
//   ?           every key        esc q  close the window (from its top level)
//
// Everything goes through the gh CLI (gh.js): its login, no token here.
// Live: a tick every second redraws what's running (timers, sweeps) and
// reads GitHub again when the shown tab wants it: every few seconds while a
// run, job or check is moving, every minute when all is still, never while
// the window is closed. Reads carry ETags, so unchanged answers are free.
//
// Opened by the nocturne mod's sky (nocturne.github) as an overlay window
// with props { folder, on }; also works as a pane or tab (+ new > GitHub in
// a new tab). `d` on a PR swaps the window for nocturne-diff on that PR, whose
// esc brings this window back where it was (its state is in shared(STATE)).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, nextCommand, shared, setShared, spaces, panes, focused, run, notify } from "herdr";
import { repoOf } from "./gh.js";
import { dither, chip, hints, empty, stop, pip, ART, unzoom, unzoomSize } from "./kit.js";
import Prs from "./prs.js";
import Actions from "./actions.js";

export const WINDOW = "nocturne-github.window"; // { id, beat }: the open window, for the toggle
const STATE = "nocturne-github.state";
const BEAT = 4000;
const TABS = [["prs", "Pull requests"], ["actions", "Actions"]];

/** The shown space's folder and machine (when opened without props). */
function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? panes().find((p) => p.tab === tab && p.cwd);
  // A space attached to a folder (space.folder) uses it over where its panes are.
  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

export default class GitHub extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.overlay = pr.overlay ?? null;
    const h = pr.folder ? { folder: pr.folder, on: pr.on ?? null } : here();
    this.folder = h.folder; this.on = h.on;
    const kept = shared(STATE) ?? {};
    const same = kept.folder === this.folder;
    this.tab = pr.tab ?? (same ? kept.tab : null) ?? "prs";
    this.prs = new Prs(this, same ? kept.prs : {});
    this.actions = new Actions(this, same ? kept.actions : {});
    this.repo = null;
    this.state = "loading"; // loading | norepo | error | ready
    this.error = "";
    this.stale = ""; // the last poll failed; data kept
    this.confirm = null; // { text, go }
    this.note = null; // { text, tone, at }
    this.help = false;
    this.size = { width: 1000, height: 700 };
    this.resizing = null; // { key, axis, at, from, set, min, max, sign } while a splitter is dragged
    this.next = 0; // when to read GitHub again
    this.busy = false;
    this.again = false;
    this.readAt = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => { if (!this.closed && !this.shown().composer) this.handle.focus(); });
    this.beat();
    this.start(cx);
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-github\./, "");
        if (c === "focus") this.handle.focus();
        else if (c === "refresh") this.refresh(cx, true);
        else if (c === "prs" || c === "actions") this.setTab(c, cx);
        else if (c === "diff" && this.repo && this.prs.current()) this.openDiff(this.prs.current().number);
        cx.notify();
      }
    });
  }

  // ---- life

  start(cx) {
    cx.spawn(async (cx) => {
      try {
        this.repo = await repoOf(this.folder, this.on);
        this.state = this.repo ? "ready" : "norepo";
        if (this.repo) this.refresh(cx, true);
      } catch (e) {
        this.state = "error"; this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  /** Tells the toggle (nocturne's sky) this window is still open. */
  beat() {
    if (!this.overlay) return;
    this.beatAt = Date.now();
    setShared(WINDOW, { id: this.overlay, beat: this.beatAt });
  }

  tick(cx) {
    if (this.closed) return;
    if (Date.now() - (this.beatAt ?? 0) >= BEAT) this.beat();
    let redraw = false;
    if (this.note && Date.now() - this.note.at > 5000) { this.note = null; redraw = true; }
    if (this.state === "ready" && Date.now() >= this.next) this.refresh(cx);
    // Running things' timers tick once a second; a still window isn't redrawn.
    if (redraw || (this.state === "ready" && this.shown().interval() < 10000)) cx.notify();
  }

  shown() { return this.tab === "prs" ? this.prs : this.actions; }

  /** Reads the shown tab now (force: past the ETags and timers). */
  refresh(cx, force = false) {
    if (!this.repo) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    const tab = this.shown();
    const gen = (this.gen = (this.gen ?? 0) + 1);
    cx.spawn(async (cx) => {
      try {
        await tab.poll(force, cx);
        this.stale = "";
        this.readAt = Date.now();
      } catch (e) {
        this.stale = String(e?.message ?? e);
      } finally {
        this.busy = false;
        if (!this.closed && gen === this.gen) {
          // A failed read waits a little longer, so a dropped network doesn't spin.
          this.next = Date.now() + (this.stale ? Math.max(15000, tab.interval()) : tab.interval());
          this.save();
          cx.notify();
          if (this.again) { this.again = false; this.refresh(cx); }
        }
      }
    });
  }

  /** Soon: a selection changed, its details want reading. */
  kick(cx) {
    this.next = Math.min(this.next, Date.now() + 150);
    cx?.timer?.after(160, (cx) => { if (!this.closed && Date.now() >= this.next) this.refresh(cx); });
  }

  /** Background work for a tab (with the cx of whatever asked for it). */
  spawn(cx, fn) {
    cx.spawn(async (cx) => { try { await fn(); } catch { /* shown by the caller */ } if (!this.closed) cx.notify(); });
  }

  save() {
    setShared(STATE, { folder: this.folder, tab: this.tab, prs: this.prs.save(), actions: this.actions.save() });
  }

  focusSelf() { this.handle.focus(); }

  close() {
    this.closed = true;
    this.save();
    const w = shared(WINDOW);
    if (this.overlay && w?.id === this.overlay) setShared(WINDOW, null);
  }

  closeWindow() {
    if (this.overlay) closeOverlay(this.overlay);
  }

  // ---- between the tabs and the outside

  setTab(tab, cx) {
    if (this.tab === tab) return;
    this.tab = tab; this.help = false;
    this.next = 0;
    this.refresh(cx, false);
  }

  showRun(runId, jobId, cx) { this.tab = "actions"; this.actions.show(runId, jobId, cx); }
  showRuns(filter, cx) { this.tab = "actions"; this.actions.showRuns(filter, cx); }

  /** The PR's diff in nocturne-diff: in this window's place (esc comes back), or beside it as a pane. */
  openDiff(number) {
    const diff = { folder: this.repo.root, on: this.on, pr: number };
    this.save();
    if (this.overlay) {
      const back = { mod: "nocturne-github", props: { folder: this.folder, on: this.on, tab: "prs" } };
      const id = openOverlay({ mod: "nocturne-diff", kind: "window", key: "nocturne-github", frame: "none", width: 0.85, height: 0.85, props: { ...diff, back } });
      setShared(WINDOW, { id, beat: Date.now() }); // the diff holds the window now (and renews this)
    } else {
      run("pane.split", { direction: "auto", mod: "nocturne-diff", props: diff });
    }
  }

  /** Starts dragging a splitter: the panel was `from` px; `set(px)` takes its
   *  new size within min..max (sign -1: the panel grows as the pointer moves back). */
  resize(e, key, axis, from, set, { min = 120, max = 4000, sign = 1 } = {}) {
    this.resizing = { key, axis, at: axis === "x" ? e.position.x : e.position.y, from, set, min, max: Math.max(min, max), sign };
  }

  dragged(key) { return this.resizing?.key === key; }

  ask(text, go) { this.confirm = { text, go }; }

  /** Runs a gh action; says how it went, then reads again soon. */
  act(promise, ok, cx, after) {
    this.note = { text: "…", tone: "working", at: Date.now() };
    cx.spawn(async (cx) => {
      let r;
      try { r = await promise; } catch (e) { r = { ok: false, err: String(e?.message ?? e) }; }
      if (r.ok) after?.();
      this.note = r.ok ? (ok ? { text: ok, tone: "done", at: Date.now() } : null) : { text: r.err, tone: "failed", at: Date.now() };
      if (!r.ok && !this.overlay) notify({ title: "GitHub", body: r.err, level: "error" });
      this.refresh(cx, true);
      cx.notify();
    });
  }

  // ---- keys

  key(e, cx) {
    const m = e.modifiers ?? {};
    const c = e.key_char;
    const k = c && c.length === 1 && c.trim() && !m.platform && !m.control ? c : e.key;
    if (this.confirm) {
      if (k === "y" || k === "enter") { const go = this.confirm.go; this.confirm = null; go(); }
      else this.confirm = null;
      cx.stop_propagation(); cx.notify(); return;
    }
    const tab = this.shown();
    if (tab.composer) {
      const used = tab.key(k, e, cx);
      if (used === true) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    if ((m.platform || m.alt) && k !== "enter") return;
    if (this.help) {
      if (k === "escape" || k === "?" || k === "q") this.help = false;
      cx.stop_propagation(); cx.notify(); return;
    }
    if (k === "1") this.setTab("prs", cx);
    else if (k === "2") this.setTab("actions", cx);
    else if (k === "[" || k === "]") this.setTab(this.tab === "prs" ? "actions" : "prs", cx);
    else if (k === "?") this.help = true;
    else if (k === "r" && !m.control) this.refresh(cx, true);
    else if (this.state === "ready" && tab.key(k, e, cx)) { /* the tab's */ }
    else if (k === "escape" || k === "q") this.closeWindow();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- drawing

  header(t) {
    const live = this.state === "ready" && this.shown().interval() < 10000;
    const runningRuns = (this.actions.runs ?? []).filter((r) => r.status === "in_progress").length;
    const where = this.repo ? this.repo.full : this.folder ?? "";
    const tabs = TABS.map(([id, label], i) => chip(t, `tab-${id}`,
      h_flex().gap(6).items_center()
        .child(div().text_color(this.tab === id ? t.accent : t.dim).child(String(i + 1)))
        .child(div().child(label))
        .when(id === "actions" && runningRuns > 0, (el) => el.child(pip(t, "working", 6)))
        .when(id === "prs" && (this.prs.list?.length ?? 0) > 0, (el) => el.child(div().text_color(t.dim).child(String(this.prs.list.length)))),
      this.tab === id, (cx) => this.setTab(id, cx)));
    const status = this.stale ? h_flex().gap(5).items_center().child(pip(t, "failed", 6)).child(div().text_color(t.blocked).truncate().max_w(260).child("offline · retrying"))
      : live ? h_flex().gap(5).items_center().child(pip(t, "working", 6)).child(div().text_color(t.working).child("live"))
      : this.readAt ? h_flex().gap(5).items_center().child(pip(t, "done", 6)).child(div().text_color(t.dim).child("quiet")) : div();
    // The bar is where the window drags from: presses on it aren't stopped.
    return h_flex().id("gh-head").relative().h(36).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
      .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)))
      // A firefly drifts along the bar while something runs.
      .when(live, (el) => el.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
        .loop("left", { from: 140, to: Math.max(300, this.size.width - 260), period: 9000 })
        .loop("opacity", { from: 0.3, to: 1, period: 800 })))
      .child(h_flex().relative().flex_none().gap(8).items_center()
        .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
        .child(div().text_color(t.foreground).child("GITHUB")))
      .child(div().relative().flex_none().max_w(320).truncate().text_color(t.muted).child(where))
      .when(Boolean(this.repo?.branch), (el) => el.child(div().relative().flex_none().text_color(t.ansi5).child(this.repo.branch)))
      .child(h_flex().relative().flex_none().gap(2).children(tabs))
      .child(div().flex_1())
      .child(div().relative().flex_none().child(status))
      .child(chip(t, "gh-refresh", "↻", false, (cx) => this.refresh(cx, true)))
      .when(Boolean(this.overlay), (el) => el.child(chip(t, "gh-close", "✕", false, () => this.closeWindow())));
  }

  helpPanel(t) {
    const all = [["1 2 [ ]", "pull requests / actions"], ["r", "read again now"], ["?", "these keys"], ["esc q", "close (from the top)"]];
    const tab = this.tab === "prs" ? Prs.help() : Actions.help();
    const col = (title, list) => v_flex().gap(3).min_w(260)
      .child(div().pb(4).text_color(t.ansi8).child(title))
      .children(list.map(([k, what], i) => h_flex().id(`help-${title}-${i}`).gap(12)
        .child(div().w(120).flex_none().text_color(t.accent).child(k))
        .child(div().text_color(t.muted).child(what))));
    return div().id("gh-help").absolute().inset_0().bg(t.background + "f2").p(20).text_size(11)
      .on_mouse_down("left", stop)
      .child(h_flex().gap(40).items_start()
        .child(col(this.tab === "prs" ? "PULL REQUESTS" : "ACTIONS", tab))
        .child(col("WINDOW", all)));
  }

  confirmBar(t) {
    return h_flex().id("gh-confirm").relative().h(30).flex_none().px(12).gap(12).items_center().text_size(12)
      .child(dither(t.ansi3 + "44", 1))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(this.confirm.text))
      .child(chip(t, "gh-yes", "y  yes", false, () => { const go = this.confirm.go; this.confirm = null; go(); }, t.ansi3))
      .child(chip(t, "gh-no", "esc  no", false, () => { this.confirm = null; }));
  }

  render() {
    const t = theme();
    let body;
    if (this.state === "loading") body = empty(t, "Finding the repo on GitHub…", this.folder ?? "", { moon: 3 });
    else if (this.state === "norepo") body = empty(t, "No GitHub repo here", `${this.folder ?? "This space has no folder"}: the window shows the GitHub repo of the shown space's folder.`, { moon: 0 });
    else if (this.state === "error") body = empty(t, "gh didn't answer", this.error, { moon: 1 });
    else body = this.shown().render(t, { width: this.size.width - 16, height: this.size.height - 70 });
    const note = this.note;
    const endResize = (cx) => { if (this.resizing) { this.resizing = null; this.save(); cx.notify(); } };
    const right = note ? div().text_color(note.tone === "failed" ? t.blocked : note.tone === "done" ? t.done : t.working).truncate().max_w(420).child(note.text)
      : this.stale ? div().text_color(t.blocked).truncate().max_w(420).child(this.stale) : null;
    return v_flex().id("nocturne-github").size_full().bg(t.background).border(1).border_color(t.ansi8)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .when(Boolean(this.resizing), (el) => el.when(this.resizing.axis === "x", (e2) => e2.cursor_col_resize()).when(this.resizing.axis === "y", (e2) => e2.cursor_row_resize()))
      .on_mouse_move((e, cx) => {
        const r = this.resizing;
        if (!r) return;
        const moved = unzoom((r.axis === "x" ? e.position.x : e.position.y) - r.at) * r.sign;
        r.set(Math.round(Math.min(r.max, Math.max(r.min, r.from + moved))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => { if (!h) endResize(cx); })
      .child(this.header(t))
      .child(div().id("gh-body").relative().flex_1().min_h(0).p(8)
        .on_mouse_down("left", (_e, cx) => { this.handle.focus(); cx.stop_propagation(); })
        .child(body)
        .when(this.help, (el) => el.child(this.helpPanel(t))))
      .when(Boolean(this.confirm), (el) => el.child(this.confirmBar(t)))
      .child(hints(t, this.help ? [["esc", "close keys"]] : this.state === "ready" ? this.shown().hints() : [["esc", "close"]], right));
  }
}
