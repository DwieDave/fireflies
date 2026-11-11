// A new pull request (n on the Pull requests tab, its "+ new" button, a
// right-click, the palette, or the git window's branches panel): a form
// (form.js) with base and head, title and body filled like
// `gh pr create --fill` (the body from the repo's pull request template when
// it has one), draft, reviewers, assignees, labels and milestone. Beside it:
// the commits and files the pull request will hold. When head isn't on
// GitHub (or is ahead of it), a "push first" toggle adds `git push` before
// `gh pr create`. The last step shows both commands; nothing runs before it.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec } from "herdr";
import { ghRun, api, graphql } from "./gh.js";
import { candidates } from "./remotes.js";
import { fillFrom, templatesIn, startBody, parseLog, parseNumstat, parseBranches, remoteFor, pushPlan, prErrors, prArgs, createdNumber } from "./pr-create.js";
import { shellLine } from "./dispatch.js";
import { Form } from "./form.js";
import { panel, empty, dither } from "./kit.js";

const CHOICES = `query($owner: String!, $name: String!) { viewer { login }
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) { nodes { login name } }
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name description } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { title dueOn } } } }`;

export class PrForm {
  /** `head`: the branch to start from (the git window's pick), else the folder's current one. */
  constructor(app, prs, { head = null } = {}) {
    this.app = app; this.prs = prs;
    const repo = (this.repo = app.repo);
    // From a fork shown as its parent (p): the head lives in the fork.
    this.headRepo = repo.child ?? repo.full;
    this.headOwner = repo.child ? repo.child.split("/")[0] : null;
    this.local = null; // [{ name, upstream, ahead, ... }]
    this.remoteBranches = null; // names on GitHub (the base repo)
    this.choices = null; // { me, users, labels, milestones }
    this.templates = []; this.template = "";
    this.range = null; // { base, head, commits, stat, error }
    this.headState = null; // { head, onRemote }
    this.remote = null; this.baseRemote = null;
    this.gen = 0;
    this.form = new Form(app, {
      title: "New pull request",
      right: () => repo.full,
      sendWord: "Create pull request",
      confirmTitle: "Create this pull request?",
      fields: this.fields(head ?? repo.branch ?? "", repo.base ?? ""),
      side: (t, size) => this.side(t, size),
      check: (v) => prErrors({ ...v, headOwner: this.headOwner }, { commits: this.range?.head === v.head && this.range?.base === v.base ? this.range.commits : null }),
      commands: () => this.commands(),
      send: (cx) => this.send(cx),
      done: (r, cx) => prs.created(r.number, cx),
      cancel: () => prs.closeForm(),
    });
  }

  fields(head, base) {
    const branchRow = (name, where) => ({ value: name, label: name, sub: where });
    return [
      { id: "base", label: "base", kind: "choice", value: base, required: true, hint: `merged into, on ${this.repo.full}`,
        options: () => this.remoteBranches?.map((b) => branchRow(b, b === this.repo.base ? "default branch" : "")) ?? null,
        onChange: (_v, cx) => this.reread(cx) },
      { id: "head", label: "head", kind: "choice", value: head, required: true, free: true, hint: this.headOwner ? `from your fork, ${this.headRepo}` : "the branch with the changes",
        options: () => this.local?.map((b) => branchRow(b.name, b.upstream ? `${b.upstream}${b.ahead ? ` · ${b.ahead} to push` : ""}` : "not pushed")) ?? null,
        onChange: (_v, cx) => this.reread(cx) },
      { id: "title", label: "title", kind: "text", value: "", required: true, placeholder: "what this pull request does" },
      { id: "body", label: "body", kind: "area", value: "", placeholder: "markdown: why, and how to check it" },
      { id: "draft", label: "draft", kind: "toggle", value: false, note: "open it as a draft" },
      { id: "reviewers", label: "reviewers", kind: "multi", value: [], placeholder: "none", options: () => this.people(false) },
      { id: "assignees", label: "assignees", kind: "multi", value: [], placeholder: "none", options: () => this.people(true) },
      { id: "labels", label: "labels", kind: "multi", value: [], placeholder: "none", options: () => this.choices?.labels.map((l) => ({ value: l.name, label: l.name, sub: l.description ?? "" })) ?? null },
      { id: "milestone", label: "milestone", kind: "choice", value: "", placeholder: "none", options: () => this.choices?.milestones.map((m) => ({ value: m.title, label: m.title, right: m.dueOn ? `due ${m.dueOn.slice(0, 10)}` : "" })) ?? null },
    ];
  }

  /** Reviewers can't include you; assignees put you first ("@me"). */
  people(withMe) {
    const c = this.choices;
    if (!c) return null;
    const rows = c.users.filter((u) => u.login !== c.me).map((u) => ({ value: u.login, label: u.login, sub: u.name ?? "" }));
    return withMe && c.me ? [{ value: "@me", label: c.me, sub: "you" }, ...rows] : rows;
  }

  // ---- reading

  git(args) {
    return exec("git", args, { cwd: this.repo.root, on: this.repo.on ?? undefined, timeout: 30000 })
      .then((r) => (r.code === 0 ? r.stdout : Promise.reject(new Error(r.stderr.trim().split("\n").pop() || `git ${args[0]} failed`))));
  }

  /** Everything the form lists, at once; then the commits between base and head. */
  load(cx) {
    const repo = this.repo, [owner, name] = repo.full.split("/");
    const done = () => { if (!this.closed) cx?.notify?.(); };
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
      const { data } = await api(repo, `repos/${repo.full}/branches?per_page=100`).catch(() => ({ data: [] }));
      const names = (data ?? []).map((b) => b.name);
      // The default branch first, the rest as GitHub sorts them.
      this.remoteBranches = repo.base && names.includes(repo.base) ? [repo.base, ...names.filter((n) => n !== repo.base)] : names;
      done();
    });
    this.app.spawn(cx, async () => {
      const d = await graphql(repo, CHOICES, { owner, name }, { partial: true }).catch(() => null);
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
      if (!this.templates.length) return;
      this.template = await this.git(["show", `HEAD:${this.templates[0]}`]).catch(() => "");
      this.fill();
      done();
    });
  }

  /** Base or head changed: what's between them, whether head is on GitHub, and the fill. */
  async reread(cx) {
    const { base, head } = this.form.values();
    const gen = ++this.gen;
    this.range = base && head ? { base, head, commits: null, stat: null, error: "" } : null;
    this.headState = null;
    cx?.notify?.();
    if (!base || !head) return;
    const baseRef = await this.baseRef(base);
    const [log, stat, onRemote] = await Promise.all([
      baseRef ? this.git(["log", "--format=%H%x1f%s%x1f%b%x1e", "-n", "200", `${baseRef}..${head}`]).catch((e) => ({ error: e.message })) : { error: `${base} isn't fetched here: fetch to see the commits.` },
      baseRef ? this.git(["diff", "--numstat", `${baseRef}...${head}`]).catch(() => "") : "",
      api(this.repo, `repos/${this.headRepo}/branches/${encodeURIComponent(head)}`, { fresh: true }).then(() => true).catch((e) => (/not found|404/i.test(e.message) ? false : null)),
    ]);
    if (gen !== this.gen || this.closed) return;
    const commits = typeof log === "string" ? parseLog(log) : null;
    this.range = { base, head, commits, stat: parseNumstat(stat), error: log?.error ?? "" };
    this.headState = { head, onRemote };
    this.fill();
    this.syncPush();
    cx?.notify?.();
  }

  /** Where base is in this clone: the remote's copy, else a local branch of that name. */
  async baseRef(base) {
    const tries = [this.baseRemote && `refs/remotes/${this.baseRemote}/${base}`, `refs/heads/${base}`].filter(Boolean);
    for (const ref of tries) {
      const ok = await this.git(["rev-parse", "--verify", "--quiet", ref]).then(() => true).catch(() => false);
      if (ok) return ref.replace(/^refs\/(remotes|heads)\//, "");
    }
    return null;
  }

  /** Title and body from the commits (and the template), until the person writes their own. */
  fill() {
    const r = this.range;
    const f = fillFrom(r?.commits ?? [], this.form.value("head"));
    if (r?.commits) this.form.set("title", f.title);
    this.form.set("body", startBody(this.template, r?.commits ? f.body : ""));
  }

  /** The push toggle, there only while head needs pushing. */
  plan() {
    const head = this.form.value("head"), s = this.headState;
    if (!s || s.head !== head || s.onRemote == null) return null;
    const b = this.local?.find((x) => x.name === head);
    if (!b) return null; // only on the remote: nothing to push
    const tracking = Boolean(this.remote && b.upstream === `${this.remote}/${head}`);
    return pushPlan({ remote: this.remote, head, onRemote: s.onRemote, ahead: tracking ? b.ahead : 0, tracking });
  }

  syncPush() {
    const plan = this.plan();
    const list = this.form.fields.filter((f) => f.id !== "push");
    if (plan) list.push({ id: "push", label: "push first", kind: "toggle", value: true, note: shellLine("git", plan.args), hint: plan.why, tone: "ansi3" });
    this.form.setFields(list);
  }

  // ---- sending

  commands() {
    const v = this.form.values(), plan = this.plan();
    const out = [];
    if (plan && v.push) out.push({ label: `push ${v.head} (${plan.why})`, line: shellLine("git", plan.args), cmd: "git", args: plan.args });
    const args = [...prArgs({ ...v, headOwner: this.headOwner }), "-R", this.repo.full];
    out.push({ label: `open the pull request on ${this.repo.full}`, line: shellLine("gh", args), cmd: "gh", args });
    return out;
  }

  async send() {
    const v = this.form.values(), plan = this.plan();
    if (plan && v.push) {
      const r = await exec("git", plan.args, { cwd: this.repo.root, on: this.repo.on ?? undefined, timeout: 180000 });
      if (r.code !== 0) return { ok: false, err: `git push: ${r.stderr.trim().split("\n").filter(Boolean).pop() ?? "failed"}` };
    }
    const r = await ghRun(this.repo, prArgs({ ...v, headOwner: this.headOwner }), { timeout: 120000 });
    if (!r.ok) return r;
    return { ok: true, number: createdNumber(r.out), url: r.out.trim() };
  }

  // ---- beside the form

  side(t, size) {
    const r = this.range, plan = this.plan();
    const commits = r?.commits ?? [];
    const right = !r ? "" : r.commits ? `${commits.length} commit${commits.length === 1 ? "" : "s"} · ${r.stat?.files.length ?? 0} files` : "reading…";
    let body;
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
          .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi3 + "55", 1)))
          .child(div().relative().flex_1().min_w(0).text_color(t.foreground).child(`${plan.why}: "push first" sends it before the pull request is made.`))))
        .children([...commits].reverse().map((c, i) => h_flex().id(`pc-${i}`).h(18).gap(8).items_center()
          .child(div().flex_none().text_color(t.ansi8).child(c.sha.slice(0, 7)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(c.subject))))
        .child(div().relative().h(2).my(8).child(dither(t.ansi0, 1)))
        .children(fileRows.map((f, i) => h_flex().id(`pf-${i}`).h(18).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
          .child(div().flex_none().text_color(f.binary ? t.dim : t.ansi2).child(f.binary ? "bin" : `+${f.add}`))
          .when(!f.binary, (el) => el.child(div().flex_none().w(36).text_color(t.ansi1).child(`-${f.del}`)))))
        .when(stat.files.length > fileRows.length, (el) => el.child(div().pt(4).text_color(t.dim).child(`and ${stat.files.length - fileRows.length} more files`)))
        .when(Boolean(this.templates.length), (el) => el.child(div().pt(10).text_color(t.dim).child(`The body starts from ${this.templates[0]}.`)));
    }
    return panel(t, "pr-side-panel", "Will include", false, body, { right }).size_full();
  }
}
