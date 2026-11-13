import { test, expect } from "bun:test";
import { PROBE, parseProbe, detect, justRecipes, makeTargets, taskfileTasks, miseTasks, looseJson, rank } from "../defaults/mods/scripts/detect.js";

const probe = (files: Record<string, string>, extra: Partial<{ ls: string[]; exec: string[]; examples: string[]; cmd: string[] }> = {}) => ({
  ls: new Set([...Object.keys(files), ...(extra.ls ?? [])]), exec: extra.exec ?? [], examples: extra.examples ?? [], cmd: extra.cmd ?? [], files,
});
const cmds = (p: ReturnType<typeof probe>) => detect(p).map((s: any) => s.cmd);

test("package.json scripts run with the package manager its lockfile names", () => {
  const pkg = JSON.stringify({ scripts: { dev: "vite", build: "vite build", prebuild: "rm -rf dist", "test:e2e": "playwright test" } });
  expect(cmds(probe({ "package.json": pkg }, { ls: ["bun.lock"] }))).toEqual(["bun run dev", "bun run build", "bun run test:e2e"]);
  expect(cmds(probe({ "package.json": pkg }, { ls: ["bun.lockb"] }))[0]).toBe("bun run dev");
  expect(cmds(probe({ "package.json": pkg }, { ls: ["pnpm-lock.yaml"] }))[0]).toBe("pnpm run dev");
  expect(cmds(probe({ "package.json": pkg }, { ls: ["yarn.lock"] }))[0]).toBe("yarn run dev");
  expect(cmds(probe({ "package.json": pkg }))[0]).toBe("npm run dev");
  const pm = JSON.stringify({ packageManager: "pnpm@9.1.0", scripts: { dev: "x" } });
  expect(cmds(probe({ "package.json": pm }))).toEqual(["pnpm run dev"]);
});

test("just recipes leave out private ones, settings and aliases", () => {
  const jf = [
    'set shell := ["bash", "-c"]', "alias b := build", "version := `git describe`", "",
    "default:", "    @just --list", "", "build:", "    cargo build", "",
    "test filter='': build", "    cargo test {{filter}}", "", "_helper:", "    true", "",
    "[private]", "hidden:", "    true", "", "[unix]", "install:", "    ./x", "@quiet:", "  echo",
  ].join("\n");
  expect(justRecipes(jf).map((r: any) => r.name)).toEqual(["default", "build", "test", "install", "quiet"]);
  expect(justRecipes(jf).find((r: any) => r.name === "test").params).toBe("filter=''");
});

test("make targets skip variables, special and pattern targets", () => {
  const mk = ["CC := gcc", "X = 1", ".PHONY: all clean", "all: build", "build test: deps", "%.o: %.c", "clean:", "\trm -rf out"].join("\n");
  expect(makeTargets(mk)).toEqual(["all", "build", "test", "clean"]);
});

test("cargo: the usual four, each [[bin]] and examples", () => {
  const toml = '[package]\nname = "x"\n\n[[bin]]\nname = "srv"\npath = "src/srv.rs"\n\n[[example]]\nname = "demo"\n';
  expect(cmds(probe({ "Cargo.toml": toml }, { examples: ["demo.rs", "other.rs", "README.md", "multi"] }))).toEqual([
    "cargo build", "cargo run", "cargo test", "cargo clippy", "cargo run --bin srv",
    "cargo run --example demo", "cargo run --example other", "cargo run --example multi",
  ]);
});

test("deno tasks, jsonc comments and all", () => {
  const d = '{\n  // tasks\n  "tasks": { "dev": "deno run -A main.ts", "fmt": "deno fmt", },\n}';
  expect(looseJson(d)?.tasks.dev).toBe("deno run -A main.ts");
  expect(cmds(probe({ "deno.jsonc": d }))).toEqual(["deno task dev", "deno task fmt"]);
});

test("pyproject scripts run with uv, poetry or pdm", () => {
  const py = '[project]\nname = "x"\n\n[project.scripts]\nserve = "x.app:main"\n"x-cli" = "x.cli:run"\n';
  expect(cmds(probe({ "pyproject.toml": py }, { ls: ["uv.lock"] }))).toEqual(["uv run serve", "uv run x-cli"]);
  const poetry = '[tool.poetry]\nname = "x"\n\n[tool.poetry.scripts]\nserve = "x:main"\n';
  expect(cmds(probe({ "pyproject.toml": poetry }, { ls: ["poetry.lock"] }))).toEqual(["poetry run serve"]);
});

test("Taskfile and mise tasks", () => {
  const tf = "version: '3'\nvars:\n  X: 1\ntasks:\n  build:\n    cmds:\n      - go build\n  \"lint:fix\":\n    cmds: [x]\nincludes:\n  a: b\n";
  expect(taskfileTasks(tf)).toEqual(["build", "lint:fix"]);
  const mise = '[tools]\nnode = "22"\n\n[tasks.dev]\nrun = "x"\n\n[tasks."db:migrate"]\nrun = "y"\n\n[tasks]\nquick = "echo hi"\n';
  expect(miseTasks(mise).sort()).toEqual(["db:migrate", "dev", "quick"]);
  expect(cmds(probe({ "Taskfile.yml": tf }))).toEqual(["task build", "task lint:fix"]);
});

test("composer scripts, go and executable files", () => {
  const c = JSON.stringify({ scripts: { test: "phpunit", "post-install-cmd": "x" } });
  expect(cmds(probe({ "composer.json": c }))).toEqual(["composer run-script test"]);
  expect(cmds(probe({ "go.mod": "module x\n" }, { cmd: ["cmd/api", "cmd/worker"] }))).toEqual([
    "go run .", "go test ./...", "go build ./...", "go run ./cmd/api", "go run ./cmd/worker",
  ]);
  const files = detect(probe({}, { exec: ["scripts/sandbox", "bin/dev server"] }));
  expect(files.map((s: any) => [s.group, s.name, s.cmd])).toEqual([["scripts/", "sandbox", "./scripts/sandbox"], ["bin/", "dev server", "./'bin/dev server'"]]);
});

test("ids are stable and unique per group", () => {
  const p = probe({ justfile: "test:\n  x\n", "package.json": '{"scripts":{"test":"x"}}' });
  const ids = detect(p).map((s: any) => s.id);
  expect(new Set(ids).size).toBe(2);
  expect(detect(p).map((s: any) => s.id)).toEqual(ids);
});

test("the probe's sections parse back", () => {
  const out = "\u001els\npackage.json\nbun.lock\n\u001eexec\nscripts/x\n\u001eexamples\n\u001ecmd\ncmd/api/\n\u001efile package.json\n{\"scripts\":{\"a\":\"b\"}}\n";
  const p = parseProbe(out);
  expect([...p.ls]).toEqual(["package.json", "bun.lock"]);
  expect(p.exec).toEqual(["scripts/x"]);
  expect(p.cmd).toEqual(["cmd/api"]);
  expect(cmds(p)).toEqual(["bun run a", "./scripts/x"]);
});

test("the probe runs in sh and finds this repo's scripts", async () => {
  const r = Bun.spawnSync(["sh", "-c", PROBE], { cwd: `${import.meta.dir}/..` });
  expect(r.exitCode).toBe(0);
  const found = detect(parseProbe(r.stdout.toString()));
  expect(found.some((s: any) => s.cmd === "just test")).toBe(true);
  expect(found.some((s: any) => s.cmd === "cargo build")).toBe(true);
  expect(found.some((s: any) => s.cmd === "./scripts/sandbox")).toBe(true);
});

test("rank: recents first without a query, best name match with one", () => {
  const s = (group: string, name: string) => ({ id: `${group}#${name}`, group, name, runner: "just", cmd: `just ${name}` });
  const all = [s("justfile", "build"), s("justfile", "test"), s("justfile", "docs-check")];
  const rows = rank(all, "", [all[1].id]);
  expect(rows.map((r: any) => [r.head, r.s.name])).toEqual([["recent", "test"], ["justfile", "build"], ["justfile", "docs-check"]]);
  expect(rank(all, "dc", []).map((r: any) => r.s.name)[0]).toBe("docs-check");
  expect(rank(all, "zzz", [])).toEqual([]);
  expect(rank(all, "", [], "make")).toEqual([]);
});

test("a recipe written per platform is listed once", () => {
  const jf = "[unix]\ninstall:\n  ./a\n\n[windows]\ninstall:\n  ./b\n";
  expect(cmds(probe({ justfile: jf }))).toEqual(["just install"]);
});
