import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = await readFile(new URL("../defaults/mods/machine-add/main.js", import.meta.url), "utf8");

// Where the app's own hc is (its folder first on the app's PATH): not on the
// person's shell PATH, as on Developer's Mac (~/.local/bin/hc).
const CORE = "/home/test/.local/bin/hc";

function setup(result: any, opts: { core?: string | null; spaces?: any[] } = {}) {
  const calls: string[][] = [];
  const overlays: unknown[] = [];
  const runs: [string, any][] = [];
  const closed: unknown[] = [];
  const machines: any[] = [];
  const probes: unknown[] = [];
  const timers: ((cx: any) => void)[] = [];
  let task: Promise<void>;
  const values = {
    View: class {}, div() {}, svg() {}, TextView: {}, v_flex() {}, h_flex() {},
    InputState: { new: () => ({ on() {}, focus() {}, set_value() {} }) }, Input: {}, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    home: () => "/home/test", readTextFile: async () => null,
    theme() {}, props: () => ({ overlay: "ma" }), closeOverlay: (id: unknown) => closed.push(id),
    run: (name: string, args: any) => { runs.push([name, args]); return null; },
    spaces: () => opts.spaces ?? [{ id: "s1", machine: null, active: true }],
    // form-keys.ts and herdr's window (imports are stripped here).
    bindTab() {}, tabActions: (el: unknown) => el, formKey: () => null, formHints: () => [], ring: (el: unknown) => el, appWindow: () => null,
    openOverlay: (...args: unknown[]) => overlays.push(args),
    exec: async (cmd: string, args: string[], options: any) => {
      if (cmd === "sh" && args[1] === "command -v hc") {
        if (opts.core === null) throw new Error("cannot run sh");
        return { code: 0, stdout: `${opts.core ?? CORE}\n`, stderr: "" };
      }
      probes.push(options.on);
      return { stdout: "Darwin\n/remote/herdr-core\n" };
    },
    hc: async (args: string[]) => {
      calls.push(args);
      if (args[1] === "add") {
        if (result.code === 0) machines.push({ target: args[2], name: args[2] });
        return result;
      }
      return { code: 0, stdout: JSON.stringify({ machines }) };
    },
  };
  const MachineAdd = new Function(...Object.keys(values), source.replace(/^import .*;\n/gm, "").replace("export default class MachineAdd", "return class MachineAdd"))(...Object.values(values));
  const view = new MachineAdd();
  const cx = {
    notify() {}, focus_handle() {}, spawn(fn: any) { task = fn(cx); },
    timer: { after() {}, every(_ms: number, fn: any) { timers.push(fn); } },
  };
  view.init({}, cx);
  return {
    view, calls, overlays, machines, probes, runs, closed, cx,
    async add(target = "my-host") {
      await task;
      view.typed = target;
      view.add(` ${target} `, cx);
      await task;
    },
    async poll() { timers.forEach((fn) => fn(cx)); await task; },
  };
}

for (const kind of ["hc_missing", "incompatible", "login_needed", "auth_failed", "host_key"]) {
  test(`${kind} gives terminal instructions without starting a terminal`, async () => {
    const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind, message: "needs attention" } }) });
    await s.add();
    expect(s.view.state["my-host"]).toContain("Couldn't add my-host here");
    expect(s.view.state["my-host"]).toContain(`\`${CORE} machine add my-host\``);
    expect(s.view.state["my-host"]).toContain(`\`${CORE} machine --help\``);
    expect(s.view.isAdded("my-host")).toBe(false);
    expect(s.calls.every((args) => args[0] === "machine")).toBe(true);
    expect(s.overlays).toEqual([]);
    expect(s.runs).toEqual([]);
  });
}

for (const message of ["Enter password", "Enter passphrase", "new host key", "Permission denied", "needs a login"]) {
  test(`${message} also gives instructions`, async () => {
    const s = setup({ code: 1, stderr: JSON.stringify({ error: { kind: "other", message } }) });
    await s.add();
    expect(s.view.state["my-host"]).toContain(`\`${CORE} machine add my-host\``);
  });
}

for (const [target, quoted] of [
  ["ssh://user@[::1]:2222", "'ssh://user@[::1]:2222'"],
  ["host';echo $HOME", "'host'\\'';echo $HOME'"],
]) {
  test(`instructions quote ${target} as one shell argument`, async () => {
    const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "host_key" } }) });
    await s.add(target);
    expect(s.view.state[target]).toContain(`\`${CORE} machine add ${quoted}\``);
    expect(s.calls.find((args) => args[1] === "add")?.[2]).toBe(target);
    const shell = Bun.spawnSync(["sh", "-c", `printf '%s' ${quoted}`]);
    expect(shell.exitCode).toBe(0);
    expect(shell.stdout.toString()).toBe(target);
  });
}

test("pending guidance clears when another terminal adds the host and checks Mac permissions", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "host_key" } }) });
  await s.add();
  await s.poll();
  expect(s.view.pending.has("my-host")).toBe(true);
  expect(s.view.state["my-host"]).toContain(`${CORE} machine add my-host`);
  expect(s.probes).toEqual([]);
  s.machines.push({ target: "my-host", name: "remote" });
  await s.poll();
  expect(s.view.isAdded("my-host")).toBe(true);
  expect(s.view.state["my-host"]).toBeUndefined();
  expect(s.view.pending.size).toBe(0);
  expect(s.view.typed).toBe("");
  expect(s.view.macs["my-host"]).toEqual({ name: "remote", core: "/remote/herdr-core" });
  expect(s.probes).toEqual(["remote"]);
  const count = s.calls.length;
  await s.poll();
  expect(s.calls.length).toBe(count);
});

// Developer, 2026-11-18: "it told me to run this but it didnt find hc". His
// shell has no hc on its PATH; the app finds ~/.local/bin/hc on its own.
test("copy gives the command with the path of the hc the app runs", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "auth_failed", message: "Permission denied (publickey,password,keyboard-interactive)" } }) });
  await s.add("david-mbp.local");
  const copied: string[] = [];
  s.view.press("copy:david-mbp.local", { write_to_clipboard: (t: string) => copied.push(t) });
  expect(copied).toEqual([`${CORE} machine add david-mbp.local`]);
});

test("a home with a space in it is quoted in the command", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "login_needed" } }) }, { core: "/Users/a b/.local/bin/hc" });
  await s.add();
  expect(s.view.state["my-host"]).toContain("`'/Users/a b/.local/bin/hc' machine add my-host`");
});

test("run in a tab answers it in a terminal on this machine and closes the dialog", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "auth_failed" } }) }, {
    spaces: [{ id: "remote", machine: "vps", active: true }, { id: "here", machine: null, active: false }],
  });
  await s.add("david-mbp.local");
  expect(s.view.stops().map((x: any) => x.id)).toEqual(["input", "add", "tab:david-mbp.local", "copy:david-mbp.local", "close"]);
  s.view.press("tab:david-mbp.local", s.cx);
  expect(s.runs).toEqual([["tab.new", { name: "add david-mbp.local", space: "here", argv: [CORE, "machine", "add", "david-mbp.local"] }]]);
  expect(s.closed).toEqual(["ma"]);
});

test("run in a tab makes a space here when every space is on another machine", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "host_key" } }) }, { spaces: [{ id: "remote", machine: "vps", active: true }] });
  await s.add();
  s.view.press("tab:my-host", s.cx);
  expect(s.runs).toEqual([["space.new", { name: "add my-host", argv: [CORE, "machine", "add", "my-host"] }]]);
});

test("without sh to ask, the command names plain hc", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "host_key" } }) }, { core: null });
  await s.add();
  expect(s.view.state["my-host"]).toContain("`hc machine add my-host`");
  s.view.press("tab:my-host", s.cx);
  expect(s.runs[0]?.[1].argv).toEqual(["hc", "machine", "add", "my-host"]);
});

test("other failures keep their message and do not poll", async () => {
  const s = setup({ code: 1, stdout: JSON.stringify({ error: { kind: "offline", message: "connection refused" } }) });
  await s.add();
  expect(s.view.state["my-host"]).toBe("connection refused");
  const count = s.calls.length;
  await s.poll();
  expect(s.calls.length).toBe(count);
});

test("success refreshes the list and clears the typed target without opening anything", async () => {
  const s = setup({ code: 0, stdout: "{}" });
  await s.add();
  expect(s.view.isAdded("my-host")).toBe(true);
  expect(s.view.state["my-host"]).toBeUndefined();
  expect(s.view.typed).toBe("");
  expect(s.probes).toEqual(["my-host"]);
  expect(s.calls.every((args) => args[0] === "machine")).toBe(true);
  expect(s.overlays).toEqual([]);
});

// The ssh config reading with real files and a real sh, started the way Fireflies
// starts programs, so a Windows home (C:\Users\...) behaves as it does there.
async function hostsUnder(prefix: string) {
  const home = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(home, ".ssh", "config.d"), { recursive: true });
    const config = "Include config.d/*\nHost direct\n";
    await writeFile(join(home, ".ssh", "config"), config);
    await writeFile(join(home, ".ssh", "config.d", "a-work"), "Host work\n  HostName 10.0.0.1\n");
    await writeFile(join(home, ".ssh", "config.d", "b-lab"), "Host lab\n");
    const values = {
      View: class {}, div() {}, svg() {}, TextView: {}, v_flex() {}, h_flex() {}, InputState: {}, Input: {},
      hc() {}, theme() {}, props: () => ({}), closeOverlay() {}, openOverlay() {},
      home: () => home,
      readTextFile: (file: string) => readFile(file, "utf8"),
      exec: async (program: string, args: string[]) => {
        const p = Bun.spawnSync([program, ...args]);
        return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
      },
    };
    const body = source.replace(/^import .*;\r?\n/gm, "").replace("export default class MachineAdd", "class MachineAdd");
    const parseConfig = new Function(...Object.keys(values), `${body}; return parseConfig;`)(...Object.values(values));
    return (await parseConfig(config)).map((h: any) => [h.alias, h.hostname]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("every file a wildcard Include matches is listed", async () => {
  expect(await hostsUnder("herdr-ssh-")).toEqual([["work", "10.0.0.1"], ["lab", null], ["direct", null]]);
});

test("a wildcard Include is listed under a home with a space", async () => {
  expect(await hostsUnder("herdr ssh ")).toEqual([["work", "10.0.0.1"], ["lab", null], ["direct", null]]);
});
