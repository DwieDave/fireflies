// The worktree dialog moved into the git window: nocturne-git's Worktrees
// tab (the Files panel's third) makes, lists, goes to and removes a repo's
// worktrees, with confirmations, as spaces. This stub keeps the old way in
// working: openOverlay({ mod: "worktree", props: { space, folder?, machine?,
// action: "new" | "open" | "remove", branch?, tab?, argv? } }) from a saved
// layout, a key or another mod opens the git window on Worktrees with the
// same request (a branch is made at once, with that first tab) and closes
// itself.

import { View, div } from "gpui-kit";
import { props, closeOverlay, openOverlay, spaces, panes, home, theme } from "herdr";

// A space's folder: the one it's attached to (home holds no repo), else
// where its first terminal is now, else where it was made.
function place(s) {
  if (!s) return null;
  if (s.attached && s.folder && !(s.machine == null && s.folder === home())) return s.folder;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

/** The dialog's props as the git window's. */
export function gitProps(p) {
  const s = spaces().find((x) => x.id === p?.space);
  const folder = p?.folder || place(s);
  const on = s ? s.machine ?? null : p?.machine ?? null;
  const worktrees = { action: p?.action ?? "new" };
  for (const k of ["space", "branch", "tab", "argv"]) if (p?.[k] != null) worktrees[k] = p[k];
  return { folder, on, worktrees };
}

export default class WorktreeMoved extends View {
  init(p, cx) {
    this.p = props() ?? p ?? {};
    cx.timer.after(0, () => this.handOver());
  }

  handOver() {
    if (this.done) return;
    this.done = true;
    openOverlay({ mod: "nocturne-git", kind: "window", key: "nocturne-git", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [420, 300] }, props: gitProps(this.p) });
    if (this.p.overlay) closeOverlay(this.p.overlay);
  }

  render() {
    const t = theme();
    return div().id("worktree").size_full().p(16).bg(t.popover ?? t.background).text_size(13).text_color(t.muted).child("Worktrees live in the git window now…");
  }
}
