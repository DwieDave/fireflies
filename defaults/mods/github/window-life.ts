// The GitHub window's opening and its way across a fork (main.ts runs them on
// the copy's runtime, fx.ts): the cache read, the folder's repo asked of git
// and gh, and p's parent repo. Each is an effect: closing the window
// interrupts it, and a failure says why on the window (its error card, the
// bar, the note) instead of being dropped.

import { Effect, Option, String as Str } from "effect";
import type { Context } from "gpui-kit";
import { Commands, redraw } from "@fireflies/kit";
import type { Repo } from "./gh.ts";
import { GhError, repoOf, viewRepo } from "./gh.ts";
import { repoKey } from "./cache.ts";
import * as store from "./store.ts";
import { noteOf } from "./kit.ts";
import type { default as GitHub } from "./main.ts";
import { runCommand } from "./window-keys.ts";

/** The same repo described the same way, its branch aside (that one may move). */
function sameRepo(a: Repo, b: Repo): boolean {
  return a.owner === b.owner && a.name === b.name && a.full === b.full && a.host === b.host && a.root === b.root && a.on === b.on
    && a.url === b.url && a.base === b.base && a.parent === b.parent && a.child === b.child;
}

/** The folder's repo is `now` (null: none): kept, moved to its branch, or shown instead of the cached one. */
function locate(v: GitHub, now: Repo | null, cx: Context): void {
  const r = v.repo;

  // The folder's fork, shown as its parent last time (p): the parent stays.
  if (now !== null && r !== null && r.child === now.full && r.full === now.parent && r.on === now.on) {
    r.branch = now.branch;

    return;
  }

  if (now === null || r === null || repoKey(now) !== repoKey(r)) {
    v.show(now, cx);

    return;
  }

  // The same repo: its branch may have moved. The tabs drop a read whose repo isn't the shown one
  // (by identity), so the object stays and the opening read under way counts; a repo GitHub now
  // describes otherwise is replaced and read again.
  if (sameRepo(r, now)) r.branch = now.branch;
  else {
    v.repo = { ...r, ...now };
    v.refresh(cx, { all: true });
  }
}

/** The folder's repo couldn't be asked for (offline, gh not logged in): a cached repo stays shown and the
 *  bar says why; without one, the window's card does. */
function unlocated(v: GitHub, why: string): void {
  if (v.repo === null) {
    v.state = "error";
    v.error = why;
  } else v.stale = why;
}

/** The window opening: the cache (unless it was shown already), a cached repo read at once, and meanwhile
 *  the folder's repo; then a form it was opened to show. `cx` is the copy's own (init's). */
export const start = (v: GitHub, cx: Context, cacheFile: string) => Effect.gen(function* () {
  if (!v.checked) {
    // A cache file that can't be read: the window opens without it and reads GitHub.
    const doc = yield* Effect.option(store.load(cacheFile));

    if (Option.isSome(doc)) v.fromCache(doc.value);
    else v.checked = true;

    yield* redraw;
  }

  if (v.repo !== null) v.refresh(cx, { all: true });

  yield* Effect.matchEffect(repoOf(v.folder, v.on), {
    onSuccess: (now) => Effect.sync(() => locate(v, now, cx)),
    onFailure: (e) => Effect.sync(() => unlocated(v, e.message)),
  });

  v.located = true; // the folder's branch is known now (a cached one may be old)
  v.openForm(cx);
});

/** p's way across: the repo to open and the fork it's opened from (null: back to the fork). */
export interface Fork {
  readonly full: string;
  readonly host: string;
  readonly child: string | null;
}

/** Opens `to` in place of `r` (p), with what the cache holds of it; what failed is the note. */
export const switchFork = (v: GitHub, cx: Context, r: Repo, to: Fork) => viewRepo(to, { root: r.root, on: r.on, branch: r.branch }).pipe(
  Effect.flatMap((next) => {
    // Something else was opened meanwhile: this answer is old.
    if (v.repo !== r) return Effect.void;

    if (next === null) return Effect.fail(GhError.make({ message: `${to.full} isn't on GitHub.` }));

    return Effect.sync(() => {
      next.child = to.child;

      if (to.child !== null) next.parent = null; // from the parent, p goes back to the fork, not up again

      v.note = null;
      v.show(next, cx, store.peek()?.repos.get(repoKey(next)) ?? null);
      v.dirty = true;
    });
  }),
  Effect.catch((e) => Effect.sync(() => {
    v.note = noteOf(e.message, "failed", v.now());
  })),
  Effect.ensuring(Effect.sync(() => {
    v.switching = false;
  })),
);

/** The window's key commands (github.prs, github.refresh, …: keys.json), one at a time for as long as it's
 *  open; github.focus takes the keyboard (`focus`). */
export const commands = (v: GitHub, cx: Context, focus: () => void) => Effect.forever(Commands.use((c) => c.next).pipe(
  Effect.flatMap((said) => Effect.sync(() => {
    const c = Str.replace(/^github\./, "")(said);

    if (c === "focus") focus();
    else runCommand(v, c, cx);
  })),
  Effect.andThen(redraw),
));
