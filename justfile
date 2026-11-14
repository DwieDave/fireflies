set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
    @just --list

notes-clip scene version="":
    bun scripts/notes-media.ts clip "{{scene}}" "{{version}}"

notes-upload version:
    bun scripts/notes-media.ts upload "{{version}}"

notes-check version:
    bun scripts/notes-media.ts check "{{version}}"

check: test

notices:
    bun scripts/notices.ts

# Before a release: tests, docs, the next version's notes and clips, then what
# changed since the last release, to review by hand.
[unix]
pre-release: test docs-check
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
    last=$(git describe --tags --abbrev=0 --match 'v*')
    if grep -q "^## \[$version\]" CHANGELOG.md; then
      bun scripts/notes-media.ts check "$version"
    else
      echo "note: CHANGELOG.md has no [$version] entry yet: write the release notes before tagging."
    fi
    echo; echo "Since $last:"; git log --oneline "$last"..HEAD
    echo
    if git diff --quiet "$last"..HEAD -- src/SKILL.md; then
      echo "review: the agent manual (herdr-app --skill, src/SKILL.md) is unchanged since $last. Does it still match the changes above?"
    else
      echo "review: the agent manual (herdr-app --skill) changed since $last. Read it once more."
    fi
    echo "review: the mod guide (defaults/AGENTS.md), README.md and docs/ describe the changes above."

build:
    cargo build --locked

# The mods' TypeScript (docs/mods-typescript.md): tsc at full strictness on every
# .ts file under defaults/, against the typings the built app writes. The .js
# mods are outside it until their migration. `cargo test` runs it too
# (tests/mods_typescript.rs).
typecheck:
    bun install --frozen-lockfile
    cargo run --locked -q -- types target/mod-types
    node_modules/.bin/tsc -p defaults/tsconfig.json

# oxlint with anti-slop (oxlint.config.ts) on the same files (mods and frame); `just lint --fix`
# adds the blank lines require-readable-spacing asks for.
lint *args:
    bun install --frozen-lockfile
    node_modules/.bin/oxlint --deny-warnings {{args}} defaults/mods defaults/frame

test:
    bun test scripts/files.test.ts scripts/machine-add.test.ts scripts/picker.test.ts scripts/palette.test.ts scripts/agents.test.ts scripts/spaces.test.ts scripts/worktree.test.ts scripts/github.test.ts scripts/github-graph.test.ts scripts/github-cache.test.ts scripts/github-remotes.test.ts scripts/github-create.test.ts scripts/equalize-panes.test.ts scripts/scripts.test.ts scripts/scripts-runs.test.ts scripts/scripts-nix.test.ts scripts/markdown.test.ts scripts/notifications.test.ts scripts/preview.test.ts scripts/preview-table.test.ts scripts/preview-diff.test.ts scripts/preview-native.test.ts scripts/github-projects.test.ts scripts/nocturne-gridify.test.ts scripts/nocturne-pins.test.ts scripts/git.test.ts scripts/editor.test.ts scripts/finder.test.ts scripts/nocturne-vim.test.ts scripts/file-tree.test.ts scripts/browser.test.ts
    # Its own process: it stands in for "herdr" (mock.module is process-wide).
    bun test scripts/github-projects-tab.test.ts
    # The GitHub window's new pull request and run workflow forms by their keys, gh and git faked (writes recorded, never sent).
    bun test scripts/github-forms.test.ts
    # Where those forms' fields sit: the column, sections, pairs, the body's growth, a list opening at its field (upward without room).
    bun test scripts/github-form-layout.test.ts
    # The git window on a real scratch repo, with herdr and gpui stand-ins.
    bun test scripts/git-view.test.ts
    # The git window as a normal pane: no frame or ✕, esc stays, narrow widths, moved window -> pane -> window, two copies, a restart's props.
    bun test scripts/git-pane.test.ts
    # The GitHub window's lists keep their cursor in view (runs, steps, log, PRs, checks, the picker) at zoom 0.9 and 1, and the job graph's default height, with herdr and gpui stand-ins.
    bun test scripts/github-scroll.test.ts
    # The GitHub window as a normal pane: no frame or ✕, esc stays, narrow tabs, moved window -> pane -> window, two copies, a restart's props.
    bun test scripts/github-pane.test.ts
    # A panel's long title ends in an ellipsis inside its panel (GitHub window, git window), with recording gpui stand-ins.
    bun test scripts/nocturne-panel-titles.test.ts
    # Nocturne's chrome by keyboard (sidebar, tab strip, headers, toasts), with herdr and gpui stand-ins.
    bun test scripts/nocturne-chrome-keys.test.ts
    # The floating tool windows' keys, with herdr and gpui stand-ins.
    bun test scripts/nocturne-windows-keys.test.ts
    # The dialogs' keyboard (Settings, nocturne's dialogs, menus, screens), with stand-ins.
    bun test scripts/dialogs-keys.test.ts
    # Every form by its keys (form-keys.js): tab order both ways, the wrap, submit, cancel; writes go to stand-ins.
    bun test scripts/form-keys.test.ts
    # Nocturne's palette through its real imports, herdr and gpui stand-ins; no command, key or mod command goes missing from it.
    bun test scripts/nocturne-palette.test.ts
    # Optional mods in "+ new" and the palette: each installed mod's mod.json launcher, nothing named.
    bun test scripts/nocturne-launchers.test.ts
    # Mod panes' marks and names (Databases, a launcher's mod) in the header, the parked chip, the tab and the shelf's tile.
    bun test scripts/nocturne-modmarks.test.ts
    # The shipped palette: every app command and global or terminal key is an entry or stays out with a reason.
    bun test scripts/palette-commands.test.ts
    # The picker's render cost and typing, herdr and gpui stand-ins.
    bun test scripts/finder-view.test.ts
    # The picker's mode switch by tab, cmd-shift-f and cmd-p, the query kept.
    bun test scripts/finder-keys.test.ts
    # The picker's folder: one that was moved or deleted is passed over, and named when none is left.
    bun test scripts/finder-folder.test.ts
    # No mod's cleanup hook (an exported View's close()) closes its pane again.
    bun test scripts/mod-close-hook.test.ts
    # The keys bars end with their ? entry, with gpui stand-ins that record draw order.
    bun test scripts/hint-bars.test.ts
    # The strip's drop-downs (script runner, + new, bell) toggle by press and by key, with stand-ins that record handlers.
    bun test scripts/nocturne-drop-toggle.test.ts
    # Every ? list names every key its handler takes (each key pressed on the real handler), and the keys dialog's map.
    bun test scripts/keys-lists.test.ts
    # Dragging a tab along nocturne's strip: the stake stands where the tab lands, with recording gpui stand-ins.
    bun test scripts/nocturne-tab-drag.test.ts
    # The pointer's firefly glow over nocturne's sidebar: placed by the sky's real mouse handlers, calm and leave, only its own view rebuilt.
    bun test scripts/nocturne-fireglow.test.ts
    # The notifications overview opens without a jump: its first seen frame has the height and key bar it settles at, with recording gpui stand-ins.
    bun test scripts/notifications-open.test.ts
    # The blue corner ticks on what's shown: the focused agent's firefly square, the shown space open and on the rail, with recording gpui stand-ins.
    bun test scripts/nocturne-highlight.test.ts
    # Nocturne's one key help: every keyhelp.js copy is the source byte for byte; in every mod ? opens the overview, ? or esc closes it.
    bun test scripts/keyhelp.test.ts
    # A menu's ask (rename, delete a space) is answered from a task after the render, never in it (GPUI refuses cx.notify there), with a cx that throws as GPUI does.
    bun test scripts/nocturne-render-asks.test.ts
    # An agent's row is pressed anywhere on it (full width, half of each gap; the rail's cell and its padding), with recording gpui stand-ins.
    bun test scripts/nocturne-hit-areas.test.ts
    # The editor's servers through the workspace's .envrc (direnv: allowed, blocked, none, missing, a slow load, kept on disk: hit, miss, a changed flake.lock), and what cmd-i says without one, exec faked.
    bun test scripts/editor-env.test.ts
    # The editor's hover card (its place, every way it closes in each vim mode, a card that waits and fills in), progress words, ranged edits, kept answers: a whole pane with herdr and gpui stand-ins (mocks herdr).
    bun test scripts/editor-card.test.ts
    # The editor's file tabs (own text, undo, caret, unsaved changes; switch, close asking, the last closing the pane, a restart) and where files go as tabs (definition, files pane, picker, Markdown viewer; editor-route.js copies identical), one server listener for every tab, vim's gt / :bn / :bd (mocks herdr).
    bun test scripts/editor-tabs.test.ts
    # Editors and the Markdown viewer follow a file renamed, moved or deleted from the files pane (shared nocturne.files.changes), with stand-ins.
    bun test scripts/editor-follow.test.ts
    # The editor's word wrap toggle (cmd-k z, space u w, :set wrap, the bar's chip): the shown tab only, from the language's soft_wrap, with stand-ins (mocks herdr).
    bun test scripts/editor-wrap.test.ts
    # The files pane's preview split through its key handler, toolbar and menu, and the preview's viewer embedded in it, with recording stand-ins.
    bun test scripts/file-tree-preview.test.ts
    # Where the files pane opens a file: a picture in its own preview pane, else its editor's tab; a text file turning that preview pane into the editor (file-tree routing.ts, preview main.ts), with stand-ins.
    bun test scripts/file-tree-open.test.ts
    # file-tree ships the preview's viewer and what it imports: each copy is preview's byte for byte.
    bun test scripts/preview-shared.test.ts
    # The tab strip's toolbar: the "+ new" menu's tiles (none that float), the tools' order with "+ new" last, its menu inside the window.
    bun test scripts/nocturne-toolbar.test.ts
    # Git, GitHub and Scripts opened as normal panes: nocturne.<mod>:pane | :tab | :window | {as, folder?, on?}, the "+ new" tiles, the palette's "… in a pane".
    bun test scripts/nocturne-inpane.test.ts
    # The editor's Markdown commands (bold … rule, enter in a list), each text and selection in and out, and off again.
    bun test scripts/editor-mdedit.test.ts
    # The editor's rendered view model: units by source line, the caret's walk, a round trip on a Markdown corpus.
    bun test scripts/editor-live.test.ts
    # The editor's rendered view and the scratchpad as a whole pane (mocks herdr): the block written back byte for byte, arrows across blocks, cmd-. and a letter, vim, undo, autosave and close.
    bun test scripts/editor-rendered.test.ts
    # The rendered view as it's typed into: no flicker or lost keys through autosaves and reloads, per-key work, adding blocks by keys and pointer, vim across blocks as on plain text.
    bun test scripts/editor-mdlive.test.ts
    # Pictures in Markdown: image blocks drawn (broken and web ones too), a pasted screenshot or copied image file saved beside the file once and put in as a block, vim's p, undo, round trip (fake clipboard, a real PNG).
    bun test scripts/editor-images.test.ts
    # The scratchpad's note per repository and worktree (git faked), its index, autosave timing and the flush on close.
    bun test scripts/nocturne-scratchpad.test.ts
    # Opening the scratchpad from the palette, the + new menu's tile and its command: only the sidebar's copy awaits git; failures toast.
    bun test scripts/nocturne-scratchpad-open.test.ts
    # Pinning panes that aren't agents (web, editor, files, a shell) to the jar's shelf: the handlers, menu, palette, keys and tiles.
    bun test scripts/nocturne-pane-pins.test.ts
    # The picture in picture player's bar in sections (a dithered seam between), wide and narrow, and its ⋯ menu's sections.
    bun test scripts/pip.test.ts
    # Keys never land behind a floating window that shows: every Git and GitHub window opens with a scrim, GitHub takes the keyboard on `focus`.
    bun test scripts/nocturne-floatfocus.test.ts
    # Usage limits: a scratch app asks nothing; the two limits.ts copies are one file.
    bun test scripts/usage-limits.test.ts
    # Usage requests per hour: one reading per machine, the paces, the 429 back-off (a simulated hour, fake endpoint).
    bun test scripts/usage-poll.test.ts
    # TypeScript mods: guard.ts and keyhelp.d.ts are one file each in every mod that has them; guard.ts proves or refuses data.
    bun test scripts/mods-typescript.test.ts
    # The processes and ports manager: ps and lsof parsers, the tree, folds, search, the kill flow, the port actions.
    bun test scripts/procs.test.ts
    # Its deck and the strip's tree mark: every key and its pointer twin (the wheel's lines and pixels, clicks, the scrollbar), the cursor across refreshes, ask / TERM / KILL against a fake exec, the readings strip and its second.
    bun test scripts/procs-deck.test.ts
    # Its graphs' readings: iostat, vm_stat, netstat, df and ioreg on a Mac's output; a machine without them reads null.
    bun test scripts/procs-sys.test.ts
    # Its readings strip: the histories, a line's points (empty, one, a full window, a gap), the layout wide and narrow at zoom 0.9 and 1.0, a cell's numbers.
    bun test scripts/procs-vitals.test.ts
    # Its row menu: the entries per row kind, each act against a fake exec and fake herdr calls, the ends asking first, open / close / its place, every entry's key, a database's port to the Databases mod.
    bun test scripts/procs-menu.test.ts
    # Its sorting: the order per column and direction in the tree (a group by what's under it) and flat, the ports' columns, a click and the keys' steps, the kept record.
    bun test scripts/procs-sort.test.ts
    # Its pane (docs/mods-in-panes.md): drawn as a pane, esc / q, the pane's size and narrow columns, window → pane → window with the handover, the copy that acts, a restart's slot.
    bun test scripts/procs-pane.test.ts
    # The new-space picker: its folders' sources and order, the filter, typed paths and tab, the name from the folder, every key, the space made or attached (stand-ins).
    bun test scripts/nocturne-newspace.test.ts
    # The sidebar's jar and walk: one firefly centered, air above the shelf, its insets; next / previous agent on through the shelf's tiles.
    bun test scripts/nocturne-chrome.test.ts
    # The jar's shelf as drawn: no caption, a tile's icon by kind, the + tile's dock menu.
    bun test scripts/nocturne-shelf.test.ts
    # The tab strip's seam before the toolbar: the tabs' dithered fade, the post, the tools' ground, with few and overflowing tabs.
    bun test scripts/nocturne-tab-seam.test.ts
    # The pane menu's "Move to" rows: flat up to three places, else levels (this space's tabs, a new tab, the other spaces); every key and the click path.
    bun test scripts/nocturne-move-menu.test.ts
    # The script runner's run rows: watch, again and remove / stop as chips with their keys, asking before ending a running one, the row's widths in the deck.
    bun test scripts/scripts-chips.test.ts
    # The script runner's deck as a normal pane: no frame, esc stays, the pane's height, moved over the tab -> pane -> back with its filter.
    bun test scripts/scripts-pane.test.ts
    # A switch's password window the whole way (deck -> job -> watch -> window -> enter / cancel), with the app's real terminal record; a wrong password, two at once, again.
    bun test scripts/scripts-sudo.test.ts
    # The sky's usage section: a window without a length (Codex) is taken as the usual one, so its path still shows the clock.
    bun test scripts/nocturne-usage.test.ts
    # An agent's one mark in its tab and pane header, the sidebar's winged one (winged.ts): colour, motion only while working, size, no second mark.
    bun test scripts/nocturne-winged.test.ts
    # The strip's drop-downs: a second press on the git mark's ▾ closes its menu (Developer's report).
    bun test scripts/nocturne-tool-dropdowns.test.ts
    # The Databases window's statements and runs: splitting, the asks before a write, scripts, the runner for real with sqlite3 (no secret on any argv), psql's recorded output.
    bun test scripts/databases-run.test.ts
    # The Databases window's data: mysql's XML, libSQL over HTTP, the catalog against SQLite, connections found in a folder, exports, history, a throwaway keychain.
    bun test scripts/databases-data.test.ts
    # The Databases window's view: window and pane (no frame or ✕ in a pane, esc leaves it, the move both ways), narrow widths, keys and menus, the asks before a write, a connection another mod sends, no secret shared or on an argv.
    bun test scripts/databases-view.test.ts
    # A database file leads to the Databases window: the files pane's "Open in Databases" (b), the preview's table strip, only with the mod installed.
    bun test scripts/databases-open.test.ts
    # q closes every dialog and menu where it isn't text, as esc does: the confirm and rename dialogs, What's New, the welcome, the "+ new" launcher, the even-out popup.
    bun test scripts/qclose.test.ts
    # The dividers between panels (dividers.ts, the pattern the Kubernetes mod copies): a drag by its handlers, the clamp, + / - steps, the double click's reset, the sizes kept.
    bun test scripts/databases-dividers.test.ts
    # Editing cells: each engine's quoting, the changes staged by row key, what's editable, the save's statements (one UPDATE per row, the old values checked, one transaction), a real round trip on a throwaway SQLite file.
    bun test scripts/databases-edit.test.ts
    # Editing cells through the window's keys and handlers on a throwaway SQLite file: c / a double click, enter, esc, tab, ctrl-n, N, u, U, w and y; changes kept through pages and sorting; the asks before leaving; q types while editing.
    bun test scripts/databases-editview.test.ts
    cargo test --locked
    # The native views' own tests (not a workspace member): picture in picture's live resize among them.
    cargo test --locked -p fireflies-native-view

docs-generate: build
    bun scripts/docs.ts generate

docs-check: build
    bun test scripts/docs.test.ts
    bun scripts/docs.ts check

[linux]
install:
    bash scripts/install-linux

[macos]
install:
    bash scripts/install-macos

[windows]
install:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows.ps1
