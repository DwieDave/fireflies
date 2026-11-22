// The git window's ctrl-p panes: what the main view shows as a pane's { show },
// opening it beside or in a new tab, and closing or leaving (q, esc, back to
// the GitHub window).

import { String as Str } from "effect";
import { run, closeOverlay, openOverlay } from "herdr";
import { baseName } from "./parse.ts";
import type { Show } from "./state.ts";
import { ownPane, randomId } from "./place.ts";
import { pathOf, hashOf, isBranch, isRemoteBranch, isTag, statusFileOf, isTreeRow, isStash, nameOf } from "./items.ts";
import type { default as GitView } from "./main.ts";

/** A ctrl-p tab's name. */
export function paneName(s: Show) {
  switch (s.kind) {
    case "file": return baseName(s.path);
    case "review": return s.pr === undefined ? "review" : `#${s.pr}`;
    case "range": return "diff";
    case "log": return s.ref;
    case "commit": return Str.slice(0, 7)(s.hash);
    case "stash": return Str.slice(0, 7)(s.ref);
  }
}

/** What the main view shows now, as a pane's { show } (null: nothing to open). */
export function showNow(v: GitView): Show | null {
  const ctx = v.ctxOf(v.panel), x = v.item(ctx);

  if (v.diffBase !== null) {
    const ref = hashOf(x) ?? (isBranch(x) || isRemoteBranch(x) || isTag(x) ? x.oid : null);

    if (ref !== null) return v.diffReverse ? { kind: "range", a: ref, b: v.diffBase } : { kind: "range", a: v.diffBase, b: ref };
  }

  if (v.staging !== null) return { kind: "file", path: v.staging.file.path };

  switch (ctx) {
    case "files": {
      const f = statusFileOf(x);

      if (f !== null) return { kind: "file", path: f.path };

      const first = isTreeRow(x) && x.kind === "dir" ? x.files[0]?.path : undefined;

      return isTreeRow(x) && x.kind === "dir" ? (first === undefined ? { kind: "review", scope: "work" } : { kind: "review", scope: "work", path: first }) : null;
    }

    case "review": {
      const review: Show = v.review.pr !== null ? { kind: "review", scope: v.review.scope, pr: v.review.pr, repo: v.review.prRepo } : { kind: "review", scope: v.review.scope };
      const path = pathOf(x);

      return path === null ? review : { ...review, path };
    }

    case "commits": case "subCommits": case "reflog": {
      const hash = hashOf(x);

      return hash === null ? null : { kind: "commit", hash };
    }

    case "commitFiles": {
      const s = v.sub();

      if (s?.kind !== "commitFiles") return null;

      const path = isTreeRow(x) && x.kind === "dir" ? null : pathOf(x);

      return s.stash ? (path === null ? { kind: "stash", ref: s.hash } : { kind: "stash", ref: s.hash, path }) : (path === null ? { kind: "commit", hash: s.hash } : { kind: "commit", hash: s.hash, path });
    }

    case "stash": return isStash(x) ? { kind: "stash", ref: x.hash } : null;
    case "branches": case "tags": case "remoteBranches": {
      const name = nameOf(x);

      return name === null ? null : { kind: "log", ref: name };
    }

    default: return null;
  }
}

/** ctrl-p: the main view as a pane beside the focused pane (tab: in a new
 *  tab); the window steps aside. */
export function openPane(v: GitView, tab = false) {
  const g = v.git;
  const show = g === null ? null : v.showNow();

  if (g === null || show === null) return v.error("Nothing in the main view to open as a pane.");

  const paneId = randomId(5);
  const props = v.on !== null ? { folder: g.root, on: v.on, show, paneId } : { folder: g.root, show, paneId };

  if (tab) run("tab.new", { mod: "git", props, name: paneName(show) });
  else run("pane.split", { direction: "auto", mod: "git", props });

  // The window steps aside a moment later: closed in the same turn, the new
  // pane's first tasks were cancelled with it (it stayed on "Reading…").
  if (v.overlay !== null) {
    v.saveState();

    const id = v.overlay;

    v.later(() => closeOverlay(id), 300);
  }
}

/** Closes this copy's own pane (found by its slot or a ctrl-p pane's paneId; else the focused one). */
export function closePane(v: GitView) {
  const mine = ownPane(v);

  run("pane.close", mine === null ? {} : { pane: mine.pane });
}

export function goBack(v: GitView) {
  const back = v.backTo;

  if (back === null) return;

  v.saveState();
  openOverlay({ mod: back.mod, kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: back.props ?? {} });
}

/** q: back to the GitHub window when it opened this, else close. esc
 *  at the top level closes only a window (a pane stays). */
export function quit(v: GitView, fromEsc = false) {
  if (v.show !== null) return closePane(v);

  if (v.backTo !== null) return v.goBack();

  if (v.overlay !== null) {
    v.saveState();
    closeOverlay(v.overlay);

    return;
  }

  // esc never closes a pane (docs/mods-in-panes.md); q does.
  if (!fromEsc) closePane(v);
}
