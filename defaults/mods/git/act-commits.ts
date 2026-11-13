// The git actions on commits (keys.ts): checkout, revert, reword, fixup,
// amend, moving and squashing (history.ts rewrites), cherry-picking, copying.

import type { Context } from "gpui-kit";
import { run as herdrRun } from "herdr";
import type { Rewrite } from "./history.ts";
import { rewrite } from "./history.ts";
import type { Env } from "./git.ts";
import type { Action } from "./keys.ts";
import type { default as GitView } from "./main.ts";
import { isCommit, isReflog, isStash, hashOf } from "./items.ts";
import { cycleScreen, enterSub, moveBy } from "./navigate.ts";
import { reload } from "./reads.ts";
import { terminal } from "./elsewhere.ts";
import type { Handler } from "./acting.ts";
import { short } from "./draw.ts";
import { commitOf, git, spawn, MSG_COMMIT, it } from "./acting.ts";

export const COMMIT_ACTIONS = {
  // ---- commits
  "view-files": (v) => {
    const c = it(v);

    if (isCommit(c)) enterSub(v, { kind: "commitFiles", hash: c.hash, title: c.short, stash: false });
    else if (isStash(c)) enterSub(v, { kind: "commitFiles", hash: c.hash, title: c.ref, stash: true });
    else {
      const hash = hashOf(c);

      if (hash) enterSub(v, { kind: "commitFiles", hash, title: isReflog(c) ? c.short : short(hash), stash: false });
    }
  },
  "checkout-commit": (v) => {
    const c = commitOf(v);

    if (c) v.ask({ title: "Checkout commit", text: `Check out ${short(c.hash)} as a detached HEAD?`, go: () => git(v, "Checkout commit", ["checkout", c.hash]) });
  },
  reword: (v) => {
    const c = commitOf(v);
    const g = v.git;

    if (!c || !g) return;

    if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

    spawn(v, async () => {
      const msg = (await g.text(["log", "-1", "--format=%B", c.hash])).trim();

      v.commitPopup({
        title: `Reword ${short(c.hash)}`, value: msg,
        ok: (m) => {
          if (v.isHead(c)) return git(v, "Reword", [], { env: { NOCTURNE_GIT_MSG: m }, shell: MSG_COMMIT("--amend --only --allow-empty"), shown: "git commit --amend --only -m <message>" });

          rebaseRewrite(v, "reword", { NOCTURNE_GIT_MSG: m });
        },
      });
    });
  },
  "reword-editor": (v) => {
    const c = commitOf(v);

    if (!c) return;

    if (v.isHead(c)) return terminal(v, ["git", "commit", "--amend", "--only"], "git commit --amend --only");

    const plan = rewrite(v.commitList(), v.commitIndex(), "edit");

    if ("error" in plan) return v.error(plan.error);

    const todo = plan.todo.replace(/^edit /m, "reword ");

    terminal(v, ["env", `NOCTURNE_GIT_TODO=${todo}`, `GIT_SEQUENCE_EDITOR=sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -`, "git", "rebase", "-i", "--autostash", ...(plan.base ? [plan.base] : ["--root"])], `git rebase -i (reword ${short(c.hash)})`);
  },
  squash: (v) => confirmRewrite(v, "squash", "Squash", "Squash this commit into the one below it? Their messages are combined."),
  fixup: (v) => confirmRewrite(v, "fixup", "Fixup", "Meld this commit into the one below it? Its message is dropped."),
  drop: (v) => confirmRewrite(v, "drop", "Drop commit", "Drop this commit from the branch?"),
  "edit-commit": (v) => rebaseRewrite(v, "edit"),
  "move-down": (v) => rebaseRewrite(v, "move-down", {}, () => moveBy(v, 1)),
  "move-up": (v) => rebaseRewrite(v, "move-up", {}, () => moveBy(v, -1)),
  pick: (v) => (v.rebasing() ? v.error("Picking todo entries mid-rebase isn't here yet: press m to continue, or i for git's own todo.") : v.error("Pick only applies mid-rebase.")),
  "rebase-interactive": (v) => {
    const c = commitOf(v);

    if (!c) return;

    const base = c.parents[0];

    terminal(v, ["git", "rebase", "-i", "--autostash", ...(base ? [base] : ["--root"])], `git rebase -i ${base ? short(base) : "--root"}`);
  },
  "fixup-commit": (v) => {
    const c = commitOf(v);

    if (c) git(v, "Create fixup commit", ["commit", `--fixup=${c.hash}`]);
  },
  autosquash: (v) => {
    const c = commitOf(v);

    if (!c) return;

    const parent = c.parents[0];

    v.ask({
      title: "Apply fixup commits", text: `Squash every fixup! commit above ${short(c.hash)} into its target?`, danger: true,
      go: () => git(v, "Apply fixup commits", ["rebase", "-i", "--autosquash", "--autostash", ...(parent ? [parent] : ["--root"])], { env: { GIT_SEQUENCE_EDITOR: "true" }, timeout: 120000 }),
    });
  },
  "amend-commit": (v) => {
    const c = commitOf(v);

    if (!c) return;

    if (!(v.data.status?.files ?? []).some((f) => f.staged)) return v.error("Nothing is staged to amend with.");

    const parent = c.parents[0] ?? "--root";

    v.ask({
      title: "Amend commit", text: `Amend ${short(c.hash)} with what's staged?`, danger: true,
      go: () => (v.isHead(c)
        ? git(v, "Amend commit", ["commit", "--amend", "--no-edit"])
        : git(v, "Amend commit", [], { env: { GIT_SEQUENCE_EDITOR: "true" }, shell: `git commit --fixup=${c.hash} && git rebase -i --autosquash --autostash ${parent}`, shown: `git commit --fixup=${short(c.hash)} && git rebase -i --autosquash ${short(parent)}`, timeout: 120000 })),
    });
  },
  revert: (v) => {
    const c = commitOf(v);

    if (!c) return;

    v.ask({ title: "Revert", text: `Make a commit that undoes ${short(c.hash)}?`, danger: true, go: () => git(v, "Revert commit", ["revert", "--no-edit", ...(c.parents.length > 1 ? ["-m", "1"] : []), c.hash]) });
  },
  "cherry-copy": (v) => cherryCopy(v),
  "cherry-paste": (v) => {
    const g = v.git;

    if (!v.copied.length || !g) return v.error("Nothing copied: C on a commit copies it.");

    const list = [...v.copied].sort((a, b) => a.date - b.date).map((c) => c.hash);

    v.ask({
      title: "Cherry-pick", text: `Paste ${list.length} commit${list.length === 1 ? "" : "s"} onto ${v.data.status?.head ?? "HEAD"}?`,
      go: () => spawn(v, async () => {
        const r = await g.run("Cherry-pick", ["cherry-pick", ...list], { timeout: 120000 });

        if (r.ok) v.copied = [];
        else v.error(r.err);

        await v.reloadNow();
      }),
    });
  },
  "cherry-reset": (v) => {
    v.copied = [];
    v.note("Copied commits forgotten");
  },
  "cherry-legacy": (v) => cherryCopy(v),
  "copy-hash": (v, cx) => {
    const hash = hashOf(it(v));

    if (hash) v.copy(hash, cx);
  },
  "copy-menu": (v) => {
    const c = commitOf(v);
    const g = v.git;

    if (!c || !g) return;

    spawn(v, async () => {
      const [msg, diff] = await Promise.all([g.text(["log", "-1", "--format=%B", c.hash]), g.text(["show", "--format=", c.hash])]);
      const url = commitUrl(v, c.hash);

      v.menu({
        title: `Copy from ${short(c.hash)}`,
        items: [
          { key: "c", label: "Hash", sub: c.hash, go: (cx2) => v.copy(c.hash, cx2) },
          { key: "s", label: "Subject", sub: c.subject, go: (cx2) => v.copy(c.subject, cx2) },
          { key: "m", label: "Message", go: (cx2) => v.copy(msg.trim(), cx2) },
          { key: "a", label: "Author", sub: `${c.author} <${c.email}>`, go: (cx2) => v.copy(`${c.author} <${c.email}>`, cx2) },
          { key: "d", label: "Diff", go: (cx2) => v.copy(diff, cx2) },
          ...(url ? [{ key: "u", label: "Url", sub: url, go: (cx2: Context) => v.copy(url, cx2) }] : []),
        ],
      });
    });
  },
  "open-commit-browser": (v) => {
    const hash = hashOf(it(v));
    const url = hash && commitUrl(v, hash);

    if (!url) return v.error("No GitHub-style remote to open it on.");

    herdrRun("app.open_url", { url, in: "system" });
  },
  "select-branch-commits": (v) => {
    const list = v.commitList();
    const n = list.findIndex((c) => !v.data.notMain.has(c.hash));

    if (n <= 0) return v.note("Every shown commit is on the main branch.");

    v.selectRange(0, n - 1);
  },
  "log-options": (v) => v.menu({
    title: "Log options",
    items: [
      { key: "g", label: v.noGraph ? "Show the graph" : "Hide the graph", go: () => { v.noGraph = !v.noGraph; } },
      { key: "a", label: v.allBranches ? "Only this branch" : "Every branch", go: () => { v.allBranches = !v.allBranches; reload(v); } },
      { key: "+", label: "Wide commits (screen mode)", sub: "+ / _", go: () => { v.panel = "commits"; cycleScreen(v, 1); } },
    ],
  }),

} satisfies { readonly [A in Action]?: Handler };

/** C: copies the picked commits (again: forgets one), for V to paste. */
export function cherryCopy(v: GitView) {
  for (const c of v.pickedRows()) {
    if (!isCommit(c) && !isReflog(c) && !isStash(c)) continue;

    const i = v.copied.findIndex((x) => x.hash === c.hash);

    if (i >= 0) v.copied.splice(i, 1);
    else v.copied.push({ hash: c.hash, subject: c.subject, date: c.date });
  }

  v.note(v.copied.length ? `${v.copied.length} commit${v.copied.length === 1 ? "" : "s"} copied: V pastes them, ctrl-r forgets them` : "Copied commits forgotten");
}

export function confirmRewrite(v: GitView, action: Rewrite, title: string, text: string) {
  if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

  const plan = rewrite(v.commitList(), v.commitIndex(), action);

  if ("error" in plan) return v.error(plan.error);

  v.ask({ title, text, danger: true, go: () => rebaseRewrite(v, action) });
}

/** A rewrite's name in the command log. */
export function rewriteTitle(action: Rewrite) {
  switch (action) {
    case "squash": return "Squash";
    case "fixup": return "Fixup";
    case "drop": return "Drop commit";
    case "reword": return "Reword";
    case "edit": return "Edit commit";
    case "move-down": return "Move commit down";
    case "move-up": return "Move commit up";
  }
}

export function rebaseRewrite(v: GitView, action: Rewrite, env: Env = {}, after?: () => void) {
  if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

  const plan = rewrite(v.commitList(), v.commitIndex(), action);
  const g = v.git;

  if ("error" in plan) return v.error(plan.error);

  if (!g) return;

  spawn(v, async () => {
    const r = await g.rebase(rewriteTitle(action), plan.base, plan.todo, env);

    if (!r.ok && !/stopped at|Stopped at/i.test(r.out + r.err)) v.error(r.err);
    else if (action === "edit") v.note("Rebase stopped at the commit: change it, amend, then m to continue");
    else after?.();

    await v.reloadNow();
  });
}

/** https://host/owner/repo/commit/<hash> from the first remote's url, if it's a GitHub-style one. */
export function commitUrl(v: GitView, hash: string) {
  const url = v.data.remotes.find((r) => r.name === "origin")?.url ?? v.data.remotes[0]?.url;

  if (!url) return null;

  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(url);

  return m ? `https://${m[1] ?? ""}/${m[2] ?? ""}/commit/${hash}` : null;
}
