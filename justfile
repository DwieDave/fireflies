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
    # The git window on a real scratch repo, with herdr and gpui stand-ins.
    bun test scripts/nocturne-git-view.test.ts
    # Nocturne's chrome by keyboard (sidebar, tab strip, headers, toasts), with herdr and gpui stand-ins.
    bun test scripts/nocturne-chrome-keys.test.ts
    # The floating tool windows' keys, with herdr and gpui stand-ins.
    bun test scripts/nocturne-windows-keys.test.ts
    # The dialogs' keyboard (Settings, nocturne's dialogs, menus, screens), with stand-ins.
    bun test scripts/dialogs-keys.test.ts
    # Nocturne's palette through its real imports, herdr and gpui stand-ins.
    bun test scripts/nocturne-palette.test.ts
    # The picker's render cost and typing, herdr and gpui stand-ins.
    bun test scripts/nocturne-picker-view.test.ts
    # The picker's mode switch by tab, cmd-shift-f and cmd-p, the query kept.
    bun test scripts/nocturne-picker-keys.test.ts
    # No mod's cleanup hook (an exported View's close()) closes its pane again.
    bun test scripts/mod-close-hook.test.ts
    # The keys bars end with their ? entry, with gpui stand-ins that record draw order.
    bun test scripts/hint-bars.test.ts
    cargo test --locked

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
