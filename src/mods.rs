//! Mods: folders of JavaScript under ~/.config/herdr-app/mods that agents write and
//! Herdr runs live (gpui-shell), plus the `herdr` module they import.

use crate::layout::Node;
use gpui::App;
use gpui_shell::{Capabilities, ExecuteGrant, HostError, HostModule, HostObject, HostValue, NetworkGrant};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::rc::{Rc, Weak};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

include!(concat!(env!("OUT_DIR"), "/default_mods.rs"));
include!(concat!(env!("OUT_DIR"), "/frame_mods.rs"));

#[cfg(test)]
mod render_tests;
#[cfg(test)]
mod lifecycle_tests;

/// The frame's own mods (welcome, ...): the app's, not the person's. Written
/// from the binary on every start, so no edit or broken mod can break them.
/// Loaded as `frame-<name>`.
pub fn frame_dir() -> PathBuf {
    app_dir().join("frame")
}

pub fn home() -> PathBuf {
    // HOME, or the profile folder on Windows.
    std::env::home_dir().unwrap_or_else(|| "/".into())
}

/// The fonts on this machine (`fonts()`): read when the window opens and
/// again when the home brings new ones.
static FONTS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn note_fonts(cx: &gpui::App) {
    // Names starting with "." are the system's private UI fonts (macOS).
    let mut names: Vec<String> = cx.text_system().all_font_names().into_iter().filter(|n| !n.starts_with('.')).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    *FONTS.lock().unwrap() = names;
}

/// The app's home: `$HERDR_APP_HOME` (tests, experiments), else
/// `$XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app`, on every OS.
pub fn app_dir() -> PathBuf {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    env("HERDR_APP_HOME").unwrap_or_else(|| env("XDG_CONFIG_HOME").unwrap_or_else(|| home().join(".config")).join("herdr-app"))
}

pub fn mods_dir() -> PathBuf {
    app_dir().join("mods")
}

const AGENTS_MD: &str = include_str!("../defaults/AGENTS.md");

/// Writes the agent guide and API types, and installs or updates the default
/// mods. Shipped mods are replaced whole; edits are first moved to a clone.
pub fn write_workspace() -> std::io::Result<()> {
    let dir = app_dir();
    std::fs::create_dir_all(mods_dir())?;
    write_if_changed(&dir.join("AGENTS.md"), AGENTS_MD)?;
    // Agents read AGENTS.md now; the pointer file we used to write goes (only ours).
    if std::fs::read_to_string(dir.join("CLAUDE.md")).is_ok_and(|s| s == "@AGENTS.md\n") {
        let _ = std::fs::remove_file(dir.join("CLAUDE.md"));
    }
    write_if_changed(&dir.join("herdr.d.ts"), DECLARATIONS)?;
    let types = gpui_shell::type_declarations(&gpui_shell::FrozenComponentRegistry::default());
    write_if_changed(&dir.join("gpui-kit.d.ts"), &types)?;
    let _ = std::fs::remove_dir_all(frame_dir());
    for (path, bytes) in FRAME_MODS {
        let file = frame_dir().join(path);
        std::fs::create_dir_all(file.parent().unwrap())?;
        std::fs::write(&file, bytes)?;
    }
    let shipped: Vec<(&str, &[u8])> = shipped_mods().iter().map(|(p, b)| (p.as_str(), b.as_slice())).collect();
    sync_defaults(&mods_dir(), &dir.join("installed.json"), &shipped)
}

/// The default mods: the ones built into the binary, plus whole mod folders
/// a packager puts in the app's resources (macOS: `Fireflies.app/Contents/
/// Resources/mods/<name>/`), which replace a built-in one of the same name.
/// They install and update the same way; shipping them beside the binary
/// lets a mod change without rebuilding the app.
fn shipped_mods() -> &'static [(String, Vec<u8>)] {
    static SHIPPED: OnceLock<Vec<(String, Vec<u8>)>> = OnceLock::new();
    SHIPPED.get_or_init(|| {
        let bundled = resource_mods_dir().map(|dir| read_mod_folders(&dir)).unwrap_or_default();
        merge_shipped(DEFAULT_MODS, bundled)
    })
}

/// `Contents/Resources/mods` of the app bundle holding this binary, if it has one.
fn resource_mods_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let dir = exe.parent()?.parent()?.join("Resources").join("mods");
    dir.is_dir().then_some(dir)
}

/// Every file under each mod folder in `dir`, as `<mod>/<path>` (hidden ones skipped).
fn read_mod_folders(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
        entries.sort();
        for path in entries {
            if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else if let (Ok(rel), Ok(bytes)) = (path.strip_prefix(root), std::fs::read(&path)) {
                out.push((rel.to_string_lossy().replace('\\', "/"), bytes));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    // Only files inside a mod folder, not loose ones at the top.
    out.retain(|(p, _)| p.contains('/'));
    out
}

/// The built-in mods with every mod named in `bundled` replaced by that one, whole.
fn merge_shipped(built_in: &[(&str, &[u8])], bundled: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    let name = |p: &str| p.split('/').next().unwrap_or_default().to_owned();
    let replaced: std::collections::BTreeSet<String> = bundled.iter().map(|(p, _)| name(p)).collect();
    let mut all: Vec<(String, Vec<u8>)> = built_in
        .iter()
        .filter(|(p, _)| !replaced.contains(&name(p)))
        .map(|(p, b)| ((*p).to_owned(), b.to_vec()))
        .collect();
    all.extend(bundled);
    all
}

static SYNC_NOTES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn take_sync_notes() -> Vec<String> {
    std::mem::take(&mut *SYNC_NOTES.lock().unwrap())
}

fn edited_note(clone: &str) {
    SYNC_NOTES.lock().unwrap().push(clone.to_owned());
}

fn edited_name(parent: &Path, name: &str, suffix: &str) -> String {
    (1..).map(|i| if i == 1 { format!("{name}-edited") } else { format!("{name}-edited-{i}") })
        .find(|n| !parent.join(format!("{n}{suffix}")).exists()).unwrap()
}

fn sync_defaults(mods: &Path, installed_path: &Path, shipped_mods: &[(&str, &[u8])]) -> std::io::Result<()> {
    let text = std::fs::read_to_string(installed_path).unwrap_or_default();
    let mut installed: Installed = serde_json::from_str(&text).unwrap_or_default();
    let names: std::collections::BTreeSet<&str> = shipped_mods.iter().filter_map(|(p, _)| p.split('/').next()).collect();
    let dropped: Vec<String> = installed.keys().filter(|n| !n.starts_with("layout:") && !names.contains(n.as_str())).cloned().collect();
    for name in dropped {
        let target = mods.join(&name);
        if installed.get(&name).is_some_and(|was| target.exists() && as_shipped(&target, was)) {
            std::fs::remove_dir_all(&target)?;
        }
        installed.remove(&name);
    }
    for name in names {
        let target = mods.join(name);
        let shipped: Files = shipped_mods.iter()
            .filter_map(|(p, bytes)| Some((p.strip_prefix(&format!("{name}/"))?.to_owned(), fingerprint(bytes))))
            .collect();
        if installed.get(name) == Some(&shipped) && target.exists() && as_shipped(&target, &shipped) {
            continue;
        }
        if target.exists() {
            if !as_shipped(&target, installed.get(name).unwrap_or(&shipped)) {
                let clone = edited_name(mods, name, "");
                std::fs::rename(&target, mods.join(&clone))?;
                edited_note(&clone);
            } else {
                std::fs::remove_dir_all(&target)?;
            }
        }
        for (path, bytes) in shipped_mods.iter().filter(|(p, _)| p.starts_with(&format!("{name}/"))) {
            let file = mods.join(path);
            std::fs::create_dir_all(file.parent().unwrap())?;
            std::fs::write(&file, bytes)?;
            // A mod's bin/ holds programs its terminals run (Nocturne's lazygit wrapper).
            #[cfg(unix)]
            if path.split('/').nth(1) == Some("bin") {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755))?;
            }
        }
        installed.insert(name.to_owned(), shipped);
    }
    write_if_changed(installed_path, serde_json::to_string_pretty(&installed).unwrap() + "\n")
}

pub fn sync_layouts(home: &Path, layouts: &[(&str, &str)]) -> std::io::Result<()> {
    let record = home.join("installed.json");
    let mut installed: Installed = serde_json::from_str(&std::fs::read_to_string(&record).unwrap_or_default()).unwrap_or_default();
    let dir = home.join("layouts");
    std::fs::create_dir_all(&dir)?;
    if dir.join(".base").exists() {
        std::fs::remove_dir_all(dir.join(".base"))?;
    }
    let dropped: Vec<String> = installed.keys().filter(|k| k.strip_prefix("layout:").is_some_and(|n| !layouts.iter().any(|(name, _)| *name == n))).cloned().collect();
    for key in dropped {
        let path = dir.join(format!("{}.json", &key["layout:".len()..]));
        if path.exists() && installed[&key].get("json").is_some_and(|hash| std::fs::read_to_string(&path).is_ok_and(|text| layout_fingerprint(&text) == *hash)) {
            std::fs::remove_file(path)?;
            let _ = std::fs::remove_file(dir.join(".state").join(format!("{}.json", &key["layout:".len()..])));
        }
        installed.remove(&key);
    }
    for (name, text) in layouts {
        let key = format!("layout:{name}");
        let hash = layout_fingerprint(text);
        let path = dir.join(format!("{name}.json"));
        if path.exists() {
            let current = layout_fingerprint(&std::fs::read_to_string(&path)?);
            let Some(was) = installed.get(&key).and_then(|f| f.get("json")) else {
                // From 0.1.x, which recorded no layouts: whether it was edited is
                // unknowable, so no rescue copy and no toast; kept aside, quietly.
                if current != hash {
                    std::fs::rename(&path, dir.join(format!("{name}.json.before-{}", env!("CARGO_PKG_VERSION"))))?;
                }
                std::fs::write(&path, text)?;
                installed.insert(key, [("json".into(), hash)].into());
                continue;
            };
            if current != *was && current != hash {
                let clone = edited_name(&dir, name, ".json");
                copy_layout_state(home, name, &clone)?;
                std::fs::rename(&path, dir.join(format!("{clone}.json")))?;
                edited_note(&clone);
            }
        }
        std::fs::write(&path, text)?;
        installed.insert(key, [("json".into(), hash)].into());
    }
    write_if_changed(&record, serde_json::to_string_pretty(&installed).unwrap() + "\n")
}

fn layout_fingerprint(text: &str) -> String {
    let canonical = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok().map(|mut v| {
        crate::layout_sync::normalize(&mut v);
        v.sort_all_objects();
        v.to_string()
    });
    fingerprint(canonical.as_deref().unwrap_or(text).as_bytes())
}

pub fn copy_layout_state(home: &Path, name: &str, to: &str) -> std::io::Result<()> {
    let dir = home.join("layouts/.state");
    match std::fs::copy(dir.join(format!("{name}.json")), dir.join(format!("{to}.json"))) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !dir.join(format!("{name}.json")).exists() => {
            match std::fs::remove_file(dir.join(format!("{to}.json"))) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e),
            }
        }
        Err(e) => Err(e),
    }
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn clone_mod(name: &str, to: &str) -> std::io::Result<()> {
    clone_mod_at(&mods_dir(), name, to)
}

fn clone_mod_at(mods: &Path, name: &str, to: &str) -> std::io::Result<()> {
    if !valid_name(name) || !valid_name(to) {
        return Err(std::io::Error::other("names use letters, digits, - or _"));
    }
    let source = mods.join(name);
    let target = mods.join(to);
    if !source.is_dir() {
        return Err(std::io::Error::other("no such mod"));
    }
    std::fs::create_dir(&target)?;
    fn copy(source: &Path, target: &Path, from: &str, to: &str) -> std::io::Result<()> {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let dest = target.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                std::fs::create_dir(&dest)?;
                copy(&entry.path(), &dest, from, to)?;
            } else {
                let bytes = std::fs::read(entry.path())?;
                std::fs::copy(entry.path(), &dest)?;
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    let mut text = text.replace(&format!("mods/{from}/"), &format!("mods/{to}/"))
                        .replace(&format!("\"mods/{from}\""), &format!("\"mods/{to}\""))
                        .replace(&format!("'mods/{from}'"), &format!("'mods/{to}'"));
                    for key in ["mod", "\"mod\"", "'mod'"] {
                        for space in ["", " "] {
                            for quote in ["\"", "'"] {
                                text = text.replace(&format!("{key}:{space}{quote}{from}{quote}"), &format!("{key}:{space}{quote}{to}{quote}"));
                            }
                        }
                    }
                    std::fs::write(dest, text)?;
                }
            }
        }
        Ok(())
    }
    let result = (|| {
        copy(&source, &target, name, to)?;
        let path = target.join("mod.json");
        let mut meta: Value = if path.exists() { serde_json::from_str(&std::fs::read_to_string(&path)?)? } else { json!({}) };
        let Some(object) = meta.as_object_mut() else {
            return Err(std::io::Error::other("mod.json must be an object"));
        };
        object.insert("cloned_from".into(), json!({ "name": name, "version": env!("CARGO_PKG_VERSION") }));
        std::fs::write(path, serde_json::to_string_pretty(&meta)?)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(target);
    }
    result
}

/// Exactly as installed: every file unchanged and none added.
fn as_shipped(dir: &Path, files: &Files) -> bool {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = e.path();
            if path.is_dir() {
                walk(root, &path, out);
            } else if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let mut found = Vec::new();
    walk(dir, dir, &mut found);
    // gpui-shell writes these editor helpers when it loads a mod.
    found.retain(|f| !matches!(f.as_str(), "gpui-kit.d.ts" | "jsconfig.json") || files.contains_key(f));
    found.len() == files.len() && found.iter().all(|f| files.contains_key(f)) && untouched(dir, files)
}

/// File path (inside the mod) to content fingerprint.
type Files = std::collections::BTreeMap<String, String>;
/// Default mods Herdr installed, with the files as installed.
type Installed = std::collections::BTreeMap<String, Files>;

/// FNV-1a: stable across builds, unlike std's hasher.
fn fingerprint(bytes: &[u8]) -> String {
    let h = bytes.iter().fold(0xcbf29ce484222325u64, |h, b| (h ^ *b as u64).wrapping_mul(0x100000001b3));
    format!("{h:016x}")
}

/// Whether every file Herdr installed is still there as installed.
fn untouched(dir: &Path, files: &Files) -> bool {
    files.iter().all(|(path, want)| std::fs::read(dir.join(path)).is_ok_and(|b| fingerprint(&b) == *want))
}

fn write_if_changed(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    let content = content.as_ref();
    if std::fs::read(path).ok().as_deref() != Some(content) {
        std::fs::write(path, content)?;
    }
    Ok(())
}

/// Where a mod would like to go the first time it appears (mod.json).
#[derive(Deserialize, Default, Clone)]
pub struct Hint {
    #[serde(default)]
    pub place: Option<String>,
    #[serde(default)]
    pub size: Option<f32>,
    /// `pane.go` can give it the keyboard.
    #[serde(default)]
    pub focusable: bool,
}

#[derive(Clone)]
pub struct Found {
    pub id: String,
    pub dir: PathBuf,
    pub hint: Hint,
    pub stamp: SystemTime,
}

/// Every mod folder that has a main.js.
pub fn scan() -> Vec<Found> {
    let mut found = scan_dir(&mods_dir(), "");
    found.extend(scan_dir(&frame_dir(), "frame-"));
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
}

fn scan_dir(root: &Path, prefix: &str) -> Vec<Found> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.path().join("main.js").is_file())
        .filter_map(|e| {
            let id = format!("{prefix}{}", e.file_name().to_str()?);
            if id.starts_with('.') {
                return None;
            }
            let dir = e.path();
            let hint = std::fs::read_to_string(dir.join("mod.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let stamp = std::fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|f| f.metadata().ok()?.modified().ok())
                .max()
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some(Found { id, dir, hint, stamp })
        })
        .collect()
}

/// What mods ask of the window.
pub enum Request {
    Run { name: String, args: Value },
    OpenOverlay { id: String, spec: Value },
    CloseOverlay { id: String },
    Refresh,
    /// From `herdr-app do` / `herdr-app status` (control.rs); answer on `reply`.
    Control { cmd: Value, reply: std::sync::mpsc::Sender<Value> },
}

static REQUESTS: OnceLock<async_channel::Sender<Request>> = OnceLock::new();

thread_local! {
    static FINAL_KILLS: RefCell<Option<(std::sync::Arc<crate::hc::Core>, std::time::Instant)>> = const { RefCell::new(None) };
}

/// The event loop stops before queued commands run at quit. Send final terminal
/// kills to the core now, bounded by the same deadline as the mod's cleanup.
pub fn final_cleanup(core: std::sync::Arc<crate::hc::Core>, deadline: std::time::Instant, body: impl FnOnce()) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) { FINAL_KILLS.with_borrow_mut(|slot| { slot.take(); }); }
    }
    FINAL_KILLS.with_borrow_mut(|slot| {
        assert!(slot.is_none(), "nested final cleanup");
        *slot = Some((core, deadline));
    });
    let _reset = Reset;
    body();
}

/// Navigation order set by the mod that lists agents, with stale entries removed and new agents appended.
pub fn agent_order(available: Vec<String>) -> Vec<String> {
    AGENT_ORDER.with(|s| {
        let mut order = Vec::new();
        for addr in s.borrow().iter().chain(available.iter()) {
            if available.contains(addr) && !order.contains(addr) {
                order.push(addr.clone());
            }
        }
        order
    })
}

pub fn shared(key: &str) -> Option<Value> {
    with_shared(|s| s.values.get(key).cloned())
}

/// Sets a value every mod can read (persisted in shared.json); mods re-render.
pub fn set_shared(key: String, value: Value) {
    if with_shared(|s| s.set(key, value)) {
        request(Request::Refresh);
    }
}

fn with_shared<R>(f: impl FnOnce(&mut SharedStore) -> R) -> R {
    SHARED.with_borrow_mut(|slot| f(slot.get_or_insert_with(|| SharedStore::load(app_dir().join("shared.json")))))
}

/// Called after mod close handlers, so their last changes reach disk before exit.
pub fn finish_shared() {
    SHARED.with_borrow_mut(|slot| {
        if let Some(store) = slot {
            store.finish();
        }
    });
}

struct SharedStore {
    values: serde_json::Map<String, Value>,
    path: PathBuf,
    writable: bool,
    writer: Option<(std::sync::mpsc::Sender<String>, std::thread::JoinHandle<()>)>,
}

impl SharedStore {
    fn load(path: PathBuf) -> Self {
        let mut writable = true;
        let values = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(values) => values,
                Err(error) => {
                    let backup = crate::window::aside(&path, "corrupt");
                    match std::fs::rename(&path, &backup) {
                        Ok(()) => tracing::warn!("{} is invalid ({error}); kept in {}", path.display(), backup.display()),
                        Err(e) => {
                            writable = false;
                            tracing::warn!("{} is invalid ({error}); cannot keep it aside: {e}; shared persistence disabled", path.display());
                        }
                    }
                    serde_json::Map::new()
                }
            },
            Err(error) => {
                if error.kind() != std::io::ErrorKind::NotFound {
                    writable = false;
                    tracing::warn!("cannot read {}: {error}; shared persistence disabled", path.display());
                }
                serde_json::Map::new()
            }
        };
        Self { values, path, writable, writer: None }
    }

    fn set(&mut self, key: String, value: Value) -> bool {
        if self.values.get(&key) == Some(&value) {
            return false;
        }
        self.values.insert(key, value);
        if self.writable {
            let (writer, _) = self.writer.get_or_insert_with(|| shared_writer(self.path.clone()));
            if let Err(error) = writer.send(serde_json::to_string(&self.values).expect("shared values encode as JSON")) {
                tracing::warn!("shared writer stopped: {error}");
            }
        }
        true
    }

    fn finish(&mut self) {
        if let Some((sender, worker)) = self.writer.take() {
            drop(sender);
            if worker.join().is_err() {
                tracing::warn!("shared writer stopped before saving finished");
            }
        }
    }
}

fn shared_writer(path: PathBuf) -> (std::sync::mpsc::Sender<String>, std::thread::JoinHandle<()>) {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let worker = std::thread::spawn(move || {
        while let Ok(mut text) = rx.recv() {
            // A burst needs only its newest snapshot. Never let an older write land last.
            for newer in rx.try_iter() {
                text = newer;
            }
            if let Err(error) = crate::persist::write_atomic(&path, text) {
                tracing::warn!("cannot write {}: {error}", path.display());
            }
        }
    });
    (tx, worker)
}

pub fn request_sender() -> Option<async_channel::Sender<Request>> {
    REQUESTS.get().cloned()
}

pub fn request(r: Request) {
    if let Some(tx) = REQUESTS.get() {
        let _ = tx.try_send(r);
    }
}

thread_local! {
    /// Snapshots the window publishes; mods read them synchronously and
    /// re-render when they change.
    static SNAPSHOT: RefCell<Snapshot> = RefCell::new(Snapshot::default());
    static AGENT_ORDER: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    static SHARED: RefCell<Option<SharedStore>> = const { RefCell::new(None) };
    /// Where key commands for each loaded copy go: (copy, mod, sender).
    static COMMANDS: RefCell<Vec<(u64, String, async_channel::Sender<String>)>> = const { RefCell::new(Vec::new()) };
    /// The copies on screen: only they get commands (a hidden copy kept alive must
    /// not act on the person's keys).
    static SHOWN_COPIES: RefCell<std::collections::HashSet<u64>> = RefCell::new(std::collections::HashSet::new());
    static LIVE_READS: RefCell<HashMap<u64, Weak<RefCell<LiveReads>>>> = RefCell::new(HashMap::new());
    static REVISIONS: RefCell<HashMap<&'static str, u64>> = RefCell::new(HashMap::new());
    static COPY_SEQ: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static OVERLAY_SEQ: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

pub struct Snapshot {
    pub layout: Value,
    pub spaces: Value,
    pub machines: Value,
    pub agents: Value,
    /// Every pane: { pane, terminal, tab, title, cwd, branch, status, app, focused, zoomed, font_zoom }.
    pub panes: Value,
    pub terminals: Value,
    pub focused: Value,
    /// Floating blocks by id: { edge, align, vertical }.
    pub floats: Value,
    /// { platform, titlebar, buttons, maximized, fullscreen, active }.
    pub window: Value,
}

impl Default for Snapshot {
    /// Lists start empty, never null, so mods can map over them right away.
    fn default() -> Self {
        Snapshot { layout: Value::Null, spaces: json!([]), machines: json!([]), agents: json!([]), panes: json!([]), terminals: json!([]), focused: Value::Null, floats: json!({}), window: Value::Null }
    }
}

/// Replaces one part of the snapshot; returns whether it changed.
fn publish(key: &'static str, set: impl FnOnce(&mut Snapshot) -> (Value, Value)) -> bool {
    let changed = SNAPSHOT.with(|s| {
        let (old, new) = set(&mut s.borrow_mut());
        old != new
    });
    if changed {
        REVISIONS.with_borrow_mut(|r| *r.entry(key).or_default() += 1);
    }
    changed
}

pub fn publish_layout(layout: &Node) -> bool {
    let v = serde_json::to_value(layout).unwrap_or(Value::Null);
    publish("layout", |s| (std::mem::replace(&mut s.layout, v.clone()), v))
}
pub fn publish_machines(v: Value) -> bool {
    publish("machines", |s| (std::mem::replace(&mut s.machines, v.clone()), v))
}
pub fn publish_spaces(v: Value) -> bool {
    publish("spaces", |s| (std::mem::replace(&mut s.spaces, v.clone()), v))
}
pub fn publish_agents(v: Value) -> bool {
    publish("agents", |s| (std::mem::replace(&mut s.agents, v.clone()), v))
}
pub fn publish_panes(v: Value) -> bool {
    publish("panes", |s| (std::mem::replace(&mut s.panes, v.clone()), v))
}
pub fn publish_terminals(v: Value) -> bool {
    publish("terminals", |s| (std::mem::replace(&mut s.terminals, v.clone()), v))
}
/// Marks `terminals()` entries `floating`: the one shown floating over the tab (or
/// none), with its `floating_view` (the view it shows) and `float_views` (their names).
pub fn publish_floating(address: Option<&str>, view: Value, views: Value) -> bool {
    let changed = SNAPSHOT.with(|s| {
        let mut s = s.borrow_mut();
        let mut changed = false;
        for t in s.terminals.as_array_mut().into_iter().flatten() {
            let floating = address.is_some() && t["address"].as_str() == address;
            let marks = [
                ("floating", Value::Bool(floating)),
                ("floating_view", if floating { view.clone() } else { Value::Null }),
                ("float_views", if floating { views.clone() } else { Value::Null }),
            ];
            let Some(o) = t.as_object_mut() else { continue };
            for (k, v) in marks {
                if o.get(k) != Some(&v) {
                    o.insert(k.into(), v);
                    changed = true;
                }
            }
        }
        changed
    });
    if changed {
        REVISIONS.with_borrow_mut(|r| *r.entry("terminals").or_default() += 1);
    }
    changed
}
pub fn terminal_address(word: &str, source: &str) -> Option<String> {
    SNAPSHOT.with(|s| {
        let s = s.borrow();
        let live = s.terminals.as_array()?;
        crate::links::terminal_address(word, source, live.iter().filter_map(|t| t["address"].as_str()))
    })
}

pub fn publish_floats(v: Value) -> bool {
    publish("floats", |s| (std::mem::replace(&mut s.floats, v.clone()), v))
}
pub fn publish_window(v: Value) -> bool {
    publish("window", |s| (std::mem::replace(&mut s.window, v.clone()), v))
}
pub fn publish_focused(v: Value) -> bool {
    publish("focused", |s| (std::mem::replace(&mut s.focused, v.clone()), v))
}

#[derive(Default)]
struct LiveReads(HashMap<&'static str, u64>);

impl LiveReads {
    fn record(&mut self, key: &'static str, revisions: &HashMap<&'static str, u64>) {
        self.0.entry(key).or_insert_with(|| revisions.get(key).copied().unwrap_or(0));
    }

    fn changed(&mut self, revisions: &HashMap<&'static str, u64>) -> bool {
        let mut changed = false;
        for (key, seen) in &mut self.0 {
            let revision = revisions.get(key).copied().unwrap_or(0);
            changed |= *seen != revision;
            *seen = revision;
        }
        changed
    }
}

fn read(reads: &RefCell<LiveReads>, key: &'static str, f: impl FnOnce(&Snapshot) -> &Value) -> HostValue {
    REVISIONS.with_borrow(|r| reads.borrow_mut().record(key, r));
    SNAPSHOT.with(|s| to_host(f(&s.borrow())))
}

fn reader(reads: Rc<RefCell<LiveReads>>, key: &'static str, f: fn(&Snapshot) -> &Value) -> impl Fn(&gpui_shell::HostArguments) -> gpui_shell::HostResult {
    move |_| Ok(read(&reads, key, f))
}

/// Reads in callbacks and child views count too: keep their dependencies until the copy unloads.
pub fn snapshot_changed(copy: u64) -> bool {
    LIVE_READS.with_borrow(|copies| {
        copies.get(&copy).and_then(Weak::upgrade).is_some_and(|reads| {
            REVISIONS.with_borrow(|r| reads.borrow_mut().changed(r))
        })
    })
}

/// Delivers `command` to every shown copy of `mod`. Returns whether any listens.
pub fn send_command(name: &str, command: &str) -> bool {
    let shown = SHOWN_COPIES.with(|s| s.borrow().clone());
    COMMANDS.with(|c| {
        let mut c = c.borrow_mut();
        c.retain(|(_, _, tx)| !tx.is_closed());
        let mut any = false;
        for (copy, p, tx) in c.iter() {
            if p == name && shown.contains(copy) {
                any |= tx.try_send(command.to_owned()).is_ok();
            }
        }
        any
    })
}

/// Delivers `command` to one shown copy (the block given the keyboard, not
/// every copy of its mod).
pub fn send_command_to(copy: u64, command: &str) -> bool {
    if !SHOWN_COPIES.with(|s| s.borrow().contains(&copy)) {
        return false;
    }
    COMMANDS.with(|c| {
        let mut c = c.borrow_mut();
        c.retain(|(_, _, tx)| !tx.is_closed());
        c.iter().any(|(id, _, tx)| *id == copy && tx.try_send(command.to_owned()).is_ok())
    })
}

/// HUP: the copies on screen now, for native views (src/native_view.rs).
pub fn shown_copies() -> std::collections::HashSet<u64> {
    SHOWN_COPIES.with(|s| s.borrow().clone())
}

/// The copies on screen now (`prepare_load` numbers them).
pub fn set_shown_copies(copies: std::collections::HashSet<u64>) {
    SHOWN_COPIES.with(|s| *s.borrow_mut() = copies);
}

pub fn new_overlay_id() -> String {
    OVERLAY_SEQ.with(|s| {
        s.set(s.get() + 1);
        format!("o{}", s.get())
    })
}

/// One loaded copy of a mod: which folder, with which props.
#[derive(Clone, Debug, PartialEq)]
pub struct Instance {
    pub name: String,
    pub props: Value,
}

impl Instance {
    pub fn key(&self) -> String {
        if self.props.is_null() { self.name.clone() } else { format!("{}{}", self.name, self.props) }
    }
}

pub fn to_host(v: &Value) -> HostValue {
    match v {
        Value::Null => HostValue::Null,
        Value::Bool(b) => HostValue::Bool(*b),
        Value::Number(n) => HostValue::Number(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => HostValue::Str(s.clone()),
        Value::Array(a) => HostValue::Array(a.iter().map(to_host).collect()),
        Value::Object(o) => HostValue::Object(o.iter().map(|(k, v)| (k.clone(), to_host(v))).collect()),
    }
}

pub fn from_host(v: &HostValue) -> Value {
    match v {
        HostValue::Null => Value::Null,
        HostValue::Bool(b) => Value::Bool(*b),
        HostValue::Number(n) if n.fract() == 0.0 && n.abs() < 9e15 => Value::from(*n as i64),
        HostValue::Number(n) => serde_json::Number::from_f64(*n).map_or(Value::Null, Value::Number),
        HostValue::Str(s) => Value::String(s.clone()),
        HostValue::Array(a) => Value::Array(a.iter().map(from_host).collect()),
        HostValue::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), from_host(v))).collect()),
    }
}

pub const DECLARATIONS: &str = include_str!("../defaults/herdr.d.ts");

fn strings(v: Option<&HostValue>) -> Vec<String> {
    v.and_then(HostValue::as_array).map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

fn opt_str(v: Option<&HostValue>, key: &str) -> Option<String> {
    v.and_then(|o| o.get(key)).and_then(HostValue::as_str).map(str::to_owned)
}

const EXEC_LIMIT: Duration = Duration::from_secs(30);
const EXEC_MAX: Duration = Duration::from_secs(600);
const EXEC_OUTPUT: u64 = 8 << 20;

fn exec_limit(options: Option<&HostValue>) -> Result<Duration, HostError> {
    match options.and_then(|o| o.get("timeout")) {
        // `timeout: undefined` reaches here as Null: both mean the default, as omitting it does.
        None | Some(HostValue::Null) => Ok(EXEC_LIMIT),
        Some(HostValue::Number(ms)) if ms.is_finite() && *ms > 0.0 => Ok(Duration::from_secs_f64(ms.min(EXEC_MAX.as_millis() as f64) / 1000.0)),
        _ => Err(HostError::new("timeout must be a positive number of milliseconds")),
    }
}

pub(crate) fn run_blocking(command: &str, args: &[String], cwd: Option<String>, limit: Duration) -> Result<(i32, String, String), String> {
    use std::io::Read;
    let mut child = crate::spawn::command(command)
        .args(args)
        .current_dir(cwd.map(PathBuf::from).unwrap_or_else(home))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {command}: {e}"))?;
    // Bounded: a chatty command can't fill memory; the rest is drained and dropped.
    let drain = |r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut r = r;
            let _ = (&mut r).take(EXEC_OUTPUT).read_to_end(&mut buf);
            let _ = std::io::copy(&mut r, &mut std::io::sink());
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = drain(Box::new(child.stdout.take().unwrap()));
    let err = drain(Box::new(child.stderr.take().unwrap()));
    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{command} took longer than {} s and was stopped", limit.as_secs_f64()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok((status.code().unwrap_or(-1), out.join().unwrap_or_default(), err.join().unwrap_or_default()))
}

/// Runs a program on another machine through the core's exec: its exact output.
pub fn run_remote(machine: &str, command: &str, args: &[String], cwd: Option<String>) -> Result<(i32, Vec<u8>, Vec<u8>), String> {
    run_remote_with_limit(machine, command, args, cwd, EXEC_LIMIT)
}

fn run_remote_with_limit(machine: &str, command: &str, args: &[String], cwd: Option<String>, limit: Duration) -> Result<(i32, Vec<u8>, Vec<u8>), String> {
    use base64::Engine;
    let mut hc_args: Vec<String> = vec!["exec".into(), "--json".into(), "--on".into(), machine.into(), "--timeout".into(), limit.as_secs_f64().to_string()];
    if let Some(c) = cwd {
        hc_args.extend(["--cwd".into(), c]);
    }
    hc_args.push("--".into());
    hc_args.push(command.into());
    hc_args.extend(args.iter().cloned());
    // Let the remote timeout end the program and deliver its result before the wrapper expires.
    let (_, out, err) = run_blocking("hc", &hc_args, None, limit + Duration::from_secs(5))?;
    let v: Value = serde_json::from_str(out.trim()).or_else(|_| serde_json::from_str(err.trim())).map_err(|_| format!("hc exec: {}", err.trim()))?;
    if let Some(e) = v.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("hc exec failed").to_owned());
    }
    if v.get("timed_out").and_then(Value::as_bool) == Some(true) {
        return Err(format!("{command} took longer than {} s on {machine} and was stopped", limit.as_secs_f64()));
    }
    let bytes = |k: &str| base64::engine::general_purpose::STANDARD.decode(v.get(k).and_then(Value::as_str).unwrap_or_default()).map_err(|e| e.to_string());
    let code = v.get("code").and_then(Value::as_i64).map_or(-1, |c| c as i32);
    Ok((code, bytes("stdout")?, bytes("stderr")?))
}

/// The agents a machine can start (`knownAgents()`), asked at most once a minute.
fn known_agents(on: Option<String>, list: Vec<Value>) -> Result<Value, String> {
    type InstalledCache = std::collections::HashMap<Option<String>, (std::time::Instant, Vec<String>, Vec<String>)>;
    static SEEN: std::sync::Mutex<Option<InstalledCache>> = std::sync::Mutex::new(None);
    let commands: Vec<String> = list.iter().filter_map(|a| a["run"][0].as_str().map(str::to_owned)).collect();
    let cached = SEEN.lock().ok().and_then(|s| s.as_ref()?.get(&on).filter(|(at, checked, _)| at.elapsed().as_secs() < 60 && checked == &commands).map(|(_, _, v)| v.clone()));
    let have = if let Some(cached) = cached { cached } else {
        let found = crate::programs::installed(&commands, on.as_deref())?;
        if let Ok(mut s) = SEEN.lock() {
            s.get_or_insert_with(std::collections::HashMap::new).insert(on.clone(), (std::time::Instant::now(), commands, found.clone()));
        }
        found
    };
    Ok(Value::Array(
        list.into_iter()
            .map(|mut a| {
                let run = a["run"][0].as_str().unwrap_or_default().to_owned();
                a["installed"] = json!(have.contains(&run));
                a
            })
            .collect(),
    ))
}

/// A text file on another machine: `cat`, or `type` where there is none (Windows).
fn read_remote(machine: &str, path: &str) -> Result<Option<String>, String> {
    let (code, out, _) = match run_remote(machine, "cat", &["--".into(), path.into()], None) {
        Err(e) if e.contains("cannot start") => run_remote(machine, "cmd", &["/d".into(), "/c".into(), "type".into(), path.replace('/', "\\")], None)?,
        r => r?,
    };
    if code != 0 {
        return Ok(None);
    }
    if out.len() as u64 > crate::mod_files::LIMIT {
        return Err("Text file exceeds 1 MiB".into());
    }
    Ok(Some(String::from_utf8_lossy(&out).into_owned()))
}

fn exec_future(command: String, args: Vec<String>, cwd: Option<String>, on: Option<String>, limit: Duration) -> impl std::future::Future<Output = Result<HostValue, HostError>> + Send {
    let (tx, rx) = async_channel::bounded(1);
    let run = move || {
        let r = match on {
            Some(m) => run_remote_with_limit(&m, &command, &args, cwd, limit).map(|(c, o, e)| (c, String::from_utf8_lossy(&o).into_owned(), String::from_utf8_lossy(&e).into_owned())),
            None => run_blocking(&command, &args, cwd, limit),
        };
        let _ = tx.send_blocking(r);
    };
    #[cfg(not(test))]
    std::thread::spawn(run);
    // GPUI tests cannot be woken from a foreign thread. Queue the real result
    // before polling the receiver, without changing production dispatch.
    #[cfg(test)]
    run();
    async move {
        let (code, stdout, stderr) = rx.recv().await.map_err(|_| HostError::new("the command was lost"))?.map_err(HostError::new)?;
        Ok(HostObject::new().field("code", code as f64).field("stdout", stdout).field("stderr", stderr).into())
    }
}

/// Mod copies holding unsaved work (`setUnsaved`): their mod, props and what
/// they'd lose, so closing their pane or tab asks first.
static UNSAVED: std::sync::LazyLock<std::sync::Mutex<HashMap<u64, (String, Value, String)>>> = std::sync::LazyLock::new(Default::default);

/// Forgets a copy's unsaved note when it goes.
struct UnsavedGuard(u64);

impl Drop for UnsavedGuard {
    fn drop(&mut self) {
        UNSAVED.lock().unwrap().remove(&self.0);
    }
}

/// What the mod pane showing `name` with `props` would lose if closed now.
pub fn unsaved(name: &str, props: &Value) -> Option<String> {
    UNSAVED.lock().unwrap().values().find(|(n, p, _)| n == name && p == props).map(|(_, _, note)| note.clone())
}

/// A language server session's id from a mod.
fn lsp_id(v: &HostValue) -> Result<u64, HostError> {
    from_host(v).as_f64().filter(|n| *n >= 0.0).map(|n| n as u64).ok_or_else(|| HostError::new("a session id is a number from lspStart"))
}

fn module(inst: Instance, copy: u64) -> HostModule {
    let reads = Rc::new(RefCell::new(LiveReads::default()));
    LIVE_READS.with_borrow_mut(|copies| {
        copies.retain(|_, reads| reads.strong_count() > 0);
        copies.insert(copy, Rc::downgrade(&reads));
    });
    let props = inst.props.clone();
    let feedback_from = inst.props.get("from").and_then(Value::as_str).unwrap_or("person").to_owned();
    let (cmd_tx, commands) = async_channel::unbounded::<String>();
    COMMANDS.with_borrow_mut(|commands| {
        commands.retain(|(_, _, tx)| !tx.is_closed());
        commands.push((copy, inst.name.clone(), cmd_tx));
    });
    // HUP: native view events for this copy (nextNativeViewEvent).
    let (native_tx, native_events) = async_channel::bounded::<String>(256);
    crate::native_view::register_events(copy, native_tx);
    HostModule::new("herdr")
        .declarations(DECLARATIONS)
        .async_function("exec", |a| {
            let command = a.string(0)?.to_owned();
            Ok(exec_future(command, strings(a.get(1)), opt_str(a.get(2), "cwd"), opt_str(a.get(2), "on"), exec_limit(a.get(2))?))
        })
        .async_function("readTextFile", |a| {
            let path = a.string(0)?.to_owned();
            let on = opt_str(a.get(1), "on");
            Ok(crate::mod_files::read_with(move || match on {
                Some(m) => read_remote(&m, &path),
                None => crate::mod_files::read(Path::new(&path)),
            }))
        })
        .async_function("writeTextFile", |a| {
            let expected = a.get(2).and_then(|v| match v { HostValue::Str(s) => Some(s.clone()), _ => None });
            Ok(crate::mod_files::write_text(a.string(0)?.to_owned(), a.string(1)?.to_owned(), expected))
        })
        .async_function("hc", |a| Ok(exec_future("hc".into(), strings(a.get(0)), None, None, EXEC_LIMIT)))
        .function("home", |_| Ok(home().to_string_lossy().into_owned().into()))
        .function("appHome", |_| Ok(app_dir().to_string_lossy().into_owned().into()))
        .function("fonts", |_| Ok(to_host(&json!(*FONTS.lock().unwrap()))))
        .function("updates", |_| Ok(to_host(&crate::update::status())))
        .function("presentUpdateNotes", |a| {
            crate::update_notes::presented(&strings(a.get(0)));
            Ok(HostValue::Null)
        })
        .function("feedbackIssue", move |a| {
            let core = crate::update::core().version;
            let i = crate::feedback::issue(a.string(0)?, a.string(1)?, &feedback_from, core.as_deref());
            Ok(to_host(&json!({ "title": i.title, "body": i.body, "url": i.url })))
        })
        .async_function("knownAgents", |a| {
            let on = opt_str(a.get(0), "on");
            // The table is loaded on the window thread; workers have only defaults.
            let list = crate::programs::startable();
            let (tx, rx) = async_channel::bounded(1);
            std::thread::spawn(move || {
                let _ = tx.send_blocking(known_agents(on, list));
            });
            Ok(async move {
                let agents = rx.recv().await.map_err(|_| HostError::new("the agent check was lost"))?.map_err(HostError::new)?;
                Ok(to_host(&agents))
            })
        })
        .async_function("pickFolder", |a| {
            let prompt = a.get(0).map(from_host).and_then(|v| v.get("prompt").and_then(Value::as_str).map(str::to_owned)).unwrap_or_else(|| "Open".into());
            let picked = gpui_shell::with_current_app(|cx| cx.prompt_for_paths(gpui::PathPromptOptions {
                files: false, directories: true, multiple: false, prompt: Some(prompt.into()),
            })).ok_or_else(|| HostError::new("no window to pick from"))?;
            Ok(async move {
                let path = picked.await.ok().and_then(Result::ok).flatten().and_then(|p| p.into_iter().next());
                Ok(path.map(|p| HostValue::Str(p.to_string_lossy().into_owned())).unwrap_or(HostValue::Null))
            })
        })
        .async_function("pickFile", |a| {
            let prompt = a.get(0).map(from_host).and_then(|v| v.get("prompt").and_then(Value::as_str).map(str::to_owned)).unwrap_or_else(|| "Open".into());
            // Files only; macOS counts a bundle (an .app) as one.
            let picked = gpui_shell::with_current_app(|cx| cx.prompt_for_paths(gpui::PathPromptOptions {
                files: true, directories: false, multiple: false, prompt: Some(prompt.into()),
            })).ok_or_else(|| HostError::new("no window to pick from"))?;
            Ok(async move {
                let path = picked.await.ok().and_then(Result::ok).flatten().and_then(|p| p.into_iter().next());
                Ok(path.map(|p| HostValue::Str(p.to_string_lossy().into_owned())).unwrap_or(HostValue::Null))
            })
        })
        .function("highlight", |a| {
            let spans = crate::syntax::highlight(a.string(0)?, a.string(1)?);
            Ok(to_host(&Value::Array(spans.into_iter().map(|(s, e, n)| json!([s, e, n])).collect())))
        })
        .async_function("lspStart", {
            // The copy's sessions are let go when its module goes.
            let guard = Rc::new(crate::lsp::CopyGuard(copy));
            move |a| {
                let _ = &guard;
                let o = from_host(a.value(0)?);
                let argv: Vec<String> = o.get("argv").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(str::to_owned).collect()).unwrap_or_default();
                let root = o.get("root").and_then(Value::as_str).ok_or_else(|| HostError::new("lspStart needs { argv, root }"))?.to_owned();
                if argv.is_empty() {
                    return Err(HostError::new("lspStart needs { argv, root }"));
                }
                let idle = o.get("idle").and_then(Value::as_f64).filter(|n| *n >= 0.0).map(std::time::Duration::from_secs_f64);
                let rx = crate::lsp::start(copy, argv, root, o.get("settings").cloned().unwrap_or(Value::Null), idle);
                Ok(async move { rx.recv().await.map_err(|_| HostError::new("lost"))?.map(|v| to_host(&v)).map_err(HostError::new) })
            }
        })
        .async_function("lspRequest", move |a| {
            let id = lsp_id(a.value(0)?)?;
            let key = opt_str(a.get(3), "key");
            let rx = crate::lsp::request(copy, id, a.string(1)?, a.get(2).map(from_host).unwrap_or(Value::Null), key).map_err(HostError::new)?;
            Ok(async move { rx.recv().await.map_err(|_| HostError::new("lost"))?.map(|v| to_host(&v)).map_err(HostError::new) })
        })
        .function("lspNotify", move |a| {
            crate::lsp::notify(copy, lsp_id(a.value(0)?)?, a.string(1)?, a.get(2).map(from_host).unwrap_or(Value::Null)).map_err(HostError::new)?;
            Ok(HostValue::Null)
        })
        .async_function("lspNextMessage", move |a| {
            let rx = crate::lsp::next_message(copy, lsp_id(a.value(0)?)?).map_err(HostError::new)?;
            Ok(async move { rx.recv().await.map(|v| to_host(&v)).map_err(|_| HostError::new("released")) })
        })
        .function("lspRelease", move |a| {
            crate::lsp::release(copy, lsp_id(a.value(0)?)?);
            Ok(HostValue::Null)
        })
        .function("lspSessions", |_| Ok(to_host(&crate::lsp::sessions())))
        .function("setUnsaved", {
            let guard = Rc::new(UnsavedGuard(copy));
            let (name, props) = (inst.name.clone(), inst.props.clone());
            move |a| {
                let _ = &guard;
                match a.get(0).map(from_host) {
                    Some(Value::String(note)) if !note.is_empty() => {
                        UNSAVED.lock().unwrap().insert(copy, (name.clone(), props.clone(), note));
                    }
                    _ => {
                        UNSAVED.lock().unwrap().remove(&copy);
                    }
                }
                Ok(HostValue::Null)
            }
        })
        .async_function("findFiles", |a| {
            let root = PathBuf::from(a.string(0)?);
            let query = a.string(1)?.to_owned();
            let o = a.get(2).map(from_host).unwrap_or(Value::Null);
            let limit = o.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
            let rx = crate::search::background(move || crate::search::find_files(&root, &query, limit));
            Ok(async move { rx.recv().await.map_err(|_| HostError::new("lost"))?.map(|v| to_host(&v)).map_err(HostError::new) })
        })
        .async_function("grep", |a| {
            let root = PathBuf::from(a.string(0)?);
            let query = a.string(1)?.to_owned();
            let o = a.get(2).map(from_host).unwrap_or(Value::Null);
            let limit = o.get("limit").and_then(Value::as_u64).unwrap_or(300) as usize;
            let mode = o.get("mode").and_then(Value::as_str).unwrap_or("plain").to_owned();
            let case = o.get("case").and_then(Value::as_str).unwrap_or("smart").to_owned();
            let rx = crate::search::background(move || crate::search::grep(&root, &query, limit, &mode, &case));
            Ok(async move { rx.recv().await.map_err(|_| HostError::new("lost"))?.map(|v| to_host(&v)).map_err(HostError::new) })
        })
        .function("languageOf", |a| Ok(crate::syntax::lang(a.string(0)?).map_or(HostValue::Null, |l| l.id.into())))
        .function("themes", |_| {
            let list: Vec<Value> = crate::settings::themes().into_iter().map(|(name, colors)| json!({ "light": crate::settings::theme_is_light(&name), "name": name, "colors": colors })).collect();
            Ok(to_host(&Value::Array(list)))
        })
        .function("playSound", |a| {
            crate::sound::play(a.string(0)?);
            Ok(HostValue::Null)
        })
        .function("run", |a| {
            let name = a.string(0)?.to_owned();
            let args = a.get(1).map(from_host).unwrap_or(Value::Null);
            if let Some(command) = crate::commands::find(&name) {
                crate::commands::validate_args(command, &args).map_err(HostError::new)?;
            }
            let final_kill = (name == "terminal.kill").then(|| FINAL_KILLS.with_borrow(Clone::clone)).flatten();
            if let Some((core, deadline)) = final_kill {
                if let Err(error) = core.call_timeout(&name, args, deadline.saturating_duration_since(std::time::Instant::now())) {
                    tracing::warn!("final terminal.kill: {error:#}");
                }
            } else {
                request(Request::Run { name, args });
            }
            Ok(HostValue::Null)
        })
        .function("spaces", reader(reads.clone(), "spaces", |s| &s.spaces))
        .function("machines", reader(reads.clone(), "machines", |s| &s.machines))
        .function("agents", reader(reads.clone(), "agents", |s| &s.agents))
        .function("panes", reader(reads.clone(), "panes", |s| &s.panes))
        .function("setAgentOrder", |a| {
            AGENT_ORDER.with(|s| *s.borrow_mut() = strings(a.get(0)));
            Ok(HostValue::Null)
        })
        .function("terminals", reader(reads.clone(), "terminals", |s| &s.terminals))
        .function("focused", reader(reads.clone(), "focused", |s| &s.focused))
        .function("layout", reader(reads.clone(), "layout", |s| &s.layout))
        .function("layouts", |_| Ok(to_host(&json!(crate::window::layout_names()))))
        .function("commands", |_| {
            let list: Vec<Value> = crate::commands::COMMANDS
                .iter()
                .map(|c| {
                    let args: Vec<Value> = c.args.iter().map(|a| json!({ "name": a.name, "required": a.required })).collect();
                    json!({ "name": c.name, "args": args, "about": c.about })
                })
                .collect();
            Ok(to_host(&Value::Array(list)))
        })
        .function("window", reader(reads.clone(), "window", |s| &s.window))
        .function("theme", |_| Ok(to_host(&serde_json::to_value(&*crate::settings::theme()).unwrap_or(Value::Null))))
        .function("settings", |_| Ok(to_host(&serde_json::to_value(&*crate::settings::get()).unwrap_or(Value::Null))))
        .function("keys", |_| {
            let list: Vec<Value> = crate::keys::listing().into_iter().map(|(s, k, a)| json!({ "section": s, "keys": k, "action": a })).collect();
            Ok(to_host(&Value::Array(list)))
        })
        .function("openOverlay", |a| {
            let mut spec = from_host(a.value(0)?);
            if spec.get("mod").is_none()
                && let Some(old) = spec.get("piece").cloned()
            {
                spec["mod"] = old;
            }
            if spec.get("mod").and_then(Value::as_str).is_none() && !spec.get("layout").is_some_and(Value::is_object) {
                return Err(HostError::new("openOverlay needs { mod: \"<folder>\" } or { layout: {...} }"));
            }
            let id = new_overlay_id();
            request(Request::OpenOverlay { id: id.clone(), spec });
            Ok(id.into())
        })
        .function("closeOverlay", |a| {
            request(Request::CloseOverlay { id: a.string(0)?.to_owned() });
            Ok(HostValue::Null)
        })
        .function("notify", |a| {
            let id = new_overlay_id();
            let n = from_host(a.value(0)?);
            request(Request::OpenOverlay { id: id.clone(), spec: json!({ "kind": "toast", "notification": n }) });
            Ok(id.into())
        })
        .function("placement", {
            let float = props.get("float").and_then(Value::as_str).map(str::to_owned);
            let reads = reads.clone();
            move |_| Ok(float.as_ref().map_or(HostValue::Null, |id| read(&reads, "floats", |s| s.floats.get(id).unwrap_or(&Value::Null))))
        })
        .function("props", move |_| Ok(to_host(&props)))
        .function("shared", |a| {
            let k = a.string(0)?;
            Ok(with_shared(|s| s.values.get(k).map(to_host).unwrap_or(HostValue::Null)))
        })
        .function("setShared", |a| {
            set_shared(a.string(0)?.to_owned(), from_host(a.value(1)?));
            Ok(HostValue::Null)
        })
        .async_function("watchFolder", |a| {
            let path = a.string(0)?.to_owned();
            Ok(async move { crate::files::next_change(path).await.map(|v| to_host(&json!(v))).map_err(HostError::new) })
        })
        .async_function("nextCommand", move |_| {
            let rx = commands.clone();
            Ok(async move { rx.recv().await.map(HostValue::Str).map_err(|_| HostError::new("herdr-app is shutting down")) })
        })
        // HUP: native content views (src/native_view.rs), interface native-view/0.
        .component("nativeView", move |mut args, window, cx| {
            let id = args.id().to_owned();
            let props = from_host(args.props());
            let children = args.take_children();
            crate::native_view::element(copy, &id, props, children, window, cx)
        })
        .function("nativeViewCapabilities", |_| Ok(to_host(&crate::native_view::capabilities())))
        .function("nativeViewCall", move |a| {
            let id = a.string(0)?.to_owned();
            let action = a.string(1)?.to_owned();
            let args = a.get(2).map(from_host).unwrap_or(Value::Null);
            crate::native_view::call(copy, &id, &action, &args).map(|v| to_host(&v)).map_err(HostError::new)
        })
        .async_function("nextNativeViewEvent", move |_| {
            let rx = native_events.clone();
            Ok(async move { rx.recv().await.map(HostValue::Str).map_err(|_| HostError::new("this view's mod was unloaded")) })
        })
}

/// The runtime's base layer, themed from settings.json.
pub fn init(cx: &mut App) {
    gpui_shell::init(cx);
    // Code editors color with tree-sitter (src/syntax.rs) where a grammar exists.
    gpui_shell::set_host_highlighters(std::rc::Rc::new(|language: &str| {
        crate::syntax::Highlighter::new(language).map(|h| Box::new(h) as Box<dyn gpui_base::input::InputHighlighter>)
    }));
    // Rendered Markdown: math, mermaid, colored code (src/markdown.rs).
    crate::markdown::install(cx);
    apply_theme(cx);
}

/// Maps the theme onto the tokens mods read through `cx.theme().colors`.
pub fn apply_theme(cx: &mut App) {
    let t = crate::settings::theme();
    let g = |k: &str| t.get(k).cloned().unwrap_or_default();
    let palette = json!({
        "background": g("background"), "foreground": g("foreground"),
        "surface": g("surface"), "surface_foreground": g("foreground"),
        "primary": g("accent"), "primary_foreground": g("accent_foreground"),
        "secondary": g("raised"), "secondary_foreground": g("foreground"),
        "muted": g("raised"), "muted_foreground": g("muted"),
        "accent": g("hover"), "accent_foreground": g("foreground"),
        "destructive": g("blocked"), "destructive_foreground": g("background"),
        "border": g("border"), "input": g("input"), "ring": g("ring"),
        "selection": g("selection"),
    });
    match serde_json::from_value::<gpui_base::ColorTokens>(palette) {
        Ok(colors) => {
            let theme = gpui_base::Theme::global_mut(cx);
            theme.appearance = if crate::settings::get().dark { gpui_base::ThemeAppearance::Dark } else { gpui_base::ThemeAppearance::Light };
            theme.tokens.colors = colors;
        }
        Err(e) => tracing::error!("theme did not map onto mod tokens: {e}"),
    }
    crate::markdown::set_theme(cx);
}

fn capabilities() -> Capabilities {
    Capabilities::new()
        .read_roots([home()])
        .write_roots([app_dir()])
        .execute(ExecuteGrant::Unrestricted)
        .network(NetworkGrant::Unrestricted)
        .storage(true)
        .clipboard_read(true)
        .clipboard_write(true)
}

/// Checks exercise shared state in memory, without reading or writing the person's file.
pub fn install_check_policy() {
    SHARED.with_borrow_mut(|slot| *slot = Some(SharedStore { values: Default::default(), path: app_dir().join("shared.json"), writable: false, writer: None }));
    install_policy();
}

/// What mods may touch, and the `herdr` module they import.
pub fn install_policy() -> async_channel::Receiver<Request> {
    gpui_shell::policy::update_default(|p| {
        p.with_capabilities(capabilities())
            .with_host_module(module(Instance { name: String::new(), props: Value::Null }, 0))
            .expect("herdr module is valid")
    });
    let (tx, rx) = async_channel::unbounded();
    let _ = REQUESTS.set(tx);
    rx
}

/// Gives the next mod copy to load a policy of its own: its `herdr` module
/// (its props, its identity) and its localStorage file. The shell hands every
/// view a copy of the default that *shares* modules and storage, so each copy
/// needs a fresh default rather than an edit of the old one.
/// Readies the next load of `inst`; returns the copy's number (for commands).
pub fn prepare_load(inst: &Instance) -> u64 {
    let copy = COPY_SEQ.with(|s| {
        s.set(s.get() + 1);
        s.get()
    });
    let dir = app_dir().join("data").join(&inst.name);
    let _ = std::fs::create_dir_all(&dir);
    let file = if inst.props.is_null() {
        "store.json".to_owned()
    } else {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        inst.props.to_string().hash(&mut h);
        format!("store-{:016x}.json", h.finish())
    };
    let policy = gpui_shell::policy::Policy::new()
        .with_application(inst.key())
        .with_capabilities(capabilities())
        .with_storage_path(dir.join(file))
        .with_host_module(module(inst.clone(), copy))
        .expect("herdr module is valid");
    gpui_shell::policy::set_default(policy);
    copy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_timeout_defaults_caps_and_rejects_invalid_values() {
        assert_eq!(exec_limit(None).unwrap(), EXEC_LIMIT);
        assert_eq!(exec_limit(Some(&HostObject::new().field("timeout", HostValue::Null).into())).unwrap(), EXEC_LIMIT);
        let options = |ms| HostObject::new().field("timeout", ms).into();
        assert_eq!(exec_limit(Some(&options(1250.0))).unwrap(), Duration::from_millis(1250));
        assert_eq!(exec_limit(Some(&options(900_000.0))).unwrap(), EXEC_MAX);
        for ms in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(exec_limit(Some(&options(ms))).is_err());
        }
        assert!(exec_limit(Some(&HostObject::new().field("timeout", "30").into())).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn exec_uses_the_requested_deadline_and_reports_it() {
        let args = ["-c".into(), "sleep 0.15; printf done".into()];
        let error = run_blocking("sh", &args, None, Duration::from_millis(30)).unwrap_err();
        assert!(error.contains("0.03 s"), "{error}");
        let (code, stdout, _) = run_blocking("sh", &args, None, Duration::from_secs(2)).unwrap();
        assert_eq!((code, stdout.as_str()), (0, "done"));
    }

    #[cfg(unix)]
    #[gpui::test]
    async fn exec_returns_real_output_and_errors_under_the_test_scheduler(_cx: &mut gpui::TestAppContext) {
        let result = exec_future("sh".into(), vec!["-c".into(), "printf out; printf err >&2; exit 7".into()], None, None, EXEC_LIMIT).await.unwrap();
        assert!(matches!(result.get("code"), Some(HostValue::Number(7.0))));
        assert!(matches!(result.get("stdout"), Some(HostValue::Str(s)) if s == "out"));
        assert!(matches!(result.get("stderr"), Some(HostValue::Str(s)) if s == "err"));
        assert!(exec_future("herdr_test_missing_command_638".into(), vec![], None, None, EXEC_LIMIT).await.is_err());
        let error = exec_future("sh".into(), vec!["-c".into(), "sleep 0.15; printf late".into()], None, None, Duration::from_millis(30)).await.unwrap_err();
        assert!(error.to_string().contains("0.03 s"), "{error}");
    }

    /// Mods' inputs select in the theme's selection colour (gpui-base takes the
    /// palette's `selection`, which apply_theme fills from the theme), not in
    /// its accent: that is the theme's hover tone, nearly the background
    /// (moonfly: #1c1c1c at 40% over #080808), and every plain input selected
    /// invisibly.
    #[gpui::test]
    fn mods_inputs_select_in_the_themes_selection_colour(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            cx.set_global(gpui_base::Theme::default());
            apply_theme(cx);
            let tokens = &gpui_base::Theme::global(cx).tokens;
            let resolved = gpui_base::input::InputEditorStyle::default().resolved(tokens);
            assert_eq!(resolved.selection, crate::settings::color("selection"));
            assert_ne!(resolved.selection, tokens.colors.accent.opacity(0.4));
        });
    }

    #[test]
    fn live_reads_ignore_unread_inputs_and_keep_pending_changes() {
        let mut revisions = HashMap::new();
        let mut list = LiveReads::default();
        let mut chrome = LiveReads::default();
        list.record("agents", &revisions);
        chrome.record("layout", &revisions);
        revisions.insert("terminals", 1);
        assert!(!list.changed(&revisions));
        assert!(!chrome.changed(&revisions));
        revisions.insert("agents", 1);
        // A callback reading the new snapshot must not swallow a pending redraw.
        list.record("agents", &revisions);
        assert!(list.changed(&revisions));
        assert!(!chrome.changed(&revisions));
        assert!(!list.changed(&revisions));
        // Dependencies first read by a child or a callback remain subscribed.
        list.record("focused", &revisions);
        revisions.insert("focused", 1);
        assert!(list.changed(&revisions));
    }

    #[test]
    fn equal_snapshots_do_not_refresh_readers() {
        std::thread::spawn(|| {
            let reads = Rc::new(RefCell::new(LiveReads::default()));
            LIVE_READS.with_borrow_mut(|copies| { copies.insert(1, Rc::downgrade(&reads)); });
            read(&reads, "agents", |s| &s.agents);
            assert!(!snapshot_changed(1));
            assert!(!publish_agents(json!([])));
            assert!(!snapshot_changed(1));
            assert!(publish_terminals(json!([{"address":"t1"}])));
            assert!(!snapshot_changed(1));
            assert!(publish_agents(json!([{"address":"t1","status":"working"}])));
            assert!(snapshot_changed(1));
            assert!(!snapshot_changed(1));
            assert!(!publish_agents(json!([{"address":"t1","status":"working"}])));
            assert!(!snapshot_changed(1));
            drop(reads);
            assert!(!snapshot_changed(1));
        }).join().unwrap();
    }

    #[test]
    fn loading_copies_reclaims_closed_command_channels_without_dispatch() {
        std::thread::spawn(|| {
            let inst = Instance { name: "test".into(), props: Value::Null };
            let live = module(inst.clone(), 1);
            for copy in 2..102 {
                drop(module(inst.clone(), copy));
                COMMANDS.with_borrow(|commands| assert!(commands.len() <= 2));
            }
            drop(live);
            let last = module(inst, 102);
            COMMANDS.with_borrow(|commands| assert_eq!(commands.len(), 1));
            drop(last);
        }).join().unwrap();
    }

    #[test]
    fn keyboard_focus_is_opt_in_and_commands_only_reach_the_shown_copy() {
        for metadata in [json!({}), json!({"focusable": false})] {
            assert!(!serde_json::from_value::<Hint>(metadata).unwrap().focusable);
        }
        assert!(serde_json::from_value::<Hint>(json!({"focusable": true})).unwrap().focusable);

        let (first_tx, first) = async_channel::unbounded();
        let (second_tx, second) = async_channel::unbounded();
        let (hidden_tx, hidden) = async_channel::unbounded();
        COMMANDS.with_borrow_mut(|c| *c = vec![
            (1, "same-mod".into(), first_tx),
            (2, "same-mod".into(), second_tx),
            (3, "same-mod".into(), hidden_tx),
        ]);
        set_shown_copies([1, 2].into());
        assert!(send_command_to(2, "focus"));
        assert_eq!(second.try_recv().unwrap(), "focus");
        assert!(first.is_empty());
        assert!(hidden.is_empty());
        assert!(!send_command_to(3, "focus"));
        assert!(!send_command_to(99, "focus"));
        // Existing mod key bindings still broadcast to every shown copy.
        assert!(send_command("same-mod", "existing-key"));
        assert_eq!(first.try_recv().unwrap(), "existing-key");
        assert_eq!(second.try_recv().unwrap(), "existing-key");
        assert!(hidden.is_empty());
        COMMANDS.with_borrow_mut(Vec::clear);
        set_shown_copies(Default::default());
    }

    #[cfg(unix)]
    #[test]
    fn known_agents_uses_snapshot_and_refreshes_changed_commands() {
        let snapshot = vec![json!({"key": "claude", "run": ["herdr_issue57_not_installed"]})];
        let first = std::thread::spawn(move || known_agents(None, snapshot)).join().unwrap().unwrap();
        assert_eq!(first[0]["run"], json!(["herdr_issue57_not_installed"]));
        assert_eq!(first[0]["installed"], false);
        let snapshot = vec![json!({"key": "claude", "run": ["printf"]}), json!({"key": "claude-alt", "run": ["printf"]})];
        let next = std::thread::spawn(move || known_agents(None, snapshot)).join().unwrap().unwrap();
        assert_eq!(next.as_array().unwrap().len(), 2);
        assert_eq!(next[0]["installed"], true);
        assert_eq!(next[1]["key"], "claude-alt");
        assert_eq!(next[1]["installed"], true);
    }

    #[test]
    fn shared_bursts_persist_only_complete_snapshots_and_finish_at_final_state() {
        let root = if cfg!(target_os = "linux") { PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let dir = root.join(format!("herdr-shared-stress-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shared.json");
        let reading = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let reader = {
            let path = path.clone();
            let reading = reading.clone();
            std::thread::spawn(move || {
                while reading.load(std::sync::atomic::Ordering::Relaxed) {
                    match std::fs::read(&path) {
                        Ok(bytes) => { serde_json::from_slice::<Value>(&bytes).unwrap(); }
                        // Windows refuses to open a file while a rename replaces it. The reader
                        // got no bytes, so that is not a torn snapshot.
                        Err(e) if cfg!(windows) && e.kind() == std::io::ErrorKind::PermissionDenied => {}
                        Err(e) => assert_eq!(e.kind(), std::io::ErrorKind::NotFound),
                    }
                    std::thread::yield_now();
                }
            })
        };
        let expected = std::thread::spawn(move || {
            SHARED.with_borrow_mut(|s| *s = Some(SharedStore::load(path)));
            for i in 0..2000 {
                set_shared("changing".into(), json!("x".repeat(if i % 2 == 0 { 16000 } else { 3 })));
                set_shared("revision".into(), json!(i));
            }
            set_shared("final".into(), json!(true));
            finish_shared();
            with_shared(|s| s.values.clone())
        }).join().unwrap();
        reading.store(false, std::sync::atomic::Ordering::Relaxed);
        reader.join().unwrap();
        let actual: serde_json::Map<String, Value> = serde_json::from_slice(&std::fs::read(dir.join("shared.json")).unwrap()).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_shared_file_is_kept_before_starting_empty() {
        let root = if cfg!(target_os = "linux") { PathBuf::from("/var/tmp") } else { std::env::temp_dir() };
        let dir = root.join(format!("herdr-shared-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shared.json");
        let corrupt = b"{\"kept\":true} old snapshot tail";
        std::fs::write(&path, corrupt).unwrap();
        let store = SharedStore::load(path.clone());
        assert!(store.values.is_empty());
        assert!(store.writable);
        assert!(!path.exists());
        let backup = std::fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        assert!(backup.file_name().unwrap().to_string_lossy().starts_with("shared.json.corrupt-"));
        assert_eq!(std::fs::read(&backup).unwrap(), corrupt);
        crate::persist::write_atomic(&path, "{}").unwrap();
        assert_eq!(std::fs::read(backup).unwrap(), corrupt);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn navigation_follows_mod_order() {
        let available = || vec!["t1".into(), "t2".into(), "t3".into()];
        AGENT_ORDER.with(|s| s.borrow_mut().clear());
        assert_eq!(agent_order(available()), available());
        AGENT_ORDER.with(|s| *s.borrow_mut() = vec!["t3".into(), "gone".into(), "t1".into(), "t3".into()]);
        assert_eq!(agent_order(available()), vec!["t3", "t1", "t2"]);
        assert!(agent_order(Vec::new()).is_empty());
        AGENT_ORDER.with(|s| *s.borrow_mut() = vec!["t2".into(), "t1".into(), "t3".into()]);
        assert_eq!(agent_order(available()), vec!["t2", "t1", "t3"]);
        AGENT_ORDER.with(|s| s.borrow_mut().clear());
    }

    #[test]
    fn an_added_file_makes_a_shipped_mod_edited() {
        let dir = std::env::temp_dir().join(format!("herdr-app-shipped-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("icons")).unwrap();
        std::fs::write(dir.join("main.js"), "a").unwrap();
        std::fs::write(dir.join("icons/x.svg"), "b").unwrap();
        let files: Files = [("main.js".to_owned(), fingerprint(b"a")), ("icons/x.svg".to_owned(), fingerprint(b"b"))].into();
        assert!(as_shipped(&dir, &files));
        std::fs::write(dir.join("gpui-kit.d.ts"), "generated").unwrap();
        std::fs::write(dir.join("jsconfig.json"), "generated").unwrap();
        assert!(as_shipped(&dir, &files));
        std::fs::write(dir.join(".DS_Store"), "finder").unwrap();
        std::fs::create_dir(dir.join(".vscode")).unwrap();
        std::fs::write(dir.join(".vscode/settings.json"), "{}").unwrap();
        assert!(as_shipped(&dir, &files));
        std::fs::write(dir.join("mine.js"), "c").unwrap();
        assert!(!as_shipped(&dir, &files));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cloned_mods_rewrite_assets_and_self_overlays_and_reject_nonobject_metadata() {
        let root = std::env::temp_dir().join(format!("herdr-mod-clone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("original")).unwrap();
        std::fs::write(root.join("original/mod.json"), "{}").unwrap();
        std::fs::write(root.join("original/main.js"), r#"const ASSETS = "mods/original"; const icon = 'mods/original/icon.svg'; openOverlay({ mod: "original" });"#).unwrap();
        std::fs::write(root.join("original/icon.svg"), "<svg/>").unwrap();
        clone_mod_at(&root, "original", "copy").unwrap();
        let text = std::fs::read_to_string(root.join("copy/main.js")).unwrap();
        assert!(text.contains("\"mods/copy\"") && text.contains("'mods/copy/icon.svg'") && text.contains("mod: \"copy\""));
        assert_eq!(std::fs::read_to_string(root.join("copy/icon.svg")).unwrap(), "<svg/>");
        assert!(clone_mod_at(&root, "original", "copy").is_err());
        for invalid in ["[]", "42", "true", "null", "\"text\""] {
            std::fs::write(root.join("original/mod.json"), invalid).unwrap();
            assert!(clone_mod_at(&root, "original", "bad").is_err());
            assert!(!root.join("bad").exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn layout_formatting_is_not_an_edit_and_rescued_clicks_still_apply() {
        use crate::layout::{Node, Size};
        use crate::layout_sync::State;
        let root = std::env::temp_dir().join(format!("herdr-layout-click-rescue-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("layouts");
        std::fs::create_dir_all(dir.join(".state")).unwrap();
        std::fs::create_dir_all(dir.join(".base")).unwrap();
        let shipped = r#"{"id":"root","type":"block","content":{"mod":"files"},"size":{"px":360}}"#;
        // No record: formatting, BOM and whole-number floats are not edits.
        std::fs::write(dir.join("main.json"), "\u{feff}{\r\n \"type\":\"block\", \"id\":\"root\", \"size\":{\"px\":360.0}, \"content\":{\"mod\":\"files\"}}").unwrap();
        sync_layouts(&root, &[("main", shipped)]).unwrap();
        assert!(!dir.join("main-edited.json").exists());
        assert!(!dir.join(".base").exists());
        let mut file: Node = serde_json::from_str(shipped).unwrap();
        file.size = Some(Size::Px { px: 400.0 });
        std::fs::write(dir.join("main.json"), crate::layout_sync::text_of(&file)).unwrap();
        let mut shown = file.clone();
        shown.size = Some(Size::Px { px: 500.0 });
        let mut state = State::between(&file, &shown);
        state.file = serde_json::to_value(&file).ok();
        std::fs::write(dir.join(".state/main.json"), serde_json::to_string(&state).unwrap()).unwrap();
        sync_layouts(&root, &[("main", shipped)]).unwrap();
        let mut rescued: Node = serde_json::from_str(&std::fs::read_to_string(dir.join("main-edited.json")).unwrap()).unwrap();
        let mut clicks: State = serde_json::from_str(&std::fs::read_to_string(dir.join(".state/main-edited.json")).unwrap()).unwrap();
        clicks.forget_since_saved(&rescued);
        clicks.apply(&mut rescued);
        assert_eq!(rescued.size, Some(Size::Px { px: 500.0 }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_0_1_x_layout_is_kept_aside_quietly_not_rescued() {
        let root = std::env::temp_dir().join(format!("herdr-layout-0-1-x-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("layouts");
        std::fs::create_dir_all(&dir).unwrap();
        // 0.1.x wrote no record of what it installed.
        std::fs::write(dir.join("main.json"), r#"{"id":"root","type":"block","content":{"mod":"old"}}"#).unwrap();
        take_sync_notes();
        sync_layouts(&root, &[("main", r#"{"id":"root","type":"block","content":{"mod":"new"}}"#)]).unwrap();
        assert!(std::fs::read_to_string(dir.join("main.json")).unwrap().contains("new"));
        let aside = dir.join(format!("main.json.before-{}", env!("CARGO_PKG_VERSION")));
        assert!(std::fs::read_to_string(aside).unwrap().contains("old"));
        assert!(!dir.join("main-edited.json").exists());
        assert!(take_sync_notes().is_empty(), "no toast for a file nobody can say was edited");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn layouts_restore_preserve_edits_clicks_and_drop_only_untouched() {
        let root = std::env::temp_dir().join(format!("herdr-layout-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("layouts");
        sync_layouts(&root, &[("a", "a1"), ("b", "b1"), ("c", "c1")]).unwrap();
        std::fs::create_dir_all(dir.join(".state")).unwrap();
        std::fs::write(dir.join(".state/a.json"), "clicks").unwrap();
        std::fs::write(dir.join("a.json"), "mine").unwrap();
        std::fs::write(dir.join("b.json"), "kept").unwrap();
        sync_layouts(&root, &[("a", "a2")]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.json")).unwrap(), "a2");
        assert_eq!(std::fs::read_to_string(dir.join("a-edited.json")).unwrap(), "mine");
        assert_eq!(std::fs::read_to_string(dir.join("b.json")).unwrap(), "kept");
        assert!(!dir.join("c.json").exists());
        assert_eq!(std::fs::read_to_string(dir.join(".state/a.json")).unwrap(), "clicks");
        std::fs::write(dir.join("a.json"), "again").unwrap();
        sync_layouts(&root, &[("a", "a2")]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a-edited-2.json")).unwrap(), "again");
        assert_eq!(std::fs::read_to_string(dir.join("a-edited.json")).unwrap(), "mine");
        std::fs::remove_file(dir.join("a.json")).unwrap();
        sync_layouts(&root, &[("a", "a3")]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.json")).unwrap(), "a3");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn default_mods_restore_shipped_and_move_edits_to_clones() {
        let root = std::env::temp_dir().join(format!("herdr-app-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (mods, record) = (root.join("mods"), root.join("installed.json"));
        let read = |p: &str| std::fs::read_to_string(mods.join(p)).unwrap_or_default();

        let v1: &[(&str, &[u8])] = &[("a/main.js", b"a1"), ("a/old.js", b"x"), ("b/main.js", b"b1"), ("c/main.js", b"c1")];
        sync_defaults(&mods, &record, v1).unwrap();
        assert_eq!(read("a/main.js"), "a1");
        let before = std::fs::metadata(mods.join("a/main.js")).unwrap().modified().unwrap();
        sync_defaults(&mods, &record, v1).unwrap();
        assert_eq!(std::fs::metadata(mods.join("a/main.js")).unwrap().modified().unwrap(), before, "untouched mods are not rewritten");

        std::fs::write(mods.join("b/main.js"), "mine").unwrap();
        std::fs::remove_dir_all(mods.join("c")).unwrap();
        let v2: &[(&str, &[u8])] = &[("a/main.js", b"a2"), ("b/main.js", b"b2"), ("c/main.js", b"c2")];
        sync_defaults(&mods, &record, v2).unwrap();
        assert_eq!(read("a/main.js"), "a2", "untouched mods update");
        assert!(!mods.join("a/old.js").exists(), "files the update dropped go");
        assert_eq!(read("b/main.js"), "b2", "edited mods are restored");
        assert_eq!(read("b-edited/main.js"), "mine", "edits become a clone");
        assert_eq!(read("c/main.js"), "c2", "deleted mods are restored");
        std::fs::write(mods.join("b/main.js"), "changed again").unwrap();

        // No longer shipped: untouched ones go, edited ones stay, and so do
        // ones someone added a file to.
        let v3: &[(&str, &[u8])] = &[("c/main.js", b"c2"), ("d/main.js", b"d1")];
        sync_defaults(&mods, &record, v3).unwrap();
        std::fs::write(mods.join("d/notes.md"), "my notes").unwrap();
        let v4: &[(&str, &[u8])] = &[("c/main.js", b"c2")];
        sync_defaults(&mods, &record, v4).unwrap();
        assert!(!mods.join("a").exists(), "untouched dropped defaults go");
        assert_eq!(read("b/main.js"), "changed again", "edited dropped defaults stay");
        assert_eq!(read("b-edited/main.js"), "mine", "clones stay untouched");
        assert_eq!(read("d/notes.md"), "my notes", "a dropped default with an added file stays");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn bundled_mod_folders_replace_built_in_ones_whole() {
        let root = std::env::temp_dir().join(format!("herdr-app-bundled-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("b/bin")).unwrap();
        std::fs::write(root.join("b/main.js"), "b2").unwrap();
        std::fs::write(root.join("b/bin/tool"), "t").unwrap();
        std::fs::write(root.join("b/.DS_Store"), "x").unwrap();
        std::fs::write(root.join("loose.txt"), "x").unwrap();
        let bundled = read_mod_folders(&root);
        assert_eq!(bundled.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(), ["b/bin/tool", "b/main.js"]);
        let built_in: &[(&str, &[u8])] = &[("a/main.js", b"a1"), ("b/main.js", b"b1"), ("b/old.js", b"o")];
        let all = merge_shipped(built_in, bundled);
        let files: Vec<(&str, &[u8])> = all.iter().map(|(p, b)| (p.as_str(), b.as_slice())).collect();
        assert_eq!(files, [("a/main.js", &b"a1"[..]), ("b/bin/tool", b"t"), ("b/main.js", b"b2")]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn default_mods_install_bin_programs_executable() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("herdr-app-sync-bin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (mods, record) = (root.join("mods"), root.join("installed.json"));
        let v1: &[(&str, &[u8])] = &[("a/main.js", b"a1"), ("a/bin/tool", b"#!/bin/sh\n")];
        sync_defaults(&mods, &record, v1).unwrap();
        let mode = |p: &str| std::fs::metadata(mods.join(p)).unwrap().permissions().mode() & 0o111;
        assert_ne!(mode("a/bin/tool"), 0, "bin/ files can run");
        assert_eq!(mode("a/main.js"), 0, "the rest stays plain");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
