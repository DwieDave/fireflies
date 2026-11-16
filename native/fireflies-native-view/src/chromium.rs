//! Chromium (CEF) web views inside the Fireflies window (kind `chromium`).
//!
//! Ported from herdr-universal-preview's CEF engine (Apache-2.0, the same
//! origin as the rest of this crate) and fitted to the events the browser mod
//! reads from WebKit views (`web.location`, `load.*`, `web.newTab`, `web.icon`,
//! `web.video`).
//!
//! CEF runs in this process with an external message pump: a main-thread
//! timer calls `do_message_loop_work`, so GPUI keeps its own run loop. Each
//! browser is created as a child of its view's `HoleHost`; CEF's NSView is
//! then moved, hidden and masked like every other native view. On macOS a
//! browser with a parent view always runs in Alloy style: no `chrome://`
//! pages, no extensions.
//!
//! The CEF framework and its helper apps are not in the app bundle: they live
//! in one folder (`set_home`, the app's data folder), downloaded when the
//! person enables Chromium. The profile (logins, cache) is beside them, never
//! the person's Chrome profile.

use cef::*;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, AnyProtocol, Bool, Imp, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::NSView;
use objc2_foundation::NSTimer;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// The helper apps' names, as Chromium looks for them beside the framework:
/// `<HELPER_BASE>.app`, `<HELPER_BASE> (GPU).app`, … Its processes find the
/// helper by `browser_subprocess_path` and pick the variant by its suffix.
pub const HELPER_BASE: &str = "Fireflies Helper";
pub const HELPER_SUFFIXES: [&str; 5] = ["", " (GPU)", " (Renderer)", " (Plugin)", " (Alerts)"];
pub const FRAMEWORK: &str = "Chromium Embedded Framework.framework";

/// What the handlers learn about one browser, read by `state`.
#[derive(Default)]
pub struct Info {
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_back: bool,
    pub can_forward: bool,
    pub progress: f64,
    pub video: bool,
}

pub struct ChromiumView {
    pub key: String,
    pub browser: Browser,
    pub info: Arc<Mutex<Info>>,
    pub generation: Arc<AtomicU64>,
}

thread_local! {
    static STARTED: Cell<Option<bool>> = const { Cell::new(None) };
    static START_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static PUMP: RefCell<Option<Retained<NSTimer>>> = const { RefCell::new(None) };
    static IN_PUMP: Cell<bool> = const { Cell::new(false) };
    /// CefAppProtocol's flag: `-[NSApplication sendEvent:]` is on the stack.
    static SENDING: Cell<bool> = const { Cell::new(false) };
    /// `sendEvent:` as the app class had it before ours wrapped it.
    static SEND_EVENT: Cell<Option<Imp>> = const { Cell::new(None) };
}

/// Where Chromium lives (`<app home>/chromium`, crate::cef_install).
pub fn home() -> Option<PathBuf> {
    crate::cef_install::home()
}

/// The bundle the framework and helpers sit in. Chromium's processes find
/// each other by the outer bundle's identifier (the main process is given it
/// as `main_bundle_path`; a helper looks four levels up from its executable),
/// so outside the app bundle they get one of their own: a bundle with no
/// executable, only `Contents/Info.plist` and `Contents/Frameworks`.
pub const BUNDLE: &str = "Fireflies Chromium.app";
pub const BUNDLE_ID: &str = "dev.herdr.app.chromium";

pub fn bundle_dir() -> Option<PathBuf> {
    Some(crate::cef_install::build_dir(&home()?).join(BUNDLE))
}

/// `Contents/Frameworks` of that bundle: the framework and the helper apps.
pub fn frameworks_dir() -> Option<PathBuf> {
    Some(crate::cef_install::frameworks_dir(&home()?))
}

/// Whether the framework is in place and the app has its helper (Chromium can start).
pub fn present() -> bool {
    frameworks_dir().is_some_and(|d| d.join(FRAMEWORK).join("Chromium Embedded Framework").exists()) && helper_source().is_some()
}

/// The helper executable the app ships beside its own (`fireflies-cef-helper`).
pub fn helper_source() -> Option<PathBuf> {
    let p = std::env::current_exe().ok()?.parent()?.join("fireflies-cef-helper");
    p.exists().then_some(p)
}

/// The helper apps Chromium starts its processes from, beside the framework
/// (they find it at ../../.. from their executable). Built from the app's own
/// helper executable: (re)written when missing or when the app's helper
/// changed (an update), so they always match the app.
pub fn prepare_helpers(dir: &std::path::Path) -> Result<(), String> {
    let src = helper_source().ok_or("the app has no Chromium helper (fireflies-cef-helper)")?;
    let bundle_plist = dir.parent().map(|c| c.join("Info.plist"));
    if let Some(p) = bundle_plist.filter(|p| !p.exists()) {
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string>
    <key>CFBundleName</key><string>Fireflies Chromium</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSUIElement</key><true/>
</dict></plist>
"#
        );
        std::fs::write(&p, plist).map_err(|e| format!("bundle: {e}"))?;
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("helper: {e}"))?;
    for suffix in HELPER_SUFFIXES {
        let name = format!("{HELPER_BASE}{suffix}");
        let contents = dir.join(format!("{name}.app/Contents"));
        let exe = contents.join("MacOS").join(&name);
        if std::fs::read(&exe).is_ok_and(|b| b == bytes) {
            continue;
        }
        std::fs::create_dir_all(contents.join("MacOS")).map_err(|e| format!("helper folder: {e}"))?;
        let tmp = exe.with_extension("new");
        std::fs::write(&tmp, &bytes).map_err(|e| format!("helper: {e}"))?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &exe).map_err(|e| format!("helper: {e}"))?;
        let id = match suffix {
            "" => String::new(),
            s => format!(".{}", s.trim_matches([' ', '(', ')']).to_ascii_lowercase()),
        };
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleExecutable</key><string>{name}</string>
    <key>CFBundleIdentifier</key><string>{BUNDLE_ID}.helper{id}</string>
    <key>CFBundleName</key><string>{name}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>{version}</string>
    <key>LSUIElement</key><true/>
    <key>LSFileQuarantineEnabled</key><false/>
    <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict></plist>
"#,
            version = crate::cef_install::CEF_VERSION.split('+').next().unwrap_or("0"),
        );
        std::fs::write(contents.join("Info.plist"), plist).map_err(|e| format!("helper: {e}"))?;
    }
    Ok(())
}

fn report(key: &str, generation: &AtomicU64, name: &'static str, data: Value) {
    crate::macos::emit_event(key, generation.load(Ordering::Relaxed), name, data);
}

fn pump() {
    if IN_PUMP.with(|p| p.replace(true)) {
        return;
    }
    do_message_loop_work();
    IN_PUMP.with(|p| p.set(false));
}

wrap_app! {
    struct FirefliesApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(FirefliesBrowserProcess::new())
        }
        // No login keychain: CEF's keychain item has a fixed name ("Chromium
        // Safe Storage") and every rebuild of the app has a new ad-hoc
        // signature, so macOS would ask again after each one and every page
        // would wait for the answer. Cookies stay in the app's own profile,
        // protected by the account's file permissions.
        fn on_before_command_line_processing(&self, _process_type: Option<&CefString>, command_line: Option<&mut CommandLine>) {
            if let Some(cl) = command_line {
                cl.append_switch(Some(&CefString::from("use-mock-keychain")));
            }
        }
    }
}

wrap_browser_process_handler! {
    struct FirefliesBrowserProcess;

    impl BrowserProcessHandler {
        // The 60 Hz timer already pumps; nothing extra to schedule.
        fn on_schedule_message_pump_work(&self, _delay_ms: i64) {}
    }
}

/// Loads and initializes CEF once (main thread). Later calls return the first result.
pub fn ensure_started(_mtm: MainThreadMarker) -> Result<(), String> {
    match STARTED.with(Cell::get) {
        Some(true) => return Ok(()),
        Some(false) => {
            let why = START_ERROR.with(|e| e.borrow().clone());
            return Err(format!("Chromium failed to start earlier in this run: {why}"));
        }
        None => {}
    }
    let r = start();
    if let Err(e) = &r {
        START_ERROR.with(|s| *s.borrow_mut() = e.clone());
    }
    STARTED.with(|s| s.set(Some(r.is_ok())));
    r
}

/// Whether CEF is running in this process.
pub fn started() -> bool {
    STARTED.with(Cell::get) == Some(true)
}

fn start() -> Result<(), String> {
    let dir = frameworks_dir().ok_or("Chromium has no home folder")?;
    if !present() {
        return Err("Chromium isn't installed: enable it in Settings".into());
    }
    prepare_helpers(&dir)?;
    let bundle = bundle_dir().ok_or("no bundle")?;
    let framework = dir.join(FRAMEWORK);
    let helper = dir.join(format!("{HELPER_BASE}.app/Contents/MacOS/{HELPER_BASE}"));
    let lib = framework.join("Chromium Embedded Framework");
    let name = std::ffi::CString::new(lib.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    // Loads the framework of the pinned build; its initializers run on the
    // main thread, as CEF expects. Never unloaded while the app runs.
    if load_library(Some(unsafe { &*name.as_ptr().cast() })) != 1 {
        return Err(format!("can't load the Chromium framework at {}", framework.display()));
    }
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    install_app_protocol()?;
    let profile = home().ok_or("no home")?.join("profile");
    std::fs::create_dir_all(&profile).map_err(|e| format!("profile folder: {e}"))?;
    // CEF compares the cache path with the root by prefix: both resolved
    // (/var/tmp is /private/var/tmp).
    let profile = std::fs::canonicalize(&profile).map_err(|e| format!("profile folder: {e}"))?;
    let args = args::Args::new();
    let settings = Settings {
        no_sandbox: 1,
        external_message_pump: 1,
        multi_threaded_message_loop: 0,
        main_bundle_path: CefString::from(bundle.to_string_lossy().as_ref()),
        framework_dir_path: CefString::from(framework.to_string_lossy().as_ref()),
        browser_subprocess_path: CefString::from(helper.to_string_lossy().as_ref()),
        root_cache_path: CefString::from(profile.to_string_lossy().as_ref()),
        cache_path: CefString::from(profile.join("Default").to_string_lossy().as_ref()),
        persist_session_cookies: 1,
        log_severity: LogSeverity::WARNING,
        log_file: CefString::from(profile.join("chromium.log").to_string_lossy().as_ref()),
        remote_debugging_port: std::env::var("FIREFLIES_CHROMIUM_DEBUG_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(0),
        ..Default::default()
    };
    let mut app = FirefliesApp::new();
    if initialize(Some(args.as_main_args()), Some(&settings), Some(&mut app), std::ptr::null_mut()) != 1 {
        return Err(format!("Chromium did not initialize (see {})", profile.join("chromium.log").display()));
    }
    let block = block2::RcBlock::new(|_t: std::ptr::NonNull<NSTimer>| pump());
    let timer = unsafe { NSTimer::scheduledTimerWithTimeInterval_repeats_block(1.0 / 60.0, true, &block) };
    // Also while a menu tracks or a window resizes (the default mode stops then).
    unsafe {
        let run_loop: Retained<AnyObject> = msg_send![objc2::class!(NSRunLoop), mainRunLoop];
        let common = objc2_foundation::NSString::from_str("kCFRunLoopCommonModes");
        let _: () = msg_send![&*run_loop, addTimer: &*timer, forMode: &*common];
    }
    PUMP.with(|p| *p.borrow_mut() = Some(timer));
    Ok(())
}

/// CEF requires the application object to implement CefAppProtocol
/// (`isHandlingSendEvent`, `setHandlingSendEvent:`) and to set the flag while
/// `sendEvent:` runs. GPUI's `GPUIApplication` doesn't, and isn't ours to
/// subclass: the methods and the protocols are added to its class at run
/// time, and its `sendEvent:` is wrapped. Runs once, after the framework is
/// loaded (the protocols are defined in it).
fn install_app_protocol() -> Result<(), String> {
    unsafe extern "C-unwind" fn is_handling(_this: &AnyObject, _cmd: Sel) -> Bool {
        Bool::new(SENDING.with(Cell::get))
    }
    unsafe extern "C-unwind" fn set_handling(_this: &AnyObject, _cmd: Sel, on: Bool) {
        SENDING.with(|s| s.set(on.as_bool()));
    }
    unsafe extern "C-unwind" fn send_event(this: &AnyObject, cmd: Sel, event: *mut AnyObject) {
        let was = SENDING.with(|s| s.replace(true));
        if let Some(orig) = SEND_EVENT.with(Cell::get) {
            // SAFETY: the implementation `sendEvent:` had before this wrapper.
            let f: unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) = unsafe { std::mem::transmute(orig) };
            unsafe { f(this, cmd, event) };
        }
        SENDING.with(|s| s.set(was));
    }
    let app: Option<Retained<AnyObject>> = unsafe { msg_send![objc2::class!(NSApplication), sharedApplication] };
    let app = app.ok_or("no NSApplication")?;
    let cls: &AnyClass = app.class();
    if cls.responds_to(sel!(isHandlingSendEvent)) {
        return Ok(());
    }
    let cls_ptr = cls as *const AnyClass as *mut AnyClass;
    unsafe {
        let types_bool = c"c@:";
        let types_set = c"v@:c";
        let types_send = c"v@:@";
        objc2::ffi::class_addMethod(cls_ptr.cast(), sel!(isHandlingSendEvent), std::mem::transmute::<_, Imp>(is_handling as unsafe extern "C-unwind" fn(_, _) -> _), types_bool.as_ptr());
        objc2::ffi::class_addMethod(cls_ptr.cast(), sel!(setHandlingSendEvent:), std::mem::transmute::<_, Imp>(set_handling as unsafe extern "C-unwind" fn(_, _, _)), types_set.as_ptr());
        let m = objc2::ffi::class_getInstanceMethod(cls_ptr.cast(), sel!(sendEvent:));
        if m.is_null() {
            return Err("NSApplication has no sendEvent:".into());
        }
        let orig = objc2::ffi::method_getImplementation(m);
        SEND_EVENT.with(|s| s.set(orig));
        let ours = std::mem::transmute::<_, Imp>(send_event as unsafe extern "C-unwind" fn(_, _, _));
        // Added on the app's own class (it may only inherit NSApplication's),
        // else replaced there.
        if !objc2::ffi::class_addMethod(cls_ptr.cast(), sel!(sendEvent:), ours, types_send.as_ptr()).as_bool() {
            objc2::ffi::method_setImplementation(m, ours);
        }
        for name in [c"CrAppProtocol", c"CrAppControlProtocol", c"CefAppProtocol"] {
            if let Some(p) = AnyProtocol::get(name) {
                objc2::ffi::class_addProtocol(cls_ptr.cast(), p as *const AnyProtocol as *mut _);
            }
        }
    }
    Ok(())
}

/// Whether the app object now answers CefAppProtocol (for native.debug).
pub fn app_protocol() -> bool {
    let app: Option<Retained<AnyObject>> = unsafe { msg_send![objc2::class!(NSApplication), sharedApplication] };
    app.is_some_and(|a| a.class().responds_to(sel!(isHandlingSendEvent)))
}

/// Creates a browser as a child of `parent` (its view's HoleHost).
pub fn create(
    mtm: MainThreadMarker,
    key: &str,
    parent: &NSView,
    url: &str,
    generation: u64,
    tabs: bool,
) -> Result<(Retained<NSView>, ChromiumView), String> {
    ensure_started(mtm)?;
    let info = Arc::new(Mutex::new(Info::default()));
    let gen_cell = Arc::new(AtomicU64::new(generation));
    let mut window_info = WindowInfo::default().set_as_child(
        parent as *const NSView as *mut c_void as _,
        &Rect { x: 0, y: 0, width: 1, height: 1 },
    );
    // A browser with a native parent is always Alloy style on macOS.
    window_info.runtime_style = RuntimeStyle::ALLOY;
    let mut client = FirefliesClient::new(key.to_owned(), info.clone(), gen_cell.clone(), tabs);
    let browser = browser_host_create_browser_sync(
        Some(&window_info),
        Some(&mut client),
        Some(&CefString::from(url)),
        Some(&BrowserSettings::default()),
        None,
        None,
    )
    .ok_or("Chromium could not create a browser")?;
    let view = browser_view(&browser)?;
    Ok((view, ChromiumView { key: key.to_owned(), browser, info, generation: gen_cell }))
}

fn browser_view(browser: &Browser) -> Result<Retained<NSView>, String> {
    let host = browser.host().ok_or("browser has no host")?;
    let handle = host.window_handle();
    // SAFETY: CEF returns the browser's NSView (a subview of its parent); we retain it.
    unsafe { Retained::retain(handle as *mut NSView) }.ok_or_else(|| "browser has no view".into())
}

pub fn close_dev_tools(of: &ChromiumView) {
    if let Some(h) = of.browser.host() {
        h.close_dev_tools();
    }
}

impl ChromiumView {
    pub fn load(&self, url: &str, generation: u64) {
        self.generation.store(generation, Ordering::Relaxed);
        if let Some(f) = self.browser.main_frame() {
            f.load_url(Some(&CefString::from(url)));
        }
    }

    pub fn state(&self) -> Value {
        let i = self.info.lock().unwrap();
        let zoom = self.browser.host().map(|h| h.zoom_level()).unwrap_or(0.0);
        json!({
            "url": crate::redact_url(&i.url),
            "href": i.url,
            "title": i.title,
            "loading": i.loading,
            "progress": i.progress,
            "canGoBack": i.can_back,
            "canGoForward": i.can_forward,
            "zoomLevel": zoom,
            "video": i.video,
            "engine": "chromium",
            "devTools": self.browser.host().is_some_and(|h| h.has_dev_tools() != 0),
        })
    }

    /// The page zoom as a factor (1 = 100%); Chromium's level is log-1.2.
    pub fn set_zoom(&self, factor: f64) {
        if let Some(h) = self.browser.host() {
            h.set_zoom_level(factor.max(0.01).ln() / 1.2f64.ln());
        }
    }

    pub fn action(&self, action: &str, _args: &Value) -> Result<Value, String> {
        let b = &self.browser;
        let host = b.host().ok_or("browser has no host")?;
        match action {
            "browser.back" => {
                let could = b.can_go_back() != 0;
                b.go_back();
                return Ok(json!(could));
            }
            "browser.forward" => {
                let could = b.can_go_forward() != 0;
                b.go_forward();
                return Ok(json!(could));
            }
            "browser.reload" => {
                b.reload();
                return Ok(json!(true));
            }
            "browser.stop" => b.stop_load(),
            "browser.zoomIn" => host.set_zoom_level(host.zoom_level() + 0.5),
            "browser.zoomOut" => host.set_zoom_level(host.zoom_level() - 0.5),
            "browser.zoomReset" => host.set_zoom_level(0.0),
            "focus" => host.set_focus(1),
            _ => return Err(format!("`{action}` is not available for Chromium views")),
        }
        Ok(Value::Null)
    }

    pub fn close(&self) {
        if let Some(h) = self.browser.host() {
            h.close_dev_tools();
            h.close_browser(1);
        }
    }
}

/// The marker a page script prefixes its console messages with. The page can
/// write the same text, so what comes through it only drives a button (the
/// picture in picture button), never anything that matters more.
const MARK: &str = "\u{2063}fireflies:";

/// Per document: whether it has a <video>, debounced, as page.rs does for WebKit.
const PAGE_SCRIPT: &str = r#"(() => {
  if (window.__firefliesPage) return; window.__firefliesPage = true;
  const M = "⁣fireflies:";
  let has = null, queued = false;
  const check = () => { queued = false; const now = document.querySelector("video") !== null; if (now !== has) { has = now; console.debug(M + JSON.stringify({ type: "video", has: now })); } };
  const soon = () => { if (!queued) { queued = true; setTimeout(check, 150); } };
  new MutationObserver(soon).observe(document, { childList: true, subtree: true });
  check();
})();"#;

wrap_client! {
    struct FirefliesClient {
        key: String,
        info: Arc<Mutex<Info>>,
        generation: Arc<AtomicU64>,
        tabs: bool,
    }

    impl Client {
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(FirefliesDisplay::new(self.key.clone(), self.info.clone(), self.generation.clone()))
        }
        fn load_handler(&self) -> Option<LoadHandler> {
            Some(FirefliesLoad::new(self.key.clone(), self.info.clone(), self.generation.clone()))
        }
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(FirefliesLifeSpan::new(self.key.clone(), self.generation.clone(), self.tabs))
        }
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(FirefliesRequest::new(self.key.clone(), self.generation.clone(), self.tabs))
        }
    }
}

fn page_state(info: &Info) -> Value {
    json!({
        "url": crate::redact_url(&info.url),
        "href": info.url,
        "title": info.title,
        "loading": info.loading,
        "progress": info.progress,
        "canGoBack": info.can_back,
        "canGoForward": info.can_forward,
    })
}

wrap_display_handler! {
    struct FirefliesDisplay {
        key: String,
        info: Arc<Mutex<Info>>,
        generation: Arc<AtomicU64>,
    }

    impl DisplayHandler {
        fn on_address_change(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, url: Option<&CefString>) {
            if frame.is_some_and(|f| f.is_main() == 0) {
                return;
            }
            let state = {
                let mut i = self.info.lock().unwrap();
                i.url = url.map(|u| u.to_string()).unwrap_or_default();
                page_state(&i)
            };
            report(&self.key, &self.generation, "web.location", state);
        }
        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let state = {
                let mut i = self.info.lock().unwrap();
                i.title = title.map(|t| t.to_string()).unwrap_or_default();
                page_state(&i)
            };
            report(&self.key, &self.generation, "web.location", state);
        }
        fn on_loading_progress_change(&self, _browser: Option<&mut Browser>, progress: f64) {
            self.info.lock().unwrap().progress = progress;
        }
        fn on_favicon_urlchange(&self, _browser: Option<&mut Browser>, icon_urls: Option<&mut CefStringList>) {
            // Iterate CEF's own (borrowed) list: cef-rs's `clone()` copies the
            // opaque handle and comes back empty (HUP's finding).
            let urls: Vec<String> = icon_urls.map(|l| std::mem::take(l).into_iter().collect()).unwrap_or_default();
            let href = urls.into_iter().find(|u| u.starts_with("https://") || u.starts_with("http://"));
            report(&self.key, &self.generation, "web.icon", json!({ "href": href }));
        }
        fn on_console_message(&self, _browser: Option<&mut Browser>, _level: LogSeverity, message: Option<&CefString>, _source: Option<&CefString>, _line: i32) -> i32 {
            let Some(text) = message.map(|m| m.to_string()) else { return 0 };
            let Some(rest) = text.strip_prefix(MARK) else { return 0 };
            let Ok(v) = serde_json::from_str::<Value>(rest) else { return 1 };
            if v["type"] == "video" {
                let has = v["has"].as_bool().unwrap_or(false);
                self.info.lock().unwrap().video = has;
                report(&self.key, &self.generation, "web.video", json!({ "present": has }));
            }
            // Not in the log.
            1
        }
    }
}

wrap_load_handler! {
    struct FirefliesLoad {
        key: String,
        info: Arc<Mutex<Info>>,
        generation: Arc<AtomicU64>,
    }

    impl LoadHandler {
        fn on_loading_state_change(&self, _browser: Option<&mut Browser>, is_loading: i32, can_go_back: i32, can_go_forward: i32) {
            let state = {
                let mut i = self.info.lock().unwrap();
                i.loading = is_loading != 0;
                i.can_back = can_go_back != 0;
                i.can_forward = can_go_forward != 0;
                page_state(&i)
            };
            report(&self.key, &self.generation, if is_loading != 0 { "load.start" } else { "load.finish" }, state);
        }
        fn on_load_start(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, _transition_type: TransitionType) {
            if frame.is_some_and(|f| f.is_main() == 0) {
                return;
            }
            let state = {
                let mut i = self.info.lock().unwrap();
                i.video = false;
                page_state(&i)
            };
            report(&self.key, &self.generation, "load.commit", state);
        }
        fn on_load_end(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, _http_status_code: i32) {
            if let Some(f) = frame {
                f.execute_java_script(Some(&CefString::from(PAGE_SCRIPT)), None, 0);
            }
        }
        fn on_load_error(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, error_code: Errorcode, error_text: Option<&CefString>, failed_url: Option<&CefString>) {
            if frame.is_some_and(|f| f.is_main() == 0) {
                return;
            }
            let code: i32 = unsafe { std::mem::transmute_copy(&error_code) };
            // ERR_ABORTED (-3): a navigation replaced by another; not a failure to show.
            if code == -3 {
                return;
            }
            let mut state = page_state(&self.info.lock().unwrap());
            state["message"] = json!(error_text.map(|t| t.to_string()).unwrap_or_default());
            state["code"] = json!(code);
            state["domain"] = json!("chromium");
            state["failingUrl"] = json!(failed_url.map(|u| u.to_string()));
            report(&self.key, &self.generation, "load.error", state);
        }
    }
}

/// `WindowOpenDisposition`'s raw value.
fn disposition(d: &WindowOpenDisposition) -> i32 {
    unsafe { std::mem::transmute_copy(d) }
}
/// cef_window_open_disposition_t: NEW_FOREGROUND_TAB 3, NEW_BACKGROUND_TAB 4.
const NEW_BACKGROUND_TAB: i32 = 4;

wrap_life_span_handler! {
    struct FirefliesLifeSpan {
        key: String,
        generation: Arc<AtomicU64>,
        tabs: bool,
    }

    impl LifeSpanHandler {
        // target=_blank and window.open (user-initiated): a new tab in front
        // for a mod that keeps tabs (web.newTab, from "window"), else in place.
        fn on_before_popup(
            &self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: i32,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            target_disposition: WindowOpenDisposition,
            user_gesture: i32,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut i32>,
        ) -> i32 {
            let Some(url) = target_url.map(|u| u.to_string()) else { return 1 };
            if self.tabs {
                let background = disposition(&target_disposition) == NEW_BACKGROUND_TAB;
                report(&self.key, &self.generation, "web.newTab", json!({ "url": url, "background": background, "from": "window" }));
            } else if user_gesture != 0
                && let Some(f) = browser.and_then(|b| b.main_frame())
            {
                f.load_url(Some(&CefString::from(url.as_str())));
                report(&self.key, &self.generation, "web.newWindowInPlace", json!({}));
            }
            1
        }
    }
}

wrap_request_handler! {
    struct FirefliesRequest {
        key: String,
        generation: Arc<AtomicU64>,
        tabs: bool,
    }

    impl RequestHandler {
        // A middle or Cmd click on a link: a tab behind (Shift: in front).
        fn on_open_urlfrom_tab(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, target_url: Option<&CefString>, target_disposition: WindowOpenDisposition, _user_gesture: i32) -> i32 {
            if !self.tabs {
                return 0;
            }
            let Some(url) = target_url.map(|u| u.to_string()) else { return 0 };
            let background = disposition(&target_disposition) == NEW_BACKGROUND_TAB;
            report(&self.key, &self.generation, "web.newTab", json!({ "url": url, "background": background, "from": "click" }));
            1
        }
        fn on_render_process_terminated(&self, _browser: Option<&mut Browser>, _status: TerminationStatus, _error_code: i32, _error_string: Option<&CefString>) {
            report(&self.key, &self.generation, "web.processTerminated", json!({}));
        }
    }
}
