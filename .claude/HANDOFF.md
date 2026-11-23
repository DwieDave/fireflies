# Handoff: the batch of 2026-11-16

Written by the orchestrator when Developer stopped the batch at 20% weekly
usage. His words: "ship what is there and leave docs (commited) for the rest
to be picked up by a fresh orchestrator". Read CLAUDE.md first; this file is
the state it does not hold. Delete it when the open work below is done.

## The sidebar regression of the first ship (fixed)

After the first ship Developer's nocturne sidebar showed "could not be
re-rendered · interrupted" with no spaces and no fireflies. Cause: every
`labelsOf()` in nocturne/kit.ts asked the app for the whole terminal listing
(each terminal with its argv; his fireflies carried their briefs there), once
per agent row and again in every comparison of the sidebar's sort, so a draw
with a dozen agents ran past the render's 50 ms budget, every time. The batch
added a schema decode to every dither() (layout-look) on top. Fixed: the
sidebar draws with one listing (`oneListing`), the sort looks labels up once,
and layout-look decodes the layout's name only when it changes. Measured in a
scratch app with 18 labelled agents (debug build): the sort 23 ms -> 1 ms, the
sidebar's draw 41-49 ms -> 9-16 ms. The reproduction is `/var/tmp/sb-run.sh`
(not kept in the repository): a copy of the app home, three spaces, six
labelled fake agents each. Lesson: a scratch app with one space and no agents
proves nothing about the sidebar; shoot with a dozen agents.

## Shipped with this commit

On main, green on every justfile test line:

| area | what | branch (merged) |
| --- | --- | --- |
| databases | a connection's sslmode, the form's `ssl` toggle; fireflies-k8s sends `sslmode: "disable"` for forwards (pushed there, 8b200c1) | feat/sslmode |
| browser | page fullscreen, mouse back/forward, two-finger swipe; pinned tabs' own status, pinning one tab | feat/fullscreen-nav, feat/browser-pins |
| scratchpad | block editing, toolbar A, focus thieves, copy path, blank lines on top | feat/scratchpad-edit |
| editor | mod files type-check in the editor (committed defaults/types, scripts/tsconfig.json, the home tsconfig); scroll kept on reload | feat/mod-types, feat/editor-reload |
| preview | previewable files open in a reused, zoomable preview pane (wheel, pinch) | feat/preview-open |
| menus | one placement helper: at the pointer, beside the cursor's element, centered for global keys | feat/menus |
| pip | the popped-out player drags by its whole area | feat/pip-drop |
| themes | mods draw with theme names only; pickers: moonfly, graphite, paper; the look follows the layout (flat dither in plain layouts); `layout:main` window keys; @fireflies/look (concept A, cards) with scripts as its reference | feat/themes |
| Chromium | CEF panes behind the cargo feature `chromium` (off by default): Settings → Web enables and downloads it, engine per tab, the chip, the video policy, DevTools over an in-app bridge | feat/chrome-panes |
| Effect | library modules in the engine, @fireflies/kit (+ batch 1), the Effect lint, the usage mod as pilot, wave 0: 13 shared libraries under defaults/lib/@fireflies | feat/effect-kit, feat/fx-0a, feat/fx-0b |

Developer has not yet run `darwin-rebuild`; the lists of what only his hands
can check are in each `/Volumes/data/coding/fireflies-wt/<name>-report.md`
("not verified").

## His scratchpad (~/.config/fireflies/app/scratchpad/fireflies-c6ebf457.md)

Ticked: fullscreen, mouse buttons, pinned-tab status, pinning one tab, the
five scratchpad items, editor type checking, PiP drag. Tick an item when its
work is merged and green (memory: scratchpad-check-off). Still open:

- **Context menus**: merged, but three gaps are left: right-click menus for
  GitHub cards, notifications' entries, agent-graph's nodes. They are in the
  fx-github and fx-panes briefs. Tick when those merge.
- **Chrome panes**: merged, not ticked: CEF's macOS sandbox is off (with it
  on every helper dies in a CHECK and Chromium ends the app; likely because
  the helpers live outside the app bundle). Needs its own agent. Until then
  Chromium is for trusted pages only and must not become the default engine.
  The nix patch that turns the feature on in his build:
  `/Volumes/data/coding/fireflies-wt/chrome-panes-nix.patch` (he applies it;
  aarch64 only; the deps and app tiers were not built under nix).
- **Make it themeable**: colors and the layout-driven look are in. Left: the
  plain look (concept A) applied per mod, by the conversion fireflies, from
  `docs/plain-look.md`'s per-mod checklist.
- **Effectify the mods**: phase 1 and wave 0 are in. Waves 1 and 2 and the
  k8s mod are open (below).

## The Effect conversion: where it stopped

The plan is `docs/effect-mods.md` (kit patterns, lint, per-mod inventory,
waves, "done"). Developer's decisions: every Effect rule stays on and every
finding is fixed ("yes youre expected to fix all findings too"); fresh agents
per wave; k8s is converted too ("k8s too!"); the conversion fireflies also
apply the look ("can the themes agent brief effect agents to include the
theme work too??").

**Wave 1 was launched and paused about 15 minutes in.** Six worktrees under
`/Volumes/data/coding/fireflies-wt/`, branches `feat/<name>`, each with
uncommitted work in progress (do not remove them):

| firefly | terminal | mods | commits ahead of integrate | uncommitted files |
| --- | --- | --- | --- | --- |
| fx-nocturne | t135 | nocturne | 1 | 36 |
| fx-github | t136 | github | 0 | 11 |
| fx-databases | t137 | databases | 2 | 15 |
| fx-editor | t138 | editor, markdown, finder | 1 | 3 |
| fx-panes | t139 | preview, file-tree, agent-graph, notifications, browser | 0 | 19 |
| fx-git | t13b | git | 0 | 13 |

Their briefs (task part) are in `.claude/handoff/briefs/`. If the terminals
are still live (`fireflies get <t>`), a message resumes each with its context; if
not, start fresh agents in the same worktrees from those briefs and tell
them to read their own diff first.

**Not yet told to them** (sending it resumes them, so it was held): kit batch
1 and two fixes are merged. The notice, with exact names and signatures, is
`.claude/handoff/kit-batch-1-notice.md`. Add to it: the test loader now
follows re-exports (scripts/mod-source.ts, 304ab3b), so a mod importing
@fireflies/look loads in tests (fx-editor and fx-panes were blocked on that).

**The kit's owner** (effect-kit, t12z, worktree `effect-kit`, 2 uncommitted
files) was working on two requests from fx-editor: (7) Files read/write/list
on another machine (`{ on }`), (8) `Files.watch(dir)` for watchFolder. The
rule that held the wave together: a conversion firefly never patches the kit
or a library; it sends one line, the owner fixes it once, you merge and tell
all six. Owners: kit and scripts/mod-source.ts: effect-kit; @fireflies/viewer
and /markdown: fx-0b (t134); the 11 libraries of wave 0a: fx-0a (t133);
@fireflies/look and docs/plain-look.md: themes (t12y).

**After wave 1**: wave 2 (one firefly: procs, scripts, pip, diff,
equalize-panes) and fireflies-k8s (its own repository,
`/Volumes/data/coding/fireflies-k8s`; "Mods outside this repository" in
docs/effect-mods.md is its contract).

**Cost**: Developer stopped here because of it. Measured: wave 0 (7.9k lines,
1,240 findings) cost about 3 to 4 points of weekly usage; wave 1 is 80.5k
lines and 15.5k findings. The orchestrator's estimate for all that is left
was 45 to 70 points. Its advice, which he has not answered: resume one
mid-sized mod first (git: 9.2k lines, 2,187 findings) to measure the cost per
mod before resuming the rest. Ask him for a usage threshold before resuming
anything; the watcher that paused at 20% read
`~/.cache/fireflies/usage-claude.json` (`.answer.week.used`) once a minute
and ran `fireflies interrupt` on every working agent.

## Questions he has not answered

- Picture links inside the editor's own Markdown preview still open a drawn
  editor tab: should they open in the preview pane too? (preview-open asked.)
- Paper theme: nocturne's dark veil behind open windows reads heavy on a
  light theme. The plain look uses a 35% flat veil; nocturne's stays.
- A fresh agent on CEF's sandbox: yes or no.

## Core changes waiting for his review

Each report answers the three AGENTS.md questions. In short:

- `crates/ghostty-sys/build.rs`, `vendor/gpui-pre-apple/build.rs`: watch
  paths printed relative (worktree seeding); THIRD-PARTY-NOTICES' hash line
  for the first was updated by hand (`cargo-about` is not installed:
  `just notices` regenerates it properly).
- `src/window.rs`: popups flip at the pointer, the `at:{x,y,w,h,over}` anchor
  (menus); link routing and the reused preview pane (preview-open).
  `src/links.rs`, `src/commands.rs` (preview-open, chromium.install/cancel/remove).
- `vendor/gpui-kit`: `ScrollHandle.offset()`, `on_bounds_change` (menus);
  `on_pinch` (preview-open); library modules, `TextEncoder`/`TextDecoder`
  (effect-kit).
- `native/fireflies-native-view`: fullscreen and side buttons
  (fullscreen-nav); `PipVideo` and the drag (pip-drop); `pdf.actualSize`
  (preview-open); `chromium.rs`, `cef_install.rs`, `devtools.rs`, the
  overlay-hole union and dim fix (chrome-panes). The DevTools bridge listens
  on 127.0.0.1 with a per-inspector token and an origin check.
- `src/mods.rs`: the home `tsconfig.json` (mod-types); `export_libraries`,
  `herdr-app types` writing the libraries (effect-kit). `build.rs` embeds
  `defaults/lib` and skips `node_modules`. `src/settings.rs`: `web_engine`,
  `chromium_video`. `Cargo.toml`: the `chromium` feature.
- `src/keys.rs`, `defaults/keys.macos.json`: `layout:main` window keys.
- `build.rs`: a `defaults/` folder that isn't there embeds nothing (the nix
  dependency step builds from a stub without `defaults/lib`; the first nix
  build of this batch failed there).
- Test code: `src/mods/render_tests.rs` registers the libraries and answers
  scripts' probe of the shown space.

## What the orchestrator learned today (now in CLAUDE.md or the brief)

- Seeding: `.claude/seed-worktree.sh`; a seeded `target/` is fresh only with
  file and folder times copied, relative `rerun-if-changed` paths, and
  `MACOSX_DEPLOYMENT_TARGET=14.0` in the agent's cargo environment. Confirmed
  on wave 0 and wave 1 (seeding in under a minute).
- Mod-only branches skip cargo, and twice that hid a cargo-side check (the
  size limit, a render test). Run `cargo test --locked` on a mod-only branch
  yourself before merging it, not after.
- Never merge into `integrate` while a test run is going there, and read the
  whole result before committing on top or fast-forwarding main.
- `cargo test` stops at the first failing test binary: run it with
  `--no-fail-fast` (not on lines that already pass `--`).
- After a merge that changes dependencies: `bun install --frozen-lockfile`
  on `integrate` before the tests.
- Timing tests (git-view's 5 s, editor-mdlive's frame budget, macos_check's
  launchctl deadline) fail at load averages above about 150 and pass alone.
- A scratch app's window shows on Developer's screen; he stopped runs that
  took minutes. One command that starts, shoots and stops; ask him first when
  a run is longer than about a minute.
- Developer's own checkout needs `bun install` once for the editor's types in
  scripts/.
