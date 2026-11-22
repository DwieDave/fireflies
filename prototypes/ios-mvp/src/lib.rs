//! Fireflies iOS MVP: GPUI draws one full-screen view on iOS and counts taps.
//! The Swift host (`host/main.swift`) owns UIKit and calls these functions.

#[cfg(target_os = "ios")]
mod app {
    use gpui::{
        App, AppContext as _, Application, ApplicationHandle, Context, IntoElement,
        InteractiveElement as _, ParentElement as _, Render, StatefulInteractiveElement as _,
        Styled as _, Window, WindowOptions, div, px, rgb,
    };
    use gpui_apple::ios::{IosPlatform, IosTextSystem, host};
    use std::{cell::RefCell, ffi::c_void, rc::Rc, sync::Arc};

    thread_local! {
        static APP: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    }

    struct Counter {
        taps: usize,
        /// The Effect mod's view, or why it failed, and how long its load took.
        effect_mod: Result<gpui::Entity<gpui_shell::ScriptView>, String>,
        load_ms: u128,
    }

    /// `defaults/lib` (copied into the bundle by build.sh) served to mods by
    /// name, as src/mods.rs `export_libraries` does on the desktop.
    fn export_libraries(lib: &std::path::Path) {
        fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<(String, String)>) {
            for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, out);
                    continue;
                }
                let name = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
                let code = (name.ends_with(".ts") && !name.ends_with(".d.ts")) || name.ends_with(".js");
                if code {
                    out.push((name, std::fs::read_to_string(&path).unwrap_or_default()));
                }
            }
        }
        let mut files = Vec::new();
        walk(lib, lib, &mut files);
        gpui_shell::library_modules::export_libraries(files);
    }

    fn mount_effect_mod(window: &mut Window, cx: &mut App) -> (Result<gpui::Entity<gpui_shell::ScriptView>, String>, u128) {
        let bundle = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
        export_libraries(&bundle.join("lib"));
        let started = std::time::Instant::now();
        let result = (|| {
            let runtime = gpui_shell::ShellRuntime::new(cx)?;
            let app = runtime.load_application(&bundle.join("mod"), "main.ts")?;
            runtime.mount_application(&app, window, cx)
        })()
        .map_err(|e| format!("{e:#}"));
        (result, started.elapsed().as_millis())
    }

    impl Render for Counter {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .bg(rgb(0x0b0f1a))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(24.))
                .font_family("Helvetica Neue")
                .text_color(rgb(0xe8e6e3))
                .child(div().text_size(px(28.)).font_weight(gpui::FontWeight::SEMIBOLD).child("Fireflies on iOS"))
                .child(div().text_size(px(15.)).text_color(rgb(0x8b93a7)).child("GPUI · Metal · UIKit touch"))
                .child(
                    div()
                        .id("tap-target")
                        .size(px(200.))
                        .rounded(px(24.))
                        .bg(if self.taps % 2 == 0 { rgb(0xf2c14e) } else { rgb(0x4ecdc4) })
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.taps += 1;
                            cx.notify();
                        })),
                )
                .child(div().text_size(px(20.)).child(format!("taps: {}", self.taps)))
                .child(match &self.effect_mod {
                    Ok(view) => div().w(px(330.)).child(view.clone()),
                    Err(e) => div().w(px(330.)).text_size(px(12.)).text_color(rgb(0xff6b6b)).child(e.clone()),
                })
                .child(div().text_size(px(13.)).text_color(rgb(0x8b93a7)).child(format!("effect + kit + mod loaded in {} ms", self.load_ms)))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .w(px(300.))
                        .justify_center()
                        .children((0..self.taps).map(|_| div().size(px(20.)).rounded(px(4.)).bg(rgb(0xe8e6e3)))),
                )
        }
    }

    pub fn start(layer: *mut c_void, width: f32, height: f32, scale: f32, taps: usize) {
        unsafe { host::attach_layer(layer, width, height, scale) };
        let platform = Rc::new(IosPlatform::new(Arc::new(IosTextSystem::new())));
        let handle = Application::with_platform(platform).run_embedded(move |cx: &mut App| {
            cx.open_window(WindowOptions::default(), |window, cx| {
                let (effect_mod, load_ms) = mount_effect_mod(window, cx);
                cx.new(|_| Counter { taps, effect_mod, load_ms })
            })
                .expect("open the window");
        });
        APP.with(|a| *a.borrow_mut() = Some(handle));
    }
}

/// # Safety
/// `layer` is the host view's live `CAMetalLayer`; call once, on the main thread.
#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ffm_start(layer: *mut std::ffi::c_void, width: f32, height: f32, scale: f32) {
    app::start(layer, width, height, scale, 0);
}

#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_frame() {
    gpui_apple::ios::host::frame();
}

#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_resize(width: f32, height: f32, scale: f32) {
    gpui_apple::ios::host::resize(width, height, scale);
}

/// `phase`: 0 began, 1 moved, 2 ended, 3 cancelled; points from the top left.
#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_touch(id: u64, phase: u8, x: f32, y: f32) {
    gpui_apple::ios::host::touch(id, phase, x, y);
}
