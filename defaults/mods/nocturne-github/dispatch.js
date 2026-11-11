// Running a workflow by hand (workflow_dispatch), as plain functions: no
// herdr imports, so scripts/ tests them. dispatchForm.js draws the form and
// talks to gh; this reads a workflow file's `on:` (a small YAML reader: block
// maps and lists, flow lists and maps, quoted and block scalars, comments),
// turns its inputs into form fields, checks the answers, builds
// `gh workflow run` and finds the run it started.

// ---- a small YAML reader (what workflow files use)

/** Splits a line at its comment (a # after a space, outside quotes). */
function uncomment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q && (q === "'" || line[i - 1] !== "\\")) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s:[{,-]/.test(line[i - 1])) q = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, "");
  }
  return line.replace(/\s+$/, "");
}

/** A plain or quoted scalar as YAML 1.2's core schema reads it. */
export function scalar(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\(["\\/nt])/g, (_m, c) => ({ n: "\n", t: "\t" })[c] ?? c);
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^(null|Null|NULL|~)$/.test(s)) return null;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** A flow list or map (`[a, b]`, `{ a: 1 }`), one level of nesting deep enough for workflows. */
function flow(s) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const value = () => {
    ws();
    if (s[i] === "[") {
      i++; const out = [];
      for (;;) { ws(); if (s[i] === "]" || i >= s.length) { i++; return out; } out.push(value()); ws(); if (s[i] === ",") i++; }
    }
    if (s[i] === "{") {
      i++; const out = {};
      for (;;) {
        ws(); if (s[i] === "}" || i >= s.length) { i++; return out; }
        const k = atom(":,}"); ws();
        let v = null;
        if (s[i] === ":") { i++; v = value(); }
        out[String(k)] = v; ws(); if (s[i] === ",") i++;
      }
    }
    return atom(",]}");
  };
  const atom = (stops) => {
    ws();
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]; let j = i + 1;
      while (j < s.length && !(s[j] === q && (q === "'" ? s[j + 1] !== "'" : s[j - 1] !== "\\"))) j += q === "'" && s[j] === "'" ? 2 : 1;
      const raw = s.slice(i, j + 1); i = j + 1; return scalar(raw);
    }
    let j = i;
    while (j < s.length && !stops.includes(s[j])) j++;
    const raw = s.slice(i, j); i = j; return scalar(raw);
  };
  return value();
}

/** Reads YAML text (the subset workflow files use) into plain values. Never throws: what it can't read is null. */
export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text ?? "").replace(/\t/g, "  ").split(/\r?\n/)) {
    if (/^\s*(---|\.\.\.)\s*$/.test(raw)) continue;
    lines.push({ raw, pad: raw.length - raw.trimStart().length, text: uncomment(raw).trim() });
  }
  let at = 0;
  const skip = () => { while (at < lines.length && !lines[at].text) at++; };

  // A block scalar's lines (| keeps newlines, > folds them), from the next line deeper than `pad`.
  const block = (style, pad) => {
    const out = [];
    let indent = null;
    while (at < lines.length) {
      const l = lines[at];
      if (l.raw.trim() && l.pad <= pad) break;
      if (l.raw.trim()) indent ??= l.pad;
      out.push(l.raw.trim() ? l.raw.slice(indent ?? 0) : "");
      at++;
    }
    while (out.length && !out[out.length - 1]) out.pop();
    const keep = style.includes("+"), strip = style.includes("-");
    const body = style.startsWith(">") ? out.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ") : out.join("\n");
    return strip ? body : body + (keep ? "\n" : body ? "\n" : "");
  };

  // The value after `key:` or `- ` on the same line, or the block under it.
  const after = (rest, pad) => {
    const r = rest.trim();
    if (/^[|>][-+0-9]*$/.test(r)) { at++; return block(r, pad); }
    at++;
    if (r) return r.startsWith("[") || r.startsWith("{") ? flow(r) : scalar(r);
    skip();
    if (at < lines.length && (lines[at].pad > pad || (lines[at].pad === pad && lines[at].text.startsWith("- ")))) return node(lines[at].pad);
    return null;
  };

  const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#][^:]*?)\s*:(?:\s+(.*)|$)/;

  const node = (pad) => {
    skip();
    if (at >= lines.length) return null;
    const first = lines[at];
    if (first.text === "-" || first.text.startsWith("- ")) {
      const out = [];
      while (at < lines.length) {
        skip();
        const l = lines[at];
        if (!l || l.pad !== pad || !(l.text === "-" || l.text.startsWith("- "))) break;
        const rest = l.text.slice(1).trimStart();
        const m = KEY.exec(rest);
        if (m && !rest.startsWith("[") && !rest.startsWith("{")) {
          // `- key: v` starts a map whose keys sit where `key` does.
          const inner = pad + (l.text.length - rest.length);
          lines[at] = { ...l, pad: inner, text: rest };
          out.push(map(inner));
        } else {
          out.push(after(rest, pad));
        }
      }
      return out;
    }
    if (KEY.test(first.text)) return map(pad);
    at++;
    return first.text.startsWith("[") || first.text.startsWith("{") ? flow(first.text) : scalar(first.text);
  };

  const map = (pad) => {
    const out = {};
    while (at < lines.length) {
      skip();
      const l = lines[at];
      if (!l || l.pad !== pad) break;
      const m = KEY.exec(l.text);
      if (!m) { at++; continue; }
      out[String(scalar(m[1]) ?? m[1])] = after(m[2] ?? "", pad);
    }
    return out;
  };

  try {
    skip();
    return at < lines.length ? node(lines[at].pad) : null;
  } catch {
    return null;
  }
}

// ---- workflow_dispatch

/** A workflow file's `on:` as GitHub reads it: a word, a list of words, or a map (YAML 1.1 reads a bare `on` key as true). */
function triggers(doc) {
  if (!doc || typeof doc !== "object") return null;
  return doc.on ?? doc.true ?? doc['"on"'] ?? null;
}

/** Whether a workflow file can be run by hand, and its inputs: { inputs: [...] }, or null when it has no workflow_dispatch. */
export function dispatchOf(yaml) {
  const on = triggers(parseYaml(yaml));
  if (on === "workflow_dispatch") return { inputs: [] };
  if (Array.isArray(on)) return on.includes("workflow_dispatch") ? { inputs: [] } : null;
  if (!on || typeof on !== "object" || !("workflow_dispatch" in on)) return null;
  const raw = on.workflow_dispatch?.inputs;
  const inputs = [];
  if (raw && typeof raw === "object") {
    for (const [name, spec] of Object.entries(raw)) {
      const s = spec && typeof spec === "object" ? spec : {};
      const type = ["string", "choice", "boolean", "number", "environment"].includes(s.type) ? s.type : "string";
      const options = type === "choice" && Array.isArray(s.options) ? s.options.map((o) => String(o)) : [];
      inputs.push({
        name, type, options,
        description: s.description != null ? String(s.description).trim() : "",
        required: s.required === true || s.required === "true",
        default: s.default ?? null,
      });
    }
  }
  return { inputs };
}

/** An input's starting answer: its default, else what GitHub's form starts with (a choice's first option, off, empty). */
export function startValue(input) {
  const d = input.default;
  if (input.type === "boolean") return d === true || d === "true";
  if (input.type === "choice") return d != null && input.options.includes(String(d)) ? String(d) : input.options[0] ?? "";
  return d == null ? "" : String(d);
}

/** What's wrong with an answer, or "" (required ones filled, numbers numeric, choices among the options). */
export function inputError(input, value, envs = null) {
  const v = typeof value === "string" ? value.trim() : value;
  if (input.type === "boolean") return "";
  if (input.required && (v === "" || v == null)) return "Required.";
  if (v === "" || v == null) return "";
  if (input.type === "number" && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return "A number.";
  if (input.type === "choice" && !input.options.includes(v)) return `One of: ${input.options.join(", ")}.`;
  if (input.type === "environment" && envs && envs.length && !envs.includes(v)) return `An environment of the repo: ${envs.join(", ")}.`;
  return "";
}

/** The file name gh's workflow run takes (`.github/workflows/ci.yml` -> `ci.yml`). */
export const workflowFile = (path) => String(path ?? "").split("/").pop();

/** `gh workflow run` argv (without -R): the workflow, the ref, every input as -f name=value. */
export function dispatchArgs(workflow, ref, inputs, values) {
  const args = ["workflow", "run", workflowFile(workflow.path) || String(workflow.id), "--ref", ref];
  for (const i of inputs) {
    const v = values[i.name];
    args.push("-f", `${i.name}=${i.type === "boolean" ? (v ? "true" : "false") : String(v ?? "").trim()}`);
  }
  return args;
}

/** The run a dispatch started: the newest workflow_dispatch run of that
 *  workflow on that ref made since `since` (ms, a little slack for clocks)
 *  that wasn't there before (`known`: ids), or null. */
export function newRun(runs, { ref, since, known = [] }) {
  const seen = new Set(known);
  const fresh = (runs ?? []).filter((r) => r && !seen.has(r.id) && (r.event ?? "workflow_dispatch") === "workflow_dispatch"
    && (!ref || r.head_branch === ref) && Date.parse(r.created_at ?? r.run_started_at ?? 0) >= since - 15000);
  fresh.sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0));
  return fresh[0] ?? null;
}

// ---- shared with the pull request form

/** One argv as a shell line a person can read and paste. */
export function shellLine(cmd, args) {
  const q = (a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`);
  return [cmd, ...args].map(q).join(" ");
}
