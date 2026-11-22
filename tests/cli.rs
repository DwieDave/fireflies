//! `fireflies` and `ff` against a fake core: hc's commands pass through
//! untouched (arguments, stdin, stdout, stderr, exit code), the window's stay
//! the app's, and `herdr-app` behaves as before. Every run has its own HOME,
//! XDG folders and app home, so nothing touches the person's setup.
#![cfg(unix)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const FAKE_CORE: &str = r#"#!/bin/sh
if [ "$1" = --version ]; then echo "hc 9.9.9"; exit 0; fi
if [ "$1" = --help ]; then echo "FAKE CORE HELP"; exit 0; fi
for a in "$@"; do printf 'arg[%s]\n' "$a"; done
printf 'stdin[%s]\n' "$(cat)"
echo "fake core stderr" >&2
exit "${FAKE_EXIT:-0}"
"#;

struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("fireflies-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["bin", "core", "home", "app", "empty"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let exe = Path::new(env!("CARGO_BIN_EXE_herdr-app"));
        for name in ["fireflies", "ff", "herdr-app"] {
            std::os::unix::fs::symlink(exe, dir.join("bin").join(name)).unwrap();
        }
        let core = dir.join("core/hc");
        std::fs::write(&core, FAKE_CORE).unwrap();
        std::fs::set_permissions(&core, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        Scratch { dir }
    }

    fn command(&self, name: &str) -> Command {
        let mut cmd = Command::new(self.dir.join("bin").join(name));
        let home = self.dir.join("home");
        cmd.env("HOME", &home)
            .env("HERDR_APP_HOME", self.dir.join("app"))
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("XDG_CACHE_HOME", home.join(".cache"))
            .env("XDG_STATE_HOME", home.join(".local/state"))
            .env("XDG_DATA_HOME", home.join(".local/share"))
            .env("HERDR_CORE_DIRS", self.dir.join("core"))
            .env("HC_SESSION", "fireflies-cli-test")
            .env_remove("FAKE_EXIT")
            .stdin(Stdio::null());
        cmd
    }

    fn run(&self, name: &str, args: &[&str]) -> Output {
        self.command(name).args(args).output().unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn hc_commands_pass_through_untouched() {
    let s = Scratch::new("pass");
    for name in ["fireflies", "ff"] {
        let mut child = s
            .command(name)
            .args(["send", "t7", "two words", "--", "-x", "", "ls"])
            .env("FAKE_EXIT", "42")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(b"piped in\nsecond line").unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(42), "{name}");
        assert_eq!(
            text(&out.stdout),
            "arg[send]\narg[t7]\narg[two words]\narg[--]\narg[-x]\narg[]\narg[ls]\nstdin[piped in\nsecond line]\n",
            "{name}"
        );
        assert_eq!(text(&out.stderr), "fake core stderr\n", "{name}");
    }
    // A command no build of the app knows (a newer core's) goes through too.
    let out = s.run("fireflies", &["frobnicate", "--json"]);
    assert_eq!(text(&out.stdout), "arg[frobnicate]\narg[--json]\nstdin[]\n");
    assert!(out.status.success());
}

#[test]
fn ls_is_the_cores_and_app_reaches_the_windows() {
    let s = Scratch::new("clash");
    let out = s.run("fireflies", &["ls", "--all"]);
    assert_eq!(text(&out.stdout), "arg[ls]\narg[--all]\nstdin[]\n");
    // `app ls` asks the window, and no window runs on this scratch home: the app's error, not the core.
    let out = s.run("fireflies", &["app", "ls"]);
    assert!(!text(&out.stdout).contains("arg["), "{}", text(&out.stdout));
    assert!(!text(&out.stderr).contains("fake core"), "{}", text(&out.stderr));
}

#[test]
fn core_prefix_is_hc_with_exactly_these_arguments() {
    let s = Scratch::new("core");
    let out = s.run("ff", &["core", "--version"]);
    assert_eq!(text(&out.stdout), "hc 9.9.9\n");
    let out = s.run("ff", &["core", "status"]);
    assert_eq!(text(&out.stdout), "arg[status]\nstdin[]\n");
    let out = s.run("ff", &["core"]);
    assert_eq!(text(&out.stdout), "stdin[]\n");
}

#[test]
fn window_flags_and_help() {
    let s = Scratch::new("flags");
    let version = env!("CARGO_PKG_VERSION");
    assert_eq!(text(&s.run("fireflies", &["--version"]).stdout), format!("fireflies {version}\n"));
    assert_eq!(text(&s.run("ff", &["app", "-V"]).stdout), format!("fireflies {version}\n"));
    assert_eq!(text(&s.run("herdr-app", &["--version"]).stdout), format!("herdr-app {version}\n"));
    assert_eq!(text(&s.run("fireflies", &["--skill"]).stdout), include_str!("../src/SKILL.md"));

    let out = s.run("fireflies", &["--help"]);
    assert!(out.status.success());
    let help = text(&out.stdout);
    for part in ["fireflies app <command>", "fireflies app ls", "fireflies core", "FAKE CORE HELP"] {
        assert!(help.contains(part), "{part}: {help}");
    }
    let home = s.dir.join("app");
    assert!(help.contains(&format!("Home: {}", home.display())), "{help}");
    let app_help = text(&s.run("herdr-app", &["--help"]).stdout);
    assert!(app_help.starts_with("herdr-app: the Fireflies desktop app"), "{app_help}");
    assert!(!app_help.contains("FAKE CORE HELP"));
}

#[test]
fn herdr_app_is_unchanged() {
    let s = Scratch::new("old");
    // hc's commands were never herdr-app's: still an unknown argument, never the core.
    for cmd in ["run", "send", "core", "app"] {
        let out = s.run("herdr-app", &[cmd, "x"]);
        assert_eq!(out.status.code(), Some(2), "{cmd}");
        assert!(text(&out.stderr).starts_with(&format!("herdr-app: unknown argument \"{cmd}\"")), "{}", text(&out.stderr));
        assert!(out.stdout.is_empty());
    }
    // `fireflies app <unknown>` is the window's error, by the name used.
    let out = s.run("fireflies", &["app", "run"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).starts_with("fireflies app: unknown argument \"run\""));
}

#[test]
fn no_core_says_so() {
    let s = Scratch::new("none");
    let out = s.command("fireflies").args(["ls"]).env("HERDR_CORE_DIRS", s.dir.join("empty")).output().unwrap();
    assert_eq!(out.status.code(), Some(127));
    assert!(text(&out.stderr).contains("herdr-core (hc) was not found"));
}
