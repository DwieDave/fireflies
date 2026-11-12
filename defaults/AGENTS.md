# Herdr app

<!-- Written by the Herdr app on every start. Edits here are overwritten. -->

This folder is **the Herdr app's whole interface, as files**. The Herdr app
is a desktop app for terminals and coding agents, and it redraws itself from
these files while it runs: change a layout, a key or a panel here and the
window follows within a second. Shipped layouts and mods are Herdr's:
change settings for look, or clone before editing structure/code (see Layouts).
When someone asks for something ("a sidebar
of my PRs", "give ctrl+1 back to the shell", "make it warmer", "move the
agents list to the right"), you do it by editing these files or writing a
mod. Nothing in the default interface is special: the spaces sidebar, the
agents list, the tab bar, menus, dialogs and notifications are built
from the same parts you have.

## Two programs

- **`herdr-app`**, the window: spaces, tabs, layouts, panels.
- **herdr-core (`hc`)**, which runs every terminal and agent. They keep
  running when the window closes or updates. You can use `hc` yourself:
  start a terminal, read its screen, send it text, wait for an agent
  (`hc --help`). The Herdr app is one client of it.

`herdr-app` controls this app; `hc` controls herdr-core.

## What you can and can't do

You can: rearrange and restyle the whole window (layouts), rebind any key,
write panels (mods) that list, filter and act on spaces, tabs, agents
and terminals, open dialogs, popups and floating blocks, show a live
terminal inside a block, run any app command, run programs (`exec`) and
fetch URLs, keep state per mod or shared between mods, animate natively.

You can't: use HTML, CSS, a web view, Node APIs or `setTimeout`; draw
outside your block except through overlays; change how a terminal itself
draws text; read or change other mods' code at run time.

## What mods are written in

Mods use **gpui-kit** (its gpui-shell): JavaScript that describes **GPUI**
elements, a native GPU UI (`div()`, flex, children,
`.on_click`). There's no DOM: the script describes, Rust draws. Background:
https://gpui-kit.com. The Herdr app carries its own copy with additions
(`frames`, `loop`), so **the type files here are the truth**:
`gpui-kit.d.ts` for elements and `herdr.d.ts` for the app's data and
commands. They're rewritten on every start to match this version.

## Changing things safely

- Edits apply at once. If a file is invalid, the app keeps the last good
  version and writes why to `<name>.error` (`layout.error`, `keys.error`,
  `settings.error`, `programs.error`). Check after every edit.
- `herdr-app check <mod folder>` loads a mod once and checks its initial
  description and eager native elements, including virtual lists and motion.
  It does not lay out the mod or run deferred rows, nested renders, or later
  async states. Never call a mod done without a passing check; also try it
  in the app.
- **Escape hatch:** `ctrl-alt-shift-escape` always works: it sets the shown
  layout and `keys.json` aside (`*.reset-<time>`) and goes back to the
  default `main` layout. Nothing can rebind it.

## Seeing the window

`herdr-app shot [file.png]` saves the last rendered window frame as a PNG
and prints its absolute path (default: `herdr-shot.png` in your current
folder). Use it when debugging mod UIs: inspect spacing, colors, terminal
images, overlays, popups and floats. It captures the app, not the desktop,
at the window’s physical pixel size, even when covered or minimized. No
screen-recording permission is needed. Herdr must be running; before its
first frame or during GPU recovery it reports an error instead of a PNG.
`HERDR_APP_HOME` selects which running window to ask, as with `status`.

## The files

| File | What it decides | Applied |
|---|---|---|
| `layouts/<name>.json` | the window and its whole look: blocks, theme, fonts, backgrounds, pane frames; one file per layout (`main`, `terminals`, `win98`, any you add) | live |
| `keys.json` | what every key does | live |
| `settings.json` | the person: zoom, sounds, fonts for every layout | live |
| `mods/<name>/` | panels: small JavaScript programs | live (hot reload) |
| `programs.json` | how programs show (name, icon, tile), on top of the built-in table | live |
| `icons/` | the shipped program icons | written by Herdr (put your own elsewhere) |
| `frame/` | the app's own screens (welcome, ...) | rewritten by Herdr on every start: don't edit, it won't stick |
| `view.json` | this screen's selected space/tab/pane, zoom, settled tabs, recent spaces and seen attention | written by Herdr |
| `shared.json`, `data/`, `seen.json`, `installed.json`, `window.json`, `windows.json` | mod state, bookkeeping, where the window was (size, maximized), mods' windows (spots, kept ones) | written by Herdr |

Shared state is saved atomically in the background, with the latest change winning.
If `shared.json` is invalid, Herdr logs a warning and keeps it as
`shared.json.corrupt-<time>` before starting empty.
`herdr-app check` uses empty shared state in memory and leaves this file untouched.
Nocturne's GitHub window keeps what it last read of each repo (pull requests,
runs, jobs, project boards; the last 8 repos, under 768 KB, never tokens) in
`data/nocturne-github/cache.json`: it shows that at once when opened and reads
GitHub behind it. Deleting the file only makes the next opening wait for GitHub.
The window picks the folder's repo from its git remotes, not gh's guess: gh's
default if set (`gh repo set-default`), else the remote the current branch
pushes to or tracks, else `origin`, else the others. In a fork, the header's
"fork of owner/name" (or `p`, `F` on every tab) switches to the parent and back.
`L` lists the links in the shown pull request or open card (j/k, enter opens
one); `tab` / `shift-tab` walk the panels; `?` lists every key.
Its third tab, Projects (`3`, or `nocturne-github.projects` in keys.json), is
a GitHub Projects board: the projects linked to the repo (and its parent, for
a fork) and its owner's, `p` to pick one, `v` its board views (their filter,
sort, column field and group-by swimlanes), `/` a filter in GitHub's syntax
(`assignee:@me label:bug status:Ready is:open repo:name -label:x no:assignee`,
field names like `priority:P1`, `sprint:@current`, `estimate:>2`, words).
`h j k l` move, `m` or space carries a card (`hjkl`, `enter` drops, `esc` puts
it back), `e` edits fields, `a` adds a draft, `i` makes a draft an issue,
`x` archives, `enter` docks the card's detail, `o` opens it on GitHub, `-`
folds a column, `z` a swimlane, `w` sets a column's limit. Edits show at once
and roll back if GitHub refuses them. GitHub's API keeps no column limits or
hidden columns, so limits and folds are Herdr's, per project, in shared state
`nocturne-github.boards`. Reading needs gh's `read:project` scope and editing
`project` (`gh auth refresh -s project`); the tab says which is missing.
It also writes, always after a last step that shows the exact commands
(enter or `y` sends, esc goes back; nothing runs before it). `n` on Pull
requests (or its "+ new", a right-click on the list, the palette's "GitHub:
new pull request…", `nocturne.github-pr` in keys.json) opens a new pull
request: base (the default branch) and head (the current branch) picked
from lists, title and body filled like `gh pr create --fill` (the body from
the repo's pull request template when it has one), draft, reviewers,
assignees, labels, milestone; beside it the commits and files it will hold.
A head that isn't on GitHub, or is ahead of it, gets a "push first" toggle
(`git push --set-upstream`). It runs `gh pr create` and selects the new
pull request. `O` on a branch in the git window's branches panel opens it on
that branch (the branch goes through shared `nocturne-github.create`). `n`
on Actions (its "run workflow", a right-click, "GitHub: run a workflow…",
`nocturne.github-run`) runs a workflow by hand: only workflows with a
`workflow_dispatch` trigger, a branch or tag, and the inputs that ref's file
declares (text, number, a list for `choice` and `environment`, a toggle for
`boolean`; defaults filled, required ones checked). It runs
`gh workflow run <file> --ref <ref> -f name=value…`, then waits for the run
and selects it. Both forms take keys like every form (below): tab /
shift-tab walk the fields, then Review and Cancel; ← → change a choice
(base, head, a workflow, a ref, a choice input), space flips a toggle or
opens a list (typing filters it), enter reviews (cmd-enter from the body or
Cancel), esc cancels; in the last step Send has the keyboard, tab reaches
Back. With the window open, `nocturne-github.new-pr` and
`nocturne-github.run-workflow` do the same. On the Projects tab, `e`'s
field editor walks the item's fields with tab / shift-tab too.

Every form takes keys the same way: the GitHub window's, the git window's
commit message and confirms, Nocturne's prompt and confirm dialogs, the
sidebar's new / rename / folder / delete space forms, the ask dialog, the
editor's find line, Add a machine and Send feedback. It opens on its first
field; tab / shift-tab go to the next / previous field or button, wrapping
at both ends (↑ ↓ too, outside a multi-line field), and the focused one has
the accent ring; ← → step a choice and flip a toggle, typing on a list field
opens it filtered; enter submits from a one-line field, a choice or a toggle
and presses a focused button, cmd-enter (ctrl-enter off macOS) submits from
anywhere (enter is a new line in a multi-line field), esc cancels. Each
form's hint line names its keys.

Nocturne's git window (`mods/nocturne-git`, cmd-g, `nocturne.git`; the old
`nocturne.lazygit` does the same) is lazygit in Nocturne's look and runs
the real git CLI, on the space's machine too: 1 Status, 2 Files / Review /
Worktrees, 3 Local branches / Remotes / Tags, 4 Commits (with the lane
graph) / Reflog, 5 Stash, the main view, the command log, the options bar.
Its keys are lazygit's defaults (`?` lists them in the window; `+` / `_`
widen the focused panel: half gives Commits a wide graph column, then full).
Review (`nocturne.diff`, the git button's ▾ > Diff) is what nocturne-diff was:
uncommitted / the branch since its base / a PR's `gh pr diff`, reviewed marks
(space, `a`) and hidden tests / config / assets / docs (ctrl-b). Open it in a
pane or tab yourself with `pane.split` / `tab.new {mod: "nocturne-git", props:
{folder, on?, review?, scope?: "work" | "branch", pr?, repo?}}`. A
`nocturne-diff` pane or window (old saved tabs) hands over to it.
In the window, ctrl-p (or the ⧉ in the main view's title, a right-click menu,
the palette's "Git: open the diff as a pane") opens what the main view shows
as a pane beside the focused pane, ctrl-shift-p in a new tab, and closes the
window. That pane is `nocturne-git` with props `{folder, on?, paneId, show}`,
`show` one of `{kind: "file", path}` (the working diff), `{kind: "commit",
hash, path?}`, `{kind: "stash", ref, path?}`, `{kind: "range", a, b}`,
`{kind: "log", ref}` (a branch's, remote branch's or tag's log: what the main
view shows for the Branches panel, lazygit's `git log --graph` on the lane graph),
`{kind: "review", scope, pr?, repo?, path?}`; it refreshes on changes and its
q / esc close it. keys.json can bind any of the window's actions as
`nocturne-git.<action>` (`open-pane`, `screen-next`, `panel-commits`…).
Worktrees (the Files panel's third tab; `nocturne.worktrees`, the git
button's ▾ > Worktrees, "+ new" > New / Open worktree…) is what the
worktree dialog and the worktrees pane were: the repo's checkouts, the main
one first, with the spaces showing each and the agents working in it. `space`
goes to its space (or opens one), `enter` turns the window to it, `n` checks
out a branch (an existing one, or a new one from HEAD; `w` on a branch,
remote branch, tag or commit does it from there) in
`~/.herdr/worktrees/<repo>/<branch>` on the repo's machine and opens it as a
space, `d` removes it after a confirm that says what goes (uncommitted
files, submodules, commits pushed nowhere, the spaces it closes and agents
it ends; `b` takes the branch too), `o` opens it in a files pane, the
editor, a tab or the file manager, `R` renames its branch, `M` / `U` / `A`
pick the merged, unused or all ones for one `d`, `X` prunes ones whose
folder is gone. Open it yourself with props `{folder, on?, worktrees:
{action: "new" | "open" | "remove", space?, branch?, tab?, argv?}}`: "new"
with a `branch` makes it at once and opens its space with that first `tab` /
`argv`; "remove" asks to remove the space's worktree. The `worktree` mod and
a saved worktrees pane hand over to it.

## The model: spaces, tabs, terminals

Every layout shows the same world; a layout may show less, never a
different one. Each machine keeps its spaces, tabs and splits in its core's
`herdr-app` document. Connected screens share that layout and live terminals,
not their focus, zoom or attention. Use commands to change structure; there
is no `spaces.json`. On simultaneous edits the newest accepted document wins
(no merging); structural commands fail while that machine's layout is unavailable.
Mod pane props are stored as given, never machine-qualified. Space order is local
machine first, then machines by name; `space.move` stays inside its machine's block.
In the expanded Spaces sidebar, drag a space to reorder it within its machine;
the highlighted line shows where it will land.

- A **space** is a place to work, on one machine: this one, or another
  from `hc machine ls` (`spaces()[i].machine`). Herdr leaves out machines
  added with `--temp` (an agent's short-lived sandbox): no spaces, not in
  `machines()`, and mods listing machines skip `temporary`. Names work as in Herdr:
  a space nobody named is called after where its first terminal is now
  (its repo, else its folder, `~` at home) and follows it; once named
  (`space.rename`), the name stays; renaming to "" goes back.
  `spaces()[i].named` says which. Where a space is now is its terminals'
  live folders (`panes()[i].cwd`), not the folder it was made in: new
  tabs start where its focused pane is, and the default mods take a
  space's repo from its first terminal. A space made with a `folder`, or
  given one later (`space.folder`; right-click a space > Change folder…),
  is attached to it (`spaces()[i].attached`): the default mods and
  Nocturne's GitHub, git window, git button and worktrees take its repo from
  that folder instead (a space attached to home still goes by its terminals).
  In the sidebars, spaces stay top level; only a space on a linked git
  worktree is indented under its repo's main-checkout space. Right-click a
  space > New worktree… (or `w` on it in the sidebar) checks out a branch in
  its own folder as such a space, from the git window's Worktrees tab.
  If starting in an inherited folder fails, new spaces, tabs and splits retry in
  that machine's home. Explicit invalid folders still fail.
- A **tab** is a piece of work in a space: its terminals and how they're
  split right and down. One nobody named is called by its place (1, 2,
  ...), as in Herdr; `tab.rename` names it ("fix login"). A space
  has one or more; closing the last one closes the space (it stays in
  `recent`).
- A tab can be **settled** (`tab.settle`): put away on this screen, still running;
  `settled` on each tab. The shipped layouts don't use it (they list every
  tab); a mod that does can hide or fold settled tabs. Showing one, or an
  agent in it needing the user, brings it back.
- A **pane** is a terminal on screen, or a **mod** beside them (a markdown
  viewer, a board, a git panel): `pane.split {direction, mod, props}`. A
  mod pane splits, zooms, closes and gets a header like any pane, keeps
  the keyboard when clicked, and is saved with its tab; its `props` tell
  it what to show (a file, a folder). Closing a terminal pane ends its
  terminal, and a program exiting closes its pane, even if Herdr was closed.
  Terminal panes are kept by their machine's core (`keep: true`). A lost
  terminal (core crash, reboot, logout) gets a shell in its last folder,
  with the same address; its original command is never run again. Splits,
  mod panes and parked panes stay. An exited or killed terminal is closed, not restarted.
  Focus, zoom, recent spaces, settled tabs and seen attention stay on this screen.
- Every terminal is a core terminal. Herdr labels the ones it starts with
  `herdr.space=<id>` and `herdr.tab=<id>`. **A terminal with those
  labels shows up there**, even one you start yourself:
  `hc run --keep --label herdr.space=<id> --label herdr.tab=<id> -- claude`.
  Labels use ids local to that machine; remote ids shown by the app have a
  `<machine>/` prefix (strip it when writing labels on that machine). Adoption
  also enables core keep; `terminal.park` removes the pane and disables keep.
  When a core change is needed, `terminal.keep` / `terminal.park` acknowledge
  with `pending: true`, then apply after the machine replies; failures show a toast.
  Normal quit waits for pending terminal changes and layout writes; remote waits are bounded.
  An id Herdr doesn't know becomes a new space or tab (unnamed: Herdr's names).
  Terminals without the labels (another app's) stay out of Herdr's
  screens, and so do other machines' terminals, unless Herdr started them
  for a space on that machine.
- **Agents** are terminals whose program reports a status (OSC 7501):
  `working`, `blocked`, `idle`, or `done` = finished while the user wasn't
  looking (it becomes `idle` once they look). A space's and a tab's
  status is the most urgent of its agents: blocked > done > working > idle.
- **Sub-agents** are terminals an agent started with `hc run`: the core
  records the starter as `parent` (see `terminals()`). Parent addresses use
  the app's machine names, or a bare ID for this computer, when they can be
  mapped; otherwise they stay as the core reported them. They belong to their
  parent's tab without a pane; the `agents` mod shows them,
  `terminal.peek` opens one, `terminal.keep` gives one a pane.
- **Scripts** (Nocturne's script runner, the `nocturne-scripts` mod): the
  tab strip's ▶ (its deck hangs under it, like "+ new"'s menu; a second click
  closes either, and it stays closed; the button is lit while its view is open;
  cmd-shift-r, `nocturne.scripts`, opens the deck centered or closes it;
  `nocturne.scripts-again` runs the folder's last script again) lists what the space's folder
  (else the focused pane's) can run: package.json scripts (bun / pnpm / yarn /
  npm by lockfile), just recipes, make targets, cargo, deno tasks, pyproject
  scripts (uv / poetry / pdm), Taskfile, mise tasks, composer scripts, go, and
  executables in `scripts/` and `bin/`. The list has the keyboard: up/down or
  j/k, enter runs, shift-enter runs and floats it, `/` filters (esc clears, esc
  leaves the filter, esc closes), g / G the ends, pgup / pgdn a page, tab /
  shift-tab the next group; on a run `w` watches, `x` stops, `R` runs it again;
  an ended run's output scrolls with j/k and g/G; `q` closes, `?` lists the keys. A flake gets `nix flake check` / `update`
  at once and its outputs from `nix flake show --json` (in the background,
  cached): packages (`nix build .#x`), apps (`nix run`), devShells (`nix develop`),
  checks, and build / switch for darwin (Mac), nixos (Linux) and home-manager
  configurations, this machine's (its LocalHostName / hostname) first. A switch
  that needs root shows a lock: it builds as you first (a flake evaluated as root
  fails git's ownership check), then activates the built system through `sudo` in
  the run's own terminal (in your desktop session, so macOS credits Herdr Core's
  permissions). When sudo asks, a small window shows its prompt over that
  terminal ("switch homelab · password"): type the password there; it closes once
  sudo takes it, stays for "Sorry, try again.", and its cancel (or ctrl-c) ends the
  run as "cancelled". A run you already float keeps its float (type there); with Touch ID
  for sudo, its own dialog asks, and a cached sudo doesn't ask. If nix-darwin still says "permission denied when trying to
  update apps", Herdr Core lacks App Management (the core runs the terminals, not
  Herdr): the toast and output say so, with a button that opens System Settings >
  Privacy & Security > App Management and shows
  `~/.local/share/herdr-core/active/Herdr Core.app` in Finder; if it's on already,
  remove it and add it again. A picked script runs in a pane-less
  terminal (`hc run --bg --no-parent`), one dithered cell per run beside ▶; the deck watches (floats it),
  restarts, stops and dismisses runs, and shows an ended run's output; a failure
  toasts. A run is any terminal labeled `nocturne.script=<id>` (with
  `nocturne.script.name`, `.runner`, `.cmd`, `.folder`), so a script you start
  that way shows there too: `hc run --bg --no-parent --cwd ~/app --label
  nocturne.script=dev --label nocturne.script.name=dev -- "bun run dev"`.
- **Notifications** (Nocturne's, the `nocturne-notifications` mod): one place
  for everything agents need from the person, from every agent, space and
  machine. The bell at the right of Nocturne's tab strip, before "+ new" (a 9 px pixel bell,
  muted like the strip's tools when nothing waits) counts what waits: the
  bell turns pink beside a pink chip for permissions and questions; agents
  that need a look turn it yellow, with a dim `+n` and sizes its own block (`layout.resize`) to fit (props `end`:
  the room after it, 8 px unless a block follows); a click on it opens the
  overview hanging under the bell like the scripts deck under ▶ (as wide as
  the window allows, up to 880; with a request as tall as the room below the
  strip, up to 900, with nothing waiting only as tall as its note); cmd-shift-a
  (`nocturne-notifications.open`: a key, the palette, the strip's enter on the
  bell) opens it centered, as cmd-shift-r the deck (up to 85% of the window's
  height). Either closes it again; the bell is lit while it's open. A toast's
  click opens it centered on that agent's request. The overview lists Permissions, Questions and, when there are any, Needs a look (an
  error, or waiting for input that is neither), each with the agent, its
  space / tab and how long it has waited. Finished agents aren't listed: the
  sidebar and Herdr's toast tell about them.
  A permission shows the exact tool call and the options its terminal lists;
  answer with one (↑↓ enter, or its number), or with "yes, but…" / "no, but…"
  (tab / shift-tab): a line sent with the answer as the agent's next
  instruction. A question block opens a dialog like Claude Code's
  AskUserQuestion (j/k or ↑↓, enter / space, typed "other" answers, tab /
  shift-tab between questions and the review's submit / back, wrapping,
  a review that submits all of them, cmd-enter from anywhere). Answers go
  into the agent's terminal as keys, the way a person answers there, and the
  screen is read again before every key: a request that changed or went away
  is refused ("Not sent"), never answered blindly; each key waits for the
  dialog itself to change (not the rest of a busy screen), and when a step
  doesn't take (the note line didn't open, the note didn't arrive) it says
  so in place of the answer. Herdr's "needs you" toast
  says what the agent asks and opens it here. p peeks, g goes to the agent;
  x puts an error away; ? lists the overview's keys (the key bar's last item). The overview and the question dialog also take
  `nocturne-notifications.<key>` commands for keys.json: `next`, `prev`, `up`,
  `down`, `enter`, `space`, `tab`, `back`, `yes-but`, `no-but`, `peek`,
  `goto`, `put-away`, `close`, `keys` (its ? overview), `1`…`9`. Claude Code's exact requests and its
  questions come from its PermissionRequest hook, which only records them and
  never answers (it prints nothing; outside a herdr-core terminal it does
  nothing). Turn it on in `~/.claude/settings.json` (on each machine its
  agents run on; elsewhere, copy the script there):
  ```json
  { "hooks": { "PermissionRequest": [ { "hooks": [ { "type": "command",
    "command": "~/.config/herdr-app/mods/nocturne-notifications/bin/claude-hook", "timeout": 5 } ] } ] } }
  ```
  It writes `${XDG_STATE_HOME:-~/.local/state}/herdr-app/notify/<terminal>.claude.json`.
  Without it, and for other agents (Codex, pi, opencode, ...), a request shows
  herdr-core's words for it and the end of the agent's screen, with peek and
  go to; an agent family gets exact answers by an adapter in the mod's
  `model.js` (`describe` the request from its screen, `step` the keys).
  Ctrl-click (Cmd-click on macOS) a live terminal address in terminal text to
  peek at it. Bare addresses refer to the machine of the terminal showing them;
  use `machine/address` for another machine. Names and non-live addresses aren't links.
- **Links**: Ctrl-click (Cmd-click on macOS) a URL or OSC 8 hyperlink in a
  terminal, or click a link in a mod (`cx.open_url`, `Link` `href`, the update
  notes): an http(s) page opens in a new web pane (`nocturne-browser`) split
  beside that terminal's pane (else the focused one; no pane: a tab of its own).
  Other schemes (mailto:, file:, ssh:, ...) and files go to the system; a file
  one of the app's viewers shows (below) opens in that viewer instead, and a
  folder in a new files pane beside (Files panes), also
  from a mod: `cx.open_url("file:///abs/shot.png")` or a `Link` `href` with a
  `file:` URL (a mod's `file:` links go nowhere else). Without
  the web pane (only macOS has one) or with `links: "system"` in settings.json,
  pages open in the system's browser. The web pane's bar, while it has the
  keyboard (whenever its pane is focused: a click on the bar, `pane.go`, a tab
  switch, agent.next, Cmd-Esc in the page): Enter / `i` into the page, `o` / `/` the address, `H` `L`
  back / forward, `r` reload, `+ - 0` zoom, `p` picture in picture, `d` the
  inspector, `O` the system's browser, Tab / Shift-Tab its buttons (Enter
  presses), `?` the keys. Its keys.json section (`mod:nocturne-browser`:
  Cmd-P / Cmd-L the address, Cmd-R reload, Cmd-[ / Cmd-] back / forward,
  Cmd-Alt-I the inspector) applies in the bar, the address field, the page
  (after a click into it, or Enter from the bar) and its inspector pane, over
  Nocturne's and the global keys (Cmd-P is not the picker there, Cmd-[ / Cmd-]
  not agents), and only in the focused web pane. Enter in the address goes
  and puts the keyboard into the page; Esc leaves the address the same way.
  Cmd-Esc in any native view (page, PDF, player) gives the keyboard back to
  its pane; in a PDF, the player and Quick Look plain Esc does too.
- **Markdown files**: a link to an existing `.md` / `.markdown` file in a
  terminal (a path, `path:42`, a `file://` URL or OSC 8 link, a path relative to
  the terminal's folder, or a bare `README.md` there) opens it rendered in the
  Markdown viewer (`nocturne-markdown`) beside that pane; clicking it again
  shows the viewer already open on it. The files panes do the same for a picked
  `.md` (alt-click; in Nocturne's files pane a double click opens it, and
  alt-double-click or `e` opens it as text in the editor).
  `markdown.open {path, anchor?, in?, pane?, on?}` does it from a mod or an agent.
  The viewer re-reads the file when it changes on disk, keeping its scroll;
  web links in it follow `links`, relative `.md` links open in the same viewer
  (‹ back), `#anchors` scroll, local images are drawn. Besides GitHub's
  Markdown (tables, task lists, strikethrough, autolinks) it draws, as every
  Markdown text in the app does (the editor's preview, the GitHub window): math,
  `$…$` inline and `$$…$$` or a ```` ```math ```` fence as a block, typeset with
  KaTeX's coverage in white (the theme's bright white, or its foreground on a
  light theme; RaTeX, in the app, no network; `$5 and $10` stays text);
  mermaid diagrams in a ```` ```mermaid ```` fence (flowchart, sequence, class,
  state, ER, gantt, pie, mindmap, timeline, git graph, …), in the theme's
  colors; code fences colored by tree-sitter (the editor's languages);
  callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`,
  Obsidian's others, `> [!note]- Title`, MkDocs' `!!! note "Title"`);
  footnotes (`[^1]` as numbered links, the notes gathered at the end, ↩ back);
  front matter as a YAML block. Ticking a task box writes `[x]` into the file
  (local files). A formula or diagram that can't be drawn shows its source and
  why. Its bar: raw / rendered,
  edit (the editor beside; another machine's file: $EDITOR in a terminal), files.
  Keys: `j k` scroll, `d u` half pages, `gg G`, Tab / Shift-Tab the next /
  previous link or picture (its block marked, where it goes at the foot),
  Enter follows, `] [` headings, `h` back, `r` raw, `e` edit, `f` files, `y`
  copy the path, `?` the keys, Esc lets go. Commands for the shown viewers:
  `nocturne-markdown.down`, `.up`, `.top`, `.bottom`, `.raw`, `.back`, `.reload`.
- **Previews**: the same goes for files you look at but don't edit: pictures
  (`.png`, `.jpg` / `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tif` / `.tiff`, `.ico`,
  `.svg`, `.avif`, `.heic` / `.heif`), PDFs (`.pdf`), tables (`.csv`, `.tsv`),
  SQLite databases (`.sqlite`, `.sqlite3`, `.db`, `.db3`), patches (`.diff`,
  `.patch`) and, on macOS, fonts (`.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`),
  audio (`.mp3`, `.m4a`, `.aac`, `.wav`, `.aif` / `.aiff`, `.flac`, `.caf`) and
  video (`.mp4`, `.m4v`, `.mov`). A link to one in a terminal (any of the forms
  above, a bare `shot.png` in the terminal's folder too; `path:42` is ignored)
  opens it in the preview (`nocturne-preview`, called `nocturne-image` before:
  panes and keys saved with that name keep working) beside that pane, or shows
  the preview already on it. The files panes open a picked one there
  (alt-click, or in Nocturne's files pane alt-double-click or `e`: the
  system's app; for a table or patch the editor); so do such links and drawn images in the Markdown viewer.
  `preview.open {path, in?, pane?, on?}` does it from a mod or an agent
  (`image.open` is the same); web URLs stay web pages. JSON, YAML, TOML, source
  code and other text you edit open in the editor (Editing files). Per kind:
  - pictures fit the pane; `+` / `-` zoom, `0` fit, `1` 100%, `h j k l` /
    arrows / drag pan (scroll pans, Cmd/Ctrl-scroll zooms at the pointer), `r` /
    `R` turn, `b` checker / dark background. Animated GIF and WebP play. HEIC
    and AVIF are converted to a PNG copy in `cache/nocturne-preview` (macOS:
    sips, qlmanage; Linux: heif-convert, avifdec, ImageMagick or ffmpeg, else it
    says what to install).
  - PDFs: on macOS the system's PDF view (scroll, `+` / `-` zoom, `0` fit
    width, ← → / PageUp PageDown pages, `g` / `G` first / last; the bar shows
    the page and page count); elsewhere one page at a time drawn by `pdftoppm`
    when it's installed, zoomed and panned as a picture.
  - tables: the header row and row numbers stay put, numbers align right;
    `j k` / arrows rows, `J K` / PageUp PageDown pages, `g` / `G` top / bottom,
    `h l` / ← → columns, scroll (Shift or sideways: across). The separator is
    found (`,` `;` tab `|`); the first 50 000 rows and 200 columns of the first
    4 MB are shown, and the bar says what's left out.
  - SQLite: its tables and views as chips (`t` / `T` next / previous), each
    one's first 1 000 rows as a table; read through `sqlite3 -readonly`, so it
    needs sqlite3.
  - patches (git's, `diff -u`'s, `git format-patch` mails): colored per file as
    the diff pane colors them; `}` / `{` next / previous file.
  - fonts: Quick Look's specimen. Audio and video: the system's player (it
    never plays by itself; while the preview has focus Space / `k` plays /
    pauses, ← → 5 s, with Shift 30 s, `0` the start, `m` sound). Esc in the
    PDF view, the player or Quick Look gives the keys back to the preview.
  The bar: kind, name, facts (size, pages, rows, length), the place among the
  folder's files of the same kind (`n` `]` / `p` `[` next / previous; ← → too
  for a fitted picture), the kind's controls, files (`f`), open (`o`, the
  system's app), copy (`y`, the path), `? keys` (the keys overview in the file's place); Tab /
  Shift-Tab ring the bar's controls (Enter presses one). What it can't show says why and offers
  the system's app. The original is only read (pictures, PDFs and fonts are
  drawn from a copy in its cache) and it shows the file again when it changes
  on disk. Commands for the shown previews: `nocturne-preview.zoom_in`,
  `.zoom_out`, `.fit`, `.actual`, `.next`, `.prev`, `.page_next`, `.page_prev`,
  `.rotate`, `.background`, `.reload`. The files panes' preview split shows
  files with this same viewer (Files panes).
- **Editing files**: source code and other text people edit (every language
  `languageOf` knows, plus Makefiles, Dockerfiles, `.env`, SQL, Ruby, ...)
  opens in the editor (`nocturne-editor`): a link to one in a terminal (a
  `path:42:7` link puts the caret there), a file picked in the files panes
  (Nocturne's: double click or `e`; `E` and folders: $EDITOR in a terminal beside), the
  Markdown viewer's and the preview's edit (`e`: Markdown, tables, patches, SVG
  as text), the file picker, or `editor.open {path, line?, col?, in?, pane?, on?}`.
  One file per pane, beside the pane it came from; an editor already on the
  file there goes to the line instead. The text is the code editor of
  gpui-kit (undo / redo cmd-z / cmd-shift-z, selection, multiple carets, copy /
  paste, folding) colored by tree-sitter in moonfly's roles (a curated set of
  grammars: Rust, TypeScript / TSX / JavaScript, Python, Go, Nix, Lua, Bash,
  JSON, YAML, TOML, Markdown, CSS, HTML, C, Zig; other text plain). Its bar:
  unsaved mark (also `●` in the pane header), name, folder, the problems'
  counts (click: the problems drawer), the language server, language and
  indent, line:col. Saving writes only over what was read: a file changed
  outside while edited says so (reload theirs / keep mine), a clean one
  reloads by itself, keeping the caret. Closing an edited editor's pane or tab
  asks first (`setUnsaved`). Keys while it has focus (keys.json
  `mod:nocturne-editor`, macOS; no function keys): cmd-s save, cmd-f find
  (enter / shift-enter, Aa, esc), cmd-alt-f replace (cmd-enter: all), cmd-l go
  to line (`42`, `42:7`), cmd-k n / cmd-k p next / previous problem, cmd-k m
  the problems drawer, cmd-k d definition (another file opens in its own
  editor), cmd-i the hover card at the caret (again: closes it), ctrl-= / ctrl-- the type a level
  deeper / shallower, cmd-r reload, cmd-k v vim on / off, cmd-shift-v the
  Markdown preview (below). The app's keys win over the code editor's own
  keymap: a chord keys.json binds in `global` or `layout:nocturne` and not in
  `mod:nocturne-editor` runs the app's command with an editor focused (in
  every vim mode, card open or not) and the editor does nothing with it:
  cmd-alt-arrows move between panes, cmd-] / cmd-[ go to the next / previous
  agent, cmd-shift-f greps (indent with tab / shift-tab or vim's > / <).
  `nocturne-editor.keys` (space ? in vim; the hint
  bar's last entry, `? keys`, clickable) the keys overview in the file's place; ? or esc hides it. **Vim** is on by
  default (settings.json `editor.vim`, Settings → Editor). The bar's `vim`
  chip, cmd-k v and `:novim` switch it for that pane only; the pane keeps its
  choice, panes never switched follow the default. The bar shows the mode (NORMAL,
  INSERT, VISUAL, V-LINE, V-BLOCK, REPLACE), the keys typed so far and
  `rec @a` while recording; the caret is a block in normal and visual mode, a
  bar in insert, an underline in replace. It has normal, insert, replace and
  visual (char, line, block) modes; counts; operators d c y > < g~ gu gU ~ with
  motions (h j k l w W b B e E ge gE 0 ^ $ gg G { } % f F t T ; , H-less
  scrolling ctrl-d ctrl-u ctrl-f ctrl-b) and text objects (iw aw iW aW i" a"
  i' a' i` a` i( a( ib i[ i{ iB i< it at ip ap); x X s S r R J gJ o O i a I A
  D C Y p P ctrl-a ctrl-x; registers "a-"z ("A appends), "0, "-, "1-"9, "_
  and "+ (yanks and deletes also go to the system clipboard; p takes another
  app's copy); `.`; macros q / @ / @@; marks m / ` / '; search / ? n N * #;
  undo u and redo ctrl-r; the ex line drawn under the bar: `:w` `:q` `:q!`
  `:wq` `:x` `:e` `:e!` `:e <file>` `:<line>` `:s/a/b/g` `:%s/(\w+)/[\1]/g`
  (JS regex; `&`, `\1`), `:'<,'>d`, `:d` `:y` `:j`, `:noh`, `:novim`. Typing in
  insert mode stays the editor's (IME, auto-pairs, indentation): vim reads what
  was typed back from the text for `.` and macros. gd definition, gr
  references, K hover, ]d / [d next / previous problem. The **leader** (space;
  settings.json `editor.leader`) opens a which-key popup of the keys after it:
  `ff` files, `fg` grep, `e` the files pane, `w` save, `q` close, `d` problems,
  `h` hover, `cf` format, `?` the keys, `gd` definition, `gr` references (`ca` code action and
  `rn` rename are listed, not done yet), `mp` the Markdown preview's next
  view, `ms` / `mv` / `mt` split / preview only / text only. cmd combinations
  stay the app's in every mode.
  **Markdown files** get a live preview beside the text (under it in a pane
  narrower than 760 px), redrawn as you type with the Markdown viewer's
  renderer (math, mermaid, colored code, tables, callouts, footnotes, local
  images: see Markdown files). It follows the text's scrolling and the text
  follows it; ticking a task box puts `[x]` into the text (undoable); links go
  where they point: a heading in it (the text too), another `.md` in the
  editor beside, pictures and the like in the preview, web pages per `links`.
  The bar's chip (split / preview / text), cmd-shift-v and space `m p` go
  split → preview only → text only; the pane keeps its choice. In preview
  only: j / k / d / u / gg / G scroll, `e` or esc back to the text.
  Resting the pointer on a word shows the hover card:
  the server's signature and docs, and every problem there with its whole
  message (multi-line type errors included), code and source. TypeScript and
  JavaScript (typescript-language-server 5.3+ with TypeScript 5.9+) expand the
  type a level at a time (the card's − / +, ctrl-- / ctrl-=). **The card** opens
  under its word (cmd-i / vim's K: the caret's; the pointer: the word it rests
  on) when a full-size card (half the pane) fits there, else above it,
  standing on the line by its bottom edge: its first frame is its place, and
  filling in or growing never moves it (a long one scrolls). Slid in to stay
  inside the pane, at most half the pane tall, never over the word; it stays at its word as the
  text scrolls (hidden while the word is off screen). Its keys: esc closes it
  and does nothing else (in every vim mode and without vim), cmd-i again
  closes it, ctrl-d / ctrl-u and page down / up scroll a long one, gd (cmd-k d)
  goes to the definition; its footer lists them. Moving the caret, typing, a
  click outside it and the editor losing the keyboard close it. Asked before
  the server can answer (loading the `.envrc`, starting, loading or indexing
  the workspace), it opens at once saying what it waits for ("rust-analyzer:
  indexing 120/340") and fills in by itself; the bar shows the server's own
  progress words meanwhile. An answer is kept per place until the text
  changes. Edits go to the server as ranged changes 40 ms after typing (the
  whole text when another editor has the file open), and before every
  question; a hover the pointer left is cancelled at the server. A clean file
  reloaded because it changed on disk counts as saved for the server
  (rust-analyzer's `cargo check` runs, so an agent's edit shows its errors). Language servers run per language
  and workspace (the outermost `Cargo.toml` in the repository, the nearest
  `tsconfig.json` / `package.json`, `pyproject.toml`, `go.mod`, `flake.nix`,
  ..., else the repository) from settings.json's `editor` (see The person):
  the built-in ones only when found (rust-analyzer, typescript-language-server
  or vtsls, basedpyright / pyright / pylsp, gopls, nixd or nil,
  lua-language-server, bash-language-server, vscode-json-language-server
  (validates JSON), yaml-language-server, taplo, marksman, vscode-css / html
  language servers, clangd, zls), shared by every editor of that workspace and
  started as the first editor of that language and workspace opens. **A
  server's lifetime**: it runs while an editor uses it, and 15 minutes after
  the last one closes (coming back is instant); of the servers no editor uses,
  Herdr keeps at most 2, stopping the least recently used first. Nothing starts
  for a project no editor has opened. rust-analyzer builds in its own target
  folder (`target/rust-analyzer`: `cargo.targetDir`), so it never waits on a
  `cargo build`'s lock nor rebuilds what that built; `server_settings`
  overrides it. A file renamed, moved or deleted from
  the files pane (its record `shared("nocturne.files.changes")`: newest last,
  at most 50 entries `{ id, from, to, on, at }`, `to` null for a delete, a
  folder one entry matched by prefix; only entries newer than the editor's
  start, only its own machine's) is followed: a rename or move keeps the
  buffer, unsaved edits, caret, scroll and undo, and the name, folder,
  language, unsaved mark, tab name and the server's document follow (a pane
  restarted later opens it where it went); a delete keeps the editor and its
  text, the bar says `deleted · cmd-s writes it again`, and a save writes it
  again. The Markdown viewer follows a rename or move the same way. Changes
  made elsewhere (a terminal's `mv`, git) aren't followed: the editor keeps
  the old path, and a save there is refused ("the file changed outside
  Herdr"), the draft kept. Found means: in the workspace's own
  environment when the file's folder or one above it (up to the repository)
  has an `.envrc` that direnv allows (looked up and started inside what
  `direnv export` gives, loaded once per folder, a flake's first load
  meanwhile shown as "loading .envrc…"), else on the app's PATH. The loaded
  environment is kept on disk (`cache/nocturne-editor/env-*.json`, keyed by
  checksums of `.envrc`, `.env`, `flake.nix`, `flake.lock`, `shell.nix`,
  `default.nix` and devenv's files): the next app start has it at once
  without running nix, refreshes it behind the scenes, and loads anew when
  one of those files changed (or its server is gone from the store). An `.envrc`
  direnv hasn't allowed is never loaded: the bar says `direnv allow`, as it
  says `no direnv` without direnv. cmd-i with no answer says why (no server
  for the language, not on PATH or in the environment, still starting or
  loading, the `.envrc` not allowed, nothing for that place) and what to do;
  the pointer's hover stays quiet then. Files up to 1 MiB; files on another
  machine open without a language server. Commands for the shown editors:
  `nocturne-editor.save`, `.find`, `.replace`, `.line`, `.next-problem`,
  `.prev-problem`, `.problems`, `.definition`, `.hover`, `.hover-more`,
  `.hover-less`, `.reload`, `.vim`, `.preview` (split → preview → text),
  `.preview-split`, `.preview-only`, `.preview-text`.
- **Files panes** (Nocturne's `nocturne-files`): the tab strip's files
  button toggles the panel down the tab's right edge at the focused pane's
  folder ("+ new" > Files opens a files pane of its own instead, beside the
  focused pane or in a new tab, at the folder a terminal would open in); cmd-e (`nocturne.files`) is the keyboard's way: it opens the
  panel with the keyboard in it, moves the keyboard into an open one, and
  closes it when pressed inside, the keyboard back in the pane it came from
  (esc in the panel goes back there and leaves it open; `q` closes it). A
  files pane that opens as the focused pane takes the keyboard; `pane.go`
  reaches every files pane; `nocturne-files.take-panel` hands an open panel
  the keyboard (cmd-e sends it after `pane.focus`). A link to a folder (Ctrl/Cmd-click a path, a `file://` URL or a
  bare `ls` name in a terminal, a mod's `file:` link) opens a files pane of its
  own rooted there, split beside that pane (clicking it again shows the one
  already there); so do `files.open {path, in?, pane?, on?}` (`in: "tab"`: a tab
  of its own; `"system"`: the system's file manager) and the palette's "Files
  pane of this folder". It works as the panel (files open beside it) and closes
  with `q` / `esc`. In every files pane a click on a file selects it (the
  keyboard goes there, the preview split follows) and opens nothing; a double
  click opens it (alt-double-click: the other way, as `e`). A click on a folder
  folds it; a double click opens the folder in $EDITOR (its first click's fold
  undone). Every files pane: `j k h l` / arrows, `gg` / `G`, enter,
  `e` / `E` edit, `p` its viewer (preview, Markdown), `-` / `.` reroot, `[` / `]`
  (alt-← / alt-→, ctrl-o / ctrl-i, backspace; the toolbar's ‹ ›) back and
  forward through the folders rooted at (back with none goes up), `r` refresh; `/` filters as you type (fff's fuzzy
  `findFiles` over the root, git-ignored files left out; hits under their
  folders, ↑↓ pick, enter opens, a folder shows in the tree; esc clears; home,
  `/` and other machines search the folders listed so far); `H` / `I` (the eye
  switches under the toolbar) hide or show dotfiles and git-ignored files
  (`git ls-files --ignored`), each pane keeping its choice (shared
  `nocturne-files.filters` by slot; new panes take settings.json `files`).
  Right-click a row or press `m` for its menu: open, edit, $EDITOR, Open in
  Neovim (`v`: `nvim` from PATH in a terminal beside, on a file in its folder,
  on a folder `nvim .` there), a folder in a new files pane (`o`), copy the path
  (`y`), the file operations below, close; on the empty space below the rows:
  new file / folder and paste in the root. File operations, one row at a time:
  `a` new file, `A` new folder (a name row in the selected folder or beside the
  selected file; slashes make the folders on the way, a trailing `/` makes a
  folder, a new file opens as enter would), `R` rename (the stem selected; a
  path in the name, `../x` or `docs/`, moves it), `x` cut and `P` paste into the
  selected folder (shared `nocturne-files.cut`: any files pane on that machine),
  `d` delete after asking (y / enter; anything else keeps it): to the machine's
  trash (macOS's `/usr/bin/trash`, else `gio trash` or `trash-put`), without
  one permanently, and the question says so. Enter confirms a name, esc
  cancels; while a name or the question is open the pane's keys go to it. An
  existing target is refused (nothing is overwritten), so are the root and a
  folder into itself; a failed command shows its error in the hint line. The
  tree then shows the result, unfolded and selected. Editors with a renamed,
  moved or deleted file open keep the old path. Several rows: cmd-click marks or
  unmarks a row, shift-click marks every row from the last clicked one, `t`
  marks / unmarks and steps down, `V` marks a range while moving (`V` again ends
  it), shift-↑↓ mark while moving, esc clears the marks before anything else;
  the hint line counts them. With marks, `d` (one question: the count and the
  first names), `x` / `P`, `y` (every path, one a line) and the menu on a marked
  row ("Delete 3 items…") act on all of them; a marked folder covers what's in
  it; rename, open, edit and the viewers act on the keyboard's row. Each row is
  tried; what failed is listed afterwards with its reason. Drag a row, or the
  marked rows when the press starts on one, onto a folder row or below the rows
  (the root): the target lights while a drop is allowed (not into itself, its
  own folder or where it already is), a folder unfolds after a short rest, the
  list scrolls near its edges, esc or a release elsewhere cancels. Every rename,
  move and delete that worked is appended to shared `nocturne.files.changes`
  (`[{ id, from, to, on, at }]`, newest last, 50 at most, `to` null for a
  delete, a folder one entry with its own paths: match by prefix) for editors to
  follow. `?` (or the `? keys` that ends the
  filter line) shows the keys overview in the list's place; `?` or esc hides it.
  The preview split: `space` (the toolbar's split icon, the menu's "Show the
  preview") shows the selected file in a part of the files pane's own area, at
  the bottom of a pane taller than wide and at the right of one wider than tall
  (near square it stays where it was); `space` again hides it. Moving through
  the tree updates it once the selection rests (stepping fast loads only the
  last file), and the keyboard stays in the tree: `J` / `K` scroll the preview
  (half a view; a PDF a page), `<` / `>` make it smaller / bigger, or drag the
  divider; both parts keep a usable least. It is the preview pane's own viewer
  (`nocturne-preview/viewer.js`; nocturne-files ships identical copies of it
  and its files), so every kind the preview shows looks the same here, and it
  adds text: code in the editor's colors, Markdown rendered, other text plain,
  the first 256 KB. A binary without a viewer or a file it can't read says why
  in one line; a folder shows what it holds. On another machine only text is
  read (a capped `head`); pictures, PDFs, fonts and clips there say `p` opens
  them. Clips never play by themselves. A native view (PDF, font, clip) steps
  aside while the menu is open. `nocturne-files.look` toggles it in the focused
  files pane (the palette's "Show or hide the preview"). Enter, `e`, `E`, `p`, `v` and a double click open as
  before: the split is only a look. Each pane keeps it (on, size) in shared
  `nocturne-files.look` by slot.
- **Finding files** (Nocturne's `nocturne-picker`): cmd-p (`nocturne.picker`)
  finds a file in the space's repository (its attached folder, else the focused
  pane's, else the editor's or files pane's, else one of the space's terminals',
  else where the space was made; the first that's still there, up to its git
  top; when none is, it names the missing folder and says to change the space's
  folder) by fuzzy, typo-tolerant name; cmd-shift-f
  (`nocturne.grep`) searches every file's text as you type, lines grouped by
  file. Both are fff's (`findFiles`, `grep`): git-ignored files stay out, the
  folder's index stays warm while it's used. It covers most of the window: the
  list beside a preview of the picked file around the line, about two thirds
  wide and as tall as the picker (narrow windows drop the preview). tab or
  shift-tab switches mode keeping the query, and so does the other mode's key
  while it's open (cmd-shift-f in files, cmd-p in grep; each chip at the top
  right names its key); the same key again closes it. ↑↓ or ctrl-p / ctrl-n
  pick, pgup / pgdn page, enter opens in the editor (grep: at the line),
  ctrl-r regex, ctrl-t fuzzy lines, esc closes. The hint bar lists every key.
  A `query` prop starts the box with text. Tab is the base's focus key: a mod
  that wants it binds it to an action in its own `key_context` (`cx.bind_keys`),
  as the picker does; an `on_key_down` alone never hears it. Bind once: a mod's
  bindings stay bound when keys.json is edited and reloaded.
- **The command palette** (`app.palette`, cmd-shift-p) lists every command a
  person can run without pointing at something, each row with the key that
  runs it now (a key a layout or the focused pane takes for something else
  isn't shown on the row it shadows). Commands for what's focused or waiting
  show only then: terminal ones on a terminal; pin, right-clicks to the
  program, Send back to the parent for the focused agent or sub-agent; Move
  this pane to a new tab beside another pane; Restart into / Update
  herdr-core once an update waits. Commands that need an id, index, path or
  URL (`tab.select`, `pane.focus`, `editor.open`, ...) stay out: the
  palette's `OUT` list names each with its reason, and a test fails when a
  command, a shipped key's action or a Nocturne mod command is neither in it
  nor in the palette. Nocturne's palette (its `palette_mod`) adds its own:
  Find a file… and Grep the project… (`nocturne.picker`, `nocturne.grep`),
  New… (the + new menu), the panels, Start <agent> (beside or in a tab), New
  worktree…, Notifications, the keyboard to the sidebar / tab strip / pane
  header, the toast's action, and while it's focused the focused pane's own
  commands (an editor's save, find, go to line, problems, vim...; a web
  pane's address, reload, back, inspect...; the Markdown viewer's, the
  preview's, the agents graph's, usage's), and the git and GitHub windows'
  while they're open. A mod opening Nocturne's palette itself
  (`openOverlay({ mod: "nocturne", props: { dialog: "palette", query } })`)
  may hand it a search to start from.
- **Agent navigation order** belongs to the mods. A mod displaying agents calls
  `setAgentOrder(list.map(a => a.address))` on render so `agent.next` /
  `agent.prev` follow its list.

## Layouts: `layouts/<name>.json`

Each file is one whole window. `layout.switch` (`ctrl-shift-l`) cycles
through them, `layout.switch {name}` picks one; `shared("layout")` is the
shown one's name. Herdr ships `main` ("Herdr": spaces by machine and the
agents list on the left, `workspace-chrome`; tabs as pills with a + menu
that starts a terminal or any installed agent, `new-menu`; panes as cards
with a header; Files and Changes panels on the right, `files` and
`changes`, opened from the tab bar and remembered per space (which ones:
shared `"workspace.panels"`, set by the welcome); a status bar,
`workspace-status`), and as examples `terminals` ("Terminals": tabs in
the title bar, panes as cards, a space picker) and `win98`
("Herdr 98": a whole desktop in one mod, `win98`). Add a layout by
writing a new file. The Files panel supports Windows folder paths with spaces,
parentheses and apostrophes, and preserves Unicode file and folder names
(including Chinese). Directory links expand as folders; their contents load
only when expanded.

**Herdr's own layouts and mods are read-only.** They are replaced whole
on every start. Use settings.json for look (fonts, sizes, theme, colors,
sounds), where the layout leaves them unset. Herdr (main) has no look of
its own, so your settings decide it; Herdr 98 and Terminals bring their own
look. The theme picker overrides any layout. To change a shipped layout's
look beyond that, or its structure/code, clone it and edit the clone:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
herdr-app do mod.clone '{"name":"files","as":"my-files"}'
```

The default clone name is `<name>-copy`; an existing name is refused.
`layout.clone` switches to the clone. In the palette: Duplicate layout
or Duplicate mod. Clones are yours and never updated. They record
`cloned_from: {name, version}` and copy the layout and its clicks as-is,
including its look. A cloned layout keeps its mod references:
clone a mod too and point your layout's `content.mod` to it to change code.
Mod clones rewrite their own `mods/<name>/` asset paths and self-opening
overlay names to the new name.

If you edit a shipped file anyway, the next start moves it to
`<name>-edited` (a mod folder or layout JSON; a number is added if taken),
copies its layout clicks, restores Herdr's version and shows a toast.
No-longer-shipped things go if
untouched, otherwise they stay.

Clicks (sizes, shown/hidden, stack child, floating spots, theme picks,
background, text size, pane header height and border/focus look) live
in `layouts/.state/` and survive restarts. Don't edit those files.
A deliberate layout-file edit beats a click on that field.
`layout.reset {name}` resets a shipped layout and its clicks, keeping its
previous file aside as `<name>.json.old-<time>`.

A layout is a tree of nodes. Four types:

- `block`: shows content. `"content"` is `{ "mod": "<folder>", "props": {...} }`,
  `{ "terminal": "t7" }`, `{ "tab": "active" }` (the shown tab's
  terminals as it arranges them), or `{ "agent": "focused" }` (one agent's
  terminal, full size: the one chosen with `agent.focus` / `agent.next`, else
  the focused pane's agent, else the first agent).
- `row` / `column`: children side by side / stacked.
- `stack`: shows one child (`"active": "<child id>"`), with an optional
  `"header"` (a mod that draws tabs, or `"tabs"` for a plain built-in strip).

Properties any node can have:
- `id` (unique; commands use it), `size`: `{ "px": 240 }` or `{ "weight": 2 }`
  (shares of what fixed siblings leave), `min` / `max` (px), `hidden`.
- Paint: `background` (a color; `{ "gradient": ["#2a6cbd", "#0b2a57"], "angle": 165 }`;
  or `{ "image": "backgrounds/sky.jpg", "fit": "cover" | "contain" }`, a path in
  the home folder), `border` (`{ "width": 1, "color": "border" }`), `radius`,
  `shadow` (`"sm" | "md" | "lg"`), `focus` (`{ "border": {...} }` when the
  focused pane is inside).
- `padding`: space inside the node's edge, px: `16` or `[vertical, horizontal]`.
- row/column: `gap` (px between children), `divider` (`{ "width": 1, "color": "border" }`),
  `resizable` (default true: drag the boundary). This applies to that row/column only.
- `movable` (default true): panes can be dragged by the app's top-center grip within a split tab.
  Unlike `resizable`, it inherits: the nearest explicit ancestor wins, through the
  tab tree and then the layout's tab block and its ancestors. Root `"movable": false`
  opts the layout out. Composition terminal blocks aren't tab panes and never drag.
  Center drop swaps panes; an edge drop places beside it. Escape or dropping outside
  another pane cancels. Zoomed tabs and one-pane tabs don't drag. The grip appears
  on top-edge hover, regardless of the header's position or presence. Only the grip
  starts dragging; header mods don't need drag handlers. `panes()` exposes `movable`.
- `floating`: blocks over this node (below).
- `window_drag: true`: dragging the node moves the window, a double-click
  maximizes it. A mod's own control inside opts out by stopping the press:
  `.on_mouse_down("left", (_e, cx) => cx.stop_propagation())`.
- Root only: `"titlebar": "none"` hides the system title bar so the layout
  draws its own (a bar mod in a `window_drag` block). macOS keeps its window
  buttons over the layout at `"traffic_lights": [x, y]` (px); leave them
  room. Where the system draws no buttons (`window().buttons`, Linux and
  Windows), the bar draws them with `window.minimize`, `window.maximize`, `window.close`.
  Windows' shipped tab bar and system strip use vector window icons, with a
  restore icon when maximized, rather than font glyphs.
- Root only: `"preview": "layouts/<name>.svg"` (or png): the picture the
  settings screen shows for this layout. Draw one when you make a layout;
  without it the person sees a plain frame. New layouts and `themes/*.json`
  show up in settings by themselves.
- Root only: `"terminal_menu": "my-menu"` chooses the mod for terminal
  right-clicks (including Shift+right-click). Omit it for the shipped `menu`;
  an unknown mod logs a warning and falls back to `menu`. Clone a shipped
  layout before changing this field. Other menus are unchanged.
- Root only: `"toast": "my-toast"` chooses the mod that shows notifications
  (Herdr's own and every `notify()`), in place of the shipped `toast`; an
  unknown mod logs a warning and falls back to `toast`. It gets the same
  `props()`: `{title, body, level, icon, action, timeout, overlay}` (`timeout`
  is optional). A mod that hands them to the system instead
  (`exec("notify-send", ...)`) closes itself at once
  with `closeOverlay(props().overlay)`. The older name `"toast_mod"` (this fork) still works.
- Root only: `"prompt_mod"`, `"confirm_mod"`, `"palette_mod"` (this fork) choose
  the mods for the name prompt (rename tab/space), the confirm dialog (close a
  space, ...) and the command palette, in place of the shipped `prompt`,
  `confirm` and the frame's palette. Each gets the shipped one's props (prompt:
  `title`, `value`, `hint`, `command`; confirm: `title`, `detail`, `command`;
  palette: none) plus `dialog` (`"prompt"`, `"confirm"`, `"palette"`) and
  `overlay`, keeps its size and spot, and opens with `frame: "none"`: the mod
  draws its own border and background. Run `command.name` with `command.args`
  (a prompt adds `name`) and close with `closeOverlay(props().overlay)`. An
  unknown mod logs a warning and keeps the shipped one.
- Root only: `"peek_mod"` (this fork) draws the 34 px bar over a peeked or
  floating terminal in place of the shipped `peek`, with its props
  (`terminal`, `float`, `views`, `overlay`) plus `dialog: "peek"`. Herdr still frames
  the overlay; read `defaults/mods/peek` for the keep / dock / end / close controls
  and the switch between a float's views (`views`: their names, or null; run
  `float.view {index}`; `terminals()`' `floating_view` says which one shows).
- Root only: `"dialog_mods"` (this fork) maps Herdr's other screens to the mods
  that draw them instead: `welcome`, `whats_new`, `help` (the keys), `worktree`,
  `machine_add`, `update` (the update note, bottom right), and `prompt`,
  `confirm`, `palette` (as the fields above, which win). Each gets the shipped
  one's props plus `dialog` (that key) and opens with `frame: "none"`, wherever it
  is opened from (the app, a key, or a mod's `openOverlay({mod: "worktree"})`;
  the shipped `worktree` is now a stub that opens the git window's Worktrees).
  A welcome records `setShared("frame.welcomed", "finished" | "skipped")`; a
  what's new calls `presentUpdateNotes(versions)`. The update note gets
  `{label, restart, success, dismissal}` (restart: run `app.update`) in a 460×34 px
  slot it hides itself from. Settings and feedback stay the app's (they follow the
  theme). Nocturne: `defaults/mods/nocturne/screens.js`. Nocturne's dialogs,
  menus and screens take the keyboard when they open and give it back when they
  close: tab / ← → between a dialog's field and buttons (the focused one lit),
  ↑↓ / j k (ctrl-n / ctrl-p in a list with a search field) move, enter / space
  press, esc closes; a confirm also takes y / n. Keep that when drawing your own.
  `{"dialog_mods": {"welcome": "my-screens", "help": "my-screens"}}`
- Root only: `"corners": "square"` (this fork) paints every corner in the window
  square: dialogs, menus, toasts, buttons, inputs, scrollbars, images, mods' own
  `rounded*` included. Default `"round"`: as each asks.
- Root only: `"scrim"` (this fork): what dims the window behind a dialog (and the command palette,
  and windows / popups opened with `scrim: true`),
  `{"color": "#000000", "opacity": 1, "dither": true, "fill": 0.45, "cell": 1}` (color: a
  theme name or hex; dither: a 1-bit checkerboard of it, `cell` px; `fill`: the same
  color at that opacity under the checker, so a dithered scrim can dim past half).
  Default: black at 35%.
- Colors are theme names (`border`, `accent`, `surface`, ...) or `#rrggbb[aa]`.

A personal terminal menu replaces the whole menu; it doesn't merge items.
Create `mods/my-menu/main.js` and `mod.json` (e.g.
`{"place":"none","overlay":{"width":280,"height":100}}`), then set the layout root's
`"terminal_menu": "my-menu"`. It opens as a pointer popup, default 220×260 px;
its `mod.json` overlay width/height override those defaults. It gets
`props()` = `{tab: "pane", target: {pane, terminal}, overlay}`. Always use
`target.terminal` or `target.pane` in actions, not the focused terminal:
right-clicking a different terminal must act on the one clicked. A terminal
shown outside a tab (a layout terminal block, a window) has no pane:
`target.pane` is its block's id, not in `panes()`, so leave out pane items
there, as the shipped menu does. For example:

```js
import { View, div } from "gpui-kit";
import { props, run, closeOverlay } from "herdr";
export default class MyMenu extends View {
  render() {
    return div().id("split-target").child("Split this pane").on_click(() => {
      const {target, overlay} = props();
      closeOverlay(overlay);
      run("pane.split", {pane: target.pane, direction: "right"});
    });
  }
}
```

### The look: on the layout, cascading

A layout's own look wins; settings.json fills what it leaves unset.
The theme picker overrides both. These go
on any node, and the nearest node up the tree wins, so the root sets the
layout's look and a block can differ:

```json
{ "id": "root", "type": "row", "theme": "graphite", "colors": { "accent": "#a7b4c6" },
  "font": "Geist Mono", "font_size": 15, "ui_font": "Geist",
  "terminal_padding": [10, 6], "terminal_opacity": 1, ... }
```

- `theme`: `graphite`, `ink`, `moss` (dark), `paper` (light), or the name
  of a file in `themes/`; or one for each appearance:
  `"theme": { "light": "paper", "dark": "graphite" }` follows the system's
  light or dark mode (or the person's `appearance`). `app.theme {name}`
  sets the half of the name's lightness. A layout without a theme shows
  settings.json's theme, else graphite or paper. `colors` overrides any theme color by name (see
  `theme()` below), for terminals and panels alike: overrides apply in
  both appearances, so name theme colors (`chrome`, `canvas`) rather than
  writing hex when a layout should work light and dark.
- `themes/<name>.json`: `{ "background", "foreground", "selection",
  "cursor"?, "ansi": [16 colors], "colors"?: {...} }`, all `#rrggbb`; panel
  colors are derived from these, `colors` overrides them. Herdr ships
  `atom-one-dark`. The original unedited Atom One Dark and Win98 theme files
  are upgraded to readable terminal colors; edited theme files are kept.
  A theme named like a layout (`themes/win98.json`) is
  that layout's own: Settings offers it only there.
- `font` / `font_size`: the terminals' (px at zoom 1); `ui_font`: the mods'
  (their text sizes are their own, in px, and follow zoom). Optional: without
  them a layout uses settings.json's, else Herdr's (JetBrains Mono 14, Geist).
  Herdr (main) leaves these unset; Terminals sets text size 15, and Herdr 98
  brings its own fonts.
  JetBrains Mono, Geist Mono and Geist ship with Herdr; any installed font
  works (a terminal font the machine lacks falls back to JetBrains Mono).
  A layout brings its own fonts: `.ttf`/`.otf` files in a mod's `fonts/`
  folder (or the home's `fonts/`) load at start and on the next look change,
  so a layout and its mod folder travel together (Herdr 98's do: its pixel
  fonts are in `mods/win98/fonts/`).
- `pane_scrollbars` in settings.json (default `true`): show terminal scrollback
  with a slim thumb and track. Drag the thumb or click the track to jump there.
  With little or no terminal padding, the hit lane overlays the last 8px;
  terminal columns do not change. Hidden in alternate-screen programs.
- `terminal_opacity` (0..1): below 1, the background behind a terminal
  (a pane frame's, the layout's gradient) shows through its text.
- Switching layouts switches the look. The theme menu changes the shown
  layout's root `theme`.
- Today only the root's look applies; a block's own look is coming.

### Pane frames

The tab block says how each pane of the shown tab is wrapped:

```json
{ "tab": "active",
  "pane": { "gap": 6, "radius": 6, "background": "surface",
            "border": { "width": 1, "color": "border" }, "focus": { "width": 1, "color": "accent" },
            "header": { "content": { "mod": "pane" }, "height": 30, "position": "top", "reveal": "always" },
            "lone": false } }
```

- The look applies to every pane; `focus` replaces the border while the
  pane has the keyboard; `gap` is the space between panes.
- `header`: a mod drawn on each pane, one copy per pane, with
  `props().pane` and `props().terminal`. It reads its live facts from
  `panes()` (title, folder, branch, agent status, focused, zoomed, font_zoom, parked; a mod pane's `props`) and its
  buttons run pane commands with that pane (`pane.split`, `pane.zoom`,
  `pane.close`). `position`: `top` or `bottom`; `reveal: "hover"` shows it
  only while the pointer is on the pane, drawn over the terminal so the
  terminal never resizes. The shipped `pane` mod keeps its divider on the
  terminal-facing edge and reads the frame position from `layout()`.
- `lone: true` frames a tab's only pane too (default: only when split).
- `parked`: the chips of parked panes (`pane.park`) in the row under the tab.
  Each chip is a small pane frame (this frame's background, border, radius;
  `focus` while hovered), `gap` below the panes and apart, starting at their
  left edge. `{ "content": { "mod": "…", "props": {} }, "width": 200, "height": 24 }`:
  `content` draws in each chip, one copy per parked pane with
  `props().pane` / `props().terminal` (default: the app writes the pane's
  name and status), `width` (default: as wide as the name; a mod chip 180),
  `height` (default: the header's, else 24). The app handles the pointer on
  chips (click, drag); a chip mod only draws. Nocturne's is `role: "parked"`.
- Each layout has its own, so one can stay bare while another makes
  every pane a card.

### Floating blocks

```json
"floating": [ { "id": "board", "content": { "mod": "board" }, "edge": "left", "align": "center", "peek": 52 } ]
```

A floating block sits over its node, `edge` (`top`, `right`, `bottom`,
`left`) and `align` along it (`start`, `center`, `end`), 12 px in. It sizes
to its content (render nothing to hide it). People drag it anywhere; on
release it springs to the nearest edge and third, and Herdr saves the new
spot. Clicks and hovers on it never reach what's underneath.

`peek` (side edges only) makes it a drawer: only that many px next to the
edge show until it's hovered, then the rest slides out; it slides back a
moment after the pointer leaves. The mod draws one full layout and never
changes it on hover (that's what keeps it smooth): put what should peek
(status, icons) on the edge side of each row.

Herdr draws the frame around a floating mod (theme background, border,
rounded corners, shadow; accent border while dragged), like a dialog's,
with 5 px above and below. The mod draws only its content, no panel: on a
side, rows can run edge to edge. It reads `placement()`:
`{ edge, align, vertical, hovered, dragging }`. Lay out vertically when
`vertical` (left/right edges), horizontally otherwise; on the right edge,
mirror rows so their edge side is on the right.

The default window:

```json
{ "id": "root", "type": "row", "divider": { "width": 1, "color": "border" },
  "children": [
    { "id": "sidebar", "type": "column", "size": { "px": 240 }, "min": 40, "max": 480,
      "divider": { "width": 1, "color": "border" },
      "children": [
        { "id": "spaces", "type": "block", "content": { "mod": "spaces" } },
        { "id": "agents", "type": "block", "content": { "mod": "agents" } } ] },
    { "id": "work", "type": "column",
      "children": [
        { "id": "tabs", "type": "block", "size": { "px": 30 }, "content": { "mod": "tabs" } },
        { "id": "main", "type": "block", "content": { "tab": "active",
          "pane": { "gap": 6, "radius": 6, "border": { "width": 1, "color": "border" },
                    "focus": { "width": 1, "color": "accent" } } } } ] } ] }
```

Sidebar on the right: swap the two children of `root`. No sidebar: set
`"hidden": true` on `sidebar` (the user can toggle it: `ctrl-shift-b`).
Narrower than 160px, the sidebar mods draw a compact rail; folding resizes
`sidebar` to 44 (76 on macOS, room for the traffic lights). On macOS,
the tabs also leave room for the window buttons when the sidebar is narrower.
Nocturne's sky folds the same way (cmd-b, `nocturne.fold`) to a rail as wide as
the window buttons need at the person's zoom; it and the open sky list agents
needs you, working, running a command, done, resting; the done and resting ones
sit on the ground above the hills (the rail pairs them up when crowded). A row
takes a press anywhere on it (its full width and half the gap to its
neighbours; on the rail the cell and its padding): click focuses the agent,
right-click its menu, double-click renames it. Pinned agents
(`terminal.pin`, the `herdr.pinned` label) sit above them all in a glass jar
at the top (in the open sidebar a mason jar: a threaded lid, round shoulders,
a sheen down its glass, never shorter than a jar with room under one firefly;
on the rail a small one), in the order pinned (the label `nocturne.pinned-at`, ms; a pin
made elsewhere gets one when the sky sees it), keeping their status. Pin or
unpin from a firefly's or an agent pane's right-click menu (open sky and
rail), the palette or cmd-alt-p (`nocturne.pin`: the focused pane's agent);
`nocturne.pin-up` / `nocturne.pin-down` (cmd-alt-shift-[ / ] on macOS) move it in the jar. Toasts by key:
`nocturne.toast` does what the newest toast on screen says (as a click would),
`nocturne.toast-close` (or `nocturne.toast-dismiss`) dismisses it. Scripts:
`herdr-app do terminal.pin '{"terminal":"t7","pinned":true}'`.
While the pointer is over the sky (open or folded) it carries a firefly's
light: a small dithered diamond in the theme's ansi11 around a pixel + that
trails it and lights the stars, haze and grass near it. Every 2.8 s it
signals as a firefly does, two quick blinks: the + turns into a bright x and
a square ring opens out from it, then rest. It fades when the pointer leaves;
it holds still when the window isn't in front or the system asks for less
motion (nocturne's `glow.js`, a nested view, so it never redraws the sky).

Nocturne's chrome by keyboard: its sidebar and tab strip are focusable blocks
(`sidebar`, `tabs`), so cmd-alt-left from the leftmost pane enters the sidebar
and cmd-alt-up from a top pane the tab strip; `nocturne.sidebar`,
`nocturne.tabstrip` and `nocturne.header` (the focused pane's header controls)
go straight there and, pressed again, back (macOS: cmd-alt-s, cmd-alt-t,
cmd-alt-.). cmd-alt-n does what the newest toast offers (`nocturne.toast`),
cmd-alt-shift-n dismisses it (`nocturne.toast-close`). Floating windows:
ctrl-` / ctrl-shift-` pass the keyboard to the next / previous one
(`overlay.focus`). To move or resize it by key, bind `overlay.move` in keys.json, e.g.
`"ctrl-alt-left": {"command": "overlay.move", "args": {"dx": -40}}` (`dw`/`dh` resize). A blue ring or edge marks the
cursor; j/k (↑↓) and h/l (←→) move, tab/shift-tab jump, enter acts, m opens
the control's menu, r renames, esc/q go back to the pane, ? lists every key
of the row the cursor is on (the strip's, the header's, the parked chips') in
a dialog (the chrome has no body to draw it over).

Every Nocturne pane, panel and window has the same key help: its bar ends
with `? keys` (the key in the accent, bright while open; a click toggles it),
and `?` shows the keys overview: KEYS, what it's for and `? esc close` on
top, then each section's keys in an aligned column (sections side by side as
the width allows, one under the other in a narrow panel; long words wrap).
It takes the body's place and the bars stay; `?`, esc or q close it. Where
`?` types (the editor, a filter) its chord opens it (`space ?`, `cmd-k ?`),
and the bar's entry says so. Over a native view (a web page, a PDF, a video)
the view hides while the keys show and comes back as it was; picture in
picture opens them as a popup over its video. Git's rows run their action
(j k, enter or the row's own key), as lazygit's menu does. Every overview
also opens by command: `<mod>.keys` (nocturne-agents, -browser, -editor,
-files, -git, -github, -markdown, -notifications, -pip, -preview, -scripts,
-usage). The drawing is `mods/nocturne/keyhelp.js`, copied byte for byte into
each of those mods (a mod can't import another's files): change the source
and copy it, a copy of your own goes with your own mod.
The sidebar walks the fold key, spaces (n new, t new tab, f folder, w worktree,
d delete: y/n), fireflies (p pin, J/K in the jar) and usage. The tab strip's
rows are the tabs (x close, H/L move, 1-9), its buttons, the bell and "+ new"; the
focused pane's header (name, text size, float, splits, even out, gridify,
park, zoom, ⋯, then close, always the rightmost); the shown tab's parked chips (enter unparks).

Keys, everywhere: cmd-/ (`app.help`) opens Nocturne's keys dialog
(`nocturne/screens.js` Keys, `nocturne/keymap.js`): every binding in plain
words, grouped as a map (keyboard focus, spaces, tabs, panes, agents, windows
and panels, in a terminal, in the editor, in the web pane, app), Nocturne's
own keys in place of the global ones they rebind, the core's own (esc closes
the window in front, stops a pane drag, closes a terminal's search). The
keys that give a block the keyboard (sidebar, tab strip, a pane's header,
toasts) open into what works there (enter or a click), as do the parked
chips, menus and panes. Typing filters: every word must match a key, its
words or its group ("focus sidebar"). A binding you add gets its command's
own words. Every pane and window takes ? for its own keys (all of them) and
ends its key bar with that entry; where ? would type (the editor, the script
runner's filter) cmd-k ? does it instead, shown as the bar's last entry.
`<mod>.keys` shows or hides a pane's list by command (the palette's "… keys":
nocturne-files, -markdown, -preview, -browser, -agents, -usage, -pip,
-github, -scripts, and the editor's `nocturne-editor.keys`). To show someone
a key: `herdr-app do app.help`, then `herdr-app do nocturne.keys-filter.focus-sidebar`
(the filter, `-` for spaces) or `nocturne.keys-open.sidebar` (unfolds that block:
sidebar, tabstrip, header, parked, toasts, menus, panes).

Nocturne's tab strip by mouse: drag a tab along it to move it. The dragged tab
lifts where it is and a blue stake stands in the gap it will drop into: the
half of the tab under the pointer picks before or after it, the strip past the
last tab is the end. Letting go drops it there (`tab.move`); leaving the strip
drops nothing. Two blue corner ticks mark what's shown: the shown space (its plate in
the open sidebar, its initials on the folded rail), the focused agent in the sky (around its firefly's dotted square,
in the jar too; its name stands in the moonlit path) and on the rail.

Nocturne's toolbar, right of the tabs: ▶ and its runs (the script runner),
files, the git button and its ▾ (Git, Diff, Worktrees, GitHub), the bell,
then "+ new", the last control at the window's right edge (a block of its
own after the bell's, `{ mod: "nocturne", props: { role: "newbutton" } }`; a
layout without it gets "+ new" in the strip before the bell). The strip's
keyboard walk goes in that order. "+ new" (cmd-n, `nocturne.new`) drops a menu under it, its right edge on
the button's, inside the window (a key opens it centered): where new
things land (a pane beside the focused one, or a new tab; tab flips it), a
grid of panels, three to a row (Terminal t, Web w, Files f: a files pane of its own, not
the docked panel the strip's files button and cmd-e toggle, Agents a, Usage
u; the panels that float over the tab, Git, its diff, worktrees and GitHub,
open from the git button, its ▾, their keys and the palette instead), every
installed agent (1-9; the ones that aren't installed hide behind a dim
"2 not installed · show" row: enter or a click shows them, again hides them,
remembered in shared `nocturne.newShowMissing`; the numbers never move), then
New space, New worktree… and Open worktree….

### Layouts and mods other people made

People share layouts at herdr.dev/layouts and mods at herdr.dev/mods. Each
is a folder laid out like this home: a layout has `layouts/<name>.json` and
the `mods/<name>/` it needs; a mod is a piece for the person's own window,
so it has only `mods/<name>/` and maybe a `keys.json` with the keys it
expects. Both have a `RECIPE.md` (the brief to build it from scratch) and a
`preview.png`. The files are one build of the recipe. Asked to add one
(`herdr.dev/layouts/<owner>/<name>`, `herdr.dev/mods/<owner>/<name>`, or a
folder on GitHub):

1. Read the recipe and every file before writing anything. Before adding,
   tell the person if a mod reaches the network, runs programs (`exec`,
   `hc`) or reads files outside its own folder.
2. Copy the layout file to `layouts/` and each mod folder to `mods/`. Leave
   the recipe and preview out. Never overwrite: if a name is taken (yours
   or Herdr's), rename the new one: its file or folder, the `mod` names in
   the layout, and the mod's own `mods/<name>/` paths.
3. Fit it to this setup only where its assumptions don't hold (a missing
   program, a name clash) or the person asks. If the files don't work on
   this version, or the person wants it different, build it from the
   recipe instead.
4. A mod's `keys.json`: merge it into the person's. Add its sections and
   keys, and ask before replacing a key they already use.
5. `herdr-app check` each mod; for a layout, then `layout.switch {name}`.
   The person's own layout stays as it was; `ctrl-shift-l` switches back,
   and deleting the files removes it.

To share one: put that folder in a public GitHub repo (one folder each if
there are several), write its `RECIPE.md`, save a screenshot of it as
`preview.png` and add the repo topic `herdr-layout` for a layout or
`herdr-mod` for a mod. It shows up at herdr.dev/layouts or herdr.dev/mods
within the hour.

A `RECIPE.md` is a brief: another agent with an empty folder builds the
layout or mod from it. Write it from the real files, in this order:

1. `# Name`, one paragraph of what the person sees, `![Name](preview.png)`.
2. **What you see:** the regions top to bottom or left to right, their
   sizes, colors and type; what each one shows.
3. **How it behaves:** every agent status (working, blocked, done, idle)
   and how it looks; what clicks, keys and hovers do; what moves.
4. **Built from:** the layout's node tree and blocks, each mod and its
   `props` roles, the shipped mods it uses, the `herdr` functions and
   commands it calls, any programs it runs, its art.
5. **Watch out:** what tripped the build up and what a fresh build would
   get wrong; limits (sizes, counts); controls that do nothing yet; what
   it assumes about the setup.
6. **Done when:** checks that prove a build works, each one something the
   build really does.

The person and what they see come first; code only in Built from and
Watch out. Exact over vague (`#ab7748`, 29px, `agent.focus`), and nothing
the build doesn't do.

## Keys: `keys.json`

On upgrade, an untouched keys file from an earlier release gets the current
shortcuts. Any edit, even whitespace, keeps the entire file as yours; new default
shortcuts must then be added by hand.

```json
{
  "global":   { "ctrl-shift-t": "tab.new", "ctrl-shift-o": "pane.split:right", "alt-1": "space.select:1" },
  "terminal": { "ctrl-shift-c": "terminal.copy", "ctrl-left": "send:\u001bb", "ctrl-1": "terminal" },
  "layout:terminals": { "ctrl-shift-pagedown": "space.next", "ctrl-shift-pageup": "space.prev" },
  "mod:editor": { "ctrl-s": "editor.save" }
}
```

- Sections: `global`, `layout:<name>` (while `layouts/<name>.json` shows),
  `terminal` (a terminal has focus), `mod:<name>`. The more specific section
  wins: `layout:terminals` over `global`, `terminal` over both.
- An action is a command (`name`, or `name:value`: the value fills the
  command's first argument), `send:<text>` (types into the terminal),
  `<mod>.<command>` (delivered to that mod's `nextCommand()`), or `terminal`
  (the program gets the key).
- Named, typed command arguments use an object instead of a string:
  `"ctrl-shift-r": {"command": "layout.resize", "args": {"id": "sidebar", "px": 240}}`.
  `command` names an app command; `args` is an object (optional, defaults to `{}`).
  It can pass several arguments, numbers, booleans, arrays or nested objects.
  String actions keep their literal first-argument shorthand, including numeric
  indexes: `space.new:{work}` names a space `{work}`, and `space.new:{}` names it `{}`.
  Invalid binding objects or rejected arguments show an error toast when pressed;
  the key does not go to the terminal program.
- Plain ctrl+letters go to the program unless bound. Programs rely on
  ctrl+c, ctrl+d, ctrl+l, ctrl+r, ctrl+w, ctrl+a, ctrl+e, ctrl+u, ctrl+k,
  ctrl+z and ctrl+[ (Escape); ctrl+alt is AltGr on Windows; option+digits
  and letters type characters on many Mac keyboards (`[`, `@`). Don't pick
  these on your own. If the person asks for one, bind it and tell them what
  it takes from typing.
- Windows AltGr and dead-key compositions type text in terminals. macOS
  dead keys compose accents through native text input; Option keeps its
  keyboard-layout characters rather than acting as Alt.
- On macOS, shifted punctuation shortcuts accept both spellings from the
  current layout: `cmd-shift-]` and `cmd-}` match the same US-layout keypress.
  Existing `keys.json` files don't need to change.
- Terminal keys honor the program's negotiated Kitty mode, including on Windows.
- Windows terminal Escape stays separate from the following key.
- Search: `ctrl-shift-f` (Cmd-F on macOS) opens a find bar inside the focused terminal;
  Enter/Shift-Enter moves through matches and Escape closes it while the find field
  has focus. Clicking the terminal puts typing, including Escape, back in the program;
  the bar and its matches stay.
  Each terminal keeps its own query, and reopening selects it so typing replaces it. Search covers the screen and scrollback without replacing text selection.

## Commands

The one way to change anything; keys, mods (`run(name, args)`), menus and
you use the same list. `herdr-app commands` prints every one with its arguments
(which are required) and what it does. Unknown argument names are errors and list
valid names; they never fall back to the current target. For example, closing a
space uses `herdr-app do space.close --id <id> --confirmed true`, not `--space`.
Target IDs (`id`, `pane`, `space`, `terminal`) must be strings. Other non-null
types are rejected before a current-target default applies; null means omitted.
The main ones:

- Spaces: `space.new {name?, folder?, tab?, argv?, task?, machine?}`
  (machine: another machine from `hc machine ls`; omitted: the focused space's
  machine for keys and clicks, this computer for scripts; `""`: this computer.
  The space lives there, its
  terminals start in that machine's home unless folder, and its tabs and
  splits stay there; `spaces()` gives each space's `machine`, null here),
  `space.close {id?, confirmed?}`, `space.rename {id?, name}` ("": Herdr's name again),
  `space.folder {folder, id?}` (attach a space to a folder; its open terminals stay where they are),
  `space.move {id, index}`, `space.select {index | id}`, `space.next`, `space.prev`.
  With no `argv`, the target core chooses that machine's default shell (PowerShell 7 when available on Windows).
- Tabs: `tab.new {name?, space?, folder?, argv?, task?}` (argv: an
  agent to run, task: its first message). Agents run in your interactive
  shell (including fish), which stays open after the agent exits. A terminal
  that exits with a nonzero code within two seconds of launch shows an error
  toast with its exit code and last output lines. Or `tab.new {name?, space?, mod,
  props?}` for a tab whose only pane is a mod (a file, a board; split a shell
  in beside it like any tab), `tab.close {id?, confirmed?}` (closing the last tab
  closes its space and asks first unless confirmed; a tab holding an agent, whatever
  its status (idle too, or one a terminal there started), a program other than the
  shell in front or unsaved work asks the person first however it is closed (keys,
  menus, middle-click, a mod's `run`), naming the agents and counting them, and from a
  script fails unless confirmed; a tab of shells at their prompts just closes),
  `tab.rename {id?, name}` ("": its number again), `tab.move {id, index}`,
  `tab.select {index | id}`, `tab.next`, `tab.prev`,
  `tab.settle {id?}`, `tab.unsettle {id?}` (index, next and prev
  skip settled tabs).
- Panes: `pane.split {direction: "right" | "down" | "left" | "up" | "auto", pane?, argv? | mod?, props?}` (a new
  terminal, or a mod pane; left/up put it before the pane, left of or above it; "auto"
  alternates: below a pane whose parent split is side by side, right of one whose parent is
  stacked, right of a lone pane; keys too: `"pane.split:auto"`),
  `pane.split {edge: "right" | "left" | "top" | "bottom", px?, tab?, argv? | mod?, props?, folder?}`
  (instead of `direction`: the new pane along that side of a whole tab, default the shown
  one, spanning its full height or width; `px` fixes its width or height and the rest stays
  flexible; later splits of the other panes stay in the rest of the tab), `pane.close {pane?, confirmed?}`
  (a pane holding an agent, whatever its status, or a mod pane holding unsaved work, an
  editor's, asks the person first, parked ones too; a script passes `confirmed`; a shell
  or another program closes without a word, so tool panes toggle quietly),
  `pane.zoom {pane?}`, `pane.focus {pane | terminal}`, `pane.go {direction}`, `pane.swap {pane?, direction | target}`, `pane.move {pane?, tab? | target?, edge?, space?, name?}`, `pane.equalize {scope?, pane?}`, `pane.resize {direction, step?, pane?}`,
  `pane.font_bigger {pane?}`, `pane.font_smaller {pane?}`, `pane.font_reset {pane?}` (that pane's
  terminal text only, in the app zoom's tenths on top of it, 0.5–3; the grid refits; kept with this
  screen's view like zoom; `panes()` `font_zoom`, 1 = the app's size),
  `pane.float {pane?}` (its terminal floats over the tab: the pane goes as with `terminal.park`, the
  terminal keeps running).
  `pane.park {pane?, index?}` parks a pane (default: the focused one) in its tab's bottom row:
  the pane leaves the arrangement and shows as a small chip (title and status dot) in a row
  under the tab; its terminal keeps running and it stays the tab's (status, alerts, `ls`
  under `parked`, `panes()` with `parked: true`, closing the tab ends it). A tab keeps one
  pane in place. A parked mod pane keeps running too (a web page plays on). `index` (1 = first) puts the chip at that spot; on a parked pane it only
  moves the chip. `pane.unpark {pane?, target?, edge?}` puts it back and focuses it (default:
  the shown tab's last parked one): beside the pane it was parked from, or beside `target`
  on `edge` ("right" | "left" | "top" | "bottom"); `target` without `edge` takes target's
  place and parks target instead. Click a chip to unpark it; drag a chip along the row to
  reorder, or onto a pane (edge or center, as pane dragging) to put it back there; drag a
  pane's grip onto the bottom of the tab to park it. Focusing a parked pane
  (`pane.focus`, `agent.focus`) unparks it. Closing the last pane in place brings the first
  parked one back. Parked panes live in the machine's layout document, so they stay across
  restarts and every screen shows them. Keys: `pane.park` cmd-shift-m (macOS) / ctrl-shift-m,
  `pane.unpark` cmd-alt-shift-m / ctrl-alt-shift-m; the pane menu has "Park pane", and Nocturne's pane header a park
  button before zoom (hidden on the tab's last pane in place).
  `terminal.park` is different: it takes a terminal out of every tab (no chip).
  `pane.go` prefers the most recently focused pane along the nearest edge in that
  direction; unvisited panes fall back to overlap, then top/left layout order.
  `pane.go` also reaches visible mods whose `mod.json` says `"focusable": true`, and
  starts from that mod while it holds the keyboard.
  `pane.equalize {scope?, pane?}` gives panes even shares of their tab (default: the focused
  pane's): `scope` `"all"` (default) evens every row and column at every level, `"row"` the
  panes side by side with `pane` (its nearest row), `"column"` the panes stacked with it (its
  nearest column; none: an error). Siblings keep their total weight; fixed `px` sizes stay.
  Replies `{ok, changed}`; saved like any layout change. Keys: `"pane.equalize:row"`.
  Nocturne's pane header ▦ button and pane menu open the `nocturne-equalize-panes` popup
  (all / row / column / as a grid); its palette has Equalize panes / this row / this column,
  and cmd-alt-e (macOS) evens all.
  `pane.resize {direction, step?, pane?}` moves a pane's divider one step (default: the
  focused pane, a mod pane too): `"left"` / `"right"` move the nearest side-by-side split
  around it, `"up"` / `"down"` the nearest stacked one, also in nested splits. With a
  neighbor on that side the pane grows that way; at the tab's edge its other divider moves
  that way instead, so it shrinks (as tmux and vim do). `step` is a share of the tab's width
  or height (default 0.05: ten steps cross half the tab). Stored like a divider drag (weights,
  or the px of a px side; kept across restarts, zoom and parking), with the drag's minimum
  (24 px a side, a pane's own `min` / `max`). A zoomed tab, one pane, or no split that way:
  `{ok, changed: false}`. Keys: cmd-ctrl-left / right / up / down on macOS (`"pane.resize:left"`, ...). Palette: Resize pane left / right / up / down.
  Nocturne's `nocturne.gridify` (palette "Gridify panes", cmd-alt-g on macOS, the pane
  header's grid button with three or more panes, the popup's "As a grid") rearranges every
  placed pane of the shown tab into an even grid: ceil(sqrt(n)) columns, rows filled left to
  right in the tab's pane order, a short last row stretched, then equalized. Terminals and
  mods keep running, parked panes stay parked, focus stays. It moves the panes through a
  holding tab with `pane.move` (which can't move a pane inside its own tab), so the tab
  strip shows a "⧉ gridify" tab for a moment.
  `pane.swap {direction}` uses geometry only. Focus history lasts until the window closes.
  `pane.swap {target}` trades the places of `pane` (default: the focused one) and
  `target`, another pane of the same tab; give `direction` or `target`, not both.
  A swap moves panes, not focus: the focused pane stays focused in its new place.
  `pane.move {tab}` takes a pane (placed or parked, a terminal or a mod; the only one
  of its tab too) to another tab in any space on its machine, beside `target` on `edge`
  or beside that tab's focused pane; no tab or target: a new tab of its own (`name`, in
  `space`). Its terminal keeps running; the tab it leaves closes when emptied. The pane
  menus (shipped and Nocturne's, and a firefly's) list "Move to …" for every tab.
  `pane.focus {terminal}` prefers the first visible layout terminal block showing that
  address, then its model pane. Clicking a terminal block focuses it too.
  While a layout terminal block is focused, implicit split/close/zoom/go/swap and
  `terminal.show` fail, as do `terminal.open`/`terminal.keep` with place right/down/left/up/auto
  and no `pane`.
  They never act on the terminal's source pane. An explicit `pane` still targets that
  model pane; composition edits belong to the mod (edit its layout instead).
- Terminals: `terminal.open {argv?, folder?, place?, name?, pane?}` (place: "tab" (default),
  "right" | "down" | "left" | "up" | "auto" of `pane` (default: the focused one; directions as
  `pane.split`), or "float"; `folder` sets the starting directory for tabs and splits, with or
  without `argv`), `terminal.kill {terminal}`,
  `terminal.keep {terminal, place?, pane?}` (the same places, but no "float"), `terminal.park {terminal}`,
  `terminal.peek {terminal, float?}` (peek over the tab, with keep-as-tab, dock and close;
  `float: true` shows it as a floating terminal),
  `terminal.open {place: "float"}` starts a terminal without a pane and floats it over the
  shown tab (85% of it, room for lazygit). A float has one overlay, `terminal-peek` (one peek or
  float at a time), with the `peek` bar: ↗ keep (a tab), ⇥ dock (`terminal.keep {terminal,
  place: "right"}`: a split right of the focused pane), ⏻ end (`terminal.kill`) and ✕ (closes
  the float; the terminal keeps running without a pane, so `terminal.peek {terminal, float: true}`
  shows it again). Neither leaves a pane behind. `terminals()` marks the one floating now
  `floating: true` (all others false), so a mod toggles with
  `const f = terminals().find((t) => t.floating); f ? run("overlay.close", { id: "terminal-peek" }) : run("terminal.open", { argv: ["lazygit"], place: "float" })`.
  A float that ends closes by itself.
  Float views: `terminal.open {place: "float", view?: {mod, props?, name?}, show?: 0 | 1}` and
  `terminal.peek {terminal, float: true, view?, show?}` give the float's body two children, the
  terminal (0) and a block of mod `view.mod` with `view.props` (1), one shown at a time (a stack),
  starting with `show` (default 0). `float.view {index: 0 | 1}` switches the open float and gives
  the shown one the keyboard (the terminal, or the mod if its `mod.json` says `"focusable": true`;
  it gets `"focus"` from `nextCommand()`). Both stay alive while hidden. `terminal.peek` with the
  same view on the terminal floating now only switches to `show` (no reopen). `terminals()` gives
  the floating one `floating_view` (the shown index; 0 for a float without a view) and
  `float_views` (`[its program's name, view.name ?? view.mod]`; null without a view); every other
  terminal has null for both. The bar's props get `views` (the same names, or null), and the
  shipped bar shows a switch between them.
  `terminal.show {terminal?, pane?}`, `terminal.search` (screen and scrollback;
  find bar state stays with that terminal), `terminal.copy`, `terminal.paste` (copied
  files, such as Finder's or a clipboard manager's image, as if dropped; an image
  alone as `terminal.paste_image` pastes it), `terminal.paste_image` (Ctrl+V: an
  image, into a terminal on another machine: copied there, its path pasted; on
  Windows, clipboard text is pasted; otherwise Ctrl+V goes to the program, which
  reads the clipboard itself). TIFF and BMP clipboard
  images are converted to PNG before sending,
  `terminal.right_click {to: "program" | "menu", terminal?}` (where right-clicks go
  when the program takes the mouse; kept as its label `herdr.right-click=program`;
  Shift+right-click is always Herdr's menu),
  `terminal.scroll {lines | pages | to: "top" | "bottom", terminal?}` (moves Herdr's view of the
  history, not the program: negative lines or pages go up, toward history; pages may be
  fractional, one page is the terminal's rows; on the alternate screen, such as vim or less,
  there is no history, so nothing moves),
  `terminal.pin {terminal, pinned}` (pins an agent to the top of the agent lists;
  kept on the terminal as `herdr.pinned`, so every Herdr client shows it, and
  gone when the terminal ends; read it as `agents()` `pinned`). Copy, paste, paste-image and implicit
  right-click targeting follow keyboard focus, including peek and floating terminals;
  with no terminal holding keyboard focus, they use the focused pane or block.
  Dragging a text selection past the terminal's top or bottom scrolls while held;
  releasing stops it. Programs that track the mouse still get their mouse events
  (hold Shift to select text instead). A drag stays with the terminal where it
  started, including its release outside the pane; other panes don't receive it.
  Terminals display Kitty graphics, including Unicode placeholder images used by
  programs such as yazi; partial images and scrolling follow the placeholder cells.
- Agents: `agent.next`, `agent.prev`, `agent.focus {terminal}`.
- Layout: `layout.switch {name?}`, `layout.toggle {id}`, `layout.show {id}`, `layout.hide {id}`,
  `layout.resize {id, px | weight}`, `layout.focus {id}` (the keyboard to a shown block whose
  mod is focusable, as `pane.go` gives it), `layout.select {stack, child}`, `layout.set {layout}`
  (personal tree edits; on shipped layouts only click/look fields change),
  `layout.reset {name?}` (reset a shipped layout and its clicks),
  `layout.clone {name, as?}` (duplicate, then switch; default `<name>-copy`).
- Native views (this fork, interface native-view/0): `native.debug` (every native view's frame,
  visibility, focus, content state and recent events), `native.call {key, action, args?}`
  (one whitelisted action, key `<copy>:<id>`). A web view takes a `zoom` prop
  (`herdr.nativeView.new(id, { kind: "web", url, zoom: 1.25 })`, WKWebView page zoom,
  default 1, clamped to 0.25–5): applied on create, and a change to only `zoom` zooms the
  page in place without reloading it.
  Overlays (menus, dialogs, windows, toasts) drawn above a native view cut a hole in it
  instead of hiding it, and a dialog's backdrop dims it; only a pane drag hides it.
  That holds for a native view inside an overlay too (the picture-in-picture player's
  window): every overlay painted after its own one cuts it and dims it (windows first, in
  the order raised, then dialogs, popups and toasts, each in the order opened), never its
  own overlay nor those under it; floating blocks cut the panes below them. `native.debug`'s
  `layers` shows, per mod copy, its layer (`z`, `float`), its holes and its dim.
  A web view is inspectable (right-click "Inspect Element"); its `web.inspect` action returns
  `{ of }`, and a native view `{ kind: "inspector", of }` (in any pane, e.g. a split beside it)
  shows Safari's Web Inspector for that page in its place.
  A web view sends `web.location` (its state: `href`, `canGoBack`, …) whenever its address or
  history changes, also within a page (links in single-page apps, pushState, #fragments), so an
  address bar can follow it; `load.*` alone misses those.
  Picture in picture (no macOS Picture in Picture): a web view
  created with `pip: true` can hand its page's video to a player. Its `web.pip` action marks the
  biggest (playing) `<video>` (main frame, else the frame that last played one), returns `{ of }`
  and sends `pip.enter { of }` (`pip.start { result | error }`: `"none"` when there is no video);
  again: back. Such a page also sends `web.video { present }` when it gains its first or loses its
  last `<video>` (any frame; `state` has `video`), e.g. to show a PiP button only then.
  A native view `{ kind: "pip", of }` then takes the page's whole web view and
  lifts the video into the page's top layer to fill it, with the rest of the page hidden, in
  any of the site's layouts (a site moving its player, as YouTube does when the width
  changes, is followed; an embedded player's iframe too); the pane is left empty meanwhile
  (draw a placeholder; the page gets `pip.leave` when it's back). Actions: `pip.toggle`
  (play/pause), `pip.seek { by }` (seconds, back when negative), `pip.mute { muted? }`
  (sound off/on; without `muted`, the other way round), `pip.sync` (nothing): each answers
  with event `pip.state { result: "playing" | "paused", muted, width, height }` (the video's
  own size, for its real shape). While lifted, the video's own controls are hidden. `pip.back` (the page goes
  home playing on, and its pane takes focus, across tabs and spaces, out of a chip too),
  `pip.close` (home, paused), `pip.popOut { colors: { background, foreground, dim, border } }`
  (a square, resizable window above every app and space, in the screen's bottom right
  corner, with the Nocturne player's bar in its order, ↩ « ❚❚ » sound ◧ ⤓ ⇲ ✕, keeping the
  video's shape when resized; ⇲, ◧ and ⤓ send the page `pip.popIn { of, then }` (`then`:
  null, `"pane"` or `"park"`, for the player to go on with); the view may go). The newest `pip` view of a page holds its video: when another takes it (a pane, out
  of Herdr), the old one and the page get `pip.moved` (the page's with `{ popped }`). Event
  `pip.ended`: the page went home (also on a new page, a crash, a closed pane, or the video
  leaving the page). One video at a time.
  Nocturne's browser does this with its ⧉ button (command `nocturne-browser.pip`) and the
  `nocturne-pip` player, a `kind: "window"` overlay with key `nocturne-pip` that resizes in
  its video's real shape (`overlay.resizable` once `pip.state` gives the size). While it
  is being resized the video's page keeps its layout, drawn scaled to the new size, and
  is laid out once the size has held 150 ms (the page doesn't relayout on every step). While
  the video is out, the browser pane is parked and comes back when the video goes home or
  into a pane. When it is its tab's only pane, the whole tab is settled instead, after
  showing the tab shown before it (else its neighbor; the only tab of its space: the space
  shown before); ↩ and ✕ show the tab again, into a pane puts it back in the tab bar. The
  only tab of the only space stays shown. The player's bar: ↩ « ❚❚ »
  sound ◧ (into a pane beside the focused one) ⤓ (park: the player becomes a chip in the
  shown tab's parked row, playing on; unparking it brings the window back) ⇱ (out of Herdr)
  ✕; what doesn't fit a narrow bar goes into a ⋯ menu (play/pause and close stay). The
  control under the pointer shows its name in the bar's title (tooltips would be drawn under
  the video, a native view). Commands
  `nocturne-pip.toggle`, `.rewind`, `.forward`, `.mute`, `.pane`, `.park`, `.out`, `.back`,
  `.close`; Nocturne's palette lists them while the player window is open. Keys while the
  player has the keyboard (`overlay.focus`, or a click on it; its bar's edge turns blue):
  Space / `k`, ← → (`h l`), `m`, `b`, `p` pane, `P` park, `o` out, `x` / `q` close; esc
  gives the keyboard back to the pane.
- App: `mod.clone {name, as?}` (duplicate; default `<name>-copy`), `mod.open {name}` (again: closes it), `overlay.close {id?}`, `overlay.resizable {id, resizable}` (a window's `resizable`, see Windows), `overlay.focus {dir?, id?}` (`overlay.focus:prev` in keys.json) and `overlay.move {id?, dx?, dy?, dw?, dh?}` (a window by keyboard, see Windows), `app.help` (again: closes it), `app.palette` (again: closes it), `app.settings {section?}`
  (sections: `look`, `editor`, `machines`, `alerts`, `updates`; Machines lists, updates, renames and removes ssh machines; settings edit the same files you do).
  `app.check_updates` (only a successful check reports Up to date; a failed check clears the checked time and can be retried), `app.update_core` (a newer herdr-core of this generation, terminals kept;
  never one a package manager owns), `app.welcome`, `app.whats_new`,
  `app.open_url {url, in?}` (an http(s) page: `in: "app"` a web pane beside the focused one,
  `"system"` the system's browser; default: the `links` setting; the reply says `opened`),
  `editor.open {path, line?, col?, in?, pane?, on?}` (text or source in the editor beside `pane`,
  default the focused one, or the editor there already on it, going to `line` / `col`, one-based;
  `in: "system"` the system's app; see Editing files),
  `markdown.open {path, anchor?, in?, pane?, on?}` (a Markdown file rendered in the viewer beside
  `pane`, default the focused one, or the viewer there already showing it; `anchor` scrolls to a
  heading; `in: "system"` the system's app; a relative path is the pane's folder's; `on` the
  machine the file is on; the reply says `opened` and the absolute `path`),
  `preview.open {path, in?, pane?, on?}` (the same for a picture, PDF, table, SQLite database,
  patch, font or clip, in the preview; `image.open` is the same command),
  `files.open {path, in?, pane?, on?}` (a folder in a new files pane beside `pane`, or the one
  there already rooted at it; `in: "tab"` a tab of its own, `"system"` the system's file manager;
  see Files panes),
  `app.feedback {message?, from?}` (from `"person"` or `"agent"`; opens a review window that drafts a GitHub issue with the message and the app, herdr-core and OS versions; Open on GitHub opens the prefilled new-issue page like `app.open_url`, where the person adds screenshots and submits; Herdr sends nothing itself), `app.reset`,
  `app.theme {name}`, `app.zoom_in`, `app.zoom_out`, `app.zoom_reset`,
  `app.update` (restart into a downloaded update).
  Add machine lists all named ssh-config hosts in a scrollable list. Machines
  that need a password, a new host key or herdr-core installed show what to run
  in your own terminal; the picker updates once it is added. Other machines are
  added quietly. Login guidance includes Copy. A machine that needs a login shows
  `hc machine login <name>` with Copy in Settings > Machines, its sidebar group,
  the welcome screen and the failed New space toast. If a remote machine was rebuilt
  or replaced and a different core answers there, its sidebar offers Connect:
  explicitly forget the old identity and pair again with the same name and target.
  Other unreachable machines don't offer this.
- Window: `window.minimize`, `window.maximize` (or back), `window.close`.
- macOS: `app.quit`, `app.hide`, `app.hide_others`, `app.show_all`.

When the user runs a command without a required name (a key, a click), Herdr
asks them. **You never get a dialog**: pass every required argument, or the
command says what's missing.

From a shell:

```sh
herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "look at the login bug"
herdr-app do pane.split:right
herdr-app ls          # spaces, their tabs and terminals (sub-agents under their parent)
herdr-app status      # what's on screen: layout, focus, overlays, zoom, errors from files and mods
herdr-app commands    # every command and its arguments
```

`herdr-app do` prints what the command made (`{ "space", "tab",
"terminal" }`, `{ "pane", "terminal" }`) or `{ "error": "..." }` and exits 1.

## The person: `settings.json`

What's about the user, never a look:

```json
{ "zoom": 1, "sounds": { "enabled": true } }
```

The Settings window (`app.settings`) works by keyboard too: its section rail
is one stop (↑↓ / j k, or 1-6 from anywhere), tab / shift-tab and ↑↓ / j k
walk the page's controls (a ring marks the one with the keyboard), enter /
space press it, ← → / h l step a stepper or a choice, esc closes an open font
list or a machine's rename first.

- `zoom` scales the whole app: terminals, mods, the layout's px sizes
  (0.5 to 3; the zoom keys change it). Write sizes as designed at zoom 1.
- `sounds`: `{ "enabled": true, "done": "<file>", "blocked": "<file>" }`.
  When an agent needs the person, or finishes while they aren't looking at
  it, Herdr plays a sound and (unless they're looking) posts a toast that
  goes there when clicked. `done` / `blocked` replace the bundled MP3s
  (path absolute or relative to `~/.config/herdr-app`). Changes apply live,
  including the Play buttons in Settings > Alerts.
- `core`: the herdr-core binary to use, when it isn't where Herdr looks
  (PATH, the login shell's PATH, `~/.local/bin`, Homebrew, mise, Nix,
  cargo). Read at start.
- `font`, `font_size`, `ui_font`: used where the layout doesn't set its
  own. Herdr (main) leaves these unset. Bigger panels: `zoom`.
- `font_ligatures`: programming ligatures are off by default; set `true` to
  enable them in terminal fonts such as JetBrains Mono and Fira Code. The cursor
  and background changes (including selections) break ligatures so individual cells stay clear.
- `theme`: a theme name or `{light, dark}`; used where the layout sets none.
  The theme picker overrides any layout and stays on that layout.
- `colors`: theme color overrides (`{"accent":"#ff8800"}`), with the same
  precedence as fonts.
- `appearance`: `"light"` or `"dark"` always; absent, the system's. A layout
  with a light and a dark theme shows the matching one.
- Updates: an installed app downloads them by itself and offers Restart and
  What changed. If the app crashes or is killed with a verified newer update
  waiting, the next launch installs it before opening a window. The first
  start after an app update also updates herdr-core
  to the latest release of the same generation, keeping terminals running.
  Settings → Updates keeps app and core actions together;
  its What's new button opens the waiting update's release range, or this
  version's notes, in the What's new window. Reading never clears the waiting-update dot.
  Rare spotlight releases open What’s new after restart, once; otherwise a
  quiet Updated pill lasts for that launch. A build from source never updates.
  Curated notes come from the bundled root `CHANGELOG.md`; remote notes and
  media are optional. `update-notes.json` records the last successful app
  version and presented spotlights; `update-notes-cache.md` caches remote
  notes; `update-notes-media/` caches HTTPS images (including animated WebP clips),
  referenced below its item in the changelog as `![label](https://...)`.
  Each version uses `### New` with `- **Headline.** detail` highlights and
  `### Fixed` with short bullet items. Unsectioned bullets are plain items.
  Notes expose `items` with `headline`, `detail`, `fixed`, and cached `media`
  objects (`path`, pixel `width`, pixel `height`). Highlights use matching cards:
  edge-to-edge media at its original aspect ratio, then headline and detail.
  For local release-media previews only, launch with
  `HERDR_NOTES_MEDIA_DIR=/var/tmp/herdr-notes-media`: URLs under
  `https://media.herdr.dev/<version>/<scene>.webp` use that directory's
  `<version>/<scene>.webp` instead of downloading. Without the variable,
  media uses the normal HTTPS cache.
  Mods use `updates().notes` and `presentUpdateNotes([version])` only
  for spotlight entries actually shown expanded, not collapsed headlines.
  macOS releases require Apple Silicon; Intel Macs must build from source.
  Keep signed macOS bundles unchanged: don't edit their Info.plist or
  re-sign them. On launch, an installed macOS bundle creates or repairs its
  own `~/.local/bin/herdr-app` symlink, leaving personal files and other
  apps' links alone. Disk-image and translocated launches don't create it.
  Finder launches load the login shell's PATH, with the usual install
  folders as a fallback.
- `links`: `"app"` (default) opens web links in a web pane in Herdr (macOS,
  the `nocturne-browser` mod), `"system"` in the system's default browser
  (see Links above). Other schemes always go to the system. Applies at once.
- `option_as_alt`: macOS only, `"auto"` (default), `"on"`, `"off"`, `"left"`, or `"right"`.
  Available in Settings → Keyboard.
  `"auto"` sends Option as Alt on US, US International, ABC and ABC-India;
  other layouts keep native Option text and dead keys. `"on"` enables terminal
  Alt shortcuts (including Option+E without composition); `"off"` keeps native
  Option input on every layout. `"left"` / `"right"` makes only that Option
  key act as Alt; the other types characters. Changes apply immediately, including layout
  switches. Linux and Windows are unchanged.
- `minimum_contrast`: terminal text contrast ratio, `1` (default) leaves
  program colors unchanged. Set it to `1.6` to enable the previous readability
  adjustment, or another number from `1` to `21`. Text below that ratio is
  replaced with near-white or near-black, whichever contrasts more with its
  background; this is a threshold, not a guaranteed resulting ratio.
  Box/block, Powerline and sprite glyph colors are never adjusted.
  Changes apply immediately, including text already on screen.
- `clipboard_write`: `false` blocks terminal programs from writing the local
  clipboard (default `true`, including remote terminals attached in this window).
  OSC 52 accepts base64 UTF-8 text up to 1 MiB: `c` writes the system clipboard,
  `p` writes Linux primary selection. `s` is ignored; cut buffers `0`–`7`
  are treated as the system clipboard.
  Clipboard reads (`?`) are never allowed.
- `editor`: the code editor (Nocturne's `nocturne-editor`, see Editing files).
  Top-level values apply to every language; `languages` overrides them per
  language id (`languageOf(path)`: `rust`, `typescript`, `tsx`, `javascript`,
  `python`, `go`, `nix`, `lua`, `bash`, `json`, `yaml`, `toml`, `markdown`,
  `css`, `html`, `c`, `zig`, `csv`, `text`). Each takes `tab_size` (1–16),
  `insert_spaces`, `soft_wrap`, `format` (an argv that reads the file on stdin
  and prints it formatted), `format_on_save` (off unless set), `server` (the
  language server's argv, or `false` for none) and `server_settings` (what the
  server gets as `workspace/configuration` and `initializationOptions`).
  At the top only, `vim`: whether editors start in vim mode (default `true`;
  Settings → Editor; a pane's own switch overrides it for that pane), and
  `leader`: vim's leader key
  (`"space"`, default; `"comma"`; or a character).
  Without `server`, a language uses the first built-in server found (in the
  workspace's `.envrc` environment, else on PATH, see Editing files);
  none is ever installed. Changes apply to editors opened afterwards.
  ```json
  { "editor": { "tab_size": 4, "format_on_save": true, "vim": true, "leader": "space",
      "languages": { "rust": { "format": ["rustfmt", "--edition", "2024"] },
                     "python": { "server": ["pyright-langserver", "--stdio"] },
                     "go": { "server": false }, "markdown": { "soft_wrap": true } } } }
  ```
- `files`: what a new files pane lists (Nocturne's `nocturne-files`, see Files
  panes): `{ "hidden": false }` leaves dotfiles out, `{ "ignored": false }`
  files git ignores; both are listed when unset. A pane's `H` / `I` switch
  overrides it for that pane.
- `pane_scrollbars`: `false` hides the scroll position thumb at a terminal
  pane's right edge (default `true`). It shows only when the pane has
  scrollback — never on the alternate screen (editors, pagers) — and
  drags to move through it.

## Programs: `programs.json`

Every pane, agent and terminal carries `program`: its name, icon and tile,
from one table, so every mod shows the same, and the app's own toasts
("Kiro finished") use the same names. An agent's own report wins;
else the program the terminal runs (an interpreter shows what it runs:
`node .../vite` is Vite, `npx vitest` is Vitest); shells are `shell`,
anything unlisted is `program` with a color of its own. The built-in table
has 120 programs (agents, editors, runtimes, tools, databases, infra);
`programs.json` here adds to it or changes entries field by field:

```json
{ "programs": {
    "lazygit": { "name": "Git", "tile": "#f05032" },
    "mytool": { "name": "My Tool", "icon": "my-icons/mytool.svg", "tint": true,
                "tile": "#334155", "color": "#ffffff", "match": ["mytool-dev"] } },
  "shells": ["xonsh"], "interpreters": ["pipx"] }
```

- `icon`: a path in the home folder. `tint: true` for a one-color glyph
  (drawn in `color` on a tile, or the text color), false for a picture.
- `match`: other process names (or agents' `app` names) for the entry.
- `run`: how to start it (`["cursor-agent"]`), for agents people start
  from a menu: `knownAgents()` lists the entries with one, and whether this
  machine (or another) has them installed. For example, override
  `"claude": { "run": ["my-claude"] }` or add
  `"claude-alt": { "name": "Claude (alt)", "icon": "icons/claude.svg", "run": ["my-claude-alt"] }`
  inside `programs`. Use programs or shell functions, not aliases (the launcher
  does not expand them). On macOS both checks and the menu launcher load login profiles before
  running the agent and leaves an interactive login shell when it ends.
  Codex starts as `codex --no-daemon`: a shared Codex daemon would make later
  sessions use the first terminal's identity and stop with it.
  On remote Unix machines, both the installed-agent check and launcher load
  that user's login/interactive shell for sh, bash, zsh, dash, ksh and fish, so
  its PATH includes shell-configured tools. Other shells keep the sh launcher.
  Local Linux launches keep interactive non-login shells. Local and remote checks
  include functions in bash and zsh; fish checks find executables only. Installation
  checks are cached for up to a minute; changing the commands checks again.
  Invalid JSON is reported in `programs.error` (a valid file has no error).
- It follows what runs in the terminal now (lazygit, nvim), else what it
  started with.

## Mods: `mods/<name>/`

```
~/.config/herdr-app/mods/<name>/
  main.js       the mod (required)
  mod.json    where it first appears: { "place": "right" | "left" | "top" | "bottom" | "none", "size": 320 }
  *.js, *.svg   more modules ("./ui.js"), its own icons
  bin/          programs its terminals run (a shipped mod's are installed executable;
                start one as `${appHome()}/mods/<name>/bin/<program>`)
```

- A form (fields and buttons): copy `mods/nocturne/form-keys.js` into your
  mod (a mod can't import another's files). `formKey(stops, at, key,
  modifiers, char)` says what a key does on the focused stop (`{ act: "move",
  to }`, `"submit"`, `"cancel"`, `"press"`, `"step"`, `"flip"`, `"open"`,
  `"type"`: let the input have it), `formHints()` is the hint line, `ring()`
  the focus ring; stops are `{ id, kind: "text" | "area" | "choice" |
  "multi" | "toggle" | "button", submit? }` in tab order. Tab never reaches
  an `on_key_down` (key bindings run first and the root binds tab to move the
  focus): call `bindTab(cx)` in `init` and wrap the root that tracks your
  focus handle, above the inputs, in `tabActions(el, (e, cx) => this.key(e,
  cx))`; tab and shift-tab then reach your handler as key events. A
  multi-line field types cmd-enter as a new line and fires `submit` with
  `secondary`: listen for that to submit from it.
- `"focusable": true` in `mod.json` lets `pane.go` give a shown copy the keyboard.
  It gets `"focus"` from `nextCommand()`: focus your own handle then
  (`this.handle.focus()`) and handle keys with `on_key_down`. The copy gets `"focus"`
  again after a popup over it closes, and whenever the window focuses its pane
  any other way (a tab or space switch, `agent.next`, a pane closing, the start),
  as a terminal pane gets the keyboard (not while a dialog holds it). It gets it on
  every click into its native view too (a web page): the view keeps the keys it
  types, while the chords it leaves come back to the mod's keys.json section
  (`mod:<name>`). `layout.focus {id}` gives a layout block the
  keyboard the same way, and `pane.focus {pane}` a mod pane; `focused().block` names the layout block that has it (else null).
  Leave with `run("pane.go", {direction})` or `run("pane.focus", {pane})`.
  Without this opt-in, navigation and clicks stay unchanged.

- The first time Herdr sees a folder, it docks one copy per `mod.json` into
  the shown layout (`"none"`: only where a layout or another mod puts it).
  After that, the layouts decide. Saving any file reloads every copy in place
  (not files the app writes: `jsconfig.json`, `.d.ts`, hidden ones,
  `node_modules`). The old build's tasks and timers stop: a loop ends at its
  next `cx` use. A broken save keeps the old version running and shows in
  `herdr-app status`; its top-level code has already run, so keep side effects
  on `globalThis` out of the module's top level.
- A copy starts the first time it shows, then stays alive while its block is in
  the layout, shown or not (a hidden column, the other child of a stack, a pane
  in another tab or behind a zoom): switching back finds it as it was. Its
  timers keep running while hidden, so poll gently. Another layout starts its
  mods fresh (pane mods belong to their tab and stay); a block removed or given
  another mod or props starts over. `<mod>.<command>` reaches shown copies only.
- Images and SVGs are referenced from `~/.config/herdr-app`:
  `image("mods/<name>/logo.svg")` (full color), `svg("mods/<name>/icon.svg")`
  (tinted with the text color). Saving an asset under `mods/` updates every
  mod showing it, including images that were missing or invalid on first load.
- The defaults are mods too, read them as examples: `spaces`, `agents`,
  `tabs` (the tab bar), `menu`, `prompt`, `confirm`, `help`, `toast`,
  Terminals' `picker`, `peek`, and `pane` (an
  example pane header, not used by the default layouts). Git worktrees as
  spaces live in the git window's Worktrees tab (above): the space menu's and
  the + menu's New worktree, Open worktree and Remove worktree open it; the
  `worktree` mod is left as a stub that turns `openOverlay({mod: "worktree",
  props: {space, folder?, action, branch?, tab?, argv?}})` into the git
  window with the same request. The `spaces` sidebar nests worktree spaces
  under their repo's and shows each space's repo, branch, ahead/behind and
  uncommitted changes. Shipped mods are Herdr's; duplicate with `mod.clone`
  before editing.

### Check before you finish

```sh
herdr-app check ~/.config/herdr-app/mods/<name>
```

Loads the mod, renders it once, exits nonzero with the exact error. Run it
after every change. Never call a mod done without a passing check.

### A mod

```js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, theme, run } from "herdr";

export default class Branches extends View {
  init(_props, cx) {
    this.branch = {};
    cx.timer.every(3000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      for (const p of spaces()) {
        // on: a space on another machine runs git there.
        const r = await exec("git", ["branch", "--show-current"], { cwd: p.folder, on: p.machine });
        this.branch[p.id] = r.stdout.trim();
      }
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    return v_flex().size_full().bg(t.surface).p(10).gap(4).text_size(13).children(
      spaces().map((p) =>
        h_flex().id(`b-${p.id}`).gap(8).hover((s) => s.bg(t.raised))
          .on_click(() => run("space.select", { id: p.id }))
          .child(div().text_color(p.active ? t.foreground : t.muted).child(p.name))
          .child(div().text_color(t.dim).child(this.branch[p.id] ?? ""))));
  }
}
```

Rules:
- `main.js` default-exports a class extending `View`. `init(props, cx)` runs
  once; `render(cx)` describes the UI and runs again after `cx.notify()` and
  whenever Herdr's live data changes (spaces, agents, terminals, focus,
  theme, shared state). Don't poll those.
- Module code runs once per source version and is shared by copies, even after all
  copies close. Keep instance state and host calls in constructor/init, not module
  scope. Each copy still gets its own instance, tasks and localStorage.
- **Never keep a `cx` and use it later.** Every callback gets its own:
  `on_click((event, cx) => …)`, `cx.spawn(async (cx) => …)`,
  `cx.timer.every(ms, (cx) => …)`.
- No `setTimeout`/`setInterval` (use `cx.timer`), no top-level `await` (use
  `cx.spawn` in `init`). Anything slow goes through `exec` or `fetch`.
- Size: put `.id("root").on_size_change((size, cx) => { this.size = size; cx.notify(); })`
  on the root `div()`, `h_flex()` or `v_flex()`. It reports `{width, height}`
  in logical pixels after the first layout and whenever the size changes,
  even with the pointer elsewhere. It does not change `props()`.
- Cleanup: an optional `async close(cx)` on the exported `View` gets one final
  call when its pane, tab, layout-owned slot or overlay goes, and on app quit.
  It is not called for a hidden copy or an inactive tab. Start cleanup inside
  `close()`; don't await work started earlier. Await cleanup directly,
  for example `async close(cx) { await exec("hc", ["kill", this.browser]); }`.
  Closing stays responsive: cleanup has at most 250 ms (shared across copies
  on quit), then unfinished tasks are cancelled. On quit, use `exec(...)` and
  `run("terminal.kill", { terminal: address })`: those go out before the event
  loop stops; other commands may not run. An `exec` already started keeps
  running; don't start new long-lived work in `close`. This is best-effort,
  not a guarantee after a crash or forced termination. The pane is already
  gone when `close` runs (`panes()` may still list it): don't name the
  mod's own "close this pane" action `close`, or it closes the pane twice
  and the person sees "pane.close failed".
- Use `theme()` colors so the mod follows the user's theme.
- **Animate natively, never with a timer.** Every redraw of a mod redraws
  the whole window, so `cx.timer.every(90, () => cx.notify())` for a
  spinner costs real battery. Use `.frames(["⠋", "⠙", …], 90)` (shows
  each string in turn as the element's text), `svg(arc).spin(900)` (turns
  an icon once every 900 ms: a ring spinner, e.g.
  `mods/workspace-chrome/spinner.svg`), or `.loop("opacity", { from:
  0.4, to: 1, period: 1200 })` (also width, height, left, top), and
  `.transition(...)` for changes: they run without your script and stop
  when not shown. Timers are for data (a clock, a fetch), and only as often
  as what they show changes.
- **Something that follows the pointer** (a highlight, a glow): make it a
  nested view, `this.glow = cx.new(GlowClass, props)` in `init`, mounted with
  `.child(this.glow)`, and feed it from `.on_mouse_move((e, cx) => …)` with
  `this.glow.set_props({ x, y })`: only that view is rebuilt, not yours. Skip
  moves that change nothing, and draw nothing once it's out of sight (a loop
  at opacity 0 still runs). Nocturne's sidebar glow (`glow.js`) does this.
- **Acting on something `render()` reads** (a request another copy left in
  `shared()`, say "rename this"): render can't change state that needs a new
  frame, `cx.notify()` there throws ("not allowed during the `render`
  phase") and the view shows "could not be re-rendered". Note it in render and
  act from a task: `cx.timer.after(0, (cx) => { …; cx.notify(); })`, once per
  request. Nocturne's sidebar and pane header answer their menus' asks so.

### UI

Chained builders with GPUI's snake_case names: `div()`, `h_flex()`,
`v_flex()`; `.size_full()`, `.flex_1()`, `.gap(n)`, `.p(n)`, `.px(n)`,
`.w(n)`, `.h(n)`, `.items_center()`, `.justify_between()`,
`.overflow_y_scrollbar()`; `.child("text")`, `.text_size(n)`, `.font_semibold()`,
`.truncate()`, `.text_color(c)`; `.bg(c)`, `.border(1)`, `.border_color(c)`,
`.rounded(n)`; `.id("unique")` then `.on_click(...)`, `.on_mouse_down("right", ...)`,
`.hover((s) => s.bg(c))`, `.on_scroll_wheel(...)`; keyboard: `this.h = cx.focus_handle()`
in init, `.track_focus(this.h).on_key_down((e, cx) => …)`, `this.h.focus()`.
`ScrollHandle` from `gpui-base` scrolls a plain `overflow_*_scroll()` or
`overflow_*_scrollbar()` area from code. Create `this.scroll = ScrollHandle.new()`
in `init`, attach `.track_scroll(this.scroll)`, then call
`this.scroll.scroll_to_item(index)` to reveal a zero-based direct child with
only the movement needed. Requests run once after layout; visible children stay put.
`.on_drop((event, cx) => …)` on a plain layout element receives external files as
`event.paths` (absolute paths).
`.on_hover((hovered, cx) => …)` reports pointer entry and exit on buttons
and other interactive controls too.
`.when(cond, (el) => …)`, `.children([...])`. Controls from `gpui-base`
(`Button`, `Checkbox`, `Switch`, `InputState` + `Input`) are unstyled: style
them. Text: `TextView.markdown(id, text)` renders markdown; `EditorState.new({
language, value, readonly, font_family: settings().font_family, syntax: {
keyword: theme().ansi5, ... } })` + `Editor.new(state)` is a code view (readonly)
or editor with syntax highlighting, line numbers and folding. A viewer opens
beside the shell as a pane: `pane.split {direction, mod, props: { file }}`.
The full surface is in `gpui-kit.d.ts` next to this file.

### The `herdr` module

All of it is in `herdr.d.ts`. In short:

- Live data: `spaces()` (each with its tabs, status, name, named, folder,
  machine, branch), `machines()` (name, null for this computer; layout:
  `loading`, `ready`, or `unavailable` on this connection; loading ends on
  the first read even if it fails, and offline machines are unavailable),
  `agents()` (status, app, space, tab, pinned, focused, command: working but
  waiting on a shell command it started; "done" turns "idle"
  once someone looks at it on any Herdr client), `terminals()`
  (every core terminal), `focused()`, `layout()`, `theme()` (every color by
  name: background (the terminals', cards), canvas (behind cards), chrome
  (sidebars, bars), surface, popover, raised, hover, selected, border,
  input (a stronger border), foreground, muted, dim, accent,
  accent_foreground, solid and solid_foreground (a primary button),
  selection, working, blocked, done, idle, unknown, ansi0..15; light and
  dark themes name the same ones), `settings()` (with `dark`: the
  appearance now), `keys()`, `commands()` (every app
  command, its arguments and what it does), `layouts()` (the layout names).
  `focused().agent` is the agent an agent block shows.
  `focused().space`/`tab` describe the current window context. With a layout terminal
  block focused, `pane` and `shown` are null; `terminal` and `cwd` describe that block,
  not its source pane. A terminal in a window (`openOverlay` with a `layout`) that has
  the keyboard is reported the same way; pane commands without a `pane` still act on
  the focused pane under the window. Check `focused()?.pane` before offering pane controls.
  `panes()` still lists only model panes; none is focused while a terminal block is.
  For composition navigation: `run("pane.focus", {terminal: nextAddress})`.
  Terminal copy/paste and implicit right-click routing follow the focused block.
- Floating: `placement()` (null unless this copy floats).
- Act: `run(command, args)`.
- Links: `cx.open_url(url)` and a `Link`'s `href` open like a clicked
  terminal link (a web pane, or the system's browser per `links`). For the
  system's browser always: `run("app.open_url", { url, in: "system" })`.
- Overlays: `openOverlay({ mod, props, kind: "dialog" | "popup" | "window", width, height, at, frame })`
  returns an id; the mod gets `props().overlay` and closes itself with
  `closeOverlay(id)`; Esc closes the top dialog or popup. `frame: "none"`
  drops Herdr's border, corners and shadow so the mod draws its own.
  `notify({ title, body, level, icon, timeout })` posts a notification, drawn
  by the layout-chosen mod (default: `toast`).
- Windows (`kind: "window"`): stay open until closed, over the layout and
  under dialogs; a press the mod doesn't stop drags it (stop it on your
  controls, like a title bar's buttons), it stays where dropped, and the one
  pressed last is on top. Sized by content unless `width`/`height`; at `at`
  or centered. `key: "name"` remembers its spot (opening that key again
  replaces it); `keep: true` with a key reopens it on the next start. A
  layout switch closes windows; kept ones come back with their layout.
  `scrim: true` (this fork) draws the layout's dialog dim (its `"scrim"`) behind the
  window; a click on it closes the window, like a dialog's (the mod's `close()` runs).
  A popup may ask for it too, when it's modal rather than hanging from a button
  (the command palette does in a layout with a `"scrim"`). Dialogs always have
  it: the floating terminal, centered menus, the scripts deck opened by key, the
  picker and the notifications question dialog sit on it.
  `resizable: true` or `{ min: [w, h], aspect, chrome: [w, h] }` lets people resize it by
  its edges and corners (grips just outside it): never below `min` (default 120×80) nor
  bigger than the app window, keeping `aspect` (width / height) once `chrome` (a bar, a
  border) is taken off; a keyed one remembers its size (refit to its aspect when it opens).
  `overlay.resizable {id, resizable}` changes that while it is open; a new aspect refits its
  height at its width now (a player learning its video's real shape).
  By keyboard: `overlay.focus` gives the next window the keyboard and brings it to the
  front (`dir: "prev"` the one before, in the order they opened; past the last, or
  `dir: "none"`, the keyboard goes back to the pane; `id` a given one). A mod gets
  `focus` from `nextCommand()`: take the keyboard then (`handle.focus()`), and show it.
  `overlay.move {dx, dy}` moves the window holding the keyboard (else the top one) and
  `{dw, dh}` resizes a resizable one by its right and bottom edges, kept like a drag. A video player:
  `{ width: 384, height: 238, resizable: { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] } }`.
  A window can hold a layout, terminals too: a terminal keeps its presses
  (selecting text), so give it a mod block to drag by, a title bar:
  `openOverlay({ kind: "window", key: "t7", width: 600, height: 400, layout: { type: "column", children: [{ type: "block", size: { px: 28 }, content: { mod: "my-titlebar" } }, { type: "block", content: { terminal: "t7" } }] } })`.
  An overlay's terminal that nothing else shows gets the size it had before back when the
  overlay closes, so a small window (a password prompt) doesn't leave it small.
- Machine: `exec(cmd, args, { cwd, on, timeout })` (the user's real environment; use this,
  not `process.run`; `on: space.machine` runs there, omitted means local).
  `timeout` is milliseconds, defaults to 30,000 and is capped at 600,000 (10 minutes),
  locally and remotely. It rejects on timeout, if the program cannot start or the machine cannot be reached.
  `hc(args)` (`hc read <t>` gives a terminal's text),
  `home()`, `appHome()`, `playSound("done" | "blocked" | file)`.
  `knownAgents({ on })`: the agents people can start (programs.json's
  `run`), most picked first, each `installed` or not there (asked of the
  shell agents start in; a remote Unix machine's login/interactive shell when supported);
  rejects if the check fails (failed checks are not cached); start one with `argv: agent.run`.
  `pickFolder({ prompt })`: the system's folder picker (here only),
  resolves with the folder or null.
- Files: `readTextFile(path, { on })` (here, or on that machine),
  `writeTextFile(path, text, expected)` (here only), and
  `watchFolder(dir)` (here only; poll a remote space's folder): resolves with the changed paths the next time anything
  under `dir` changes. On Linux, Git-ignored directories and Git objects are skipped,
  and trees above 4096 non-ignored directories reject the watch; use a timer fallback.
  macOS and Windows watch recursively, including ignored directories.
  A returned root path means refresh everything (the pending paths are bounded).
  Files also refreshes on its 10-second timer:
  `cx.spawn(async (cx) => { for (;;) { await watchFolder(dir); this.reload(); cx.notify(); } })`.
- Code (this machine): `highlight(text, language)` (tree-sitter spans `[start, end, name]`
  to color code you draw yourself; `languageOf(path)` names the language), `findFiles(root,
  query)` and `grep(root, query, { mode })` (fff: fuzzy file names and live grep, git-ignored
  files left out), and language servers: `lspStart({ argv, root, settings, idle })` (shared per
  argv and root, initialized for you; `idle`: seconds it runs on once no copy uses it, default
  90, of such servers at most 2 stay, least recently used stopped first), `lspRequest(id,
  method, params, { key })` (a newer request with the same key cancels this one), `lspNotify`,
  `lspNextMessage` (diagnostics, `$/progress` (work under way is replayed to a copy that joins)
  and other notifications), `lspRelease`; documents and their sync are yours. A code editor's
  `EditorState` moves its caret, finds, edits, underlines problems (`set_diagnostics`), writes
  notes after lines (`set_line_notes`), reports the word under the pointer (`on("hover")`),
  says where a place is drawn (`bounds({ line, col })`: its word and the editor's box, window
  coordinates) and whether it has the keyboard (`focused()`),
  gets every keystroke first and may take it (`on("key")`, a modal scheme's), shapes its caret
  (`set_cursor_shape`) and sets several selections (`set_selections`).
  `setUnsaved(note)`: closing this copy's pane or tab asks the person first.
- `notify({ ..., action: { name, args } })`: the toast runs the command when clicked.
- This copy: `props()`, `shared(key)` / `setShared(key, value)` (every mod
  sees it; setting re-renders all), `nextCommand()` (key commands for this
  mod: `cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); …; cx.notify(); } })`).

Mods are trusted code: commands and network access (including `fetch`) are unrestricted.
Other built-ins: `localStorage` (per mod copy), `console.log`, `fetch`,
`import * as fs from "fs/promises"` (read in home, write under `~/.config/herdr-app`).

## herdr-core (`hc`)

`herdr-app --skill` prints the manual for driving this window;
`hc --skill` prints the manual for running and coordinating programs and agents,
including a small herdr-core skill you can install with the user's permission.
`herdr-app commands` lists app commands and arguments without needing an open window.

- `hc ls --json`, `hc read t3 --lines 50`, `hc run --json --cwd <dir> --label k=v -- <cmd>`,
  `hc label t3 k=v`, `hc send t3 "text"`, `hc wait t3`. `hc --help` for all.
- Other machines: `hc machine ls`; `hc run --on <machine> ...` starts a
  terminal there (`vps/t7`), `hc exec --on <machine> git status` runs one
  command there and prints exactly its output.

## Keep in mind

- A task's `cx` belongs to the copy that started it: `cx.notify()` redraws
  that copy, even when another copy woke it (a shared promise).
- One mod per idea. Don't edit `AGENTS.md` or the `.d.ts` files (the app
  rewrites them). Don't touch other mods unless the request
  needs it.
