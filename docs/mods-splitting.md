# Splitting the mods' large files and long functions

Developer's words:

> Check for large files: 750lines + and develop common strategies to split
> them up also long functions are an anti pattern split them up too

This page is the bar, the ratchet that holds it, and the ways the shipped
mods split. It goes with [mods-typescript.md](mods-typescript.md): a split
keeps that bar (no `any`, no `as` without `// SAFETY:`, guards at the
boundary).

## The limits

- **A file stays under 750 lines**, every line counted (blank lines,
  comments), as `wc -l` counts them.
- **A function stays at 80 lines or fewer**, blank lines and comments not
  counted. Why 80: it is a function read whole in one editor pane at
  Developer's zoom, and it is where the shipped mods' long functions start
  doing two jobs: those over 80 today are mostly a `render`, a key handler,
  a parser or an `init` whose parts already carry names in comments.
  Counting only code keeps the readable-spacing lint's blank lines and a
  good doc comment from pushing a function over.

Both are oxlint rules (`eslint/max-lines`, `eslint/max-lines-per-function`)
in `oxlint.size.json`, run over every `.ts` file under `defaults/mods`
(the stock JavaScript and win98's art scripts left out, as in the main lint).

## The ratchet

`tests/mods_over_limits.txt` lists what is over today: a line with a path is
a file of 750 lines or more, a line with a path and a name is a function over 80
(`(anonymous)` for one without a name; a name twice is two functions).
`cargo test --locked --test mods_typescript mods_stay_under_the_size_limits`
runs oxlint with `oxlint.size.json` and fails when:

- something over a limit isn't listed (a new large file or long function, or
  one that left the list and came back), or
- a listed entry isn't over anymore (the list only shrinks: take it off).

The list says nothing about how much a listed file may grow; a file you add
lines to is a file you split first.

To see what's over, with lengths:

```sh
node_modules/.bin/oxlint -c oxlint.size.json defaults/mods/git
```

**Taking a file off the list**: split it (below), run the test, delete the
lines it names as no longer over, commit the split and the list's lines
together. One commit per file, behaviour unchanged: `tsc`, the lint, the
mod's bun tests and `cargo test --locked render_tests` green. Never add a line
to the list; a split that leaves a new file or function over is split further.

## What a split must do

- **Name what moved.** A new file is named for the one thing it holds
  (`staging.ts`, `branch-panel.ts`, `ex.ts`), and its top comment says what
  that is and who uses it. A new function is named for the part of the work
  it does (`headerRow`, `applyDelete`), not `renderPart2`.
- **Keep behaviour.** No fix, rename of a command, key or shared record,
  or new feature rides along; those go in their own commit.
- **Keep the tests' doors.** A method tests call keeps its name and
  signature on the view (it may forward to the new module). Tests that read a
  source's text (`form-keys.test.ts`, `nocturne-floatfocus.test.ts`) follow
  the code to its new file in the same commit. A test that evaluates a mod
  file with a `load()` that drops its imports and puts names in scope doesn't
  see the modules a split makes: import the mod for real instead,
  `importMod("<mod>/main.ts", { herdr, "gpui-kit": kit, … }, { "./viewer.ts":
  { default: class {} } })` (scripts/mod-source.ts: the mod's own modules as
  the app loads them, stand-ins for the app's, a module left out where the
  test doesn't want it), as file-tree.test.ts does.
- **Imports: types back, functions across.** A new module imports the view's
  type only (`import type { default as GitView } from "./main.ts"`), or an
  interface of what it needs (below). Modules of the split may call each
  other's functions, cycles included: function declarations are there before
  anything runs, as in git's `navigate.ts` and `staging.ts`. What a cycle
  can't hold is a value used while a module loads (a table built from
  another's export, a class extending one): that goes in a module the cycle
  doesn't reach (git's `state.ts`, `items.ts`).

What not to do:

- files named `utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`: a file is
  named for its job;
- a barrel (`index.ts` re-exporting everything): importers name the file
  that has the thing;
- moving lines without a name for what moved (`main2.ts`, a function
  `rest()`);
- a class split by mixins or `Object.assign(View.prototype, …)`: tsc can't
  follow them and the view's type stops saying what it has;
- shrinking by squeezing (several statements per line, dropped blank lines
  the spacing lint wants, deleted comments).

## Strategies

### A view class too big: state and logic out, panels out, keys as a table

A `View` that holds state, pure logic, every panel's render and the key
handler splits along those lines. The view keeps `init`, `render` (the
frame that places the panels), its fields, and the methods tests call.

**Pure logic** goes into a module of functions over a typed state:

```ts
// before: main.ts
class TreeView extends View {
  rows: Row[] = [];
  open = new Set<string>();

  visibleRows() { /* 60 lines over this.rows and this.open */ }
}

// after: rows.ts — "the tree's rows: which are shown, folded, filtered"
export interface TreeState { readonly rows: readonly Row[]; readonly open: ReadonlySet<string> }
export function visibleRows(s: TreeState): readonly Row[] { … }

// main.ts
visibleRows() { return visibleRows(this); }  // the view is a TreeState
```

**A panel or section** of the render becomes a function `(state, theme) =>
Element` in a file of its own, one per panel:

```ts
// before: main.ts render() draws the header, the list and the footer inline

// after: footer.ts — "the procs window's footer: the keys bar and the counts"
export interface FooterState { readonly count: number; readonly busy: boolean }
export function footer(s: FooterState, t: Theme): Element { … }

// main.ts render()
return div().child(header(this, t)).child(list(this, t, cx)).child(footer(this, t));
```

The panel takes the narrowest state that draws it (an interface, met by the
view structurally), and the handlers it needs (`onPick: (i: number, cx:
Context) => void`) rather than the whole view.

**A module that must call back into the view** gets an interface of what it
asks for, as github's `host.ts` does for the window's tabs (`Host`: `note`,
`spawn`, `openUrl`, …) and git's `PopupHost` for its popups. The module
imports that interface; the view meets it with no `implements` needed. This
keeps `this` narrow without mixins: the module can only touch what the
interface names, and a test can hand it a small stand-in.

### A long `render`: name the parts

```ts
// before
render(cx: Context) {
  const t = theme();
  // the title row
  …30 lines…
  // the rows
  …50 lines…
  // the hint bar
  …20 lines…
}

// after
render(cx: Context) {
  const t = theme();

  return div().child(this.titleRow(t)).child(this.rowList(t, cx)).child(this.hintBar(t));
}
```

The comments that marked the parts are the new functions' names. A part
reused by another panel, or one that needs no `this`, goes to a module
function (above); otherwise a private method next to `render` is fine.

### A long key handler or `switch`: a table of actions

```ts
// before
key(e: KeyEvent, cx: Context) {
  switch (e.key) {
    case "j": … 8 lines …
    case "k": … 8 lines …
    case "enter": … 20 lines …
    …
  }
}

// after: keys.ts holds the bindings, actions.ts one function per action
export const BINDINGS = [["j", "down"], ["k", "up"], ["enter", "open"]] as const satisfies readonly Row[];
export type Action = (typeof BINDINGS)[number][1];

export const ACTIONS = {
  down: (v) => v.step(1),
  up: (v) => v.step(-1),
  open: (v, cx) => openPicked(v, cx),
} satisfies { readonly [A in Action]: Handler };

// main.ts
key(e: KeyEvent, cx: Context) {
  const action = actionFor(e);

  if (!action) return false;

  ACTIONS[action](this, cx);

  return true;
}
```

git's `keys.ts` (`BINDINGS`, `Action`) and `actions.ts` (`ACTIONS`) are the
shipped example. The `?` overview (keyhelp) reads the same table, so the keys
listed and the keys handled can't drift. A handler's modes (search open,
a popup up) are checked first and hand off to their own table.

### A long parser: one function per record kind

```ts
// before: parse() walks the lines and handles every kind in one loop
// after
function parse(text: string): Patch {
  const p = emptyPatch();

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) fileHeader(p, line);
    else if (line.startsWith("@@")) hunkHeader(p, line);
    else hunkLine(p, line);
  }

  return p;
}
```

Each kind's function takes the parse state and the line; the loop says
which kind a line is, and nothing else. markdown's `blocks` (a block per
kind: fence, list, table, callout …) and diff's `parse` split this way.

### A long `init` or async setup: steps with names

`init` that reads props, builds nested views, registers watchers and starts
loads becomes a list of calls (`this.readProps(p)`, `this.mountEditor(cx)`,
`this.watch(cx)`), each a method of its own.

### A shared copy too big: split into shared copies that stay identical

A file copied into several mods (the table in mods-typescript.md) splits
into files that are copies too: every copy of `viewer.ts` imports the same
new `viewer-find.ts`, and that file is copied into the same mods, byte for
byte. In the same commit:

- the new file joins the copies' identity test (`preview-shared.test.ts`
  `SHARED`, `markdown.test.ts`, …),
- it joins the shared copies table in mods-typescript.md,
- `for m in …; do cp …; done` puts it in every mod that has the original.

Edit one copy, copy it over the others, run the identity test.

## Outside the ratchet

The stock JavaScript mods, `defaults/frame`, the Rust core (`src/`, much of
it upstream Herdr's: splitting `src/window.rs` would fight every rebase onto
upstream) and the bun tests in `scripts/` aren't held by these limits.
