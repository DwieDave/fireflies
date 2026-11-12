# Contributing

Fireflies is a fork of [Herdr](https://github.com/herdrdev/herdr-app), built to be changed by your agent. If what you want can be done with a mod or a layout, build it, there is no need to wait for us.

Issues that ask for a custom mod, or for a feature a mod can already do, get closed.

The same goes for pull requests: the layouts and mods Fireflies ships take fixes only. Build the features you want as your own mod.

Please open an issue for:
- bugs in Fireflies itself or in the layouts and mods it ships with;
- things a mod cannot do yet (a missing API, an event, a setting).

Layouts and mods work in both apps. Herdr's community shares them in its [Discord](https://discord.gg/PsgRfzmUDg) and under the [GitHub topic `herdr-layout`](https://github.com/topics/herdr-layout) (see [herdr.dev/layouts](https://herdr.dev/layouts)).

A bug that is Herdr's too belongs [upstream](https://github.com/herdrdev/herdr-app/issues).

## Code contributions

Discuss bigger changes in an issue first. Keep PRs small and focused.

See [build from source](README.md#build-from-source) for setup. Run `just build` and `just check` (or `cargo test --locked`). On Linux, test UI changes with `scripts/sandbox up`, `scripts/sandbox shot` and `scripts/sandbox down`; it uses its own app home, core and display. Don't test against someone else's running app or core.

Keep OS-specific code only where the OS really differs. Keep small quirks near their use; put larger differences behind one small module per concern. Test Windows and macOS changes on those systems.

When dependencies or bundled assets change, update their licenses and run `just notices`. See [licenses](licenses/README.md).
