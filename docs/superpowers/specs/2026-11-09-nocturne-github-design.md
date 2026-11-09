# nocturne-github: design

## Intent

A GitHub view for the Nocturne layout. It lets you check a repo's pull
requests and Actions without leaving Fireflies: read a PR with its
description and comments, open its diff in the diff mod you already use,
see which checks gate it, and watch Actions runs move job by job and step
by step. It lives in a floating window that Cmd-Shift-G toggles. It looks
like the rest of Nocturne (1-bit dither, moonfly colors, small animations)
and moves like lazygit (hjkl).

## Decided with the user

- **Auth:** the `gh` CLI through `exec` (its keyring login). The mod stores
  no token. A space on another machine runs `gh` there (`on: space.machine`).
- **Live status:** adaptive polling with ETags. While anything shown is
  queued or in progress and the window is open, it polls every ~3 s; when
  everything is idle, every ~60 s; when the window is closed, not at all.
  Requests send `If-None-Match`, and 304 replies don't count against the
  rate limit.
- **Scope:** the repo of the active space's folder, found the same way the
  diff mod finds it.
- **PR diff:** nocturne-diff gets a third scope, `pr`, filled from
  `gh pr diff <n>`. There is no checkout, and the file list, reviewed marks
  and keys stay the same.
- **Gated Actions:** the checks on the PR's head commit
  (`statusCheckRollup`), with required ones marked. Picking one jumps to
  that run in the Actions tab.
- **Write actions:** re-run failed jobs, re-run all, cancel a run, comment
  on a PR, and `gh pr checkout` into the space's folder. Each one confirms
  before running.
- **Float:** an overlay window (`openOverlay kind: "window"`,
  `key: "nocturne-github"`) about 85% of the app window, draggable, that
  remembers where it was. Cmd-Shift-G toggles it, and Esc closes it at the
  top level.
- **Key:** `cmd-shift-g` → `nocturne.github` in `keys.macos.json`'s
  `layout:nocturne` section. It is free in the shipped and the user's
  keymaps, and that section is unreleased, so no shipped-keymap copy is
  needed.

## Shape

```
nocturne (sky role)     handles nocturne.github → opens/closes the window
                        "+ new" menu / palette entry "GitHub" (g)
nocturne-github/
  main.js               the window: header, tabs, routing keys, polling
  gh.js                 gh wrapper: exec, JSON, ETag cache, rate errors
  prs.js                Pull requests tab: list + detail (markdown, checks)
  actions.js            Actions tab: runs list, run graph, job/step logs
  graph.js, kit.js      copied from nocturne-agents (mods can't import each
                        other), trimmed to what's needed
nocturne-diff           + scope "pr" (props { folder, on, pr })
```

### Header and tabs

There is a dithered title bar with the repo name and an `owner/repo ·
branch` eyebrow. Below it are two tabs, **Pull requests** and **Actions**,
switched with `1`/`2` or `[`/`]`. A bottom bar shows the keys that matter
right now, as in the diff mod, and `?` lists every key.

### Pull requests

- **List:** open PRs, newest first. Each row has a status pip (draft, open,
  checks pass/fail/pending, review state), `#n`, the title, the author, and
  `+a −d`. A filter cycles through all, mine and review-requested (`f`).
- **Detail (enter / l):** the title, branch → base, labels and review
  state. The body is rendered markdown (`TextView.markdown`). Then comes
  the **checks** strip: one row per check, with its pip, its name, a
  "required" mark and its duration; enter on a row jumps to that run in
  Actions. Last are the **comments**: issue comments and review comments
  in time order, each with its author, age and rendered markdown body.
  Review comments show their file:line.
- **Keys:** j/k move, h/esc go back, `d` opens the diff (it swaps the window
  to nocturne-diff with the PR scope, and esc in the diff comes back), `c`
  writes a comment (an input at the bottom, cmd-enter posts it), `C`
  checks the PR out (with a confirm step), `o` opens it in the browser,
  `r` refreshes.

### Actions

- **Runs list:** recent workflow runs for the repo. Each row has the
  workflow name, the event, the branch, `#n`, the age and the duration,
  with a color-coded pip that breathes while running. Filters are "this
  PR's" (when you come from a PR) and all.
- **Run view (enter / l):** the graph. Run → jobs, laid out by `needs:`
  (the workflow's job dependencies, read from the jobs API ordering and
  the workflow file when it's available; otherwise one column). It uses the
  constellation look of nocturne-agents: dithered edges, a pulse running
  into in-progress jobs, breathing nodes, and colors from TONE
  (queued=dim, in_progress=working/blue, success=done/green,
  failure=blocked/red, cancelled/skipped=grey).
- **Job view (enter / l on a job):** the steps as a vertical timeline. Each
  step has a pip, its name and its duration; the running step pulses and
  its timer ticks every second on the client side. Enter on a finished
  step shows its log section (from the job log, split at the `##[group]`
  markers), with `##[error]` lines in red and wrapped in a virtual list. A
  running job's log isn't available from the API until the job finishes:
  the step says "log arrives when the job finishes" and fills in on the
  next poll after completion.
- **Keys:** hjkl move through graph and list, `l`/enter go in, `h`/esc go
  out, `R` re-runs failed jobs, `A` re-runs all, `X` cancels (each with a
  confirm step), `o` opens in the browser, `w` jumps to the next running
  job, `G`/`gg` go to the newest or oldest log line.

### Data (gh.js)

- `gh api` with `-i` to read the ETag and status, a cache per URL in
  memory with the ETag and body, and `If-None-Match` on repeat requests.
- PR list and detail: `gh pr list/view --json ...`. Comments:
  `gh api repos/{o}/{r}/issues/{n}/comments` and `/pulls/{n}/comments`.
- Runs: `/actions/runs?per_page=30`; jobs: `/actions/runs/{id}/jobs`;
  log: `gh run view --job <id> --log`, fetched once per finished job and
  cached.
- Errors (no gh, not logged in, not a GitHub repo, rate limited) show as a
  calm note in the window, not as toasts.

### Sharing graph code

Mods can't import each other's files, so `graph.js`'s layout (`place`,
`edges`, the dither `seg`) and `kit.js` are copied into nocturne-github, as
nocturne-diff already does with `dither`. A note at the top of each says
where it was copied from.

## Non-goals

- Issues, notifications, PRs across repos, merging, approving reviews.
- Streaming the logs of a running job (the API doesn't offer it).
- A Linux keybinding (Linux has no `layout:nocturne` cmd-g counterpart
  today; the command is still in the palette and the + menu).

## Docs and tests

`defaults/AGENTS.md` gets the new mod and the `nocturne.github` command,
in the same commit as the change. `cargo test` checks that the commands
are named there. The code that doesn't touch the UI (parsing the PR JSON,
splitting the log into steps, the job graph from `needs`, the poll
interval) is plain JS functions, which I check with `node`.

## Left to the builder

The exact pixel sizes, the wording of empty states, the 3 s / 60 s
timings, and how many runs to list.
