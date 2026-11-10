// A run is a script started in a terminal of its own with no pane
// (`hc run --bg`), labeled so every copy of every mod can find it in
// terminals(): the core is the record, so runs outlive the deck, the window
// and an app restart. The labels:
//
//   nocturne.script         the script's id (detect.js)
//   nocturne.script.name    its name, runner, shell line and folder
//   nocturne.script.runner
//   nocturne.script.cmd
//   nocturne.script.folder
//   nocturne.script.admin   how it gets root: "osascript" (the macOS password
//                           dialog) or "sudo"; none for most (nix.js shellLine)
//
// A finished run keeps its terminal (and its output) until it's dismissed
// (`hc rm`) or restarted. Watching floats the terminal over the tab
// (terminal.peek {float: true}); its bar's ✕ hides it again, still running.
// ../nocturne/scripts.js reads the same labels for the tab strip (a mod can't
// import another mod's files).

import { hc, run, shared, setShared } from "herdr";
import { shellLine, CANCELLED } from "./nix.js";

export const LABEL = "nocturne.script";
// Ended runs' records, kept by the tab strip (../nocturne/scripts.js ENDED),
// and the runs it follows until they end (TRACK): terminals() lists only live
// terminals, so a run that ends is read back with `hc get`.
export const ENDED = "nocturne-scripts.ended";
const TRACK = "nocturne-scripts.track";

/** terminals() plus the ended runs the strip kept that the core no longer lists. */
export function withEnded(all, ended) {
  const here = new Set((all ?? []).map((t) => t.address));
  return [...(all ?? []), ...Object.values(ended ?? {}).filter((t) => !here.has(t.address))];
}

/** Every run in `terminals()`, the running ones first, newest first.
 *  { address, id, name, runner, cmd, folder, on, live, code, reason, started, ended, word } */
export function runs(all) {
  return (all ?? [])
    .filter((t) => t?.labels?.[LABEL])
    .map((t) => {
      const l = t.labels;
      const live = t.state !== "finished";
      const code = live ? null : (typeof t.exit_code === "number" ? t.exit_code : null);
      const at = String(t.address).lastIndexOf("/");
      return {
        address: t.address, id: l[LABEL], name: l[`${LABEL}.name`] || l[LABEL], runner: l[`${LABEL}.runner`] || "",
        cmd: l[`${LABEL}.cmd`] || (t.argv ?? []).join(" "), folder: l[`${LABEL}.folder`] || t.cwd || null,
        on: at > 0 ? String(t.address).slice(0, at) : null,
        live, code, reason: t.reason ?? null,
        started: t.created_ms ?? null, ended: t.finished_ms ?? null,
        admin: l[`${LABEL}.admin`] || null,
        word: word(live, code, t.reason, l[`${LABEL}.admin`]),
      };
    })
    .sort((a, b) => Number(b.live) - Number(a.live) || (b.started ?? 0) - (a.started ?? 0));
}

/** The state in words: running, ok, exit N, stopped, cancelled (an admin dialog). */
export function word(live, code, reason, admin) {
  if (live) return "running";
  if (reason === "killed") return "stopped";
  if (admin && code === CANCELLED) return "cancelled";
  if (code === 0) return "ok";
  return code == null ? "ended" : `exit ${code}`;
}

/** running, ok, failed or stopped: the color a run is drawn in. */
export const tone = (r) => (r.live ? "running" : r.reason === "killed" ? "stopped" : r.code === 0 ? "ok" : "failed");

/** How long it ran or has been running: 0:07, 12:04, 1:02:03. */
export function elapsed(r, now = Date.now()) {
  if (r.started == null) return "";
  const s = Math.max(0, Math.floor(((r.live ? now : r.ended ?? now) - r.started) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The arguments to `hc run` for a script in a folder (on a machine). One
 *  shell line, as `hc run "cd app && bun test"` takes it. */
export function runArgs(s, folder, on) {
  const label = (k, v) => ["--label", `${k}=${String(v ?? "").replace(/\n/g, " ")}`];
  return [
    "run", "--bg", "--no-parent", "--no-notify", "--json",
    ...(on ? ["--on", on] : []),
    ...(folder ? ["--cwd", folder] : []),
    ...label(LABEL, s.id), ...label(`${LABEL}.name`, s.name), ...label(`${LABEL}.runner`, s.runner),
    ...label(`${LABEL}.cmd`, s.cmd), ...(folder ? label(`${LABEL}.folder`, folder) : []),
    // Nocturne's name for a terminal: the float's bar says "dev", not "sh".
    ...label("nocturne.name", s.name),
    ...(s.admin ? label(`${LABEL}.admin`, s.admin) : []),
    "--", shellLine(s.cmd, s.admin),
  ];
}

/** Starts a script; resolves with its terminal's address, or throws why not. */
export async function start(s, folder, on) {
  const r = await hc(runArgs(s, folder, on));
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "hc run failed").trim().split("\n").pop());
  let address = null;
  try { address = JSON.parse(r.stdout).address ?? null; } catch { /* started, address unknown */ }
  // A short script can end before the strip ever sees it live: follow it from here.
  if (address) setShared(TRACK, { ...(shared(TRACK) ?? {}), [address]: Date.now() });
  return address;
}

/** Floats its terminal over the tab, to watch it or type into it. */
export const watch = (r) => run("terminal.peek", { terminal: r.address, float: true });

/** Ends a running script (its terminal shows "stopped"). */
export const stop = (r) => hc(["kill", r.address]).catch(() => null);

/** Forgets a finished run (its terminal goes with it). */
export async function dismiss(r) {
  const ended = { ...(shared(ENDED) ?? {}) };
  if (ended[r.address]) { delete ended[r.address]; setShared(ENDED, ended); }
  const tracked = { ...(shared(TRACK) ?? {}) };
  if (tracked[r.address]) { delete tracked[r.address]; setShared(TRACK, tracked); }
  await hc(["rm", r.address]).catch(() => null);
}

/** Runs it again in the same folder: the old run goes, a new one starts. */
export async function restart(r) {
  if (r.live) await stop(r);
  await dismiss(r);
  return start({ id: r.id, name: r.name, runner: r.runner, cmd: r.cmd, admin: r.admin }, r.folder, r.on);
}
