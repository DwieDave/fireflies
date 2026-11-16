// The mods' TypeScript in the editor (docs/mods-typescript.md, "In an
// editor"): the language server the editor starts for a .ts file, with the
// root the editor picks and the initialize it sends (src/lsp.rs), finds every
// module a mod file and a bun test import, and still reports a real type error.
//
// The server is the editor's first TypeScript candidate (logic.ts SERVERS) as
// the repository's dev shell has it (flake.nix; the editor loads it through
// .envrc and direnv): from PATH, else built from the nixpkgs flake.lock pins
// (`nix develop` would copy the whole checkout into the store first, minutes).
// Without either (CI without nix) the test is skipped and says so.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pickRoot, ROOTS, rootScript, serverCandidates, uri } from "../defaults/mods/editor/logic.ts";

const REPO = join(import.meta.dir, "..");
const MOD = join(REPO, "defaults/mods/usage/main.ts");
const TEST = join(REPO, "scripts/agents.test.ts");

interface Diagnostic {
  readonly code?: number | string;
  readonly message: string;
  readonly range: { readonly start: { readonly line: number } };
}

/** The editor's TypeScript server argv: its first candidate, from PATH, else
 *  the dev shell's build of it: the package from the nixpkgs flake.lock pins
 *  (what `use flake` puts in PATH; built offline when it is in the store). */
function serverArgv(): { argv: string[]; settings: unknown } | null {
  const pick = serverCandidates("typescript", {})[0];
  const program = pick?.argv[0];

  if (!pick || !program) return null;

  const run = (cmd: string[]): string => {
    const r = spawnSync(cmd[0] ?? "", cmd.slice(1), { cwd: REPO, encoding: "utf8", timeout: 600_000 });

    return r.status === 0 ? r.stdout.trim().split("\n").pop() ?? "" : "";
  };
  const inPath = run(["sh", "-c", `command -v ${program}`]);
  const lock: unknown = JSON.parse(readFileSync(join(REPO, "flake.lock"), "utf8"));
  const rev = /"rev":\s*"([0-9a-f]{40})"/.exec(JSON.stringify(lock))?.[1];
  const built = (offline: boolean): string => (rev ? run(["nix", "build", ...(offline ? ["--offline"] : []), "--no-link", "--print-out-paths", `github:NixOS/nixpkgs/${rev}#${program}`]) : "");
  const store = inPath ? "" : built(true) || built(false);
  const path = inPath || (store.startsWith("/") ? `${store}/bin/${program}` : "");

  return path.startsWith("/") ? { argv: [path, ...pick.argv.slice(1)], settings: pick.settings } : null;
}

/** The root the editor picks for `file` (lsp-client.ts lookups + pickRoot). */
function editorRoot(file: string): string {
  const dir = dirname(file);
  const out = spawnSync("sh", ["-c", rootScript(ROOTS.get("typescript")?.markers ?? []), "root", dir], { encoding: "utf8" });

  return pickRoot("typescript", out.stdout, dir);
}

/** A language server session over stdio, as src/lsp.rs speaks to it. */
class Session {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private next = 0;
  private readonly pending = new Map<number, (v: unknown) => void>();
  private readonly waiting = new Map<string, (d: readonly Diagnostic[]) => void>();
  private readonly versions = new Map<string, number>();

  constructor(argv: readonly string[], root: string) {
    this.proc = spawn(argv[0] ?? "", argv.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d: Buffer) => this.read(d));
  }

  private send(m: object): void {
    const text = JSON.stringify({ jsonrpc: "2.0", ...m });

    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  }

  private read(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);

    for (;;) {
      const head = this.buf.indexOf("\r\n\r\n");

      if (head < 0) return;

      const len = Number(/Content-Length: (\d+)/i.exec(this.buf.subarray(0, head).toString())?.[1] ?? 0);

      if (this.buf.length < head + 4 + len) return;

      const m = JSON.parse(this.buf.subarray(head + 4, head + 4 + len).toString());

      this.buf = this.buf.subarray(head + 4 + len);

      if (m.id !== undefined && m.method) this.send({ id: m.id, result: m.method === "workspace/configuration" ? m.params.items.map(() => null) : null });
      else if (m.id !== undefined) this.pending.get(m.id)?.(m.result ?? m.error);
      else if (m.method === "textDocument/publishDiagnostics") {
        // The server first answers with an empty list while it loads; the check's list follows.
        const done = this.waiting.get(m.params.uri);

        if (done && m.params.diagnostics.length) done(m.params.diagnostics);
      }
    }
  }

  request(method: string, params: object): Promise<unknown> {
    const id = ++this.next;

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: object): void {
    this.send({ method, params });
  }

  /** Opens `path` with `text` (or, open already, changes it to `text`) and
   *  waits for its diagnostics (an empty list after `quiet` ms). */
  diagnostics(path: string, text: string, quiet = 8000): Promise<readonly Diagnostic[]> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve([]), quiet);
      const version = (this.versions.get(path) ?? 0) + 1;

      this.waiting.set(uri(path), (d) => {
        clearTimeout(timer);
        resolve(d);
      });
      this.versions.set(path, version);

      if (version === 1) this.notify("textDocument/didOpen", { textDocument: { uri: uri(path), languageId: "typescript", version, text } });
      else this.notify("textDocument/didChange", { textDocument: { uri: uri(path), version }, contentChanges: [{ text }] });
    });
  }

  stop(): void {
    this.proc.kill();
  }
}

/** src/lsp.rs initialize_params, for `root` and the candidate's settings. */
async function started(argv: readonly string[], root: string, settings: unknown): Promise<Session> {
  const s = new Session(argv, root);

  await s.request("initialize", {
    processId: process.pid,
    clientInfo: { name: "herdr-app", version: "test" },
    rootUri: uri(root),
    rootPath: root,
    workspaceFolders: [{ uri: uri(root), name: root.split("/").pop() }],
    initializationOptions: settings,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: { synchronization: { didSave: true }, publishDiagnostics: { relatedInformation: true, versionSupport: true } },
    },
  });
  s.notify("initialized", {});

  return s;
}

const missing = (d: readonly Diagnostic[]): string[] => d.filter((x) => String(x.code) === "2307").map((x) => x.message);
const server = serverArgv();
const sessions: Session[] = [];

afterAll(() => sessions.forEach((s) => s.stop()));

describe.skipIf(!server)("the editor's TypeScript server on the repository", () => {
  let mod: Session;
  let tests: Session;

  beforeAll(async () => {
    if (!server) return;

    mod = await started(server.argv, editorRoot(MOD), server.settings);
    tests = await started(server.argv, editorRoot(TEST), server.settings);
    sessions.push(mod, tests);
  }, 600_000);

  test("a mod file finds herdr, gpui-kit, gpui-base and gpui-shell: no problem at all", async () => {
    expect(editorRoot(MOD)).toBe(join(REPO, "defaults"));

    const d = await mod.diagnostics(MOD, readFileSync(MOD, "utf8"));

    expect(missing(d)).toEqual([]);
    expect(d.map((x) => `${x.range.start.line + 1}: ${x.message}`)).toEqual([]);
  }, 60_000);

  test("a bun test finds bun:test, node: modules and the mods it imports", async () => {
    expect(editorRoot(TEST)).toBe(join(REPO, "scripts"));
    expect(missing(await tests.diagnostics(TEST, readFileSync(TEST, "utf8")))).toEqual([]);
  }, 60_000);

  test("a real type error in a mod file is still reported", async () => {
    // The open mod file, edited (not saved) as the editor sends a change: a wrong assignment.
    const text = `${readFileSync(MOD, "utf8")}\nexport const wrong: number = "not a number";\n`;
    const d = await mod.diagnostics(MOD, text, 30_000);

    expect(missing(d)).toEqual([]);
    expect(d.some((x) => String(x.code) === "2322" && x.message.includes("not assignable to type 'number'"))).toBe(true);
  }, 60_000);
});

test.skipIf(!!server)("the editor's TypeScript server is not here (no typescript-language-server, no nix): skipped", () => {
  console.warn("scripts/mod-types-lsp.test.ts: no typescript-language-server in PATH or the dev shell; the editor check is skipped");
});
