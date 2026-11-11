// Running a workflow by hand (n on the Actions tab, its "run workflow"
// button, a right-click, the palette): a form (form.js) with the workflow
// (only those with a workflow_dispatch trigger), the ref (a branch or tag)
// and the workflow's inputs as that ref's file declares them: text, a
// number, a list for a choice or an environment, a toggle for a boolean,
// defaults filled and required ones checked. The last step shows the exact
// `gh workflow run`; once it's sent the window waits for the run to show
// up in the list and selects it.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { ghJson, ghRun, api, fileAt } from "./gh.js";
import { slug } from "./remotes.js";
import { dispatchOf, startValue, inputError, dispatchArgs, newRun, shellLine, workflowFile } from "./dispatch.js";
import { Form } from "./form.js";
import { panel, empty, band } from "./kit.js";

const KIND = { string: "text", number: "number", boolean: "toggle", choice: "choice", environment: "choice" };
const WAIT = 2000, WAIT_FOR = 120000; // how often, and how long, to look for the new run

export class DispatchForm {
  /** `path`: the workflow to start on (the selected run's), when it can be run by hand. */
  constructor(app, actions, { path = null } = {}) {
    this.app = app; this.actions = actions;
    const repo = (this.repo = app.repo);
    this.want = path;
    this.workflows = null; // [{ id, name, path, inputs }] that can be run by hand
    this.listError = "";
    this.refs = null; // [{ name, kind: "branch" | "tag" }]
    this.envs = null; // environment names, read when an input wants one
    this.inputs = null; // the chosen workflow's inputs at the chosen ref, [] for none
    this.inputsFor = ""; // `${path}@${ref}` they were read for
    this.inputsError = "";
    this.gen = 0;
    this.form = new Form(app, {
      title: "Run a workflow",
      right: () => repo.full,
      sendWord: "Run workflow",
      confirmTitle: "Run this workflow?",
      confirmNote: () => "Once GitHub takes it, the run shows in the list and is selected.",
      fields: this.fields(),
      side: (t, size) => this.side(t, size),
      check: (v) => this.check(v),
      commands: () => this.commands(),
      send: () => this.send(),
      done: (r, cx) => this.wait(r, cx),
      cancel: () => actions.closeForm(),
    });
  }

  workflow() { return this.workflows?.find((w) => w.path === this.form?.value("workflow")) ?? null; }

  fields() {
    const base = [
      { id: "workflow", label: "workflow", kind: "choice", value: "", required: true,
        display: (path) => { const w = this.workflows?.find((x) => x.path === path); return w ? `${w.name} · ${workflowFile(w.path)}` : String(path ?? ""); },
        options: () => this.workflows?.map((w) => ({ value: w.path, label: w.name, sub: workflowFile(w.path), right: w.inputs.length ? `${w.inputs.length} input${w.inputs.length === 1 ? "" : "s"}` : "" })) ?? null,
        onChange: (_v, cx) => this.reread(cx) },
      { id: "ref", label: "ref", kind: "choice", value: this.repo.base ?? "", required: true, free: true, hint: "the branch or tag whose workflow file runs",
        options: () => this.refs?.map((r) => ({ value: r.name, label: r.name, sub: r.kind === "tag" ? "tag" : r.name === this.repo.base ? "default branch" : r.name === this.repo.branch ? "your branch" : "" })) ?? null,
        onChange: (_v, cx) => this.reread(cx) },
    ];
    const w = this.workflow();
    if (!w || !this.inputs) return base;
    return [...base, ...this.inputs.map((i) => {
      const kind = KIND[i.type] ?? "text";
      const f = { id: `in:${w.id}:${i.name}`, name: i.name, spec: i, label: i.name, kind, required: i.required && i.type !== "boolean",
        value: startValue(i), hint: [i.description, i.type === "number" ? "a number" : i.type === "environment" ? "an environment" : ""].filter(Boolean).join(" · ") };
      if (kind === "toggle") { f.note = i.description || "on / off"; f.hint = ""; }
      if (i.type === "choice") f.options = () => i.options.map((o) => ({ value: o, label: o, right: o === String(i.default ?? "") ? "default" : "" }));
      if (i.type === "environment") { f.free = true; f.options = () => this.envs?.map((e) => ({ value: e, label: e })) ?? null; }
      return f;
    })];
  }

  // ---- reading

  load(cx) {
    const repo = this.repo;
    this.app.spawn(cx, async () => {
      try {
        const list = (await ghJson(repo, ["workflow", "list", "--json", "id,name,path,state", "--limit", "100"])) ?? [];
        const read = await Promise.all(list.filter((w) => w.state === "active" && w.path).map(async (w) => {
          const yaml = await fileAt(repo, w.path, repo.base ?? "HEAD");
          const d = yaml ? dispatchOf(yaml) : null;
          return d ? { id: w.id, name: w.name, path: w.path, inputs: d.inputs } : null;
        }));
        this.workflows = read.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
      } catch (e) {
        this.workflows = []; this.listError = String(e?.message ?? e);
      }
      if (this.closed) return;
      const first = this.workflows.find((w) => w.path === this.want) ?? (this.workflows.length === 1 ? this.workflows[0] : null);
      if (first && !this.form.value("workflow")) { this.form.set("workflow", first.path); await this.reread(cx); }
    });
    this.app.spawn(cx, async () => {
      const [b, t] = await Promise.all([
        api(repo, `repos/${repo.full}/branches?per_page=100`).catch(() => ({ data: [] })),
        api(repo, `repos/${repo.full}/tags?per_page=100`).catch(() => ({ data: [] })),
      ]);
      const names = (b.data ?? []).map((x) => x.name);
      const order = [repo.base, repo.branch].filter((n, i, a) => n && names.includes(n) && a.indexOf(n) === i);
      this.refs = [...order, ...names.filter((n) => !order.includes(n))].map((name) => ({ name, kind: "branch" }))
        .concat((t.data ?? []).map((x) => ({ name: x.name, kind: "tag" })));
      // Your branch when GitHub has it (and you didn't pick another meanwhile).
      if (repo.branch && names.includes(repo.branch) && !this.form.field("ref")?.touched && this.form.value("ref") !== repo.branch) {
        this.form.set("ref", repo.branch);
        await this.reread(cx);
      }
    });
  }

  /** The workflow or the ref changed: its inputs as that ref's file has them. */
  async reread(cx) {
    const w = this.workflow(), ref = String(this.form.value("ref") ?? "").trim();
    const key = w && ref ? `${w.path}@${ref}` : "";
    if (key === this.inputsFor) return;
    const gen = ++this.gen;
    this.inputsFor = key; this.inputs = null; this.inputsError = "";
    this.form.setFields(this.fields());
    cx?.notify?.();
    if (!key) return;
    const yaml = await fileAt(this.repo, w.path, ref);
    if (gen !== this.gen || this.closed) return;
    const d = yaml ? dispatchOf(yaml) : null;
    if (!yaml) { this.inputsError = `${ref} has no ${w.path}, or GitHub has no ref ${ref}.`; this.inputs = []; }
    else if (!d) { this.inputsError = `At ${ref}, ${workflowFile(w.path)} can't be run by hand (no workflow_dispatch).`; this.inputs = []; }
    else this.inputs = d.inputs;
    this.form.setFields(this.fields());
    if (this.inputs.some((i) => i.type === "environment") && !this.envs) {
      const { data } = await api(this.repo, `repos/${this.repo.full}/environments`).catch(() => ({ data: null }));
      this.envs = (data?.environments ?? []).map((e) => e.name);
    }
    cx?.notify?.();
  }

  check(v) {
    const e = {};
    if (!v.workflow) e.workflow = this.workflows?.length === 0 ? "No workflow here can be run by hand." : "Pick a workflow.";
    if (!String(v.ref ?? "").trim()) e.ref = "Pick a branch or tag.";
    if (e.workflow || e.ref) return e;
    if (this.inputs == null) e.workflow = "Still reading its inputs…";
    else if (this.inputsError) e.ref = this.inputsError;
    for (const f of this.form.fields) if (f.spec) { const why = inputError(f.spec, f.value, this.envs); if (why) e[f.id] = why; }
    return e;
  }

  args() {
    const w = this.workflow(), values = {};
    for (const f of this.form.fields) if (f.spec) values[f.name] = f.value;
    return dispatchArgs(w, String(this.form.value("ref")).trim(), this.inputs ?? [], values);
  }

  commands() {
    const w = this.workflow();
    if (!w) return [];
    return [{ label: `run ${w.name} on ${String(this.form.value("ref")).trim()}`, line: shellLine("gh", [...this.args(), "-R", slug(this.repo)]) }];
  }

  // ---- sending, then finding the run

  runsOf(w) {
    return api(this.repo, `repos/${this.repo.full}/actions/workflows/${w.id}/runs?event=workflow_dispatch&per_page=20`, { fresh: true })
      .then((r) => r.data?.workflow_runs ?? []).catch(() => []);
  }

  async send() {
    const w = this.workflow(), ref = String(this.form.value("ref")).trim();
    const known = (await this.runsOf(w)).map((r) => r.id);
    const since = Date.now();
    const r = await ghRun(this.repo, this.args(), { timeout: 60000 });
    return r.ok ? { ok: true, workflow: w, ref, since, known } : r;
  }

  /** Sent: the form goes; the run is looked for every couple of seconds and selected when GitHub lists it. */
  wait(r, cx) {
    const a = this.actions;
    a.closeForm();
    a.waiting = { name: r.workflow.name, ref: r.ref, since: r.since };
    this.app.note = { text: `Started ${r.workflow.name} on ${r.ref}; waiting for its run…`, tone: "working", at: Date.now() };
    this.app.spawn(cx, async () => {
      while (Date.now() - r.since < WAIT_FOR && !this.app.closed && a.waiting?.since === r.since) {
        await new Promise((ok) => cx.timer.after(WAIT, () => ok()));
        const run = newRun(await this.runsOf(r.workflow), r);
        if (!run) continue;
        a.waiting = null;
        this.app.note = { text: `${r.workflow.name} #${run.run_number} is ${run.status === "queued" ? "queued" : "running"}.`, tone: "done", at: Date.now() };
        a.show(run.id, null, cx);
        a.focus = "runs";
        return;
      }
      if (a.waiting?.since === r.since) {
        a.waiting = null;
        this.app.note = { text: `GitHub took it, but its run hasn't shown up yet: r reads again.`, tone: "working", at: Date.now() };
      }
    });
  }

  // ---- beside the form

  side(t) {
    const list = this.workflows, cur = this.workflow();
    let body;
    if (!list) body = empty(t, "Reading the workflows…", "Only those with a workflow_dispatch trigger can be run by hand.", { small: true });
    else if (!list.length) body = empty(t, "Nothing to run by hand", this.listError || "No active workflow here has a workflow_dispatch trigger.", { small: true });
    else {
      body = v_flex().id("wf-side").size_full().overflow_y_scroll().py(4).text_size(11)
        .children(list.map((w, i) => h_flex().id(`wf-${i}`).relative().h(32).flex_none().px(10).gap(8).items_center().cursor_pointer()
          .hover((s) => s.bg(t.ansi0 + "55"))
          .when(w === cur, (el) => el.children(band(t, false)))
          .on_click((_e, cx) => { this.form.set("workflow", w.path, { force: true }); this.form.field("workflow").touched = true; this.reread(cx); cx.notify(); })
          .child(v_flex().relative().flex_1().min_w(0)
            .child(div().truncate().text_color(w === cur ? t.foreground : t.muted).child(w.name))
            .child(div().truncate().text_size(10).text_color(t.dim).child(w.path)))
          .child(div().relative().flex_none().text_size(10).text_color(t.dim).child(w.inputs.length ? `${w.inputs.length} in` : ""))))
        .when(Boolean(cur), (el) => el.child(v_flex().px(10).pt(10).gap(3)
          .child(div().text_color(t.ansi8).child(this.inputs == null ? `Reading its inputs at ${this.form.value("ref")}…` : this.inputsError ? "" : this.inputs.length ? `Inputs at ${this.form.value("ref")}` : "No inputs: it runs as it is."))
          .when(Boolean(this.inputsError), (e2) => e2.child(div().text_color(t.blocked).child(this.inputsError)))
          .children((this.inputs ?? []).map((i, k) => h_flex().id(`wfi-${k}`).gap(8)
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(i.name))
            .child(div().flex_none().text_color(t.dim).child(`${i.type}${i.required ? " · required" : ""}`))))));
    }
    return panel(t, "wf-side-panel", "Can be run by hand", false, body, { right: list ? `${list.length}` : "" }).size_full();
  }
}
