# Fireflies: orchestrating agents

Fireflies is David's fork of the Herdr desktop app (origin `DwieDave/fireflies`,
upstream `herdrdev/herdr-app`). AGENTS.md holds the project's rules; this file
is how *you*, the **orchestrator**, develop it: agents do the work in their own
worktrees, you brief, review, merge, and ship.

## Spawn an agent

1. **Worktree** (always on `/Volumes/data`, never inside the repo):
   ```sh
   W=/Volumes/data/coding/fireflies-wt/<name>
   git worktree add -b feat/<name> $W main
   git -C $W submodule update --init --reference /Users/david/Documents/personal/coding/fireflies/vendor/ghostty
   cp -cR /Volumes/data/coding/fireflies-wt/integrate/target $W/target   # APFS clone, seeds the build
   ```
2. **Brief**: write it to your scratchpad (`$SCRATCH`) as `<name>.md`. Start from
   [.claude/agent-brief.md](.claude/agent-brief.md) (the rules block every
   brief carries) and put the task above it: area, exact scope, what's already
   ruled out, files to read, parallel agents and which files they own.
3. **Launch** it as a tab in David's fireflies space, then label it:
   ```sh
   T=$(herdr-app do tab.new "$(jq -n --rawfile b $SCRATCH/<name>.md '{name:"<name>",space:"sp29a5b18766c620ac796867e1c51c5d1c",argv:["env","CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1","claude",$b],folder:"'$W'"}')" | jq -r .terminal)
   ~/.local/bin/hc label $T nocturne.name=<name>
   ```
   `hc` is at `~/.local/bin/hc` (not on the Bash tool's PATH). Without
   `space`, the tab lands in whatever space is focused.
4. **Follow-ups** go to a live agent with `hc send <t> "<task>"`; check it's
   alive first (`hc get <t>`). A finished agent's worktree can host a new one.

Design work: the brief asks for **2 concepts** (images/HTML via /impeccable,
look locked to the nocturne style) sent back first; the agent builds its pick
unless David answers within ~10 minutes. Relay both concepts to David with
your read on them.

## Review and merge

Reports arrive as `<hc from="tNN">`. Before merging, **look**: open the
agent's screenshots and check them against what David asked; send back
anything off (clipped text, leftover F-keys, wrong state) instead of merging.

The merge loop, in `/Volumes/data/coding/fireflies-wt/integrate` (branch
`integrate`):

1. `git merge --no-edit feat/<name>`.
2. Conflicts:
   - justfile `bun test` lines: union (keep every line and its comment).
   - Two agents implementing the same thing differently (keys, commands,
     handlers): `git merge --abort` and send it back to one agent to merge
     main and reconcile into one implementation, keeping both test suites.
   - A branch that started before big merges: ask its agent to merge main.
3. Every test, muted: each `bun test` line from the justfile (`grep '^    bun test' justfile`, strip comments, eval) and
   `PATH=/nix/store/mskva5g8bqz7mym9a70ablndnl1ag8jm-zig-0.16.0/bin:$PATH cargo test --locked`.
   **Green** on all of them is the bar.
4. Ship: in the main checkout `git merge --ff-only integrate && git push origin main`;
   in `/private/etc/nix-darwin`: `nix flake update herdr-app` and
   `nix build --no-link --print-out-paths .#darwinConfigurations.$(scutil --get LocalHostName).system`.
5. Tell David: what changed in his words, what was verified and what wasn't,
   then `! sudo darwin-rebuild switch --flake /private/etc/nix-darwin` and
   restart Fireflies. He commits the nix-darwin changes himself.

Batch several merges before one nix build when agents finish close together.

## Keys

- Agents never edit `defaults/keys.macos.json`; they **propose** global keys
  in their report. You add them in one commit on `integrate`.
- Before changing it: copy the current file to `src/keys/shipped/fireflies-<topic>-keys.macos.json`
  and list it last in `SHIPPED_MACOS_KEYS` (src/keys.rs) with a comment, so
  untouched installed files upgrade.
- Shipped bindings are **strings** only (`"cmd-x": "cmd.name"` or `"name:arg"`);
  argument objects belong in a user's own keys.json. New mod commands bound in
  shipped keys go in the whitelist in `src/mods/render_tests.rs`
  (`shipped_layouts_and_keys`).
- No function keys: David's keyboard makes them awkward.

## Upstream and core

- Rebase onto upstream in a dedicated agent's worktree; keep our core
  changes unless an upstream change fully replaces one. Main gets rewritten
  only with David's yes: tag the old head, `--force-with-lease`.
- Every change to `src/`, `vendor/` or `native/` is flagged for Can's review
  with the three AGENTS.md questions; collect them in your reports.
- Fork decisions stay: no telemetry; feedback opens a GitHub issue on DwieDave/fireflies.

## Housekeeping

- **Cleanup**: a worktree goes when its branch is on main (or, after a
  rebase, on the tagged old main) and no live agent sits in it
  (`hc ls | jq '.terminals[] | select(.state=="live") | .cwd'`). Look at
  untracked files before `git worktree remove --force`.
- David's screen recordings arrive as scrawl captures: the agent opens
  `contact-sheet.png` and `frames/` before changing anything; pass the
  capture path on unchanged.
- `ls` is aliased to eza and can hang in big git trees; use `/bin/ls`.
- Never touch David's running app or core; demo or inspect his session only
  through `herdr-app do` / `hc` commands he asked for.
