# herdr-app: drive the person's window

Fireflies shows spaces, tabs and panes. herdr-core (`hc`) runs their terminals
and keeps them alive when the window closes. Use `herdr-app` only to change
what the person sees. For starting, reading, messaging, waiting on or cleaning
up agents and programs, read `hc --skill` and use hc.
Your terminal address is `$HC_TERMINAL_ID`; it is not a pane ID.

## Inspect before acting

```sh
herdr-app ls          # spaces > tabs > terminals, including pane IDs
herdr-app status      # current layout, focus, overlays, zoom and file/mod errors
herdr-app commands    # available commands, arguments and descriptions
```

`ls` and `status` talk to the running window, not a new app. `commands`
prints the built-in command list even without an open window. Do not launch bare
`herdr-app` to inspect it: that opens or raises the window. Do not stop,
signal or restart the person's app or core. A window closing does not kill
its terminals.

`app.check_updates` checks for newer releases. Settings reports "Up to date"
only after a successful check; on failure, check the connection and retry.

## Show something when asked

New spaces and tabs are shown immediately: only create them when asked.
Pick an explicit, useful name for every new space and tab; don't rely on
default names. Use IDs from `ls` rather than guessing or acting on the wrong
focused pane.

```sh
herdr-app do space.new --name api --folder /path/to/api
herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "Look at the login bug"
herdr-app do pane.split --direction right --pane p12
herdr-app do agent.focus --terminal t7
```

To show the person a web page, `herdr-app do app.open_url --url https://...`
opens it in a web pane beside the focused one (or the system's browser, per
their `links` setting). A web pane keeps tabs: `herdr-app do
browser.open:https://...` opens the page in a new tab of the web
pane last used instead (`browser.tab_next`, `.tab_prev`,
`.tab_close` move between them, `.tab_move_left` / `.tab_move_right` reorder
the shown one).

To show them what runs and what listens (a dev server you started, a stuck
build), `herdr-app do nocturne.procs` opens Nocturne's processes and ports
manager centered (`nocturne.ports` on its ports, where they can open a port in
a web pane, copy its address or end its process; graphs of CPU, memory,
network and disk sit over its lists; a right-click on a row offers what one
does to it). It only shows and asks: ending a process is
theirs to confirm in it.

To put a repo's git, its GitHub (pull requests, runs, projects) or its
scripts beside their terminals as a normal pane that stays, in Nocturne:
`herdr-app do 'nocturne.git:pane'` (`nocturne.github:pane`,
`nocturne.scripts:pane`, `nocturne.procs:pane` for the processes deck; `:tab` a tab of its own, `:window` the floating
window; `'nocturne.git:{"as":"pane","folder":"/abs/repo"}'` another folder).
Without Nocturne: `herdr-app do pane.split
'{"direction":"auto","mod":"git","props":{"slot":"s1","folder":"/abs/repo"}}'`
(`slot` any unique word). In the pane, ctrl-t moves it out to the window
and back.

To show them a database (`nocturne.databases`, or `mod.open
'{"name":"databases"}'` in any layout): open it on a connection with
`herdr-app do 'nocturne.databases:{"kind":"sqlite","path":"/abs/app.db"}'`
(`"kind":"postgres","host":…,"port":…,"database":…,"user":…`; never a
password: the window asks for it, or, for a port-forward on 127.0.0.1, reads
it itself from the Kubernetes secret `"secret":{"from":"kubernetes","context":…,"namespace":…,"name":…,"key":…}`
names: defaults/AGENTS.md has the whole contract), then `herdr-app do
databases.table:lanterns` shows a table's rows and structure,
`herdr-app do 'databases.sql:select count(*) from lanterns;'` puts a query in
a tab (`databases.run` runs it; a write asks the person first, so don't
expect it to run unattended). A change to a table's cell
(`databases.set:<text>` on the cursor's cell) is only staged: the person
reviews and saves it themselves (`w`, then `y`).

To show them a Markdown file you wrote (a plan, a report), `herdr-app do
markdown.open --path /abs/path/PLAN.md` opens it rendered beside the focused
pane (`--anchor some-heading` scrolls there; `--pane p12` picks the pane). It
re-renders by itself when you edit the file, so open it once. They can also
Cmd/Ctrl-click a `.md` path in terminal output.

To show them a file to look at (a screenshot you took, a chart you drew, a
PDF or CSV you generated, a patch, a SQLite database), `herdr-app do
preview.open --path /abs/path/shot.png` opens it beside the focused pane in the
preview: pictures fitted, PDFs paged, CSV/TSV and database tables as tables,
patches colored (on macOS fonts and audio/video too; `image.open` is the same).
It shows the file again when you overwrite it, so open it once and keep saving
to the same path. Cmd/Ctrl-click on such a path (or a Markdown file) in
terminal output opens it as a tab of their editor instead, drawn the same way
(Markdown in the editor's view for it); `herdr-app do editor.open --path … --look true`
does that too. Their files pane opens a picture or PDF in a preview pane of its
own until they open a text file from it, which turns that preview pane into an
editor (the picture its first tab); later pictures from it go to that editor.

To show them code or text at a place (the line you changed, a failing test),
`herdr-app do editor.open --path /abs/path/src/main.rs --line 42 --col 7` opens
it in the editor beside the focused pane, the caret there (an editor already
holding that file in one of its tabs shows that tab and goes there instead;
an editor in that tab takes it as a new tab, but never one the person popped
a tab out into (it keeps its one file); `--in pane` opens a new editor). It reloads by itself when you change a file it
shows unedited; when the person has unsaved edits it asks them first, so don't
fight it. Cmd/Ctrl-click on `path:42:7` in terminal output does the same.
`editor.open` doesn't save for them: their edits are theirs.

Each repository has a scratchpad: the person's Markdown note for it, kept out
of the repository at `~/.config/herdr-app/scratchpad/<repo>-<hash>.md`
(`$HERDR_APP_HOME/scratchpad/` when set), one per repository and shared by its
worktrees; `scratchpad/index.json` names the repository of each file
(`{ "<file>": { "name", "dir": "<git common dir>", "repo" } }`). Read it for
what they noted about the work; write to it only when they ask (an open
scratchpad pane reloads it). `herdr-app do nocturne.scratchpad` opens the
shown space's note beside the focused pane (`nocturne.scratchpad-tab`: in a
tab of its own). It's plain Markdown, kept byte for byte: write paragraphs
and lists as you would in any .md (the person's rendered view adds blocks as
paragraphs separated by a blank line). Pictures the person pastes into it
are saved beside it in `<note>-assets/`; in a repository's Markdown file in
`assets/` beside the file (`![](assets/<file>-<time>.png)`).

To show them a folder (what you generated, where the files you changed
live), `herdr-app do files.open --path /abs/path/out` opens a files pane rooted
there beside the focused pane (`--in tab` for a tab of its own). Cmd/Ctrl-click
on a folder path in terminal output does the same. It leaves dotfiles and
git-ignored files out unless settings.json `files` says otherwise (H / I show
them): to show a `.github/` or `target/` folder, open that folder itself.

When the person wants to keep an eye on an agent (an orchestrator, say),
`herdr-app do terminal.pin '{"terminal":"t7","pinned":true}'` pins it to the
top of the sidebar's agent list (`false` unpins). The pin stays with the
terminal and ends with it. In the nocturne layout any pane can be pinned to the
jar at the top of the sidebar: a plain terminal the same way (it sits as a tile
on the jar's shelf), a web, editor or files pane from its right-click menu,
the palette or `herdr-app do nocturne.pin` with that pane focused (kept in the
mods' shared `nocturne.pinned-panes`; it ends when the pane closes). One tab of
a web pane can have a tile of its own (its tab's menu, or `herdr-app do
browser.pin_tab` for the web pane's shown tab); the tile shows that tab and
wears its favicon, as the web pane's tab strip does. For a pane
that belongs to no project (a docs page, a dashboard), `herdr-app do
nocturne.dock-web` opens a web pane in the dock, a space tied to no folder (no
repo for git or GitHub, terminals start in ~), pinned to the shelf (`nocturne.dock-shell` a shell in ~, `nocturne.dock-files`
a files pane at ~); `herdr-app do nocturne.dock` moves the focused pane there,
whatever it shows (a terminal, an agent, an editor, a files or web pane; not a
pane on another machine). There,
`nocturne.agent-next` / `nocturne.agent-prev` (cmd-] / cmd-[) walk the
sidebar top to bottom as drawn: the pinned agents in the jar, the shelf's tiles
at its foot, then the other agents (awake, then done or idle), wrapping;
the core's `agent.next` / `agent.prev` visit agents only.

For a remote space:

```sh
herdr-app do space.new --name "remote api" --machine vps --folder /srv/api
```

The folder is on that machine; tabs and splits in the space stay there.
A space made with `--folder` is attached to it: its GitHub and git windows use
that repo. `herdr-app do space.folder --id <space> --folder <path>` attaches a
space to another folder later. A person in the Nocturne layout makes spaces
from a folder list instead (`herdr-app do nocturne.space-new` opens it for
them: recent and nearby folders, a path field, "no folder" for a space in ~);
scripts keep using `space.new --folder`.
New-space keys and clicks follow the focused space's machine. Script commands
without `--machine` still use this computer; `--machine ''` explicitly chooses it.
The agent menu checks and starts agents in the remote Unix user's
login/interactive shell (sh, bash, zsh, dash, ksh or fish), including its
configured PATH. Other shells keep the sh launcher.
`terminal.open --folder /path --place down` starts the split in that folder,
including when `--argv` supplies a program. Without `--folder`, it follows the
focused terminal's folder. If an inherited local folder was deleted, new spaces,
tabs and splits retry in that machine's home. An explicit invalid folder
still fails.
`hc machine ls` lists machines. Use `hc run --on vps ...`, `hc exec --on vps ...`
and `hc file ... --on vps ...` for remote work, not your local file tools.

`do` accepts `--key value` arguments (JSON for arrays/objects) or one JSON
object. Unknown argument names fail and list valid names. Target IDs (`id`,
`pane`, `space`, `target`, `terminal`) must be strings; other non-null types fail before
the current-target default can apply. Null keeps its omitted-argument meaning.
Use `commands` to confirm the command's exact shape:

```sh
herdr-app do pane.split '{"direction":"right","pane":"p12"}'
```

`pane.swap {pane?, direction | target}` trades the places of `pane` (default:
the focused one) and its neighbor in a direction, or `target`, another pane of
the same tab. Give `direction` or `target`, not both. Focus stays with the same pane:

```sh
herdr-app do pane.swap '{"pane":"p12","target":"p14"}'
```

`pane.move {pane?, tab? | target?, edge?, space?, name?}` takes a pane
(default: the focused one; its terminal keeps running) to another tab, in any
space on its machine: beside `target` (a pane there) on `edge`, else beside that
tab's focused pane. Neither: its own new tab (`name`) in `space` (default: its
own). The tab it leaves closes when it was its last pane:

```sh
herdr-app do pane.move '{"pane":"p12","tab":"tb3"}'
```

Closing ends what runs there. `tab.close`, `pane.close` and `space.close`
from a script fail with what they would end (an agent in any status, idle
too; for a tab also a busy program or unsaved work) until you pass
`confirmed: true`. Read the error and make sure that's meant before
confirming; a pane or tab of plain shells closes without it:

```sh
herdr-app do pane.close '{"pane":"p12","confirmed":true}'
```

`pane.equalize {scope?, pane?}` evens out pane sizes in `pane`'s tab (default:
the focused one): `scope` `"all"` (default: every row and column, every level),
`"row"` (the panes side by side with it) or `"column"` (the panes stacked with
it). Fixed px sizes stay. A 3x2 grid: split, then equalize all:

```sh
herdr-app do pane.equalize '{"scope":"all"}'
```

`pane.resize {direction, step?, pane?}` moves a pane's divider a step (default:
the focused pane): with a neighbor on the arrow's side it grows that way, at
the tab's edge its other divider moves and it shrinks. `step` is a share of the
tab (default 0.05); panes keep a drag's minimum; a zoomed or one-pane tab
replies `changed: false`. Move pane p3's divider right by a tenth of the tab:

```sh
herdr-app do pane.resize '{"pane":"p3","direction":"right","step":0.1}'
```

In the Nocturne layout, `nocturne.gridify` rearranges the shown tab's placed
panes into an even grid (about square, in their order) and equalizes it; the
terminals keep running:

```sh
herdr-app do nocturne.gridify
```

`pane.park {pane?, index?}` moves a pane out of the arrangement into a chip
row at the bottom of its tab; it keeps running and stays in the tab (`ls`
lists it under the tab's `parked`; a mod pane keeps running too). A tab keeps one pane in place.
`pane.unpark {pane?, target?, edge?}` puts it back where it was, or beside
`target` on `edge`. Park only when asked; it changes what the person sees:

```sh
herdr-app do pane.park --pane p12
herdr-app do pane.unpark '{"pane":"p12","target":"p14","edge":"bottom"}'
```

`terminal.search` opens a find bar in the focused terminal. It searches that
terminal's screen and scrollback; Enter and Shift-Enter move between matches,
Escape closes the bar while its find field has focus, and each terminal keeps its own query (reopening selects it, so typing replaces it).
Clicking the terminal while the bar is open puts typing, including Escape, back in the program; the bar and its matches stay.

It prints the created IDs (for example `{ "pane": "...", "terminal": "..." }`)
or `{ "error": "..." }` and exits 1. Read the result, then inspect `ls` or
`status` to confirm. Commands invoked by an agent never open a missing-argument
dialog: supply all required arguments. A successful launch reply means the
terminal was created, not that its program started correctly. If it exits
with a nonzero code within two seconds, the window shows an error toast with
the exit code and last output lines.

A terminal started with hc opts into the window with `herdr.space=<id>`.
`herdr.tab=<id>` chooses its tab; without it, Fireflies creates a tab in that space.
Unlabeled workers stay hidden. Do not add labels just to run a background
worker. Use app commands when the
user wants to see a new tab or split, hc for orchestration that need not change
the screen.

## Customize layouts, keys, or mods

First read `~/.config/herdr-app/AGENTS.md` (or `$HERDR_APP_HOME/AGENTS.md` if
set). It is the installed guide to settings, layouts, commands and mods.
Read the generated `.d.ts` files beside it for full API details; do not edit
those files or the generated guide. The app rewrites them on start.

- Home defaults to `~/.config/herdr-app`; `HERDR_APP_HOME` selects another.
- Mods live in `mods/<name>/` with `main.js` (or `main.ts`) and optional `mod.json`.
  They are trusted JavaScript or TypeScript with command and network access;
  a `.ts` file runs with its types removed (no enum, namespace, parameter
  properties or `<T>x`; imports name the file, `./kit.ts`), so check its types
  with `tsc` against `herdr-app types <folder>` (the guide's TypeScript section).
  `"focusable": true` in `mod.json` lets `pane.go` move onto a copy; it receives
  `"focus"` from `nextCommand()` and focuses its own keyboard handle. A
  focusable mod pane gets it whenever it becomes the focused pane (a tab switch,
  `agent.next`, a pane closing), as a terminal gets the keyboard, and on a click
  into its native view (a web page), so the mod's keys.json section applies.
  `layout.focus {id}` does the same for a layout block by id; `focused().block`
  names the block holding the keyboard. None of this moves the keyboard out of an
  open dialog, popup or window opened with `scrim: true` (Git, GitHub): those keep
  it until they close, and a key that finds it behind one is dropped.
- Native views (web, PDF, video; macOS) sit above Fireflies' own drawing and
  don't appear in `shot`. Every overlay painted after the one a view is in
  (or after the tabs, for a view in a pane) cuts a hole in it, and a dialog
  backdrop above it dims it; `native.debug`'s `layers` lists each mod copy's
  layer, holes and dim, so check those instead of a screenshot.
- Shipped mods belong to Fireflies: duplicate with `mod.clone` before editing.
  Shipped layouts likewise use `layout.clone` for a personal copy.
  Discover required arguments with `herdr-app commands`.
- Save to reload. A broken save keeps the old version running and reports
  an error in `status`; a still-working screen is not proof the edit worked.
- Make only the requested change. Don't touch unrelated mods or settings.
- Use theme colors. Do not retain a mod's `cx` across callbacks; each
  callback receives its own. Native animations, not redraw timers, keep
  the window cheap to run. Root `on_size_change((size, cx) => …)` reports
  logical pixels after layout, including resizes without pointer movement.
  Optional `View.close(cx)` gets one bounded final call; start cleanup there,
  not in an earlier task. The installed guide explains its 250 ms quit budget
  and which cleanup commands go out before shutdown.

After every mod change:

```sh
herdr-app check ~/.config/herdr-app/mods/<name>
herdr-app status
herdr-app shot /tmp/mod.png   # then look at the picture
```

`check` loads the mod and renders it once. It exits nonzero with the exact
error. Its shared state starts empty and stays in memory; it leaves shared.json
untouched. Never call a mod done without a passing check. Then confirm it is
shown correctly in the running window with `shot`; don't claim a visual
check you haven't made.

`herdr-app shot [file.png]` saves the window's last frame and prints its
absolute path (default: `herdr-shot.png` in your current folder). It is the
app's own rendering at full pixel size: terminals, images, overlays and
floats included, even when the window is covered or minimized. No screen
capture or permissions. It needs a running window that has drawn a frame;
`HERDR_APP_HOME` selects the window, as for `status`.

## Problems and safety

If Fireflies misbehaves, `herdr-app feedback "<what happened>"` drafts a GitHub issue.
With Fireflies open, the person reviews it in a window and opens it on GitHub; without, the
prefilled issue page opens in the browser and its link is printed. Nothing is filed
until the person submits it on GitHub.

A mod's `notify()` toast also reaches the system's notification center (and
the lock screen) while Fireflies isn't in front: keep secrets out of its title
and body. settings.json `system_notifications: false` keeps it in the window.

Never experiment with pointer/key automation on the person's real display.
When developing the app on Linux, its `scripts/sandbox` provides an isolated
home, core and display: `up`, `do`, `status`, `shot`, then `down` when done.
Never stop a server or session you didn't start.
