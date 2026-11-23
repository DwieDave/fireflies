// The Worktrees tab's work on the git window: going to a worktree, making one,
// removing the picked ones after one confirm, picking the merged ones, and what
// a window opened for a worktree asked for (worktrees.ts does the git).

import { Array as Arr, Effect, Number as Num, Option, String as Str } from "effect";
import { spaces, run, closeOverlay } from "herdr";
import type { Check, Line } from "./popups.ts";
import * as WT from "./worktrees.ts";
import type { Checkout, Loss, Occupants } from "./worktrees.ts";
import type { SpaceOptions, NewWorktree } from "./state.ts";
import { pathOf, isCheckout } from "./items.ts";
import type { default as GitView } from "./main.ts";
import { loadAll } from "./reads.ts";
import { switchRepo } from "./elsewhere.ts";

/** "1 space", "2 spaces". */
const count = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;

/** A text that's there and not empty. */
const given = (s: string | null | undefined): s is string => s !== null && s !== undefined && Str.isNonEmpty(s);

/** After a worktree was made or picked from outside (a space's menu, the
 *  palette, the sidebar's w): what it asked for, once the repo is read. */
export function worktreeIntent(v: GitView): void {
  const want = v.wtIntent;

  v.wtIntent = null;

  if (want === null) return;

  v.setPanel("files");
  v.setTab("worktrees");

  const s = given(want.space) ? Arr.findFirst(spaces(), (x) => x.id === want.space) : Option.none();
  const at = Option.match(s, { onNone: () => WT.owner(v.data.worktrees, v.folder), onSome: (sp) => WT.owner(v.data.worktrees, WT.spaceFolder(sp)) });

  if (at !== null) Option.map(Arr.findFirstIndex(v.items("worktrees"), (w) => pathOf(w) === at.path), (i) => v.moveTo(i));

  if (want.action === "new" || given(want.branch)) newWorktree(v, { value: want.branch ?? "", now: given(want.branch), tab: want.tab, argv: want.argv });
  else if (want.action === "remove") {
    if (at === null) v.error("That space isn't on a worktree of this repo.");
    else if (at.main) v.error("This is the repository's main checkout, not a worktree.");
    else removeWorktrees(v, [at]);
  }
}

/** Goes to a worktree: the space showing it, else a new space there
 *  (unnamed, so it follows the checkout and nests under its repo); the
 *  window steps aside, as after lazygit's worktree switch. */
export function goToWorktree(v: GitView, w: { readonly path: string; readonly prunable?: boolean }, options: SpaceOptions = {}): void {
  const { tab, argv } = options;

  if (w.prunable === true) return v.error("Its folder is gone: X prunes it.");

  const s = v.occupancy().get(w.path)?.spaces[0];

  if (s !== undefined && !given(tab) && argv === undefined) run("space.select", { id: s.id });
  else {
    const args = { folder: w.path, machine: v.on ?? "" };
    const named = given(tab) ? { ...args, tab } : args;

    run("space.new", argv === undefined ? named : { ...named, argv });
  }

  if (v.overlay !== null && v.show === null) {
    v.saveState();
    closeOverlay(v.overlay);
  }
}

/** n: a branch for a new worktree (an existing one is checked out, a new
 *  one starts from `base`, HEAD by default), checked out under
 *  <worktrees.directory>/<repo>/ (default ~/.herdr/worktrees) and opened as a space. `now`: no prompt. */
export function newWorktree(v: GitView, options: NewWorktree = {}): void {
  const { value = "", base = null, label = null, track = false, now = false, tab, argv } = options;
  const g = v.git;

  if (g === null) return;

  const from = label ?? v.data.status?.head ?? "HEAD";

  const go = (branch: string): void => {
    const name = Str.trim(branch);

    if (Str.isEmpty(name)) return;

    v.spawn(Effect.gen(function* () {
      v.busyText = `Checking out ${name}…`;

      const made = yield* WT.create(g, name, { base }).pipe(Effect.ensuring(Effect.sync(() => { v.busyText = null; })));

      if ("error" in made) {
        v.error(made.error);
        yield* loadAll(v);

        return;
      }

      if (track && made.created && base !== null) {
        const up = yield* g.run("Set upstream", ["-C", made.path, "branch", "--set-upstream-to", base]);

        // The worktree is made either way; an upstream git refused is said, not hidden.
        if (!up.ok) v.note(`No upstream: ${up.err}`, "failed");
      }

      yield* loadAll(v);

      const w = Option.getOrElse(Arr.findFirst(v.data.worktrees, (x) => x.path === made.path), () => ({ path: made.path, branch: name }));

      v.note(`${name} checked out in ${v.tilde(made.path)}`);
      goToWorktree(v, w, { tab, argv });
    }));
  };

  if (now) return go(value);

  const out = new Set(Arr.flatMap(v.data.worktrees, (w) => (w.branch === null ? [] : [w.branch])));
  const local = Arr.filter(v.data.branches, (b) => !out.has(b.name));
  const root = v.wtRoot ?? (v.userHome === null ? "~/.herdr/worktrees" : WT.ROOT(v.userHome));

  v.prompt({
    title: "New worktree: branch", value,
    placeholder: "a branch: an existing one, or a new name",
    note: `An existing branch is checked out; a new one starts from ${from}. It goes to ${v.tilde(root)}/${g.name}/ and opens as a space.`,
    suggest: (q) => {
      const f = Str.toLowerCase(Str.trim(q));

      return Arr.flatMap(local, (b) => (Str.isEmpty(f) || Str.includes(f)(Str.toLowerCase(b.name)) ? [{ value: b.name, sub: b.subject }] : []));
    },
    ok: go,
  });
}

/** What d removes: the picked worktrees (M / U / A), else the range, else
 *  the selected one; never the main checkout. */
function toRemove(v: GitView, list: readonly Checkout[] | null): readonly Checkout[] {
  if (list !== null) return list;

  if (v.wtPicked.size > 0) return Arr.filter(v.data.worktrees, (w) => v.wtPicked.has(w.path));

  if (v.range?.ctx === "worktrees") {
    const at = v.sel.worktrees ?? 0, a = Math.min(v.range.anchor, at), b = Math.max(v.range.anchor, at);

    return Arr.take(Arr.drop(Arr.filter(v.items("worktrees"), isCheckout), a), b - a + 1);
  }

  const x = v.item("worktrees");

  return isCheckout(x) ? [x] : [];
}

/** The confirm's lines: what goes (folders, uncommitted work, unpushed submodule commits, spaces, agents). */
function lossLines(v: GitView, picked: readonly Checkout[], info: readonly Loss[], occ: ReadonlyMap<string, Occupants>): Line[] {
  const one = picked.length === 1;
  const dirty = Arr.filter(info, (x) => x.dirty > 0), lost = Arr.flatMap(info, (x) => x.unpushed);
  const spaceN = Num.sumAll(Arr.map(picked, (w) => occ.get(w.path)?.spaces.length ?? 0));
  const agentN = Num.sumAll(Arr.map(picked, (w) => occ.get(w.path)?.agents.length ?? 0));
  const ends = Arr.join([...(spaceN > 0 ? [`closes ${count(spaceN, "space")}`] : []), ...(agentN > 0 ? [`ends ${count(agentN, "agent")}`] : [])], ", ");

  return [
    ...(one ? Arr.map(picked, (w): Line => [`Deletes ${v.tilde(w.path)}. The branch stays unless b.`, "muted"]) : Arr.map(Arr.take(picked, 6), (w): Line => [`${WT.label(w)}  ${v.tilde(w.path)}`, "muted"])),
    ...(picked.length > 6 ? [[`and ${picked.length - 6} more`, "dim"] as const] : []),
    ...(Arr.isReadonlyArrayNonEmpty(dirty) ? [[one ? `${count(dirty[0].dirty, "uncommitted file")}: lost` : `${count(dirty.length, "has", "have")} uncommitted changes: lost`, "ansi1"] as const] : []),
    ...(Arr.isReadonlyArrayNonEmpty(lost) ? [[`Submodule ${Arr.join(lost, ", ")} has commits pushed nowhere: lost`, "ansi1"] as const] : []),
    ...(Str.isNonEmpty(ends) ? [[ends, agentN > 0 ? "ansi1" : "ansi3"] as const] : []),
  ];
}

/** d: removes the picked worktrees, else the range, else the selected one,
 *  after one confirm that says what goes with them. */
export function removeWorktrees(v: GitView, list: readonly Checkout[] | null = null): void {
  const items = toRemove(v, list);
  const picked = Arr.filter(items, (w) => !w.main);

  if (Arr.isReadonlyArrayNonEmpty(items) && !Arr.isReadonlyArrayNonEmpty(picked)) return v.error("This is the repository's main checkout: it can't be removed (a worktree can).");

  if (!Arr.isReadonlyArrayNonEmpty(picked)) return;

  const first = picked[0], one = picked.length === 1;

  v.note(`Checking ${one ? WT.label(first) : `${picked.length} worktrees`}…`);
  v.read(Effect.gen(function* () {
    const none: Loss = { dirty: 0, subs: 0, unpushed: [] };
    const info = yield* Effect.forEach(picked, (w) => (w.prunable ? Effect.succeed(none) : WT.inspect(w, v.on)), { concurrency: "unbounded" });
    const occ = v.occupancy();
    const checks: Check[] = [{ key: "b", label: one ? "also delete its branch" : "also delete their branches", on: false }];

    if (Arr.some(info, (x) => x.subs > 0)) checks.push({ key: "s", label: "take the submodules out first (else forced)", on: true });

    v.ask({
      title: one ? `Remove worktree ${WT.label(first)}` : `Remove ${picked.length} worktrees`,
      text: one ? `Remove the worktree ${WT.label(first)}?` : `Remove these ${picked.length} worktrees?`,
      danger: true, lines: lossLines(v, picked, info, occ), checks,
      go: (_cx, answers) => {
        const answer = (key: string, fallback: boolean) => Option.getOrElse(Option.map(Arr.findFirst(answers, (c) => c.key === key), (c) => c.on), () => fallback);

        v.spawn(removeAll(v, picked, info, occ, { branch: answer("b", false), clearSubs: answer("s", true) }));
      },
    });
  }));
}

/** Removes each picked worktree in turn (its spaces closed), prunes the gone
 *  ones, says which weren't removed, and reads again (the main checkout, when
 *  the window was on one of them). */
function removeAll(v: GitView, picked: Arr.NonEmptyReadonlyArray<Checkout>, info: readonly Loss[], occ: ReadonlyMap<string, Occupants>, opts: { readonly branch: boolean; readonly clearSubs: boolean }) {
  const none: Loss = { dirty: 0, subs: 0, unpushed: [] };

  return Effect.gen(function* () {
    const g = v.git;

    if (g === null) return;

    const failed: string[] = [];
    const leaving = Arr.some(picked, (w) => w.path === g.root);

    for (const [k, w] of picked.entries()) {
      if (w.prunable) continue;

      const say = (text: string) => { v.busyText = `${picked.length > 1 ? `${k + 1} of ${picked.length}, ` : ""}${WT.label(w)}: ${text}`; };

      const error = yield* WT.removeOne(g, w, { ...(info[k] ?? none), ...opts, spaces: occ.get(w.path)?.spaces ?? [] },
        { closeSpace: (s) => run("space.close", { id: s.id, confirmed: true }), step: say });

      if (Str.isNonEmpty(error)) failed.push(`${WT.label(w)}: ${error}`);
      else v.wtPicked.delete(w.path);
    }

    if (Arr.some(picked, (w) => w.prunable)) {
      const pruned = yield* g.run("Prune worktrees", ["worktree", "prune"]);

      if (!pruned.ok) failed.push(`git worktree prune: ${pruned.err}`);
    }

    v.busyText = null;

    if (Arr.isReadonlyArrayNonEmpty(failed)) v.error(`Removed ${picked.length - failed.length} of ${picked.length}. Not removed:\n${Arr.join(failed, "\n")}`);
    else v.note(picked.length === 1 ? `Removed ${WT.label(picked[0])}` : `Removed ${picked.length} worktrees`);

    // The window was on one of them: it goes to the main checkout.
    const main = Arr.findFirst(v.data.worktrees, (w) => w.main);

    if (leaving && !Arr.isReadonlyArrayNonEmpty(failed) && Option.isSome(main)) return switchRepo(v, main.value.path);

    yield* loadAll(v);
  }).pipe(Effect.ensuring(Effect.sync(() => { v.busyText = null; })));
}

/** M: picks the worktrees whose branch is merged into the main checkout's. */
export function pickMergedWorktrees(v: GitView): void {
  const base = Option.getOrNull(Option.flatMap(Arr.findFirst(v.data.worktrees, (w) => w.main), (w) => Option.fromNullOr(w.branch)));
  const g = v.git;

  if (!given(base) || g === null) return v.error("The main checkout has no branch to compare with.");

  v.read(Effect.gen(function* () {
    const merged = yield* WT.merged(g, base);

    v.wtPicked = new Set(Arr.flatMap(v.data.worktrees, (w) => (!w.main && given(w.branch) && w.branch !== base && merged.has(w.branch) ? [w.path] : [])));
    v.note(v.wtPicked.size > 0 ? `${v.wtPicked.size} merged into ${base} picked: d removes them, esc lets go` : `Nothing merged into ${base}`);
  }));
}
