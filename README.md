<p align="center">
  <img src="assets/icons/Fireflies.svg" width="128" height="128" alt="The Fireflies icon: a dithered firefly glowing under a crescent moon, over a hill at night">
</p>

<h1 align="center">Fireflies</h1>

Fireflies is a desktop app for terminals and coding agents. Keep work in spaces, see which agents need you, and leave terminals running when you close the window.

It is a fork of [Herdr](https://github.com/herdrdev/herdr-app), the desktop app, made for macOS. It adds:

- **Nocturne**, the layout a first start shows: a 1-bit night meadow in the moonfly palette, with a sky sidebar where your agents are fireflies, a tab strip, pane headers, menus and dialogs of its own.
- **Native views in panes**: a mod can place a real macOS view in its pane. The shipped ones show web pages (with Safari's Web Inspector), PDFs, video (with a picture-in-picture player) and Quick Look previews.
- **More from panes**: splits left, up or along a tab's edge, font zoom per pane, and floating terminals.
- **Layout roles for the dialogs**, so a layout can draw the prompt, confirm, palette, peek, toasts, the welcome and the update note in its own look.

Under the name it is still Herdr: the same `herdr-app` command, the same app home (`~/.config/herdr-app`), the same [herdr-core](https://github.com/herdrdev/herdr-core) and the same mod API. Mods written for Herdr run here. [FIREFLIES.md](FIREFLIES.md) lists what the fork changes and how it follows Herdr.

## Install

Fireflies has no release downloads yet. Build it from source on a Mac. Herdr's install scripts and its Homebrew cask install Herdr, not Fireflies.

You need [herdr-core](https://github.com/herdrdev/herdr-core). If Fireflies can't find it, its setup window offers to install it for you.

### Build from source

Clone the repository with its submodules and use Rust 1.95.0 and Zig 0.16.0, the versions in [CI](.github/workflows/ci.yml). Install [just](https://github.com/casey/just) for the recipes.

```sh
git clone --recurse-submodules https://github.com/DwieDave/fireflies.git
cd fireflies
just build
just test
just install
```

On macOS `just install` builds a release, puts the app in `~/Applications/Herdr.app` and links the command to `~/.local/bin/herdr-app`. Add that folder to your PATH. Quit and reopen the app to use a new build.

`scripts/install-fork-macos` installs into `/Applications/Herdr.app` instead, the place the official app uses, so Dock pins and settings that point there keep working. It refuses to overwrite an official Herdr: uninstall that first with `brew uninstall --cask herdr-app`, without `--zap` (zap deletes `~/.config/herdr-app`).

Both scripts still name the bundle `Herdr.app`. A build from source never updates itself: pull and build again.

### Nix

`flake.nix` is a development shell with the language servers for this repository (rust-analyzer, the TypeScript language server, nixd, taplo) and Zig 0.16. Run `nix develop`, or `direnv allow` once to load it through `.envrc`. It doesn't build the app. To build the app with Nix, use crane as [FIREFLIES.md](FIREFLIES.md#build) describes.

## Find your work

A **space** holds work on one machine, usually in one repo. Each space has **tabs**. Split a tab into **panes** to put terminals or mod panels beside each other.

An unnamed space follows its first terminal's folder. Name a space or tab when you want a label that stays. New tabs start in the focused terminal's folder.

The sidebar brings agents from your spaces into one list, including workers started by another agent. Agents that report status show as:

- **Working:** still busy.
- **Blocked:** waiting for you.
- **Done:** finished while you were looking elsewhere.
- **Idle:** not working, or a finished agent you have looked at.

Click an agent to see it. A worker without a pane opens in **peek**, over your tab. Keep it as a tab if you want it beside your other work. Cmd-click a live terminal address such as `t7` in terminal text to peek at it. `vps/t7` names one on another machine.

The window arranges terminals. The core runs them. Closing the window leaves them running; closing a pane or tab ends its terminals. After a reboot or a core crash, kept panes get fresh shells in their last folders, not their old programs.

## Work on another machine

Add an SSH machine from Settings → Machines or the sidebar's Add machine action. Pick a host from your SSH config or type how SSH reaches it. Spaces on that machine run their terminals there, and keep running when your laptop sleeps, as long as the remote machine and core stay up.

## Make it yours

Open the command palette (Cmd+Shift+P) to find an action by name and see its key, or open Settings to change fonts, colors, sounds and other preferences. Settings → Look switches layouts: Nocturne, plus Herdr's own main, Terminals and Windows 98 layouts.

A **layout** arranges the window. **Mods** are small JavaScript programs that draw its panels, menus and dialogs. Duplicate a shipped layout or mod before changing it: your copies stay yours, and the app replaces the shipped ones on start. Save a personal layout, mod or key file and the window reloads it. A broken edit keeps the last good version and reports the error.

Change any key in `keys.json`. The [keys section](defaults/AGENTS.md#keys-keysjson) of the mod guide has the format.

[Layouts and mods](docs/mods.md) · [Commands](docs/commands.md) · [Labels](docs/labels.md)

## Privacy

Fireflies collects no usage data. Send feedback opens a prefilled GitHub issue on this repository that you review and submit yourself. Mods are trusted code, not sandboxed extensions: read [security and privacy](docs/security.md) before installing someone else's mod.

## For agents

```sh
herdr-app --skill
```

This prints the agent guide for driving the window. The herdr-core skill points agents here. Use herdr-core for running and coordinating programs; use the app to change what you see.

```sh
herdr-app ls
herdr-app status
herdr-app commands
```

The first two inspect the open window. The command list also works without one. See the [command reference](docs/commands.md) for arguments.

## Contributing

See [Contributing](CONTRIBUTING.md). Run `just build` and `just check` (or `cargo test --locked`) before you send a change. Documentation checks also need [Bun](https://bun.sh): `just docs-check` checks generated pages and CLI examples, and `just docs-generate` refreshes the reference pages.

To compare drawing performance between builds, run the same fixed workloads against each:

```sh
python scripts/bench.py --bin <app executable> --set spinners --seconds 20
```

The runner needs `hc` on PATH. It prints a folder with the run's settings, counters and results, then stops its private app, terminals and core. `python scripts/bench_compare.py ghostty --root <artifact folder>` compares against Ghostty on macOS.

## License

Fireflies keeps Herdr's license: see [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES).
