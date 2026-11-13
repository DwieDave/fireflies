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
// `admin: "sudo"`: it builds as the person, then activates through sudo in
// the run's own terminal (switchPlan), with a prompt the tab strip knows
// (SUDO_PROMPT): ../nocturne/prompt.js shows that line in a small window to
// type the password into. Builds stay unprivileged.
//
// Both shapes of `nix flake show --json` are read: the classic one
// ({ packages: { <system>: { x: { type } } } }) and the inventory one newer
// Nix prints ({ inventory: { packages: { output: { children } } }, version: 2 }).

import type { Script } from "./detect.ts";
import type { JsonRecord } from "./guards.ts";
import { fields, isRecord } from "./guards.ts";
import { isString, object } from "./guard.ts";

export const FLAKE_SHOW = ["flake", "show", "--json", "--no-write-lock-file"];

/** A script's id: its group and name. It goes on its terminal as a label, so
 *  it's plain text; ids from before kept a NUL between them (oldId). */
export const scriptId = (group: string, name: string) => `${group}#${name}`;

export const oldId = (id: string) => id.replaceAll("\u0000", "#");

/** A password prompt the person cancels (ctrl-c) makes the run exit with this; it reads "cancelled". */
export const CANCELLED = 130;

/** Shell-quotes one word: 'it''s' style, so nothing in it is ever code. */
export const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : sq(s));

/** Who and where the folder is (detect.ts's probe): this host's name, the user, `uname -s`, `uname -m`. */
export interface Sys {
  readonly host: string | null;
  readonly user: string | null;
  readonly os: string | null;
  readonly arch: string | null;
}

/** Nothing known about the machine (no probe yet). */
export const NO_SYS: Sys = { host: null, user: null, os: null, arch: null };

const CPUS: ReadonlyMap<string, string> = new Map([
  ["arm64", "aarch64"], ["aarch64", "aarch64"], ["x86_64", "x86_64"], ["amd64", "x86_64"], ["i686", "i686"], ["armv7l", "armv7l"], ["riscv64", "riscv64"],
]);

const KERNELS: ReadonlyMap<string, string> = new Map([["darwin", "darwin"], ["linux", "linux"]]);

/** Nix's system name for `uname -s` / `uname -m`: aarch64-darwin, x86_64-linux, … */
export function nixSystem(os: string | null, arch: string | null) {
  const cpu = CPUS.get((arch ?? "").toLowerCase());
  const kernel = KERNELS.get((os ?? "").toLowerCase());

  return cpu !== undefined && kernel !== undefined ? `${cpu}-${kernel}` : null;
}

/** An output (a package, an app, a configuration): what nix calls it, if it says. */
export interface FlakeLeaf {
  readonly leaf: true;
  readonly what: string | null;
}

/** A flake's outputs as a plain tree: each name a subtree or a leaf. */
export type FlakeNode = FlakeLeaf | FlakeTree;

export type FlakeTree = ReadonlyMap<string, FlakeNode>;

const leaf = (what: string | null): FlakeLeaf => ({ leaf: true, what });

// The classic shape: { packages: { <system>: { x: { type } } } }.
const isTyped = object({ type: isString });

// The inventory one: { inventory: { packages: { output: { children } } }, version: 2 }.
const isInventory = object({ inventory: isRecord });

const isOutput = object({ output: isRecord });

const isParent = object({ children: isRecord });

const isWhat = object({ what: isString });

/** One classic node: a leaf has a `type`, another object is a subtree, anything else a leaf. */
function classic(node: JsonRecord | undefined): FlakeNode {
  if (node === undefined) return leaf(null);

  if (isTyped(node)) return leaf(node.type);

  const subs = fields(node, isRecord);

  return new Map(Object.keys(node).map((name) => [name, classic(subs.get(name))]));
}

/** One inventory node: its `children` a subtree, else a leaf (`what` it is). */
function inventory(node: JsonRecord | undefined): FlakeNode {
  if (node !== undefined && isParent(node)) {
    const subs = fields(node.children, isRecord);

    return new Map(Object.keys(node.children).map((name) => [name, inventory(subs.get(name))]));
  }

  return leaf(node !== undefined && isWhat(node) ? node.what : null);
}

/** The flake's outputs (`nix flake show --json`, either shape) as plain trees: output → name → subtree | leaf. */
export function flakeOutputs(json: JsonRecord): FlakeTree {
  if (isInventory(json)) {
    const outputs = fields(json.inventory, isOutput);

    return new Map(Object.keys(json.inventory).map((name) => {
      const o = outputs.get(name);

      return [name, o === undefined ? new Map() : inventory(o.output)];
    }));
  }

  const subs = fields(json, isRecord);

  return new Map(Object.keys(json).map((name) => [name, classic(subs.get(name))]));
}

/** The node under `name`, when `node` is a subtree that has one. */
const under = (node: FlakeNode | undefined, name: string | null): FlakeNode | undefined =>
  node === undefined || name === null || "leaf" in node ? undefined : node.get(name);

/** The names of a subtree's leaves (none for a leaf or nothing). */
const names = (node: FlakeNode | undefined) => (node === undefined || "leaf" in node ? [] : [...node].flatMap(([k, v]) => ("leaf" in v ? [k] : [])));

const ref = (attr: string) => q(`.#${attr}`);

/** A script nix.ts makes, before its runner and id. */
type Unnamed = Omit<Script, "runner" | "id">;

/** The flake's scripts (see the top). `sys`: { host, user, os, arch } from the probe. */
export function nixScripts(json: JsonRecord, sys: Sys = NO_SYS): Script[] {
  const out = flakeOutputs(json);
  const system = nixSystem(sys.os, sys.arch);
  const mac = (sys.os ?? "").toLowerCase() === "darwin";
  const linux = (sys.os ?? "").toLowerCase() === "linux";
  const g = "flake.nix", r = "nix";
  const list: Unnamed[] = [];
  const per = (o: string) => under(out.get(o), system);

  for (const n of names(per("packages"))) list.push({ group: g, name: n === "default" ? "build" : `build ${n}`, cmd: n === "default" ? "nix build" : `nix build ${ref(n)}` });

  for (const n of names(per("apps"))) list.push({ group: g, name: n === "default" ? "run" : `run ${n}`, cmd: n === "default" ? "nix run" : `nix run ${ref(n)}` });

  for (const n of names(per("devShells"))) list.push({ group: g, name: n === "default" ? "develop" : `develop ${n}`, cmd: n === "default" ? "nix develop" : `nix develop ${ref(n)}` });

  for (const n of names(per("checks"))) list.push({ group: g, name: `check ${n}`, cmd: `nix build ${ref(`checks.${system ?? ""}.${n}`)}` });

  const here = (n: string, home: boolean) => sys.host !== null && sys.host !== "" && (home ? n === `${sys.user ?? ""}@${sys.host}` || n === sys.user : n === sys.host);

  const systems = (output: string, group: string, tool: string, admin: "sudo" | null, home: boolean) => {
    const all = names(out.get(output)).sort((a, b) => Number(here(b, home)) - Number(here(a, home)));

    for (const n of all) {
      const mine = here(n, home);
      // A switch builds as the person first, then only activates with root (switchPlan).
      const plain = { group, name: `switch ${n}`, cmd: `${tool} switch --flake ${ref(n)}` };
      const sw: Unnamed = admin === null ? plain : { ...plain, admin, plan: `${tool}:${n}` };
      const build: Unnamed = { group, name: `build ${n}`, cmd: `${tool} build --flake ${ref(n)}` };

      list.push(mine ? { ...sw, here: true } : sw, mine ? { ...build, here: true } : build);
    }
  };

  if (mac) systems("darwinConfigurations", "nix-darwin", "darwin-rebuild", "sudo", false);

  if (linux) systems("nixosConfigurations", "nixos", "nixos-rebuild", "sudo", false);

  systems("homeConfigurations", "home-manager", "home-manager", null, true);

  return list.map((s) => ({ runner: r, ...s, id: scriptId(s.group, s.name) }));
}

/** What every flake can do, before (or without) an evaluation. */
export function nixStatic(): Script[] {
  const both: Omit<Script, "id">[] = [
    { runner: "nix", group: "flake.nix", name: "flake check", cmd: "nix flake check" },
    { runner: "nix", group: "flake.nix", name: "flake update", cmd: "nix flake update" },
  ];

  return both.map((s) => ({ ...s, id: scriptId(s.group, s.name) }));
}

/** sudo's prompt in a switch's terminal: the tab strip watches for it
 *  (../nocturne/prompt.js keeps a copy) to show it in a small window. */
export const SUDO_PROMPT = "password to activate (sudo): ";

const NIX = `nix --extra-experimental-features ${sq("nix-command flakes")}`;
const PROFILE = "/nix/var/nix/profiles/system";

/** What root does with a built nix-darwin system ($1; $2 the person), as
 *  darwin-rebuild switch does after its build: point the system profile at
 *  it, run the legacy activate-user as the person (unless it says it's
 *  deprecated), activate. */
export const DARWIN_ACTIVATE = `nix-env -p ${PROFILE} --set "$1" && if [ -x "$1/activate-user" ] && ! grep -q '^# nix-darwin: deprecated$' "$1/activate-user"; then sudo --user="$2" --set-home -- "$1/activate-user"; fi && "$1/activate"`;

/** The same for NixOS, as nixos-rebuild switch does: the profile, then switch-to-configuration. */
export const NIXOS_ACTIVATE = `nix-env -p ${PROFILE} --set "$1" && "$1/bin/switch-to-configuration" switch`;

/** Runs `script` as root through sudo in this terminal, the built system
 *  ($ARG) and the person as its arguments, never spliced in. It exits with
 *  the script's code (sudo's own, 1, after three wrong passwords); ctrl-c,
 *  at the prompt or later, ends it as CANCELLED. sudo reads the password
 *  from the terminal itself: nothing else ever sees it. */
export function activateStep(script: string) {
  return [
    `trap 'echo; echo cancelled; exit ${CANCELLED}' INT`,
    `sudo -p ${sq(SUDO_PROMPT)} -- sh -c ${sq(script)} _ "$ARG" "$(id -un)"`,
  ].join("; ");
}

/** One attribute name in a nix attribute path: bare when plain, else in
 *  double quotes ("my.host" stays one name, not two). */
export const attrName = (n: string) => (/^[A-Za-z_][\w'-]*$/.test(n) ? n : `"${n.replace(/["\\$]/g, "\\$&")}"`);

/** Builds `attr` of the flake here as the person (its log streams to the
 *  terminal) and leaves the store path in $ARG; a failed build ends the run
 *  with the build's code, before anything asks for a password. */
export function buildStep(attr: string) {
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
 *  activate the result as root through sudo in the same terminal. That
 *  terminal is in the person's desktop session, so macOS credits Fireflies
 *  Core's permissions (App Management) to nix-darwin's activation.
 *  `plan`: "darwin-rebuild:<name>" or "nixos-rebuild:<name>". */
export function switchPlan(plan: string) {
  const at = plan.indexOf(":");
  const tool = plan.slice(0, at), name = plan.slice(at + 1);

  if (tool === "darwin-rebuild") return `${buildStep(`darwinConfigurations.${attrName(name)}.system`)}; ${activateStep(DARWIN_ACTIVATE)}`;

  if (tool === "nixos-rebuild") return `${buildStep(`nixosConfigurations.${attrName(name)}.config.system.build.toplevel`)}; ${activateStep(NIXOS_ACTIVATE)}`;

  return null;
}

/** The line a script runs as: its command; a switch's two steps; or with sudo
 *  in front ("osascript", from runs before, is sudo too). */
export function shellLine(cmd: string, admin?: string | null, plan?: string | null) {
  const planned = plan && admin ? switchPlan(plan) : null;

  if (planned !== null) return planned;

  return admin ? `sudo ${cmd}` : cmd;
}

// nix-darwin's activation touches /Applications/Nix Apps/*.app to check it
// may update them, which macOS allows only with App Management for whoever
// owns the process: for a run, Herdr Core (the core holds terminals, not the
// app). Activated through sudo in the run's terminal, that's credited; if it
// still fails, the permission is off or stale (an updated core is a new
// binary to macOS). ../nocturne/scripts.js keeps a copy for the failure toast.
export const APP_MANAGEMENT = {
  match: "permission denied when trying to update apps",
  hint: "Herdr Core needs App Management (System Settings > Privacy & Security). If it is already on, remove it and add it again",
  // Opens the setting and shows the core's bundle in Finder, to drag into its list.
  open: `open 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'; open -R "$HOME/.local/share/herdr-core/active/Herdr Core.app"`,
} as const;

/** A nix-darwin switch that failed because Herdr Core lacks App Management. */
export const needsAppManagement = (r: { readonly plan: string | null }, text: string | null) =>
  (r.plan ?? "").startsWith("darwin-rebuild:") && (text ?? "").includes(APP_MANAGEMENT.match);
