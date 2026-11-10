import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakeOutputs, nixScripts, nixStatic, nixSystem, adminLine, shellLine, switchPlan, attrName, sq, ADMIN_SCRIPT, CANCELLED, APP_MANAGEMENT, needsAppManagement } from "../defaults/mods/nocturne-scripts/nix.js";
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
PATH="$2" ARG="$5" ARGUSER="$6" sh -c 'cd "$1" && { eval "$2" ; } >> "$3" 2>&1; echo $? > "$3.code"' _ "$3" "$1" "$4"
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
  expect(shellLine("darwin-rebuild switch --flake '.#h'", "osascript", "darwin-rebuild:h")).toContain("build --no-link --print-out-paths");
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

// ---- a switch in two steps: build as the person, then activate as root.
// Everything here is a fake on PATH: nix, nix-env, sudo, osascript and the
// built system's activate scripts only write down that they ran.

function toolchain(opts: { buildFails?: boolean; cancel?: boolean; activateCode?: number; deprecatedUser?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nix-switch-"));
  const bin = join(dir, "bin"), sys = join(dir, "store", "abc-darwin-system");
  Bun.spawnSync(["mkdir", "-p", bin, sys]);
  const rec = join(dir, "record.txt");
  const put = (path: string, text: string) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  put(join(bin, "osascript"), FAKE);
  put(join(bin, "nix"), `#!/bin/sh\necho "nix $*" >> ${sq(rec)}\necho "evaluating... building..." >&2\n${opts.buildFails ? "echo 'error: build failed' >&2; exit 1" : `echo ${sq(sys)}`}\n`);
  put(join(bin, "nix-env"), `#!/bin/sh\necho "nix-env $*" >> ${sq(rec)}\n`);
  put(join(bin, "sudo"), `#!/bin/sh\necho "sudo $*" >> ${sq(rec)}\nwhile [ $# -gt 0 ]; do case "$1" in --) shift; break ;; -*) shift ;; *) break ;; esac; done\nexec "$@"\n`);
  put(join(sys, "activate"), `#!/bin/sh\necho "activate as $(id -un)" >> ${sq(rec)}\nexit ${opts.activateCode ?? 0}\n`);
  put(join(sys, "activate-user"), `#!/bin/sh\n${opts.deprecatedUser ? "# nix-darwin: deprecated\n" : ""}echo "activate-user" >> ${sq(rec)}\n`);
  put(join(sys, "bin-placeholder"), "");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, FAKE_LOG: join(dir, "script.txt"), ...(opts.cancel ? { FAKE_CANCEL: "1" } : {}) };
  const go = (line: string) => {
    const r = Bun.spawnSync(["sh", "-c", line], { cwd: dir, env });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), rec: existsSync(rec) ? readFileSync(rec, "utf8").trim().split("\n") : [], asked: existsSync(join(dir, "script.txt")) };
  };
  return { dir, sys, go, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const user = Bun.spawnSync(["id", "-un"]).stdout.toString().trim();

test("darwin switch: builds as the person, then the dialog activates only the built system", () => {
  const t = toolchain();
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab", "osascript")!);
    expect(r.code).toBe(0);
    expect(r.rec).toEqual([
      `nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths -- .#darwinConfigurations.homelab.system`,
      `nix-env -p /nix/var/nix/profiles/system --set ${t.sys}`,
      `sudo --user=${user} --set-home -- ${t.sys}/activate-user`,
      "activate-user",
      `activate as ${user}`,
    ]);
    // The build's log streamed first, then the password was asked for.
    expect(r.out.indexOf("building the system configuration")).toBeLessThan(r.out.indexOf("asking for an administrator"));
    expect(r.out).toContain("evaluating... building...");
    expect(r.out).toContain(`built ${t.sys}`);
    expect(r.asked).toBe(true);
  } finally { t.done(); }
});

test("a failed build never asks for a password", () => {
  const t = toolchain({ buildFails: true });
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab", "osascript")!);
    expect(r.code).toBe(1);
    expect(r.asked).toBe(false);
    expect(r.rec.some((l) => l.startsWith("nix-env"))).toBe(false);
    expect(r.out).toContain("error: build failed");
  } finally { t.done(); }
});

test("activation's own exit code is the run's; a cancelled dialog activates nothing", () => {
  let t = toolchain({ activateCode: 5 });
  try { expect(t.go(switchPlan("darwin-rebuild:homelab", "osascript")!).code).toBe(5); } finally { t.done(); }
  t = toolchain({ cancel: true });
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab", "osascript")!);
    expect(r.code).toBe(CANCELLED);
    expect(r.rec.some((l) => l.startsWith("nix-env") || l.startsWith("activate"))).toBe(false);
  } finally { t.done(); }
});

test("a deprecated activate-user is left alone, as darwin-rebuild does", () => {
  const t = toolchain({ deprecatedUser: true });
  try {
    const r = t.go(switchPlan("darwin-rebuild:homelab", "osascript")!);
    expect(r.code).toBe(0);
    expect(r.rec.some((l) => l === "activate-user")).toBe(false);
    expect(r.rec[r.rec.length - 1]).toBe(`activate as ${user}`);
  } finally { t.done(); }
});

test("nixos switch: build as the person, sudo only for the profile and switch-to-configuration", () => {
  const t = toolchain();
  try {
    Bun.spawnSync(["mkdir", "-p", join(t.sys, "bin")]);
    writeFileSync(join(t.sys, "bin", "switch-to-configuration"), `#!/bin/sh\necho "switch-to-configuration $1" >> ${sq(join(t.dir, "record.txt"))}\n`);
    chmodSync(join(t.sys, "bin", "switch-to-configuration"), 0o755);
    const r = t.go(switchPlan("nixos-rebuild:vps", "sudo")!);
    expect(r.code).toBe(0);
    expect(r.rec[0]).toBe("nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths -- .#nixosConfigurations.vps.config.system.build.toplevel");
    expect(r.rec.slice(1)).toEqual([
      `sudo sh -c nix-env -p /nix/var/nix/profiles/system --set "$1" && "$1/bin/switch-to-configuration" switch _ ${t.sys}`,
      `nix-env -p /nix/var/nix/profiles/system --set ${t.sys}`,
      "switch-to-configuration switch",
    ]);
    expect(r.asked).toBe(false);
  } finally { t.done(); }
});

test("configuration names reach nix as one attribute, never as shell", () => {
  expect(attrName("homelab")).toBe("homelab");
  expect(attrName("my.host")).toBe('"my.host"');
  const t = toolchain({ buildFails: true });
  try {
    const evil = `x";touch PWNED;"$(touch PWNED2)`;
    t.go(switchPlan(`darwin-rebuild:${evil}`, "osascript")!);
    const rec = readFileSync(join(t.dir, "record.txt"), "utf8");
    expect(rec).toContain(`.#darwinConfigurations."x\\";touch PWNED;\\"\\$(touch PWNED2)".system`);
    expect(existsSync(join(t.dir, "PWNED"))).toBe(false);
    expect(existsSync(join(t.dir, "PWNED2"))).toBe(false);
  } finally { t.done(); }
});

test("a switch remembers its plan, so restarting it builds and activates again", async () => {
  const s = nixScripts({ darwinConfigurations: { homelab: { type: "unknown" } } }, MAC).find((x: any) => x.name === "switch homelab");
  expect(s).toMatchObject({ admin: "osascript", plan: "darwin-rebuild:homelab", cmd: "darwin-rebuild switch --flake '.#homelab'" });
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
  const src = readFileSync(join(import.meta.dir, "../defaults/mods/nocturne/scripts.js"), "utf8");
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
