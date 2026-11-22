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
// the window is closed. Something GitHub took and doesn't show yet (a
// dispatched run: dispatchForm.ts; a re-run or cancel: run-actions.ts) is
// read again with a backoff (model.ts soon) within a bound. Reads carry
// ETags, so unchanged answers are free.
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
import { Effect, Fiber, Option, Schema, String as Str } from "effect";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent, Size } from "gpui-kit";
import type { Pt, Rect } from "@fireflies/menu-place";
import type { Props } from "gpui-shell";
import { v_flex, ScrollHandle } from "gpui-base";
import { appHome, theme, props, closeOverlay, openOverlay, shared, setShared, spaces, panes, focused, run, settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { hereOf, readShared, sharedKey, writeShared } from "@fireflies/kit";
import type { RunOptions } from "@fireflies/kit";
import type { Repo } from "./gh.ts";
import type { GhError } from "./gh.ts";
import { nowMs, runtime } from "./fx.ts";
import type { GithubFx, GithubServices } from "./fx.ts";
import { acted, commands, kicked, start, switchFork, takeFocus, ticks } from "./window-life.ts";
import type { Fork } from "./window-life.ts";
import { cachePath } from "./store.ts";
import { readAgo } from "./model.ts";
import { slug } from "./remotes.ts";
import { type Doc, type Entry, lookup } from "./cache.ts";
import * as store from "./store.ts";
import { type Axis, type Hint, type Note, hints, empty, unzoom, unzoomSize, noteOf } from "./kit.ts";
import { bindTab, tabActions } from "@fireflies/form-keys";
import type { Host, Picker, ReadOptions, ResizeOptions, RunFilter } from "./host.ts";
import Prs from "./prs.ts";
import Actions from "./actions.ts";
import Projects from "./projects.ts";
import type { Confirm, TabId } from "./window-chrome.ts";
import { TabIdSchema, header, helpPanel, pickerPanel, confirmBar } from "./window-chrome.ts";
import { windowKey, pickerKey } from "./window-keys.ts";
import { refresh, warm, persist, SAVE_EVERY } from "./window-reads.ts";
import { STATE, WINDOW_KEY, besidePane, keptFor, saveCopy } from "./place.ts";

export const WINDOW = "github.window";

// { folder, on, head, at }: the git window's branch for a new pull request (its branches panel),
// read when github.new-pr arrives or the window opens with create "pr".
export const CREATE = "github.create";

const maybeText = Schema.optionalKey(Schema.NullOr(Schema.String));

const CREATE_KEY = sharedKey(CREATE, Schema.NullOr(Schema.Struct({ folder: maybeText, on: maybeText, head: maybeText, at: Schema.optionalKey(Schema.Finite) })));

const CREATE_FRESH = 30000;
const BEAT = 4000;


/** What the window is opened with (nocturne/github.ts, git's way back, + new): the folder and
 *  machine, its overlay, the tab, a form to open (and when it was asked). */
const GithubPropsSchema = Schema.Struct({
  folder: maybeText, on: maybeText, overlay: Schema.optionalKey(Schema.String), slot: Schema.optionalKey(Schema.String), tab: Schema.optionalKey(TabIdSchema),
  create: Schema.optionalKey(Schema.Literals(["pr", "workflow"])), at: Schema.optionalKey(Schema.Finite),
});

const isGithubProps = Schema.is(GithubPropsSchema);

type GithubProps = typeof GithubPropsSchema.Type;

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

/** The shown space's folder and machine (when opened without props): the kit's one rule (hereOf). */
function here(): Place {
  const h = hereOf({ spaces: spaces(), panes: panes(), focused: focused() });

  return { folder: Option.getOrNull(h.folder), on: h.on };
}

/** A tab with a comment being written (the Pull requests tab's composer). */
const composing = (tab: Tab): boolean => tab.composer !== null && tab.composer !== false;

/** p's way from `r`: to the parent of a fork, or back to the fork from its parent; null when neither. */
function forkOf(r: Repo | null): Fork | null {
  if (r === null) return null;

  if (r.parent !== null && r.parent !== "") return { full: r.parent, host: r.host, child: r.full };

  return r.child !== null && r.child !== "" ? { full: r.child, host: r.host, child: null } : null;
}

/** The note's color: failed, done, or at work. */
function noteColor(t: Theme, note: Note): Color {
  switch (note.tone) {
    case "failed": return t.blocked;
    case "done": return t.done;
    default: return t.working;
  }
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
  /** Where the body is drawn (window px, its on_bounds_change): a press is placed in it. */
  bodyBox: Rect | null = null;

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
  /** The cache write on its way (window-reads.ts persist), on the mod's runtime. */
  saving: Fiber.Fiber<void> | null = null;
  closed = false;
  switching = false;
  gen = 0;
  beatAt = 0;
  said = "";

  /** The other tab, once read behind the shown one. */
  warmed: Set<Tab> | null = null;
  handle: FocusHandle | null = null;

  /** The copy's handle on the runtime (fx.ts) and its own cx, from init: what its effects run with. */
  fx: GithubFx | null = null;
  acx: AsyncContext | null = null;

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

    const h: Place = pr.folder === null || pr.folder === undefined || pr.folder === "" ? here() : { folder: pr.folder, on: pr.on ?? null };

    this.folder = h.folder;
    this.on = h.on;

    const kept = keptFor(this);
    const same = kept.folder === this.folder;

    this.tab = pr.tab ?? (same ? kept.tab : null) ?? "prs";

    // Opened to write (nocturne's githubForm): the form, once the repo is known. Only a fresh ask:
    // the same props come back when the window is restored or reloaded, and must not open it again.
    const ask = pr.create !== undefined && this.now() - (pr.at ?? 0) < CREATE_FRESH;

    this.wantForm = ask ? pr.create ?? null : null;
    this.prs = new Prs(this, same ? kept.prs : {});
    this.actions = new Actions(this, same ? kept.actions : {});
    this.projects = new Projects(this, same ? kept.projects : {});

    this.acx = cx;
    this.fx = runtime.attach(cx, (said) => {
      this.note = noteOf(said, "failed", this.now());
    });
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    handle.focus();

    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay !== null) {
      this.fx.run(takeFocus(() => {
        const tab = this.shown();

        if (!this.closed && !composing(tab) && tab.form === null) handle.focus();
      }), { redraw: false });
    }

    this.beat();

    // Opened before in this run: the cache is in memory, shown in the first frame.
    const doc = store.peek();

    if (doc !== null) this.fromCache(doc);

    this.start(cx);
    this.fx.run(ticks(this, cx), { key: "tick", redraw: false });
    this.fx.run(commands(this, cx, () => handle.focus()), { key: "commands" });
  }

  // ---- life

  /** Shows what the cache holds for this folder's repo, if anything. */
  fromCache(doc: Doc): boolean {
    this.checked = true;

    const e = this.folder === null || this.folder === "" ? null : lookup(doc, this.folder, this.on);

    if ((e?.repo?.full ?? "") === "" || this.repo !== null || e?.repo === undefined || e.repo === null) return false;

    this.repo = { ...e.repo };
    this.prs.hydrate(e.prs);
    this.actions.hydrate(e.actions);
    this.projects.hydrate(e.projects);
    this.state = "ready";

    return true;
  }

  /** The opening (window-life.ts), on the copy's runtime. */
  start(cx: Context): void {
    this.fx?.run(start(this, this.acx ?? cx, cachePath(appHome())), { key: "start" });
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
    this.state = repo === null ? "norepo" : "ready";

    if (repo !== null) this.refresh(cx, { all: true });
  }

  /** p: a fork's parent, or back to the fork. The choice is kept per folder (in the cache). */
  switchFork(cx: Context): void {
    const r = this.repo;
    const to = forkOf(r);

    if (r === null || to === null || this.switching) return;

    this.switching = true;
    this.note = noteOf(`Opening ${to.full}…`, "working", this.now());
    this.fx?.run(switchFork(this, this.acx ?? cx, r, to), { key: "fork" });
  }

  /** Tells the toggle (nocturne's sky) this window is still open. */
  beat(): void {
    if (this.overlay === null) return;

    this.beatAt = this.now();
    writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: this.beatAt });
  }

  /** A form asked for (props, a command) once the repo is known: a new pull request (with the git window's branch, if it just asked) or a workflow to run. */
  openForm(cx: Context): void {
    const repo = this.repo;

    if (this.wantForm === null || this.state !== "ready" || repo === null || !this.located) return;

    const what = this.wantForm;

    this.wantForm = null;
    this.help = false;
    this.picker = null;

    if (what === "pr") {
      const req = readShared(shared, CREATE_KEY, null);
      const folder = req?.folder;
      const mine = req !== null && this.now() - (req.at ?? 0) < CREATE_FRESH && (folder === null || folder === undefined || folder === "" || repo.root === "" || Str.startsWith(repo.root)(folder) || Str.startsWith(folder)(repo.root));

      if (req !== null) writeShared(setShared, CREATE_KEY, null);

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

    if (this.wantForm !== null) this.openForm(cx);

    if (this.now() - this.beatAt >= BEAT) this.beat();
    this.save(false);

    let redraw = false;

    if (this.note !== null && this.now() - this.note.at > 5000) {
      this.note = null;
      redraw = true;
    }

    if (this.state === "ready" && this.now() >= this.next) this.refresh(cx);

    if (this.dirty && this.saving === null && this.now() - this.savedAt >= SAVE_EVERY) this.persist();

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
    switch (this.tab) {
      case "prs": return this.prs;
      case "projects": return this.projects;
      default: return this.actions;
    }
  }

  /** Reads the shown tab now. force (true, or { all, fresh }): all reads past the
   *  timers, fresh past the ETags too (r, after an action). */
  refresh(cx: Context, force: boolean | ReadOptions = false): void {
    refresh(this, cx, force);
  }

  warm(cx: Context): void {
    warm(this, cx);
  }

  persist(): void {
    persist(this);
  }


  /** The bar's word for the shown data's age: "updated 2m ago". */
  readWord(): string {
    const at = this.state === "ready" ? this.shown().readAt() : 0;

    return at === 0 ? "" : `updated ${readAgo(at, this.now())}`;
  }

  /** Soon: a selection changed, its details want reading (window-life.ts kicked). */
  kick(cx: Context): void {
    this.next = Math.min(this.next, this.now() + 150);
    this.fx?.run(kicked(this, this.acx ?? cx), { key: "kick", redraw: false });
  }


  save(all = true): void {
    const kept = { folder: this.folder, tab: this.tab, prs: this.prs.save(), actions: this.actions.save(), projects: this.projects.save() };

    if (all) writeShared(setShared, STATE, kept);
    saveCopy(this, kept, all); // all false: the tick's, written where it changed (place.ts)
  }

  focusSelf(): void {
    this.handle?.focus();
  }

  now(): number {
    return nowMs();
  }

  run<A, E>(effect: Effect.Effect<A, E, GithubServices>, options?: RunOptions): void {
    this.fx?.run(effect, options);
  }

  override close(): Promise<void> | undefined {
    this.closed = true;
    this.save();

    if (this.dirty) this.persist();

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay !== null && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);

    // What still runs of this copy ends; the last cache write (on the mod's runtime, window-reads.ts persist) is
    // waited for, within the quarter second the app gives cleanup.
    const closing = this.fx?.close(), saving = this.saving;

    return saving === null ? closing : runtime.runtime.runPromise(Effect.asVoid(Fiber.await(saving)));
  }

  /** Opens a link like any mod's (a web pane beside the focused pane, or the
   *  system's browser per `links`). From the floating window, a link that opens
   *  in a web pane closes the window, so the page isn't hidden under it; the
   *  pane goes beside the one the window floated over. */
  openUrl(url: string, cx: Context): void {
    if (url === "") return;

    const inApp = settings().links !== "system" && appWindow().platform === "macos" && /^https?:/i.test(url);

    if (this.overlay === null || !inApp) {
      cx.open_url(url);

      return;
    }

    run("app.open_url", { url, in: "app" });
    this.closeWindow();
  }

  closeWindow(): void {
    if (this.overlay !== null) closeOverlay(this.overlay);
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

    if (repo === null) return;

    const diff = { folder: repo.root, on: this.on, pr: number, repo: slug(repo) };

    this.save();

    if (this.overlay !== null) {
      const back = { mod: "github", props: { folder: this.folder, on: this.on, tab: "prs" } };
      const id = openOverlay({ mod: "git", kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: { ...diff, back } });

      writeShared(setShared, WINDOW_KEY, { id, beat: this.now() }); // the review holds the window now (and renews this)
    } else {
      const pane = besidePane(this);

      run("pane.split", pane !== null ? { direction: "auto", pane, mod: "git", props: diff } : { direction: "auto", mod: "git", props: diff });
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

  /** A yes / no in the bar; `go` runs on yes with that key's or click's cx. */
  ask(text: string, go: (cx: Context) => void): void {
    this.confirm = { text, go };
  }

  /** Runs a gh action (window-life.ts acted); says how it went, then reads again soon. */
  act(effect: Effect.Effect<unknown, GhError, GithubServices>, ok: string, cx: Context, after?: () => void): void {
    this.note = noteOf("…", "working", this.now());
    this.run(acted(this, effect, ok, this.acx ?? cx, after));
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

  pressAt(e: { readonly position: Pt }): Pt | null {
    const b = this.bodyBox;

    return b === null ? null : { x: unzoom(e.position.x - b.x), y: unzoom(e.position.y - b.y) };
  }

  pickerPanel(t: Theme): Element {
    return pickerPanel(this, t);
  }

  /** The key bar's entries now. */
  barHints(): Hint[] {
    const form = this.shown().form;

    if (form !== null && this.picker === null && !this.help) return form.hints();

    if (this.picker !== null) return [["j/k", "move"], ["enter", "open"], ["esc", "close"]];

    if (this.help) return [["esc", "close keys"], ["?", "keys"]];

    return this.state === "ready" ? this.shown().hints() : [[this.overlay === null ? "q" : "esc", "close"], ["?", "keys"]];
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
      if (this.resizing !== null) {
        this.resizing = null;
        this.save();
        cx.notify();
      }
    };

    const right = note !== null ? div().text_color(noteColor(t, note)).truncate().max_w(420).child(note.text)
      : this.stale !== "" ? div().text_color(t.muted).truncate().max_w(420).child(this.stale) : null;

    const handle = this.handle, resizing = this.resizing, picker = this.picker, confirm = this.confirm;
    // A window draws its frame; a pane has the pane's (place.ts).
    const root = v_flex().id("github").size_full().bg(t.background);
    const view = this.overlay === null ? root : root.border(1).border_color(t.muted);
    // A form open: ctrl-tab moves through it from any stop, not the app's tabs.
    const formOpen = this.shown().form !== null;

    return (handle === null ? view : view.track_focus(handle))
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

        if (r === null) return;

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
        .on_bounds_change((b) => {
          this.bodyBox = { x: b.x, y: b.y, w: b.width, h: b.height };
        })
        .on_mouse_down("left", (_e, cx) => {
          this.focusSelf();
          cx.stop_propagation();
        })
        .child(body)
        .when(this.help, (el) => el.child(this.helpPanel(t)))
        .when(picker !== null, (el) => el.child(this.pickerPanel(t))))
      .when(confirm !== null, (el) => (confirm !== null ? el.child(confirmBar(this, t, confirm)) : el))
      .child(hints(t, this.barHints(), right, {
        on: this.help, toggle: () => {
          this.help = !this.help;
        },
      }));
  }
}
