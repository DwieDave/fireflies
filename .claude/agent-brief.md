# Rules block for agent briefs

Paste this below the task in every brief. Fill `<name>` (worktree and branch
name) and `<orchestrator>` (your `$HC_TERMINAL_ID`, e.g. `t7y`).

---

You work in the git worktree /Volumes/data/coding/fireflies-wt/<name> (branch feat/<name>, from integrate) of fireflies, Developer's fork of the Herdr desktop app (Rust/GPUI core in src/, JS mods in defaults/mods/, nocturne UI mods named nocturne-*; Developer runs the nocturne layout at zoom 0.9). Read AGENTS.md first.

Rules:
- Stay inside this worktree. Main, other worktrees, and Developer's running app and core belong to others.
- UI checks run in a scratch app: HERDR_APP_HOME under /var/tmp (short: the socket path has a length limit) plus its own HC_SESSION, nocturne layout, zoom 0.9, sounds off; every herdr-app/hc command you run carries that env, and you stop the app and core afterwards. A bare `herdr-app` without the scratch env opens Developer's real setup. Input on the real display is off limits: key handling is proven with bun tests that call the mods' handlers. A hidden scratch window draws no fresh frames: `herdr-app do window.maximize` (scratch env) forces one. It is never the active window: carets, selections and hover states don't paint there and no pointer reaches it, so prove those in tests and list them under not verified. Native views (PDF, video, web) don't appear in `herdr-app shot`.
- Build and test need Zig 0.16: PATH=/nix/store/mskva5g8bqz7mym9a70ablndnl1ag8jm-zig-0.16.0/bin:$PATH. target/ is seeded. Run every `bun test` line in the justfile plus `cargo test --locked`, muted; add new test files to the justfile's bun list. vendor/gpui-kit's own tests are outside that bar; one runs with an uncommitted placeholder `README.md` beside vendor/gpui-kit/Cargo.toml and `CARGO_TARGET_DIR=target/gpuikit cargo test --manifest-path vendor/gpui-kit/Cargo.toml -p gpui-base --lib <name>`.
- Prefer mods. A change to src/, vendor/ or native/ is flagged for Can's review with the three AGENTS.md questions answered.
- defaults/keys.macos.json stays as is: propose global keys (key, command, why, checked free) in your report. Use no function keys.
- Keep defaults/AGENTS.md and src/SKILL.md current for what you change, in your area's sections.
- Write actions on real services (GitHub PRs, workflow runs, project items, pushes, sudo, answering Developer's agents) are tested against fakes; ask <orchestrator> before any real one.
- Design work: invoke /impeccable; the nocturne look is locked in (dithered night UI, moonfly colors, square corners, existing fonts and icons).
- Everything committed (code, comments, tests, docs, commit messages) calls the person you work for `Developer` and writes a path under his home as `~/…`.
- Commits: lowercase single-line conventional commits, no co-author or AI trailers. Leave pushing to the orchestrator. Work alone: no subagents or other agents.
- Developer's screen recordings (scrawl captures): open contact-sheet.png and frames/ before changing anything.

When done or stuck: hc send <orchestrator> "<changed; core changes for Can; proposed keys; verified; not verified; screenshot paths; commits>". Long details go in /Volumes/data/coding/fireflies-wt/<name>-report.md.
