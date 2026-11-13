# Fireflies: orchestrating agents

Fireflies is Developer's fork of the Herdr desktop app (origin `DwieDave/fireflies`,
upstream `herdrdev/herdr-app`). AGENTS.md holds the project's rules; this file
is how *you*, the **orchestrator**, develop it: agents do the work in their own
worktrees, you brief, review, merge, and ship.

## Spawn an agent

1. **Worktree** (always on `/Volumes/data`, never inside the repo):
   ```sh
   W=/Volumes/data/coding/fireflies-wt/<name>
   git worktree add -b feat/<name> $W integrate
   git -C $W submodule update --init --reference ~/Documents/personal/coding/fireflies/vendor/ghostty
   cp -cR /Volumes/data/coding/fireflies-wt/integrate/target $W/target   # APFS clone, seeds the build
   ```
   `integrate` holds what is merged and not shipped yet. An agent that needs
   another's work merges `integrate`; tell it when that work lands.
2. **Brief**: write it to your scratchpad (`$SCRATCH`) as `<name>.md`. Start from
   [.claude/agent-brief.md](.claude/agent-brief.md) (the rules block every
   brief carries) and put the task above it: area, exact scope, what's already
   ruled out, files to read, parallel agents and which files they own.
   - Quote Developer's words, then give your reading of them, marked as yours.
   - What you traced in the code goes in as leads to check.
   - An image he pasted: copy it to `/Volumes/data/coding/fireflies-wt/refs/`
     and give that path.
   - Two agents that have to meet (one writes a record, the other reads it)
     get the same contract in both briefs: the key and its shape.
   - End the task with a "Done means" list: the tests, the screenshots, the docs.
3. **Launch** it as a tab in Developer's fireflies space, then label it:
   ```sh
   T=$(herdr-app do tab.new "$(jq -n --rawfile b $SCRATCH/<name>.md '{name:"<name>",space:"sp29a5b18766c620ac796867e1c51c5d1c",argv:["env","CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1","claude","--model","claude-opus-5-5","--effort","high",$b],folder:"'$W'"}')" | jq -r .terminal)
   ~/.local/bin/hc label $T nocturne.name=<name>
   ```
   Agents run on Opus 5.5 at high effort (the `--model` and `--effort` above).
   `hc` is at `~/.local/bin/hc` (not on the Bash tool's PATH). Without
   `space`, the tab lands in whatever space is focused. Then start its
   watcher (Notify Developer), and tell Developer every choice the brief made
   for him, so he can overrule it while the agent is early.
4. **Follow-ups** go to a live agent with `hc send <t> "<task>"`; check it's
   alive first (`hc get <t>`). Each carries his words quoted and an item
   number, one commit per item. An agent with a long list reports finished
   items in batches, so they merge while it works on. Tell it when files it was
   told to leave change hands. A new area, or faults its author and you both
   missed, get a fresh agent with his complaint quoted; a finished agent's
   worktree can host it.

Design work: the brief asks for **2 concepts** (images/HTML via /impeccable,
look locked to the nocturne style) sent back first; the agent builds its pick
unless Developer answers within ~10 minutes. Relay both concepts to Developer with
your read on them. Other UI work asks for a **first look**: a screenshot as soon
as it draws, passed on to him while the agent carries on.

## Notify Developer

Push to his phone with the `pushover` skill on two events:

- **All agents done**: the last working agent has stopped. One push for the
  batch, once you have read the last report: which agents finished, what each
  delivered in a line, and what happens next (merge and build running, or the
  decision he owes).
- **An agent is blocked**: its status is `blocked` (a permission prompt or a
  question on its screen), or its report asks something only Developer can
  answer. Read its screen first (`hc read --lines 0 <t>`); the push names the
  agent and quotes what it asks.

Agent tabs aren't your children, so hc tells you nothing when one stops or
blocks. A **watcher** per agent does: run it as a background command once the
agent shows `working`, after its launch and after each follow-up to an agent
that had stopped (its status stays `done` for a few seconds after the send).

```sh
T=<t>; while s=$(~/.local/bin/hc get $T | jq -r 'if .state != "live" then "exited" else .status.state // "working" end'); [ "$s" = working ]; do ~/.local/bin/hc wait $T --timeout 600 >/dev/null 2>&1; done; echo "$T $s"
```

It ends when the agent leaves `working` and prints why: `blocked` (push);
`error` (read the screen, push if a nudge from you doesn't clear it); `done`,
`idle` or `exited` (that agent stopped: push if it was the last one working).

## Review and merge

Reports arrive as `<hc from="tNN">`. An agent that reports success is merged
right away: Developer's go-ahead for the merge loop is standing. First **look**:
open the agent's screenshots and check them against what Developer asked; send
back anything off (clipped text, leftover F-keys, wrong state) instead of
merging. For whatever opens (a card, a menu, a dialog): does it open at the
caret or pointer, and do the shots show it closing? Read the diff where a shot
can't show the risk: deletes and moves of his files, native code. The report's
"not verified" lines are his to try by hand; keep them for step 5.

The merge loop, in `/Volumes/data/coding/fireflies-wt/integrate` (branch
`integrate`):

1. `git merge --no-edit feat/<name>`.
2. Conflicts:
   - justfile `bun test` lines: union (keep every line and its comment).
   - Two agents implementing the same thing differently (keys, commands,
     handlers): `git merge --abort` and send it back to one agent to merge
     `integrate` and reconcile into one implementation, keeping both test suites.
   - A branch that started before big merges: ask its agent to merge `integrate`.
3. Every test, muted (`HERDR_APP_NO_SOUND=1`), as one background command with
   a log: each `bun test` and `cargo test` line of the justfile
   (`grep -E '^    (bun|cargo) test' justfile`, strip comments, eval), with
   `PATH=/nix/store/mskva5g8bqz7mym9a70ablndnl1ag8jm-zig-0.16.0/bin:$PATH`.
   **Green** on all of them is the bar.
4. Ship: in the main checkout `git merge --ff-only integrate && git push origin main`;
   in `/private/etc/nix-darwin`: `nix flake update herdr-app` and
   `nix build --no-link --print-out-paths .#darwinConfigurations.$(scutil --get LocalHostName).system`.
5. Tell Developer: what changed in his words, what was verified, the list of
   what only his hands and eyes can check (a real pointer, native views, the
   reports' "not verified"), the core changes for his review, then
   `! sudo darwin-rebuild switch --flake /private/etc/nix-darwin` and
   restart Fireflies. He commits the nix-darwin changes himself; the build
   takes in whatever else is uncommitted there, so name those files.

Steps 1 to 3 run for each agent as it reports. Steps 4 and 5 run once, when the
last working agent is merged: one push, one build, one `darwin-rebuild` for him.

Local main moves at ship. A commit he needs in his checkout at once (this file,
.gitignore) is fast-forwarded there right away. What main has is no longer
reworded: resetting main is his to run
(`! git -C ~/Documents/personal/coding/fireflies reset --hard integrate`).

## Ecosystem

The mods are meant to work as one system, not as windows side by side.
Developer's words, when he asked for a Kubernetes mod (2026-11-13):

> It should work with e.g. the tools, opening new shell terminals in panes,
> port forward for databases or browser so it should be integrateable in the
> rest of the app. So i want to open a database connection to a portforward or
> even create it and view it you know it should feel like an ecosystem

So every brief for a mod, new or changed, asks two things and puts the
answers in both mods' briefs as a contract (the command's name and its JSON
arguments):

- **What it offers the others**: commands another mod can run to hand it
  work (`databases.connect:{…}`, `browser.open:…`, `editor.open`, a terminal
  in a pane), each working whether or not the caller is installed.
- **What it uses of the others**: where its own rows lead on (a port to a web
  pane or a database connection, a pod to a shell in a pane, a file to the
  editor, a failing run to its log), offered only when the other mod is there.

Optional mods live in their own repositories (`fireflies-k8s` is the first)
and may not be assumed by the shipped ones: a shipped mod finds an optional
one by its command, never by importing it.

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
- No function keys: Developer's keyboard makes them awkward.

## Upstream and core

- Rebase onto upstream in a dedicated agent's worktree; keep our core
  changes unless an upstream change fully replaces one. Main gets rewritten
  only with Developer's yes: tag the old head, `--force-with-lease`.
- Every change to `src/`, `vendor/` or `native/` is flagged for Developer's review
  with the three AGENTS.md questions; collect them in your reports.
- Fork decisions stay: no telemetry; feedback opens a GitHub issue on DwieDave/fireflies.

## Housekeeping

- **Naming**: everything committed (code, comments, tests, docs, commit
  messages) and every brief calls the person `Developer`, and writes a path
  under his home as `~/…`.
- **Cleanup**: a worktree goes when its branch is on main (or, after a
  rebase, on the tagged old main) and no live agent sits in it
  (`hc ls | jq '.terminals[] | select(.state=="live") | .cwd'`). Look at
  untracked files before `git worktree remove --force`.
- Developer's screen recordings arrive as scrawl captures: the agent opens
  `contact-sheet.png` and `frames/` before changing anything; pass the
  capture path on unchanged.
- `ls` is aliased to eza and can hang in big git trees; use `/bin/ls`.
- Never touch Developer's running app or core; demo or inspect his session only
  through `herdr-app do` / `hc` commands he asked for.
