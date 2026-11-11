// Nocturne GitHub: a floating window over the tab (cmd-shift-g, or
// "+ new" > GitHub) with the space's repo on GitHub: its pull requests
// (prs.js), its Actions (actions.js) and its GitHub Projects boards
// (projects.js), in Nocturne's 1-bit night look,
// moved through lazygit's way (hjkl, panels, a key bar; ? lists every key).
//
//   1 2 3 [ ]   Pull requests / Actions / Projects
//   r           read everything again now
//   p F         a fork: its parent repo, and back (the header's "fork of …"; on Projects only F: p picks the project)
//   L           the links in the shown PR or card, as a list (j/k, enter opens one)
//   drag        the gaps between panels resize them (kept per tab)
//   n           a new pull request (Pull requests) / run a workflow by hand (Actions):
//               a form (form.js; prForm.js, dispatchForm.js) whose last step shows the exact commands
//
// keys.json can bind nocturne-github.prs / .actions / .projects / .refresh / .diff / .fork / .new-pr / .run-workflow (to a shown window).
//   ?           every key        esc q  close the window (from its top level)
//
// Everything goes through the gh CLI (gh.js): its login, no token here.
// Live: a tick every second redraws what's running (timers, sweeps) and
// reads GitHub again when the shown tab wants it: every few seconds while a
// run, job or check is moving, every minute when all is still, never while
// the window is closed. Reads carry ETags, so unchanged answers are free.
//
// Stale while revalidate: what the window last read of a repo (PRs, their
// views, runs, jobs, workflow needs, and the ETags) is kept in
// data/nocturne-github/cache.json (cache.js, store.js), so an opening shows
// it at once and reads GitHub behind it; the bar says "updating…", then
// "updated 2m ago". A failed read keeps what's shown and says so quietly.
//
// Opened by the nocturne mod's sky (nocturne.github) as an overlay window
// with props { folder, on }; also works as a pane or tab (+ new > GitHub in
// a new tab). `d` on a PR swaps the window for the git window's review of
// that PR (nocturne-git, which took in nocturne-diff), whose esc / q brings
// this window back where it was (its state is in shared(STATE)).
// A link opened from the floating window (o, a check, a link in a PR) opens
// in a web pane beside the pane underneath and closes the window.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, nextCommand, shared, setShared, spaces, panes, focused, run, notify, settings, window as appWindow } from "herdr";
import { repoOf, viewRepo } from "./gh.js";
import { readAgo } from "./model.js";
import { slug } from "./remotes.js";
import { lookup, entryFor, repoKey, slimRepo } from "./cache.js";
import * as store from "./store.js";
import { dither, chip, hints, empty, stop, pip, band, ART, unzoom, unzoomSize, popupScrim } from "./kit.js";
import { bindTab, tabActions } from "./form-keys.js";
import { keysView, keysKey } from "./keyhelp.js";
import Prs from "./prs.js";
import Actions from "./actions.js";
import Projects from "./projects.js";

export const WINDOW = "nocturne-github.window"; // { id, beat }: the open window, for the toggle
// { folder, on, head, at }: the git window's branch for a new pull request (its branches panel),
// read when nocturne-github.new-pr arrives or the window opens with create "pr".
export const CREATE = "nocturne-github.create";
const CREATE_FRESH = 30000;
const STATE = "nocturne-github.state";
const BEAT = 4000;
const SAVE_EVERY = 10000; // the cache is written at most this often
const TABS = [["prs", "Pull requests"], ["actions", "Actions"], ["projects", "Projects"]];

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
    // Opened to write (nocturne's githubForm): the form, once the repo is known. Only a fresh ask:
    // the same props come back when the window is restored or reloaded, and must not open it again.
    const ask = (pr.create === "pr" || pr.create === "workflow") && Date.now() - (pr.at ?? 0) < CREATE_FRESH;
    this.wantForm = ask ? pr.create : null;
    this.prs = new Prs(this, same ? kept.prs : {});
    this.actions = new Actions(this, same ? kept.actions : {});
    this.projects = new Projects(this, same ? kept.projects : {});
    this.repo = null;
    this.state = "loading"; // loading | norepo | error | ready
    this.error = "";
    this.stale = ""; // the last poll failed; data kept
    this.confirm = null; // { text, go }
    this.note = null; // { text, tone, at }
    this.help = false;
    this.picker = null; // { title, rows: [{ label, sub, go(cx) }], at }: L's list of links
    this.size = { width: 1000, height: 700 };
    this.resizing = null; // { key, axis, at, from, set, min, max, sign } while a splitter is dragged
    this.next = 0; // when to read GitHub again
    this.busy = false;
    this.again = false;
    this.loud = false; // the running read is worth showing ("updating…")
    this.checked = false; // the cache was looked at
    this.dirty = false; this.savedAt = 0; this.saving = null;
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.js)
    this.handle.focus();
    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => { if (!this.closed && !this.shown().composer && !this.shown().form) this.handle.focus(); });
    this.beat();
    // Opened before in this run: the cache is in memory, shown in the first frame.
    const doc = store.peek();
    if (doc) this.fromCache(doc);
    this.start(cx);
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-github\./, "");
        if (c === "focus") this.handle.focus();
        else if (c === "refresh") this.refresh(cx, true);
        else if (c === "keys") this.help = !this.help;
        else if (c === "fork") this.switchFork(cx);
        else if (c === "prs" || c === "actions" || c === "projects") this.setTab(c, cx);
        else if (c === "diff" && this.repo && this.prs.current()) this.openDiff(this.prs.current().number);
        else if (c === "new-pr") { this.wantForm = "pr"; this.openForm(cx); }
        else if (c === "run-workflow") { this.wantForm = "workflow"; this.openForm(cx); }
        cx.notify();
      }
    });
  }

  // ---- life

  /** Shows what the cache holds for this folder's repo, if anything. */
  fromCache(doc) {
    this.checked = true;
    const e = this.folder ? lookup(doc, this.folder, this.on) : null;
    if (!e?.repo?.full || this.repo) return false;
    this.repo = { ...e.repo };
    this.prs.hydrate(e.prs);
    this.actions.hydrate(e.actions);
    this.projects.hydrate(e.projects);
    this.state = "ready";
    return true;
  }

  start(cx) {
    cx.spawn(async (cx) => {
      if (!this.checked) {
        try { this.fromCache(await store.load()); } catch { this.checked = true; }
        cx.notify();
      }
      // A cached repo is read at once; where the folder's repo is now is asked meanwhile.
      if (this.repo) this.refresh(cx, { all: true });
      try {
        const now = await repoOf(this.folder, this.on);
        if (this.closed) return;
        // The folder's fork, shown as its parent last time (p): the parent stays.
        const onParent = now && this.repo?.child === now.full && this.repo.full === now.parent && this.repo.on === now.on;
        if (onParent) {
          this.repo.branch = now.branch;
        } else if (now && this.repo && repoKey(now) === repoKey(this.repo)) {
          Object.assign(this.repo, now); // the same repo: its branch may have moved
        } else {
          this.show(now, cx);
        }
      } catch (e) {
        // Offline: a cached repo stays shown, the bar says so.
        if (this.repo) this.stale = String(e?.message ?? e);
        else { this.state = "error"; this.error = String(e?.message ?? e); }
      }
      this.located = true; // the folder's branch is known now (a cached one may be old)
      this.openForm(cx);
      cx.notify();
    });
  }

  /** Shows another repo (or none), with what the cache holds of it (`cached`): what was shown of the old one goes. */
  show(repo, cx, cached = null) {
    this.repo = repo;
    this.prs.hydrate(cached?.prs ?? null); this.actions.hydrate(cached?.actions ?? null); this.projects.hydrate(cached?.projects ?? null);
    this.warmed = null;
    this.gen = (this.gen ?? 0) + 1; this.busy = false; // a read of the old repo is dropped
    this.stale = "";
    this.state = repo ? "ready" : "norepo";
    if (repo) this.refresh(cx, { all: true });
  }

  /** p: a fork's parent, or back to the fork. The choice is kept per folder (in the cache). */
  switchFork(cx) {
    const r = this.repo;
    const to = r?.parent ? { full: r.parent, host: r.host, child: r.full } : r?.child ? { full: r.child, host: r.host, child: null } : null;
    if (!to || this.switching) return;
    this.switching = true;
    this.note = { text: `Opening ${to.full}…`, tone: "working", at: Date.now() };
    cx.spawn(async (cx) => {
      try {
        const next = await viewRepo(to, { root: r.root, on: r.on, branch: r.branch });
        if (this.closed || this.repo !== r) return;
        if (!next) throw new Error(`${to.full} isn't on GitHub.`);
        next.child = to.child;
        if (to.child) next.parent = null; // from the parent, p goes back to the fork, not up again
        this.note = null;
        // From the cache when this folder showed it before.
        this.show(next, cx, store.peek()?.repos?.[repoKey(next)] ?? null);
        this.dirty = true;
      } catch (e) {
        this.note = { text: String(e?.message ?? e), tone: "failed", at: Date.now() };
      } finally {
        this.switching = false;
        cx.notify();
      }
    });
  }

  /** Tells the toggle (nocturne's sky) this window is still open. */
  beat() {
    if (!this.overlay) return;
    this.beatAt = Date.now();
    setShared(WINDOW, { id: this.overlay, beat: this.beatAt });
  }

  /** A form asked for (props, a command) once the repo is known: a new pull request (with the git window's branch, if it just asked) or a workflow to run. */
  openForm(cx) {
    if (!this.wantForm || this.state !== "ready" || !this.repo || !this.located) return;
    const what = this.wantForm;
    this.wantForm = null;
    this.help = false; this.picker = null;
    if (what === "pr") {
      const req = shared(CREATE);
      const mine = req && Date.now() - (req.at ?? 0) < CREATE_FRESH && (!req.folder || !this.repo.root || req.folder.startsWith(this.repo.root) || this.repo.root.startsWith(req.folder));
      if (req) setShared(CREATE, null);
      this.tab = "prs";
      this.prs.newPr(cx, { head: mine ? req.head ?? null : null });
    } else {
      this.tab = "actions";
      this.actions.runWorkflow(cx);
    }
    cx.notify();
  }

  tick(cx) {
    if (this.closed) return;
    if (this.wantForm) this.openForm(cx);
    if (Date.now() - (this.beatAt ?? 0) >= BEAT) this.beat();
    let redraw = false;
    if (this.note && Date.now() - this.note.at > 5000) { this.note = null; redraw = true; }
    if (this.state === "ready" && Date.now() >= this.next) this.refresh(cx);
    if (this.dirty && !this.saving && Date.now() - this.savedAt >= SAVE_EVERY) this.persist();
    // "updated 2m ago" changes once a minute.
    const said = this.readWord();
    if (said !== this.said) { this.said = said; redraw = true; }
    // Running things' timers tick once a second; a still window isn't redrawn.
    if (redraw || (this.state === "ready" && this.shown().interval() < 10000)) cx.notify();
  }

  shown() { return this.tab === "prs" ? this.prs : this.tab === "projects" ? this.projects : this.actions; }

  /** Reads the shown tab now. force (true, or { all, fresh }): all reads past the
   *  timers, fresh past the ETags too (r, after an action). */
  refresh(cx, force = false) {
    if (!this.repo) return;
    const opts = force === true ? { all: true, fresh: true } : force || {};
    if (this.busy) { this.again = true; if (opts.all) this.againOpts = opts; return; }
    this.busy = true;
    this.next = Infinity; // the tick doesn't queue another read behind this one
    const tab = this.shown();
    // Worth a word in the bar: asked for, or what's shown is old (a cached opening).
    const at = tab.readAt();
    this.loud = Boolean(opts.all) || !at || Date.now() - at > Math.max(2 * tab.interval(), 30000);
    const gen = (this.gen = (this.gen ?? 0) + 1);
    cx.spawn(async (cx) => {
      try {
        await tab.warming;
        await tab.poll(opts, cx);
        if (gen !== this.gen) return;
        this.stale = "";
        this.dirty = true;
      } catch (e) {
        if (gen === this.gen) this.stale = String(e?.message ?? e);
      } finally {
        if (!this.closed && gen === this.gen) {
          this.busy = false; this.loud = false;
          // A failed read waits a little longer, so a dropped network doesn't spin.
          this.next = Date.now() + (this.stale ? Math.max(15000, tab.interval()) : tab.interval());
          this.save();
          if (this.dirty && Date.now() - this.savedAt >= SAVE_EVERY) this.persist();
          if (!this.stale) this.warm(cx);
          cx.notify();
          if (this.again) { const o = this.againOpts ?? false; this.again = false; this.againOpts = null; this.refresh(cx, o); }
        }
      }
    });
  }

  /** Once the shown tab is read, the other one is read behind it, so switching shows fresh data. */
  warm(cx) {
    const other = this.tab === "prs" ? this.actions : this.prs;
    if (this.warmed?.has(other) || other.warming) return;
    (this.warmed ??= new Set()).add(other);
    const repo = this.repo;
    other.warming = (async () => {
      try { await other.poll({}, null); if (this.repo === repo) this.dirty = true; } catch { /* the tab's own read says it */ }
    })();
    cx.spawn(async (cx) => { await other.warming; other.warming = null; if (!this.closed) cx.notify(); });
  }

  /** Writes what's shown to the cache (store.js), at most every SAVE_EVERY. */
  persist() {
    if (!this.repo || this.saving || this.state !== "ready") return this.saving;
    this.dirty = false; this.savedAt = Date.now();
    const entry = { ...entryFor(this.repo), repo: slimRepo(this.repo), prs: this.prs.snapshot(), actions: this.actions.snapshot(), projects: this.projects.snapshot() };
    this.saving = store.save(this.folder, entry).catch(() => false).finally(() => { this.saving = null; });
    return this.saving;
  }

  /** The bar's word for the shown data's age: "updated 2m ago". */
  readWord() {
    const at = this.state === "ready" ? this.shown().readAt() : 0;
    return at ? `updated ${readAgo(at)}` : "";
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
    setShared(STATE, { folder: this.folder, tab: this.tab, prs: this.prs.save(), actions: this.actions.save(), projects: this.projects.save() });
  }

  focusSelf() { this.handle.focus(); }

  async close() {
    this.closed = true;
    this.save();
    if (this.dirty) this.persist();
    const w = shared(WINDOW);
    if (this.overlay && w?.id === this.overlay) setShared(WINDOW, null);
    // The last read goes to the cache (the app gives cleanup a quarter second).
    await this.saving;
  }

  /** Opens a link like any mod's (a web pane beside the focused pane, or the
   *  system's browser per `links`). From the floating window, a link that opens
   *  in a web pane closes the window, so the page isn't hidden under it; the
   *  pane goes beside the one the window floated over. */
  openUrl(url, cx) {
    if (!url) return;
    const inApp = settings()?.links !== "system" && appWindow()?.platform === "macos" && /^https?:/i.test(url);
    if (!this.overlay || !inApp) return cx.open_url(url);
    run("app.open_url", { url, in: "app" });
    this.closeWindow();
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

  /** The PR's diff in the git window's review: in this window's place (esc / q come back), or beside it as a pane. */
  openDiff(number) {
    const diff = { folder: this.repo.root, on: this.on, pr: number, repo: slug(this.repo) };
    this.save();
    if (this.overlay) {
      const back = { mod: "nocturne-github", props: { folder: this.folder, on: this.on, tab: "prs" } };
      const id = openOverlay({ mod: "nocturne-git", kind: "window", key: "nocturne-github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: { ...diff, back } });
      setShared(WINDOW, { id, beat: Date.now() }); // the review holds the window now (and renews this)
    } else {
      run("pane.split", { direction: "auto", mod: "nocturne-git", props: diff });
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
    if (tab.form) {
      const used = tab.form.key(k, e, cx);
      if (used === true) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (tab.composer) {
      const used = tab.key(k, e, cx);
      if (used === true) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    if ((m.platform || m.alt) && k !== "enter") return;
    if (this.picker) {
      if (this.pickerKey(k, cx) !== false) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    const help = keysKey(e, this.help);
    if (help || this.help) {
      if (help) this.help = help === "toggle" ? !this.help : false;
      cx.stop_propagation(); cx.notify(); return;
    }
    const ids = TABS.map(([id]) => id);
    if (k === "1" || k === "2" || k === "3") this.setTab(ids[Number(k) - 1], cx);
    else if (k === "[" || k === "]") this.setTab(ids[(ids.indexOf(this.tab) + (k === "]" ? 1 : ids.length - 1)) % ids.length], cx);
    else if (((k === "p" && this.tab !== "projects") || k === "F") && (this.repo?.parent || this.repo?.child)) this.switchFork(cx);
    else if (k === "L" && this.state === "ready" && this.shown().links) this.pickLink();
    else if (k === "r" && !m.control) this.refresh(cx, true);
    else if (this.state === "ready" && tab.key(k, e, cx)) { /* the tab's */ }
    else if (k === "escape" || k === "q") this.closeWindow();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** L: the shown PR's (or card's) links as a list: j/k, enter opens one, esc closes. */
  pickLink() {
    const links = this.shown().links();
    if (!links.length) { this.note = { text: "No links in what's shown.", tone: "working", at: Date.now() }; return; }
    this.picker = { title: "LINKS", at: 0, rows: links.map((l) => ({ label: l.label, sub: l.label === l.url ? "" : l.url, go: (cx) => this.openUrl(l.url, cx) })) };
  }

  /** Keys while the picker is open: it keeps them all. */
  pickerKey(k, cx) {
    const p = this.picker, n = p.rows.length;
    if (k === "escape" || k === "q") this.picker = null;
    else if (k === "j" || k === "down" || (k === "tab")) p.at = Math.min(n - 1, p.at + 1);
    else if (k === "k" || k === "up") p.at = Math.max(0, p.at - 1);
    else if (k === "g" || k === "home") p.at = 0;
    else if (k === "G" || k === "end") p.at = n - 1;
    else if (k === "enter" || k === "o") { const r = p.rows[p.at]; this.picker = null; r?.go(cx); }
    else if (/^[1-9]$/.test(k) && Number(k) <= n) { const r = p.rows[Number(k) - 1]; this.picker = null; r.go(cx); }
    return true;
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
    const said = this.readWord();
    const word = (tone, color, text, breathe = false) => h_flex().gap(5).items_center()
      .child(breathe ? div().loop("opacity", { from: 0.35, to: 1, period: 1100 }).child(pip(t, tone, 6)) : pip(t, tone, 6))
      .child(div().text_color(color).truncate().max_w(260).child(text));
    // Quiet: what's shown is never taken away; the bar only says how old it is.
    const status = this.busy && this.loud ? word("working", t.dim, said ? `updating… · ${said.replace(/^updated /, "")}` : "updating…", true)
      : this.stale ? word("failed", t.dim, said ? `couldn't update · ${said}` : "couldn't update")
      : live ? word("working", t.working, "live")
      : said ? word("done", t.dim, said) : div();
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
      .when(Boolean(this.repo?.parent || this.repo?.child), (el) => el.child(chip(t, "gh-fork",
        this.repo.parent ? `fork of ${this.repo.parent}` : `‹ ${this.repo.child}`, false, (cx) => this.switchFork(cx), t.dim)))
      .when(Boolean(this.repo?.branch), (el) => el.child(div().relative().flex_none().text_color(t.ansi5).child(this.repo.branch)))
      .child(h_flex().relative().flex_none().gap(2).children(tabs))
      .child(div().flex_1())
      .child(div().relative().flex_none().child(status))
      .child(chip(t, "gh-refresh", "↻", false, (cx) => this.refresh(cx, true)))
      .when(Boolean(this.overlay), (el) => el.child(chip(t, "gh-close", "✕", false, () => this.closeWindow())));
  }

  /** ?: every key of the tab and the window (keyhelp.js). */
  helpPanel(t) {
    const fork = this.tab === "projects" ? "F" : "p F";
    const all = [["1 2 3 [ ]", "pull requests / actions / projects"], ["r", "read again now"],
      ...(this.repo?.parent ? [[fork, `the parent, ${this.repo.parent}`]] : this.repo?.child ? [[fork, `back to the fork, ${this.repo.child}`]] : []),
      ["esc q", "close (from the top)"], ["?", "keys"]];
    const tab = this.tab === "prs" ? Prs.help() : this.tab === "projects" ? Projects.help() : Actions.help();
    const name = { prs: "pull requests", actions: "actions", projects: "projects" }[this.tab];
    return keysView(t, { id: "gh-help", title: `GitHub · ${name}`, list: [{ title: name, keys: tab }, { title: "window", keys: all }], close: () => { this.help = false; } });
  }

  pickerPanel(t) {
    const p = this.picker;
    const rows = p.rows.map((r, i) => h_flex().id(`pick-${i}`).relative().h(r.sub ? 34 : 24).flex_none().px(10).gap(10).items_center().cursor_pointer()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(i === p.at, (el) => el.children(band(t, true)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.picker = null; r.go(cx); cx.notify(); })
      .child(div().relative().w(14).flex_none().text_color(i === p.at ? t.accent : t.dim).child(i < 9 ? String(i + 1) : ""))
      .child(v_flex().relative().flex_1().min_w(0)
        .child(div().truncate().text_color(i === p.at ? t.foreground : t.muted).child(r.label))
        .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub)))));
    return div().id("gh-picker").absolute().inset_0().flex().items_center().justify_center().text_size(12)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.picker = null; cx.notify(); })
      .child(popupScrim("gh-picker-scrim"))
      .child(v_flex().id("gh-picker-box").w(560).max_h(420).bg(t.background).border(1).border_color(t.accent).py(4).overflow_y_scroll()
        .on_mouse_down("left", stop)
        .child(div().px(10).pb(4).text_size(10).text_color(t.ansi8).child(p.title))
        .children(rows));
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
    // Before the cache was looked at (a few ms): nothing, rather than a flash of "Finding…".
    if (this.state === "loading" && !this.checked) body = div().size_full();
    else if (this.state === "loading") body = empty(t, "Finding the repo on GitHub…", this.folder ?? "", { moon: 3 });
    else if (this.state === "norepo") body = empty(t, "No GitHub repo here", `${this.folder ?? "This space has no folder"}: the window shows the GitHub repo of the shown space's folder.`, { moon: 0 });
    else if (this.state === "error") body = empty(t, "gh didn't answer", this.error, { moon: 1 });
    else body = this.shown().render(t, { width: this.size.width - 16, height: this.size.height - 70 });
    const note = this.note;
    const endResize = (cx) => { if (this.resizing) { this.resizing = null; this.save(); cx.notify(); } };
    const right = note ? div().text_color(note.tone === "failed" ? t.blocked : note.tone === "done" ? t.done : t.working).truncate().max_w(420).child(note.text)
      : this.stale ? div().text_color(t.ansi8).truncate().max_w(420).child(this.stale) : null;
    return v_flex().id("nocturne-github").size_full().bg(t.background).border(1).border_color(t.ansi8)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
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
        .when(this.help, (el) => el.child(this.helpPanel(t)))
        .when(Boolean(this.picker), (el) => el.child(this.pickerPanel(t))))
      .when(Boolean(this.confirm), (el) => el.child(this.confirmBar(t)))
      .child(hints(t, this.shown().form && !this.picker && !this.help ? this.shown().form.hints() : this.picker ? [["j/k", "move"], ["enter", "open"], ["esc", "close"]] : this.help ? [["esc", "close keys"], ["?", "keys"]] : this.state === "ready" ? this.shown().hints() : [["esc", "close"], ["?", "keys"]], right,
        { on: this.help, toggle: () => { this.help = !this.help; } }));
  }
}
