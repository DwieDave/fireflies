// The Worktrees tab's work on the git window: going to a worktree, making one,
// removing the picked ones after one confirm, picking the merged ones, and what
// a window opened for a worktree asked for (worktrees.ts does the git).

import { spaces, run, closeOverlay } from "herdr";
import type { Check, Line } from "./popups.ts";
import * as WT from "./worktrees.ts";
import type { Checkout, Loss } from "./worktrees.ts";
import type { SpaceOptions, NewWorktree } from "./state.ts";
import { pathOf, isCheckout } from "./items.ts";
import type { default as GitView } from "./main.ts";
import { loadAll } from "./reads.ts";
import { switchRepo } from "./elsewhere.ts";

/** After a worktree was made or picked from outside (a space's menu, the
 *  palette, the sidebar's w): what it asked for, once the repo is read. */
export function worktreeIntent(v: GitView) {
  const want = v.wtIntent;

  v.wtIntent = null;

  if (!want) return;

  v.setPanel("files");
  v.setTab("worktrees");

  const s = want.space ? spaces().find((x) => x.id === want.space) : null;
  const at = s ? WT.owner(v.data.worktrees, WT.spaceFolder(s)) : WT.owner(v.data.worktrees, v.folder);
  const i = at ? v.items("worktrees").findIndex((w) => pathOf(w) === at.path) : -1;

  if (i >= 0) v.moveTo(i);

  if (want.action === "new" || want.branch) newWorktree(v, { value: want.branch ?? "", now: Boolean(want.branch), tab: want.tab, argv: want.argv });
  else if (want.action === "remove") {
    if (!at || at.main) v.error(at ? "This is the repository's main checkout, not a worktree." : "That space isn't on a worktree of this repo.");
    else removeWorktrees(v, [at]);
  }
}

/** Goes to a worktree: the space showing it, else a new space there
 *  (unnamed, so it follows the checkout and nests under its repo); the
 *  window steps aside, as after lazygit's worktree switch. */
export function goToWorktree(v: GitView, w: { readonly path: string; readonly prunable?: boolean }, options: SpaceOptions = {}) {
  const { tab, argv } = options;

  if (w.prunable) return v.error("Its folder is gone: X prunes it.");

  const s = v.occupancy().get(w.path)?.spaces[0];

  if (s && !tab && !argv) run("space.select", { id: s.id });
  else {
    const args = { folder: w.path, machine: v.on ?? "" };
    const named = tab ? { ...args, tab } : args;

    run("space.new", argv ? { ...named, argv } : named);
  }

  if (v.overlay && !v.show) {
    v.saveState();
    closeOverlay(v.overlay);
  }
}

/** n: a branch for a new worktree (an existing one is checked out, a new
 *  one starts from `base`, HEAD by default), checked out under
 *  ~/.herdr/worktrees/<repo>/ and opened as a space. `now`: no prompt. */
export function newWorktree(v: GitView, options: NewWorktree = {}) {
  const { value = "", base = null, label = null, track = false, now = false, tab, argv } = options;
  const g = v.git;

  if (!g) return;

  const from = label ?? v.data.status?.head ?? "HEAD";

  const go = (branch: string) => {
    const name = branch.trim();

    if (!name) return;

    v.spawn(async () => {
      v.busyText = `Checking out ${name}…`;

      const made = await WT.create(g, name, { base });

      v.busyText = null;

      if ("error" in made) {
        v.error(made.error);
        await loadAll(v);

        return;
      }

      if (track && made.created && base) await g.run("Set upstream", ["-C", made.path, "branch", "--set-upstream-to", base]);

      await loadAll(v);

      const w = v.data.worktrees.find((x) => x.path === made.path) ?? { path: made.path, branch: name };

      v.note(`${name} checked out in ${v.tilde(made.path)}`);
      goToWorktree(v, w, { tab, argv });
    });
  };

  if (now) return go(value);

  const out = new Set(v.data.worktrees.flatMap((w) => (w.branch ? [w.branch] : [])));
  const local = v.data.branches.filter((b) => !out.has(b.name));

  v.prompt({
    title: "New worktree: branch", value,
    placeholder: "a branch: an existing one, or a new name",
    note: `An existing branch is checked out; a new one starts from ${from}. It goes to ${v.tilde(v.userHome ? WT.ROOT(v.userHome) : "~/.herdr/worktrees")}/${g.name}/ and opens as a space.`,
    suggest: (q) => {
      const f = q.trim().toLowerCase();

      return local.flatMap((b) => (!f || b.name.toLowerCase().includes(f) ? [{ value: b.name, sub: b.subject }] : []));
    },
    ok: go,
  });
}

/** d: removes the picked worktrees (M / U / A), else the range, else the
 *  selected one, after one confirm that says what goes with them. */
export function removeWorktrees(v: GitView, list: readonly Checkout[] | null = null) {
  const all = v.items("worktrees").filter(isCheckout);
  let items = list;

  if (!items && v.wtPicked.size) items = v.data.worktrees.filter((w) => v.wtPicked.has(w.path));

  if (!items && v.range?.ctx === "worktrees") {
    const at = v.sel.worktrees ?? 0;

    items = all.slice(Math.min(v.range.anchor, at), Math.max(v.range.anchor, at) + 1);
  }

  if (!items) {
    const x = v.item("worktrees");

    items = isCheckout(x) ? [x] : [];
  }

  if (items.some((w) => w.main)) {
    items = items.filter((w) => !w.main);

    if (!items.length) return v.error("This is the repository's main checkout: it can't be removed (a worktree can).");
  }

  const picked = items;
  const first = picked[0];

  if (!first) return;

  v.note(`Checking ${picked.length === 1 ? WT.label(first) : `${picked.length} worktrees`}…`);
  v.reads.push(async () => {
    const none: Loss = { dirty: 0, subs: 0, unpushed: [] };
    const info = await Promise.all(picked.map((w) => (w.prunable ? none : WT.inspect(w, v.on))));
    const occ = v.occupancy();
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    const dirty = info.filter((x) => x.dirty), subs = info.filter((x) => x.subs), lost = info.flatMap((x) => x.unpushed);
    const spaceN = picked.reduce((k, w) => k + (occ.get(w.path)?.spaces.length ?? 0), 0);
    const agentN = picked.reduce((k, w) => k + (occ.get(w.path)?.agents.length ?? 0), 0);
    const one = picked.length === 1;

    const lines: Line[] = [
      ...(one ? [[`Deletes ${v.tilde(first.path)}. The branch stays unless b.`, "muted"] as const] : picked.slice(0, 6).map((w): Line => [`${WT.label(w)}  ${v.tilde(w.path)}`, "muted"])),
      ...(picked.length > 6 ? [[`and ${picked.length - 6} more`, "dim"] as const] : []),
      ...(dirty.length ? [[one ? `${n(dirty[0]?.dirty ?? 0, "uncommitted file")}: lost` : `${n(dirty.length, "has", "have")} uncommitted changes: lost`, "ansi1"] as const] : []),
      ...(lost.length ? [[`Submodule ${lost.join(", ")} has commits pushed nowhere: lost`, "ansi1"] as const] : []),
      ...(spaceN || agentN ? [[[spaceN ? `closes ${n(spaceN, "space")}` : null, agentN ? `ends ${n(agentN, "agent")}` : null].filter(Boolean).join(", "), agentN ? "ansi1" : "ansi3"] as const] : []),
    ];

    const checks: Check[] = [{ key: "b", label: one ? "also delete its branch" : "also delete their branches", on: false }];

    if (subs.length) checks.push({ key: "s", label: "take the submodules out first (else forced)", on: true });

    v.ask({
      title: one ? `Remove worktree ${WT.label(first)}` : `Remove ${picked.length} worktrees`,
      text: one ? `Remove the worktree ${WT.label(first)}?` : `Remove these ${picked.length} worktrees?`,
      danger: true, lines, checks,
      go: (_cx, answers) => {
        const branch = answers.find((c) => c.key === "b")?.on ?? false;
        const clearSubs = answers.find((c) => c.key === "s")?.on ?? true;

        v.spawn(async () => {
          const g = v.git;

          if (!g) return;

          const failed: string[] = [];
          const leaving = picked.some((w) => w.path === g.root);

          for (const [k, w] of picked.entries()) {
            if (w.prunable) continue;

            const say = (text: string) => { v.busyText = `${picked.length > 1 ? `${k + 1} of ${picked.length}, ` : ""}${WT.label(w)}: ${text}`; };

            const error = await WT.removeOne(g, w, { ...info[k], clearSubs, branch, spaces: occ.get(w.path)?.spaces ?? [] },
              { closeSpace: (s) => run("space.close", { id: s.id, confirmed: true }), step: say });

            if (error) failed.push(`${WT.label(w)}: ${error}`);
            else v.wtPicked.delete(w.path);
          }

          if (picked.some((w) => w.prunable)) await g.run("Prune worktrees", ["worktree", "prune"]);

          v.busyText = null;

          if (failed.length) v.error(`Removed ${picked.length - failed.length} of ${picked.length}. Not removed:\n${failed.join("\n")}`);
          else v.note(one ? `Removed ${WT.label(first)}` : `Removed ${picked.length} worktrees`);

          // The window was on one of them: it goes to the main checkout.
          if (leaving && !failed.length) {
            const main = v.data.worktrees.find((w) => w.main);

            if (main) {
              switchRepo(v, main.path);

              return;
            }
          }

          await loadAll(v);
        });
      },
    });
  });
}

/** M: picks the worktrees whose branch is merged into the main checkout's. */
export function pickMergedWorktrees(v: GitView) {
  const base = v.data.worktrees.find((w) => w.main)?.branch;
  const g = v.git;

  if (!base || !g) return v.error("The main checkout has no branch to compare with.");

  v.reads.push(async () => {
    const merged = await WT.merged(g, base);

    v.wtPicked = new Set(v.data.worktrees.flatMap((w) => (!w.main && w.branch && w.branch !== base && merged.has(w.branch) ? [w.path] : [])));
    v.note(v.wtPicked.size ? `${v.wtPicked.size} merged into ${base} picked: d removes them, esc lets go` : `Nothing merged into ${base}`);
  });
}
