// The Projects tab's menus (projects.ts opens them from its keys and
// clicks): the projects, the views, convert a draft, a column's limit, a
// card's fields and their values; the keys while one is open.

import type { Context, KeyEvent } from "gpui-kit";
import { Array as Arr, Effect, Option, String as Str } from "effect";
import { choicesFor } from "./projects-reads.ts";
import type { Board, Field, Item, ListedProject } from "./board.ts";
import type { Layout } from "./board-layout.ts";
import { selectOf } from "./board-filter.ts";
import { convertMutation, draftMutation, toggleMutation } from "./board-edits.ts";
import { editableFields, valueText, ansiKey } from "./board-cards.ts";
import { edit, gql, setField } from "./projects-edits.ts";
import type { default as Projects, Menu, Opt } from "./projects.ts";

const FROM = { repo: "linked", parent: "parent's", owner: "owner's" } as const satisfies { readonly [K in ListedProject["from"]]: string };

export function openProjects(proj: Projects): void {
  const ps = proj.list?.projects ?? [];

  proj.menu = {
    kind: "pick", title: "Projects", at: Math.max(0, Option.getOrElse(Arr.findFirstIndex(ps, (p) => p.id === proj.pick), () => -1)),
    rows: Arr.map(ps, (p) => ({ label: p.title, right: `${p.closed ? "closed · " : ""}${FROM[p.from]} · ${p.owner ?? ""}/#${p.number ?? ""}`, dim: p.closed, go: (cx) => proj.setProject(p.id, cx) })),
  };
}

export function openViews(proj: Projects, b: Board): void {
  const vs = b.views, cur = proj.view(b);

  proj.menu = {
    kind: "pick", title: "Views", at: Math.max(0, Option.getOrElse(Arr.findFirstIndex(vs, (v) => v.id === cur?.id), () => -1)),
    rows: Arr.map(vs, (v) => ({ label: v.name, right: `${v.layout}${v.filter === "" ? "" : ` · ${v.filter}`}`, dim: v.layout !== "board", go: () => proj.setView(v.id) })),
  };
}

export function openConvert(proj: Projects, b: Board, item: Item): void {
  const full = proj.app.repo?.full ?? "";
  const repos = [...b.repos];
  const repoId = proj.list?.repoId;

  if (repoId !== null && repoId !== undefined && repoId !== "" && !Arr.some(repos, (r) => r.id === repoId)) repos.unshift({ id: repoId, full });

  proj.menu = {
    kind: "pick", title: `Make “${item.content.title}” an issue in`, at: Math.max(0, Option.getOrElse(Arr.findFirstIndex(repos, (r) => r.full === full), () => -1)),
    rows: Arr.map(repos, (r) => ({ label: r.full, go: (cx) => edit(proj, null, gql(proj, convertMutation(item.id, r.id)), `Made an issue in ${r.full}`, cx) })),
  };
}

export function openLimit(proj: Projects, lay: Layout, col: number): void {
  const c = lay.columns[col];

  if (c === undefined) return;

  proj.menu = {
    kind: "value", title: `Limit for ${c.name} (cards; empty: none)`, go: (text) => {
      const n = Math.max(0, Math.floor(Number(text) || 0));
      const fid = lay.field?.id ?? "";

      proj.setLocal((l) => {
        const limits = new Map(l.limits.get(fid) ?? []);

        if (n > 0) limits.set(c.key, n);
        else limits.delete(c.key);

        return { ...l, limits: new Map(l.limits).set(fid, limits) };
      });
    },
  };
  proj.valueInput.set_value(c.limit === null || c.limit === 0 ? "" : String(c.limit));
  proj.typing = "value";
  proj.valueInput.focus();
}

/** e: the card's fields on the left, the chosen one's values on the right. */
export function openFields(proj: Projects, item: Item, _cx: Context): void {
  const b = proj.board();

  if (b === null) return;

  const fields = editableFields(b, item);

  if (fields.length === 0) return;

  proj.menu = { kind: "fields", item: item.id, at: 0, side: "fields", opt: 0, fields: Arr.map(fields, (f) => f.id) };

  const repo = item.content.repo ?? proj.app.repo?.full ?? null;

  if (Arr.some(fields, (f) => f.type === "labels" || f.type === "assignees")) {
    // A repo's labels and people that can't be read: the menu offers none (and says so).
    proj.app.run(Effect.ignore(choicesFor(proj, repo)));
  }
}

/** The values the field menu offers for one field: [{ id, label, color, on }]. */
export function options(proj: Projects, _b: Board, item: Item, f: Field): Opt[] {
  const v = item.values.get(f.id);

  if (f.type === "single") return [...Arr.map(f.options, (o) => ({ id: o.id, label: o.name, color: ansiKey(o.color), on: selectOf(v)?.optionId === o.id })), { id: null, label: "clear", dim: true }];

  if (f.type === "iteration") {
    const cur = v !== undefined && "iterationId" in v ? v.iterationId : null;

    return [...Arr.map(Arr.filter(f.iterations, (i) => !i.done), (i) => ({ id: i.id, label: i.title, right: i.startDate, on: cur === i.id })), { id: null, label: "clear", dim: true }];
  }

  if (f.type === "labels" || f.type === "assignees") {
    const c = proj.choices.get(item.content.repo ?? proj.app.repo?.full ?? "");

    if (c === undefined) return [{ id: undefined, label: "reading…", dim: true }];

    if (f.type === "labels") {
      const have = Arr.map(item.content.labels, (l) => l.name);

      return Arr.map(c.labels, (l) => ({ id: l.id, label: l.name, hex: l.color, on: have.includes(l.name), toggle: true }));
    }

    const have = Arr.map(item.content.assignees, (a) => a.login);

    return Arr.map(c.users, (u) => ({ id: u.id, label: u.login, on: have.includes(u.login), toggle: true }));
  }

  const edit: Opt = { id: "edit", label: valueText(f, v) || (f.type === "title" ? item.content.title : "(empty)"), right: "enter edits", input: true };

  return f.type === "title" ? [edit] : [edit, { id: null, label: "clear", dim: true }];
}

/** The fields a fields menu lists, as the board has them. */
export function menuFields(proj: Projects, b: Board, ids: readonly string[]): Field[] {
  return Arr.flatMap(ids, (id) => {
    const f = Option.getOrUndefined(Arr.findFirst(b.fields, (x) => x.id === id));

    return f === undefined ? [] : [f];
  });
}

export function menuKey(proj: Projects, m: Menu, k: string, e: KeyEvent, cx: Context): boolean {
  if (k === "escape" || k === "q") {
    proj.menu = null;

    return true;
  }

  if (m.kind === "pick") {
    if (k === "j" || k === "down") m.at = Math.min(m.rows.length - 1, m.at + 1);
    else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
    else if (k === "enter" || k === "space") {
      const r = m.rows[m.at];

      proj.menu = null;
      r?.go(cx);
    }

    return true;
  }

  if (m.kind !== "fields") return true;

  const b = proj.board(), item = Option.getOrUndefined(Arr.findFirst(b?.items ?? [], (i) => i.id === m.item));

  if (b === null || item === undefined) {
    proj.menu = null;

    return true;
  }

  const fields = menuFields(proj, b, m.fields);
  const f = fields[m.at], opts = f === undefined ? [] : options(proj, b, item, f);

  // tab / shift-tab: the next / previous field, wrapping, as in every form (form-keys.ts).
  if (k === "tab" || k === "shift-tab") {
    const by = k === "tab" && !e.modifiers.shift ? 1 : -1;

    m.at = (((m.at + by) % fields.length) + fields.length) % fields.length;
    m.side = "fields";

    return true;
  }

  if (m.side === "fields") {
    if (k === "j" || k === "down") m.at = Math.min(fields.length - 1, m.at + 1);
    else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
    else if (k === "l" || k === "right" || k === "enter" || k === "space") {
      m.side = "opts";
      m.opt = Math.max(0, Option.getOrElse(Arr.findFirstIndex(opts, (o) => o.on === true), () => -1));
    }

    return true;
  }

  if (k === "j" || k === "down") m.opt = Math.min(opts.length - 1, m.opt + 1);
  else if (k === "k" || k === "up") m.opt = Math.max(0, m.opt - 1);
  else if (k === "h" || k === "left") m.side = "fields";
  else if ((k === "enter" || k === "space") && f !== undefined) choose(proj, item, f, opts[m.opt], cx);

  return true;
}

export function choose(proj: Projects, item: Item, f: Field, o: Opt | undefined, cx: Context): void {
  if (o === undefined || o.id === undefined) return;

  if (o.input === true) {
    const v = item.values.get(f.id);

    const text = f.type === "title" ? item.content.title
      : f.type === "date" ? (v !== undefined && "date" in v ? v.date : "")
      : f.type === "number" ? (v !== undefined && "number" in v ? String(v.number) : "")
      : v !== undefined && "text" in v ? v.text : "";

    proj.valueInput.set_value(text);

    const back = proj.menu;

    proj.menu = {
      kind: "value", back, title: `${f.name}${f.type === "date" ? " (YYYY-MM-DD)" : ""}`, go: (typed) => {
        if (f.type === "title") retitle(proj, item, typed, cx);
        else setField(proj, item, f, Str.trim(typed), cx);
      },
    };
    proj.typing = "value";
    proj.valueInput.focus();

    return;
  }

  if (o.toggle === true) {
    toggle(proj, item, f, o, cx);

    return;
  }

  setField(proj, item, f, o.id, cx);

  if (proj.menu?.kind === "fields") proj.menu.side = "fields";
}

export function retitle(proj: Projects, item: Item, text: string, cx: Context): void {
  const title = Str.trim(text);

  if (title === "" || item.content.id === null || item.content.id === "") return;

  edit(proj, { kind: "content", item: item.id, patch: { title } }, gql(proj, draftMutation(item.content.id, { title })), "Renamed the draft", cx);
}

/** A label or an assignee on or off. */
export function toggle(proj: Projects, item: Item, f: Field, o: Opt, cx: Context): void {
  const c = item.content, id = o.id ?? "", on = o.on === true;

  if (c.id === null || c.id === "") return;

  if (f.type === "labels") {
    const labels = on ? Arr.filter(c.labels, (l) => l.name !== o.label) : [...c.labels, { id: o.id ?? null, name: o.label, color: o.hex ?? "666666" }];
    const q = toggleMutation(c.id, "labels", on ? [] : [id], on ? [id] : []);

    if (q !== null) edit(proj, { kind: "content", item: item.id, patch: { labels } }, gql(proj, q), `${on ? "Took off" : "Put on"} ${o.label}`, cx);

    return;
  }

  const assignees = on ? Arr.filter(c.assignees, (a) => a.login !== o.label) : [...c.assignees, { id: o.id ?? null, login: o.label }];
  const q = c.kind === "draft" ? draftMutation(c.id, { assigneeIds: Arr.flatMap(assignees, (a) => (a.id === null || a.id === "" ? [] : [a.id])) }) : toggleMutation(c.id, "assignees", on ? [] : [id], on ? [id] : []);

  if (q !== null) edit(proj, { kind: "content", item: item.id, patch: { assignees } }, gql(proj, q), `${on ? "Unassigned" : "Assigned"} ${o.label}`, cx);
}

export function submitValue(proj: Projects, cx: Context): void {
  const m = proj.menu, text = proj.valueInput.value();

  proj.typing = null;
  proj.app.focusSelf();
  proj.menu = m?.kind === "value" ? m.back ?? null : null;

  if (proj.menu?.kind === "fields") proj.menu.side = "fields";

  if (m?.kind === "value") m.go(text);

  cx.notify();
}
