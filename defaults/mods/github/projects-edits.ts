// The Projects tab's edits: laid over the board at once (board-edits.ts),
// sent to GitHub in order, taken back when it refuses; a card dropped,
// a draft added, a card archived.

import type { Context } from "gpui-kit";
import type { Repo } from "./gh.ts";
import { graphql, mutate } from "./gh.ts";
import { noteOf } from "./kit.ts";
import type { Field, FieldValue, Item } from "./board.ts";
import type { Op } from "./board-edits.ts";
import { scopeProblem } from "./board.ts";
import { grid, find, drop } from "./board-layout.ts";
import { valueFor, setFieldMutation, positionMutation, archiveMutation, addDraftMutation, isAddedDraft } from "./board-edits.ts";
import { valueText, label } from "./board-cards.ts";
import type { default as Projects, Pending } from "./projects.ts";

const SETTLE = 2500; // after an edit GitHub took, the board is read again this much later

/** The note for an edit GitHub refused. */
export function refused(proj: Projects, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  const s = scopeProblem(message, true);

  proj.app.note = noteOf(s ? s.text : `GitHub refused it: ${message}`, "failed");
  proj.keepSel();
}

/** Lays `op` over the board and sends it (`send`, with the repo). Returns its pending entry (null: nothing laid over). */
export function edit(proj: Projects, op: Op | null, send: (repo: Repo) => Promise<void>, ok: string | null, cx: Context): Pending | null {
  const entry: Pending | null = op ? { id: ++proj.seq, op, state: "sending", at: Date.now() } : null;

  if (entry) proj.pending.push(entry);

  sendEdits(proj, entry ? [entry] : [], send, ok, cx);

  return entry;
}

export function editBatch(proj: Projects, ops: readonly Op[], send: (repo: Repo) => Promise<void>, ok: string, cx: Context): void {
  const entries = ops.map((op): Pending => ({ id: ++proj.seq, op, state: "sending", at: Date.now() }));

  proj.pending.push(...entries);
  sendEdits(proj, entries, send, ok, cx);
}

/** Sends edits laid over the board: done, they wait for a read; refused, they go (the rollback). */
export function sendEdits(proj: Projects, entries: readonly Pending[], send: (repo: Repo) => Promise<void>, ok: string | null, cx: Context): void {
  const repo = proj.app.repo;

  proj.app.note = noteOf("…", "working");
  cx.spawn(async (cx) => {
    try {
      if (!repo) throw new Error("No repo.");

      await send(repo);

      for (const e of entries) {
        e.state = "done";
        e.doneAt = Date.now();
      }

      proj.app.note = ok ? noteOf(ok, "done") : null;
      proj.settleAt = Date.now() + SETTLE;
      proj.app.next = Math.min(proj.app.next, proj.settleAt);
    } catch (err) {
      proj.pending = proj.pending.filter((p) => !entries.includes(p)); // the rollback
      refused(proj, err);
    }

    cx.notify();
  });
}

export function gql(proj: Projects, query: string): (repo: Repo) => Promise<void> {
  return (repo) => mutate(repo, query);
}

export function setField(proj: Projects, item: Item, field: Field, choice: string | null, cx: Context): void {
  const b = proj.board();

  if (!b) return;

  const value = valueFor(field, choice);

  if (choice !== null && choice !== "" && !value) {
    proj.app.note = noteOf(`That isn't a ${field.type} for ${field.name}.`, "failed");

    return;
  }

  edit(proj, { kind: "field", item: item.id, field: field.id, value }, gql(proj, setFieldMutation(b.project.id, item.id, field, value)),
    `${field.name}: ${value ? valueText(field, value) : "cleared"}`, cx);
}

/** Drops the carried card where it is. */
export function dropCard(proj: Projects, cx: Context): void {
  const lay = proj.lay(), c = proj.carrying, b = proj.board();

  proj.carrying = null;

  if (!lay || !c || !b) return;

  const plan = drop(grid(lay), c, lay.columns, { sorted: lay.sorted });

  if (!plan) return;

  const pid = b.project.id;
  const item = b.items.find((i) => i.id === plan.id);
  const col = lay.columns[c.col];
  const field = lay.field;
  const ops: Op[] = [];
  // Both edits are one move: shown together, rolled back together.
  const sends: string[] = [];

  if (plan.column !== undefined && field) {
    const value = plan.column ? valueFor(field, plan.column) : null;

    ops.push({ kind: "field", item: plan.id, field: field.id, value });
    sends.push(setFieldMutation(pid, plan.id, field, value));
  }

  if (plan.afterId !== undefined) {
    ops.push({ kind: "position", item: plan.id, afterId: plan.afterId });
    sends.push(positionMutation(pid, plan.id, plan.afterId));
  }

  proj.sel = plan.id;
  proj.selCol = c.col;
  editBatch(proj, ops, async (repo) => {
    for (const q of sends) await mutate(repo, q);
  }, plan.column !== undefined ? `Moved ${label(item)} to ${col?.name ?? ""}` : `Moved ${label(item)}`, cx);
}

export function addDraft(proj: Projects, cx: Context): void {
  const title = proj.draft.value().trim(), lay = proj.lay(), b = proj.board();

  proj.typing = null;
  proj.draft.set_value("");
  proj.app.focusSelf();

  if (!title || !lay || !b) return;

  const col = lay.columns[proj.at(lay).col];
  const temp = `temp-${++proj.seq}`;
  const field = lay.field;
  const start = col?.key && field ? valueFor(field, col.key) : null;
  const values = new Map<string, FieldValue>(field && start ? [[field.id, start]] : []);

  const item: Item = {
    id: temp, db: null, type: "DRAFT_ISSUE", archived: false, values,
    content: { kind: "draft", id: null, number: null, title, state: "DRAFT", isDraft: false, url: null, repo: null, assignees: [], labels: [], milestone: null },
  };

  proj.sel = temp;

  let entry: Pending | null = null;

  entry = edit(proj, { kind: "add", item }, async (repo) => {
    const r = await graphql(repo, addDraftMutation(b.project.id, title), isAddedDraft);
    const made = r.addProjectV2DraftIssue?.projectItem;
    const id = made?.id;

    if (id && col?.key && field) await mutate(repo, setFieldMutation(b.project.id, id, field, values.get(field.id)));

    if (!id) return;

    // The real item takes the temporary one's place in what's shown until the next read.
    if (entry) entry.op = { kind: "add", item: { ...item, id, db: made.databaseId ?? null, content: { ...item.content, id: made.content?.id ?? null } } };

    if (proj.sel === temp) proj.sel = id;
  }, `Added “${title}”${col ? ` to ${col.name}` : ""}`, cx);
}

export function archive(proj: Projects, item: Item, cx: Context): void {
  const b = proj.board();

  if (!b) return;

  proj.app.ask(`Archive ${label(item)} “${item.content.title}” from ${b.project.title}?`, () => {
    const lay = proj.lay();
    const g = lay ? proj.grid(lay) : [], a = find(g, item.id);
    const next = a ? g[a.col]?.[a.row + 1] ?? g[a.col]?.[a.row - 1] : null;

    proj.sel = next?.id ?? null;
    edit(proj, { kind: "archive", item: item.id }, gql(proj, archiveMutation(b.project.id, item.id)), `Archived ${label(item)}`, cx);
    cx.notify();
  });
}
