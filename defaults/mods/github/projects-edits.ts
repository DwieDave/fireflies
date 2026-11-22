// The Projects tab's edits: laid over the board at once (board-edits.ts),
// sent to GitHub in order as a run on the window, taken back when it refuses;
// a card dropped, a draft added, a card archived.

import { Array as Arr, Clock, Effect, Option, String as Str } from "effect";
import type { Context } from "gpui-kit";
import type { GhServices, GitHubFailure, Repo } from "./gh.ts";
import { GhError, graphql, mutate } from "./gh.ts";
import { noteOf } from "./kit.ts";
import type { Field, FieldValue, Item } from "./board.ts";
import type { Op } from "./board-edits.ts";
import { scopeProblem } from "./board.ts";
import { grid, find, drop } from "./board-layout.ts";
import { valueFor, setFieldMutation, positionMutation, archiveMutation, addDraftMutation, AddedDraftSchema } from "./board-edits.ts";
import { valueText, label } from "./board-cards.ts";
import type { default as Projects, Pending } from "./projects.ts";

/** After an edit GitHub took, the board is read again this much later. */
const SETTLE = 2500;

/** What sends an edit: its GraphQL to GitHub, for the repo shown. */
export type Send = (repo: Repo) => Effect.Effect<void, GitHubFailure, GhServices>;

/** The note for an edit GitHub refused (`message`, its words): a missing scope says how to add it. */
export function refused(proj: Projects, message: string): void {
  const s = scopeProblem(message, true);

  proj.app.note = noteOf(s === null ? `GitHub refused it: ${message}` : s.text, "failed", proj.app.now());
  proj.keepSel();
}

/** Lays `op` over the board and sends it (`send`, with the repo). Returns its pending entry (null: nothing laid over). */
export function edit(proj: Projects, op: Op | null, send: Send, ok: string | null, cx: Context): Pending | null {
  const entry: Pending | null = op === null ? null : { id: ++proj.seq, op, state: "sending", at: proj.app.now() };

  if (entry !== null) proj.pending.push(entry);

  sendEdits(proj, entry === null ? [] : [entry], send, ok, cx);

  return entry;
}

export function editBatch(proj: Projects, ops: readonly Op[], send: Send, ok: string, cx: Context): void {
  const entries = Arr.map(ops, (op): Pending => ({ id: ++proj.seq, op, state: "sending", at: proj.app.now() }));

  proj.pending.push(...entries);
  sendEdits(proj, entries, send, ok, cx);
}

/** Edits GitHub took: they wait for a read (soon: SETTLE). */
const took = (proj: Projects, entries: readonly Pending[], ok: string | null) => Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;

  for (const e of entries) {
    e.state = "done";
    e.doneAt = now;
  }

  proj.app.note = ok === null || ok === "" ? null : noteOf(ok, "done", now);
  proj.settleAt = now + SETTLE;
  proj.app.next = Math.min(proj.app.next, proj.settleAt);
});

/** Sends edits laid over the board: done, they wait for a read; refused, they go (the rollback). */
export function sendEdits(proj: Projects, entries: readonly Pending[], send: Send, ok: string | null, _cx: Context): void {
  const repo = proj.app.repo;

  proj.app.note = noteOf("…", "working", proj.app.now());
  proj.app.run(Effect.matchEffect(repo === null ? GhError.make({ message: "No repo." }) : send(repo), {
    onSuccess: () => took(proj, entries, ok),
    onFailure: (e) => Effect.sync(() => {
      proj.pending = Arr.filter(proj.pending, (p) => !entries.includes(p)); // the rollback
      refused(proj, e.message);
    }),
  }));
}

/** An edit that is one mutation. */
export function gql(_proj: Projects, query: string): Send {
  return (repo) => mutate(repo, query);
}

export function setField(proj: Projects, item: Item, field: Field, choice: string | null, cx: Context): void {
  const b = proj.board();

  if (b === null) return;

  const value = valueFor(field, choice);

  if (choice !== null && choice !== "" && value === null) {
    proj.app.note = noteOf(`That isn't a ${field.type} for ${field.name}.`, "failed", proj.app.now());

    return;
  }

  edit(proj, { kind: "field", item: item.id, field: field.id, value }, gql(proj, setFieldMutation(b.project.id, item.id, field, value)),
    `${field.name}: ${value === null ? "cleared" : valueText(field, value)}`, cx);
}

/** Drops the carried card where it is. */
export function dropCard(proj: Projects, cx: Context): void {
  const lay = proj.lay(), c = proj.carrying, b = proj.board();

  proj.carrying = null;

  if (lay === null || c === null || b === null) return;

  const plan = drop(grid(lay), c, lay.columns, { sorted: lay.sorted });

  if (plan === null) return;

  const pid = b.project.id;
  const item = Option.getOrUndefined(Arr.findFirst(b.items, (i) => i.id === plan.id));
  const col = lay.columns[c.col];
  const field = lay.field;
  const ops: Op[] = [];
  // Both edits are one move: shown together, rolled back together.
  const sends: string[] = [];

  if (plan.column !== undefined && field !== null) {
    const value = plan.column === "" ? null : valueFor(field, plan.column);

    ops.push({ kind: "field", item: plan.id, field: field.id, value });
    sends.push(setFieldMutation(pid, plan.id, field, value));
  }

  if (plan.afterId !== undefined) {
    ops.push({ kind: "position", item: plan.id, afterId: plan.afterId });
    sends.push(positionMutation(pid, plan.id, plan.afterId));
  }

  proj.sel = plan.id;
  proj.selCol = c.col;
  editBatch(proj, ops, (repo) => Effect.forEach(sends, (q) => mutate(repo, q), { concurrency: 1, discard: true }), plan.column !== undefined ? `Moved ${label(item)} to ${col?.name ?? ""}` : `Moved ${label(item)}`, cx);
}

export function addDraft(proj: Projects, cx: Context): void {
  const title = Str.trim(proj.draft.value()), lay = proj.lay(), b = proj.board();

  proj.typing = null;
  proj.draft.set_value("");
  proj.app.focusSelf();

  if (title === "" || lay === null || b === null) return;

  const col = lay.columns[proj.at(lay).col];
  const temp = `temp-${++proj.seq}`;
  const field = lay.field;
  const key = col?.key ?? "";
  const start = key !== "" && field !== null ? valueFor(field, key) : null;
  const values = new Map<string, FieldValue>(field !== null && start !== null ? [[field.id, start]] : []);

  const item: Item = {
    id: temp, db: null, type: "DRAFT_ISSUE", archived: false, values,
    content: { kind: "draft", id: null, number: null, title, state: "DRAFT", isDraft: false, url: null, repo: null, assignees: [], labels: [], milestone: null },
  };

  proj.sel = temp;

  let entry: Pending | null = null;

  entry = edit(proj, { kind: "add", item }, (repo) => Effect.gen(function* () {
    const r = yield* graphql(repo, addDraftMutation(b.project.id, title), AddedDraftSchema);
    const made = r.addProjectV2DraftIssue?.projectItem;
    const id = made?.id ?? "";

    if (id !== "" && key !== "" && field !== null) yield* mutate(repo, setFieldMutation(b.project.id, id, field, values.get(field.id)));

    if (id === "") return;

    // The real item takes the temporary one's place in what's shown until the next read.
    if (entry !== null) entry.op = { kind: "add", item: { ...item, id, db: made?.databaseId ?? null, content: { ...item.content, id: made?.content?.id ?? null } } };

    if (proj.sel === temp) proj.sel = id;
  }), `Added “${title}”${col === undefined ? "" : ` to ${col.name}`}`, cx);
}

export function archive(proj: Projects, item: Item, _cx: Context): void {
  const b = proj.board();

  if (b === null) return;

  proj.app.ask(`Archive ${label(item)} “${item.content.title}” from ${b.project.title}?`, (cx) => {
    const lay = proj.lay();
    const g = lay === null ? [] : proj.grid(lay), a = find(g, item.id);
    const next = a === null ? null : g[a.col]?.[a.row + 1] ?? g[a.col]?.[a.row - 1];

    proj.sel = next?.id ?? null;
    edit(proj, { kind: "archive", item: item.id }, gql(proj, archiveMutation(b.project.id, item.id)), `Archived ${label(item)}`, cx);
    cx.notify();
  });
}
