// Windows: a window app, but tests inherit Cargo's console for their child processes.
#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]

mod badge;
mod bench;
mod cli;
mod commands;
mod control;
mod core_bin;
mod equalize;
mod files;
mod hc;
mod keys;
mod layout;
mod layout_sync;
mod links;
mod lsp;
mod markdown;
mod model;
mod pane_resize;
mod paths;
mod mirror;
mod mirror_sync;
mod place;
mod persist;
#[cfg(any(target_os = "macos", test))]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos;
#[cfg(target_os = "macos")]
mod macos_check;
mod mods;
mod native_view;
mod mod_files;
mod agent_command;
mod process_cwd;
mod programs;
mod remote_shell;
mod search;
mod settings;
mod setup;
mod sound;
mod spawn;
mod sprites;
mod syntax;
mod feedback;
mod terminal;
mod update;
mod update_notes;
mod vt;
mod win32_keys;
mod window;

use gpui::*;

/// The window's commands; `{cmd}` is how the person called them
/// (`herdr-app`, or `fireflies app`).
const HELP: &str = "\
{cmd}: the Fireflies desktop app. With no arguments it opens the window.

Usage:
  {cmd}                        open the window
  {cmd} ls                     spaces, their tabs and terminals, in the open window
  {cmd} do <command> [args]    run a command: --name api --argv '[\"pi\"]', or one JSON object
  {cmd} feedback <text>        draft a GitHub issue for the person to review and submit
  {cmd} commands               every command, its arguments, what it does
  {cmd} status                 what the window shows, and any errors
  {cmd} shot [file.png]        save the current window frame (default: herdr-shot.png)
  {cmd} check <mod folder>     load a mod once and report what's wrong
  {cmd} types <mod folder>     write its typings (gpui-kit.d.ts) and editor config for tsc
  {cmd} --skill                Agent Skill: driving the window, and where the core fits
  {cmd} --version

The terminals run in herdr-core, which keeps them alive when the window
closes. `fireflies` (short: `ff`) is this command and hc's in one: the
window's commands as above (`fireflies app ls` for the window's ls),
every other one hc's (`fireflies run`, `fireflies send`, `fireflies ls`).
`fireflies --help` lists both.

Home: {home} (HERDR_APP_HOME picks another).
";

fn help(cmd: &str) -> String {
    HELP.replace("{cmd}", cmd).replace("{home}", &mods::app_dir().display().to_string())
}

/// The folder tests put their scratch data in: `HERDR_TEST_TMPDIR` if set, else /var/tmp.
#[cfg(test)]
fn test_tmp() -> std::path::PathBuf {
    std::env::var_os("HERDR_TEST_TMPDIR").map_or_else(|| "/var/tmp".into(), Into::into)
}

/// A Windows window app has no console: answers to `herdr-app ls` and the
/// like go to the terminal it was started from. Output already piped (agents,
/// scripts) keeps its pipes.
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE};
    // Attaching would point the output at the console instead of the pipe or file.
    let out = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if out.is_null() || out == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    }
}

fn link_check_path(args: &[String]) -> Option<&std::path::Path> {
    let mut paths = args.iter().filter(|arg| !matches!(arg.as_str(), "--print-spec" | "--watch" | "--dev"));
    let path = paths.next()?;
    (!path.starts_with('-') && paths.next().is_none()).then(|| std::path::Path::new(path))
}

fn main() {
    let raw: Vec<std::ffi::OsString> = std::env::args_os().collect();
    #[cfg(windows)]
    if raw.len() > 1 {
        attach_console();
    }
    // `fireflies` / `ff`: hc's commands go to the core as they are.
    let (name, args) = match cli::route(&raw) {
        cli::Route::Core(args) => std::process::exit(cli::exec_core(&args)),
        cli::Route::Help => std::process::exit(cli::help(&help("fireflies app"))),
        cli::Route::App { name, args } => (name, args),
    };
    #[cfg(target_os = "macos")]
    macos_check::startup(&args);
    // `herdr-app check <mod>` / `herdr-app types <mod>`: gpui-shell's own checker, with Fireflies' module installed.
    if matches!(args.get(1).map(String::as_str), Some("check" | "types")) {
        // HERDR: beside the typings, the mods' libraries (@fireflies/*) as this build serves them.
        if args.get(1).map(String::as_str) == Some("types")
            && let Some(dir) = args.iter().skip(2).rfind(|a| !a.starts_with('-'))
            && let Err(e) = mods::write_library_types(std::path::Path::new(dir))
        {
            eprintln!("herdr-app types: the mods' libraries were not written: {e}");
        }
        mods::install_check_policy();
        if args[1] == "check" && let Some(path) = link_check_path(&args[2..]) {
            let dir = if path.is_file() { path.parent().unwrap_or(path) } else { path };
            match mods::check_link_mod(dir) {
                Ok(true) if dir.join("link.js").is_file() && !dir.join("main.js").is_file() => {
                    println!("check passed: {}", dir.display());
                    return;
                }
                Ok(_) => {}
                Err(error) => {
                    eprintln!("herdr-app check: {error:#}");
                    std::process::exit(1);
                }
            }
        }
        gpui_shell::host::main_with_components(gpui_shell::FrozenComponentRegistry::default());
        return;
    }
    if matches!(args.get(1).map(String::as_str), Some("do" | "status" | "ls" | "commands" | "feedback" | "shot")) {
        std::process::exit(control::client(&args[1..]));
    }
    // Anything else from a shell answers in the shell; only a bare launch opens the window.
    match args.get(1).map(String::as_str) {
        // Already open on this home: that window comes to the front.
        None if control::raise_running() => return,
        None => {}
        Some("-h" | "--help" | "help") => return print!("{}", help(name)),
        Some("--skill") => return print!("{}", include_str!("SKILL.md")),
        Some("-V" | "--version" | "version") => {
            return println!("{} {}", name.split(' ').next().unwrap_or(name), env!("CARGO_PKG_VERSION"));
        }
        Some(other) => {
            eprint!("{name}: unknown argument {other:?}\n\n{}", help(name));
            std::process::exit(2);
        }
    }

    #[cfg(target_os = "macos")]
    core_bin::fill_path();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("HERDR_APP_LOG")
                .unwrap_or_else(|_| "warn,herdr_app=info,gpui_shell=info".into()),
        )
        .init();
    // Herdr's ~/.config/herdr-app and ~/.cache/herdr-app move to Fireflies' own, once.
    paths::migrate();

    update::leave_install_folder();
    if update::apply_on_startup() {
        return;
    }

    // A first start sizes the app to the screen and the system's text size.
    let fresh = !settings::path().exists();
    // The core people installed; without one, the setup screen installs it.
    let person = settings::load_person();
    let configured = person.as_ref().ok().and_then(|p| p.core.clone());
    let core: Result<std::sync::Arc<hc::Core>, setup::Need> = match core_bin::find(configured.as_deref()) {
        None => Err(setup::Need::Install),
        Some(bin) => {
            core_bin::use_core(bin);
            match hc::Core::connect() {
                // One that can't serve this app gets the screen that fixes it.
                Ok(core) => hc::check(&core.hello).map(|()| core).map_err(setup::Need::Fix),
                Err(e) => {
                    eprintln!("herdr-app: {e:#}");
                    Err(setup::Need::connection(e))
                }
            }
        }
    };
    #[cfg(target_os = "macos")]
    core_bin::install_cli_link();
    if let Ok(core) = &core {
        update::after_update(core.clone());
    }
    update::start();
    bench::start();
    // Usage data and uploaded feedback are gone: drop what earlier versions
    // kept for them (install id, unsent reports, feedback screenshots).
    let _ = std::fs::remove_dir_all(mods::app_dir().join("telemetry"));
    let _ = std::fs::remove_dir_all(mods::app_dir().join("data").join("frame-feedback"));
    if let Err(e) = mods::write_workspace() {
        eprintln!("herdr-app: cannot write {}: {e}", mods::app_dir().display());
    }

    gpui_platform::application()
        // Mods run programs already; the user's own links (dotfiles, Nix) may point out.
        .with_assets(gpui_shell::AppAssets::new(mods::app_dir()).following_links())
        .run(move |cx| {
            let fonts = settings::BUNDLED_FONTS.iter().map(|f| std::borrow::Cow::Borrowed(*f)).collect();
            if let Err(e) = cx.text_system().add_fonts(fonts) {
                tracing::warn!("bundled fonts not loaded: {e:#}");
            }
            settings::note_fonts(cx.text_system().all_font_names());
            settings::load_home_fonts(cx);
            mods::init(cx);
            // Not restarted for it: the update goes in when the app quits.
            cx.on_app_quit(|cx| {
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(250);
                // Where the window was, for the next start (a quit never asks the window).
                for w in cx.windows() {
                    if let Some(w) = w.downcast::<window::AppWindow>() {
                        let _ = w.update(cx, |this, window, cx| {
                            this.drain_documents(window, cx);
                            this.close_mods_now(deadline, window, cx);
                            place::save(window, cx);
                        });
                    }
                }
                mods::finish_shared();
                let _ = update::apply();
                async {}
            })
            .detach();
            #[cfg(target_os = "macos")]
            macos::init(cx);
            if fresh {
                let width = cx.primary_display().map(|d| f32::from(d.bounds().size.width));
                let zoom = settings::first_zoom(width);
                if zoom != 1.0 {
                    let _ = settings::write_person(&settings::Person { zoom, ..Default::default() });
                }
            }
            let requests = mods::install_policy();
            if let Some(tx) = mods::request_sender() {
                control::listen(tx);
            }
            match core {
                Ok(core) => open_main(core, requests, cx),
                Err(need) => setup::open(need, requests, cx),
            }
        });
}

/// The main window, on a connected core.
pub fn open_main(core: std::sync::Arc<hc::Core>, requests: async_channel::Receiver<mods::Request>, cx: &mut App) {
            let (window_bounds, display_id) = place::initial(cx);
            let options = WindowOptions {
                window_bounds: Some(window_bounds),
                display_id,
                // macOS: always see-through, so a layout can draw its own title bar
                // live; the app drags the window (window/titlebar.rs).
                titlebar: Some(TitlebarOptions {
                    title: Some("Fireflies".into()),
                    // Windows: hidden for good (it can't change live); the app draws it.
                    appears_transparent: cfg!(any(target_os = "macos", windows)),
                    traffic_light_position: cfg!(target_os = "macos").then(|| point(px(12.0), px(7.0))),
                }),
                app_owns_titlebar_drag: cfg!(target_os = "macos"),
                // Linux: open with the title bar the shipped layouts draw. Turning the
                // system's off on the first render, while KWin maps the window, shrinks
                // it to 20x20; turning it on later (a "system" layout) is fine.
                window_decorations: Some(WindowDecorations::Client),
                // Herdr Dev and other side-by-side builds get their own dock icon.
                app_id: Some(std::env::var("HERDR_APP_ID").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "herdr-app".into())),
                ..Default::default()
            };
            // Linux and Windows name the app's system notifications by it
            // (window/sysnote.rs); macOS takes the bundle's.
            if let Some(id) = &options.app_id {
                cx.set_app_identity(id, "Fireflies");
            }
            cx.open_window(options, |window, cx| cx.new(|cx| window::AppWindow::new(core, requests, window, cx)))
                .expect("cannot open the Fireflies window");
            cx.activate(true);
}
