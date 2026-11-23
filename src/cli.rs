//! `fireflies` (and `ff`): one command over the window and herdr-core.
//!
//! Called by one of those names, the window's commands answer as they do
//! under `herdr-app`, and everything else goes to the core unchanged, as if
//! `hc` had been called with the same arguments: the core is exec'd, so
//! stdin, stdout, stderr, the terminal, signals and the exit code are its
//! own. A newer core's commands work without a new app. The one command name
//! both have, `ls`, is the core's (the CLI extends hc, it never shadows it);
//! `fireflies app <command>` reaches every window command, and
//! `fireflies core <args>` is hc with exactly those arguments (its own
//! `--help`, `--version`, `--skill`, and no arguments: its terminal picker).
//!
//! Called as `herdr-app` (or the bundle's own executable name), nothing
//! changes: only window commands.

use std::ffi::{OsStr, OsString};
use std::path::Path;

/// The window's commands at the top level of `fireflies`.
const WINDOW: &[&str] = &["do", "status", "commands", "feedback", "shot", "check", "types"];
/// The window's flags at the top level of `fireflies`.
const WINDOW_FLAGS: &[&str] = &["-V", "--version", "version", "--skill"];
/// Window commands hc has too: at the top level they are the core's.
const SHARED: &[&str] = &["ls"];

#[derive(Debug, PartialEq)]
pub enum Route {
    /// The window's command line, as `herdr-app` would get it: `name` is how
    /// help and errors call the command (`herdr-app`, `fireflies app`).
    App { name: &'static str, args: Vec<String> },
    /// hc's arguments, without a program name.
    Core(Vec<OsString>),
    /// `fireflies --help`: both sets.
    Help,
}

/// Whether this program name is the combined command (`fireflies`, `ff`).
pub fn combined(argv0: &OsStr) -> bool {
    let name = Path::new(argv0).file_name().and_then(OsStr::to_str).unwrap_or_default();
    let name = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    matches!(name, "fireflies" | "ff")
}

fn lossy(args: &[OsString]) -> Vec<String> {
    args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
}

/// Where this command line goes. `args` includes the program name.
pub fn route(args: &[OsString]) -> Route {
    let Some(argv0) = args.first() else {
        return Route::App { name: "herdr-app", args: Vec::new() };
    };
    if !combined(argv0) {
        return Route::App { name: "herdr-app", args: lossy(args) };
    }
    let app = |rest: &[OsString]| {
        let mut a = vec![argv0.to_string_lossy().into_owned()];
        a.extend(lossy(rest));
        a
    };
    let Some(first) = args.get(1) else {
        // Bare: the window, as from the Dock.
        return Route::App { name: "fireflies", args: app(&[]) };
    };
    match first.to_str() {
        Some("app") => Route::App { name: "fireflies app", args: app(&args[2..]) },
        Some("core") => Route::Core(args[2..].to_vec()),
        Some("-h" | "--help" | "help") => Route::Help,
        Some(w) if SHARED.contains(&w) => Route::Core(args[1..].to_vec()),
        Some(w) if WINDOW.contains(&w) || WINDOW_FLAGS.contains(&w) => Route::App { name: "fireflies", args: app(&args[1..]) },
        // The app's own re-launches (the mod checker's job) never come by these
        // names, but if one did it must stay the app's.
        Some(w) if w.starts_with("--herdr-") => Route::App { name: "fireflies", args: app(&args[1..]) },
        _ => Route::Core(args[1..].to_vec()),
    }
}

/// The core binary for `fireflies`: the one the app would run.
fn core() -> Option<std::path::PathBuf> {
    // settings.json's `core`, read without writing a default file.
    let configured = std::fs::read_to_string(crate::settings::path())
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("core").and_then(|c| c.as_str()).map(str::to_owned));
    let bin = crate::core_bin::find(configured.as_deref())?;
    // Never this program itself (an `hc` linked to fireflies would loop).
    let me = std::env::current_exe().and_then(|p| p.canonicalize()).ok();
    (bin.canonicalize().ok() != me || me.is_none()).then_some(bin)
}

fn missing() -> i32 {
    eprintln!("fireflies: herdr-core (hc) was not found: open Fireflies once to install it, or set `core` in settings.json");
    127
}

/// Runs hc with these arguments in this process's place; returns only when
/// it can't (the exit code to leave with).
pub fn exec_core(args: &[OsString]) -> i32 {
    let Some(bin) = core() else { return missing() };
    let mut cmd = std::process::Command::new(&bin);
    cmd.args(args);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let e = cmd.arg0("hc").exec();
        eprintln!("fireflies: cannot run {}: {e}", bin.display());
        126
    }
    #[cfg(not(unix))]
    match cmd.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("fireflies: cannot run {}: {e}", bin.display());
            126
        }
    }
}

/// `fireflies --help`: the window's commands, then the core's own help.
pub fn help(app_help: &str) -> i32 {
    print!("{}", combined_head());
    print!("{app_help}");
    println!();
    println!("Terminals and agents: herdr-core (`fireflies core --help`, every command below runs as `fireflies <command>`)");
    println!();
    let Some(bin) = core() else { return missing() };
    let mut cmd = std::process::Command::new(&bin);
    #[cfg(unix)]
    std::os::unix::process::CommandExt::arg0(&mut cmd, "hc");
    match cmd.arg("--help").stdin(std::process::Stdio::null()).output() {
        Ok(out) => {
            print!("{}", String::from_utf8_lossy(&out.stdout));
            0
        }
        Err(e) => {
            eprintln!("fireflies: cannot run {}: {e}", bin.display());
            126
        }
    }
}

fn combined_head() -> &'static str {
    "\
fireflies (short: ff): the Fireflies window and herdr-core in one command.

  fireflies                        open the window
  fireflies <hc command> [args]    a herdr-core command, exactly as `hc` runs it (list below)
  fireflies app <command> [args]   a window command, exactly as `herdr-app` runs it
  fireflies core [args]            hc itself: `fireflies core --skill`, `--version`, no
                                   arguments to pick a terminal
  `ls` is hc's (terminals); the window's is `fireflies app ls`.

"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }
    fn app(name: &'static str, args: &[&str]) -> Route {
        Route::App { name, args: args.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn names() {
        for name in ["fireflies", "ff", "/run/current-system/sw/bin/fireflies", "~/.local/bin/ff", "fireflies.exe"] {
            assert!(combined(OsStr::new(name)), "{name}");
        }
        for name in ["herdr-app", "/Applications/Fireflies.app/Contents/MacOS/Fireflies", "Herdr", "hc", "herdr-core", "fff", "target/debug/herdr-app"] {
            assert!(!combined(OsStr::new(name)), "{name}");
        }
    }

    #[test]
    fn herdr_app_keeps_every_argument_for_the_window() {
        for args in [&["herdr-app"][..], &["herdr-app", "ls"], &["herdr-app", "run", "x"], &["herdr-app", "--help"], &["herdr-app", "app", "ls"], &["herdr-app", "core"]] {
            assert_eq!(route(&os(args)), app("herdr-app", args), "{args:?}");
        }
        let bundle = "/Applications/Fireflies.app/Contents/MacOS/Fireflies";
        assert_eq!(route(&os(&[bundle, "--herdr-check-job", "d", "t"])), app("herdr-app", &[bundle, "--herdr-check-job", "d", "t"]));
    }

    #[test]
    fn window_commands_stay_at_the_top() {
        for cmd in ["do", "status", "commands", "feedback", "shot", "check", "types", "--version", "-V", "version", "--skill"] {
            assert_eq!(route(&os(&["ff", cmd, "x"])), app("fireflies", &["ff", cmd, "x"]), "{cmd}");
        }
        assert_eq!(route(&os(&["fireflies"])), app("fireflies", &["fireflies"]));
    }

    #[test]
    fn a_shared_name_is_the_cores_and_app_reaches_it() {
        for name in SHARED {
            assert_eq!(route(&os(&["fireflies", name, "--all"])), Route::Core(os(&[name, "--all"])));
            assert_eq!(route(&os(&["fireflies", "app", name])), app("fireflies app", &["fireflies", name]));
        }
        assert_eq!(route(&os(&["ff", "app"])), app("fireflies app", &["ff"]));
        assert_eq!(route(&os(&["ff", "app", "--help"])), app("fireflies app", &["ff", "--help"]));
    }

    #[test]
    fn everything_else_falls_through_to_the_core() {
        for args in [&["run", "--bg", "claude"][..], &["send", "t7", "hi there"], &["server", "status"], &["a-command-of-a-newer-core"], &["--json"], &["--licenses"]] {
            let mut full = vec!["fireflies"];
            full.extend_from_slice(args);
            assert_eq!(route(&os(&full)), Route::Core(os(args)), "{args:?}");
        }
        assert_eq!(route(&os(&["ff", "core"])), Route::Core(vec![]));
        assert_eq!(route(&os(&["ff", "core", "--version"])), Route::Core(os(&["--version"])));
        assert_eq!(route(&os(&["ff", "core", "ls"])), Route::Core(os(&["ls"])));
        for h in ["-h", "--help", "help"] {
            assert_eq!(route(&os(&["ff", h])), Route::Help);
        }
    }

    #[cfg(unix)]
    #[test]
    fn arguments_that_are_not_utf8_reach_the_core_untouched() {
        use std::os::unix::ffi::OsStringExt;
        let odd = OsString::from_vec(vec![b'x', 0xff, b'y']);
        let args = vec![OsString::from("fireflies"), "send".into(), odd.clone()];
        assert_eq!(route(&args), Route::Core(vec!["send".into(), odd]));
    }
}
