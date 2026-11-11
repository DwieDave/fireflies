// Review: what nocturne-diff was, now a tab of the Files panel ("Review").
// The changes of a scope (uncommitted; the whole branch since it left its
// base; a pull request's diff from `gh pr diff`), each file with a reviewed
// box (space marks it and goes to the next unreviewed one, a marks all or
// none), tests / config / assets / docs hideable (ctrl-b). Marks and the
// hide choices keep nocturne-diff's shared keys, so what people marked
// there is still marked here.

import { shared, setShared } from "herdr";
import { kind, KINDS } from "./kinds.js";
import { diffKey } from "./git.js";

export const MARKS = "nocturne-diff.reviewed";
export const HIDE = "nocturne-diff.hide";

export class Review {
  constructor(v, { scope = "work", pr = null, repo = null } = {}) {
    this.v = v;
    this.pr = pr; this.prRepo = repo;
    this.scope = pr ? "pr" : scope;
    this.files = []; this.since = null;
    this.state = "idle"; // idle | loading | ready | error
    this.error = "";
  }

  scopes() { return this.pr ? ["pr", "work", "branch"] : ["work", "branch"]; }

  scopeName(s = this.scope, base = this.v.data.main) {
    return s === "pr" ? `#${this.pr}` : s === "work" ? "uncommitted" : `since ${base ?? "base"}`;
  }

  async load() {
    const g = this.v.git;
    if (!g) return;
    this.state = this.files.length ? "ready" : "loading";
    try {
      const head = Boolean(this.v.data.status?.oid);
      const { files, since } = this.scope === "pr" ? await g.prReview(this.pr, this.prRepo) : await g.review(this.scope, this.v.data.main, head);
      for (const f of files) { f.kind = kind(f); f.key = diffKey(f); }
      this.files = files; this.since = since;
      this.state = "ready";
    } catch (e) {
      this.state = "error"; this.error = String(e?.message ?? e);
    }
  }

  hidden() { return shared(HIDE) ?? {}; }
  shown() { const h = this.hidden(); return this.files.filter((f) => !(f.kind && h[f.kind])); }
  marks() { return new Set(shared(MARKS)?.[this.v.git?.root] ?? []); }

  toggle(f) {
    const m = this.marks();
    m.has(f.key) ? m.delete(f.key) : m.add(f.key);
    const live = new Set(this.files.map((x) => x.key));
    setShared(MARKS, { ...(shared(MARKS) ?? {}), [this.v.git.root]: [...m].filter((k) => live.has(k)) });
  }

  /** space: mark the file reviewed (or not), then the next unreviewed one. */
  markAndNext() {
    const list = this.shown(), f = this.v.item();
    if (!f) return;
    const was = this.marks().has(f.key);
    this.toggle(f);
    if (!was) {
      const m = this.marks(), i = list.indexOf(f);
      const next = [...list.slice(i + 1), ...list.slice(0, i)].find((x) => !m.has(x.key));
      if (next) this.v.moveTo(list.indexOf(next));
    }
  }

  /** a: every shown file reviewed; when they all are already, none. */
  markAll() {
    const list = this.shown(), m = this.marks(), all = list.every((x) => m.has(x.key));
    for (const x of list) if (all === m.has(x.key)) this.toggle(x);
  }

  nextScope() {
    const s = this.scopes();
    this.scope = s[(s.indexOf(this.scope) + 1) % s.length];
    this.files = [];
    this.v.moveTo(0);
    this.v.reloadReview();
  }

  setScope(s) {
    if (this.scope === s) return;
    this.scope = s; this.files = [];
    this.v.moveTo(0);
    this.v.reloadReview();
  }

  hideMenu() {
    const h = this.hidden();
    this.v.menu({
      title: "Hide in review",
      items: [
        ...KINDS.map(([k, label], i) => {
          const n = this.files.filter((f) => f.kind === k).length;
          return { key: String(i + 1), label: `${h[k] ? "Show" : "Hide"} ${label}`, sub: n ? `${n} file${n === 1 ? "" : "s"}` : "none", go: () => setShared(HIDE, { ...this.hidden(), [k]: !this.hidden()[k] }) };
        }),
        { key: "0", label: "Show everything", go: () => setShared(HIDE, {}) },
      ],
    });
  }

  /** The review's counts for the panel's foot: "3/9 reviewed · 2 hidden". */
  summary() {
    const list = this.shown(), m = this.marks();
    const done = list.filter((f) => m.has(f.key)).length;
    const off = this.files.length - list.length;
    return `${done}/${list.length} reviewed${off ? ` · ${off} hidden` : ""}`;
  }
}
