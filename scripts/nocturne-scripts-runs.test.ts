import { test, expect, mock } from "bun:test";

mock.module("herdr", () => ({ hc: async () => ({ code: 0, stdout: "{}", stderr: "" }), run: () => null, shared: () => null, setShared: () => null }));
const { runs, word, tone, elapsed, runArgs, LABEL } = await import("../defaults/mods/nocturne-scripts/runs.js");

const term = (address: string, labels: Record<string, string>, more: Record<string, unknown> = {}) => ({ address, labels, state: "live", created_ms: 1000, ...more });
const lab = (id: string) => ({ [LABEL]: id, [`${LABEL}.name`]: id, [`${LABEL}.runner`]: "bun", [`${LABEL}.cmd`]: `bun run ${id}`, [`${LABEL}.folder`]: "/repo" });

test("runs are the labeled terminals, running first, newest first", () => {
  const all = [
    term("t1", lab("build"), { state: "finished", exit_code: 0, reason: "exited", finished_ms: 3000 }),
    term("t2", {}),
    term("t3", lab("dev"), { created_ms: 2000 }),
    term("vps/t4", lab("watch"), { created_ms: 5000 }),
  ];
  const r = runs(all);
  expect(r.map((x: any) => x.address)).toEqual(["vps/t4", "t3", "t1"]);
  expect(r[0].on).toBe("vps");
  expect(r[1].on).toBe(null);
  expect(r[2]).toMatchObject({ name: "build", runner: "bun", cmd: "bun run build", folder: "/repo", live: false, code: 0, word: "ok" });
});

test("words and tones", () => {
  expect(word(true, null, null)).toBe("running");
  expect(word(false, 0, "exited")).toBe("ok");
  expect(word(false, 101, "exited")).toBe("exit 101");
  expect(word(false, null, "killed")).toBe("stopped");
  expect(tone({ live: false, reason: "killed", code: 137 })).toBe("stopped");
  expect(tone({ live: false, reason: "exited", code: 2 })).toBe("failed");
});

test("elapsed counts to now while running, to the end once finished", () => {
  expect(elapsed({ live: true, started: 0 }, 7000)).toBe("0:07");
  expect(elapsed({ live: true, started: 0 }, 724000)).toBe("12:04");
  expect(elapsed({ live: false, started: 0, ended: 3723000 }, 9e9)).toBe("1:02:03");
});

test("hc run gets one shell line, the folder, the machine and the labels", () => {
  const a = runArgs({ id: "justfile\u0000test", name: "test", runner: "just", cmd: "just test" }, "/repo", "vps");
  expect(a.slice(0, 5)).toEqual(["run", "--bg", "--no-parent", "--no-notify", "--json"]);
  expect(a).toContain("--on");
  expect(a[a.indexOf("--cwd") + 1]).toBe("/repo");
  expect(a.slice(-2)).toEqual(["--", "just test"]);
  expect(a).toContain(`${LABEL}.cmd=just test`);
  expect(runArgs({ id: "x", name: "x", runner: "go", cmd: "go run ." }, null, null)).not.toContain("--cwd");
});

test("ended runs the strip kept come back when the core no longer lists them", async () => {
  const { withEnded } = await import("../defaults/mods/nocturne-scripts/runs.js");
  const kept = { t1: term("t1", lab("build"), { state: "finished", exit_code: 2, reason: "exited" }), t3: term("t3", lab("old"), { state: "finished" }) };
  const all = [term("t3", lab("dev"))];
  expect(withEnded(all, kept).map((t: any) => t.address)).toEqual(["t3", "t1"]);
  expect(runs(withEnded(all, kept)).find((r: any) => r.address === "t1").word).toBe("exit 2");
});
