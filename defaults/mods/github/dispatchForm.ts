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
import type { Repo } from "./gh.ts";
import { Array as Arr, Option, Predicate, String as Str } from "effect";
import type { Effect } from "effect";
import type { GithubServices } from "./fx.ts";
import { readRefs, readWorkflows, reread, sendDispatch, waitForRun } from "./dispatch-form-reads.ts";
import { slug } from "./remotes.ts";
import type { Input, InputType } from "./dispatch.ts";
import { startValue, inputError, dispatchArgs, shellLine, workflowFile } from "./dispatch.ts";
import type { Command, Field, FormHost, Outcome, Values } from "./form-fields.ts";
import { textIn } from "./form-fields.ts";
import { Form } from "./form.ts";
import type { Note } from "./kit.ts";
import { panel, empty, lit, noteOf } from "./kit.ts";
import { edge } from "@fireflies/tones";


/** "3 inputs", "1 input", or nothing. */
const inputsWord = (n: number): string => (n === 0 ? "" : `${n} input${n === 1 ? "" : "s"}`);

/** What a typed input's hint says of its type. */
const TYPE_HINT: ReadonlyMap<InputType, string> = new Map([["number", "a number"], ["environment", "an environment"]]);

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
export interface Runnable {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly inputs: readonly Input[];
}

/** A branch or a tag to run on. */
export interface Ref {
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
  now(): number;
}

/** What the form asks of the Actions tab: the form gone, the run waited for, then shown. */
export interface DispatchTab {
  closeForm(): void;
  waiting: Waiting | null;
  focus: string;
  show(runId: number, jobId: number | null, cx: Context): void;
}

export class DispatchForm {
  /** The cx of the last ask (load, a send): the window's own is used when it has one. */
  lastCx: Context | null = null;

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

    return Option.getOrNull(Arr.findFirst(this.workflows ?? [], (w) => w.path === path));
  }

  /** What the ref list says beside a ref: a tag, the default branch, yours. */
  refWord(r: Ref): string {
    if (r.kind === "tag") return "tag";

    if (r.name === this.repo.base) return "default branch";

    return r.name === this.repo.branch ? "your branch" : "";
  }

  /** The ref, as typed or picked. */
  ref(): string {
    return Str.trim(this.form.text("ref"));
  }

  fields(): Field[] {
    const w = this.workflow();

    const base: Field[] = [
      {
        id: "workflow", label: "workflow", kind: "choice", value: "", required: true, group: "what runs", pair: true, join: "@",
        hint: w === null ? "" : workflowFile(w.path),
        display: (path) => Option.getOrElse(Option.map(Arr.findFirst(this.workflows ?? [], (x) => x.path === path), (x) => x.name), () => path),
        options: () => (this.workflows === null ? null : Arr.map(this.workflows, (x) => ({ value: x.path, label: x.name, sub: workflowFile(x.path), right: inputsWord(x.inputs.length) }))),
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
      {
        id: "ref", label: "ref", kind: "choice", value: this.repo.base ?? "", required: true, free: true, hint: "branch or tag",
        options: () => (this.refs === null ? null : Arr.map(this.refs, (r) => ({ value: r.name, label: r.name, sub: this.refWord(r) }))),
        onChange: (_v, cx) => {
          void this.reread(cx);
        },
      },
    ];

    this.specs = new Map();

    if (w === null || this.inputs === null) return base;

    // The inputs as the file orders them, in one section: lists and numbers two to a row, text full width.
    const group = `inputs · ${this.inputs.length}`;

    return [...base, ...Arr.map(this.inputs, (i): Field => {
      const id = `in:${w.id}:${i.name}`;
      const kind = kindOf(i.type);
      const start = startValue(i);
      const hint = Arr.join(Arr.filter([i.description, TYPE_HINT.get(i.type) ?? ""], Str.isNonEmpty), " · ");

      this.specs.set(id, i);

      if (kind === "toggle") return { id, label: i.name, kind, required: false, group, half: true, value: start === true, note: i.description === "" ? "on / off" : i.description, hint: "" };

      const value = Predicate.isString(start) ? start : "";

      if (kind === "text" || kind === "number") return { id, label: i.name, kind, required: i.required, group, half: kind !== "text", value, hint };

      if (i.type === "environment") return { id, label: i.name, kind, required: i.required, group, half: true, value, hint, free: true, options: () => (this.envs === null ? null : Arr.map(this.envs, (e) => ({ value: e, label: e }))) };

      return {
        id, label: i.name, kind, required: i.required, group, half: true, value, hint,
        options: () => Arr.map(i.options, (o) => ({ value: o, label: o, right: o === String(i.default ?? "") ? "default" : "" })),
      };
    })];
  }

  // ---- reading

  /** The workflows and the refs, at once (dispatch-form-reads.ts). */
  load(cx: Context): void {
    this.lastCx = cx;
    this.app.run(readWorkflows(this));
    this.app.run(readRefs(this));
  }

  /** The workflow or the ref changed: its inputs as that ref's file has them, the newest ask winning. */
  reread(_cx: Context): void {
    this.app.run(reread(this), { key: "dispatch-inputs" });
  }

  /** A cx good after the handler that asked has returned: the window's own, else the last one handed in. */
  cx(): Context | null {
    return this.app.acx ?? this.lastCx;
  }

  /** The footer's line: the command it will run. */
  summary(): string {
    const w = this.workflow(), ref = this.ref();

    if (w === null) return this.workflows?.length === 0 ? "nothing here can be run by hand" : "pick a workflow";

    const n = this.inputs?.length ?? 0;

    return `gh workflow run ${workflowFile(w.path)}${ref === "" ? "" : ` --ref ${ref}`}${n === 0 ? "" : ` · ${inputsWord(n)}`}`;
  }

  check(v: Values): Map<string, string> {
    const e = new Map<string, string>();

    if (textIn(v, "workflow") === "") e.set("workflow", this.workflows?.length === 0 ? "No workflow here can be run by hand." : "Pick a workflow.");

    if (Str.trim(textIn(v, "ref")) === "") e.set("ref", "Pick a branch or tag.");

    if (e.size > 0) return e;

    if (this.inputs === null) e.set("workflow", "Still reading its inputs…");
    else if (this.inputsError !== "") e.set("ref", this.inputsError);

    for (const f of this.form.fields) {
      const spec = this.specs.get(f.id);

      if (spec === undefined || f.kind === "multi") continue;

      const why = inputError(spec, f.value, this.envs);

      if (why !== "") e.set(f.id, why);
    }

    return e;
  }

  args(): string[] {
    const w = this.workflow();
    const values = new Map<string, string | boolean>();

    for (const f of this.form.fields) {
      const spec = this.specs.get(f.id);

      if (spec !== undefined && f.kind !== "multi") values.set(spec.name, f.value);
    }

    return w === null ? [] : dispatchArgs(w, this.ref(), this.inputs ?? [], values);
  }

  commands(): Command[] {
    const w = this.workflow();

    if (w === null) return [];

    return [{ label: `run ${w.name} on ${this.ref()}`, line: shellLine("gh", [...this.args(), "-R", slug(this.repo)]) }];
  }

  // ---- sending, then finding the run

  /** gh workflow run (the runs listed before it, to tell the new one): how it went. */
  send(): Effect.Effect<Outcome<Dispatched>, never, GithubServices> {
    return sendDispatch(this);
  }

  /** Sent: the form goes; the run is looked for (dispatch-form-reads.ts waitForRun) and selected when GitHub lists it. */
  wait(r: Dispatched, cx: Context): void {
    const a = this.actions;

    this.lastCx = cx;
    a.closeForm();
    a.waiting = { name: r.workflow.name, ref: r.ref, since: r.since };
    this.app.note = noteOf(`Started ${r.workflow.name} on ${r.ref}; waiting for its run…`, "working", this.app.now());
    this.app.run(waitForRun(this, r));
  }

  // ---- beside the form

  side(t: Theme): Element {
    const list = this.workflows, cur = this.workflow();
    const ref = this.form.text("ref");
    let body: Element;

    if (list === null) body = empty(t, "Reading the workflows…", "Only those with a workflow_dispatch trigger can be run by hand.", { small: true });
    else if (list.length === 0) body = empty(t, "Nothing to run by hand", this.listError === "" ? "No active workflow here has a workflow_dispatch trigger." : this.listError, { small: true });    else {
      body = v_flex().id("wf-side").size_full().overflow_y_scroll().py(4).text_size(11)
        .children(Arr.map(list, (w, i) => h_flex().id(`wf-${i}`).relative().h(32).flex_none().px(10).gap(8).items_center().cursor_pointer()
          .hover((s) => s.bg(`${edge(t)}55`))
          .when(w === cur, (el) => lit(t, el, false))
          .on_click((_e, cx) => {
            this.form.set("workflow", w.path, { force: true });

            const f = this.form.field("workflow");

            if (f !== null) f.touched = true;

            void this.reread(cx);
            cx.notify();
          })
          .child(v_flex().relative().flex_1().min_w(0)
            .child(div().truncate().text_color(w === cur ? t.foreground : t.muted).child(w.name))
            .child(div().truncate().text_size(10).text_color(t.dim).child(w.path)))
          .child(div().relative().flex_none().text_size(10).text_color(t.dim).child(w.inputs.length > 0 ? `${w.inputs.length} in` : ""))))
        .when(Boolean(cur), (el) => el.child(v_flex().px(10).pt(10).gap(3)
          .child(div().text_color(t.muted).child(this.inputs === null ? `Reading its inputs at ${ref}…` : this.inputsError !== "" ? "" : this.inputs.length > 0 ? `Inputs at ${ref}` : "No inputs: it runs as it is."))
          .when(Boolean(this.inputsError), (e2) => e2.child(div().text_color(t.blocked).child(this.inputsError)))
          .children(Arr.map(this.inputs ?? [], (i, k) => h_flex().id(`wfi-${k}`).gap(8)
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(i.name))
            .child(div().flex_none().text_color(t.dim).child(`${i.type}${i.required ? " · required" : ""}`))))));
    }

    return panel(t, "wf-side-panel", "Can be run by hand", false, body, { right: list === null ? "" : `${list.length}` }).size_full();
  }
}
