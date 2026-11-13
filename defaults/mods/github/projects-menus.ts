// The Projects tab's menus (projects.ts opens them from its keys and
// clicks): the projects, the views, convert a draft, a column's limit, a
// card's fields and their values; the keys while one is open.

import type { Context, KeyEvent } from "gpui-kit";
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
    kind: "pick", title: "Projects", at: Math.max(0, ps.findIndex((p) => p.id === proj.pick)),
    rows: ps.map((p) => ({ label: p.title, right: `${p.closed ? "closed · " : ""}${FROM[p.from]} · ${p.owner ?? ""}/#${p.number ?? ""}`, dim: p.closed, go: (cx) => proj.setProject(p.id, cx) })),
  };
}

export function openViews(proj: Projects, b: Board): void {
  const vs = b.views, cur = proj.view(b);

  proj.menu = {
    kind: "pick", title: "Views", at: Math.max(0, vs.findIndex((v) => v.id === cur?.id)),
    rows: vs.map((v) => ({ label: v.name, right: `${v.layout}${v.filter ? ` · ${v.filter}` : ""}`, dim: v.layout !== "board", go: () => proj.setView(v.id) })),
  };
}

export function openConvert(proj: Projects, b: Board, item: Item): void {
  const full = proj.app.repo?.full ?? "";
  const repos = [...b.repos];
  const repoId = proj.list?.repoId;

  if (repoId && !repos.some((r) => r.id === repoId)) repos.unshift({ id: repoId, full });

  proj.menu = {
    kind: "pick", title: `Make “${item.content.title}” an issue in`, at: Math.max(0, repos.findIndex((r) => r.full === full)),
    rows: repos.map((r) => ({ label: r.full, go: (cx) => edit(proj, null, gql(proj, convertMutation(item.id, r.id)), `Made an issue in ${r.full}`, cx) })),
  };
}

export function openLimit(proj: Projects, lay: Layout, col: number): void {
  const c = lay.columns[col];

  if (!c) return;

  proj.menu = {
    kind: "value", title: `Limit for ${c.name} (cards; empty: none)`, go: (text) => {
      const n = Math.max(0, Math.floor(Number(text) || 0));
      const fid = lay.field?.id ?? "";

      proj.setLocal((l) => {
        const limits = new Map(l.limits.get(fid) ?? []);

        if (n) limits.set(c.key, n);
        else limits.delete(c.key);

        return { ...l, limits: new Map(l.limits).set(fid, limits) };
      });
    },
  };
  proj.valueInput.set_value(c.limit ? String(c.limit) : "");
  proj.typing = "value";
  proj.valueInput.focus();
}

/** e: the card's fields on the left, the chosen one's values on the right. */
export function openFields(proj: Projects, item: Item, cx: Context): void {
  const b = proj.board();

  if (!b) return;

  const fields = editableFields(b, item);

  if (!fields.length) return;

  proj.menu = { kind: "fields", item: item.id, at: 0, side: "fields", opt: 0, fields: fields.map((f) => f.id) };

  const repo = item.content.repo ?? proj.app.repo?.full ?? null;

  if (fields.some((f) => f.type === "labels" || f.type === "assignees")) {
    proj.app.spawn(cx, async () => {
      try {
        await proj.choicesFor(repo);
      } catch {
        /* the menu says it */
      }
    });
  }
}

/** The values the field menu offers for one field: [{ id, label, color, on }]. */
export function options(proj: Projects, _b: Board, item: Item, f: Field): Opt[] {
  const v = item.values.get(f.id);

  if (f.type === "single") return [...f.options.map((o) => ({ id: o.id, label: o.name, color: ansiKey(o.color), on: selectOf(v)?.optionId === o.id })), { id: null, label: "clear", dim: true }];

  if (f.type === "iteration") {
    const cur = v && "iterationId" in v ? v.iterationId : null;

    return [...f.iterations.filter((i) => !i.done).map((i) => ({ id: i.id, label: i.title, right: i.startDate, on: cur === i.id })), { id: null, label: "clear", dim: true }];
  }

  if (f.type === "labels" || f.type === "assignees") {
    const c = proj.choices.get(item.content.repo ?? proj.app.repo?.full ?? "");

    if (!c) return [{ id: undefined, label: "reading…", dim: true }];

    if (f.type === "labels") {
      const have = item.content.labels.map((l) => l.name);

      return c.labels.map((l) => ({ id: l.id, label: l.name, hex: l.color, on: have.includes(l.name), toggle: true }));
    }

    const have = item.content.assignees.map((a) => a.login);

    return c.users.map((u) => ({ id: u.id, label: u.login, on: have.includes(u.login), toggle: true }));
  }

  const edit: Opt = { id: "edit", label: valueText(f, v) || (f.type === "title" ? item.content.title : "(empty)"), right: "enter edits", input: true };

  return f.type === "title" ? [edit] : [edit, { id: null, label: "clear", dim: true }];
}

/** The fields a fields menu lists, as the board has them. */
export function menuFields(proj: Projects, b: Board, ids: readonly string[]): Field[] {
  return ids.flatMap((id) => {
    const f = b.fields.find((x) => x.id === id);

    return f ? [f] : [];
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

  const b = proj.board(), item = b?.items.find((i) => i.id === m.item);

  if (!b || !item) {
    proj.menu = null;

    return true;
  }

  const fields = menuFields(proj, b, m.fields);
  const f = fields[m.at], opts = f ? options(proj, b, item, f) : [];

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
      m.opt = Math.max(0, opts.findIndex((o) => o.on));
    }

    return true;
  }

  if (k === "j" || k === "down") m.opt = Math.min(opts.length - 1, m.opt + 1);
  else if (k === "k" || k === "up") m.opt = Math.max(0, m.opt - 1);
  else if (k === "h" || k === "left") m.side = "fields";
  else if ((k === "enter" || k === "space") && f) choose(proj, item, f, opts[m.opt], cx);

  return true;
}

export function choose(proj: Projects, item: Item, f: Field, o: Opt | undefined, cx: Context): void {
  if (!o || o.id === undefined) return;

  if (o.input) {
    const v = item.values.get(f.id);

    const text = f.type === "title" ? item.content.title
      : f.type === "date" ? (v && "date" in v ? v.date : "")
      : f.type === "number" ? (v && "number" in v ? String(v.number) : "")
      : v && "text" in v ? v.text : "";

    proj.valueInput.set_value(text);

    const back = proj.menu;

    proj.menu = {
      kind: "value", back, title: `${f.name}${f.type === "date" ? " (YYYY-MM-DD)" : ""}`, go: (typed) => {
        if (f.type === "title") retitle(proj, item, typed, cx);
        else setField(proj, item, f, typed.trim(), cx);
      },
    };
    proj.typing = "value";
    proj.valueInput.focus();

    return;
  }

  if (o.toggle) {
    toggle(proj, item, f, o, cx);

    return;
  }

  setField(proj, item, f, o.id, cx);

  if (proj.menu?.kind === "fields") proj.menu.side = "fields";
}

export function retitle(proj: Projects, item: Item, text: string, cx: Context): void {
  const title = text.trim();

  if (!title || !item.content.id) return;

  edit(proj, { kind: "content", item: item.id, patch: { title } }, gql(proj, draftMutation(item.content.id, { title })), "Renamed the draft", cx);
}

/** A label or an assignee on or off. */
export function toggle(proj: Projects, item: Item, f: Field, o: Opt, cx: Context): void {
  const c = item.content, id = o.id ?? "";

  if (!c.id) return;

  if (f.type === "labels") {
    const labels = o.on ? c.labels.filter((l) => l.name !== o.label) : [...c.labels, { id: o.id ?? null, name: o.label, color: o.hex ?? "666666" }];
    const q = toggleMutation(c.id, "labels", o.on ? [] : [id], o.on ? [id] : []);

    if (q) edit(proj, { kind: "content", item: item.id, patch: { labels } }, gql(proj, q), `${o.on ? "Took off" : "Put on"} ${o.label}`, cx);

    return;
  }

  const assignees = o.on ? c.assignees.filter((a) => a.login !== o.label) : [...c.assignees, { id: o.id ?? null, login: o.label }];
  const q = c.kind === "draft" ? draftMutation(c.id, { assigneeIds: assignees.flatMap((a) => (a.id ? [a.id] : [])) }) : toggleMutation(c.id, "assignees", o.on ? [] : [id], o.on ? [id] : []);

  if (q) edit(proj, { kind: "content", item: item.id, patch: { assignees } }, gql(proj, q), `${o.on ? "Unassigned" : "Assigned"} ${o.label}`, cx);
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
