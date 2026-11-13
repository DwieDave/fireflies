// How a git action acts (the act-*.ts tables): what it acts on (the row's
// branch, commit, remote, stash entry, checkout, files), running git for it
// on the window's queue, and the menus and prompts several tables share.

import type { Context } from "gpui-kit";
import type { StatusFile } from "./parse.ts";
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

/** Runs `fn` on the action queue; a quiet spawn when the result isn't kept. */
export function spawn(v: GitView, fn: () => Promise<void>, options?: SpawnOptions) {
  v.spawn(async () => { await fn(); }, options);
}

/** The ref a branch / tag / commit / remote branch row stands for. */
export function refOf(v: GitView, x: Item | null = it(v)): string | null {
  if (!x) return null;

  return hashOf(x) ?? (isRemoteBranch(x) ? x.name : null) ?? nameOf(x);
}

/** A row's working-tree files: a directory's, a file's. */
export function filesOf(rows: readonly Item[]): StatusFile[] {
  return rows.flatMap((r) => {
    if (!isTreeRow(r)) return [];

    if (r.kind === "dir") return r.files.flatMap((f) => ("staged" in f ? [f] : []));

    const f = statusFileOf(r);

    return f ? [f] : [];
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

  if (!files.length || !g) return v.error("Nothing to commit: the work tree is clean.");

  const go = () => v.commitPopup({
    title: flags ? "Commit (no hooks)" : "Commit", draft: true,
    ok: (m) => git(v, "Commit", [], { env: { NOCTURNE_GIT_MSG: m }, shell: MSG_COMMIT(flags), shown: `git commit ${flags ? `${flags} ` : ""}-m <message>` }),
  });

  if (!files.some((f) => f.staged)) {
    return v.ask({
      title: "Nothing staged", text: "No files are staged. Stage every change and commit?",
      go: async () => {
        const r = await g.run("Stage all", ["add", "-A"]);

        if (!r.ok) return v.error(r.err);

        await v.reloadNow();
        go();
      },
    });
  }

  go();
}

export function upstreamResetMenu(v: GitView) {
  const up = v.data.status?.upstream;

  if (!up) return v.error("This branch has no upstream.");

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

  if (!s || !head || !g) return v.error("Not on a branch: nothing to push.");

  const go = (args: readonly string[], title = "Push") => spawn(v, async () => {
    // The pushed branch's row spins (whichever row is selected).
    v.busy(`Pushing ${head}…`);

    const r = await g.run(title, args, { timeout: 300000 });

    v.busy(null);

    if (r.ok) return v.reloadNow();

    if (/rejected|non-fast-forward|fetch first/i.test(r.err)) {
      v.ask({ title: "Force push", text: `${head} was rejected: the remote has commits you don't. Force push (with lease)?`, danger: true, go: () => go(["push", "--force-with-lease"], "Force push") });
    } else v.error(r.err);

    await v.reloadNow();
  }, { row: `branch:${head}` });

  if (s.upstream) return go(["push"]);

  const remote = v.data.remotes[0]?.name;

  if (!remote) return v.error("No remote to push to: add one in Branches › Remotes (n).");

  v.prompt({
    title: "Push to (upstream)", value: `${remote} ${head}`,
    ok: (x) => {
      const [r, b] = x.trim().split(/\s+/);

      if (r) go(["push", "--set-upstream", r, b ?? head]);
    },
  });
}

export function pull(v: GitView) {
  const s = v.data.status;
  const g = v.git;
  const head = s?.head;

  if (!s || !head || !g) return v.error("Not on a branch: nothing to pull.");

  const go = (args: readonly string[]) => spawn(v, async () => {
    v.busy(`Pulling ${head}…`);

    const r = await g.run("Pull", args, { timeout: 300000 });

    v.busy(null);

    if (!r.ok) v.error(r.err);

    await v.reloadNow();
  }, { row: `branch:${head}` });

  if (s.upstream) return go(["pull", "--no-edit"]);

  const remote = v.data.remotes[0]?.name;

  if (!remote) return v.error("No remote to pull from.");

  v.prompt({
    title: "Pull from (and set as upstream)", value: `${remote}/${head}`,
    ok: (x) => spawn(v, async () => {
      const r = await g.run("Set upstream", ["branch", `--set-upstream-to=${x.trim()}`]);

      if (!r.ok) return v.error(r.err);

      go(["pull", "--no-edit"]);
    }),
  });
}
