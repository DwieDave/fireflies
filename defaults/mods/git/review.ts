// Review: what diff was, now a tab of the Files panel ("Review").
// The changes of a scope (uncommitted; the whole branch since it left its
// base; a pull request's diff from `gh pr diff`), each file with a reviewed
// box (space marks it and goes to the next unreviewed one, a marks all or
// none), tests / config / assets / docs hideable (ctrl-b). Marks and the
// hide choices keep diff's shared keys, so what people marked
// there is still marked here.

import { shared, setShared } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isString, object, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { Kind } from "./kinds.ts";
import { kind, KINDS } from "./kinds.ts";
import type { Git, Scope } from "./git.ts";
import { diffKey } from "./git.ts";
import type { DiffFile } from "./patch.ts";
import type { MenuOptions } from "./popups.ts";

export const MARKS = "diff.reviewed";
export const HIDE = "diff.hide";

/** The reviewed marks, by repo root: each a file's diffKey. */
const MARKS_KEY = sharedMapKey(MARKS, arrayOf(isString));

/** The kinds hidden in review. */
const isHide = object({}, { tests: isBoolean, config: isBoolean, assets: isBoolean, docs: isBoolean });

type Hide = Guarded<typeof isHide>;

const HIDE_KEY = sharedKey(HIDE, isHide);

/** A file in review: its diff, the kind it counts as (null: code), the key its mark is kept by. */
export interface ReviewFile extends DiffFile {
  readonly kind: Kind | null;
  readonly key: string;
}

/** What review needs of the window. */
export interface ReviewHost {
  readonly data: { readonly main: string | null; readonly status: { readonly oid: string | null } | null };
  readonly git: Git | null;
  /** The review file under the cursor, if that's where it is. */
  reviewItem(): ReviewFile | null;
  moveTo(i: number): void;
  reloadReview(): void;
  menu(o: MenuOptions): void;
}

/** Where a review starts: its scope, or a pull request (`pr`, of `repo` "owner/name"). */
export interface ReviewOptions {
  readonly scope?: Scope;
  readonly pr?: number | null;
  readonly repo?: string | null;
}

/** A review's state: loading its files, ready, or failed (`error`). */
export type ReviewState = "idle" | "loading" | "ready" | "error";

export class Review {
  readonly v: ReviewHost;
  readonly pr: number | null;
  readonly prRepo: string | null;
  scope: Scope;
  files: readonly ReviewFile[] = [];
  since: string | null = null;
  state: ReviewState = "idle";
  error = "";

  constructor(v: ReviewHost, options: ReviewOptions = {}) {
    const { scope = "work", pr = null, repo = null } = options;

    this.v = v;
    this.pr = pr;
    this.prRepo = repo;
    this.scope = pr ? "pr" : scope;
  }

  scopes(): Scope[] { return this.pr ? ["pr", "work", "branch"] : ["work", "branch"]; }

  scopeName(s: Scope = this.scope, base: string | null = this.v.data.main) {
    return s === "pr" ? `#${this.pr ?? ""}` : s === "work" ? "uncommitted" : `since ${base ?? "base"}`;
  }

  async load() {
    const g = this.v.git;

    if (!g) return;

    this.state = this.files.length ? "ready" : "loading";

    try {
      const head = Boolean(this.v.data.status?.oid);
      const { files, since } = this.scope === "pr" && this.pr !== null ? await g.prReview(this.pr, this.prRepo) : await g.review(this.scope, this.v.data.main, head);

      this.files = files.map((f) => ({ ...f, kind: kind(f), key: diffKey(f) }));
      this.since = since;
      this.state = "ready";
    } catch (cause: unknown) {
      this.state = "error";
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  hidden(): Hide { return readShared(shared, HIDE_KEY, {}); }

  shown() {
    const h = this.hidden();

    return this.files.filter((f) => !(f.kind && h[f.kind]));
  }

  marks() {
    const root = this.v.git?.root;

    return new Set(root === undefined ? [] : readSharedMap(shared, MARKS_KEY).get(root) ?? []);
  }

  toggle(f: ReviewFile) {
    const root = this.v.git?.root;

    if (root === undefined) return;

    const m = this.marks();

    if (m.has(f.key)) m.delete(f.key);
    else m.add(f.key);

    const live = new Set(this.files.map((x) => x.key));

    writeSharedMap(setShared, MARKS_KEY, new Map([...readSharedMap(shared, MARKS_KEY), [root, [...m].filter((k) => live.has(k))]]));
  }

  /** space: mark the file reviewed (or not), then the next unreviewed one. */
  markAndNext() {
    const list = this.shown(), f = this.v.reviewItem();

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

    this.scope = s[(s.indexOf(this.scope) + 1) % s.length] ?? "work";
    this.files = [];
    this.v.moveTo(0);
    this.v.reloadReview();
  }

  setScope(s: Scope) {
    if (this.scope === s) return;

    this.scope = s;
    this.files = [];
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

          return { key: String(i + 1), label: `${h[k] ? "Show" : "Hide"} ${label}`, sub: n ? `${n} file${n === 1 ? "" : "s"}` : "none", go: () => writeShared(setShared, HIDE_KEY, { ...this.hidden(), [k]: !this.hidden()[k] }) };
        }),
        { key: "0", label: "Show everything", go: () => writeShared(setShared, HIDE_KEY, {}) },
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
