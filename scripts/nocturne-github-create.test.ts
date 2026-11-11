// The GitHub window's write forms as plain logic: reading a workflow's
// workflow_dispatch inputs, checking answers, building the gh argv, and the
// new pull request's fill, template, push plan and argv.
import { test, expect } from "bun:test";
import { parseYaml, dispatchOf, startValue, inputError, dispatchArgs, newRun, shellLine, workflowFile } from "../defaults/mods/nocturne-github/dispatch.js";
import { humanize, fillFrom, templatesIn, startBody, parseLog, parseNumstat, parseBranches, remoteFor, pushPlan, prErrors, prArgs, createdNumber } from "../defaults/mods/nocturne-github/pr-create.js";

const DEPLOY = `name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Where to deploy'   # a comment
        type: environment
        required: true
      level:
        description: Log level
        required: true
        default: warning
        type: choice
        options:
          - info
          - warning
          - debug
      dry:
        type: boolean
        default: true
      count:
        type: number
        default: 3
      note:
        description: |
          A note for the
          deploy log.
      "tag-name":
        required: false
jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - run: echo "# not a comment" # but this is
`;

test("reads a workflow's workflow_dispatch inputs with their types", () => {
  const d = dispatchOf(DEPLOY)!;
  expect(d.inputs.map((i: any) => [i.name, i.type, i.required])).toEqual([
    ["environment", "environment", true], ["level", "choice", true], ["dry", "boolean", false],
    ["count", "number", false], ["note", "string", false], ["tag-name", "string", false],
  ]);
  expect(d.inputs[0].description).toBe("Where to deploy");
  expect(d.inputs[1].options).toEqual(["info", "warning", "debug"]);
  expect(d.inputs[1].default).toBe("warning");
  expect(d.inputs[2].default).toBe(true);
  expect(d.inputs[3].default).toBe(3);
  expect(d.inputs[4].description).toBe("A note for the\ndeploy log.");
});

test("knows workflows without a dispatch trigger, and every way to write one", () => {
  expect(dispatchOf("on: [push, pull_request]\njobs: {}")).toBeNull();
  expect(dispatchOf("on:\n  push:\n")).toBeNull();
  expect(dispatchOf("on: workflow_dispatch\n")).toEqual({ inputs: [] });
  expect(dispatchOf("on: [push, workflow_dispatch]\n")).toEqual({ inputs: [] });
  expect(dispatchOf("on:\n  - push\n  - workflow_dispatch\n")).toEqual({ inputs: [] });
  expect(dispatchOf("on:\n  workflow_dispatch:\n  push:\n")).toEqual({ inputs: [] });
  expect(dispatchOf("'on':\n  workflow_dispatch: {}\n")).toEqual({ inputs: [] });
  expect(dispatchOf("on:\n  workflow_dispatch:\n    inputs:\n      a: { type: choice, options: [x, 'y z'], default: 'y z' }\n")!.inputs[0])
    .toMatchObject({ name: "a", type: "choice", options: ["x", "y z"], default: "y z" });
  expect(dispatchOf("")).toBeNull();
  expect(dispatchOf("::: not yaml [")).toBeNull();
});

test("the YAML reader handles lists of maps, block scalars and quotes", () => {
  expect(parseYaml("a:\n  - b: 1\n    c: two\n  - d\nx: 'it''s'\ny: \"q\\\"\"\nz: >\n  one\n  two\n")).toEqual({ a: [{ b: 1, c: "two" }, "d"], x: "it's", y: 'q"', z: "one two\n" });
  expect(parseYaml("k: v # c\n# whole\nn: ~\nf: 1.5\n")).toEqual({ k: "v", n: null, f: 1.5 });
});

test("starting values follow GitHub's form", () => {
  const [env, level, dry, count, note] = dispatchOf(DEPLOY)!.inputs;
  expect(startValue(env)).toBe("");
  expect(startValue(level)).toBe("warning");
  expect(startValue(dry)).toBe(true);
  expect(startValue(count)).toBe("3");
  expect(startValue(note)).toBe("");
  expect(startValue({ type: "choice", options: ["a", "b"], default: null } as any)).toBe("a");
  expect(startValue({ type: "boolean", default: "false" } as any)).toBe(false);
});

test("required, numbers, choices and environments are checked", () => {
  const [env, level, dry, count] = dispatchOf(DEPLOY)!.inputs;
  expect(inputError(env, "")).toBe("Required.");
  expect(inputError(env, "  ")).toBe("Required.");
  expect(inputError(env, "prod", ["prod", "staging"])).toBe("");
  expect(inputError(env, "moon", ["prod"])).toContain("prod");
  expect(inputError(level, "loud")).toContain("info, warning, debug");
  expect(inputError(dry, false)).toBe("");
  expect(inputError(count, "3.5")).toBe("");
  expect(inputError(count, "three")).toBe("A number.");
  expect(inputError(count, "")).toBe("");
});

test("builds gh workflow run with every input", () => {
  const inputs = dispatchOf(DEPLOY)!.inputs;
  const args = dispatchArgs({ id: 7, path: ".github/workflows/deploy.yml" }, "main", inputs, { environment: "prod", level: "debug", dry: false, count: " 4 ", note: "it's\nok", "tag-name": "" });
  expect(args).toEqual(["workflow", "run", "deploy.yml", "--ref", "main", "-f", "environment=prod", "-f", "level=debug", "-f", "dry=false", "-f", "count=4", "-f", "note=it's\nok", "-f", "tag-name="]);
  expect(shellLine("gh", [...args.slice(0, 5), "-f", "note=it's ok"])).toBe("gh workflow run deploy.yml --ref main -f 'note=it'\\''s ok'");
  expect(workflowFile(".github/workflows/a.yaml")).toBe("a.yaml");
  expect(dispatchArgs({ id: 9, path: "" }, "v1", [], {})).toEqual(["workflow", "run", "9", "--ref", "v1"]);
});

test("finds the run a dispatch started", () => {
  const since = Date.parse("2026-11-11T10:00:00Z");
  const runs = [
    { id: 1, event: "workflow_dispatch", head_branch: "main", created_at: "2026-11-11T09:00:00Z" },
    { id: 2, event: "push", head_branch: "main", created_at: "2026-11-11T10:00:02Z" },
    { id: 3, event: "workflow_dispatch", head_branch: "dev", created_at: "2026-11-11T10:00:03Z" },
    { id: 4, event: "workflow_dispatch", head_branch: "main", created_at: "2026-11-11T10:00:04Z" },
    { id: 5, event: "workflow_dispatch", head_branch: "main", created_at: "2026-11-11T10:00:05Z" },
  ];
  expect(newRun(runs, { ref: "main", since, known: [5] })!.id).toBe(4);
  expect(newRun(runs, { ref: "main", since })!.id).toBe(5);
  expect(newRun(runs.slice(0, 2), { ref: "main", since })).toBeNull();
  expect(newRun(null as any, { ref: "main", since })).toBeNull();
});

test("fills title and body like gh pr create --fill", () => {
  expect(humanize("feat/new_pr-form")).toBe("feat/new pr form");
  expect(fillFrom([{ subject: "fix: a thing", body: "Why.\n" }], "x")).toEqual({ title: "fix: a thing", body: "Why." });
  expect(fillFrom([{ subject: "one" }, { subject: "two" }], "feat/two-things")).toEqual({ title: "feat/two things", body: "- one\n- two" });
  expect(fillFrom([], "a-b")).toEqual({ title: "a b", body: "" });
  expect(startBody("## What\n\n", "- one")).toBe("## What");
  expect(startBody("", "- one")).toBe("- one");
});

test("finds pull request templates where gh does", () => {
  expect(templatesIn(["README.md", "docs/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "src/pull_request_template.md"]))
    .toEqual([".github/PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md"]);
  expect(templatesIn([".github/PULL_REQUEST_TEMPLATE/feature.md", ".github/PULL_REQUEST_TEMPLATE/bug.md", "pull_request_template.md"]))
    .toEqual(["pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE/bug.md", ".github/PULL_REQUEST_TEMPLATE/feature.md"]);
  expect(templatesIn([])).toEqual([]);
});

test("reads git's answers", () => {
  const log = "bbb\x1fsecond\x1f\x1e\naaa\x1ffirst\x1fbody\nline\n\x1e\n";
  expect(parseLog(log)).toEqual([{ sha: "aaa", subject: "first", body: "body\nline" }, { sha: "bbb", subject: "second", body: "" }]);
  expect(parseLog("")).toEqual([]);
  expect(parseNumstat("3\t1\tsrc/a.rs\n-\t-\timg.png\n")).toEqual({ files: [{ path: "src/a.rs", add: 3, del: 1, binary: false }, { path: "img.png", add: 0, del: 0, binary: true }], add: 3, del: 1 });
  expect(parseBranches("main\torigin/main\t\nfeat\torigin/feat\t[ahead 2, behind 1]\nlocal\t\t\nold\torigin/old\t[gone]\n")).toEqual([
    { name: "main", upstream: "origin/main", ahead: 0, behind: 0, gone: false },
    { name: "feat", upstream: "origin/feat", ahead: 2, behind: 1, gone: false },
    { name: "local", upstream: null, ahead: 0, behind: 0, gone: false },
    { name: "old", upstream: "origin/old", ahead: 0, behind: 0, gone: true },
  ]);
  expect(remoteFor([{ remote: "upstream", full: "a/b", host: "github.com" }, { remote: "origin", full: "Me/B", host: "github.com" }] as any, "me/b")).toBe("origin");
  expect(remoteFor([], "me/b")).toBeNull();
});

test("offers a push when head isn't on GitHub or is ahead", () => {
  expect(pushPlan({ remote: "origin", head: "feat", onRemote: false })).toEqual({ why: "feat isn't on origin yet", args: ["push", "--set-upstream", "origin", "feat"] });
  expect(pushPlan({ remote: "origin", head: "feat", onRemote: true, ahead: 2, tracking: true })).toEqual({ why: "2 commits of feat not on origin", args: ["push", "origin", "feat"] });
  expect(pushPlan({ remote: "origin", head: "feat", onRemote: true, ahead: 0 })).toBeNull();
  expect(pushPlan({ remote: null, head: "feat", onRemote: false } as any)).toBeNull();
});

test("checks the form and builds gh pr create", () => {
  expect(prErrors({ base: "main", head: "main", title: "" })).toEqual({ head: "Head and base are the same branch.", title: "A pull request needs a title." });
  expect(prErrors({ base: "main", head: "feat", title: "x" }, { commits: [] })).toEqual({ head: "No commits between main and feat." });
  expect(prErrors({ base: "main", head: "feat", title: "x" }, { commits: [{}] })).toEqual({});
  expect(prErrors({ base: "", head: "", title: "x" })).toEqual({ base: "Pick the branch to merge into.", head: "Pick the branch with the changes." });
  expect(prArgs({ base: "main", head: "feat", title: " T ", body: "B", draft: true, reviewers: ["a", "b"], assignees: ["@me"], labels: ["bug"], milestone: "v1" }))
    .toEqual(["pr", "create", "--base", "main", "--head", "feat", "--title", "T", "--body", "B", "--draft", "--reviewer", "a,b", "--assignee", "@me", "--label", "bug", "--milestone", "v1"]);
  expect(prArgs({ base: "main", head: "feat", headOwner: "me", title: "T", body: "", reviewers: [], labels: [] }))
    .toEqual(["pr", "create", "--base", "main", "--head", "me:feat", "--title", "T", "--body", ""]);
  expect(createdNumber("https://github.com/o/r/pull/42\n")).toBe(42);
  expect(createdNumber("nope")).toBeNull();
});
