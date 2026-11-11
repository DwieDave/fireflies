// The editor's language servers in the workspace's own environment
// (nocturne-editor/envrc.js): the nearest .envrc up to the repository,
// loaded by direnv only when direnv allows it, once per folder; and what the
// asked-for hover (cmd-i) says when no server answers (logic.js serverNote).
// `exec` is a fake that answers as sh and direnv would.
import { test, expect, beforeEach } from "bun:test";
import { projectEnv, lookup, wrap, forgetEnvs, envrcDir, ENVRC_SCRIPT } from "../defaults/mods/nocturne-editor/envrc.js";
import { serverNote } from "../defaults/mods/nocturne-editor/logic.js";

type Call = { cmd: string; args: string[]; opts?: any };
/** A fake exec: `world` says where .envrc files are, whether direnv is there, what it allows and exports. */
function fake(world: { envrc?: string | null; direnv?: boolean; allowed?: number; exported?: any; fail?: string; slow?: Promise<void>; bins?: Record<string, string> }) {
  const calls: Call[] = [];
  const exec = async (cmd: string, args: string[] = [], opts?: any) => {
    calls.push({ cmd, args, opts });
    if (cmd === "sh" && args[1] === ENVRC_SCRIPT) return { code: 0, stdout: world.envrc ?? "", stderr: "" };
    if (cmd === "sh" && args[1].includes("command -v direnv")) return { code: world.direnv === false ? 1 : 0, stdout: "", stderr: "" };
    if (cmd === "sh" && args[2] === "lookup") {
      const [path, program] = [args[3], args[4]];
      const hit = Object.entries(world.bins ?? {}).find(([p, dir]) => p === program && (path ? path.split(":").includes(dir) : dir === "/usr/bin"));
      return hit ? { code: 0, stdout: `${hit[1]}/${program}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
    }
    if (cmd === "direnv" && args[0] === "status") return { code: 0, stdout: JSON.stringify({ state: { foundRC: { allowed: world.allowed ?? 0, path: `${world.envrc}/.envrc` } } }), stderr: "" };
    if (cmd === "direnv" && args[0] === "export") {
      if (world.slow) await world.slow;
      if (world.fail) return { code: 1, stdout: "", stderr: `direnv: loading ${world.envrc}/.envrc\ndirenv: ${world.fail}\n` };
      return { code: 0, stdout: JSON.stringify(world.exported ?? {}), stderr: "direnv: loading\n" };
    }
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  return { exec, calls };
}
const SHELL = { PATH: "/nix/store/shell/bin:/usr/bin", RUST_SRC_PATH: "/nix/store/src", OLD: null };

beforeEach(() => forgetEnvs());

test("the script finds the nearest .envrc up to the repository's top, never above it", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
  const { tmpdir } = await import("os");
  const root = mkdtempSync(`${tmpdir()}/envrc-`);
  mkdirSync(`${root}/repo/.git`, { recursive: true }); mkdirSync(`${root}/repo/crates/a/src`, { recursive: true });
  writeFileSync(`${root}/.envrc`, "use flake\n"); // above the repository: not this project's
  const run = async (cmd: string, args: string[]) => { const p = Bun.spawnSync([cmd, ...args]); return { code: p.exitCode, stdout: p.stdout.toString(), stderr: "" }; };
  expect(await envrcDir(run, `${root}/repo/crates/a/src`)).toBe(null);
  writeFileSync(`${root}/repo/.envrc`, "use flake\n");
  expect(await envrcDir(run, `${root}/repo/crates/a/src`)).toBe(`${root}/repo`);
  writeFileSync(`${root}/repo/crates/a/.envrc`, "use flake\n");
  expect(await envrcDir(run, `${root}/repo/crates/a/src`)).toBe(`${root}/repo/crates/a`);
});

test("an allowed .envrc: loaded once, the server found in it and started inside it", async () => {
  const { exec, calls } = fake({ envrc: "/w/repo", exported: SHELL, bins: { "rust-analyzer": "/nix/store/shell/bin" } });
  const env = await projectEnv(exec, "/w/repo/src");
  expect(env).toEqual({ kind: "ready", dir: "/w/repo", env: SHELL });
  // The export runs in that folder, with room for a flake's first build.
  expect(calls.find((c) => c.cmd === "direnv" && c.args[0] === "export")!.opts).toMatchObject({ cwd: "/w/repo", timeout: 600000 });
  const path = await lookup(exec, "rust-analyzer", env.env);
  expect(path).toBe("/nix/store/shell/bin/rust-analyzer");
  expect(wrap(["rust-analyzer"], path!, env.env)).toEqual(["env", "-u", "OLD", "PATH=/nix/store/shell/bin:/usr/bin", "RUST_SRC_PATH=/nix/store/src", "/nix/store/shell/bin/rust-analyzer"]);
  // Not on the app's PATH: only the environment has it.
  expect(await lookup(exec, "rust-analyzer", null)).toBe(null);
});

test("a blocked .envrc is never loaded nor allowed from here; the note names direnv allow", async () => {
  for (const allowed of [1, 2]) {
    forgetEnvs();
    const { exec, calls } = fake({ envrc: "/w/repo", allowed });
    expect(await projectEnv(exec, "/w/repo")).toEqual({ kind: "blocked", dir: "/w/repo", denied: allowed === 2 });
    expect(calls.some((c) => c.cmd === "direnv" && (c.args[0] === "export" || c.args[0] === "allow"))).toBe(false);
  }
  const n = serverNote({ status: "none", why: "missing", names: ["rust-analyzer"], envrc: "/w/repo", envKind: "blocked" }, "rust")!;
  expect([n.short, n.fix]).toEqual(["direnv allow", "Run `direnv allow` in /w/repo."]);
  expect(n.text).toMatch(/isn't allowed/);
});

test("no .envrc: the app's PATH, as before", async () => {
  const { exec, calls } = fake({ envrc: null, bins: { "rust-analyzer": "/usr/bin" } });
  expect(await projectEnv(exec, "/w/plain")).toEqual({ kind: "none" });
  expect(calls.some((c) => c.cmd === "direnv")).toBe(false);
  expect(await lookup(exec, "rust-analyzer", null)).toBe("/usr/bin/rust-analyzer");
  expect(wrap(["rust-analyzer"], "/usr/bin/rust-analyzer", null)).toEqual(["/usr/bin/rust-analyzer"]);
});

test("direnv missing: nothing loaded; the note says to install it", async () => {
  const { exec, calls } = fake({ envrc: "/w/repo", direnv: false });
  expect(await projectEnv(exec, "/w/repo")).toEqual({ kind: "no-direnv", dir: "/w/repo" });
  expect(calls.some((c) => c.cmd === "direnv")).toBe(false);
  const n = serverNote({ status: "none", why: "missing", names: ["rust-analyzer"], envrc: "/w/repo", envKind: "no-direnv" }, "rust")!;
  expect(n.short).toBe("no direnv");
  expect(n.fix).toMatch(/Install direnv/);
});

test("a slow first load: one load for every editor of the folder, the loading note meanwhile, reused after", async () => {
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const { exec, calls } = fake({ envrc: "/w/repo", exported: SHELL, slow });
  const loading: string[] = [];
  const first = projectEnv(exec, "/w/repo/a", { loading: (d) => loading.push(d) });
  const second = projectEnv(exec, "/w/repo/b", { loading: (d) => loading.push(d) });
  await new Promise((r) => setTimeout(r, 5));
  // Still loading: the editor isn't waiting on it to work, and says so.
  expect(loading).toEqual(["/w/repo"]);
  expect(serverNote({ status: "env", envrc: "/w/repo", names: ["rust-analyzer"] }, "rust")!.short).toBe("loading .envrc…");
  release();
  expect((await first).kind).toBe("ready");
  expect((await second).kind).toBe("ready");
  const third = await projectEnv(exec, "/w/repo/c", { loading: (d) => loading.push(d) });
  expect(third.kind).toBe("ready");
  expect(loading).toEqual(["/w/repo"]);
  expect(calls.filter((c) => c.cmd === "direnv" && c.args[0] === "export").length).toBe(1);
});

test("a load that fails says why, and is tried again next time", async () => {
  const { exec, calls } = fake({ envrc: "/w/repo", fail: "error building flake" });
  expect(await projectEnv(exec, "/w/repo")).toEqual({ kind: "failed", dir: "/w/repo", note: "error building flake" });
  await projectEnv(exec, "/w/repo");
  expect(calls.filter((c) => c.cmd === "direnv" && c.args[0] === "export").length).toBe(2);
});

// ---- what the asked-for hover says (item: hover without a language server)

test("hover notes: each case says what is the case and what to do", () => {
  const n = (s: any, lang = "rust", empty = false) => serverNote(s, lang, { empty, tilde: (p: string) => p.replace("/Users/me", "~") });
  // No server is configured for the language.
  expect(n({ status: "none", why: "unknown" }, "csv")!.text).toBe("No language server is set up for csv files.");
  expect(n({ status: "none", why: "unknown" }, "csv")!.fix).toMatch(/editor\.languages\.csv\.server/);
  expect(n({ status: "none", why: "unknown" }, "text")!.text).toBe("Plain text: no language server.");
  expect(n({ status: "none", why: "off" })!.text).toMatch(/off for rust files/);
  // Its command isn't on PATH (no .envrc).
  expect(n({ status: "none", why: "missing", names: ["typescript-language-server", "vtsls"] }, "typescript")!.text).toBe("typescript-language-server or vtsls isn't on PATH.");
  // ... nor in the project's environment.
  expect(n({ status: "none", why: "missing", names: ["rust-analyzer"], envrc: "/Users/me/p", envKind: "ready" })!.text).toBe("rust-analyzer isn't in this project's environment (~/p/.envrc) or on PATH.");
  // Still starting; the environment still loading.
  expect(n({ status: "starting", name: "rust-analyzer" })!.text).toBe("rust-analyzer is starting.");
  expect(n({ status: "env", envrc: "/Users/me/p" })!.text).toMatch(/Loading this project's environment \(~\/p\/\.envrc\)/);
  // Running, with nothing for this place; running and asked about nothing else: no note.
  expect(n({ status: "ready", name: "rust-analyzer" }, "rust", true)!.text).toBe("rust-analyzer has nothing for this place.");
  expect(n({ status: "ready", name: "rust-analyzer" })).toBe(null);
  // Stopped.
  expect(n({ status: "exited", name: "rust-analyzer", note: "panicked" })!.text).toBe("rust-analyzer stopped: panicked");
});
