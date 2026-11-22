// The run-workflow form's reads (dispatchForm.ts runs them on the window):
// the workflows that can be run by hand (each one's file read for its
// workflow_dispatch inputs), the branches and tags, the chosen file's inputs
// at the chosen ref, the environments; and once it's sent, the new run looked
// for with a backoff (model.ts soon) until GitHub lists it. Each ends with the
// window; what can't be read says why on the form.

import { Array as Arr, Clock, Effect, Option, Order } from "effect";
import { redraw } from "@fireflies/kit";
import { api, fileAt, ghJson, plain } from "./gh.ts";
import type { Run } from "./model.ts";
import { EnvironmentsSchema, NamedListSchema, RunListSchema, WorkflowsSchema, soon } from "./model.ts";
import { dispatchOf, newRun, workflowFile } from "./dispatch.ts";
import { noteOf } from "./kit.ts";
import type { DispatchForm, Dispatched, Ref, Runnable } from "./dispatchForm.ts";

/** How long the new run is looked for (how often: model.ts soon, a backoff). */
const WAIT_FOR = 120000;

/** By name, as a person reads them. */
const byName = Order.mapInput(Order.String, (w: Runnable) => w.name);

/** A workflow file's text at `ref` (none: GitHub has no such file or ref there). */
const fileOf = (f: DispatchForm, path: string, ref: string) => fileAt(f.repo, path, ref);

/** The workflows that can be run by hand: active, with a workflow_dispatch in their file on the default branch. */
export const readWorkflows = (f: DispatchForm) => Effect.gen(function* () {
  const repo = f.repo;
  const list = (yield* ghJson(repo, ["workflow", "list", "--json", "id,name,path,state", "--limit", "100"], WorkflowsSchema)) ?? [];

  const read = yield* Effect.forEach(Arr.filter(list, (w) => w.state === "active" && w.path !== ""), (w) => Effect.map(fileOf(f, w.path, repo.base ?? "HEAD"), (yaml) => {
    const d = Option.flatMap(yaml, (y) => Option.fromNullishOr(dispatchOf(y)));

    return Option.match(d, { onNone: (): Runnable[] => [], onSome: (x): Runnable[] => [{ id: w.id, name: w.name, path: w.path, inputs: x.inputs }] });
  }), { concurrency: 4 });

  return Arr.sort(Arr.flatten(read), byName);
}).pipe(
  Effect.matchEffect({
    onSuccess: (all) => Effect.sync(() => {
      f.workflows = all;
    }),
    onFailure: (e) => Effect.sync(() => {
      f.workflows = [];
      f.listError = e.message;
    }),
  }),
  Effect.andThen(Effect.suspend(() => {
    const all = f.workflows ?? [];
    const first = Arr.findFirst(all, (w) => w.path === f.want).pipe(Option.orElse(() => (all.length === 1 ? Arr.head(all) : Option.none())));

    if (Option.isNone(first) || f.form.text("workflow") !== "") return redraw;

    f.form.set("workflow", first.value.path);

    return reread(f);
  })),
);

/** The branches (the default one and yours first) and tags to run on; your branch picked when GitHub has it
 *  (and you didn't pick another meanwhile). Either list that can't be read offers none. */
export const readRefs = (f: DispatchForm) => Effect.gen(function* () {
  const repo = f.repo;
  const named = (what: string) => Effect.orElseSucceed(Effect.map(api(repo, `repos/${repo.full}/${what}?per_page=100`, plain(NamedListSchema)), ({ data }) => Arr.map(data ?? [], (x) => x.name)), (): string[] => []);
  const [names, tags] = yield* Effect.all([named("branches"), named("tags")], { concurrency: 2 });
  const order = Arr.dedupe(Arr.filter([repo.base ?? "", repo.branch ?? ""], (n) => n !== "" && names.includes(n)));

  f.refs = [
    ...Arr.map([...order, ...Arr.filter(names, (n) => !order.includes(n))], (name): Ref => ({ name, kind: "branch" })),
    ...Arr.map(tags, (name): Ref => ({ name, kind: "tag" })),
  ];

  const mine = repo.branch ?? "";

  if (mine !== "" && names.includes(mine) && f.form.field("ref")?.touched !== true && f.form.text("ref") !== mine) {
    f.form.set("ref", mine);
    yield* reread(f);
  } else yield* redraw;
});

/** The environments an environment input picks from (none readable: typed by hand). */
const readEnvs = (f: DispatchForm) => Effect.orElseSucceed(
  Effect.map(api(f.repo, `repos/${f.repo.full}/environments`, plain(EnvironmentsSchema)), ({ data }) => Arr.map(data?.environments ?? [], (e) => e.name)),
  (): string[] => [],
);

/** The workflow or the ref changed: its inputs as that ref's file has them. */
export const reread = (f: DispatchForm) => Effect.gen(function* () {
  const w = f.workflow(), ref = f.ref();
  const key = w !== null && ref !== "" ? `${w.path}@${ref}` : "";

  if (key === f.inputsFor) return;

  const gen = ++f.gen;

  f.inputsFor = key;
  f.inputs = null;
  f.inputsError = "";
  f.form.setFields(f.fields());
  yield* redraw;

  if (w === null || key === "") return;

  // A file GitHub won't hand out reads as none: the form says the ref has no such file.
  const yaml = yield* Effect.map(Effect.orElseSucceed(fileOf(f, w.path, ref), () => Option.none<string>()), Option.getOrNull);

  if (gen !== f.gen || f.closed) return;

  const d = yaml === null ? null : dispatchOf(yaml);

  if (yaml === null) {
    f.inputsError = `${ref} has no ${w.path}, or GitHub has no ref ${ref}.`;
    f.inputs = [];
  } else if (d === null) {
    f.inputsError = `At ${ref}, ${workflowFile(w.path)} can't be run by hand (no workflow_dispatch).`;
    f.inputs = [];
  } else f.inputs = d.inputs;

  f.form.setFields(f.fields());

  if (Arr.some(f.inputs, (i) => i.type === "environment") && f.envs === null) {
    const envs = yield* readEnvs(f);

    f.envs = envs;
  }

  yield* redraw;
});

/** The workflow's runs by hand, newest first, read past the ETag (a list that can't be read: none yet). */
export const runsOf = (f: DispatchForm, w: Runnable) => Effect.orElseSucceed(
  Effect.map(api(f.repo, `repos/${f.repo.full}/actions/workflows/${w.id}/runs?event=workflow_dispatch&per_page=20`, plain(RunListSchema), { fresh: true }), (r): readonly Run[] => r.data?.workflow_runs ?? []),
  (): readonly Run[] => [],
);

/** Sent: the new run looked for with a backoff (1, 2, 3, 5, 8 s, then every 10 s, for WAIT_FOR at most; the
 *  window closing ends it) and selected when GitHub lists it. */
export const waitForRun = (f: DispatchForm, r: Dispatched) => Effect.gen(function* () {
  const a = f.actions;
  const waiting = () => a.waiting?.since === r.since;

  for (let n = 0; ; n++) {
    const now = yield* Clock.currentTimeMillis;

    if (now - r.since >= WAIT_FOR || !waiting()) break;

    yield* Effect.sleep(Math.min(soon(n), WAIT_FOR - (now - r.since))); // the last look at the bound

    if (!waiting()) return;

    const runs = yield* runsOf(f, r.workflow);
    const run = newRun(runs, r);

    if (run === null || run === undefined) continue;

    a.waiting = null;
    const at = yield* Clock.currentTimeMillis;

    f.app.note = noteOf(`${r.workflow.name} #${run.run_number ?? ""} is ${run.status === "queued" ? "queued" : "running"}.`, "done", at);
    const cx = f.cx();

    if (cx !== null) a.show(run.id, null, cx);

    a.focus = "runs";

    return;
  }

  if (waiting()) {
    a.waiting = null;
    const at = yield* Clock.currentTimeMillis;

    f.app.note = noteOf("GitHub took it, but its run hasn't shown up yet: r reads again.", "working", at);
  }
});
