//! `gpui::Platform` for iOS: what one full-screen app needs; desktop-only
//! parts (menus, dock, other apps, path prompts, cursors) are no-ops.

use super::window::{IosDisplay, IosWindow};
use crate::AppleDispatcher;
use anyhow::Result;
use futures::channel::oneshot;
use gpui::{
    Action, ActivityGuard, AnyWindowHandle, BackgroundExecutor, ClipboardItem, CursorStyle,
    DummyKeyboardMapper, ForegroundExecutor, Keymap, Menu, MenuItem, PathPromptOptions, Platform,
    PlatformDisplay, PlatformKeyboardLayout, PlatformKeyboardMapper, PlatformTextSystem,
    PlatformWindow, Task, ThermalState, WindowAppearance, WindowParams,
};
use parking_lot::Mutex;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

pub struct IosPlatform {
    background_executor: BackgroundExecutor,
    foreground_executor: ForegroundExecutor,
    text_system: Arc<dyn PlatformTextSystem>,
    renderer_context: crate::metal_renderer::Context,
    clipboard: Mutex<Option<ClipboardItem>>,
}

impl IosPlatform {
    pub fn new(text_system: Arc<dyn PlatformTextSystem>) -> Self {
        let dispatcher = Arc::new(AppleDispatcher::new());
        Self {
            background_executor: BackgroundExecutor::new(dispatcher.clone()),
            foreground_executor: ForegroundExecutor::new(dispatcher),
            text_system,
            renderer_context: Default::default(),
            clipboard: Mutex::new(None),
        }
    }
}

struct IosKeyboardLayout;

impl PlatformKeyboardLayout for IosKeyboardLayout {
    fn id(&self) -> &str {
        "ios"
    }
    fn name(&self) -> &str {
        "iOS"
    }
}

impl Platform for IosPlatform {
    fn background_executor(&self) -> BackgroundExecutor {
        self.background_executor.clone()
    }
    fn foreground_executor(&self) -> ForegroundExecutor {
        self.foreground_executor.clone()
    }
    fn text_system(&self) -> Arc<dyn PlatformTextSystem> {
        self.text_system.clone()
    }
    /// UIKit's run loop belongs to `UIApplicationMain`: launch and return
    /// (use `Application::run_embedded`).
    fn run(&self, on_finish_launching: Box<dyn 'static + FnOnce()>) {
        on_finish_launching();
    }
    fn quit(&self) {}
    fn restart(&self, _: Option<PathBuf>, _: Vec<OsString>) {}
    fn activate(&self, _: bool) {}
    fn hide(&self) {}
    fn hide_other_apps(&self) {}
    fn unhide_other_apps(&self) {}
    fn displays(&self) -> Vec<Rc<dyn PlatformDisplay>> {
        vec![Rc::new(IosDisplay)]
    }
    fn primary_display(&self) -> Option<Rc<dyn PlatformDisplay>> {
        Some(Rc::new(IosDisplay))
    }
    fn active_window(&self) -> Option<AnyWindowHandle> {
        None
    }
    fn open_window(
        &self,
        handle: AnyWindowHandle,
        _options: WindowParams,
    ) -> Result<Box<dyn PlatformWindow>> {
        Ok(Box::new(IosWindow::open(handle, self.renderer_context.clone())?))
    }
    fn window_appearance(&self) -> WindowAppearance {
        WindowAppearance::Dark
    }
    fn open_url(&self, _: &str) {}
    fn on_open_urls(&self, _: Box<dyn FnMut(Vec<String>)>) {}
    fn register_url_scheme(&self, _: &str) -> Task<Result<()>> {
        Task::ready(Ok(()))
    }
    fn prompt_for_paths(
        &self,
        _: PathPromptOptions,
    ) -> oneshot::Receiver<Result<Option<Vec<PathBuf>>>> {
        oneshot::channel().1
    }
    fn prompt_for_new_path(
        &self,
        _: &Path,
        _: Option<&str>,
    ) -> oneshot::Receiver<Result<Option<PathBuf>>> {
        oneshot::channel().1
    }
    fn can_select_mixed_files_and_dirs(&self) -> bool {
        false
    }
    fn reveal_path(&self, _: &Path) {}
    fn open_with_system(&self, _: &Path) {}
    fn on_quit(&self, _: Box<dyn FnMut() -> bool>) {}
    fn on_reopen(&self, _: Box<dyn FnMut()>) {}
    fn on_system_sleep(&self, _: Box<dyn FnMut()>) {}
    fn on_system_wake(&self, _: Box<dyn FnMut()>) {}
    fn set_menus(&self, _: Vec<Menu>, _: &Keymap) {}
    fn set_dock_menu(&self, _: Vec<MenuItem>, _: &Keymap) {}
    fn on_app_menu_action(&self, _: Box<dyn FnMut(&dyn Action)>) {}
    fn on_will_open_app_menu(&self, _: Box<dyn FnMut()>) {}
    fn on_validate_app_menu_command(&self, _: Box<dyn FnMut(&dyn Action) -> bool>) {}
    fn thermal_state(&self) -> ThermalState {
        ThermalState::Nominal
    }
    fn on_thermal_state_change(&self, _: Box<dyn FnMut()>) {}
    fn prevent_idle_sleep(&self, _: &str) -> Task<Result<ActivityGuard>> {
        Task::ready(Ok(ActivityGuard::new(|| {})))
    }
    fn app_path(&self) -> Result<PathBuf> {
        Ok(std::env::current_exe()?)
    }
    fn path_for_auxiliary_executable(&self, _: &str) -> Result<PathBuf> {
        anyhow::bail!("iOS apps run no helper executables")
    }
    fn set_cursor_style(&self, _: CursorStyle) {}
    fn hide_cursor_until_mouse_moves(&self) {}
    fn is_cursor_visible(&self) -> bool {
        false
    }
    fn should_auto_hide_scrollbars(&self) -> bool {
        true
    }
    fn read_from_clipboard(&self) -> Option<ClipboardItem> {
        self.clipboard.lock().clone()
    }
    fn write_to_clipboard(&self, item: ClipboardItem) {
        *self.clipboard.lock() = Some(item);
    }
    fn write_credentials(&self, _: &str, _: &str, _: &[u8]) -> Task<Result<()>> {
        Task::ready(Ok(()))
    }
    fn read_credentials(&self, _: &str) -> Task<Result<Option<(String, Vec<u8>)>>> {
        Task::ready(Ok(None))
    }
    fn delete_credentials(&self, _: &str) -> Task<Result<()>> {
        Task::ready(Ok(()))
    }
    fn keyboard_layout(&self) -> Box<dyn PlatformKeyboardLayout> {
        Box::new(IosKeyboardLayout)
    }
    fn keyboard_mapper(&self) -> Rc<dyn PlatformKeyboardMapper> {
        Rc::new(DummyKeyboardMapper)
    }
    fn on_keyboard_layout_change(&self, _: Box<dyn FnMut()>) {}
}
