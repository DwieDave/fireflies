// The Claude Code adapter: what a Claude Code terminal is asking, exactly,
// and the keys that answer it the way a person would in that terminal.
//
// Two sources, checked against each other:
//   the hook record   bin/claude-hook, run by Claude Code's PermissionRequest
//                     hook, keeps the request as Claude sent it (the tool and
//                     its input; for AskUserQuestion every question of the
//                     block, its options and multiSelect) in a file per
//                     terminal. Optional: without it, permissions still come
//                     from the screen, questions fall back to the generic view.
//   the screen        the dialog as drawn now: its options, where the cursor
//                     is, what is checked. Every key is chosen from the screen
//                     just read, and nothing is sent unless the screen still
//                     shows the request that was answered.
//
// Pure: no herdr imports, so it is tested with captured screens and hook
// payloads (scripts/fixtures/notifications).

/** The terminal's text as lines, without trailing blanks. */
function lines(screen) {
  return String(screen ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
}

const RULE = /^[─━]{8,}$/; // the full-width rule above Claude's input and dialogs
const DASH = /^\s*[╌]{8,}$/; // the dashed rules around a command or a diff
const OPTION = /^(\s*)(❯\s+)?(\s*)(\d+)\.\s(.*)$/;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The index of the last line matching `re`, else -1. */
function lastIndex(ls, re, before = ls.length) {
  for (let i = Math.min(before, ls.length) - 1; i >= 0; i--) if (re.test(ls[i])) return i;
  return -1;
}

/**
 * The dialog at the bottom of a Claude Code screen, or null:
 *   { kind: "permission", title, body, question, options: [{ n, label }], cursor, amend: "yes"|"no"|null, amendText, canAmend }
 *     amend: the note line is open on Yes or No (Tab); amendText: what is typed in it
 *   { kind: "question", headers: [{ header, done }] | null, submit, question, rows: [Row], cursor }
 *     Row { kind: "option", n, label, desc, checked: bool|null } | { kind: "next" } | { kind: "chat", n, label }
 *   { kind: "review", answers: [{ question, answer }], options: [{ n, label }], cursor }
 * `cursor` is an index into options (permission, review) or rows (question).
 */
export function parseScreen(screen) {
  const ls = lines(screen);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  // Claude's review of a question block: "Ready to submit your answers?" over
  // its options at the bottom (drawn with or without a key line under them).
  const ready = lastIndex(ls, /^\s*Ready to submit your answers\?\s*$/);
  if (ready >= 0 && ls.length - ready < 10 && ls.slice(ready + 1).every((l) => !l.trim() || OPTION.test(l) || /Esc to cancel/.test(l))) {
    const end = ls.findIndex((l, i) => i > ready && /Esc to cancel/.test(l));
    return parseReview(ls, end < 0 ? ls.length : end);
  }
  const foot = lastIndex(ls, /Esc to cancel/);
  if (foot < 0 || ls.length - foot > 4) return null;
  const footer = ls[foot];
  if (/Enter to select/.test(footer)) return parseQuestion(ls, foot);
  return parsePermission(ls, foot, /Tab to amend/.test(footer));
}

/** Numbered options ending just above `end`; continuation lines (deeper indent) join their option. */
function optionsAbove(ls, end) {
  const out = [];
  let i = end - 1;
  while (i >= 0 && !ls[i].trim()) i--;
  const block = [];
  for (; i >= 0; i--) {
    const l = ls[i];
    if (!l.trim()) break;
    block.unshift(l);
    if (OPTION.test(l) && /^\s*(❯\s+)?1\.\s/.test(l)) break;
  }
  let start = -1;
  for (const l of block) {
    const m = l.match(OPTION);
    if (m) {
      out.push({ n: Number(m[4]), label: m[5].trim(), cursor: Boolean(m[2]) });
      start = out.length;
    } else if (start > 0) out[out.length - 1].label += " " + l.trim();
  }
  return { options: out, top: i };
}

function parsePermission(ls, foot, canAmend) {
  const { options, top } = optionsAbove(ls, foot);
  if (!options.length || options[0].n !== 1) return null;
  const cursor = options.findIndex((o) => o.cursor);
  const rule = lastIndex(ls, RULE, top + 1);
  if (rule < 0) return null;
  // Claude's own "Tip: …" line (auto mode) isn't part of the request.
  const head = ls.slice(rule + 1, top).filter((l) => l.trim() && !DASH.test(l) && !TIP.test(l));
  const question = norm(head[head.length - 1] ?? "");
  const { amend, amendText } = amendOf(options[cursor]?.label ?? "", cursor, canAmend);
  return {
    kind: "permission",
    title: norm(head[0] ?? ""),
    body: head.slice(1, -1).map((l) => l.trim()),
    question,
    options: options.map(({ n, label }) => ({ n, label })),
    cursor,
    amend,
    amendText,
    canAmend,
  };
}

const TIP = /^\s*Tip: /;

/** The note line under the cursor (Tab): empty, Claude shows its placeholder
 *  as the option ("Yes, and tell Claude what to do next"); with text typed,
 *  the option reads "Yes, <text>" / "No, <text>" (Claude Code 2.1.322), and
 *  the footer has no "Tab to amend" while it's open. */
function amendOf(label, cursor, canAmend) {
  if (/^Yes, and tell Claude what to do next$/.test(label)) return { amend: "yes", amendText: "" };
  if (/^No, and tell Claude what to do differently$/.test(label)) return { amend: "no", amendText: "" };
  if (!canAmend && cursor === 0 && /^Yes, /.test(label)) return { amend: "yes", amendText: label.slice(5) };
  if (!canAmend && cursor > 0 && /^No, /.test(label) && !/\(esc\)$/.test(label)) return { amend: "no", amendText: label.slice(4) };
  return { amend: null, amendText: "" };
}

function parseQuestion(ls, foot) {
  // The block starts at the line of headers (☐ Color ☐ Pets ✔ Submit) after the last full rule.
  const h = lastIndex(ls, /^\s*(←\s+)?[☐☒]\s/, foot);
  if (h < 0 || foot - h > 60) return null;
  const parts = [...ls[h].replace(/^\s*←\s+/, "").replace(/\s+→\s*$/, "").matchAll(/([☐☒✔])\s+(.+?)(?=\s+[☐☒✔]\s|$)/g)];
  const submit = parts.some((p) => p[1] === "✔");
  const headers = parts.filter((p) => p[1] !== "✔").map((p) => ({ header: p[2].trim(), done: p[1] === "☒" }));
  // The question: the lines after the headers up to the first option.
  let i = h + 1;
  const q = [];
  for (; i < foot; i++) {
    if (OPTION.test(ls[i])) break;
    if (ls[i].trim()) q.push(ls[i].trim());
  }
  const rows = [];
  let cursor = -1;
  for (; i < foot; i++) {
    const l = ls[i];
    if (!l.trim() || RULE.test(l)) continue;
    const m = l.match(OPTION);
    if (m) {
      let label = m[5].trim();
      let checked = null;
      const box = label.match(/^\[([ ✔])\]\s?(.*)$/);
      if (box) { checked = box[1] === "✔"; label = box[2].trim(); }
      rows.push({ kind: /^Chat about this$/.test(label) ? "chat" : "option", n: Number(m[4]), label, desc: "", checked });
      if (m[2]) cursor = rows.length - 1;
      continue;
    }
    const next = l.match(/^(❯)?\s+(Next|Submit)$/);
    if (next) {
      rows.push({ kind: "next" });
      if (next[1]) cursor = rows.length - 1;
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === "option") last.desc = norm(`${last.desc} ${l}`);
  }
  if (!rows.length) return null;
  return { kind: "question", headers: headers.length ? headers : null, submit, question: norm(q.join(" ")), rows, cursor };
}

function parseReview(ls, foot) {
  const { options } = optionsAbove(ls, foot);
  const start = lastIndex(ls, /^\s*Review your answers\s*$/, foot);
  if (start < 0 || !options.length) return null;
  const answers = [];
  for (let i = start + 1; i < foot; i++) {
    const q = ls[i].match(/^\s*●\s+(.*)$/);
    if (q) { answers.push({ question: norm(q[1]), answer: "" }); continue; }
    const a = ls[i].match(/^\s*→\s+(.*)$/);
    if (a && answers.length) answers[answers.length - 1].answer = norm(a[1]);
    else if (answers.length && !answers[answers.length - 1].answer && ls[i].trim() && !/Ready to submit/.test(ls[i]) && !OPTION.test(ls[i]))
      answers[answers.length - 1].question = norm(`${answers[answers.length - 1].question} ${ls[i]}`);
  }
  return { kind: "review", answers, options: options.map(({ n, label }) => ({ n, label })), cursor: options.findIndex((o) => o.cursor) };
}

// ---- the request, as an item

/** A short line for a tool call: the command, the path, the URL. */
export function toolLine(tool, input = {}) {
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.pattern ?? input.query ?? input.prompt ?? "";
  return String(v).split("\n")[0];
}

/**
 * What a Claude Code terminal asks, from its screen and (optionally) its hook
 * record ({ at, payload }), or null when its screen shows no dialog:
 *   { type: "permission", tool, line, description, title, question, options: [{ n, label, kind }], canAmend, from }
 *   { type: "question", questions: [{ header, question, multiSelect, options: [{ label, description }] }], from }
 * `from`: "hook" when the record matches the screen, else "screen".
 */
export function describe(screen, record) {
  const s = parseScreen(screen);
  if (!s) return null;
  const p = record?.payload ?? null;
  if (s.kind === "permission") {
    const hook = p && p.tool_name !== "AskUserQuestion" && permissionMatches(s, p) ? p : null;
    return {
      type: "permission",
      tool: hook?.tool_name ?? s.title,
      line: hook ? toolLine(hook.tool_name, hook.tool_input) : s.body.join(" "),
      input: hook ? trimInput(hook.tool_input) : null,
      description: hook?.tool_input?.description ?? "",
      title: s.title,
      question: s.question,
      options: s.options.map((o, i) => ({ ...o, label: i === s.cursor && s.amend ? (s.amend === "yes" ? "Yes" : "No") : o.label, kind: optionKind(o.label) })),
      canAmend: s.canAmend || Boolean(s.amend),
      from: hook ? "hook" : "screen",
    };
  }
  const qs = p?.tool_name === "AskUserQuestion" ? p.tool_input?.questions : null;
  if (Array.isArray(qs) && questionMatches(s, qs)) {
    return { type: "question", questions: qs.map((q) => ({ header: q.header ?? "", question: q.question ?? "", multiSelect: Boolean(q.multiSelect), options: (q.options ?? []).map((o) => ({ label: o.label ?? "", description: o.description ?? "" })) })), from: "hook" };
  }
  return null;
}

/** A tool's input with long strings cut (a file's whole content isn't needed to decide). */
function trimInput(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === "string" && v.length > 4000 ? `${v.slice(0, 4000)}…` : v;
  return out;
}

/** The hook record a request was made from (what step() checks the screen against). */
export function recordOf(request) {
  if (request?.type === "permission" && request.from === "hook") return { at: 0, payload: { tool_name: request.tool, tool_input: request.input ?? {} } };
  if (request?.type === "question") return { at: 0, payload: { tool_name: "AskUserQuestion", tool_input: { questions: request.questions } } };
  return null;
}

/** "yes" | "always" | "auto" | "no", from an option's words. */
export function optionKind(label) {
  if (/^No\b/.test(label)) return "no";
  if (/switch to auto mode|switch to accept edits|bypass/i.test(label)) return "auto";
  if (/^Yes, (and|allow) (don't ask again|always)|always allow|don't ask again/i.test(label)) return "always";
  return "yes";
}

/** The hook's request is the one on screen: its command or path is shown there. */
function permissionMatches(s, p) {
  const line = norm(toolLine(p.tool_name, p.tool_input));
  if (!line) return true;
  const shown = norm([s.title, ...s.body, s.question].join(" "));
  const name = line.split("/").pop();
  return shown.includes(line.slice(0, 60)) || (name && shown.includes(name));
}

/** The question on screen is one of the block's, and the headers are the block's. */
function questionMatches(s, qs) {
  if (s.kind === "review") return s.answers.length === qs.length && s.answers.every((a, i) => a.question === norm(qs[i].question));
  if (!qs.some((q) => norm(q.question) === s.question)) return false;
  if (s.headers && (s.headers.length !== qs.length || s.headers.some((h, i) => !norm(qs[i].header).startsWith(norm(h.header).replace(/…$/, ""))))) return false;
  return true;
}

/** The dialog as drawn, as one string: it changes when a key changed the
 *  dialog, not when the rest of a busy screen (a spinner, a status line) did. */
export function dialog(screen) {
  return JSON.stringify(parseScreen(screen));
}

/** Same request: what an answer was made for is still what the screen asks. */
export function sameRequest(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "permission") return a.line === b.line && a.title === b.title && a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i].label);
  return JSON.stringify(a.questions) === JSON.stringify(b.questions);
}

// ---- answering: one step at a time, each from the screen just read

/**
 * The next thing to do for `goal` given the screen now. `state` is kept by
 * the driver between steps ({} at first). Returns one of
 *   { keys: [names] }      press these (hc keys)
 *   { paste: text }        paste text and press Enter (hc send --force)
 *   { wait: true, reason } nothing yet: read the screen again (reason: what
 *                          to say if it never comes)
 *   { done: true }         answered
 *   { refuse: reason }     stop: the screen isn't what the answer was for
 *
 * Goals:
 *   { type: "permission", request, option: n, amend?: text }
 *     option n is the screen's number; amend ("yes, but" / "no, but") only on the
 *     first option (Yes) or the "No" one
 *   { type: "question", request, answers: [{ picked: [optionIndex], other: text | null }] }
 */
export function step(goal, screen, state) {
  if (goal.record === undefined) goal = { ...goal, record: recordOf(goal.request) };
  return goal.type === "permission" ? permissionStep(goal, screen, state) : questionStep(goal, screen, state);
}

function move(from, to) {
  if (from < 0) return null;
  if (from === to) return [];
  return Array(Math.abs(to - from)).fill(to > from ? "down" : "up");
}

function permissionStep(goal, screen, state) {
  const now = describe(screen, goal.record);
  if (state.sent) {
    // Answered: done once the screen no longer shows this request.
    if (!now || !sameRequest(now, goal.request)) return { done: true };
    const s = parseScreen(screen);
    if (goal.amend != null && s?.amend) {
      // The note is in the line but its Enter didn't land: press it, once.
      if (norm(s.amendText) === norm(oneLine(goal.amend))) {
        state.waited = (state.waited ?? 0) + 1;
        if (state.waited >= 2 && !state.entered) { state.entered = true; return { keys: ["enter"] }; }
        return { wait: true, reason: "The note is typed in the terminal but wasn't sent: press enter there." };
      }
      if (!s.amendText) return { wait: true, reason: "The note didn't arrive in the terminal: nothing was sent." };
    }
    return { wait: true, reason: "Sent, but the request is still showing: look at the terminal." };
  }
  if (!now || now.type !== "permission") return { refuse: "The request is gone: it was answered or withdrawn." };
  if (!sameRequest(now, goal.request)) return { refuse: "The request changed: look at it again." };
  const s = parseScreen(screen);
  const t = s.options.findIndex((o) => o.n === goal.option);
  const want = goal.request.options.find((o) => o.n === goal.option);
  if (t < 0 || !want || now.options[t].label !== want.label) return { refuse: "That option isn't there any more." };
  if (s.cursor !== t) {
    // An amend field open on another option: moving would carry its text, so stop.
    if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };
    return { keys: move(s.cursor, t) ?? [] };
  }
  if (goal.amend != null) {
    const kind = want.kind === "no" ? "no" : t === 0 ? "yes" : null;
    if (!kind) return { refuse: "Only Yes and No take a note." };
    if (s.amend !== kind) {
      if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };
      // Tab opens the note line and closes it again: pressed once, then
      // waited for (another change on the screen may draw first).
      if (state.tabbed) return { wait: true, reason: "The note line didn't open in the terminal: nothing was sent." };
      if (!s.canAmend) return { refuse: "This request doesn't take a note." };
      state.tabbed = true;
      return { keys: ["tab"] };
    }
    if (s.amendText) return { refuse: "Someone is typing in that request: answer it there." };
    state.sent = true;
    return { paste: oneLine(goal.amend) };
  }
  if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };
  state.sent = true;
  return { keys: ["enter"] };
}

export const oneLine = (s) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();

/** How Claude's review shows an answer: picked labels in option order, then typed text. */
export function reviewText(q, a) {
  const words = [...(a.picked ?? [])].sort((x, y) => x - y).map((i) => q.options[i]?.label);
  if (a.other) words.push(oneLine(a.other));
  return words.join(", ");
}

/** Types the answer once per question: text that didn't arrive isn't typed again. */
function pasteOnce(state, text) {
  state.pasted ??= {};
  if (state.pasted[state.q]) return { refuse: "The typed answer didn't arrive in the terminal: nothing was submitted." };
  state.pasted[state.q] = true;
  return { paste: oneLine(text) };
}

function questionStep(goal, screen, state) {
  const qs = goal.request.questions;
  const s = parseScreen(screen);
  const ours = s && (s.kind === "question" || s.kind === "review") && questionMatches(s, qs);
  if (state.sent) return ours ? { wait: true } : { done: true };
  if (!ours) return { refuse: state.started ? "The questions changed or went away while answering: nothing was submitted." : "The questions are gone: they were answered or withdrawn." };
  state.started = true;
  state.q ??= 0;
  const single = qs.length === 1;

  if (s.kind === "review") {
    if (state.q < qs.length) return { keys: ["shift+tab"] };
    // Every answer as Claude will send it, before submitting.
    for (let i = 0; i < qs.length; i++) {
      const want = reviewText(qs[i], goal.answers[i]);
      if (s.answers[i]?.answer !== norm(want)) return { refuse: `Claude's review shows “${s.answers[i]?.answer ?? ""}” for “${qs[i].question}”, not “${want}”: nothing was submitted.` };
    }
    const t = s.options.findIndex((o) => /^Submit answers$/.test(o.label));
    if (t < 0) return { refuse: "No submit button on Claude's review." };
    if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };
    state.sent = true;
    return { keys: ["enter"] };
  }

  const qi = qs.findIndex((q) => norm(q.question) === s.question);
  if (state.q >= qs.length) {
    // All answered and still on a question: on to the review.
    return single ? { refuse: "The question is still open after answering." } : { keys: ["tab"] };
  }
  if (qi !== state.q) return { keys: [qi < state.q ? "tab" : "shift+tab"] };
  const q = qs[qi];
  const a = goal.answers[qi];
  const n = q.options.length;
  const opts = s.rows.filter((r) => r.kind === "option");
  if (opts.length < n + 1) return { refuse: "The options on screen aren't the question's." };
  for (let i = 0; i < n; i++) if (norm(opts[i].label) !== norm(q.options[i].label)) return { refuse: "The options on screen aren't the question's." };
  const otherRow = s.rows.indexOf(opts[n]);
  const otherText = /^Type something\.?$/.test(opts[n].label) ? "" : opts[n].label;
  const last = state.q === qs.length - 1;
  const advance = () => { state.q += 1; if (single || (last && !s.submit)) state.sent = true; };

  if (!q.multiSelect) {
    if (a.other) {
      if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };
      if (otherText && otherText !== oneLine(a.other)) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };
      if (otherText) { advance(); return { keys: ["enter"] }; }
      const p = pasteOnce(state, a.other);
      if (p.paste != null) advance();
      return p;
    }
    const t = s.rows.indexOf(opts[a.picked[0]]);
    if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };
    advance();
    return { keys: ["enter"] };
  }

  // multiSelect: every box as wanted, one at a time, then Next.
  for (let i = 0; i < n; i++) {
    const want = a.picked.includes(i);
    if (opts[i].checked !== want) {
      const t = s.rows.indexOf(opts[i]);
      if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };
      return { keys: ["space"] };
    }
  }
  const wantOther = Boolean(a.other);
  if (wantOther && otherText !== oneLine(a.other)) {
    if (otherText) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };
    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };
    return pasteOnce(state, a.other);
  }
  if (opts[n].checked !== wantOther) {
    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };
    // Enter toggles the typed answer (space would type a space into it).
    return { keys: ["enter"] };
  }
  const next = s.rows.findIndex((r) => r.kind === "next");
  if (next < 0) return { refuse: "No Next on screen." };
  if (s.cursor !== next) return { keys: move(s.cursor, next) ?? [] };
  advance();
  return { keys: ["enter"] };
}
