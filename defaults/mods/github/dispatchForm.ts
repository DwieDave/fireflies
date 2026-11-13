// Running a workflow by hand (n on the Actions tab, its "run workflow"
// button, a right-click, the palette): a form (form.ts) with the workflow
// (only those with a workflow_dispatch trigger), the ref (a branch or tag)
// and the workflow's inputs as that ref's file declares them: text, a
// number, a list for a choice or an environment, a toggle for a boolean,
// defaults filled and required ones checked. The last step shows the exact
// `gh workflow run`; once it's sent the window waits for the run to show
// up in the list and selects it.

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { isString } from "./guard.ts";
import type { Repo } from "./gh.ts";
import { ghJson, ghRun, api, fileAt, plain } from "./gh.ts";
import type { Run } from "./model.ts";
import { isEnvironments, isNamedList, isRunList, isWorkflows } from "./model.ts";
import { slug } from "./remotes.ts";
import type { Input, InputType } from "./dispatch.ts";
import { dispatchOf, startValue, inputError, dispatchArgs, newRun, shellLine, workflowFile } from "./dispatch.ts";
import type { Command, Field, FormHost, Outcome, Values } from "./form-fields.ts";
import { textIn } from "./form-fields.ts";
import { Form } from "./form.ts";
import type { Note } from "./kit.ts";
import { panel, empty, band, noteOf } from "./kit.ts";

const WAIT = 2000, WAIT_FOR = 120000; // how often, and how long, to look for the new run

/** A field's kind for an input's type. */
function kindOf(type: InputType): "text" | "number" | "toggle" | "choice" {
  switch (type) {
    case "number": return "number";
    case "boolean": return "toggle";
    case "choice":
    case "environment": return "choice";
    default: return "text";
  }
}

/** A workflow that can be run by hand, with its inputs at the default branch. */
interface Runnable {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly inputs: readonly Input[];
}

/** A branch or a tag to run on. */
interface Ref {
  readonly name: string;
  readonly kind: "branch" | "tag";
}

/** A dispatch GitHub took: the workflow, the ref, when, and the runs there before it. */
export interface Dispatched {
  readonly workflow: Runnable;
  readonly ref: string;
  readonly since: number;
  readonly known: readonly number[];
}

/** A dispatch sent and its run not listed yet. */
export interface Waiting {
  readonly name: string;
  readonly ref: string;
  readonly since: number;
}

/** What the form asks of the window beyond a form's: its note, and whether it closed. */
export interface DispatchHost extends FormHost {
  note: Note | null;
  readonly closed?: boolean;
}

/** What the form asks of the Actions tab: the form gone, the run waited for, then shown. */
export interface DispatchTab {
  closeForm(): void;
  waiting: Waiting | null;
  focus: string;
  show(runId: number, jobId: number | null, cx: Context): void;
}

export class DispatchForm {
  readonly app: DispatchHost;
  readonly actions: DispatchTab;
  readonly repo: Repo;
  readonly want: string | null;

  /** The workflows that can be run by hand. */
  workflows: Runnable[] | null = null;
  listError = "";
  refs: Ref[] | null = null;

  /** Environment names, read when an input wants one. */
  envs: string[] | null = null;

  /** The chosen workflow's inputs at the chosen ref, [] for none. */
  inputs: readonly Input[] | null = null;

  /** `${path}@${ref}` they were read for. */
  inputsFor = "";
  inputsError = "";

  /** Each input field's input (by field id). */
  specs = new Map<string, Input>();
  gen = 0;
  closed = false;
  readonly form: Form<Dispatched>;

  /** `path`: the workflow to start on (the selected run's), when it can be run by hand. */
  constructor(app: DispatchHost, actions: DispatchTab, repo: Repo, { path = null }: { readonly path?: string | null } = {}) {
    this.app = app;
    this.actions = actions;
    this.repo = repo;
    this.want = path;
    this.form = new Form<Dispatched>(app, {
      title: "Run a workflow",
      sendWord: "Run workflow",
      confirmTitle: "Run this workflow?",
      confirmNote: () => "Once GitHub takes it, the run shows in the list and is selected.",
      side: (t) => this.side(t),
      summary: () => this.summary(),
      check: (v) => this.check(v),
      commands: () => this.commands(),
      send: () => this.send(),
      done: (r, cx) => this.wait(r, cx),
      cancel: () => actions.closeForm(),
    });
    this.form.setFields(this.fields());
  }

  workflow(): Runnable | null {
    const path = this.form.text("workflow");

    return this.workflows?.find((w) => w.path === path) ?? null;
  }

  /** The ref, as typed or picked. */
  ref(): string {
    return this.form.text("ref").trim();
  }

  fields(): Field[] {
    const w = this.workflow();

    const base: Field[] = [
      {
        id: "workflow", label: "workflow", kind: "choice", value: "", required: true, group: "what runs", pair: true, join: "@",
        hint: w ? workflowFile(w.path) : "",
        display: (path) => this.workflows?.find((x) => x.path === path)?.name ?? path,
        options: () => this.workflows?.map((x) => ({ value: x.path, label: x.name, sub: workflowFile(x.path), right: x.inputs.length ? `${x.inputs.length} input${x.inputs.length === 1 ? "" : "s"}` : "" })) ?? null,
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
      {
        id: "ref", label: "ref", kind: "choice", value: this.repo.base ?? "", required: true, free: true, hint: "branch or tag",
        options: () => this.refs?.map((r) => ({ value: r.name, label: r.name, sub: r.kind === "tag" ? "tag" : r.name === this.repo.base ? "default branch" : r.name === this.repo.branch ? "your branch" : "" })) ?? null,
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
    ];

    this.specs = new Map();

    if (!w || !this.inputs) return base;

    // The inputs as the file orders them, in one section: lists and numbers two to a row, text full width.
    const group = `inputs · ${this.inputs.length}`;

    return [...base, ...this.inputs.map((i): Field => {
      const id = `in:${w.id}:${i.name}`;
      const kind = kindOf(i.type);
      const start = startValue(i);
      const hint = [i.description, i.type === "number" ? "a number" : i.type === "environment" ? "an environment" : ""].filter(Boolean).join(" · ");

      this.specs.set(id, i);

      if (kind === "toggle") return { id, label: i.name, kind, required: false, group, half: true, value: start === true, note: i.description || "on / off", hint: "" };

      const value = isString(start) ? start : "";

      if (kind === "text" || kind === "number") return { id, label: i.name, kind, required: i.required, group, half: kind !== "text", value, hint };

      if (i.type === "environment") return { id, label: i.name, kind, required: i.required, group, half: true, value, hint, free: true, options: () => this.envs?.map((e) => ({ value: e, label: e })) ?? null };

      return {
        id, label: i.name, kind, required: i.required, group, half: true, value, hint,
        options: () => i.options.map((o) => ({ value: o, label: o, right: o === String(i.default ?? "") ? "default" : "" })),
      };
    })];
  }

  // ---- reading

  load(cx: Context): void {
    const repo = this.repo;

    this.app.spawn(cx, async () => {
      try {
        const list = (await ghJson(repo, ["workflow", "list", "--json", "id,name,path,state", "--limit", "100"], isWorkflows)) ?? [];

        const read = await Promise.all(list.filter((w) => w.state === "active" && w.path).map(async (w): Promise<Runnable[]> => {
          const yaml = await fileAt(repo, w.path, repo.base ?? "HEAD");
          const d = yaml ? dispatchOf(yaml) : null;

          return d ? [{ id: w.id, name: w.name, path: w.path, inputs: d.inputs }] : [];
        }));

        this.workflows = read.flat().sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        this.workflows = [];
        this.listError = err instanceof Error ? err.message : String(err);
      }

      if (this.closed) return;

      const all = this.workflows;
      const first = all.find((w) => w.path === this.want) ?? (all.length === 1 ? all[0] : null);

      if (first && !this.form.text("workflow")) {
        this.form.set("workflow", first.path);
        await this.reread(cx);
      }
    });

    this.app.spawn(cx, async () => {
      const [b, t] = await Promise.all([
        api(repo, `repos/${repo.full}/branches?per_page=100`, plain(isNamedList)).catch(() => ({ data: [] })),
        api(repo, `repos/${repo.full}/tags?per_page=100`, plain(isNamedList)).catch(() => ({ data: [] })),
      ]);

      const names = (b.data ?? []).map((x) => x.name);
      const order = [repo.base, repo.branch].flatMap((n, i, a) => (n && names.includes(n) && a.indexOf(n) === i ? [n] : []));

      this.refs = [
        ...[...order, ...names.filter((n) => !order.includes(n))].map((name): Ref => ({ name, kind: "branch" })),
        ...(t.data ?? []).map((x): Ref => ({ name: x.name, kind: "tag" })),
      ];

      // Your branch when GitHub has it (and you didn't pick another meanwhile).
      if (repo.branch && names.includes(repo.branch) && !this.form.field("ref")?.touched && this.form.text("ref") !== repo.branch) {
        this.form.set("ref", repo.branch);
        await this.reread(cx);
      }
    });
  }

  /** The workflow or the ref changed: its inputs as that ref's file has them. */
  async reread(cx: Context): Promise<void> {
    const w = this.workflow(), ref = this.ref();
    const key = w && ref ? `${w.path}@${ref}` : "";

    if (key === this.inputsFor) return;

    const gen = ++this.gen;

    this.inputsFor = key;
    this.inputs = null;
    this.inputsError = "";
    this.form.setFields(this.fields());
    cx.notify();

    if (!w || !key) return;

    const yaml = await fileAt(this.repo, w.path, ref);

    if (gen !== this.gen || this.closed) return;

    const d = yaml ? dispatchOf(yaml) : null;

    if (!yaml) {
      this.inputsError = `${ref} has no ${w.path}, or GitHub has no ref ${ref}.`;
      this.inputs = [];
    } else if (!d) {
      this.inputsError = `At ${ref}, ${workflowFile(w.path)} can't be run by hand (no workflow_dispatch).`;
      this.inputs = [];
    } else this.inputs = d.inputs;

    this.form.setFields(this.fields());

    if (this.inputs.some((i) => i.type === "environment") && !this.envs) {
      const { data } = await api(this.repo, `repos/${this.repo.full}/environments`, plain(isEnvironments)).catch(() => ({ data: null }));

      this.envs = (data?.environments ?? []).map((e) => e.name);
    }

    cx.notify();
  }

  /** The footer's line: the command it will run. */
  summary(): string {
    const w = this.workflow(), ref = this.ref();

    if (!w) return this.workflows?.length === 0 ? "nothing here can be run by hand" : "pick a workflow";

    const n = this.inputs?.length ?? 0;

    return `gh workflow run ${workflowFile(w.path)}${ref ? ` --ref ${ref}` : ""}${n ? ` · ${n} input${n === 1 ? "" : "s"}` : ""}`;
  }

  check(v: Values): Map<string, string> {
    const e = new Map<string, string>();

    if (!textIn(v, "workflow")) e.set("workflow", this.workflows?.length === 0 ? "No workflow here can be run by hand." : "Pick a workflow.");

    if (!textIn(v, "ref").trim()) e.set("ref", "Pick a branch or tag.");

    if (e.size) return e;

    if (this.inputs === null) e.set("workflow", "Still reading its inputs…");
    else if (this.inputsError) e.set("ref", this.inputsError);

    for (const f of this.form.fields) {
      const spec = this.specs.get(f.id);

      if (!spec || f.kind === "multi") continue;

      const why = inputError(spec, f.value, this.envs);

      if (why) e.set(f.id, why);
    }

    return e;
  }

  args(): string[] {
    const w = this.workflow();
    const values = new Map<string, string | boolean>();

    for (const f of this.form.fields) {
      const spec = this.specs.get(f.id);

      if (spec && f.kind !== "multi") values.set(spec.name, f.value);
    }

    return w ? dispatchArgs(w, this.ref(), this.inputs ?? [], values) : [];
  }

  commands(): Command[] {
    const w = this.workflow();

    if (!w) return [];

    return [{ label: `run ${w.name} on ${this.ref()}`, line: shellLine("gh", [...this.args(), "-R", slug(this.repo)]) }];
  }

  // ---- sending, then finding the run

  async runsOf(w: Runnable): Promise<readonly Run[]> {
    try {
      const r = await api(this.repo, `repos/${this.repo.full}/actions/workflows/${w.id}/runs?event=workflow_dispatch&per_page=20`, plain(isRunList), { fresh: true });

      return r.data?.workflow_runs ?? [];
    } catch {
      return [];
    }
  }

  async send(): Promise<Outcome<Dispatched>> {
    const w = this.workflow(), ref = this.ref();

    if (!w) return { ok: false, err: "Pick a workflow." };

    const known = (await this.runsOf(w)).map((r) => r.id);
    const since = Date.now();
    const r = await ghRun(this.repo, this.args(), { timeout: 60000 });

    return r.ok ? { ok: true, workflow: w, ref, since, known } : { ok: false, err: r.err };
  }

  /** Sent: the form goes; the run is looked for every couple of seconds and selected when GitHub lists it. */
  wait(r: Dispatched, cx: Context): void {
    const a = this.actions;

    a.closeForm();
    a.waiting = { name: r.workflow.name, ref: r.ref, since: r.since };
    this.app.note = noteOf(`Started ${r.workflow.name} on ${r.ref}; waiting for its run…`, "working");
    this.app.spawn(cx, async () => {
      while (Date.now() - r.since < WAIT_FOR && !this.app.closed && a.waiting?.since === r.since) {
        await new Promise<void>((ok) => cx.timer.after(WAIT, () => ok()));

        const run = newRun(await this.runsOf(r.workflow), r);

        if (!run) continue;

        a.waiting = null;
        this.app.note = noteOf(`${r.workflow.name} #${run.run_number ?? ""} is ${run.status === "queued" ? "queued" : "running"}.`, "done");
        a.show(run.id, null, cx);
        a.focus = "runs";

        return;
      }

      if (a.waiting?.since === r.since) {
        a.waiting = null;
        this.app.note = noteOf("GitHub took it, but its run hasn't shown up yet: r reads again.", "working");
      }
    });
  }

  // ---- beside the form

  side(t: Theme): Element {
    const list = this.workflows, cur = this.workflow();
    const ref = this.form.text("ref");
    let body: Element;

    if (!list) body = empty(t, "Reading the workflows…", "Only those with a workflow_dispatch trigger can be run by hand.", { small: true });
    else if (!list.length) body = empty(t, "Nothing to run by hand", this.listError || "No active workflow here has a workflow_dispatch trigger.", { small: true });
    else {
      body = v_flex().id("wf-side").size_full().overflow_y_scroll().py(4).text_size(11)
        .children(list.map((w, i) => h_flex().id(`wf-${i}`).relative().h(32).flex_none().px(10).gap(8).items_center().cursor_pointer()
          .hover((s) => s.bg(`${t.ansi0}55`))
          .when(w === cur, (el) => el.children(band(t, false)))
          .on_click((_e, cx) => {
            this.form.set("workflow", w.path, { force: true });

            const f = this.form.field("workflow");

            if (f) f.touched = true;

            void this.reread(cx);
            cx.notify();
          })
          .child(v_flex().relative().flex_1().min_w(0)
            .child(div().truncate().text_color(w === cur ? t.foreground : t.muted).child(w.name))
            .child(div().truncate().text_size(10).text_color(t.dim).child(w.path)))
          .child(div().relative().flex_none().text_size(10).text_color(t.dim).child(w.inputs.length ? `${w.inputs.length} in` : ""))))
        .when(Boolean(cur), (el) => el.child(v_flex().px(10).pt(10).gap(3)
          .child(div().text_color(t.ansi8).child(this.inputs === null ? `Reading its inputs at ${ref}…` : this.inputsError ? "" : this.inputs.length ? `Inputs at ${ref}` : "No inputs: it runs as it is."))
          .when(Boolean(this.inputsError), (e2) => e2.child(div().text_color(t.blocked).child(this.inputsError)))
          .children((this.inputs ?? []).map((i, k) => h_flex().id(`wfi-${k}`).gap(8)
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(i.name))
            .child(div().flex_none().text_color(t.dim).child(`${i.type}${i.required ? " · required" : ""}`))))));
    }

    return panel(t, "wf-side-panel", "Can be run by hand", false, body, { right: list ? `${list.length}` : "" }).size_full();
  }
}
