// A new pull request (n on the Pull requests tab, its "+ new" button, a
// right-click, the palette, or the git window's branches panel): a form
// (form.ts) with base and head, title and body filled like
// `gh pr create --fill` (the body from the repo's pull request template when
// it has one), draft, reviewers, assignees, labels and milestone. Beside it:
// the commits and files the pull request will hold. When head isn't on
// GitHub (or is ahead of it), a "push first" toggle adds `git push` before
// `gh pr create`. The last step shows both commands; nothing runs before it.

import { div } from "gpui-kit";
import type { Context, Element, Size } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec } from "herdr";
import type { Theme } from "herdr";
import { isString } from "./guard.ts";
import type { Repo } from "./gh.ts";
import { ghRun, api, graphql, plain } from "./gh.ts";
import { isNamed, isNamedList, isPrChoices } from "./model.ts";
import { candidates } from "./remotes.ts";
import type { Commit, LocalBranch, Numstat, PrFields, PushPlan } from "./pr-create.ts";
import { fillFrom, templatesIn, startBody, parseLog, parseNumstat, parseBranches, remoteFor, pushPlan, prErrors, prArgs, createdNumber } from "./pr-create.ts";
import { shellLine } from "./dispatch.ts";
import type { Choice, Command, Field, FormHost, Outcome, Values } from "./form.ts";
import { Form, flagIn, listIn, textIn } from "./form.ts";
import { panel, empty, dither } from "./kit.ts";

const CHOICES = `query($owner: String!, $name: String!) { viewer { login }
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) { nodes { login name } }
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name description } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { title dueOn } } } }`;

/** What the form asks of the Pull requests tab: the new pull request's number (null: gh didn't say), or the form gone. */
export interface PrTab {
  created(number: number | null, cx: Context): void;
  closeForm(): void;
}

/** A pull request made: its number and URL. */
export interface Created {
  readonly number: number | null;
  readonly url: string;
}

/** Who can be assigned, the labels and the open milestones (for the lists), and who I am. */
interface Choices {
  readonly me: string | null;
  readonly users: readonly { readonly login: string; readonly name?: string | null | undefined }[];
  readonly labels: readonly { readonly name: string; readonly description?: string | null | undefined }[];
  readonly milestones: readonly { readonly title: string; readonly dueOn?: string | null | undefined }[];
}

/** What's between base and head: the commits and files once read, or why they can't be. */
interface Range {
  readonly base: string;
  readonly head: string;
  readonly commits: readonly Commit[] | null;
  readonly stat: Numstat | null;
  readonly error: string;
}

/** Whether GitHub has head (null: couldn't tell), for the head it was asked for. */
interface HeadState {
  readonly head: string;
  readonly onRemote: boolean | null;
}

/** The new pull request form's answers. */
const fieldsOf = (v: Values, headOwner: string | null): PrFields => ({
  base: textIn(v, "base"), head: textIn(v, "head"), title: textIn(v, "title"), body: textIn(v, "body"), draft: flagIn(v, "draft"),
  reviewers: listIn(v, "reviewers"), assignees: listIn(v, "assignees"), labels: listIn(v, "labels"), milestone: textIn(v, "milestone"), headOwner,
});

export class PrForm {
  readonly app: FormHost;
  readonly prs: PrTab;
  readonly repo: Repo;
  readonly headRepo: string;
  readonly headOwner: string | null;
  local: readonly LocalBranch[] | null = null;

  /** Names on GitHub (the base repo). */
  remoteBranches: readonly string[] | null = null;
  choices: Choices | null = null;
  templates: readonly string[] = [];
  template = "";
  range: Range | null = null;
  headState: HeadState | null = null;
  remote: string | null = null;
  baseRemote: string | null = null;
  gen = 0;
  closed = false;
  readonly form: Form<Created>;

  /** `head`: the branch to start from (the git window's pick), else the folder's current one. */
  constructor(app: FormHost, prs: PrTab, repo: Repo, { head = null }: { readonly head?: string | null } = {}) {
    this.app = app;
    this.prs = prs;
    this.repo = repo;
    // From a fork shown as its parent (p): the head lives in the fork.
    this.headRepo = repo.child ?? repo.full;
    this.headOwner = repo.child ? repo.child.split("/")[0] ?? null : null;
    this.form = new Form<Created>(app, {
      title: "New pull request",
      sendWord: "Create pull request",
      confirmTitle: "Create this pull request?",
      fields: this.fields(head ?? repo.branch ?? "", repo.base ?? ""),
      side: (t, size) => this.side(t, size),
      summary: () => this.summary(),
      check: (v) => this.check(v),
      commands: () => this.commands(),
      send: () => this.send(),
      done: (r, cx) => prs.created(r.number, cx),
      cancel: () => prs.closeForm(),
    });
  }

  fields(head: string, base: string): Field[] {
    const branchRow = (name: string, where: string): Choice => ({ value: name, label: name, sub: where });

    // Sections (form-layout.ts): base ← head on one row, the words, the toggles, the people and tags two to a row.
    return [
      {
        id: "base", label: "base", kind: "choice", value: base, required: true, hint: "merged into", group: "branches", pair: true, join: "←",
        options: () => this.remoteBranches?.map((b) => branchRow(b, b === this.repo.base ? "default branch" : "")) ?? null,
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
      {
        id: "head", label: "head", kind: "choice", value: head, required: true, free: true, hint: this.headOwner ? `from your fork, ${this.headRepo}` : "the branch with the changes",
        options: () => this.local?.map((b) => branchRow(b.name, b.upstream ? `${b.upstream}${b.ahead ? ` · ${b.ahead} to push` : ""}` : "not pushed")) ?? null,
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
      { id: "title", label: "title", kind: "text", value: "", required: true, placeholder: "what this pull request does", group: "pull request" },
      { id: "body", label: "body", kind: "area", value: "", placeholder: "why, and how to check it", hint: "markdown" },
      { id: "draft", label: "draft", kind: "toggle", value: false, note: "open it as a draft pull request", group: "options" },
      { id: "reviewers", label: "reviewers", kind: "multi", value: [], placeholder: "none", group: "people and tags", half: true, options: () => this.people(false) },
      {
        id: "assignees", label: "assignees", kind: "multi", value: [], placeholder: "none", half: true,
        display: (v) => (v === "@me" ? this.choices?.me ?? "me" : v), options: () => this.people(true),
      },
      {
        id: "labels", label: "labels", kind: "multi", value: [], placeholder: "none", half: true,
        options: () => this.choices?.labels.map((l) => ({ value: l.name, label: l.name, sub: l.description ?? "" })) ?? null,
      },
      {
        id: "milestone", label: "milestone", kind: "choice", value: "", placeholder: "none", half: true,
        options: () => this.choices?.milestones.map((m) => ({ value: m.title, label: m.title, right: m.dueOn ? `due ${m.dueOn.slice(0, 10)}` : "" })) ?? null,
      },
    ];
  }

  /** What's wrong, by field (pr-create.ts prErrors), the commits counted once read for this base and head. */
  check(v: Values): Map<string, string> {
    const f = fieldsOf(v, this.headOwner);
    const r = this.range;
    const e = prErrors(f, { commits: r?.head === f.head && r.base === f.base ? r.commits : null });
    const out = new Map<string, string>();

    if (e.base) out.set("base", e.base);

    if (e.head) out.set("head", e.head);

    if (e.title) out.set("title", e.title);

    return out;
  }

  /** The footer's line: what the pull request will hold, and where it goes. */
  summary(): string {
    const r = this.range, base = this.form.text("base");

    if (!r?.commits) return base ? `into ${base}` : "";

    const n = r.commits.length, files = r.stat?.files.length ?? 0;

    return `${n} commit${n === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"} → ${base}`;
  }

  /** Reviewers can't include you; assignees put you first ("@me"). */
  people(withMe: boolean): Choice[] | null {
    const c = this.choices;

    if (!c) return null;

    const rows = c.users.flatMap((u) => (u.login === c.me ? [] : [{ value: u.login, label: u.login, sub: u.name ?? "" }]));

    return withMe && c.me ? [{ value: "@me", label: c.me, sub: "you" }, ...rows] : rows;
  }

  // ---- reading

  async git(args: readonly string[]): Promise<string> {
    const r = await exec("git", [...args], this.repo.on ? { cwd: this.repo.root, on: this.repo.on, timeout: 30000 } : { cwd: this.repo.root, timeout: 30000 });

    if (r.code === 0) return r.stdout;

    throw new Error(r.stderr.trim().split("\n").pop() || `git ${args[0] ?? ""} failed`);
  }

  /** Everything the form lists, at once; then the commits between base and head. */
  load(cx: Context): void {
    const repo = this.repo, [owner = "", name = ""] = repo.full.split("/");

    const done = () => {
      if (!this.closed) cx.notify();
    };

    this.app.spawn(cx, async () => {
      const cfg = await this.git(["config", "--get-regexp", "^(remote|branch)\\."]).catch(() => "");
      const list = candidates(cfg, repo.branch);

      this.remote = remoteFor(list, this.headRepo, repo.host);
      this.baseRemote = remoteFor(list, repo.full, repo.host) ?? this.remote;
      await this.reread(cx);
    });
    this.app.spawn(cx, async () => {
      const out = await this.git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)", "refs/heads"]).catch(() => "");

      this.local = parseBranches(out);
      done();
    });
    this.app.spawn(cx, async () => {
      const { data } = await api(repo, `repos/${repo.full}/branches?per_page=100`, plain(isNamedList)).catch(() => ({ data: [] }));
      const names = (data ?? []).map((b) => b.name);

      // The default branch first, the rest as GitHub sorts them.
      this.remoteBranches = repo.base && names.includes(repo.base) ? [repo.base, ...names.filter((n) => n !== repo.base)] : names;
      done();
    });
    this.app.spawn(cx, async () => {
      const d = await graphql(repo, CHOICES, isPrChoices, [["owner", owner], ["name", name]], { partial: true }).catch(() => null);
      const r = d?.repository;

      this.choices = {
        me: d?.viewer?.login ?? null,
        users: r?.assignableUsers?.nodes ?? [], labels: r?.labels?.nodes ?? [], milestones: r?.milestones?.nodes ?? [],
      };
      done();
    });
    this.app.spawn(cx, async () => {
      const files = await this.git(["ls-files", "--", ":(icase)pull_request_template*", ":(icase).github/pull_request_template*", ":(icase)docs/pull_request_template*"]).catch(() => "");

      this.templates = templatesIn(files.split("\n").filter(Boolean));

      const [first] = this.templates;

      if (first === undefined) return;

      this.template = await this.git(["show", `HEAD:${first}`]).catch(() => "");
      this.fill();
      done();
    });
  }

  /** Base or head changed: what's between them, whether head is on GitHub, and the fill. */
  async reread(cx: Context): Promise<void> {
    const base = this.form.text("base"), head = this.form.text("head");
    const gen = ++this.gen;

    this.range = base && head ? { base, head, commits: null, stat: null, error: "" } : null;
    this.headState = null;
    cx.notify();

    if (!base || !head) return;

    const baseRef = await this.baseRef(base);
    const failed = (cause: unknown) => ({ error: cause instanceof Error ? cause.message : String(cause) });

    const [log, stat, onRemote] = await Promise.all([
      baseRef ? this.git(["log", "--format=%H%x1f%s%x1f%b%x1e", "-n", "200", `${baseRef}..${head}`]).catch(failed) : { error: `${base} isn't fetched here: fetch to see the commits.` },
      baseRef ? this.git(["diff", "--numstat", `${baseRef}...${head}`]).catch(() => "") : "",
      api(this.repo, `repos/${this.headRepo}/branches/${encodeURIComponent(head)}`, plain(isNamed), { fresh: true })
        .then(() => true)
        .catch((cause: unknown) => (cause instanceof Error && /not found|404/i.test(cause.message) ? false : null)),
    ]);

    if (gen !== this.gen || this.closed) return;

    this.range = { base, head, commits: isString(log) ? parseLog(log) : null, stat: parseNumstat(stat), error: isString(log) ? "" : log.error };
    this.headState = { head, onRemote };
    this.fill();
    this.syncPush();
    cx.notify();
  }

  /** Where base is in this clone: the remote's copy, else a local branch of that name. */
  async baseRef(base: string): Promise<string | null> {
    const tries = [...(this.baseRemote ? [`refs/remotes/${this.baseRemote}/${base}`] : []), `refs/heads/${base}`];

    for (const ref of tries) {
      const ok = await this.git(["rev-parse", "--verify", "--quiet", ref]).then(() => true).catch(() => false);

      if (ok) return ref.replace(/^refs\/(remotes|heads)\//, "");
    }

    return null;
  }

  /** Title and body from the commits (and the template), until the person writes their own. */
  fill(): void {
    const r = this.range;
    const f = fillFrom(r?.commits ?? [], this.form.text("head"));

    if (r?.commits) this.form.set("title", f.title);

    this.form.set("body", startBody(this.template, r?.commits ? f.body : ""));
  }

  /** The push toggle, there only while head needs pushing. */
  plan(): PushPlan | null {
    const head = this.form.text("head"), s = this.headState;

    if (!s || s.head !== head || s.onRemote === null) return null;

    const b = this.local?.find((x) => x.name === head);

    if (!b) return null; // only on the remote: nothing to push

    const tracking = Boolean(this.remote && b.upstream === `${this.remote}/${head}`);

    return pushPlan({ remote: this.remote, head, onRemote: s.onRemote, ahead: tracking ? b.ahead : 0, tracking });
  }

  /** The push toggle goes right after draft, in the options (the side panel says why it's there). */
  syncPush(): void {
    const plan = this.plan();
    const list = this.form.fields.filter((f) => f.id !== "push");

    if (plan) list.splice(list.findIndex((f) => f.id === "draft") + 1, 0, { id: "push", label: "push first", kind: "toggle", value: true, note: shellLine("git", plan.args), hint: plan.why });

    this.form.setFields(list);
  }

  // ---- sending

  commands(): Command[] {
    const v = this.form.values(), plan = this.plan();
    const f = fieldsOf(v, this.headOwner);
    const out: Command[] = [];

    if (plan && flagIn(v, "push")) out.push({ label: `push ${f.head} (${plan.why})`, line: shellLine("git", plan.args) });

    const args = [...prArgs(f), "-R", this.repo.full];

    out.push({ label: `open the pull request on ${this.repo.full}`, line: shellLine("gh", args) });

    return out;
  }

  async send(): Promise<Outcome<Created>> {
    const v = this.form.values(), plan = this.plan();

    if (plan && flagIn(v, "push")) {
      const where = this.repo.on ? { cwd: this.repo.root, on: this.repo.on, timeout: 180000 } : { cwd: this.repo.root, timeout: 180000 };
      const r = await exec("git", [...plan.args], where);

      if (r.code !== 0) return { ok: false, err: `git push: ${r.stderr.trim().split("\n").filter(Boolean).pop() ?? "failed"}` };
    }

    const r = await ghRun(this.repo, prArgs(fieldsOf(v, this.headOwner)), { timeout: 120000 });

    if (!r.ok) return { ok: false, err: r.err };

    return { ok: true, number: createdNumber(r.out), url: r.out.trim() };
  }

  // ---- beside the form

  side(t: Theme, _size: Size): Element {
    const r = this.range, plan = this.plan();
    const commits = r?.commits ?? [];
    const right = !r ? "" : r.commits ? `${commits.length} commit${commits.length === 1 ? "" : "s"} · ${r.stat?.files.length ?? 0} files` : "reading…";
    let body: Element;

    if (!r) body = empty(t, "Pick base and head", "The commits between them show here.", { small: true });
    else if (r.error) body = empty(t, "Can't compare yet", r.error, { small: true });
    else if (!r.commits) body = empty(t, "Reading the commits…", null, { small: true });
    else if (!commits.length) body = empty(t, "Nothing to merge", `${r.head} has no commits that ${r.base} doesn't.`, { small: true });
    else {
      const stat = r.stat ?? { files: [], add: 0, del: 0 };
      const fileRows = stat.files.slice(0, 40);

      body = v_flex().id("pr-side").size_full().overflow_y_scroll().px(10).py(8).gap(2).text_size(11)
        .child(h_flex().gap(6).pb(6).items_center()
          .child(div().text_color(t.ansi5).child(r.head)).child(div().text_color(t.dim).child("→")).child(div().text_color(t.ansi4).child(r.base))
          .child(div().flex_1())
          .child(div().text_color(t.ansi2).child(`+${stat.add}`)).child(div().text_color(t.ansi1).child(`-${stat.del}`)))
        .when(Boolean(plan), (el) => el.child(h_flex().relative().mb(6).px(8).py(5).gap(8).items_start()
          .child(div().absolute().inset_0().opacity(0.5).child(dither(`${t.ansi3}55`, 1)))
          .child(div().relative().flex_1().min_w(0).text_color(t.foreground).child(`${plan?.why ?? ""}: "push first" sends it before the pull request is made.`))))
        .children([...commits].reverse().map((c, i) => h_flex().id(`pc-${i}`).h(18).gap(8).items_center()
          .child(div().flex_none().text_color(t.ansi8).child(c.sha.slice(0, 7)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(c.subject))))
        .child(div().relative().h(2).my(8).child(dither(t.ansi0, 1)))
        .children(fileRows.map((f, i) => h_flex().id(`pf-${i}`).h(18).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
          .child(div().flex_none().text_color(f.binary ? t.dim : t.ansi2).child(f.binary ? "bin" : `+${f.add}`))
          .when(!f.binary, (el) => el.child(div().flex_none().w(36).text_color(t.ansi1).child(`-${f.del}`)))))
        .when(stat.files.length > fileRows.length, (el) => el.child(div().pt(4).text_color(t.dim).child(`and ${stat.files.length - fileRows.length} more files`)))
        .when(Boolean(this.templates.length), (el) => el.child(div().pt(10).text_color(t.dim).child(`The body starts from ${this.templates[0] ?? ""}.`)));
    }

    return panel(t, "pr-side-panel", "Will include", false, body, { right }).size_full();
  }
}
