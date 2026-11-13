// The script runner's corner of the tab strip (the deck itself is the
// scripts mod): ▶ and a little jar with one dithered cell per run in
// its state's color (running ones breathe, ok green, failed red, stopped
// grey). A click opens the deck hanging under ▶ (kit.js dropBelow), a
// second closes it (and it stays closed: tabs.js tool); ▶ is lit while it's
// open. Stopping happens there.
// cmd-shift-r (nocturne.scripts) opens the deck centered, or closes it.
//
// A run is a labeled pane-less terminal (scripts/runs.ts); this file
// reads the same labels. The strip also tells about failures: a run that
// ended with a nonzero exit code, not stopped by a person, posts one toast
// (shared(TOLD) keeps which, so two windows don't both tell).

import { div, svg } from "gpui-kit";
import type { Color, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, openOverlay, closeOverlay, shared, setShared, notify, hc, exec } from "herdr";
import type { Status, Theme } from "herdr";
import { isNumber, isString, nullable, object, parseJson, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import { isTerminal } from "./guards.ts";
import type { Terminal } from "./guards.ts";
import { ART, dither, dropBelow } from "./kit.ts";
import type { DropAt, ToolButton } from "./kit.ts";
import { here } from "./panels.ts";

export const DECK = "scripts.deck";

/** The open deck's note: its overlay, renewed every second (the scripts mod writes it too). */
const DECK_KEY = sharedKey(DECK, nullable(object({ id: isString }, { beat: isNumber })));

/** The failed runs a toast told about: address -> 1. */
const TOLD = sharedMapKey("scripts.told", isNumber);

// Ended runs as their terminals' records, by address (trackRuns).
export const ENDED = "scripts.ended";
const ENDED_KEY = sharedMapKey(ENDED, isTerminal);

// Runs being followed until they end: { address: when first seen }.
const TRACK = sharedMapKey("scripts.track", isNumber);
const CELLS = 8;
export const DECK_W = 420;
export const DECK_H = 470;

/** A run's terminal: labeled by the scripts mod (scripts/runs.ts). */
const isRun = (t: Terminal) => Boolean(t.labels?.["nocturne.script"]);

/** The live runs' terminals. */
const liveRuns = (): Terminal[] => terminals().filter((t) => isTerminal(t)).filter((t) => isRun(t));

/** Every run's terminal record: live ones from terminals(), ended ones kept in shared(ENDED). */
export function scriptTerminals(): Terminal[] {
  const all = liveRuns();
  const live = new Set(all.map((t) => t.address));

  return [...all, ...[...readSharedMap(shared, ENDED_KEY).values()].filter((t) => !live.has(t.address))];
}

/** Follows runs: terminals() lists only live terminals, so a run that ends
 *  just goes from it. Every labeled terminal seen live (and every one the deck
 *  started, which may end before it's ever seen) is in shared(TRACK); once it
 *  isn't live any more, `hc get` gives its last record (exit code, how it
 *  ended), kept in shared(ENDED), the newest 30. */
let checking = false;

export async function trackRuns(): Promise<void> {
  const live = liveRuns();
  const tracked = new Map(readSharedMap(shared, TRACK));
  let changed = false;

  for (const t of live) {
    if (!tracked.get(t.address)) {
      tracked.set(t.address, Date.now());
      changed = true;
    }
  }

  if (changed) writeSharedMap(setShared, TRACK, tracked);

  const gone = [...tracked.keys()].filter((a) => !live.some((t) => t.address === a));

  if (!gone.length || checking) return;

  checking = true;

  try {
    const ended = new Map(readSharedMap(shared, ENDED_KEY));
    const now = new Map(readSharedMap(shared, TRACK));

    for (const a of gone) {
      const r = await hc(["get", a, "--json"]).catch(() => null);
      const rec = r?.code === 0 ? (parseJson(r.stdout, isTerminal) ?? null) : null;

      if (rec?.state === "live") {
        // Started a moment ago, not in terminals() yet; give up on it after a minute.
        if (Date.now() - (tracked.get(a) ?? 0) > 60000) now.delete(a);

        continue;
      }

      now.delete(a);

      if (rec?.state === "finished" && rec.labels?.["nocturne.script"]) {
        ended.set(a, {
          address: a, labels: rec.labels, state: "finished", exit_code: rec.exit_code ?? null, reason: rec.reason ?? null,
          created_ms: rec.created_ms ?? null, finished_ms: rec.finished_ms ?? null, cwd: rec.cwd ?? null, argv: rec.argv ?? null,
        });
      }
    }

    const newest = [...ended.values()].sort((x, y) => (x.finished_ms ?? 0) - (y.finished_ms ?? 0)).slice(-30);

    writeSharedMap(setShared, ENDED_KEY, new Map(newest.map((t) => [t.address, t])));
    writeSharedMap(setShared, TRACK, now);
  } finally {
    checking = false;
  }
}

/** A run, as the strip and the palette read it. */
export interface ScriptRun {
  readonly address: string;
  readonly name: string | undefined;
  readonly admin: string | null;
  readonly plan: string | null;
  /** The machine it runs on, null for this one. */
  readonly on: string | null;
  readonly live: boolean;
  readonly code: number | null;
  readonly reason: string | null;
  readonly started: number;
  readonly ended: number;
}

/** Every run: { address, name, admin, plan, on, live, code, reason, started }, the running ones first. */
export function scriptRuns(): ScriptRun[] {
  return scriptTerminals()
    .map((t) => ({
      address: t.address, name: t.labels?.["nocturne.script.name"] || t.labels?.["nocturne.script"], admin: t.labels?.["nocturne.script.admin"] || null,
      plan: t.labels?.["nocturne.script.plan"] || null, on: t.address.includes("/") ? t.address.slice(0, t.address.lastIndexOf("/")) : null, live: t.state !== "finished",
      code: t.exit_code ?? null, reason: t.reason ?? null, started: t.created_ms ?? 0, ended: t.finished_ms ?? 0,
    }))
    .sort((a, b) => Number(b.live) - Number(a.live) || a.started - b.started);
}

/** Where scripts come from: a folder and its machine. */
export interface ScriptsFolder {
  readonly folder: string | null;
  readonly on: string | null;
}

/** The folder scripts come from: the space's own folder, else the focused pane's. */
export function scriptsFolder(): ScriptsFolder {
  const h = here();

  return { folder: (h.space?.attached && h.space.folder) || h.folder, on: h.on };
}

/** How the deck opens (toggleDeck). */
export interface DeckOpening {
  /** "pick" the filter, "runs" the running list. */
  readonly focus?: "pick" | "runs";
  readonly centered?: boolean;
  /** A run (its address) to show. */
  readonly show?: string | null;
  readonly again?: boolean;
  readonly at?: DropAt | null;
  readonly wasOpen?: boolean;
}

/** The deck's props (the scripts mod reads them). */
type DeckProps = { folder: string | null; on: string | null; focus: "pick" | "runs"; show?: string; again?: true };

/** Opens the deck (focus: "pick" the filter, "runs" the running list), or
 *  closes it when open. `show` (a run) and `again` always open it, on that.
 *  `wasOpen`: ▶ was lit when pressed (tabs.js tool): the press closed the
 *  deck already, or closes it now; either way it stays closed. */
export function toggleDeck({ focus = "pick", centered = false, show = null, again = false, at = null, wasOpen = false }: DeckOpening = {}): void {
  const open = deckOpen();

  if (open) {
    writeShared(setShared, DECK_KEY, null);
    closeOverlay(open);

    if (!show && !again) return;
  } else if (wasOpen && !show && !again) return;

  const { folder, on } = scriptsFolder();
  const props: DeckProps = { folder, on, focus };

  if (show) props.show = show;

  if (again) props.again = true;

  const kind = centered ? "dialog" : "popup";

  const id = openOverlay(at && !centered
    ? { mod: "scripts", kind, frame: "none", width: DECK_W, height: DECK_H, at, props }
    : { mod: "scripts", kind, frame: "none", width: DECK_W, height: DECK_H, props });

  writeShared(setShared, DECK_KEY, { id, beat: Date.now() });
}

/** The open deck's overlay id, or null. The deck renews shared(DECK) every
 *  second, so a note left by an app restart doesn't swallow a press. */
export function deckOpen(): string | null {
  const d = readShared(shared, DECK_KEY, null);

  return d?.id && Date.now() - (d.beat ?? 0) < 4000 ? d.id : null;
}

const tone = (r: ScriptRun): Status => (r.live ? "working" : r.reason === "killed" ? "idle" : r.code === 0 ? "done" : "blocked");

/** A run that failed (killed ones aren't failures). */
const failed = (r: ScriptRun) => !r.live && r.reason !== "killed" && r.code != null && r.code !== 0;

/** The newest failed run, and its address for the toast's click (nocturne.scripts-failed). */
const lastFailedRun = (): ScriptRun | null => scriptRuns().filter((r) => failed(r)).sort((a, b) => b.ended - a.ended)[0] ?? null;

export const lastFailed = (): string | null => lastFailedRun()?.address ?? null;

// A nix-darwin switch fails when Herdr Core lacks App Management (a copy of
// ../scripts/nix.ts APP_MANAGEMENT: a mod can't import another's).
const APP_MANAGEMENT = {
  match: "permission denied when trying to update apps",
  hint: "Herdr Core needs App Management (System Settings > Privacy & Security). If it is already on, remove it and add it again",
  open: `open 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'; open -R "$HOME/.local/share/herdr-core/active/Herdr Core.app"`,
} as const;

/** The toast's click for that failure (nocturne.scripts-grant): opens the
 *  setting and shows Herdr Core in Finder, on the machine the run was on. */
export function grantAppManagement(): void {
  exec("sh", ["-c", APP_MANAGEMENT.open], { on: lastFailedRun()?.on ?? null }).catch(() => null);
}

/** A failed nix-darwin switch's output says Herdr Core lacks App Management. */
async function needsAppManagement(r: ScriptRun): Promise<boolean> {
  if (!(r.plan ?? "").startsWith("darwin-rebuild:")) return false;

  const res = await hc(["read", r.address, "--lines", "300"]).catch(() => null);

  return res?.code === 0 && res.stdout.includes(APP_MANAGEMENT.match);
}

/** One toast per failed run (killed ones aren't failures). */
export function tellFailures(list: readonly ScriptRun[]): void {
  const told = readSharedMap(shared, TOLD);
  const fresh = list.filter((r) => failed(r) && !told.get(r.address) && Date.now() - (r.ended || 0) < 60000);
  // Forget runs that are gone, so the note stays small.
  const keep = new Map([...told].filter(([a]) => list.some((r) => r.address === a)));

  if (!fresh.length) {
    if (keep.size !== told.size) writeSharedMap(setShared, TOLD, keep);

    return;
  }

  for (const r of fresh) keep.set(r.address, 1);

  writeSharedMap(setShared, TOLD, keep);

  for (const r of fresh) {
    const name = r.name ?? "";
    // An admin run cancelled at its password prompt (scripts/nix.ts CANCELLED).
    const cancelled = Boolean(r.admin) && r.code === 130;

    if (!cancelled && r.plan) {
      needsAppManagement(r).then((grant) => notify(grant
        ? { title: "Herdr Core needs App Management", body: `${name} · click to open the setting`, level: "error", action: { name: "nocturne.scripts-grant" } }
        : { title: `${name} failed · exit ${r.code ?? ""}`, body: "click to see its output", level: "error", action: { name: "nocturne.scripts-failed" } }));
      continue;
    }

    notify({
      title: cancelled ? `${name} cancelled` : `${name} failed · exit ${r.code ?? ""}`,
      body: cancelled ? "no password given" : "click to see its output", level: cancelled ? "warning" : "error",
      action: { name: "nocturne.scripts-failed" },
    });
  }
}

/** The strip's control: ▶ and the jar. `tool` is the strip's icon button. */
export function scriptsControl(t: Theme, tool: ToolButton): Element {
  const list = scriptRuns();
  const live = list.filter((r) => r.live).length;
  const open = Boolean(deckOpen());
  const icon = (n: string, c: Color) => svg(`${ART}/${n}.svg`).size(9).text_color(c);

  const cells = list.slice(0, CELLS).map((r, i) => {
    const c = t[tone(r)];
    const cell = div().id(`sc-cell-${i}`).relative().w(4).h(10).flex_none().child(dither(c, 1));

    return r.live ? cell.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : cell.opacity(r.reason === "killed" ? 0.5 : 1);
  });

  const more = list.length - CELLS;
  const tip = !list.length ? "Run a script" : [live ? `${live} running` : null, list.length - live ? `${list.length - live} ended` : null].flatMap((x) => (x ? [x] : [])).join(" · ");

  const kids = [
    icon("play", open ? t.accent : t.muted),
    ...(cells.length ? [h_flex().gap(2).items_center().children(cells)] : []),
    ...(more > 0 ? [div().text_size(10).text_color(t.dim).child(`+${more}`)] : []),
  ];

  const press = (e: MouseButtonEvent | undefined, wasOpen: boolean) => toggleDeck({ at: dropBelow(e, DECK_W), wasOpen });

  return h_flex().flex_none().items_center()
    .child(tool(t, "tab-scripts-run", open, open ? null : list.length ? `Run a script · ${tip}` : "Run a script", press, ...kids));
}
