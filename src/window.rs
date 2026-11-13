//! The window. The chrome (`layouts/<name>.json`) is a tree of the locked
//! primitives; a `{ "tab": "active" }` block shows the selected
//! tab's terminals as it arranges them. Every visible part that isn't a
//! terminal is a mod. Commands (commands.rs) are the one way to change
//! anything: keys, mods, menus and agents all run them.

use crate::hc::Core;
mod floats;
mod movable;
mod pane_drag;
mod parking;
mod pane_size;
mod titlebar;

use crate::layout::{Axis, Background as Paint, Content, Fit, HeaderContent, Kind, Line, Node, PaneFrame, Size as Span};
use crate::model::{self, Tab, Model};
use crate::mods::{self, Found, Instance, Request};
use crate::settings;
use crate::layout_sync;
use crate::links::Viewer;
use crate::terminal::{TerminalEvent, TerminalView, scroll_target};
use gpui::prelude::FluentBuilder as _;
use gpui::*;
use gpui_shell::action::ShellAction;
use gpui_shell::{ShellRoot, ShellRuntime, Watcher};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

const HEADER_HEIGHT: f32 = 30.0;
const HANDLE: f32 = 6.0;

// The three native buttons plus their trailing breathing room (also used by the tabs mod).
const TRAFFIC_LIGHT_WIDTH: f32 = 64.0;

fn traffic_light_divider_inset(n: &Node, axis: Axis, index: usize, macos: bool, zoom: f32) -> f32 {
    if !macos || axis != Axis::Row || n.titlebar != Some(crate::layout::Titlebar::Layout) {
        return 0.0;
    }
    let Some([x, _]) = n.traffic_lights else { return 0.0 };
    let shown: Vec<_> = n.children().iter().filter(|child| !child.hidden).collect();
    let mut edge = n.padding.map_or(0.0, |padding| padding.axes().1)
        + index as f32 * (n.gap.unwrap_or(0.0) + n.divider.as_ref().map_or(0.0, |line| line.width));
    for child in shown.iter().take(index + 1) {
        let Some(Span::Px { px }) = child.size else { return 0.0 };
        edge += px;
    }
    if edge * zoom < x || edge * zoom > x + TRAFFIC_LIGHT_WIDTH {
        return 0.0;
    }
    // Keep the toolbar continuous above the rail; the divider starts with the content.
    shown.iter().skip(index).take(2).filter_map(|column| {
        let header = column.children().iter().find(|child| !child.hidden)?;
        match header.size {
            Some(Span::Px { px }) if header.window_drag => Some(px),
            _ => None,
        }
    }).reduce(f32::min).unwrap_or(0.0)
}

fn separator_line(row: bool, width: f32, color: Hsla, top: f32) -> Div {
    div().bg(color)
        .when(row, |d| d.w(px(width)))
        .when(row && top == 0.0, |d| d.h_full())
        .when(row && top > 0.0, |d| d.absolute().top(px(top)).bottom_0())
        .when(!row, |d| d.h(px(width)).w_full())
}

/// A window or popup opened with `scrim: true` sits on the dialog dim
/// (dialogs always do; toasts never; a popup from a button doesn't ask).
fn window_scrim(kind: OverlayKind, spec: &Value) -> bool {
    matches!(kind, OverlayKind::Window | OverlayKind::Popup) && spec.get("scrim").and_then(Value::as_bool) == Some(true)
}

/// The command palette: a popup hanging from the top, on the dialog dim when
/// the layout has a `scrim` of its own (it's modal, like a dialog).
fn palette_spec(layout_scrim: bool) -> Value {
    let mut spec = json!({ "mod": "frame-palette", "kind": "popup", "at": "top", "offset": 60, "width": 620, "height": 0.85 });
    if layout_scrim {
        spec["scrim"] = json!(true);
    }
    spec
}

/// The solid floor under a dithered scrim (its `fill`), if it has one.
fn scrim_fill(s: Option<&crate::layout::Scrim>) -> Option<Hsla> {
    s.filter(|s| s.dither && s.fill > 0.0).map(|s| c(&s.color).opacity(s.fill.clamp(0.0, 1.0)))
}

/// A layer that dims what's under it as the layout's `scrim` says: its
/// `fill` (if any) under the checker, or the plain color.
fn scrim_layer(s: Option<&crate::layout::Scrim>, scale: f32) -> Div {
    div()
        .absolute()
        .inset_0()
        .when_some(scrim_fill(s), |d, fill| d.bg(fill))
        .child(div().absolute().inset_0().bg(scrim(s, scale)))
}

/// The dim behind a dialog: the layout's `scrim`, else black at 35%. A
/// dithered one counts device pixels (the checkerboard's cells are those).
fn scrim(s: Option<&crate::layout::Scrim>, scale: f32) -> Background {
    let Some(s) = s else { return hsla(0.0, 0.0, 0.0, 0.35).into() };
    let color = c(&s.color).opacity(s.opacity.clamp(0.0, 1.0));
    if s.dither {
        gpui::checkerboard(color, (s.cell * settings::zoom() * scale).round().max(1.0))
    } else {
        color.into()
    }
}

fn c(name: &str) -> Hsla {
    settings::color_or_literal(name)
}

fn file(name: &str) -> PathBuf {
    mods::app_dir().join(name)
}

fn is_dark(a: gpui::WindowAppearance) -> bool {
    matches!(a, gpui::WindowAppearance::Dark | gpui::WindowAppearance::VibrantDark)
}

/// A layout's theme after picking `name`: it takes the half of its own
/// lightness; the other half stays (a single theme of the other lightness
/// becomes that half).
fn with_theme(was: Option<crate::layout::ThemeChoice>, name: String) -> crate::layout::ThemeChoice {
    use crate::layout::ThemeChoice::{One, Pair};
    let light = settings::theme_is_light(&name);
    let (l, d) = match was {
        Some(Pair { light, dark }) => (light, dark),
        Some(One(x)) if settings::theme_is_light(&x) == light => return One(name),
        Some(One(x)) => (x.clone(), x),
        None => (settings::DEFAULT_LIGHT.into(), settings::DEFAULT_DARK.into()),
    };
    if light { Pair { light: name, dark: d } } else { Pair { light: l, dark: name } }
}

fn mtime(p: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(p).ok()?.modified().ok()
}

pub fn shell() -> String {
    if cfg!(windows) {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let pwsh = std::env::split_paths(&path).any(|d| d.join("pwsh.exe").is_file());
        return if pwsh { "pwsh.exe" } else { "powershell.exe" }.into();
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

fn unix_agent_argv(sh: String, cmd: Vec<String>, login: bool) -> Vec<String> {
    let fish = std::path::Path::new(&sh).file_name().and_then(|s| s.to_str()) == Some("fish");
    let script = match (fish, login) {
        (true, true) => "command $argv[2..]; exec $argv[1] -li",
        (true, false) => "command $argv[2..]; exec $argv[1] -i",
        (false, true) => "\"$@\"; exec \"$0\" -li",
        (false, false) => "\"$@\"; exec \"$0\" -i",
    };
    let mut run = vec![sh.clone(), if login { "-lic" } else { "-ic" }.into(), script.into(), sh];
    run.extend(cmd);
    run
}

fn launch_failure(record: &Value, output: &str) -> Option<String> {
    let code = record["exit_code"].as_i64().filter(|c| *c != 0)?;
    let elapsed = record["finished_ms"].as_u64()?.checked_sub(record["created_ms"].as_u64()?)?;
    if record["reason"].as_str() != Some("exited") || elapsed > 2000 {
        return None;
    }
    let lines = output.lines().filter(|l| !l.trim().is_empty()).collect::<Vec<_>>();
    let tail = lines[lines.len().saturating_sub(5)..].join("\n");
    Some(if tail.is_empty() { format!("Exit code {code}") } else { format!("Exit code {code}\n{tail}") })
}

/// The shipped layouts (defaults/layouts): `main` is Fireflies' window (spaces
/// sidebar, tab bar); `nocturne` is Fireflies' (its nocturne* mods).
const LAYOUTS: &[(&str, &str)] = &[
    ("main", include_str!("../defaults/layouts/main.json")),
    ("terminals", include_str!("../defaults/layouts/terminals.json")),
    ("win98", include_str!("../defaults/layouts/win98.json")),
    ("nocturne", include_str!("../defaults/layouts/nocturne.json")),
];

/// The layout a first start shows (Fireflies: Nocturne). `main` stays the
/// fallback when a layout's mods are gone and what the escape hatch restores.
const FIRST_LAYOUT: &str = "nocturne";

/// Pictures shipped layouts name as their `preview`, written beside them.
const LAYOUT_PREVIEWS: &[(&str, &str)] = &[
    ("win98.svg", include_str!("../defaults/layouts/win98.svg")),
    ("nocturne.svg", include_str!("../defaults/layouts/nocturne.svg")),
];

pub fn shipped_layouts() -> Vec<&'static str> {
    LAYOUTS.iter().map(|(n, _)| *n).collect()
}

fn shipped_layout(name: &str) -> &'static str {
    LAYOUTS.iter().find(|(n, _)| *n == name).unwrap_or(&LAYOUTS[0]).1
}

/// A layout as shipped (main for names Fireflies doesn't ship).
fn default_layout(name: &str) -> Node {
    serde_json::from_str(shipped_layout(name)).expect("defaults/layouts are valid")
}

fn layout_path(name: &str) -> PathBuf {
    file(&format!("layouts/{name}.json"))
}

/// Layout names on disk, in order: main first, then the rest alphabetically.
/// A layout whose mods are gone (Zen after the update) isn't offered;
/// `layout.switch {name}` still reaches it.
pub(crate) fn layout_names() -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(file("layouts"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json").map(str::to_owned))
        .filter(|n| missing_mods(n).is_empty())
        .collect();
    names.sort_by_key(|n| (n != "main", n.clone()));
    names
}

fn state_path(name: &str) -> PathBuf {
    file(&format!("layouts/.state/{name}.json"))
}

/// The clicks on a layout (layout_sync.rs), none if unreadable.
fn read_state(name: &str) -> layout_sync::State {
    std::fs::read_to_string(state_path(name)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn state_text(s: &layout_sync::State) -> String {
    serde_json::to_string_pretty(s).unwrap_or_default() + "\n"
}

/// Where to set `path` aside: `<path>.<tag>-<time>`, with `-2`, `-3` ... when
/// that's taken, so an older one is never replaced.
pub(crate) fn aside(path: &std::path::Path, tag: &str) -> PathBuf {
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    (1..).map(|i| path.with_file_name(if i == 1 { format!("{name}.{tag}-{stamp}") } else { format!("{name}.{tag}-{stamp}-{i}") })).find(|p| !p.exists()).unwrap_or_else(|| path.to_path_buf())
}

/// Writes through a temporary file and a rename, so a reader never sees half
/// a file. Says whether it worked.
fn write_atomic(path: &std::path::Path, text: &str) -> bool {
    match crate::persist::write_atomic(path, text) {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!("cannot write {}: {error}", path.display());
            false
        }
    }
}

/// The mods a layout file names that aren't in mods/ (frame mods are always there).
fn missing_mods(name: &str) -> Vec<String> {
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Object(o) => o.iter().for_each(|(k, v)| match v {
                Value::String(s) if k == "mod" => out.push(s.clone()),
                _ => walk(v, out),
            }),
            Value::Array(a) => a.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let Some(layout) = std::fs::read_to_string(layout_path(name)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return vec![] };
    let mut used = Vec::new();
    walk(&layout, &mut used);
    used.sort();
    used.dedup();
    used.retain(|m| !m.starts_with("frame-") && !mods::mods_dir().join(m).is_dir());
    used
}

fn install_layouts() {
    if let Err(e) = mods::sync_layouts(&mods::app_dir(), LAYOUTS) {
        tracing::warn!("cannot install layouts: {e}");
    }
    for (name, text) in LAYOUT_PREVIEWS {
        let _ = std::fs::write(file(&format!("layouts/{name}")), text);
    }
}

fn clone_layout(name: &str, to: &str) -> std::io::Result<()> {
    if !mods::valid_name(name) || !mods::valid_name(to) {
        return Err(std::io::Error::other("names use letters, digits, - or _"));
    }
    let mut node: Node = serde_json::from_str(&std::fs::read_to_string(layout_path(name))?)?;
    node.cloned_from = Some(crate::layout::ClonedFrom { name: name.into(), version: env!("CARGO_PKG_VERSION").into() });
    let text = layout_sync::text_of(&node);
    use std::io::Write;
    let mut dest = std::fs::OpenOptions::new().write(true).create_new(true).open(layout_path(to))?;
    let result = (|| {
        dest.write_all(text.as_bytes())?;
        mods::copy_layout_state(&mods::app_dir(), name, to)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(layout_path(to));
        let _ = std::fs::remove_file(state_path(to));
    }
    result
}

struct Term {
    view: Entity<TerminalView>,
    address: String,
    focus: FocusHandle,
    _sub: Subscription,
}

enum TerminalChange {
    Keep { space: String, tab: String, pane: String, name: String, target: Option<String>, dir: model::Direction },
    Park,
}

struct PendingTerminalChange {
    change: TerminalChange,
    reply: std::sync::mpsc::Receiver<Result<(), String>>,
}

/// The slot of a terminal shown in a pane in place of its own (`<pane>#swap`).
const SWAP: &str = "#swap";

struct Copy {
    inst: Instance,
    /// Its number for commands (`mods::prepare_load`); 0 if it never loaded.
    id: u64,
    root: Option<Entity<ShellRoot>>,
    _watch: Option<Watcher>,
    error: Option<String>,
    /// Its folder is gone (a removed or uninstalled mod): nothing to fix, only to close.
    missing: bool,
}

/// Counts overlays as they open (Overlay::opened).
static OVERLAYS_OPENED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Clone, Copy, PartialEq)]
enum OverlayKind {
    Dialog,
    Popup,
    Toast,
    /// Stays until closed, moves where it's dropped, comes to the front when
    /// pressed (`movable.rs`). Without a scrim it never holds the keyboard on
    /// its own; with one it's modal while it shows (`Overlay::holds_keys`).
    Window,
}

impl OverlayKind {
    /// Dialogs and popups hold the keyboard while open (Esc closes them).
    fn modal_keys(self) -> bool {
        matches!(self, OverlayKind::Dialog | OverlayKind::Popup)
    }
}

impl Overlay {
    /// It holds the keyboard over everything outside the overlays: a dialog or
    /// popup, or a window with a scrim (Git, GitHub), which is modal while it
    /// shows. No key reaches a pane or the layout behind it.
    fn holds_keys(&self) -> bool {
        self.kind.modal_keys() || (self.kind == OverlayKind::Window && self.scrim)
    }
}

/// A float's second view (`terminal.open {place: "float", view}`): a mod
/// shown in the float's body in place of the terminal (`float.view`).
#[derive(Clone, Debug)]
struct FloatView {
    name: String,
    props: Value,
    /// What it's called (default: the mod's name).
    label: Option<String>,
    /// What the terminal is called, when the caller knows better than `terminals()` yet.
    term: Option<String>,
}

impl FloatView {
    /// `view: {mod, props?, name?}`; null or missing: none.
    fn parse(v: Option<&Value>) -> Result<Option<FloatView>, String> {
        let Some(v) = v.filter(|v| !v.is_null()) else { return Ok(None) };
        let name = v.get("mod").and_then(Value::as_str).filter(|m| !m.is_empty()).ok_or("view is {mod, props?, name?}")?;
        Ok(Some(FloatView {
            name: name.to_owned(),
            props: v.get("props").cloned().unwrap_or(Value::Null),
            label: v.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()).map(str::to_owned),
            term: None,
        }))
    }

    fn same(&self, other: &FloatView) -> bool {
        (&self.name, &self.props, &self.label) == (&other.name, &other.props, &other.label)
    }
}

/// The floating terminal's views: which one shows, and what they're called.
struct FloatViews {
    view: FloatView,
    names: [String; 2],
    shown: usize,
}

/// The float's body: the terminal (view 0) and the mod (view 1), as a stack.
const FLOAT_BODY: &str = "float-body";
const FLOAT_CHILDREN: [&str; 2] = ["float-term", "float-view"];

/// `show: 0 | 1` (default 0).
fn float_show(a: &Value) -> Result<usize, String> {
    match a.get("show").filter(|v| !v.is_null()) {
        None => Ok(0),
        Some(v) => v.as_u64().filter(|i| *i <= 1).map(|i| i as usize).ok_or_else(|| format!("show is 0 (the terminal) or 1 (the view), not {v}")),
    }
}

struct Overlay {
    id: String,
    kind: OverlayKind,
    slot: String,
    at: Point<Pixels>,
    /// As designed; drawn at the current zoom. Up to 1: a share of the window.
    size: Size<f32>,
    expires: Option<Instant>,
    focus: FocusHandle,
    /// Blocks instead of one mod (terminals too), ids prefixed with the overlay's.
    layout: Option<Node>,
    /// `at: "top"`: centered, this far below the window's top.
    top: Option<f32>,
    /// As tall as its content (size.height is the most).
    fit: bool,
    /// A click beside it doesn't close it (the first-run welcome).
    modal: bool,
    /// `frame: "none"`: no border, corners, shadow or background; the mod draws its own.
    bare: bool,
    /// A window or popup with `scrim: true`: the layout's dialog dim behind it; a click on it closes it.
    scrim: bool,
    /// A window: where its top left is (None: centered) and its name (`key`).
    place: Option<Point<Pixels>>,
    /// When it opened, for `overlay.focus`'s order (pressing reorders `overlays`).
    opened: u64,
    key: Option<String>,
    /// A window people can resize by its edges (`resizable`).
    resize: Option<movable::Resize>,
    /// Its terminal blocks that nothing else showed when it opened, and the
    /// size each had then (block, address, cols, rows): given back as it
    /// closes, so a small window doesn't leave its terminal small.
    sizes: Vec<(String, String, u16, u16)>,
    /// The app's own screen (a `frame-` mod: What's new, the welcome): only
    /// its own close ends it, never a layout switch.
    frame: bool,
    /// A dialog or popup: the window that held the keyboard when it opened,
    /// which gets it back when it closes (the palette over the GitHub window).
    back_to: Option<String>,
}

struct Drag {
    container: String,
    index: usize,
    axis: Axis,
}

#[derive(Default)]
struct Watched {
    settings: Option<SystemTime>,
    keys: Option<SystemTime>,
    programs: Option<SystemTime>,
}

pub struct AppWindow {
    core: Arc<Core>,
    runtime: Option<Rc<ShellRuntime>>,
    chrome: Node,
    /// Which layout `chrome` is (`layouts/<name>.json`).
    layout_name: String,
    /// The agent an `{ "agent": "focused" }` block shows (by address); any core
    /// terminal, so sub-agents outside workspaces work too.
    agent: Option<String>,
    /// The agent view that has the keyboard, so it's only taken on change.
    agent_focused: Option<String>,
    /// Panes showing another terminal for now (pane → address), e.g. a sub-agent
    /// looked at in place of its parent. Not saved; the pane keeps its own.
    swapped: HashMap<String, String>,
    /// The terminal floating over the tab (`terminal.open {place: "float"}`,
    /// `pane.float`): shown in the `terminal-peek` overlay, without a pane.
    floating: Option<String>,
    /// The float's two views (`view`): its body a stack of the terminal and a mod.
    float_views: Option<FloatViews>,
    float_drag: Option<floats::FloatDrag>,
    pane_drag: Option<pane_drag::PaneDrag>,
    pane_grip_hover: Option<String>,
    /// The parking row chip under the pointer (parking.rs).
    chip_hover: Option<String>,
    /// Each pane's top row the grip sits centered in: its top header, else a strip.
    pane_grip_rows: RefCell<HashMap<String, f32>>,
    /// A window (`kind: "window"` overlay) being pressed or dragged.
    win_drag: Option<movable::WinDrag>,
    float_anims: HashMap<String, floats::FloatAnim>,
    float_reveal: HashMap<String, floats::Reveal>,
    float_hover: HashSet<String>,
    /// Bumped on every hover change, so a delayed leave knows it's still current.
    float_leave: HashMap<String, u64>,
    model: Model,
    /// Terminal views by block id (panes and chrome terminal blocks).
    terms: HashMap<String, Term>,
    /// Mod copies by slot (block id, `<stack>#header`, or `overlay:<id>`).
    copies: HashMap<String, Copy>,
    overlays: Vec<Overlay>,
    folders: BTreeMap<String, Found>,
    /// Mods placed once; later the layout decides where (or whether) they show.
    seen: BTreeSet<String>,
    bounds: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    hidden_fit: pane_size::HiddenFit,
    /// The hidden-tab size prediction disagreed with a pane on screen (logged once).
    hidden_fit_warned: std::cell::Cell<bool>,
    drag: Option<Drag>,
    written_layout: String,
    /// The shown layout as its file has it; `chrome` is this plus the clicks
    /// (layout_sync.rs).
    file_chrome: Node,
    written_state: String,
    picked_theme: Option<crate::layout::ThemeChoice>,
    /// Whether the shown layout's file read and parsed (or is simply
    /// missing): a broken one is never written over.
    layout_file_ok: bool,
    written_view: String,
    /// settings.json: zoom and sounds.
    person: settings::Person,
    /// What the last command made or why it didn't (for callers that wait for it).
    reply: Option<Value>,
    /// The `where` label last written per terminal address.
    written_where: HashMap<String, String>,
    /// `herdr.seen` turns written but not yet back from the core.
    written_seen: HashMap<String, u64>,
    /// Agents the person is looking at, and the turn they were shared as seen at.
    looked: HashMap<String, u64>,
    watched: Watched,
    /// Core's terminal records by address.
    live: HashMap<String, Value>,
    listed_once: bool,
    /// Live folders by address (from the shell process).
    cwds: HashMap<String, String>,
    /// When each terminal's repo and branch were last read, and what it was doing.
    folders_checked: HashMap<String, FolderCheck>,
    /// When Fireflies started each terminal: a listing already in flight can't know them yet.
    born: RefCell<HashMap<String, Instant>>,
    /// Connection epoch: ignore replies from an old connection.
    core_generation: u64,
    checking_closed: bool,
    documents_watching: bool,
    draining: bool,
    changing_terminals: HashSet<String>,
    /// Closed terminals stay excluded until kill completes and a listing drops them.
    closing_terminals: HashMap<String, bool>,
    pending_terminals: std::collections::BTreeMap<String, PendingTerminalChange>,
    /// Each machine owns a document; the empty key is this core.
    documents: std::collections::BTreeMap<String, crate::mirror_sync::Slot>,
    initial_view: Option<crate::mirror::View>,
    pointer: Point<Pixels>,
    /// Where a press on a `window_drag` node started, until it moves the window.
    drag_from: Option<Point<Pixels>>,
    titlebar_applied: Option<(crate::layout::Titlebar, Option<[f32; 2]>)>,
    focused_pane: Option<String>,
    /// The mod block holding the keyboard for directional navigation.
    focused_block: Option<String>,
    synced_model_pane: Option<String>,
    /// A terminal block in a window (an overlay's layout) holding the keyboard.
    /// `focused()` reports it like a layout terminal block; the focused pane stays.
    window_terminal: Option<String>,
    /// Whether the last sync showed the tab, to hand it the keyboard back when a stack shows it again.
    tab_shown: bool,
    pane_history: Vec<String>,
    window_active: bool,
    /// The system's appearance; a layout with a light and a dark theme follows it.
    system_dark: bool,
    /// The OS tells us when files change (`files.rs`); else the disk is polled.
    file_events: Option<crate::files::FileEvents>,
    polls: u64,
    /// The downloaded update the frame's pill offers, and the one closed for now.
    /// What's waiting, in words (`update_label`).
    update_ready: Option<String>,
    update_dismissed: Option<String>,
    update_success: bool,
    update_status: String,
    focus: FocusHandle,
    _tasks: Vec<Task<()>>,
    /// Gives the keyboard back when what had it leaves the screen (`restore_focus`).
    _focus_lost: Option<Subscription>,
    /// Keeps keys from panes behind a window with a scrim (`take_back_keys`).
    _keys_guard: Option<Subscription>,
    /// Remembers where the window is (`place.rs`); the write waiting to settle.
    _place: Option<Subscription>,
    place_write: Option<Task<()>>,
}

impl AppWindow {
    pub fn new(core: Arc<Core>, requests: async_channel::Receiver<Request>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let runtime = ShellRuntime::new(cx).map_err(|e| tracing::error!("script runtime failed, mods are off: {e:#}")).ok();
        let file_events = crate::files::watch(&mods::app_dir(), #[cfg(test)] cx.background_executor().clone());
        if let (Some(runtime), Some(events)) = (&runtime, &file_events) {
            runtime.set_source_revision_provider(events.revision_provider());
        }
        mods::note_fonts(cx);
        // Mods' links (`cx.open_url`, `Link.href`, notes) open like a terminal's.
        let (links_to, handle) = (cx.weak_entity(), window.window_handle());
        cx.set_global(gpui_shell::UrlOpener(Rc::new(move |url: &str, cx: &mut App| {
            let (to, url) = (links_to.clone(), url.to_owned());
            // Never inside the click's own update of this window.
            cx.defer(move |cx| {
                let _ = handle.update(cx, |_, window, cx| {
                    to.update(cx, |this, cx| {
                        if let Err(e) = this.open_link(&url, None, None, window, cx) {
                            tracing::warn!("cannot open {url}: {e}");
                        }
                    })
                });
            });
        })));
        let seen = std::fs::read_to_string(file("seen.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let mut w = AppWindow {
            core,
            runtime,
            chrome: default_layout("main"),
            layout_name: "main".into(),
            agent: None,
            agent_focused: None,
            swapped: HashMap::new(),
            floating: None,
            float_views: None,
            float_drag: None,
            pane_drag: None,
            pane_grip_hover: None,
            chip_hover: None,
            pane_grip_rows: RefCell::default(),
            win_drag: None,
            float_anims: HashMap::new(),
            float_reveal: HashMap::new(),
            float_hover: HashSet::new(),
            float_leave: HashMap::new(),
            model: Model::default(),
            terms: HashMap::new(),
            copies: HashMap::new(),
            overlays: Vec::new(),
            folders: mods::scan().into_iter().map(|f| (f.id.clone(), f)).collect(),
            seen,
            bounds: Default::default(),
            hidden_fit: Default::default(),
            hidden_fit_warned: Default::default(),
            drag: None,
            written_layout: String::new(),
            file_chrome: default_layout("main"),
            written_state: String::new(),
            picked_theme: None,
            layout_file_ok: true,
            written_view: String::new(),
            person: settings::Person::default(),
            reply: None,
            written_where: HashMap::new(),
            written_seen: HashMap::new(),
            looked: HashMap::new(),
            watched: Watched::default(),
            live: HashMap::new(),
            listed_once: false,
            cwds: HashMap::new(),
            folders_checked: HashMap::new(),
            born: RefCell::new(HashMap::new()),
            core_generation: 0,
            checking_closed: false,
            documents_watching: false,
            draining: false,
            changing_terminals: HashSet::new(),
            closing_terminals: HashMap::new(),
            pending_terminals: Default::default(),
            documents: {
                let mut local = crate::mirror_sync::Slot::default();
                local.connection(true, None, None);
                [(String::new(), local)].into()
            },
            initial_view: std::fs::read_to_string(file("view.json")).ok().and_then(|s| serde_json::from_str(&s).ok()),
            pointer: Point::default(),
            drag_from: None,
            titlebar_applied: None,
            focused_pane: None,
            focused_block: None,
            synced_model_pane: None,
            window_terminal: None,
            tab_shown: true,
            pane_history: Vec::new(),
            window_active: true,
            system_dark: is_dark(window.appearance()),
            file_events,
            polls: 0,
            update_ready: None,
            update_dismissed: None,
            update_success: false,
            update_status: String::new(),
            focus: cx.focus_handle(),
            _tasks: Vec::new(),
            _focus_lost: None,
            _keys_guard: None,
            _place: None,
            place_write: None,
        };
        w._focus_lost = Some(cx.on_focus_lost(window, |this, window, cx| this.restore_focus(window, cx)));
        // Ahead of every binding and key handler: a key that finds the keyboard
        // behind a window with a scrim is dropped, and the window takes it back.
        let (me, handle) = (cx.weak_entity(), window.window_handle());
        w._keys_guard = Some(cx.intercept_keystrokes(move |_, window, cx| {
            if window.window_handle() == handle && me.update(cx, |this, cx| this.take_back_keys(window, cx)).unwrap_or(false) {
                cx.stop_propagation();
            }
        }));
        w._place = Some(cx.observe_window_bounds(window, |this, window, cx| {
            if let Some(t) = crate::place::changed(window, cx) {
                this.place_write = Some(t);
            }
        }));
        let closing = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            // macOS: the red button hides the app instead, so alerts keep ringing;
            // the Dock icon or a new launch brings it back, Cmd+Q quits.
            if cfg!(target_os = "macos") {
                cx.hide();
                return false;
            }
            let _ = closing.update(cx, |this, cx| {
                this.drain_documents(window, cx);
                this.close_mods_now(std::time::Instant::now() + Duration::from_millis(250), window, cx);
            });
            crate::place::save(window, cx);
            true
        });
        settings::install_themes();
        crate::programs::install_icons();
        w.reload_config(window, cx);
        install_layouts();
        let name = mods::shared("layout").and_then(|v| v.as_str().map(str::to_owned)).filter(|n| layout_path(n).exists());
        // A layout whose mods are gone (Zen, T4, ADE after the update took
        // theirs) starts on Fireflies' instead of a wall of "did not load".
        let gone = name.as_deref().map(missing_mods).unwrap_or_default();
        w.load_layout(if gone.is_empty() { name.as_deref().unwrap_or(FIRST_LAYOUT) } else { "main" });
        w.apply_look(window, cx);
        w.show_layout_notes(window, cx);
        if let (Some(n), false) = (&name, gone.is_empty()) {
            let note = json!({ "title": format!("{n} needs mods that aren't here"), "body": format!("Showing Fireflies instead. Missing: {}. Your {n} layout file is still there.", gone.join(", ")), "level": "info", "timeout": 12000 });
            w.open_overlay(mods::new_overlay_id(), json!({ "kind": "toast", "notification": note }), window, cx);
        }

        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            loop {
                if this.update_in(cx, |this, window, cx| this.poll(window, cx)).is_err() {
                    break;
                }
                cx.background_executor().timer(Duration::from_millis(400)).await;
            }
        }));
        // A press on a mod's native view (a web page) focuses its pane, as a
        // click does on any other pane: the view takes the click, so the
        // pane's own mouse handler never runs.
        let presses = crate::native_view::presses();
        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            while let Ok(copy) = presses.recv().await {
                if this.update_in(cx, |this, window, cx| this.native_view_pressed(copy, window, cx)).is_err() {
                    break;
                }
            }
        }));
        if let Some(events) = w.file_events.clone() {
            w._tasks.push(cx.spawn_in(window, async move |this, cx| {
                while let Ok(mut changed) = events.changes.recv().await {
                    // An editor's save is several events: take them together.
                    cx.background_executor().timer(Duration::from_millis(80)).await;
                    while let Ok(more) = events.changes.try_recv() {
                        changed.extend(more);
                    }
                    if this.update_in(cx, |this, window, cx| this.files_changed(changed, window, cx)).is_err() {
                        break;
                    }
                }
            }));
        }
        // Size changes, as they happen: the main loop reads the core's events
        // twice a second, too late for a terminal another client just resized.
        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            loop {
                let Ok(core) = this.update(cx, |this, _| this.core.clone()) else { break };
                let sub = cx.background_executor().spawn({
                    let core = core.clone();
                    async move { core.subscribe() }
                }).await;
                let Ok((channel, events, _)) = sub else {
                    cx.background_executor().timer(Duration::from_secs(2)).await;
                    continue;
                };
                let mut pending = Vec::new();
                while let Ok(crate::hc::Stream::Data(bytes)) = events.recv().await {
                    core.credit(channel, bytes.len());
                    pending.extend_from_slice(&bytes);
                    let mut sizes = Vec::new();
                    while let Some(end) = pending.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = pending.drain(..=end).collect();
                        let Ok(v) = serde_json::from_slice::<Value>(&line) else { continue };
                        let p = v.get("params").unwrap_or(&v);
                        if p.get("type").and_then(Value::as_str) != Some("size") { continue }
                        let (Some(t), Some(c), Some(r)) = (
                            p.get("terminal").and_then(Value::as_str),
                            p.pointer("/data/cols").and_then(Value::as_u64),
                            p.pointer("/data/rows").and_then(Value::as_u64),
                        ) else { continue };
                        sizes.push((t.to_owned(), c, r));
                    }
                    if !sizes.is_empty()
                        && this.update(cx, |this, cx| for (t, c, r) in sizes { this.on_core_size(&t, c, r, cx) }).is_err()
                    {
                        return;
                    }
                }
                cx.background_executor().timer(Duration::from_millis(500)).await;
            }
        }));
        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            while let Ok(req) = requests.recv().await {
                if this.update_in(cx, |this, window, cx| this.handle(req, window, cx)).is_err() {
                    break;
                }
            }
        }));
        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            // The terminals come from the core's events (a snapshot, then each
            // change), not from listing them all every tick; machines, which
            // send no events, are asked now and then.
            let mut subscription = None;
            let mut subscribed_generation = u64::MAX;
            let mut event_lines = crate::hc::EventLines::default();
            let mut known_machines = Value::Null;
            let (mut tick, mut relist) = (0u64, false);
            loop {
                let Ok((core, generation)) = this.update(cx, |this, _| {
                    (this.core.clone(), this.core_generation)
                }) else { break };
                if generation != subscribed_generation {
                    drop(subscription.take());
                    event_lines = crate::hc::EventLines::default();
                    subscribed_generation = generation;
                    let local_core = core.clone();
                    let (sub, result) = cx.background_executor().spawn(async move {
                        let sub = local_core.subscribe().ok();
                        let result = crate::mirror_sync::round(&local_core, crate::mirror_sync::Work {
                            machine: String::new(), version: 0, write: None,
                        });
                        (sub, result)
                    }).await;
                    subscription = sub.map(|(channel, events, snapshot)| {
                        event_lines = crate::hc::EventLines::new(&snapshot);
                        (channel, events)
                    });
                    (tick, relist) = (0, true);
                    if this.update_in(cx, |this, window, cx| {
                        if generation != this.core_generation { return; }
                        this.documents.entry(String::new()).or_default().connection(true, None, None);
                        this.documents_updated(None, vec![result], window, cx);
                        this.sync(window, cx);
                    }).is_err() { break; }
                }
                let ask_machines = tick.is_multiple_of(5);
                tick += 1;
                let relisting = std::mem::take(&mut relist);
                let (sub, machines, refresh, listed, lines, machine_names) = cx.background_executor().spawn(async move {
                    // The local stream forwards remote doc events too.
                    let mut sub = subscription;
                    let (mut refresh, mut terminals) = (false, relisting);
                    if sub.is_none() && let Ok((channel, events, snapshot)) = core.subscribe() {
                        event_lines = crate::hc::EventLines::new(&snapshot);
                        sub = Some((channel, events));
                        (refresh, terminals) = (true, true);
                    }
                    let mut closed = false;
                    if let Some((channel, events)) = &sub {
                        while let Ok(event) = events.try_recv() {
                            if let crate::hc::Stream::Data(bytes) = event {
                                let pushed = event_lines.push(&bytes);
                                refresh |= pushed.docs;
                                terminals |= pushed.terminals;
                                core.credit(*channel, bytes.len());
                            } else { (refresh, closed) = (true, true); }
                        }
                    }
                    // A stream that ended is subscribed to again, with a fresh snapshot.
                    if closed { sub = None; }
                    let machines = if ask_machines || terminals { core.call("machine.list", json!({})).ok() } else { None };
                    let machines_changed = machines.as_ref().is_some_and(|m| m != &known_machines);
                    if let Some(m) = &machines { known_machines = m.clone(); }
                    let listed = (terminals || machines_changed).then(|| event_lines.live_for(&core.hello, &known_machines));
                    (sub, machines, refresh, listed, event_lines, known_machines)
                }).await;
                let watching = sub.is_some();
                subscription = sub;
                event_lines = lines;
                known_machines = machine_names;
                let (seen, resynced) = event_lines.take_seen();
                if this.update_in(cx, |this, window, cx| {
                    if generation != this.core_generation { return; }
                    // Our seen writes the core has applied (or, after a fresh
                    // snapshot, can't tell): its labels decide again.
                    if resynced {
                        this.written_seen.clear();
                    } else {
                        this.written_seen.retain(|a, w| seen.get(a).is_none_or(|s| s < w));
                    }
                    this.documents_watching = watching;
                    if watching { this.documents.entry(String::new()).or_default().connection(true, None, None); }
                    let changed = this.documents_updated(machines, vec![], window, cx);
                    match listed {
                        Some(v) => this.terminals_listed(v, window, cx),
                        None => this.tend_terminals(false, window, cx),
                    }
                    if changed { this.sync(window, cx); }
                    this.fit_hidden_tabs(window, cx);
                    this.flush_documents(refresh, window, cx);
                }).is_err() { break; }
                cx.background_executor().timer(Duration::from_millis(500)).await;
            }
        }));
        w._tasks.push(cx.spawn_in(window, async move |this, cx| {
            // Cores restart (upgrades, crashes) and their programs survive: keep
            // the panes, reconnect, reattach the same terminals.
            loop {
                let Ok(core) = this.update(cx, |this, _| this.core.clone()) else { break };
                core.closed().await;
                tracing::warn!("lost the core; reconnecting");
                let fresh = loop {
                    cx.background_executor().timer(Duration::from_millis(1000)).await;
                    if let Ok(core) = cx.background_executor().spawn(async { Core::connect() }).await {
                        break core;
                    }
                };
                if this.update(cx, |this, cx| this.reconnected(fresh, cx)).is_err() {
                    break;
                }
            }
        }));
        Self::note_core(&w.core);
        w.sync(window, cx);
        w.restore_focus(window, cx);
        // The first time the app opens: the frame's welcome (it sets
        // "frame.welcomed" when you start or skip).
        cx.defer_in(window, |this, window, cx| this.open_kept_windows(window, cx));
        // 0.1.0 kept space colors under its own word.
        if mods::shared("space.colors").is_none()
            && let Some(c) = mods::shared("project.colors")
        {
            mods::set_shared("space.colors".into(), c);
        }
        let first_install = mods::shared("frame.welcomed").is_none();
        crate::update_notes::started(first_install);
        if first_install {
            cx.defer_in(window, |this, window, cx| this.open_welcome(window, cx));
        } else if !crate::update_notes::spotlights().is_empty() {
            cx.defer_in(window, |this, window, cx| this.open_whats_new(false, window, cx));
        } else {
            w.update_success = crate::update_notes::changed();
        }
        w
    }

    /// After an update: unseen spotlights. Asked for: the pending range, or this version's notes.
    fn open_whats_new(&mut self, asked: bool, window: &mut Window, cx: &mut Context<Self>) {
        let notes = if asked { crate::update_notes::notes(crate::update::ready().as_deref()) } else { crate::update_notes::spotlights() };
        if notes.is_empty() {
            self.run("app.settings", json!({ "section": "updates" }), window, cx);
            return;
        }
        let viewport = window.viewport_size();
        let width = 880.0_f32.min((f32::from(viewport.width) / settings::zoom() - 24.0).max(1.0));
        let height = 760.0_f32.min((f32::from(viewport.height) / settings::zoom() - 24.0).max(1.0));
        let spec = json!({ "mod": "frame-whatsnew", "kind": "window", "width": width, "height": height, "props": { "notes": notes } });
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    fn open_welcome(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // A window over the live app (nothing dims), centered and movable:
        // each step changes what's behind it, and a click beside it doesn't end it.
        let spec = json!({ "mod": "frame-welcome", "kind": "window", "width": 660, "height": 600 });
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    /// Tells the updater which core this is and who owns it (off the UI thread).
    fn note_core(core: &Arc<Core>) {
        let core = core.clone();
        std::thread::spawn(move || {
            if let Ok(s) = core.call("server.status", json!({})) {
                let text = |k: &str| s.get(k).and_then(Value::as_str).map(str::to_owned);
                crate::update::set_core(text("version").map(|v| v.trim_start_matches("hc ").to_owned()), text("installed_by"));
            }
        });
    }

    fn reconnected(&mut self, core: Arc<Core>, cx: &mut Context<Self>) {
        tracing::info!("reconnected to the core");
        self.core_generation += 1;
        self.documents_watching = false;
        for (machine, slot) in &mut self.documents {
            slot.available = false;
            slot.connected = machine.is_empty();
            slot.read_attempted = false;
            slot.pending = None;
            slot.blocked = false;
        }
        Self::note_core(&core);
        self.core = core.clone();
        self.publish(cx);
        for t in self.terms.values() {
            t.view.update(cx, |v, cx| v.reattach(core.clone(), cx));
        }
        cx.notify();
    }

    fn report(&self, what: &str, message: &str) {
        tracing::warn!("{what}.json not applied: {message}");
        let _ = std::fs::write(file(&format!("{what}.error")), format!("{what}.json was not applied: {message}\n"));
    }

    // ---- config files ------------------------------------------------------

    /// Changes settings.json from inside the app (the zoom keys). If the file
    /// is broken mid-edit, the change applies for now without touching it.
    fn write_person(&mut self, change: impl FnOnce(&mut settings::Person), window: &mut Window, cx: &mut Context<Self>) {
        let broken = settings::load_person().is_err();
        change(&mut self.person);
        if !broken {
            if let Err(e) = settings::write_person(&self.person) {
                tracing::warn!("cannot write settings.json: {e}");
            }
            self.watched.settings = mtime(&settings::path());
        }
        self.apply_look(window, cx);
    }

    /// Runs with the shown layout's look (its root node) at the person's zoom.
    fn apply_look(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // A layout's fonts arrive with its mod: added since the start, they load now.
        if settings::load_home_fonts(cx) {
            mods::note_fonts(cx);
        }
        let s = settings::Settings::compose(&self.person, &self.chrome.look, self.system_dark);
        let problems = s.problems();
        if !problems.is_empty() {
            self.report_layout(&problems.join("; "));
        }
        if settings::set(s) {
            for term in self.terms.values() {
                term.view.read(cx).refresh_theme();
            }
            mods::apply_theme(cx);
            self.refresh_mods(cx);
            window.refresh();
        }
    }

    fn reload_config(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let s_time = mtime(&settings::path());
        if s_time.is_none() || s_time != self.watched.settings {
            let loaded = settings::load_person();
            match loaded {
                Ok(p) => {
                    self.person = p;
                    let _ = std::fs::remove_file(file("settings.error"));
                }
                Err(e) => self.report("settings", &e),
            }
            self.watched.settings = mtime(&settings::path());
            self.apply_look(window, cx);
        }
        let k_time = mtime(&crate::keys::path());
        if k_time.is_none() || k_time != self.watched.keys {
            match crate::keys::load() {
                Ok(bindings) => {
                    crate::keys::install(bindings, cx);
                    let _ = std::fs::remove_file(file("keys.error"));
                }
                Err(e) => {
                    self.report("keys", &e);
                    if self.watched.keys.is_none() {
                        crate::keys::install(vec![], cx);
                    }
                }
            }
            self.watched.keys = mtime(&crate::keys::path());
        }
        let p_time = mtime(&crate::programs::path());
        if p_time != self.watched.programs {
            match crate::programs::load() {
                Ok(()) => {
                    let _ = std::fs::remove_file(file("programs.error"));
                }
                Err(e) => self.report("programs", &e),
            }
            self.watched.programs = p_time;
            self.publish(cx);
        }
    }

    /// Makes `name` the shown layout (its file, or its default if missing or
    /// broken), with the person's clicks on it.
    fn load_layout(&mut self, name: &str) {
        self.layout_name = name.to_owned();
        self.written_layout.clear();
        let mut from_file = false;
        // A file that's there but broken or unreadable is shown as shipped for
        // now and never written to (nor its clicks) until it's fixed.
        self.layout_file_ok = true;
        let mut chrome = match std::fs::read_to_string(layout_path(name)) {
            Ok(text) => match serde_json::from_str::<Node>(&text) {
                Ok(n) => {
                    self.written_layout = text;
                    from_file = true;
                    let _ = std::fs::remove_file(file("layout.error"));
                    n
                }
                Err(e) => {
                    self.report_layout(&e.to_string());
                    self.layout_file_ok = false;
                    default_layout(name)
                }
            },
            Err(e) => {
                self.layout_file_ok = e.kind() == std::io::ErrorKind::NotFound;
                default_layout(name)
            }
        };
        if from_file {
            self.keep_ids(&mut chrome);
        } else {
            fill_ids(&mut chrome, &mut self.model);
        }
        self.file_chrome = chrome.clone();
        let mut state = read_state(name);
        if self.layout_file_ok {
            // Clicks on fields the file changed since (an edit while the app
            // was closed or another layout showed, an update) give way.
            state.forget_since_saved(&chrome);
        }
        self.picked_theme = state.theme.clone();
        state.apply(&mut chrome);
        self.chrome = chrome;
        self.written_state.clear();
        if self.layout_file_ok {
            self.write_state(&state);
        }
        mods::set_shared("layout".into(), json!(name));
    }

    fn report_layout(&self, message: &str) {
        let name = &self.layout_name;
        tracing::warn!("layouts/{name}.json not applied: {message}");
        let _ = std::fs::write(file("layout.error"), format!("layouts/{name}.json was not applied: {message}\n"));
    }

    /// Shows the layout `name`, or the next one after the current.
    fn switch_layout(&mut self, name: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let names = layout_names();
        let next = match name {
            Some(n) if mods::valid_name(n) && layout_path(n).exists() => n.to_owned(),
            Some(n) => {
                tracing::warn!("no layout {n:?} in layouts/");
                return;
            }
            None => {
                let i = names.iter().position(|n| *n == self.layout_name).map_or(0, |i| i + 1);
                match names.get(i % names.len().max(1)) {
                    Some(n) => n.clone(),
                    None => return,
                }
            }
        };
        self.save();
        self.float_drag = None;
        self.pane_drag = None;
        self.float_anims.clear();
        self.float_reveal.clear();
        self.float_hover.clear();
        let other = next != self.layout_name;
        if other {
            self.close_windows(window, cx);
            self.drop_layout_copies(window, cx);
        }
        self.load_layout(&next);
        self.apply_look(window, cx);
        // Whatever the new layout shows takes the keyboard.
        self.focused_pane = None;
        self.agent_focused = None;
        self.sync(window, cx);
        if other {
            self.open_kept_windows(window, cx);
        }
    }

    fn check_layout_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(text) = std::fs::read_to_string(layout_path(&self.layout_name)) else { return };
        if text == self.written_layout {
            return;
        }
        match serde_json::from_str::<Node>(&text) {
            Ok(mut n) => {
                self.written_layout = text;
                let was_broken = !self.layout_file_ok;
                self.layout_file_ok = true;
                self.keep_ids(&mut n);
                // What the file now sets on purpose wins over a click on it.
                // Coming back from a broken file, the clicks are the saved ones
                // (what showed meanwhile was only the shipped stand-in).
                let state = if was_broken {
                    let mut s = read_state(&self.layout_name);
                    s.forget_since_saved(&n);
                    s
                } else {
                    let mut s = layout_sync::State::between(&self.file_chrome, &self.chrome);
                    s.theme = self.picked_theme.clone();
                    s.forget_edited(&self.file_chrome, &n);
                    s
                };
                self.file_chrome = n.clone();
                self.chrome = n;
                self.picked_theme = state.theme.clone();
                state.apply(&mut self.chrome);
                self.write_state(&state);
                let _ = std::fs::remove_file(file("layout.error"));
                self.apply_look(window, cx);
                self.sync(window, cx);
            }
            Err(e) => {
                self.written_layout = text;
                self.layout_file_ok = false;
                self.report_layout(&e.to_string());
            }
        }
    }

    /// Live folders used for unnamed spaces; not restart state.
    fn note_pane_folders(&mut self) {
        let panes: Vec<(String, String)> =
            self.model.tabs().flat_map(|c| c.root.terminals()).filter_map(|n| Some((n.id.clone(), n.terminal()?.to_owned()))).collect();
        self.model.pane_folders.retain(|p, _| panes.iter().any(|(id, _)| id == p));
        for (pane, addr) in panes {
            if let Some(cwd) = self.cwds.get(&addr) {
                self.model.pane_folders.insert(pane, cwd.clone());
            }
        }
    }

    /// Writes the clicks to the layout's state file and, only when something
    /// else changed (a mod docked, `layout.set`), the layout file.
    fn save(&mut self) {
        // Quitting (also the OS ending the session): programs may end in any
        // order now. Their panes aren't closing; the next start brings them back.
        if QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        self.note_pane_folders();
        let mut state = layout_sync::State::between(&self.file_chrome, &self.chrome);
        state.theme = self.picked_theme.clone();
        if self.layout_file_ok {
            self.write_state(&state);
        }
        let edited = layout_sync::without_clicks(&self.file_chrome, &self.chrome);
        if edited != self.file_chrome && self.layout_file_ok && !shipped_layouts().contains(&self.layout_name.as_str()) {
            let path = layout_path(&self.layout_name);
            // Someone (an agent) changed the file since we read it: theirs
            // wins; the watcher loads it next.
            let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
            if !self.written_layout.is_empty() && on_disk != self.written_layout {
                tracing::info!("layouts/{}.json changed meanwhile: not overwritten", self.layout_name);
            } else {
                let layout = layout_sync::text_of(&edited);
                if write_atomic(&path, &layout) {
                    self.written_layout = layout;
                    self.file_chrome = edited;
                }
            }
        }
        self.save_view();
    }

    fn save_view(&mut self) {
        let mut view = crate::mirror::View::capture(&self.model);
        if let Some(saved) = &self.initial_view {
            view.preserve_unloaded(saved, |machine| self.documents.get(machine.unwrap_or("")).is_some_and(|s| s.document.is_some()));
        }
        let view = serde_json::to_string_pretty(&view).unwrap_or_default() + "\n";
        if self.documents.values().any(|s| s.document.is_some()) && view != self.written_view && write_atomic(&file("view.json"), &view) {
            self.written_view = view;
        }
    }

    /// What installing layouts kept of the person's own, as toasts.
    fn show_layout_notes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        for clone in mods::take_sync_notes() {
            let n = json!({ "title": format!("Your edits are in {clone}"), "body": "Fireflies' own layouts and mods can't be changed: clone one to make it yours.", "level": "info", "timeout": 12000 });
            self.open_overlay(mods::new_overlay_id(), json!({ "kind": "toast", "notification": n }), window, cx);
        }
    }

    /// Writes the clicks, with the file they were made on (so a later change
    /// to the file can win over them).
    fn write_state(&mut self, state: &layout_sync::State) {
        let mut state = state.clone();
        if !state.is_empty() {
            state.file = serde_json::to_value(&self.file_chrome).ok();
        }
        let text = state_text(&state);
        if text == self.written_state {
            return;
        }
        let path = state_path(&self.layout_name);
        let ok = if state.is_empty() {
            std::fs::remove_file(&path).is_ok() || !path.exists()
        } else {
            let _ = std::fs::create_dir_all(file("layouts/.state"));
            write_atomic(&path, &text)
        };
        if ok {
            self.written_state = text;
        }
    }

    /// Gives nodes without an id one and writes it into the file, so clicks
    /// on them (keyed by id) still find them next time.
    fn keep_ids(&mut self, n: &mut Node) {
        let before = n.clone();
        // Never one the tree (or yesterday's generated ids in it) already has.
        let taken: std::collections::HashSet<String> = n.walk().iter().map(|x| x.id.clone()).collect();
        let mut i = 0;
        n.fill_ids(&mut || loop {
            i += 1;
            let id = format!("node-{i}");
            if !taken.contains(&id) {
                break id;
            }
        });
        if *n != before {
            let text = layout_sync::text_of(n);
            if write_atomic(&layout_path(&self.layout_name), &text) {
                self.written_layout = text;
            }
        }
    }

    // ---- making the screen match the model ---------------------------------

    /// Visible slots: terminal blocks (id → address) and mod slots (key → instance).
    fn visible(&self) -> (Vec<(String, String)>, Vec<(String, Instance)>) {
        let mut terms = Vec::new();
        let mut mods = Vec::new();
        let visit = |n: &Node, terms: &mut Vec<(String, String)>, mods: &mut Vec<(String, Instance)>| match n.content() {
            Some(Content::Terminal { terminal }) => terms.push((n.id.clone(), terminal.clone())),
            Some(Content::Mod { name, props }) => mods.push((n.id.clone(), Instance { name: name.clone(), props: props.clone() })),
            _ => {}
        };
        let stacks = |root: &Node, mods: &mut Vec<(String, Instance)>| {
            for n in visible_nodes(root) {
                if let Kind::Stack { header: Some(h), .. } = &n.kind
                    && let HeaderContent::Mod { name, props } = &h.content
                {
                    mods.push((format!("{}#header", n.id), Instance { name: name.clone(), props: props.clone() }));
                }
            }
        };
        for n in self.chrome.visible_blocks() {
            visit(n, &mut terms, &mut mods);
            // An agent block with an agent outside every tab gets its own view.
            if matches!(n.content(), Some(Content::Agent { .. }))
                && let Some(addr) = self.shown_agent()
                && self.model.placed_pane_of(&addr).is_none()
            {
                terms.push((n.id.clone(), addr));
            }
        }
        stacks(&self.chrome, &mut mods);
        for n in visible_nodes(&self.chrome) {
            for f in n.floating.iter().filter(|f| !f.hidden) {
                match &f.content {
                    Content::Mod { name, props } => mods.push(float_mod(&f.id, name, props)),
                    Content::Terminal { terminal } => terms.push((floats::slot(&f.id), terminal.clone())),
                    _ => {}
                }
            }
        }
        if self.shows_tab()
            && let Some(c) = self.model.active_tab()
        {
            let header = self.pane_frame().and_then(|f| f.header.as_ref()).and_then(|h| match &h.content {
                HeaderContent::Mod { name, props } => Some((name.clone(), props.clone())),
                HeaderContent::Builtin(_) => None,
            });
            for n in c.shown().visible_blocks() {
                if let Some((name, props)) = &header
                    && n.is_pane()
                {
                    mods.push(pane_header_mod(n, name, props));
                }
                visit(n, &mut terms, &mut mods);
                if let Some(a) = self.swapped.get(&n.id) {
                    terms.push((format!("{}{SWAP}", n.id), a.clone()));
                }
            }
            // The parking row's chips, when the layout draws them with a mod.
            mods.extend(self.chip_mods());
        }
        if let Some(name) = self.update_note_mod()
            && let Some(props) = self.update_note()
        {
            mods.push((UPDATE_NOTE.to_owned(), Instance { name: name.clone(), props }));
        }
        for o in &self.overlays {
            if let Some(c) = self.copies.get(&o.slot) {
                mods.push((o.slot.clone(), c.inst.clone()));
            }
            if let Some(l) = &o.layout {
                for n in l.visible_blocks() {
                    visit(n, &mut terms, &mut mods);
                }
            }
        }
        (terms, mods)
    }

    /// Mod slots whose copy may stay alive: every one in the layout (hidden
    /// nodes, inactive stack children, hidden floats), every pane mod of every
    /// tab (zoomed or not shown), and the overlays.
    fn owned_mods(&self) -> HashMap<String, Instance> {
        let mut out = HashMap::new();
        let inst = |name: &String, props: &Value| Instance { name: name.clone(), props: props.clone() };
        for n in self.chrome.walk() {
            if let Some(Content::Mod { name, props }) = n.content() {
                out.insert(n.id.clone(), inst(name, props));
            }
            if let Kind::Stack { header: Some(h), .. } = &n.kind
                && let HeaderContent::Mod { name, props } = &h.content
            {
                out.insert(format!("{}#header", n.id), inst(name, props));
            }
            for f in &n.floating {
                if let Content::Mod { name, props } = &f.content {
                    let (slot, i) = float_mod(&f.id, name, props);
                    out.insert(slot, i);
                }
            }
        }
        // The layout's pane header, shown or not (`pane_frame` says what's drawn now).
        let header = self
            .chrome
            .walk()
            .into_iter()
            .find_map(|n| match n.content() {
                Some(Content::Context { pane: Some(f), .. }) => f.header.as_ref(),
                _ => None,
            })
            .and_then(|h| match &h.content {
                HeaderContent::Mod { name, props } => Some((name.clone(), props.clone())),
                HeaderContent::Builtin(_) => None,
            });
        for c in self.model.tabs() {
            for n in c.root.walk() {
                if let Some(Content::Mod { name, props }) = n.content() {
                    out.insert(n.id.clone(), inst(name, props));
                }
                if let Some((name, props)) = &header
                    && n.is_pane()
                {
                    let (slot, i) = pane_header_mod(n, name, props);
                    out.insert(slot, i);
                }
            }
            // Parked mod panes stay alive too (a web page keeps playing), as
            // their terminals keep running.
            for p in &c.parked {
                if let Some(Content::Mod { name, props }) = p.pane.content() {
                    out.insert(p.pane.id.clone(), inst(name, props));
                }
            }
        }
        if let Some(name) = self.update_note_mod()
            && let Some(props) = self.update_note()
        {
            out.insert(UPDATE_NOTE.to_owned(), Instance { name: name.clone(), props });
        }
        for o in &self.overlays {
            if let Some(c) = self.copies.get(&o.slot) {
                out.insert(o.slot.clone(), c.inst.clone());
            }
            // Inactive stack children too (a float's other view), like the layout's.
            if let Some(l) = &o.layout {
                for n in l.walk() {
                    if let Some(Content::Mod { name, props }) = n.content() {
                        out.insert(n.id.clone(), inst(name, props));
                    }
                }
            }
        }
        out
    }

    /// Another layout: its mods start fresh. Pane mods (they belong to their
    /// tab) and overlays stay.
    fn drop_layout_copies(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let gone: Vec<_> = self.copies.keys().filter(|s| {
            self.model.tab_holding(s).is_none() && !self.overlays.iter().any(|o| o.slot == **s || o.layout.as_ref().is_some_and(|l| l.find(s).is_some()))
        }).cloned().collect();
        for slot in gone {
            self.remove_copy(&slot, window, cx);
        }
    }

    fn remove_copy(&mut self, slot: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(copy) = self.copies.remove(slot)
            && let (Some(runtime), Some(root)) = (&self.runtime, copy.root)
        {
            runtime.close(&root, std::time::Instant::now() + Duration::from_millis(250), window, cx).detach();
        }
    }

    pub(crate) fn close_mods_now(&self, deadline: std::time::Instant, window: &mut Window, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else { return };
        mods::final_cleanup(self.core.clone(), deadline, || {
            for root in self.copies.values().filter_map(|copy| copy.root.as_ref()) {
                runtime.close_now(root, deadline, window, cx);
            }
        });
    }

    fn shows_tab(&self) -> bool {
        self.chrome.visible_blocks().iter().any(|n| matches!(n.content(), Some(Content::Context { .. })))
    }

    fn agent_block(&self) -> Option<String> {
        self.chrome.visible_blocks().iter().find(|n| matches!(n.content(), Some(Content::Agent { .. }))).map(|n| n.id.clone())
    }

    fn shows_agent(&self) -> bool {
        self.agent_block().is_some()
    }

    /// The mod listing agents chooses navigation order; model order is the fallback.
    fn agent_order(&self) -> Vec<String> {
        let m = &self.model;
        mods::agent_order(m.all_addresses().into_iter().filter(|a| m.status(a).is_some()).collect())
    }

    /// The agent an agent block shows: the chosen one while it lives, else the
    /// focused pane if it's an agent, else the first agent.
    fn shown_agent(&self) -> Option<String> {
        let focused = self.model.focused_pane().and_then(|p| self.model.address_of(&p));
        self.agent
            .clone()
            .filter(|a| self.live.contains_key(a))
            .or_else(|| focused.filter(|a| self.model.status(a).is_some()))
            .or_else(|| self.agent_order().into_iter().next())
    }

    /// The terminal view showing `addr` in an agent block: its pane's, or the block's own.
    fn agent_view(&self, block: &str, addr: &str) -> Option<&Term> {
        self.model.placed_pane_of(addr).and_then(|p| self.terms.get(&p)).or_else(|| self.terms.get(block).filter(|t| t.address == addr))
    }

    /// What's on screen now, for done-vs-seen.
    fn visible_addresses(&self) -> Vec<String> {
        let (terms, _) = self.visible();
        // A swapped-in terminal is drawn instead of its pane's own.
        let covered: HashSet<&str> = terms.iter().filter_map(|(slot, _)| slot.strip_suffix(SWAP)).collect();
        let mut out: Vec<String> = terms.iter().filter(|(slot, _)| !covered.contains(slot.as_str())).map(|(_, a)| a.clone()).collect();
        if self.shows_agent() {
            out.extend(self.shown_agent());
        }
        out
    }

    /// Makes `addr` the shown agent; a pane showing it also becomes the focused pane.
    fn focus_agent(&mut self, addr: &str) {
        if let Some(p) = self.model.pane_of(addr) {
            self.model.focus_pane(&p);
        }
        self.focused_pane = None;
        self.agent = Some(addr.to_owned());
    }

    /// The parent chain's top: the agent a sub-agent belongs to in the agent order.
    fn root_agent(&self, addr: &str) -> String {
        let mut cur = addr.to_owned();
        for _ in 0..32 {
            let parent = self.live.get(&cur).and_then(|r| r.get("parent")).and_then(Value::as_str);
            match parent {
                Some(p) if self.live.contains_key(p) => cur = p.to_owned(),
                _ => break,
            }
        }
        cur
    }

    /// Creates what's visible, drops what isn't, publishes state, saves, focuses.
    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.model.order_spaces();
        let (model, live) = (&self.model, &self.live);
        self.swapped.retain(|p, a| model.address_of(p).is_some() && live.contains_key(a));
        let (mut terms, mods_visible) = self.visible();
        let covered: HashSet<&str> = terms.iter().filter_map(|(slot, _)| slot.strip_suffix(SWAP)).collect();
        let mut displayed: HashSet<String> = terms.iter().filter(|(slot, _)| !covered.contains(slot.as_str())).map(|(slot, _)| slot.clone()).collect();
        // Agent blocks reuse their agent's pane view even when its tab isn't shown.
        if self.shows_agent()
            && let Some(addr) = self.shown_agent()
            && let Some(pane) = self.model.pane_of(&addr)
        {
            displayed.insert(pane);
        }
        for (id, t) in &self.terms {
            if !displayed.contains(id) {
                t.view.update(cx, |v, _| v.blur());
            }
        }
        // Every tab's terminals stay attached (only visible ones are drawn): tab
        // switches are instant and kitty images survive, which a repaint can't bring back.
        for c in self.model.tabs() {
            for n in c.root.terminals() {
                if let Some(a) = n.terminal()
                    && !terms.iter().any(|(id, _)| *id == n.id)
                {
                    terms.push((n.id.clone(), a.to_owned()));
                }
            }
        }
        // An overlay's hidden terminal (a float showing its other view) stays attached too.
        for n in self.overlays.iter().filter_map(|o| o.layout.as_ref()).flat_map(|l| l.terminals()) {
            if let Some(a) = n.terminal()
                && !terms.iter().any(|(id, _)| *id == n.id)
            {
                terms.push((n.id.clone(), a.to_owned()));
            }
        }
        let want_terms: HashSet<String> = terms.iter().map(|(id, _)| id.clone()).collect();
        for (id, address) in terms {
            if self.terms.get(&id).is_some_and(|t| t.address == address) {
                continue;
            }
            let rec = self.live.get(&address);
            let dim = |k: &str, d: u64| rec.and_then(|r| r.get(k)).and_then(Value::as_u64).unwrap_or(d) as u16;
            let size_hint = (dim("cols", 120), dim("rows", 40));
            let view = cx.new(|cx| TerminalView::attach(self.core.clone(), address.clone(), size_hint, cx));
            self.tell_term(&view, &address, cx);
            let (block, addr) = (id.clone(), address.clone());
            let sub = cx.subscribe_in(&view, window, move |this, _, ev: &TerminalEvent, window, cx| match ev {
                TerminalEvent::Peek(address) => this.peek_terminal(address, false, None, 0, window, cx),
                TerminalEvent::OpenUrl(url) => {
                    if let Err(e) = this.open_link(url, Some(block.trim_end_matches(SWAP).to_owned()), None, window, cx) {
                        tracing::warn!("cannot open {url}: {e}");
                    }
                }
                TerminalEvent::OpenFile(path, place) => {
                    let Some(viewer) = Viewer::of(path) else { return };
                    let path = path.to_string_lossy().into_owned();
                    // Markdown and what the preview shows open as a tab of the editor,
                    // to be looked at (a picture drawn, Markdown in the editor's view for it).
                    let (viewer, look) = editor_takes(viewer, this.folders.contains_key(Viewer::Editor.mod_name()));
                    // `path:42:7`: the editor goes there.
                    let extra = match place {
                        _ if look => json!({ "look": true }),
                        Some((line, col)) if viewer == Viewer::Editor => json!({ "line": line, "col": col }),
                        _ => Value::Null,
                    };
                    if let Err(e) = this.open_viewer(viewer, &path, Some(block.trim_end_matches(SWAP).to_owned()), None, None, extra, window, cx) {
                        tracing::warn!("cannot open {path}: {e}");
                    }
                }
                TerminalEvent::TitleChanged => this.publish(cx),
                TerminalEvent::Ended => this.terminal_ended(&block, window, cx),
                TerminalEvent::ContextMenu(at) => {
                    this.open_menu("pane", json!({ "pane": block.trim_end_matches(SWAP), "terminal": addr }), Some(*at), window, cx)
                }
            });
            let focus = view.read(cx).focus_handle().clone();
            self.terms.insert(id, Term { view, address, focus, _sub: sub });
        }
        let gone: Vec<String> = self.terms.keys().filter(|id| !want_terms.contains(*id)).cloned().collect();
        for id in gone {
            if let Some(t) = self.terms.remove(&id) {
                t.view.read(cx).detach();
            }
        }
        // Each pane's own text size (`pane.font_bigger`), also while it shows another terminal.
        for (id, t) in &self.terms {
            let pane = id.trim_end_matches(SWAP);
            let zoom = self.model.tab_of(pane).and_then(|c| c.font_zoom.get(pane).copied()).unwrap_or(1.0);
            t.view.update(cx, |v, cx| v.set_font_zoom(zoom, cx));
        }

        // A mod copy lives while its slot is in the layout, hidden or not (an
        // inactive stack child, a hidden column, a pane in another tab), so it
        // keeps its place; only shown slots start a copy. Gone or changed: dropped.
        let owned = self.owned_mods();
        let gone: Vec<_> = self.copies.iter().filter(|(slot, copy)| owned.get(*slot).is_none_or(|inst| *inst != copy.inst)).map(|(slot, _)| slot.clone()).collect();
        for slot in gone {
            self.remove_copy(&slot, window, cx);
        }
        let want: HashMap<String, Instance> = mods_visible.into_iter().collect();
        for (slot, inst) in want {
            if !self.copies.contains_key(&slot) {
                let copy = self.load(inst, window, cx);
                if slot.starts_with("float:")
                    && let Some(root) = &copy.root
                {
                    root.update(cx, |r, cx| r.set_fit_content(true, cx));
                }
                self.copies.insert(slot, copy);
            }
        }
        self.publish_shown_copies();

        // Keyboard to the focused pane when it changes (never steal it from an open dialog).
        let model_pane = self.model.focused_pane();
        let block = terminal_block(&self.chrome, self.focused_pane.as_deref());
        let focused = if block.is_some() && model_pane == self.synced_model_pane {
            self.focused_pane.clone()
        } else {
            model_pane.clone()
        };
        let pane_changed = focused != self.focused_pane;
        // A pane focused some other way, or the block leaving, ends it.
        if (pane_changed && self.focused_block != focused) || self.focused_block.as_ref().is_some_and(|b| !self.mod_block_shown(b)) {
            self.focused_block = None;
        }
        // Mod blocks too, so `pane.go` goes back to a mod it came from.
        self.pane_history.retain(|id| {
            self.copies.contains_key(id) || self.model.spaces.iter().any(|s| s.tabs.iter().any(|t| t.root.find(id).is_some()))
        });
        if let Some(id) = self.focused_block.as_ref().or(model_pane.as_ref()) {
            remember_pane(&mut self.pane_history, id);
        }
        self.synced_model_pane = model_pane;
        self.focused_pane = focused.clone();
        // A dialog, popup or window with a scrim keeps the keyboard through any
        // change behind it (agent.next, a tab switch, a pane closing).
        let no_dialog = !self.keys_held();
        // GPUI focus alone does not change AppKit's first responder. A browser
        // page can keep receiving keys after a keyboard pane switch.
        if pane_changed {
            crate::native_view::release_keyboard(window);
        }
        // The tab shown again (`layout.select` back from another stack child): its
        // focused pane gets the keyboard, which went to the window while it was hidden.
        let tab_shown = self.shows_tab();
        let revealed = tab_shown && !self.tab_shown;
        self.tab_shown = tab_shown;
        if terminal_block(&self.chrome, focused.as_deref()).is_some() {
            if pane_changed && no_dialog && let Some(f) = focused.as_deref().and_then(|p| self.pane_focus(p, cx)) {
                f.focus(window, cx);
            }
        } else if let Some(block) = self.agent_block() {
            let shown = self.shown_agent();
            if shown != self.agent_focused || pane_changed {
                self.agent_focused = shown.clone();
                if no_dialog && let Some(t) = shown.and_then(|a| self.agent_view(&block, &a)) {
                    t.focus.focus(window, cx);
                }
            }
        } else if pane_changed {
            // Outside an agent view, the agent shown later follows the focused pane.
            self.agent = None;
            // The focused pane takes the keyboard however the focus came (a tab
            // or space switch, agent.next, a pane closing, the start): a terminal,
            // or a focusable mod pane (its copy gets `focus`). Any other mod pane
            // takes it on a click; until then the window holds it, so another
            // tab's terminal can't keep it (and pull its tab back).
            if no_dialog && !focused.as_deref().is_some_and(|p| self.hand_mod_pane(p, window, cx)) {
                focused.and_then(|p| self.pane_focus(&p, cx)).unwrap_or_else(|| self.focus.clone()).focus(window, cx);
            }
        } else if revealed {
            self.refocus_pane(window, cx);
        }
        if self.window_active {
            let visible = self.visible_addresses();
            self.model.mark_seen(&visible);
        }
        self.share_seen(cx);
        self.publish(cx);
        self.save();
        cx.notify();
    }

    /// Shares what the person looks at as `herdr.seen` (docs/labels.md): an
    /// agent on screen in the active window, once per turn while it stays
    /// there, so a phone marking it unread isn't undone by a screen nobody
    /// watches. Only ever raises it. True when a status changed.
    fn share_seen(&mut self, cx: &mut Context<Self>) -> bool {
        let looking: HashSet<String> = if self.window_active { self.visible_addresses().into_iter().collect() } else { HashSet::new() };
        self.looked.retain(|a, _| looking.contains(a));
        let mut changed = false;
        for addr in looking {
            let Some(a) = self.model.agents.get(&addr) else { continue };
            let turn = a.turn;
            if a.word.is_none() || !self.live.contains_key(&addr) || self.looked.get(&addr) == Some(&turn) {
                continue;
            }
            self.looked.insert(addr.clone(), turn);
            if a.seen_turn.is_some_and(|s| s >= turn) {
                continue;
            }
            // Shown as seen now, not after the core's round trip.
            changed |= self.model.set_turn(&addr, turn, Some(turn));
            self.written_seen.insert(addr.clone(), turn);
            let core = self.core.clone();
            cx.spawn(async move |this, cx| {
                let params = json!({ "terminal": addr, "labels": { "herdr.seen": turn.to_string() } });
                let Err(e) = cx.background_executor().spawn(async move { core.call("terminal.label", params) }).await else { return };
                tracing::warn!("seen label for {addr}: {e:#}");
                let _ = this.update(cx, |this, _| {
                    if this.written_seen.get(&addr) == Some(&turn) {
                        this.written_seen.remove(&addr);
                        this.looked.remove(&addr);
                    }
                });
            })
            .detach();
        }
        changed
    }

    /// The keyboard never ends up nowhere. When what had it leaves the screen (a
    /// mod hidden but kept alive, a closed pane, a hidden mod focusing itself on a
    /// reload, an input a window's mod stopped drawing), it goes to the top
    /// dialog, else the top window with a scrim (modal: never the pane behind
    /// it), else the shown agent or focused pane, else the window, where the
    /// app's keys work.
    fn restore_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.restore_focus_to(None, window, cx);
    }

    /// `restore_focus`, with the window a closing dialog or popup opened over
    /// (`back_to`) first in line after another dialog.
    fn restore_focus_to(&mut self, back_to: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let dialog = self.overlays.iter().rev().find(|o| o.kind.modal_keys()).map(|o| o.focus.clone());
        if dialog.is_none()
            && let Some(id) = back_to.filter(|id| self.overlays.iter().any(|o| o.id == *id && o.kind == OverlayKind::Window)).or_else(|| self.top_scrim_window())
        {
            return self.hand_window(&id, window, cx);
        }
        // A mod block holding the keyboard gets it back (a popup over it closed).
        if dialog.is_none() && self.focused_block.as_ref().is_some_and(|b| self.mod_block_shown(b)) {
            self.focus.focus(window, cx);
            return self.hand_keyboard();
        }
        let shown = if terminal_block(&self.chrome, self.focused_pane.as_deref()).is_some() {
            self.focused_pane.as_deref().and_then(|p| self.pane_focus(p, cx))
        } else if let Some(block) = self.agent_block() {
            self.shown_agent().and_then(|a| self.agent_view(&block, &a)).map(|t| t.focus.clone())
        } else if self.shows_tab() {
            self.model.focused_pane().and_then(|p| self.pane_focus(&p, cx))
        } else {
            None
        };
        dialog.or(shown).unwrap_or_else(|| self.focus.clone()).focus(window, cx);
    }

    /// The terminal view a pane shows: the swapped-in one, else its own.
    fn pane_term(&self, pane: &str) -> Option<&Term> {
        self.swapped.get(pane).and_then(|_| self.terms.get(&format!("{pane}{SWAP}"))).or_else(|| self.terms.get(pane))
    }

    /// Key path for `terminal.copy`. Copies and clears when there is a selection.
    /// Returns whether it copied. False means the key should reach the program.
    fn copy_key(&mut self, window: &Window, cx: &mut Context<Self>) -> bool {
        let Some(t) = self.focused_terminal(window, cx) else { return true };
        t.view.update(cx, |v, cx| {
            if !v.copy(cx) {
                return false;
            }
            v.clear_selection(cx);
            true
        })
    }

    /// Peeks, floats and swapped-in views own keyboard focus without changing the model pane.
    fn focused_terminal(&self, window: &Window, cx: &App) -> Option<&Term> {
        self.terms.values().find(|t| t.view.read(cx).owns_keyboard_focus(window, cx))
            .or_else(|| self.focused_pane.as_deref().and_then(|p| self.pane_term(p)))
            .or_else(|| self.model.focused_pane().and_then(|p| self.pane_term(&p)))
    }

    fn shown_terminal_view(&self, address: &str, window: &Window, cx: &App) -> Result<Entity<TerminalView>, String> {
        if !self.live.contains_key(address) {
            return Err(format!("no running terminal {address:?}"));
        }

        let own_pane = self.model.pane_of(address);
        // The view the person sees wins over a hidden one, such as a peek over its own tab's pane.
        let best = self.terms.iter().filter(|(_, t)| t.address == address).max_by_key(|(pane, t)| {
            let view = t.view.read(cx);
            (view.owns_keyboard_focus(window, cx), view.on_screen_this_frame(), own_pane.as_deref() == Some(pane.as_str()))
        });
        best.map(|(_, t)| t.view.clone()).ok_or_else(|| format!("terminal {address:?} is running but not shown in this window, so it has no view to scroll"))
    }

    fn scroll_terminal(&self, args: &Value, window: &Window, cx: &mut Context<Self>) -> Result<(), String> {
        let target = scroll_target(args)?;

        let view = match Self::owned(args, "terminal") {
            Some(address) => self.shown_terminal_view(&address, window, cx)?,
            None => self.focused_terminal(window, cx).map(|t| t.view.clone()).ok_or("no focused terminal to scroll")?,
        };

        view.update(cx, |view, cx| view.scroll_history(target, cx));
        Ok(())
    }

    /// Gives the focused pane the keyboard, unless something other than the
    /// window holds it: a dialog, a mod block, an input.
    fn refocus_pane(&mut self, window: &mut Window, cx: &mut App) {
        let dialog = self.keys_held();
        let window_holds_keys = window.focused(cx).is_none() || self.focus.is_focused(window);
        if dialog || self.focused_block.is_some() || !window_holds_keys {
            return;
        }
        if let Some(p) = self.focused_pane.clone()
            && self.hand_mod_pane(&p, window, cx)
        {
            return;
        }
        if let Some(f) = self.focused_pane.as_ref().and_then(|p| self.pane_focus(p, cx)) {
            f.focus(window, cx);
        }
    }

    /// A shown pane whose mod is focusable takes the keyboard, as `pane.go`
    /// gives it: the window holds GPUI's until its copy focuses itself on
    /// `focus`, and it stays the block with the keyboard (`focus` again after a
    /// popup over it). False for any other pane.
    fn hand_mod_pane(&mut self, pane: &str, window: &mut Window, cx: &mut App) -> bool {
        if self.model.tab_of(pane).is_none() || !self.focusable(pane) || !self.mod_block_shown(pane) {
            return false;
        }
        self.focused_block = Some(pane.to_owned());
        self.focus.focus(window, cx);
        self.hand_keyboard();
        true
    }

    fn pane_focus(&self, pane: &str, cx: &App) -> Option<FocusHandle> {
        self.pane_term(pane).map(|t| t.view.read(cx).focus_target(cx))
    }

    fn load(&self, inst: Instance, window: &mut Window, cx: &mut Context<Self>) -> Copy {
        let mut copy = Copy { inst, id: 0, root: None, _watch: None, error: None, missing: false };
        let (Some(runtime), Some(folder)) = (&self.runtime, self.folders.get(&copy.inst.name)) else {
            copy.missing = self.runtime.is_some();
            copy.error = Some(format!("no mod folder ~/.config/herdr-app/mods/{}", copy.inst.name));
            return copy;
        };
        copy.id = mods::prepare_load(&copy.inst);
        match runtime.try_load(&folder.dir, window, cx) {
            Ok(root) => {
                if self.file_events.is_none() {
                    copy._watch = runtime.watch(&root, window, cx).map_err(|e| tracing::warn!("{}: no hot reload: {e:#}", copy.inst.name)).ok();
                }
                copy.root = Some(root);
            }
            Err(e) => {
                tracing::warn!("mod {} failed to load: {e:#}", copy.inst.name);
                copy.error = Some(format!("{e:#}"));
            }
        }
        copy
    }

    fn refresh_mods(&self, cx: &mut Context<Self>) {
        self.refresh_mods_matching(|_| true, cx);
    }

    fn refresh_snapshot_mods(&self, cx: &mut Context<Self>) {
        self.refresh_mods_matching(mods::snapshot_changed, cx);
    }

    fn refresh_mods_matching(&self, changed: impl Fn(u64) -> bool, cx: &mut Context<Self>) {
        if let Some(runtime) = &self.runtime {
            for c in self.copies.values() {
                if let Some(root) = &c.root
                    && changed(c.id)
                {
                    let _ = runtime.refresh(root, cx);
                }
            }
        }
    }

    /// What closing a tab would end that the person is asked about first
    /// (`ending`): its terminals, placed and parked, the terminals they
    /// started (`doomed`), and mod panes with unsaved work.
    fn tab_endings(&self, tab: &str) -> Vec<Ending> {
        let Some(c) = self.model.tab(tab) else { return vec![] };
        let mut endings = self.endings(&c.addresses());
        endings.extend(c.root.panes().into_iter().chain(c.parked.iter().map(|p| &p.pane)).filter_map(|n| self.unsaved_note(n)).map(Ending::unsaved));
        endings
    }

    /// What closing a pane (placed or parked) would end that the person is
    /// asked about first: an agent in it or started from it, whatever its
    /// status, and unsaved work. A program alone doesn't ask: tool panes
    /// (lazygit, a viewer) close as they were toggled open.
    fn pane_endings(&self, pane: &str) -> Vec<Ending> {
        let mut endings: Vec<Ending> = self.endings(&self.model.address_of(pane).into_iter().collect::<Vec<_>>()).into_iter().filter(|e| e.kind == EndingKind::Agent).collect();
        let node = self.model.tab_of(pane).and_then(|c| c.root.find(pane))
            .or_else(|| self.model.parked_tab_of(pane).and_then(|c| c.parked.iter().map(|p| &p.pane).find(|n| n.id == pane)));
        endings.extend(node.and_then(|n| self.unsaved_note(n)).map(Ending::unsaved));
        endings
    }

    /// `ending` of these terminals and every terminal they started.
    fn endings(&self, addresses: &[String]) -> Vec<Ending> {
        self.doomed(addresses).iter().filter_map(|addr| {
            let rec = self.live.get(addr)?;
            ending(self.model.status(addr).or_else(|| rec["status"].as_str()), rec)
        }).collect()
    }

    /// What a mod pane would lose if closed now (`setUnsaved`), if anything.
    fn unsaved_note(&self, node: &Node) -> Option<String> {
        match node.content() {
            Some(Content::Mod { name, props }) => crate::mods::unsaved(name, props),
            _ => None,
        }
    }

    /// How a terminal shows (`program` for mods): its agent, else what it runs.
    fn program(&self, addr: &str) -> Value {
        let rec = self.live.get(addr).and_then(Value::as_object);
        program_of(rec.and_then(|r| r.get("report")).unwrap_or(&Value::Null), rec.and_then(running_argv))
    }

    /// Tells mods what changed (they re-render only if something did).
    fn publish(&mut self, cx: &mut Context<Self>) {
        let m = &self.model;
        let home = home();
        let spaces: Vec<Value> = m
            .spaces
            .iter()
            .enumerate()
            .map(|(i, p)| {
                // The branch of the terminal the space shows first.
                let first = p.active_tab().and_then(|c| c.focused_pane()).and_then(|pane| m.address_of(&pane));
                let branch = first.and_then(|a| m.folder_info.get(&a)).and_then(|f| f.branch.clone());
                model::space_json(m, p, i, branch.as_deref(), &home)
            })
            .collect();
        // A window's terminal with the keyboard first, then a layout terminal block.
        let block = overlay_terminal_block(&self.overlays, self.window_terminal.as_deref())
            .or_else(|| terminal_block(&self.chrome, self.focused_pane.as_deref()));
        let focused_pane = if block.is_some() { None } else { m.focused_pane() };
        let mut agents = Vec::new();
        let mut panes = Vec::new();
        for pr in &m.spaces {
            for (ci, ctx) in pr.tabs.iter().enumerate() {
                // Parked panes too (`parked`: in the tab's bottom row), after the placed ones.
                for (p, parked) in ctx.root.panes().into_iter().map(|p| (p, false)).chain(ctx.parked.iter().map(|p| (&p.pane, true))) {
                    let focused = m.active.as_deref() == Some(pr.id.as_str()) && focused_pane.as_deref() == Some(p.id.as_str());
                    let zoomed = ctx.zoomed.as_deref() == Some(p.id.as_str());
                    // A mod pane: what it shows, no terminal.
                    if let Some(Content::Mod { name, props }) = p.content() {
                        panes.push(json!({ "pane": p.id, "terminal": null, "mod": name, "props": props, "tab": ctx.id, "title": name, "focused": focused, "zoomed": zoomed, "font_zoom": 1.0, "movable": self.pane_movable(&p.id), "parked": parked }));
                        continue;
                    }
                    let Some(addr) = p.terminal() else { continue };
                    let a = m.agents.get(addr);
                    let title = self.terms.get(&p.id).map(|t| t.view.read(cx).title.clone()).or_else(|| {
                        self.live.get(addr).and_then(|r| r.get("title")).and_then(Value::as_str).map(str::to_owned)
                    });
                    panes.push(json!({
                        "pane": p.id, "terminal": addr, "tab": ctx.id, "title": title.clone().unwrap_or_default(),
                        "cwd": self.cwds.get(addr), "branch": m.folder_info.get(addr).and_then(|f| f.branch.clone()),
                        "status": m.status(addr), "app": a.and_then(|a| a.app.clone()), "program": self.program(addr),
                        "focused": focused, "zoomed": zoomed, "font_zoom": ctx.font_zoom.get(&p.id).copied().unwrap_or(1.0),
                        "movable": self.pane_movable(&p.id), "parked": parked,
                    }));
                    let Some(status) = m.status(addr) else { continue };
                    agents.push(json!({
                        "address": addr, "pane": p.id, "space": pr.id, "space_name": m.space_name(pr, &home),
                        "tab": ctx.id, "tab_index": ci + 1, "tab_name": Model::tab_name(pr, ctx),
                        "status": status, "app": a.and_then(|a| a.app.clone()), "program": self.program(addr), "title": title.unwrap_or_default(),
                        "seq": a.map(|a| a.seq).unwrap_or(0), "command": a.is_some_and(|a| a.command),
                        "pinned": self.live.get(addr).and_then(|r| r.pointer("/labels/herdr.pinned")).and_then(Value::as_str).is_some_and(|v| !v.is_empty()),
                        "focused": m.active.as_deref() == Some(pr.id.as_str()) && focused_pane.as_deref() == Some(p.id.as_str()),
                    }));
                }
            }
        }
        let focused = m.active_space().and_then(|p| {
            let ctx = p.active_tab()?;
            if let Some(block) = block {
                let address = block.terminal()?;
                return Some(json!({ "space": p.id, "tab": ctx.id, "pane": null, "terminal": address,
                    "shown": null, "agent": self.shown_agent(), "cwd": self.cwds.get(address) }));
            }
            let pane = ctx.focused_pane()?;
            let cwd = (if self.shows_agent() { self.shown_agent() } else { m.address_of(&pane) }).and_then(|a| self.cwds.get(&a).cloned());
            Some(json!({ "space": p.id, "tab": ctx.id, "terminal": m.address_of(&pane), "shown": self.swapped.get(&pane),
                "pane": pane, "agent": self.shown_agent(), "cwd": cwd }))
        });
        // A layout block holding the keyboard (a focusable mod: `pane.go`, `layout.focus`).
        let chrome_block = self.focused_block.as_ref().filter(|b| self.chrome.find(b).is_some()).cloned();
        // With no space yet, a block holding the keyboard is still reported (the rest null).
        let focused = match focused {
            Some(mut f) => {
                f["block"] = json!(chrome_block);
                Some(f)
            }
            None => chrome_block.map(|b| json!({ "space": null, "tab": null, "pane": null, "terminal": null,
                "shown": null, "agent": null, "cwd": null, "block": b })),
        };
        let machines = self.documents.iter().map(|(name, slot)| json!({
            "name": (!name.is_empty()).then_some(name), "layout": slot.layout(),
        })).collect();
        let mut changed = mods::publish_machines(Value::Array(machines));
        changed |= mods::publish_spaces(Value::Array(spaces));
        changed |= mods::publish_agents(Value::Array(agents));
        changed |= mods::publish_panes(Value::Array(panes));
        let (view, views) = self.float_marks(true);
        changed |= mods::publish_floating(self.floating.as_deref(), view, views);
        changed |= mods::publish_focused(focused.unwrap_or(Value::Null));
        changed |= mods::publish_floats(self.float_placements());
        changed |= mods::publish_layout(&self.chrome);
        if changed {
            self.refresh_snapshot_mods(cx);
        }
        self.write_where(cx);
    }

    /// Tells the core where each terminal lives, in words: the `where` label,
    /// `<space> / <tab>`, which hc shows in its picker and `ls`.
    /// Sub-agents get their parent's. The ids (`herdr.space`,
    /// `herdr.tab`) are what the app groups by; only this follows renames
    /// and moves. Written only when it changes.
    fn write_where(&mut self, cx: &mut Context<Self>) {
        let m = &self.model;
        let home = home();
        let mut want: HashMap<String, String> = HashMap::new();
        for p in &m.spaces {
            let name = m.space_name(p, &home);
            for c in &p.tabs {
                for a in c.addresses() {
                    want.insert(a, format!("{name} / {}", Model::tab_name(p, c)));
                }
            }
        }
        for addr in self.live.keys() {
            if want.contains_key(addr) {
                continue;
            }
            let mut cur = addr.clone();
            for _ in 0..32 {
                let Some(p) = self.live.get(&cur).and_then(|r| r.get("parent")).and_then(Value::as_str) else { break };
                if let Some(place) = want.get(p).cloned() {
                    want.insert(addr.clone(), place);
                    break;
                }
                cur = p.to_owned();
            }
        }
        self.written_where.retain(|a, _| self.live.contains_key(a));
        for (addr, place) in want {
            if self.written_where.get(&addr) == Some(&place) || !self.live.contains_key(&addr) {
                continue;
            }
            // Off the UI thread (a terminal on a slow machine answers late); a
            // failed write is forgotten so the next publish tries again.
            self.written_where.insert(addr.clone(), place.clone());
            let core = self.core.clone();
            cx.spawn(async move |this, cx| {
                let params = json!({ "terminal": addr, "labels": { "where": place } });
                let Err(e) = cx.background_executor().spawn(async move { core.call("terminal.label", params) }).await else { return };
                tracing::warn!("where label for {addr}: {e:#}");
                let _ = this.update(cx, |this, _| {
                    if this.written_where.get(&addr) == Some(&place) {
                        this.written_where.remove(&addr);
                    }
                });
            })
            .detach();
        }
    }

    fn flush_documents(&mut self, refresh: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.draining || !self.documents_watching { return; }
        let generation = self.core_generation;
        for (machine, slot) in &mut self.documents {
            slot.dirty |= refresh;
            if !slot.ready() { continue; }
            let doc = crate::mirror::Document::capture(&self.model, (!machine.is_empty()).then_some(machine.as_str()));
            let write = (self.drag.is_none() && slot.available && slot.document.as_ref() != Some(&doc)).then_some(doc);
            if write.is_none() && slot.available && !slot.dirty { continue; }
            let (tx, rx) = std::sync::mpsc::channel();
            slot.pending = Some(rx);
            slot.dirty = false;
            let work = crate::mirror_sync::Work { machine: machine.clone(), version: slot.version, write };
            let core = self.core.clone();
            // Quit can block the foreground before the continuation gets a turn.
            let job = cx.background_executor().spawn(async move {
                let (machine, outcome) = crate::mirror_sync::round(&core, work);
                let _ = tx.send(outcome);
                machine
            });
            cx.spawn_in(window, async move |this, cx| {
                let machine = job.await;
                let _ = this.update_in(cx, |this, window, cx| {
                    if generation != this.core_generation || this.draining { return; }
                    let result = this.documents.get_mut(&machine).and_then(|s| s.pending.take()).and_then(|rx| rx.try_recv().ok());
                    if let Some(result) = result
                        && this.documents_updated(None, vec![(machine, result)], window, cx) { this.sync(window, cx); }
                });
            }).detach();
        }
    }

    fn layout_notice(&mut self, title: &str, body: &str, window: &mut Window, cx: &mut Context<Self>) {
        let spec = json!({"kind":"toast", "notification":{"title":title,"body":body,"level":"info"}});
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    /// Finish the accepted edit and any newer projection before the window goes.
    pub fn drain_documents(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.draining { return; }
        self.save();
        self.draining = true;
        QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
        while let Some(address) = self.pending_terminals.keys().next().cloned() {
            let pending = self.pending_terminals.remove(&address).unwrap();
            let timeout = Duration::from_secs(if address.contains('/') { 2 } else { 10 });
            let result = pending.reply.recv_timeout(timeout).unwrap_or_else(|e| Err(format!("terminal change did not finish before quit: {e}")));
            self.apply_terminal_change(address, pending.change, result, window, cx);
        }
        let machines = self.documents.keys().cloned().collect::<Vec<_>>();
        for machine in machines {
            let timeout = Duration::from_secs(if machine.is_empty() { 10 } else { 2 });
            let deadline = Instant::now() + timeout;
            let pending = self.documents.get_mut(&machine).and_then(|s| s.pending.take());
            if let Some(pending) = pending {
                match pending.recv_timeout(timeout) {
                    Ok(result) => { self.documents_updated(None, vec![(machine.clone(), result)], window, cx); }
                    Err(e) => {
                        tracing::error!("layout on {machine:?} could not finish saving before quit: {e}");
                        continue;
                    }
                }
            }
            let slot = &self.documents[&machine];
            let doc = crate::mirror::Document::capture(&self.model, (!machine.is_empty()).then_some(machine.as_str()));
            if slot.document.as_ref() == Some(&doc) { continue; }
            if !slot.available {
                tracing::error!("layout on {machine:?} could not save before quit: {}", slot.error.as_deref().unwrap_or("machine unavailable"));
                continue;
            }
            let work = crate::mirror_sync::Work { machine: machine.clone(), version: slot.version, write: Some(doc) };
            let result = crate::mirror_sync::round_timeout(&self.core, work, deadline.saturating_duration_since(Instant::now()));
            self.documents_updated(None, vec![result], window, cx);
        }
        self.save_view();
    }

    fn documents_updated(&mut self, machines: Option<Value>, results: Vec<(String, crate::mirror_sync::Outcome)>, window: &mut Window, cx: &mut Context<Self>) -> bool {
        use crate::mirror_sync::Outcome;
        let mut changed = false;
        // The listing every 500 ms brings the machines alone: redraw only when
        // one's state moved, or the whole window draws twice a second for nothing.
        let shown = |d: &std::collections::BTreeMap<String, crate::mirror_sync::Slot>| {
            d.iter().map(|(m, s)| (m.clone(), s.connected, s.available, s.blocked, s.error.clone(), s.layout())).collect::<Vec<_>>()
        };
        let (listing, was) = (results.is_empty(), shown(&self.documents));
        for (machine, result) in results {
            let Some(slot) = self.documents.get_mut(&machine) else { continue };
            let first = slot.document.is_none();
            slot.read_attempted = true;
            let (document, version, replace, conflict) = match result {
                Outcome::Read(d, v) => {
                    let replace = !slot.available || slot.version != v || slot.document.is_none();
                    let projection = crate::mirror::Document::capture(&self.model, (!machine.is_empty()).then_some(machine.as_str()));
                    let unsent = slot.document.as_ref().is_some_and(|old| old != &projection);
                    let conflict = replace && unsent && projection != d;
                    (d, v, replace, conflict)
                }
                Outcome::Written(d, v) => (d, v, false, false),
                Outcome::Conflict(d, v) => (d, v, true, true),
                error @ (Outcome::Unavailable(_) | Outcome::Undecodable(_) | Outcome::Blocked(_)) => {
                    let blocked = !matches!(&error, Outcome::Unavailable(_));
                    let error = match error {
                        Outcome::Unavailable(e) | Outcome::Undecodable(e) | Outcome::Blocked(e) => e,
                        _ => unreachable!(),
                    };
                    let notify = slot.connected && blocked && slot.notified_error.as_ref() != Some(&error);
                    slot.available = false;
                    slot.blocked = blocked;
                    if slot.connected || slot.error.is_none() { slot.error = Some(error.clone()); }
                    if notify {
                        tracing::warn!("layout on {machine:?} unavailable: {error}");
                        slot.notified_error = Some(error.clone());
                        self.layout_notice("Layout unavailable", &format!("{}: {error}", if machine.is_empty() { "This machine" } else { &machine }), window, cx);
                    }
                    continue;
                }
            };
            slot.version = version;
            slot.available = slot.connected;
            slot.blocked = false;
            if slot.connected { slot.error = None; slot.notified_error = None; }
            slot.document = Some(document.clone());
            if replace {
                let on = (!machine.is_empty()).then_some(machine.as_str());
                document.replace(&mut self.model, on);
                if first && let Some(view) = &self.initial_view { view.apply_machine(&mut self.model, on); }
                changed = true;
            }
            if conflict {
                self.layout_notice("Layout changed elsewhere", "The other screen's layout is shown.", window, cx);
            }
        }
        if let Some(machines) = machines {
            // Temporary machines are agents' short-lived sandboxes: the app leaves them out.
            let kept = || machines["machines"].as_array().into_iter().flatten().filter(|m| m["temporary"] != true);
            let states = kept().filter_map(|m| Some((m["name"].as_str()?, m["state"].as_str()?))).collect::<HashMap<_, _>>();
            for machine in kept() {
                let Some(name) = machine["name"].as_str() else { continue };
                let state = machine["state"].as_str().unwrap_or("unavailable");
                let reason = (state != "connected").then(|| machine["why"].as_str().map(str::to_owned).unwrap_or_else(|| match state {
                    "needs_update" => format!("{name} needs a core update; run hc machine update {name}"),
                    "needs_login" => format!("{name} needs login; run hc machine login {name}"),
                    _ => format!("{name} is {state}"),
                }));
                self.documents.entry(name.to_owned()).or_default().connection(state == "connected", machine["since_ms"].as_u64(), reason);
            }
            if self.model.spaces.iter().any(|s| s.machine.as_deref().is_some_and(|m| !states.contains_key(m))) {
                let mut view = crate::mirror::View::capture(&self.model);
                if let Some(saved) = &self.initial_view {
                    view.preserve_unloaded(saved, |m| self.documents.get(m.unwrap_or("")).is_some_and(|s| s.document.is_some()));
                }
                self.initial_view = Some(view);
            }
            self.documents.retain(|m, _| m.is_empty() || states.contains_key(m.as_str()));
            let before = self.model.spaces.len();
            self.model.spaces.retain(|s| s.machine.as_deref().is_none_or(|m| states.contains_key(m)));
            changed |= before != self.model.spaces.len();
        }
        if !listing || changed || shown(&self.documents) != was {
            self.publish(cx);
            cx.notify();
        }
        changed
    }

    // ---- core facts --------------------------------------------------------

    /// What a terminal view takes from the core's facts: its folder, where right-clicks go.
    fn tell_term(&self, view: &Entity<TerminalView>, addr: &str, cx: &mut Context<Self>) {
        let cwd = self.cwds.get(addr).map(std::path::PathBuf::from);
        let to_program = self.live.get(addr).and_then(|r| r.pointer("/labels/herdr.right-click")).and_then(Value::as_str) == Some("program");
        view.update(cx, |v, _| {
            v.cwd = cwd;
            v.right_click_to_program = to_program;
        });
    }

    /// `terminals()`' `floating_view` and `float_views` for a terminal (floating or not).
    fn float_marks(&self, floating: bool) -> (Value, Value) {
        if !floating || self.floating.is_none() {
            return (Value::Null, Value::Null);
        }
        match &self.float_views {
            Some(f) => (json!(f.shown), json!(f.names)),
            None => (json!(0), Value::Null),
        }
    }

    fn terminals_listed(&mut self, v: Value, window: &mut Window, cx: &mut Context<Self>) {
        let mut list = v.get("terminals").cloned().unwrap_or(Value::Array(vec![]));
        let mut live = HashMap::new();
        for t in list.as_array_mut().into_iter().flatten() {
            let Some(obj) = t.as_object_mut() else { continue };
            let report = obj.remove("status").unwrap_or(Value::Null);
            let word = report.get("state").cloned().unwrap_or_else(|| if report.is_string() { report.clone() } else { Value::Null });
            obj.insert("status".into(), word);
            obj.insert("program".into(), program_of(&report, running_argv(obj)));
            obj.insert("report".into(), report);
            // As the panes show it: a spinning title would change every listing.
            if let Some(title) = obj.get("title").and_then(Value::as_str).map(|t| crate::terminal::shown_title(t).into_owned()) {
                obj.insert("title".into(), title.into());
            }
            let floating = self.floating.is_some() && obj.get("address").and_then(Value::as_str) == self.floating.as_deref();
            obj.insert("floating".into(), floating.into());
            let (view, views) = self.float_marks(floating);
            obj.insert("floating_view".into(), view);
            obj.insert("float_views".into(), views);
            if let Some(a) = obj.get("address").and_then(Value::as_str) {
                live.insert(a.to_owned(), Value::Object(obj.clone()));
            }
        }
        self.live = live;
        self.reclaim_sizes(cx);
        self.closing_terminals.retain(|addr, completed| !*completed || self.live.contains_key(addr));
        // A new sub-agent changes only this list; mods that show teams need to redraw.
        let terminals_changed = mods::publish_terminals(list);
        // A floating terminal that ended takes its overlay with it.
        if self.floating.as_ref().is_some_and(|a| !self.live.contains_key(a) && !self.just_born(a)) {
            self.close_overlay("terminal-peek", window, cx);
        }
        self.tend_terminals(true, window, cx);
        if terminals_changed {
            self.refresh_snapshot_mods(cx);
        }
    }

    /// Whether this window takes its terminals' size back from other clients:
    /// it's active and the person used it moments ago. Another client (an `hc
    /// attach` from a phone over mosh) sets a terminal's size when it attaches,
    /// resizes or types. Right after the person acts here, that's the phone
    /// following the agent they switched to, so this window's size wins; while
    /// they're away (on the phone, with this window still active), the phone's
    /// size stays until they come back.
    fn takes_sizes(&self) -> bool {
        self.window_active && crate::terminal::person_here()
    }

    /// The person used this window (a key, a click, the mouse): if they were
    /// away, shown terminals another client resized get this window's size back
    /// now rather than at the next tick.
    fn on_local_input(&mut self, cx: &mut Context<Self>) {
        if crate::terminal::note_input() {
            self.reclaim_sizes(cx);
        }
    }

    /// A size change the core reported for a terminal (from the size watch).
    /// Another client resized one shown here while the person is here (see
    /// `takes_sizes`): hold its screen and give it our size back at once; once
    /// the core is at our size again, let it draw.
    fn on_core_size(&mut self, address: &str, cols: u64, rows: u64, cx: &mut Context<Self>) {
        let views: Vec<_> = self.terms.values().filter(|t| t.address == address).map(|t| t.view.clone()).collect();
        if views.is_empty() {
            return;
        }
        let take = self.takes_sizes() && self.visible_addresses().iter().any(|a| a == address);
        for view in views {
            let (c, r) = view.read(cx).dimensions();
            view.update(cx, |v, cx| {
                if (cols, rows) == (u64::from(c), u64::from(r)) {
                    v.release_soon(cx);
                } else if take {
                    v.hold(cx);
                    v.reclaim_size();
                }
            });
        }
    }

    /// Terminals shown here that the core lists at another client's size get
    /// this window's size back, while the person is here (`takes_sizes`).
    /// Their screens are held until the program has redrawn for it.
    fn reclaim_sizes(&self, cx: &mut Context<Self>) {
        if !self.takes_sizes() { return }
        let visible: HashSet<String> = self.visible_addresses().into_iter().collect();
        let mut taken = Vec::new();
        for t in self.terms.values() {
            if !visible.contains(&t.address) { continue }
            let Some(rec) = self.live.get(&t.address) else { continue };
            let core = (rec.get("cols").and_then(Value::as_u64), rec.get("rows").and_then(Value::as_u64));
            let (cols, rows) = t.view.read(cx).dimensions();
            if let (Some(c), Some(r)) = core
                && (c, r) != (u64::from(cols), u64::from(rows))
            {
                taken.push(t.view.clone());
            }
        }
        for view in taken {
            view.update(cx, |v, cx| {
                v.hold(cx);
                v.reclaim_size();
            });
        }
    }

    /// Every tick, with or without news from the core: where the terminals go
    /// (a layout that arrived late can place one now), what they mean now (a
    /// finished agent you're looking at is no longer news), their folders, their
    /// streams. `listed`: the list itself changed.
    fn tend_terminals(&mut self, listed: bool, window: &mut Window, cx: &mut Context<Self>) {
        // Place newly labeled terminals first: one that is blocked on its first
        // listing is ours, and must ring.
        let mut changed = self.reconcile(window, cx);
        let visible: HashSet<String> = self.visible_addresses().into_iter().collect();
        let mut alerts = Vec::new();
        let mut commands = false;
        for (addr, rec) in &self.live {
            let word = rec.get("status").and_then(Value::as_str).map(str::to_owned);
            let app = rec.get("report").and_then(|r| r.get("app")).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned);
            let looking = visible.contains(addr) && self.window_active;
            let prev = self.model.agents.get(addr).and_then(|a| a.word.clone());
            let child = rec.get("parent").and_then(Value::as_str).is_some_and(|p| !p.is_empty());
            if let Some(alert) = self.model.alert_for(addr, child, prev.as_deref(), word.as_deref(), looking) {
                alerts.push((addr.clone(), alert, looking));
            }
            changed |= self.model.set_word(addr, word, app, looking);
            let turn = rec.get("turn").and_then(Value::as_u64).unwrap_or(0);
            let label = rec.pointer("/labels/herdr.seen").and_then(Value::as_str).and_then(|s| s.parse::<u64>().ok());
            changed |= self.model.set_turn(addr, turn, label.max(self.written_seen.get(addr).copied()));
            // Working on a shell command it started (only this machine's processes can be seen).
            let msg = rec.pointer("/report/msg").and_then(Value::as_str).map(str::to_owned);
            self.model.set_msg(addr, msg);
            let step = self.model.agents.get(addr).filter(|a| a.word.as_deref() == Some("working")).map(|a| a.step);
            let pid = rec.pointer("/foreground/pid").or_else(|| rec.get("pid")).and_then(Value::as_u64);
            let command = match (step, pid) {
                (Some(step), Some(pid)) if !addr.contains('/') => crate::agent_command::running(pid, step, model::now_ms()),
                _ => false,
            };
            commands |= self.model.set_command(addr, command);
        }
        self.written_seen.retain(|a, _| self.live.contains_key(a));
        changed |= self.share_seen(cx);
        // Changes already made before Fireflies started aren't news.
        if self.listed_once {
            for (addr, alert, looking) in alerts {
                self.alert(&addr, alert, looking, window, cx);
            }
        }
        self.track_folders(cx);
        for t in self.terms.values() {
            if self.live.get(&t.address).is_some_and(|r| r["pid"].as_u64().is_some()) {
                t.view.update(cx, |v, cx| v.reattach_if_needed(self.core.clone(), cx));
            }
            self.tell_term(&t.view, &t.address, cx);
        }
        self.listed_once = true;
        if changed {
            self.sync(window, cx);
        } else if listed || commands {
            self.publish(cx);
        }
    }

    /// Tells the person an agent needs them or finished: Fireflies' sounds, and a
    /// toast (drawn by the `toast` mod; click it to go there) unless they're
    /// looking at that agent.
    fn alert(&mut self, addr: &str, alert: model::Alert, looking: bool, window: &mut Window, cx: &mut Context<Self>) {
        if settings::get().sounds.enabled {
            crate::sound::play(if alert == model::Alert::Blocked { "blocked" } else { "done" });
        }
        // Needing the person brings a settled tab back.
        if let Some(ctx) = self.model.pane_of(&self.root_agent(addr)).and_then(|p| self.model.tab_holding(&p)).map(|c| c.id.clone())
            && self.model.unsettle(&ctx)
        {
            self.save();
            self.publish(cx);
        }
        if looking {
            return;
        }
        let rec = self.live.get(addr);
        let app = self.model.agents.get(addr).and_then(|a| a.app.clone());
        let name = rec
            .and_then(|r| r.get("name").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned))
            .or_else(|| app.as_deref().map(crate::programs::name))
            .unwrap_or_else(|| "An agent".into());
        // A sub-agent lives where its top agent does.
        let home = self.root_agent(addr);
        let place = self.model.pane_of(&home).and_then(|pane| {
            let (p, c) = (self.model.space_of(&pane)?, self.model.tab_holding(&pane)?);
            Some(format!("{} / {}", self.model.space_name(p, &self::home()), Model::tab_name(p, c)))
        });
        let (title, level) = match alert {
            model::Alert::Blocked => (format!("{name} needs you"), "error"),
            model::Alert::Done => (format!("{name} finished"), "info"),
        };
        let notification = json!({
            "title": title, "body": place, "level": level,
            "action": { "name": "agent.focus", "args": { "terminal": addr } },
        });
        self.open_overlay(mods::new_overlay_id(), json!({ "kind": "toast", "notification": notification }), window, cx);
    }

    /// Keeps the model true to core, on every listing: drops panes whose terminal
    /// is gone (ended while hidden, or while the app was closed) and places
    /// terminals labeled `herdr.space` that aren't shown (started by an
    /// agent, a script, or before a restart). Returns whether anything changed.
    fn reconcile(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        // No fresh shells while quitting: the next start brings them back.
        if QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
            return false;
        }
        let missing = self.model.tabs().flat_map(|c| c.root.terminals().into_iter().chain(c.parked.iter().map(|p| &p.pane))).chain(self.chrome.terminals())
            .filter_map(|n| n.terminal().filter(|a| !self.live.contains_key(*a) && !self.just_born(a)).map(|a| (n.id.clone(), a.to_owned())))
            .collect::<Vec<_>>();
        if !missing.is_empty() && !self.checking_closed {
            self.check_closed(missing, window, cx);
        }
        let mut orphans = self.live.iter()
            .filter(|(a, _)| self.model.pane_of(a).is_none() && !self.changing_terminals.contains(*a) && !self.closing_terminals.contains_key(*a))
            .filter_map(|(a, r)| {
                let machine = a.split_once('/').map(|(m, _)| m);
                if !self.documents.get(machine.unwrap_or("")).is_some_and(|s| s.available) { return None; }
                let labels = r.get("labels")?;
                let space = labels.get("herdr.space")?.as_str().filter(|s| !s.is_empty())?;
                let tab = labels.get("herdr.tab").and_then(Value::as_str).filter(|s| !s.is_empty());
                Some((a.clone(), crate::mirror::qualify(space, machine), tab.map(|t| crate::mirror::qualify(t, machine))))
            }).collect::<Vec<_>>();
        orphans.sort();
        for (addr, space, tab) in orphans {
            self.start_adoption(addr, space, tab, window, cx);
        }
        false
    }

    fn start_adoption(&mut self, addr: String, space: String, tab: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.changing_terminals.insert(addr.clone());
        let core = self.core.clone();
        let generation = self.core_generation;
        cx.spawn_in(window, async move |this, cx| {
            let (address, wanted_space, wanted_tab) = (addr.clone(), space.clone(), tab.clone());
            let ready = cx.background_executor().spawn(async move {
                let record = core.call("terminal.get", json!({"terminal":address}))?;
                let machine = address.split_once('/').map(|(m, _)| m);
                if !adoptable(&record, &wanted_space, wanted_tab.as_deref(), machine) { return Ok(false); }
                if record["keep"].as_bool() != Some(true) {
                    core.call("terminal.keep", json!({"terminal":address,"keep":true}))?;
                }
                anyhow::Ok(true)
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.changing_terminals.remove(&addr);
                if generation != this.core_generation || this.draining { return; }
                if matches!(ready, Ok(true)) && this.model.pane_of(&addr).is_none()
                    && this.require_document(addr.split_once('/').map(|(m, _)| m)).is_ok()
                {
                    this.adopt(&addr, &space, tab.as_deref());
                    this.sync(window, cx);
                    this.flush_documents(false, window, cx);
                }
            });
        }).detach();
    }

    /// Puts a live terminal where its labels say, without changing what's
    /// shown. A space or tab the app doesn't know is made under the label's
    /// id, unnamed (called Fireflies' way).
    fn adopt(&mut self, addr: &str, space: &str, ctx: Option<&str>) {
        let machine = addr.split_once('/').map(|(m, _)| m.to_owned());
        let pane = self.model.fresh_id_on("p", machine.as_deref());
        let ctx_id = ctx.map(str::to_owned).unwrap_or_else(|| self.model.fresh_id_on("tb", machine.as_deref()));
        // Found by its labels: no names, so they're called Fireflies' way.
        let new_ctx = Tab::new(&ctx_id, "", &pane, addr);
        if self.model.space(space).is_none() {
            // Its live folder may not be read yet: the core's record has it.
            let rec = self.live.get(addr);
            let folder = self
                .cwds
                .get(addr)
                .cloned()
                .or_else(|| rec.and_then(|r| r.get("foreground").and_then(|f| f.get("cwd")).or_else(|| r.get("cwd"))).and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| mods::home().to_string_lossy().into_owned());
            let active = self.model.active.clone();
            self.model.add_space(space, "", &folder, new_ctx);
            self.model.space_mut(space).unwrap().machine = machine;
            self.model.active = active.or(Some(space.to_owned()));
            return;
        }
        let target = self.model.tab(&ctx_id).and_then(|c| c.root.panes().last().map(|p| p.id.clone()));
        if let Some(target) = target {
            let tab = self.model.tab_of(&target).unwrap();
            let focused = tab.focused.clone();
            let before = tab.before.clone();
            let zoomed = tab.zoomed.clone();
            let id = tab.id.clone();
            self.model.split(&target, Axis::Row, &pane, addr);
            let tab = self.model.tab_mut(&id).unwrap();
            tab.focused = focused;
            tab.before = before;
            tab.zoomed = zoomed;
            return;
        }
        let keep = self.model.space(space).and_then(|p| p.active.clone());
        self.model.add_tab(space, new_ctx);
        if let Some(p) = self.model.space_mut(space) {
            p.active = keep;
        }
    }

    /// Reads each terminal's live folder, and its repo and branch for mods.
    fn track_folders(&mut self, cx: &mut Context<Self>) {
        let home = mods::home().to_string_lossy().into_owned();
        let mut todo: HashMap<(Option<String>, String), Vec<String>> = HashMap::new();
        let mut moved = false;
        for (addr, rec) in &self.live {
            // Core's live folder of what runs there (any machine), else the shell's (local).
            let cwd = rec
                .get("foreground")
                .and_then(|f| f.get("cwd"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                // (a pid on another machine means nothing here)
                .or_else(|| rec.get("pid").and_then(Value::as_u64).filter(|_| !addr.contains('/')).and_then(crate::process_cwd::read).map(|p| p.to_string_lossy().into_owned()))
                .or_else(|| rec.get("cwd").and_then(Value::as_str).map(str::to_owned));
            let Some(cwd) = cwd else { continue };
            let busy = busy(rec);
            let last = self.folders_checked.get_mut(addr);
            if recheck(last.as_deref(), &cwd, busy, self.window_active) {
                moved |= self.cwds.get(addr) != Some(&cwd);
                self.cwds.insert(addr.clone(), cwd.clone());
                let repo = last.as_ref().is_none_or(|l| l.cwd != cwd || l.repo); // until git says otherwise
                self.folders_checked.insert(addr.clone(), FolderCheck { at: Instant::now(), cwd: cwd.clone(), busy, repo });
                // Another machine's terminal (`vps/t7`): git runs there.
                todo.entry((addr.split_once('/').map(|(m, _)| m.to_owned()), cwd)).or_insert_with(Vec::new).push(addr.clone());
            } else if let Some(last) = last {
                last.busy = busy;
            }
        }
        self.folders_checked.retain(|a, _| self.live.contains_key(a));
        // Refresh unnamed spaces when a terminal moves.
        if moved {
            self.save();
        }
        // Once per machine and folder, however many terminals are there.
        for ((on, cwd), addrs) in todo {
            let home = home.clone();
            cx.spawn(async move |this, cx| {
                let asked = cwd.clone();
                let (info, repo) = cx.background_executor().spawn(async move { folder_info(&asked, &home, on.as_deref()) }).await;
                let _ = this.update(cx, |this, cx| {
                    let mut changed = false;
                    // Not one that moved on meanwhile: its own answer is coming.
                    for addr in addrs.into_iter().filter(|a| this.cwds.get(a) == Some(&cwd)) {
                        if let Some(check) = this.folders_checked.get_mut(&addr) {
                            check.repo = repo;
                        }
                        if this.model.folder_info.get(&addr) != Some(&info) {
                            this.model.folder_info.insert(addr, info.clone());
                            changed = true;
                        }
                    }
                    if changed {
                        this.publish(cx);
                        cx.notify();
                    }
                });
            })
            .detach();
        }
    }

    fn terminal_ended(&mut self, block: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(pane) = block.strip_suffix(SWAP) {
            self.swapped.remove(pane);
            self.focused_pane = None;
            return self.sync(window, cx);
        }
        if let Some(address) = self.model.address_of(block) {
            self.notify_launch_failure(&address, window, cx);
        }
        if let Some(o) = self.overlays.iter().find(|o| o.layout.as_ref().is_some_and(|l| l.find(block).is_some())) {
            let id = o.id.clone();
            return self.close_overlay(&id, window, cx);
        }
        // How its stream ended, for `reconcile` (`hc run --rm` leaves no record).
        if let Some(t) = self.terms.get(block)
            && let Some(why) = t.view.read(cx).ended.clone()
        {
            // The program ended on its own (or was killed): its pane goes now. A
            // stream that just broke (the core died) says neither.
            let closed = matches!(why.as_str(), "exited" | "killed" | "finished");
            if closed && self.chrome.find(block).and_then(Node::terminal) == Some(t.address.as_str()) {
                self.chrome.remove_slot(block);
                return self.sync(window, cx);
            }
            if closed && self.model.address_of(block).as_deref() == Some(t.address.as_str()) {
                self.model.remove_pane(block);
                return self.sync(window, cx);
            }
        }
        // Otherwise the next listing checks closure; core owns lost terminals.
    }

    fn notify_launch_failure(&mut self, address: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.born.borrow_mut().remove(address).is_none() {
            return;
        }
        let core = self.core.clone();
        let address = address.to_owned();
        cx.spawn_in(window, async move |this, cx| {
            let failure = cx.background_executor().spawn(async move {
                let record = core.call("terminal.get", json!({"terminal": address})).ok()?;
                launch_failure(&record, "")?;
                let output = core.call("terminal.read", json!({"terminal": address, "lines": 5})).unwrap_or(Value::Null);
                launch_failure(&record, output["text"].as_str().unwrap_or_default())
            }).await;
            if let Some(body) = failure {
                let _ = this.update_in(cx, |this, window, cx| {
                    this.open_overlay(mods::new_overlay_id(), json!({"kind":"toast", "notification":{"title":"Terminal failed to start", "body":body, "level":"error"}}), window, cx);
                });
            }
        }).detach();
    }

    // ---- creating terminals ------------------------------------------------

    /// The folder new terminals in `space` start in: where its shown tab's focused
    /// pane is now (Fireflies' "follow"), else the folder the space was made in.
    fn folder_for(&self, space: &str) -> String {
        let p = self.model.space(space);
        let here = p.and_then(|p| p.active_tab()).and_then(|c| c.focused_pane()).and_then(|f| self.model.address_of(&f)).and_then(|a| self.cwds.get(&a).cloned());
        here.or_else(|| p.map(|p| p.folder.clone())).unwrap_or_else(home)
    }

    /// The machine a space's terminals run on, None for this one.
    fn require_document(&self, machine: Option<&str>) -> Result<(), String> {
        match self.documents.get(machine.unwrap_or("")) {
            Some(slot) if slot.available => Ok(()),
            Some(slot) => Err(slot.error.clone().unwrap_or_else(|| "This machine's layout is unavailable. Try again when it reconnects.".into())),
            None => Err(match machine {
                Some(m) => format!("Fireflies has no machine called {m}. See hc machine ls; machines added with --temp stay out of Fireflies."),
                None => "This machine's layout is unavailable. Try again when it reconnects.".into(),
            }),
        }
    }

    fn machine_of(&self, space: &str) -> Option<String> {
        self.model.space(space).and_then(|p| p.machine.clone())
    }

    /// Starts a terminal for `space`, on `on` (another machine) or here. An
    /// empty `cwd`: the machine's home. With no argv, that machine's core
    /// picks its own shell.
    fn spawn(&mut self, argv: Option<Vec<String>>, cwd: String, follow: bool, space: &str, ctx: &str, on: Option<&str>, size: Option<(u16, u16)>, window: &Window) -> Result<(String, String), String> {
        let argv = argv.unwrap_or_default();
        self.require_document(on)?;
        let labels = json!({ "herdr.space": crate::mirror::local(space, on), "herdr.tab": crate::mirror::local(ctx, on), "herdr.seen": "0" });
        let (addr, cwd) = run_following_folder(cwd, follow, on, |cwd| match self.core.run(argv.clone(), cwd.clone(), labels.clone(), on, size, crate::terminal::initial_display(window)) {
            // An agent on a machine without `sh` (Windows): in its PowerShell instead.
            Err(e) if on.is_some() && argv.first().map(String::as_str) == Some("sh") && format!("{e:#}").contains("not found") => {
                self.core.run(Self::powershell_argv(&argv), cwd, labels.clone(), on, size, crate::terminal::initial_display(window))
            }
            r => r,
        })
        .map_err(|e| format!("cannot start a terminal: {e:#}"))?;
        self.born.borrow_mut().insert(addr.clone(), Instant::now());
        // Follow the launch folder until the first live folder report arrives.
        if !cwd.is_empty() {
            self.cwds.insert(addr.clone(), cwd.clone());
        }
        Ok((addr, cwd))
    }

    /// The PowerShell form of a remote agent start (`agent_argv`): the program,
    /// then a shell that stays.
    fn powershell_argv(sh: &[String]) -> Vec<String> {
        let cmd = sh.get(4..).unwrap_or_default();
        vec!["powershell.exe".into(), "-NoLogo".into(), "-NoExit".into(), "-Command".into(), crate::programs::powershell_line(cmd)]
    }

    /// An agent with its first message, in a shell that stays when the agent exits
    /// (on another machine: that machine's shell).
    fn agent_argv(argv: Option<Vec<String>>, task: Option<&str>, on: Option<&str>) -> Option<Vec<String>> {
        let task = task.map(str::trim).filter(|t| !t.is_empty());
        argv.filter(|a| !a.is_empty()).map(|mut cmd| {
            cmd.extend(task.map(str::to_owned));
            if on.is_some() {
                return crate::remote_shell::launch(cmd);
            }
            let sh = shell();
            if cfg!(windows) {
                // PowerShell has no `-ic`: run it, then stay. `&` finds npm's `.cmd` shims too.
                return vec![sh, "-NoExit".into(), "-Command".into(), crate::programs::powershell_line(&cmd)];
            }
            // macOS terminal sessions load login profiles (including Homebrew's PATH).
            unix_agent_argv(sh, cmd, cfg!(target_os = "macos"))
        })
    }

    /// A space with its first tab and terminal, shown at once.
    /// `machine`: another machine (`hc machine ls`); its space starts in that machine's home.
    fn new_space(&mut self, name: &str, folder: Option<String>, ctx_name: Option<&str>, argv: Option<Vec<String>>, task: Option<&str>, machine: Option<String>, window: &Window) -> Result<Value, String> {
        let follow = folder.is_none();
        let on = machine.as_deref();
        // The focused pane's folder only means something on its own machine.
        let here = || self.model.focused_pane().and_then(|p| self.model.address_of(&p))
            .filter(|a| a.split_once('/').map(|(m, _)| m) == on)
            .and_then(|a| self.cwds.get(&a).cloned());
        let folder = folder.or_else(here).unwrap_or_else(|| if on.is_some() { String::new() } else { home() });
        let (space, ctx, pane) = (self.model.fresh_id_on("sp", on), self.model.fresh_id_on("tb", on), self.model.fresh_id_on("p", on));
        let size = self.initial_size(&Tab::new(&ctx, "", &pane, "").root, &pane, window);
        let (addr, folder) = self.spawn(Self::agent_argv(argv.clone(), task, on).or(argv), folder, follow, &space, &ctx, on, size, window)?;
        let ctx_name = ctx_name.map(str::trim).unwrap_or_default();
        self.model.add_space(&space, name.trim(), &folder, Tab::new(&ctx, ctx_name, &pane, &addr));
        if let Some(p) = self.model.space_mut(&space) {
            p.machine = machine;
            p.attached = !follow;
        }
        Ok(json!({ "space": space, "tab": ctx, "terminal": addr }))
    }

    /// A tab in a space (default: the shown one), shown at once.
    fn new_tab(&mut self, space: Option<String>, name: &str, folder: Option<String>, argv: Option<Vec<String>>, task: Option<&str>, window: &Window) -> Result<Value, String> {
        let space = space.or_else(|| self.model.active_space().map(|p| p.id.clone())).ok_or("no space yet: make one first (space.new)")?;
        if self.model.space(&space).is_none() {
            return Err(format!("no space {space:?}"));
        }
        let follow = folder.is_none();
        let folder = folder.unwrap_or_else(|| self.folder_for(&space));
        let on = self.machine_of(&space);
        let (ctx, pane) = (self.model.fresh_id_on("tb", on.as_deref()), self.model.fresh_id_on("p", on.as_deref()));
        let size = self.initial_size(&Tab::new(&ctx, "", &pane, "").root, &pane, window);
        let (addr, _) = self.spawn(Self::agent_argv(argv.clone(), task, on.as_deref()).or(argv), folder, follow, &space, &ctx, on.as_deref(), size, window)?;
        self.model.add_tab(&space, Tab::new(&ctx, name.trim(), &pane, &addr));
        self.model.active = Some(space.clone());
        Ok(json!({ "space": space, "tab": ctx, "terminal": addr }))
    }

    /// A tab whose only pane is a mod (a file, a board), shown at once.
    fn new_mod_tab(&mut self, space: Option<String>, name: &str, m: String, props: Value) -> Result<Value, String> {
        let space = space.or_else(|| self.model.active_space().map(|p| p.id.clone())).ok_or("no space yet: make one first (space.new)")?;
        if self.model.space(&space).is_none() {
            return Err(format!("no space {space:?}"));
        }
        if !self.folders.contains_key(&m) {
            return Err(format!("no mod {m:?} in mods/"));
        }
        let machine = self.machine_of(&space);
        self.require_document(machine.as_deref())?;
        let (ctx, pane) = (self.model.fresh_id_on("tb", machine.as_deref()), self.model.fresh_id_on("p", machine.as_deref()));
        self.model.add_tab(&space, Tab::with_pane(&ctx, name.trim(), Node::block(pane.clone(), Content::Mod { name: m, props })));
        self.model.active = Some(space.clone());
        Ok(json!({ "space": space, "tab": ctx, "pane": pane }))
    }

    fn split(&mut self, pane: Option<String>, dir: model::Direction, argv: Option<Vec<String>>, folder: Option<String>, window: &Window) -> Result<Value, String> {
        let target = pane.or_else(|| self.model.focused_pane()).ok_or("no pane to split")?;
        let (Some(p), Some(c)) = (self.model.space_of(&target), self.model.tab_of(&target)) else { return Err(format!("no pane {target:?}")) };
        let (space, ctx, fallback) = (p.id.clone(), c.id.clone(), p.folder.clone());
        let target_addr = self.model.address_of(&target);
        let follow = folder.is_none();
        let cwd = folder.unwrap_or_else(|| target_addr.as_ref().and_then(|a| self.cwds.get(a).cloned()).unwrap_or(fallback));
        // A split stays on the machine of the pane it splits (else its space's).
        let on = target_addr.and_then(|a| a.split_once('/').map(|(m, _)| m.to_owned())).or_else(|| self.machine_of(&space));
        let new = self.model.fresh_id_on("p", on.as_deref());
        let (axis, before) = self.model.split_side(&target, dir);
        let mut root = self.model.tab(&ctx).expect("target tab").root.clone();
        root.split_at(&target, axis, before, Node::block(new.clone(), Content::Terminal { terminal: String::new() }), "initial-size".into());
        let size = self.model.active_tab().filter(|tab| tab.id == ctx)
            .and_then(|_| self.initial_size(&root, &new, window));
        let (addr, _) = self.spawn(argv, cwd, follow, &space, &ctx, on.as_deref(), size, window)?;
        self.model.split_toward(&target, dir, model::pane(&new, &addr));
        Ok(json!({ "pane": new, "terminal": addr }))
    }

    /// A mod as a pane beside the target (a viewer next to the shell).
    /// A web link (a terminal's, a mod's, `app.open_url`): a web pane beside
    /// `pane` (default: the focused one; with none, a tab of its own) when the
    /// app has one and `links` (or `place`) says "app"; else the system's browser.
    /// A link to a local file a viewer shows (a mod's `cx.open_url("/a/shot.png")`,
    /// a `file://` link) opens in that viewer instead.
    fn open_link(&mut self, url: &str, pane: Option<String>, place: Option<&str>, window: &mut Window, cx: &mut Context<Self>) -> Result<Value, String> {
        if let Some((viewer, path)) = crate::links::resolve(url, None).as_ref().and_then(crate::links::viewable) {
            return self.open_viewer(viewer, &path.to_string_lossy(), pane, place, None, Value::Null, window, cx);
        }
        // The web pane is a native view: macOS only, and only with its mod installed.
        let web_pane = crate::native_view::capabilities()["available"] == json!(true) && self.folders.contains_key(WEB_MOD);
        let system = || {
            crate::links::open(&crate::links::Target::Url(url.to_owned()));
            Ok(json!({ "opened": "system" }))
        };
        if !link_in_app(url, place, settings::get().links, web_pane)? {
            return system();
        }
        let props = json!({ "url": url, "slot": web_slot() });
        let pane = pane.filter(|p| self.model.tab_of(p).is_some()).or_else(|| self.model.focused_pane());
        let r = match pane {
            Some(pane) => self.run_as("pane.split", json!({ "direction": "auto", "pane": pane, "mod": WEB_MOD, "props": props }), false, window, cx),
            None => self.run_as("tab.new", json!({ "name": "web", "mod": WEB_MOD, "props": props }), false, window, cx),
        };
        if let Some(e) = r.get("error") {
            tracing::warn!("no web pane for {url} ({e}); the system's browser opens it");
            return system();
        }
        let mut r = r;
        r["opened"] = json!("app");
        Ok(r)
    }

    /// A file one of the app's viewers shows (`links::Viewer`: a terminal's or a
    /// mod's link, `markdown.open`, `preview.open` (`image.open`), `files.open` for a folder):
    /// that viewer mod beside `pane` (default: the focused one; with none, or `in` "tab",
    /// a tab of its own), or the viewer in that tab already showing it; the system's
    /// app with `in` "system" or without the viewer. A relative path is the pane's folder's. `extra`: more
    /// props for the viewer (Markdown's `anchor`).
    #[allow(clippy::too_many_arguments)]
    fn open_viewer(&mut self, viewer: Viewer, path: &str, pane: Option<String>, place: Option<&str>, on: Option<&str>, extra: Value, window: &mut Window, cx: &mut Context<Self>) -> Result<Value, String> {
        let viewer_mod = viewer.mod_name();
        let pane = pane.filter(|p| self.model.tab_of(p).is_some()).or_else(|| self.model.focused_pane());
        let on = on.filter(|m| !m.is_empty());
        let path = match path.trim() {
            "" => return Err("path is required".into()),
            p if p.starts_with("~/") => format!("{}/{}", home(), &p[2..]),
            p if std::path::Path::new(p).is_absolute() || on.is_some() => p.to_owned(),
            p => {
                let cwd = pane.as_ref().and_then(|id| self.terms.get(id)).and_then(|t| t.view.read(cx).cwd.clone())
                    .ok_or_else(|| format!("{p:?} is relative and the pane has no folder: give an absolute path"))?;
                cwd.join(p).to_string_lossy().into_owned()
            }
        };
        // A folder: one name for it, however the link wrote it.
        let path = match viewer {
            Viewer::Files if path.len() > 1 => path.trim_end_matches('/').to_owned(),
            _ => path,
        };
        let system = |path: &str| {
            crate::links::open(&crate::links::Target::File(path.into()));
            Ok(json!({ "opened": "system", "path": path }))
        };
        // "tab": a tab of its own, even with a pane to open beside.
        let tab = match place {
            None | Some("app") | Some("pane") => false,
            Some("tab") => true,
            Some("system") if on.is_none() => return system(&path),
            Some("system") => return Err("in \"system\" opens files on this computer only".into()),
            Some(other) => return Err(format!("in is \"app\", \"pane\", \"tab\" or \"system\", not {other:?}")),
        };
        if !self.folders.contains_key(viewer_mod) {
            return if on.is_none() { system(&path) } else { Err(format!("no mod {viewer_mod:?} in mods/")) };
        }
        // Clicking the same link again shows the viewer already open on it: the
        // file a viewer shows now (it notes that by slot in shared `<mod>.paths`,
        // having moved on from the one it opened with; a list when it holds
        // several, the editor's tabs), else its props' file.
        let now = crate::mods::shared(&format!("{viewer_mod}.paths"));
        let shown = pane.as_ref().filter(|_| !tab).and_then(|p| self.model.tab_of(p)).and_then(|tab| {
            tab.root.panes().into_iter().find(|n| matches!(n.content(), Some(Content::Mod { name, props }) if name == viewer_mod && {
                let noted = props.get("slot").and_then(Value::as_str).and_then(|slot| now.as_ref()?.get(slot).cloned());
                let showing = match noted {
                    Some(Value::String(p)) => p == path,
                    Some(Value::Array(list)) => list.iter().any(|p| p.as_str() == Some(path.as_str())),
                    _ => props.get("path").and_then(Value::as_str) == Some(path.as_str()),
                };
                showing && props.get("on").and_then(Value::as_str) == on
            })).map(|n| n.id.clone())
        });
        // An editor in the tab takes the file as a new tab (nocturne-editor's
        // tabs, its editor-route.js): the one that last had the keyboard, else
        // the first; never a scratchpad's. `in: "pane"`: a new editor beside.
        let into = (viewer == Viewer::Editor && shown.is_none() && !tab && place != Some("pane"))
            .then(|| pane.as_ref().and_then(|p| self.model.tab_of(p)))
            .flatten()
            .and_then(|t| {
                let eds: Vec<(String, Value)> = t.root.panes().into_iter().filter_map(|n| match n.content() {
                    Some(Content::Mod { name, props }) if name == viewer_mod => Some((n.id.clone(), props.clone())),
                    _ => None,
                }).collect();
                let last = crate::mods::shared("nocturne-editor.last");
                tab_editor(&eds, on, last.as_ref().and_then(Value::as_str), &crate::mods::app_dir().join("scratchpad"))
            });
        if let Some((id, slot)) = into {
            let n = crate::mods::shared("nocturne-editor.open").and_then(|r| r.get("n").and_then(Value::as_u64)).unwrap_or(0) + 1;
            let at = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
            let mut req = json!({ "slot": slot, "path": path, "n": n, "at": at });
            if extra.get("line").is_some() {
                req["line"] = extra["line"].clone();
                req["col"] = extra.get("col").cloned().unwrap_or(json!(1));
            }
            if extra.get("look").and_then(Value::as_bool) == Some(true) {
                req["look"] = json!(true);
            }
            crate::mods::set_shared("nocturne-editor.open".into(), req);
            let r = self.run_as("pane.focus", json!({ "pane": id }), false, window, cx);
            return match r.get("error") {
                Some(e) => Err(e.to_string()),
                None => Ok(json!({ "pane": id, "opened": "app", "path": path, "as": "tab" })),
            };
        }
        if let Some(id) = shown {
            // The editor already on the file shows it (its tab) and moves to the
            // place asked for: it watches shared `nocturne-editor.goto` for its paths.
            if viewer == Viewer::Editor {
                let n = crate::mods::shared("nocturne-editor.goto").and_then(|g| g.get("n").and_then(Value::as_u64)).unwrap_or(0) + 1;
                let mut goto = json!({ "path": path, "n": n });
                if extra.get("line").is_some() {
                    goto["line"] = extra["line"].clone();
                    goto["col"] = extra.get("col").cloned().unwrap_or(json!(1));
                }
                crate::mods::set_shared("nocturne-editor.goto".into(), goto);
            }
            let r = self.run_as("pane.focus", json!({ "pane": id }), false, window, cx);
            return match r.get("error") {
                Some(e) => Err(e.to_string()),
                None => Ok(json!({ "pane": id, "opened": "app", "path": path })),
            };
        }
        let mut props = json!({ "path": path, "on": on, "slot": web_slot() });
        if let (Some(props), Value::Object(extra)) = (props.as_object_mut(), extra) {
            props.extend(extra);
        }
        let r = match pane.filter(|_| !tab) {
            Some(pane) => self.run_as("pane.split", json!({ "direction": "auto", "pane": pane, "mod": viewer_mod, "props": props }), false, window, cx),
            None => self.run_as("tab.new", json!({ "name": viewer.tab_name(), "mod": viewer_mod, "props": props }), false, window, cx),
        };
        if let Some(e) = r.get("error") {
            return Err(e.as_str().map_or_else(|| e.to_string(), str::to_owned));
        }
        let mut r = r;
        r["opened"] = json!("app");
        r["path"] = json!(path);
        Ok(r)
    }

    fn split_mod(&mut self, pane: Option<String>, dir: model::Direction, name: String, props: Value) -> Result<Value, String> {
        let target = pane.or_else(|| self.model.focused_pane()).ok_or("no pane to split")?;
        if self.model.tab_of(&target).is_none() {
            return Err(format!("no pane {target:?}"));
        }
        if !self.folders.contains_key(&name) {
            return Err(format!("no mod {name:?} in mods/"));
        }
        let machine = self.model.space_of(&target).and_then(|s| s.machine.clone());
        self.require_document(machine.as_deref())?;
        let new = self.model.fresh_id_on("p", machine.as_deref());
        self.model.split_toward(&target, dir, Node::block(new.clone(), Content::Mod { name, props }));
        Ok(json!({ "pane": new }))
    }

    /// `pane.split {edge}`: a new pane along one edge of a whole tab (default:
    /// the shown one), spanning it; `px` fixes its size. A terminal, or `mod`.
    fn split_at_edge(&mut self, tab: Option<String>, edge: crate::layout::Edge, px: Option<f32>, a: &Value, window: &Window) -> Result<Value, String> {
        let ctx = tab.or_else(|| self.model.active_tab().map(|c| c.id.clone())).ok_or("no tab to split")?;
        let (Some(p), Some(c)) = (self.model.space_of(&ctx), self.model.tab(&ctx)) else { return Err(format!("no tab {ctx:?}")) };
        let (space, root, fallback) = (p.id.clone(), c.root.clone(), p.folder.clone());
        let here = c.focused_pane().and_then(|f| self.model.address_of(&f));
        let on = self.machine_of(&space);
        self.require_document(on.as_deref())?;
        let new = self.model.fresh_id_on("p", on.as_deref());
        let sized = |mut n: Node| {
            n.size = px.map(|px| Span::Px { px });
            n
        };
        if let Some(name) = Self::owned(a, "mod") {
            if !self.folders.contains_key(&name) {
                return Err(format!("no mod {name:?} in mods/"));
            }
            let props = a.get("props").cloned().unwrap_or(Value::Null);
            self.model.split_edge(&ctx, edge, sized(Node::block(new.clone(), Content::Mod { name, props })));
            return Ok(json!({ "pane": new, "tab": ctx }));
        }
        let folder = Self::owned(a, "folder");
        let follow = folder.is_none();
        let cwd = folder
            .or_else(|| here.filter(|h| h.split_once('/').map(|(m, _)| m) == on.as_deref()).and_then(|h| self.cwds.get(&h).cloned()))
            .unwrap_or(fallback);
        let mut shown = root;
        shown.add_at_edge(edge, sized(Node::block(new.clone(), Content::Terminal { terminal: String::new() })), "initial-size".into());
        let size = self.model.active_tab().filter(|t| t.id == ctx).and_then(|_| self.initial_size(&shown, &new, window));
        let (addr, _) = self.spawn(Self::argv(a), cwd, follow, &space, &ctx, on.as_deref(), size, window)?;
        self.model.split_edge(&ctx, edge, sized(model::pane(&new, &addr)));
        Ok(json!({ "pane": new, "tab": ctx, "terminal": addr }))
    }

    /// Ask only whether a missing terminal is closed. Core owns restarting it.
    fn check_closed(&mut self, missing: Vec<(String, String)>, window: &mut Window, cx: &mut Context<Self>) {
        self.checking_closed = true;
        let core = self.core.clone();
        let generation = self.core_generation;
        cx.spawn_in(window, async move |this, cx| {
            let checked = cx.background_executor().spawn(async move {
                missing.into_iter().map(|(pane, addr)| {
                    let result = core.call("terminal.get", json!({"terminal":addr}));
                    (pane, addr, result)
                }).collect::<Vec<_>>()
            }).await;
            let _ = this.update_in(cx, |this, window, cx| this.checked_closed(generation, checked, window, cx));
        }).detach();
    }

    fn checked_closed(&mut self, generation: u64, checked: Vec<(String, String, anyhow::Result<Value>)>, window: &mut Window, cx: &mut Context<Self>) {
        self.checking_closed = false;
        if generation != self.core_generation { return; }
        let mut changed = false;
        for (pane, addr, result) in checked {
            if self.chrome.find(&pane).and_then(Node::terminal) == Some(addr.as_str()) {
                // A failed lookup is not evidence the program exited.
                if result.as_ref().is_ok_and(|v| v["state"] == "finished") {
                    self.chrome.remove_slot(&pane);
                    changed = true;
                }
            } else if self.model.address_of(&pane).as_deref() == Some(&addr) {
                let closed = match result {
                    Ok(v) => matches!(v["reason"].as_str(), Some("exited" | "killed")),
                    Err(e) => crate::hc::error_kind(&e) == Some("not_found"),
                };
                if closed {
                    self.notify_launch_failure(&addr, window, cx);
                    self.model.remove_pane(&pane);
                    changed = true;
                }
            }
        }
        if changed { self.sync(window, cx); }
    }

    fn just_born(&self, addr: &str) -> bool {
        let mut born = self.born.borrow_mut();
        // Keep launch facts until hidden panes have passed through `check_closed`.
        born.retain(|_, t| t.elapsed() < Duration::from_secs(30));
        born.get(addr).is_some_and(|t| t.elapsed() < Duration::from_secs(5))
    }

    /// `terminal.open {place: "float"}`: a terminal of the shown space's machine
    /// without a pane (no `herdr.space` label, so nothing adopts it), floating
    /// over the tab. Closing the float leaves it running; `terminal.keep` gives it a pane.
    fn open_float(&mut self, argv: Option<Vec<String>>, folder: Option<String>, view: Option<FloatView>, show: usize, window: &mut Window, cx: &mut Context<Self>) -> Result<Value, String> {
        if let Some(v) = &view && !self.folders.contains_key(&v.name) {
            return Err(format!("no mod {:?} in mods/", v.name));
        }
        if show == 1 && view.is_none() {
            return Err("show 1 needs a view".into());
        }
        let space = self.model.active_space().map(|p| p.id.clone()).ok_or("no space yet: make one first (space.new)")?;
        let on = self.machine_of(&space);
        let here = self.model.focused_pane().and_then(|p| self.model.address_of(&p))
            .filter(|a| a.split_once('/').map(|(m, _)| m) == on.as_deref())
            .and_then(|a| self.cwds.get(&a).cloned());
        let cwd = folder.or(here).unwrap_or_else(|| self.folder_for(&space));
        self.require_document(on.as_deref())?;
        let labels = json!({ "herdr.space": "", "herdr.tab": "", "herdr.seen": "0" });
        // Not listed yet: its view names come from what it runs.
        let view = view.map(|v| FloatView { term: Some(program_name(None, argv.as_deref().unwrap_or_default())), ..v });
        let addr = self.core.run(argv.unwrap_or_default(), Some(cwd).filter(|c| !c.is_empty()), labels, on.as_deref(), None, crate::terminal::initial_display(window))
            .map_err(|e| format!("cannot start a terminal: {e:#}"))?;
        self.born.borrow_mut().insert(addr.clone(), Instant::now());
        self.peek_terminal(&addr, true, view, show, window, cx);
        Ok(json!({ "terminal": addr }))
    }

    /// Gives a running terminal without a pane (a sub-agent, say) one in the
    /// shown space and focuses it; already in a pane: focuses that.
    fn keep_terminal(&mut self, addr: &str, place: &str, pane: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Result<Value, String> {
        if let Some(p) = self.model.pane_of(addr) {
            self.model.focus_pane(&p);
            return Ok(json!({ "pane": p }));
        }
        if !self.live.contains_key(addr) { return Err(format!("no running terminal {addr:?}")); }
        if self.changing_terminals.contains(addr) { return Err("This terminal already has a pane change in progress.".into()); }
        // A split beside a pane (the given one, else the focused one); anything else: a new tab.
        let dir = model::Direction::parse(place);
        let target = dir.and_then(|_| pane.or_else(|| self.model.focused_pane()));
        if let Some(t) = &target && self.model.tab_of(t).is_none() {
            return Err(format!("no pane {t:?}"));
        }
        let space = target.as_deref().and_then(|t| self.model.space_of(t)).or_else(|| self.model.active_space())
            .map(|p| p.id.clone()).ok_or("no space to keep it in")?;
        let machine = self.machine_of(&space);
        if addr.split_once('/').map(|(m, _)| m) != machine.as_deref() {
            return Err("A terminal's pane must stay on its own machine.".into());
        }
        self.require_document(machine.as_deref())?;
        let ctx = target.as_deref().and_then(|p| self.model.tab_of(p)).map(|t| t.id.clone())
            .unwrap_or_else(|| self.model.fresh_id_on("tb", machine.as_deref()));
        let pane = self.model.fresh_id_on("p", machine.as_deref());
        let name = self.live.get(addr).and_then(|r| r["name"].as_str()).filter(|s| !s.is_empty()).map(str::to_owned)
            .or_else(|| self.model.agents.get(addr).and_then(|a| a.app.as_deref()).map(crate::programs::name)).unwrap_or_else(|| addr.to_owned());
        let address = addr.to_owned();
        let reply = json!({"pending":true,"terminal":addr,"pane":pane,"tab":ctx});
        self.start_terminal_change(address, TerminalChange::Keep {
            space, tab: ctx, pane, name, target, dir: dir.unwrap_or(model::Direction::Right),
        }, window, cx);
        Ok(reply)
    }

    /// Parking changes labels/keep in the background; only a successful reply removes the pane.
    fn park_terminal(&mut self, addr: &str, window: &mut Window, cx: &mut Context<Self>) -> Result<Value, String> {
        self.require_document(addr.split_once('/').map(|(m, _)| m))?;
        if self.changing_terminals.contains(addr) { return Err("This terminal already has a pane change in progress.".into()); }
        self.start_terminal_change(addr.to_owned(), TerminalChange::Park, window, cx);
        Ok(json!({"pending":true,"terminal":addr}))
    }

    fn start_terminal_change(&mut self, address: String, change: TerminalChange, window: &mut Window, cx: &mut Context<Self>) {
        let machine = address.split_once('/').map(|(m, _)| m);
        let (keep, labels) = match &change {
            TerminalChange::Keep { space, tab, .. } => (true, json!({
                "herdr.space":crate::mirror::local(space, machine), "herdr.tab":crate::mirror::local(tab, machine),
            })),
            TerminalChange::Park => (false, json!({"herdr.space":"","herdr.tab":""})),
        };
        let (tx, rx) = std::sync::mpsc::channel();
        self.changing_terminals.insert(address.clone());
        self.pending_terminals.insert(address.clone(), PendingTerminalChange { change, reply: rx });
        let core = self.core.clone();
        let addr = address.clone();
        // The drain must not need the foreground continuation to start this work.
        let job = cx.background_executor().spawn(async move {
            let result = (|| {
                core.call("terminal.label", json!({"terminal":addr,"labels":labels}))?;
                core.call("terminal.keep", json!({"terminal":addr,"keep":keep}))?;
                anyhow::Ok(())
            })().map_err(|e| format!("{e:#}"));
            let _ = tx.send(result);
        });
        cx.spawn_in(window, async move |this, cx| {
            job.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.draining { return; }
                let Some(pending) = this.pending_terminals.remove(&address) else { return };
                let result = pending.reply.try_recv().unwrap_or_else(|e| Err(format!("terminal change reply missing: {e}")));
                this.apply_terminal_change(address, pending.change, result, window, cx);
            });
        }).detach();
    }

    fn apply_terminal_change(&mut self, address: String, change: TerminalChange, result: Result<(), String>, window: &mut Window, cx: &mut Context<Self>) {
        self.changing_terminals.remove(&address);
        if let Err(error) = result {
            tracing::error!("terminal change for {address} failed: {error}");
            if !self.draining { self.layout_notice("Could not change terminal pane", &error, window, cx); }
            return;
        }
        match change {
            TerminalChange::Keep { space, tab, pane, name, target, dir } => {
                if !self.live.contains_key(&address) { return; }
                if self.model.space(&space).is_none() {
                    if let Err(error) = self.park_terminal(&address, window, cx) {
                        tracing::error!("cannot undo pane placement into closed space: {error}");
                    }
                    return;
                }
                if self.model.pane_of(&address).is_none() {
                    let destination = target.filter(|p| self.model.tab_of(p).is_some_and(|t| t.id == tab))
                        .or_else(|| self.model.tab(&tab).and_then(|t| t.root.panes().first().map(|p| p.id.clone())));
                    if let Some(target) = destination {
                        self.model.split_toward(&target, dir, model::pane(&pane, &address));
                    } else {
                        self.model.add_tab(&space, Tab::new(&tab, &name, &pane, &address));
                    }
                }
                if let Some(pane) = self.model.pane_of(&address) { self.model.focus_pane(&pane); }
            }
            TerminalChange::Park => {
                if let Some(pane) = self.model.pane_of(&address) { self.model.remove_pane(&pane); }
            }
        }
        if !self.draining {
            self.sync(window, cx);
            self.flush_documents(false, window, cx);
        }
    }

    /// Kills terminals and their sub-agents, all the way down. Core keeps a
    /// sub-agent running when its parent dies; closing one here means done with
    /// its whole tree. Kept sub-agents (given a tab) are the person's: spared.
    /// These terminals and the ones they started (`parent`), which end with
    /// them unless a space keeps them (`herdr.space`).
    fn doomed(&self, addresses: &[String]) -> Vec<String> {
        let mut doomed: Vec<String> = addresses.to_vec();
        let mut i = 0;
        while i < doomed.len() {
            let parent = doomed[i].clone();
            for (addr, rec) in &self.live {
                let child = rec.get("parent").and_then(Value::as_str) == Some(parent.as_str());
                let kept = rec.get("labels").and_then(|l| l.get("herdr.space")).and_then(Value::as_str).is_some_and(|w| !w.is_empty());
                if child && !kept && !doomed.contains(addr) {
                    doomed.push(addr.clone());
                }
            }
            i += 1;
        }
        doomed
    }

    fn kill(&mut self, addresses: &[String], cx: &mut Context<Self>) {
        let doomed = self.doomed(addresses);
        self.closing_terminals.extend(doomed.iter().cloned().map(|a| (a, false)));
        // Off the UI thread: a kill waits for the program to go, and for slow machines.
        let core = self.core.clone();
        cx.spawn(async move |this, cx| {
            for address in doomed {
                let core = core.clone();
                let addr = address.clone();
                let result = cx.background_executor().spawn(async move {
                    core.call("terminal.kill", json!({ "terminal": addr }))
                }).await;
                let _ = this.update(cx, |this, _| {
                    if result.is_ok() && this.live.contains_key(&address) {
                        // The live snapshot may still predate the kill's reply.
                        this.closing_terminals.insert(address, true);
                    } else {
                        this.closing_terminals.remove(&address);
                    }
                });
            }
        }).detach();
    }

    // ---- commands ----------------------------------------------------------

    /// Runs a keys.json action string: `name`, `name:value` (the value fills
    /// the command's first argument), `send:<text>`, or `<mod>.<command>`.
    fn run_action(&mut self, action: &str, window: &mut Window, cx: &mut Context<Self>) {
        // `send:` is only meaningful in a terminal, which handles it before it gets here.
        if !action.starts_with("send:") {
            self.run_key(action, Value::Null, window, cx);
        }
    }

    fn run_key(&mut self, name: &str, args: Value, window: &mut Window, cx: &mut Context<Self>) {
        // Close the dialog holding the keyboard, not the terminal behind it.
        let implicit_close = match crate::keys::current(name).as_str() {
            "tab.close" => Self::arg(&args, "id").is_none(),
            "pane.close" => Self::arg(&args, "pane").is_none(),
            _ => false,
        };
        if implicit_close && self.overlays.iter().any(|o| o.kind.modal_keys())
        {
            self.run("overlay.close", json!({}), window, cx);
        } else if implicit_close && let Some(id) = self.top_scrim_window() {
            // A window with a scrim is modal: cmd-w closes it, not the tab behind.
            self.close_overlay(&id, window, cx);
        } else {
            self.run(name, args, window, cx);
        }
    }

    fn argv(args: &Value) -> Option<Vec<String>> {
        args.get("argv").and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    fn arg<'a>(args: &'a Value, k: &str) -> Option<&'a str> {
        args.get(k).and_then(Value::as_str)
    }

    fn owned(args: &Value, k: &str) -> Option<String> {
        Self::arg(args, k).map(str::to_owned)
    }

    fn answer(&mut self, r: Result<Value, String>) {
        if let Err(e) = &r {
            tracing::warn!("{e}");
        }
        self.reply = Some(r.unwrap_or_else(|e| json!({ "error": e })));
    }

    fn fail(&mut self, message: impl Into<String>) {
        self.answer(Err(message.into()));
    }

    /// Runs a command for the person (keys, clicks, menus, mods): a missing
    /// name is asked for.
    fn run(&mut self, name: &str, args: Value, window: &mut Window, cx: &mut Context<Self>) {
        // A click or key has nobody to read the reply: show why it failed.
        if let Some(error) = self.run_as(name, args, true, window, cx).get("error").and_then(Value::as_str) {
            self.command_error(name, error, window, cx);
        }
    }

    fn command_error(&mut self, name: &str, error: &str, window: &mut Window, cx: &mut Context<Self>) {
        let spec = json!({"kind":"toast", "notification":{"title":format!("{name} failed"),"body":error,"level":"error"}});
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    /// Runs a command and says what it made or why not. Scripts and agents
    /// (`person: false`) never get a dialog: a missing argument is an error.
    fn run_as(&mut self, name: &str, mut args: Value, person: bool, window: &mut Window, cx: &mut Context<Self>) -> Value {
        // A mod someone edited under 0.1.0 still says project.* / context.*.
        let current = crate::keys::current(name);
        let name = current.as_str();
        // `name:value`, as in keys.json.
        if let Some((n, v)) = name.split_once(':')
            && let Some(c) = crate::commands::find(n)
        {
            if let Err(error) = crate::commands::validate_args(c, &args) {
                return json!({ "error": error });
            }
            if c.args.is_empty() {
                return json!({ "error": format!("{n}: unexpected shorthand argument; valid arguments: none") });
            }
            let mut short = crate::commands::shorthand(c, v);
            if let (Some(s), Some(extra)) = (short.as_object_mut(), args.as_object()) {
                s.extend(extra.clone());
            }
            args = short;
            return self.run_as(n, args, person, window, cx);
        }
        let Some(command) = crate::commands::find(name) else {
            // `<mod>.<command>` goes to that mod's nextCommand() (a renamed mod's old name to it).
            if let Some((m, c)) = name.split_once('.')
                && mods::send_command(crate::layout::current_mod_name(m), c)
            {
                return json!({ "ok": true });
            }
            tracing::warn!("unknown command {name:?}");
            return json!({ "error": format!("unknown command {name:?}: see `herdr-app commands`; a mod's are <mod>.<command> and need the mod loaded") });
        };
        if let Err(error) = crate::commands::validate_args(command, &args) {
            return json!({ "error": error });
        }
        // pane.go from a mod block starts at the block, not at the terminal block focused before it.
        if terminal_block(&self.chrome, self.focused_pane.as_deref()).is_some()
            && needs_model_pane(name, &args)
            && !(name == "pane.go" && self.focused_block.is_some())
        {
            return json!({ "error": "a terminal layout block is focused, not a pane; focus a pane or pass an explicit pane id" });
        }
        if person && name.ends_with(".rename") && args.get("name").is_none_or(Value::is_null) {
            self.ask_name(name, args, window, cx);
            return json!({ "asked": "name" });
        }
        if let Some(arg) = crate::commands::missing(command, &args) {
            return json!({ "error": format!("{name} needs {arg}") });
        }
        if name == "space.new" {
            let machine = new_space_machine(&args, person, &self.model);
            if !args.is_object() { args = json!({}); }
            args["machine"] = json!(machine);
        }
        if matches!(name, "space.new" | "space.close" | "space.rename" | "space.folder" | "space.move" | "tab.new" | "tab.close" | "tab.rename" | "tab.move" | "pane.split" | "pane.close" | "pane.swap" | "pane.move" | "pane.equalize" | "pane.resize" | "pane.park" | "pane.unpark" | "terminal.keep" | "terminal.park") {
            let node = ["id", "space", "pane", "tab"].into_iter().find_map(|k| Self::arg(&args, k));
            let target = node.and_then(|id| self.model.space(id).or_else(|| self.model.space_of(id))).or_else(|| self.model.active_space());
            let machine = if name == "space.new" { Self::arg(&args, "machine") }
                else if name == "terminal.park" { Self::arg(&args, "terminal").and_then(|a| a.split_once('/').map(|(m, _)| m)) }
                else { target.and_then(|s| s.machine.as_deref()) };
            if let Err(error) = self.require_document(machine) { return json!({"error":error}); }
        }
        if name == "layout.resize"
            && let Some(space) = Self::arg(&args, "id").and_then(|id| self.model.space_of(id))
            && let Err(error) = self.require_document(space.machine.as_deref())
        { return json!({"error":error}); }
        self.reply = None;
        self.dispatch(name, &args, person, window, cx);
        self.flush_documents(false, window, cx);
        self.reply.take().unwrap_or_else(|| json!({ "ok": true }))
    }

    /// Asks the person for a new name (space.rename, tab.rename), then runs it with it.
    /// The prompt starts with the name someone gave, empty for an automatic one.
    fn ask_name(&mut self, name: &str, mut args: Value, window: &mut Window, cx: &mut Context<Self>) {
        if !args.is_object() {
            args = json!({});
        }
        let (title, hint, current) = match name {
            "space.rename" => {
                let id = Self::owned(&args, "id").or_else(|| self.model.active.clone());
                let current = id.as_deref().and_then(|i| self.model.space(i)).map(|p| p.name.clone());
                args["id"] = json!(id);
                ("rename space", "empty: named after its folder", current)
            }
            _ => {
                let id = Self::owned(&args, "id").or_else(|| self.model.active_tab().map(|c| c.id.clone()));
                let current = id.as_deref().and_then(|i| self.model.tab(i)).map(|c| c.name.clone());
                args["id"] = json!(id);
                ("rename tab", "empty: its number", current)
            }
        };
        // Once: a second rename press closes the open prompt instead of stacking another.
        if self.overlays.iter().any(|o| o.id == "rename") {
            self.close_overlay("rename", window, cx);
            return;
        }
        let mut spec = json!({ "mod": "prompt", "kind": "dialog", "width": 380,
            "props": { "title": title, "value": current.as_deref().unwrap_or(""), "hint": hint, "command": { "name": name, "args": args } } });
        self.skin_dialog(&mut spec, self.chrome.prompt_mod.clone(), "prompt");
        self.open_overlay("rename".into(), spec, window, cx);
    }

    fn dispatch(&mut self, name: &str, a: &Value, person: bool, window: &mut Window, cx: &mut Context<Self>) {
        let active_ctx = self.model.active_tab().map(|c| c.id.clone());
        match name {
            // ---- spaces
            "space.new" => {
                let name = Self::arg(a, "name").unwrap_or_default();
                let r = self.new_space(name, Self::owned(a, "folder"), Self::arg(a, "tab"), Self::argv(a), Self::arg(a, "task"), Self::owned(a, "machine").filter(|m| !m.is_empty()), window);
                self.answer(r);
            }
            "space.close" => {
                let Some(id) = Self::owned(a, "id").or_else(|| self.model.active.clone()) else { return self.fail("no space to close") };
                let Some(p) = self.model.space(&id) else { return self.fail(format!("no space {id:?}")) };
                if a.get("confirmed").and_then(Value::as_bool) != Some(true) {
                    if !person {
                        return self.fail("space.close ends its terminals: pass confirmed: true");
                    }
                    let panes: usize = p.tabs.iter().map(|c| c.root.panes().len()).sum();
                    let mut detail = format!("{} \u{2014} {} tabs, {} terminals", self.model.space_name(p, &home()), p.tabs.len(), panes);
                    let tabs: Vec<String> = p.tabs.iter().map(|c| c.id.clone()).collect();
                    let endings: Vec<Ending> = tabs.iter().flat_map(|c| self.tab_endings(c)).collect();
                    if !endings.is_empty() {
                        detail = format!("{detail}\n\n{}", endings_summary(&endings));
                    }
                    self.confirm("Close space?", &detail, "space.close", json!({ "id": id, "confirmed": true }), window, cx);
                    return;
                }
                let addrs = self.model.remove_space(&id);
                self.kill(&addrs, cx);
            }
            "space.rename" => {
                let Some(id) = Self::owned(a, "id").or_else(|| self.model.active.clone()) else { return self.fail("no space to rename") };
                let Some(name) = Self::arg(a, "name") else { return self.fail("space.rename needs name (empty: automatic)") };
                let Some(p) = self.model.space_mut(&id) else { return self.fail(format!("no space {id:?}")) };
                p.name = name.trim().to_owned();
            }
            "space.folder" => {
                let Some(id) = Self::owned(a, "id").or_else(|| self.model.active.clone()) else { return self.fail("no space to attach") };
                let Some(folder) = Self::arg(a, "folder").map(str::trim).filter(|f| !f.is_empty()) else { return self.fail("space.folder needs folder") };
                let Some(p) = self.model.space_mut(&id) else { return self.fail(format!("no space {id:?}")) };
                p.folder = folder.to_owned();
                p.attached = true;
            }
            "space.move" => {
                let (Some(id), Some(i)) = (Self::arg(a, "id"), a.get("index").and_then(Value::as_u64)) else { return self.fail("space.move needs id and index") };
                if !self.model.move_space(id, i as usize) { return self.fail(format!("no space {id:?}")); }
            }
            "space.select" => {
                let id = Self::owned(a, "id").or_else(|| {
                    let i = a.get("index").and_then(Value::as_u64)? as usize;
                    self.model.spaces.get(i.checked_sub(1)?).map(|p| p.id.clone())
                });
                match id.filter(|id| self.model.space(id).is_some()) {
                    Some(id) => self.model.active = Some(id),
                    None => return self.fail("no such space"),
                }
            }
            "space.next" | "space.prev" => {
                let n = self.model.spaces.len();
                if let Some(i) = self.model.active_index().filter(|_| n > 0) {
                    let j = if name == "space.next" { (i + 1) % n } else { (i + n - 1) % n };
                    self.model.active = Some(self.model.spaces[j].id.clone());
                }
            }
            // ---- tabs
            "tab.new" => {
                let name = Self::arg(a, "name").unwrap_or_default();
                let r = match Self::owned(a, "mod") {
                    Some(m) => self.new_mod_tab(Self::owned(a, "space"), name, m, a.get("props").cloned().unwrap_or(Value::Null)),
                    // A person's new tab with no space open starts one, as space.new does.
                    None if person && a.get("space").is_none() && self.model.active_space().is_none() => {
                        self.new_space("", Self::owned(a, "folder"), Some(name), Self::argv(a), Self::arg(a, "task"), None, window)
                    }
                    None => self.new_tab(Self::owned(a, "space"), name, Self::owned(a, "folder"), Self::argv(a), Self::arg(a, "task"), window),
                };
                self.answer(r);
            }
            "tab.close" => {
                let Some(id) = Self::owned(a, "id").or(active_ctx) else { return self.fail("no tab to close") };
                let Some(p) = self.model.space_of(&id) else { return self.fail(format!("no tab {id:?}")) };
                // The last tab takes its space with it: ask like closing the space.
                if p.tabs.len() == 1 {
                    let mut args = json!({ "id": p.id });
                    args["confirmed"] = a.get("confirmed").cloned().unwrap_or(Value::Null);
                    return self.dispatch("space.close", &args, person, window, cx);
                }
                // An agent there (whatever its status), a program running or
                // unsaved work: the person says so first; a script passes
                // confirmed. A tab of shells at their prompts just closes.
                if a.get("confirmed").and_then(Value::as_bool) != Some(true) {
                    let endings = self.tab_endings(&id);
                    if !endings.is_empty() {
                        if !person {
                            return self.fail(format!("tab.close ends what runs there ({}): pass confirmed: true", endings_summary(&endings).replace('\n', " \u{b7} ")));
                        }
                        self.confirm("Close tab?", &close_detail(&endings, "tab"), "tab.close", json!({ "id": id, "confirmed": true }), window, cx);
                        return;
                    }
                }
                let (addrs, _) = self.model.remove_tab(&id);
                self.kill(&addrs, cx);
            }
            "tab.rename" => {
                let Some(id) = Self::owned(a, "id").or(active_ctx) else { return self.fail("no tab to rename") };
                let Some(name) = Self::arg(a, "name") else { return self.fail("tab.rename needs name (empty: its number)") };
                let Some(c) = self.model.tab_mut(&id) else { return self.fail(format!("no tab {id:?}")) };
                c.name = name.trim().to_owned();
            }
            "tab.move" => {
                let (Some(id), Some(i)) = (Self::arg(a, "id"), a.get("index").and_then(Value::as_u64)) else { return self.fail("tab.move needs id and index") };
                let Some(pid) = self.model.space_of(id).map(|p| p.id.clone()) else { return self.fail(format!("no tab {id:?}")) };
                let p = self.model.space_mut(&pid).unwrap();
                let from = p.tabs.iter().position(|c| c.id == id).unwrap();
                let c = p.tabs.remove(from);
                let to = (i as usize).saturating_sub(1).min(p.tabs.len());
                p.tabs.insert(to, c);
            }
            "tab.settle" | "tab.unsettle" => {
                let Some(id) = Self::owned(a, "id").or(active_ctx) else { return self.fail("no tab") };
                let found = if name == "tab.settle" { self.model.settle(&id, model::now_ms()) } else { self.model.tab(&id).is_some() && { self.model.unsettle(&id); true } };
                if !found {
                    return self.fail(format!("no tab {id:?}"));
                }
            }
            "tab.select" => {
                // By position among the tabs the lists show (settled ones are put away).
                let id = Self::owned(a, "id").or_else(|| {
                    let i = a.get("index").and_then(Value::as_u64)? as usize;
                    self.model.active_space()?.tabs.iter().filter(|c| c.settled.is_none()).nth(i.checked_sub(1)?).map(|c| c.id.clone())
                });
                if !id.is_some_and(|id| self.model.select_tab(&id)) {
                    return self.fail("no such tab");
                }
            }
            "tab.next" | "tab.prev" => {
                if let Some(p) = self.model.active_space()
                    && let Some(i) = active_ctx.as_ref().and_then(|c| p.tabs.iter().position(|x| x.id == *c))
                {
                    let n = p.tabs.len();
                    let step = |k: usize| if name == "tab.next" { (i + k) % n } else { (i + n * k - k) % n };
                    if let Some(id) = (1..n).map(|k| &p.tabs[step(k)]).find(|c| c.settled.is_none()).map(|c| c.id.clone()) {
                        self.model.select_tab(&id);
                    }
                }
            }
            // ---- panes
            "pane.split" => {
                let r = if let Some(edge) = a.get("edge").filter(|e| !e.is_null()) {
                    let Some(edge) = edge.as_str().and_then(split_edge) else {
                        return self.fail(format!("pane.split edge is \"right\", \"left\", \"top\" or \"bottom\", not {edge}"));
                    };
                    let px = match a.get("px").filter(|p| !p.is_null()) {
                        None => None,
                        Some(p) => match p.as_f64().filter(|p| *p > 0.0) {
                            Some(p) => Some(p as f32),
                            None => return self.fail(format!("pane.split px is a number above 0, not {p}")),
                        },
                    };
                    self.split_at_edge(Self::owned(a, "tab"), edge, px, a, window)
                } else {
                    let Some(dir) = Self::arg(a, "direction").and_then(model::Direction::parse) else {
                        return self.fail(format!(
                            "pane.split direction is \"right\", \"down\", \"left\", \"up\" or \"auto\" (or give edge), not {:?}",
                            Self::arg(a, "direction")
                        ));
                    };
                    match Self::owned(a, "mod") {
                        Some(name) => self.split_mod(Self::owned(a, "pane"), dir, name, a.get("props").cloned().unwrap_or(Value::Null)),
                        None => self.split(Self::owned(a, "pane"), dir, Self::argv(a), Self::owned(a, "folder"), window),
                    }
                };
                self.answer(r);
            }
            "pane.close" => {
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to close") };
                let confirmed = a.get("confirmed").and_then(Value::as_bool) == Some(true);
                let parked = self.model.parked_tab_of(&pane).is_some();
                if !parked {
                    let Some(c) = self.model.tab_of(&pane) else { return self.fail(format!("no pane {pane:?}")) };
                    if c.root.find(&pane).is_some_and(|n| !n.closable()) {
                        return;
                    }
                    if c.root.panes().len() == 1 && c.parked.is_empty() {
                        let id = c.id.clone();
                        return self.dispatch("tab.close", &json!({ "id": id, "confirmed": a.get("confirmed").cloned().unwrap_or(Value::Null) }), person, window, cx);
                    }
                }
                // An agent in it (whatever its status) or a mod pane's unsaved
                // work: the person says so first; a script passes confirmed.
                let endings = if confirmed { vec![] } else { self.pane_endings(&pane) };
                if !endings.is_empty() {
                    let unsaved = endings.iter().all(|e| e.kind == EndingKind::Unsaved);
                    if !person {
                        let what = endings_summary(&endings).replace('\n', " \u{b7} ");
                        return self.fail(if unsaved { format!("pane.close loses {what}: pass confirmed: true") } else { format!("pane.close ends {what}: pass confirmed: true") });
                    }
                    let args = json!({ "pane": pane, "confirmed": true });
                    if unsaved {
                        self.confirm("Close without saving?", &format!("{}\n\nClosing the pane loses them.", endings_summary(&endings)), "pane.close", args, window, cx);
                    } else {
                        self.confirm("Close pane?", &close_detail(&endings, "pane"), "pane.close", args, window, cx);
                    }
                    return;
                }
                let addr = self.model.address_of(&pane);
                self.model.remove_pane(&pane);
                self.kill(&addr.into_iter().collect::<Vec<_>>(), cx);
                if parked {
                    return self.sync(window, cx);
                }
            }
            "pane.zoom" => {
                let pane = Self::owned(a, "pane").or_else(|| self.model.focused_pane());
                if let Some(pane) = pane
                    && let Some(ctx) = self.model.tab_of(&pane).map(|c| c.id.clone())
                    && let Some(c) = self.model.tab_mut(&ctx)
                    && c.root.panes().len() > 1
                {
                    c.zoomed = if c.zoomed.as_deref() == Some(pane.as_str()) { None } else { Some(pane) };
                }
            }
            "pane.font_bigger" | "pane.font_smaller" | "pane.font_reset" => {
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane") };
                let Some(ctx) = self.model.tab_of(&pane).map(|c| c.id.clone()) else { return self.fail(format!("no pane {pane:?}")) };
                let Some(c) = self.model.tab_mut(&ctx) else { return };
                let steps = match name {
                    "pane.font_bigger" => 1,
                    "pane.font_smaller" => -1,
                    _ => 0,
                };
                let zoom = settings::next_font_zoom(c.font_zoom.get(&pane).copied().unwrap_or(1.0), steps);
                if zoom == 1.0 {
                    c.font_zoom.remove(&pane);
                } else {
                    c.font_zoom.insert(pane, zoom);
                }
            }
            "pane.float" => {
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to float") };
                if self.model.tab_of(&pane).is_none() {
                    return self.fail(format!("no pane {pane:?}"));
                }
                let Some(addr) = self.model.address_of(&pane).filter(|a| self.live.contains_key(a)) else { return self.fail("only a running terminal's pane floats") };
                match self.park_terminal(&addr, window, cx) {
                    Ok(_) => {
                        self.peek_terminal(&addr, true, None, 0, window, cx);
                        self.answer(Ok(json!({ "pending": true, "terminal": addr })));
                    }
                    Err(e) => return self.fail(e),
                }
            }
            "pane.park" => {
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to park") };
                let index = match a.get("index").filter(|v| !v.is_null()) {
                    None => None,
                    Some(v) => match v.as_u64().filter(|i| *i >= 1) {
                        Some(i) => Some(i as usize - 1),
                        None => return self.fail(format!("pane.park index is a position from 1, not {v}")),
                    },
                };
                if let Err(e) = self.model.park_pane(&pane, index) {
                    return self.fail(e);
                }
                self.swapped.remove(&pane);
                self.focused_pane = None;
                self.answer(Ok(json!({ "pane": pane })));
            }
            "pane.unpark" => {
                let pane = Self::owned(a, "pane").or_else(|| self.model.active_tab().and_then(|t| t.parked.last()).map(|p| p.pane.id.clone()));
                let Some(pane) = pane else { return self.fail("no parked pane") };
                let edge = match Self::arg(a, "edge") {
                    None => None,
                    Some(e) => match split_edge(e) {
                        Some(e) => Some(e),
                        None => return self.fail(format!("pane.unpark edge is \"right\", \"left\", \"top\" or \"bottom\", not {e:?}")),
                    },
                };
                let target = Self::owned(a, "target");
                if edge.is_some() && target.is_none() {
                    return self.fail("pane.unpark edge needs target");
                }
                if let Err(e) = self.model.unpark_pane(&pane, target.as_deref().map(|t| (t, edge))) {
                    return self.fail(e);
                }
                self.focused_block = None;
                self.focused_pane = None;
                self.agent = self.model.address_of(&pane);
                self.answer(Ok(json!({ "pane": pane })));
            }
            "pane.move" => {
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to move") };
                let Some(space) = self.model.space_of(&pane).map(|s| (s.id.clone(), s.machine.clone())) else { return self.fail(format!("no pane {pane:?}")) };
                let edge = match Self::arg(a, "edge") {
                    None => None,
                    Some(e) => match split_edge(e) {
                        Some(e) => Some(e),
                        None => return self.fail(format!("pane.move edge is \"right\", \"left\", \"top\" or \"bottom\", not {e:?}")),
                    },
                };
                let target = Self::owned(a, "target");
                let into = match (Self::owned(a, "tab"), target) {
                    (Some(tab), target) => model::MoveInto::Tab { tab, target, edge },
                    // A target names its tab.
                    (None, Some(t)) => match self.model.tab_of(&t) {
                        Some(tab) => model::MoveInto::Tab { tab: tab.id.clone(), target: Some(t), edge },
                        None => return self.fail(format!("no pane {t:?}")),
                    },
                    (None, None) => {
                        let space = Self::owned(a, "space").unwrap_or(space.0);
                        let machine = self.model.space(&space).and_then(|s| s.machine.clone());
                        let name = Self::owned(a, "name").unwrap_or_default();
                        model::MoveInto::New { tab: self.model.fresh_id_on("tb", machine.as_deref()), space, name }
                    }
                };
                let tab = match self.model.move_to_tab(&pane, into) {
                    Ok(tab) => tab,
                    Err(e) => return self.fail(e),
                };
                // The terminal's labels say where it lives (a restart or
                // another client places it by them): its new tab now.
                if let Some(addr) = self.model.address_of(&pane)
                    && let Some(space) = self.model.space_of(&tab).map(|s| s.id.clone())
                {
                    let machine = addr.split_once('/').map(|(m, _)| m.to_owned());
                    let labels = json!({ "herdr.space": crate::mirror::local(&space, machine.as_deref()), "herdr.tab": crate::mirror::local(&tab, machine.as_deref()) });
                    let core = self.core.clone();
                    cx.background_executor().spawn(async move {
                        if let Err(e) = core.call("terminal.label", json!({ "terminal": addr, "labels": labels })) {
                            tracing::warn!("pane.move label: {e:#}");
                        }
                    }).detach();
                }
                self.focused_block = None;
                self.focused_pane = None;
                self.agent = self.model.address_of(&pane);
                self.answer(Ok(json!({ "pane": pane, "tab": tab })));
            }
            "pane.focus" => {
                if Self::arg(a, "pane").is_none()
                    && let Some(terminal) = Self::arg(a, "terminal")
                    && let Some(block) = self.chrome.visible_blocks().into_iter().find(|n| n.terminal() == Some(terminal))
                {
                    let id = block.id.clone();
                    self.focused_block = None;
                    self.focused_pane = Some(id.clone());
                    self.synced_model_pane = self.model.focused_pane();
                    if !self.keys_held() && let Some(f) = self.pane_focus(&id, cx) {
                        f.focus(window, cx);
                    }
                    self.publish(cx);
                    cx.notify();
                    return;
                }
                let pane = Self::owned(a, "pane").or_else(|| Self::arg(a, "terminal").and_then(|t| self.model.pane_of(t)));
                // A parked pane comes back (Model::focus_pane).
                let Some(p) = pane.filter(|p| self.model.tab_holding(p).is_some()) else { return self.fail("no such pane") };
                self.focused_block = None;
                self.model.focus_pane(&p);
                self.focused_pane = None;
                self.agent = self.model.address_of(&p);
                self.swapped.remove(&p);
                // A focusable mod pane takes the keyboard, as `pane.go` gives it.
                if self.focusable(&p) {
                    return self.focus_block(&p, window, cx);
                }
            }
            "pane.go" => {
                let dir = Self::arg(a, "direction").unwrap_or_default();
                if !matches!(dir, "left" | "right" | "up" | "down") {
                    return self.fail(format!("{name} direction is left, right, up or down, not {dir:?}"));
                }
                return self.go(dir, window, cx);
            }
            "pane.swap" => {
                let by = match swap_by(a) {
                    Ok(by) => by,
                    Err(e) => return self.fail(e),
                };
                let explicit = Self::arg(a, "pane").is_some();
                let pane = Self::owned(a, "pane").or_else(|| self.model.focused_pane());
                let r = match (by, pane) {
                    (SwapBy::Direction(dir), Some(pane)) => self.swap_pane(&pane, explicit, dir),
                    (SwapBy::Direction(_), None) => Ok(()),
                    (SwapBy::Target(target), Some(pane)) => self.model.swap_panes(&pane, target),
                    (SwapBy::Target(_), None) => Err("no pane to swap".into()),
                };
                if let Err(e) = r {
                    return self.fail(e);
                }
            }
            "pane.equalize" => {
                let scope = match a.get("scope").filter(|v| !v.is_null()) {
                    Some(v) if !v.is_string() => Err(format!("pane.equalize scope must be a string, not {v}")),
                    v => crate::equalize::Scope::parse(v.and_then(Value::as_str)),
                };
                let scope = match scope {
                    Ok(scope) => scope,
                    Err(e) => return self.fail(e),
                };
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to equalize") };
                match self.model.equalize(&pane, scope) {
                    Ok(changed) => self.answer(Ok(json!({ "ok": true, "changed": changed }))),
                    Err(e) => return self.fail(e),
                }
            }
            "pane.resize" => {
                let dir = match a.get("direction") {
                    Some(v) if !v.is_string() => Err(format!("pane.resize direction must be a string, not {v}")),
                    v => crate::pane_resize::Direction::parse(v.and_then(Value::as_str)),
                };
                let dir = match dir {
                    Ok(dir) => dir,
                    Err(e) => return self.fail(e),
                };
                let step = match a.get("step").filter(|v| !v.is_null()) {
                    None => crate::pane_resize::STEP,
                    Some(v) => match v.as_f64().filter(|s| *s > 0.0 && *s <= 1.0) {
                        Some(s) => s as f32,
                        None => return self.fail(format!("pane.resize step is a share of the tab above 0 and up to 1, not {v}")),
                    },
                };
                let Some(pane) = Self::owned(a, "pane").or_else(|| self.model.focused_pane()) else { return self.fail("no pane to resize") };
                // Lengths as last drawn, designed (unzoomed) like the sizes they become.
                let (bounds, zoom) = (self.bounds.clone(), settings::zoom());
                let length = |id: &str| bounds.borrow().get(id).map(|b| f32::from(match dir.axis() {
                    Axis::Row => b.size.width,
                    Axis::Column => b.size.height,
                }) / zoom);
                match self.model.resize_pane(&pane, dir, step, length) {
                    Ok(changed) => self.answer(Ok(json!({ "ok": true, "changed": changed }))),
                    Err(e) => return self.fail(e),
                }
            }
            // ---- terminals
            "terminal.open" => {
                let argv = Self::argv(a);
                let place = Self::arg(a, "place").unwrap_or("tab");
                let r = match place {
                    _ if let Some(dir) = model::Direction::parse(place) => self.split(Self::owned(a, "pane"), dir, argv, Self::owned(a, "folder"), window),
                    "float" => match (FloatView::parse(a.get("view")), float_show(a)) {
                        (Ok(view), Ok(show)) => self.open_float(argv, Self::owned(a, "folder"), view, show, window, cx),
                        (Err(e), _) | (_, Err(e)) => Err(format!("terminal.open: {e}")),
                    },
                    _ => {
                        let name = Self::owned(a, "name")
                            .or_else(|| argv.as_ref().and_then(|v| v.first()).map(|p| p.rsplit('/').next().unwrap_or(p).to_owned()))
                            .unwrap_or_else(|| "shell".into());
                        self.new_tab(None, &name, Self::owned(a, "folder"), argv, None, window)
                    }
                };
                self.answer(r);
            }
            "terminal.keep" => {
                let r = self.keep_terminal(Self::arg(a, "terminal").unwrap_or_default(), Self::arg(a, "place").unwrap_or("tab"), Self::owned(a, "pane"), window, cx);
                self.answer(r);
            }
            "terminal.park" => {
                let r = self.park_terminal(Self::arg(a, "terminal").unwrap_or_default(), window, cx);
                self.answer(r);
            }
            "terminal.right_click" => {
                let to = match Self::arg(a, "to") {
                    Some("program") => "program",
                    Some("menu") => "",
                    other => return self.fail(format!("terminal.right_click to is \"program\" or \"menu\", not {other:?}")),
                };
                let t = Self::owned(a, "terminal").or_else(|| self.focused_terminal(window, cx).map(|t| t.address.clone()));
                let Some(t) = t.filter(|t| self.live.contains_key(t)) else { return self.fail("no such running terminal") };
                // Off the UI thread: a terminal on a slow machine answers late.
                let core = self.core.clone();
                let params = json!({ "terminal": t, "labels": { "herdr.right-click": to } });
                cx.background_executor()
                    .spawn(async move {
                        if let Err(e) = core.call("terminal.label", params) {
                            tracing::warn!("right-click label: {e:#}");
                        }
                    })
                    .detach();
            }
            "terminal.pin" => {
                let Some(pinned) = a.get("pinned").and_then(Value::as_bool) else { return self.fail("terminal.pin pinned is true or false") };
                let t = Self::arg(a, "terminal").unwrap_or_default().to_owned();
                if !self.live.contains_key(&t) {
                    return self.fail(format!("no running terminal {t:?}"));
                }
                let core = self.core.clone();
                let params = json!({ "terminal": t, "labels": { "herdr.pinned": if pinned { "1" } else { "" } } });
                cx.background_executor()
                    .spawn(async move {
                        if let Err(e) = core.call("terminal.label", params) {
                            tracing::warn!("pin label: {e:#}");
                        }
                    })
                    .detach();
            }
            "terminal.kill" => {
                let t = Self::arg(a, "terminal").unwrap_or_default();
                if !self.live.contains_key(t) {
                    return self.fail(format!("no running terminal {t:?}"));
                }
                self.kill(&[t.to_owned()], cx);
            }
            "terminal.peek" => {
                let t = Self::arg(a, "terminal").unwrap_or_default();
                if !self.live.contains_key(t) {
                    return self.fail(format!("no running terminal {t:?}"));
                }
                let float = a.get("float").and_then(Value::as_bool).unwrap_or(false);
                let (view, show) = match (FloatView::parse(a.get("view")), float_show(a)) {
                    (Ok(view), Ok(show)) => (view, show),
                    (Err(e), _) | (_, Err(e)) => return self.fail(format!("terminal.peek: {e}")),
                };
                if let Some(v) = &view {
                    if !float {
                        return self.fail("terminal.peek: a view needs float: true");
                    }
                    if !self.folders.contains_key(&v.name) {
                        return self.fail(format!("terminal.peek: no mod {:?} in mods/", v.name));
                    }
                }
                if show == 1 && view.is_none() {
                    return self.fail("terminal.peek: show 1 needs a view");
                }
                let t = t.to_owned();
                self.peek_terminal(&t, float, view, show, window, cx);
            }
            "float.view" => {
                let index = match a.get("index").and_then(Value::as_u64) {
                    Some(i @ (0 | 1)) => i as usize,
                    _ => return self.fail(format!("float.view index is 0 (the terminal) or 1 (the view), not {}", a.get("index").unwrap_or(&Value::Null))),
                };
                if self.float_views.is_none() {
                    return self.fail("float.view: no float with a view is open");
                }
                self.show_float_view(index, window, cx);
            }
            "terminal.show" => {
                let pane = Self::owned(a, "pane").or_else(|| self.model.focused_pane());
                let target = Self::arg(a, "terminal").filter(|t| self.live.contains_key(*t)).map(str::to_owned);
                if let Some(p) = pane {
                    match target {
                        // One with a pane of its own is shown there.
                        Some(t) if let Some(own) = self.model.pane_of(&t) => {
                            self.swapped.remove(&p);
                            self.model.focus_pane(&own);
                        }
                        Some(t) => {
                            self.swapped.insert(p.clone(), t);
                            self.model.focus_pane(&p);
                        }
                        None => {
                            self.swapped.remove(&p);
                        }
                    }
                    self.focused_pane = None;
                }
            }
            "terminal.search" => {
                let Some(t) = self.focused_terminal(window, cx) else { return self.fail("no focused terminal to search") };
                t.view.update(cx, |view, cx| view.open_search(window, cx));
                return;
            }
            "terminal.copy" | "terminal.paste" | "terminal.paste_image" => {
                if let Some(t) = self.focused_terminal(window, cx) {
                    t.view.update(cx, |v, cx| match name {
                        "terminal.paste" => v.paste(cx),
                        "terminal.paste_image" => v.paste_image(cx),
                        // A command, not a key: copy and leave the selection.
                        _ => { let _ = v.copy(cx); }
                    });
                }
                return;
            }
            "terminal.scroll" => {
                if let Err(error) = self.scroll_terminal(a, window, cx) {
                    self.fail(error);
                }
            }
            // ---- agents
            "agent.focus" => {
                let t = Self::arg(a, "terminal").unwrap_or_default().to_owned();
                if !self.live.contains_key(&t) {
                    return self.fail(format!("no running terminal {t:?}"));
                }
                self.focus_agent(&t);
            }
            "agent.next" | "agent.prev" => {
                let order = self.agent_order();
                if order.is_empty() {
                    return;
                }
                let current = self.shown_agent().map(|a| self.root_agent(&a));
                let n = order.len();
                let next = match current.and_then(|c| order.iter().position(|a| *a == c)) {
                    Some(i) if name == "agent.next" => (i + 1) % n,
                    Some(i) => (i + n - 1) % n,
                    None if name == "agent.next" => 0,
                    None => n - 1,
                };
                let addr = order[next].clone();
                self.focus_agent(&addr);
            }
            // ---- layout
            "layout.switch" => {
                self.switch_layout(Self::arg(a, "name"), window, cx);
                return;
            }
            "layout.clone" => {
                self.save();
                let name = Self::owned(a, "name").unwrap_or_else(|| self.layout_name.clone());
                let to = Self::owned(a, "as").unwrap_or_else(|| format!("{name}-copy"));
                if let Err(e) = clone_layout(&name, &to) {
                    return self.fail(format!("cannot clone layout: {e}"));
                }
                self.switch_layout(Some(&to), window, cx);
                return;
            }
            "mod.clone" => {
                let name = Self::arg(a, "name").unwrap_or_default();
                let to = Self::owned(a, "as").unwrap_or_else(|| format!("{name}-copy"));
                if let Err(e) = mods::clone_mod(name, &to) {
                    return self.fail(format!("cannot clone mod: {e}"));
                }
                self.folders = mods::scan().into_iter().map(|f| (f.id.clone(), f)).collect();
            }
            "layout.set" if shipped_layouts().contains(&self.layout_name.as_str()) => {
                let n = match serde_json::from_value::<Node>(a.get("layout").cloned().unwrap_or_default()) {
                    Ok(n) => n,
                    Err(e) => return self.fail(format!("layout: {e}")),
                };
                if layout_sync::without_clicks(&self.chrome, &n) != self.chrome {
                    return self.fail("Only supported click/look fields can change on Fireflies' own layouts: clone one for other changes");
                }
                let mut state = layout_sync::State::between(&self.file_chrome, &n);
                if n.look.theme == self.chrome.look.theme {
                    state.theme = self.picked_theme.clone();
                }
                self.chrome = self.file_chrome.clone();
                state.apply(&mut self.chrome);
                self.picked_theme = state.theme;
                self.apply_look(window, cx);
            }
            // A deliberate edit: the file becomes this tree, clicks start over.
            "layout.set" => match serde_json::from_value::<Node>(a.get("layout").cloned().unwrap_or_default()) {
                Ok(mut n) => {
                    fill_ids(&mut n, &mut self.model);
                    let text = layout_sync::text_of(&n);
                    if !write_atomic(&layout_path(&self.layout_name), &text) {
                        return self.fail(format!("cannot write layouts/{}.json", self.layout_name));
                    }
                    self.written_layout = text;
                    self.layout_file_ok = true;
                    self.file_chrome = n.clone();
                    self.chrome = n;
                    self.picked_theme = None;
                    self.write_state(&layout_sync::State::default());
                    self.apply_look(window, cx);
                }
                Err(e) => return self.fail(format!("layout: {e}")),
            },
            "layout.toggle" | "layout.show" | "layout.hide" => {
                let id = Self::arg(a, "id").unwrap_or_default();
                let Some(n) = self.chrome.find_mut(id) else { return self.fail(format!("no node {id:?} in the shown layout")) };
                n.hidden = match name {
                    "layout.toggle" => !n.hidden,
                    "layout.show" => false,
                    _ => true,
                };
            }
            "layout.focus" => {
                // What `pane.go` does on reaching a focusable mod block, by id.
                let id = Self::arg(a, "id").unwrap_or_default().to_owned();
                let shown = self.chrome.visible_blocks().iter().any(|n| n.id == id && matches!(n.content(), Some(Content::Mod { .. })));
                if !shown {
                    return self.fail(format!("no shown mod block {id:?} in the shown layout"));
                }
                if !self.focusable(&id) {
                    return self.fail(format!("{id:?} shows a mod whose mod.json isn't \"focusable\": true"));
                }
                return self.focus_block(&id, window, cx);
            }
            "layout.resize" => {
                let id = Self::arg(a, "id").unwrap_or_default();
                let Some(n) = self.find_node_mut(id) else { return self.fail(format!("no node {id:?}")) };
                if let Some(px) = a.get("px").and_then(Value::as_f64) {
                    n.size = Some(Span::Px { px: px as f32 });
                } else if let Some(w) = a.get("weight").and_then(Value::as_f64) {
                    n.size = Some(Span::Weight { weight: w as f32 });
                }
            }
            "layout.reset" => {
                let name = Self::owned(a, "name").unwrap_or_else(|| self.layout_name.clone());
                let Some((_, text)) = LAYOUTS.iter().find(|(n, _)| *n == name) else {
                    return self.fail(format!("{name:?} isn't a layout Fireflies ships"));
                };
                // Theirs is kept under a name nothing else has (never over an older one).
                if layout_path(&name).exists() {
                    if let Err(e) = std::fs::rename(layout_path(&name), aside(&layout_path(&name), "old")) {
                        return self.fail(format!("cannot set layouts/{name}.json aside: {e}"));
                    }
                }
                if !write_atomic(&layout_path(&name), text) {
                    return self.fail(format!("cannot write layouts/{name}.json"));
                }
                let _ = std::fs::remove_file(state_path(&name));
                if name == self.layout_name {
                    self.load_layout(&name);
                    self.apply_look(window, cx);
                }
            }
            "layout.select" => {
                let (s, ch) = (Self::arg(a, "stack").unwrap_or_default(), Self::arg(a, "child").unwrap_or_default());
                if !self.chrome.select(s, ch) {
                    return self.fail(format!("no stack {s:?} with a child {ch:?}"));
                }
            }
            // HUP: native view inspection and actions for the test harness.
            "native.debug" => self.answer(Ok(crate::native_view::debug())),
            "native.call" => {
                let (Some(key), Some(action)) = (Self::arg(a, "key"), Self::arg(a, "action")) else { return self.fail("native.call needs key and action") };
                let r = crate::native_view::call_key(&key, &action, a.get("args").unwrap_or(&Value::Null));
                self.answer(r);
                cx.notify();
            }
            "mod.open" => {
                let name = Self::arg(a, "name").unwrap_or_default();
                let Some(f) = self.folders.get(name) else { return self.fail(format!("no mod folder {name:?}")) };
                let mut spec = mod_overlay(&f.dir);
                spec["mod"] = json!(name);
                // One popup per mod: running mod.open again toggles it, like app.settings.
                let id = format!("mod-{name}");
                if self.overlays.iter().any(|o| o.id == id) {
                    self.close_overlay(&id, window, cx);
                } else {
                    self.open_overlay(id, spec, window, cx);
                }
            }
            "overlay.resizable" => {
                let Some(id) = Self::owned(a, "id") else { return self.fail("overlay.resizable needs id") };
                if let Err(e) = self.window_resizable(&id, a.get("resizable"), window.viewport_size()) {
                    return self.fail(e);
                }
                cx.notify();
            }
            "overlay.focus" => {
                let dir = Self::arg(a, "dir").unwrap_or("next").to_owned();
                if let Err(e) = self.focus_window_cmd(Self::owned(a, "id"), &dir, window, cx) {
                    return self.fail(e);
                }
                return;
            }
            "overlay.move" => {
                let n = |k: &str| a.get(k).and_then(|v| v.as_f64().or_else(|| v.as_str()?.trim().parse().ok())).unwrap_or(0.0) as f32;
                if let Err(e) = self.move_window_cmd(Self::owned(a, "id"), [n("dx"), n("dy"), n("dw"), n("dh")], window.viewport_size(), window, cx) {
                    return self.fail(e);
                }
                return;
            }
            "overlay.close" => {
                let id = Self::owned(a, "id").or_else(|| self.overlays.iter().rev().find(|o| o.kind.modal_keys()).map(|o| o.id.clone()));
                if let Some(id) = id {
                    self.close_overlay(&id, window, cx);
                }
                return;
            }
            // ---- the app
            "app.welcome" => {
                self.open_welcome(window, cx);
                return;
            }
            "app.whats_new" => {
                self.open_whats_new(true, window, cx);
                return;
            }
            "app.open_url" => {
                let url = Self::owned(a, "url").unwrap_or_default();
                let r = self.open_link(&url, None, Self::arg(a, "in"), window, cx);
                self.answer(r);
                return;
            }
            "editor.open" => {
                let path = Self::owned(a, "path").unwrap_or_default();
                // Numbers, or their text (`herdr-app do editor.open --line 42`).
                let num = |k: &str| a.get(k).and_then(|v| v.as_u64().or_else(|| v.as_str()?.trim().parse().ok())).filter(|n| *n >= 1);
                let mut extra = match num("line") {
                    Some(line) => json!({ "line": line, "col": num("col").unwrap_or(1) }),
                    None => json!({}),
                };
                // `look`: opened to be looked at (a new tab of a picture or table drawn); `--look true` too.
                if a.get("look").is_some_and(|v| v.as_bool() == Some(true) || v.as_str() == Some("true")) {
                    extra["look"] = json!(true);
                }
                let r = self.open_viewer(Viewer::Editor, &path, Self::owned(a, "pane"), Self::arg(a, "in"), Self::arg(a, "on"), extra, window, cx);
                self.answer(r);
                return;
            }
            "files.open" => {
                let path = Self::owned(a, "path").unwrap_or_default();
                let r = self.open_viewer(Viewer::Files, &path, Self::owned(a, "pane"), Self::arg(a, "in"), Self::arg(a, "on"), Value::Null, window, cx);
                self.answer(r);
                return;
            }
            // image.open: the preview's name when it showed pictures only.
            "markdown.open" | "preview.open" | "image.open" => {
                let viewer = if name == "markdown.open" { Viewer::Markdown } else { Viewer::Preview };
                let path = Self::owned(a, "path").unwrap_or_default();
                let extra = match Self::arg(a, "anchor").filter(|a| !a.is_empty() && viewer == Viewer::Markdown) {
                    Some(anchor) => json!({ "anchor": anchor.trim_start_matches('#').to_lowercase() }),
                    None => Value::Null,
                };
                let r = self.open_viewer(viewer, &path, Self::owned(a, "pane"), Self::arg(a, "in"), Self::arg(a, "on"), extra, window, cx);
                self.answer(r);
                return;
            }
            "app.palette" => {
                // Once: a second press closes the palette instead of stacking another.
                if self.overlays.iter().any(|o| o.id == "palette") {
                    self.close_overlay("palette", window, cx);
                } else {
                    let mut spec = palette_spec(self.chrome.scrim.is_some());
                    self.skin_dialog(&mut spec, self.chrome.palette_mod.clone(), "palette");
                    self.open_overlay("palette".into(), spec, window, cx);
                }
                return;
            }
            "app.feedback" => {
                let from = Self::owned(a, "from").unwrap_or_else(|| "person".into());
                if !matches!(from.as_str(), "person" | "agent") {
                    return self.fail("from must be person or agent");
                }
                // A window, not a dialog: the app stays usable behind it (copy an error, paste it in).
                let spec = json!({ "mod": "frame-feedback", "kind": "window", "key": "feedback", "width": 680,
                    "props": { "message": Self::owned(a, "message").unwrap_or_default(), "from": from } });
                self.open_overlay(mods::new_overlay_id(), spec, window, cx);
                return;
            }
            "app.settings" => {
                // Once: a second press doesn't stack another; asking for a section opens it there.
                let section = Self::owned(a, "section");
                let open = self.overlays.iter().any(|o| o.id == "settings");
                if open && section.is_some() {
                    self.close_overlay("settings", window, cx);
                }
                if !open || section.is_some() {
                    let spec = json!({ "mod": "frame-settings", "kind": "dialog", "width": 880, "props": { "section": section } });
                    self.open_overlay("settings".into(), spec, window, cx);
                }
                return;
            }
            "app.check_updates" => crate::update::check_now(),
            "app.update_core" => {
                if crate::update::core().ready.is_none() && crate::update::core().error.is_none() {
                    return self.fail("herdr-core is up to date");
                }
                crate::update::update_core();
            }
            "app.help" => {
                if self.overlays.iter().any(|o| o.id == "help") {
                    self.close_overlay("help", window, cx);
                } else {
                    let spec = json!({ "mod": "help", "kind": "dialog", "width": 640, "height": 520 });
                    self.open_overlay("help".into(), spec, window, cx);
                }
                return;
            }
            "app.reset" => self.reset(window, cx),
            "app.theme" => {
                let name = Self::arg(a, "name").unwrap_or_default().to_owned();
                if !settings::theme_exists(&name) {
                    return self.fail(format!("no theme {name:?}"));
                }
                // A layout is a look: the theme goes on the shown layout's root,
                // as its light or its dark half (the other half stays).
                let current = crate::layout::ThemeChoice::Pair {
                    light: settings::get().theme_light.clone(),
                    dark: settings::get().theme_dark.clone(),
                };
                self.chrome.look.theme = Some(with_theme(Some(current), name));
                self.picked_theme = self.chrome.look.theme.clone();
                self.save();
                self.apply_look(window, cx);
            }
            "app.zoom_in" | "app.zoom_out" | "app.zoom_reset" => {
                let zoom = settings::next_zoom(match name {
                    "app.zoom_in" => 1,
                    "app.zoom_out" => -1,
                    _ => 0,
                });
                self.write_person(|p| p.zoom = zoom, window, cx);
            }
            "app.quit" => cx.quit(),
            "app.update" => {
                if !crate::update::apply() {
                    return self.fail("no update is ready yet");
                }
                self.drain_documents(window, cx);
                crate::update::relaunch();
                cx.quit();
            }
            "window.close" | "window.minimize" | "window.maximize" => return self.window_command(name, window, cx),
            // Hiding apps is macOS's (bound natively there).
            "app.hide" | "app.hide_others" | "app.show_all" => return,
            other => {
                tracing::warn!("command {other:?} is listed but not handled");
                return;
            }
        }
        self.sync(window, cx);
    }

    fn find_node_mut(&mut self, id: &str) -> Option<&mut Node> {
        if self.chrome.find(id).is_some() {
            return self.chrome.find_mut(id);
        }
        self.model.spaces.iter_mut().flat_map(|p| p.tabs.iter_mut()).find_map(|c| c.root.find_mut(id))
    }

    /// The nearest visible pane, also considering focusable mods for `pane.go`.
    fn neighbor(&self, from: &str, dir: &str, use_history: bool) -> Option<String> {
        let bounds = self.bounds.borrow();
        let cur = *bounds.get(from)?;
        let mut candidates: Vec<String> = self.model.active_tab().into_iter()
            .flat_map(|c| c.shown().visible_blocks().into_iter().filter(|n| n.is_pane()).map(|n| n.id.clone()))
            .collect();
        if use_history {
            candidates.extend(self.chrome.visible_blocks().into_iter().filter(|n| self.focusable(&n.id)).map(|n| n.id.clone()));
        }
        let candidates = candidates.into_iter().filter(|id| id != from).filter_map(|id| Some((id.clone(), *bounds.get(&id)?)));
        nearest(cur, dir, candidates, if use_history { &self.pane_history } else { &[] })
    }

    /// `pane.go`: the nearest pane or focusable mod.
    fn go(&mut self, dir: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(from) = self.focused_block.clone().or_else(|| self.model.focused_pane()) else { return };
        let Some(to) = self.neighbor(&from, dir, true) else { return };
        if self.focusable(&to) {
            return self.focus_block(&to, window, cx);
        }
        self.focused_block = None;
        self.model.focus_pane(&to);
        self.focused_pane = None;
        self.sync(window, cx);
    }

    /// Until the mod takes the keyboard, the window holds the keys.
    fn focus_block(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.tab_of(id).is_some() {
            self.model.focus_pane(id);
            self.focused_pane = None;
        }
        self.focused_block = Some(id.to_owned());
        self.sync(window, cx);
        if !self.keys_held() {
            crate::native_view::release_keyboard(window);
            self.focus.focus(window, cx);
            self.hand_keyboard();
        }
    }

    /// The keyboard is somewhere behind a window with a scrim: in a pane, the
    /// layout or the window itself, outside every overlay. Only what was
    /// drawn counts (a handle focused before its first frame is left to it).
    fn keys_astray(&self, window: &Window, cx: &App) -> bool {
        self.top_scrim_window().is_some()
            && self.focus.contains_focused(window, cx)
            && !self.overlays.iter().any(|o| o.kind != OverlayKind::Toast && o.focus.contains_focused(window, cx))
    }

    /// The guard behind `Overlay::holds_keys`: whatever moved the keyboard
    /// behind a window with a scrim (a mod focusing itself, a terminal, a path
    /// nobody thought of), it goes back to the overlays. True when it had to.
    fn take_back_keys(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if !self.keys_astray(window, cx) {
            return false;
        }
        let pane = self.terms.iter().find(|(_, t)| t.focus.is_focused(window)).map(|(id, _)| id.clone());
        tracing::warn!(?pane, block = ?self.focused_block, window = ?self.top_scrim_window(), "the keyboard was behind a window with a scrim: taken back");
        self.restore_focus(window, cx);
        true
    }

    /// A dialog, popup or window with a scrim is open: the keyboard stays in
    /// the overlays, whatever changes behind them.
    fn keys_held(&self) -> bool {
        self.overlays.iter().any(Overlay::holds_keys)
    }

    /// The window with a scrim in front, if one shows.
    fn top_scrim_window(&self) -> Option<String> {
        self.overlays.iter().rev().find(|o| o.kind == OverlayKind::Window && o.scrim).map(|o| o.id.clone())
    }

    /// Its copy gets `focus` from `nextCommand()`.
    fn hand_keyboard(&self) {
        if let Some(copy) = self.focused_block.as_ref().and_then(|b| self.copies.get(b)) {
            mods::send_command_to(copy.id, "focus");
        }
    }

    /// A mod block on screen: in the layout, or a mod pane of the shown tab.
    fn mod_block_shown(&self, id: &str) -> bool {
        self.copies.contains_key(id)
            && (self.chrome.visible_blocks().iter().any(|n| n.id == id && matches!(n.content(), Some(Content::Mod { .. })))
                || self.model.active_tab().is_some_and(|t| t.shown().visible_blocks().iter().any(|n| n.id == id)))
    }

    /// Its mod.json says `"focusable": true` (`go` asks only of visible blocks).
    fn focusable(&self, id: &str) -> bool {
        self.copies.get(id).and_then(|c| self.folders.get(&c.inst.name)).is_some_and(|f| f.hint.focusable)
    }

    fn swap_pane(&mut self, from: &str, explicit: bool, dir: &str) -> Result<(), String> {
        let neighbor = self.neighbor(from, dir, false);
        swap_with_neighbor(&mut self.model, from, explicit, neighbor)
    }

    // ---- overlays ----------------------------------------------------------

    fn confirm(&mut self, title: &str, detail: &str, command: &str, args: Value, window: &mut Window, cx: &mut Context<Self>) {
        let mut spec = json!({ "mod": "confirm", "kind": "dialog", "width": 380,
            "props": { "title": title, "detail": detail, "command": { "name": command, "args": args } } });
        self.skin_dialog(&mut spec, self.chrome.confirm_mod.clone(), "confirm");
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    /// The layout's `prompt_mod` / `confirm_mod` / `palette_mod`, like
    /// `toast_mod`: that mod draws the overlay instead of the shipped one, with
    /// no frame of Fireflies' (it draws its own) and `dialog` (`"prompt"`,
    /// `"confirm"`, `"palette"`) added to its props so one mod can play
    /// several parts. An unknown mod logs a warning and keeps the shipped one.
    fn skin_dialog(&self, spec: &mut Value, chosen: Option<String>, dialog: &str) {
        let Some(name) = chosen.or_else(|| self.chrome.dialog_mods.get(dialog).cloned()) else { return };
        if !self.folders.contains_key(&name) {
            tracing::warn!(mod_name = %name, dialog, "dialog mod not found; using the shipped one");
            return;
        }
        spec["mod"] = json!(name);
        spec["frame"] = json!("none");
        spec["props"]["dialog"] = json!(dialog);
    }

    #[allow(clippy::too_many_arguments)]
    fn open_menu(&mut self, tab: &str, target: Value, at: Option<Point<Pixels>>, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(p) = at {
            self.pointer = p;
        }
        let requested = self.chrome.terminal_menu.as_deref().unwrap_or("menu");
        let name = if self.folders.contains_key(requested) {
            requested
        } else {
            tracing::warn!(mod_name = requested, "terminal menu mod not found; using menu");
            "menu"
        };
        let defaults = self.folders.get(name).map(|f| mod_overlay(&f.dir)).unwrap_or_else(|| json!({}));
        let spec = terminal_menu_spec(name, &defaults, tab, target);
        self.open_overlay(mods::new_overlay_id(), spec, window, cx);
    }

    /// The layout's notification mod (`"toast"` on the root), else the shipped `toast`.
    fn toast_mod(&self) -> &str {
        let requested = self.chrome.toast.as_deref().unwrap_or("toast");
        if self.folders.contains_key(requested) {
            requested
        } else {
            tracing::warn!(mod_name = requested, "toast mod not found; using toast");
            "toast"
        }
    }

    fn open_overlay(&mut self, id: String, mut spec: Value, window: &mut Window, cx: &mut Context<Self>) {
        // The app's own screen stays one when the layout's mod draws it.
        let app_screen = spec.get("mod").and_then(Value::as_str).is_some_and(|m| m.starts_with("frame-"));
        if let Some(screen) = spec.get("mod").and_then(Value::as_str).and_then(dialog_screen) {
            let chosen = self.chrome.dialog_mods.get(screen).cloned();
            self.skin_dialog(&mut spec, chosen, screen);
        }
        let kind = match spec.get("kind").and_then(Value::as_str) {
            Some("popup") => OverlayKind::Popup,
            Some("toast") => OverlayKind::Toast,
            Some("window") => OverlayKind::Window,
            _ => OverlayKind::Dialog,
        };
        let key = spec.get("key").and_then(Value::as_str).filter(|k| !k.is_empty() && kind == OverlayKind::Window).map(str::to_owned);
        // One window per name: opening it again replaces it, in its place.
        let mut place = key.as_deref().and_then(movable::place_of);
        if let Some(k) = &key
            && let Some(old) = self.overlays.iter().find(|o| o.key.as_ref() == Some(k)).map(|o| (o.id.clone(), o.place))
        {
            place = old.1.or(place);
            self.remove_overlay(&old.0, window, cx);
        }
        let layout = spec.get("layout").filter(|_| kind != OverlayKind::Toast).and_then(|l| match serde_json::from_value::<Node>(l.clone()) {
            Ok(n) => Some(overlay_layout(n, &id)),
            Err(e) => {
                tracing::warn!("overlay layout: {e}");
                None
            }
        });
        let (name, mut props) = if kind == OverlayKind::Toast {
            (self.toast_mod().to_owned(), spec.get("notification").cloned().unwrap_or(Value::Null))
        } else {
            (spec.get("mod").and_then(Value::as_str).unwrap_or_default().to_owned(), spec.get("props").cloned().unwrap_or(json!({})))
        };
        if !props.is_object() {
            props = json!({});
        }
        props["overlay"] = json!(id);
        let num = |k: &str, d: f32| spec.get(k).and_then(Value::as_f64).map_or(d, |v| v as f32);
        let resize = (kind == OverlayKind::Window).then(|| movable::Resize::parse(spec.get("resizable"))).flatten();
        // A size it was resized to before, in the shape it keeps now (design px).
        let resized = resize.and(key.as_deref()).and_then(movable::size_of).map(|s| match resize {
            Some(r) if r.aspect.is_some() => {
                let (_, _, w, h) = r.resized((0.0, 0.0, s.width, s.height), [false, false, true, false], (0.0, 0.0), (f32::MAX, f32::MAX), 1.0);
                size(w, h)
            }
            _ => s,
        });
        let size = match kind {
            OverlayKind::Toast => size(340.0, num("height", 72.0)),
            // A size it was resized to before, under its key.
            OverlayKind::Window if resized.is_some() => resized.unwrap(),
            // No size: as big as its content (0 = unset).
            OverlayKind::Window => size(num("width", 0.0), num("height", 0.0)),
            // No height: as tall as the content, up to most of the window.
            _ => size(num("width", 420.0), num("height", 0.85)),
        };
        let at = match spec.get("at") {
            Some(v) if v.get("x").is_some() => point(px(num_in(v, "x")), px(num_in(v, "y"))),
            _ => self.pointer,
        };
        let top = (spec.get("at").and_then(Value::as_str) == Some("top")).then(|| num("offset", 0.0));
        let fit = layout.is_none() && resized.is_none() && (kind == OverlayKind::Popup || (matches!(kind, OverlayKind::Dialog | OverlayKind::Window) && spec.get("height").is_none()));
        if kind == OverlayKind::Window && place.is_none() && spec.get("at").is_some_and(|v| v.get("x").is_some()) {
            place = Some(at);
        }
        let timeout = props.get("timeout").and_then(Value::as_f64).unwrap_or(match props.get("level").and_then(Value::as_str) {
            Some("error" | "warning") => 8000.0,
            _ => 5000.0,
        });
        let slot = format!("overlay:{id}");
        // A dialog or popup over a window that has the keyboard gives it back there.
        let back_to = kind.modal_keys().then(|| self.overlays.iter().rev().find(|o| o.kind == OverlayKind::Window && o.focus.contains_focused(window, cx)).map(|o| o.id.clone())).flatten();
        let scrim = window_scrim(kind, &spec);
        // The frame takes the keyboard first, so a mod that focuses itself while
        // loading wins. A window with a scrim is modal: it takes it too, and a
        // web page behind gives up AppKit's.
        let focus = cx.focus_handle();
        if kind.modal_keys() || (kind == OverlayKind::Window && scrim) {
            focus.focus(window, cx);
        }
        if kind == OverlayKind::Window && scrim {
            crate::native_view::release_keyboard(window);
        }
        if layout.is_none() {
            let copy = self.load(Instance { name, props }, window, cx);
            // Popups (menus) are as tall as what's in them; `height` is the most.
            if fit
                && let Some(root) = &copy.root
            {
                root.update(cx, |r, cx| r.set_fit_content(true, cx));
            }
            self.copies.insert(slot.clone(), copy);
        }
        let first_term = layout.as_ref().and_then(|l| l.visible_blocks().into_iter().find(|n| matches!(n.content(), Some(Content::Terminal { .. }))).map(|n| n.id.clone()));
        let shown = self.visible_addresses();
        let sizes = layout.as_ref().map(|l| l.visible_blocks().into_iter().filter_map(|n| match n.content() {
            Some(Content::Terminal { terminal }) if !shown.contains(terminal) => {
                let rec = self.live.get(terminal)?;
                let dim = |k: &str| rec.get(k).and_then(Value::as_u64).and_then(|v| u16::try_from(v).ok()).filter(|v| *v > 0);
                Some((n.id.clone(), terminal.clone(), dim("cols")?, dim("rows")?))
            }
            _ => None,
        }).collect()).unwrap_or_default();
        let has_layout = layout.is_some();
        self.overlays.push(Overlay {
            id,
            kind,
            slot,
            at,
            size,
            expires: (kind == OverlayKind::Toast).then(|| Instant::now() + Duration::from_millis(timeout as u64)),
            focus,
            layout,
            top,
            fit,
            modal: spec.get("modal").and_then(Value::as_bool).unwrap_or(false),
            bare: spec.get("frame").and_then(Value::as_str) == Some("none"),
            scrim,
            place,
            opened: OVERLAYS_OPENED.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            key: key.clone(),
            resize,
            sizes,
            frame: app_screen,
            back_to,
        });
        if let Some(k) = &key {
            if spec.get("keep").and_then(Value::as_bool) == Some(true) {
                movable::keep(&self.layout_name, k, &spec);
            } else {
                movable::forget(&self.layout_name, k);
            }
        }
        if has_layout {
            self.sync(window, cx);
            if (kind.modal_keys() || (kind == OverlayKind::Window && scrim))
                && let Some(t) = first_term.and_then(|b| self.terms.get(&b))
            {
                t.focus.focus(window, cx);
            }
        } else {
            self.publish_shown_copies();
        }
        cx.notify();
    }

    /// A terminal over the tab with the `peek` bar on top. `float`: a floating
    /// terminal (bigger, room for a full TUI), which `terminals()` marks `floating`.
    /// A float's `view`: its body holds the terminal and that mod, showing `show`.
    fn peek_terminal(&mut self, address: &str, float: bool, view: Option<FloatView>, show: usize, window: &mut Window, cx: &mut Context<Self>) {
        let view = view.filter(|_| float);
        // Already floating with this view: only switch, no close and reopen.
        if let Some(v) = &view
            && self.floating.as_deref() == Some(address)
            && self.float_views.as_ref().is_some_and(|f| f.view.same(v))
        {
            return self.show_float_view(show, window, cx);
        }
        self.close_overlay("terminal-peek", window, cx);
        let size = if float { 0.85 } else { 0.8 };
        let names = view.as_ref().map(|v| {
            let term = v.term.clone().unwrap_or_else(|| self.terminal_name(address));
            [term, v.label.clone().unwrap_or_else(|| v.name.clone())]
        });
        let views = names.as_ref().map_or(Value::Null, |n| json!(n));
        // The layout's `peek_mod` draws the bar instead of the shipped `peek`,
        // with `dialog: "peek"` added to its props, like the dialog mods.
        let bar = match self.chrome.peek_mod.clone() {
            Some(name) if self.folders.contains_key(&name) => {
                json!({ "mod": name, "props": { "terminal": address, "float": float, "views": views, "dialog": "peek" } })
            }
            Some(name) => {
                tracing::warn!(mod_name = %name, "peek mod not found; using the shipped one");
                json!({ "mod": "peek", "props": { "terminal": address, "float": float, "views": views } })
            }
            None => json!({ "mod": "peek", "props": { "terminal": address, "float": float, "views": views } }),
        };
        let show = if view.is_some() { show.min(1) } else { 0 };
        let body = match &view {
            Some(v) => json!({
                "type": "stack",
                "id": FLOAT_BODY,
                "active": FLOAT_CHILDREN[show],
                "children": [
                    { "type": "block", "id": FLOAT_CHILDREN[0], "content": { "terminal": address } },
                    { "type": "block", "id": FLOAT_CHILDREN[1], "content": { "mod": v.name, "props": v.props } }
                ]
            }),
            None => json!({ "type": "block", "content": { "terminal": address } }),
        };
        self.open_overlay("terminal-peek".into(), json!({
            "kind": "dialog",
            "width": size,
            "height": size,
            "layout": {
                "type": "column",
                "children": [
                    { "type": "block", "size": { "px": 34 }, "content": bar },
                    body
                ]
            }
        }), window, cx);
        self.floating = float.then(|| address.to_owned());
        self.float_views = view.zip(names).map(|(view, names)| FloatViews { view, names, shown: show });
        if show == 1 {
            self.focus_float_view(window, cx);
        }
        self.publish(cx);
    }

    /// `float.view {index}`: the float's body shows the terminal (0) or its view (1),
    /// and the keyboard goes there.
    fn show_float_view(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(f) = self.float_views.as_mut() else { return };
        f.shown = index.min(1);
        let child = ov_id("terminal-peek", FLOAT_CHILDREN[f.shown]);
        if let Some(l) = self.overlays.iter_mut().find(|o| o.id == "terminal-peek").and_then(|o| o.layout.as_mut()) {
            l.select(&ov_id("terminal-peek", FLOAT_BODY), &child);
        }
        self.sync(window, cx);
        self.focus_float_view(window, cx);
        self.publish(cx);
        cx.notify();
    }

    /// The keyboard to the float's shown view: its terminal, or its mod when
    /// that mod's `mod.json` says `focusable` (else the float holds it).
    fn focus_float_view(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(shown) = self.float_views.as_ref().map(|f| f.shown) else { return };
        let block = ov_id("terminal-peek", FLOAT_CHILDREN[shown]);
        if shown == 0 {
            if let Some(t) = self.terms.get(&block) {
                t.focus.focus(window, cx);
            }
            return;
        }
        if let Some(o) = self.overlays.iter().find(|o| o.id == "terminal-peek") {
            o.focus.focus(window, cx);
        }
        if !self.focusable(&block) {
            return;
        }
        // A copy that just started asks for commands a moment later.
        cx.spawn_in(window, async move |this, cx| {
            for _ in 0..40 {
                let done = this.update(cx, |this, _| {
                    let Some(copy) = this.copies.get(&block).map(|c| c.id) else { return true };
                    this.float_views.as_ref().is_none_or(|f| f.shown != 1) || mods::send_command_to(copy, "focus")
                });
                if done.unwrap_or(true) {
                    break;
                }
                cx.background_executor().timer(Duration::from_millis(25)).await;
            }
        })
        .detach();
    }

    /// What a terminal is called in a float's views: its program's name.
    fn terminal_name(&self, address: &str) -> String {
        let rec = self.live.get(address);
        rec.and_then(|r| r.pointer("/program/name")).and_then(Value::as_str).filter(|n| !n.is_empty()).map(str::to_owned).unwrap_or_else(|| {
            let argv: Vec<String> = rec.and_then(|r| r.get("argv")).and_then(Value::as_array).into_iter().flatten()
                .filter_map(|a| a.as_str().map(str::to_owned)).collect();
            program_name(None, &argv)
        })
    }

    /// Which copies are on screen, for `<mod>.<command>` (`mods::send_command`).
    fn publish_shown_copies(&self) {
        let (_, shown) = self.visible();
        mods::set_shown_copies(shown.iter().filter_map(|(s, i)| self.copies.get(s).filter(|c| c.inst == *i)).map(|c| c.id).collect());
    }

    /// Closes an overlay; a kept window stays closed on the next start too.
    fn close_overlay(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(k) = self.overlays.iter().find(|o| o.id == id).and_then(|o| o.key.clone()) {
            movable::forget(&self.layout_name, &k);
        }
        self.remove_overlay(id, window, cx);
    }

    fn remove_overlay(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(i) = self.overlays.iter().position(|o| o.id == id) {
            let o = self.overlays.remove(i);
            if o.id == "terminal-peek" {
                self.floating = None;
                self.float_views = None;
            }
            if self.win_drag.as_ref().is_some_and(|d| d.id == o.id) {
                self.win_drag = None;
            }
            self.bounds.borrow_mut().remove(&o.slot);
            self.remove_copy(&o.slot, window, cx);
            // Its terminals that nothing else shows get their size from before
            // it back, ahead of its views going (the next sync drops them).
            if !o.sizes.is_empty() {
                let shown = self.visible_addresses();
                for (block, address, cols, rows) in &o.sizes {
                    if !shown.contains(address)
                        && let Some(t) = self.terms.get(block)
                    {
                        t.view.read(cx).give_back_size(*cols, *rows);
                    }
                }
            }
            if o.layout.is_some() {
                self.sync(window, cx);
            } else {
                self.publish_shown_copies();
            }
            // The keyboard never ends up nowhere: back to a dialog still open,
            // else the window it opened over, else a window with a scrim, else
            // the pane, else the window (where the app's keys work). A window in
            // the background had none to give back (one that had it:
            // `restore_focus` runs on its own when its focus goes).
            if o.kind.modal_keys() {
                self.restore_focus_to(o.back_to, window, cx);
            }
            cx.notify();
        }
    }

    /// The escape hatch: set the files aside and go back to the default screen.
    fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let layout = format!("layouts/{}.json", self.layout_name);
        for name in [layout.as_str(), "keys.json"] {
            if file(name).exists() {
                let _ = std::fs::rename(file(name), aside(&file(name), "reset"));
            }
        }
        let _ = std::fs::remove_file(state_path(&self.layout_name));
        tracing::warn!("escape hatch: {layout} and keys.json set aside as *.reset-<time>");
        self.watched.keys = None;
        install_layouts();
        self.drop_layout_copies(window, cx);
        self.load_layout("main");
        self.apply_look(window, cx);
        self.focused_pane = None;
        self.agent_focused = None;
        let ids: Vec<String> = self.overlays.iter().map(|o| o.id.clone()).collect();
        for id in ids {
            self.close_overlay(&id, window, cx);
        }
        self.show_layout_notes(window, cx);
        self.reload_config(window, cx);
    }

    fn handle(&mut self, req: Request, window: &mut Window, cx: &mut Context<Self>) {
        match req {
            Request::Run { name, args } => self.run(&name, args, window, cx),
            Request::OpenOverlay { id, spec } => self.open_overlay(id, spec, window, cx),
            Request::CloseOverlay { id } => self.close_overlay(&id, window, cx),
            Request::Refresh => self.refresh_mods(cx),
            Request::Control { cmd, reply } => {
                let _ = reply.send(self.control(cmd, window, cx));
            }
        }
    }

    fn control(&mut self, cmd: Value, window: &mut Window, cx: &mut Context<Self>) -> Value {
        if let Some(name) = cmd.get("do").and_then(Value::as_str) {
            let args = cmd.get("args").cloned().unwrap_or(Value::Null);
            return self.run_as(name, args, false, window, cx);
        }
        if let Some(path) = cmd.get("shot").and_then(Value::as_str) {
            return match crate::control::save_shot(window, std::path::Path::new(path)) {
                Ok(()) => json!({ "path": path }),
                Err(error) => json!({ "error": format!("cannot save screenshot: {error:#}") }),
            };
        }
        if cmd.get("commands").is_some() {
            return crate::commands::listing();
        }
        // Fireflies was launched again: this window comes to the front instead.
        if cmd.get("raise").is_some() {
            cx.activate(true);
            window.activate_window();
            return json!({ "ok": true });
        }
        if cmd.get("ls").is_some() {
            return self.world();
        }
        if cmd.get("status").is_some() {
            let round = |v: f32| (v as f64 * 100.0).round() / 100.0;
            let errors: Vec<String> = ["settings", "keys", "layout", "programs"]
                .iter()
                .filter_map(|w| std::fs::read_to_string(file(&format!("{w}.error"))).ok())
                .chain(self.copies.values().filter_map(|c| Some(format!("mod {}: {}", c.inst.name, c.error.as_ref()?))))
                .chain(self.documents.iter().filter_map(|(m, s)| s.error.as_ref().map(|e| format!("layout {}: {e}", if m.is_empty() { "local" } else { m }))))
                .collect();
            return json!({
                "zoom": round(settings::zoom()),
                "font_size": round(settings::font_size()),
                "ui_font_size": round(settings::ui_font_size()),
                "space": self.model.active,
                "tab": self.model.active_tab().map(|c| c.id.clone()),
                "focused_pane": self.focused_pane,
                "layout": self.layout_name,
                "agent": self.shown_agent(),
                "floats": self.float_status(),
                "overlays": self.overlays.iter().map(|o| match &o.layout {
                    Some(_) => Some("layout".to_owned()),
                    None => self.copies.get(&o.slot).map(|c| c.inst.name.clone()),
                }).collect::<Vec<_>>(),
                "errors": errors,
            });
        }
        json!({ "error": "expected { do }, { ls }, { commands } or { status }" })
    }

    /// Spaces, their tabs and terminals, for `herdr-app ls`. Sub-agents are listed
    /// under the terminal that started them.
    fn world(&self) -> Value {
        let m = &self.model;
        let children = |addr: &str| -> Vec<String> {
            let mut out: Vec<String> = self
                .live
                .iter()
                .filter(|(_, r)| r.get("parent").and_then(Value::as_str) == Some(addr))
                .map(|(a, _)| a.clone())
                .collect();
            out.sort();
            out
        };
        let terminal = |pane: &str, addr: &str| {
            let rec = self.live.get(addr);
            json!({
                "terminal": addr, "pane": pane, "status": m.status(addr),
                "app": m.agents.get(addr).and_then(|a| a.app.clone()),
                "name": rec.and_then(|r| r.get("name")).cloned(),
                "sub_agents": children(addr),
            })
        };
        let spaces: Vec<Value> = m
            .spaces
            .iter()
            .map(|p| {
                let active = p.active_tab().map(|c| c.id.clone());
                let tabs: Vec<Value> = p
                    .tabs
                    .iter()
                    .map(|c| {
                        let terms: Vec<Value> = c.root.terminals().iter().filter_map(|n| Some(terminal(&n.id, n.terminal()?))).collect();
                        // Parked panes (pane.park): terminals and mods, in the row's order.
                        let parked: Vec<Value> = c.parked.iter().map(|pk| match pk.pane.terminal() {
                            Some(addr) => terminal(&pk.pane.id, addr),
                            None => json!({ "pane": pk.pane.id, "mod": match pk.pane.content() { Some(Content::Mod { name, .. }) => Some(name.clone()), _ => None } }),
                        }).collect();
                        let mut tab = json!({ "id": c.id, "name": Model::tab_name(p, c), "active": Some(&c.id) == active.as_ref(), "settled": c.settled.is_some(), "terminals": terms });
                        if !parked.is_empty() { tab["parked"] = Value::Array(parked); }
                        tab
                    })
                    .collect();
                json!({ "id": p.id, "name": m.space_name(p, &home()), "folder": p.folder, "attached": p.attached, "machine": p.machine, "active": m.active.as_deref() == Some(&p.id), "tabs": tabs })
            })
            .collect();
        json!({ "spaces": spaces, "recent": m.recent })
    }

    // ---- mods on disk ----------------------------------------------------

    fn poll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.flush_documents(false, window, cx);
        let ready = Self::update_label();
        if ready != self.update_ready {
            self.update_ready = ready;
            cx.notify();
        }
        // A layout's update note is a mod copy: made (or ended) by a sync.
        if self.update_note_mod().is_some() && self.copies.contains_key(UPDATE_NOTE) != self.update_note().is_some() {
            self.sync(window, cx);
        }
        // The settings screen shows versions and progress: redraw mods when they move.
        let status = crate::update::status().to_string();
        if status != self.update_status {
            self.update_status = status;
            self.refresh_mods(cx);
        }
        if let Some(r) = &self.runtime {
            crate::bench::note_mods(&r.read_metrics());
        }
        // With file events the disk is only checked now and then, in case one
        // was missed.
        self.polls += 1;
        if self.file_events.is_none() || self.polls.is_multiple_of(25) {
            self.reload_config(window, cx);
            self.check_layout_file(window, cx);
            self.sync_folders(window, cx);
        }
        let now = Instant::now();
        let expired: Vec<String> = self.overlays.iter().filter(|o| o.expires.is_some_and(|e| e <= now)).map(|o| o.id.clone()).collect();
        for id in expired {
            self.close_overlay(&id, window, cx);
        }
        let active = window.is_window_active();
        if active != self.window_active {
            self.window_active = active;
            if active {
                self.sync(window, cx);
                // Coming to this window (a click, cmd-tab) is the person coming back.
                crate::terminal::note_input();
                self.reclaim_sizes(cx);
            } else {
                self.looked.clear();
            }
            // Tell mods now: render publishes window() too, but a mod it refreshes
            // waits for another frame, which an idle window that just lost focus
            // may not draw for a long time.
            if mods::publish_window(self.window_json(window)) {
                self.refresh_snapshot_mods(cx);
            }
        }
        let dark = is_dark(window.appearance());
        if dark != self.system_dark {
            self.system_dark = dark;
            self.apply_look(window, cx);
        }
    }

    /// Files people or agents edited: apply what they change.
    fn files_changed(&mut self, changed: Vec<std::path::PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
        for path in changed_asset_paths(&mods::app_dir(), &changed) {
            invalidate_asset(&path, window, cx);
        }
        let top = |p: &std::path::PathBuf| p.components().next().and_then(|c| c.as_os_str().to_str().map(str::to_owned)).unwrap_or_default();
        if changed.iter().any(|p| matches!(top(p).as_str(), "settings.json" | "keys.json" | "programs.json" | "themes")) {
            self.reload_config(window, cx);
        }
        // The theme showing may be the file that changed.
        if changed.iter().any(|p| top(p) == "themes") {
            self.apply_look(window, cx);
        }
        if changed.iter().any(|p| top(p) == "layouts") {
            self.check_layout_file(window, cx);
        }
        let edited: BTreeSet<String> = changed.iter().filter_map(|p| crate::files::mod_of(p)).collect();
        if edited.is_empty() {
            return;
        }
        // Copies that load now (a new folder, a fixed failed load) already run the
        // saved code: reloading them too would start them twice.
        let loaded: BTreeSet<u64> = self.copies.values().filter(|c| c.root.is_some()).map(|c| c.id).collect();
        self.sync_folders(window, cx);
        let Some(runtime) = self.runtime.clone() else { return };
        for copy in self.copies.values_mut().filter(|c| edited.contains(&c.inst.name) && loaded.contains(&c.id)) {
            let Some(root) = &copy.root else { continue };
            let error = runtime.reload_now(root, window, cx).err().map(|e| format!("{e:#}"));
            if let Some(e) = &error {
                tracing::warn!("mod reload failed: {e}");
            }
            copy.error = error;
        }
    }

    fn sync_folders(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.runtime.is_none() {
            return;
        }
        let found: BTreeMap<String, Found> = mods::scan().into_iter().map(|f| (f.id.clone(), f)).collect();
        let edited: BTreeSet<String> = found.values().filter(|f| self.folders.get(&f.id).is_some_and(|o| o.stamp != f.stamp)).map(|f| f.id.clone()).collect();
        let added = found.keys().any(|k| !self.folders.contains_key(k));
        let removed = self.folders.keys().any(|k| !found.contains_key(k));
        let fresh: Vec<Found> = found.values().filter(|f| !self.seen.contains(&f.id)).cloned().collect();
        self.folders = found;

        // Copies that failed get another try when their folder changes; loaded ones hot-reload.
        let retry: Vec<String> = self.copies.iter().filter(|(_, c)| c.root.is_none() && (edited.contains(&c.inst.name) || added)).map(|(s, _)| s.clone()).collect();
        for slot in &retry {
            self.copies.remove(slot);
        }
        // A mod seen for the first time goes where it asked (unless the layout already shows it).
        for f in fresh {
            if shipped_layouts().contains(&self.layout_name.as_str()) && f.hint.place.as_deref().unwrap_or("right") != "none" {
                continue;
            }
            self.seen.insert(f.id.clone());
            write_atomic(&file("seen.json"), &serde_json::to_string(&self.seen).unwrap_or_default());
            let shown = self.chrome.walk().iter().any(|n| matches!(n.content(), Some(Content::Mod { name, .. }) if *name == f.id));
            let place = f.hint.place.as_deref().unwrap_or("right");
            if !shown && place != "none" && !shipped_layouts().contains(&self.layout_name.as_str()) {
                let mut block = Node::block(self.model.fresh_id("b"), Content::Mod { name: f.id.clone(), props: Value::Null });
                block.size = Some(Span::Px { px: f.hint.size.unwrap_or(320.0) });
                dock(&mut self.chrome, block, place, self.model.fresh_id("r"));
            }
        }
        if !retry.is_empty() || added || removed {
            self.sync(window, cx);
        }
    }

    // ---- rendering ---------------------------------------------------------

    fn focused_path(&self, window: &Window, cx: &App) -> HashSet<String> {
        let mut out = HashSet::new();
        // A mod block in the layout holding the keyboard: its `focus` looks, not the pane's.
        if let Some(path) = self.focused_block.as_ref().and_then(|b| self.chrome.path_to(b)) {
            out.extend(path);
            return out;
        }
        if let Some(p) = &self.focused_pane {
            // Pane selection survives an input, float or dialog taking the keyboard.
            if self.pane_term(p).is_some_and(|t| !t.view.read(cx).owns_keyboard_focus(window, cx)) {
                return out;
            }
            if let Some(c) = self.model.active_tab()
                && let Some(path) = c.root.path_to(p)
            {
                out.extend(path);
            }
            out.insert(p.clone());
        }
        out
    }

    /// The shown tab block's pane frame, if its panes are framed now: when
    /// the tab is split, or always with `lone`.
    fn pane_frame(&self) -> Option<&PaneFrame> {
        let frame = self.chrome.visible_blocks().into_iter().find_map(|n| match n.content() {
            Some(Content::Context { pane, .. }) => pane.as_ref(),
            _ => None,
        })?;
        let ctx = self.model.active_tab()?;
        (frame.lone || ctx.root.panes().len() > 1).then_some(frame)
    }

    /// A pane in its frame: the look, and the header mod above or below it
    /// (on hover: drawn over the terminal, so it never resizes).
    fn frame_pane(&self, n: &Node, f: &PaneFrame, on: bool, inner: AnyElement, cx: &mut Context<Self>) -> AnyElement {
        let line = pane_size::frame_border(f, on);
        let group = SharedString::from(format!("pane-{}", n.id));
        let mut el = div().size_full().relative().flex().flex_col().overflow_hidden().group(group.clone());
        if let Some(r) = f.radius {
            el = el.rounded(settings::z(r));
        }
        if let Some(bg) = &f.background {
            el = paint(el, bg);
        }
        if let Some(l) = line {
            el = el.border(settings::z(l.width)).border_color(c(&l.color));
        }
        el = shadow(el, f.shadow.as_deref());
        let body = div().flex_1().min_h_0().flex().child(inner);
        let Some(h) = &f.header else { return el.child(body).into_any_element() };
        let head = div().flex_none().h(settings::z(pane_size::header_height(h))).w_full().flex()
            .child(self.render_slot(&format!("{}#frame", n.id), cx));
        if h.hover() {
            let head = head.absolute().left_0().right_0().opacity(0.).group_hover(group, |s| s.opacity(1.));
            let head = if h.bottom() { head.bottom_0() } else { head.top_0() };
            return el.child(body).child(head).into_any_element();
        }
        if h.bottom() { el.child(body).child(head) } else { el.child(head).child(body) }.into_any_element()
    }

    /// `frame`: how panes are wrapped here (inside a framed tab), else None.
    fn render_node(&self, n: &Node, focused: &HashSet<String>, frame: Option<&PaneFrame>, cx: &mut Context<Self>) -> AnyElement {
        let mut el = div().relative().overflow_hidden().size_full().flex();
        let bounds_map = self.bounds.clone();
        let id = n.id.clone();
        el = el.child(canvas(move |b, _, _| { bounds_map.borrow_mut().insert(id, b); }, |_, _, _, _| {}).absolute().size_full());
        el = apply_look(el, n, focused.contains(&n.id));
        if n.window_drag {
            el = self.window_drag(el, cx);
        }
        let el = match &n.kind {
            Kind::Block { content } => {
                let inner = self.render_block(n, content, focused, cx);
                match frame.filter(|_| n.is_pane()) {
                    Some(f) => el.child(self.frame_pane(n, f, focused.contains(&n.id), inner, cx)),
                    None => el.child(inner),
                }
            }
            Kind::Row { children } | Kind::Column { children } => {
                let axis = n.axis().unwrap();
                el = if axis == Axis::Row { el.flex_row() } else { el.flex_col() };
                let shown: Vec<&Node> = children.iter().filter(|c| !c.hidden).collect();
                let gap = pane_size::gap(n, frame);
                // Weights are shares of what the fixed-size siblings leave, so they always fill it.
                let total: f32 = shown
                    .iter()
                    .map(|c| pane_size::weight(c))
                    .sum::<f32>()
                    .max(f32::EPSILON);
                for (i, child) in shown.iter().enumerate() {
                    if i > 0 {
                        el = el.child(self.separator(n, axis, gap, i - 1, cx));
                    }
                    // No clipping here: a child's shadow may fall outside it (the child clips itself).
                    let mut slot = div().relative().flex().min_w_0().min_h_0();
                    slot = sized(slot, child, axis, total);
                    el = el.child(slot.child(self.render_node(child, focused, frame, cx)));
                }
                el
            }
            Kind::Stack { header, .. } => {
                el = el.flex_col();
                let head = header.as_ref().map(|h| {
                    let height = pane_size::header_height(h);
                    let head: AnyElement = match &h.content {
                        HeaderContent::Mod { .. } => self.render_slot(&format!("{}#header", n.id), cx),
                        HeaderContent::Builtin(_) => self.builtin_tabs(n, cx),
                    };
                    (h.bottom(), div().flex_none().h(settings::z(height)).w_full().flex().child(head))
                });
                let body = match n.active_child() {
                    Some(child) => self.render_node(child, focused, frame, cx),
                    None => div().into_any_element(),
                };
                let body = div().flex_1().min_h_0().flex().child(body);
                match head {
                    Some((true, head)) => el.child(body).child(head),
                    Some((false, head)) => el.child(head).child(body),
                    None => el.child(body),
                }
            }
        };
        let row = frame.and_then(|f| f.header.as_ref()).filter(|h| !h.bottom() && !h.hover()).map(pane_size::header_height);
        el.children(self.render_floats(n, cx)).children(self.pane_grip(&n.id, row, cx)).into_any_element()
    }

    fn render_block(&self, n: &Node, content: &Content, focused: &HashSet<String>, cx: &mut Context<Self>) -> AnyElement {
        match content {
            Content::Terminal { .. } => match self.pane_term(&n.id) {
                Some(t) => {
                    let id = n.id.clone();
                    div()
                        .size_full()
                        .on_any_mouse_down(cx.listener(move |this, _, _, cx| {
                            // Overlay terminals keep their own focus; chrome blocks share the pane focus API.
                            if this.focused_pane.as_deref() != Some(id.as_str())
                                && (this.model.tab_of(&id).is_some() || terminal_block(&this.chrome, Some(&id)).is_some())
                            {
                                this.model.focus_pane(&id);
                                this.focused_pane = Some(id.clone());
                                this.synced_model_pane = this.model.focused_pane();
                                this.publish(cx);
                                this.save();
                                cx.notify();
                            }
                        }))
                        .child(shown_terminal(&t.view, cx))
                        .into_any_element()
                }
                None => div().into_any_element(),
            },
            Content::Mod { .. } => self.render_slot(&n.id, cx),
            Content::Agent { .. } => match self.shown_agent() {
                Some(addr) => match self.agent_view(&n.id, &addr) {
                    Some(t) => div().size_full().child(shown_terminal(&t.view, cx)).into_any_element(),
                    None => div().into_any_element(),
                },
                None => div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(c("dim"))
                    .child("no agents yet. start claude, codex or pi in a terminal")
                    .into_any_element(),
            },
            Content::Context { .. } => match self.model.active_tab() {
                Some(c) => {
                    let body = self.render_node(c.shown(), focused, self.pane_frame(), cx);
                    self.with_parking_row(c, body, cx)
                }
                None if self.documents.get("").is_some_and(|s| s.layout() == "loading") => div().size_full().into_any_element(),
                None => {
                    let key = crate::keys::listing().into_iter().find(|(_, _, a)| a == "space.new").map(|(_, k, _)| format!(" ({k})"));
                    div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(c("dim"))
                        .child(format!("No space open. Make one{}.", key.unwrap_or_default()))
                        .into_any_element()
                }
            },
        }
    }

    /// A press on the native view of mod copy `copy`: its pane takes focus, as
    /// in render_slot's mouse handler (the keyboard stays with the page).
    /// A focusable mod also gets GPUI's keyboard (`focus`, as `pane.go` gives
    /// it): the page keeps the keys it types, while the cmd chords it leaves
    /// come back through GPUI to the mod's own keys.json section
    /// (`mod:<name>`), not the window's.
    fn native_view_pressed(&mut self, copy: u64, window: &mut Window, cx: &mut Context<Self>) {
        let Some(slot) = self.copies.iter().find(|(_, c)| c.id == copy).map(|(s, _)| s.clone()) else { return };
        self.focus_pressed(slot.clone(), window, cx);
        let dialog = self.keys_held();
        if !dialog && self.model.tab_of(&slot).is_some() && self.focusable(&slot) {
            // Kept as the block with the keyboard: it gets `focus` back after a popup over it.
            self.focused_block = Some(slot);
            self.hand_keyboard();
        }
    }

    /// A press on a pane's native view: that pane takes focus, its tab and space show.
    fn focus_pressed(&mut self, slot: String, window: &mut Window, cx: &mut Context<Self>) {
        // A parked pane too: focusing it unparks it (Model::focus_pane).
        let Some(tab) = self.model.tab_holding(&slot).map(|t| t.id.clone()) else { return };
        // Focused already, and shown: nothing to do. A pane still marked focused
        // in a tab that was left needs its tab shown again.
        let shown = self.model.active_tab().is_some_and(|t| t.id == tab);
        if shown && self.focused_pane.as_deref() == Some(slot.as_str()) {
            return;
        }
        self.model.focus_pane(&slot);
        // A block that had the keyboard (`pane.go`) has it no more.
        if self.focused_block.as_deref().is_some_and(|b| b != slot) {
            self.focused_block = None;
        }
        // The keyboard leaves the terminal that had it (in a tab now hidden, it
        // would take its tab back at the next frame): the pane's own terminal,
        // else the window (the native view keeps AppKit's keyboard).
        match self.pane_focus(&slot, cx) {
            Some(f) => f.focus(window, cx),
            None => self.focus.focus(window, cx),
        }
        self.focused_pane = Some(slot);
        self.publish(cx);
        self.save();
        cx.notify();
    }

    fn render_slot(&self, slot: &str, cx: &mut Context<Self>) -> AnyElement {
        let in_overlay = slot.starts_with("overlay:") || self.overlays.iter().any(|o| o.layout.as_ref().is_some_and(|l| l.find(slot).is_some()));
        // A mod that is a pane in a tab: a click makes it the focused pane, and the
        // keyboard is its own (an editor, a board), like a terminal's.
        let in_pane = self.model.tab_of(slot).is_some();
        match self.copies.get(slot) {
            Some(Copy { root: Some(root), inst, .. }) => div()
                .size_full()
                .key_context(format!("Mod mod = {}", inst.name).as_str())
                .when(in_pane, |d| {
                    let id = slot.to_owned();
                    d.on_any_mouse_down(cx.listener(move |this, _, _, cx| {
                        if this.focused_pane.as_deref() != Some(id.as_str()) {
                            this.model.focus_pane(&id);
                            // A block that had the keyboard (`pane.go`) has it no more.
                            if this.focused_block.as_deref().is_some_and(|b| b != id) {
                                this.focused_block = None;
                            }
                            this.focused_pane = Some(id.clone());
                            this.publish(cx);
                            this.save();
                            cx.notify();
                        }
                    }))
                })
                // Bare layout clicks leave the keyboard with the pane, but an input
                // or other focusable control owns the keyboard once it takes focus.
                .when(!in_overlay && !in_pane, |d| {
                    d.capture_any_mouse_down(cx.listener(|_, _, window, cx| {
                        cx.defer_in(window, |this, window, cx| this.refocus_pane(window, cx));
                    }))
                })
                // Popups size to their content, up to the window: a column, so a mod
                // root with `min_h(0)` can shrink and scroll. Layout mods fill their block.
                // Not cached here: ShellRoot caches the mod's view itself and draws its
                // spinners over it, waking only itself (GPUI rebuilds all under a cached
                // view that changed, so a spinner step would rebuild the mod).
                .map(|d| if in_overlay { d.h_auto().min_h_0().flex().flex_col().child(root.clone()) } else { d.child(root.clone()) })
                .into_any_element(),
            Some(Copy { error, inst, missing, .. }) => div()
                .id(SharedString::from(format!("err-{slot}")))
                .size_full()
                .p_2()
                .text_xs()
                .text_color(c("blocked"))
                .overflow_y_scroll()
                .child(if *missing {
                    format!("The {} mod isn't installed (no folder ~/.config/herdr-app/mods/{}).\n\nClose this pane, or put the mod back.", inst.name, inst.name)
                } else {
                    format!("{} did not load:\n\n{}\n\nFix the files; Fireflies retries on save.", inst.name, error.as_deref().unwrap_or("?"))
                })
                .into_any_element(),
            None => div().into_any_element(),
        }
    }

    /// Plain fallback for `"header": { "content": "tabs" }`.
    fn builtin_tabs(&self, n: &Node, cx: &mut Context<Self>) -> AnyElement {
        let active = n.active_child().map(|c| c.id.clone());
        let stack = n.id.clone();
        let mut row = div().size_full().flex().flex_row().bg(c("surface")).text_xs();
        for (i, ch) in n.children().iter().enumerate() {
            let (s, id) = (stack.clone(), ch.id.clone());
            let on = active.as_deref() == Some(ch.id.as_str());
            row = row.child(
                div()
                    .id(SharedString::from(format!("tab-{}", ch.id)))
                    .px_3()
                    .flex()
                    .items_center()
                    .text_color(if on { c("foreground") } else { c("muted") })
                    .when(on, |d| d.bg(c("raised")))
                    .on_click(cx.listener(move |this, _, w, cx| this.run("layout.select", json!({ "stack": s, "child": id }), w, cx)))
                    .child(ch.title.clone().unwrap_or_else(|| (i + 1).to_string())),
            );
        }
        row.into_any_element()
    }

    fn separator(&self, n: &Node, axis: Axis, gap: f32, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let row = axis == Axis::Row;
        let zoom = settings::zoom();
        let line = n.divider.as_ref().map(|d| (d.width * zoom, c(&d.color)));
        let width = pane_size::separator_width(n, gap) * zoom;
        let mut sep = div().flex_none().relative().flex().items_center().justify_center();
        sep = if row { sep.w(px(width)).h_full() } else { sep.h(px(width)).w_full() };
        if let Some((w, color)) = line {
            let top = traffic_light_divider_inset(n, axis, index, cfg!(target_os = "macos"), zoom) * zoom;
            if top > 0.0
                && let Some(Paint::Color(background)) = n.children().iter().filter(|child| !child.hidden).nth(index).and_then(|child| child.background.as_ref())
            {
                sep = sep.bg(c(background));
            }
            sep = sep.child(separator_line(row, w, color, top));
        }
        if n.resizable() {
            let container = n.id.clone();
            let hit = HANDLE.max(width);
            sep = sep.child(
                div()
                    .absolute()
                    .when(row, |d| d.top_0().bottom_0().left(px((width - hit) / 2.0)).w(px(hit)).cursor_col_resize())
                    .when(!row, |d| d.left_0().right_0().top(px((width - hit) / 2.0)).h(px(hit)).cursor_row_resize())
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _: &MouseDownEvent, _, cx| {
                            if let Some(space) = this.model.space_of(&container)
                                && this.require_document(space.machine.as_deref()).is_err() { return; }
                            this.drag = Some(Drag { container: container.clone(), index, axis });
                            cx.stop_propagation();
                        }),
                    ),
            );
        }
        sep.into_any_element()
    }

    fn drag_to(&mut self, pos: Point<Pixels>) {
        let Some(d) = &self.drag else { return };
        let (container, index, axis) = (d.container.clone(), d.index, d.axis);
        let Some(node) = self.find_node_mut(&container).map(|n| n.clone()) else { return };
        if !node.resizable() { return; }
        let shown: Vec<&Node> = node.children().iter().filter(|c| !c.hidden).collect();
        let (Some(a), Some(b)) = (shown.get(index), shown.get(index + 1)) else { return };
        let bounds = self.bounds.borrow();
        let (Some(ba), Some(bb)) = (bounds.get(&a.id).copied(), bounds.get(&b.id).copied()) else { return };
        drop(bounds);
        let (start, p) = match axis {
            Axis::Row => (f32::from(ba.left()), f32::from(pos.x)),
            Axis::Column => (f32::from(ba.top()), f32::from(pos.y)),
        };
        let (la, lb) = match axis {
            Axis::Row => (f32::from(ba.size.width), f32::from(bb.size.width)),
            Axis::Column => (f32::from(ba.size.height), f32::from(bb.size.height)),
        };
        // Measured on screen; sizes are stored as designed (unzoomed).
        let zoom = settings::zoom();
        let (la, lb, start, p) = (la / zoom, lb / zoom, start / zoom, p / zoom);
        let total = la + lb;
        let Some(new_a) = crate::pane_resize::clamp(a, total, p - start) else { return };
        let sizes = crate::pane_resize::sizes(a, b, total, new_a);
        let Some(parent) = self.find_node_mut(&container) else { return };
        let Some(children) = parent.children_mut() else { return };
        for (id, s) in sizes {
            if let Some(n) = children.iter_mut().find(|n| n.id == id) {
                n.size = Some(s);
            }
        }
    }

    /// The overlays in paint order, bottom first: windows under dialogs, popups
    /// and toasts; each kind in the order opened (a window pressed last is
    /// last: on top).
    fn overlay_order(&self) -> impl Iterator<Item = &Overlay> {
        self.overlays.iter().filter(|o| o.kind == OverlayKind::Window).chain(self.overlays.iter().filter(|o| o.kind != OverlayKind::Window))
    }

    /// Each mod copy's native view layer (`native_view::Layer`): the overlay
    /// it's drawn in (by `overlay_order`), and whether it's in a floating block.
    fn native_layers(&self) -> HashMap<u64, crate::native_view::Layer> {
        let order: Vec<&Overlay> = self.overlay_order().collect();
        self.copies
            .iter()
            .filter(|(_, c)| c.id != 0)
            .map(|(slot, c)| {
                let float = slot.strip_prefix("float:").map(|f| f.split('#').next().unwrap_or(f));
                let inside = |o: &&Overlay| {
                    o.slot == *slot
                        || o.layout.as_ref().is_some_and(|l| l.find(slot).is_some() || float.is_some_and(|f| l.find_float(f).is_some()))
                };
                let z = order.iter().position(|o| inside(o)).map_or(0, |i| i + 1);
                (c.id, crate::native_view::Layer { z, float: float.is_some() })
            })
            .collect()
    }

    fn render_overlays(&self, viewport: Size<Pixels>, scale: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut out = Vec::new();
        let mut toast_y = 16.0;
        // Drawn last, so it stays clickable over an open dialog.
        let pill = self.render_update_pill(cx);
        if pill.is_some() {
            toast_y += UPDATE_PILL_HEIGHT + 8.0;
        }
        for (i, o) in self.overlay_order().enumerate() {
            let id = o.id.clone();
            // HUP: what this overlay paints (its backdrop, card and grips) is on
            // its own layer, above the tree's and every overlay painted before it.
            out.push(crate::native_view::layer(i + 1).into_any_element());
            // Up to 1: a share of the window (terminals in overlays want room, not px).
            let span = |v: f32, full: Pixels| if v <= 1.0 { full * v } else { settings::z(v) };
            let (w, h) = (span(o.size.width, viewport.width), span(o.size.height, viewport.height));
            let sized = |v: f32| v > 0.0 || o.kind != OverlayKind::Window;
            let content = match &o.layout {
                Some(l) => self.render_node(l, &HashSet::new(), None, cx),
                None => self.render_slot(&o.slot, cx),
            };
            let body = div()
                .id(SharedString::from(format!("ov-{}", o.id)))
                .track_focus(&o.focus)
                // Esc stays with terminals (agents use it to interrupt) and windows.
                .when(o.layout.is_none() && o.kind.modal_keys(), |d| d.key_context("Overlay"))
                .when(sized(o.size.width), |d| d.w(w))
                .when(sized(o.size.height), |d| if o.fit { d.max_h(h) } else { d.h(h) })
                .when(!o.bare, |d| d.bg(c("popover")).border_1().border_color(c("border")).rounded(settings::z(8.0)).shadow_lg())
                .overflow_hidden()
                .flex()
                // Scroll, hover and cursor stop here, not on the pane behind.
                .occlude()
                .when(o.kind != OverlayKind::Window, |d| d.on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()))
                // HUP: native views below keep rendering, with a hole here.
                .relative()
                .child(crate::native_view::cover_probe(if o.bare { 0.0 } else { f32::from(settings::z(8.0)) }, crate::native_view::By::Overlay))
                .child(content);
            match o.kind {
                OverlayKind::Window => {
                    // A window over a dim of its own: like a dialog's, a click on it closes the window.
                    if o.scrim {
                        let id = id.clone();
                        out.push(
                            div()
                                .id(SharedString::from(format!("scrim-{id}")))
                                .absolute()
                                .inset_0()
                                .child(scrim_layer(self.chrome.scrim.as_ref(), scale))
                                .occlude()
                                .child(crate::native_view::dim_probe())
                                .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, w, cx| this.close_overlay(&id, w, cx)))
                                .into_any_element(),
                        );
                    }
                    out.push(self.render_window(o, body, viewport, cx));
                }
                OverlayKind::Dialog => out.push(
                    div()
                        .absolute()
                        .inset_0()
                        .child(scrim_layer(self.chrome.scrim.as_ref(), scale))
                        .occlude()
                        .child(crate::native_view::dim_probe())
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(!o.modal, |d| d.on_mouse_down(MouseButton::Left, cx.listener(move |this, _, w, cx| this.close_overlay(&id, w, cx))))
                        .child(body)
                        .into_any_element(),
                ),
                OverlayKind::Popup => {
                    let at = match o.top {
                        // Centered, hanging from `offset` px below the top (a drop-down from a bar).
                        Some(off) => point((viewport.width - w) / 2.0, settings::z(off)),
                        None => o.at,
                    };
                    out.push(
                        div()
                            .absolute()
                            .inset_0()
                            // `scrim: true`: the dialog dim behind it (a click there still closes it).
                            .when(o.scrim, |d| d.child(scrim_layer(self.chrome.scrim.as_ref(), scale)).occlude().child(crate::native_view::dim_probe()))
                            .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, w, cx| this.close_overlay(&id, w, cx)))
                            .on_mouse_down(MouseButton::Right, cx.listener({
                                let id = o.id.clone();
                                move |this, _, w, cx| this.close_overlay(&id, w, cx)
                            }))
                            .child(position_popup(at, body))
                            .into_any_element(),
                    );
                }
                OverlayKind::Toast => {
                    out.push(div().absolute().right(settings::z(16.0)).bottom(settings::z(toast_y)).child(body).into_any_element());
                    toast_y += o.size.height + 8.0;
                }
            }
        }
        if let Some(error) = crate::update::core().error {
            out.push(div().absolute().right(settings::z(16.0)).bottom(settings::z(toast_y))
                .max_w(settings::z(540.0)).p(settings::z(12.0)).rounded_lg().bg(c("popover"))
                .border_1().border_color(c("border")).text_size(settings::z(13.0)).text_color(c("foreground"))
                .id("core-update-error").cursor_pointer()
                .on_click(cx.listener(|this, _, w, cx| this.run("app.settings", json!({ "section": "updates" }), w, cx)))
                .child(format!("herdr-core update failed: {error} · Open Updates")).into_any_element());
        }
        out.extend(pill);
        out
    }
}

const UPDATE_PILL_HEIGHT: f32 = 34.0;
/// A layout mod's update note: its slot and width (it is as tall as the pill).
const UPDATE_NOTE: &str = "update-note";
const UPDATE_NOTE_WIDTH: f32 = 460.0;

impl AppWindow {
    /// "Fireflies 0.2.0 is ready · Restart": the frame's, so no layout or mod can hide it.
    /// What's waiting, in words: the pill shows it until clicked or dismissed.
    fn update_label() -> Option<String> {
        let core = crate::update::core();
        let core = core.ready.filter(|_| !core.updating);
        match (crate::update::ready(), core) {
            (Some(a), Some(c)) => Some(format!("Fireflies {a} and herdr-core {c} are ready")),
            (Some(a), None) => Some(format!("Fireflies {a} is ready")),
            (None, Some(c)) => Some(format!("herdr-core {c} is ready")),
            (None, None) => None,
        }
    }

    /// The layout's mod for the update note (`dialog_mods.update`), when it has one.
    fn update_note_mod(&self) -> Option<&String> {
        self.chrome.dialog_mods.get("update").filter(|m| self.folders.contains_key(*m))
    }

    /// What the update note says now, as the props a layout's mod gets:
    /// `{label, restart, success, dismissal}` (restart: a new app is ready,
    /// app.update starts it; success: this start updated it). None: no note.
    fn update_note(&self) -> Option<Value> {
        let app_version = crate::update::ready();
        let success = self.update_ready.is_none() && self.update_success;
        let label = self.update_ready.clone().or_else(|| success.then(|| format!("Updated to {}", env!("CARGO_PKG_VERSION"))))?;
        let dismissal = app_version.clone().map(|v| format!("app:{v}")).unwrap_or_else(|| label.clone());
        if self.update_dismissed.as_ref() == Some(&dismissal) { return None; }
        Some(json!({ "dialog": "update", "label": label, "restart": app_version.is_some(), "success": success, "dismissal": dismissal }))
    }

    fn render_update_pill(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        // The layout's mod draws it (it dismisses itself): its copy, bottom right.
        if self.update_note_mod().is_some() {
            self.update_note()?;
            let root = self.copies.get(UPDATE_NOTE)?.root.clone()?;
            return Some(div().absolute().right(settings::z(16.0)).bottom(settings::z(16.0))
                .w(settings::z(UPDATE_NOTE_WIDTH)).h(settings::z(UPDATE_PILL_HEIGHT))
                .child(cached(&root)).into_any_element());
        }
        let app_version = crate::update::ready();
        let app_ready = app_version.is_some();
        let success = self.update_ready.is_none() && self.update_success;
        let label = self.update_ready.clone().or_else(|| success.then(|| format!("Updated to {}", env!("CARGO_PKG_VERSION"))))?;
        let dismissal = app_version.map(|v| format!("app:{v}")).unwrap_or_else(|| label.clone());
        if self.update_dismissed.as_ref() == Some(&dismissal) { return None; }
        let pill = div()
            .absolute()
            .right(settings::z(16.0))
            .bottom(settings::z(16.0))
            .h(settings::z(UPDATE_PILL_HEIGHT))
            .pl(settings::z(14.0))
            .pr(settings::z(6.0))
            .flex()
            .items_center()
            .gap(settings::z(10.0))
            .bg(c("popover"))
            .border_1()
            .border_color(c("border"))
            .rounded_full()
            .shadow_lg()
            .occlude()
            .text_size(settings::z(13.0))
            .child(div().text_color(c("foreground")).child(label.clone()))
            .when(app_ready, |pill| pill.child(
                div()
                    .id("update-restart")
                    .h(settings::z(24.0))
                    .px(settings::z(10.0))
                    .flex()
                    .items_center()
                    .rounded_full()
                    .cursor_pointer()
                    .bg(c("accent"))
                    .text_color(c("accent_foreground"))
                    .font_weight(FontWeight::SEMIBOLD)
                    .hover(|s| s.opacity(0.9))
                    .child("Restart")
                    .on_click(cx.listener(|this, _, w, cx| this.run("app.update", json!({}), w, cx))),
            ))
            .child(div().id("update-notes").px(settings::z(6.0)).cursor_pointer().text_color(c("accent"))
                .child(if app_ready || success { "What changed" } else { "Open Updates" })
                .on_click(cx.listener(move |this, _, w, cx| {
                    if success { this.update_success = false; }
                    this.run("app.settings", json!({ "section": "updates" }), w, cx);
                })))
            .child(
                div()
                    .id("update-dismiss")
                    .size(settings::z(24.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .cursor_pointer()
                    .text_color(c("dim"))
                    .hover(|s| s.bg(c("raised")).text_color(c("foreground")))
                    .child("×")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.update_dismissed = Some(dismissal.clone());
                        cx.notify();
                    })),
            );
        Some(pill.into_any_element())
    }
}

/// A view drawn again only when it changed: a terminal's output then
/// redraws that terminal, not every mod and pane in the window.
pub(crate) fn cached<V: Render>(view: &Entity<V>) -> AnyElement {
    view.clone().cached(StyleRefinement::default().size_full()).into_any_element()
}

pub(crate) fn shown_terminal(view: &Entity<TerminalView>, cx: &App) -> AnyElement {
    // Output that arrived while it was off screen didn't redraw it: draw it
    // afresh this once, or the window keeps the screen it had when hidden.
    // Not while held: the last drawn screen is the one to keep showing then.
    if view.read(cx).mark_shown() && !view.read(cx).held() {
        return view.clone().into_any_element();
    }
    cached(view)
}

fn remember_pane(history: &mut Vec<String>, id: &str) {
    if history.last().is_some_and(|last| last == id) {
        return;
    }
    history.retain(|pane| pane != id);
    history.push(id.to_owned());
}

/// Prefer the most recently focused pane along the nearest edge. Unvisited
/// panes fall back to overlap and layout order, ignoring subpixel split noise.
fn nearest(cur: Bounds<Pixels>, dir: &str, candidates: impl IntoIterator<Item = (String, Bounds<Pixels>)>, history: &[String]) -> Option<String> {
    let overlap = |a0: Pixels, a1: Pixels, b0: Pixels, b1: Pixels| f32::from(a1.min(b1) - a0.max(b0)).max(0.0);
    let cmp = |a: f32, b: f32| if (a - b).abs() < 1.0 { std::cmp::Ordering::Equal } else { a.total_cmp(&b) };
    candidates
        .into_iter()
        .filter_map(|(id, r)| {
            let (gap, ov) = match dir {
                "left" => (f32::from(cur.left() - r.right()), overlap(cur.top(), cur.bottom(), r.top(), r.bottom())),
                "right" => (f32::from(r.left() - cur.right()), overlap(cur.top(), cur.bottom(), r.top(), r.bottom())),
                "up" => (f32::from(cur.top() - r.bottom()), overlap(cur.left(), cur.right(), r.left(), r.right())),
                _ => (f32::from(r.top() - cur.bottom()), overlap(cur.left(), cur.right(), r.left(), r.right())),
            };
            let recent = history.iter().position(|pane| pane == &id);
            (gap > -2.0 && ov > 0.0).then_some((gap, recent, ov, id))
        })
        .reduce(|best, next| if cmp(next.0, best.0).then(best.1.cmp(&next.1)).then(cmp(best.2, next.2)).is_lt() { next } else { best })
        .map(|(_, _, _, id)| id)
}

fn position_popup(at: Point<Pixels>, body: Stateful<Div>) -> Anchored {
    anchored()
        .position(point(at.x.max(px(8.0)), at.y.max(px(8.0))))
        .snap_to_window_with_margin(px(8.0))
        .child(body)
}

/// An overlay's blocks get ids of their own (`<overlay>/<id>`), and its mods learn the overlay.
/// A node's id inside an overlay's layout (`overlay_layout`).
fn ov_id(overlay: &str, id: &str) -> String {
    format!("ov{overlay}/{id}")
}

fn overlay_layout(mut n: Node, overlay: &str) -> Node {
    fn walk(n: &mut Node, overlay: &str, seq: &mut usize) {
        *seq += 1;
        n.id = if n.id.is_empty() { format!("ov{overlay}/{seq}") } else { format!("ov{overlay}/{}", n.id) };
        if let Kind::Block { content: Content::Mod { props, .. } } = &mut n.kind {
            if !props.is_object() {
                *props = json!({});
            }
            props["overlay"] = json!(overlay);
        }
        // A stack's shown child goes by its id, which gets the same prefix.
        if let Kind::Stack { active: Some(a), .. } = &mut n.kind {
            *a = ov_id(overlay, a);
        }
        for c in n.children_mut().into_iter().flatten() {
            walk(c, overlay, seq);
        }
    }
    walk(&mut n, overlay, &mut 0);
    n
}

/// What a terminal's folder last said about its repo, and what ran there then.
struct FolderCheck {
    at: Instant,
    cwd: String,
    busy: bool,
    /// A repo, or git couldn't say (a machine unreachable): worth a look again.
    repo: bool,
}

/// Changes made outside Fireflies (a commit in another app): looked for this often,
/// in repos, while the window is in front.
const FOLDER_FALLBACK: Duration = Duration::from_secs(60);

/// What a close would end, named in its confirm.
#[derive(Clone, Copy, Debug, PartialEq)]
enum EndingKind {
    Agent,
    Program,
    Unsaved,
}

#[derive(Clone, Debug, PartialEq)]
struct Ending {
    kind: EndingKind,
    note: String,
}

impl Ending {
    fn unsaved(note: String) -> Self {
        Ending { kind: EndingKind::Unsaved, note }
    }
}

/// What keeps a terminal from closing without a word: an agent, whatever
/// its status (an idle one still holds its conversation), or a program
/// other than the shell in front. A shell at its prompt closes quietly.
fn ending(status: Option<&str>, rec: &Value) -> Option<Ending> {
    let flag = |k: &str| rec["program"][k].as_bool() == Some(true);
    let named = rec.pointer("/program/name").and_then(Value::as_str).filter(|n| !n.is_empty());
    // Only agents report a status.
    if flag("agent") || status.is_some() {
        let name = named.unwrap_or("an agent");
        let state = match status {
            Some("working") => "is working",
            Some("blocked") => "needs you",
            Some("done") => "is done",
            _ => "is idle",
        };
        return Some(Ending { kind: EndingKind::Agent, note: format!("{name} {state}") });
    }
    if !rec.get("program").is_some_and(Value::is_object) || flag("shell") {
        return None;
    }
    // A program in its own words: its command and first argument ("cargo build").
    let mut argv = rec.pointer("/foreground/argv").or_else(|| rec.get("argv")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str);
    let what = match argv.next().map(|w| w.rsplit('/').next().unwrap_or(w)) {
        Some(cmd) => match argv.find(|w| !w.starts_with('-')) {
            Some(arg) => format!("{cmd} {arg}"),
            None => cmd.to_owned(),
        },
        None => named.unwrap_or("a program").to_owned(),
    };
    Some(Ending { kind: EndingKind::Program, note: format!("{what} running") })
}

/// A line of notes: the first few, then how many more.
fn running_summary(notes: &[String]) -> String {
    const SHOWN: usize = 3;
    let mut line = notes.iter().take(SHOWN).cloned().collect::<Vec<_>>().join(" \u{b7} ");
    if notes.len() > SHOWN {
        line.push_str(&format!(" \u{b7} +{} more", notes.len() - SHOWN));
    }
    line
}

/// A confirm's lines for what a close ends: the agents first (counted when
/// there are several), then programs and unsaved work.
fn endings_summary(endings: &[Ending]) -> String {
    let notes = |agents: bool| endings.iter().filter(|e| (e.kind == EndingKind::Agent) == agents).map(|e| e.note.clone()).collect::<Vec<_>>();
    let (agents, rest) = (notes(true), notes(false));
    let mut lines = Vec::new();
    match agents.len() {
        0 => {}
        1 => lines.push(agents[0].clone()),
        n => lines.push(format!("{n} agents: {}", running_summary(&agents))),
    }
    if !rest.is_empty() {
        lines.push(running_summary(&rest));
    }
    lines.join("\n")
}

/// A confirm's detail: what ends, then that closing `what` ends it.
fn close_detail(endings: &[Ending], what: &str) -> String {
    format!("{}\n\nClosing the {what} ends {}.", endings_summary(endings), if endings.len() == 1 { "it" } else { "them" })
}

/// An agent working, or a program other than the shell in front (an agent
/// between turns isn't, even started from a shell).
fn busy(rec: &Value) -> bool {
    let program = |k: &str| rec["program"][k].as_bool() == Some(true);
    rec["status"] == "working" || !(program("shell") || program("agent"))
}

/// Whether to ask a terminal's folder for its repo and branch again: only when
/// the answer could have changed. It moved, a command or an agent's turn just
/// ended there (a checkout, a commit), or a repo's fallback is due.
fn recheck(last: Option<&FolderCheck>, cwd: &str, busy: bool, active: bool) -> bool {
    let Some(last) = last else { return true };
    last.cwd != cwd || (last.busy && !busy) || (active && last.repo && last.at.elapsed() > FOLDER_FALLBACK)
}

/// Set once the app starts quitting, the OS ending the session included: the
/// saved layout stays as it was.
pub static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The repo a folder is in (a worktree counts as its main checkout's), else the
/// folder itself, and the branch; and whether it is a repo (or git couldn't say).
fn folder_info(cwd: &str, home: &str, on: Option<&str>) -> (model::FolderInfo, bool) {
    let none = model::FolderInfo { top: cwd.into(), branch: None };
    if on.is_none() && cwd == home {
        return (none, false);
    }
    let args = ["-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"].map(str::to_owned);
    let ran = match on {
        Some(m) => mods::run_remote(m, "git", &args, None).ok().map(|(code, out, err)| (code == 0, out, err)),
        None => crate::spawn::command("git").args(&args).output().ok().map(|o| (o.status.success(), o.stdout, o.stderr)),
    };
    let Some((true, out, _)) = ran else {
        // Only git's own "no" means no repo; a failed run, a repo without commits
        // or one git won't read are asked again.
        let no = ran.is_some_and(|(_, _, err)| String::from_utf8_lossy(&err).to_lowercase().contains("not a git repository"));
        return (none, !no);
    };
    let out: Vec<String> = String::from_utf8_lossy(&out).lines().map(str::to_owned).collect();
    let [top, head] = out.as_slice() else { return (none, true) };
    let branch = (head != "HEAD").then(|| head.clone());
    (model::FolderInfo { top: top.clone(), branch }, true)
}

fn terminal_block<'a>(chrome: &'a Node, focused: Option<&str>) -> Option<&'a Node> {
    let id = focused?;
    chrome.visible_blocks().into_iter().find(|n| n.id == id && n.terminal().is_some())
}

/// The terminal block `id` in a window's layout (an overlay with blocks).
fn overlay_terminal_block<'a>(overlays: &'a [Overlay], id: Option<&str>) -> Option<&'a Node> {
    let id = id?;
    overlays.iter().filter_map(|o| o.layout.as_ref()).find_map(|l| l.visible_blocks().into_iter().find(|n| n.id == id && n.terminal().is_some()))
}

#[derive(Debug, PartialEq)]
enum SwapBy<'a> {
    Direction(&'a str),
    Target(&'a str),
}

fn swap_with_neighbor(model: &mut Model, from: &str, explicit: bool, neighbor: Option<String>) -> Result<(), String> {
    if explicit && model.tab_of(from).and_then(|c| c.root.find(from)).is_none_or(|n| !n.is_pane()) {
        return Err(format!("no pane {from:?}"));
    }
    let shown = model.active_tab().is_some_and(|c| c.shown().visible_blocks().iter().any(|n| n.id == from));
    if explicit && !shown {
        return Err(format!("pane.swap direction needs a pane in the shown tab, not {from:?}"));
    }
    if let Some(to) = neighbor
        && let Some(ctx) = model.tab_of(from).map(|c| c.id.clone())
        && let Some(c) = model.tab_mut(&ctx)
    {
        c.root.swap(from, &to);
    }
    Ok(())
}

fn swap_by(args: &Value) -> Result<SwapBy<'_>, String> {
    if args.get("direction").is_some_and(|d| !d.is_string() && !d.is_null()) {
        return Err("pane.swap direction must be a string (or null to omit it)".into());
    }
    match (AppWindow::arg(args, "direction"), AppWindow::arg(args, "target")) {
        (Some(_), Some(_)) => Err("pane.swap takes direction or target, not both".into()),
        (None, None) => Err("pane.swap needs direction or target".into()),
        (None, Some(target)) => Ok(SwapBy::Target(target)),
        (Some(dir @ ("left" | "right" | "up" | "down")), None) => Ok(SwapBy::Direction(dir)),
        (Some(dir), None) => Err(format!("pane.swap direction is left, right, up or down, not {dir:?}")),
    }
}

/// `pane.split {edge}`: which side of the tab.
fn split_edge(edge: &str) -> Option<crate::layout::Edge> {
    use crate::layout::Edge;
    Some(match edge {
        "right" => Edge::Right,
        "left" => Edge::Left,
        "top" => Edge::Top,
        "bottom" => Edge::Bottom,
        _ => return None,
    })
}

/// The mod a web link opens in (`open_link`).
const WEB_MOD: &str = "nocturne-browser";

/// Whether a web link opens in the app's web pane (true) or the system's
/// Where a terminal's link to a file goes: Markdown and what the preview shows
/// open in the editor (when its mod is there) as a tab to look at (`true`):
/// Markdown in the editor's view for it, a picture or a PDF drawn by the preview's viewer.
fn editor_takes(viewer: Viewer, editor: bool) -> (Viewer, bool) {
    match viewer {
        Viewer::Markdown | Viewer::Preview if editor => (Viewer::Editor, true),
        other => (other, false),
    }
}

/// The editor pane of a tab that takes a file as a new tab: among `eds` (an
/// editor's pane id and props, in the tab's order) on machine `on`, the one
/// whose slot is `last` (it last had the keyboard), else the first; never a
/// scratchpad's (its note, under `notes`, keeps its pane). -> (pane, slot).
fn tab_editor(eds: &[(String, Value)], on: Option<&str>, last: Option<&str>, notes: &std::path::Path) -> Option<(String, String)> {
    let notes = format!("{}/", notes.to_string_lossy().trim_end_matches('/'));
    let fit: Vec<(String, String)> = eds.iter().filter_map(|(id, props)| {
        let slot = props.get("slot").and_then(Value::as_str)?;
        let here = props.get("on").and_then(Value::as_str).filter(|m| !m.is_empty()) == on;
        let note = props.get("path").and_then(Value::as_str).is_some_and(|p| p.starts_with(&notes));
        (here && !note).then(|| (id.clone(), slot.to_owned()))
    }).collect();
    fit.iter().find(|(_, slot)| Some(slot.as_str()) == last).or(fit.first()).cloned()
}

/// browser: `place` ("app" | "system") over the `links` setting, and never in
/// the app without a web pane. Not a web page: an error.
fn link_in_app(url: &str, place: Option<&str>, links: settings::Links, web_pane: bool) -> Result<bool, String> {
    if !crate::links::is_web(url) {
        return Err(format!("not a web address (http or https with a host): {url:?}"));
    }
    let in_app = match place {
        None => links == settings::Links::App,
        Some("app") => true,
        Some("system") => false,
        Some(other) => return Err(format!("in is \"app\" or \"system\", not {other:?}")),
    };
    Ok(in_app && web_pane)
}

/// Each web pane's own `slot`, so its page and zoom are kept apart from the others'.
fn web_slot() -> String {
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    format!("link-{nanos:x}")
}

fn needs_model_pane(name: &str, args: &Value) -> bool {
    match name {
        // An edge split goes by the tab, not a pane.
        "pane.split" => AppWindow::arg(args, "pane").is_none() && args.get("edge").is_none_or(Value::is_null),
        "pane.close" | "pane.zoom" | "pane.swap" | "pane.equalize" | "pane.resize" | "pane.park" | "pane.font_bigger" | "pane.font_smaller" | "pane.font_reset" | "pane.float" | "terminal.show" => {
            AppWindow::arg(args, "pane").is_none()
        }
        "pane.go" => true,
        "terminal.open" | "terminal.keep" => {
            AppWindow::arg(args, "pane").is_none() && AppWindow::arg(args, "place").and_then(model::Direction::parse).is_some()
        }
        _ => false,
    }
}

/// A failed implicit folder gets one retry in the machine's home, without local probes.
fn run_following_folder(mut folder: String, follow: bool, on: Option<&str>, mut run: impl FnMut(Option<String>) -> anyhow::Result<String>) -> anyhow::Result<(String, String)> {
    let result = run(Some(folder.clone()).filter(|f| !f.is_empty()));
    let address = match result {
        // A missing folder and a missing program both report spawn_failed. The holder's
        // timeout may still create a terminal, so never retry that ambiguous outcome.
        Err(e) if follow && !folder.is_empty() && crate::hc::error_kind(&e) == Some("spawn_failed") && !format!("{e:#}").contains("the holder did not answer") => {
            folder = if on.is_some() { String::new() } else { home() };
            run(Some(folder.clone()).filter(|f| !f.is_empty()))?
        }
        result => result?,
    };
    Ok((address, folder))
}

fn new_space_machine(args: &Value, person: bool, model: &Model) -> Option<String> {
    args.get("machine").and_then(Value::as_str)
        .or_else(|| if person { model.active_space().and_then(|s| s.machine.as_deref()) } else { None })
        .filter(|m| !m.is_empty()).map(str::to_owned)
}

fn home() -> String {
    mods::home().to_string_lossy().into_owned()
}

fn mod_overlay(dir: &std::path::Path) -> Value {
    let meta: Value = std::fs::read_to_string(dir.join("mod.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    meta.get("overlay").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}))
}

/// The shipped screens a layout's `dialog_mods` can draw instead, opened by
/// their mod's name (by the app or by any mod): the screen's key there.
/// The prompt, confirm and palette are chosen where they open (`skin_dialog`).
fn dialog_screen(shipped: &str) -> Option<&'static str> {
    Some(match shipped {
        "frame-welcome" => "welcome",
        "frame-whatsnew" => "whats_new",
        "help" => "help",
        "worktree" => "worktree",
        "machine-add" => "machine_add",
        _ => return None,
    })
}

fn terminal_menu_spec(name: &str, defaults: &Value, tab: &str, target: Value) -> Value {
    json!({ "mod": name, "kind": "popup",
        "width": defaults.get("width").and_then(Value::as_f64).unwrap_or(220.0),
        "height": defaults.get("height").and_then(Value::as_f64).unwrap_or(260.0),
        "props": { "tab": tab, "target": target } })
}

fn num_in(v: &Value, k: &str) -> f32 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32
}

/// A floating mod's slot and copy (it's told its float id). `visible` and
/// `owned_mods` must build the same, or a kept copy is dropped.
fn float_mod(id: &str, name: &str, props: &Value) -> (String, Instance) {
    let mut props = if props.is_object() { props.clone() } else { json!({}) };
    props["float"] = json!(id);
    (floats::slot(id), Instance { name: name.to_owned(), props })
}

/// A pane header's slot and copy, told which pane it sits on (a mod pane has no terminal).
fn pane_header_mod(n: &Node, name: &str, props: &Value) -> (String, Instance) {
    let mut props = if props.is_object() { props.clone() } else { json!({}) };
    props["pane"] = json!(n.id);
    props["terminal"] = json!(n.terminal());
    (format!("{}#frame", n.id), Instance { name: name.to_owned(), props })
}

/// Every node shown on screen (hidden ones and inactive stack children skipped).
fn visible_nodes(n: &Node) -> Vec<&Node> {
    if n.hidden {
        return vec![];
    }
    let mut out = vec![n];
    match &n.kind {
        Kind::Stack { .. } => {
            if let Some(c) = n.active_child() {
                out.extend(visible_nodes(c));
            }
        }
        _ => {
            for c in n.children() {
                out.extend(visible_nodes(c));
            }
        }
    }
    out
}

fn fill_ids(n: &mut Node, m: &mut Model) {
    n.fill_ids(&mut || m.fresh_id("n"));
}

/// Puts a block along one side of the chrome.
fn dock(root: &mut Node, block: Node, place: &str, wrapper_id: String) {
    let axis = if matches!(place, "top" | "bottom") { Axis::Column } else { Axis::Row };
    let first = matches!(place, "left" | "top");
    if root.axis() == Some(axis) {
        let c = root.children_mut().unwrap();
        if first { c.insert(0, block) } else { c.push(block) }
        return;
    }
    let mut old = std::mem::replace(root, Node::new("", Kind::Row { children: vec![] }));
    let toast = old.toast.take();
    let terminal_menu = old.terminal_menu.take();
    let children = if first { vec![block, old] } else { vec![old, block] };
    let mut wrapper = Node::container(wrapper_id, axis, children);
    wrapper.toast = toast;
    wrapper.terminal_menu = terminal_menu;
    wrapper.divider = Some(Line { width: 1.0, color: "border".into() });
    *root = wrapper;
}

fn sized(slot: Div, n: &Node, axis: Axis, total_weight: f32) -> Div {
    let mut slot = slot;
    let row = axis == Axis::Row;
    match n.size {
        Some(Span::Px { px: v }) => {
            slot = slot.flex_none();
            slot = if row { slot.w(settings::z(v)).h_full() } else { slot.h(settings::z(v)).w_full() };
        }
        _ => {
            let w = pane_size::weight(n);
            let s = slot.style();
            s.flex_grow = Some(w / total_weight);
            s.flex_shrink = Some(1.0);
            s.flex_basis = Some(relative(0.).into());
            slot = if row { slot.h_full() } else { slot.w_full() };
        }
    }
    if let Some(min) = n.min {
        slot = if row { slot.min_w(settings::z(min)) } else { slot.min_h(settings::z(min)) };
    }
    if let Some(max) = n.max {
        slot = if row { slot.max_w(settings::z(max)) } else { slot.max_h(settings::z(max)) };
    }
    slot
}

/// What a terminal runs now (core's `foreground`), else what it started with.
fn running_argv(rec: &serde_json::Map<String, Value>) -> Option<&Value> {
    rec.get("foreground").and_then(|f| f.get("argv")).filter(|a| a.as_array().is_some_and(|a| !a.is_empty())).or_else(|| rec.get("argv"))
}

/// Whether the core's record still puts a terminal in this space and tab and
/// it still runs. A listing taken just before it ended still shows it running,
/// and labels outlive the program: putting it back would show a dead pane.
fn adoptable(record: &Value, space: &str, tab: Option<&str>, machine: Option<&str>) -> bool {
    let label = record.pointer("/labels/herdr.space").and_then(Value::as_str);
    let labeled_tab = record.pointer("/labels/herdr.tab").and_then(Value::as_str).filter(|s| !s.is_empty());
    record["state"] == "live"
        && label == Some(crate::mirror::local(space, machine))
        && labeled_tab == tab.map(|t| crate::mirror::local(t, machine))
}

/// A program's name as `terminals()` gives it (`program.name`), else "shell".
fn program_name(app: Option<&str>, argv: &[String]) -> String {
    crate::programs::of(app, argv).get("name").and_then(Value::as_str).filter(|n| !n.is_empty()).unwrap_or("shell").to_owned()
}

fn program_of(report: &Value, argv: Option<&Value>) -> Value {
    let app = report.get("app").and_then(Value::as_str);
    let argv: Vec<String> = argv.and_then(Value::as_array).into_iter().flatten().filter_map(|a| a.as_str().map(str::to_owned)).collect();
    crate::programs::of(app, &argv)
}

fn apply_look(el: Div, n: &Node, focused: bool) -> Div {
    let mut el = el;
    let focus = n.focus.as_ref().filter(|_| focused);
    if let Some(bg) = focus.and_then(|f| f.background.as_ref()) {
        el = el.bg(c(bg));
    } else if let Some(bg) = &n.background {
        el = paint(el, bg);
    }
    if let Some(line) = pane_size::node_border(n, focused) {
        el = el.border(settings::z(line.width)).border_color(c(&line.color));
    }
    if let Some(r) = n.radius {
        el = el.rounded(settings::z(r));
    }
    if n.padding.is_some() {
        let (y, x) = pane_size::padding(n);
        el = el.py(settings::z(y)).px(settings::z(x));
    }
    shadow(el, n.shadow.as_deref())
}

/// A color or gradient paints the element; an image is a layer behind
/// whatever comes after it (call before adding content).
fn paint(el: Div, bg: &Paint) -> Div {
    match bg {
        Paint::Color(name) => el.bg(c(name)),
        Paint::Gradient { gradient: [a, b], angle } => el.bg(linear_gradient(*angle, linear_color_stop(c(a), 0.), linear_color_stop(c(b), 1.))),
        Paint::Image { image, fit } => {
            let fit = match fit {
                Fit::Cover => ObjectFit::Cover,
                Fit::Contain => ObjectFit::Contain,
            };
            el.child(img(mods::app_dir().join(image)).absolute().top_0().left_0().size_full().object_fit(fit))
        }
    }
}

fn shadow(el: Div, s: Option<&str>) -> Div {
    match s {
        Some("sm") => el.shadow_sm(),
        Some("md") => el.shadow_md(),
        Some("lg") => el.shadow_lg(),
        _ => el,
    }
}

impl Render for AppWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::bench::count(&crate::bench::WINDOW);
        let _timed = crate::bench::timed(&crate::bench::WINDOW_US);
        crate::bench::frame_start();
        crate::terminal::next_frame();
        window.set_rem_size(px(settings::ui_font_size()));
        gpui::set_square_corners(self.chrome.corners == Some(crate::layout::CornerStyle::Square));
        // The keyboard behind a window with a scrim: taken back once this frame is drawn.
        let astray = self.keys_astray(window, cx);
        if astray {
            cx.defer_in(window, |this, window, cx| {
                this.take_back_keys(window, cx);
            });
        }
        // A terminal the person clicked into becomes the focused pane (not one
        // that took the keyboard behind a window with a scrim).
        let clicked = self
            .terms
            .iter()
            .find(|(_, t)| t.focus.is_focused(window))
            .map(|(id, _)| id.clone())
            .filter(|_| !astray);
        if clicked.is_some() && self.focused_block.take().is_some() {
            self.publish(cx);
        }
        // A window's terminal with the keyboard is what focused() reports; the pane under it stays.
        let in_window = overlay_terminal_block(&self.overlays, clicked.as_deref()).map(|n| n.id.clone());
        if in_window != self.window_terminal {
            self.window_terminal = in_window;
            self.publish(cx);
        }
        if let Some(id) = clicked
            && self.focused_pane.as_deref() != Some(id.as_str())
            && (self.model.tab_of(&id).is_some() || terminal_block(&self.chrome, Some(&id)).is_some())
        {
            self.model.focus_pane(&id);
            self.focused_pane = Some(id);
            self.synced_model_pane = self.model.focused_pane();
            self.publish(cx);
        }
        self.tick_floats(window);
        self.apply_titlebar(window);
        if mods::publish_window(self.window_json(window)) {
            self.refresh_snapshot_mods(cx);
        }
        let focused = self.focused_path(window, cx);
        let tree = self.render_node(&self.chrome, &focused, None, cx);
        let tree = self.window_frame(tree, window, cx);
        let overlays = self.render_overlays(window.viewport_size(), window.scale_factor(), cx);
        let tracker = self.float_tracker(cx);
        let win_tracker = self.window_tracker(cx);
        let pane_drag = self.pane_drag_layer(cx);
        div()
            .id("herdr")
            .track_focus(&self.focus)
            // `layout:<name>` key sections apply while that layout shows.
            .key_context(format!("Herdr layout = {}", self.layout_name).as_str())
            .size_full()
            .relative()
            .bg(c("background"))
            .text_color(c("foreground"))
            .font_family(settings::get().ui_font_family.clone())
            .on_action(cx.listener(|this, a: &ShellAction, w, cx| {
                // Nothing selected: the copy chord goes to the program (#216).
                if a.id() == "terminal.copy" {
                    if !this.copy_key(w, cx) {
                        cx.propagate();
                    }
                    return;
                }
                this.run_action(a.id(), w, cx);
            }))
            .on_action(cx.listener(|this, a: &crate::keys::CommandBinding, w, cx| {
                match a.command() {
                    Ok((name, args)) => {
                        #[cfg(target_os = "macos")]
                        if let Some(action) = crate::macos::action(&name) {
                            w.dispatch_action(action, cx);
                            return;
                        }
                        this.run_key(&name, args, w, cx);
                    }
                    Err(error) => this.command_error("Key binding", &error, w, cx),
                }
            }))
            // Ctrl (Cmd) alone shows links in the pane under the pointer, focused or not.
            .on_modifiers_changed(cx.listener(|this, _: &ModifiersChangedEvent, _, cx| {
                for t in this.terms.values() {
                    if t.view.read(cx).hovered() {
                        t.view.update(cx, |_, cx| cx.notify());
                    }
                }
            }))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, window, cx| {
                this.on_local_input(cx);
                // A key may show another tab: its terminals get our size back once shown.
                cx.defer_in(window, |this, _, cx| this.reclaim_sizes(cx));
                if ev.keystroke.key == "escape" && this.pane_drag.is_some() {
                    this.cancel_pane_drag(cx);
                    cx.stop_propagation();
                }
            }))
            .capture_any_mouse_down(cx.listener(|this, ev: &MouseDownEvent, window, cx| {
                this.pointer = ev.position;
                this.on_local_input(cx);
                cx.defer_in(window, |this, _, cx| this.reclaim_sizes(cx));
            }))
            .on_mouse_move(cx.listener(|this, ev: &MouseMoveEvent, window, cx| {
                this.on_local_input(cx);
                this.drag_window(ev, window);
                if this.drag.is_none() {
                    return;
                }
                if ev.pressed_button != Some(MouseButton::Left) {
                    this.drag = None;
                    this.save();
                    this.publish(cx);
                    return;
                }
                this.drag_to(ev.position);
                cx.notify();
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, window, cx| {
                this.drag_from = None;
                if this.drag.take().is_some() {
                    this.save();
                    // Mods see the new sizes (the sidebar picks its rail by width).
                    this.publish(cx);
                    this.flush_documents(false, window, cx);
                }
            }))
            .child(crate::native_view::layer(0))
            .child(tree)
            .children(overlays)
            .children(tracker)
            .children(win_tracker)
            .child(pane_drag)
            .child(crate::bench::frame_end())
            // HUP: native views follow their elements; overlays and floats painted
            // above them cut holes (cover_probe), a backdrop above them dims them,
            // and they step aside while a pane is dragged.
            .child(crate::native_view::frame_end(
                self.copies.values().map(|c| c.id).filter(|id| *id != 0).collect(),
                mods::shown_copies(),
                self.native_layers(),
                self.pane_drag.is_some(),
            ))
    }
}

fn invalidate_asset(path: &std::path::Path, window: &mut Window, cx: &mut gpui::App) {
    let key = gpui_shell::AppAssets::cache_key(&path.to_string_lossy());
    invalidate_image(&gpui::Resource::Embedded(key.clone()), window, cx);
    window.invalidate_svg(&key);
}

fn invalidate_image(resource: &gpui::Resource, window: &mut Window, cx: &mut gpui::App) {
    if let Some(Ok(old)) = cx.cached_asset::<gpui::ImgResourceLoader>(resource) {
        cx.drop_image(old, Some(window));
    }
    cx.remove_asset::<gpui::ImgResourceLoader>(resource);
}

/// The changed paths, plus the files inside changed mod folders (a folder
/// renamed into place arrives as one event). Runs on the UI thread: skips what
/// the watcher ignores (hidden, `node_modules`) and stops at a mod-sized limit.
fn changed_asset_paths(home: &std::path::Path, changed: &[std::path::PathBuf]) -> Vec<std::path::PathBuf> {
    const MAX_FILES: usize = 2000;
    let mut paths: std::collections::BTreeSet<_> = changed.iter().cloned().collect();
    let mut seen = std::collections::HashSet::new();
    let mut pending: Vec<_> = changed.iter().filter(|p| p.starts_with("mods")).cloned().collect();
    while let Some(path) = pending.pop() {
        // Do not follow symlinks out of the mod folder (or into a cycle).
        if !seen.insert(path.clone()) || !home.join(&path).symlink_metadata().is_ok_and(|m| m.is_dir()) { continue; }
        let Ok(entries) = std::fs::read_dir(home.join(&path)) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" { continue; }
            let child = path.join(&*name);
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                pending.push(child);
            } else if paths.len() < MAX_FILES {
                paths.insert(child);
            } else {
                return paths.into_iter().collect();
            }
        }
    }
    paths.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use gpui::{div, point, px, size, Context, IntoElement, Render, TestAppContext, Window};
    use gpui::prelude::*;

    #[test]
    fn going_back_into_a_split_column_takes_its_top_pane_whatever_the_fractions() {
        let r = |x: f32, y: f32, w: f32, h: f32| gpui::Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
        // An odd height splits into halves a fraction apart, the bottom one larger.
        let column = || vec![("top".to_owned(), r(0.0, 0.0, 400.0, 300.4)), ("bottom".to_owned(), r(0.0, 300.4, 400.0, 300.6))];
        assert_eq!(super::nearest(r(401.0, 0.0, 399.0, 601.0), "left", column(), &[]).as_deref(), Some("top"));
        // More overlap by a pixel or more still decides.
        assert_eq!(super::nearest(r(401.0, 250.0, 399.0, 351.0), "left", column(), &[]).as_deref(), Some("bottom"));
        // A visited pane wins even when an unvisited pane has more overlap.
        assert_eq!(super::nearest(r(401.0, 250.0, 399.0, 351.0), "left", column(), &["top".to_owned()]).as_deref(), Some("top"));
    }

    #[test]
    fn directional_round_trips_return_to_the_recent_pane_in_either_split() {
        let r = |x: f32, y: f32, w: f32, h: f32| gpui::Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
        for (a, b, other, out, back) in [
            (r(0.0, 0.0, 400.0, 300.4), r(0.0, 300.4, 400.0, 300.6), r(401.0, 0.0, 399.0, 601.0), "right", "left"),
            (r(0.0, 0.0, 300.4, 400.0), r(300.4, 0.0, 300.6, 400.0), r(0.0, 401.0, 601.0, 399.0), "down", "up"),
        ] {
            let split = || vec![("a".to_owned(), a), ("b".to_owned(), b)];
            assert_eq!(super::nearest(other, back, split(), &[]).as_deref(), Some("a"));
            let mut history = Vec::new();
            for (id, bounds) in [("a", a), ("b", b), ("a", a)] {
                super::remember_pane(&mut history, id);
                assert_eq!(super::nearest(bounds, out, vec![("other".to_owned(), other)], &history).as_deref(), Some("other"));
                super::remember_pane(&mut history, "other");
                assert_eq!(super::nearest(other, back, split(), &history).as_deref(), Some(id));
                super::remember_pane(&mut history, id);
            }
            assert_eq!(history.len(), 3);
            // Recency cannot select a pane outside the requested direction.
            assert_eq!(super::nearest(other, out, split(), &history), None);
        }
    }

    #[test]
    fn terminal_folders_retry_only_definite_spawn_failures_in_home() {
        let failed = |message| anyhow::Error::new(crate::hc::RpcError(serde_json::json!({"message": message, "data": {"kind": "spawn_failed"}})));
        let mut folders = Vec::new();
        let result = super::run_following_folder("deleted".into(), true, None, |folder| {
            folders.push(folder.clone());
            if folder.as_deref() == Some("deleted") { Err(failed("invalid directory")) } else { Ok("t2".into()) }
        }).unwrap();
        assert_eq!(folders, vec![Some("deleted".into()), Some(super::home())]);
        assert_eq!(result, ("t2".into(), super::home()));
        let result = super::run_following_folder("/remote/deleted".into(), true, Some("remote"), |folder| {
            if folder.is_some() { Err(failed("invalid directory")) } else { Ok("remote/t2".into()) }
        }).unwrap();
        assert_eq!(result, ("remote/t2".into(), String::new()));
        for (follow, folder, message) in [(false, "explicit", "invalid directory"), (true, "", "invalid directory"), (true, "inherited", "the holder did not answer")] {
            let mut calls = 0;
            assert!(super::run_following_folder(folder.into(), follow, None, |_| { calls += 1; Err(failed(message)) }).is_err());
            assert_eq!(calls, 1);
        }
        let mut calls = 0;
        assert!(super::run_following_folder("inherited".into(), true, None, |_| { calls += 1; Err(anyhow::anyhow!("lost the core")) }).is_err());
        assert_eq!(calls, 1);
        let mut calls = 0;
        let result = super::run_following_folder("existing".into(), true, None, |_| { calls += 1; Ok("t1".into()) }).unwrap();
        assert_eq!(calls, 1);
        assert_eq!(result, ("t1".into(), "existing".into()));
        let mut calls = 0;
        let error = super::run_following_folder("deleted".into(), true, None, |_| { calls += 1; Err(failed(if calls == 1 { "first" } else { "second" })) }).unwrap_err();
        assert_eq!(calls, 2);
        assert!(error.to_string().contains("second"));
    }

    #[test]
    fn new_spaces_follow_the_persons_active_machine_but_keep_explicit_targets() {
        use serde_json::json;
        let mut model = crate::model::Model::default();
        assert_eq!(super::new_space_machine(&json!({}), true, &model), None);
        model.add_space("remote", "", "", crate::model::Tab::new("tab", "", "pane", "second/t1"));
        model.space_mut("remote").unwrap().machine = Some("second".into());
        for args in [json!({}), json!({"machine": null})] {
            assert_eq!(super::new_space_machine(&args, true, &model).as_deref(), Some("second"));
            assert_eq!(super::new_space_machine(&args, false, &model), None);
        }
        for person in [true, false] {
            assert_eq!(super::new_space_machine(&json!({"machine": "other"}), person, &model).as_deref(), Some("other"));
            assert_eq!(super::new_space_machine(&json!({"machine": ""}), person, &model), None);
        }
        model.add_space("local", "", "", crate::model::Tab::new("local-tab", "", "local-pane", "t1"));
        assert_eq!(super::new_space_machine(&json!({}), true, &model), None);
        model.active = Some("remote".into());
        assert_eq!(super::new_space_machine(&json!({}), true, &model).as_deref(), Some("second"));
    }

    #[test]
    fn only_windows_and_popups_asking_for_it_get_a_scrim() {
        use super::{OverlayKind, window_scrim};
        use serde_json::json;
        assert!(window_scrim(OverlayKind::Window, &json!({ "scrim": true })));
        assert!(!window_scrim(OverlayKind::Window, &json!({})));
        assert!(!window_scrim(OverlayKind::Window, &json!({ "scrim": "yes" })));
        // A modal popup (the palette) may ask; one hanging from a button doesn't.
        assert!(window_scrim(OverlayKind::Popup, &json!({ "scrim": true })));
        assert!(!window_scrim(OverlayKind::Popup, &json!({})));
        assert!(!window_scrim(OverlayKind::Toast, &json!({ "scrim": true })));
    }

    #[test]
    fn the_palette_sits_on_the_scrim_where_the_layout_has_one() {
        use serde_json::json;
        assert_eq!(super::palette_spec(true)["scrim"], json!(true));
        assert!(super::palette_spec(false).get("scrim").is_none());
        assert_eq!(super::palette_spec(false)["kind"], json!("popup"));
    }

    #[gpui::test]
    fn image_invalidation_drops_cached_atlas_tiles_without_loading_missing_assets(cx: &mut TestAppContext) {
        use gpui::{ImgResourceLoader, Resource};
        let temp = if cfg!(target_os = "linux") { std::path::PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let home = temp.join(format!("herdr-image-atlas-test-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let file = home.join("image.gif");
        let mut encoder = image::codecs::gif::GifEncoder::new(std::fs::File::create(&file).unwrap());
        for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
            encoder.encode_frame(image::Frame::new(image::RgbaImage::from_pixel(2, 2, image::Rgba(color)))).unwrap();
        }
        drop(encoder);
        let resource = Resource::Path(file.into());
        cx.update(|cx| { cx.fetch_asset::<ImgResourceLoader>(&resource); });
        cx.background_executor.run_until_parked();
        let old = cx.update(|cx| cx.cached_asset::<ImgResourceLoader>(&resource)).unwrap().unwrap();
        let context = cx.add_empty_window();
        let displayed = old.clone();
        assert_eq!(old.frame_count(), 1);
        context.draw(point(px(0.0), px(0.0)), size(px(20.0), px(20.0)), move |_, _| {
            gpui::canvas(|_, _, _| (), move |bounds, _, window, _| {
                for frame in 0..displayed.frame_count() {
                    window.paint_image(bounds, bounds, gpui::Corners::default(), displayed.clone(), frame, false).unwrap();
                }
            }).size_full()
        });
        context.update(|window, cx| {
            assert!(window.has_image_atlas_entry(&old));
            super::invalidate_image(&resource, window, cx);
            assert!(!window.has_image_atlas_entry(&old));
            assert!(!cx.has_asset::<ImgResourceLoader>(&resource));
            let missing = Resource::Embedded("mods/missing.png".into());
            super::invalidate_image(&missing, window, cx);
            assert!(!cx.has_asset::<ImgResourceLoader>(&missing));
        });
        std::fs::remove_dir_all(home).unwrap();
    }

    #[gpui::test]
    fn still_image_cache_is_bounded_and_avoids_repeat_downloads(cx: &mut TestAppContext) {
        use gpui::{ImgResourceLoader, Resource, http_client::{AsyncBody, FakeHttpClient, Response}};
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]))
            .write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let bytes = bytes.into_inner();
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        cx.update(|cx| cx.set_http_client(FakeHttpClient::create(move |_| {
            count.fetch_add(1, Ordering::SeqCst);
            let bytes = bytes.clone();
            async move { Ok(Response::builder().status(200).body(AsyncBody::from(bytes)).unwrap()) }
        })));
        let context = cx.add_empty_window();
        context.deactivate_window();
        let sources: Vec<_> = (0..130).map(|id| Resource::Uri(format!("http://images.test/{id}.png").into())).collect();
        for source in &sources {
            context.update(|_, cx| { cx.fetch_asset::<ImgResourceLoader>(source); });
            context.run_until_parked();
        }
        context.update(|window, cx| { window.draw(cx).clear(cx); });
        assert_eq!(context.update(|_, cx| sources.iter().filter(|source| cx.has_asset::<ImgResourceLoader>(source)).count()), 128);
        let retained = sources.last().unwrap();
        assert!(context.update(|_, cx| cx.fetch_asset::<ImgResourceLoader>(retained)).unwrap().is_ok());
        assert_eq!(requests.load(Ordering::SeqCst), 130);
        assert!(!context.update(|_, cx| cx.has_asset::<ImgResourceLoader>(&sources[0])));
        context.update(|window, cx| {
            cx.set_quit_mode(gpui::QuitMode::Explicit);
            window.remove_window();
        });
    }

    #[gpui::test]
    fn closing_last_window_releases_many_animation_sources_in_one_call(cx: &mut TestAppContext) {
        use gpui::{ImgResourceLoader, Resource, img};
        use std::sync::Arc;
        struct Images(Vec<Resource>);
        impl Render for Images {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().children(self.0.iter().enumerate().map(|(id, source)| {
                    img(gpui::ImageSource::Resource(source.clone())).id(id).size_4()
                }))
            }
        }
        let mut gif = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
            for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
                encoder.encode_frame(image::Frame::new(image::RgbaImage::from_pixel(2, 2, image::Rgba(color)))).unwrap();
            }
        }
        let temp = if cfg!(target_os = "linux") { std::path::PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let dir = temp.join(format!("herdr-many-images-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sources: Vec<_> = (0..24).map(|id| {
            let path = dir.join(format!("{id}.gif"));
            std::fs::write(&path, &gif).unwrap();
            Resource::Path(path.into())
        }).collect();
        let (_, context) = cx.add_window_view(|_, _| Images(sources.clone()));
        context.deactivate_window();
        context.run_until_parked();
        let mut images = context.update(|window, _| window.displayed_images());
        assert_eq!(images.iter().filter(|image| image.frame_count() == 2).count(), 24);
        images.extend(context.update(|_, cx| sources.iter().map(|source| cx.cached_asset::<ImgResourceLoader>(source).unwrap().unwrap()).collect::<Vec<_>>()));
        let weak: Vec<_> = images.iter().map(Arc::downgrade).collect();
        drop(images);
        context.update(|window, cx| {
            cx.set_quit_mode(gpui::QuitMode::Explicit);
            window.remove_window();
        });
        assert!(weak.iter().all(|image| image.upgrade().is_none()), "one close must release every animation and its source regardless of hash order");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[gpui::test]
    fn image_tiles_wait_for_both_scenes_before_retiring(cx: &mut TestAppContext) {
        use std::sync::Arc;
        let context = cx.add_empty_window();
        let image = Arc::new(gpui::RenderImage::new((0..3).map(|red| {
            image::Frame::new(image::RgbaImage::from_pixel(2, 2, image::Rgba([red, 0, 0, 255])))
        }).collect::<smallvec::SmallVec<[_; 1]>>()));
        for frame in 0..3 {
            let painted = image.clone();
            context.draw(point(px(0.), px(0.)), size(px(20.), px(20.)), move |_, _| {
                gpui::canvas(|_, _, _| (), move |bounds, _, window, _| {
                    window.paint_image(bounds, bounds, gpui::Corners::default(), painted.clone(), frame, false).unwrap();
                }).size_full()
            });
            for previous in 0..=frame {
                assert_eq!(context.update(|window, _| window.has_image_frame_atlas_entry(&image, previous)), previous + 1 >= frame);
            }
        }
    }

    #[gpui::test]
    fn clipped_images_do_not_upload(cx: &mut TestAppContext) {
        use std::sync::Arc;
        let context = cx.add_empty_window();
        let image = Arc::new(gpui::RenderImage::new(smallvec::smallvec![
            image::Frame::new(image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255])))
        ]));
        for mask in [
            gpui::Bounds::new(point(px(50.), px(50.)), size(px(10.), px(10.))),
            gpui::Bounds::new(point(px(0.), px(0.)), size(px(0.), px(0.))),
        ] {
            for _ in 0..2 {
                let painted = image.clone();
                context.draw(point(px(0.), px(0.)), size(px(20.), px(20.)), move |_, _| {
                    gpui::canvas(|_, _, _| (), move |bounds, _, window, _| {
                        window.with_content_mask(Some(gpui::ContentMask { bounds: mask }), |window| {
                            window.paint_image(bounds, bounds, gpui::Corners::default(), painted.clone(), 0, false).unwrap();
                        });
                    }).size_full()
                });
                assert!(!context.update(|window, _| window.has_image_frame_atlas_entry(&image, 0)));
            }
        }
        let painted = image.clone();
        context.draw(point(px(0.), px(0.)), size(px(20.), px(20.)), move |_, _| {
            gpui::canvas(|_, _, _| (), move |bounds, _, window, _| {
                window.paint_image(bounds, bounds, gpui::Corners::default(), painted.clone(), 0, false).unwrap();
            }).size_full()
        });
        assert!(context.update(|window, _| window.has_image_frame_atlas_entry(&image, 0)));
    }

    #[gpui::test]
    fn background_images_stay_warm_and_release_animations(cx: &mut TestAppContext) {
        use gpui::{AssetSource as _, ImgResourceLoader, Resource, img};
        use std::sync::Arc;
        struct ImageProbe { source: Option<Resource>, animate: bool }
        impl Render for ImageProbe {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let mut element = div().size_full();
                if let Some(source) = &self.source {
                    element = element.child(img(gpui::ImageSource::Resource(source.clone())).size_4());
                    if self.animate {
                        element = element.child(img(gpui::ImageSource::Resource(source.clone())).id("animated").size_4());
                    }
                }
                element
            }
        }
        let temp = if cfg!(target_os = "linux") { std::path::PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let home = temp.join(format!("herdr-image-release-test-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let gif = home.join("animated.gif");
        let png = home.join("still.png");
        let mut encoder = image::codecs::gif::GifEncoder::new(std::fs::File::create(&gif).unwrap());
        for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
            encoder.encode_frame(image::Frame::new(image::RgbaImage::from_pixel(2, 2, image::Rgba(color)))).unwrap();
        }
        drop(encoder);
        image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255])).save(&png).unwrap();
        let assets = gpui_shell::AppAssets::new(home.clone());
        assert_eq!(
            assets.image_resource(&Resource::Path(gif.clone().into())),
            Resource::Path(gif.clone().into())
        );
        let (view, cx) = cx.add_window_view(|_, _| ImageProbe { source: None, animate: false });
        cx.deactivate_window();
        for file in [&gif, &png, &gif] {
            let resource = Resource::Path(file.clone().into());
            view.update(cx, |view, cx| { view.source = Some(resource.clone()); cx.notify(); });
            cx.run_until_parked();
            let image = cx.update(|_, cx| cx.cached_asset::<ImgResourceLoader>(&resource)).unwrap().unwrap();
            assert_eq!(image.frame_count(), 1);
            assert_eq!(&image.as_bytes(0).unwrap()[..4], &[0, 0, 255, 255]);
            assert!(cx.update(|window, _| window.has_image_frame_atlas_entry(&image, 0)));
            if file == &gif {
                view.update(cx, |view, cx| { view.animate = true; cx.notify(); });
                cx.run_until_parked();
                let animation = cx.update(|window, _| window.displayed_images().into_iter().find(|image| image.frame_count() == 2)).unwrap();
                assert_eq!(animation.as_bytes(0).unwrap().as_ptr(), image.as_bytes(0).unwrap().as_ptr());
                let weak_animation = Arc::downgrade(&animation);
                drop(animation);
                view.update(cx, |view, cx| { view.animate = false; cx.notify(); });
                cx.run_until_parked();
                assert!(weak_animation.upgrade().is_none(), "a still background must not keep animation pixels");
                assert!(cx.update(|window, _| window.has_image_frame_atlas_entry(&image, 0)));
            }
            let weak = Arc::downgrade(&image);
            drop(image);
            view.update(cx, |view, cx| { view.source = None; cx.notify(); });
            cx.run_until_parked();
            assert!(weak.upgrade().is_some(), "still pixels stay warm for layout switches");
            view.update(cx, |view, cx| { view.source = Some(resource.clone()); cx.notify(); });
            cx.update(|window, cx| { window.draw(cx).clear(cx); });
            let warm = cx.update(|_, cx| cx.cached_asset::<ImgResourceLoader>(&resource)).unwrap().unwrap();
            assert!(Arc::ptr_eq(&warm, &weak.upgrade().unwrap()));
            assert!(cx.update(|window, _| window.has_image_frame_atlas_entry(&warm, 0)));
            drop(warm);
        }
        // Leave both the source and animation unowned in the same close operation.
        view.update(cx, |view, cx| { view.animate = true; cx.notify(); });
        cx.run_until_parked();
        let images = cx.update(|window, _| window.displayed_images());
        let weak: Vec<_> = images.iter().map(Arc::downgrade).collect();
        assert!(images.iter().any(|image| image.frame_count() == 2));
        drop(images);
        cx.update(|window, cx| {
            cx.set_quit_mode(gpui::QuitMode::Explicit);
            window.remove_window();
        });
        assert!(weak.iter().all(|image| image.upgrade().is_none()), "closing the last window must prune in dependency order without another draw");
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn directory_changes_include_nested_assets() {
        let temp = if cfg!(target_os = "linux") { std::path::PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let home = temp.join(format!("herdr-image-directory-test-{}", std::process::id()));
        std::fs::create_dir_all(home.join("mods/probe/nested")).unwrap();
        std::fs::write(home.join("mods/probe/nested/icon.svg"), "svg").unwrap();
        for ignored in ["node_modules/pkg", ".git"] {
            std::fs::create_dir_all(home.join("mods/probe").join(ignored)).unwrap();
            std::fs::write(home.join("mods/probe").join(ignored).join("logo.svg"), "svg").unwrap();
        }
        let changed = vec![std::path::PathBuf::from("mods/probe")];
        // A repeated root and a covered child are walked once.
        let events = [changed[0].clone(), changed[0].clone(), "mods/probe/nested".into()];
        let paths = super::changed_asset_paths(&home, &events);
        assert!(paths.contains(&std::path::PathBuf::from("mods/probe/nested/icon.svg")));
        assert!(paths.contains(&changed[0]));
        assert!(!paths.iter().any(|p| p.to_string_lossy().contains("node_modules") || p.to_string_lossy().contains(".git")));
        assert_eq!(paths.iter().filter(|p| p.ends_with("icon.svg")).count(), 1);
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(super::changed_asset_paths(&home, &changed), changed);
    }

    #[test]
    fn asset_cache_keys_match_file_events_without_requiring_the_file() {
        use gpui_shell::AppAssets;
        let expected = AppAssets::cache_key("mods/probe/icon.svg");
        for alias in ["./mods/probe/icon.svg", "/mods/probe/icon.svg", "mods//probe/./icon.svg"] {
            assert_eq!(AppAssets::cache_key(alias), expected);
        }
        // Traversal remains invalid, rather than becoming a valid cache hit.
        assert_eq!(AppAssets::cache_key("mods/probe/../icon.svg").as_ref(), "mods/probe/../icon.svg");
        #[cfg(windows)]
        assert_eq!(AppAssets::cache_key(r"mods\probe\icon.svg"), expected);
    }

    #[test]
    fn svg_invalidation_removes_every_size_but_preserves_other_assets() {
        use gpui::{AtlasKey, DevicePixels, HeadlessAtlas, PlatformAtlas, RenderSvgParams, Size};
        let atlas = HeadlessAtlas::default();
        let key = |path: &str, size| AtlasKey::Svg(RenderSvgParams {
            path: path.to_owned().into(), size: Size::new(DevicePixels(size), DevicePixels(size)),
        });
        let keys = [key("icons/icon.svg", 16), key("icons/icon.svg", 32), key("icons/nested/icon.svg", 16), key("icons-other/icon.svg", 16), AtlasKey::Image(gpui::RenderImageParams { image_id: gpui::ImageId(1), frame_index: 0 })];
        let mut build = || Ok(Some((Size::new(DevicePixels(1), DevicePixels(1)), std::borrow::Cow::Borrowed(&[255u8][..]))));
        let tiles: Vec<_> = keys.iter().map(|key| atlas.get_or_insert_with(key.clone(), &mut build).unwrap().unwrap()).collect();
        atlas.remove_svg("icons");
        atlas.remove_svg("icons");
        for (index, key) in keys.iter().enumerate() {
            assert_eq!(atlas.contains(key), index >= 3);
            let tile = atlas.get_or_insert_with(key.clone(), &mut build).unwrap().unwrap();
            assert_eq!(tile == tiles[index], index >= 3);
        }
    }

    #[test]
    fn agent_commands_keep_arguments_out_of_shell_source() {
        let cmd = vec!["agent".to_owned(), "a 'quoted' task; $(not-a-command)\nnext line".to_owned(), "".to_owned()];
        for login in [false, true] {
            for sh in ["/bin/bash", "/bin/zsh", "/bin/sh", "/bin/dash", "/bin/fish"] {
                let run = super::unix_agent_argv(sh.into(), cmd.clone(), login);
                assert_eq!(run[0], sh);
                assert_eq!(run[1], if login { "-lic" } else { "-ic" });
                assert_eq!(run[3], sh);
                assert_eq!(run[4..], cmd);
                let expected = match (sh.ends_with("/fish"), login) {
                    (true, true) => "command $argv[2..]; exec $argv[1] -li",
                    (true, false) => "command $argv[2..]; exec $argv[1] -i",
                    (false, true) => "\"$@\"; exec \"$0\" -li",
                    (false, false) => "\"$@\"; exec \"$0\" -i",
                };
                assert_eq!(run[2], expected);
            }
        }
    }

    #[test]
    fn early_launch_failures_show_exit_code_and_last_output_lines() {
        let mut record = serde_json::json!({"reason":"exited", "exit_code":127, "created_ms":1000, "finished_ms":3000});
        assert_eq!(super::launch_failure(&record, "old\none\ntwo\nthree\nfour\nfive\n\n").as_deref(), Some("Exit code 127\none\ntwo\nthree\nfour\nfive"));
        assert_eq!(super::launch_failure(&record, "").as_deref(), Some("Exit code 127"));
        record["exit_code"] = 0.into();
        assert!(super::launch_failure(&record, "").is_none());
        record["exit_code"] = 1.into();
        record["finished_ms"] = 3001.into();
        assert!(super::launch_failure(&record, "").is_none());
        record["finished_ms"] = 999.into();
        assert!(super::launch_failure(&record, "").is_none());
        record["finished_ms"] = 2000.into();
        record["reason"] = "killed".into();
        assert!(super::launch_failure(&record, "").is_none());
        assert!(super::launch_failure(&serde_json::Value::Null, "").is_none());
    }

    #[gpui::test]
    fn traffic_light_dividers_start_below_the_toolbar(cx: &mut TestAppContext) {
        use std::{cell::Cell, rc::Rc};
        let mut layout: crate::layout::Node = serde_json::from_str(include_str!("../defaults/layouts/main.json")).unwrap();
        let context = cx.add_empty_window();
        for (macos, titlebar, width, zoom, expected) in [
            (true, crate::layout::Titlebar::Layout, 44.0, 1.0, 42.0),
            (true, crate::layout::Titlebar::Layout, 90.0, 0.75, 42.0),
            (true, crate::layout::Titlebar::Layout, 60.0, 1.5, 0.0),
            (true, crate::layout::Titlebar::Layout, 60.0, 1.0, 42.0),
            (true, crate::layout::Titlebar::Layout, 76.0, 1.0, 42.0),
            (true, crate::layout::Titlebar::Layout, 268.0, 1.0, 0.0),
            (false, crate::layout::Titlebar::Layout, 44.0, 1.0, 0.0),
            (true, crate::layout::Titlebar::System, 44.0, 1.0, 0.0),
        ] {
            layout.titlebar = Some(titlebar);
            layout.children_mut().unwrap()[0].size = Some(crate::layout::Size::Px { px: width });
            let top = super::traffic_light_divider_inset(&layout, crate::layout::Axis::Row, 0, macos, zoom);
            assert_eq!(top, expected);
            let bounds = Rc::new(Cell::new(gpui::Bounds::default()));
            let observed = bounds.clone();
            context.draw(point(px(0.0), px(0.0)), size(px(1.0), px(100.0)), move |_, _| {
                div().size_full().relative().flex().items_center().justify_center().child(
                    super::separator_line(true, 1.0, gpui::rgb(0xffffff).into(), top).child(
                        gpui::canvas(move |bounds, _, _| observed.set(bounds), |_, _, _, _| {}).size_full()
                    )
                )
            });
            assert_eq!(bounds.get().origin.y, px(expected));
            assert_eq!(bounds.get().size.height, px(100.0 - expected));
        }
        layout.traffic_lights = None;
        assert_eq!(super::traffic_light_divider_inset(&layout, crate::layout::Axis::Row, 0, true, 1.0), 0.0);
    }

    #[gpui::test]
    fn fitted_popups_use_their_rendered_size_at_the_window_edge(cx: &mut TestAppContext) {
        struct Popup {
            height: f32,
            edge: bool,
        }
        impl Render for Popup {
            fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let viewport = window.viewport_size();
                let at = if self.edge {
                    point(viewport.width - px(40.0), viewport.height - px(40.0))
                } else {
                    point(px(100.0), px(200.0))
                };
                div().size_full().child(super::position_popup(
                    at,
                    div()
                        .id("popup")
                        .debug_selector(|| "popup".into())
                        .w(px(220.0))
                        .max_h(viewport.height * 0.85)
                        .child(div().h(px(self.height))),
                ))
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Popup { height: 72.0, edge: false });
        for (height, edge) in [(72.0, false), (72.0, true), (300.0, true)] {
            view.update(cx, |view, cx| {
                view.height = height;
                view.edge = edge;
                cx.notify();
            });
            cx.run_until_parked();
            let bounds = cx.debug_bounds("popup").unwrap();
            assert_eq!(bounds.size, size(px(220.0), px(height)));
            if edge {
                let viewport = cx.update(|window, _| window.viewport_size());
                assert_eq!(bounds.bottom_right(), point(viewport.width - px(8.0), viewport.height - px(8.0)));
            } else {
                assert_eq!(bounds.origin, point(px(100.0), px(200.0)));
            }
        }
    }

    #[test]
    fn terminal_menu_is_a_root_layout_choice_that_roundtrips() {
        let mut root = super::default_layout("main");
        assert_eq!(root.terminal_menu, None);
        assert!(serde_json::to_value(&root).unwrap().get("terminal_menu").is_none());
        root.terminal_menu = Some("personal-menu".into());
        let restored: super::Node = serde_json::from_value(serde_json::to_value(&root).unwrap()).unwrap();
        assert_eq!(restored.terminal_menu.as_deref(), Some("personal-menu"));
    }

    #[test]
    fn dialog_mods_are_root_layout_choices_that_roundtrip() {
        let mut root = super::default_layout("main");
        assert_eq!((root.prompt_mod.as_deref(), root.confirm_mod.as_deref(), root.palette_mod.as_deref()), (None, None, None));
        let bare = serde_json::to_value(&root).unwrap();
        assert!(bare.get("prompt_mod").is_none() && bare.get("confirm_mod").is_none() && bare.get("palette_mod").is_none());
        root.prompt_mod = Some("my-prompt".into());
        root.confirm_mod = Some("my-confirm".into());
        root.palette_mod = Some("my-palette".into());
        let restored: super::Node = serde_json::from_value(serde_json::to_value(&root).unwrap()).unwrap();
        assert_eq!(restored.prompt_mod.as_deref(), Some("my-prompt"));
        assert_eq!(restored.confirm_mod.as_deref(), Some("my-confirm"));
        assert_eq!(restored.palette_mod.as_deref(), Some("my-palette"));
    }

    #[test]
    fn toast_mod_is_a_root_layout_choice_that_roundtrips() {
        let mut root = super::default_layout("main");
        assert_eq!(root.toast, None);
        assert!(serde_json::to_value(&root).unwrap().get("toast").is_none());
        root.toast = Some("personal-toast".into());
        let restored: super::Node = serde_json::from_value(serde_json::to_value(&root).unwrap()).unwrap();
        assert_eq!(restored.toast.as_deref(), Some("personal-toast"));
        // The fork's older name still reads.
        let old: super::Node = serde_json::from_value(serde_json::json!({"id": "root", "type": "row", "children": [], "toast_mod": "personal-toast"})).unwrap();
        assert_eq!(old.toast.as_deref(), Some("personal-toast"));
    }

    /// Runs `window::tests::<name>` alone in a test process of its own, on a
    /// fresh app home: a window takes process-wide things (the app home, the
    /// mods' request channel) that tests beside it would otherwise share.
    fn in_own_process(name: &str) {
        let home = std::path::PathBuf::from(format!("/var/tmp/herdr-window-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &format!("window::tests::{name}"), "--nocapture", "--test-threads=1"])
            .env("HERDR_APP_HOME", &home)
            .env("HERDR_TEST_WINDOW", name)
            .output()
            .unwrap();
        let _ = std::fs::remove_dir_all(&home);
        let log = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        assert!(out.status.success() && log.contains("1 passed"), "{log}");
    }

    /// In the process `in_own_process` started for `name`: whether to go on.
    fn running_alone(name: &str) -> bool {
        std::env::var("HERDR_TEST_WINDOW").as_deref() == Ok(name)
    }

    /// The window on a core that's never there (`hc::offline`), showing
    /// `layout` with `mod_name` (its `main.js`) in the home, past the first-run
    /// welcome (it lists machines through the core). No other mods: the
    /// shipped ones run programs on threads of their own, which the test
    /// executor refuses.
    fn open_window<'a>(cx: &'a mut gpui::TestAppContext, mod_name: &str, main_js: &str, layout: serde_json::Value) -> (gpui::Entity<super::AppWindow>, &'a mut gpui::VisualTestContext) {
        use serde_json::json;
        let home = crate::mods::app_dir();
        crate::mods::write_workspace().unwrap();
        let folder = home.join("mods").join(mod_name);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("mod.json"), r#"{ "place": "none" }"#).unwrap();
        std::fs::write(folder.join("main.js"), main_js).unwrap();
        std::fs::create_dir_all(home.join("layouts")).unwrap();
        std::fs::write(home.join("layouts/test.json"), layout.to_string()).unwrap();
        cx.update(crate::mods::init);
        let requests = crate::mods::install_policy();
        crate::mods::set_shared("layout".into(), json!("test"));
        crate::mods::set_shared("frame.welcomed".into(), json!("test"));
        let (view, cx) = cx.add_window_view(|window, cx| super::AppWindow::new(crate::hc::offline(), requests, window, cx));
        assert_eq!(view.update(cx, |this, _| this.layout_name.clone()), "test");
        (view, cx)
    }

    #[test]
    fn layout_terminals_survive_stream_loss_until_confirmed_closed() {
        in_own_process("layout_terminal_stream_loss");
    }

    #[gpui::test]
    fn layout_terminal_stream_loss(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("layout_terminal_stream_loss") {
            return;
        }
        let (view, cx) = open_window(cx, "neighbor", "", json!({
            "id": "root", "type": "row", "children": [
                { "id": "left", "type": "column", "children": [
                    { "id": "terminal", "type": "block", "content": { "terminal": "t1" } }
                ] },
                { "id": "right", "type": "column", "children": [
                    { "id": "neighbor", "type": "block", "content": { "mod": "neighbor" } }
                ] }
            ]
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            let saved = |this: &mut super::AppWindow| -> crate::layout::Node {
                this.save();
                serde_json::from_str(&std::fs::read_to_string(super::layout_path("test")).unwrap()).unwrap()
            };
            let original = this.chrome.clone();
            this.terms["terminal"].view.update(cx, |v, _| v.ended = Some("holder_lost".into()));
            this.terminal_ended("terminal", window, cx);
            assert_eq!(this.chrome, original);
            assert_eq!(saved(this), original, "saving while disconnected must retain the slot");
            this.live.insert("t1".into(), json!({"pid": 1, "state": "live"}));
            this.tend_terminals(false, window, cx);
            assert!(this.terms["terminal"].view.read(cx).ended.is_none(), "recovered terminal reattaches");

            let mut closed = original.clone();
            closed.remove_slot("terminal");
            this.terms["terminal"].view.update(cx, |v, _| v.ended = Some("exited".into()));
            this.terminal_ended("terminal", window, cx);
            assert_eq!(this.chrome, closed, "exit removes only the slot");
            assert_eq!(saved(this), closed);

            let error = |kind| Err(crate::hc::RpcError(json!({"data": {"kind": kind}})).into());
            for (result, stale, removed) in [
                (Ok(json!({"state": "finished", "reason": "holder_lost"})), false, true),
                (error("not_found"), false, false),
                (error("unavailable"), false, false),
                (Ok(json!({"state": "finished", "reason": "holder_lost"})), true, false),
                (Ok(json!({"state": "live", "reason": "holder_lost"})), false, false),
            ] {
                this.chrome = original.clone();
                this.sync(window, cx);
                let generation = this.core_generation;
                if stale { this.core_generation += 1; }
                this.checking_closed = true;
                this.checked_closed(generation, vec![("terminal".into(), "t1".into(), result)], window, cx);
                assert!(!this.checking_closed);
                let expected = if removed { &closed } else { &original };
                assert_eq!(&this.chrome, expected);
                assert_eq!(&saved(this), expected);
            }
        }));
    }

    #[test]
    fn showing_the_tab_again_gives_its_pane_the_keyboard() {
        in_own_process("tab_shown_again");
    }

    /// A home page in a stack beside the tab: a space made while it shows
    /// gets the keyboard once `layout.select` shows the tab again.
    #[gpui::test]
    fn tab_shown_again(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("tab_shown_again") {
            return;
        }
        let (view, cx) = open_window(cx, "home", "", json!({
            "id": "center", "type": "stack", "active": "main", "children": [
                { "id": "main", "type": "block", "content": { "tab": "active" } },
                { "id": "home", "type": "block", "content": { "mod": "home" } }
            ]
        }));
        let select = |child: &str, cx: &mut gpui::VisualTestContext| {
            cx.update(|window, cx| view.update(cx, |this, cx| this.run("layout.select", json!({ "stack": "center", "child": child }), window, cx)));
            cx.run_until_parked();
        };
        select("home", cx);
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        let pane_focused = |cx: &mut gpui::VisualTestContext| cx.update(|window, cx| view.read(cx).pane_focus("p1", cx).unwrap().is_focused(window));
        assert!(!pane_focused(cx), "hidden, the pane can't hold the keyboard");
        select("main", cx);
        assert!(pane_focused(cx));
    }

    #[test]
    fn a_press_from_a_hidden_tabs_view_shows_its_tab() {
        in_own_process("press_shows_hidden_tab");
    }

    /// A native view's press (e.g. picture in picture's "back") comes from a
    /// pane in a tab that isn't shown: that tab shows, even though the pane
    /// was the focused one when its tab was left.
    #[gpui::test]
    fn press_shows_hidden_tab(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("press_shows_hidden_tab") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.model.add_tab("sp1", crate::model::Tab::new("tb2", "", "p2", "t2"));
            this.model.focus_pane("p2");
            this.focused_pane = Some("p2".into());
            this.model.select_tab("tb1");
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        // As in the app: the shown tab's terminal has the keyboard.
        cx.update(|window, cx| view.update(cx, |this, cx| this.pane_focus("p1", cx).unwrap().focus(window, cx)));
        cx.run_until_parked();
        let active = |cx: &mut gpui::VisualTestContext| cx.update(|_, cx| view.read(cx).model.active_tab().map(|t| t.id.clone()));
        assert_eq!(active(cx).as_deref(), Some("tb1"));
        cx.update(|window, cx| view.update(cx, |this, cx| this.focus_pressed("p2".into(), window, cx)));
        cx.run_until_parked();
        assert_eq!(active(cx).as_deref(), Some("tb2"));
    }

    #[test]
    fn a_parked_mod_pane_keeps_running_and_a_press_on_it_unparks_it() {
        in_own_process("parked_mod_lives");
    }

    /// A mod pane parked as a chip keeps its copy (a web page plays on); a
    /// press on its native view (picture in picture's "back") unparks it.
    #[gpui::test]
    fn parked_mod_lives(cx: &mut gpui::TestAppContext) {
        use crate::layout::{Axis, Content, Node};
        use serde_json::json;
        if !running_alone("parked_mod_lives") {
            return;
        }
        let (view, cx) = open_window(cx, "probe", "import { View, div } from \"gpui-kit\"; export default class P extends View { render() { return div(); } }", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            let block = Node::block("pm", Content::Mod { name: "probe".into(), props: json!({}) });
            assert!(this.model.split_with("p1", Axis::Row, block));
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        let copy = |cx: &mut gpui::VisualTestContext| cx.update(|_, cx| view.read(cx).copies.get("pm").map(|c| c.id));
        let first = copy(cx);
        assert!(first.is_some(), "the shown mod pane has a copy");
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.park_pane("pm", None).unwrap();
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        assert_eq!(copy(cx), first, "parked, the same copy runs on");
        cx.update(|window, cx| view.update(cx, |this, cx| this.focus_pressed("pm".into(), window, cx)));
        cx.run_until_parked();
        assert!(cx.update(|_, cx| view.read(cx).model.parked_tab_of("pm").is_none()), "a press unparks it");
        assert_eq!(copy(cx), first);
    }

    #[test]
    fn a_press_on_a_focusable_mods_view_gives_the_mod_the_keyboard() {
        in_own_process("press_hands_keyboard");
    }

    /// A press on a web page's native view: the page keeps AppKit's keyboard,
    /// and the mod gets GPUI's (`focus`), so its own keys.json section applies
    /// to the chords the page leaves. Each press again (the window may have
    /// taken GPUI's keyboard back since, the pane still focused); a mod that
    /// isn't focusable gets nothing.
    #[gpui::test]
    fn press_hands_keyboard(cx: &mut gpui::TestAppContext) {
        use crate::layout::{Axis, Content, Node};
        use serde_json::json;
        if !running_alone("press_hands_keyboard") {
            return;
        }
        let web = crate::mods::app_dir().join("mods/web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(web.join("mod.json"), r#"{ "place": "none", "focusable": true }"#).unwrap();
        std::fs::write(web.join("main.js"), "import { View, div } from \"gpui-kit\"; import { nextCommand, shared, setShared } from \"herdr\";
            export default class W extends View {
              init(_p, cx) { cx.spawn(async () => { for (;;) { const c = await nextCommand(); if (c === \"focus\") setShared(\"web.focus\", (shared(\"web.focus\") ?? 0) + 1); } }); }
              render() { return div(); } }").unwrap();
        let (view, cx) = open_window(cx, "plain", "import { View, div } from \"gpui-kit\"; export default class P extends View { render() { return div(); } }", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            assert!(this.model.split_with("p1", Axis::Row, Node::block("pw", Content::Mod { name: "web".into(), props: json!({}) })));
            assert!(this.model.split_with("p1", Axis::Column, Node::block("pp", Content::Mod { name: "plain".into(), props: json!({}) })));
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        let copy = |slot: &str, cx: &mut gpui::VisualTestContext| cx.update(|_, cx| view.read(cx).copies.get(slot).map(|c| c.id).unwrap());
        let focus_count = || crate::mods::shared("web.focus").and_then(|v| v.as_u64()).unwrap_or(0);
        let (web_copy, plain_copy) = (copy("pw", cx), copy("pp", cx));
        cx.update(|window, cx| view.update(cx, |this, cx| this.native_view_pressed(web_copy, window, cx)));
        cx.run_until_parked();
        assert_eq!(focus_count(), 1, "the focusable mod got the keyboard");
        let state = |cx: &mut gpui::VisualTestContext| cx.update(|_, cx| { let w = view.read(cx); (w.focused_pane.clone(), w.focused_block.clone()) });
        assert_eq!(state(cx), (Some("pw".into()), Some("pw".into())));
        // Pressed again while focused: the keyboard again.
        cx.update(|window, cx| view.update(cx, |this, cx| this.native_view_pressed(web_copy, window, cx)));
        cx.run_until_parked();
        assert_eq!(focus_count(), 2);
        // A mod without "focusable": its pane is focused, the window keeps GPUI's keyboard.
        cx.update(|window, cx| view.update(cx, |this, cx| this.native_view_pressed(plain_copy, window, cx)));
        cx.run_until_parked();
        assert_eq!(focus_count(), 2);
        assert_eq!(state(cx), (Some("pp".into()), None), "nor is the web pane the block with the keyboard any more");
    }

    #[test]
    fn a_focusable_mod_pane_takes_the_keyboard_however_the_focus_comes() {
        in_own_process("mod_pane_takes_keyboard");
    }

    /// A focusable mod pane focused without a click or `pane.go` (a tab
    /// switch, a pane closing, the start) takes the keyboard as a terminal does:
    /// its copy gets `focus` and it is the block with the keyboard, so its own
    /// keys.json section applies. Not while a dialog holds the keys; a terminal
    /// pane focused next takes it back.
    #[gpui::test]
    fn mod_pane_takes_keyboard(cx: &mut gpui::TestAppContext) {
        use crate::layout::{Axis, Content, Node};
        use serde_json::json;
        if !running_alone("mod_pane_takes_keyboard") {
            return;
        }
        let web = crate::mods::app_dir().join("mods/web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(web.join("mod.json"), r#"{ "place": "none", "focusable": true }"#).unwrap();
        std::fs::write(web.join("main.js"), "import { View, div } from \"gpui-kit\"; import { nextCommand, props, shared, setShared } from \"herdr\";
            export default class W extends View {
              init(_p, cx) { const k = `focus.${props().n}`; cx.spawn(async () => { for (;;) { const c = await nextCommand(); if (c === \"focus\") setShared(k, (shared(k) ?? 0) + 1); } }); }
              render() { return div(); } }").unwrap();
        let (view, cx) = open_window(cx, "plain", "import { View, div } from \"gpui-kit\"; export default class P extends View { render() { return div(); } }", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        let count = |n: u64| crate::mods::shared(&format!("focus.{n}")).and_then(|v| v.as_u64()).unwrap_or(0);
        let state = |cx: &mut gpui::VisualTestContext| cx.update(|_, cx| { let w = view.read(cx); (w.focused_pane.clone(), w.focused_block.clone()) });
        let web_pane = |n: u64| Node::block(&format!("w{n}"), Content::Mod { name: "web".into(), props: json!({ "n": n }) });
        // The start: tab 2 shown, its web pane focused.
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.model.add_tab("sp1", crate::model::Tab::new("tb2", "", "p2", "t2"));
            assert!(this.model.split_with("p2", Axis::Row, web_pane(2)));
            assert!(this.model.split_with("p1", Axis::Row, web_pane(1)));
            assert!(this.model.split_with("p1", Axis::Column, Node::block("pp", Content::Mod { name: "plain".into(), props: json!({}) })));
            this.model.focus_pane("w1");
            this.model.select_tab("tb2");
            this.model.focus_pane("w2");
            this.sync(window, cx);
        }));
        cx.run_until_parked();
        assert_eq!((count(2), state(cx)), (1, (Some("w2".into()), Some("w2".into()))), "at the start");
        // A tab switch onto tab 1, whose focused pane is its web pane.
        let select = |tab: &str, cx: &mut gpui::VisualTestContext| {
            cx.update(|window, cx| view.update(cx, |this, cx| this.run("tab.select", json!({ "id": tab }), window, cx)));
            cx.run_until_parked();
        };
        select("tb1", cx);
        assert_eq!((count(1), state(cx)), (1, (Some("w1".into()), Some("w1".into()))), "after a tab switch");
        select("tb2", cx);
        assert_eq!(count(2), 2, "and back");
        // A terminal focused next: it has the keyboard, the web pane is no longer the block.
        cx.update(|window, cx| view.update(cx, |this, cx| { this.model.focus_pane("p2"); this.sync(window, cx); }));
        cx.run_until_parked();
        assert_eq!(state(cx), (Some("p2".into()), None));
        assert!(cx.update(|window, cx| view.read(cx).pane_focus("p2", cx).unwrap().is_focused(window)));
        // The terminal closes: the focus falls to the web pane, which takes the keyboard.
        cx.update(|window, cx| view.update(cx, |this, cx| { this.model.remove_pane("p2"); this.sync(window, cx); }));
        cx.run_until_parked();
        assert_eq!((count(2), state(cx)), (3, (Some("w2".into()), Some("w2".into()))), "after a pane closed");
        // A dialog open: the switch leaves the keys with it.
        cx.update(|window, cx| view.update(cx, |this, cx| this.open_overlay("d".into(), json!({ "kind": "dialog" }), window, cx)));
        cx.run_until_parked();
        select("tb1", cx);
        assert_eq!(count(1), 1, "not under a dialog");
        // A mod that isn't focusable: the window holds the keys.
        cx.update(|window, cx| view.update(cx, |this, cx| { this.close_overlay("d", window, cx); this.model.focus_pane("pp"); this.sync(window, cx); }));
        cx.run_until_parked();
        assert_eq!(state(cx), (Some("pp".into()), None));
    }

    #[test]
    fn close_keys_dismiss_the_top_dialog_without_closing_the_tab() {
        in_own_process("close_keys_dismiss_dialog");
    }

    #[gpui::test]
    fn close_keys_dismiss_dialog(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("close_keys_dismiss_dialog") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.sync(window, cx);
            this.open_overlay("bottom".into(), json!({"kind": "dialog"}), window, cx);
            for kind in ["dialog", "popup"] {
                for name in ["tab.close", "pane.close"] {
                    let mut bindings = vec![None, Some(json!({}))];
                    if name == "tab.close" {
                        bindings.extend([Some(json!({"confirmed": true})), Some(json!({"id": null})), Some(json!({"id": null, "confirmed": true}))]);
                    } else {
                        bindings.push(Some(json!({"pane": null})));
                    }
                    for args in bindings {
                        this.open_overlay("top".into(), json!({"kind": kind}), window, cx);
                        if let Some(args) = args {
                            this.run_key(name, args, window, cx);
                        } else {
                            this.run_action(name, window, cx);
                        }
                        assert!(!this.overlays.iter().any(|o| o.id == "top"));
                        assert!(this.overlays.iter().any(|o| o.id == "bottom"));
                        assert_eq!(this.model.focused_pane().as_deref(), Some("p1"));
                        assert!(this.model.tab("tb1").is_some());
                    }
                }
            }
        }));
    }

    #[test]
    fn a_second_rename_press_closes_the_prompt() {
        in_own_process("rename_prompt_opens_once");
    }

    #[gpui::test]
    fn rename_prompt_opens_once(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("rename_prompt_opens_once") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.sync(window, cx);
            let prompts = |this: &super::AppWindow| this.overlays.iter().filter(|o| o.id == "rename").count();
            this.run("tab.rename", json!({}), window, cx);
            assert_eq!(prompts(this), 1);
            this.run("tab.rename", json!({}), window, cx);
            assert_eq!(prompts(this), 0, "a second press closes the prompt");
            this.run("tab.rename", json!({}), window, cx);
            assert_eq!(prompts(this), 1, "and a third opens it again");
        }));
    }

    #[test]
    fn pane_ring_follows_keyboard_focus() {
        in_own_process("pane_ring_focus");
    }

    #[gpui::test]
    fn pane_ring_focus(cx: &mut gpui::TestAppContext) {
        if !running_alone("pane_ring_focus") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", serde_json::json!({
            "id": "pane", "type": "block", "content": { "terminal": "t1" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.focused_pane = Some("pane".into());
            let pane = this.pane_focus("pane", cx).unwrap();
            pane.focus(window, cx);
            assert!(this.focused_path(window, cx).contains("pane"));
            let input = cx.focus_handle();
            input.focus(window, cx);
            assert!(this.focused_path(window, cx).is_empty());
            assert_eq!(this.focused_pane.as_deref(), Some("pane"));
            pane.focus(window, cx);
            assert!(this.focused_path(window, cx).contains("pane"));
        }));
        cx.deactivate_window();
        cx.update(|window, cx| view.update(cx, |this, cx| {
            assert!(this.focused_path(window, cx).contains("pane"));
        }));
    }

    #[test]
    fn find_focus_survives_tab_and_space_switches() {
        in_own_process("find_focus_switches");
    }

    #[gpui::test]
    fn find_focus_switches(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("find_focus_switches") {
            return;
        }
        cx.update(gpui_base::init);
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "main", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("s1", "one", "", crate::model::Tab::new("a", "a", "pa", "t1"));
            this.model.add_tab("s1", crate::model::Tab::new("b", "b", "pb", "t2"));
            this.model.add_space("s2", "two", "", crate::model::Tab::new("c", "c", "pc", "t3"));
            this.model.select_tab("a");
            this.sync(window, cx);
            this.dispatch("terminal.search", &json!({}), true, window, cx);
        }));
        cx.run_until_parked();
        cx.simulate_keystrokes("n e e d l e");
        for (action, args) in [
            ("tab.select", json!({"id": "b"})),
            ("tab.select", json!({"id": "a"})),
            ("space.select", json!({"id": "s2"})),
            ("space.select", json!({"id": "s1"})),
        ] {
            cx.update(|window, cx| view.update(cx, |this, cx| {
                this.dispatch(action, &args, true, window, cx);
            }));
            cx.run_until_parked();
            if args["id"] == "a" || args["id"] == "s1" {
                cx.update(|window, cx| view.update(cx, |this, cx| {
                    let term = this.pane_term("pa").unwrap();
                    assert!(!term.focus.is_focused(window), "returning must not send a find query to the program");
                    assert!(this.pane_focus("pa", cx).unwrap().is_focused(window));
                    assert!(this.focused_path(window, cx).contains("pa"), "Find focus must keep the pane ring");
                }));
                cx.simulate_keystrokes("x");
            }
        }
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        cx.update(|window, cx| view.update(cx, |this, _| {
            assert!(this.pane_term("pa").unwrap().focus.is_focused(window));
        }));
    }

    #[test]
    fn the_toast_clock_runs_only_while_a_toast_is_up() {
        in_own_process("toast_clock");
    }

    /// No mod root wakes for toasts it doesn't have: the clock starts with a
    /// toast and stops once the last one has left.
    #[gpui::test]
    fn toast_clock(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("toast_clock") {
            return;
        }
        let (view, cx) = open_window(cx, "probe", "import { View, div } from \"gpui-kit\";\nexport default class P extends View { render() { return div(); } }", json!({ "id": "probe", "type": "block", "content": { "mod": "probe" } }));
        cx.run_until_parked();
        let roots: Vec<_> = view.update(cx, |this, _| this.copies.values().filter_map(|c| c.root.clone()).collect());
        assert!(!roots.is_empty(), "no mod loaded");
        let running = |cx: &mut gpui::VisualTestContext| roots.iter().filter(|r| r.read_with(cx, |r, _| r.toast_clock_running())).count();
        assert_eq!(running(cx), 0, "no toasts, no clock");
        let root = roots[0].clone();
        cx.update(|window, cx| root.update(cx, |r, cx| r.push_toast(gpui_shell::ToastRequest::new("Saved"), window, cx)));
        assert_eq!(running(cx), 1, "a toast starts its root's clock, and only its");
        cx.executor().advance_clock(gpui_shell::ToastRequest::DEFAULT_TIMEOUT / 2);
        cx.run_until_parked();
        assert_eq!((running(cx), root.read_with(cx, |r, _| r.toast_count())), (1, 1), "still up, still ticking");
        cx.executor().advance_clock(gpui_shell::ToastRequest::DEFAULT_TIMEOUT * 2);
        cx.run_until_parked();
        assert_eq!(root.read_with(cx, |r, _| r.toast_count()), 0, "the toast timed out and left");
        assert_eq!(running(cx), 0, "and the clock stopped with it");
    }

    /// Mods see window().active follow the focus, losing it too: a probe mod
    /// notes every value it renders with while the window is focused and
    /// blurred, and the poll that checks the focus runs in between.
    #[test]
    fn mods_see_the_window_lose_and_regain_focus() {
        in_own_process("focus_window");
    }

    #[gpui::test]
    fn focus_window(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("focus_window") {
            return;
        }
        let probe = r#"import { View, div } from "gpui-kit";
import { window, shared, setShared } from "herdr";

export default class Probe extends View {
  render() {
    const active = window().active;
    if (active !== this.last) {
      this.last = active;
      setShared("probe.seen", [...(shared("probe.seen") ?? []), active]);
    }
    return div();
  }
}
"#;
        let layout = json!({ "id": "root", "type": "row", "children": [
            { "id": "probe", "type": "block", "content": { "mod": "active-probe" } }
        ] });
        let (_view, cx) = open_window(cx, "active-probe", probe, layout);
        // What the probe saw last, after the focus poll (every 400 ms) had its turn.
        let seen = |cx: &mut gpui::VisualTestContext| {
            cx.executor().advance_clock(std::time::Duration::from_secs(1));
            cx.run_until_parked();
            crate::mods::shared("probe.seen").and_then(|v| v.as_array()?.last().cloned())
        };
        for _ in 0..2 {
            cx.update(|window, _| window.activate_window());
            assert_eq!(seen(cx), Some(json!(true)), "focused: {:?}", crate::mods::shared("probe.seen"));
            cx.deactivate_window();
            assert_eq!(seen(cx), Some(json!(false)), "blurred: {:?}", crate::mods::shared("probe.seen"));
        }
    }

    /// The script runner's deck (defaults/mods/nocturne-scripts) owns the
    /// keyboard from the moment it opens: real keystrokes through the window,
    /// what the deck queued for the tab strip (`nocturne-scripts.jobs`) says
    /// which script they ran.
    #[test]
    fn the_scripts_deck_list_has_the_keyboard() {
        in_own_process("scripts_deck_keys");
    }

    #[gpui::test]
    fn scripts_deck_keys(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("scripts_deck_keys") {
            return;
        }
        cx.update(gpui_base::init);
        let (view, cx) = open_window(cx, "nocturne-scripts", include_str!("../defaults/mods/nocturne-scripts/main.js"), json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        let folder = crate::mods::app_dir().join("mods/nocturne-scripts");
        for (name, text) in [
            ("detect.js", include_str!("../defaults/mods/nocturne-scripts/detect.js")),
            ("nix.js", include_str!("../defaults/mods/nocturne-scripts/nix.js")),
            ("runs.js", include_str!("../defaults/mods/nocturne-scripts/runs.js")),
        ] {
            std::fs::write(folder.join(name), text).unwrap();
        }
        // What the deck found here before (no folder: nothing to look at again).
        let script = |name: &str| json!({ "runner": "just", "group": "justfile", "name": name, "cmd": format!("just {name}"), "id": format!("justfile#{name}") });
        crate::mods::set_shared("nocturne-scripts.found".into(), json!({ ":": [script("build"), script("test"), script("lint"), script("deploy")] }));
        let open = |cx: &mut gpui::VisualTestContext| {
            crate::mods::set_shared("nocturne-scripts.jobs".into(), json!([]));
            crate::mods::set_shared("nocturne-scripts.recent".into(), json!({}));
            cx.update(|window, cx| view.update(cx, |this, cx| {
                this.open_overlay("deck".into(), json!({ "mod": "nocturne-scripts", "kind": "dialog", "width": 420, "height": 470, "props": {} }), window, cx);
            }));
            cx.run_until_parked();
            // One frame drawn, as the window does (the deck's key handlers are
            // in it), and no clock advanced: the keys work right away.
            cx.update(|window, cx| window.draw(cx).clear(cx));
            cx.update(|window, _| window.activate_window());
        };
        let ran = |cx: &mut gpui::VisualTestContext| {
            cx.run_until_parked();
            let jobs = crate::mods::shared("nocturne-scripts.jobs").unwrap_or(json!([]));
            jobs.as_array().unwrap().iter().map(|j| (j["name"].as_str().unwrap_or("").to_owned(), j["watch"].as_bool().unwrap_or(false))).collect::<Vec<_>>()
        };
        let deck_open = |cx: &mut gpui::VisualTestContext| view.update(cx, |this, _| this.overlays.iter().any(|o| o.id == "deck"));

        // Right after it opens: down, enter. The second script runs; the deck closes.
        open(cx);
        cx.simulate_keystrokes("down enter");
        assert_eq!(ran(cx), vec![("test".to_owned(), false)]);
        assert!(!deck_open(cx));

        // j/k move too; shift-enter runs and watches.
        open(cx);
        cx.simulate_keystrokes("j j k shift-enter");
        assert_eq!(ran(cx), vec![("test".to_owned(), true)]);

        // "/" goes to the filter (without typing itself there); enter runs the match.
        open(cx);
        cx.simulate_keystrokes("/ d e p enter");
        assert_eq!(ran(cx), vec![("deploy".to_owned(), false)]);

        // Letters on the list are its keys, not a filter: "d" alone runs nothing.
        open(cx);
        cx.simulate_keystrokes("d e p");
        assert_eq!(ran(cx), vec![]);
        assert!(deck_open(cx));
        cx.simulate_keystrokes("escape");
        assert!(!deck_open(cx), "esc on the list closes");

        // In the filter, k is a letter (nothing has one); up/down still move.
        open(cx);
        cx.simulate_keystrokes("/ k down enter");
        assert_eq!(ran(cx), vec![], "nothing matches k");
        assert!(deck_open(cx));
        // Esc clears the filter, esc again gives the list the keyboard.
        cx.simulate_keystrokes("escape escape");
        assert!(deck_open(cx));
        cx.simulate_keystrokes("j enter");
        assert_eq!(ran(cx), vec![("test".to_owned(), false)], "back on the list, with the filter cleared");

        // Backspace takes back a letter.
        open(cx);
        cx.simulate_keystrokes("/ x backspace l i n enter");
        assert_eq!(ran(cx), vec![("lint".to_owned(), false)]);

        // Up/down in the filter move through what matches.
        open(cx);
        cx.simulate_keystrokes("/ t down up down enter");
        assert_eq!(ran(cx).len(), 1);

        // A third esc closes.
        open(cx);
        cx.simulate_keystrokes("/ escape escape escape");
        assert_eq!(ran(cx), vec![]);
        assert!(!deck_open(cx));
    }

    /// A small window showing a terminal (a switch's password prompt) shrinks
    /// it; closing the window gives back the size it had before, unless
    /// something else shows it (that viewer keeps sizing it).
    #[test]
    fn an_overlay_gives_its_terminals_their_size_back() {
        in_own_process("overlay_sizes");
    }

    #[gpui::test]
    fn overlay_sizes(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("overlay_sizes") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            this.sync(window, cx);
            this.live.insert("t1".into(), json!({ "address": "t1", "cols": 120, "rows": 40 }));
            this.live.insert("t9".into(), json!({ "address": "t9", "cols": 200, "rows": 120 }));
            let small = |t: &str| json!({ "kind": "dialog", "width": 440, "height": 92, "layout": { "type": "column", "children": [
                { "type": "block", "content": { "terminal": t } }
            ] } });
            this.open_overlay("pw".into(), small("t9"), window, cx);
            let o = this.overlays.iter().find(|o| o.id == "pw").unwrap();
            assert_eq!(o.sizes.iter().map(|(_, a, c, r)| (a.as_str(), *c, *r)).collect::<Vec<_>>(), vec![("t9", 200, 120)]);
            assert!(o.sizes.iter().all(|(b, ..)| this.terms.contains_key(b)), "recorded by the block its view lives under");
            this.close_overlay("pw", window, cx);
            assert!(!this.overlays.iter().any(|o| o.id == "pw"));
            // A terminal its pane shows: the pane sizes it, nothing to give back.
            this.open_overlay("pw2".into(), small("t1"), window, cx);
            assert!(this.overlays.iter().find(|o| o.id == "pw2").unwrap().sizes.is_empty());
        }));
    }

    include!("window/pane_size_tests.rs");
    include!("window/drag_tests.rs");
    include!("window/floatfocus_tests.rs");

    /// The whole path, in a real window: a layout names the toast mod, a
    /// notification opens it with its props, and it can close itself (as one
    /// that hands notifications to the system does). Unknown: the shipped toast.
    #[test]
    fn a_layout_s_toast_mod_gets_every_notification() {
        in_own_process("toast_window");
    }

    #[gpui::test]
    fn toast_window(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("toast_window") {
            return;
        }
        let forward = r#"import { View, div } from "gpui-kit";
import { props, closeOverlay, shared, setShared } from "herdr";

export default class SystemToast extends View {
  render() {
    const p = props();
    // A real one would exec("notify-send", [p.title, p.body]) here.
    setShared("toast-test.seen", [...(shared("toast-test.seen") ?? []), `${p.title}: ${p.body}`]);
    closeOverlay(p.overlay);
    return div();
  }
}
"#;
        let layout = json!({ "id": "root", "type": "row", "toast": "system-toast", "children": [] });
        let (view, cx) = open_window(cx, "system-toast", forward, layout);
        let notify = |cx: &mut gpui::VisualTestContext| {
            view.update_in(cx, |this, window, cx| {
                this.sync_folders(window, cx);
                let note = json!({ "kind": "toast", "notification": { "title": "Build finished", "body": "All green", "level": "success" } });
                let id = crate::mods::new_overlay_id();
                this.open_overlay(id.clone(), note, window, cx);
                (id.clone(), this.copies[&format!("overlay:{id}")].inst.name.clone())
            })
        };
        // Fireflies' own notes ("Your edits are in …") may show up too.
        let shown = |id: &str, cx: &mut gpui::VisualTestContext| {
            cx.run_until_parked();
            view.update(cx, |this, _| this.overlays.iter().any(|o| o.id == id))
        };

        let (id, name) = notify(cx);
        assert_eq!(name, "system-toast");
        assert!(!shown(&id, cx), "the layout's mod closed the notification");
        let seen = crate::mods::shared("toast-test.seen").unwrap_or_default();
        assert!(seen.as_array().unwrap().contains(&json!("Build finished: All green")), "the mod got the notification's props: {seen}");

        view.update(cx, |this, _| this.chrome.toast = Some("no-such-mod".into()));
        let (id, name) = notify(cx);
        assert_eq!(name, "toast");
        assert!(shown(&id, cx), "an unknown mod falls back to the shipped toast, which stays");
    }

    #[test]
    fn docking_keeps_the_layouts_notification_and_menu_mods() {
        in_own_process("dock_root_choices");
    }

    #[gpui::test]
    fn dock_root_choices(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("dock_root_choices") {
            return;
        }
        let layout = json!({
            "id": "root", "type": "row", "toast": "chosen", "terminal_menu": "chosen", "children": []
        });
        let (view, cx) = open_window(cx, "chosen", "", layout);
        let check_handlers = |cx: &mut gpui::VisualTestContext| {
            view.update_in(cx, |this, window, cx| {
                let id = crate::mods::new_overlay_id();
                this.open_overlay(id.clone(), json!({
                    "kind": "toast", "notification": { "title": "After docking", "body": "Still chosen" }
                }), window, cx);
                assert_eq!(this.copies[&format!("overlay:{id}")].inst.name, "chosen");
                this.close_overlay(&id, window, cx);
                this.open_menu("tab", json!({}), None, window, cx);
                let id = this.overlays.last().unwrap().id.clone();
                assert_eq!(this.copies[&format!("overlay:{id}")].inst.name, "chosen");
                this.close_overlay(&id, window, cx);
            });
        };
        check_handlers(cx);
        let folder = crate::mods::app_dir().join("mods/new-top");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("mod.json"), r#"{"place":"top"}"#).unwrap();
        std::fs::write(folder.join("main.js"), "").unwrap();
        view.update_in(cx, |this, window, cx| {
            this.sync_folders(window, cx);
            assert_eq!(this.chrome.axis(), Some(crate::layout::Axis::Column));
            assert!(this.chrome.walk().iter().any(|n| matches!(
                n.content(), Some(crate::layout::Content::Mod { name, .. }) if name == "new-top"
            )));
            this.save();
        });
        check_handlers(cx);
        view.update_in(cx, |this, window, cx| {
            this.load_layout("test");
            this.sync(window, cx);
        });
        check_handlers(cx);
    }

    #[test]
    fn toast_is_a_root_layout_choice_that_roundtrips() {
        let mut root = super::default_layout("main");
        assert_eq!(root.toast, None);
        assert!(serde_json::to_value(&root).unwrap().get("toast").is_none());
        root.toast = Some("system-toast".into());
        let restored: super::Node = serde_json::from_value(serde_json::to_value(&root).unwrap()).unwrap();
        assert_eq!(restored.toast.as_deref(), Some("system-toast"));
    }

    #[test]
    fn terminal_menu_preserves_clicked_target_and_uses_mod_dimensions() {
        use serde_json::json;
        let target = json!({ "pane": "p2", "terminal": "t8" });
        let stock = super::terminal_menu_spec("menu", &json!({}), "pane", target.clone());
        assert_eq!(stock["width"], 220.0);
        assert_eq!(stock["height"], 260.0);
        let custom = super::terminal_menu_spec("personal-menu", &json!({"kind": "dialog", "width": 310, "height": 120}), "pane", target.clone());
        assert_eq!(custom["mod"], "personal-menu");
        assert_eq!(custom["kind"], "popup");
        assert_eq!(custom["width"], 310.0);
        assert_eq!(custom["height"], 120.0);
        assert_eq!(custom["props"], json!({"tab": "pane", "target": target}));
        let partial = super::terminal_menu_spec("personal-menu", &json!({"width": 0.4}), "pane", json!({}));
        assert_eq!(partial["width"], 0.4);
        assert_eq!(partial["height"], 260.0);
    }

    #[test]
    fn composition_focus_only_uses_visible_terminal_blocks() {
        let chrome: super::Node = serde_json::from_value(serde_json::json!({
            "id": "composition", "type": "row", "children": [
                { "id": "left", "type": "block", "content": {"terminal": "t1"} },
                { "id": "right", "type": "block", "content": {"terminal": "other/t2"} },
                { "id": "hidden", "type": "block", "hidden": true, "content": {"terminal": "t3"} },
                { "id": "tabs", "type": "block", "content": {"tab": "active"} }
            ]
        })).unwrap();
        assert_eq!(super::terminal_block(&chrome, Some("left")).and_then(|n| n.terminal()), Some("t1"));
        assert_eq!(super::terminal_block(&chrome, Some("right")).and_then(|n| n.terminal()), Some("other/t2"));
        for id in [None, Some("hidden"), Some("tabs"), Some("source-pane"), Some("overlay:term")] {
            assert!(super::terminal_block(&chrome, id).is_none());
        }
    }

    #[test]
    fn pane_swap_refuses_a_direction_that_is_not_a_string() {
        use serde_json::json;
        for direction in [json!(false), json!(1), json!(["left"]), json!({"to": "left"})] {
            for args in [json!({"direction": direction}), json!({"direction": direction, "target": "p2"})] {
                assert_eq!(super::swap_by(&args), Err("pane.swap direction must be a string (or null to omit it)".into()), "{args}");
            }
        }
        assert_eq!(super::swap_by(&json!({"direction": null, "target": "p2"})), Ok(super::SwapBy::Target("p2")));
    }

    fn swap_model() -> super::Model {
        use crate::layout::Axis;
        let mut m = super::Model::default();
        m.add_space("s1", "api", "/src", super::Tab::new("c1", "", "x1", "t1"));
        m.split("x1", Axis::Row, "x2", "t2");
        m.add_tab("s1", super::Tab::new("c2", "", "x3", "t3"));
        m.select_tab("c1");
        m.focus_pane("x1");
        m
    }

    fn swap_state(m: &super::Model) -> (Vec<String>, Vec<String>, Option<String>) {
        let order = |tab: &str| m.tab(tab).unwrap().root.panes().iter().map(|n| n.id.clone()).collect();
        (order("c1"), order("c2"), m.focused_pane())
    }

    #[test]
    fn an_explicit_pane_swaps_with_its_neighbor_in_the_shown_tab() {
        let mut m = swap_model();
        assert_eq!(super::swap_with_neighbor(&mut m, "x2", true, Some("x1".into())), Ok(()));
        assert_eq!(swap_state(&m), (vec!["x2".into(), "x1".into()], vec!["x3".into()], Some("x1".into())));
        assert_eq!(super::swap_with_neighbor(&mut m, "x2", true, None), Ok(()));
        assert_eq!(swap_state(&m).0, ["x2", "x1"]);
    }

    #[test]
    fn an_explicit_pane_swap_by_direction_refuses_panes_it_cannot_place() {
        let mut m = swap_model();
        let container = m.tab("c1").unwrap().root.id.clone();
        let before = swap_state(&m);
        let cases = [
            ("nope".to_owned(), "no pane \"nope\"".to_owned()),
            (container.clone(), format!("no pane {container:?}")),
            ("x3".to_owned(), "pane.swap direction needs a pane in the shown tab, not \"x3\"".to_owned()),
        ];
        for (pane, error) in cases {
            assert_eq!(super::swap_with_neighbor(&mut m, &pane, true, Some("x1".into())), Err(error), "{pane}");
            assert_eq!(swap_state(&m), before, "{pane}");
        }
    }

    #[test]
    fn pane_swap_takes_exactly_one_of_direction_or_target() {
        use super::SwapBy;
        use serde_json::json;
        for dir in ["left", "right", "up", "down"] {
            assert_eq!(super::swap_by(&json!({"direction": dir})), Ok(SwapBy::Direction(dir)));
        }
        assert_eq!(super::swap_by(&json!({"target": "p2", "pane": "p1"})), Ok(SwapBy::Target("p2")));
        assert_eq!(super::swap_by(&json!({"direction": "left", "target": "p2"})), Err("pane.swap takes direction or target, not both".into()));
        for neither in [json!({}), json!(null), json!({"pane": "p1"}), json!({"direction": null, "target": null})] {
            assert_eq!(super::swap_by(&neither), Err("pane.swap needs direction or target".into()), "{neither}");
        }
        assert_eq!(super::swap_by(&json!({"direction": "sideways"})), Err("pane.swap direction is left, right, up or down, not \"sideways\"".into()));
    }

    #[test]
    fn a_float_view_is_a_stack_child_and_show_picks_one() {
        use serde_json::json;
        let layout: crate::layout::Node = serde_json::from_value(json!({
            "type": "stack", "id": super::FLOAT_BODY, "active": super::FLOAT_CHILDREN[1],
            "children": [
                { "type": "block", "id": super::FLOAT_CHILDREN[0], "content": { "terminal": "t1" } },
                { "type": "block", "id": super::FLOAT_CHILDREN[1], "content": { "mod": "git", "props": {} } }
            ]
        })).unwrap();
        // The shown child keeps pointing at its (prefixed) id.
        let l = super::overlay_layout(layout, "terminal-peek");
        assert_eq!(l.active_child().map(|n| n.id.as_str()), Some("ovterminal-peek/float-view"));
        assert_eq!(super::ov_id("terminal-peek", super::FLOAT_CHILDREN[1]), "ovterminal-peek/float-view");
        assert_eq!(super::float_show(&json!({})), Ok(0));
        assert_eq!(super::float_show(&json!({"show": 1})), Ok(1));
        assert!(super::float_show(&json!({"show": 2})).is_err());
        let v = super::FloatView::parse(Some(&json!({"mod": "git", "props": {"a": 1}}))).unwrap().unwrap();
        assert_eq!((v.name.as_str(), v.label.as_deref()), ("git", None));
        assert!(super::FloatView::parse(Some(&json!({"props": {}}))).is_err());
        assert!(super::FloatView::parse(None).unwrap().is_none());
        let named = super::FloatView::parse(Some(&json!({"mod": "git", "props": {"a": 1}, "name": "Git"}))).unwrap().unwrap();
        assert!(!v.same(&named));
        assert!(v.same(&super::FloatView { term: Some("lazygit".into()), ..v.clone() }));
    }

    #[test]
    fn composition_commands_never_default_to_a_source_pane() {
        use serde_json::json;
        for name in ["pane.split", "pane.close", "pane.zoom", "pane.go", "pane.swap", "terminal.show"] {
            assert!(super::needs_model_pane(name, &json!({})), "{name}");
            assert!(super::needs_model_pane(name, &json!({"pane": null})), "{name}");
        }
        for name in ["pane.split", "pane.close", "pane.zoom", "pane.swap", "terminal.show"] {
            assert!(!super::needs_model_pane(name, &json!({"pane": "explicit-pane"})), "{name}");
        }
        assert!(super::needs_model_pane("pane.go", &json!({"pane": "explicit-pane"})));
        // An edge split goes by the tab.
        assert!(!super::needs_model_pane("pane.split", &json!({"edge": "right"})));
        for name in ["terminal.open", "terminal.keep"] {
            for place in ["right", "down", "left", "up", "auto"] {
                assert!(super::needs_model_pane(name, &json!({"place": place})), "{name} {place}");
                assert!(!super::needs_model_pane(name, &json!({"place": place, "pane": "explicit-pane"})), "{name} {place}");
            }
            assert!(!super::needs_model_pane(name, &json!({"place": "float"})), "{name}");
            assert!(!super::needs_model_pane(name, &json!({})), "{name}");
            assert!(!super::needs_model_pane(name, &json!({"place": "tab"})), "{name}");
        }
        for name in ["pane.focus", "terminal.copy", "terminal.paste", "terminal.paste_image", "terminal.right_click"] {
            assert!(!super::needs_model_pane(name, &json!({})), "{name}");
        }
    }

    #[test]
    fn a_terminals_markdown_and_preview_links_open_in_the_editor_to_look_at() {
        use super::editor_takes;
        use crate::links::Viewer;
        assert_eq!(editor_takes(Viewer::Markdown, true), (Viewer::Editor, true));
        assert_eq!(editor_takes(Viewer::Preview, true), (Viewer::Editor, true));
        assert_eq!(editor_takes(Viewer::Editor, true), (Viewer::Editor, false));
        assert_eq!(editor_takes(Viewer::Files, true), (Viewer::Files, false));
        // Without the editor's mod: the viewers, as before.
        assert_eq!(editor_takes(Viewer::Markdown, false), (Viewer::Markdown, false));
        assert_eq!(editor_takes(Viewer::Preview, false), (Viewer::Preview, false));
    }

    #[test]
    fn a_file_goes_to_the_tabs_editor_that_last_had_the_keyboard_else_its_first_never_a_scratchpad() {
        use super::tab_editor;
        use serde_json::json;
        let notes = std::path::Path::new("/home/a/.config/herdr-app/scratchpad");
        let ed = |id: &str, slot: &str, path: &str, on: Option<&str>| (id.to_owned(), json!({ "slot": slot, "path": path, "on": on }));
        let eds = vec![
            ed("p1", "s1", "/home/a/.config/herdr-app/scratchpad/repo-0123abcd.md", None),
            ed("p2", "s2", "/r/a.rs", None),
            ed("p3", "s3", "/r/b.rs", None),
            ed("p4", "s4", "/r/c.rs", Some("box")),
        ];
        assert_eq!(tab_editor(&eds, None, None, notes), Some(("p2".into(), "s2".into())));
        assert_eq!(tab_editor(&eds, None, Some("s3"), notes), Some(("p3".into(), "s3".into())));
        // The last one is a scratchpad, or on another machine: the first that fits.
        assert_eq!(tab_editor(&eds, None, Some("s1"), notes), Some(("p2".into(), "s2".into())));
        assert_eq!(tab_editor(&eds, None, Some("s4"), notes), Some(("p2".into(), "s2".into())));
        assert_eq!(tab_editor(&eds, Some("box"), None, notes), Some(("p4".into(), "s4".into())));
        // Only a scratchpad, or no editor with a slot: none (a new editor opens beside).
        assert_eq!(tab_editor(&eds[..1], None, None, notes), None);
        assert_eq!(tab_editor(&[("p5".to_owned(), json!({ "path": "/r/a.rs" }))], None, None, notes), None);
    }

    #[test]
    fn web_links_open_in_the_app_unless_told_otherwise() {
        use crate::settings::Links::{App, System};
        let url = "https://example.com/x";
        assert_eq!(super::link_in_app(url, None, App, true), Ok(true));
        assert_eq!(super::link_in_app(url, None, System, true), Ok(false));
        assert_eq!(super::link_in_app(url, Some("app"), System, true), Ok(true));
        assert_eq!(super::link_in_app(url, Some("system"), App, true), Ok(false));
        // No web pane (not macOS, or the mod is gone): the system's browser.
        assert_eq!(super::link_in_app(url, Some("app"), App, false), Ok(false));
        assert!(super::link_in_app(url, Some("tab"), App, true).is_err());
        for other in ["mailto:a@b.com", "file:///etc/hosts", "javascript:alert(1)", "https://"] {
            assert!(super::link_in_app(other, None, App, true).is_err(), "{other}");
        }
    }

    #[test]
    fn a_folder_is_asked_again_only_when_its_answer_could_have_changed() {
        use super::{FOLDER_FALLBACK, FolderCheck, recheck};
        use std::time::{Duration, Instant};
        let checked = |busy, repo, ago: Duration| FolderCheck { at: Instant::now() - ago, cwd: "/src".into(), busy, repo };
        let (now, later) = (Duration::ZERO, FOLDER_FALLBACK + Duration::from_secs(1));
        assert!(recheck(None, "/src", false, false), "never asked");
        assert!(!recheck(Some(&checked(false, true, now)), "/src", false, true), "nothing happened");
        assert!(recheck(Some(&checked(false, true, now)), "/elsewhere", false, false), "it moved");
        assert!(recheck(Some(&checked(true, true, now)), "/src", false, false), "a command or turn ended");
        assert!(!recheck(Some(&checked(false, true, now)), "/src", true, true), "one started");
        assert!(recheck(Some(&checked(false, true, later)), "/src", false, true), "a repo, a minute on, in front");
        assert!(!recheck(Some(&checked(false, true, later)), "/src", false, false), "not while the window is behind");
        assert!(!recheck(Some(&checked(false, false, later)), "/src", false, true), "not a repo: never on a timer");
    }

    #[test]
    fn busy_is_an_agent_working_or_a_program_in_front_of_the_shell() {
        let rec = |status: &str, shell: bool, agent: bool| {
            serde_json::json!({ "status": status, "program": { "shell": shell, "agent": agent } })
        };
        assert!(super::busy(&rec("working", false, true)), "an agent's turn");
        assert!(!super::busy(&rec("done", false, true)), "an agent started from a shell, its turn over");
        assert!(super::busy(&rec("", false, false)), "vim in front of the shell");
        assert!(!super::busy(&rec("", true, false)), "the shell's prompt");
    }

    #[test]
    fn closing_asks_for_any_agent_and_a_running_program_never_a_shell() {
        use super::{Ending, EndingKind::*};
        let rec = |name: &str, shell: bool, agent: bool| {
            serde_json::json!({ "program": { "name": name, "shell": shell, "agent": agent } })
        };
        let note = |status, r: &serde_json::Value| super::ending(status, r);
        let agent = |n: &str| Some(Ending { kind: Agent, note: n.into() });
        assert_eq!(note(Some("working"), &rec("claude", false, true)), agent("claude is working"));
        assert_eq!(note(Some("blocked"), &rec("codex", false, true)), agent("codex needs you"));
        // An agent asks whatever its status: between turns, or never started.
        assert_eq!(note(Some("done"), &rec("claude", false, true)), agent("claude is done"));
        assert_eq!(note(Some("idle"), &rec("claude", false, true)), agent("claude is idle"));
        assert_eq!(note(None, &rec("pi", false, true)), agent("pi is idle"), "an agent with no status yet");
        assert_eq!(note(Some("idle"), &serde_json::json!({})), agent("an agent is idle"), "a status says agent");
        assert_eq!(note(None, &rec("vim", false, false)).map(|e| (e.kind, e.note)), Some((Program, "vim running".into())));
        let cargo = serde_json::json!({ "program": { "name": "cargo", "shell": false, "agent": false }, "foreground": { "argv": ["/usr/bin/cargo", "build", "--locked"] } });
        assert_eq!(note(None, &cargo).map(|e| e.note).as_deref(), Some("cargo build running"));
        assert_eq!(note(None, &rec("zsh", true, false)), None, "the shell at its prompt");
        assert_eq!(note(None, &serde_json::json!({})), None, "nothing known about it");
        let notes: Vec<String> = ["claude is working", "cargo build running", "vim running", "codex needs you", "top running"].map(String::from).into();
        assert_eq!(super::running_summary(&notes[..2]), "claude is working \u{b7} cargo build running");
        assert_eq!(super::running_summary(&notes), "claude is working \u{b7} cargo build running \u{b7} vim running \u{b7} +2 more");
    }

    #[test]
    fn a_close_confirm_names_the_agents_and_counts_them() {
        use super::{Ending, EndingKind::*};
        let e = |kind, note: &str| Ending { kind, note: note.into() };
        let one = [e(Agent, "claude is idle")];
        assert_eq!(super::close_detail(&one, "pane"), "claude is idle\n\nClosing the pane ends it.");
        let mixed = [e(Agent, "claude is working"), e(Program, "vim running"), e(Agent, "codex is idle"), e(Unsaved, "1 unsaved file")];
        assert_eq!(super::close_detail(&mixed, "tab"), "2 agents: claude is working \u{b7} codex is idle\nvim running \u{b7} 1 unsaved file\n\nClosing the tab ends them.");
        let many: Vec<Ending> = ["a", "b", "c", "d"].iter().map(|n| e(Agent, &format!("{n} is idle"))).collect();
        assert_eq!(super::endings_summary(&many), "4 agents: a is idle \u{b7} b is idle \u{b7} c is idle \u{b7} +1 more");
    }

    #[test]
    fn closing_a_pane_or_tab_with_an_agent_asks_first() {
        in_own_process("close_asks_for_agents");
    }

    #[gpui::test]
    fn close_asks_for_agents(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("close_asks_for_agents") {
            return;
        }
        let (view, cx) = open_window(cx, "unused", "", json!({
            "id": "root", "type": "block", "content": { "tab": "active" }
        }));
        cx.update(|window, cx| view.update(cx, |this, cx| {
            // As run_as, past its check that the (offline) core holds the document.
            macro_rules! run {
                ($name:expr, $args:expr, $person:expr) => {{
                    this.reply = None;
                    this.dispatch($name, &$args, $person, window, cx);
                    this.reply.take().unwrap_or_else(|| json!({ "ok": true }))
                }};
            }
            // tb1: a shell (p1) beside an idle agent (p2); tb2: a shell alone;
            // tb3: two idle agents; t5, an agent the shell in tb2 started.
            this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
            assert!(this.model.add_tab("sp1", crate::model::Tab::new("tb2", "", "p3", "t3")));
            assert!(this.model.add_tab("sp1", crate::model::Tab::new("tb3", "", "p4", "t4")));
            this.sync(window, cx);
            let shell = json!({ "program": { "name": "zsh", "shell": true, "agent": false } });
            let agent = |name: &str| json!({ "status": "idle", "program": { "name": name, "shell": false, "agent": true } });
            this.live.insert("t1".into(), shell.clone());
            this.live.insert("t3".into(), shell.clone());
            this.live.insert("t4".into(), agent("claude"));
            let mut child = agent("codex");
            child["parent"] = json!("t3");
            this.live.insert("t5".into(), child);
            let split = |this: &mut super::AppWindow, pane: &str, addr: &str, rec: serde_json::Value| {
                assert!(this.model.split_toward("p1", crate::model::Direction::Right, crate::model::pane(pane, addr)));
                this.live.insert(addr.into(), rec);
            };
            split(this, "p2", "t2", agent("pi"));
            this.sync(window, cx);
            // The confirm dialog's props, if one is open.
            let asked = |this: &super::AppWindow| this.overlays.last().and_then(|o| this.copies.get(&format!("overlay:{}", o.id))).map(|c| c.inst.props.clone()).filter(|p| p["command"].is_object());

            // A script is told to confirm; nothing closes.
            let r = run!("pane.close", json!({ "pane": "p2" }), false);
            assert_eq!(r["error"], "pane.close ends pi is idle: pass confirmed: true");
            let r = run!("tab.close", json!({ "id": "tb3" }), false);
            assert_eq!(r["error"], "tab.close ends what runs there (claude is idle): pass confirmed: true");
            let r = run!("tab.close", json!({ "id": "tb2" }), false);
            assert_eq!(r["error"], "tab.close ends what runs there (codex is idle): pass confirmed: true", "a sub-agent the shell started ends with the tab");
            assert!(this.model.tab_of("p2").is_some() && this.model.tab("tb2").is_some() && this.model.tab("tb3").is_some());
            assert!(asked(this).is_none());

            // The person is asked, and the dialog says what ends.
            run!("pane.close", json!({ "pane": "p2" }), true);
            let ask = asked(this).expect("a confirm");
            assert_eq!(ask["title"], "Close pane?");
            assert_eq!(ask["detail"], "pi is idle\n\nClosing the pane ends it.");
            assert_eq!(ask["command"], json!({ "name": "pane.close", "args": { "pane": "p2", "confirmed": true } }));
            run!("tab.close", json!({ "id": "tb1" }), true);
            let ask = asked(this).expect("a confirm");
            assert_eq!((ask["title"].as_str(), ask["detail"].as_str()), (Some("Close tab?"), Some("pi is idle\n\nClosing the tab ends it.")));
            assert!(this.model.tab("tb1").is_some());

            // Confirmed, it closes; a shell's pane closes without a word.
            let r = run!("pane.close", json!({ "pane": "p2", "confirmed": true }), false);
            assert!(r.get("error").is_none(), "{r}");
            assert!(this.model.tab_of("p2").is_none());
            split(this, "p6", "t6", shell.clone());
            let r = run!("pane.close", json!({ "pane": "p6" }), false);
            assert!(r.get("error").is_none(), "{r}");
            assert!(this.model.tab_of("p6").is_none());
            // A parked agent asks too.
            split(this, "p7", "t7", agent("claude"));
            this.model.park_pane("p7", None).unwrap();
            let r = run!("pane.close", json!({ "pane": "p7" }), false);
            assert_eq!(r["error"], "pane.close ends claude is idle: pass confirmed: true");
            assert!(this.model.parked_tab_of("p7").is_some());
            // Two agents in a tab: counted and named.
            this.live.insert("t1".into(), agent("codex"));
            run!("tab.close", json!({ "id": "tb1" }), true);
            assert_eq!(asked(this).unwrap()["detail"], "2 agents: codex is idle \u{b7} claude is idle\n\nClosing the tab ends them.");
            let r = run!("tab.close", json!({ "id": "tb1", "confirmed": true }), false);
            assert!(r.get("error").is_none(), "{r}");
            assert!(this.model.tab("tb1").is_none());
        }));
    }

    #[test]
    fn shipped_layouts_parse_and_show_what_they_promise() {
        let main = super::default_layout("main");
        assert!(main.find("main").is_some() && main.find("sidebar").is_some());
        assert!(main.walk().iter().any(|n| matches!(n.content(), Some(super::Content::Context { .. }))));
        let terminals = super::default_layout("terminals");
        assert!(terminals.find("tabs").is_some());
        assert!(matches!(terminals.find("main").and_then(|n| n.content()), Some(super::Content::Context { .. })));
        // Fireflies starts on Nocturne, whose mods all ship.
        assert!(super::shipped_layouts().contains(&super::FIRST_LAYOUT));
        let nocturne = super::default_layout(super::FIRST_LAYOUT);
        assert!(matches!(nocturne.find("main").and_then(|n| n.content()), Some(super::Content::Context { .. })));
        let mut mods: Vec<String> = nocturne.walk().iter().filter_map(|n| match n.content() {
            Some(super::Content::Mod { name, .. }) => Some(name.clone()),
            _ => None,
        }).collect();
        mods.extend([&nocturne.toast, &nocturne.prompt_mod, &nocturne.confirm_mod, &nocturne.palette_mod, &nocturne.peek_mod, &nocturne.terminal_menu].into_iter().flatten().cloned());
        assert!(mods.len() > 6, "{mods:?}");
        // Its own screens, square corners and a dithered dim; the others keep Fireflies'.
        for screen in ["welcome", "whats_new", "help", "update"] {
            assert!(nocturne.dialog_mods.contains_key(screen), "nocturne draws no {screen}");
        }
        mods.extend(nocturne.dialog_mods.values().cloned());
        assert_eq!(nocturne.corners, Some(crate::layout::CornerStyle::Square));
        assert!(nocturne.scrim.as_ref().is_some_and(|s| s.dither));
        for other in ["main", "terminals", "win98"] {
            let l = super::default_layout(other);
            assert!(l.corners.is_none() && l.scrim.is_none() && l.dialog_mods.is_empty(), "{other}");
        }
        let shipped = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("defaults/mods");
        for m in mods {
            assert!(shipped.join(&m).join("main.js").is_file(), "nocturne names {m:?}, which doesn't ship");
        }
    }

    #[test]
    fn the_layouts_dialog_mods_draw_the_shipped_screens_they_name() {
        assert_eq!(super::dialog_screen("frame-welcome"), Some("welcome"));
        assert_eq!(super::dialog_screen("frame-whatsnew"), Some("whats_new"));
        assert_eq!(super::dialog_screen("machine-add"), Some("machine_add"));
        assert_eq!(super::dialog_screen("worktree"), Some("worktree"));
        assert_eq!(super::dialog_screen("help"), Some("help"));
        // Settings and feedback stay the app's; the prompt, confirm and palette are chosen where they open.
        for kept in ["frame-settings", "frame-feedback", "prompt", "confirm", "frame-palette", "nocturne"] {
            assert_eq!(super::dialog_screen(kept), None, "{kept}");
        }
        let root: super::Node = serde_json::from_value(serde_json::json!({
            "id": "root", "type": "row", "children": [],
            "dialog_mods": { "welcome": "mine" }, "corners": "square", "scrim": { "dither": true }
        })).unwrap();
        assert_eq!(root.dialog_mods.get("welcome").map(String::as_str), Some("mine"));
        let scrim = root.scrim.unwrap();
        assert_eq!((scrim.color.as_str(), scrim.opacity, scrim.cell, scrim.fill), ("#000000", 0.35, 1.0, 0.0));
        assert!(super::scrim_fill(Some(&scrim)).is_none(), "no fill: the checker alone");
        let filled: crate::layout::Scrim = serde_json::from_value(serde_json::json!({ "dither": true, "fill": 0.5 })).unwrap();
        assert_eq!(super::scrim_fill(Some(&filled)).map(|c| c.a), Some(0.5));
        let plain: crate::layout::Scrim = serde_json::from_value(serde_json::json!({ "fill": 0.5 })).unwrap();
        assert!(super::scrim_fill(Some(&plain)).is_none(), "fill is for a dithered scrim only");
    }

    #[test]
    fn a_finished_terminal_is_not_put_back_in_its_tab() {
        let record = |state: &str| serde_json::json!({ "state": state, "labels": { "herdr.space": "sp1", "herdr.tab": "tb1" } });
        assert!(super::adoptable(&record("live"), "sp1", Some("tb1"), None));
        assert!(!super::adoptable(&record("finished"), "sp1", Some("tb1"), None));
        assert!(!super::adoptable(&record("live"), "sp2", Some("tb1"), None));
        assert!(!super::adoptable(&record("live"), "sp1", Some("tb2"), None));
    }


    #[test]
    fn native_views_are_cut_by_the_overlays_painted_above_them() {
        in_own_process("native_layers");
    }

    /// A video player window, a window opened over it with a dim, a popup on
    /// top: each copy's native views get the cards and dims painted above
    /// its own overlay, never its own; raising a window swaps the cuts.
    #[gpui::test]
    fn native_layers(cx: &mut gpui::TestAppContext) {
        use crate::native_view::{Layer, last_frame};
        use serde_json::json;
        if !running_alone("native_layers") {
            return;
        }
        let main = r#"import { View, div } from "gpui-kit";
export default class Viewer extends View { render() { return div().size_full(); } }
"#;
        let layout = json!({ "id": "root", "type": "row", "children": [
            { "id": "viewer", "type": "block", "content": { "mod": "viewer" } }
        ] });
        let (view, cx) = open_window(cx, "viewer", main, layout);
        let open = |spec: serde_json::Value, cx: &mut gpui::VisualTestContext| {
            view.update_in(cx, |this, window, cx| {
                this.sync_folders(window, cx);
                let id = crate::mods::new_overlay_id();
                this.open_overlay(id.clone(), spec, window, cx);
                id
            })
        };
        let copy = |slot: &str, cx: &mut gpui::VisualTestContext| view.update(cx, |this, _| this.copies[slot].id);
        // What the last frame gave a copy: its layer, its holes' x and its dim.
        let seen = |c: u64, cx: &mut gpui::VisualTestContext| {
            view.update(cx, |_, cx| cx.notify());
            cx.run_until_parked();
            let (layer, covers, dim) = last_frame(c).expect("drawn");
            let mut xs: Vec<i64> = covers.iter().map(|c| c.rect.x.round() as i64).collect();
            xs.sort();
            (layer, xs, dim)
        };
        let player = open(json!({ "mod": "viewer", "kind": "window", "key": "player", "frame": "none", "width": 300, "height": 200 }), cx);
        view.update(cx, |this, _| this.overlays.iter_mut().find(|o| o.id == player).unwrap().place = Some(point(px(10.0), px(10.0))));
        cx.run_until_parked();
        let pane = view.update(cx, |this, _| this.copies.iter().find(|(s, c)| !s.starts_with("overlay:") && c.inst.name == "viewer").map(|(_, c)| c.id).unwrap());
        let player_copy = copy(&format!("overlay:{player}"), cx);
        let base = Layer { z: 0, float: false };
        let on = |z| Layer { z, float: false };
        assert_eq!(seen(pane, cx), (base, vec![10], false), "the player cuts the pane under it");
        assert_eq!(seen(player_copy, cx), (on(1), vec![], false), "the player's own card doesn't");

        // A window opened over the player, with its dim (like the git window).
        let git = open(json!({ "mod": "viewer", "kind": "window", "key": "git", "frame": "none", "scrim": true, "width": 300, "height": 200 }), cx);
        view.update(cx, |this, _| this.overlays.iter_mut().find(|o| o.id == git).unwrap().place = Some(point(px(200.0), px(10.0))));
        let git_copy = copy(&format!("overlay:{git}"), cx);
        assert_eq!(seen(player_copy, cx), (on(1), vec![200], true), "the git window cuts and dims the player");
        assert_eq!(seen(git_copy, cx), (on(2), vec![], false));
        assert_eq!(seen(pane, cx), (base, vec![10, 200], true));

        // A popup (a menu, the notification center) over both.
        let popup = open(json!({ "mod": "viewer", "kind": "popup", "at": { "x": 400, "y": 300 }, "frame": "none", "width": 100, "height": 50 }), cx);
        let popup_copy = copy(&format!("overlay:{popup}"), cx);
        let (_, xs, _) = seen(player_copy, cx);
        assert_eq!(xs.len(), 2, "the git window and the popup cut the player: {xs:?}");
        assert_eq!(seen(popup_copy, cx).1, Vec::<i64>::new(), "nothing is above the popup");
        assert_eq!(seen(popup_copy, cx).0, on(3));

        // The player raised (pressed, overlay.focus): it's above the git window and its dim now, still under the popup.
        view.update(cx, |this, cx| this.raise_window(&player, cx));
        let (layer, xs, dim) = seen(player_copy, cx);
        assert_eq!((layer, xs.len(), dim), (on(2), 1, false), "only the popup is above the raised player");
        assert_eq!(seen(git_copy, cx).0, on(1));
        assert!(seen(git_copy, cx).1.contains(&10), "the raised player cuts the git window");

        // Closed: nothing above the player.
        view.update_in(cx, |this, window, cx| {
            this.close_overlay(&popup, window, cx);
            this.close_overlay(&git, window, cx);
        });
        assert_eq!(seen(player_copy, cx), (on(1), vec![], false));
    }

    #[test]
    fn a_layouts_update_note_closes_from_its_close_button() {
        in_own_process("update_note_close");
    }

    /// The update note a layout's mod draws (dialog_mods.update, as Nocturne's):
    /// a real click on its × hides it.
    #[gpui::test]
    fn update_note_close(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("update_note_close") {
            return;
        }
        let note = r#"import { View, div } from "gpui-kit";
import { props, shared, setShared } from "herdr";
export default class Note extends View {
  render() {
    const p = props() ?? {};
    if (!p.label || shared("note.dismissed") === p.dismissal) { setShared("note.drawn", "gone"); return div(); }
    setShared("note.drawn", "shown");
    return div().size_full().flex().justify_end()
      .child(div().id("upd-x").w(30).h_full().on_click(() => setShared("note.dismissed", p.dismissal)));
  }
}
"#;
        let layout = json!({ "id": "root", "type": "row", "dialog_mods": { "update": "note" }, "children": [] });
        let (view, cx) = open_window(cx, "note", note, layout);
        view.update_in(cx, |this, window, cx| {
            this.sync_folders(window, cx);
            this.update_success = true;
            this.sync(window, cx);
            cx.notify();
        });
        cx.run_until_parked();
        assert!(view.update(cx, |this, _| this.copies.contains_key(super::UPDATE_NOTE)), "the note's copy is made");
        let shown = |cx: &mut gpui::VisualTestContext| view.update(cx, |this, _| this.update_note().is_some()) && crate::mods::shared("note.dismissed").is_none();
        assert!(shown(cx));
        assert_eq!(crate::mods::shared("note.drawn"), Some(json!("shown")));
        // The ×: the note's right end, 16 px from the window's bottom right.
        let viewport = cx.update(|window, _| window.viewport_size());
        let at = point(viewport.width - px(16.0 + 15.0), viewport.height - px(16.0 + super::UPDATE_PILL_HEIGHT / 2.0));
        // While the button is down, another mod changes a shared value (the sky, the usage
        // section, the bell do every few seconds): every copy draws again before the release.
        cx.simulate_mouse_down(at, gpui::MouseButton::Left, gpui::Modifiers::default());
        cx.run_until_parked();
        crate::mods::set_shared("note.elsewhere".into(), json!(1));
        cx.run_until_parked();
        view.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        cx.simulate_mouse_up(at, gpui::MouseButton::Left, gpui::Modifiers::default());
        cx.run_until_parked();
        assert_eq!(crate::mods::shared("note.dismissed"), Some(json!(format!("Updated to {}", env!("CARGO_PKG_VERSION")))), "the click reached the ×");
        assert_eq!(crate::mods::shared("note.drawn"), Some(json!("gone")), "the note drew itself again, gone");
    }

    #[test]
    fn a_windows_close_button_closes_it() {
        in_own_process("window_close_button");
    }

    /// A window overlay drawn by a layout's mod (Nocturne's What's New): its
    /// header's ×, which stops the press (no window drag) and closes on click.
    #[gpui::test]
    fn window_close_button(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("window_close_button") {
            return;
        }
        let main = r#"import { View, div } from "gpui-kit";
import { props, closeOverlay } from "herdr";
export default class W extends View {
  render() {
    return div().size_full().flex().flex_col()
      .child(div().h(40).flex().justify_end()
        .child(div().id("scr-close").w(24).h(24).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => closeOverlay(props().overlay))));
  }
}
"#;
        let layout = json!({ "id": "root", "type": "row", "children": [] });
        let (view, cx) = open_window(cx, "win", main, layout);
        let id = view.update_in(cx, |this, window, cx| {
            this.sync_folders(window, cx);
            let id = crate::mods::new_overlay_id();
            this.open_overlay(id.clone(), json!({ "mod": "win", "kind": "window", "width": 400, "height": 300 }), window, cx);
            this.overlays.iter_mut().find(|o| o.id == id).unwrap().place = Some(point(px(100.0), px(100.0)));
            id
        });
        cx.run_until_parked();
        cx.run_until_parked();
        let open = |cx: &mut gpui::VisualTestContext| view.update(cx, |this, _| this.overlays.iter().any(|o| o.id == id));
        assert!(open(cx));
        // Another window opened after it (a kept Git or PiP window, say), beside it: a press raises ours first.
        view.update_in(cx, |this, window, cx| {
            let other = crate::mods::new_overlay_id();
            this.open_overlay(other.clone(), json!({ "mod": "win", "kind": "window", "width": 200, "height": 200 }), window, cx);
            this.overlays.iter_mut().find(|o| o.id == other).unwrap().place = Some(point(px(600.0), px(400.0)));
        });
        cx.run_until_parked();
        // The ×: 12 px in from the window's right edge, 12 px down (a 1 px border around the body).
        cx.simulate_click(point(px(100.0 + 400.0 - 13.0), px(100.0 + 13.0)), gpui::Modifiers::default());
        cx.run_until_parked();
        assert!(!open(cx), "the × closed the window");
    }

    #[test]
    fn the_pip_player_drags_by_its_video() {
        in_own_process("pip_drag_by_video");
    }

    /// The shipped picture in picture player (nocturne-pip) in its window: a
    /// left press on the video (which the native view hands to Fireflies,
    /// fireflies-native-view's Kind::gives_left_presses) is the window's. Moved
    /// under 4 px it's a click: the window stays and the player takes the
    /// keyboard; moved further it drags the window by the video, as by its bar.
    #[gpui::test]
    fn pip_drag_by_video(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("pip_drag_by_video") {
            return;
        }
        let shipped = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("defaults/mods/nocturne-pip");
        let home = crate::mods::app_dir();
        let to = home.join("mods/nocturne-pip");
        std::fs::create_dir_all(to.join("icons")).unwrap();
        for e in std::fs::read_dir(&shipped).unwrap().flatten().chain(std::fs::read_dir(shipped.join("icons")).unwrap().flatten()) {
            if e.path().is_file() {
                let rel = e.path().strip_prefix(&shipped).unwrap().to_owned();
                std::fs::copy(e.path(), to.join(rel)).unwrap();
            }
        }
        let layout = json!({ "id": "root", "type": "row", "children": [] });
        let (view, cx) = open_window(cx, "noop", "", layout);
        let id = view.update_in(cx, |this, window, cx| {
            this.sync_folders(window, cx);
            let id = crate::mods::new_overlay_id();
            this.open_overlay(id.clone(), json!({ "mod": "nocturne-pip", "kind": "window", "key": "nocturne-pip", "frame": "none", "width": 384, "height": 238,
                "resizable": { "min": [240, 158], "aspect": 16.0 / 9.0, "chrome": [2, 24] }, "props": { "of": "1:web" } }), window, cx);
            this.overlays.iter_mut().find(|o| o.id == id).unwrap().place = Some(point(px(100.0), px(100.0)));
            id
        });
        cx.run_until_parked();
        cx.run_until_parked();
        let place = |cx: &mut gpui::VisualTestContext| view.update(cx, |this, _| this.overlays.iter().find(|o| o.id == id).and_then(|o| o.place));
        let keys = |cx: &mut gpui::VisualTestContext| view.update_in(cx, |this, window, cx| this.window_has_keys(&id, window, cx));
        assert!(!keys(cx));
        let none = gpui::Modifiers::default();
        let left = gpui::MouseButton::Left;
        // The video's middle: under the 22 px bar (and the 1 px border).
        let video = point(px(100.0 + 192.0), px(100.0 + 24.0 + 105.0));
        // A click: pressed, moved 3 px, let go. The window stays; the player has the keyboard.
        cx.simulate_mouse_down(video, left, none);
        cx.simulate_mouse_move(video + point(px(3.0), px(0.0)), left, none);
        cx.simulate_mouse_up(video + point(px(3.0), px(0.0)), left, none);
        cx.run_until_parked();
        assert_eq!(place(cx), Some(point(px(100.0), px(100.0))), "a click doesn't move it");
        assert!(keys(cx), "a click on the video gives the player the keyboard");
        // A drag: past 4 px the window follows; let go, it stays there.
        cx.simulate_mouse_down(video, left, none);
        for step in [5.0, 20.0, 40.0] {
            cx.simulate_mouse_move(video + point(px(step), px(step * 0.75)), left, none);
            cx.run_until_parked();
        }
        cx.simulate_mouse_up(video + point(px(40.0), px(30.0)), left, none);
        cx.run_until_parked();
        assert_eq!(place(cx), Some(point(px(140.0), px(130.0))), "dragged by the video");
        // By the bar's title, as before.
        let title = point(px(140.0 + 30.0), px(130.0 + 11.0));
        cx.simulate_mouse_down(title, left, none);
        cx.simulate_mouse_move(title + point(px(-20.0), px(10.0)), left, none);
        cx.run_until_parked();
        cx.simulate_mouse_up(title + point(px(-20.0), px(10.0)), left, none);
        cx.run_until_parked();
        assert_eq!(place(cx), Some(point(px(120.0), px(140.0))), "dragged by its bar");
    }

    #[test]
    fn nocturnes_update_note_closes_from_its_close_button() {
        in_own_process("nocturne_update_note");
    }

    /// Nocturne's own update note (the shipped mod, dialog_mods.update), at zoom 1
    /// and 0.9: a press and release where its × is drawn, near the window's
    /// bottom right corner, hides it.
    #[gpui::test]
    fn nocturne_update_note(cx: &mut gpui::TestAppContext) {
        use serde_json::json;
        if !running_alone("nocturne_update_note") {
            return;
        }
        fn copy(from: &std::path::Path, to: &std::path::Path) {
            std::fs::create_dir_all(to).unwrap();
            for e in std::fs::read_dir(from).unwrap().flatten() {
                let t = to.join(e.file_name());
                if e.path().is_dir() { copy(&e.path(), &t) } else { std::fs::copy(e.path(), &t).unwrap(); }
            }
        }
        let shipped = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("defaults/mods");
        // A terminal under the note, as in a real window: its press starts a selection.
        let layout = json!({ "id": "root", "type": "row", "dialog_mods": { "update": "nocturne" }, "children": [
            { "id": "terminal", "type": "block", "content": { "terminal": "t1" } }
        ] });
        let home = crate::mods::app_dir();
        copy(&shipped.join("nocturne"), &home.join("mods/nocturne"));
        copy(&shipped.join("workspace-chrome"), &home.join("mods/workspace-chrome"));
        let (view, cx) = open_window(cx, "noop", "", layout);
        let label = json!(format!("Updated to {}", env!("CARGO_PKG_VERSION")));
        for zoom in [1.0_f32, 0.9] {
            let mut st = (*crate::settings::get()).clone();
            st.zoom = zoom;
            crate::settings::set(st);
            crate::mods::set_shared("nocturne.update-dismissed".into(), json!(null));
            view.update_in(cx, |this, window, cx| {
                this.sync_folders(window, cx);
                this.update_success = true;
                this.sync(window, cx);
                cx.notify();
            });
            cx.run_until_parked();
            assert!(view.update(cx, |this, _| this.copies.contains_key(super::UPDATE_NOTE)), "zoom {zoom}: the note's copy");
            let shown = cx.debug_bounds("nocturne-update");
            // Where Nocturne draws the ×: the note's right end, 16 + 4 px in, 22 px wide, the note 34 px tall, 16 px up.
            let viewport = cx.update(|window, _| window.viewport_size());
            let at = point(viewport.width - px(31.0 * zoom), viewport.height - px(33.0 * zoom));
            cx.simulate_mouse_down(at, gpui::MouseButton::Left, gpui::Modifiers::default());
            cx.run_until_parked();
            cx.simulate_mouse_up(at, gpui::MouseButton::Left, gpui::Modifiers::default());
            cx.run_until_parked();
            assert_eq!(crate::mods::shared("nocturne.update-dismissed"), Some(label.clone()), "zoom {zoom}: the × at {at:?} (note {shown:?}, window {viewport:?})");
        }
    }
}
