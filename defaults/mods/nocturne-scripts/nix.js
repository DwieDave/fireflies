// Nix flakes for the script runner. A folder with flake.nix gets
// `nix flake check` and `nix flake update` at once (detect.js); its outputs
// come from `nix flake show --json` (FLAKE_SHOW), which the deck runs in the
// background and caches, so the picker never waits on an evaluation:
//
//   flake.nix     packages (nix build .#x), apps (nix run .#x), devShells
//                 (nix develop .#x), checks (nix build .#checks.<system>.x)
//   nix-darwin    darwinConfigurations (on a Mac): build, switch
//   nixos         nixosConfigurations (on Linux): build, switch
//   home-manager  homeConfigurations: build, switch
//
// This machine's configuration (its LocalHostName / hostname; user@host or
// user for home-manager) comes first, marked. A switch that needs root is
// `admin`: on a Mac it goes through the system's password / Touch ID dialog
// (adminLine: osascript "do shell script … with administrator privileges"),
// elsewhere through sudo in its terminal. Builds stay unprivileged.
//
// Both shapes of `nix flake show --json` are read: the classic one
// ({ packages: { <system>: { x: { type } } } }) and the inventory one newer
// Nix prints ({ inventory: { packages: { output: { children } } }, version: 2 }).

export const FLAKE_SHOW = ["flake", "show", "--json", "--no-write-lock-file"];

/** A dialog the person cancels makes the run exit with this; it reads "cancelled". */
export const CANCELLED = 130;

/** Shell-quotes one word: 'it''s' style, so nothing in it is ever code. */
export const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : sq(s));

/** Nix's system name for `uname -s` / `uname -m`: aarch64-darwin, x86_64-linux, … */
export function nixSystem(os, arch) {
  const cpu = { arm64: "aarch64", aarch64: "aarch64", x86_64: "x86_64", amd64: "x86_64", i686: "i686", armv7l: "armv7l", riscv64: "riscv64" }[String(arch ?? "").toLowerCase()];
  const kernel = { darwin: "darwin", linux: "linux" }[String(os ?? "").toLowerCase()];
  return cpu && kernel ? `${cpu}-${kernel}` : null;
}

/** The flake's outputs as plain trees: { output: { name: subtree | LEAF } }. */
export function flakeOutputs(json) {
  const leaf = (what) => ({ leaf: true, what: what ?? null });
  const map = (o, f) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));
  if (json?.inventory && typeof json.inventory === "object") {
    const conv = (node) => (node && typeof node === "object" && node.children && typeof node.children === "object" ? map(node.children, conv) : leaf(node?.what));
    return map(json.inventory, (o) => (o?.output ? conv(o.output) : {}));
  }
  const conv = (node) => (node && typeof node === "object" && typeof node.type === "string" ? leaf(node.type) : node && typeof node === "object" ? map(node, conv) : leaf(null));
  return map(json ?? {}, conv);
}

const names = (tree) => Object.keys(tree ?? {}).filter((k) => tree[k]?.leaf);
const ref = (attr) => q(`.#${attr}`);

/** The flake's scripts (see the top). `sys`: { host, user, os, arch } from the probe. */
export function nixScripts(json, sys = {}) {
  const out = flakeOutputs(json);
  const system = nixSystem(sys.os, sys.arch);
  const mac = String(sys.os ?? "").toLowerCase() === "darwin";
  const linux = String(sys.os ?? "").toLowerCase() === "linux";
  const g = "flake.nix", r = "nix";
  const list = [];
  const per = (o) => (system ? out[o]?.[system] : null) ?? {};
  for (const n of names(per("packages"))) list.push({ group: g, name: n === "default" ? "build" : `build ${n}`, cmd: n === "default" ? "nix build" : `nix build ${ref(n)}` });
  for (const n of names(per("apps"))) list.push({ group: g, name: n === "default" ? "run" : `run ${n}`, cmd: n === "default" ? "nix run" : `nix run ${ref(n)}` });
  for (const n of names(per("devShells"))) list.push({ group: g, name: n === "default" ? "develop" : `develop ${n}`, cmd: n === "default" ? "nix develop" : `nix develop ${ref(n)}` });
  for (const n of names(per("checks"))) list.push({ group: g, name: `check ${n}`, cmd: `nix build ${ref(`checks.${system}.${n}`)}` });

  const here = (n, home) => Boolean(sys.host) && (home ? n === `${sys.user}@${sys.host}` || n === sys.user : n === sys.host);
  const systems = (output, group, tool, admin, home) => {
    const all = names(out[output]).sort((a, b) => Number(here(b, home)) - Number(here(a, home)));
    for (const n of all) {
      const mine = here(n, home);
      list.push({ group, name: `switch ${n}`, cmd: `${tool} switch --flake ${ref(n)}`, ...(admin ? { admin } : {}), ...(mine ? { here: true } : {}) });
      list.push({ group, name: `build ${n}`, cmd: `${tool} build --flake ${ref(n)}`, ...(mine ? { here: true } : {}) });
    }
  };
  if (mac) systems("darwinConfigurations", "nix-darwin", "darwin-rebuild", "osascript", false);
  if (linux) systems("nixosConfigurations", "nixos", "nixos-rebuild", "sudo", false);
  systems("homeConfigurations", "home-manager", "home-manager", null, true);
  return list.map((s) => ({ runner: r, ...s, id: `${s.group}\u0000${s.name}` }));
}

/** What every flake can do, before (or without) an evaluation. */
export function nixStatic() {
  return [
    { runner: "nix", group: "flake.nix", name: "flake check", cmd: "nix flake check" },
    { runner: "nix", group: "flake.nix", name: "flake update", cmd: "nix flake update" },
  ].map((s) => ({ ...s, id: `${s.group}\u0000${s.name}` }));
}

// The AppleScript: the command, PATH, folder and log file come in as argv,
// never spliced into the script, and each goes to the root shell through
// `quoted form of`; the command itself is already a shell line we built.
// The root shell appends everything to the log and writes the exit code
// beside it, so `do shell script` itself only fails when the dialog does.
export const ADMIN_SCRIPT = [
  "on run argv",
  'do shell script "export PATH=" & quoted form of (item 2 of argv) & "; cd " & quoted form of (item 3 of argv) & " && { " & (item 1 of argv) & " ; } >> " & quoted form of (item 4 of argv) & " 2>&1; echo $? > " & quoted form of ((item 4 of argv) & ".code") with administrator privileges',
  "end run",
];

/** The shell line that runs `cmd` as root through the macOS password dialog:
 *  the run's terminal tails the log, so output streams; it exits with the
 *  command's own code, or CANCELLED when the person cancels the dialog. */
export function adminLine(cmd) {
  const script = ADMIN_SCRIPT.map((l) => `-e ${sq(l)}`).join(" ");
  return [
    `C=${sq(cmd)}`,
    `L=$(mktemp "\${TMPDIR:-/tmp}/nocturne-admin.XXXXXX") || exit 1`,
    `echo "asking for an administrator's password to run: $C"`,
    `tail -n +1 -f "$L" & T=$!`,
    `osascript ${script} "$C" "$PATH" "$PWD" "$L" 2>"$L.err"`,
    `R=$?`,
    `sleep 0.3; kill $T 2>/dev/null`,
    `if [ $R -ne 0 ]; then if grep -q -- "-128" "$L.err"; then echo "cancelled: no password given"; rm -f "$L" "$L.err"; exit ${CANCELLED}; fi; cat "$L.err" >&2; rm -f "$L" "$L.err"; exit $R; fi`,
    `R=$(cat "$L.code" 2>/dev/null || echo 1)`,
    `rm -f "$L" "$L.code" "$L.err"`,
    `exit $R`,
  ].join("; ");
}

/** The line a script runs as: its command, or wrapped to get root. */
export function shellLine(cmd, admin) {
  if (admin === "osascript") return adminLine(cmd);
  if (admin === "sudo") return `sudo ${cmd}`;
  return cmd;
}
