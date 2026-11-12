#!/usr/bin/env bun
// The editor's way from opening a file to its first hover answer, timed: the
// same steps nocturne-editor's startServer takes (envrc.js, logic.js), then
// the server spoken to as Fireflies' core speaks to it (src/lsp.rs: the same
// initialize), with its `$/progress` and a hover asked every 100 ms until one
// answers with something.
//
//   bun scripts/lsp-timeline.ts <file> <line> <col> [--settings json] [--quiet-ms 4000] [--max-s 900]
//
// line and col are one-based (as the bar shows them). Prints a timeline and,
// last, one JSON line with the phases' times (ms from the start).
import { projectEnv, lookup, wrap, forgetEnvs } from "../defaults/mods/nocturne-editor/envrc.js";
import { serverCandidates, languageSettings, ROOTS, rootScript, pickRoot, uri, languageId } from "../defaults/mods/nocturne-editor/logic.js";

const [file, lineArg, colArg, ...rest] = process.argv.slice(2);
if (!file || !lineArg) { console.error("usage: lsp-timeline.ts <file> <line> <col> [--settings json]"); process.exit(2); }
const opt = (name: string, d: string | null = null) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : d; };
const extra = opt("--settings") ? JSON.parse(opt("--settings")!) : null;
const quietMs = Number(opt("--quiet-ms", "4000"));
const maxS = Number(opt("--max-s", "900"));
const line = Number(lineArg) - 1, col = Number(colArg ?? 1) - 1;

const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
const marks: Record<string, number> = {};
const mark = (name: string, note = "") => { marks[name] ??= ms(); console.log(`${String(ms()).padStart(7)} ms  ${name}${note ? `  ${note}` : ""}`); };

/** herdr's exec, as Bun runs it. */
async function exec(cmd: string, args: string[] = [], o: { cwd?: string; timeout?: number } = {}) {
  const at = ms();
  const p = Bun.spawn([cmd, ...args], { cwd: o.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  const what = cmd === "sh" ? args[2] ?? "sh" : `${cmd} ${args[0] ?? ""}`;
  console.log(`${String(at).padStart(7)} ms  exec ${what}: ${ms() - at} ms`);
  return { code, stdout, stderr };
}

const lang = /\.rs$/.test(file) ? "rust" : /\.tsx$/.test(file) ? "tsx" : /\.ts$/.test(file) ? "typescript" : /\.m?js$/.test(file) ? "javascript" : "text";
const dir = file.slice(0, file.lastIndexOf("/"));
mark("open");
forgetEnvs();
const env = await projectEnv(exec, dir, { loading: () => mark("envrc loading") });
mark("env", env.kind);
const inEnv = env.kind === "ready" ? env.env : null;
const candidates = serverCandidates(lang, languageSettings({}, lang));
let pick: any = null, path: string | null = null;
for (const c of candidates) { path = await lookup(exec, c.argv[0], inEnv); if (path) { pick = c; break; } }
mark("lookup", path ?? "none");
if (!pick) process.exit(1);
const r = await exec("sh", ["-c", rootScript(ROOTS[lang]?.markers ?? []), "root", dir]);
const root = pickRoot(lang, r.stdout, dir);
mark("root", root);
const argv = wrap(pick.argv, path, inEnv);
const settings = extra ?? pick.settings ?? null;
const proc = Bun.spawn(argv, { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
mark("spawned");

// ---- LSP, as src/lsp.rs
let next = 1;
const pending = new Map<number, (m: any) => void>();
const send = (m: any) => { const b = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...m })); proc.stdin.write(`Content-Length: ${b.length}\r\n\r\n`); proc.stdin.write(b); proc.stdin.flush(); };
// Unanswered after 5 s: given up on (and cancelled), as a person would ask again.
const request = (method: string, params: any, wait = method === "initialize" ? 600000 : 5000) => new Promise<any>((res) => {
  const id = next++;
  pending.set(id, res);
  send({ id, method, params });
  setTimeout(() => { if (pending.delete(id)) { send({ method: "$/cancelRequest", params: { id } }); res({ error: { message: `no answer in ${wait} ms` } }); } }, wait);
});
const notify = (method: string, params: any) => send({ method, params });
const open = new Map<string, string>(); // progress token -> title
let lastProgress = 0, quiet = false;
(async () => {
  let buf = Buffer.alloc(0);
  for await (const chunk of proc.stdout as any) {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    for (;;) {
      const head = buf.indexOf("\r\n\r\n");
      if (head < 0) break;
      const n = Number(/content-length:\s*(\d+)/i.exec(buf.subarray(0, head).toString())?.[1]);
      if (buf.length < head + 4 + n) break;
      const m = JSON.parse(buf.subarray(head + 4, head + 4 + n).toString());
      buf = buf.subarray(head + 4 + n);
      if (m.id != null && m.method) {
        const result = m.method === "workspace/configuration" ? (m.params?.items ?? []).map((i: any) => (i.section ? i.section.split(".").reduce((v: any, k: string) => v?.[k], settings) ?? null : settings)) : null;
        send({ id: m.id, result });
      } else if (m.id != null) pending.get(m.id)?.(m), pending.delete(m.id);
      else if (m.method === "$/progress") {
        const v = m.params.value, tok = String(m.params.token);
        lastProgress = performance.now();
        if (v.kind === "begin") { open.set(tok, v.title); mark(`begin ${v.title}`, v.message ?? ""); }
        else if (v.kind === "end") { const title = open.get(tok); open.delete(tok); mark(`end ${title}`, v.message ?? ""); }
        else if (v.kind === "report" && process.env.VERBOSE) console.log(`${String(ms()).padStart(7)} ms    ${open.get(tok)}: ${v.message ?? ""} ${v.percentage ?? ""}`);
      } else if (m.method === "window/logMessage" && process.env.VERBOSE) console.log(`${String(ms()).padStart(7)} ms  log ${m.params.message}`);
    }
  }
  mark("server exited");
})();
let stderr = "";
(async () => { for await (const c of proc.stderr as any) stderr += Buffer.from(c).toString(); })();

const init = await request("initialize", {
  processId: process.pid, clientInfo: { name: "herdr-app", version: "timeline" }, rootUri: uri(root), rootPath: root,
  workspaceFolders: [{ uri: uri(root), name: root.split("/").pop() }], initializationOptions: settings,
  capabilities: {
    general: { positionEncodings: ["utf-16"] }, window: { workDoneProgress: true, showMessage: {} },
    workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: false } },
    textDocument: { synchronization: { didSave: true }, hover: { contentFormat: ["markdown", "plaintext"] }, definition: { linkSupport: true }, publishDiagnostics: { relatedInformation: true } },
  },
});
mark("initialize", init.error ? `error ${init.error.message}` : "");
notify("initialized", {});
if (settings) notify("workspace/didChangeConfiguration", { settings });
const text = await Bun.file(file).text();
notify("textDocument/didOpen", { textDocument: { uri: uri(file), languageId: languageId(lang, file), version: 1, text } });
mark("didOpen");

// A hover every 100 ms (one at a time) until one has something.
const hover = () => request("textDocument/hover", { textDocument: { uri: uri(file) }, position: { line, character: col } });
let first: any = null, asks = 0;
const deadline = performance.now() + maxS * 1000;
while (performance.now() < deadline) {
  const at = performance.now();
  const h = await hover();
  asks++;
  const took = Math.round(performance.now() - at);
  if (h.error) { if (process.env.VERBOSE) console.log(`${String(ms()).padStart(7)} ms    hover error after ${took} ms: ${h.error.message}`); }
  else if (h.result?.contents) {
    const v = typeof h.result.contents === "string" ? h.result.contents : h.result.contents.value ?? JSON.stringify(h.result.contents);
    first = { at: ms(), took, text: String(v).split("\n").filter((l: string) => l.trim() && !l.startsWith("```"))[0] };
    mark("first hover answer", `(${took} ms to answer, ${asks} asks) ${first.text}`);
    break;
  } else if (process.env.VERBOSE) console.log(`${String(ms()).padStart(7)} ms    hover null after ${took} ms`);
  await Bun.sleep(100);
}
// Then until the server is quiet (no progress open, none for quietMs).
while (performance.now() < deadline && (open.size || performance.now() - lastProgress < quietMs)) await Bun.sleep(100);
mark("quiet", open.size ? `still open: ${[...open.values()].join(", ")}` : "");
// Resident memory: the server and its helpers (rust-analyzer's proc-macro server), in MB.
const rss = async () => {
  const kids = (await exec("sh", ["-c", 'p=$1; all=$p; for c in $(pgrep -P $p); do all="$all,$c"; done; ps -o rss= -p $all', "rss", String(proc.pid)])).stdout;
  return Math.round(kids.split("\n").map(Number).filter(Boolean).reduce((a, b) => a + b, 0) / 1024);
};
const memory = await rss();
mark("memory", `${memory} MB`);
if (process.env.MEMDETAIL) {
  const m = await request("rust-analyzer/memoryUsage", null, 60000);
  console.log(String(m.result ?? m.error?.message).split("\n").slice(0, 40).join("\n"));
}
// A ready server's hover: five in a row.
const took: number[] = [];
for (let i = 0; i < 5; i++) { const at = performance.now(); await hover(); took.push(Math.round(performance.now() - at)); }
mark("ready hovers", took.join(" ") + " ms");
await request("shutdown", null);
notify("exit", null);
await Promise.race([proc.exited, Bun.sleep(2000)]);
proc.kill();
if (process.env.VERBOSE) console.log(stderr.split("\n").slice(-20).join("\n"));
console.log(JSON.stringify({ marks, readyHovers: took, memoryMB: memory }));
process.exit(0);
