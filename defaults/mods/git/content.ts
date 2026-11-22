// What the git window's main view shows for the selection: a file's diff, a
// commit's patch, a branch's log (lazygit's git log --graph, read further at
// its end), a worktree, a stash entry, a range in diff mode, a ctrl-p pane's diff.
// Each is read on the copy's reads lane (main.ts `read`), so it ends with the window.

import { Array as Arr, Clock, Effect, Match, Option, String as Str } from "effect";
import { localStamp } from "@fireflies/kit";
import { LOG_LIMIT, LOG_FULL_LIMIT } from "./git.ts";
import type { DiffOptions, Git, GitError } from "./git.ts";
import { layoutGraph, usedWidth } from "./graph.ts";
import type { DiffFile } from "./patch.ts";
import { rows as diffRows } from "./patch.ts";
import { relativeDate } from "./parse.ts";
import type { StatusFile } from "./parse.ts";
import * as WT from "./worktrees.ts";
import type { Checkout, Occupants } from "./worktrees.ts";
import type { MainRow, Part } from "./draw.ts";
import { text, short } from "./draw.ts";
import type { MainContent, More, Show } from "./state.ts";
import { LOG_ROW } from "./state.ts";
import { pathOf, isCheckout, isReviewFile, hashOf, statusFileOf, isTreeRow, isStash, nameOf, isRemote } from "./items.ts";
import type { GitServices } from "./fx.ts";
import type { default as GitView } from "./main.ts";
import { loadSub } from "./reads.ts";

type Read<A> = Effect.Effect<A, GitError, GitServices>;

const NOTHING: MainContent = { title: "", rows: [] };

/** "s" when `n` isn't one. */
const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;

/** Reads what the main view shows for the selection now (a newer selection's read replaces one not done yet). */
export function loadMain(v: GitView): void {
  const gen = ++v.mainGen;

  v.read(Effect.gen(function* () {
    if (gen !== v.mainGen || v.git === null) return;

    const m = yield* mainContent(v);

    if (gen !== v.mainGen) return;

    v.main = m;
    v.mainTop = Math.min(v.mainTop, Math.max(0, Math.max(m.rows.length, 1) - 1));
  }));
}

/** The end of a history cut at its limit came into view (`what`: "commits",
 *  "subCommits" or "main"): read as far again, the rows already shown stay
 *  where they are. Once per end: a read already going isn't asked twice. */
export function readMore(v: GitView, what: More): void {
  const g = v.git;

  if (v.moreBusy.has(what) || g === null) return;

  v.moreBusy.add(what);
  v.read(Effect.gen(function* () {
    if (what === "commits") {
      v.commitLimit += LOG_LIMIT;

      const commits = yield* g.log("HEAD", { all: v.allBranches, limit: v.commitLimit });

      v.data.commits = commits;
      v.graph = layoutGraph(commits);
    } else if (what === "subCommits") {
      const s = v.subOfKind("subCommits");

      if (s?.kind === "subCommits") {
        s.limit = (s.limit ?? LOG_LIMIT) + LOG_LIMIT;
        yield* loadSub(v, s);
      }
    } else {
      const ref = v.main?.more ?? null;

      if (ref === null) return;

      v.logLimits.set(ref, (v.logLimits.get(ref) ?? LOG_FULL_LIMIT) + LOG_FULL_LIMIT);

      const gen = v.mainGen, m = yield* mainContent(v);

      if (gen === v.mainGen) v.main = m; // top stays: the new rows come below
    }
  }).pipe(Effect.ensuring(Effect.sync(() => { v.moreBusy.delete(what); }))));
}

const REF_COLOR = { head: "ansi6", branch: "ansi2", ref: "ansi1", tag: "ansi3", detached: "ansi6" } as const;

/** A ref as git log --decorate prints it. */
const refName = (r: { readonly kind: keyof typeof REF_COLOR; readonly name: string }): string => Match.value(r.kind).pipe(
  Match.when("head", () => `HEAD -> ${r.name}`),
  Match.when("tag", () => `tag: ${r.name}`),
  Match.orElse(() => r.name),
);

/** lazygit's branch log (git log --graph with whole headers): a block of
 *  rows per commit, the commit line on the lane graph's node, the others
 *  with the lanes running through, in the Commits panel's colors. `more`:
 *  the ref, when its log is cut at the limit and goes further. */
export function logRows(v: GitView, ref: string): Read<{ readonly rows: readonly MainRow[]; readonly more: string | null }> {
  return Effect.gen(function* () {
    const g = v.git;

    if (g === null) return { rows: [], more: null };

    const limit = v.logLimits.get(ref) ?? LOG_FULL_LIMIT;
    const commits = yield* g.logFull(ref, limit);
    const now = (yield* Clock.currentTimeMillis) / 1000;
    const graph = layoutGraph(commits);
    const head = v.data.status?.oid;
    const rows: MainRow[] = [];

    Arr.forEach(commits, (c, i) => {
      const gr = graph.rows[i];

      if (gr === undefined) return;

      const w = usedWidth(gr);
      const line = (parts: readonly Part[]) => rows.push({ kind: "log", g: gr, w, node: false, parts });
      const refs = Arr.flatMap(c.refs, (r, k): Part[] => [[k > 0 ? ", " : " (", "ansi3"], [refName(r), REF_COLOR[r.kind]]]);

      rows.push({ kind: "log", g: gr, w, node: true, head: c.hash === head, parts: [[`commit ${c.short}`, "ansi3"], ...refs, ...(Arr.isReadonlyArrayNonEmpty(refs) ? [[")", "ansi3"] as const] : [])] });

      if (c.parents.length > 1) line([["Merge: ", "dim"], [Arr.join(Arr.map(c.parents, (p) => Str.slice(0, 7)(p)), " "), "muted"]]);

      line([["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]]);
      line([["Date:   ", "dim"], [relativeDate(c.date, now), "muted"]]);

      for (const l of Str.split(c.message, "\n")) line([[`    ${l}`, "foreground"]]);

      line([]);
    });

    return { rows: Arr.isReadonlyArrayNonEmpty(rows) ? rows : [text("No commits.", "muted")], more: commits.length >= limit ? ref : null };
  });
}

/** A worktree in the main view: where it is, what's in it (spaces,
 *  agents, uncommitted changes), then its branch's log. */
export function worktreeContent(v: GitView, w: Checkout): Read<MainContent> {
  return Effect.gen(function* () {
    const g = v.git;
    const occ: Occupants = v.occupancy().get(w.path) ?? { spaces: [], agents: [] };
    const kv = (k: string, parts: readonly Part[]): MainRow => ({ kind: "text", parts: [[Str.padEnd(10)(k), "dim"], ...parts] });
    const rows: MainRow[] = [kv("Worktree", [[v.tilde(w.path), "foreground"], ...(w.main ? [["  (the main checkout)", "dim"] as const] : [])])];

    rows.push(kv("Branch", w.branch === null ? [[`detached at ${Str.slice(0, 7)(w.head ?? "")}`, "ansi3"]] : [[w.branch, "ansi6"]]));

    if (w.prunable) rows.push(kv("Folder", [["gone: X forgets it (git worktree prune)", "ansi1"]]));
    else if (g !== null) {
      // Its changes are one line of the card: a status git can't give (or can't run for) says "unreadable".
      const st = yield* g.read(["-C", w.path, "status", "--porcelain"]).pipe(Effect.option);
      const n = Option.flatMap(st, (r) => (r.code === 0 ? Option.some(Arr.filter(Str.split(r.stdout, "\n"), Str.isNonEmpty).length) : Option.none()));

      rows.push(kv("Changes", Option.match(n, {
        onNone: (): readonly Part[] => [["unreadable", "ansi1"]],
        onSome: (k): readonly Part[] => (k > 0 ? [[`${plural(k, "uncommitted file")}`, "ansi3"]] : [["none", "muted"]]),
      })));
    }

    if (w.locked) rows.push(kv("Locked", [["git won't remove it until it's unlocked (git worktree unlock)", "ansi3"]]));

    rows.push(kv("Spaces", Arr.isReadonlyArrayNonEmpty(occ.spaces) ? [[Arr.join(Arr.map(occ.spaces, (s) => (Str.isEmpty(s.name) ? "unnamed" : s.name)), ", "), "accent"]] : [["none: space opens one", "muted"]]));

    if (Arr.isReadonlyArrayNonEmpty(occ.agents)) rows.push(kv("Agents", [[Arr.join(Arr.map(occ.agents, (a) => `${a.program.name} (${a.status})`), ", "), "ansi3"]]));

    rows.push(text(""));

    const ref = w.branch ?? w.head;
    const log = ref !== null && !Str.isEmpty(ref) && !w.prunable ? yield* logRows(v, ref) : { rows: [], more: null };

    return { title: `Worktree · ${WT.label(w)}`, rows: [...rows, ...log.rows], rowH: LOG_ROW, more: log.more };
  });
}

/** A file's rows in a diff, each knowing its path. */
const fileRows = (f: DiffFile): MainRow[] => Arr.map(diffRows(f), (r) => ({ ...r, path: f.path }));

/** A diff's files as main-view rows: a file's head over each (unless there's one). */
export function flatRows(files: readonly DiffFile[]): MainRow[] {
  if (files.length === 1) return Arr.flatMap(files, fileRows);

  return Arr.flatMap(files, (f): MainRow[] => [{ kind: "file", text: f.status === "renamed" && f.old !== null ? `${f.old} → ${f.path}` : f.path, sub: f.binary ? "binary" : `+${f.add} -${f.del}` }, ...fileRows(f)]);
}

/** A commit's head as the main view shows it. */
interface Head {
  readonly hash: string;
  readonly refs: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: number;
  readonly body: string;
}

/** A commit's head rows: its hash and refs, a merge's parents, author, date, message. */
export function commitHead(c: Head, merge: boolean): MainRow[] {
  return [
    { kind: "text", parts: [[`commit ${c.hash}`, "ansi3"], ...(Str.isEmpty(c.refs) ? [] : [[` (${c.refs})`, "ansi5"] as const])] },
    ...(merge && c.parents.length > 1 ? [text(`Merge: ${Arr.join(Arr.map(c.parents, short), " ")}`, "muted")] : []),
    { kind: "text", parts: [["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]] },
    { kind: "text", parts: [["Date:   ", "dim"], [localStamp(c.date * 1000, { seconds: true, zone: true }), "muted"]] },
    text(""), ...Arr.map(Str.split(c.body, "\n"), (l) => text(`    ${l}`, "foreground")), text(""),
  ];
}

/** The rows of files, or one line saying there are none. */
const filesOr = (files: readonly DiffFile[], none: string): readonly MainRow[] => (Arr.isReadonlyArrayNonEmpty(files) ? flatRows(files) : [text(none, "muted")]);

/** " · path" when there's one. */
const pathNote = (path: string | undefined): string => (path === undefined || Str.isEmpty(path) ? "" : ` · ${path}`);

/** A working file's unstaged and staged diffs (none for a side it has no changes on). */
function bothSides(v: GitView, f: StatusFile, opts: DiffOptions): Read<readonly [DiffFile | null, DiffFile | null]> {
  const g = v.git;

  if (g === null) return Effect.succeed([null, null] as const);

  return Effect.all([
    f.unstaged ? g.fileDiff(f, opts) : Effect.succeed(null),
    f.staged ? g.fileDiff(f, { cached: true, ...opts }) : Effect.succeed(null),
  ], { concurrency: "unbounded" });
}

/** A ctrl-p pane's one diff (show kinds other than review). */
export function showContent(v: GitView, s: Exclude<Show, { kind: "review" }>): Read<MainContent> {
  return Effect.gen(function* () {
    const g = v.git, opts = { context: v.context, ws: v.ws };

    if (g === null) return NOTHING;

    switch (s.kind) {
      case "file": {
        const found = Arr.findFirst(v.data.status?.files ?? [], (x) => x.path === s.path);

        if (Option.isNone(found)) return { title: s.path, path: s.path, rows: [text("No changes in this file now.", "muted")] };

        const f = found.value;
        const [un, st] = yield* bothSides(v, f, opts);

        const rows: MainRow[] = [
          ...(un === null ? [] : [{ kind: "file", text: "unstaged", sub: `+${un.add} -${un.del}` } as const, ...fileRows(un)]),
          ...(st === null ? [] : [{ kind: "file", text: "staged", sub: `+${st.add} -${st.del}` } as const, ...fileRows(st)]),
        ];

        return { title: `Working diff · ${f.path}`, path: f.path, rows: Arr.isReadonlyArrayNonEmpty(rows) ? rows : [text("No text changes (mode, rename or binary).", "muted")] };
      }

      case "commit": {
        const shown = yield* g.show(s.hash, { ...opts, path: s.path ?? null });

        return Option.match(shown, {
          onNone: (): MainContent => ({ title: short(s.hash), rows: [text("Not a commit.", "muted")] }),
          onSome: (c): MainContent => ({ title: `Patch · ${short(c.hash)}${pathNote(s.path)}`, rows: [...commitHead(c, false), ...flatRows(c.files)] }),
        });
      }

      case "stash": {
        const all = yield* g.stashShow(s.ref, opts);
        const files = Arr.filter(all, (f) => s.path === undefined || Str.isEmpty(s.path) || f.path === s.path);

        return { title: `Stash · ${short(s.ref)}${pathNote(s.path)}`, rows: filesOr(files, "Empty stash entry.") };
      }

      case "log": {
        const log = yield* logRows(v, s.ref);

        return { title: `Log · ${s.ref}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
      }

      case "range": {
        const files = yield* g.between(s.a, s.b, opts);

        return { title: `Diff ${short(s.a)}..${short(s.b)}`, rows: filesOr(files, "No differences.") };
      }
    }
  });
}

/** The Status panel's card: the repo, its branch and upstream, what's going on in it. */
function statusContent(v: GitView, g: Git): MainContent {
  const s = v.data.status;
  const n = (s?.files ?? []).length;
  const up = s?.upstream ?? null;
  const stash = v.data.stash.length;

  return { title: "Status", rows: [
    text(g.name, "foreground"), text(g.root, "dim"), text(""),
    text(`on ${s?.head ?? "a detached HEAD"}${up === null ? " (no upstream)" : ` → ${up}`}`, "ansi6"),
    ...(up === null || s === null ? [] : [text(`↑${s.ahead} ahead · ↓${s.behind} behind`, "ansi4")]),
    ...(v.data.state === null ? [] : [text(`${v.data.state}: m for continue / abort`, "ansi3")]),
    text(`${plural(n, "changed file")} · ${plural(stash, "stash entry", "stash entries")} · ${v.data.branches.length} branches`, "muted"),
    text(""), text("? lists every key · 1-5 jump to a panel · + widens it · enter on Status: recent repos", "dim"),
  ] };
}

/** What the main view shows for the selected row (or a ctrl-p pane's diff). */
export function mainContent(v: GitView): Read<MainContent> {
  return Effect.gen(function* () {
    if (v.show !== null && v.show.kind !== "review") return yield* showContent(v, v.show);

    const g = v.git, ctx = v.ctxOf(v.panel), x = v.item(ctx), opts = { context: v.context, ws: v.ws };

    if (g === null) return NOTHING;

    const ref = hashOf(x) ?? (ctx === "branches" || ctx === "tags" || ctx === "remoteBranches" ? nameOf(x) : null);

    if (v.diffBase !== null && ref !== null) {
      const [a, b] = v.diffReverse ? [ref, v.diffBase] : [v.diffBase, ref];
      const files = yield* g.between(a, b, opts);

      return { title: `Diff ${short(a)}..${short(b)}`, rows: Arr.isReadonlyArrayNonEmpty(files) ? flatRows(files) : [text("No differences.")] };
    }

    if (x === null) return NOTHING;

    switch (ctx) {
      case "status": return statusContent(v, g);

      case "files": {
        if (isTreeRow(x) && x.kind === "dir") {
          const files = yield* g.between("HEAD", null, { ...opts, path: x.path });
          const n = x.files.length;

          return { title: `${x.path} · ${plural(n, "file")}`, rows: Arr.isReadonlyArrayNonEmpty(files) ? flatRows(files) : [text(`${plural(n, "new file")} under ${x.path}`, "muted")] };
        }

        const f = statusFileOf(x);

        if (f === null) return NOTHING;

        const [un, st] = yield* bothSides(v, f, opts);
        const shown = f.unstaged ? un : st;

        return {
          title: f.unstaged ? "Unstaged changes" : "Staged changes", path: f.path,
          rows: shown === null ? [text(f.conflict ? "Merge conflict: enter or M for the options." : "No text changes (mode, rename or binary).", "muted")] : fileRows(shown),
          second: f.unstaged && st !== null ? { title: "Staged changes", rows: diffRows(st) } : null,
        };
      }

      case "review": {
        if (!isReviewFile(x)) return NOTHING;

        const f = x;

        const rows = f.binary ? [text("Binary file: not shown.", "muted")]
          : Arr.isReadonlyArrayNonEmpty(f.hunks) ? fileRows(f)
          : [text(f.status === "untracked" ? "Untracked, not diffed (too many new files)." : "No text changes (mode or rename only).", "muted")];

        return { title: `${v.review.scopeName()} · ${f.status === "renamed" && f.old !== null ? `${f.old} → ${f.path}` : f.path}`, path: f.path, rows };
      }

      case "worktrees": return isCheckout(x) ? yield* worktreeContent(v, x) : NOTHING;
      case "remotes": {
        if (!isRemote(x)) return NOTHING;

        const branches = Arr.take(Arr.filter(v.data.remoteBranches, (r) => r.remote === x.name), 40);

        return { title: x.name, rows: [text(`fetch ${x.url}`, "foreground"), text(`push  ${x.push}`, "muted"), text(""), ...Arr.map(branches, (r) => text(`${r.branch}  ${r.subject}`, "muted"))] };
      }

      case "branches": case "remoteBranches": case "tags": {
        const name = nameOf(x) ?? "";
        const log = yield* logRows(v, name);

        return { title: `Log · ${name}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
      }

      case "commits": case "subCommits": case "reflog": {
        const hash = hashOf(x) ?? "";
        const shown = yield* g.show(hash, opts);

        return Option.match(shown, {
          onNone: (): MainContent => ({ title: short(hash), rows: [text("Not a commit.", "muted")] }),
          onSome: (c): MainContent => ({ title: `Patch · ${short(c.hash)}`, rows: [...commitHead(c, true), ...flatRows(c.files)] }),
        });
      }

      case "commitFiles": {
        const s = v.sub();

        if (isTreeRow(x) && x.kind === "dir") return { title: x.path, rows: [text(`${x.files.length} files under ${x.path}`, "muted")] };

        if (s?.kind !== "commitFiles") return NOTHING;

        const path = pathOf(x) ?? "";

        const files = s.stash
          ? yield* Effect.map(g.stashShow(s.hash, opts), Arr.filter((d) => d.path === path))
          : yield* Effect.map(g.show(s.hash, { ...opts, path }), Option.match({ onNone: (): readonly DiffFile[] => [], onSome: (c) => c.files }));

        return { title: `${short(s.hash)} · ${path}`, rows: filesOr(files, "No text changes.") };
      }

      case "stash": {
        if (!isStash(x)) return NOTHING;

        const files = yield* g.stashShow(x.ref, opts);

        return { title: `${x.ref} · ${x.subject}`, rows: filesOr(files, "Empty stash entry.") };
      }
    }
  });
}
