// The git actions on branches, remotes and tags (keys.ts): checkout, new,
// delete, merge, rebase, upstreams, pull requests, a remote's branches.

import { run as herdrRun, setShared } from "herdr";
import { shq } from "./git.ts";
import type { Action } from "./keys.ts";
import type { MenuItem } from "./popups.ts";
import type { default as GitView } from "./main.ts";
import { isRemoteBranch, isTag, nameOf } from "./items.ts";
import { enterSub } from "./navigate.ts";
import type { Handler } from "./acting.ts";
import { refOf, git, branchOf, spawn, upstreamResetMenu, remoteOf, it } from "./acting.ts";
import { short } from "./draw.ts";

export const BRANCH_ACTIONS = {
  // ---- branches
  checkout: (v) => {
    const r = refOf(v);

    if (r) checkoutRef(v, r);
  },
  "branch-new": (v) => {
    const base = refOf(v);

    v.prompt({ title: base ? `New branch from ${short(base)}` : "New branch", placeholder: "name", ok: (name) => { if (name.trim()) git(v, "New branch", ["checkout", "-b", name.trim(), ...(base ? [base] : [])]); } });
  },
  "checkout-by-name": (v) => v.prompt({ title: "Checkout branch", placeholder: "a branch, tag or commit; - for the previous one", ok: (name) => { if (name.trim()) checkoutRef(v, name.trim()); } }),
  "checkout-previous": (v) => git(v, "Checkout previous branch", ["checkout", "-"]),
  "force-checkout": (v) => {
    const r = refOf(v);

    if (r) v.ask({ title: "Force checkout", text: `Check out ${r}, throwing away local changes?`, danger: true, go: () => git(v, "Force checkout", ["checkout", "-f", r]) });
  },
  "branch-delete-menu": (v) => {
    const b = branchOf(v);
    const g = v.git;

    if (!b || !g) return;

    if (b.head) return v.error("You can't delete the branch you're on.");

    const remote = b.upstream && !b.gone ? b.upstream : null;

    const delLocal = () => spawn(v, async () => {
      const r = await g.run("Delete branch", ["branch", "-d", b.name]);

      if (r.ok) return v.reloadNow();

      if (/not fully merged/.test(r.err)) v.ask({ title: "Force delete", text: `${b.name} isn't fully merged. Delete it anyway?`, danger: true, go: () => git(v, "Force delete branch", ["branch", "-D", b.name]) });
      else v.error(r.err);
    });

    const delRemote = (up: string) => {
      const [rem = "", ...rest] = up.split("/");

      git(v, "Delete remote branch", ["push", rem, "--delete", rest.join("/")], { timeout: 120000 });
    };

    const both: MenuItem[] = remote ? [
      { key: "r", label: `Delete remote branch ${remote}`, danger: true, go: () => v.ask({ title: "Delete remote branch", text: `Delete ${remote} on the remote?`, danger: true, go: () => delRemote(remote) }) },
      { key: "b", label: "Delete both", danger: true, go: () => v.ask({ title: "Delete both", text: `Delete ${b.name} here and ${remote} on the remote?`, danger: true, go: () => { delRemote(remote); delLocal(); } }) },
    ] : [];

    v.menu({
      title: `Delete ${b.name}`,
      items: [
        { key: "c", label: "Delete local branch", danger: true, go: () => v.ask({ title: "Delete branch", text: `Delete the local branch ${b.name}?`, danger: true, go: delLocal }) },
        ...both,
      ],
    });
  },
  "rebase-onto": (v) => {
    const r = refOf(v);
    const cur = v.data.status?.head;

    if (!r || r === cur) return v.error("Pick another branch to rebase onto.");

    v.ask({ title: "Rebase", text: `Rebase ${cur ?? "HEAD"} onto ${short(r)}?`, danger: true, go: () => git(v, "Rebase branch", ["rebase", "--autostash", r], { timeout: 120000 }) });
  },
  "merge-menu": (v) => {
    const r = refOf(v);
    const cur = v.data.status?.head ?? "HEAD";

    if (!r) return;

    v.menu({
      title: `Merge ${short(r)} into ${cur}`,
      items: [
        { key: "m", label: "Merge", sub: "git merge", go: () => git(v, "Merge", ["merge", "--no-edit", r], { timeout: 120000 }) },
        { key: "f", label: "Fast-forward only", sub: "--ff-only", go: () => git(v, "Merge (fast-forward)", ["merge", "--ff-only", r]) },
        { key: "n", label: "Always a merge commit", sub: "--no-ff", go: () => git(v, "Merge (no fast-forward)", ["merge", "--no-ff", "--no-edit", r]) },
        { key: "s", label: "Squash merge", sub: "--squash, then commit", go: () => git(v, "Squash merge", ["merge", "--squash", r]) },
      ],
    });
  },
  "fast-forward": (v) => {
    const b = branchOf(v);

    if (!b?.upstream) return v.error(`${b?.name ?? "This branch"} has no upstream.`);

    if (b.head) return git(v, "Fast-forward", [], { shell: "git fetch && git merge --ff-only @{u}", shown: "git fetch && git merge --ff-only @{u}", timeout: 120000 });

    const [rem = "", ...rest] = b.upstream.split("/");

    return git(v, "Fast-forward", ["fetch", rem, `${rest.join("/")}:${b.name}`], { timeout: 120000 });
  },
  "tag-new": (v) => {
    const r = refOf(v) ?? "HEAD";

    v.prompt({
      title: `New tag on ${short(r)}`, placeholder: "name",
      ok: (name) => {
        if (!name.trim()) return;

        v.prompt({
          title: "Tag message (empty: a lightweight tag)", placeholder: "",
          ok: (msg) => git(v, "New tag", ["tag", ...(msg.trim() ? ["-a", "-m", msg.trim()] : []), name.trim(), r]),
        });
      },
    });
  },
  "reset-menu-ref": (v) => {
    const r = refOf(v);

    if (!r) return;

    v.menu({
      title: `Reset ${v.data.status?.head ?? "HEAD"} to ${short(r)}`,
      items: [
        { key: "s", label: "Soft reset", sub: "keep changes staged", go: () => git(v, "Soft reset", ["reset", "--soft", r]) },
        { key: "m", label: "Mixed reset", sub: "keep changes unstaged", go: () => git(v, "Mixed reset", ["reset", "--mixed", r]) },
        { key: "h", label: "Hard reset", sub: "discard changes", danger: true, go: () => v.ask({ title: "Hard reset", text: `Reset to ${short(r)}, discarding every change?`, danger: true, go: () => git(v, "Hard reset", ["reset", "--hard", r]) }) },
      ],
    });
  },
  "branch-rename": (v) => {
    const b = branchOf(v);

    if (!b) return;

    v.prompt({ title: `Rename ${b.name}`, value: b.name, ok: (n) => { if (n.trim() && n.trim() !== b.name) git(v, "Rename branch", ["branch", "-m", b.name, n.trim()]); } });
  },
  "upstream-menu": (v) => {
    const b = branchOf(v);

    if (!b) return;

    const items: MenuItem[] = [
      { key: "s", label: "Set upstream…", go: () => v.prompt({ title: `Upstream of ${b.name}`, value: b.upstream ?? `origin/${b.name}`, ok: (u) => { if (u.trim()) git(v, "Set upstream", ["branch", `--set-upstream-to=${u.trim()}`, b.name]); } }) },
    ];

    if (b.upstream) items.push({ key: "u", label: `Unset upstream (${b.upstream})`, go: () => git(v, "Unset upstream", ["branch", "--unset-upstream", b.name]) });

    if (b.head && b.upstream) items.push({ key: "g", label: "Reset to upstream…", go: () => upstreamResetMenu(v) });

    v.menu({ title: `Upstream of ${b.name}`, items });
  },
  "sort-menu": (v) => v.menu({
    title: "Sort branches",
    items: [
      { key: "r", label: "Recency", go: () => { v.branchSort = "date"; } },
      { key: "a", label: "Alphabetical", go: () => { v.branchSort = "name"; } },
    ],
  }),
  "pr-create": (v) => {
    const b = branchOf(v);

    if (b) gh(v, "Create pull request", ["pr", "create", "--web", "--head", b.name]);
  },
  // The GitHub window's form (github's prForm.ts) on this branch: it reads the branch from shared state.
  "pr-create-github": (v) => {
    const b = branchOf(v);

    if (!b) return;

    setShared("github.create", { folder: v.folder, on: v.on, head: b.name, at: Date.now() });
    herdrRun("nocturne.github-pr");
  },
  "pr-open": (v) => {
    const b = branchOf(v);

    if (b) gh(v, "Open pull request", ["pr", "view", b.name, "--web"]);
  },
  "copy-name": (v, cx) => {
    const name = nameOf(it(v));

    if (name !== null) v.copy(name, cx);
  },
  "view-commits": (v) => {
    const r = refOf(v);

    if (r) enterSub(v, { kind: "subCommits", ref: r, title: short(r) });
  },


  // ---- remotes
  "view-remote-branches": (v) => {
    const r = remoteOf(v);

    if (r) enterSub(v, { kind: "remoteBranches", remote: r.name, title: r.name });
  },
  "fetch-remote": (v) => {
    const r = remoteOf(v);

    if (r) git(v, `Fetch ${r.name}`, ["fetch", "--prune", r.name], { timeout: 120000 });
  },
  "remote-new": (v) => v.prompt({
    title: "New remote: name", placeholder: "upstream",
    ok: (name) => {
      if (!name.trim()) return;

      v.prompt({ title: `Url of ${name.trim()}`, placeholder: "git@github.com:owner/repo.git", ok: (url) => { if (url.trim()) git(v, "Add remote", ["remote", "add", name.trim(), url.trim()]); } });
    },
  }),
  "remote-edit": (v) => {
    const r = remoteOf(v);
    const g = v.git;

    if (!r || !g) return;

    v.prompt({
      title: `Rename ${r.name}`, value: r.name,
      ok: (name) => v.prompt({
        title: `Url of ${name.trim() || r.name}`, value: r.url,
        ok: (url) => spawn(v, async () => {
          let n = r.name;

          if (name.trim() && name.trim() !== r.name) {
            const x = await g.run("Rename remote", ["remote", "rename", r.name, name.trim()]);

            if (!x.ok) return v.error(x.err);

            n = name.trim();
          }

          if (url.trim() && url.trim() !== r.url) {
            const x = await g.run("Set remote url", ["remote", "set-url", n, url.trim()]);

            if (!x.ok) return v.error(x.err);
          }

          await v.reloadNow();
        }),
      }),
    });
  },
  "remote-remove": (v) => {
    const r = remoteOf(v);

    if (r) v.ask({ title: "Remove remote", text: `Remove the remote ${r.name}? Local branches stay.`, danger: true, go: () => git(v, "Remove remote", ["remote", "remove", r.name]) });
  },
  "checkout-remote": (v) => {
    const r = it(v);

    if (!isRemoteBranch(r)) return;

    const local = v.data.branches.find((b) => b.name === r.branch);

    if (local) return checkoutRef(v, r.branch);

    git(v, "Checkout remote branch", ["checkout", "-b", r.branch, "--track", r.name]);
  },
  "remote-branch-delete": (v) => {
    const r = it(v);

    if (isRemoteBranch(r)) v.ask({ title: "Delete remote branch", text: `Delete ${r.name} on ${r.remote}?`, danger: true, go: () => git(v, "Delete remote branch", ["push", r.remote, "--delete", r.branch], { timeout: 120000 }) });
  },
  "set-upstream": (v) => {
    const name = nameOf(it(v));

    if (name !== null) git(v, "Set upstream", ["branch", `--set-upstream-to=${name}`]);
  },


  // ---- tags
  "tag-delete-menu": (v) => {
    const tg = it(v);

    if (!isTag(tg)) return;

    v.menu({
      title: `Delete tag ${tg.name}`,
      items: [
        { key: "c", label: "Delete local tag", danger: true, go: () => v.ask({ title: "Delete tag", text: `Delete the tag ${tg.name} here?`, danger: true, go: () => git(v, "Delete tag", ["tag", "-d", tg.name]) }) },
        ...v.data.remotes.map((r, i) => ({ key: i ? "" : "r", label: `Delete on ${r.name}`, danger: true, go: () => v.ask({ title: "Delete remote tag", text: `Delete the tag ${tg.name} on ${r.name}?`, danger: true, go: () => git(v, "Delete remote tag", ["push", r.name, "--delete", `refs/tags/${tg.name}`], { timeout: 120000 }) }) })),
      ],
    });
  },
  "tag-push": (v) => {
    const tg = it(v);

    if (!isTag(tg)) return;

    const remotes = v.data.remotes;
    const only = remotes.length === 1 ? remotes[0] : undefined;

    if (only) return git(v, "Push tag", ["push", only.name, `refs/tags/${tg.name}`], { timeout: 120000 });

    v.menu({ title: `Push ${tg.name} to`, items: remotes.map((r, i) => ({ key: String(i + 1), label: r.name, sub: r.url, go: () => git(v, "Push tag", ["push", r.name, `refs/tags/${tg.name}`], { timeout: 120000 }) })), empty: "No remotes." });
  },

} satisfies { readonly [A in Action]?: Handler };

export function checkoutRef(v: GitView, ref: string) {
  const g = v.git;

  if (!g) return;

  spawn(v, async () => {
    const r = await g.run("Checkout", ["checkout", ref]);

    if (r.ok) return v.reloadNow();

    if (/would be overwritten|commit your changes or stash/i.test(r.err)) {
      v.ask({ title: "Checkout", text: `Your local changes would be overwritten. Stash them, check out ${short(ref)}, then pop them back?`, go: () => git(v, "Autostash checkout", [], { shell: `git stash push -q -m "git autostash" && git checkout ${shq(ref)} && git stash pop -q`, shown: `git stash && git checkout ${ref} && git stash pop` }) });
    } else v.error(r.err);

    await v.reloadNow();
  });
}

export function gh(v: GitView, title: string, args: readonly string[]) {
  const g = v.git;

  if (!g) return;

  spawn(v, async () => {
    const r = await g.run(title, [], { shell: `gh ${args.map(shq).join(" ")}`, shown: `gh ${args.join(" ")}` });

    if (!r.ok) v.error(r.err);
  }, { row: null });
}
