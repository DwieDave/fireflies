# Window mods in normal panes

A mod that opens as a floating window can also live in a pane of a tab,
beside terminals and editors, and stay there: the same view, the same keys,
its state kept. Git, GitHub, the script runner and the processes deck do; a
new window mod (databases, the optional Kubernetes mod) follows the same
pattern. Each mod carries its own small `place.ts` for it (a mod can't import
another's); `defaults/mods/github/place.ts` is the shortest to copy from.

## Window or pane

- `props().overlay` is a string: a **window** (the app gives every overlay its
  id). No `overlay`: a **pane** (a tab's only pane too).
- A pane's props: `{ slot, folder, on?, ...the mod's own opening args }`.
  `slot` is unique, made by whoever opens it
  (`Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`): the
  copy finds its pane with
  `panes().find((p) => p.mod === MOD && isSlotted(p.props) && p.props.slot === slot)`
  (a mod isn't told its pane id), and `localStorage` (per mod and props) is
  per slot. `folder` / `on` are fixed when it opens: the shown space's
  attached folder, else the focused pane's (the window's rule). Props are
  never rewritten; what changes goes in state.

## What differs in a pane

- No frame: the root's border only `when(inWindow)`, no ✕, no scrim. The
  pane's header names and closes it.
- The move button where the window's ✕ is: ◧ "Into a pane" in a window, ⧉
  "Out to a window" in a pane, both with ctrl-t.
- esc never closes a pane. Inside, esc still backs out (popups, filters,
  drill-ins, forms); at the top level it does nothing. `q` closes the copy
  wherever the mod's `q` already closed the window (its own pane, by slot:
  `pane.close {pane}`).
- Focus as panes focus: the window's re-focus timers (`[60, 250, 600]`) are
  window only; `mod.json` `"focusable": true` so `pane.go` sends `"focus"`.
- Size from the pane: `on_size_change` (zoom taken out) drives the layout,
  nothing assumes the window's size. Each mod has one narrow break (640 px):
  git stacks its five panels in one column (enter / esc between them and the
  main view), GitHub's tabs not shown say only their number and its lists
  stack their panels below 820, the script deck's list takes the pane's
  height.
- Commands (`<mod>.<action>`, keys.json or `herdr-app do`) reach every copy;
  one acts: the window while one is open (its fresh `<mod>.window` note,
  written by the window only), else the pane with the keyboard, else none.
- Links and "beside" from a pane open beside that pane; nothing closes it.

## Opening one

- Nocturne: `nocturne.<mod>` toggles the window as before;
  `nocturne.<mod>:pane | :tab | :window`, or
  `nocturne.<mod>:{"as": "pane" | "tab" | "window", "folder"?, "on"?, ...the mod's opening args}`
  (`defaults/mods/nocturne/inpane.ts`). "+ new" has a tile per mod (beside or
  a tab, by its landing switch), the palette "Git in a pane" and the like.
- Anywhere: `pane.split {direction: "auto", mod, props: {slot, folder}}`, from
  a shell `herdr-app do pane.split '{"direction":"auto","mod":"git","props":{"slot":"s1","folder":"/abs"}}'`.
  An optional mod Nocturne doesn't know is opened this way.

## Moving a live copy

ctrl-t, the ◧ / ⧉ button, or `<mod>.to-pane` / `<mod>.to-window`:

- Window → pane: save the kept state, leave the handover note, `pane.split`
  beside the focused pane under the window with a new slot, close the window
  **300 ms later** (closed in the same turn, the new copy's first tasks are
  cancelled with it).
- Pane → window: the same, `openOverlay` with the window's spec (an open
  window of that mod gives way first), then `pane.close` of its own pane.
- The state goes through the mod's kept state (`git.state` by folder,
  `github.state`); what it doesn't hold (git's selection and screen mode, the
  deck's filter and cursor) goes in a one-shot `shared("<mod>.handover") =
  {at, folder, ...}` the new copy takes when under 5 s old and of its folder.

## Two copies, restart

One window per mod, any number of panes (a window and two panes on different
folders). Shared: caches and the per-folder kept state (the copy that saves
last wins). Per copy: everything on screen, in memory, and for a pane in
`localStorage`, saved on `close()` (which runs when the app quits). A pane
comes back with its tab: same props, so same folder and slot, so its
`localStorage` puts back its panel, tab and selection. Open forms and popups
aren't restored. Windows come back only if opened with `keep: true`.

## Windows only

Dialogs and passing things, not places to stay: the palette, "+ new", the
picker, help, notifications and toasts, confirm / prompt / password asks,
menus, peek, key lists. Picture in picture has its own ◧.

## Tests each mod carries

Drawn as a pane (no frame, no ✕, the ⧉), esc at the top level leaves the
pane (q closes its own), narrow widths draw, moved window → pane → window
with its state, two copies (commands go to the focused one), a restart's
props restoring its state. `scripts/git-pane.test.ts`,
`github-pane.test.ts`, `scripts-pane.test.ts`, `procs-pane.test.ts`,
`databases-view.test.ts`, `nocturne-inpane.test.ts`.
