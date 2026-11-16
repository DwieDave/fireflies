// The mods' Effect kit (defaults/lib/@fireflies/kit, @fireflies/kit): its test layers
// stand in for the app, so nothing here mocks a module. HTTP runs against
// fakes: an in-memory server (httpTest) and, for the curl transport, a
// local Bun server reached by the real curl. No request leaves the machine.
import { test, expect, afterAll } from "bun:test";
import { Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { DecodeError, Exec, Files, Hc, Workspace, curlClient, decodeJson, decodeJsonOption, execJson, execOk, filesService, hcJson, hcOk, here, hereOf, listOf, localStamp, localTime, mapOf, modRuntime, policy, readShared, retryAfter, sharedKey, Shared, writeShared } from "@fireflies/kit";
import { execTest, filesTest, hcTest, httpTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";

const Answer = Schema.Struct({ used: Schema.Finite, plan: Schema.NullOr(Schema.String) });

// ---- decoding

test("decodeJson: the value, or a DecodeError naming its source and where it differed", async () => {
  const read = decodeJson(Answer, "the usage endpoint");
  expect(await Effect.runPromise(read('{"used": 3, "plan": null}'))).toEqual({ used: 3, plan: null });
  const bad = await Effect.runPromise(Effect.flip(read('{"used": "3"}')));
  expect(bad).toBeInstanceOf(DecodeError);
  expect(bad.what).toBe("the usage endpoint");
  expect(bad.message).toContain("used");
  expect((await Effect.runPromise(Effect.flip(read("not json")))).what).toBe("the usage endpoint");
});

test("execJson: exit 0 and JSON of the shape, else ExitError / DecodeError, typed", async () => {
  const exec = execTest((_c, args) => (args[0] === "ok" ? { code: 0, stdout: '{"used":1,"plan":"max"}', stderr: "" } : args[0] === "bad" ? { code: 0, stdout: "[]", stderr: "" } : { code: 2, stdout: "", stderr: "line one\nno such thing" }));
  const read = execJson(Answer, "probe");
  const run = <A, E>(e: Effect.Effect<A, E, Exec>) => Effect.runPromise(Effect.result(Effect.provide(e, exec.layer)));
  expect((await run(read("probe", ["ok"]))).success).toEqual({ used: 1, plan: "max" });
  expect((await run(read("probe", ["bad"]))).failure?._tag).toBe("DecodeError");
  const failed = (await run(read("probe", ["no"]))).failure;
  expect(failed?._tag).toBe("ExitError");
  expect(failed?.message).toBe("no such thing");
  expect(exec.calls.map((c) => c.args[0])).toEqual(["ok", "bad", "no"]);
});

test("exec that can't run at all is an ExecError, not a throw", async () => {
  const exec = execTest(() => { throw new Error("no such program"); });
  const e = await Effect.runPromise(Effect.flip(Effect.provide(execOk("nope", []), exec.layer)));
  expect(e._tag).toBe("ExecError");
  expect(e.message).toBe("no such program");
});

// ---- shared keys

test("a shared key reads its value, and absent or another shape as none / the fallback", async () => {
  const KEY = sharedKey("t.k", Schema.Struct({ n: Schema.Finite }));
  const s = sharedTest();
  const get = Effect.provide(Shared.use((x) => x.get(KEY)), s.layer);
  expect(Option.isNone(await Effect.runPromise(get))).toBe(true);
  await Effect.runPromise(Effect.provide(Shared.use((x) => x.set(KEY, { n: 2 })), s.layer));
  expect(await Effect.runPromise(get)).toEqual(Option.some({ n: 2 }));
  s.store.set("t.k", { n: "two" });
  expect(Option.isNone(await Effect.runPromise(get))).toBe(true);
  // The render-side reader over herdr's shared / setShared.
  const raw = new Map<string, unknown>([["t.k", { n: 5 }]]);
  expect(readShared((k) => raw.get(k), KEY, { n: 0 })).toEqual({ n: 5 });
  writeShared((k, v) => { raw.set(k, v); return null; }, KEY, { n: 6 });
  expect(raw.get("t.k")).toEqual({ n: 6 });
  raw.set("t.k", "junk");
  expect(readShared((k) => raw.get(k), KEY, { n: 0 })).toEqual({ n: 0 });
});

test("listOf / mapOf: a list or map read entry by entry, an entry of another shape left out, not the whole value", async () => {
  const Row = Schema.Struct({ id: Schema.String, n: Schema.Finite });
  const ROWS = sharedKey("t.rows", listOf(Row));
  const TOLD = sharedKey("t.told", mapOf(Schema.Finite));
  const raw = new Map<string, unknown>();
  const read = (k: string) => raw.get(k);
  const write = (k: string, v: unknown) => { raw.set(k, v); return null; };
  // guard.ts readSharedList: absent, not a list, and mixed entries.
  expect(readShared(read, ROWS, [])).toEqual([]);
  raw.set("t.rows", { id: "a" });
  expect(readShared(read, ROWS, [])).toEqual([]);
  raw.set("t.rows", [{ id: "a", n: 1 }, "junk", { id: "b" }, { id: "c", n: 3 }]);
  expect(readShared(read, ROWS, [])).toEqual([{ id: "a", n: 1 }, { id: "c", n: 3 }]);
  // guard.ts readSharedMap / writeSharedMap: an object keyed by data, as a Map.
  raw.set("t.told", { "/a": 1, "/b": "two", "/c": 3 });
  const told = readShared(read, TOLD, new Map());
  expect(told).toEqual(new Map([["/a", 1], ["/c", 3]]));
  expect(readShared(read, TOLD, new Map([["x", 0]]))).toEqual(new Map([["/a", 1], ["/c", 3]]));
  raw.set("t.told", [1, 2]);
  expect(readShared(read, TOLD, new Map())).toEqual(new Map());
  expect(writeShared(write, TOLD, new Map(told).set("/d", 4))).toBe(true);
  expect(raw.get("t.told")).toEqual({ "/a": 1, "/c": 3, "/d": 4 });
  // An entry its own schema can't encode isn't written: the whole write is refused, as for any key.
  expect(writeShared(write, TOLD, new Map([["/x", Number.NaN]]))).toBe(false);
  expect(raw.get("t.told")).toEqual({ "/a": 1, "/c": 3, "/d": 4 });
  // A key whose data holds what an object's prototype has is just an entry.
  raw.set("t.told", JSON.parse('{"__proto__": 7, "constructor": 8}'));
  expect(readShared(read, TOLD, new Map())).toEqual(new Map([["__proto__", 7], ["constructor", 8]]));
  // The Shared service and the test store, and guard.ts parseJsonMap.
  const s = sharedTest();
  await Effect.runPromise(Effect.provide(Shared.use((x) => x.set(ROWS, [{ id: "z", n: 9 }])), s.layer));
  expect(s.store.get("t.rows")).toEqual([{ id: "z", n: 9 }]);
  s.store.set("t.rows", [{ id: "z", n: 9 }, null]);
  expect(await Effect.runPromise(Effect.provide(Shared.use((x) => x.get(ROWS)), s.layer))).toEqual(Option.some([{ id: "z", n: 9 }]));
  expect(decodeJsonOption(mapOf(Row))('{"k": {"id": "k", "n": 1}, "j": 2}')).toEqual(Option.some(new Map([["k", { id: "k", n: 1 }]])));
  expect(Option.isNone(decodeJsonOption(mapOf(Row))("[]"))).toBe(true);
});

// ---- herdr-core, files, the window

test("hc: hcOk / hcJson ask exit 0 and decode; a failure names the hc subcommand", async () => {
  const core = hcTest((args) => (args[0] === "get" ? { code: 0, stdout: '{"used":1,"plan":null}', stderr: "" } : args[0] === "label" ? { code: 0, stdout: "ok\n", stderr: "" } : { code: 1, stdout: "", stderr: "hc: no terminal t9" }));
  const run = <A, E>(e: Effect.Effect<A, E, Hc>) => Effect.runPromise(Effect.result(Effect.provide(e, core.layer)));
  expect((await run(hcJson(Answer, "hc get")(["get", "t1", "--json"]))).success).toEqual({ used: 1, plan: null });
  expect((await run(hcOk(["label", "t1", "a=b"]))).success).toBe("ok\n");
  const failed = (await run(hcOk(["read", "t9"]))).failure;
  expect(failed?._tag).toBe("ExitError");
  expect(failed?._tag === "ExitError" ? [failed.command, failed.message] : []).toEqual(["hc read", "hc: no terminal t9"]);
  expect(core.calls).toEqual([["get", "t1", "--json"], ["label", "t1", "a=b"], ["read", "t9"]]);
  const down = hcTest(() => Promise.reject(new Error("core not running")));
  const e = await Effect.runPromise(Effect.flip(Effect.provide(hcOk(["ls"]), down.layer)));
  expect([e._tag, e.message]).toEqual(["ExecError", "core not running"]);
});

test("Files.list: a folder's names sorted, none when it isn't there, a FileError for a file", async () => {
  const fs = filesTest(new Map([["/m/b/main.ts", ""], ["/m/a/main.ts", ""], ["/m/a/mod.json", ""], ["/m/readme", ""]]), new Set(["/m/empty"]));
  const list = (dir: string) => Effect.runPromise(Effect.result(Effect.provide(Files.use((f) => f.list(dir)), fs.layer)));
  expect((await list("/m")).success).toEqual(Option.some(["a", "b", "empty", "readme"]));
  expect((await list("/m/a/")).success).toEqual(Option.some(["main.ts", "mod.json"]));
  expect((await list("/m/empty")).success).toEqual(Option.some([]));
  expect((await list("/gone")).success).toEqual(Option.none());
  expect((await list("/m/readme")).failure?._tag).toBe("FileError");
  // The live shape: filesService over exists + readdir (fs/promises in the app).
  const live = filesService(() => Promise.resolve(null), () => Promise.resolve(), {
    exists: (dir) => Promise.resolve(dir === "/x"),
    names: () => Promise.resolve(["z", "a"]),
  });
  expect(await Effect.runPromise(live.list("/x"))).toEqual(Option.some(["a", "z"]));
  expect(await Effect.runPromise(live.list("/y"))).toEqual(Option.none());
  const denied = filesService(() => Promise.resolve(null), () => Promise.resolve(), { exists: () => Promise.reject(new Error("outside the mod's roots")), names: () => Promise.resolve([]) });
  expect((await Effect.runPromise(Effect.flip(denied.list("/etc")))).message).toBe("outside the mod's roots");
  // A library handed only read and write: list fails saying so.
  expect((await Effect.runPromise(Effect.flip(filesService(() => Promise.resolve(null), () => Promise.resolve()).list("/x"))))._tag).toBe("FileError");
});

const space = (over: Record<string, unknown>) => ({ id: "s1", active: true, machine: null, attached: false, folder: "", tabs: [{ id: "tb1", active: true }], ...over });
const pane = (id: string, cwd: string | null, terminal: string | null = `t${id}`) => ({ pane: id, tab: "tb1", terminal, cwd });

test("here: the shown space's own folder, else the focused terminal's, else one in the shown tab, else the space's", async () => {
  type Shown = Parameters<typeof hereOf>[0];
  const at = (spaces: unknown[], panes: unknown[], focused: unknown) => hereOf({ spaces, panes, focused } as unknown as Shown);
  expect(at([space({ attached: true, folder: "/repo", machine: "vps" })], [pane("p1", "/elsewhere")], { pane: "p1", cwd: "/elsewhere" })).toEqual({ folder: Option.some("/repo"), on: "vps" });
  expect(at([space({ folder: "/home" })], [pane("p1", "/one"), pane("p2", "/two")], { pane: "p2", cwd: "/two" }).folder).toEqual(Option.some("/two"));
  // A focused mod pane: the first terminal's folder in the tab.
  expect(at([space({ folder: "/home" })], [pane("p3", null, null), pane("p1", "/one")], { pane: "p3", cwd: null }).folder).toEqual(Option.some("/one"));
  expect(at([space({ folder: "/home" })], [], null).folder).toEqual(Option.some("/home"));
  expect(at([space({})], [], null).folder).toEqual(Option.none());
  expect(at([], [], { cwd: "/f" })).toEqual({ folder: Option.some("/f"), on: null });
  // The effect reads the same through the Workspace.
  const ws = workspaceTest({ spaces: () => [space({ folder: "/home" })] as never, panes: () => [pane("p1", "/one")] as never, focused: () => ({ pane: "p1", cwd: "/one" }) as never, agents: () => [] });
  expect((await Effect.runPromise(Effect.provide(here, ws.layer))).folder).toEqual(Option.some("/one"));
  expect(await Effect.runPromise(Effect.provide(Workspace.use((w) => w.focused), workspaceTest().layer))).toEqual(Option.none());
  expect(await Effect.runPromise(Effect.provide(Workspace.use((w) => w.agents), workspaceTest().layer))).toEqual([]);
});

test("localTime / localStamp: the local date and time, a plain stamp", () => {
  // The system zone, read back from the fields: the stamp prints exactly those.
  const ms = Date.UTC(2026, 10, 16, 13, 5, 9);
  const t = localTime(ms);
  expect(t.month).toBeGreaterThanOrEqual(1);
  expect(Date.UTC(t.year, t.month - 1, t.day, t.hours, t.minutes, t.seconds) - t.offset * 60_000).toBe(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  expect(localStamp(ms)).toBe(`${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hours)}:${two(t.minutes)}`);
  expect(localStamp(ms, { seconds: true })).toEndWith(`:${two(t.minutes)}:09`);
  expect(localStamp(ms, { zone: true })).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d [+-]\d{4}$/);
});

// ---- HTTP: the policy

const get = (url: string) => HttpClient.HttpClient.use((c) => policy({ timeout: "5 seconds", retries: 3, base: "1 second" })(c).execute(HttpClientRequest.get(url)));

/** Runs `effect` with the test clock, advancing it a minute at a time until it ends. */
async function withClock<A, E>(effect: Effect.Effect<A, E>, steps = 30) {
  return Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(effect));
    for (let i = 0; i < steps; i++) yield* TestClock.adjust("1 minute");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
}

test("policy: a 503 is retried with back-off until it answers", async () => {
  let n = 0;
  const http = httpTest(() => (++n < 3 ? { status: 503 } : { status: 200, body: '{"used":4,"plan":null}' }));
  const exit = await withClock(Effect.provide(Effect.flatMap(get("https://fake.test/usage"), HttpClientResponse.schemaBodyJson(Answer)), http.layer));
  expect(exit).toEqual(Exit.succeed({ used: 4, plan: null }));
  expect(http.requests.length).toBe(3);
});

test("policy: a 429 waits its short Retry-After; a long one isn't waited here, the caller backs off", async () => {
  let n = 0;
  const short = httpTest(() => (++n === 1 ? { status: 429, headers: [["retry-after", "20"]] } : { status: 200, body: "{}" }));
  expect(Exit.isSuccess(await withClock(Effect.provide(get("https://fake.test/a"), short.layer)))).toBe(true);
  expect(short.requests.length).toBe(2);

  const long = httpTest(() => ({ status: 429, headers: [["retry-after", "900"]] }));
  const exit = await withClock(Effect.provide(get("https://fake.test/b"), long.layer));
  expect(long.requests.length).toBe(1);
  expect(Exit.isFailure(exit)).toBe(true);
  const error = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined;
  const response = error?._tag === "Fail" && error.error.reason._tag === "StatusCodeError" ? error.error.reason.response : undefined;
  expect(response?.status).toBe(429);
  expect(response && Option.map(retryAfter(response.headers, Date.now()), (d) => d.toJSON())).toEqual(Option.some({ _id: "Duration", _tag: "Millis", millis: 900_000 }));
});

test("policy: a POST is never retried (it may have landed); a 404 isn't either", async () => {
  const http = httpTest(() => ({ status: 503 }));
  const post = HttpClient.HttpClient.use((c) => policy({ timeout: "5 seconds", retries: 3 })(c).execute(HttpClientRequest.post("https://fake.test/write")));
  expect(Exit.isFailure(await withClock(Effect.provide(post, http.layer)))).toBe(true);
  expect(http.requests.length).toBe(1);
  const missing = httpTest(() => ({ status: 404 }));
  expect(Exit.isFailure(await withClock(Effect.provide(get("https://fake.test/x"), missing.layer)))).toBe(true);
  expect(missing.requests.length).toBe(1);
});

test("policy: a request that never answers times out per attempt, then gives up after its retries", async () => {
  const http = httpTest(() => new Promise(() => {}));
  const exit = await withClock(Effect.provide(get("https://fake.test/hang"), http.layer));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(http.requests.length).toBe(4);
});

// ---- HTTP: curl, with its secret header kept in the shell

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/busy") return new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    return Response.json({ path: url.pathname, auth: req.headers.get("authorization"), q: url.searchParams.get("q"), method: req.method, body: req.method === "POST" ? "posted" : null });
  },
});
afterAll(() => server.stop(true));

// Spawned without blocking: the fake server answers from this same process.
const realExec = execTest(async (command, args) => {
  const p = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
});
const run = (command: string, args: readonly string[]) => Effect.provide(Exec.use((e) => e.run(command, args)), realExec.layer);

test("curl: the header script's lines reach the server, never curl's arguments; status, body, Retry-After", async () => {
  // The secret is read inside the shell (as a login is, from the keychain): no process's arguments hold it.
  const secret = `${Bun.env.TMPDIR ?? "/tmp"}/effect-kit-secret-${process.pid}`;
  await Bun.write(secret, "sekrit");
  const client = curlClient(run, { headersFrom: `printf 'Authorization: Bearer %s\\n' "$(cat '${secret}')"` });
  const r = await Effect.runPromise(client.execute(HttpClientRequest.get(`http://localhost:${server.port}/u`, { urlParams: { q: "a b" } })));
  expect(r.status).toBe(200);
  expect(await Effect.runPromise(r.json)).toEqual({ path: "/u", auth: "Bearer sekrit", q: "a b", method: "GET", body: null });
  expect(realExec.calls.at(-1)?.args.join(" ")).not.toContain("sekrit");

  const busy = await Effect.runPromise(client.execute(HttpClientRequest.get(`http://localhost:${server.port}/busy`)));
  expect(busy.status).toBe(429);
  expect(Option.map(retryAfter(busy.headers, Date.now()), (d) => d.toJSON())).toEqual(Option.some({ _id: "Duration", _tag: "Millis", millis: 120_000 }));
});

test("curl: a header script that exits non-zero sends nothing", async () => {
  let hits = 0;
  const counting = Bun.serve({ port: 0, fetch: () => { hits++; return new Response("{}"); } });
  try {
    const client = curlClient(run, { headersFrom: "exit 3" });
    const e = await Effect.runPromise(Effect.flip(client.execute(HttpClientRequest.get(`http://localhost:${counting.port}/`))));
    expect(e.reason._tag).toBe("TransportError");
    expect(e.reason._tag === "TransportError" && e.reason.cause instanceof Error ? e.reason.cause.name : "").toBe("HeaderScriptExit");
    expect(hits).toBe(0);
  } finally {
    counting.stop(true);
  }
});

test("curl: nobody listening is a transport error (retried by the policy, then given up)", async () => {
  const client = curlClient(run, { seconds: 2 });
  const e = await Effect.runPromise(Effect.flip(client.execute(HttpClientRequest.get("http://127.0.0.1:9/"))));
  expect(e.reason._tag).toBe("TransportError");
});

// ---- the view runtime

test("a copy's runs: failures reported in its words, interruptions silent, close interrupts what's left", async () => {
  const notified: string[] = [];
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  // A stand-in AsyncContext: the parts the kit uses (notify, timer.after).
  const cx = {
    notify: () => { notified.push("notify"); },
    timer: { after: (ms: number, fire: () => void) => { const t = { ms, fire, cancelled: false }; timers.push(t); return { cancel: () => { t.cancelled = true; }, is_done: () => false }; } },
  };
  const said: string[] = [];
  const rt = modRuntime(Layer.empty);
  // SAFETY: the stand-in has every member of AsyncContext the kit calls (notify, timer.after).
  const fx = rt.attach(cx as never, (m) => said.push(m));

  fx.run(Effect.fail(new DecodeError({ what: "x", message: "the answer wasn't a list" })));
  await Bun.sleep(5);
  expect(said).toEqual(["the answer wasn't a list"]);
  expect(notified.length).toBe(1);

  // A sleep runs on the copy's cx.timer (the engine has no setTimeout).
  let woke = false;
  fx.run(Effect.sleep("3 seconds").pipe(Effect.tap(() => Effect.sync(() => { woke = true; }))));
  await Bun.sleep(5);
  expect(timers.map((t) => t.ms)).toEqual([3000]);
  timers[0]?.fire();
  await Bun.sleep(5);
  expect(woke).toBe(true);

  // Latest wins under a key; close interrupts the rest and cancels their timers, reporting nothing.
  fx.run(Effect.sleep("1 minute"), { key: "read" });
  fx.run(Effect.sleep("2 minutes"), { key: "read" });
  await Bun.sleep(5);
  expect(timers.slice(1).map((t) => [t.ms, t.cancelled])).toEqual([[60_000, true], [120_000, false]]);
  expect(fx.running()).toBe(1);
  await fx.close();
  expect(fx.running()).toBe(0);
  expect(timers[2]?.cancelled).toBe(true);
  expect(said.length).toBe(1);
  fx.run(Effect.fail(new DecodeError({ what: "x", message: "after close" })));
  await Bun.sleep(5);
  expect(said.length).toBe(1);
});

// ---- the tests' mod loader

// The look library re-exports others (`export * from "@fireflies/tones"`): the
// test loaders follow re-exports and import() as they do imports.
const gpui = () => {
  const el: any = new Proxy(() => el, { get: () => el, apply: () => el });
  return { div: () => el, svg: () => el, PathBuilder: class {}, Background: {} };
};
const app = { settings: () => ({}), window: () => ({ platform: "macos" }), shared: () => undefined, setShared: () => null };

test("a library re-exporting another loads through importLibrary and importMod", async () => {
  const { importLibrary, importMod } = await import("./mod-source.ts");
  const look = await importLibrary("@fireflies/look", { herdr: app, "gpui-kit": gpui(), "gpui-base": { h_flex: () => ({}) } });
  expect(typeof look.edge).toBe("function");       // @fireflies/tones, through export *
  expect(typeof look.dithered).toBe("function");   // @fireflies/layout-look, through export *
  expect(typeof look.titleShown).toBe("function"); // look's own
  const place = await importMod("scripts/place.ts", { herdr: { ...app, panes: () => [], focused: () => null, run: () => {}, openOverlay: () => {}, closeOverlay: () => {} }, "gpui-kit": gpui(), "gpui-base": { h_flex: () => ({}) } });
  expect(place.DECK_W).toBe(420);
});

test("the copier points every form at its target: export * (as), export { } from, import()", async () => {
  const { copier } = await import("./mod-source.ts");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const src = mkdtempSync(join(tmpdir(), "copier-src-"));
  writeFileSync(join(src, "forms.ts"), [
    'export * from "@fireflies/tones";',
    'export * as kit from "@fireflies/kit";',
    'export { platform } from "herdr";',
    'export type { Theme } from "herdr";',
    'export const later = () => import("herdr").then((h) => h.platform());',
    "export const lazyTones = () => import('@fireflies/tones');",
  ].join("\n"));
  const copy = copier("copier-", { herdr: { platform: () => "macos" } });
  copy.write(join(src, "forms.ts"), join(copy.dir, "forms.ts"));
  copy.standins();
  const m = await import(join(copy.dir, "forms.ts"));
  expect(typeof m.edge).toBe("function");
  expect(typeof m.kit.sharedKey).toBe("function");
  expect(m.platform()).toBe("macos");
  expect(await m.later()).toBe("macos");
  expect(typeof (await m.lazyTones()).edge).toBe("function");
});

test("importLibrary loads a library and what it imports (effect, @fireflies/kit) for real, standing in only for the app", async () => {
  const { importLibrary } = await import("./mod-source.ts");
  const m = await importLibrary("@fireflies/usage-limits", { herdr: {} });
  expect(m.PROVIDERS.map((p: { id: string }) => p.id)).toEqual(["claude", "codex"]);
  const shared = sharedTest();
  shared.store.set("usage.provider", "codex");
  expect((await Effect.runPromise(Effect.provide(m.provider, shared.layer))).id).toBe("codex");
});
