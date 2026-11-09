# Fireflies

Fireflies is a fork of [Herdr](https://github.com/herdrdev/herdr-app) (the
desktop app). It stays a Herdr build: same config folder (`~/.config/herdr-app`),
same core, same mod API. On top of Herdr it adds:

- **Native views for mods**: a mod can host a native view in its pane (a
  WKWebView browser, Safari's Web Inspector). `nativeView`, `nativeViewCall`,
  `nextNativeViewEvent` in `defaults/herdr.d.ts`; `native/herdr-native-view`.
- **Layout roles** for the dialogs Herdr draws: `prompt_mod`, `confirm_mod`,
  `palette_mod`, `peek_mod` (and upstream's `toast`, which also reads the fork's
  older `toast_mod`). See `defaults/AGENTS.md`.
- **Panes**: `pane.split` left/up/auto and along a tab's edge, per-pane font
  zoom, floating terminals with a second view (`terminal.open {place: "float"}`).
- **Nocturne**, the layout a first start shows: a 1-bit night meadow in the
  moonfly palette. Its parts ship as ordinary Herdr mods in `defaults/mods`,
  installed and updated like Herdr's own:

  | mod | what it is |
  | --- | --- |
  | `nocturne` | the sky sidebar, tab strip, pane headers, menus, dialogs, toasts, palette |
  | `nocturne-browser` | a web page in a pane (native view) |
  | `nocturne-diff` | the git diff beside lazygit |
  | `nocturne-files` | a file tree that opens picks in `$EDITOR` |
  | `nocturne-agents` | Claude Code's agents as a graph |
  | `nocturne-usage` | Claude's usage limits |

  With them: `defaults/layouts/nocturne.json` (+ `.svg` preview),
  `defaults/themes/moonfly.json`, and its keys in `defaults/keys.macos.json`
  (`layout:nocturne`, `mod:nocturne-browser`). The git pane needs `lazygit`
  on PATH; the files pane uses `$EDITOR` (nvim gets one instance per tab).
  `main` and the other Herdr layouts are still there (cmd-shift-l).
- **Branding**: Fireflies.app with its own icon (`assets/icons/fireflies`).

## Branches

`main` is Herdr's `master` with the fork merged in. To follow Herdr, merge its
master (don't rebase: `main` is published):

```sh
git remote add upstream https://github.com/herdrdev/herdr-app.git  # once
git fetch upstream
git merge upstream/master
```

Keep fork changes additive (new files, new fields, new commands) so these
merges stay small.

## Build

`scripts/install-fork-macos` builds and installs it (Rust 1.95, Zig 0.16).
With Nix, build it from source with crane, as `modules/herdr-app.nix` in
[dwiedave/config](https://github.com/dwiedave/config) does.
