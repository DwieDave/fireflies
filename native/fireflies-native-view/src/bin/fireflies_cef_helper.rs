//! Chromium's helper process for Fireflies (GPU, renderer, plugin, alerts and
//! utility processes). Copied into each `Fireflies Helper*.app` beside the CEF
//! framework in the app's data folder when Chromium is enabled.
fn main() {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().expect("helper path");
        // The framework sits beside the helper apps: ../../.. from Contents/MacOS.
        let loader = cef::library_loader::LibraryLoader::new(&exe, true);
        if !loader.load() {
            eprintln!("fireflies-cef-helper: can't load the Chromium framework");
            std::process::exit(1);
        }
        let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
        let args = cef::args::Args::new();
        let code = cef::execute_process(Some(args.as_main_args()), None, std::ptr::null_mut());
        std::process::exit(code.max(0));
    }
}
