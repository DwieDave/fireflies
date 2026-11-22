// How a git action acts (the act-*.ts tables): what it acts on (the row's
// branch, commit, remote, stash entry, checkout, files), running git for it
// on the window's queue, and the menus and prompts several tables share.

import type { Context } from "gpui-kit";
import { Array as Arr, Effect, String as Str } from "effect";
import type { GitServices } from "./fx.ts";
import type { StatusFile } from "./parse.ts";
import type { CommitFile } from "./git.ts";
import type { default as GitView } from "./main.ts";
import type { ExecOptions, SpawnOptions } from "./state.ts";
import type { Item } from "./items.ts";
import { isBranch, isCheckout, isCommit, isRemote, isRemoteBranch, isStash, isTreeRow, hashOf, nameOf, statusFileOf } from "./items.ts";

export const MSG_COMMIT = (flags: string) => `printf '%s' "$NOCTURNE_GIT_MSG" | git commit --cleanup=strip ${flags} -F -`;

/** What an action does; false: it doesn't apply here (the key falls through). */
export type Handler = (v: GitView, cx: Context) => boolean | void;

export const it = (v: GitView) => v.item();

/** A git action that reloads after; errors open lazygit's error popup. */
export function git(v: GitView, title: string, args: readonly string[], opts?: ExecOptions) { v.exec(title, args, opts); }

/** Runs `job` on the actions lane; a failure opens the error popup. */
export function spawn<E>(v: GitView, job: Effect.Effect<void, E, GitServices>, options?: SpawnOptions): void {
  v.spawn(job, options);
}

/** A prompt's answer, trimmed, handed on when it isn't empty. */
export function answered(text: string, go: (said: string) => void): void {
  const said = Str.trim(text);

  if (Str.isNonEmpty(said)) go(said);
}

/** An upstream ("origin/feat/x") as its remote and its branch there. */
export function upstreamParts(up: string): readonly [string, string] {
  const [rem = "", ...rest] = Str.split(up, "/");

  return [rem, Arr.join(rest, "/")];
}

/** The ref a branch / tag / commit / remote branch row stands for. */
export function refOf(v: GitView, x: Item | null = it(v)): string | null {
  if (x === null) return null;

  return hashOf(x) ?? (isRemoteBranch(x) ? x.name : null) ?? nameOf(x);
}

/** A row's working-tree files: a directory's, a file's. */
export function filesOf(rows: readonly Item[]): StatusFile[] {
  return Arr.flatMap(rows, (r) => {
    if (!isTreeRow(r)) return [];

    if (r.kind === "dir") {
      const all: readonly (StatusFile | CommitFile)[] = r.files;

      return Arr.filter(all, (f): f is StatusFile => "staged" in f);
    }

    const f = statusFileOf(r);

    return f === null ? [] : [f];
  });
}

/** The selected row when it's a branch. */
export const branchOf = (v: GitView) => {
  const x = it(v);

  return isBranch(x) ? x : null;
};

/** The selected row when it's a commit. */
export const commitOf = (v: GitView) => {
  const x = it(v);

  return isCommit(x) ? x : null;
};

/** The selected row when it's a remote. */
export const remoteOf = (v: GitView) => {
  const x = it(v);

  return isRemote(x) ? x : null;
};

/** The selected row when it's a stash entry. */
export const stashOf = (v: GitView) => {
  const x = it(v);

  return isStash(x) ? x : null;
};

/** The selected row when it's a checkout. */
export const checkoutOf = (v: GitView) => {
  const x = it(v);

  return isCheckout(x) ? x : null;
};


export function commit(v: GitView, flags: string) {
  const files = v.data.status?.files ?? [];
  const g = v.git;

  if (!Arr.isReadonlyArrayNonEmpty(files) || g === null) return v.error("Nothing to commit: the work tree is clean.");

  const go = () => v.commitPopup({
    title: Str.isEmpty(flags) ? "Commit" : "Commit (no hooks)", draft: true,
    ok: (m) => git(v, "Commit", [], { env: { NOCTURNE_GIT_MSG: m }, shell: MSG_COMMIT(flags), shown: `git commit ${Str.isEmpty(flags) ? "" : `${flags} `}-m <message>` }),
  });

  if (!Arr.some(files, (f) => f.staged)) {
    return v.ask({
      title: "Nothing staged", text: "No files are staged. Stage every change and commit?",
      go: () => spawn(v, Effect.gen(function* () {
        const r = yield* g.run("Stage all", ["add", "-A"]);

        if (!r.ok) return v.error(r.err);

        yield* v.reloadNow();
        go();
      })),
    });
  }

  go();
}

export function upstreamResetMenu(v: GitView) {
  const up = v.data.status?.upstream;

  if (up === null || up === undefined || Str.isEmpty(up)) return v.error("This branch has no upstream.");

  v.menu({
    title: `Reset to ${up}`,
    items: [
      { key: "s", label: "Soft reset", go: () => git(v, "Soft reset to upstream", ["reset", "--soft", up]) },
      { key: "m", label: "Mixed reset", go: () => git(v, "Mixed reset to upstream", ["reset", "--mixed", up]) },
      { key: "h", label: "Hard reset", danger: true, go: () => v.ask({ title: "Hard reset", text: `Reset to ${up}, discarding local commits and changes?`, danger: true, go: () => git(v, "Hard reset to upstream", ["reset", "--hard", up]) }) },
    ],
  });
}

export function push(v: GitView) {
  const s = v.data.status;
  const g = v.git;
  const head = s?.head;

  if (s === null || head === null || head === undefined || g === null) return v.error("Not on a branch: nothing to push.");

  const go = (args: readonly string[], title = "Push"): void => spawn(v, Effect.gen(function* () {
    // The pushed branch's row spins (whichever row is selected).
    v.busy(`Pushing ${head}…`);

    const r = yield* g.run(title, args, { timeout: 300000 }).pipe(Effect.ensuring(Effect.sync(() => v.busy(null))));

    if (r.ok) return yield* v.reloadNow();

    if (/rejected|non-fast-forward|fetch first/i.test(r.err)) {
      v.ask({ title: "Force push", text: `${head} was rejected: the remote has commits you don't. Force push (with lease)?`, danger: true, go: () => go(["push", "--force-with-lease"], "Force push") });
    } else v.error(r.err);

    yield* v.reloadNow();
  }), { row: `branch:${head}` });

  if (s.upstream !== null) return go(["push"]);

  const remote = v.data.remotes[0]?.name;

  if (remote === undefined) return v.error("No remote to push to: add one in Branches › Remotes (n).");

  v.prompt({
    title: "Push to (upstream)", value: `${remote} ${head}`,
    ok: (x) => {
      const [r, b] = Str.split(Str.trim(x), /\s+/);

      if (r !== undefined && Str.isNonEmpty(r)) go(["push", "--set-upstream", r, b ?? head]);
    },
  });
}

export function pull(v: GitView) {
  const s = v.data.status;
  const g = v.git;
  const head = s?.head;

  if (s === null || head === null || head === undefined || g === null) return v.error("Not on a branch: nothing to pull.");

  const go = (args: readonly string[]): void => spawn(v, Effect.gen(function* () {
    v.busy(`Pulling ${head}…`);

    const r = yield* g.run("Pull", args, { timeout: 300000 }).pipe(Effect.ensuring(Effect.sync(() => v.busy(null))));

    if (!r.ok) v.error(r.err);

    yield* v.reloadNow();
  }), { row: `branch:${head}` });

  if (s.upstream !== null) return go(["pull", "--no-edit"]);

  const remote = v.data.remotes[0]?.name;

  if (remote === undefined) return v.error("No remote to pull from.");

  v.prompt({
    title: "Pull from (and set as upstream)", value: `${remote}/${head}`,
    ok: (x) => spawn(v, Effect.gen(function* () {
      const r = yield* g.run("Set upstream", ["branch", `--set-upstream-to=${Str.trim(x)}`]);

      if (!r.ok) return v.error(r.err);

      go(["pull", "--no-edit"]);
    })),
  });
}
