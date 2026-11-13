// Rewriting history without an editor, and undo / redo from the reflog,
// lazygit's way. Pure: tested in scripts/git.test.ts; git.ts runs
// what these return.
//
// Rewrites (squash, fixup, drop, reword, edit, move) are an interactive
// rebase whose todo list this file writes: git.ts hands it to
// `git rebase -i` through GIT_SEQUENCE_EDITOR. The commits from HEAD down to
// the oldest one touched must be one straight line (no merges), as lazygit
// asks for its own rewrites.

export const UNDO = "[git undo]";
export const REDO = "[git redo]";

/** A rewrite of a commit in HEAD's history. */
export type Rewrite = "squash" | "fixup" | "drop" | "reword" | "edit" | "move-down" | "move-up";

/** What a rewrite needs of a commit. */
export interface HistoryCommit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly subject?: string;
}

/** A rewrite's rebase: onto `base` (null: --root), with this todo list; `oldest` the deepest commit touched. */
export interface Plan {
  readonly base: string | null;
  readonly todo: string;
  readonly oldest: number;
}

/** Why a rewrite can't be done. */
export interface Refused {
  readonly error: string;
}

/** The todo verb a rewritten commit gets. */
function verbOf(action: Rewrite) {
  switch (action) {
    case "squash": return "squash";
    case "fixup": return "fixup";
    case "drop": return "drop";
    case "edit": return "edit";
    default: return "pick";
  }
}

/** The rebase for `action` on commit `i` of `commits` (HEAD's history,
 *  newest first, each { hash, parents, subject }). Returns { base (hash, or
 *  null for --root), todo (text), oldest } or { error }. A reword's exec
 *  line reads the new message from $NOCTURNE_GIT_MSG. */
export function rewrite(commits: readonly HistoryCommit[], i: number, action: Rewrite): Plan | Refused {
  const c = commits[i];

  if (!c) return { error: "No commit selected." };

  let oldest = i;

  if (action === "squash" || action === "fixup" || action === "move-down") oldest = i + 1;

  if (action === "move-up" && i === 0) return { error: "It's the newest commit already." };

  const last = commits[oldest];

  if (!last) {
    return { error: action === "move-down" ? "It's the oldest commit shown." : "There's no commit below to meld it into." };
  }

  for (let k = 0; k <= oldest; k++) {
    const x = commits[k];

    if (!x) continue;

    if (x.parents.length > 1) return { error: `${x.hash.slice(0, 7)} is a merge commit: rewrite above it, or rebase by hand.` };

    if (k < oldest && x.parents[0] !== commits[k + 1]?.hash) return { error: "These commits aren't one straight line of history." };
  }

  const base = last.parents[0] ?? null;
  const lines: string[] = [];
  const order = commits.slice(0, oldest + 1).map((x, k) => ({ x, k })).reverse(); // oldest first

  const swap = (a: number, b: number) => {
    const x = order[a], y = order[b];

    if (x && y) {
      order[a] = y;
      order[b] = x;
    }
  };

  if (action === "move-down") swap(0, 1);

  if (action === "move-up") swap(order.findIndex((o) => o.k === i), order.findIndex((o) => o.k === i - 1));

  for (const { x, k } of order) {
    const verb = k !== i ? "pick" : verbOf(action);

    lines.push(`${verb} ${x.hash} ${x.subject ?? ""}`.trimEnd());

    if (k === i && action === "reword") lines.push(`exec ${REWORD_EXEC}`);
  }

  return { base, todo: lines.join("\n") + "\n", oldest };
}

/** The exec line after a reworded commit: amends it with the new message. */
export const REWORD_EXEC = `printf '%s' "$NOCTURNE_GIT_MSG" | git commit --amend --only --allow-empty --cleanup=strip -F -`;

/** What undo reads of a reflog entry. */
export interface Step {
  readonly hash: string;
  readonly subject?: string;
}

/** What a reflog entry did: a checkout, or HEAD moved (reset); made by this window's z / Z (`undo`, `redo`). */
export interface Done {
  readonly kind: "checkout" | "reset";
  readonly from: string;
  readonly to: string;
  readonly undo: boolean;
  readonly redo: boolean;
  readonly i: number;
}

/** What the reflog entry at `i` did, for undo: a checkout { kind: "checkout",
 *  from, to } or a move of HEAD { kind: "reset", from, to }; null for the
 *  steps inside a rebase. `undo` / `redo`: made by this window's z / Z. */
export function reflogAction(reflog: readonly Step[], i: number): Done | null {
  const e = reflog[i];

  if (!e) return null;

  const s = e.subject ?? "";
  const undo = s.startsWith(UNDO), redo = s.startsWith(REDO);
  const m = /moving from (\S+) to (\S+)$/.exec(s);
  const [, from, to] = m ?? [];

  if (from !== undefined && to !== undefined && (undo || redo || s.startsWith("checkout:"))) return { kind: "checkout", from, to, undo, redo, i };

  if (/^rebase( -i| \(\w+\))?.*\((start|pick|squash|fixup|reword|edit|continue|abort|skip)\)/.test(s) || /^rebase (-i )?\((start|pick|squash|fixup|reword|edit|continue|abort|skip)\)/.test(s)) return null;

  if (/^rebase.*\(finish\)/.test(s)) {
    // Back to before the rebase started: the entry under its "(start)".
    let j = i + 1;

    while (j < reflog.length && !/^rebase.*\(start\)/.test(reflog[j]?.subject ?? "")) j++;

    const before = reflog[j + 1];

    // "(finish): returning to refs/heads/x" keeps the hash of the last step.
    return before ? { kind: "reset", from: before.hash, to: e.hash, undo, redo, i } : null;
  }

  const prev = reflog[i + 1];

  if (!prev) return null;

  if (prev.hash === e.hash) return null; // nothing moved

  return { kind: "reset", from: prev.hash, to: e.hash, undo, redo, i };
}

/** The git command that undoes or redoes a step, what the note says, whether it resets --hard. */
export interface Undo {
  readonly args: readonly string[];
  readonly says: string;
  readonly action: "undo" | "redo";
  readonly hard: boolean;
}

/** The git command that undoes the last thing (skipping what was undone
 *  already): { args, says } or null. */
export function nextUndo(reflog: readonly Step[]): Undo | null {
  let counter = 0;

  for (let i = 0; i < reflog.length; i++) {
    const a = reflogAction(reflog, i);

    if (!a) continue;

    if (a.undo) { counter++; continue; }

    if (a.redo) { counter--; continue; }

    if (counter === 0) return undoOf(a, "undo");

    counter--;
  }

  return null;
}

/** The git command that redoes the last undo, or null (something else happened since). */
export function nextRedo(reflog: readonly Step[]): Undo | null {
  let counter = 0;

  for (let i = 0; i < reflog.length; i++) {
    const a = reflogAction(reflog, i);

    if (!a) continue;

    if (a.undo) {
      counter--;

      if (counter === -1) return undoOf(a, "redo");

      continue;
    }

    if (a.redo) { counter++; continue; }

    return null;
  }

  return null;
}

function undoOf(a: Done, what: "undo" | "redo"): Undo {
  if (a.kind === "checkout") return { args: ["checkout", a.from], says: `${what === "undo" ? "Undo" : "Redo"}: checkout ${a.from}`, action: what, hard: false };

  return { args: ["reset", "--hard", a.from], says: `${what === "undo" ? "Undo" : "Redo"}: reset --hard ${a.from.slice(0, 7)}`, action: what, hard: true };
}
