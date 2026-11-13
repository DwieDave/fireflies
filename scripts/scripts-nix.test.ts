import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakeOutputs, nixScripts, nixStatic, nixSystem, shellLine, switchPlan, attrName, sq, SUDO_PROMPT, CANCELLED, APP_MANAGEMENT, needsAppManagement } from "../defaults/mods/scripts/nix.js";
import { detect, parseProbe } from "../defaults/mods/scripts/detect.js";

// `nix flake show --json`, classic shape.
const CLASSIC = {
  packages: {
    "aarch64-darwin": { default: { type: "derivation", name: "app" }, cli: { type: "derivation", name: "cli" } },
    "x86_64-linux": { default: { type: "derivation", name: "app" } },
  },
  apps: { "aarch64-darwin": { serve: { type: "app" } } },
  devShells: { "aarch64-darwin": { default: { type: "derivation" }, ci: { type: "derivation" } } },
  checks: { "aarch64-darwin": { fmt: { type: "derivation" } } },
  darwinConfigurations: { work: { type: "unknown" }, homelab: { type: "unknown" } },
  nixosConfigurations: { vps: { type: "nixos-configuration" }, homelab: { type: "nixos-configuration" } },
  homeConfigurations: { "developer@homelab": { type: "unknown" }, "developer@work": { type: "unknown" } },
  formatter: { "aarch64-darwin": { type: "derivation" } },
};

// The inventory shape newer Nix prints (trimmed from /private/etc/nix-darwin's).
const INVENTORY = {
  inventory: {
    checks: { doc: "…", output: { children: { "aarch64-darwin": { children: { homelab: { derivation: { name: "darwin-system" }, what: "CI test" } } } } } },
    darwinConfigurations: { doc: "…", output: { children: {
      homelab: { derivation: { name: "darwin-system" }, what: "nix-darwin configuration" },
      work: { derivation: { name: "darwin-system" }, what: "nix-darwin configuration" },
    } } },
    packages: { doc: "…", output: { children: { "aarch64-darwin": { children: { default: { derivation: { name: "x" }, what: "package" } } } } } },
    formatter: { doc: "…", output: { children: { "aarch64-darwin": { derivation: { name: "nixfmt" }, what: "formatter" } } } },
  },
  version: 2,
};

const MAC = { host: "homelab", user: "developer", os: "Darwin", arch: "arm64" };
const LINUX = { host: "homelab", user: "developer", os: "Linux", arch: "x86_64" };
const pick = (list: any[]) => list.map((s) => [s.group, s.name, s.cmd, s.admin ?? null, Boolean(s.here)]);

test("systems from uname", () => {
  expect(nixSystem("Darwin", "arm64")).toBe("aarch64-darwin");
  expect(nixSystem("Linux", "x86_64")).toBe("x86_64-linux");
  expect(nixSystem("Linux", "aarch64")).toBe("aarch64-linux");
  expect(nixSystem("FreeBSD", "amd64")).toBe(null);
});

test("both shapes of flake show read the same", () => {
  expect(flakeOutputs(CLASSIC).darwinConfigurations.work.leaf).toBe(true);
  const inv = flakeOutputs(INVENTORY);
  expect(Object.keys(inv.darwinConfigurations)).toEqual(["homelab", "work"]);
  expect(inv.packages["aarch64-darwin"].default.leaf).toBe(true);
  expect(inv.checks["aarch64-darwin"].homelab.leaf).toBe(true);
});

test("a Mac: this system's outputs, nix-darwin and home-manager, this host first", () => {
  expect(pick(nixScripts(CLASSIC, MAC))).toEqual([
    ["flake.nix", "build", "nix build", null, false],
    ["flake.nix", "build cli", "nix build '.#cli'", null, false],
    ["flake.nix", "run serve", "nix run '.#serve'", null, false],
    ["flake.nix", "develop", "nix develop", null, false],
    ["flake.nix", "develop ci", "nix develop '.#ci'", null, false],
    ["flake.nix", "check fmt", "nix build '.#checks.aarch64-darwin.fmt'", null, false],
    ["nix-darwin", "switch homelab", "darwin-rebuild switch --flake '.#homelab'", "sudo", true],
    ["nix-darwin", "build homelab", "darwin-rebuild build --flake '.#homelab'", null, true],
    ["nix-darwin", "switch work", "darwin-rebuild switch --flake '.#work'", "sudo", false],
    ["nix-darwin", "build work", "darwin-rebuild build --flake '.#work'", null, false],
    ["home-manager", "switch developer@homelab", "home-manager switch --flake '.#developer@homelab'", null, true],
    ["home-manager", "build developer@homelab", "home-manager build --flake '.#developer@homelab'", null, true],
    ["home-manager", "switch developer@work", "home-manager switch --flake '.#developer@work'", null, false],
    ["home-manager", "build developer@work", "home-manager build --flake '.#developer@work'", null, false],
  ]);
});

test("Linux: nixos instead of nix-darwin, switched with sudo", () => {
  const list = nixScripts(CLASSIC, LINUX);
  expect(list.some((s: any) => s.group === "nix-darwin")).toBe(false);
  expect(pick(list.filter((s: any) => s.group === "nixos"))).toEqual([
    ["nixos", "switch homelab", "nixos-rebuild switch --flake '.#homelab'", "sudo", true],
    ["nixos", "build homelab", "nixos-rebuild build --flake '.#homelab'", null, true],
    ["nixos", "switch vps", "nixos-rebuild switch --flake '.#vps'", "sudo", false],
    ["nixos", "build vps", "nixos-rebuild build --flake '.#vps'", null, false],
  ]);
  expect(list.find((s: any) => s.name === "build").cmd).toBe("nix build");
  expect(list.some((s: any) => s.name === "run serve")).toBe(false);
});

test("the inventory shape on a Mac", () => {
  expect(nixScripts(INVENTORY, MAC).map((s: any) => s.name)).toEqual([
    "build", "check homelab", "switch homelab", "build homelab", "switch work", "build work",
  ]);
});

test("a flake's static entries come with the probe, ids are unique", () => {
  const p = { ls: new Set(["flake.nix", "flake.lock"]), exec: [], examples: [], cmd: [], files: {}, sys: MAC };
  expect(detect(p).map((s: any) => s.cmd)).toEqual(["nix flake check", "nix flake update"]);
  const ids = [...nixStatic(), ...nixScripts(CLASSIC, MAC)].map((s: any) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(nixScripts(null, MAC)).toEqual([]);
  expect(nixScripts({ garbage: 1 }, MAC)).toEqual([]);
});

test("the probe says who and where", () => {
  const p = parseProbe("\u001els\nflake.nix\n\u001esys\nhomelab\ndeveloper\nDarwin\narm64\n");
  expect(p.sys).toEqual(MAC);
});

test("attribute names never reach the shell as code", () => {
  const evil = { darwinConfigurations: { "x';touch PWNED;'": { type: "unknown" }, "$(touch PWNED2)": { type: "unknown" } } };
  const cmds = nixScripts(evil, MAC).map((s: any) => s.cmd);
  expect(cmds[0]).toBe(`darwin-rebuild switch --flake '.#x'\\'';touch PWNED;'\\'''`);
  const dir = mkdtempSync(join(tmpdir(), "nix-quote-"));
  try {
    for (const c of cmds) {
      // The same line with a harmless program in place of darwin-rebuild.
      const r = Bun.spawnSync(["sh", "-c", c.replace(/^darwin-rebuild/, "printf '%s|'")], { cwd: dir });
      expect(r.exitCode).toBe(0);
    }
    expect(existsSync(join(dir, "PWNED"))).toBe(false);
    expect(existsSync(join(dir, "PWNED2"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sq quotes anything", () => {
  const r = Bun.spawnSync(["sh", "-c", `printf '%s' ${sq(`it's "$(x)" \`y\` $HOME`)}`]);
  expect(r.stdout.toString()).toBe(`it's "$(x)" \`y\` $HOME`);
});

test("shellLine: a switch's two steps, sudo in front of other admin runs", () => {
  expect(shellLine("nix build", null)).toBe("nix build");
  expect(shellLine("nixos-rebuild switch --flake '.#a'", "sudo")).toBe("sudo nixos-rebuild switch --flake '.#a'");
  // Runs from before the switch to sudo keep "osascript" as their label: restarted, they use sudo.
  for (const admin of ["sudo", "osascript"]) {
    const line = shellLine("darwin-rebuild switch --flake '.#h'", admin, "darwin-rebuild:h");
    expect(line).toContain("build --no-link --print-out-paths");
    expect(line).toContain(`sudo -p ${sq(SUDO_PROMPT)}`);
    expect(line).not.toContain("osascript");
  }
  expect(shellLine("x", "osascript")).toBe("sudo x");
});

// ---- a switch in two steps: build as the person, then activate as root
// through sudo in the same terminal. Everything here is a fake on PATH: nix,
// nix-env, sudo and the built system's activate scripts only write down that
// they ran. The fake sudo asks for FAKE_SUDO_PW on stdin (the real one reads
// the terminal) with the prompt it's given, like sudo: "Sorry, try again."
// and three tries; FAKE_SUDO_INT presses ctrl-c at the prompt instead.

const FAKE_SUDO = (rec: string) => `#!/bin/sh
P="Password:"
if [ -n "$FAKE_SUDO_DONE" ]; then echo "sudo $*" >> ${sq(rec)}; else echo "sudo: root" >> ${sq(rec)}; fi
while [ $# -gt 0 ]; do case "$1" in -p) P="$2"; shift 2 ;; --) shift; break ;; -*) shift ;; *) break ;; esac; done
if [ -z "$FAKE_SUDO_DONE" ] && [ -n "$FAKE_SUDO_PW" ]; then
  n=0
  while :; do
    printf '%s' "$P"
    if [ -n "$FAKE_SUDO_INT" ]; then kill -INT 0; sleep 2; fi
    IFS= read -r pw || exit 1
    echo
    [ "$pw" = "$FAKE_SUDO_PW" ] && break
    n=$((n+1)); if [ $n -ge 3 ]; then echo "sudo: 3 incorrect password attempts" >&2; exit 1; fi
    echo "Sorry, try again." >&2
  done
fi
FAKE_SUDO_DONE=1 exec "$@"
`;

function toolchain(opts: { buildFails?: boolean; activateCode?: number; deprecatedUser?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nix-switch-"));
  const bin = join(dir, "bin"), sys = join(dir, "store", "abc-darwin-system");
  Bun.spawnSync(["mkdir", "-p", bin, sys]);
  const rec = join(dir, "record.txt");
  const put = (path: string, text: string) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  put(join(bin, "nix"), `#!/bin/sh\necho "nix $*" >> ${sq(rec)}\necho "evaluating... building..." >&2\n${opts.buildFails ? "echo 'error: build failed' >&2; exit 1" : `echo ${sq(sys)}`}\n`);
  put(join(bin, "nix-env"), `#!/bin/sh\necho "nix-env $*" >> ${sq(rec)}\n`);
  put(join(bin, "sudo"), FAKE_SUDO(rec));
  put(join(sys, "activate"), `#!/bin/sh\necho "activate as $(id -un)" >> ${sq(rec)}\necho "setting up /Applications/Nix Apps..."\nexit ${opts.activateCode ?? 0}\n`);
  put(join(sys, "activate-user"), `#!/bin/sh\n${opts.deprecatedUser ? "# nix-darwin: deprecated\n" : ""}echo "activate-user" >> ${sq(rec)}\n`);
  const go = (line: string, input = "secret\n", env: Record<string, string> = {}) => {
    // Its own process group, as in a terminal: ctrl-c reaches the shell and sudo, not the tests.
    const r = Bun.spawnSync(["perl", "-e", "setpgrp(0,0); exec @ARGV", "sh", "-c", line], {
      cwd: dir, stdin: Buffer.from(input), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, FAKE_SUDO_PW: "secret", ...env },
    });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), rec: existsSync(rec) ? readFileSync(rec, "utf8").trim().split("\n") : [] };
  };
  return { dir, sys, go, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const user = Bun.spawnSync(["id", "-un"]).stdout.toString().trim();
const asked = (out: string) => out.split(SUDO_PROMPT).length - 1;

test("darwin switch: builds as the person, then sudo in its terminal activates only the built system", () => {
  const t = toolchain();
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!);
    expect(r.code).toBe(0);
    expect(r.rec).toEqual([
      `nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths -- .#darwinConfigurations.homelab.system`,
      "sudo: root",
      `nix-env -p /nix/var/nix/profiles/system --set ${t.sys}`,
      `sudo --user=${user} --set-home -- ${t.sys}/activate-user`,
      "activate-user",
      `activate as ${user}`,
    ]);
    // The build's log streamed first, then sudo asked once, with the prompt the strip watches for.
    expect(r.out).toContain("evaluating... building...");
    expect(r.out.indexOf(`built ${t.sys}`)).toBeLessThan(r.out.indexOf(SUDO_PROMPT));
    expect(asked(r.out)).toBe(1);
    expect(r.out).toContain("setting up /Applications/Nix Apps...");
  } finally { t.done(); }
});

test("a failed build never asks for a password", () => {
  const t = toolchain({ buildFails: true });
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!);
    expect(r.code).toBe(1);
    expect(asked(r.out)).toBe(0);
    expect(r.rec.some((l) => l.startsWith("sudo") || l.startsWith("nix-env"))).toBe(false);
    expect(r.out).toContain("error: build failed");
  } finally { t.done(); }
});

test("activation's own exit code is the run's", () => {
  const t = toolchain({ activateCode: 5 });
  try { expect(t.go(switchPlan("darwin-rebuild:homelab")!).code).toBe(5); } finally { t.done(); }
});

test("a wrong password asks again; three wrong ones activate nothing", () => {
  let t = toolchain();
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!, "nope\nsecret\n");
    expect(r.code).toBe(0);
    expect(asked(r.out)).toBe(2);
    expect(r.out).toContain("Sorry, try again.");
    expect(r.rec[r.rec.length - 1]).toBe(`activate as ${user}`);
  } finally { t.done(); }
  t = toolchain();
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!, "a\nb\nc\n");
    expect(r.code).toBe(1);
    expect(asked(r.out)).toBe(3);
    expect(r.out).toContain("3 incorrect password attempts");
    expect(r.rec.some((l) => l.startsWith("nix-env") || l.startsWith("activate"))).toBe(false);
  } finally { t.done(); }
});

test("ctrl-c at the prompt cancels: nothing activated, the run ends as cancelled", () => {
  const t = toolchain();
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!, "", { FAKE_SUDO_INT: "1" });
    expect(r.code).toBe(CANCELLED);
    expect(r.out).toContain("cancelled");
    expect(r.rec.some((l) => l.startsWith("nix-env") || l.startsWith("activate"))).toBe(false);
  } finally { t.done(); }
});

test("a deprecated activate-user is left alone, as darwin-rebuild does", () => {
  const t = toolchain({ deprecatedUser: true });
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab")!);
    expect(r.code).toBe(0);
    expect(r.rec.some((l) => l === "activate-user")).toBe(false);
    expect(r.rec[r.rec.length - 1]).toBe(`activate as ${user}`);
  } finally { t.done(); }
});

test("nixos switch: build as the person, sudo only for the profile and switch-to-configuration", () => {
  const t = toolchain();
  try {
    Bun.spawnSync(["mkdir", "-p", join(t.sys, "bin")]);
    writeFileSync(join(t.sys, "bin", "switch-to-configuration"), `#!/bin/sh\necho "switch-to-configuration $1 as $(id -un)" >> ${sq(join(t.dir, "record.txt"))}\n`);
    chmodSync(join(t.sys, "bin", "switch-to-configuration"), 0o755);
    const r = t.go(switchPlan("nixos-rebuild:vps")!);
    expect(r.code).toBe(0);
    expect(r.rec).toEqual([
      "nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths -- .#nixosConfigurations.vps.config.system.build.toplevel",
      "sudo: root",
      `nix-env -p /nix/var/nix/profiles/system --set ${t.sys}`,
      `switch-to-configuration switch as ${user}`,
    ]);
    expect(asked(r.out)).toBe(1);
  } finally { t.done(); }
});

test("configuration names and store paths never reach a shell as code", () => {
  expect(attrName("homelab")).toBe("homelab");
  expect(attrName("my.host")).toBe('"my.host"');
  let t = toolchain({ buildFails: true });
  try {
    const evil = `x";touch PWNED;"$(touch PWNED2)`;
    t.go(switchPlan(`darwin-rebuild:${evil}`)!);
    const rec = readFileSync(join(t.dir, "record.txt"), "utf8");
    expect(rec).toContain(`.#darwinConfigurations."x\\";touch PWNED;\\"\\$(touch PWNED2)".system`);
    expect(existsSync(join(t.dir, "PWNED"))).toBe(false);
    expect(existsSync(join(t.dir, "PWNED2"))).toBe(false);
  } finally { t.done(); }
  // A built path with shell in it reaches root's script as $1, one word.
  t = toolchain();
  try {
    const odd = join(t.dir, "store", "x'$(touch PWNED3)'");
    Bun.spawnSync(["mv", t.sys, odd]);
    writeFileSync(join(t.dir, "bin", "nix"), `#!/bin/sh\nprintf '%s\\n' ${sq(odd)}\n`);
    const r = t.go(switchPlan("darwin-rebuild:homelab")!);
    expect(r.code).toBe(0);
    expect(r.rec).toContain(`nix-env -p /nix/var/nix/profiles/system --set ${odd}`);
    expect(existsSync(join(t.dir, "PWNED3"))).toBe(false);
  } finally { t.done(); }
});

test("a switch remembers its plan, so restarting it builds and activates again", async () => {
  const s = nixScripts({ darwinConfigurations: { homelab: { type: "unknown" } } }, MAC).find((x: any) => x.name === "switch homelab");
  expect(s).toMatchObject({ admin: "sudo", plan: "darwin-rebuild:homelab", cmd: "darwin-rebuild switch --flake '.#homelab'" });
});

test("the strip's copy of SUDO_PROMPT matches", () => {
  const src = readFileSync(join(import.meta.dir, "../defaults/mods/nocturne/prompt.ts"), "utf8");
  expect(src).toContain(`export const SUDO_PROMPT = ${JSON.stringify(SUDO_PROMPT)};`);
});

// nix-darwin's activate (checkAppManagementPermission) prints this when it can't touch /Applications/Nix Apps.
const DENIED = "error: permission denied when trying to update apps over SSH, aborting activation\nApps could not be updated, as SSH sessions are not allowed to update apps...";

test("a darwin switch denied App Management is recognized, nothing else is", () => {
  expect(needsAppManagement({ plan: "darwin-rebuild:homelab" }, `building...\n${DENIED}`)).toBe(true);
  expect(needsAppManagement({ plan: "darwin-rebuild:homelab" }, "error: builder failed")).toBe(false);
  expect(needsAppManagement({ plan: "nixos-rebuild:box" }, DENIED)).toBe(false);
  expect(needsAppManagement({ plan: null }, DENIED)).toBe(false);
  expect(needsAppManagement(null, null)).toBe(false);
});

test("the strip's copy of APP_MANAGEMENT matches the deck's", () => {
  const src = readFileSync(join(import.meta.dir, "../defaults/mods/nocturne/scripts.ts"), "utf8");
  for (const v of [APP_MANAGEMENT.match, APP_MANAGEMENT.hint, APP_MANAGEMENT.open]) expect(src).toContain(v);
});

test("opening the setting opens App Management and reveals Herdr Core in Finder", () => {
  const dir = mkdtempSync(join(tmpdir(), "nocturne-open-"));
  try {
    const log = join(dir, "open.log");
    writeFileSync(join(dir, "open"), `#!/bin/sh\nfor a in "$@"; do printf '%s|' "$a"; done >> ${sq(log)}; echo >> ${sq(log)}\n`);
    chmodSync(join(dir, "open"), 0o755);
    const r = Bun.spawnSync(["/bin/sh", "-c", APP_MANAGEMENT.open], { env: { PATH: `${dir}:/usr/bin:/bin`, HOME: "/Users/me" } });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles|",
      "-R|/Users/me/.local/share/herdr-core/active/Herdr Core.app|",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
