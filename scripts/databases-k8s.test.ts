// A database's password that lives in a Kubernetes secret (defaults/mods/databases/kube.ts):
// the connect request names the secret, never the value; the window checks the names, reads it
// with one fixed kubectl call into its memory, shows where it came from, asks when the read fails
// (or the server refuses it), reads again at each connect, and saves the source, not the value.
// kubectl, the client and the keychain are stand-ins: no cluster, no server, no keychain touched.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";
import { found, standIn } from "./databases-host.ts";

const { h, theme, el, cx, forget, until, flush, advance, services } = standIn();
const { files, commands, opened, closed, execs, written, stores } = h;

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
(await import("../defaults/mods/databases/app.ts")).useServices(services);
const { runtime: dbRuntime } = await import("../defaults/mods/databases/app.ts");
const { viewRun } = await import("./databases-host.ts");
const runView = viewRun(dbRuntime);
const { command } = await import("../defaults/mods/databases/opening.ts");

function open(p: any) {
  h.props = p;
  const v: any = new Databases();
  v.init(p, cx);
  return v;
}
function render(v: any, width = 1100) {
  v.size = { width, height: 720 };
  h.drawn = [];
  v.render();
  return h.drawn;
}
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "databases");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
const fresh = () => { forget(); h.shared = {}; commands.length = 0; opened.length = 0; closed.length = 0; h.panes = []; h.focused = null; stores.clear(); execs.length = 0; written.length = 0; h.reply = found; };

const { kubeProblem, kubeReadArgs, kubeTemplate, parseKubeRead, kubeWords } = await import("../defaults/mods/databases/kube.ts");
const { saveFound } = await import("../defaults/mods/databases/conns.ts");
const { connectArgsOf } = await import("../defaults/mods/nocturne/databases.ts");

const PASSWORD = "moth-lantern-42";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const SOURCE = { from: "kubernetes", context: "nightjar-dev", namespace: "lantern", name: "lantern-db-auth", key: "password", userKey: "username" };
const ARGS = { kind: "postgres", name: "lantern-db (nightjar-dev/lantern)", host: "127.0.0.1", port: 15432, database: "lantern", from: "port-forward svc/lantern-db in nightjar-dev/lantern", secret: SOURCE };
const READ = ["--context=nightjar-dev", "--namespace=lantern", "get", "secret", "lantern-db-auth", "--request-timeout=10s", "-o", `go-template={{with .data}}{{with index . "password"}}{{.}}{{end}}{{"\\n"}}{{with index . "username"}}{{.}}{{end}}{{"\\n"}}{{end}}`];

/** The cluster's answers: the secret's values, a refusal, or a server that wants another password. */
let secretNow: string | null = PASSWORD;
let kubectlSays: { code: number; stderr: string } | null = null;
let serverRefuses = false;
const cluster = (cmd: string, args: string[]) => {
  if (cmd === "kubectl" || cmd.endsWith("/kubectl")) return kubectlSays ? { code: kubectlSays.code, stdout: "", stderr: kubectlSays.stderr } : { code: 0, stdout: `${secretNow === null ? "" : b64(secretNow)}\n${b64("lantern")}\n`, stderr: "" };
  if (cmd === "sh" && args[2] === "ff-db") return serverRefuses ? { code: 2, stdout: "", stderr: 'psql: error: connection to server at "127.0.0.1", port 15432 failed: FATAL:  password authentication failed for user "lantern"\n' } : { code: 0, stdout: "", stderr: "" };
  return found(cmd, args);
};
const kubectlCalls = () => execs.filter((a) => a[0] === "kubectl" || a[0]!.endsWith("/kubectl"));
const reset = () => { fresh(); h.reply = cluster; secretNow = PASSWORD; kubectlSays = null; serverRefuses = false; };
/** Everything the window put anywhere but its memory: argv, shared state, files, what it drew, its notes. */
const outside = (v: any) => [JSON.stringify(execs), JSON.stringify(h.shared), JSON.stringify(written.filter(([p]) => !/\/s-[a-z0-9]+$/.test(p))), JSON.stringify(commands), JSON.stringify(opened), texts(render(v)).join(" "), v.note?.text ?? "", JSON.stringify(v.log), JSON.stringify(v.history), JSON.stringify(v.sent), JSON.stringify(v.saved), JSON.stringify([...v.sourced])].join("\n");

test("the source's rules: only Postgres or MySQL on this machine, names kubernetes allows, kubectl by its name", () => {
  expect(kubeProblem(SOURCE as any, "postgres", "127.0.0.1")).toBeNull();
  expect(kubeProblem(SOURCE as any, "mysql", "localhost")).toBeNull();
  expect(kubeProblem(SOURCE as any, "postgres", "db.example.com")).toContain("on this machine");
  expect(kubeProblem(SOURCE as any, "postgres", undefined)).toContain("on this machine");
  expect(kubeProblem(SOURCE as any, "sqlite", "127.0.0.1")).toContain("only for Postgres and MySQL");
  expect(kubeProblem({ ...SOURCE, name: "--kubeconfig=/tmp/x" } as any, "postgres", "127.0.0.1")).toContain("name");
  expect(kubeProblem({ ...SOURCE, namespace: "Lantern" } as any, "postgres", "127.0.0.1")).toContain("namespace");
  expect(kubeProblem({ ...SOURCE, key: 'password"}}{{.' } as any, "postgres", "127.0.0.1")).toContain("key");
  expect(kubeProblem({ ...SOURCE, context: "a\nb" } as any, "postgres", "127.0.0.1")).toContain("context");
  expect(kubeProblem({ ...SOURCE, kubectl: "/bin/sh" } as any, "postgres", "127.0.0.1")).toContain("kubectl");
  expect(kubeProblem({ ...SOURCE, kubectl: "/nix/store/abc-kubectl-1.31/bin/kubectl" } as any, "postgres", "127.0.0.1")).toBeNull();
  expect(kubeWords(SOURCE as any)).toBe("secret lantern-db-auth · password (nightjar-dev/lantern), read with kubectl");
});

test("one fixed read: its argv, the template's lines, an absent key, an answer that isn't base64, kubectl's refusal", () => {
  expect(kubeReadArgs(SOURCE as any)).toEqual({ program: "kubectl", args: READ });
  expect(kubeReadArgs({ ...SOURCE, kubectl: "/opt/bin/kubectl" } as any).program).toBe("/opt/bin/kubectl");
  expect(kubeTemplate({ ...SOURCE, userKey: undefined, databaseKey: "dbname" } as any)).toBe('{{with .data}}{{with index . "password"}}{{.}}{{end}}{{"\\n"}}{{with index . "dbname"}}{{.}}{{end}}{{"\\n"}}{{end}}');
  const ok = (stdout: string) => parseKubeRead(SOURCE as any, { code: 0, stdout, stderr: "" });
  expect(ok(`${b64(PASSWORD)}\n${b64("lantern")}\n`)).toEqual({ password: PASSWORD, user: "lantern" });
  expect(ok(`${b64(PASSWORD)}\n\n`)).toEqual({ password: PASSWORD });
  expect(ok("\n\n")).toEqual({ error: "the secret lantern-db-auth has no password" });
  expect(ok("")).toEqual({ error: "the secret lantern-db-auth has no password" });
  expect(ok("%%%\n\n")).toEqual({ error: "the secret's password isn't text" });
  const no = (code: number, stderr: string) => parseKubeRead(SOURCE as any, { code, stdout: "", stderr });
  expect(no(1, 'Error from server (Forbidden): secrets "lantern-db-auth" is forbidden: User "ada" cannot get resource "secrets"\n')).toEqual({ error: 'Error from server (Forbidden): secrets "lantern-db-auth" is forbidden: User "ada" cannot get resource "secrets"' });
  expect(no(1, 'Error from server (NotFound): secrets "lantern-db-auth" not found\n')).toEqual({ error: 'Error from server (NotFound): secrets "lantern-db-auth" not found' });
  expect(no(127, "sh: kubectl: command not found")).toEqual({ error: "kubectl isn't there (not on the app's PATH)" });
});

test("a sent connection with a secret: read once with kubectl, into memory only, connected; the row and head say where it came from", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush();
  expect(kubectlCalls()).toEqual([["kubectl", ...READ]]);
  expect(v.sent[0]).toMatchObject({ kind: "postgres", host: "127.0.0.1", port: 15432, user: "lantern", database: "lantern", secret: "kubernetes", source: SOURCE, origin: "sent" });
  expect(v.secrets.get(v.sent[0].id)).toBe(PASSWORD);
  expect(v.active?.id).toBe(v.sent[0].id);
  expect(v.password).toBeNull();
  // The client got it the way every password goes: a one-shot file in the private folder, never an argument.
  expect(written.some(([p, t]) => /\/s-[a-z0-9]+$/.test(p) && t === PASSWORD)).toBe(true);
  const shown = texts(render(v));
  expect(shown).toEqual(expect.arrayContaining(["lantern-db-auth", "· password from secret lantern-db-auth · password (nightjar-dev/lantern), read with kubectl"]));
  expect(outside(v)).not.toContain(PASSWORD);
  expect(outside(v)).not.toContain(b64(PASSWORD));
  await v.close();
  expect(v.secrets.size).toBe(0);
  expect(v.sourced.size).toBe(0);
});

test("a reconnect reads again: a rotated password is the one used", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush();
  secretNow = "moth-lantern-43";
  v.connectTo(v.sent[0], cx);
  await flush(); await flush();
  expect(kubectlCalls().length).toBe(2);
  expect(v.secrets.get(v.sent[0].id)).toBe("moth-lantern-43");
  expect(written.filter(([p]) => /\/s-[a-z0-9]+$/.test(p)).at(-1)?.[1]).toBe("moth-lantern-43");
});

test("a failed read says why and asks; the typed password connects without reading again", async () => {
  reset();
  kubectlSays = { code: 1, stderr: 'Error from server (Forbidden): secrets "lantern-db-auth" is forbidden: User "ada" cannot get resource "secrets" in the namespace "lantern"\n' };
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush();
  const id = v.sent[0].id;
  expect(v.secrets.has(id)).toBe(false);
  expect(v.password?.conn).toBe(id);
  expect(v.sourced.get(id)).toEqual({ ok: false, text: 'couldn\'t read secret lantern-db-auth · password: Error from server (Forbidden): secrets "lantern-db-auth" is forbidden: User "ada" cannot get resource "secrets" in the namespace "lantern"' });
  expect(texts(render(v)).join(" ")).toContain("couldn't read secret lantern-db-auth · password: Error from server (Forbidden)");
  v.password.input.set_value("typed-by-hand-7");
  v.key(key("enter"), cx);
  await flush(); await flush();
  expect(kubectlCalls().length).toBe(1);
  expect(v.secrets.get(id)).toBe("typed-by-hand-7");
  expect(execs.some((a) => a[0] === "sh" && a[3] === "ff-db")).toBe(true);
  // kubectl missing: said so, asked too.
  reset();
  h.reply = (cmd: string, args: string[]) => (cmd === "kubectl" ? { code: 127, stdout: "", stderr: "sh: kubectl: command not found" } : cluster(cmd, args));
  const w = open({ folder: "/w", overlay: "w2" });
  await flush();
  command(w, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush();
  expect(w.sourced.get(w.sent[0].id)?.text).toBe("couldn't read secret lantern-db-auth · password: kubectl isn't there (not on the app's PATH)");
  expect(w.password).not.toBeNull();
});

test("the server refuses the secret's password: asked once, the reason shown", async () => {
  reset();
  serverRefuses = true;
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush(); await flush();
  expect(v.password).not.toBeNull();
  expect(v.sourced.get(v.sent[0].id)).toEqual({ ok: false, text: "the server refused the password from secret lantern-db-auth · password" });
  v.password.input.set_value("still-wrong-1");
  v.key(key("enter"), cx);
  await flush(); await flush(); await flush();
  expect(v.password).toBeNull();
  expect(kubectlCalls().length).toBe(1);
});

test("a request that would send a cluster's secret elsewhere, or names a bad one, is refused: nothing read", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  command(v, `databases.connect:${JSON.stringify({ ...ARGS, host: "db.example.com" })}`, cx);
  expect(v.note.text).toBe("databases.connect: a secret is read only for a server on this machine (127.0.0.1, a port-forward)");
  command(v, `databases.connect:${JSON.stringify({ ...ARGS, secret: { ...SOURCE, kubectl: "/bin/sh" } })}`, cx);
  expect(v.note.text).toContain("kubectl must be kubectl");
  command(v, `databases.connect:${JSON.stringify({ ...ARGS, secret: { ...SOURCE, from: "vault" } })}`, cx);
  expect(v.note.text).toContain("isn't a connection");
  await flush();
  expect(v.sent).toEqual([]);
  expect(kubectlCalls()).toEqual([]);
});

test("saved: the source is kept (read again at each connect), never the password, and the keychain is left alone", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await flush(); await flush();
  await runView(saveFound(v, v.sent[0]));
  const file = written.find(([p]) => p.endsWith("/data/databases/connections.json"));
  const doc = JSON.parse(file?.[1] ?? "{}");
  expect(doc.connections[0]).toMatchObject({ kind: "postgres", host: "127.0.0.1", port: 15432, user: "lantern", secret: "kubernetes", source: SOURCE });
  expect(file?.[1]).not.toContain(PASSWORD);
  expect(execs.some((a) => a[0] === "security" || (a[0] === "sh" && a[3] === "ff-keychain"))).toBe(false);
  expect(v.note.text).toBe("pinned lantern-db (nightjar-dev/lantern): every Databases window lists it · its password is read from secret lantern-db-auth at each connect");
  expect(v.active?.secret).toBe("kubernetes");
  expect(v.secrets.get(v.active.id)).toBe(PASSWORD);
  // Connected again later: read again.
  v.connectTo(v.saved[0], cx);
  await flush(); await flush();
  expect(kubectlCalls().length).toBe(2);
  // Edited without typing a password: the source stays; typed: the keychain takes over.
  v.key(key("1"), cx);
  v.connAt = 0;
  v.key(key("e"), cx);
  expect(v.form.conn(v.saved[0].id)).toMatchObject({ secret: "kubernetes", source: SOURCE });
  v.form.inputs.get("password").set_value("from-now-on-9");
  h.platform = "macos";
  expect(v.form.conn(v.saved[0].id).secret).toBe("keychain");
  h.platform = "linux";
  expect(v.form.conn(v.saved[0].id).source).toBeUndefined();
});

test("opened with it in its props (nocturne.databases:{…}, openOverlay elsewhere): the same read; nocturne's copy of the guard takes the secret", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w2", connect: ARGS });
  await flush(); await flush();
  expect(kubectlCalls()).toEqual([["kubectl", ...READ]]);
  expect(v.secrets.get(v.sent[0].id)).toBe(PASSWORD);
  expect(connectArgsOf(JSON.stringify({ ...ARGS, as: "pane" }))).toEqual({ ...ARGS, as: "pane" } as any);
  expect(connectArgsOf(JSON.stringify({ ...ARGS, secret: { ...SOURCE, password: PASSWORD, from: "env" } }))).toBeNull();
});
