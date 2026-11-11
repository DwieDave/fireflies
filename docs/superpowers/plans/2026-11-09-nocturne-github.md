# nocturne-github Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floating GitHub window for Nocturne: PRs (markdown, comments, checks, diff) and live Actions (job graph, steps, logs).

**Architecture:** A new shipped mod `defaults/mods/nocturne-github` opened as an overlay window by the nocturne sky role on `nocturne.github`. All GitHub access goes through `gh` via `exec`. Pure parsing/layout logic lives in `model.js` (no herdr imports) so bun can test it; `gh.js` wraps exec with an ETag cache; `main.js` is the view.

**Tech Stack:** gpui-kit / gpui-base JS mods, `gh` CLI, bun:test.

**Spec:** `docs/superpowers/specs/2026-11-09-nocturne-github-design.md`

## Global Constraints

- Stay in `~/code/fireflies-github`; never touch `~/code/fireflies`, never stop/restart the running app.
- Key: `"cmd-shift-g": "nocturne.github"` in `defaults/keys.macos.json` `layout:nocturne` (unreleased section: no shipped copy needed).
- Poll: 3000 ms while anything shown is queued/in_progress, 60000 ms otherwise; nothing while closed. Requests carry `If-None-Match`.
- Overlay: `openOverlay({ mod: "nocturne-github", kind: "window", key: "nocturne-github", frame: "none", width: 0.85, height: 0.85 })`.
- Commit messages: lowercase conventional, single line, no co-author trailer (user's CLAUDE.md overrides the attribution reminder).
- `defaults/AGENTS.md` documents the mod and `nocturne.github` in the same commit that adds them.

## Review Focus

- No `gh`, logged out, or folder isn't a GitHub repo → a calm note in the window, no crash loop.
- Rate limit / network failure mid-poll → keep last data, show a dim "offline · retrying" mark.
- A run with jobs still queued (no `started_at`) and steps with `null` times → graph and step durations render "—".
- Log lines for skipped steps / "UNKNOWN STEP" output from gh → steps still get their own lines by timestamp + `##[group]` markers.
- Window closed while a poll is in flight → no writes after close (generation check).

---

### Task 1: model.js (pure logic) + tests

**Files:** Create `defaults/mods/nocturne-github/model.js`; Test `scripts/nocturne-github.test.ts`; Modify `justfile` (add the test file to `test`).

**Produces:**
- `tone(status, conclusion) -> "queued"|"working"|"done"|"failed"|"stopped"|"skipped"`
- `pollEvery(items) -> 3000|60000` (items: `{status}`; any `queued|in_progress|waiting|pending|requested` → 3000)
- `parseHeaders(text) -> { status:number, etag:string|null, body:string }` (from `gh api -i` output)
- `needsFromWorkflow(yaml) -> Map<jobKey, { name:string|null, needs:string[] }>` (top-level `jobs:` only; `needs: x`, `needs: [a, b]`, block list)
- `jobColumns(jobs, needsMap) -> jobs[][]` (match api job name to key by `name` or key, matrix suffix ` (…)` stripped; depth = 1 + max depth of needs; no map → waves by start time: a job starting after every job of the previous wave completed starts a new wave)
- `splitLog(text, steps) -> Map<stepNumber, string[]>` (strip `job\tstep\t` prefixes, BOM, ANSI; timestamp per line; assign by time window, advancing on `##[group]Run ` when a later step's window also contains the line; skipped steps get none)
- `duration(start, end, now) -> "12s"|"3m 04s"|"1h 02m"|"—"`
- `checkRows(rollup) -> [{ name, tone, required:false, runId:number|null, url }]` (rollup from `gh pr view --json statusCheckRollup`; runId parsed from `/actions/runs/<id>/`)

- [ ] Write tests for each with fixtures from the real herdr-app payloads (jobs of run 42652702731, the ci.yml `needs` shapes, a log with UNKNOWN STEP prefixes). Run `bun test scripts/nocturne-github.test.ts` → FAIL.
- [ ] Implement `model.js`. Run → PASS.
- [ ] Commit `feat(nocturne-github): model for runs, jobs, logs and checks`.

### Task 2: gh.js, the window shell and the command

**Files:** Create `defaults/mods/nocturne-github/{mod.json,gh.js,kit.js,main.js}`; Modify `defaults/mods/nocturne/sky.js` (command `github`), `defaults/mods/nocturne/panels.js` (+ new entry "GitHub", key `g`), `defaults/mods/nocturne/palette.js` (bind `github: "nocturne.github"`), `defaults/keys.macos.json`, `defaults/AGENTS.md`.

**Produces:**
- `gh.js`: `repoOf(folder, on) -> {owner, name, root, branch} | null`; `api(path, {on, cwd, fresh}) -> {data, changed:boolean}` (ETag cache in a module Map; 304 → cached, `changed:false`); `ghJson(args, opts)`; `ghRun(args, opts) -> {ok, out, err}`.
- `toggleGithub()` in sky: shared `"nocturne-github.window"` holds the overlay id; present → `closeOverlay`, else open. The window clears it in `close()`.
- `main.js`: header (dithered title `GITHUB`, repo · branch, tabs `1 Pull requests` `2 Actions`, live dot), bottom hints bar, `?` help, Esc at top level closes. Focuses itself on init.

- [ ] Build, `just test` passes (docs test names `nocturne.github`), commit `feat(nocturne-github): a floating GitHub window on cmd-shift-g`.

### Task 3: Pull requests tab

**Files:** Create `defaults/mods/nocturne-github/prs.js`; Modify `main.js`.

- List from `gh pr list --json number,title,author,isDraft,headRefName,additions,deletions,reviewDecision,statusCheckRollup,updatedAt --limit 50`; filter `f` cycles all / mine (`--author @me`) / review (`--search review-requested:@me`).
- Detail: `gh pr view N --json number,title,body,author,baseRefName,headRefName,labels,reviewDecision,statusCheckRollup,url,createdAt,comments,reviews,headRefOid` + `api repos/{o}/{r}/pulls/N/comments` for review comments. Body & comments via `TextView.markdown`. Checks strip from `checkRows`; enter on a check → Actions tab, that run.
- Keys: j/k, l/enter, h/esc, d diff, c comment (InputState, cmd-enter posts with `gh pr comment N --body-file -`… via `--body`), C checkout (confirm), o browser (`gh pr view N --web`), r refresh.

- [ ] Build, try in the sandboxed window, commit `feat(nocturne-github): pull requests with markdown, comments and checks`.

### Task 4: PR scope in nocturne-diff

**Files:** Modify `defaults/mods/nocturne-diff/{git.js,main.js}`.

- `prChanges(r, pr) -> {files, since:"#N"}` from `gh pr diff N` (cwd root) through `parse`.
- props `{ folder, on, pr, back }`: starts in scope `pr`; scope chips gain `#N`; when `back` is set (opened in the GitHub window), Esc at top level reopens `nocturne-github` in the same window key; focuses on init when `props().overlay`.
- [ ] Test `prChanges` parse path via existing `parse` on a `gh pr diff` fixture (bun). Commit `feat(nocturne-diff): a pr scope from gh pr diff`.

### Task 5: Actions tab: runs, graph, steps, logs, live

**Files:** Create `defaults/mods/nocturne-github/{actions.js,graph.js}`; Modify `main.js`.

- Runs: `api repos/{o}/{r}/actions/runs?per_page=30` (+ `&branch=<head>` when filtered to a PR).
- Run view: `api .../runs/{id}/jobs?per_page=100`, workflow file via `api repos/{o}/{r}/contents/{path}?ref={sha}` (base64) → `needsFromWorkflow` → `jobColumns`; graph (copied dither/seg/pulse look from nocturne-agents) with run node → job columns.
- Job view: steps timeline, running step pulses, timers tick via `cx.timer.every(1000)` only while something runs; enter on a finished step → its lines from `splitLog(gh run view --job ID --log)`, cached per job once completed.
- Actions: R `gh run rerun ID --failed`, A `gh run rerun ID`, X `gh run cancel ID`, each through a confirm row; o `gh run view ID --web`.
- Poll loop: `pollEvery` of what's shown; generation counter; stops in `close()`.
- [ ] Build, try, commit `feat(nocturne-github): live actions with job graph, steps and logs`.

### Task 6: Docs pass and review

- [ ] `defaults/AGENTS.md` mod list/keys final; `just test` green; whole-branch review; commit.
