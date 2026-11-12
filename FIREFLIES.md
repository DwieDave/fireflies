# Fireflies

Fireflies is a fork of [Herdr](https://github.com/herdrdev/herdr-app) (the
desktop app). Under the name it is still Herdr: same config folder
(`~/.config/herdr-app`), same core, same mod API. On top of Herdr it adds:

- **Native views for mods**: a mod can host a native view in its pane (a
  WKWebView browser, Safari's Web Inspector). `nativeView`, `nativeViewCall`,
  `nextNativeViewEvent` in `defaults/herdr.d.ts`; `native/fireflies-native-view`.
- **Layout roles** for the dialogs the app draws: `prompt_mod`, `confirm_mod`,
  `palette_mod`, `peek_mod` (and upstream's `toast`, which also reads the fork's
  older `toast_mod`), `dialog_mods` for the welcome, what's new, keys, worktree,
  add-machine and update note, plus `corners: "square"` and a `scrim`. See
  `defaults/AGENTS.md`.
- **Panes**: `pane.split` left/up/auto and along a tab's edge, per-pane font
  zoom, floating terminals with a second view (`terminal.open {place: "float"}`).
- **Nocturne**, the layout a first start shows: a 1-bit night meadow in the
  moonfly palette. Its parts ship as ordinary mods in `defaults/mods`,
  installed and updated like Herdr's own:

  | mod | what it is |
  | --- | --- |
  | `nocturne` | the sky sidebar, tab strip, pane headers, menus, dialogs, toasts, palette |
  | `nocturne-browser` | a web page in a pane (native view) |
  | `nocturne-diff` | the git diff beside lazygit |
  | `nocturne-files` | a file tree that opens picks in `$EDITOR` |
  | `nocturne-agents` | Claude Code's agents as a graph |
  | `nocturne-usage` | Claude's or Codex's usage limits |

  With them: `defaults/layouts/nocturne.json` (+ `.svg` preview),
  `defaults/themes/moonfly.json`, and its keys in `defaults/keys.macos.json`
  (`layout:nocturne`, `mod:nocturne-browser`). The git pane needs `lazygit`
  on PATH; the files pane uses `$EDITOR` (nvim gets one instance per tab).
  Herdr's `main` and its other layouts are still there (cmd-shift-l).
- **Branding**: the name Fireflies in the window and the app's text, and its own
  icon (`assets/icons/fireflies`, the README's `assets/icons/Fireflies.svg`).
  The bundle is Fireflies.app (`just install`, `scripts/install-fork-macos`
  and the Nix build); its bundle id stays `dev.herdr.app`. The command is `fireflies`; `herdr-app` is the same
  program and stays for good. The other identifiers stay Herdr's (the app
  home, `HERDR_APP_*`, the mods' `herdr` module, labels): they are shared with
  upstream and with installed setups.
- **Mods beside the binary**: besides the built-in default mods, the app installs
  whole mod folders from `Fireflies.app/Contents/Resources/mods/` (replacing a
  built-in one of the same name). A packager can ship the mods there and change
  them without recompiling the app.

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

`scripts/install-fork-macos` builds and installs it as `/Applications/Fireflies.app`
(Rust 1.95, Zig 0.16); `just install` puts it in `~/Applications/Fireflies.app`.
With Nix, build it from source with crane, as `modules/herdr-app.nix` in
[dwiedave/config](https://github.com/dwiedave/config) does.

## Development shell

`flake.nix` is a shell with the language servers for this repository:
rust-analyzer (with cargo, rustc and the standard library's sources), the
TypeScript language server for the mods and scripts, nixd and taplo, and Zig
0.16 (the same store path as the build's), which ghostty-sys's build script
needs when rust-analyzer runs build scripts and `cargo check` (without it they
fail there, and the app crate gets no `cargo check` errors). It holds language
tooling only; the build's toolchain stays as it is. The editor's
rust-analyzer builds in `target/rust-analyzer`, apart from `cargo build`'s
folder: the shell's environment differs from a terminal's, and sharing one
folder would rebuild each other's work and wait on each other's lock. nix-darwin takes
this repository with `flake = false`, so the file doesn't change that build.
`.envrc` loads it with direnv: run `direnv allow` once in the checkout. Then
terminals with direnv's hook, and Fireflies' editor (it looks a language
server up through the workspace's `.envrc`), get the servers:
`nix develop -c rust-analyzer --version` shows they're there.
