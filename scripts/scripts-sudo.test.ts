// A nix switch's password window, the whole way: the deck starts the switch
// (scripts/runs.ts start, a job), the tab strip runs the job (nocturne/jobs.ts)
// and watches the run's terminal (nocturne/prompt.ts watchPrompts); sudo's
// prompt on its screen opens the small window, whose bar is the scripts mod
// with { password, name } (scripts/bars.ts passwordBar) over the run's own
// terminal. A fake core stands in for hc: its terminals carry the fields the
// app's terminals() really gives a script run (status null: no agent reports
// one), and a "typed" password is only ever on that fake terminal. No sudo runs.
// mock.module is process-wide: this file runs in its own `bun test`.
import { test, expect, mock, beforeEach } from "bun:test";
import { find, texts, cx as mkcx } from "./dialog-stubs.ts";

const SECRET = "hunter2-not-a-real-password";

const st: any = {};
mock.module("herdr", () => ({
  props: () => st.props, theme: () => new Proxy({}, { get: () => "#808080" }), settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "macos" }),
  shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; return null; },
  run: (name: string, args?: any) => { st.runs.push([name, args]); return null; },
  openOverlay: (spec: any) => { st.opened.push(spec); return `ov${st.opened.length}`; },
  closeOverlay: (id: string) => { st.closed.push(id); return null; },
  notify: (n: unknown) => { st.notes.push(n); return "n1"; },
  terminals: () => st.terms, panes: () => st.panes, focused: () => null, keys: () => [], spaces: () => [], agents: () => [],
  hc: async (a: string[]) => { st.calls.push(a); await Bun.sleep(1); return core(a); },
  home: () => "/h", appHome: () => "/tmp/none", exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  nextCommand: () => new Promise(() => {}), readTextFile: async () => null, writeTextFile: async () => null, layout: () => null,
}));

// ---- the fake core: `hc run` makes a terminal, `hc read` shows its screen,
// `hc keys` presses keys in it, `hc kill` / `hc rm` end it.

let next = 0;
function core(a: string[]) {
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

  if (a[0] === "run") {
    const labels: Record<string, string> = {};

    for (let i = 0; i < a.length; i++) if (a[i] === "--label") { const [k, ...v] = a[i + 1].split("="); labels[k] = v.join("="); }

    const address = `t${++next}`;
    const line = a[a.indexOf("--") + 1];
    // As the app's terminals() lists it: core's `hc get` fields, then status as a
    // plain word (null: no agent), program, report and the float marks.
    st.terms.push({
      address, argv: ["sh", "-c", line], cols: 200, rows: 120, created_ms: Date.now(), cwd: a[a.indexOf("--cwd") + 1] ?? null,
      die_with_parent: false, exit_code: null, finished_ms: null, identity: "ghostty", keep: false, labels, name: null, notify: false,
      parent: null, pid: 4242, reason: null, reported: false, rm: false, screen: "exact", signal: null, state: "live",
      status: null, status_ms: null, template: null, title: "", turn: 0,
      program: { key: "program", name: "sh", icon: null, tint: false, tile: null, color: null, shell: false, agent: false },
      report: null, floating: false, floating_view: null, float_views: null,
    });
    st.screens[address] = "building\n";

    return ok(JSON.stringify({ address, agent: "sh", state: "live", turn: 0 }));
  }

  if (a[0] === "read") return ok(st.screens[a[1]] ?? "");

  if (a[0] === "keys") {
    if (a.includes("ctrl+c")) st.screens[a[1]] = `${st.screens[a[1]]}^C\n`;

    return ok();
  }

  if (a[0] === "kill" || a[0] === "rm") { st.terms = st.terms.filter((t: any) => t.address !== a[1]); return ok(); }

  return { code: 1, stdout: "", stderr: `unknown ${a[0]}` };
}

/** What the person does in the small window: types into the run's own terminal (the app's terminal block). */
function type(address: string, text: string) {
  st.typed.push([address, text]);

  if (text.endsWith("\n")) st.screens[address] = `${st.screens[address]}\nsetting up /etc...\n`;
}

beforeEach(() => {
  Object.assign(st, { props: {}, shared: {}, runs: [], opened: [], closed: [], notes: [], terms: [], panes: [], calls: [], screens: {}, typed: [] });
});

const { start, restart, runs, runArgs } = await import("../defaults/mods/scripts/runs.ts");
const { nixScripts, SUDO_PROMPT } = await import("../defaults/mods/scripts/nix.ts");
const jobs = await import("../defaults/mods/nocturne/jobs.ts");
const prompt = await import("../defaults/mods/nocturne/prompt.ts");
const { default: Deck } = await import("../defaults/mods/scripts/main.ts");

const P = SUDO_PROMPT;
const MAC = { host: "homelab", user: "developer", os: "Darwin", arch: "arm64" };
const switchHomelab = () => nixScripts({ darwinConfigurations: { homelab: { type: "unknown" } } }, MAC).find((s: any) => s.name === "switch homelab")!;

/** The deck starts it; the strip runs the job. */
async function startSwitch(folder = "/private/etc/nix-darwin") {
  start(switchHomelab(), folder, null);
  await jobs.runJobs();

  return st.terms[st.terms.length - 1].address as string;
}

/** The small window's bar, as the app draws the scripts mod inside it. */
function bar(spec: any, overlay: string) {
  st.props = { ...spec.layout.children[0].content.props, overlay };
  const d: any = new Deck();
  const c = mkcx();
  d.init({}, c);

  return { d, c, r: d.render() };
}

/** Everything the mods wrote or sent: shared state, hc calls, toasts, overlays, commands. */
const everything = () => JSON.stringify([st.shared, st.calls, st.notes, st.opened, st.runs]);

test("the copy of sudo's prompt matches the one the switch asks with", () => {
  expect(prompt.SUDO_PROMPT).toBe(SUDO_PROMPT);
});

test("a switch started from the deck: its prompt opens the password window over its terminal; enter takes it, the window goes", async () => {
  const t = await startSwitch();
  // The run carries what the watch looks for.
  expect(st.terms[0].labels).toMatchObject({ "nocturne.script.plan": "darwin-rebuild:homelab", "nocturne.script.admin": "sudo", "nocturne.script.name": "switch homelab" });

  // Still building: nothing opens.
  await prompt.watchPrompts();
  expect(st.opened).toEqual([]);

  // sudo asks.
  st.screens[t] = `building\nbuilt /nix/store/x-darwin-system\n${P}`;
  await prompt.watchPrompts();
  expect(st.opened.length).toBe(1);

  const spec = st.opened[0];
  expect(spec).toMatchObject({ kind: "dialog", modal: true, width: prompt.PROMPT_W, height: prompt.PROMPT_H });
  expect(spec.layout.children[0].content).toEqual({ mod: "scripts", props: { password: t, name: "switch homelab" } });
  // What's typed goes to the run's own terminal, nowhere else.
  expect(spec.layout.children[1].content).toEqual({ terminal: t });

  // Its bar: the run's name, "password", and a cancel.
  const { r } = bar(spec, "ov1");
  expect(texts(r)).toEqual(expect.arrayContaining(["switch homelab", "· password", "cancel"]));
  expect(find(r, "pw-cancel")).toBeDefined();

  // Typed and enter: sudo takes it, the output moves on, the window closes.
  type(t, `${SECRET}\n`);
  await prompt.watchPrompts();
  expect(st.closed).toEqual(["ov1"]);
  expect(st.shared[prompt.PROMPTS]).toEqual({});
  expect(st.opened.length).toBe(1);

  // The password was only ever on the terminal: no shared record, hc call, toast, prop or command holds it.
  expect(st.typed).toEqual([[t, `${SECRET}\n`]]);
  expect(everything()).not.toContain(SECRET);
  expect(st.calls.filter((a: string[]) => a[0] === "send" || a[0] === "keys")).toEqual([]);
});

test("the window opens whether the runner is open as a window, as a pane, or closed", async () => {
  for (const runner of ["window", "pane", "closed"]) {
    Object.assign(st, { shared: {}, opened: [], closed: [], terms: [], screens: {}, panes: [] });

    if (runner === "window") st.shared["scripts.deck"] = { id: "deck1", beat: Date.now() };

    if (runner === "pane") st.panes = [{ pane: "p2", mod: "scripts", props: { folder: "/private/etc/nix-darwin", slot: "s1" } }];

    const t = await startSwitch();
    st.screens[t] = P;
    await prompt.watchPrompts();
    expect([runner, st.opened.length]).toEqual([runner, 1]);
    expect(st.opened[0].layout.children[1].content).toEqual({ terminal: t });
  }
});

test("cancel presses ctrl-c in the run and closes the window; it stays closed while the run ends", async () => {
  const t = await startSwitch();
  st.screens[t] = P;
  await prompt.watchPrompts();

  const { r, c } = bar(st.opened[0], "ov1");
  find(r, "pw-cancel")!.calls.on_click[0]({}, c);
  await Bun.sleep(5);
  expect(st.calls).toContainEqual(["keys", t, "ctrl+c"]);
  expect(st.closed).toEqual(["ov1"]);
  expect(st.shared[prompt.PROMPTS]).toEqual({ [t]: { closed: true } });

  // The prompt still on screen until ctrl-c lands: nothing opens again.
  st.screens[t] = P;
  await prompt.watchPrompts();
  expect(st.opened.length).toBe(1);

  // The run ends: its record goes.
  st.terms = [];
  await prompt.watchPrompts();
  expect(st.shared[prompt.PROMPTS]).toEqual({});
});

test("a wrong password: sudo asks again and the window stays (or comes back) until one is taken", async () => {
  const t = await startSwitch();
  st.screens[t] = P;
  await prompt.watchPrompts();
  type(t, "wrong\n");
  st.screens[t] = `${P}\nSorry, try again.\n`;
  await prompt.watchPrompts();
  st.screens[t] = `${P}\nSorry, try again.\n${P}`;
  await prompt.watchPrompts();
  expect(st.opened.length).toBe(1);
  expect(st.closed).toEqual([]);

  // Had it closed between tries (output moved on, then sudo asked again), it comes back.
  st.screens[t] = "checking...\n";
  await prompt.watchPrompts();
  expect(st.closed).toEqual(["ov1"]);
  st.screens[t] = `checking...\n${P}`;
  await prompt.watchPrompts();
  expect(st.opened.length).toBe(2);
  expect(st.opened[1].layout.children[1].content).toEqual({ terminal: t });
});

test("two switches asking at once get a window each, over their own terminals", async () => {
  const a = await startSwitch("/private/etc/nix-darwin");
  const b = await startSwitch("/srv/homelab");
  st.screens[a] = P;
  st.screens[b] = P;
  await prompt.watchPrompts();
  expect(st.opened.map((s: any) => s.layout.children[1].content.terminal)).toEqual([a, b]);
  expect(st.shared[prompt.PROMPTS]).toEqual({ [a]: { id: "ov1" }, [b]: { id: "ov2" } });

  type(b, `${SECRET}\n`);
  await prompt.watchPrompts();
  expect(st.closed).toEqual(["ov2"]);
  expect(st.shared[prompt.PROMPTS]).toEqual({ [a]: { id: "ov1" } });
});

test("again: an ended switch started once more asks through the window again", async () => {
  const t = await startSwitch();
  const run = runs(st.terms).find((r: any) => r.address === t)!;
  expect(run.plan).toBe("darwin-rebuild:homelab");

  restart({ ...run, live: false });
  await jobs.runJobs();
  const again = st.terms[st.terms.length - 1];
  expect(again.address).not.toBe(t);
  expect(again.labels["nocturne.script.plan"]).toBe("darwin-rebuild:homelab");
  // The same `hc run` as the first start: sudo's prompt and the plan's labels.
  const ran = st.calls.filter((a: string[]) => a[0] === "run");
  expect(ran.length).toBe(2);
  expect(ran[1]).toEqual(ran[0]);
  expect(ran[1]).toEqual(runArgs(switchHomelab(), "/private/etc/nix-darwin", null));

  st.screens[again.address] = P;
  await prompt.watchPrompts();
  expect(st.opened.at(-1).layout.children[1].content).toEqual({ terminal: again.address });
});

test("a run already floating (he's watching it) gets no window: he types there", async () => {
  const t = await startSwitch();
  st.terms[0].floating = true;
  st.terms[0].floating_view = 0;
  st.screens[t] = P;
  await prompt.watchPrompts();
  expect(st.opened).toEqual([]);
});
