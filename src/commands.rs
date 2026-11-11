//! Every command the app runs, defined once. Keys, menus, mods and
//! `herdr-app do` all run these; key checks, `herdr-app commands` and the docs come
//! from this list. Mods' own commands are `<mod>.<command>`.

use serde_json::{Value, json};

pub struct Arg {
    pub name: &'static str,
    pub required: bool,
}

pub struct Command {
    pub name: &'static str,
    pub args: &'static [Arg],
    pub about: &'static str,
}

const fn req(name: &'static str) -> Arg {
    Arg { name, required: true }
}

const fn opt(name: &'static str) -> Arg {
    Arg { name, required: false }
}

const fn cmd(name: &'static str, args: &'static [Arg], about: &'static str) -> Command {
    Command { name, args, about }
}

pub const COMMANDS: &[Command] = &[
    // What exists.
    cmd("space.new", &[opt("name"), opt("folder"), opt("tab"), opt("argv"), opt("task"), opt("machine")],
        "Make a space: its name (default: none, so it's called after where its first terminal is), the folder its terminals start in (default: the focused terminal's), its first tab's name (default: none, so it's called by its number), optionally an agent (argv) and its first message (task), and the machine it lives on (`hc machine ls`; default the focused space's machine for keys and clicks, this computer for scripts; empty string: this computer; its terminals start in that machine's home unless folder)."),
    cmd("space.close", &[opt("id"), opt("confirmed")], "Close a space and end its terminals (asks first unless confirmed)."),
    cmd("space.rename", &[opt("id"), opt("name")], "Rename a space (asks the person when no name; an empty name: called after where its first terminal is again)."),
    cmd("space.move", &[req("id"), req("index")], "Move a space to a position (1 = first)."),
    cmd("space.folder", &[req("folder"), opt("id")], "Attach a space (default: the selected one) to a folder: where its terminals start when none is focused, and the repo its GitHub and lazygit panes use."),
    cmd("tab.new", &[opt("name"), opt("space"), opt("folder"), opt("argv"), opt("task"), opt("mod"), opt("props")],
        "Make a tab in a space (default: the selected one; name default: none, so it's called by its number) with a terminal in folder (default: the focused terminal's), optionally an agent (argv) and its first message (task); or with a mod as its only pane (`mod`, its `props`: a file, a board). With no space open, a person's new tab starts a space (as space.new)."),
    cmd("tab.close", &[opt("id"), opt("confirmed")], "Close a tab and end its terminals. While something runs there (an agent working or needing you, a program other than the shell in front) it asks the person first, and a script must pass confirmed: true."),
    cmd("tab.rename", &[opt("id"), opt("name")], "Rename a tab (asks the person when no name; an empty name: called by its number again)."),
    cmd("tab.move", &[req("id"), req("index")], "Move a tab to a position in its space (1 = first)."),
    cmd("pane.split", &[opt("direction"), opt("pane"), opt("argv"), opt("mod"), opt("props"), opt("folder"), opt("edge"), opt("px"), opt("tab")],
        "Split a pane (default: the focused one) \"right\", \"down\", \"left\", \"up\" or \"auto\" (below a pane beside others, right of one stacked or alone) with a new terminal (in folder), or with a mod (`mod`, its `props`) beside it. Or edge (\"right\", \"left\", \"top\", \"bottom\") instead of direction: the new pane along that side of a whole tab (default: the shown one), px wide or tall if given."),
    cmd("pane.close", &[opt("pane")], "Close a pane and end its terminal."),
    cmd("terminal.open", &[opt("argv"), opt("folder"), opt("place"), opt("name"), opt("pane"), opt("view"), opt("show")], "Start a terminal: as a new tab (place \"tab\", default), \"right\"/\"down\"/\"left\"/\"up\"/\"auto\" of a pane (default: the focused one), or \"float\": without a pane, floating over the tab (view {mod, props?, name?}: a second view in the float, a mod; show 0 or 1: which one shows first)."),
    cmd("terminal.keep", &[req("terminal"), opt("place"), opt("pane")], "Give a running terminal without a pane (a sub-agent) a pane: a new tab, or \"right\"/\"down\"/\"left\"/\"up\"/\"auto\" of a pane (default: the focused one)."),
    cmd("terminal.park", &[req("terminal")], "Take a terminal's pane away and disable core keep; it keeps running (a sub-agent shows under its parent again)."),
    cmd("terminal.right_click", &[req("to"), opt("terminal")], "Where right-clicks in a terminal (default: the focused one) go when its program takes the mouse: \"program\" or \"menu\" (Herdr's, the default). Shift+right-click is always the menu."),
    cmd("terminal.pin", &[req("terminal"), req("pinned")], "Pin an agent to the top of the agent lists (pinned true) or unpin it (false). Pins are kept with the terminal, so every Herdr client shows them, and end with it."),
    cmd("terminal.kill", &[req("terminal")], "End a terminal and its sub-agents."),
    // What you see.
    cmd("space.select", &[opt("index"), opt("id")], "Show a space (by position or id)."),
    cmd("space.next", &[], "Show the next space."),
    cmd("space.prev", &[], "Show the previous space."),
    cmd("tab.select", &[opt("index"), opt("id")], "Show a tab (by position in the space, or id)."),
    cmd("tab.settle", &[opt("id")], "Put a tab away on this screen (default: the shown one): out of the lists, still running. It comes back when shown or when an agent in it needs you."),
    cmd("tab.unsettle", &[opt("id")], "Bring a settled tab back to the lists."),
    cmd("tab.next", &[], "Show the next tab."),
    cmd("tab.prev", &[], "Show the previous tab."),
    cmd("pane.zoom", &[opt("pane")], "Show only this pane of its tab, or all again."),
    cmd("pane.font_bigger", &[opt("pane")], "Make this pane's terminal text bigger (default: the focused pane), on top of the app's zoom."),
    cmd("pane.font_smaller", &[opt("pane")], "Make this pane's terminal text smaller (default: the focused pane)."),
    cmd("pane.font_reset", &[opt("pane")], "Back to the app's terminal text size in this pane (default: the focused pane)."),
    cmd("pane.float", &[opt("pane")], "Float a pane's terminal over the tab (default: the focused pane): its pane goes (as terminal.park), it keeps running."),
    cmd("pane.park", &[opt("pane"), opt("index")], "Park a pane in its tab's bottom row (default: the focused pane): out of the arrangement as a small chip, still running, kept across restarts. A tab keeps one pane in place. A parked pane with index: moves its chip to that spot in the row (1 = first). Unlike terminal.park, it stays in its tab."),
    cmd("pane.unpark", &[opt("pane"), opt("target"), opt("edge")], "Put a parked pane back into its tab and focus it (default: the shown tab's last parked one): where it was parked from, or beside target (a pane of its tab) on edge \"right\", \"left\", \"top\" or \"bottom\"; target without edge: in target's place, target parked instead. Clicking its chip or focusing the pane brings it back too."),
    cmd("pane.focus", &[opt("pane"), opt("terminal")], "Focus a pane (or the pane showing a terminal)."),
    cmd("pane.go", &[req("direction")], "Focus the pane or focusable mod to the \"left\", \"right\", \"up\" or \"down\"."),
    cmd("pane.swap", &[opt("direction"), opt("pane"), opt("target")], "Swap a pane (default: the focused one) with its neighbor in a direction, or with another pane of its tab (target). Give exactly one of direction or target."),
    cmd("pane.move", &[opt("pane"), opt("tab"), opt("target"), opt("edge"), opt("space"), opt("name")],
        "Move a pane (default: the focused one; a terminal keeps running, a parked one too) to another tab, any space on its machine: tab (an id), beside target (a pane there; target alone names its tab) on edge \"right\", \"left\", \"top\" or \"bottom\", else beside that tab's focused pane. No tab or target: its own new tab (name) in space (default: its space). The tab it leaves closes when it was its last pane. Then shows it there."),
    cmd("pane.equalize", &[opt("scope"), opt("pane")], "Give panes even shares of their tab (default: the focused pane's): scope \"all\" (default: every row and column), \"row\" (the panes side by side with this one) or \"column\" (the panes stacked with it). Fixed px sizes stay."),
    cmd("terminal.peek", &[req("terminal"), opt("float"), opt("view"), opt("show")], "Peek at a running terminal over the tab, with keep-as-tab, dock-right and close controls (float true: as a floating terminal, bigger; view and show as terminal.open's float; the one floating already just shows `show`)."),
    cmd("float.view", &[req("index")], "Show the floating terminal's view 0 (the terminal) or 1 (its view's mod) and give it the keyboard (a mod only when its mod.json says focusable)."),
    cmd("terminal.show", &[opt("terminal"), opt("pane")], "Show a terminal in a pane for now, in place of its own (no terminal: back)."),
    cmd("terminal.copy", &[], "Copy the focused terminal's selection. With nothing selected, that key goes to the program."),
    cmd("terminal.scroll", &[opt("lines"), opt("pages"), opt("to"), opt("terminal")], "Scroll a terminal's view of its history (default: the focused one). Give exactly one of: lines (a whole number; negative goes up, toward history), pages (a number, fractions allowed; one page is the terminal's rows), to: \"top\" (oldest history) or \"bottom\" (the live screen). This scrolls Herdr's view, not the program."),
    cmd("terminal.paste", &[], "Paste into the focused terminal (copied files as if dropped; an image alone as terminal.paste_image pastes it)."),
    cmd("terminal.paste_image", &[], "Ctrl+V: the clipboard's image as a file on the focused terminal's machine, when that's another one; on Windows, paste clipboard text; otherwise Ctrl+V goes to the terminal."),
    cmd("terminal.search", &[], "Search the focused terminal's screen and scrollback; the find bar and query stay with that terminal."),
    cmd("agent.focus", &[req("terminal")], "Show an agent (sub-agents too)."),
    cmd("agent.next", &[], "Show the next agent, in the order the agents list shows them."),
    cmd("agent.prev", &[], "Show the previous agent."),
    cmd("layout.switch", &[opt("name")], "Show a layout (layouts/<name>.json), or the next one."),
    cmd("layout.clone", &[req("name"), opt("as")], "Duplicate a layout as <name>-copy (or as), then show it."),
    cmd("mod.clone", &[req("name"), opt("as")], "Duplicate a mod as <name>-copy (or as)."),
    cmd("layout.set", &[req("layout")], "Replace a personal layout tree; shipped layouts accept only click/look fields (not structure)."),
    cmd("layout.toggle", &[req("id")], "Hide or show a layout node."),
    cmd("layout.show", &[req("id")], "Show a layout node."),
    cmd("layout.hide", &[req("id")], "Hide a layout node."),
    cmd("layout.resize", &[req("id"), opt("px"), opt("weight")], "Size a layout node."),
    cmd("layout.select", &[req("stack"), req("child")], "Show one child of a stack."),
    cmd("layout.reset", &[opt("name")], "Reset a shipped layout and its clicks (the old file is kept aside)."),
    cmd("mod.open", &[req("name")], "Toggle a mod as the overlay its mod.json describes; calling again closes it."),
    cmd("overlay.close", &[opt("id")], "Close an overlay (default: the top dialog or popup)."),
    cmd("overlay.resizable", &[req("id"), req("resizable")], "Change how a window resizes (min, aspect, chrome); a new aspect refits its height now."),
    // The app.
    // Native content views (native-view/0).
    cmd("native.debug", &[], "Every native view: frame, visibility, focus, content state and recent events."),
    cmd("native.call", &[req("key"), req("action"), opt("args")], "Run one whitelisted action on a native view (key: <copy>:<id>)."),
    cmd("app.help", &[], "Toggle the keys dialog."),
    cmd("app.welcome", &[], "Show the welcome again."),
    cmd("app.open_url", &[req("url"), opt("in")], "Open a web page (http or https) in a web pane beside the focused pane (in \"app\") or the system's browser (in \"system\"); default: settings.json links."),
    cmd("markdown.open", &[req("path"), opt("anchor"), opt("in"), opt("pane"), opt("on")], "Open a Markdown file in the viewer (nocturne-markdown) beside the pane (default: the focused one), or the viewer already showing it there; anchor: a heading to scroll to; in \"system\": the system's app. A relative path is the pane's folder's; on: the machine the file is on."),
    cmd("preview.open", &[req("path"), opt("in"), opt("pane"), opt("on")], "Open a file you look at but don't edit (a picture, PDF, CSV/TSV, SQLite database, patch; on macOS also fonts, audio, video) in the preview (nocturne-preview) beside the pane (default: the focused one), or the preview already showing it there; in \"system\": the system's app. A relative path is the pane's folder's; on: the machine the file is on."),
    cmd("image.open", &[req("path"), opt("in"), opt("pane"), opt("on")], "The same as preview.open (its name when the preview showed pictures only)."),
    cmd("app.whats_new", &[], "Show what this release brought (it opens once by itself after an update)."),
    cmd("app.feedback", &[opt("message"), opt("from")], "Draft feedback as a GitHub issue for the person to review, open and submit there (from: person or agent)."),
    cmd("app.palette", &[], "Toggle the command palette: every command by name, with its key; calling again closes it."),
    cmd("app.settings", &[opt("section")], "Open the settings (section: look, alerts, updates)."),
    cmd("app.check_updates", &[], "Look for a newer Herdr and herdr-core now."),
    cmd("app.update_core", &[], "Update herdr-core to its latest release of this generation; terminals keep running."),
    cmd("app.reset", &[], "The escape hatch: set the shown layout and keys aside, back to the default screen."),
    cmd("app.theme", &[req("name")], "Use a theme (a preset or themes/<name>.json)."),
    cmd("app.zoom_in", &[], "Make everything bigger."),
    cmd("app.zoom_out", &[], "Make everything smaller."),
    cmd("app.zoom_reset", &[], "Back to normal size."),
    cmd("app.update", &[], "Restart into the update Herdr downloaded (your terminals keep running)."),
    cmd("app.quit", &[], "Quit (macOS)."),
    cmd("app.hide", &[], "Hide the app (macOS)."),
    cmd("app.hide_others", &[], "Hide other apps (macOS)."),
    cmd("app.show_all", &[], "Show all apps (macOS)."),
    cmd("window.close", &[], "Close the window (on Linux, quits)."),
    cmd("window.minimize", &[], "Minimize the window."),
    cmd("window.maximize", &[], "Maximize the window, or back."),
];

pub fn find(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|c| c.name == name)
}

/// A key's `name:value` shorthand: the value fills the first argument (a
/// number fills `index` when there is one).
pub fn shorthand(c: &Command, value: &str) -> Value {
    let index = value.parse::<u64>().ok().filter(|_| c.args.iter().any(|a| a.name == "index"));
    match (index, c.args.first()) {
        (Some(i), _) => json!({ "index": i }),
        (None, Some(a)) => json!({ a.name: value }),
        (None, None) => Value::Null,
    }
}

/// Reject misspelled arguments before a command can use its current-target default.
/// Null is the argument-free form used by keys and mods.
pub fn validate_args(c: &Command, args: &Value) -> Result<(), String> {
    let valid = if c.args.is_empty() { "none".into() } else { c.args.iter().map(|a| a.name).collect::<Vec<_>>().join(", ") };
    match args {
        Value::Null => Ok(()),
        Value::Object(args) => {
            let unknown: Vec<_> = args.keys().filter(|key| !c.args.iter().any(|a| a.name == key.as_str())).map(String::as_str).collect();
            if !unknown.is_empty() {
                return Err(format!("{}: unknown argument(s): {}; valid arguments: {valid}", c.name, unknown.join(", ")));
            }
            for (key, value) in args {
                if matches!(key.as_str(), "id" | "pane" | "space" | "terminal" | "target") && !value.is_string() && !value.is_null() {
                    return Err(format!("{}: argument {key} must be a string (or null to omit it)", c.name));
                }
            }
            Ok(())
        }
        _ => Err(format!("{}: arguments must be an object; valid arguments: {valid}", c.name)),
    }
}

/// The first required argument that's missing (an empty string counts as missing).
pub fn missing(c: &Command, args: &Value) -> Option<&'static str> {
    c.args.iter().filter(|a| a.required).map(|a| a.name).find(|k| match args.get(k) {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        _ => false,
    })
}

/// The list as data, for `herdr-app commands` and mods.
pub fn listing() -> Value {
    Value::Array(
        COMMANDS
            .iter()
            .map(|c| {
                let args: Vec<Value> = c.args.iter().map(|a| json!({ "name": a.name, "required": a.required })).collect();
                json!({ "name": c.name, "args": args, "about": c.about })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The guide agents read (written to the home folder) names every command.
    #[test]
    fn the_guide_names_every_command() {
        let guide = include_str!("../defaults/AGENTS.md");
        let missing: Vec<&str> = COMMANDS.iter().map(|c| c.name).filter(|n| !guide.contains(&format!("`{n}"))).collect();
        assert!(missing.is_empty(), "defaults/AGENTS.md (## Commands) doesn't name: {missing:?}");
    }

    #[test]
    fn unknown_arguments_are_rejected_for_every_command() {
        for c in COMMANDS {
            let error = validate_args(c, &json!({ "typo": "target" })).unwrap_err();
            assert!(error.contains(c.name), "{error}");
            assert!(error.contains("unknown argument(s): typo"), "{error}");
            assert!(error.contains("valid arguments:"), "{error}");
            assert!(validate_args(c, &Value::Null).is_ok());
            assert!(validate_args(c, &json!({})).is_ok());
            assert!(validate_args(c, &json!(["target"])).is_err());
            let args: serde_json::Map<String, Value> = c.args.iter().map(|a| (a.name.into(), json!("target"))).collect();
            assert!(validate_args(c, &Value::Object(args)).is_ok());
        }
        let close = find("space.close").unwrap();
        assert_eq!(validate_args(close, &json!({"space": "X", "confirmed": true})),
            Err("space.close: unknown argument(s): space; valid arguments: id, confirmed".into()));
        assert!(validate_args(close, &json!({"id": "X", "confirmed": true})).is_ok());
    }

    #[test]
    fn malformed_targets_cannot_fall_back_to_the_current_work() {
        for (name, arg) in [("tab.close", "id"), ("pane.close", "pane"), ("space.close", "id"), ("tab.new", "space"), ("terminal.show", "terminal"), ("pane.swap", "pane"), ("pane.swap", "target")] {
            let c = find(name).unwrap();
            for value in [json!(123), json!(false), json!([]), json!({"id": "target"})] {
                let error = validate_args(c, &json!({arg: value})).unwrap_err();
                assert!(error.contains(name) && error.contains(arg), "{error}");
            }
            // Null keeps its existing omitted-argument meaning for optional targets.
            for value in [Value::Null, json!("target")] {
                assert!(validate_args(c, &json!({arg: value})).is_ok());
            }
        }
    }

    #[test]
    fn names_are_unique_and_shorthand_fills_the_first_argument() {
        let mut names: Vec<&str> = COMMANDS.iter().map(|c| c.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), COMMANDS.len());
        assert_eq!(shorthand(find("tab.select").unwrap(), "3"), json!({ "index": 3 }));
        assert_eq!(shorthand(find("pane.split").unwrap(), "right"), json!({ "direction": "right" }));
        assert_eq!(shorthand(find("pane.split").unwrap(), "auto"), json!({ "direction": "auto" }));
        let move_ = find("space.move").unwrap();
        assert_eq!(missing(move_, &json!({ "id": " ", "index": 1 })), Some("id"));
        assert_eq!(missing(move_, &json!({ "id": "sp1", "index": 1 })), None);
        assert_eq!(shorthand(find("space.folder").unwrap(), "/src/api"), json!({ "folder": "/src/api" }));
        assert_eq!(missing(find("space.folder").unwrap(), &json!({ "id": "sp1" })), Some("folder"));
        // Names are optional: none is Herdr's automatic one.
        assert_eq!(missing(find("space.new").unwrap(), &json!({})), None);
    }
}
