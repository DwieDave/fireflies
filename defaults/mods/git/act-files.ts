// The git actions on files (keys.ts): staging, committing, discarding,
// stashing, ignoring, conflicts, the Review tab's marks, a commit's files, the
// stash's entries and staging single lines.

import { partialPatch } from "./patch.ts";
import { shq } from "./git.ts";
import type { Action } from "./keys.ts";
import type { MenuItem } from "./popups.ts";
import type { default as GitView } from "./main.ts";
import { isTreeRow, statusFileOf } from "./items.ts";
import { pickedKeys, startStaging, stepFile, stepHunk, stepLine, switchSide } from "./staging.ts";
import { collapseAll, toggleDir } from "./navigate.ts";
import { editFile, openFile, terminal } from "./elsewhere.ts";
import type { Handler } from "./acting.ts";
import { filesOf, git, commit, upstreamResetMenu, stashOf, spawn, it } from "./acting.ts";
import { short } from "./draw.ts";

export const FILE_ACTIONS = {
  // ---- files
  stage: (v) => {
    const files = filesOf(v.pickedRows());

    if (!files.length) return;

    const allStaged = files.every((f) => f.staged && !f.unstaged);
    const paths = files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));

    if (allStaged) return git(v, "Unstage", ["reset", "-q", "--", ...paths]);

    return git(v, "Stage", ["add", "-A", "--", ...paths]);
  },
  "stage-all": (v) => {
    const files = v.data.status?.files ?? [];

    if (files.length && files.every((f) => f.staged && !f.unstaged)) return git(v, "Unstage all", ["reset", "-q"]);

    return git(v, "Stage all", ["add", "-A"]);
  },
  "stage-lines": (v) => {
    const r = it(v);

    if (!isTreeRow(r)) return;

    if (r.kind === "dir") return toggleDir(v, r.path);

    const f = statusFileOf(r);

    if (!f) return;

    if (f.conflict) return conflictMenu(v);

    startStaging(v, f);
  },
  commit: (v) => commit(v, ""),
  "commit-no-verify": (v) => commit(v, "--no-verify"),
  amend: (v) => v.ask({
    title: "Amend last commit", text: "Amend the last commit with what's staged? Its message stays.", danger: true,
    go: () => git(v, "Amend commit", [], { env: {}, shell: "git commit --amend --no-edit --allow-empty", shown: "git commit --amend --no-edit" }),
  }),
  "commit-editor": (v) => terminal(v, ["git", "commit"], "git commit"),
  "discard-menu": (v) => discardMenu(v),
  "reset-menu": (v) => v.menu({
    title: "Reset the working tree",
    items: [
      { key: "x", label: "Nuke working tree", sub: "reset --hard; clean -fd", danger: true, go: () => v.ask({ title: "Nuke working tree", text: "Throw away every change and untracked file?", danger: true, go: () => git(v, "Nuke working tree", [], { shell: "git reset -q --hard HEAD && git clean -fd", shown: "git reset --hard HEAD && git clean -fd" }) }) },
      { key: "u", label: "Discard unstaged changes", sub: "checkout -- .", danger: true, go: () => v.ask({ title: "Discard unstaged", text: "Discard every unstaged change?", danger: true, go: () => git(v, "Discard unstaged", ["checkout", "--", "."]) }) },
      { key: "c", label: "Discard untracked files", sub: "clean -fd", danger: true, go: () => v.ask({ title: "Discard untracked", text: "Delete every untracked file?", danger: true, go: () => git(v, "Discard untracked", ["clean", "-fd"]) }) },
      { key: "S", label: "Unstage everything", sub: "reset --mixed HEAD", go: () => git(v, "Mixed reset", ["reset", "-q", "--mixed", "HEAD"]) },
      { key: "h", label: "Hard reset", sub: "reset --hard HEAD", danger: true, go: () => v.ask({ title: "Hard reset", text: "Reset to HEAD, losing every tracked change?", danger: true, go: () => git(v, "Hard reset", ["reset", "--hard", "HEAD"]) }) },
    ],
  }),
  stash: (v) => stashPrompt(v, [], "Stash all changes"),
  "stash-menu": (v) => v.menu({
    title: "Stash options",
    items: [
      { key: "a", label: "Stash all changes", go: () => stashPrompt(v, [], "Stash all changes") },
      { key: "i", label: "Stash all, untracked included", go: () => stashPrompt(v, ["--include-untracked"], "Stash all with untracked") },
      { key: "s", label: "Stash staged changes", go: () => stashPrompt(v, ["--staged"], "Stash staged") },
      { key: "u", label: "Stash unstaged changes", go: () => stashPrompt(v, ["--keep-index"], "Stash unstaged") },
    ],
  }),
  edit: (v) => {
    const p = v.itemPath();

    if (!p) return false;

    editFile(v, p);

    return true;
  },
  open: (v) => {
    const p = v.itemPath();

    if (!p) return false;

    openFile(v, p);

    return true;
  },
  "ignore-menu": (v) => {
    const p = v.itemPath();

    if (!p) return false;

    const add = (file: string, what: string) => git(v, what, [], { env: { NOCTURNE_GIT_LINE: `/${p}` }, shell: `printf '%s\\n' "$NOCTURNE_GIT_LINE" >> "${file}"`, shown: `echo /${p} >> ${file}` });

    v.menu({
      title: `Ignore ${p}`,
      items: [
        { key: "i", label: "Add to .gitignore", go: () => add(".gitignore", "Ignore file") },
        { key: "e", label: "Add to .git/info/exclude", go: () => add("$(git rev-parse --git-path info/exclude)", "Exclude file") },
      ],
    });

    return true;
  },
  tree: (v) => {
    v.tree = !v.tree;
    v.moveTo(0);
  },
  "collapse-all": (v) => collapseAll(v, true),
  "expand-all": (v) => collapseAll(v, false),
  "copy-path": (v, cx) => {
    const p = v.itemPath();

    if (!p) return false;

    v.copy(p, cx);

    return true;
  },
  "status-filter": (v) => v.menu({
    title: "Filter files by status",
    items: [
      { key: "s", label: "Staged only", go: () => { v.statusFilter = "staged"; } },
      { key: "u", label: "Unstaged only", go: () => { v.statusFilter = "unstaged"; } },
      { key: "r", label: "Every file", go: () => { v.statusFilter = null; } },
    ],
  }),
  "conflict-menu": (v) => conflictMenu(v),
  "upstream-reset-menu": (v) => upstreamResetMenu(v),


  // ---- review (diff's)
  "review-mark": (v) => v.review.markAndNext(),
  "review-all": (v) => v.review.markAll(),
  "review-scope": (v) => v.review.nextScope(),
  "review-hide": (v) => v.review.hideMenu(),
  "review-open": (v) => v.focusMain(),


  // ---- commit files
  "checkout-file": (v) => {
    const path = v.itemPath(), s = v.sub();

    if (!path || s?.kind !== "commitFiles") return;

    v.ask({ title: "Checkout file", text: `Replace ${path} in your work tree with its version in ${short(s.hash)}?`, danger: true, go: () => git(v, "Checkout file", ["checkout", s.hash, "--", path]) });
  },


  // ---- stash
  "stash-apply": (v) => {
    const s = stashOf(v);

    if (s) git(v, "Apply stash", ["stash", "apply", s.ref]);
  },
  "stash-pop": (v) => {
    const s = stashOf(v);

    if (s) v.ask({ title: "Pop stash", text: `Apply ${s.ref} and drop it from the stash?`, go: () => git(v, "Pop stash", ["stash", "pop", s.ref]) });
  },
  "stash-drop": (v) => {
    const s = stashOf(v);

    if (s) v.ask({ title: "Drop stash", text: `Drop ${s.ref} (${s.subject})?`, danger: true, go: () => git(v, "Drop stash", ["stash", "drop", s.ref]) });
  },
  "stash-branch": (v) => {
    const s = stashOf(v);

    if (s) v.prompt({ title: `New branch from ${s.ref}`, placeholder: "name", ok: (n) => { if (n.trim()) git(v, "Branch from stash", ["stash", "branch", n.trim(), s.ref]); } });
  },
  "stash-rename": (v) => {
    const s = stashOf(v);

    if (!s) return;

    v.prompt({
      title: `Rename ${s.ref}`, value: s.subject.replace(/^On [^:]+: /, ""),
      ok: (m) => git(v, "Rename stash", [], { env: { NOCTURNE_GIT_MSG: m }, shell: `h=$(git rev-parse ${shq(s.ref)}) && git stash drop -q ${shq(s.ref)} && git stash store -m "$NOCTURNE_GIT_MSG" "$h"`, shown: `git stash drop ${s.ref} && git stash store -m <message> <hash>` }),
    });
  },


  // ---- staging lines
  "line-down": (v) => (v.staging ? stepLine(v, 1) : v.scrollMain(1, 1)),
  "line-up": (v) => (v.staging ? stepLine(v, -1) : v.scrollMain(-1, 1)),
  "hunk-next": (v) => stepHunk(v, 1),
  "hunk-prev": (v) => stepHunk(v, -1),
  "hunk-mode": (v) => {
    if (v.staging) {
      v.staging.hunkMode = !v.staging.hunkMode;
      v.staging.anchor = null;
    }
  },
  "switch-side": (v) => switchSide(v),
  "stage-pick": (v) => stagePick(v),
  "discard-pick": (v) => discardPick(v),
  "copy-lines": (v, cx) => {
    const s = v.staging;

    if (!s) return;

    const keys = pickedKeys(v);
    const text = s.rows.flatMap((r) => (keys.has(`${r.hunk}:${r.line}`) ? [r.text] : [])).join("\n");

    v.copy(text, cx);
  },
  "file-next": (v) => stepFile(v, 1),
  "file-prev": (v) => stepFile(v, -1),
} satisfies { readonly [A in Action]?: Handler };

export function discardMenu(v: GitView) {
  const files = filesOf(v.pickedRows());
  const g = v.git;
  const first = files[0];

  if (!first || !g) return;

  const what = files.length === 1 ? first.path : `${files.length} files`;

  const all = () => spawn(v, async () => {
    const untracked = files.flatMap((f) => (f.untracked ? [f.path] : []));
    const added = files.flatMap((f) => (!f.untracked && f.x === "A" ? [f.path] : []));
    const tracked = files.flatMap((f) => (f.untracked || f.x === "A" ? [] : f.from ? [f.path, f.from] : [f.path]));

    if (tracked.length) {
      const r = await g.run("Discard changes", ["checkout", "HEAD", "--", ...tracked]);

      if (!r.ok) return v.error(r.err);
    }

    if (added.length) {
      const r = await g.run("Discard new files", [], { shell: `git rm -q -f --cached -- ${added.map(shq).join(" ")} && rm -f -- ${added.map(shq).join(" ")}`, shown: `git rm --cached ${added.join(" ")} && rm ${added.join(" ")}` });

      if (!r.ok) return v.error(r.err);
    }

    if (untracked.length) {
      const r = await g.run("Discard untracked", ["clean", "-fd", "--", ...untracked]);

      if (!r.ok) return v.error(r.err);
    }

    await v.reloadNow();
  });

  const items: MenuItem[] = [{ key: "x", label: "Discard all changes", danger: true, go: () => v.ask({ title: "Discard", text: `Discard every change to ${what}?`, danger: true, go: all }) }];

  if (files.some((f) => f.staged && f.unstaged)) {
    items.push({ key: "u", label: "Discard unstaged changes", danger: true, go: () => v.ask({ title: "Discard unstaged", text: `Discard the unstaged changes to ${what}?`, danger: true, go: () => git(v, "Discard unstaged", ["checkout", "--", ...files.flatMap((f) => (f.unstaged && !f.untracked ? [f.path] : []))]) }) });
  }

  v.menu({ title: `Discard ${what}`, items });
}

export function conflictMenu(v: GitView) {
  const f = statusFileOf(it(v));

  if (!f?.conflict) return v.error("No merge conflict in this file.");

  v.menu({
    title: `Conflict in ${f.path}`,
    items: [
      { key: "o", label: "Use ours", sub: "checkout --ours", go: () => git(v, "Use ours", [], { shell: `git checkout --ours -- ${shq(f.path)} && git add -- ${shq(f.path)}`, shown: `git checkout --ours ${f.path} && git add ${f.path}` }) },
      { key: "t", label: "Use theirs", sub: "checkout --theirs", go: () => git(v, "Use theirs", [], { shell: `git checkout --theirs -- ${shq(f.path)} && git add -- ${shq(f.path)}`, shown: `git checkout --theirs ${f.path} && git add ${f.path}` }) },
      { key: "e", label: "Edit the file", go: () => editFile(v, f.path) },
      { key: "a", label: "Mark as resolved", sub: "git add", go: () => git(v, "Mark resolved", ["add", "--", f.path]) },
    ],
  });
}

export function stashPrompt(v: GitView, flags: readonly string[], title: string) {
  if (!(v.data.status?.files ?? []).length) return v.error("Nothing to stash.");

  v.prompt({ title, placeholder: "message (optional)", ok: (m) => git(v, title, ["stash", "push", ...flags, ...(m.trim() ? ["-m", m.trim()] : [])]) });
}

// ---- staging lines
export function stagePick(v: GitView) {
  const s = v.staging;
  const g = v.git;
  const diff = s?.diff;

  if (!s || !diff || !g) return;

  const keys = pickedKeys(v);

  if (!keys.size) return;

  const reverse = s.side === "staged";
  const patch = partialPatch(diff, keys, { reverse });

  if (!patch) return;

  spawn(v, async () => {
    if (!reverse && s.file.untracked) {
      const r = await g.run("Intent to add", ["add", "-N", "--", s.file.path]);

      if (!r.ok) return v.error(r.err);

      // The diff of an intent-to-add file is the same lines: apply as a change to an empty file.
      s.diff = { ...diff, status: "added" };
    }

    const r = await g.apply(reverse ? "Unstage lines" : "Stage lines", patch, reverse ? ["--cached", "-R", "--recount"] : ["--cached", "--recount"]);

    if (!r.ok) v.error(r.err);

    s.anchor = null;
    await v.reloadNow();
  });
}

export function discardPick(v: GitView) {
  const s = v.staging;
  const g = v.git;

  if (!s?.diff || !g) return;

  if (s.side === "staged") return stagePick(v); // lazygit: d on the staged side unstages

  const keys = pickedKeys(v);

  if (!keys.size) return;

  const patch = partialPatch(s.diff, keys, { reverse: true });

  if (!patch) return;

  v.ask({
    title: "Discard lines", text: `Discard ${keys.size} changed line${keys.size === 1 ? "" : "s"} from ${s.file.path}?`, danger: true,
    go: () => spawn(v, async () => {
      const r = await g.apply("Discard lines", patch, ["-R", "--recount"]);

      if (!r.ok) v.error(r.err);

      s.anchor = null;
      await v.reloadNow();
    }),
  });
}
