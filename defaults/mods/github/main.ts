// Nocturne GitHub: a floating window over the tab (cmd-shift-g, or
// "+ new" > GitHub) with the space's repo on GitHub: its pull requests
// (prs.ts), its Actions (actions.ts) and its GitHub Projects boards
// (projects.ts), in Nocturne's 1-bit night look,
// moved through lazygit's way (hjkl, panels, a key bar; ? lists every key).
//
//   1 2 3 [ ]   Pull requests / Actions / Projects
//   r           read everything again now
//   p F         a fork: its parent repo, and back (the header's "fork of …"; on Projects only F: p picks the project)
//   L           the links in the shown PR or card, as a list (j/k, enter opens one)
//   drag        the gaps between panels resize them (kept per tab)
//   n           a new pull request (Pull requests) / run a workflow by hand (Actions):
//               a form (form.ts; prForm.ts, dispatchForm.ts) whose last step shows the exact commands
//
// keys.json can bind github.prs / .actions / .projects / .refresh / .diff / .fork / .new-pr / .run-workflow (to a shown window).
//   ?           every key        esc q  close the window (from its top level)
//
// Everything goes through the gh CLI (gh.ts): its login, no token here.
// Live: a tick every second redraws what's running (timers, sweeps) and
// reads GitHub again when the shown tab wants it: every few seconds while a
// run, job or check is moving, every minute when all is still, never while
// the window is closed. Reads carry ETags, so unchanged answers are free.
//
// Stale while revalidate: what the window last read of a repo (PRs, their
// views, runs, jobs, workflow needs, and the ETags) is kept in
// data/github/cache.json (cache.ts, store.ts), so an opening shows
// it at once and reads GitHub behind it; the bar says "updating…", then
// "updated 2m ago". A failed read keeps what's shown and says so quietly.
//
// Opened by the nocturne mod's sky (nocturne.github) as an overlay window
// with props { folder, on }; also works as a pane or tab (+ new > GitHub in
// a new tab). `d` on a PR swaps the window for the git window's review of
// that PR (git, which took in diff), whose esc / q brings
// this window back where it was (its state is in shared(STATE)).
// A link opened from the floating window (o, a check, a link in a PR) opens
// in a web pane beside the pane underneath and closes the window.

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex, ScrollHandle } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, nextCommand, shared, setShared, spaces, panes, focused, run, notify, settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Ran, Repo } from "./gh.ts";
import { repoOf, viewRepo } from "./gh.ts";
import { readAgo } from "./model.ts";
import { slug } from "./remotes.ts";
import type { Doc, Entry } from "./cache.ts";
import { lookup, repoKey } from "./cache.ts";
import * as store from "./store.ts";
import type { Axis, Hint, Note } from "./kit.ts";
import { hints, empty, unzoom, unzoomSize, noteOf } from "./kit.ts";
import { bindTab, tabActions } from "./form-keys.ts";
import type { Host, Picker, ReadOptions, ResizeOptions, RunFilter } from "./host.ts";
import Prs from "./prs.ts";
import Actions from "./actions.ts";
import Projects from "./projects.ts";
import type { Confirm, TabId } from "./window-chrome.ts";
import { isTabId, header, helpPanel, pickerPanel, confirmBar } from "./window-chrome.ts";
import { windowKey, pickerKey, runCommand } from "./window-keys.ts";
import { refresh, warm, persist, SAVE_EVERY } from "./window-reads.ts";
import { STATE, WINDOW_KEY, besidePane, keptFor, saveCopy } from "./place.ts";

export const WINDOW = "github.window";

// { folder, on, head, at }: the git window's branch for a new pull request (its branches panel),
// read when github.new-pr arrives or the window opens with create "pr".
export const CREATE = "github.create";

const CREATE_KEY = sharedKey(CREATE, nullable(object({}, { folder: nullable(isString), on: nullable(isString), head: nullable(isString), at: isNumber })));

const CREATE_FRESH = 30000;
const BEAT = 4000;


/** What the window is opened with (nocturne/github.ts, git's way back, + new): the folder and
 *  machine, its overlay, the tab, a form to open (and when it was asked). */
const isGithubProps = object({}, {
  folder: nullable(isString), on: nullable(isString), overlay: isString, slot: isString, tab: isTabId, create: literal("pr", "workflow"), at: isNumber,
});

type GithubProps = Guarded<typeof isGithubProps>;

const NO_PROPS: GithubProps = {};

/** A form asked for: a new pull request, or a workflow to run. */
type FormAsk = "pr" | "workflow";

/** A tab as the window drives it. */
type Tab = Prs | Actions | Projects;

/** A splitter being dragged: which, which way, where it started, how to set the size, the bounds. */
interface Resizing {
  readonly key: string;
  readonly axis: Axis;
  readonly at: number;
  readonly from: number;
  readonly set: (px: number) => void;
  readonly min: number;
  readonly max: number;
  readonly sign: 1 | -1;
}

/** A folder and the machine it's on. */
interface Place {
  readonly folder: string | null;
  readonly on: string | null;
}

/** The shown space's folder and machine (when opened without props). */
function here(): Place {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const ps = panes();
  const pane = ps.find((p) => p.focused && p.tab === tab) ?? ps.find((p) => p.tab === tab && p.terminal !== null && p.cwd);
  const cwd = pane && pane.terminal !== null ? pane.cwd : null;

  // A space attached to a folder (space.folder) uses it over where its panes are.
  return { folder: (space?.attached && space.folder) || cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

export default class GitHub extends View implements Host {
  overlay: string | null = null;
  /** A pane's own id (props.slot, place.ts). */
  slot: string | null = null;
  folder: string | null = null;
  on: string | null = null;
  tab: TabId = "prs";

  /** A form asked for, opened once the repo is known. */
  wantForm: FormAsk | null = null;
  prs: Prs;
  actions: Actions;
  projects: Projects;
  repo: Repo | null = null;
  state: "loading" | "norepo" | "error" | "ready" = "loading";
  error = "";

  /** The last poll failed; data kept. */
  stale = "";
  confirm: Confirm | null = null;
  note: Note | null = null;
  help = false;

  /** L's list of links, a right-click menu. */
  picker: Picker | null = null;

  /** The picker's box follows its cursor. */
  pickerScroll = ScrollHandle.new();
  size: Size = { width: 1000, height: 700 };

  /** While a splitter is dragged. */
  resizing: Resizing | null = null;

  /** When to read GitHub again. */
  next = 0;
  busy = false;
  again = false;
  againOpts: ReadOptions | null = null;

  /** The running read is worth showing ("updating…"). */
  loud = false;

  /** The cache was looked at. */
  checked = false;

  /** The folder's repo was asked for (a cached one's branch may be old until then). */
  located = false;
  dirty = false;
  savedAt = 0;
  saving: Promise<boolean> | null = null;
  closed = false;
  switching = false;
  gen = 0;
  beatAt = 0;
  said = "";

  /** The other tab, once read behind the shown one. */
  warmed: Set<Tab> | null = null;
  handle: FocusHandle | null = null;

  constructor(p?: Props) {
    super(p);
    this.prs = new Prs(this);
    this.actions = new Actions(this);
    this.projects = new Projects(this);
  }

  override init(p: Props | undefined, cx: AsyncContext): void {
    const given = props() ?? p;
    const pr = isGithubProps(given) ? given : NO_PROPS;

    this.overlay = pr.overlay ?? null;
    this.slot = pr.slot ?? null;

    const h: Place = pr.folder ? { folder: pr.folder, on: pr.on ?? null } : here();

    this.folder = h.folder;
    this.on = h.on;

    const kept = keptFor(this);
    const same = kept.folder === this.folder;

    this.tab = pr.tab ?? (same ? kept.tab : null) ?? "prs";

    // Opened to write (nocturne's githubForm): the form, once the repo is known. Only a fresh ask:
    // the same props come back when the window is restored or reloaded, and must not open it again.
    const ask = pr.create !== undefined && Date.now() - (pr.at ?? 0) < CREATE_FRESH;

    this.wantForm = ask ? pr.create ?? null : null;
    this.prs = new Prs(this, same ? kept.prs : {});
    this.actions = new Actions(this, same ? kept.actions : {});
    this.projects = new Projects(this, same ? kept.projects : {});

    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    handle.focus();

    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay) {
      for (const ms of [60, 250, 600]) {
        cx.timer.after(ms, () => {
          const tab = this.shown();

          if (!this.closed && !tab.composer && !tab.form) handle.focus();
        });
      }
    }

    this.beat();

    // Opened before in this run: the cache is in memory, shown in the first frame.
    const doc = store.peek();

    if (doc) this.fromCache(doc);

    this.start(cx);
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^github\./, "");

        if (c === "focus") handle.focus();
        else runCommand(this, c, cx);

        cx.notify();
      }
    });
  }

  // ---- life

  /** Shows what the cache holds for this folder's repo, if anything. */
  fromCache(doc: Doc): boolean {
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

  start(cx: Context): void {
    cx.spawn(async (cx) => {
      if (!this.checked) {
        try {
          this.fromCache(await store.load());
        } catch {
          this.checked = true;
        }

        cx.notify();
      }

      // A cached repo is read at once; where the folder's repo is now is asked meanwhile.
      if (this.repo) this.refresh(cx, { all: true });

      try {
        const now = await repoOf(this.folder, this.on);

        if (this.closed) return;

        const r = this.repo;
        // The folder's fork, shown as its parent last time (p): the parent stays.
        const onParent = now && r?.child === now.full && r.full === now.parent && r.on === now.on;

        if (onParent && r) r.branch = now.branch;
        else if (now && r && repoKey(now) === repoKey(r)) {
          // The same repo: its branch may have moved.
          this.repo = { ...r, ...now };
        } else this.show(now, cx);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);

        // Offline: a cached repo stays shown, the bar says so.
        if (this.repo) this.stale = why;
        else {
          this.state = "error";
          this.error = why;
        }
      }

      this.located = true; // the folder's branch is known now (a cached one may be old)
      this.openForm(cx);
      cx.notify();
    });
  }

  /** Shows another repo (or none), with what the cache holds of it (`cached`): what was shown of the old one goes. */
  show(repo: Repo | null, cx: Context, cached: Entry | null = null): void {
    this.repo = repo;
    this.prs.hydrate(cached?.prs ?? null);
    this.actions.hydrate(cached?.actions ?? null);
    this.projects.hydrate(cached?.projects ?? null);
    this.warmed = null;
    this.gen++;
    this.busy = false; // a read of the old repo is dropped
    this.stale = "";
    this.state = repo ? "ready" : "norepo";

    if (repo) this.refresh(cx, { all: true });
  }

  /** p: a fork's parent, or back to the fork. The choice is kept per folder (in the cache). */
  switchFork(cx: Context): void {
    const r = this.repo;
    const to = r?.parent ? { full: r.parent, host: r.host, child: r.full } : r?.child ? { full: r.child, host: r.host, child: null } : null;

    if (!r || !to || this.switching) return;

    this.switching = true;
    this.note = noteOf(`Opening ${to.full}…`, "working");
    cx.spawn(async (cx) => {
      try {
        const next = await viewRepo(to, { root: r.root, on: r.on, branch: r.branch });

        if (this.closed || this.repo !== r) return;

        if (!next) throw new Error(`${to.full} isn't on GitHub.`);

        next.child = to.child;

        if (to.child) next.parent = null; // from the parent, p goes back to the fork, not up again

        this.note = null;
        // From the cache when this folder showed it before.
        this.show(next, cx, store.peek()?.repos.get(repoKey(next)) ?? null);
        this.dirty = true;
      } catch (err) {
        this.note = noteOf(err instanceof Error ? err.message : String(err), "failed");
      } finally {
        this.switching = false;
        cx.notify();
      }
    });
  }

  /** Tells the toggle (nocturne's sky) this window is still open. */
  beat(): void {
    if (!this.overlay) return;

    this.beatAt = Date.now();
    writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: this.beatAt });
  }

  /** A form asked for (props, a command) once the repo is known: a new pull request (with the git window's branch, if it just asked) or a workflow to run. */
  openForm(cx: Context): void {
    const repo = this.repo;

    if (!this.wantForm || this.state !== "ready" || !repo || !this.located) return;

    const what = this.wantForm;

    this.wantForm = null;
    this.help = false;
    this.picker = null;

    if (what === "pr") {
      const req = readShared(shared, CREATE_KEY, null);
      const folder = req?.folder;
      const mine = req && Date.now() - (req.at ?? 0) < CREATE_FRESH && (!folder || !repo.root || folder.startsWith(repo.root) || repo.root.startsWith(folder));

      if (req) writeShared(setShared, CREATE_KEY, null);

      this.tab = "prs";
      this.prs.newPr(cx, { head: mine ? req.head ?? null : null });
    } else {
      this.tab = "actions";
      this.actions.runWorkflow(cx);
    }

    cx.notify();
  }

  tick(cx: Context): void {
    if (this.closed) return;

    if (this.wantForm) this.openForm(cx);

    if (Date.now() - this.beatAt >= BEAT) this.beat();

    let redraw = false;

    if (this.note && Date.now() - this.note.at > 5000) {
      this.note = null;
      redraw = true;
    }

    if (this.state === "ready" && Date.now() >= this.next) this.refresh(cx);

    if (this.dirty && !this.saving && Date.now() - this.savedAt >= SAVE_EVERY) void this.persist();

    // "updated 2m ago" changes once a minute.
    const said = this.readWord();

    if (said !== this.said) {
      this.said = said;
      redraw = true;
    }

    // Running things' timers tick once a second; a still window isn't redrawn.
    if (redraw || (this.state === "ready" && this.shown().interval() < 10000)) cx.notify();
  }

  shown(): Tab {
    return this.tab === "prs" ? this.prs : this.tab === "projects" ? this.projects : this.actions;
  }

  /** Reads the shown tab now. force (true, or { all, fresh }): all reads past the
   *  timers, fresh past the ETags too (r, after an action). */
  refresh(cx: Context, force: boolean | ReadOptions = false): void {
    refresh(this, cx, force);
  }

  warm(cx: Context): void {
    warm(this, cx);
  }

  persist(): Promise<boolean> | null {
    return persist(this);
  }

  /** The bar's word for the shown data's age: "updated 2m ago". */
  readWord(): string {
    const at = this.state === "ready" ? this.shown().readAt() : 0;

    return at ? `updated ${readAgo(at)}` : "";
  }

  /** Soon: a selection changed, its details want reading. */
  kick(cx: Context): void {
    this.next = Math.min(this.next, Date.now() + 150);
    cx.timer.after(160, (cx) => {
      if (!this.closed && Date.now() >= this.next) this.refresh(cx);
    });
  }

  /** Background work for a tab (with the cx of whatever asked for it). */
  spawn(cx: Context, fn: () => Promise<void>): void {
    cx.spawn(async (cx) => {
      try {
        await fn();
      } catch {
        /* shown by the caller */
      }

      if (!this.closed) cx.notify();
    });
  }

  save(): void {
    const kept = { folder: this.folder, tab: this.tab, prs: this.prs.save(), actions: this.actions.save(), projects: this.projects.save() };

    writeShared(setShared, STATE, kept);
    saveCopy(this, kept);
  }

  focusSelf(): void {
    this.handle?.focus();
  }

  override async close(): Promise<void> {
    this.closed = true;
    this.save();

    if (this.dirty) void this.persist();

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);

    // The last read goes to the cache (the app gives cleanup a quarter second).
    await this.saving;
  }

  /** Opens a link like any mod's (a web pane beside the focused pane, or the
   *  system's browser per `links`). From the floating window, a link that opens
   *  in a web pane closes the window, so the page isn't hidden under it; the
   *  pane goes beside the one the window floated over. */
  openUrl(url: string, cx: Context): void {
    if (!url) return;

    const inApp = settings().links !== "system" && appWindow().platform === "macos" && /^https?:/i.test(url);

    if (!this.overlay || !inApp) {
      cx.open_url(url);

      return;
    }

    run("app.open_url", { url, in: "app" });
    this.closeWindow();
  }

  closeWindow(): void {
    if (this.overlay) closeOverlay(this.overlay);
  }

  // ---- between the tabs and the outside

  setTab(tab: TabId, cx: Context): void {
    if (this.tab === tab) return;

    this.tab = tab;
    this.help = false;
    this.next = 0;
    this.refresh(cx, false);
  }

  showRun(runId: number, jobId: number | null, cx: Context): void {
    this.tab = "actions";
    this.actions.show(runId, jobId, cx);
  }

  showRuns(filter: RunFilter, cx: Context): void {
    this.tab = "actions";
    this.actions.showRuns(filter, cx);
  }

  /** The PR's diff in the git window's review: in this window's place (esc / q come back), or beside it as a pane. */
  openDiff(number: number): void {
    const repo = this.repo;

    if (!repo) return;

    const diff = { folder: repo.root, on: this.on, pr: number, repo: slug(repo) };

    this.save();

    if (this.overlay) {
      const back = { mod: "github", props: { folder: this.folder, on: this.on, tab: "prs" } };
      const id = openOverlay({ mod: "git", kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: { ...diff, back } });

      writeShared(setShared, WINDOW_KEY, { id, beat: Date.now() }); // the review holds the window now (and renews this)
    } else {
      const pane = besidePane(this);

      run("pane.split", pane ? { direction: "auto", pane, mod: "git", props: diff } : { direction: "auto", mod: "git", props: diff });
    }
  }

  /** Starts dragging a splitter: the panel was `from` px; `set(px)` takes its
   *  new size within min..max (sign -1: the panel grows as the pointer moves back). */
  resize(e: MouseButtonEvent, key: string, axis: Axis, from: number, set: (px: number) => void, { min = 120, max = 4000, sign = 1 }: ResizeOptions = {}): void {
    this.resizing = { key, axis, at: axis === "x" ? e.position.x : e.position.y, from, set, min, max: Math.max(min, max), sign };
  }

  dragged(key: string): boolean {
    return this.resizing?.key === key;
  }

  ask(text: string, go: () => void): void {
    this.confirm = { text, go };
  }

  /** Runs a gh action; says how it went, then reads again soon. */
  act(promise: Promise<Ran>, ok: string, cx: Context, after?: () => void): void {
    this.note = noteOf("…", "working");
    cx.spawn(async (cx) => {
      let r: Ran;

      try {
        r = await promise;
      } catch (err) {
        r = { ok: false, out: "", err: err instanceof Error ? err.message : String(err) };
      }

      if (r.ok) after?.();

      this.note = r.ok ? (ok ? noteOf(ok, "done") : null) : noteOf(r.err, "failed");

      if (!r.ok && !this.overlay) notify({ title: "GitHub", body: r.err, level: "error" });

      this.refresh(cx, true);
      cx.notify();
    });
  }

  // ---- keys (window-keys.ts)

  key(e: KeyEvent, cx: Context): void {
    windowKey(this, e, cx);
  }

  pickerKey(k: string, cx: Context): void {
    pickerKey(this, k, cx);
  }

  // ---- drawing (window-chrome.ts)

  helpPanel(t: Theme): Element {
    return helpPanel(this, t);
  }

  pickerPanel(t: Theme): Element {
    return pickerPanel(this, t);
  }

  /** The key bar's entries now. */
  barHints(): Hint[] {
    const form = this.shown().form;

    if (form && !this.picker && !this.help) return form.hints();

    if (this.picker) return [["j/k", "move"], ["enter", "open"], ["esc", "close"]];

    if (this.help) return [["esc", "close keys"], ["?", "keys"]];

    return this.state === "ready" ? this.shown().hints() : [[this.overlay ? "esc" : "q", "close"], ["?", "keys"]];
  }

  override render(): Element {
    const t = theme();
    let body: Element;

    // Before the cache was looked at (a few ms): nothing, rather than a flash of "Finding…".
    if (this.state === "loading" && !this.checked) body = div().size_full();
    else if (this.state === "loading") body = empty(t, "Finding the repo on GitHub…", this.folder ?? "", { moon: 3 });
    else if (this.state === "norepo") body = empty(t, "No GitHub repo here", `${this.folder ?? "This space has no folder"}: the window shows the GitHub repo of the shown space's folder.`, { moon: 0 });
    else if (this.state === "error") body = empty(t, "gh didn't answer", this.error, { moon: 1 });
    else body = this.shown().render(t, { width: this.size.width - 16, height: this.size.height - 70 });

    const note = this.note;

    const endResize = (cx: Context) => {
      if (this.resizing) {
        this.resizing = null;
        this.save();
        cx.notify();
      }
    };

    const right = note ? div().text_color(note.tone === "failed" ? t.blocked : note.tone === "done" ? t.done : t.working).truncate().max_w(420).child(note.text)
      : this.stale ? div().text_color(t.ansi8).truncate().max_w(420).child(this.stale) : null;

    const handle = this.handle, resizing = this.resizing, picker = this.picker, confirm = this.confirm;
    // A window draws its frame; a pane has the pane's (place.ts).
    const root = v_flex().id("github").size_full().bg(t.background);
    const view = this.overlay ? root.border(1).border_color(t.ansi8) : root;
    // A form open: ctrl-tab moves through it from any stop, not the app's tabs.
    const formOpen = !!this.shown().form;

    return (handle ? view.track_focus(handle) : view)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx), formOpen))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = size;
          cx.notify();
        }
      })
      .when(resizing !== null, (el) => el.when(resizing?.axis === "x", (e2) => e2.cursor_col_resize()).when(resizing?.axis === "y", (e2) => e2.cursor_row_resize()))
      .on_mouse_move((e, cx) => {
        const r = this.resizing;

        if (!r) return;

        const moved = unzoom((r.axis === "x" ? e.position.x : e.position.y) - r.at) * r.sign;

        r.set(Math.round(Math.min(r.max, Math.max(r.min, r.from + moved))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => {
        if (!h) endResize(cx);
      })
      .child(header(this, t))
      .child(div().id("gh-body").relative().flex_1().min_h(0).p(8)
        .on_mouse_down("left", (_e, cx) => {
          this.focusSelf();
          cx.stop_propagation();
        })
        .child(body)
        .when(this.help, (el) => el.child(this.helpPanel(t)))
        .when(picker !== null, (el) => el.child(this.pickerPanel(t))))
      .when(confirm !== null, (el) => (confirm ? el.child(confirmBar(this, t, confirm)) : el))
      .child(hints(t, this.barHints(), right, {
        on: this.help, toggle: () => {
          this.help = !this.help;
        },
      }));
  }
}
