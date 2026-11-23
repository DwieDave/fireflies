# Task: Effect conversion, wave 1: the editor, markdown and finder mods

Area: defaults/mods/{editor,markdown,finder} and their tests in scripts/. Nothing else: the
shared libraries (defaults/lib/@fireflies/*) are done and owned by others.

Developer's words, on the refactor:

> The last item is an Effect v4 Refactor of all Typescript mods. But this needs developing common tools to e.g. run effects, common abstracted context services to make a clean codebase. Everything that needs decoding/parsing should run through Schema. Everything HTTP should use Effects client with sane retry rules etc. The goal is not only a mechanical refactor but improving the code, finding weaknesses and improving on them using a more typesafe solution that allows us to have common patterns too.

on the lint findings:

> yes youre expected to fix all findings too

and on the look, when the themes firefly had made the mods follow the theme:

> Basically the herdr default layout! but all panes and dialogs and uis should support it

> (the non dithered non nocturne theme )

He then picked "concept A" (cards) for that plain look, and asked that the
conversion fireflies apply it while they rewrite their mods.

Two documents are your brief; read both whole before any edit:

1. docs/effect-mods.md: how Effect reaches a mod, the kit (@fireflies/kit)
   and its patterns with before/after code from the usage pilot, the lint,
   your mods' rows in "Each mod: what it decodes, runs, fetches and times",
   "Wave 0a, done" and "Wave 0b, done" (what the libraries give you and the
   weaknesses they left for wave 1), and 'What "done" means for a converted
   mod'. Invoke the `effect` skill. Effect v4's sources are at
   /Volumes/data/coding/fireflies-wt/refs/effect (read-only): check an API
   there before writing it from memory. Models: defaults/mods/usage (the
   pilot), defaults/lib/@fireflies/viewer and /markdown (converted in wave 0).
2. docs/plain-look.md: the look library (@fireflies/look), the scripts mod as
   its reference, the 7-step how-to, "Opened outside nocturne: the folder",
   "Shots", and your mods' checklist under "The checklist, per mod" (file and
   function -> what it draws -> which primitive).

So for each of your mods: (a) convert it to the kit: every finding of the
full Effect lint pass fixed (no per-file or per-line disables), its mod's
guard.ts gone (Schema), its exec/files/shared/commands through the services
with test layers instead of module mocks, its timers and reads as fx runs
that end with the view, tagged errors instead of swallowed ones, HTTP through
the kit's client where it has any; (b) apply its look checklist, so it draws
nocturne's chrome exactly as today in nocturne and concept A in a plain
layout; (c) write down every weakness you found and how the new code closes
it. Not a mechanical rewrite, and not a redesign: behavior, keys, commands and
the nocturne look stay as they are.

From docs/plain-look.md's folder section: the finder says 'No folder' when opened outside nocturne without one: give it scripts' rule (here.ts).

Five other wave 1 fireflies convert the other mods at the same time (nocturne;
github; databases; editor+markdown+finder; preview+file-tree+agent-graph+
notifications+browser; git): each owns only its mods' folders and tests.
If the kit or a library lacks something or has a bug, do not patch it your
own way: send it to the orchestrator in one line
(`~/.local/bin/hc send t7y "kit: <what, where>"`); the kit's owner fixes it
and I tell you when it is in. A helper two mods would want goes the same way.

Size: this is a large job. Work mod by mod, file by file; commit as you go
(one commit per mod or coherent part), keep the bar green at each commit, and
if your context runs low, write where you are into your report file before
you continue. Report finished mods in batches so they merge while you go on.

Rust: you edit none. Your target/ is seeded and fresh: export the zig PATH and
MACOSX_DEPLOYMENT_TARGET=14.0 as the rules say, and cargo rebuilds only the
top crate (defaults are embedded by build.rs). Scratch-app shots: keep each
run short, one command that starts, shoots and stops; the window shows on
Developer's screen.

Done means, per mod: the plan's "done" (full Effect pass green on its files,
both lint passes, tsc, size limits, every bun line, cargo test --locked); the
look checklist applied, with the shots docs/plain-look.md asks for (nocturne
unchanged against integrate on the same binary; main layout, graphite, as a
window and as a pane); its weaknesses in your report; docs
(defaults/AGENTS.md, src/SKILL.md) current where behavior is described.
