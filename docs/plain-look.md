# The plain look: Fireflies' mods in herdr-app's default layout

Developer's words:

> it should be exactly herdr default theme, add it too but keep the 3 still
> present to choose from. Basically the herdr default layout! but all panes
> and dialogs and uis should support it (the non dithered non nocturne theme)

> can the themes agent brief effect agents to include the theme work too??

He picked **concept A, "cards"**
(/Volumes/data/coding/fireflies-wt/themes-shots/concepts/concept-a.png, its
HTML beside it). This page is the brief section the Effect conversion
fireflies get: while each rewrites its mods (docs/effect-mods.md, waves 1
and 2), it also draws them through `@fireflies/look`, mechanically, by the
checklist below. Nocturne must come out pixel-identical.

## How a mod knows the look

The shown layout says it, in fields it already has (no new layout key, no
core change):

- `"scrim": {"dither": true}` (nocturne's): **dithered**, Nocturne's 1-bit
  look. Absent or false (`main`, upstream's default; a person's own layout):
  **plain**, upstream's look.
- `"corners": "square"`: every corner square (the app squares them, so a
  `rounded(n)` costs nothing there); otherwise they round as asked.

`@fireflies/look` reads both from `layout()` once per layout (cached by
`shared("layout")`, the layout's name) and every primitive branches on it.
The theme's colors are items 1 and 2's (tones.ts' `edge(t)`, `t.muted`):
they follow any theme in either look.

## @fireflies/look

`defaults/lib/@fireflies/look`, a library module (served by the app, in the
Effect lint pass). `import { panel, fill, … } from "@fireflies/look"`.
scripts/look.test.ts proves the nocturne branches draw what the mods draw
(recorded element trees, equal to git's `panel()`, `dither()`, `band()`).

| primitive | nocturne (dithered) draws | plain (concept A) draws |
| --- | --- | --- |
| `fill(color, cell)` | the 50% checker the mods' `dither()` draws | the color flat at half strength (a coarse checker, cell > 2, stays: a picture's transparency) |
| `rule(t, at, {height, color, opacity})` | a bar's dithered 2 px strip (1 px at 60% under a field) | a 1 px line in `t.border` |
| `hairline(t)` | the inline dithered rule after a section's name | a 1 px `t.border` line |
| `lit(t, el, active, {mark, band})` | the chosen row's band: a checker of the edge tone (dimmer off focus) and a 2 px accent edge | `t.selected` (`t.hover` off focus), rounded 6 |
| `veil(id)` | `#0000008c` dithered over the window under an in-window popup | black at 35%, flat (upstream's dialog veil) |
| `plate(t)` | a title bar's dithered plate and lit foot | `t.popover` and a 1 px line |
| `panel(t, id, title, active, body, {foot, right, onTitle})` | lazygit's frame, the title cut into the top edge (git's `panel()`, call for call) | a card: `t.background`, 1 px `t.border` (`t.accent` while focused), rounded 8, a 26 px header row with `title`, `right`, `foot` |
| `canvas(t, el)` | `el` as it is (frames meet edge to edge) | `t.canvas` with a 6 px gutter and padding |
| `segmented(t, tabs)` | (plain only: nocturne keeps its own title) | a card header's tabs as a segmented control |
| `titleBar(t, {id, art, plain, title}, parts)` | git's window header: the plate, the moon, the caps name, 34 px | a 40 px header row (`TITLE_BAR`): line icon, the name, `parts`, a 1 px line under it |
| `tag(t, el)` | `el` | a raised, rounded tag (the branch) |
| `kbd(t, key)` | (plain only) | a key as a chip: mono, raised, bordered, rounded 4 |
| `heading(t, text)` | caps, 11 px, muted | as written (capitalized), 11.5 px, dim |
| `menuBox(t, el)` | `t.background` with the accent frame | `t.popover`, `t.input` border, rounded 8 |
| `boxed(t, el, color)` | a square 1 px border in `color` or the edge tone | the same, `t.border` by default, rounded 5 |
| `frameBox(t, el)` | a window's 1 px edge | upstream's popover: `t.input` border, rounded 10 |
| `button(t, el)` | the edge-toned block | upstream's raised button with its border, rounded 6 |
| `dot(color, size)` | nocturne's pip art | a round dot |
| `icon(art, plain)` | `mods/nocturne/art/<art>.svg` | `mods/nocturne/plain/<plain>.svg` (Lucide, as upstream's Settings; ISC), or null where plain has no picture |
| `glyph(text, plain)` | the text glyph (✕ ↻ ◧ ⧉ ‹) | the line icon |
| `textWidth(text, size)` | 7 px a character at 11 px (Departure Mono) | an estimate of Geist's proportional widths (prefer flex layout) |
| `pick(nocturne, plain)` | the first value | the second (a pixel size 11 → 12.5, a 9 px pixel icon → 12) |
| `titleShown(inPane)` | true | false in a pane: main's pane header names the mod |
| `radius(n)`, `dithered()`, `square()` | 0, true, true | n, false, as the layout says |

The two costs of cards, handled in the library:

1. **Gutters in the five-panel windows (git, github, databases).** A 6 px
   gutter and padding (the concept's 10 would cost a column of five 40 px),
   a 26 px card header (the concept's 36 cost a row a panel), rows from the
   header's foot. A panel sized to its content (git's status and stash)
   grows by the header and keeps every row; the flexible ones (files,
   branches, commits) give up about one row each at Developer's window sizes
   and zoom 0.9.
2. **Nesting inside a pane** (main's panes are cards already): in a pane the
   pane is the canvas. No outer card (`frameBox` only where the mod is a
   window), no own title bar (`titleShown(inPane)` false), the panels are
   cards on `canvas()`.

## The reference: scripts, converted

Commits 3c95167 and 732b324. Before and after; nocturne unchanged:

```ts
// a section's head (rows-view.ts section)
-    .child(eyebrow(t, label))
-    .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.muted, 1)));
+    .child(heading(t, label))
+    .child(hairline(t));

// the row under the cursor (rows-view.ts band)
-  return on ? el.child(dither(edge(t), 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
+  return on ? lit(t, el, true) : el;

// a badge's border (rows-view.ts badge)
-  return (w === undefined ? el : el.w(w).justify_center()).flex().items_center()
-    .border(1).border_color(on ? t.muted : edge(t)).text_size(9)…
+  return boxed(t, (w === undefined ? el : el.w(w).justify_center()).flex().items_center(), on ? t.muted : null).text_size(9)…

// the foot's top edge, the filter line's (bars.ts)
-    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(edge(t), 1)));
+    .child(rule(t, "top"));
-        .child(div().absolute().left(0).right(0).bottom(0).h(1).opacity(0.6).child(dither(t.muted, 1)));
+        .child(rule(t, "bottom", { height: 1, color: t.muted, opacity: 0.6 }));

// the head (bars.ts deckHead): the shared title bar in a plain layout, its own in nocturne
+  if (!dithered()) return titleBar(t, { id: "scripts-head", art: "play", plain: "play", title: "Scripts" }, [where, moveChip(v, t)]);

// no own head in a plain layout's pane, and the heights that count it (place.ts, main.ts, run-menu.ts)
+export const headHeight = (v: ScriptsDeck): number => (titleShown(inPane(v)) ? pick(HEAD, TITLE_BAR) : 0);
-      .child(deckHead(this, t))
+      .when(titleShown(inPane(this)), (el) => el.child(deckHead(this, t)))

// the deck's own frame, the run menu's box, glyphs, icons
-    const deck = inPane(this) ? root : root.border(1).border_color(edge(t));
+    const deck = inPane(this) ? root : frameBox(t, root);
-    …w(MENU_W).py(6).bg(t.background).border(1).border_color(t.accent)
+    menuBox(t, v_flex()…w(MENU_W).py(6))
-    .child(pane ? "⧉" : "◧");
+    .child(glyph(pane ? "⧉" : "◧", pane ? "app-window" : "panel-left"));
-    svg(`${ART}/lock.svg`).size(9)
+    svg(icon("lock", "lock")).size(pick(9, 12))
```

`paint.ts` lost its own `dither()` and caps `eyebrow`. scripts has no
panels: git's conversion is the first `panel()` user (look.test.ts already
proves `panel()` equals git's in nocturne).

## How to convert a mod's look

1. Replace the mod's own `dither()`/`checker()` with `fill` (import it under
   the old name where that keeps the diff small: `import { fill as dither }`).
   Its `flat()` call (items 1+2) goes with it.
2. Walk the mod's table below, function by function: each drawn kind
   becomes its primitive. The primitive's nocturne branch is the code you
   remove: if a site differs from it (another height, color, order), keep
   the site's nocturne code and branch with `dithered()` / `pick()` rather
   than changing nocturne.
3. Panels: a column of `panel()`s on `canvas()`. A title made of tabs
   ([2] Files · Review · Worktrees) stays as it is in nocturne; in plain it
   is the panel's name and `segmented()` with its tabs.
4. Title bars: `titleBar()` in a window; in a pane nothing
   (`titleShown(inPane)`), and every height that counted it counts 0.
5. Popups inside a window: `veil()` under them, `menuBox()` / `frameBox()`
   for their box; dialogs (a commit, a confirm) as upstream's confirm:
   `t.popover`, 32 px buttons (`button()`), fields with an accent ring.
6. Foot keys: `kbd()` chips in plain. (The shared bar is
   `@fireflies/keyhelp`'s: see "Libraries".)
7. Icons: `icon(art, plain)`; art with no plain counterpart passes `null`
   and the plain look draws nothing there. Pixel sizes go through `pick()`.

What must not change: anything in nocturne (each mod's shots against
integrate), behavior, keys, commands, shared records, sizes in nocturne.
In plain only what the cards need: header heights, gutters.

## Libraries (wave 0's, then the look)

| library | plain look | who |
| --- | --- | --- |
| `@fireflies/keyhelp` (0a) | `hint()` / `hintBar()`: keys as `kbd()` chips, the bar's top edge `rule()`; `keysView()`'s rule and chosen row `rule()` / `lit()` | themes firefly, right after wave 0 merges (one library, one firefly) |
| `@fireflies/toolground` (0a) | the tab strip's plate and ledge: `fill()` flat, the horizon `rule()` | themes firefly, after wave 0 |
| `@fireflies/viewer` (0b) | `viewer-bars.ts` buttons and chips; `viewer-views.ts` checker stays (a picture's transparency) | themes firefly, after wave 0 |
| `@fireflies/form-keys`, `@fireflies/menu-place`, `@fireflies/dividers` | no chrome of their own | none |
| `@fireflies/tones`, `@fireflies/layout-look` (0a) | look imports them by name and re-exports them (`import { edge, dithered } from "@fireflies/look"` works) | done |

A test that loads a mod importing `@fireflies/look` (or a library itself)
uses scripts/mod-source.ts: `importMod` loads `@fireflies/*` with the test's
stand-ins, `importLibrary(spec, standins)` loads one library; a stand-in for
`herdr` gives `layout` (a layout tree, nocturne's for the dithered look) and
`shared("layout")` (its name), as scripts/look.test.ts does.

## Opened outside nocturne: the folder

In nocturne each window opens through nocturne's own opener, which passes
the folder it found (props `{ folder, on }`). Elsewhere (`mod.open {name}`,
the palette's Window rows, a pane made by `pane.split {mod}`) a mod gets no
props and must find the folder itself: the shown space's own folder, else
the focused terminal's, else a terminal's in the shown tab, else the space's
(nocturne/panels.ts `here()`; scripts' `here.ts` is the small copy).

| mod | opened without props | to do (its conversion firefly) |
| --- | --- | --- |
| scripts | fixed: `here.ts` (scripts-pane.test.ts proves both ways) | none |
| git, github, databases | already: their own `here()` when `folder` is missing | none (keep it through the conversion) |
| procs | needs none: the machine's processes; its tab defaults to "procs" | none |
| file-tree | lists the home folder (main.ts `reroot(…, pr.path \|\| pr.folder \|\| home())`) | fall back to the shown space's folder, as scripts |
| finder | "No folder: open a terminal in the project first" (main.ts) | the same fallback |
| notifications | fixed: mod.json's overlay gives `role: overview`; the palette's Window row opens it | none |
| editor, markdown, preview | need a file (`path`): "no file given" | nothing: they open from a file (the files pane, a link) |



Not chrome, drawn as it is in every layout: nocturne's sky, moon, stars,
hills, meadow and jar glass (`sky.ts`, `rail.ts`, `meadow.ts`, `glow.ts`, the
fireflies' glow), the usage window's candle and sheep, procs' dotted
sparklines (`vitals-view.ts`) and list guides, the git graph's lanes, the
agent graph's nodes, the PDF page's paper, the video's letterbox. Their
colors are the theme's (items 1+2). Where such art sits in chrome (an empty
page's moon) `icon(art, null)` drops it in plain.

Nocturne's own chrome (its dialogs, menus, toasts, palette, pane header,
tab strip) shows only where a layout loads the nocturne mod: the nocturne
firefly converts it last and lowest.

## Shots

Each firefly hands back, in /Volumes/data/coding/fireflies-wt/<firefly>-shots/:
every window and pane in its table in nocturne (moonfly) next to
integrate's, pixel-identical (one binary, integrate's mods beside one copy,
the branch's beside the other: CLAUDE.md's ff.app bundle twice); and in main
(graphite, and paper for one), plain: no checker anywhere, cards on the
canvas, no second title bar in a pane.

## The checklist, per mod

Every function of each mod's own files (shared files and wave 0's libraries
left out) that draws Nocturne chrome, what it draws (counts are code sites:
frame = lazygit frames, title = a title bar or caps name, lit = a chosen
row's band, box = a 1 px border, art = 1-bit art, glyph = a text control,
metric = a pixel-font width), and the primitive it becomes. The firefly
checks each row off in its report.

| firefly (wave) | mods | functions | shoot |
| --- | --- | --- | --- |
| git (1) | git | 28 | the git window, git as a pane, the commit popup, a menu |
| github (1) | github | 45 | the github window (PRs, actions, projects), a form, a menu |
| databases (1) | databases | 46 | the window, a table open, the connection form, a menu, as a pane |
| editor (1) | editor, markdown, finder | 35, 5, 5 | an editor pane with tabs and find, the markdown viewer, the finder |
| panes (1) | preview, file-tree, agent-graph, notifications, browser | 0, 18, 9, 23, 9 | each as a pane; notifications' overview and an ask |
| nocturne (1) | nocturne | 101 (the sky's art stays) | in a plain layout that loads it: a dialog, a menu, a toast, the palette |
| small (2) | procs, scripts (done), pip, diff, equalize-panes | 23, 0, 7, 1, 1 | procs window and pane, pip's bar, the equalize popup |

#### nocturne (14953 lines of its own, 101 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `dialog.ts:button` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `dialog.ts:cap` | title ×1 | `titleBar()` / `heading()` |
| `dialog.ts:frame` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `dialog.ts:render` | lit ×1, box ×1 | `lit()`, `boxed()` / `frameBox()` / `button()` |
| `dialog.ts:titleRow` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `glow.ts:drawGlow` | fill ×1, art ×3 | `fill()`, `icon(art, plain)` / `dot()` |
| `header.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `header.ts:headerControls` | art ×1 | `icon(art, plain)` / `dot()` |
| `header.ts:lazygit` | fill ×1 | `fill()` |
| `header.ts:markPath` | art ×2 | `icon(art, plain)` / `dot()` |
| `header.ts:render` | fill ×1 | `fill()` |
| `inline.ts:check` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `inline.ts:confirm` | box ×2 | `boxed()` / `frameBox()` / `button()` |
| `inline.ts:field` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `inline.ts:working` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:(top)` | art ×1, metric ×1 | `icon(art, plain)` / `dot()`, `textWidth()` / `pick()` |
| `kit.ts:eyebrow` | title ×1 | `titleBar()` / `heading()` |
| `kit.ts:navRing` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `kit.ts:navRow` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `kit.ts:pip` | art ×1 | `icon(art, plain)` / `dot()` |
| `meadow.ts:doneBadge` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `meadow.ts:firefly` | lit ×1, fill ×2, art ×1 | `lit()`, `fill()`, `icon(art, plain)` / `dot()` |
| `meadow.ts:glass` | fill ×4 | `fill()` |
| `meadow.ts:jarGlow` | art ×1 | `icon(art, plain)` / `dot()` |
| `meadow.ts:railGlass` | fill ×4 | `fill()` |
| `menu.ts:menuItems` | art ×2 | `icon(art, plain)` / `dot()` |
| `menu.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `newbutton.ts:render` | fill ×1 | `fill()` |
| `newmenu.ts:foot` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `newmenu.ts:head` | rule ×1, fill ×1, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `newmenu.ts:mark` | art ×2 | `icon(art, plain)` / `dot()` |
| `newmenu.ts:picture` | fill ×3, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `newmenu.ts:render` | box ×2 | `boxed()` / `frameBox()` / `button()` |
| `newmenu.ts:row` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `newmenu.ts:section` | hairline ×1, fill ×1 | `hairline()`, `fill()` |
| `newmenu.ts:switcher` | fill ×1 | `fill()` |
| `newmenu.ts:tile` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `newspace-draw.ts:fieldBox` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `newspace-draw.ts:pickRow` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `newspace-draw.ts:pickerFoot` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `newspace-draw.ts:pickerHead` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `newspace.ts:listItems` | fill ×1 | `fill()` |
| `newspace.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `palette-entries.ts:sections` | metric ×1 | `textWidth()` / `pick()` |
| `palette-entries.ts:titleOf` | title ×1 | `titleBar()` / `heading()` |
| `palette-entries.ts:windowEntries` | art ×1 | `icon(art, plain)` / `dot()` |
| `palette.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `palette.ts:groupHead` | fill ×1 | `fill()` |
| `palette.ts:keycap` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `palette.ts:render` | lit ×1, rule ×2, fill ×4, box ×1 | `lit()`, `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `panels.ts:panels` | art ×5 | `icon(art, plain)` / `dot()` |
| `parked.ts:render` | fill ×1 | `fill()` |
| `peek.ts:buttons` | glyph ×1 | `glyph(text, plain)` |
| `peek.ts:frame` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `peek.ts:views` | fill ×1 | `fill()` |
| `popup.ts:render` | lit ×1, rule ×2, fill ×4, box ×1 | `lit()`, `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `procs.ts:procsControl` | art ×1 | `icon(art, plain)` / `dot()` |
| `rail.ts:openKey` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `rail.ts:railFly` | fill ×1, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `rail.ts:railSpace` | fill ×1 | `fill()` |
| `rail.ts:railView` | fill ×2, art ×2 | `fill()`, `icon(art, plain)` / `dot()` |
| `screens.ts:bullet` | art ×1 | `icon(art, plain)` / `dot()` |
| `screens.ts:button` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `screens.ts:eyebrow` | title ×1 | `titleBar()` / `heading()` |
| `screens.ts:fly` | art ×1 | `icon(art, plain)` / `dot()` |
| `screens.ts:frame` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `screens.ts:header` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `screens.ts:hero` | art ×2 | `icon(art, plain)` / `dot()` |
| `screens.ts:horizon` | rule ×1 | `rule()` |
| `screens.ts:machineRow` | art ×1 | `icon(art, plain)` / `dot()` |
| `screens.ts:pageThree` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `screens.ts:pageTwo` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `screens.ts:release` | fill ×1, box ×1, art ×1 | `fill()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `screens.ts:render` | lit ×1, rule ×3, fill ×5, box ×2, glyph ×1, art ×2 | `lit()`, `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()`, `glyph(text, plain)`, `icon(art, plain)` / `dot()` |
| `scripts.ts:scriptsControl` | fill ×1, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `shelf.ts:newTile` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `shelf.ts:pinTile` | fill ×1, box ×2 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `shelf.ts:shelfView` | fill ×1 | `fill()` |
| `shelf.ts:tabEar` | fill ×1 | `fill()` |
| `sky.ts:header` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `sky.ts:hints` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `sky.ts:render` | art ×7 | `icon(art, plain)` / `dot()` |
| `spaces.ts:row` | fill ×1 | `fill()` |
| `tabdrag.ts:lift` | menu ×1, fill ×1, box ×1 | `menuBox()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `tabdrag.ts:stake` | lit ×1 | `lit()` |
| `tabs.ts:gitButton` | glyph ×1 | `glyph(text, plain)` |
| `tabs.ts:render` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `tabs.ts:seam` | fill ×1 | `fill()` |
| `tabs.ts:seamFade` | fill ×2 | `fill()` |
| `tabs.ts:tabItem` | fill ×1 | `fill()` |
| `tabs.ts:toolFrame` | fill ×1 | `fill()` |
| `toast.ts:render` | rule ×1, fill ×1, box ×1, art ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `usage.ts:hourglass` | art ×2 | `icon(art, plain)` / `dot()` |
| `usage.ts:moon` | art ×1 | `icon(art, plain)` / `dot()` |
| `usage.ts:path` | fill ×1, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `usage.ts:rail` | fill ×1 | `fill()` |
| `usage.ts:render` | glyph ×1 | `glyph(text, plain)` |
| `usage.ts:switcher` | art ×1 | `icon(art, plain)` / `dot()` |
| `winged.ts:flyMark` | art ×2 | `icon(art, plain)` / `dot()` |
| `winged.ts:wings` | art ×1 | `icon(art, plain)` / `dot()` |
| `worktrees.ts:render` | title ×1, box ×1, art ×1 | `titleBar()` / `heading()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |

#### github (12275 lines of its own, 45 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `actions-panels.ts:graphPanel` | frame ×4 | `panel()` (+ `canvas()` on the column) |
| `actions-panels.ts:logPanel` | frame ×2 | `panel()` (+ `canvas()` on the column) |
| `actions-panels.ts:runsPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `actions-panels.ts:stepsPanel` | frame ×2, fill ×1 | `panel()` (+ `canvas()` on the column), `fill()` |
| `dispatchForm.ts:side` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `form-draw.ts:button` | fill ×1 | `fill()` |
| `form-draw.ts:chipOf` | fill ×1 | `fill()` |
| `form-draw.ts:fieldCell` | fill ×2, box ×3, glyph ×1 | `fill()`, `boxed()` / `frameBox()` / `button()`, `glyph(text, plain)` |
| `form-draw.ts:footer` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `form-draw.ts:pickerBox` | menu ×1, box ×2, glyph ×1 | `menuBox()`, `boxed()` / `frameBox()` / `button()`, `glyph(text, plain)` |
| `form-draw.ts:reviewBody` | fill ×1 | `fill()` |
| `form-draw.ts:section` | title ×1, fill ×1 | `titleBar()` / `heading()`, `fill()` |
| `form.ts:render` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `graph.ts:jobNode` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `graph.ts:runNode` | box ×1, art ×1 | `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `graph.ts:strip` | fill ×1 | `fill()` |
| `kit.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:band` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `kit.ts:chip` | fill ×1 | `fill()` |
| `kit.ts:dither` | veil ×3 | `veil()` |
| `kit.ts:empty` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:eyebrow` | title ×1 | `titleBar()` / `heading()` |
| `kit.ts:hints` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `kit.ts:panel` | frame ×1, rule ×1, fill ×1, box ×1 | `panel()` (+ `canvas()` on the column), `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `kit.ts:pip` | box ×1, art ×1 | `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `kit.ts:popupScrim` | veil ×2, fill ×1 | `veil()`, `fill()` |
| `main.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `pr-draw.ts:prHead` | fill ×2 | `fill()` |
| `pr-draw.ts:saidCard` | fill ×1 | `fill()` |
| `pr-draw.ts:sweepLite` | fill ×1 | `fill()` |
| `prForm.ts:side` | frame ×1, fill ×2 | `panel()` (+ `canvas()` on the column), `fill()` |
| `projects-draw.ts:bar` | fill ×2, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `projects-draw.ts:card` | rule ×1, fill ×3, box ×1, art ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `projects-draw.ts:column` | rule ×1, fill ×1, box ×2 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `projects-draw.ts:detail` | rule ×1, fill ×5, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `projects-draw.ts:foldStrip` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `projects-draw.ts:laneRow` | fill ×1 | `fill()` |
| `projects-draw.ts:menuPanel` | menu ×1, lit ×1, rule ×1, fill ×3, box ×1 | `menuBox()`, `lit()`, `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `projects.ts:render` | title ×1, fill ×1, art ×1 | `titleBar()` / `heading()`, `fill()`, `icon(art, plain)` / `dot()` |
| `prs.ts:checksPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `prs.ts:listPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `prs.ts:mainPanel` | frame ×2, fill ×2, box ×1 | `panel()` (+ `canvas()` on the column), `fill()`, `boxed()` / `frameBox()` / `button()` |
| `window-chrome.ts:confirmBar` | fill ×1 | `fill()` |
| `window-chrome.ts:header` | title ×2, rule ×1, fill ×2, glyph ×4, art ×2 | `titleBar()` / `heading()`, `rule()`, `fill()`, `glyph(text, plain)`, `icon(art, plain)` / `dot()` |
| `window-chrome.ts:pickerPanel` | menu ×1, veil ×1, box ×1 | `menuBox()`, `veil()`, `boxed()` / `frameBox()` / `button()` |

#### databases (11939 lines of its own, 46 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `chrome.ts:header` | title ×2, rule ×1, fill ×2, glyph ×4, art ×1 | `titleBar()` / `heading()`, `rule()`, `fill()`, `glyph(text, plain)`, `icon(art, plain)` / `dot()` |
| `chrome.ts:keyBar` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `conn-form.ts:draw` | menu ×1, veil ×1, box ×1 | `menuBox()`, `veil()`, `boxed()` / `frameBox()` / `button()` |
| `conn-form.ts:fieldGrid` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `connmark.ts:statePip` | art ×1 | `icon(art, plain)` / `dot()` |
| `export-form.ts:draw` | menu ×1, veil ×1, box ×2 | `menuBox()`, `veil()`, `boxed()` / `frameBox()` / `button()` |
| `forward-view.ts:forwardAskPanel` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `grid.ts:editCell` | title ×1 | `titleBar()` / `heading()` |
| `grid.ts:header` | fill ×1 | `fill()` |
| `grid.ts:row` | lit ×1, fill ×3 | `lit()`, `fill()` |
| `kit.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:band` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `kit.ts:chip` | fill ×1 | `fill()` |
| `kit.ts:dither` | veil ×1 | `veil()` |
| `kit.ts:edgeRow` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `kit.ts:empty` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:groupRule` | fill ×1 | `fill()` |
| `kit.ts:kindBadge` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `kit.ts:lock` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:panel` | frame ×3 | `panel()` (+ `canvas()` on the column) |
| `kit.ts:pip` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:popupScrim` | veil ×2, fill ×1 | `veil()`, `fill()` |
| `main-view.ts:filterLine` | rule ×1, fill ×1, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `main-view.ts:mainPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `main-view.ts:orderPart` | glyph ×1 | `glyph(text, plain)` |
| `main-view.ts:pager` | glyph ×2 | `glyph(text, plain)` |
| `main-view.ts:resultHead` | rule ×1, fill ×1, glyph ×1 | `rule()`, `fill()`, `glyph(text, plain)` |
| `main.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `panels.ts:connsPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `panels.ts:emptyDbView` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `panels.ts:logPanel` | frame ×1, glyph ×1 | `panel()` (+ `canvas()` on the column), `glyph(text, plain)` |
| `panels.ts:pinMark` | art ×1 | `icon(art, plain)` / `dot()` |
| `panels.ts:secretMark` | art ×1 | `icon(art, plain)` / `dot()` |
| `panels.ts:structPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `panels.ts:tablesPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `popups.ts:askBar` | fill ×1, box ×1, glyph ×1 | `fill()`, `boxed()` / `frameBox()` / `button()`, `glyph(text, plain)` |
| `popups.ts:dimLayer` | veil ×1 | `veil()` |
| `popups.ts:menuLayer` | menu ×1, box ×1 | `menuBox()`, `boxed()` / `frameBox()` / `button()` |
| `popups.ts:passwordPanel` | menu ×1, box ×2 | `menuBox()`, `boxed()` / `frameBox()` / `button()` |
| `popups.ts:renamePanel` | menu ×1, box ×2 | `menuBox()`, `boxed()` / `frameBox()` / `button()` |
| `press.ts:ghost` | fill ×1 | `fill()` |
| `read-view.ts:missingView` | title ×1, box ×1, art ×1 | `titleBar()` / `heading()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `read-view.ts:readingView` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `review.ts:changesBar` | fill ×1 | `fill()` |
| `review.ts:reviewPanel` | veil ×1, fill ×1, box ×1 | `veil()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `review.ts:reviewRow` | glyph ×1 | `glyph(text, plain)` |

#### editor (16109 lines of its own, 35 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `card-view.ts:cardLinksView` | title ×1, fill ×1 | `titleBar()` / `heading()`, `fill()` |
| `card-view.ts:parts` | fill ×1 | `fill()` |
| `card-view.ts:problemRow` | fill ×1 | `fill()` |
| `drawn-tabs.ts:lookHints` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `find.ts:findLine` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `find.ts:findRow` | glyph ×2 | `glyph(text, plain)` |
| `md-pane.ts:mdMenuView` | fill ×1 | `fill()` |
| `md-pane.ts:renderedHost` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `pane-bar.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `pane-bar.ts:modeChip` | fill ×1 | `fill()` |
| `pane-bar.ts:oneFile` | fill ×1 | `fill()` |
| `pane-bar.ts:problemChips` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `pane-bar.ts:stripTab` | menu ×1, fill ×3, box ×1 | `menuBox()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `pane-bar.ts:tabStake` | lit ×1 | `lit()` |
| `pane-bar.ts:tabStrip` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `pane-lines.ts:askLine` | fill ×1 | `fill()` |
| `pane-lines.ts:bodyView` | fill ×1 | `fill()` |
| `pane-lines.ts:conflictLine` | fill ×1 | `fill()` |
| `pane-lines.ts:drawerView` | title ×1, lit ×1, fill ×2, box ×1 | `titleBar()` / `heading()`, `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `pane-lines.ts:exLine` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `pane-lines.ts:hints` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `pane-lines.ts:noteView` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `pane-lines.ts:whichView` | fill ×1 | `fill()` |
| `rendered-column.ts:litView` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `rendered-column.ts:scrollbar` | fill ×1 | `fill()` |
| `rendered-keys.ts:pressedAt` | metric ×1 | `textWidth()` / `pick()` |
| `rendered-units.ts:addView` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `rendered-units.ts:calloutBody` | lit ×1, box ×1 | `lit()`, `boxed()` / `frameBox()` / `button()` |
| `rendered-units.ts:imagesView` | lit ×1, box ×1 | `lit()`, `boxed()` / `frameBox()` / `button()` |
| `rendered-units.ts:itemBody` | fill ×1, metric ×1 | `fill()`, `textWidth()` / `pick()` |
| `rendered-units.ts:unitBody` | fill ×1 | `fill()` |
| `scratch-bar.ts:saveWord` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `tab-menu.ts:dropZone` | fill ×1 | `fill()` |
| `tab-menu.ts:tabMenuView` | menu ×1, lit ×1, fill ×2, box ×1 | `menuBox()`, `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `vim-ops.ts:applyOperator` | title ×1 | `titleBar()` / `heading()` |

#### markdown (960 lines of its own, 5 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `bars.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `bars.ts:chip` | fill ×1 | `fill()` |
| `bars.ts:empty` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `bars.ts:linkBar` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `bars.ts:toolbar` | rule ×1, fill ×1, glyph ×1 | `rule()`, `fill()`, `glyph(text, plain)` |

#### finder (1065 lines of its own, 5 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `main.ts:headRow` | fill ×1 | `fill()` |
| `main.ts:keysLine` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `main.ts:previewView` | lit ×1 | `lit()` |
| `main.ts:render` | rule ×1, fill ×2, box ×3, glyph ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()`, `glyph(text, plain)` |
| `main.ts:selected` | lit ×1 | `lit()` |

#### preview (109 lines of its own, 0 functions): done

Nothing of its own to draw: the pane is @fireflies/viewer's (defaults/lib), whose look is the library's.

| file: function | draws | becomes |
| --- | --- | --- |

#### file-tree (4795 lines of its own, 18 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `fit.ts:lensStep` | metric ×1 | `textWidth()` / `pick()` |
| `list-view.ts:drawFolderView` | title ×1, rule ×1, fill ×1 | `titleBar()` / `heading()`, `rule()`, `fill()` |
| `list-view.ts:drawRow` | lit ×1, fill ×6, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `list-view.ts:drawSplit` | fill ×1 | `fill()` |
| `list-view.ts:emptyView` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `list-view.ts:listBody` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `logic.ts:keyColumn` | metric ×1 | `textWidth()` / `pick()` |
| `logic.ts:marks` | metric ×1 | `textWidth()` / `pick()` |
| `main.ts:isFocusedPane` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `main.ts:leave` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `main.ts:panel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `menu.ts:menuBox` | lit ×1, fill ×1, metric ×1 | `lit()`, `fill()`, `textWidth()` / `pick()` |
| `opening.ts:closePane` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `paint.ts:ring` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `search.ts:openWeb` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `state.ts:isEdit` | art ×1 | `icon(art, plain)` / `dot()` |
| `toolbar.ts:drawLens` | rule ×2, fill ×2, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `toolbar.ts:drawToolbar` | title ×1, rule ×1, fill ×1, glyph ×2 | `titleBar()` / `heading()`, `rule()`, `fill()`, `glyph(text, plain)` |

#### agent-graph (2302 lines of its own, 9 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `feed-view.ts:details` | rule ×2, fill ×3 | `rule()`, `fill()` |
| `feed-view.ts:drawToolbar` | title ×1, rule ×1, fill ×2 | `titleBar()` / `heading()`, `rule()`, `fill()` |
| `feed-view.ts:feedList` | title ×1, metric ×1 | `titleBar()` / `heading()`, `textWidth()` / `pick()` |
| `graph.ts:node` | title ×1, fill ×2, box ×1, art ×1 | `titleBar()` / `heading()`, `fill()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `graph.ts:sky` | fill ×1, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `kit.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:pip` | art ×1 | `icon(art, plain)` / `dot()` |
| `stats-view.ts:statsBody` | title ×1, hairline ×1, fill ×3 | `titleBar()` / `heading()`, `hairline()`, `fill()` |
| `stats-view.ts:statsStrip` | title ×1, lit ×1, fill ×1 | `titleBar()` / `heading()`, `lit()`, `fill()` |

#### notifications (3394 lines of its own, 23 functions): done

Done on 2026-11-23: every row below draws through the primitive named
(fill, lit, boxed, frameBox, rule, dot, icon). An agent's logo stays its
1-bit mark in both looks (it is the agent's identity, as the agent graph's
nodes); the empty overview's fireflies art only in nocturne (`icon(art,
null)`). Nocturne's element tree is unchanged (recorded in sixteen states,
before and after: identical but for the overview's new `m menu` key row and
zero radii); scripts/notifications-look.test.ts proves both looks. The
overview opens without a role from `mod.open {"name": "notifications"}`
(mod.json's overlay gives it `role: overview`) and from the palette's
Window row. The shots are owed while scratch apps are off.

| file: function | draws | becomes |
| --- | --- | --- |
| `ask-dialog.ts:cells` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `ask-dialog.ts:footer` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `ask-dialog.ts:question` | lit ×1, fill ×1, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `ask-dialog.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `ask-dialog.ts:review` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `bell.ts:mark` | art ×1 | `icon(art, plain)` / `dot()` |
| `bell.ts:render` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `kit.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:button` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `kit.ts:horizon` | rule ×1 | `rule()` |
| `kit.ts:kbd` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `kit.ts:logo` | art ×1 | `icon(art, plain)` / `dot()` |
| `kit.ts:pip` | art ×1 | `icon(art, plain)` / `dot()` |
| `overview.ts:butBox` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `overview.ts:empty` | art ×1 | `icon(art, plain)` / `dot()` |
| `overview.ts:entry` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `overview.ts:footer` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `overview.ts:main` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `overview.ts:permission` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `overview.ts:plate` | fill ×1 | `fill()` |
| `overview.ts:questions` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `overview.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `overview.ts:screenTail` | box ×1 | `boxed()` / `frameBox()` / `button()` |

#### browser (2966 lines of its own, 9 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `bar.ts:addressField` | box ×2 | `boxed()` / `frameBox()` / `button()` |
| `bar.ts:barIcon` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `bar.ts:barView` | rule ×1, fill ×2, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `bar.ts:blankPage` | title ×1, art ×1 | `titleBar()` / `heading()`, `icon(art, plain)` / `dot()` |
| `bar.ts:keysButton` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `strip.ts:lift` | menu ×1, fill ×1, box ×1 | `menuBox()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `strip.ts:stake` | lit ×1 | `lit()` |
| `strip.ts:stripView` | rule ×2, fill ×2, box ×2 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `tab-menu.ts:renderMenu` | lit ×1, fill ×2, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |

#### git (8745 lines of its own, 28 functions): done

Done on 2026-11-22: every row below. Nocturne's element tree is unchanged
(recorded whole in ten states, before and after: identical);
scripts/git-look.test.ts proves both looks. The look is read once per draw
(draw.ts `isDithered`, `byLook`, `mark`, `ageWidth`: look's `pick`,
`glyph` and `textWidth` asked the app per call); the age column is the
widest age measured in the plain font. The shots are owed while scratch apps
are off.

| file: function | draws | becomes |
| --- | --- | --- |
| `bars.ts:windowHeader` | title ×2, rule ×1, fill ×2, glyph ×4, art ×2 | `titleBar()` / `heading()`, `rule()`, `fill()`, `glyph(text, plain)`, `icon(art, plain)` / `dot()` |
| `draw.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `draw.ts:band` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `draw.ts:busyMark` | fill ×1 | `fill()` |
| `draw.ts:chip` | fill ×1 | `fill()` |
| `draw.ts:diffLine` | lit ×1, fill ×3, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `draw.ts:dither` | veil ×2 | `veil()` |
| `draw.ts:edgeRow` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `draw.ts:empty` | art ×1 | `icon(art, plain)` / `dot()` |
| `draw.ts:graphCell` | box ×1, art ×1 | `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |
| `draw.ts:hints` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `draw.ts:panel` | frame ×3 | `panel()` (+ `canvas()` on the column) |
| `draw.ts:popupScrim` | veil ×2, fill ×1 | `veil()`, `fill()` |
| `main-view.ts:logPanel` | frame ×1 | `panel()` (+ `canvas()` on the column) |
| `main-view.ts:mainPanel` | frame ×4 | `panel()` (+ `canvas()` on the column) |
| `main.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `parse.ts:age` | metric ×2 | `textWidth()` / `pick()` |
| `parse.ts:relativeDate` | metric ×1 | `textWidth()` / `pick()` |
| `popups.ts:commitBox` | title ×1, box ×2 | `titleBar()` / `heading()`, `boxed()` / `frameBox()` / `button()` |
| `popups.ts:frame` | frame ×2 | `panel()` (+ `canvas()` on the column) |
| `popups.ts:menuBox` | title ×1, lit ×1, fill ×1, metric ×2 | `titleBar()` / `heading()`, `lit()`, `fill()`, `textWidth()` / `pick()` |
| `popups.ts:promptBox` | lit ×1, fill ×1, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `popups.ts:render` | veil ×2 | `veil()` |
| `rows.ts:drawRow` | fill ×1, box ×1 | `fill()`, `boxed()` / `frameBox()` / `button()` |
| `rows.ts:fileRow` | glyph ×1 | `glyph(text, plain)` |
| `rows.ts:wideCommit` | rule ×1, fill ×1, box ×1 | `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `side.ts:modeChip` | glyph ×1 | `glyph(text, plain)` |
| `side.ts:sidePanel` | frame ×1, box ×1 | `panel()` (+ `canvas()` on the column), `boxed()` / `frameBox()` / `button()` |

#### procs (4167 lines of its own, 23 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `bars.ts:emptyView` | art ×1 | `icon(art, plain)` / `dot()` |
| `bars.ts:footBar` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `bars.ts:headBar` | rule ×1, fill ×1, art ×1 | `rule()`, `fill()`, `icon(art, plain)` / `dot()` |
| `bars.ts:moveChip` | glyph ×2 | `glyph(text, plain)` |
| `heads.ts:portHeads` | title ×3 | `titleBar()` / `heading()` |
| `heads.ts:procHeads` | title ×2, box ×1 | `titleBar()` / `heading()`, `boxed()` / `frameBox()` / `button()` |
| `main.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `menu-view.ts:menuBox` | lit ×1, fill ×1, metric ×1 | `lit()`, `fill()`, `textWidth()` / `pick()` |
| `paint.ts:dither` | fill ×1 | `fill()` |
| `pointer.ts:scrollbar` | fill ×1 | `fill()` |
| `ports-view.ts:portRow` | art ×1 | `icon(art, plain)` / `dot()` |
| `procs-view.ts:badge` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `procs-view.ts:band` | lit ×1, fill ×1 | `lit()`, `fill()` |
| `procs-view.ts:command` | fill ×1 | `fill()` |
| `procs-view.ts:confirmBand` | lit ×1, fill ×1, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `procs-view.ts:detail` | rule ×1, fill ×3, art ×1 | `rule()`, `fill()`, `icon(art, plain)` / `dot()` |
| `procs-view.ts:foldArrow` | art ×1 | `icon(art, plain)` / `dot()` |
| `procs-view.ts:pip` | art ×1 | `icon(art, plain)` / `dot()` |
| `procs-view.ts:treeRow` | art ×1 | `icon(art, plain)` / `dot()` |
| `state.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `vitals-view.ts:cell` | title ×2, rule ×1, fill ×1 | `titleBar()` / `heading()`, `rule()`, `fill()` |
| `vitals-view.ts:spark` | rule ×1, fill ×1 | `rule()`, `fill()` |
| `vitals-view.ts:vitalsStrip` | rule ×1, fill ×1 | `rule()`, `fill()` |

#### scripts (2771 lines of its own, 3 functions): done

The reference. The three rows the scan still finds are converted: the glyphs
go through `glyph()`, `runChip` keeps its border with `radius(5)`, `state.ts`
names the art folder the primitives take over.

| file: function | draws | becomes |
| --- | --- | --- |
| `bars.ts:moveChip` | glyph ×2 | `glyph(text, plain)` |
| `rows-view.ts:runChip` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `state.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |

#### pip (846 lines of its own, 7 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `look.ts:seamTone` | glyph ×2 | `glyph(text, plain)` |
| `main.ts:label` | glyph ×2 | `glyph(text, plain)` |
| `main.ts:more` | glyph ×1 | `glyph(text, plain)` |
| `main.ts:render` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `main.ts:renderKeys` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `main.ts:renderMenu` | lit ×1, fill ×2, box ×1 | `lit()`, `fill()`, `boxed()` / `frameBox()` / `button()` |
| `main.ts:seam` | fill ×1 | `fill()` |

#### diff (118 lines of its own, 1 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `main.ts:render` | title ×1, box ×1, art ×1 | `titleBar()` / `heading()`, `boxed()` / `frameBox()` / `button()`, `icon(art, plain)` / `dot()` |

#### equalize-panes (231 lines of its own, 1 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `main.ts:render` | lit ×1, rule ×1, fill ×2, box ×1 | `lit()`, `rule()`, `fill()`, `boxed()` / `frameBox()` / `button()` |

#### usage (568 lines of its own, 9 functions)

| file: function | draws | becomes |
| --- | --- | --- |
| `kit.ts:(top)` | art ×1 | `icon(art, plain)` / `dot()` |
| `main.ts:candle` | fill ×2, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `main.ts:card` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `main.ts:moon` | art ×2 | `icon(art, plain)` / `dot()` |
| `main.ts:page` | art ×1 | `icon(art, plain)` / `dot()` |
| `main.ts:path` | fill ×1, art ×1 | `fill()`, `icon(art, plain)` / `dot()` |
| `main.ts:providers` | art ×1 | `icon(art, plain)` / `dot()` |
| `main.ts:sheep` | box ×1 | `boxed()` / `frameBox()` / `button()` |
| `main.ts:toolbar` | title ×1, rule ×1, fill ×2, glyph ×1 | `titleBar()` / `heading()`, `rule()`, `fill()`, `glyph(text, plain)` |
