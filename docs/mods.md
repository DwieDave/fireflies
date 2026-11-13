# Layouts and mods

You can change the whole window, not just its colors. Layouts arrange it; mods draw the panels inside it.

Read the [layout and mod guide](../defaults/AGENTS.md). This is the same guide Fireflies writes into your app home on every start, so people and agents work from one source of truth.
It covers layouts, settings, keys, overlays, mod code and the app API.
The generated `herdr.d.ts` and `gpui-kit.d.ts` beside your installed guide describe the full API for your version.

Start with Settings for fonts, colors and sounds.
For deeper changes, duplicate a shipped layout or mod from the command palette, then edit the copy.
Shipped files update on start; personal copies do not.
Save to reload. Check for errors, even when the old screen still looks fine.

```sh
fireflies check ~/.config/herdr-app/mods/my-panel
fireflies status
```

The check loads a mod and renders it once. It does not replace looking at the result in the window.

Mods may be TypeScript: a `.ts` file runs with its types removed, so its errors point at its own lines. Check the types with `tsc` against the typings `fireflies types <mod folder>` writes; the guide's TypeScript section says what's allowed. The shipped mods' bar (full strictness, no `any`, oxlint with anti-slop) and how to convert one: [mods in TypeScript](mods-typescript.md).

A mod that opens as a floating window can live in a normal pane too: [window mods in normal panes](mods-in-panes.md).

Mods can run programs, read files and use the network. Only install code you trust.
See [security and privacy](security.md).

[Back to Fireflies](../README.md)
