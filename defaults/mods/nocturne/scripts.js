// The script runner's corner of the tab strip (the deck itself is the
// scripts mod): ▶ and a little jar with one dithered cell per run in
// its state's color (running ones breathe, ok green, failed red, stopped
// grey). A click opens the deck hanging under ▶ (kit.js dropBelow), a
// second closes it (and it stays closed: tabs.js tool); ▶ is lit while it's
// open. Stopping happens there.
// cmd-shift-r (nocturne.scripts) opens the deck centered, or closes it.
//
// A run is a labeled pane-less terminal (scripts/runs.js); this file
// reads the same labels. The strip also tells about failures: a run that
// ended with a nonzero exit code, not stopped by a person, posts one toast
// (shared(TOLD) keeps which, so two windows don't both tell).

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, openOverlay, closeOverlay, shared, setShared, notify, hc, exec } from "herdr";
import { ART, dither, dropBelow } from "./kit.js";
import { here } from "./panels.js";

const LABEL = "nocturne.script";
export const DECK = "scripts.deck";
const TOLD = "scripts.told";
// Ended runs as their terminals' records, by address (trackRuns).
export const ENDED = "scripts.ended";
// Runs being followed until they end: { address: when first seen }.
const TRACK = "scripts.track";
const CELLS = 8;
export const DECK_W = 420;
export const DECK_H = 470;

/** Every run's terminal record: live ones from terminals(), ended ones kept in shared(ENDED). */
export function scriptTerminals() {
  const all = terminals().filter((t) => t?.labels?.[LABEL]);
  const here = new Set(all.map((t) => t.address));
  return [...all, ...Object.values(shared(ENDED) ?? {}).filter((t) => !here.has(t.address))];
}

/** Follows runs: terminals() lists only live terminals, so a run that ends
 *  just goes from it. Every labeled terminal seen live (and every one the deck
 *  started, which may end before it's ever seen) is in shared(TRACK); once it
 *  isn't live any more, `hc get` gives its last record (exit code, how it
 *  ended), kept in shared(ENDED), the newest 30. */
let checking = false;
export async function trackRuns() {
  const live = terminals().filter((t) => t?.labels?.[LABEL]);
  const tracked = { ...(shared(TRACK) ?? {}) };
  let changed = false;
  for (const t of live) if (!tracked[t.address]) { tracked[t.address] = Date.now(); changed = true; }
  if (changed) setShared(TRACK, tracked);
  const gone = Object.keys(tracked).filter((a) => !live.some((t) => t.address === a));
  if (!gone.length || checking) return;
  checking = true;
  try {
    const ended = { ...(shared(ENDED) ?? {}) };
    const now = { ...(shared(TRACK) ?? {}) };
    for (const a of gone) {
      const r = await hc(["get", a, "--json"]).catch(() => null);
      let rec = null;
      try { rec = r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { rec = null; }
      if (rec?.state === "live") {
        // Started a moment ago, not in terminals() yet; give up on it after a minute.
        if (Date.now() - (tracked[a] ?? 0) > 60000) delete now[a];
        continue;
      }
      delete now[a];
      if (rec?.state === "finished" && rec.labels?.[LABEL]) {
        ended[a] = { address: a, labels: rec.labels, state: "finished", exit_code: rec.exit_code ?? null, reason: rec.reason ?? null,
          created_ms: rec.created_ms ?? null, finished_ms: rec.finished_ms ?? null, cwd: rec.cwd ?? null, argv: rec.argv ?? null };
      }
    }
    const newest = Object.values(ended).sort((x, y) => (x.finished_ms ?? 0) - (y.finished_ms ?? 0)).slice(-30);
    setShared(ENDED, Object.fromEntries(newest.map((t) => [t.address, t])));
    setShared(TRACK, now);
  } finally { checking = false; }
}

/** Every run: { address, name, admin, plan, on, live, code, reason, started }, the running ones first. */
export function scriptRuns() {
  return scriptTerminals()
    .map((t) => ({ address: t.address, name: t.labels[`${LABEL}.name`] || t.labels[LABEL], admin: t.labels[`${LABEL}.admin`] || null,
      plan: t.labels[`${LABEL}.plan`] || null, on: String(t.address).includes("/") ? String(t.address).slice(0, String(t.address).lastIndexOf("/")) : null, live: t.state !== "finished",
      code: typeof t.exit_code === "number" ? t.exit_code : null, reason: t.reason ?? null, started: t.created_ms ?? 0, ended: t.finished_ms ?? 0 }))
    .sort((a, b) => Number(b.live) - Number(a.live) || a.started - b.started);
}

/** The folder scripts come from: the space's own folder, else the focused pane's. */
export function scriptsFolder() {
  const h = here();
  return { folder: (h.space?.attached && h.space.folder) || h.folder, on: h.on };
}

/** Opens the deck (focus: "pick" the filter, "runs" the running list), or
 *  closes it when open. `show` (a run) and `again` always open it, on that.
 *  `wasOpen`: ▶ was lit when pressed (tabs.js tool): the press closed the
 *  deck already, or closes it now; either way it stays closed. */
export function toggleDeck({ focus = "pick", centered = false, show = null, again = false, at = null, wasOpen = false } = {}) {
  const open = deckOpen();
  if (open) { setShared(DECK, null); closeOverlay(open); if (!show && !again) return; }
  else if (wasOpen && !show && !again) return;
  const { folder, on } = scriptsFolder();
  const id = openOverlay({ mod: "scripts", kind: centered ? "dialog" : "popup", frame: "none",
    width: DECK_W, height: DECK_H, ...(at && !centered ? { at } : {}), props: { folder, on, focus, ...(show ? { show } : {}), ...(again ? { again } : {}) } });
  setShared(DECK, { id, beat: Date.now() });
}

/** The open deck's overlay id, or null. The deck renews shared(DECK) every
 *  second, so a note left by an app restart doesn't swallow a press. */
export function deckOpen() {
  const d = shared(DECK);
  return d?.id && Date.now() - (d.beat ?? 0) < 4000 ? d.id : null;
}

const tone = (r) => (r.live ? "working" : r.reason === "killed" ? "idle" : r.code === 0 ? "done" : "blocked");

/** The newest failed run, and its address for the toast's click (nocturne.scripts-failed). */
const lastFailedRun = () => scriptRuns().filter((r) => !r.live && r.reason !== "killed" && r.code != null && r.code !== 0)
  .sort((a, b) => b.ended - a.ended)[0] ?? null;
export const lastFailed = () => lastFailedRun()?.address ?? null;

// A nix-darwin switch fails when Herdr Core lacks App Management (a copy of
// ../scripts/nix.js APP_MANAGEMENT: a mod can't import another's).
const APP_MANAGEMENT = {
  match: "permission denied when trying to update apps",
  hint: "Herdr Core needs App Management (System Settings > Privacy & Security). If it is already on, remove it and add it again",
  open: `open 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'; open -R "$HOME/.local/share/herdr-core/active/Herdr Core.app"`,
};

/** The toast's click for that failure (nocturne.scripts-grant): opens the
 *  setting and shows Herdr Core in Finder, on the machine the run was on. */
export function grantAppManagement() {
  exec("sh", ["-c", APP_MANAGEMENT.open], { on: lastFailedRun()?.on ?? null }).catch(() => null);
}

/** A failed nix-darwin switch's output says Herdr Core lacks App Management. */
async function needsAppManagement(r) {
  if (!String(r.plan ?? "").startsWith("darwin-rebuild:")) return false;
  const res = await hc(["read", r.address, "--lines", "300"]).catch(() => null);
  return res?.code === 0 && res.stdout.includes(APP_MANAGEMENT.match);
}

/** One toast per failed run (killed ones aren't failures). */
export function tellFailures(list) {
  const told = shared(TOLD) ?? {};
  const failed = list.filter((r) => !r.live && r.reason !== "killed" && r.code != null && r.code !== 0);
  const fresh = failed.filter((r) => !told[r.address] && Date.now() - (r.ended || 0) < 60000);
  // Forget runs that are gone, so the note stays small.
  const keep = Object.fromEntries(Object.entries(told).filter(([a]) => list.some((r) => r.address === a)));
  if (!fresh.length) {
    if (Object.keys(keep).length !== Object.keys(told).length) setShared(TOLD, keep);
    return;
  }
  for (const r of fresh) keep[r.address] = 1;
  setShared(TOLD, keep);
  for (const r of fresh) {
    // An admin run cancelled at its password prompt (scripts/nix.js CANCELLED).
    const cancelled = r.admin && r.code === 130;
    if (!cancelled && r.plan) {
      needsAppManagement(r).then((grant) => notify(grant
        ? { title: "Herdr Core needs App Management", body: `${r.name} · click to open the setting`, level: "error", action: { name: "nocturne.scripts-grant" } }
        : { title: `${r.name} failed · exit ${r.code}`, body: "click to see its output", level: "error", action: { name: "nocturne.scripts-failed" } }));
      continue;
    }
    notify({ title: cancelled ? `${r.name} cancelled` : `${r.name} failed · exit ${r.code}`,
      body: cancelled ? "no password given" : "click to see its output", level: cancelled ? "warning" : "error",
      action: { name: "nocturne.scripts-failed" } });
  }
}

/** The strip's control: ▶ and the jar. `tool` is the strip's icon button. */
export function scriptsControl(t, tool) {
  const list = scriptRuns();
  const live = list.filter((r) => r.live).length;
  const open = Boolean(deckOpen());
  const icon = (n, c) => svg(`${ART}/${n}.svg`).size(9).text_color(c);
  const cells = list.slice(0, CELLS).map((r, i) => {
    const c = t[tone(r)];
    const cell = div().id(`sc-cell-${i}`).relative().w(4).h(10).flex_none().child(dither(c, 1));
    return r.live ? cell.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : cell.opacity(r.reason === "killed" ? 0.5 : 1);
  });
  const more = list.length - CELLS;
  const tip = !list.length ? "Run a script" : [live ? `${live} running` : null, list.length - live ? `${list.length - live} ended` : null].filter(Boolean).join(" · ");
  return h_flex().flex_none().items_center()
    .child(tool(t, "tab-scripts-run", open, open ? null : list.length ? `Run a script · ${tip}` : "Run a script", (e, wasOpen) => toggleDeck({ at: dropBelow(e, DECK_W), wasOpen }),
      icon("play", open ? t.accent : t.muted),
      ...(cells.length ? [h_flex().gap(2).items_center().children(cells)] : []),
      ...(more > 0 ? [div().text_size(10).text_color(t.dim).child(`+${more}`)] : [])));
}
