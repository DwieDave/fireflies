//! Where the app keeps its files: its home (settings, keys, layouts, mods,
//! scratchpad, the control socket) and the machine's cache. Every path under
//! either is built from here.

use std::path::PathBuf;

/// A non-empty environment variable, as a path.
fn var(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// `$XDG_CONFIG_HOME`, else `~/.config`, on every OS.
fn config_base() -> PathBuf {
    var("XDG_CONFIG_HOME").unwrap_or_else(|| crate::mods::home().join(".config"))
}

/// `$XDG_CACHE_HOME`, else `~/.cache`, on every OS.
fn cache_base() -> PathBuf {
    var("XDG_CACHE_HOME").unwrap_or_else(|| crate::mods::home().join(".cache"))
}

/// The app's home: `$HERDR_APP_HOME` (tests, experiments), else
/// `$XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app`.
pub fn app_home() -> PathBuf {
    var("HERDR_APP_HOME").unwrap_or_else(|| config_base().join("herdr-app"))
}

/// The cache every app on this machine shares (the usage-limits records):
/// `$XDG_CACHE_HOME/herdr-app`, else `~/.cache/herdr-app`.
#[allow(dead_code)]
pub fn cache_dir() -> PathBuf {
    cache_base().join("herdr-app")
}
