// The editor pane's language server (main.ts): starting one for a tab's
// language, listening to it (diagnostics, progress), sending changes, asking
// it (requests, go to definition).

import type { ExecResult } from "herdr";
import type { EnvNote, ServerCandidate, ServerCaps } from "./logic.ts";
import type { EnvCache, EnvVars, KeptEnv, ProjectEnv } from "./envrc.ts";
import type EditorPane from "./main.ts";
import { editorPaths, filesOf } from "./editor-route.ts";
import { cacheName, keptEnv, keptEnvText, lookup, projectEnv, wrap } from "./envrc.ts";
import type { Guard } from "./guard.ts";
import { isString, object, oneOf } from "./guard.ts";
import { isJsonObject, isList } from "./guards.ts";
import { basename, changeBetween, dirname, incremental, isServerCaps, languageId, pickRoot, ROOTS, rootScript, serverCandidates, uri } from "./logic.ts";
import type { Problem, ProgressParams } from "./lsp-replies.ts";
import { busy, diagnostics, firstLocation, isLocations, isLspDiagnostic, isProgressParams, isPublishedDiagnostics, lineNotes, progressWord } from "./lsp-replies.ts";
import type { EditorState as EditorStateT } from "gpui-base";
import type { Context } from "gpui-kit";
import { appHome, exec, lspNextMessage, lspNotify, lspRelease, lspRequest, lspStart, panes, readTextFile, shared, theme, writeTextFile } from "herdr";
import type { Doc, LspExtra } from "./pane-kit.ts";
import { errorText, MOD, paneProps, serverId, serverName } from "./pane-kit.ts";

export const CHANGE_DELAY = 40; // ms: edits typed together go to the server as one change (and before any question)

// How long a server runs on once its last editor closes (s): coming back to
// the project within it is instant. Fireflies keeps at most a few unused servers
// (least recently used stop first), so this is a ceiling, not a promise.
export const SERVER_IDLE = 15 * 60;

// The project environments kept on disk (envrc.ts): a second app start runs no nix.
export const envFile = (dir: string): string => `${appHome()}/cache/editor/${cacheName(dir)}`;

export const envCache: EnvCache = {
  async read(dir: string): Promise<KeptEnv | null> {
    return keptEnv(await readTextFile(envFile(dir)), dir);
  },
  async write(dir: string, value: KeptEnv): Promise<void> {
    const path = envFile(dir);
    const was = await readTextFile(path).catch(() => null);

    await writeTextFile(path, keptEnvText(dir, value), was).catch(() => null);
  },
};

/** `$/exit`'s params: the server's last lines. */
export const isExitParams = object({}, { stderr: oneOf(isList) });

/** A problem as the code editor underlines it. */
export function editorProblem(p: Problem): Parameters<EditorStateT["set_diagnostics"]>[0][number] {
  const at = { line: p.line, col: p.col, end_line: p.end_line, end_col: p.end_col, severity: p.severity, message: p.message };

  if (p.code !== null && p.source !== null) return { ...at, code: p.code, source: p.source };

  if (p.code !== null) return { ...at, code: p.code };

  if (p.source !== null) return { ...at, source: p.source };

  return at;
}

/** A step of the way to the server's answers, for a look at where the time
 *  goes: `HERDR_APP_LOG=info,gpui_shell::script=debug` prints them. */
export function logStep(ed: EditorPane, what: string, d: Doc | null = ed.cur): void {
  console.debug(`lsp ${basename(d?.path ?? "")} +${Date.now() - (d?.openedAt ?? Date.now())}ms ${what}`);
}

/** Starts (or joins) tab `d`'s language server as it opens, so it is warm
 *  by the time anything is asked: the project's environment from disk when
 *  nothing it depends on changed (envrc.ts), the lookups side by side, then
 *  herdr's session for this server and workspace (one per project: every
 *  tab and editor of it shares it). `fresh`: the kept environment's server
 *  is gone (garbage-collected): load it anew. */
export async function startServer(ed: EditorPane, cx: Context, fresh = false, d: Doc = ed.shown()): Promise<void> {
  const redraw = (): void => {
    if (d === ed.cur) ed.cardState(cx);

    cx.notify();
  };

  if (ed.on) {
    d.server = { status: "none", why: "remote" };

    return;
  }

  const candidates = serverCandidates(d.lang, d.opts);

  if (!candidates.length) {
    d.server = { status: "none", why: d.opts.server === false ? "off" : "unknown" };
    cx.notify();

    return;
  }

  const names = candidates.map((c) => basename(c.argv[0] ?? ""));
  const dir = dirname(d.path);

  // The workspace's own environment first (envrc.ts): its .envrc, through direnv.
  logStep(ed, "start", d);

  const env = await projectEnv(exec, dir, {
    cache: envCache,
    fresh,
    loading: (at) => {
      d.server = { status: "env", envrc: at, names };
      logStep(ed, "environment: loading with direnv", d);
      cx.notify();
    },
  });

  if (d.gone) return;

  logStep(ed, `environment: ${env.kind}${env.kind === "ready" && env.cached ? " (kept on disk; refreshing behind)" : ""}`, d);

  const inEnv = env.kind === "ready" ? env.env : null;
  const [paths, r] = await lookups(candidates, d.lang, dir, inEnv);

  if (d.gone) return;

  const at = paths.findIndex(Boolean);
  const pick = at >= 0 ? candidates[at] : undefined;
  const path = paths[at] ?? null;

  if (!pick && env.kind === "ready" && env.cached && !fresh) return ed.startServer(cx, true, d);

  // Not there: why, for the bar and the hover card (logic.ts serverNote).
  const envNote = envNoteOf(env);

  if (!pick || path === null) {
    d.server = { status: "none", why: "missing", names, ...envNote };
    redraw();

    return;
  }

  logStep(ed, `lookup: ${path}`, d);

  const root = pickRoot(d.lang, r?.stdout, dir);
  const argv = wrap(pick.argv, path, inEnv);
  const name = basename(pick.argv[0] ?? "");

  d.server = { status: "starting", argv, root, name, ...envNote };
  cx.notify();

  let started: Awaited<ReturnType<typeof lspStart>>;

  logStep(ed, "lspStart", d);

  // The settings go out as the server's own (an object; another JSON value isn't sent).
  const settingsOut = isJsonObject(pick.settings) ? pick.settings : null;

  try {
    started = await lspStart({ argv, root, settings: settingsOut, idle: SERVER_IDLE });
  } catch (cause) {
    d.server = { status: "exited", name, note: errorText(cause), ...envNote };
    redraw();

    return;
  }

  const id = started.id;

  if (d.gone) {
    // Closed while it started: let go unless another tab holds it.
    if (!ed.allDocs().some((x) => serverId(x.server) === id)) lspRelease(id);

    return;
  }

  serverReady(ed, d, { argv, root, name, id, caps: isServerCaps(started.capabilities) ? started.capabilities : {} }, envNote, cx);
  redraw();
}

/** Every candidate's path and the workspace root at once: each is a process. */
async function lookups(candidates: readonly ServerCandidate[], lang: string, dir: string, inEnv: EnvVars | null): Promise<[(string | null)[], ExecResult | null]> {
  const markers = ROOTS.get(lang)?.markers ?? [];

  return Promise.all([
    Promise.all(candidates.map((c) => {
      const program = c.argv[0] ?? "";

      return program.startsWith("/") ? Promise.resolve(program) : lookup(exec, program, inEnv);
    })),
    exec("sh", ["-c", rootScript(markers), "root", dir]).catch(() => null),
  ]);
}

/** What the bar and the card say of the project's environment when there's no server (logic.ts serverNote). */
function envNoteOf(env: ProjectEnv): EnvNote {
  return env.kind === "none"
    ? {}
    : env.kind === "blocked"
      ? { envrc: env.dir, envKind: env.kind, envNote: null, denied: env.denied }
      : env.kind === "failed"
        ? { envrc: env.dir, envKind: env.kind, envNote: env.note, denied: false }
        : { envrc: env.dir, envKind: env.kind, envNote: null, denied: false };
}

/** A started server, ready for tab `d`: its work shared with the tabs on it, the document opened, listened to. */
function serverReady(ed: EditorPane, d: Doc, s: { readonly argv: readonly string[]; readonly root: string; readonly name: string; readonly id: number; readonly caps: ServerCaps }, envNote: EnvNote, cx: Context): void {
  const { argv, root, name, id, caps } = s;

  d.server = { status: "ready", argv, root, name, id, caps, ...envNote };
  logStep(ed, "initialized", d);

  // The server's work is the server's: tabs sharing it share what's under way.
  const sibling = ed.allDocs().find((x) => x !== d && serverId(x.server) === id);

  if (sibling) {
    d.progress = sibling.progress;
    d.lastWork = sibling.lastWork;
  } else {
    d.progress.clear();
    d.lastWork = Date.now();
  }

  d.version = 1;
  d.sent = d.editor.value();
  lspNotify(id, "textDocument/didOpen", { textDocument: { uri: uri(d.path), languageId: languageId(d.lang, d.path), version: d.version, text: d.sent } });
  listen(ed, id, cx);
}

/** The server's messages, once per server however many tabs use it
 *  (herdr keeps one queue per copy): diagnostics go to the tab of their
 *  file, work and an exit to every tab on it. */
export function listen(ed: EditorPane, id: number, cx: Context): void {
  if (ed.listening.has(id)) return;

  ed.listening.add(id);

  const on = (): Doc[] => ed.allDocs().filter((d) => serverId(d.server) === id);

  cx.spawn(async (cx) => {
    for (;;) {
      let m: Awaited<ReturnType<typeof lspNextMessage>>;

      try {
        m = await lspNextMessage(id);
      } catch {
        ed.listening.delete(id);

        return;
      }

      if (!ed.listening.has(id) || !on().length) {
        ed.listening.delete(id);

        return;
      }

      if (m.method === "textDocument/publishDiagnostics") {
        const params = m.params;

        if (!isPublishedDiagnostics(params)) continue;

        const d = on().find((x) => uri(x.path) === params.uri);

        if (d) {
          // Each diagnostic as LSP has it; one in another shape is left out.
          ed.setProblems(diagnostics(params.diagnostics.filter((x) => isLspDiagnostic(x))), d);
          cx.notify();
        }
      } else if (m.method === "$/progress") {
        if (isProgressParams(m.params)) onProgress(ed, m.params, cx, id);
      } else if (m.method === "$/exit") {
        const stderr = isExitParams(m.params) ? (m.params.stderr ?? []) : [];
        const lastLine = stderr.at(-1);
        const note = isString(lastLine) ? lastLine : "it stopped";

        for (const d of on()) {
          const s = d.server;

          d.server = { status: "exited", name: s && "name" in s ? s.name : "server", note };
          d.progress.clear();
        }

        ed.listening.delete(id);
        ed.cardState(cx);
        cx.notify();

        return;
      }
    }
  });
}

/** The server's work under way, for the bar ("indexing 120/340") and a
 *  waiting card, which asks again once the work answers wait on is done.
 *  `id`: the server (default: the shown tab's). */
export function onProgress(ed: EditorPane, params: ProgressParams, cx: Context, id: number | null = serverId(ed.cur?.server)): void {
  const docs = ed.allDocs().filter((d) => serverId(d.server) === id);
  const d0 = docs.find((d) => d === ed.cur) ?? docs[0] ?? ed.cur;

  if (!d0) return;

  const progress = d0.progress;
  const token = String(params.token);
  const v = params.value;
  const wasBusy = busy(progress);

  if (!/\b(cargo check|check|clippy|flycheck)\b/i.test(v.title ?? progress.get(token)?.title ?? "")) {
    const now = Date.now();

    for (const d of docs.length ? docs : [d0]) d.lastWork = now;
  }

  if (v.kind === "begin") {
    progress.set(token, v.percentage === undefined ? { title: v.title ?? "", message: v.message ?? "" } : { title: v.title ?? "", message: v.message ?? "", percentage: v.percentage });
    logStep(ed, `begin ${v.title ?? ""}`, d0);
  } else if (v.kind === "report") {
    const work = progress.get(token);

    if (!work) return;

    if (v.message !== undefined) work.message = v.message;

    if (v.percentage !== undefined) work.percentage = v.percentage;
  } else {
    logStep(ed, `end ${progress.get(token)?.title ?? token}`, d0);
    progress.delete(token);
  }

  if (v.kind === "end" && !busy(progress)) {
    for (const d of docs.length ? docs : [d0]) d.hovers.clear();

    if (wasBusy && d0 === ed.cur) ed.cardState(cx);
  }

  // Reports come by the hundred while it indexes: one redraw per frame or so.
  if (ed.redrawSoon) return;

  ed.redrawSoon = true;
  cx.timer.after(50, (cx) => {
    ed.redrawSoon = false;
    cx.notify();
  });
}

export function setProblems(ed: EditorPane, list: Problem[], d: Doc = ed.shown()): void {
  d.problems = list;

  const t = theme();
  const colors = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };

  d.editor.set_diagnostics(list.map((p) => editorProblem(p)));
  d.editor.set_line_notes(lineNotes(list, colors).map((n) => ({ ...n, color: n.color + "bb" })));
}

/** Tells the server about an edit: what changed since it last heard, as one
 *  ranged change (the whole text for servers that want it, or when another
 *  editor has the file open too: their buffers differ), a moment after the
 *  typing, or at once (`now`; before every question). */
export function didChange(ed: EditorPane, cx: Context, now: boolean, d: Doc = ed.shown()): void {
  if (serverId(d.server) === null) return;

  if (now) return flush(ed, d);

  if (d.flushDue) return;

  d.flushDue = true;
  cx.timer.after(CHANGE_DELAY, () => flush(ed, d));
}

export function flush(ed: EditorPane, d: Doc = ed.shown()): void {
  d.flushDue = false;

  const s = d.server;

  if (s?.status !== "ready") return;

  const text = d.editor.value();

  if (text === d.sent) return;

  // Another editor pane holding the file (any of its tabs): their buffers differ.
  const paths = editorPaths(shared);
  const alone = !panes().some((p) => p.mod === MOD && paneProps(p).slot !== ed.slot && filesOf(p, paths).includes(d.path));
  const change = (d.sent !== null && alone && incremental(s.caps) ? changeBetween(d.sent, text) : null) ?? { text };

  d.sent = text;
  d.version += 1;
  lspNotify(s.id, "textDocument/didChange", { textDocument: { uri: uri(d.path), version: d.version }, contentChanges: [change] });
}

/** A question about a place (the caret by default). `key`: a newer question
 *  with the same key cancels this one at the server (herdr's lspRequest). */
export async function request<T>(ed: EditorPane, method: string, guard: Guard<T>, extra: LspExtra = {}, line: number | null = null, col: number | null = null, key: string | null = null): Promise<T | null> {
  const id = serverId(ed.server);

  if (id === null) return null;

  flush(ed);

  const at = line === null ? ed.editor.cursor() : { line, col: col ?? 0 };
  const answer = await lspRequest(id, method, { textDocument: { uri: uri(ed.path) }, position: { line: at.line, character: at.col }, ...extra }, key ? { key } : undefined);

  // An answer in another shape counts as none.
  return guard(answer) ? answer : null;
}

export function definition(ed: EditorPane, cx: Context): Promise<void> {
  return ed.later(cx, (cx) => definitionNow(ed, cx));
}

export async function definitionNow(ed: EditorPane, cx: Context): Promise<void> {
  let loc = null;

  try {
    loc = firstLocation(await ed.request("textDocument/definition", isLocations, {}, null, null, "definition"));
  } catch (cause) {
    if (!/cancelled/.test(errorText(cause))) ed.say(errorText(cause), true);
  }

  if (!loc) {
    // Still loading the workspace: say so, rather than "not found".
    const work = busy(ed.progress) ? progressWord(ed.progress) : null;

    if (work) ed.say(`${serverName(ed.server) ?? "the server"} is busy: ${work}`);
    else if (serverId(ed.server) !== null) ed.say("no definition found");
    else ed.say(ed.serverNote()?.short || "no language server");

    cx.notify();

    return;
  }

  ed.closeCard(cx);

  // Another file: a tab of this editor (the one showing it, if open).
  if (loc.path === ed.path) ed.goto(loc.line, loc.col, cx);
  else ed.openFile(loc.path, cx, { line: loc.line + 1, col: loc.col + 1 });
}
