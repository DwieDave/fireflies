// The git window's ctrl-p panes: what the main view shows as a pane's { show },
// opening it beside or in a new tab, and closing or leaving (q, esc, back to
// the GitHub window).

import { panes, run, closeOverlay, openOverlay } from "herdr";
import type { Show } from "./state.ts";
import { isGitProps } from "./state.ts";
import { pathOf, hashOf, isBranch, isRemoteBranch, isTag, statusFileOf, isTreeRow, isStash, nameOf } from "./items.ts";
import type { default as GitView } from "./main.ts";

/** A ctrl-p tab's name. */
export function paneName(s: Show) {
  switch (s.kind) {
    case "file": return s.path.split("/").pop() ?? s.path;
    case "review": return s.pr ? `#${s.pr}` : "review";
    case "range": return "diff";
    case "log": return s.ref;
    case "commit": return s.hash.slice(0, 7);
    case "stash": return s.ref.slice(0, 7);
  }
}

/** What the main view shows now, as a pane's { show } (null: nothing to open). */
export function showNow(v: GitView): Show | null {
  const ctx = v.ctxOf(v.panel), x = v.item(ctx);

  if (v.diffBase) {
    const ref = hashOf(x) ?? (isBranch(x) || isRemoteBranch(x) || isTag(x) ? x.oid : null);

    if (ref) return v.diffReverse ? { kind: "range", a: ref, b: v.diffBase } : { kind: "range", a: v.diffBase, b: ref };
  }

  if (v.staging) return { kind: "file", path: v.staging.file.path };

  switch (ctx) {
    case "files": {
      const f = statusFileOf(x);

      if (f) return { kind: "file", path: f.path };

      const first = isTreeRow(x) && x.kind === "dir" ? x.files[0]?.path : undefined;

      return isTreeRow(x) && x.kind === "dir" ? (first === undefined ? { kind: "review", scope: "work" } : { kind: "review", scope: "work", path: first }) : null;
    }

    case "review": {
      const review: Show = v.review.pr ? { kind: "review", scope: v.review.scope, pr: v.review.pr, repo: v.review.prRepo } : { kind: "review", scope: v.review.scope };
      const path = pathOf(x);

      return path ? { ...review, path } : review;
    }

    case "commits": case "subCommits": case "reflog": {
      const hash = hashOf(x);

      return hash ? { kind: "commit", hash } : null;
    }

    case "commitFiles": {
      const s = v.sub();

      if (s?.kind !== "commitFiles") return null;

      const path = isTreeRow(x) && x.kind === "dir" ? null : pathOf(x);

      return s.stash ? (path ? { kind: "stash", ref: s.hash, path } : { kind: "stash", ref: s.hash }) : (path ? { kind: "commit", hash: s.hash, path } : { kind: "commit", hash: s.hash });
    }

    case "stash": return isStash(x) ? { kind: "stash", ref: x.hash } : null;
    case "branches": case "tags": case "remoteBranches": {
      const name = nameOf(x);

      return name ? { kind: "log", ref: name } : null;
    }

    default: return null;
  }
}

/** ctrl-p: the main view as a pane beside the focused pane (tab: in a new
 *  tab); the window steps aside. */
export function openPane(v: GitView, tab = false) {
  const g = v.git;
  const show = g ? v.showNow() : null;

  if (!g || !show) return v.error("Nothing in the main view to open as a pane.");

  const paneId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const props = v.on ? { folder: g.root, on: v.on, show, paneId } : { folder: g.root, show, paneId };

  if (tab) run("tab.new", { mod: "git", props, name: paneName(show) });
  else run("pane.split", { direction: "auto", mod: "git", props });

  // The window steps aside a moment later: closed in the same turn, the new
  // pane's first tasks were cancelled with it (it stayed on "Reading…").
  if (v.overlay) {
    v.saveState();

    const id = v.overlay;

    v.later(() => closeOverlay(id), 300);
  }
}

/** Closes this copy's own pane (a ctrl-p pane finds itself by its paneId prop). */
export function closePane(v: GitView) {
  const id = v.paneId;
  const mine = id ? panes().find((p) => p.mod === "git" && isGitProps(p.props) && p.props.paneId === id) : undefined;

  run("pane.close", mine ? { pane: mine.pane } : {});
}

export function goBack(v: GitView) {
  const back = v.backTo;

  if (!back) return;

  v.saveState();
  openOverlay({ mod: back.mod, kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: back.props ?? {} });
}

/** q: back to the GitHub window when it opened this, else close. esc
 *  at the top level closes only a window (a pane stays). */
export function quit(v: GitView, fromEsc = false) {
  if (v.show) return closePane(v);

  if (v.backTo) return v.goBack();

  if (v.overlay) {
    v.saveState();
    closeOverlay(v.overlay);

    return;
  }

  if (!fromEsc) run("pane.close");
}
