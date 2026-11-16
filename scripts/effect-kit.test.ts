// The mods' Effect kit (defaults/lib/@fireflies/kit, @fireflies/kit): its test layers
// stand in for the app, so nothing here mocks a module. HTTP runs against
// fakes: an in-memory server (httpTest) and, for the curl transport, a
// local Bun server reached by the real curl. No request leaves the machine.
import { test, expect, afterAll } from "bun:test";
import { Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { DecodeError, Exec, curlClient, decodeJson, execJson, execOk, modRuntime, policy, readShared, retryAfter, sharedKey, Shared, writeShared } from "@fireflies/kit";
import { execTest, httpTest, sharedTest } from "@fireflies/kit/testing";

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

test("importLibrary loads a library and what it imports (effect, @fireflies/kit) for real, standing in only for the app", async () => {
  const { importLibrary } = await import("./mod-source.ts");
  const m = await importLibrary("@fireflies/usage-limits", { herdr: {} });
  expect(m.PROVIDERS.map((p: { id: string }) => p.id)).toEqual(["claude", "codex"]);
  const shared = sharedTest();
  shared.store.set("usage.provider", "codex");
  expect((await Effect.runPromise(Effect.provide(m.provider, shared.layer))).id).toBe("codex");
});
