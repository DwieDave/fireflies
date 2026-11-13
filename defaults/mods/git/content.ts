// What the git window's main view shows for the selection: a file's diff, a
// commit's patch, a branch's log (lazygit's git log --graph, read further at
// its end), a worktree, a stash entry, a range in diff mode, a ctrl-p pane's diff.

import { LOG_LIMIT, LOG_FULL_LIMIT } from "./git.ts";
import { layoutGraph, usedWidth } from "./graph.ts";
import type { DiffFile } from "./patch.ts";
import { rows as diffRows } from "./patch.ts";
import { relativeDate } from "./parse.ts";
import * as WT from "./worktrees.ts";
import type { Checkout, Occupants } from "./worktrees.ts";
import type { MainRow, Part } from "./draw.ts";
import { text, short } from "./draw.ts";
import type { MainContent, More, Show } from "./state.ts";
import { LOG_ROW } from "./state.ts";
import { pathOf, isCheckout, isReviewFile, hashOf, statusFileOf, isTreeRow, isStash, nameOf, isRemote } from "./items.ts";
import type { default as GitView } from "./main.ts";
import { loadSub } from "./reads.ts";

export function loadMain(v: GitView) {
  const gen = ++v.mainGen;

  v.reads.push(async () => {
    if (gen !== v.mainGen || !v.git) return;

    const m = await mainContent(v);

    if (gen !== v.mainGen) return;

    v.main = m;
    v.mainTop = Math.min(v.mainTop, Math.max(0, (m.rows.length || 1) - 1));
  });
}

/** The end of a history cut at its limit came into view (`what`: "commits",
 *  "subCommits" or "main"): read as far again, the rows already shown stay
 *  where they are. Once per end: a read already going isn't asked twice. */
export function readMore(v: GitView, what: More) {
  const g = v.git;

  if (v.moreBusy.has(what) || !g) return;

  v.moreBusy.add(what);
  v.reads.push(async () => {
    try {
      if (what === "commits") {
        v.commitLimit += LOG_LIMIT;

        const commits = await g.log("HEAD", { all: v.allBranches, limit: v.commitLimit });

        v.data.commits = commits;
        v.graph = layoutGraph(commits);
      } else if (what === "subCommits") {
        const s = v.subOfKind("subCommits");

        if (s?.kind === "subCommits") {
          s.limit = (s.limit ?? LOG_LIMIT) + LOG_LIMIT;
          await loadSub(v, s);
        }
      } else if (what === "main" && v.main?.more) {
        const ref = v.main.more;

        v.logLimits.set(ref, (v.logLimits.get(ref) ?? LOG_FULL_LIMIT) + LOG_FULL_LIMIT);

        const gen = v.mainGen, m = await mainContent(v);

        if (gen === v.mainGen) v.main = m; // top stays: the new rows come below
      }
    } finally { v.moreBusy.delete(what); }
  });
}

/** lazygit's branch log (git log --graph with whole headers): a block of
 *  rows per commit, the commit line on the lane graph's node, the others
 *  with the lanes running through, in the Commits panel's colors. `more`:
 *  the ref, when its log is cut at the limit and goes further. */
export async function logRows(v: GitView, ref: string): Promise<{ readonly rows: readonly MainRow[]; readonly more: string | null }> {
  const g = v.git;

  if (!g) return { rows: [], more: null };

  const limit = v.logLimits.get(ref) ?? LOG_FULL_LIMIT;
  const commits = await g.logFull(ref, limit);
  const graph = layoutGraph(commits);
  const head = v.data.status?.oid;
  const refColor = { head: "ansi6", branch: "ansi2", ref: "ansi1", tag: "ansi3", detached: "ansi6" } as const;
  const rows: MainRow[] = [];

  commits.forEach((c, i) => {
    const gr = graph.rows[i];

    if (!gr) return;

    const w = usedWidth(gr);
    const line = (parts: readonly Part[]) => rows.push({ kind: "log", g: gr, w, node: false, parts });
    const refs = c.refs.flatMap((r, k): Part[] => [[k ? ", " : " (", "ansi3"], [r.kind === "head" ? `HEAD -> ${r.name}` : r.kind === "tag" ? `tag: ${r.name}` : r.name, refColor[r.kind]]]);

    rows.push({ kind: "log", g: gr, w, node: true, head: c.hash === head, parts: [[`commit ${c.short}`, "ansi3"], ...refs, ...(refs.length ? [[")", "ansi3"] as const] : [])] });

    if (c.parents.length > 1) line([["Merge: ", "dim"], [c.parents.map((p) => p.slice(0, 7)).join(" "), "muted"]]);

    line([["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]]);
    line([["Date:   ", "dim"], [relativeDate(c.date), "muted"]]);

    for (const l of c.message.split("\n")) line([[`    ${l}`, "foreground"]]);

    line([]);
  });

  return { rows: rows.length ? rows : [text("No commits.", "muted")], more: commits.length >= limit ? ref : null };
}

/** A worktree in the main view: where it is, what's in it (spaces,
 *  agents, uncommitted changes), then its branch's log. */
export async function worktreeContent(v: GitView, w: Checkout): Promise<MainContent> {
  const g = v.git;
  const occ: Occupants = v.occupancy().get(w.path) ?? { spaces: [], agents: [] };
  const kv = (k: string, parts: readonly Part[]): MainRow => ({ kind: "text", parts: [[k.padEnd(10), "dim"], ...parts] });
  const rows: MainRow[] = [kv("Worktree", [[v.tilde(w.path), "foreground"], ...(w.main ? [["  (the main checkout)", "dim"] as const] : [])])];

  rows.push(kv("Branch", w.branch ? [[w.branch, "ansi6"]] : [[`detached at ${(w.head ?? "").slice(0, 7)}`, "ansi3"]]));

  if (w.prunable) rows.push(kv("Folder", [["gone: X forgets it (git worktree prune)", "ansi1"]]));
  else if (g) {
    const st = await g.read(["-C", w.path, "status", "--porcelain"]);
    const n = st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null;

    rows.push(kv("Changes", n === null ? [["unreadable", "ansi1"]] : n ? [[`${n} uncommitted file${n === 1 ? "" : "s"}`, "ansi3"]] : [["none", "muted"]]));
  }

  if (w.locked) rows.push(kv("Locked", [["git won't remove it until it's unlocked (git worktree unlock)", "ansi3"]]));

  rows.push(kv("Spaces", occ.spaces.length ? [[occ.spaces.map((s) => s.name || "unnamed").join(", "), "accent"]] : [["none: space opens one", "muted"]]));

  if (occ.agents.length) rows.push(kv("Agents", [[occ.agents.map((a) => `${a.program.name} (${a.status})`).join(", "), "ansi3"]]));

  rows.push(text(""));

  const ref = w.branch ?? w.head;
  const log = ref && !w.prunable ? await logRows(v, ref) : { rows: [], more: null };

  return { title: `Worktree · ${WT.label(w)}`, rows: [...rows, ...log.rows], rowH: LOG_ROW, more: log.more };
}

/** A diff's files as main-view rows: a file's head over each (unless there's one). */
export function flatRows(v: GitView, files: readonly DiffFile[]): MainRow[] {
  const only = files.length === 1 ? files[0] : undefined;

  if (only) return diffRows(only).map((r) => ({ ...r, path: only.path }));

  return files.flatMap((f): MainRow[] => [{ kind: "file", text: f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path, sub: f.binary ? "binary" : `+${f.add} -${f.del}` }, ...diffRows(f).map((r) => ({ ...r, path: f.path }))]);
}

/** A commit's head rows: its hash and refs, a merge's parents, author, date, message. */
export function commitHead(v: GitView, c: { readonly hash: string; readonly refs: string; readonly parents: readonly string[]; readonly author: string; readonly email: string; readonly date: number; readonly body: string }, merge: boolean): MainRow[] {
  return [
    { kind: "text", parts: [[`commit ${c.hash}`, "ansi3"], ...(c.refs ? [[` (${c.refs})`, "ansi5"] as const] : [])] },
    ...(merge && c.parents.length > 1 ? [text(`Merge: ${c.parents.map(short).join(" ")}`, "muted")] : []),
    { kind: "text", parts: [["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]] },
    { kind: "text", parts: [["Date:   ", "dim"], [new Date(c.date * 1000).toLocaleString(), "muted"]] },
    text(""), ...c.body.split("\n").map((l) => text(`    ${l}`, "foreground")), text(""),
  ];
}

/** A ctrl-p pane's one diff (show kinds other than review). */
export async function showContent(v: GitView, s: Exclude<Show, { kind: "review" }>): Promise<MainContent> {
  const g = v.git, opts = { context: v.context, ws: v.ws };

  if (!g) return { title: "", rows: [] };

  if (s.kind === "file") {
    const f = (v.data.status?.files ?? []).find((x) => x.path === s.path);

    if (!f) return { title: s.path, path: s.path, rows: [text("No changes in this file now.", "muted")] };

    const [un, st] = await Promise.all([f.unstaged ? g.fileDiff(f, opts) : null, f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null]);

    const rows: MainRow[] = [
      ...(un ? [{ kind: "file", text: "unstaged", sub: `+${un.add} -${un.del}` } as const, ...diffRows(un).map((r) => ({ ...r, path: f.path }))] : []),
      ...(st ? [{ kind: "file", text: "staged", sub: `+${st.add} -${st.del}` } as const, ...diffRows(st).map((r) => ({ ...r, path: f.path }))] : []),
    ];

    return { title: `Working diff · ${f.path}`, path: f.path, rows: rows.length ? rows : [text("No text changes (mode, rename or binary).", "muted")] };
  }

  if (s.kind === "commit") {
    const c = await g.show(s.hash, { ...opts, path: s.path ?? null });

    if (!c) return { title: short(s.hash), rows: [text("Not a commit.", "muted")] };

    return { title: `Patch · ${short(c.hash)}${s.path ? ` · ${s.path}` : ""}`, rows: [...commitHead(v, c, false), ...flatRows(v, c.files)] };
  }

  if (s.kind === "stash") {
    const files = (await g.stashShow(s.ref, opts)).filter((f) => !s.path || f.path === s.path);

    return { title: `Stash · ${short(s.ref)}${s.path ? ` · ${s.path}` : ""}`, rows: files.length ? flatRows(v, files) : [text("Empty stash entry.", "muted")] };
  }

  if (s.kind === "log") {
    const log = await logRows(v, s.ref);

    return { title: `Log · ${s.ref}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
  }

  const files = await g.between(s.a, s.b, opts);

  return { title: `Diff ${short(s.a)}..${short(s.b)}`, rows: files.length ? flatRows(v, files) : [text("No differences.", "muted")] };
}

export async function mainContent(v: GitView): Promise<MainContent> {
  if (v.show && v.show.kind !== "review") return showContent(v, v.show);

  const g = v.git, ctx = v.ctxOf(v.panel), x = v.item(ctx), opts = { context: v.context, ws: v.ws };

  if (!g) return { title: "", rows: [] };

  const ref = hashOf(x) ?? (ctx === "branches" || ctx === "tags" || ctx === "remoteBranches" ? nameOf(x) : null);

  if (v.diffBase && ref) {
    const [a, b] = v.diffReverse ? [ref, v.diffBase] : [v.diffBase, ref];
    const files = await g.between(a, b, opts);

    return { title: `Diff ${short(a)}..${short(b)}`, rows: files.length ? flatRows(v, files) : [text("No differences.")] };
  }

  if (!x) return { title: "", rows: [] };

  switch (ctx) {
    case "status": {
      const s = v.data.status;
      const n = (s?.files ?? []).length;

      return { title: "Status", rows: [
        text(`${g.name}`, "foreground"), text(g.root, "dim"), text(""),
        text(`on ${s?.head ?? "a detached HEAD"}${s?.upstream ? ` → ${s.upstream}` : " (no upstream)"}`, "ansi6"),
        ...(s?.upstream ? [text(`↑${s.ahead} ahead · ↓${s.behind} behind`, "ansi4")] : []),
        ...(v.data.state ? [text(`${v.data.state}: m for continue / abort`, "ansi3")] : []),
        text(`${n} changed file${n === 1 ? "" : "s"} · ${v.data.stash.length} stash entr${v.data.stash.length === 1 ? "y" : "ies"} · ${v.data.branches.length} branches`, "muted"),
        text(""), text("? lists every key · 1-5 jump to a panel · + widens it · enter on Status: recent repos", "dim"),
      ] };
    }

    case "files": {
      if (isTreeRow(x) && x.kind === "dir") {
        const files = await g.between("HEAD", null, { ...opts, path: x.path });
        const n = x.files.length;

        return { title: `${x.path} · ${n} file${n === 1 ? "" : "s"}`, rows: files.length ? flatRows(v, files) : [text(`${n} new file${n === 1 ? "" : "s"} under ${x.path}`, "muted")] };
      }

      const f = statusFileOf(x);

      if (!f) return { title: "", rows: [] };

      const [un, st] = await Promise.all([
        f.unstaged ? g.fileDiff(f, { ...opts }) : null,
        f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null,
      ]);

      const shown = f.unstaged ? un : st;

      return {
        title: f.unstaged ? "Unstaged changes" : "Staged changes", path: f.path,
        rows: shown ? diffRows(shown).map((r) => ({ ...r, path: f.path })) : [text(f.conflict ? "Merge conflict: enter or M for the options." : "No text changes (mode, rename or binary).", "muted")],
        second: f.unstaged && st ? { title: "Staged changes", rows: diffRows(st) } : null,
      };
    }

    case "review": {
      if (!isReviewFile(x)) return { title: "", rows: [] };

      const f = x;
      const rows = f.binary ? [text("Binary file: not shown.", "muted")] : !f.hunks.length ? [text(f.status === "untracked" ? "Untracked, not diffed (too many new files)." : "No text changes (mode or rename only).", "muted")] : diffRows(f).map((r) => ({ ...r, path: f.path }));

      return { title: `${v.review.scopeName()} · ${f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path}`, path: f.path, rows };
    }

    case "worktrees": return isCheckout(x) ? worktreeContent(v, x) : { title: "", rows: [] };
    case "remotes": {
      if (!isRemote(x)) return { title: "", rows: [] };

      return { title: x.name, rows: [text(`fetch ${x.url}`, "foreground"), text(`push  ${x.push}`, "muted"), text(""), ...v.data.remoteBranches.filter((r) => r.remote === x.name).slice(0, 40).map((r) => text(`${r.branch}  ${r.subject}`, "muted"))] };
    }

    case "branches": case "remoteBranches": case "tags": {
      const name = nameOf(x) ?? "";
      const log = await logRows(v, name);

      return { title: `Log · ${name}`, rows: log.rows, rowH: LOG_ROW, more: log.more };
    }

    case "commits": case "subCommits": case "reflog": {
      const hash = hashOf(x) ?? "";
      const c = await g.show(hash, opts);

      if (!c) return { title: short(hash), rows: [text("Not a commit.", "muted")] };

      return { title: `Patch · ${short(c.hash)}`, rows: [...commitHead(v, c, true), ...flatRows(v, c.files)] };
    }

    case "commitFiles": {
      const s = v.sub();

      if (isTreeRow(x) && x.kind === "dir") return { title: x.path, rows: [text(`${x.files.length} files under ${x.path}`, "muted")] };

      if (s?.kind !== "commitFiles") return { title: "", rows: [] };

      const path = pathOf(x) ?? "";
      const files = s.stash ? (await g.stashShow(s.hash, opts)).filter((d) => d.path === path) : (await g.show(s.hash, { ...opts, path }))?.files ?? [];

      return { title: `${short(s.hash)} · ${path}`, rows: files.length ? flatRows(v, files) : [text("No text changes.", "muted")] };
    }

    case "stash": {
      if (!isStash(x)) return { title: "", rows: [] };

      const files = await g.stashShow(x.ref, opts);

      return { title: `${x.ref} · ${x.subject}`, rows: files.length ? flatRows(v, files) : [text("Empty stash entry.", "muted")] };
    }
  }
}
