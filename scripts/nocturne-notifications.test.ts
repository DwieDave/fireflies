import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { parseScreen, describe as describeClaude, step, reviewText, optionKind, dialog } from "../defaults/mods/nocturne-notifications/claude.js";

const FIX = `${import.meta.dir}/fixtures/nocturne-notifications`;
const screen = (name: string) => readFileSync(`${FIX}/${name}.txt`, "utf8");
const hook = (name: string) => ({ at: 0, payload: JSON.parse(readFileSync(`${FIX}/${name}.json`, "utf8")) });

// ---- parsing Claude Code's dialogs (captured from Claude Code 2.1)

test("a Bash permission: its options, wrapped lines joined, the cursor", () => {
  const s: any = parseScreen(screen("perm-bash"));
  expect(s.kind).toBe("permission");
  expect(s.title).toBe("Bash command");
  expect(s.question).toBe("Do you want to proceed?");
  expect(s.options.map((o: any) => o.n)).toEqual([1, 2, 3, 4]);
  expect(s.options[0].label).toBe("Yes");
  expect(s.options[1].label).toMatch(/^Yes, and don't ask again for mkdir -p tmpdir and touch tmpdir\/a\.txt commands in \/tmp\/scratch/);
  expect(s.options[3].label).toBe("No");
  expect(s.cursor).toBe(0);
  expect(s.canAmend).toBe(true);
  expect(s.amend).toBe(null);
});

test("the amend field open on Yes and on No", () => {
  const yes: any = parseScreen(screen("perm-bash-yes-amend"));
  expect(yes.amend).toBe("yes");
  expect(yes.canAmend).toBe(false);
  const no: any = parseScreen(screen("perm-bash-no-amend"));
  expect(no.amend).toBe("no");
  expect(no.cursor).toBe(3);
  const cur: any = parseScreen(screen("perm-bash-cursor-no"));
  expect(cur.cursor).toBe(3);
  expect(cur.amend).toBe(null);
});

test("Claude Code 2.1.322: the note line, empty and typed in, on Yes and on No", () => {
  const plain: any = parseScreen(screen("perm-write-322"));
  expect([plain.title, plain.question, plain.amend, plain.canAmend]).toEqual(["Create file", "Do you want to create notes.txt?", null, true]);
  const yes: any = parseScreen(screen("perm-write-322-yes-amend"));
  expect([yes.amend, yes.amendText, yes.cursor, yes.canAmend]).toEqual(["yes", "", 0, false]);
  // Typed in: the option reads "Yes, <text>", not the placeholder.
  const typed: any = parseScreen(screen("perm-write-322-yes-typed"));
  expect([typed.amend, typed.amendText]).toEqual(["yes", "hi there"]);
  const no: any = parseScreen(screen("perm-write-322-no-amend"));
  expect([no.amend, no.amendText, no.cursor]).toEqual(["no", "", 2]);
  const noTyped: any = parseScreen(screen("perm-write-322-no-typed"));
  expect([noTyped.amend, noTyped.amendText]).toEqual(["no", "use txt"]);
  // The request is the same one whatever the note line shows.
  const req = describeClaude(screen("perm-write-322"), null);
  for (const f of ["perm-write-322-yes-amend", "perm-write-322-yes-typed", "perm-write-322-no-amend", "perm-write-322-no-typed"]) {
    expect(describeClaude(screen(f), null)?.options.map((o: any) => o.label)).toEqual(req!.options.map((o: any) => o.label));
  }
});

test("Claude's 'Tip: auto mode…' line isn't part of the request", () => {
  const s: any = parseScreen(screen("perm-bash"));
  expect(s.body.join(" ")).not.toMatch(/Tip:/);
  expect(describeClaude(screen("perm-bash"), null)?.line).toBe("Create tmpdir and touch a.txt inside it mkdir -p tmpdir && touch tmpdir/a.txt");
});

test("a Write permission", () => {
  const s: any = parseScreen(screen("perm-write"));
  expect(s.title).toBe("Create file");
  expect(s.question).toBe("Do you want to create notes.md?");
  expect(s.options.map((o: any) => o.label)).toEqual(["Yes", "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)", "No"]);
});

test("a question block: headers, the question, rows with descriptions", () => {
  const s: any = parseScreen(screen("q-multi-1"));
  expect(s.kind).toBe("question");
  expect(s.headers).toEqual([{ header: "Color", done: false }, { header: "Pets", done: false }, { header: "Size", done: false }]);
  expect(s.submit).toBe(true);
  expect(s.question).toBe("Which color?");
  expect(s.rows.map((r: any) => r.label ?? r.kind)).toEqual(["Red", "Green", "Blue", "Type something.", "Chat about this"]);
  expect(s.rows[0].desc).toBe("Choose red");
  expect(s.rows[4].kind).toBe("chat");
  expect(s.cursor).toBe(0);
});

test("multiSelect rows: boxes, typed other text, Next", () => {
  const s: any = parseScreen(screen("q-multi-2-other-checked"));
  expect(s.headers.map((h: any) => h.done)).toEqual([true, true, false]);
  expect(s.rows.map((r: any) => [r.kind, r.label ?? "", r.checked ?? null])).toEqual([
    ["option", "Cats", true], ["option", "Dogs", false], ["option", "Fish", false], ["option", "Birds & Co", true], ["next", "", null], ["chat", "Chat about this", null],
  ]);
  expect(s.cursor).toBe(3);
});

test("a single question has no Submit header", () => {
  const s: any = parseScreen(screen("q-single"));
  expect(s.headers).toEqual([{ header: "Lunch", done: false }]);
  expect(s.submit).toBe(false);
  expect(s.question).toBe("What for lunch?");
});

test("Claude's review of the answers", () => {
  const s: any = parseScreen(screen("q-review"));
  expect(s.kind).toBe("review");
  expect(s.answers).toEqual([
    { question: "Which color?", answer: "Green" },
    { question: "Which pets do you like?", answer: "Cats, Birds & Co" },
    { question: "Which size?", answer: "Large" },
  ]);
  expect(s.options.map((o: any) => o.label)).toEqual(["Submit answers", "Cancel"]);
});

test("no dialog: an idle prompt and the folder-trust screen aren't requests", () => {
  const idle = screen("perm-bash").split("────").slice(0, 1).join("") + "\n❯ \n";
  expect(parseScreen(idle)).toBe(null);
  expect(describeClaude(screen("trust"), null)).toBe(null);
});

// ---- the adapter's item: the hook record when it matches the screen

test("the hook record gives the exact tool and command", () => {
  const d: any = describeClaude(screen("perm-bash"), hook("hook-perm-bash"));
  expect(d.type).toBe("permission");
  expect(d.from).toBe("hook");
  expect(d.tool).toBe("Bash");
  expect(d.line).toBe("mkdir -p tmpdir && touch tmpdir/a.txt");
  expect(d.description).toBe("Create tmpdir and touch a.txt inside it");
  expect(d.options.map((o: any) => o.kind)).toEqual(["yes", "always", "auto", "no"]);
});

test("a stale hook record (another request) is ignored", () => {
  const d: any = describeClaude(screen("perm-bash"), hook("hook-perm-write"));
  expect(d.from).toBe("screen");
  expect(d.tool).toBe("Bash command");
  const q: any = describeClaude(screen("perm-bash"), hook("hook-ask"));
  expect(q.type).toBe("permission");
  expect(describeClaude(screen("q-single"), hook("hook-ask"))).toBe(null); // another block's questions
});

test("the hook record gives every question of the block", () => {
  const d: any = describeClaude(screen("q-multi-1"), hook("hook-ask"));
  expect(d.type).toBe("question");
  expect(d.questions.map((q: any) => [q.header, q.multiSelect, q.options.length])).toEqual([["Color", false, 3], ["Pets", true, 3], ["Size", false, 2]]);
  expect(describeClaude(screen("q-review"), hook("hook-ask"))?.type).toBe("question");
});

test("option kinds", () => {
  expect(optionKind("Yes")).toBe("yes");
  expect(optionKind("Yes, and don't ask again for x commands")).toBe("always");
  expect(optionKind("Yes, and always allow access to /x from this project")).toBe("always");
  expect(optionKind("Yes, and switch to auto mode · auto mode handles these prompts for you")).toBe("auto");
  expect(optionKind("No")).toBe("no");
});

// ---- answering: a model of Claude Code's dialogs, driven only by the steps

const RULE = "─".repeat(80);

/** Claude Code 2.1.322's permission dialog, as captured: Tab opens the note
 *  line on Yes or No and closes it again; typed text shows as "Yes, <text>".
 *  `lag`: renders before a change is drawn (another part of a busy screen
 *  changes first); `dropEnter`: the paste's Enter is lost. */
class FakePermission {
  options: string[]; cursor = 0; amend: "yes" | "no" | null = null; text = ""; result: any = null; log: string[] = [];
  lag = 0; behind = 0; shown = ""; dropEnter = false; tick = 0;
  constructor(options = ["Yes", "Yes, and don't ask again for mkdir -p tmpdir commands in /tmp", "Yes, and switch to auto mode · auto mode handles these prompts for you", "No"]) { this.options = options; }
  draw() {
    if (this.result) return `⏺ Bash(mkdir -p tmpdir && touch tmpdir/a.txt)\n${RULE}\n❯ \n${RULE}\n`;
    const note = this.amend === "yes" ? "Yes, and tell Claude what to do next" : "No, and tell Claude what to do differently";
    const label = (o: string, i: number) => i === this.cursor && this.amend ? (this.text ? `${this.amend === "yes" ? "Yes" : "No"}, ${this.text}` : note) : o;
    return [`⏺ Bash(mkdir -p tmpdir && touch tmpdir/a.txt)`, RULE, " Bash command", " Tip: auto mode handles these prompts for you — choose \"switch to auto mode\" below", " Create tmpdir", "", " mkdir -p tmpdir && touch tmpdir/a.txt", "", " Do you want to proceed?",
      ...this.options.map((o, i) => ` ${i === this.cursor ? "❯" : " "} ${i + 1}. ${label(o, i)}`), "", this.amend ? " Esc to cancel" : " Esc to cancel · Tab to amend"].join("\n");
  }
  render() {
    // A busy screen: its status line ticks, so every read differs.
    if (this.behind > 0) { this.behind--; return `${this.shown}\n ◐ ${this.tick++}`; }
    this.shown = this.draw();
    return `${this.shown}\n ◐ ${this.tick++}`;
  }
  changed() { this.behind = this.lag; }
  keys(ks: string[]) {
    for (const k of ks) {
      this.log.push(k);
      if (k === "down") { this.cursor = Math.min(this.options.length - 1, this.cursor + 1); this.amend = null; this.text = ""; }
      else if (k === "up") { this.cursor = Math.max(0, this.cursor - 1); this.amend = null; this.text = ""; }
      else if (k === "tab") { this.amend = this.amend ? null : this.cursor === 0 ? "yes" : this.options[this.cursor] === "No" ? "no" : null; this.text = ""; }
      else if (k === "enter") this.result = { option: this.cursor + 1, note: this.amend ? this.text : null };
      else if (/^\d$/.test(k) && !this.amend) this.result = { option: Number(k), note: null };
    }
    this.changed();
  }
  /** hc send --force: the text, then Enter. */
  paste(text: string) {
    this.log.push(`paste:${text}`);
    if (this.amend) this.text += text;
    else if (/^\d/.test(text)) this.result = { option: Number(text[0]), note: null }; // typed into the dialog: a digit picks
    if (!this.dropEnter) this.keys(["enter"]); else { this.log.push("enter lost"); this.changed(); }
  }
}

type Q = { header: string; question: string; multiSelect: boolean; options: { label: string; description: string }[] };

class FakeQuestions {
  qs: Q[]; q = 0; cursor = 0; picks: Set<number>[]; single: (number | null)[]; other: string[]; otherOn: boolean[]; review = false; result: any = null; log: string[] = [];
  constructor(qs: Q[]) { this.qs = qs; this.picks = qs.map(() => new Set()); this.single = qs.map(() => null); this.other = qs.map(() => ""); this.otherOn = qs.map(() => false); }
  rowsOf(i: number) { const n = this.qs[i].options.length; return this.qs[i].multiSelect ? n + 3 : n + 2; } // options, other, [next], chat
  answered(i: number) { return this.qs[i].multiSelect ? this.picks[i].size > 0 || this.otherOn[i] : this.single[i] !== null; }
  answer(i: number) {
    const q = this.qs[i];
    if (!q.multiSelect) return this.single[i] === -1 ? this.other[i] : q.options[this.single[i]!]?.label ?? "";
    const w = [...this.picks[i]].sort().map((k) => q.options[k].label);
    if (this.otherOn[i] && this.other[i]) w.push(this.other[i]);
    return w.join(", ");
  }
  render() {
    if (this.result) return `⏺ User answered Claude's questions\n${RULE}\n❯ \n${RULE}\n`;
    const multi = this.qs.length > 1;
    const head = multi ? `←  ${this.qs.map((q, i) => `${this.answered(i) ? "☒" : "☐"} ${q.header}`).join("  ")}  ✔ Submit  →` : ` ☐ ${this.qs[0].header}`;
    if (this.review) {
      return [RULE, head, "", "Review your answers", "", ...this.qs.flatMap((q, i) => [` ● ${q.question}`, `   → ${this.answer(i)}`]), "", "Ready to submit your answers?", "",
        `${this.cursor === 0 ? "❯" : " "} 1. Submit answers`, `${this.cursor === 1 ? "❯" : " "} 2. Cancel`, "", "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"].join("\n").replace("Enter to select · Tab/Arrow keys to navigate · Esc to cancel", " Esc to cancel");
    }
    const q = this.qs[this.q];
    const n = q.options.length;
    const mark = (r: number) => (r === this.cursor ? "❯" : " ");
    const box = (on: boolean) => (q.multiSelect ? `[${on ? "✔" : " "}] ` : "");
    const out = [RULE, head, "", q.question, ""];
    q.options.forEach((o, i) => { out.push(`${mark(i)} ${i + 1}. ${box(this.picks[this.q].has(i))}${o.label}`, `     ${o.description}`); });
    out.push(`${mark(n)} ${n + 1}. ${box(this.otherOn[this.q])}${this.other[this.q] || (q.multiSelect ? "Type something" : "Type something.")}`);
    if (q.multiSelect) out.push(`${mark(n + 1)}    Next`);
    out.push(RULE, `${mark(this.rowsOf(this.q) - 1)} ${n + 2}. Chat about this`, "", "Enter to select · Tab/Arrow keys to navigate · Esc to cancel");
    return out.join("\n");
  }
  go(i: number) { if (i >= this.qs.length) { if (this.qs.length > 1) { this.review = true; this.cursor = 0; } } else { this.review = false; this.q = i; this.cursor = 0; } }
  advance() { if (this.qs.length === 1) this.result = this.qs.map((_, i) => this.answer(i)); else this.go(this.q + 1); }
  keys(ks: string[]) {
    for (const k of ks) {
      this.log.push(k);
      if (this.review) {
        if (k === "down") this.cursor = 1; else if (k === "up") this.cursor = 0;
        else if (k === "enter") { if (this.cursor === 0) this.result = this.qs.map((_, i) => this.answer(i)); else this.result = "cancelled"; }
        else if (k === "shift+tab" || k === "left") this.go(this.qs.length - 1);
        continue;
      }
      const q = this.qs[this.q]; const n = q.options.length;
      if (k === "down") this.cursor = Math.min(this.rowsOf(this.q) - 1, this.cursor + 1);
      else if (k === "up") this.cursor = Math.max(0, this.cursor - 1);
      else if (k === "tab" || k === "right") this.go(this.q + 1);
      else if (k === "shift+tab" || k === "left") this.go(Math.max(0, this.q - 1));
      else if (k === "space" || k === "enter") {
        if (q.multiSelect) {
          if (this.cursor < n) { const s = this.picks[this.q]; s.has(this.cursor) ? s.delete(this.cursor) : s.add(this.cursor); }
          else if (this.cursor === n) { if (k === "space") this.other[this.q] += " "; else this.otherOn[this.q] = !this.otherOn[this.q]; }
          else if (this.cursor === n + 1 && k === "enter") this.advance();
        } else if (k === "enter" && this.cursor < n) { this.single[this.q] = this.cursor; this.advance(); }
        else if (k === "enter" && this.cursor === n && this.other[this.q]) { this.single[this.q] = -1; this.advance(); }
      }
    }
  }
  paste(text: string) {
    this.log.push(`paste:${text}`);
    const q = this.qs[this.q]; const n = q.options.length;
    if (this.review || this.cursor !== n) return;
    this.other[this.q] += text;
    if (q.multiSelect) { this.otherOn[this.q] = true; this.keys(["enter"]); } // typing checks it, the Enter of the paste toggles it back off
    else this.keys(["enter"]);
  }
}

/** Runs the steps against a fake until done or refused; returns the outcome.
 *  After a key it reads the screen until the dialog changes, as drive.js
 *  settled() does (a few reads at most). */
function drive(fake: any, goal: any, limit = 80) {
  const state = {};
  let screen = fake.render();
  for (let i = 0; i < limit; i++) {
    const a: any = step(goal, screen, state);
    if (a.done) return { done: true };
    if (a.refuse) return { refuse: a.refuse };
    const before = screen;
    if (a.keys) fake.keys(a.keys);
    if (a.paste != null) fake.paste(a.paste);
    screen = fake.render();
    for (let r = 0; r < 20 && (a.keys || a.paste != null) && dialog(screen) === dialog(before); r++) screen = fake.render();
  }
  return { stuck: true };
}

const permRequest = (fake: FakePermission) => describeClaude(fake.render(), null);

test("permission: each option sends exactly that option", () => {
  for (const n of [1, 2, 3, 4]) {
    const fake = new FakePermission();
    const request = permRequest(fake);
    expect(drive(fake, { type: "permission", request, option: n })).toEqual({ done: true });
    expect(fake.result).toEqual({ option: n, note: null });
  }
});

test("permission: from a moved cursor it comes back to the chosen option", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  fake.cursor = 3;
  drive(fake, { type: "permission", request, option: 1 });
  expect(fake.result).toEqual({ option: 1, note: null });
  expect(fake.log).toEqual(["up", "up", "up", "enter"]);
});

test("permission: yes, but and no, but open the amend field, then send the note", () => {
  const yes = new FakePermission();
  expect(drive(yes, { type: "permission", request: permRequest(yes), option: 1, amend: "and run the tests after" })).toEqual({ done: true });
  expect(yes.result).toEqual({ option: 1, note: "and run the tests after" });
  expect(yes.log).toEqual(["tab", "paste:and run the tests after", "enter"]);
  const no = new FakePermission();
  drive(no, { type: "permission", request: permRequest(no), option: 4, amend: "use cargo clean\ninstead" });
  expect(no.result).toEqual({ option: 4, note: "use cargo clean instead" });
});

test("permission: a busy screen drawing the note line late gets one Tab, not a second that shuts it", () => {
  for (const lag of [1, 3, 6]) {
    const fake = new FakePermission();
    const request = permRequest(fake);
    fake.lag = lag;
    expect(drive(fake, { type: "permission", request, option: 1, amend: "then run the tests" })).toEqual({ done: true });
    expect(fake.result).toEqual({ option: 1, note: "then run the tests" });
    expect(fake.log.filter((k) => k === "tab")).toEqual(["tab"]);
  }
  const no = new FakePermission();
  const request = permRequest(no);
  no.lag = 4;
  drive(no, { type: "permission", request, option: 4, amend: "use make" });
  expect(no.result).toEqual({ option: 4, note: "use make" });
});

test("permission: a note whose Enter got lost is sent with one Enter", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  fake.dropEnter = true;
  expect(drive(fake, { type: "permission", request, option: 1, amend: "and commit" })).toEqual({ done: true });
  expect(fake.result).toEqual({ option: 1, note: "and commit" });
  expect(fake.log.filter((k) => k === "enter")).toEqual(["enter"]);
});

test("permission: when the note line never opens, nothing is typed and the center says why", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  fake.keys = function (ks: string[]) { for (const k of ks) this.log.push(k); }; // keys don't arrive
  const state: any = {};
  const goal = { type: "permission", request, option: 1, amend: "x" };
  let a: any;
  for (let i = 0; i < 20; i++) { a = step(goal, fake.render(), state); if (a.keys) fake.keys(a.keys); if (!a.wait && !a.keys) break; }
  expect(a.wait).toBe(true);
  expect(a.reason).toMatch(/note line didn't open/);
  expect(fake.log).toEqual(["tab"]);
  expect(fake.result).toBe(null);
});

test("stale: a note typed in the terminal (\"Yes, …\") isn't overridden", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  fake.keys(["tab"]); fake.text = "mine"; fake.log = [];
  expect(drive(fake, { type: "permission", request, option: 1, amend: "x" }).refuse).toMatch(/typing/);
  expect(drive(fake, { type: "permission", request, option: 1 }).refuse).toMatch(/typing/);
  expect(fake.log).toEqual([]);
});

test("permission: a note on 'don't ask again' is refused, not sent elsewhere", () => {
  const fake = new FakePermission();
  const r = drive(fake, { type: "permission", request: permRequest(fake), option: 2, amend: "x" });
  expect(r.refuse).toBeTruthy();
  expect(fake.result).toBe(null);
});

test("stale: a changed or vanished permission is refused before any key", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  const changed = new FakePermission(["Yes", "Yes, and always allow access to /x from this project", "No"]);
  expect(drive(changed, { type: "permission", request, option: 2 }).refuse).toMatch(/changed/);
  expect(changed.log).toEqual([]);
  fake.result = { option: 4, note: null }; // answered in the terminal meanwhile
  const gone = drive(fake, { type: "permission", request, option: 1 });
  expect(gone.refuse).toMatch(/gone/);
  expect(fake.log).toEqual([]);
});

test("stale: someone typing in the amend field isn't overridden", () => {
  const fake = new FakePermission();
  const request = permRequest(fake);
  fake.keys(["tab"]); fake.log = [];
  expect(drive(fake, { type: "permission", request, option: 4 }).refuse).toMatch(/typing/);
  expect(fake.log).toEqual([]);
});

const BLOCK: Q[] = hook("hook-ask").payload.tool_input.questions;
const qRequest = (fake: FakeQuestions) => describeClaude(fake.render(), { at: 0, payload: { tool_name: "AskUserQuestion", tool_input: { questions: fake.qs } } });

test("questions: single, multiSelect with other text, single — submitted only after the review matches", () => {
  const fake = new FakeQuestions(BLOCK);
  const request = qRequest(fake);
  expect(request?.type).toBe("question");
  const answers = [{ picked: [1], other: null }, { picked: [0, 2], other: "Birds & Co" }, { picked: [1], other: null }];
  expect(drive(fake, { type: "question", request, answers })).toEqual({ done: true });
  expect(fake.result).toEqual(["Green", "Cats, Fish, Birds & Co", "Large"]);
});

test("questions: other text in a single-select question", () => {
  const fake = new FakeQuestions(BLOCK);
  const answers = [{ picked: [], other: "Teal" }, { picked: [1], other: null }, { picked: [0], other: null }];
  drive(fake, { type: "question", request: qRequest(fake), answers });
  expect(fake.result).toEqual(["Teal", "Dogs", "Small"]);
});

test("questions: one question submits on its own Enter", () => {
  const one = hook("hook-ask-single").payload.tool_input.questions;
  const fake = new FakeQuestions(one);
  drive(fake, { type: "question", request: qRequest(fake), answers: [{ picked: [1], other: null }] });
  expect(fake.result).toEqual(["Salad"]);
});

test("questions: boxes already ticked in the terminal are put right", () => {
  const fake = new FakeQuestions(BLOCK);
  const request = qRequest(fake);
  fake.picks[1].add(1); // Dogs ticked by hand
  drive(fake, { type: "question", request, answers: [{ picked: [0], other: null }, { picked: [2], other: null }, { picked: [0], other: null }] });
  expect(fake.result).toEqual(["Red", "Fish", "Small"]);
});

test("questions: started from the review or a later question, it goes back first", () => {
  const fake = new FakeQuestions(BLOCK);
  const request = qRequest(fake);
  fake.go(2);
  drive(fake, { type: "question", request, answers: [{ picked: [2], other: null }, { picked: [1], other: null }, { picked: [1], other: null }] });
  expect(fake.result).toEqual(["Blue", "Dogs", "Large"]);
});

test("questions: a review that differs is never submitted", () => {
  const fake = new FakeQuestions(BLOCK);
  const request = qRequest(fake);
  // A terminal that drops the typed text: the review won't say what was asked for.
  fake.paste = function (text: string) { this.log.push(`paste:${text}`); this.keys(["enter"]); };
  const r = drive(fake, { type: "question", request, answers: [{ picked: [0], other: null }, { picked: [], other: "Owls" }, { picked: [0], other: null }] });
  expect(r.refuse).toMatch(/nothing was submitted/);
  expect(fake.result).toBe(null);
});

test("questions: a different block on screen is refused", () => {
  const fake = new FakeQuestions(BLOCK);
  const request = qRequest(fake);
  const other = new FakeQuestions(hook("hook-ask-single").payload.tool_input.questions);
  expect(drive(other, { type: "question", request, answers: [{ picked: [0], other: null }, { picked: [0], other: null }, { picked: [0], other: null }] }).refuse).toBeTruthy();
  expect(other.log).toEqual([]);
});

test("review text: picked labels in option order, then the typed answer", () => {
  expect(reviewText(BLOCK[1], { picked: [2, 0], other: "Birds" })).toBe("Cats, Fish, Birds");
  expect(reviewText(BLOCK[0], { picked: [], other: "Teal" })).toBe("Teal");
});

// ---- the question dialog's keys

import { start, press, setOther, answers, isReview } from "../defaults/mods/nocturne-notifications/ask.js";
import { collect, group, counts, tail, headline, adapterOf, splitAddress, age } from "../defaults/mods/nocturne-notifications/model.js";

const keys = (qs: any, s: any, ...ks: string[]) => {
  let action: any = null;
  for (const k of ks) {
    const [key, mod] = k.split("+").reverse();
    ({ state: s, action } = press(qs, s, key, { shift: mod === "shift" }));
  }
  return { s, action };
};

test("dialog: j/k and arrows move, wrapping; enter picks a single-select answer and goes on", () => {
  let s = start(BLOCK);
  ({ s } = keys(BLOCK, s, "j", "down", "k"));
  expect(s.cursor[0]).toBe(1);
  ({ s } = keys(BLOCK, s, "up", "up"));
  expect(s.cursor[0]).toBe(3); // wrapped onto "other"
  ({ s } = keys(BLOCK, s, "down", "down", "enter"));
  expect(answers(BLOCK, s)[0]).toEqual({ picked: [1], other: null });
  expect(s.q).toBe(1);
});

test("dialog: space toggles in a multiSelect, enter too; tab and shift-tab move between questions", () => {
  let s = start(BLOCK);
  ({ s } = keys(BLOCK, s, "tab", "space", "down", "down", "enter", "space"));
  expect(s.q).toBe(1);
  expect(answers(BLOCK, s)[1]).toEqual({ picked: [0], other: null }); // Cats on (space); Fish on (enter), off again (space)
  ({ s } = keys(BLOCK, s, "shift+tab"));
  expect(s.q).toBe(0);
  ({ s } = keys(BLOCK, s, "tab", "tab", "tab"));
  expect(isReview(BLOCK, s)).toBe(true);
});

test("dialog: other text, typed in the input, picks and goes on (single) or ticks (multi)", () => {
  let s = start(BLOCK);
  let a: any;
  ({ s, action: a } = keys(BLOCK, s, "up", "enter"));
  expect(a).toBe("edit");
  expect(s.editing).toBe(true);
  ({ s, action: a } = keys(BLOCK, s, "j"));
  expect(s.cursor[0]).toBe(3); // the input has the keys
  s = setOther(BLOCK, s, "Teal");
  expect(s.q).toBe(1);
  expect(answers(BLOCK, s)[0]).toEqual({ picked: [], other: "Teal" });
  ({ s } = keys(BLOCK, s, "space", "up", "enter"));
  s = setOther(BLOCK, s, "Birds & Co");
  expect(s.q).toBe(1);
  expect(answers(BLOCK, s)[1]).toEqual({ picked: [0], other: "Birds & Co" });
  ({ s } = keys(BLOCK, s, "space"));
  expect(answers(BLOCK, s)[1]).toEqual({ picked: [0], other: null }); // space on a typed answer unticks it
});

test("dialog: the review submits only with every question answered", () => {
  let s = start(BLOCK);
  let a: any;
  ({ s } = keys(BLOCK, s, "enter", "tab", "tab"));
  expect(isReview(BLOCK, s)).toBe(true);
  ({ s, action: a } = keys(BLOCK, s, "enter"));
  expect(a).toBe(null);
  expect(s.q).toBe(1); // back to the first unanswered
  ({ s } = keys(BLOCK, s, "space", "tab", "2"));
  expect(isReview(BLOCK, s)).toBe(true);
  ({ s, action: a } = keys(BLOCK, s, "enter"));
  expect(a).toBe("submit");
  expect(answers(BLOCK, s)).toEqual([{ picked: [0], other: null }, { picked: [0], other: null }, { picked: [1], other: null }]);
});

test("dialog: esc stops typing first, then closes", () => {
  let s = start(BLOCK);
  let a: any;
  ({ s } = keys(BLOCK, s, "up", "enter"));
  ({ s, action: a } = keys(BLOCK, s, "escape"));
  expect(a).toBe(null);
  expect(s.editing).toBe(false);
  ({ action: a } = keys(BLOCK, s, "escape"));
  expect(a).toBe("close");
});

// ---- items: sources, types, grouping

const T = (address: string, report: any, extra: any = {}) => ({ address, labels: { "herdr.space": "s1" }, state: "live", status: report?.state ?? null, report, status_ms: 1000, program: { key: "claude", name: "Claude Code" }, ...extra });
const AG = (address: string, space_name: string, tab_name: string) => ({ address, space: "s1", space_name, tab: "c1", tab_name, tab_index: 1, app: "claude-code", program: { name: "Claude Code" } });

test("items: finished agents alone make no items", () => {
  const items = collect({ terminals: [T("t1", { app: "claude-code", state: "done" }), T("t2", { app: "pi", state: "done" })] });
  expect(items).toEqual([]);
  expect(counts(items)).toEqual({ permission: 0, question: 0, other: 0, needs: 0 });
});

test("items: types from the adapter, else from herdr-core's kind; grouped and counted", () => {
  const terminals = [
    T("t1", { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Bash: mkdir" }),
    T("t2", { app: "claude-code", state: "blocked", kind: "question", msg: "answer: Which color?" }),
    T("vps/t3", { app: "codex", state: "blocked", kind: "permission", msg: "approve: rm" }, { program: { key: "codex", name: "Codex" } }),
    T("t4", { app: "pi", state: "done" }, { program: { key: "pi", name: "pi" } }),
    T("t5", { app: "claude-code", state: "error", msg: "API overloaded" }),
    T("t6", { app: "claude-code", state: "working" }),
    T("t7", { app: "claude-code", state: "blocked", kind: "other", msg: "trust this folder?" }),
  ];
  const info = { t1: { screen: screen("perm-bash"), record: hook("hook-perm-bash") }, t2: { screen: screen("q-multi-1"), record: hook("hook-ask") } };
  const items = collect({ terminals, agents: [AG("t1", "fireflies", "fix login")], info });
  const g = group(items);
  expect(g.permission.map((i: any) => i.address)).toEqual(["t1", "vps/t3"]);
  expect(g.question.map((i: any) => i.address)).toEqual(["t2"]);
  // A finished agent (t4) isn't an item: the sidebar and Fireflies' toast tell about it.
  expect(g.other.map((i: any) => [i.address, i.status])).toEqual([["t5", "error"], ["t7", "blocked"]]);
  expect(counts(items)).toEqual({ permission: 2, question: 1, other: 2, needs: 3 });
  const t1 = g.permission[0];
  expect([t1.spaceName, t1.tabName, t1.answerable, t1.request.line]).toEqual(["fireflies", "fix login", true, "mkdir -p tmpdir && touch tmpdir/a.txt"]);
  expect(headline(t1)).toBe("wants to run a command");
  expect(g.permission[1].answerable).toBe(false); // codex: generic, peek and go to
  expect(g.permission[1].machine).toBe("vps");
  expect(headline(g.question[0])).toBe("asks 3 questions");
});

test("items: a sub-agent goes by its parent's place; errors put away go", () => {
  const terminals = [T("t1", { app: "claude-code", state: "working" }), T("t9", { app: "claude-code", state: "error", msg: "API overloaded" }, { parent: "t1" })];
  const items = collect({ terminals, agents: [AG("t1", "fireflies", "fix login")] });
  expect(items[0].spaceName).toBe("fireflies");
  expect(collect({ terminals, agents: [], dismissed: { [items[0].id]: true } })).toEqual([]);
});

test("adapters: Claude Code by its report, anything else generic", () => {
  expect(adapterOf({ report: { app: "claude-code" } }).id).toBe("claude");
  expect(adapterOf({ report: { app: "codex" } }).id).toBe("generic");
  expect(splitAddress("vps/t3")).toEqual({ machine: "vps", id: "t3" });
  expect(age(0)).toBe("");
  expect(age(1000, 1000 + 125_000)).toBe("2m");
});

test("generic view: the screen's last lines, without rules or trailing blanks", () => {
  const t = tail(screen("perm-bash"), 6);
  expect(t.split("\n").pop()).toMatch(/Esc to cancel/);
  expect(t).not.toMatch(/╌{8}/);
});

test("a hook-made request answers its own screen and refuses another", () => {
  const request: any = describeClaude(screen("perm-bash"), hook("hook-perm-bash"));
  expect(step({ type: "permission", request, option: 1 }, screen("perm-bash"), {})).toEqual({ keys: ["enter"] });
  expect(step({ type: "permission", request, option: 4 }, screen("perm-bash"), {})).toEqual({ keys: ["down", "down", "down"] });
  expect((step({ type: "permission", request, option: 1 }, screen("perm-write"), {}) as any).refuse).toMatch(/changed/);
  const q: any = describeClaude(screen("q-multi-1"), hook("hook-ask"));
  expect((step({ type: "question", request: q, answers: [] }, screen("perm-bash"), {}) as any).refuse).toMatch(/gone/);
});
