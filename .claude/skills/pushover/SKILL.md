---
name: pushover
description: Push a notification to Developer's phone through Pushover. Use when Developer asks to be notified, pinged or pushed about something ("notify me when the agents are done"), or to test Pushover.
---

# Pushover

Send with the script beside this file. It runs from the main checkout and from any worktree:

```sh
.claude/skills/pushover/push.sh -t "fileops merged" "Tests green on integrate. Ready for darwin-rebuild switch."
```

A notification is sent when the script exits 0 and prints `sent (request …)`. Any other exit: tell Developer in the conversation what it printed, since the push he is waiting for did not arrive.

| Exit | Means | Do |
|---|---|---|
| 0 | sent | nothing more |
| 2 | bad option, or text over a limit | fix the call, send again |
| 3 | keys missing or malformed | tell Developer; the keys are his to add (see Keys) |
| 4 | Pushover refused it | read the reason it prints; the same call fails again |
| 5 | no answer after one retry | tell Developer; send again later if it still matters |

## What to write

Developer reads it on a lock screen, away from the conversation. The title names the thing ("polish: jar concepts", "merge blocked"), in about 40 characters. The message says what happened and what he has to do, in words that make sense without the terminal: at most 1024 characters, two or three lines read best. A path or link he should open goes in `-u`.

One notification per event he asked about. Batch things that finish together into one message.

The text passes through Pushover's servers: keys, tokens and file contents stay out of it.

## Options

- `-p 0` is the default: sound and alert as his phone is set.
- `-p -1` delivers quietly, for things he wants on record without a sound.
- `-p 1` bypasses his quiet hours. Use it when he is blocking on the news or asked for it to be loud.
- `-p 2` repeats until he acknowledges it (`--retry`, `--expire`). Only when he asks for an emergency alert in those words.
- `-u URL --url-title TEXT`, `-s SOUND`, `-d DEVICE`, `--mono` for output that needs columns, `--ttl SECONDS` for news that goes stale. `push.sh --help` lists them all.
- A message from a file or a pipe: `… | push.sh -t "title" -`.

## Keys

`PUSHOVER_TOKEN` (the application's API token) and `PUSHOVER_USER` (Developer's user key) live in `.env` at the root of the main checkout, which git ignores. Worktrees read the main checkout's file. `push.sh --check` validates the keys with Pushover and sends nothing.
