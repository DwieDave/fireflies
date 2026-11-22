# Mods over SSH on the iOS app

Developer's words (2026-11-22):

> one concept i think we should let a firefly check is the mod communication
> via ssh, imagine the git or files mod how they communicate

On the phone a mod's code runs in the app (prototypes/ios-mvp proves the
engine, Effect and the kit run there), but its work happens on the machine:
git, files, the folder watch, the spaces and agents. This page counts what
the git and file-tree mods ask of their host, compares three ways to carry
that over SSH, and sketches the protocol. Read from the code on 2026-11-22;
latencies are reasoned from round trips, not measured.

## What the desktop already does

The desktop already runs these mods against a machine it reaches over SSH:
every call takes `on: <machine>`.

| host call | local | `on` a machine (src/mods.rs) |
|---|---|---|
| `exec(cmd, args, {cwd, on})` | spawn | `hc exec --json --on <m> --timeout … -- cmd args`, one per call (`run_remote_with_limit`), output base64 in JSON |
| `readTextFile(path, {on})` | read | `cat -- path` through that exec (`read_remote`), capped at `mod_files::LIMIT` |
| `writeTextFile` | write, stale check | local only |
| `watchFolder(root)` | FS events (`files::next_change`) | **none**: git (`reads.ts` `watch`) and file-tree (`tree.ts` `watchTree`) skip the watch when `on` is set and fall back to their timers |
| `findFiles` (fff) | index | none (file-tree's search falls back to listing folders) |
| spaces, panes, settings, agents, `nextCommand` | the app's own model | the app's own model (the window is local) |

So "the mod here, its machine there" exists today. The phone turns every
machine into an `on` machine, and the window model itself into a remote one.

## The two mods' host calls

Git is on the kit (`defaults/mods/git/fx.ts`: `Exec | Commands | Files |
Workspace | FolderWatch`, the Live layers call the `herdr` module);
file-tree is not converted and calls `herdr` directly.

| | git (kit services) | file-tree (`herdr` calls) |
|---|---|---|
| process | `Exec.run` → `herdr.exec` (git, gh, sh) | `exec` (sh scripts in `state.ts`, `file-ops.ts`; git in `tree.ts`; the edit tool in `opening.ts`) |
| files | `Files.read/write/list` (settings.json, worktree notes) | none directly (listing is an `sh` script) |
| watch (stream) | `FolderWatch.next(root)` → `watchFolder` | `watchFolder(root)` in a loop |
| search | — | `findFiles` (fff) |
| window model | `Workspace` (window, spaces, panes, terminals, settings, agents, focused) | `panes`, `spaces`, `focused`, `settings`, `terminals`, `appWindow`, `props` |
| commands (stream) | `Commands.run`, `Commands.next` (`nextCommand`) | `run`, `nextCommand` |
| shared keys | via `Shared` / `setShared` | `shared`, `setShared` (5 each) |

Counted by reading (`git/reads.ts`, `git/git.ts`, `file-tree/tree.ts`,
`file-tree/state.ts`):

| moment | git: execs (sequential waves) | file-tree: execs (waves) |
|---|---|---|
| open | `rev-parse --show-toplevel`; then 8 at once (status, branches, remotes, remote branches, tags, stash, worktrees, state); `log`; then 2 at once (unpushed, not on main); base branch probe 1–5: **≈ 13–17 in 4–5 waves** | folder listing (sh script); `rev-parse`, `status`, `ls-files --ignored`, `branch --show-current`: **5 in ≈ 3 waves** |
| typical action | stage a file: `git add` + full reload (≈ 12 in 3–4 waves); show a diff: 1 | unfold a folder: 1; rename/trash: 1 (`file-ops.ts`) + listing 1 |
| on a change | the watch fires → full reload (≈ 12) | the watch fires → listing + git (≈ 5) |
| streams | `watchFolder`, `nextCommand` | `watchFolder`, `nextCommand` |

Workspace reads and commands are cheap on the desktop (the app's memory);
on the phone they are the machine's window model, so they belong in a cache
the server keeps current, not in a request per render.

## Three transports

RTT assumed: home Wi-Fi to the machine 3–10 ms; cellular through WireGuard
40–100 ms. An SSH connection setup costs ≈ 4–6 RTT (TCP, key exchange,
auth, channel); an exec channel on an open connection ≈ 2 RTT (open +
request/result). Process time on the machine (git status ≈ 10–50 ms) adds
to every row.

| | a) one SSH exec per call | b) one channel to a mods server | c) mod runs on the machine, phone draws |
|---|---|---|---|
| how | in-app SSH (russh/libssh2), a session kept open, a new exec channel per call (`git …` or `hc exec --json`) | in-app SSH, one channel running `fireflies serve --stdio`; JSON lines both ways, ids, many requests in flight | a headless gpui-shell on the machine renders the mod; its element tree (or pixels) goes to the phone, input comes back |
| open git (4–5 waves) | ≈ 10 RTT: Wi-Fi 0.05–0.1 s, cellular 0.4–1 s | 4–5 RTT, or 1–2 with a server-side `batch`: Wi-Fi < 0.05 s, cellular 0.1–0.3 s | 1 RTT per frame; cellular every tap, scroll and key waits 40–100 ms |
| stage a file | ≈ 8 RTT; cellular ≈ 0.5 s | 2–4 RTT; cellular ≈ 0.1–0.3 s | 1 RTT + server render |
| watch (stream) | no stream: poll (`git status` every few s) | server watches (FS events), pushes `changed` | native on the machine |
| build on the machine | nothing (git, sh, `hc` are there) | `fireflies serve`: exec, files, watch, the window model, as messages (ours: the CLI, not herdr-core, which is upstream's) | a headless Fireflies + a tree/frame protocol: does not exist |
| build in the app | the `herdr` host module over exec channels | the `herdr` host module over the message channel | a remote-tree renderer; mods are not in the app at all |
| large diffs | whole output per call, base64 +33 % | streamed in chunks, zstd, capped; first screen first | the server already holds it |
| binary files | base64 | bytes frames | — |
| reconnect (Wi-Fi ↔ VPN switch) | each call retried; writes not safe to retry | one reconnect, resubscribe watches, replay by id (server keeps last results) | the whole view drops and redraws |
| auth | SSH key in the Keychain / Secure Enclave, host key pinned | same, one session | same |
| offline | nothing | nothing; the last cache shows | nothing |

**The kit makes it a swap, below the mods.** The kit's Live layers sit on the
`herdr` module (`services.ts`: `execService(herdr.exec)`, `filesService(…)`),
and file-tree calls the same functions directly. So the iOS app implements
the `herdr` host module (Rust, like src/mods.rs) over the transport, and
both the converted git mod and the unconverted file-tree run unchanged. What
conversion adds: one place per service for batching and caching
(an `ExecRemote` layer can coalesce a wave into one `batch`), and tests that
swap the layer. On the phone the machine is the mod's only machine, so `on`
is `null` and the watch code paths that are off for `on` machines today
come back on, fed by the server.

## Recommendation: b), with a) as the fallback

A `fireflies serve --stdio` subcommand of our CLI, started by the app as
one SSH exec channel and kept open; a) (`hc exec --json`) only where the
machine lacks a current Fireflies CLI. c) needs a remote-render protocol that
does not exist and puts a round trip under every touch: no.

### Messages (JSON lines; bytes base64 or a binary frame after the line)

"Today" says what already answers it on the machine without anything new:
**hc** (`fireflies core`/`hc`: `exec --json`, `file read/write/edit`, `ls`,
`read`; one process per call), **app** (`fireflies app ls`/`do`: the
window's model and commands, only while Fireflies runs on that machine),
or **new** (needs `fireflies serve`).

| request (phone → machine) | reply / push (machine → phone) | today |
|---|---|---|
| `{"id":7,"op":"exec","cmd":"git","args":["status","--porcelain=v2","-z"],"cwd":"~/src/x","timeout":30000,"stdin":null}` | `{"id":7,"code":0,"out":"…","err":"","ms":18}`; above 256 KB: `{"id":7,"chunk":"…"}`… then `{"id":7,"code":0,"end":true}` | hc `exec --json` (whole output, no chunks) |
| `{"id":8,"op":"batch","calls":[exec, exec, …]}` (one wave) | `{"id":8,"results":[…]}` in call order | new |
| `{"id":9,"op":"read","path":"…","max":1048576}` | `{"id":9,"text":"…"}`, `{"id":9,"bytes":"…"}` (binary), `{"id":9,"missing":true}` | hc `file read` (text) |
| `{"id":10,"op":"write","path":"…","text":"…","expected":"<sha256 or null>"}` | `{"id":10,"ok":true}` / `{"id":10,"error":"stale"}` (the desktop's stale check) | hc `file write` (no stale check: new for `expected`) |
| `{"id":11,"op":"list","dir":"…","limit":500}` | `{"id":11,"entries":[["d","src"],["f","README.md"]],"cut":false}` | hc `exec` of an `sh` script (file-tree's) |
| `{"id":12,"op":"watch","root":"…"}` / `{"op":"unwatch","root":"…"}` | `{"watch":"…","changed":["a.rs","b/c.ts"]}` pushed, coalesced 100 ms | new |
| `{"id":13,"op":"model"}` (once, then pushed) | `{"model":{"spaces":…,"panes":…,"agents":…,"settings":…}}` then `{"model.patch":…}` on change | app `ls` (a snapshot per call; no pushes): new for the stream |
| `{"id":14,"op":"command","name":"pane.split","args":{…}}` | `{"id":14,"ok":true}` | app `do` |
| `{"id":15,"op":"find","root":"…","query":"…","limit":50}` | `{"id":15,"hits":[…]}` (fff on the machine) | new |
| `{"id":16,"op":"shared","key":"github.create","value":…}` / `{"op":"shared","key":…}` | `{"id":16,"value":…}`; `{"shared":"…","value":…}` pushed to watchers | new (mod state lives in the app's memory) |
| `{"op":"hello","v":1,"client":"fireflies-ios/0.1"}` | `{"hello":1,"home":"/Users/…","os":"macos","features":["batch","watch","find"]}` | new |

### New fireflies commands

The machine side is our CLI (src/cli.rs routes `core` to herdr-core and
window words to the app; a new word is a new route), so the phone is not
bound to what hc offers. What it adds:

| command | carries | why hc (and `app`) alone are not enough |
|---|---|---|
| `fireflies serve --stdio` | the whole protocol above over one SSH channel: ids, many requests in flight, `batch`, chunked output, reconnect replay (last 64 results) | hc starts a process and an SSH exec per call (≈ 2 RTT each, ≈ 10 RTT to open git on cellular); no batching, no request ids to ask "did that write land" |
| `serve` op `watch` (or `fireflies watch <root> --json`, lines) | FS-event change lists, coalesced, per root, until unwatched | hc has no watch; today the mods turn theirs off for remote machines and poll |
| `serve` op `model` (or `fireflies app watch --json`) | the window model (spaces, layout, panes, terminals, agents, settings) once, then patches | `app ls` is a snapshot per call; the phone would poll it per render |
| `serve` op `shared` | the mods' shared keys (`setShared`/`shared`), read and pushed | mod state lives in the running app's memory; hc never sees it |
| `serve` op `find` | fff search on the machine's index | no search command; the phone can't index a remote disk |
| `serve` op `write` with `expected` | the desktop's stale check (`mod_files::write_text`) | `file write` overwrites whatever is there |
| `fireflies serve --headless` (later) | `model`, `shared` and `command` when no window runs on the machine | `app` needs Fireflies open there; a server or a VPS has only herdr-core |

### Batching and caching

| what | where |
|---|---|
| a wave of reads (git's `Effect.all` of 8) | one `batch`, sent by an `ExecRemote` layer that collects calls started in the same tick |
| the window model, settings, agents | phone cache, kept current by `model.patch` pushes; renders never ask |
| a repo's last status / branches / log | phone cache per root, shown at once on open, replaced by the reply (open feels instant even on cellular) |
| folder listings | phone cache per folder until a `changed` under it |
| file text, diffs | not cached past the view; capped and streamed |
| writes, commits, `command` | never replayed after a reconnect without the reply: the request id answers "did it land" from the server's last 64 results |
| `nextCommand` | stays on the phone (the phone's keys and other mods) |

### What breaks, and the answer

| risk | answer |
|---|---|
| Wi-Fi ↔ cellular handoff kills the TCP connection | reconnect, `hello`, resubscribe watches, retry idempotent ids |
| a 10 MB diff on cellular | chunks + zstd + the cap the desktop uses; the view shows the first screen |
| an old CLI on the machine | `hello.features`; fall back to a) |
| the server dies | the SSH channel closes; the app restarts it |
| more than one phone | each its own channel and watches; writes keep the stale check |

## Terminals: mosh, not this channel

Terminal panes go over mosh (docs/ios-app.md row k: screen state over UDP,
roaming, predicted echo); this channel carries the mods, the model and
scrollback (`fireflies read`), and stays on SSH.

## Verdict

b), as a new `fireflies serve`, holds up: git opens in 1–2 RTT with batching (≈ 0.1–0.3 s on cellular
through WireGuard, reasoned) and gets its watch back; file-tree in 2–3. The
swap is the `herdr` host module on iOS, under the kit, so converted and
unconverted mods both run as they are. To build: `fireflies serve` on
the machine (hc's `exec`, `file` and `app ls`/`do` already carry the
reads, writes and commands without it, a) only), the host module and an `ExecRemote` batching layer in the app.
Not checked: how herdr-core holds its own SSH links (it is not built here),
real RTTs and git timings on Developer's machines.
