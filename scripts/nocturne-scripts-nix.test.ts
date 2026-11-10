import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakeOutputs, nixScripts, nixStatic, nixSystem, adminLine, shellLine, sq, ADMIN_SCRIPT, CANCELLED } from "../defaults/mods/nocturne-scripts/nix.js";
import { detect, parseProbe } from "../defaults/mods/nocturne-scripts/detect.js";

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
  homeConfigurations: { "david@homelab": { type: "unknown" }, "david@work": { type: "unknown" } },
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

const MAC = { host: "homelab", user: "david", os: "Darwin", arch: "arm64" };
const LINUX = { host: "homelab", user: "david", os: "Linux", arch: "x86_64" };
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
    ["nix-darwin", "switch homelab", "darwin-rebuild switch --flake '.#homelab'", "osascript", true],
    ["nix-darwin", "build homelab", "darwin-rebuild build --flake '.#homelab'", null, true],
    ["nix-darwin", "switch work", "darwin-rebuild switch --flake '.#work'", "osascript", false],
    ["nix-darwin", "build work", "darwin-rebuild build --flake '.#work'", null, false],
    ["home-manager", "switch david@homelab", "home-manager switch --flake '.#david@homelab'", null, true],
    ["home-manager", "build david@homelab", "home-manager build --flake '.#david@homelab'", null, true],
    ["home-manager", "switch david@work", "home-manager switch --flake '.#david@work'", null, false],
    ["home-manager", "build david@work", "home-manager build --flake '.#david@work'", null, false],
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
  const p = parseProbe("\u001els\nflake.nix\n\u001esys\nhomelab\ndavid\nDarwin\narm64\n");
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

// A stand-in for osascript: skips the -e lines (keeping them for a look), then
// does what the AppleScript does, without root and without any dialog.
const FAKE = `#!/bin/sh
: > "$FAKE_LOG"
while [ "$1" = "-e" ]; do printf '%s\\n' "$2" >> "$FAKE_LOG"; shift 2; done
if [ -n "$FAKE_CANCEL" ]; then echo "execution error: User canceled. (-128)" >&2; exit 1; fi
PATH="$2" sh -c 'cd "$1" && { eval "$2" ; } >> "$3" 2>&1; echo $? > "$3.code"' _ "$3" "$1" "$4"
`;

function fakeRun(cmd: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nix-admin-"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", bin]);
  writeFileSync(join(bin, "osascript"), FAKE);
  chmodSync(join(bin, "osascript"), 0o755);
  const log = join(dir, "script.txt");
  const r = Bun.spawnSync(["sh", "-c", adminLine(cmd)], {
    cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, FAKE_LOG: log, ...env },
  });
  const out = { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), script: readFileSync(log, "utf8"), dir };
  return out;
}

test("the admin line streams output and keeps the command's exit code", () => {
  const r = fakeRun(`echo building; echo from ${sq("a';touch PWNED;'")}; exit 3`);
  try {
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("building");
    expect(r.stdout).toContain("from a';touch PWNED;'");
    expect(existsSync(join(r.dir, "PWNED"))).toBe(false);
    // The AppleScript goes to osascript as written: the command only ever as argv.
    expect(r.script.trim().split("\n")).toEqual(ADMIN_SCRIPT);
    // Its temporary files are gone.
    expect(Bun.spawnSync(["sh", "-c", "ls nocturne-admin.* 2>/dev/null | wc -l"], { cwd: r.dir }).stdout.toString().trim()).toBe("0");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
  const ok = fakeRun("true");
  expect(ok.code).toBe(0);
  rmSync(ok.dir, { recursive: true, force: true });
});

test("cancelling the dialog is its own exit, not a crash", () => {
  const r = fakeRun("echo never", { FAKE_CANCEL: "1" });
  try {
    expect(r.code).toBe(CANCELLED);
    expect(r.stdout).toContain("cancelled");
    expect(r.stdout).not.toMatch(/^never$/m);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("shellLine wraps only admin runs", () => {
  expect(shellLine("nix build", null)).toBe("nix build");
  expect(shellLine("nixos-rebuild switch --flake '.#a'", "sudo")).toBe("sudo nixos-rebuild switch --flake '.#a'");
  expect(shellLine("x", "osascript")).toContain("osascript -e");
});

test.skipIf(process.platform !== "darwin")("the AppleScript compiles (osacompile only compiles, it runs nothing)", () => {
  const dir = mkdtempSync(join(tmpdir(), "nix-osa-"));
  try {
    const r = Bun.spawnSync(["osacompile", ...ADMIN_SCRIPT.flatMap((l) => ["-e", l]), "-o", join(dir, "admin.scpt")]);
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
