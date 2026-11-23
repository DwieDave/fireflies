// What the window keeps between openings (place.ts STATE, a pane's
// localStorage, lastview.ts per space): its folder, its tab, and each tab's
// selection, filter and sizes. Schemas, so a record another version wrote
// that isn't in this shape is left aside (the window opens as new) instead of
// read as if it were. Every field may be missing: an older record still reads.

import { Schema } from "effect";
import { PrFilterSchema } from "./model.ts";

/** A field that may be left out. */
const opt = <S extends Schema.Top>(schema: S) => Schema.optionalKey(schema);

/** A dragged splitter's size (layout px). */
const Size = Schema.Finite;

/** The Pull requests tab: the filter, the PR, the dragged sizes. */
export const PrsKeptSchema = Schema.Struct({
  filter: opt(PrFilterSchema), sel: opt(Schema.NullOr(Schema.Finite)),
  sizes: opt(Schema.Struct({ left: opt(Size), top: opt(Size), checks: opt(Size) })),
});

export type PrsKept = typeof PrsKeptSchema.Type;

/** The Actions tab: the branch filter, the run and job, the dragged sizes. */
export const ActionsKeptSchema = Schema.Struct({
  filter: opt(Schema.NullOr(Schema.Struct({ branch: Schema.String, label: Schema.String }))), sel: opt(Schema.NullOr(Schema.Finite)), jobSel: opt(Schema.NullOr(Schema.Finite)),
  sizes: opt(Schema.Struct({ runs: opt(Size), runsH: opt(Size), graph: opt(Size), steps: opt(Size) })),
});

export type ActionsKept = typeof ActionsKeptSchema.Type;

/** The Projects tab: the project, its view, the card, the filter, the detail shown. */
export const ProjectsKeptSchema = Schema.Struct({
  pick: opt(Schema.NullOr(Schema.String)), view: opt(Schema.NullOr(Schema.String)), sel: opt(Schema.NullOr(Schema.String)), filter: opt(Schema.String), detail: opt(Schema.Boolean),
});

export type ProjectsKept = typeof ProjectsKeptSchema.Type;

/** The window: its folder, its tab (window-chrome.ts TABS) and each tab's own. */
export const KeptSchema = Schema.Struct({
  folder: opt(Schema.NullOr(Schema.String)), tab: opt(Schema.Literals(["prs", "actions", "projects"])),
  prs: opt(PrsKeptSchema), actions: opt(ActionsKeptSchema), projects: opt(ProjectsKeptSchema),
});

export type Kept = typeof KeptSchema.Type;

/** Two records that say the same. */
export const sameKept = Schema.toEquivalence(KeptSchema);
