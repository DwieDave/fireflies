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

test:
    bun test scripts/files.test.ts scripts/machine-add.test.ts scripts/picker.test.ts scripts/palette.test.ts scripts/agents.test.ts scripts/spaces.test.ts scripts/worktree.test.ts scripts/nocturne-github.test.ts scripts/nocturne-github-graph.test.ts scripts/nocturne-github-cache.test.ts scripts/nocturne-github-remotes.test.ts scripts/nocturne-github-create.test.ts scripts/nocturne-equalize-panes.test.ts scripts/nocturne-scripts.test.ts scripts/nocturne-scripts-runs.test.ts scripts/nocturne-scripts-nix.test.ts scripts/nocturne-markdown.test.ts scripts/nocturne-notifications.test.ts scripts/nocturne-preview.test.ts scripts/nocturne-preview-table.test.ts scripts/nocturne-preview-diff.test.ts scripts/nocturne-preview-native.test.ts scripts/nocturne-github-projects.test.ts scripts/nocturne-gridify.test.ts scripts/nocturne-pins.test.ts scripts/nocturne-git.test.ts scripts/nocturne-editor.test.ts scripts/nocturne-picker.test.ts scripts/nocturne-vim.test.ts scripts/nocturne-files.test.ts scripts/nocturne-browser.test.ts
    # Its own process: it stands in for "herdr" (mock.module is process-wide).
    bun test scripts/nocturne-github-projects-tab.test.ts
    # The GitHub window's new pull request and run workflow forms by their keys, gh and git faked (writes recorded, never sent).
    bun test scripts/nocturne-github-forms.test.ts
    # Where those forms' fields sit: the column, sections, pairs, the body's growth, a list opening at its field (upward without room).
    bun test scripts/nocturne-github-form-layout.test.ts
    # The git window on a real scratch repo, with herdr and gpui stand-ins.
    bun test scripts/nocturne-git-view.test.ts
    # The GitHub window's lists keep their cursor in view (runs, steps, log, PRs, checks, the picker) at zoom 0.9 and 1, and the job graph's default height, with herdr and gpui stand-ins.
    bun test scripts/nocturne-github-scroll.test.ts
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
    # The shipped palette: every app command and global or terminal key is an entry or stays out with a reason.
    bun test scripts/palette-commands.test.ts
    # The picker's render cost and typing, herdr and gpui stand-ins.
    bun test scripts/nocturne-picker-view.test.ts
    # The picker's mode switch by tab, cmd-shift-f and cmd-p, the query kept.
    bun test scripts/nocturne-picker-keys.test.ts
    # The picker's folder: one that was moved or deleted is passed over, and named when none is left.
    bun test scripts/nocturne-picker-folder.test.ts
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
    bun test scripts/nocturne-notifications-open.test.ts
    # The blue corner ticks on what's shown: the focused agent's firefly square, the shown space open and on the rail, with recording gpui stand-ins.
    bun test scripts/nocturne-highlight.test.ts
    # Nocturne's one key help: every keyhelp.js copy is the source byte for byte; in every mod ? opens the overview, ? or esc closes it.
    bun test scripts/keyhelp.test.ts
    # A menu's ask (rename, delete a space) is answered from a task after the render, never in it (GPUI refuses cx.notify there), with a cx that throws as GPUI does.
    bun test scripts/nocturne-render-asks.test.ts
    # An agent's row is pressed anywhere on it (full width, half of each gap; the rail's cell and its padding), with recording gpui stand-ins.
    bun test scripts/nocturne-hit-areas.test.ts
    # The editor's servers through the workspace's .envrc (direnv: allowed, blocked, none, missing, a slow load, kept on disk: hit, miss, a changed flake.lock), and what cmd-i says without one, exec faked.
    bun test scripts/nocturne-editor-env.test.ts
    # The editor's hover card (its place, every way it closes in each vim mode, a card that waits and fills in), progress words, ranged edits, kept answers: a whole pane with herdr and gpui stand-ins (mocks herdr).
    bun test scripts/nocturne-editor-card.test.ts
    # The editor's file tabs (own text, undo, caret, unsaved changes; switch, close asking, the last closing the pane, a restart) and where files go as tabs (definition, files pane, picker, Markdown viewer; editor-route.js copies identical), one server listener for every tab, vim's gt / :bn / :bd (mocks herdr).
    bun test scripts/nocturne-editor-tabs.test.ts
    # Editors and the Markdown viewer follow a file renamed, moved or deleted from the files pane (shared nocturne.files.changes), with stand-ins.
    bun test scripts/nocturne-editor-follow.test.ts
    # The editor's word wrap toggle (cmd-k z, space u w, :set wrap, the bar's chip): the shown tab only, from the language's soft_wrap, with stand-ins (mocks herdr).
    bun test scripts/nocturne-editor-wrap.test.ts
    # The files pane's preview split through its key handler, toolbar and menu, and the preview's viewer embedded in it, with recording stand-ins.
    bun test scripts/nocturne-files-preview.test.ts
    # nocturne-files ships the preview's viewer and what it imports: each copy is nocturne-preview's byte for byte.
    bun test scripts/nocturne-preview-shared.test.ts
    # The tab strip's toolbar: the "+ new" menu's tiles (none that float), the tools' order with "+ new" last, its menu inside the window.
    bun test scripts/nocturne-toolbar.test.ts
    # The editor's Markdown commands (bold … rule, enter in a list), each text and selection in and out, and off again.
    bun test scripts/nocturne-editor-mdedit.test.ts
    # The editor's rendered view model: units by source line, the caret's walk, a round trip on a Markdown corpus.
    bun test scripts/nocturne-editor-live.test.ts
    # The editor's rendered view and the scratchpad as a whole pane (mocks herdr): the block written back byte for byte, arrows across blocks, cmd-. and a letter, vim, undo, autosave and close.
    bun test scripts/nocturne-editor-rendered.test.ts
    # The scratchpad's note per repository and worktree (git faked), its index, autosave timing and the flush on close.
    bun test scripts/nocturne-scratchpad.test.ts
    # Pinning panes that aren't agents (web, editor, files, a shell) to the jar's shelf: the handlers, menu, palette, keys and tiles.
    bun test scripts/nocturne-pane-pins.test.ts
    # Keys never land behind a floating window that shows: every Git and GitHub window opens with a scrim, GitHub takes the keyboard on `focus`.
    bun test scripts/nocturne-floatfocus.test.ts
    # Usage limits: a scratch app asks nothing; the two limits.js copies are one file.
    bun test scripts/nocturne-usage-limits.test.ts
    # Usage requests per hour: one reading per machine, the paces, the 429 back-off (a simulated hour, fake endpoint).
    bun test scripts/nocturne-usage-poll.test.ts
    # The processes and ports manager: ps and lsof parsers, the tree, folds, search, the kill flow, the port actions.
    bun test scripts/nocturne-procs.test.ts
    # Its deck and the strip's tree mark: every key, the cursor across refreshes, ask / TERM / KILL against a fake exec.
    bun test scripts/nocturne-procs-deck.test.ts
    # Its system graphs' readings: iostat, vm_stat, netstat, df and ioreg on a Mac's output; a machine without them reads null.
    bun test scripts/nocturne-procs-sys.test.ts
    # The new-space picker: its folders' sources and order, the filter, typed paths and tab, the name from the folder, every key, the space made or attached (stand-ins).
    bun test scripts/nocturne-newspace.test.ts
    # The sidebar's jar and walk: one firefly centered, air above the shelf, its insets; next / previous agent on through the shelf's tiles.
    bun test scripts/nocturne-chrome.test.ts
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
