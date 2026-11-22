// Paths for every mod (nocturne/files.ts): nocturne.copy-path:{"path"} puts a
// path on the clipboard, nocturne.reveal:{"path"} shows it in the system's file
// manager (open -R, explorer /select, xdg-open on its folder), the path one
// argument, never through a shell. herdr is a stand-in (mock.module is
// process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { readFile } from "node:fs/promises";

let ran: [string, string[]][] = [];
let notes: any[] = [];
let platform = "macos";
let answer: () => Promise<{ code: number; stdout: string; stderr: string }> = async () => ({ code: 0, stdout: "", stderr: "" });
mock.module("herdr", () => ({
  exec: (cmd: string, args: string[]) => { ran.push([cmd, args]); return answer(); },
  notify: (n: any) => { notes.push(n); return "n1"; },
  window: () => ({ platform }),
  home: () => "/Users/dev",
  spaces: () => [], panes: () => [], focused: () => null, run: () => null, shared: () => null, setShared: () => null,
}));

const { pathCommand, revealArgv } = await import("../defaults/mods/nocturne/files.ts");

const clipboard: string[] = [];
const cx = { write_to_clipboard: (s: string) => { clipboard.push(s); } };
const settle = () => new Promise((r) => setTimeout(r, 0));
const ODD = `/Users/dev/my repo/it's "here".md`;

beforeEach(() => {
  ran = []; notes = []; clipboard.length = 0; platform = "macos";
  answer = async () => ({ code: 0, stdout: "", stderr: "" });
});

test("each platform's file manager, the path one argument", () => {
  expect(revealArgv("macos", ODD)).toEqual(["open", ["-R", ODD]]);
  expect(revealArgv("windows", "C:/Users/dev/my repo/it's.md")).toEqual(["explorer", ["/select,C:\\Users\\dev\\my repo\\it's.md"]]);
  expect(revealArgv("linux", ODD)).toEqual(["xdg-open", ["/Users/dev/my repo"]]);
  expect(revealArgv("linux", "/top")).toEqual(["xdg-open", ["/"]]);
});

test("nocturne.copy-path: the path as given (JSON or bare), ~/ expanded; a relative one is refused", () => {
  expect(pathCommand(`copy-path:${JSON.stringify({ path: ODD })}`, cx)).toBe(true);
  expect(pathCommand("copy-path:/Users/dev/plain", cx)).toBe(true);
  expect(pathCommand(`copy-path:${JSON.stringify({ path: "~/notes" })}`, cx)).toBe(true);
  expect(clipboard).toEqual([ODD, "/Users/dev/plain", "/Users/dev/notes"]);
  expect(notes.at(-1)).toMatchObject({ level: "success", body: "~/notes" });
  notes = [];
  expect(pathCommand(`copy-path:${JSON.stringify({ path: "src/a.ts" })}`, cx)).toBe(true);
  expect(pathCommand("copy-path:{oops", cx)).toBe(true);
  expect(clipboard).toHaveLength(3);
  expect(notes.map((n) => n.level)).toEqual(["error", "error"]);
  expect(notes[0].body).toContain("absolute");
});

test("nocturne.reveal runs the platform's command with the path as one argument", async () => {
  for (const [p, want] of [["macos", ["open", ["-R", ODD]]], ["linux", ["xdg-open", ["/Users/dev/my repo"]]]] as const) {
    platform = p;
    ran = [];
    expect(pathCommand(`reveal:${JSON.stringify({ path: ODD })}`, cx)).toBe(true);
    await settle();
    expect(ran).toEqual([want as any]);
  }
  platform = "macos";
  ran = [];
  pathCommand("reveal:~/my repo", cx);
  await settle();
  expect(ran).toEqual([["open", ["-R", "/Users/dev/my repo"]]]);
  expect(notes).toEqual([]);
});

test("a reveal that fails says why; Windows' explorer answers 1 when it worked", async () => {
  answer = async () => ({ code: 1, stdout: "", stderr: "The file /x does not exist." });
  pathCommand("reveal:/x", cx);
  await settle();
  expect(notes).toEqual([expect.objectContaining({ level: "error", body: "The file /x does not exist." })]);
  notes = [];
  answer = async () => { throw new Error("no such program"); };
  pathCommand("reveal:/x", cx);
  await settle();
  expect(notes[0]).toMatchObject({ level: "error", body: "no such program" });
  notes = [];
  platform = "windows";
  answer = async () => ({ code: 1, stdout: "", stderr: "" });
  pathCommand("reveal:C:/x", cx);
  await settle();
  expect(notes).toEqual([]);
  // A relative path runs nothing.
  ran = [];
  pathCommand("reveal:src/x", cx);
  await settle();
  expect(ran).toEqual([]);
  expect(notes.at(-1).level).toBe("error");
});

test("other commands are not these", () => {
  expect(pathCommand("files", cx)).toBe(false);
  expect(pathCommand("reveal", cx)).toBe(false);
  expect(pathCommand("copy-paths:/x", cx)).toBe(false);
});

test("the sidebar's command loop hands them over", async () => {
  const sky = await readFile(new URL("../defaults/mods/nocturne/sky.ts", import.meta.url), "utf8");
  expect(sky).toMatch(/else if \(pathCommand\(c, later\)\)/);
});
