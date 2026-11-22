// Review: what diff was, now a tab of the Files panel ("Review").
// The changes of a scope (uncommitted; the whole branch since it left its
// base; a pull request's diff from `gh pr diff`), each file with a reviewed
// box (space marks it and goes to the next unreviewed one, a marks all or
// none), tests / config / assets / docs hideable (ctrl-b). Marks and the
// hide choices keep diff's shared keys, so what people marked
// there is still marked here.

import { Array as Arr, Effect, Option, Schema } from "effect";
import { shared, setShared } from "herdr";
import { readShared, sharedKey, writeShared } from "@fireflies/kit";
import type { Exec } from "@fireflies/kit";
import { readSharedMap, sharedMapKey, writeSharedMap } from "./shared-map.ts";
import type { Kind } from "./kinds.ts";
import { kind, KINDS } from "./kinds.ts";
import type { Git, Scope } from "./git.ts";
import { diffKey } from "./git.ts";
import type { DiffFile } from "./patch.ts";
import type { MenuOptions } from "./popups.ts";

export const MARKS = "diff.reviewed";
export const HIDE = "diff.hide";

/** The reviewed marks, by repo root: each a file's diffKey. */
const MARKS_KEY = sharedMapKey(MARKS, Schema.Array(Schema.String));

/** The kinds hidden in review. */
const HideSchema = Schema.Struct({ tests: Schema.optionalKey(Schema.Boolean), config: Schema.optionalKey(Schema.Boolean), assets: Schema.optionalKey(Schema.Boolean), docs: Schema.optionalKey(Schema.Boolean) });

type Hide = typeof HideSchema.Type;

const HIDE_KEY = sharedKey(HIDE, HideSchema);

/** A kind hidden in `h`. */
const hides = (h: Hide, k: Kind | null): boolean => k !== null && h[k] === true;

/** A file in review: its diff, the kind it counts as (null: code), the key its mark is kept by. */
export interface ReviewFile extends DiffFile {
  readonly kind: Kind | null;
  readonly key: string;
}

/** What review needs of the window. */
export interface ReviewHost {
  readonly data: { readonly main: string | null | undefined; readonly status: { readonly oid: string | null } | null };
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
    this.scope = pr === null ? scope : "pr";
  }

  scopes(): Scope[] { return this.pr === null ? ["work", "branch"] : ["pr", "work", "branch"]; }

  scopeName(s: Scope = this.scope, base: string | null | undefined = this.v.data.main): string {
    if (s === "pr") return `#${this.pr ?? ""}`;

    return s === "work" ? "uncommitted" : `since ${base ?? "base"}`;
  }

  /** Reads the scope's changes; a failure (gh or git refusing) becomes the review's error line. */
  load(): Effect.Effect<void, never, Exec> {
    const g = this.v.git;

    if (g === null) return Effect.void;

    return Effect.gen({ self: this }, function* () {
      this.state = this.files.length > 0 ? "ready" : "loading";

      const head = (this.v.data.status?.oid ?? null) !== null;
      const { files, since } = this.scope === "pr" && this.pr !== null ? yield* g.prReview(this.pr, this.prRepo) : yield* g.review(this.scope, this.v.data.main ?? null, head);

      this.files = Arr.map(files, (f) => ({ ...f, kind: kind(f), key: diffKey(f) }));
      this.since = since;
      this.state = "ready";
    }).pipe(Effect.catchTags({
      ExecError: (e) => this.failed(e.message),
      ExitError: (e) => this.failed(e.message),
    }));
  }

  /** The review couldn't be read: why, in the list's place. */
  failed(message: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.state = "error";
      this.error = message;
    });
  }

  hidden(): Hide { return readShared(shared, HIDE_KEY, {}); }

  shown(): ReviewFile[] {
    const h = this.hidden();

    return Arr.filter(this.files, (f) => !hides(h, f.kind));
  }

  marks(): Set<string> {
    const root = this.v.git?.root;

    return new Set(root === undefined ? [] : readSharedMap(shared, MARKS_KEY).get(root) ?? []);
  }

  toggle(f: ReviewFile): void {
    const root = this.v.git?.root;

    if (root === undefined) return;

    const m = this.marks();

    if (m.has(f.key)) m.delete(f.key);
    else m.add(f.key);

    const live = new Set(Arr.map(this.files, (x) => x.key));

    writeSharedMap(setShared, MARKS_KEY, new Map([...readSharedMap(shared, MARKS_KEY), [root, Arr.filter(Arr.fromIterable(m), (k) => live.has(k))]]));
  }

  /** space: mark the file reviewed (or not), then the next unreviewed one. */
  markAndNext(): void {
    const list = this.shown(), f = this.v.reviewItem();

    if (f === null) return;

    const was = this.marks().has(f.key);

    this.toggle(f);

    if (was) return;

    const m = this.marks(), i = list.indexOf(f);
    const next = Arr.findFirst([...Arr.drop(list, i + 1), ...Arr.take(list, i)], (x) => !m.has(x.key));

    Option.map(next, (x) => this.v.moveTo(list.indexOf(x)));
  }

  /** a: every shown file reviewed; when they all are already, none. */
  markAll(): void {
    const list = this.shown(), m = this.marks(), all = Arr.every(list, (x) => m.has(x.key));

    for (const x of list) if (all === m.has(x.key)) this.toggle(x);
  }

  nextScope(): void {
    const s = this.scopes();

    this.scope = Option.getOrElse(Arr.get(s, (s.indexOf(this.scope) + 1) % s.length), () => "work" as const);
    this.files = [];
    this.v.moveTo(0);
    this.v.reloadReview();
  }

  setScope(s: Scope): void {
    if (this.scope === s) return;

    this.scope = s;
    this.files = [];
    this.v.moveTo(0);
    this.v.reloadReview();
  }

  hideMenu(): void {
    const h = this.hidden();

    this.v.menu({
      title: "Hide in review",
      items: [
        ...Arr.map(KINDS, ([k, label], i) => {
          const n = Arr.filter(this.files, (f) => f.kind === k).length;

          return { key: String(i + 1), label: `${hides(h, k) ? "Show" : "Hide"} ${label}`, sub: n > 0 ? `${n} file${n === 1 ? "" : "s"}` : "none", go: () => { writeShared(setShared, HIDE_KEY, { ...this.hidden(), [k]: !hides(this.hidden(), k) }); } };
        }),
        { key: "0", label: "Show everything", go: () => { writeShared(setShared, HIDE_KEY, {}); } },
      ],
    });
  }

  /** The review's counts for the panel's foot: "3/9 reviewed · 2 hidden". */
  summary(): string {
    const list = this.shown(), m = this.marks();
    const done = Arr.filter(list, (f) => m.has(f.key)).length;
    const off = this.files.length - list.length;

    return `${done}/${list.length} reviewed${off > 0 ? ` · ${off} hidden` : ""}`;
  }
}
