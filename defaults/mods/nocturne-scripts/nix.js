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

/** A script's id: its group and name. It goes on its terminal as a label, so
 *  it's plain text; ids from before kept a NUL between them (oldId). */
export const scriptId = (group, name) => `${group}#${name}`;
export const oldId = (id) => String(id).replace(/\u0000/g, "#");

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
      // A switch builds as the person first, then only activates with root (switchPlan).
      list.push({ group, name: `switch ${n}`, cmd: `${tool} switch --flake ${ref(n)}`, ...(admin ? { admin, plan: `${tool}:${n}` } : {}), ...(mine ? { here: true } : {}) });
      list.push({ group, name: `build ${n}`, cmd: `${tool} build --flake ${ref(n)}`, ...(mine ? { here: true } : {}) });
    }
  };
  if (mac) systems("darwinConfigurations", "nix-darwin", "darwin-rebuild", "osascript", false);
  if (linux) systems("nixosConfigurations", "nixos", "nixos-rebuild", "sudo", false);
  systems("homeConfigurations", "home-manager", "home-manager", null, true);
  return list.map((s) => ({ runner: r, ...s, id: scriptId(s.group, s.name) }));
}

/** What every flake can do, before (or without) an evaluation. */
export function nixStatic() {
  return [
    { runner: "nix", group: "flake.nix", name: "flake check", cmd: "nix flake check" },
    { runner: "nix", group: "flake.nix", name: "flake update", cmd: "nix flake update" },
  ].map((s) => ({ ...s, id: scriptId(s.group, s.name) }));
}

// The AppleScript: the command, PATH, folder and log file, then the store
// path and the user (ARG, ARGUSER) come in as argv, never spliced into the
// script; each value reaches the root shell through `quoted form of`, and the
// command itself is a fixed shell line we wrote (it reads "$ARG").
// The root shell appends everything to the log and writes the exit code
// beside it, so `do shell script` itself only fails when the dialog does.
export const ADMIN_SCRIPT = [
  "on run argv",
  'do shell script "export PATH=" & quoted form of (item 2 of argv) & " ARG=" & quoted form of (item 5 of argv) & " ARGUSER=" & quoted form of (item 6 of argv) & "; cd " & quoted form of (item 3 of argv) & " && { " & (item 1 of argv) & " ; } >> " & quoted form of (item 4 of argv) & " 2>&1; echo $? > " & quoted form of ((item 4 of argv) & ".code") with administrator privileges',
  "end run",
];

/** The shell line that runs `cmd` as root through the macOS password dialog,
 *  with $ARG (a store path the line built before) and $ARGUSER (who asked)
 *  set for it: the run's terminal tails the log, so output streams; it exits
 *  with the command's own code, or CANCELLED when the dialog is cancelled. */
export function adminLine(cmd, what = cmd) {
  const script = ADMIN_SCRIPT.map((l) => `-e ${sq(l)}`).join(" ");
  return [
    `C=${sq(cmd)}`,
    `L=$(mktemp "\${TMPDIR:-/tmp}/nocturne-admin.XXXXXX") || exit 1`,
    `echo ${sq(`asking for an administrator's password to ${what}`)}`,
    `tail -n +1 -f "$L" & T=$!`,
    `osascript ${script} "$C" "$PATH" "$PWD" "$L" "\${ARG:-}" "$(id -un)" 2>"$L.err"`,
    `R=$?`,
    `sleep 0.3; kill $T 2>/dev/null`,
    `if [ $R -ne 0 ]; then if grep -q -- "-128" "$L.err"; then echo "cancelled: no password given"; rm -f "$L" "$L.err"; exit ${CANCELLED}; fi; cat "$L.err" >&2; rm -f "$L" "$L.err"; exit $R; fi`,
    `R=$(cat "$L.code" 2>/dev/null || echo 1)`,
    `rm -f "$L" "$L.code" "$L.err"`,
    `exit $R`,
  ].join("; ");
}

const NIX = `nix --extra-experimental-features ${sq("nix-command flakes")}`;
const PROFILE = "/nix/var/nix/profiles/system";

/** What root does with a built nix-darwin system, as darwin-rebuild switch
 *  does after its build: point the system profile at it, run the legacy
 *  activate-user as the person (unless it says it's deprecated), activate. */
export const DARWIN_ACTIVATE = `nix-env -p ${PROFILE} --set "$ARG" && if [ -x "$ARG/activate-user" ] && ! grep -q '^# nix-darwin: deprecated$' "$ARG/activate-user"; then sudo --user="$ARGUSER" --set-home -- "$ARG/activate-user"; fi && "$ARG/activate"`;

/** The same for NixOS, as nixos-rebuild switch does: the profile, then switch-to-configuration. */
export const NIXOS_ACTIVATE = `nix-env -p ${PROFILE} --set "$1" && "$1/bin/switch-to-configuration" switch`;

/** One attribute name in a nix attribute path: bare when plain, else in
 *  double quotes ("my.host" stays one name, not two). */
export const attrName = (n) => (/^[A-Za-z_][\w'-]*$/.test(n) ? n : `"${String(n).replace(/["\\$]/g, "\\$&")}"`);

/** Builds `attr` of the flake here as the person (its log streams to the
 *  terminal) and leaves the store path in $ARG; a failed build ends the run
 *  with the build's code, before anything asks for a password. */
export function buildStep(attr) {
  return [
    `echo "building the system configuration..."`,
    `ARG=$(${NIX} build --no-link --print-out-paths -- ${ref(attr)}) || exit $?`,
    `ARG=$(printf '%s\\n' "$ARG" | tail -n 1)`,
    `[ -d "$ARG" ] || { echo "the build gave no system to activate"; exit 1; }`,
    `echo "built $ARG"`,
  ].join("; ");
}

/** A switch, in two steps: build as the person (evaluating a flake the
 *  person owns: as root, git refuses another user's repository), then
 *  activate the result with root, through the password dialog (osascript)
 *  or sudo. `plan`: "darwin-rebuild:<name>" or "nixos-rebuild:<name>". */
export function switchPlan(plan, admin) {
  const at = String(plan).indexOf(":");
  const tool = String(plan).slice(0, at), name = String(plan).slice(at + 1);
  if (tool === "darwin-rebuild") {
    const build = buildStep(`darwinConfigurations.${attrName(name)}.system`);
    return admin === "osascript" ? `${build}; ${adminLine(DARWIN_ACTIVATE, "activate it")}`
      : `${build}; sudo env ARG="$ARG" ARGUSER="$(id -un)" sh -c ${sq(DARWIN_ACTIVATE)}`;
  }
  if (tool === "nixos-rebuild") {
    const build = buildStep(`nixosConfigurations.${attrName(name)}.config.system.build.toplevel`);
    return admin === "osascript" ? `${build}; ${adminLine(NIXOS_ACTIVATE.replace(/\$1/g, "$ARG"), "activate it")}`
      : `${build}; sudo sh -c ${sq(NIXOS_ACTIVATE)} _ "$ARG"`;
  }
  return null;
}

/** The line a script runs as: its command; a switch's two steps; or wrapped to get root. */
export function shellLine(cmd, admin, plan) {
  const planned = plan && admin ? switchPlan(plan, admin) : null;
  if (planned) return planned;
  if (admin === "osascript") return adminLine(cmd);
  if (admin === "sudo") return `sudo ${cmd}`;
  return cmd;
}
