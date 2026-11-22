// The Projects tab's reads (projects.ts calls them), as effects on the
// window's runtime: the projects to pick from, the picked board (every page),
// a card's body and comments, a repo's labels and people. A token without the
// project scope is said on the tab (its ScopeProblem), not as a failure; a
// read of a repo no longer shown is dropped. board.ts's answers still pass its
// guards (read here as schemas) until board.ts is on Schema.

import { Array as Arr, Clock, Effect, Option, Schema } from "effect";
import { redraw } from "@fireflies/kit";
import type { Guard } from "./guard.ts";
import type { Repo } from "./gh.ts";
import { GhError, graphql } from "./gh.ts";
import type { Choices, Item } from "./board.ts";
import {
  addPage, boardQuery, choicesQuery, detailQuery, isBoardAnswer, isChoicesAnswer, isDetailAnswer, isProjectListAnswer, parseBoard, parseChoices, parseDetail,
  parseProjectList, projectListQuery, scopeProblem,
} from "./board.ts";
import { LIMITS, newest } from "./cache.ts";
import { SLOW } from "./model.ts";
import type { ReadOptions } from "./host.ts";
import type { default as Projects } from "./projects.ts";

/** The picker's list is read again this rarely. */
const LIST_EVERY = 10 * 60000;

/** A board.ts guard as the schema gh.ts decodes with. */
const answer = <T>(guard: Guard<T>) => Schema.declare(guard);

/** The picked project's board, every page of it; edits GitHub took before this read began are in it now. */
const readBoard = (v: Projects, repo: Repo, pid: string) => Effect.gen(function* () {
  const started = yield* Clock.currentTimeMillis;
  const first = yield* Effect.map(graphql(repo, boardQuery(true), answer(isBoardAnswer), [["id", pid]]), parseBoard);

  if (first === null) return yield* GhError.make({ message: "GitHub didn't find that project (it may be gone, or private to others)." });

  let b = first;

  for (let more = b.more; more !== null && more !== ""; more = b.more) {
    const page = yield* graphql(repo, boardQuery(false), answer(isBoardAnswer), [["id", pid], ["after", more]]);

    b = addPage(b, page);
  }

  if (v.app.repo !== repo) return;

  const at = yield* Clock.currentTimeMillis;

  v.boards.set(pid, { board: b, at });
  v.settleAt = 0;
  v.error = "";
  v.pending = Arr.filter(v.pending, (p) => !(p.state === "done" && (p.doneAt ?? 0) <= started));
  v.keepSel();

  if (v.boards.size > LIMITS.boards * 2) v.boards = newest(v.boards, LIMITS.boards);
});

/** The selected card's body and comments, read once it's opened (again after a minute); what failed is said in the detail. */
export const readDetail = (v: Projects, item: Item) => Effect.gen(function* () {
  const id = item.content.id, repo = v.app.repo;

  if (id === null || id === "" || repo === null || v.details.get(id)?.busy === true) return;

  const kept = v.details.get(id), now = yield* Clock.currentTimeMillis;

  if (kept !== undefined && now - kept.at < 60000) return;

  v.details.set(id, { ...kept, busy: true, at: kept?.at ?? 0 });

  const read = yield* Effect.match(graphql(repo, detailQuery, answer(isDetailAnswer), [["id", id]]), {
    onSuccess: (data) => ({ d: parseDetail(data) }),
    onFailure: (e) => ({ error: e.message }),
  });

  const at = yield* Clock.currentTimeMillis;

  v.details.set(id, { ...read, at });
});

/** A repo's labels and assignable people (asked once per repo, for the menus). */
export const choicesFor = (v: Projects, full: string | null) => Effect.gen(function* () {
  const repo = v.app.repo;
  const none: Choices = { labels: [], users: [] };

  if (full === null || full === "" || repo === null) return none;

  const had = v.choices.get(full);

  if (had !== undefined) return had;

  const c = yield* Effect.map(graphql(repo, choicesQuery(full), answer(isChoicesAnswer)), parseChoices);

  v.choices.set(full, c);

  return c;
});

/** The projects to pick from (the repo's, its parent's, its owner's), the pick kept on one of them. */
const readList = (v: Projects, repo: Repo) => Effect.gen(function* () {
  const l = yield* Effect.map(graphql(repo, projectListQuery(repo), answer(isProjectListAnswer), [], { partial: true }), parseProjectList);

  if (v.app.repo !== repo) return false;

  v.list = l;
  v.listAt = yield* Clock.currentTimeMillis;
  v.scope = null;

  if (v.pick === null || !Arr.some(l.projects, (p) => p.id === v.pick)) {
    const was = v.remembered();
    const open = Arr.findFirst(l.projects, (p) => !p.closed).pipe(Option.orElse(() => Arr.head(l.projects)));

    v.pick = was !== null && Arr.some(l.projects, (p) => p.id === was) ? was : Option.getOrNull(Option.map(open, (p) => p.id));
  }

  yield* redraw;

  return true;
});

/** Reads the project list (when asked or old), then the picked board (when asked, old, or an edit GitHub took
 *  has settled), and an open card's detail with it. all: past the timers. */
export const pollProjects = (v: Projects, { all = false }: ReadOptions) => Effect.gen(function* () {
  const repo = v.app.repo;

  if (repo === null) return;

  const now = yield* Clock.currentTimeMillis;

  if ((all || v.list === null || now - v.listAt >= LIST_EVERY) && !(yield* readList(v, repo))) return;

  const pid = v.pick;

  if (pid === null) return;

  const kept = v.boards.get(pid);
  const fresh = kept !== undefined && now - kept.at < SLOW - 500, settled = v.settleAt !== 0 && now >= v.settleAt;

  if (!all && fresh && !settled) return;

  yield* readBoard(v, repo, pid);

  // Reopened with the detail docked: its card is read with the board.
  const it = v.current();

  if (v.detailOpen && it !== null) yield* readDetail(v, it);
}).pipe(Effect.catch((e) => {
  const s = scopeProblem(e.message);

  return s === null ? Effect.fail(e) : Effect.sync(() => {
    v.scope = s;
  });
}));
