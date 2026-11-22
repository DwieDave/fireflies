// Rewriting history without an editor, and undo / redo from the reflog,
// lazygit's way. Pure: tested in scripts/git.test.ts; git.ts runs
// what these return.
//
// Rewrites (squash, fixup, drop, reword, edit, move) are an interactive
// rebase whose todo list this file writes: git.ts hands it to
// `git rebase -i` through GIT_SEQUENCE_EDITOR. The commits from HEAD down to
// the oldest one touched must be one straight line (no merges), as lazygit
// asks for its own rewrites.

import { Array as Arr, Option, String as Str } from "effect";

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
  if (Option.isNone(Arr.get(commits, i))) return { error: "No commit selected." };

  let oldest = i;

  if (action === "squash" || action === "fixup" || action === "move-down") oldest = i + 1;

  if (action === "move-up" && i === 0) return { error: "It's the newest commit already." };

  const lastOne = Arr.get(commits, oldest);

  if (Option.isNone(lastOne)) {
    return { error: action === "move-down" ? "It's the oldest commit shown." : "There's no commit below to meld it into." };
  }

  const touched = Arr.take(commits, oldest + 1);

  for (const [k, x] of touched.entries()) {
    if (x.parents.length > 1) return { error: `${Str.slice(0, 7)(x.hash)} is a merge commit: rewrite above it, or rebase by hand.` };

    if (k < oldest && Option.getOrNull(Arr.head(x.parents)) !== Option.getOrNull(Option.map(Arr.get(commits, k + 1), (c) => c.hash))) return { error: "These commits aren't one straight line of history." };
  }

  const base = Option.getOrNull(Arr.head(lastOne.value.parents));
  const order = Arr.reverse(Arr.map(touched, (x, k) => ({ x, k }))); // oldest first
  const indexOf = (k: number) => Option.getOrElse(Arr.findFirstIndex(order, (o) => o.k === k), () => -1);

  const swap = (a: number, b: number) => {
    const x = Arr.get(order, a), y = Arr.get(order, b);

    if (Option.isSome(x) && Option.isSome(y)) {
      order[a] = y.value;
      order[b] = x.value;
    }
  };

  if (action === "move-down") swap(0, 1);

  if (action === "move-up") swap(indexOf(i), indexOf(i - 1));

  const lines = Arr.flatMap(order, ({ x, k }) => {
    const line = Str.trimEnd(`${k !== i ? "pick" : verbOf(action)} ${x.hash} ${x.subject ?? ""}`);

    return k === i && action === "reword" ? [line, `exec ${REWORD_EXEC}`] : [line];
  });

  return { base, todo: Arr.join(lines, "\n") + "\n", oldest };
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
  const got = Arr.get(reflog, i);

  if (Option.isNone(got)) return null;

  const e = got.value;
  const s = e.subject ?? "";
  const undo = Str.startsWith(UNDO)(s), redo = Str.startsWith(REDO)(s);
  const m = /moving from (\S+) to (\S+)$/.exec(s);
  const from = m?.[1], to = m?.[2];

  if (from !== undefined && to !== undefined && (undo || redo || Str.startsWith("checkout:")(s))) return { kind: "checkout", from, to, undo, redo, i };

  if (/^rebase( -i| \(\w+\))?.*\((start|pick|squash|fixup|reword|edit|continue|abort|skip)\)/.test(s) || /^rebase (-i )?\((start|pick|squash|fixup|reword|edit|continue|abort|skip)\)/.test(s)) return null;

  if (/^rebase.*\(finish\)/.test(s)) {
    // Back to before the rebase started: the entry under its "(start)".
    let j = i + 1;

    const subjectAt = (k: number) => Option.getOrElse(Option.flatMap(Arr.get(reflog, k), (x) => Option.fromUndefinedOr(x.subject)), () => "");

    while (j < reflog.length && !/^rebase.*\(start\)/.test(subjectAt(j))) j++;

    // "(finish): returning to refs/heads/x" keeps the hash of the last step.
    return Option.match(Arr.get(reflog, j + 1), { onNone: () => null, onSome: (before): Done => ({ kind: "reset", from: before.hash, to: e.hash, undo, redo, i }) });
  }

  // Nothing moved: no step.
  return Option.match(Arr.get(reflog, i + 1), { onNone: () => null, onSome: (prev): Done | null => (prev.hash === e.hash ? null : { kind: "reset", from: prev.hash, to: e.hash, undo, redo, i }) });
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

    if (a === null) continue;

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

    if (a === null) continue;

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

  return { args: ["reset", "--hard", a.from], says: `${what === "undo" ? "Undo" : "Redo"}: reset --hard ${Str.slice(0, 7)(a.from)}`, action: what, hard: true };
}
