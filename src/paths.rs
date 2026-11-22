//! Where the app keeps its files: its home (settings, keys, layouts, mods,
//! scratchpad, the control socket) and the machine's cache. Every path under
//! either is built from here.
//!
//! The home is `~/.config/fireflies/app` and the cache `~/.cache/fireflies`.
//! Herdr kept them in `~/.config/herdr-app` and `~/.cache/herdr-app`: the
//! first start of a window moves each one (`migrate`) and leaves a link in its
//! place, so the Herdr iOS app over ssh, older binaries and scripts that name
//! the old folders keep reaching the same files.

use std::io;
use std::path::{Path, PathBuf};

/// Herdr's name for both folders.
const OLD: &str = "herdr-app";

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

/// The home's old place and its new one.
fn home_places() -> (PathBuf, PathBuf) {
    let base = config_base();
    (base.join(OLD), base.join("fireflies").join("app"))
}

/// The cache's old place and its new one.
fn cache_places() -> (PathBuf, PathBuf) {
    let base = cache_base();
    (base.join(OLD), base.join("fireflies"))
}

/// The app's home: `$HERDR_APP_HOME` (tests, experiments), else
/// `$XDG_CONFIG_HOME/fireflies/app`, else `~/.config/fireflies/app`, while
/// `~/.config/herdr-app` hasn't been moved there.
pub fn app_home() -> PathBuf {
    var("HERDR_APP_HOME").unwrap_or_else(|| {
        let (old, new) = home_places();
        pick(old, new)
    })
}

/// The cache every app on this machine shares (the usage-limits records):
/// `$XDG_CACHE_HOME/fireflies`, else `~/.cache/fireflies`, while
/// `~/.cache/herdr-app` hasn't been moved there.
#[allow(dead_code)]
pub fn cache_dir() -> PathBuf {
    let (old, new) = cache_places();
    pick(old, new)
}

/// `path` for people to read: `~/…` below the home folder.
pub fn shown(path: &Path) -> String {
    let home = crate::mods::home();
    match path.strip_prefix(&home) {
        Ok(rest) if home != Path::new("/") && !rest.as_os_str().is_empty() => format!("~/{}", rest.display()),
        _ => path.display().to_string(),
    }
}

/// Which of the two places is in use. The old folder, while it is a real
/// folder: not moved yet, its move failed, or the new one appeared beside it
/// (never merged: its files stay where the app has been writing them). Else
/// the new one, unless only the old name exists, as a link of the person's own
/// to somewhere else.
fn pick(old: PathBuf, new: PathBuf) -> PathBuf {
    if real_folder(&old) || (!new.exists() && old.is_dir()) { old } else { new }
}

/// What `move_folder` found or did.
#[derive(Debug, PartialEq)]
enum Moved {
    /// The folder went to its new place; the old name links to it.
    Now,
    /// Already there: the old name is a link, missing, or not a folder.
    Before,
    /// Both places are real folders: nothing moved, the old one stays in use.
    Both,
}

/// Moves the home and the cache to their new places, once, and leaves a link
/// at each old one. Runs when a window starts, before anything reads the home,
/// and only after no window answered on it (so a running one is never moved
/// under). A home chosen with `HERDR_APP_HOME` (tests, scratch apps) stays
/// put, and so does the machine's cache then. On any error the folder stays
/// where it was and the app runs from there.
pub fn migrate() {
    if var("HERDR_APP_HOME").is_some() {
        return;
    }
    // Windows: a link needs developer mode or an administrator, so the folders stay.
    if cfg!(windows) {
        return;
    }
    for (what, (old, new)) in [("home", home_places()), ("cache", cache_places())] {
        match move_folder(&old, &new, link) {
            Ok(Moved::Now) => tracing::info!("moved the app's {what} from {} to {}", old.display(), new.display()),
            Ok(Moved::Before) => {}
            Ok(Moved::Both) => tracing::warn!(
                "the app's {what}: both {} and {} are folders; running from the first (move or delete one by hand)",
                old.display(),
                new.display()
            ),
            Err(e) => tracing::warn!("the app's {what} stays in {} (moving it to {} failed: {e})", old.display(), new.display()),
        }
    }
}

/// A link at `at` to `to`, relative when `to` sits below `at`'s folder.
fn link(to: &Path, at: &Path) -> io::Result<()> {
    let target = at.parent().and_then(|dir| to.strip_prefix(dir).ok()).unwrap_or(to);
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, at);
    #[cfg(windows)]
    return std::os::windows::fs::symlink_dir(target, at);
}

/// Whether `at` is a folder itself, not a link to one.
fn real_folder(at: &Path) -> bool {
    std::fs::symlink_metadata(at).is_ok_and(|m| m.is_dir())
}

/// Whether `at` is a link that leads to the folder `to`.
fn links_to(at: &Path, to: &Path) -> bool {
    std::fs::symlink_metadata(at).is_ok_and(|m| m.file_type().is_symlink())
        && matches!((std::fs::canonicalize(at), std::fs::canonicalize(to)), (Ok(a), Ok(b)) if a == b)
}

/// Moves the folder `old` to `new` (a rename: same volume, never a copy) and
/// links `old` to it. Idempotent, and safe when another process does the same
/// at once: whoever loses the rename finds the folder moved. Rolls back when
/// the link can't be made, so old clients never find the old name missing.
fn move_folder(old: &Path, new: &Path, link: impl Fn(&Path, &Path) -> io::Result<()>) -> io::Result<Moved> {
    match std::fs::symlink_metadata(old) {
        Ok(m) if m.is_dir() => {}
        // Moved earlier, and the link went missing: put it back.
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            if new.is_dir() && !links_to(old, new) {
                return relink(old, new, &link);
            }
            return Ok(Moved::Before);
        }
        Err(e) => return Err(e),
        // A link (moved already, or the person's own) or a file stays as it is.
        Ok(_) => return Ok(Moved::Before),
    }
    if std::fs::symlink_metadata(new).is_ok() {
        // Moved by another start since the look above: only its link is missing.
        if !real_folder(old) {
            return relink(old, new, &link);
        }
        return Ok(Moved::Both);
    }
    let parent = new.parent().expect("the new place is below a folder");
    let made_parent = !parent.exists();
    std::fs::create_dir_all(parent)?;
    if let Err(e) = std::fs::rename(old, new) {
        // Another process moved it first.
        if new.is_dir() && !real_folder(old) {
            return relink(old, new, &link);
        }
        if made_parent {
            let _ = std::fs::remove_dir(parent);
        }
        return Err(e);
    }
    if let Err(e) = link(new, old) {
        // Another process made it already.
        if links_to(old, new) {
            return Ok(Moved::Now);
        }
        return match std::fs::rename(new, old) {
            Ok(()) => {
                if made_parent {
                    let _ = std::fs::remove_dir(parent);
                }
                Err(io::Error::new(e.kind(), format!("no link at the old place ({e}); moved back")))
            }
            Err(back) => Err(io::Error::new(e.kind(), format!("no link at the old place ({e}), and moving back failed ({back})"))),
        };
    }
    Ok(Moved::Now)
}

/// The link at `old` to the moved folder `new`, unless one is there.
fn relink(old: &Path, new: &Path, link: impl Fn(&Path, &Path) -> io::Result<()>) -> io::Result<Moved> {
    match link(new, old) {
        Ok(()) => Ok(Moved::Before),
        Err(_) if links_to(old, new) => Ok(Moved::Before),
        Err(e) => Err(e),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A temp HOME with `~/.config/herdr-app` holding one file, and the two places.
    fn home(test: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = crate::test_tmp().join(format!("ffp-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let old = root.join(".config/herdr-app");
        std::fs::create_dir_all(old.join("mods")).unwrap();
        std::fs::write(old.join("settings.json"), "{\"zoom\":0.9}").unwrap();
        (root.clone(), old, root.join(".config/fireflies/app"))
    }

    fn settings(dir: &Path) -> String {
        std::fs::read_to_string(dir.join("settings.json")).unwrap()
    }

    #[test]
    fn paths_below_the_home_folder_read_with_a_tilde() {
        let home = crate::mods::home();
        assert_eq!(shown(&home.join(".config/fireflies/app/mods/k8s")), "~/.config/fireflies/app/mods/k8s");
        assert_eq!(shown(Path::new("/var/tmp/ff/mods/k8s")), "/var/tmp/ff/mods/k8s");
    }

    #[test]
    fn moves_the_folder_and_leaves_a_relative_link() {
        let (root, old, new) = home("move");
        assert_eq!(pick(old.clone(), new.clone()), old, "before: the old folder");
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Now);
        assert!(std::fs::symlink_metadata(&new).unwrap().is_dir());
        assert_eq!(std::fs::read_link(&old).unwrap(), Path::new("fireflies/app"));
        assert_eq!(settings(&new), "{\"zoom\":0.9}");
        assert_eq!(settings(&old), "{\"zoom\":0.9}", "the old name reaches the same files");
        assert_eq!(pick(old.clone(), new.clone()), new);
        // A second start finds it moved and changes nothing.
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Before);
        assert_eq!(std::fs::read_link(&old).unwrap(), Path::new("fireflies/app"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_cache_moves_beside_its_old_name() {
        let root = crate::test_tmp().join(format!("ffp-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old, new) = (root.join(".cache/herdr-app"), root.join(".cache/fireflies"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("usage-claude.json"), "{}").unwrap();
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Now);
        assert_eq!(std::fs::read_link(&old).unwrap(), Path::new("fireflies"));
        assert!(old.join("usage-claude.json").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nothing_to_move_on_a_new_machine() {
        let root = crate::test_tmp().join(format!("ffp-fresh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old, new) = (root.join(".config/herdr-app"), root.join(".config/fireflies/app"));
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Before);
        assert!(!root.exists(), "no folder made");
        assert_eq!(pick(old, new.clone()), new);
    }

    #[test]
    fn a_link_at_the_old_place_stays_as_it_is() {
        let (root, old, new) = home("own-link");
        // The person's own link to a folder elsewhere: kept, and used.
        let elsewhere = root.join("dotfiles/herdr-app");
        std::fs::create_dir_all(elsewhere.parent().unwrap()).unwrap();
        std::fs::rename(&old, &elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &old).unwrap();
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Before);
        assert_eq!(std::fs::read_link(&old).unwrap(), elsewhere);
        assert!(!new.exists());
        assert_eq!(pick(old.clone(), new), old);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn both_folders_stay_and_the_old_one_is_used() {
        let (root, old, new) = home("both");
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join("settings.json"), "{}").unwrap();
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Both);
        assert_eq!(settings(&old), "{\"zoom\":0.9}");
        assert_eq!(settings(&new), "{}");
        assert_eq!(pick(old.clone(), new), old, "the folder the app has been writing");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failing_rename_leaves_everything_where_it_was() {
        let (root, old, new) = home("no-rename");
        // The new place's folder can't take it.
        let parent = new.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o555)).unwrap();
        assert!(move_folder(&old, &new, link).is_err());
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(std::fs::symlink_metadata(&old).unwrap().is_dir());
        assert_eq!(settings(&old), "{\"zoom\":0.9}");
        assert!(!new.exists());
        assert_eq!(pick(old.clone(), new), old, "the app runs from the old place");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_blocked_new_place_leaves_everything_where_it_was() {
        let root = crate::test_tmp().join(format!("ffp-no-parent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // A file where the new folder's parent would go.
        let old = root.join(".config/herdr-app");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(root.join(".config/fireflies")).unwrap();
        std::fs::write(root.join(".config/fireflies/app"), "a file").unwrap();
        let new = root.join(".config/fireflies/app/x");
        assert!(move_folder(&old, &new, link).is_err());
        assert!(std::fs::symlink_metadata(&old).unwrap().is_dir());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failing_link_moves_the_folder_back() {
        let (root, old, new) = home("no-link");
        let refuse = |_: &Path, _: &Path| Err(io::Error::new(io::ErrorKind::PermissionDenied, "no"));
        let e = move_folder(&old, &new, refuse).unwrap_err();
        assert!(e.to_string().contains("moved back"), "{e}");
        assert!(std::fs::symlink_metadata(&old).unwrap().is_dir());
        assert_eq!(settings(&old), "{\"zoom\":0.9}");
        assert!(!new.exists());
        assert!(!new.parent().unwrap().exists(), "the folder it made for the move is gone again");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_link_after_a_move_is_put_back() {
        let (root, old, new) = home("relink");
        move_folder(&old, &new, link).unwrap();
        std::fs::remove_file(&old).unwrap();
        assert_eq!(move_folder(&old, &new, link).unwrap(), Moved::Before);
        assert_eq!(std::fs::read_link(&old).unwrap(), Path::new("fireflies/app"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn two_starts_at_once_move_it_once() {
        for round in 0..20 {
            let (root, old, new) = home(&format!("race-{round}"));
            let results: Vec<io::Result<Moved>> = std::thread::scope(|s| {
                let a = s.spawn(|| move_folder(&old, &new, link));
                let b = s.spawn(|| move_folder(&old, &new, link));
                vec![a.join().unwrap(), b.join().unwrap()]
            });
            let moved: Vec<Moved> = results.into_iter().map(|r| r.expect("neither start fails")).collect();
            assert_eq!(moved.iter().filter(|m| **m == Moved::Now).count(), 1, "{moved:?}");
            assert_eq!(std::fs::read_link(&old).unwrap(), Path::new("fireflies/app"));
            assert_eq!(settings(&old), "{\"zoom\":0.9}");
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn old_clients_reach_the_socket_through_the_link() {
        use std::io::{Read, Write};
        use std::os::unix::net::{UnixListener, UnixStream};
        let (root, old, new) = home("sock");
        move_folder(&old, &new, link).unwrap();
        let listener = UnixListener::bind(new.join("herdr-app.sock")).unwrap();
        let mut client = UnixStream::connect(old.join("herdr-app.sock")).unwrap();
        client.write_all(b"hi").unwrap();
        let (mut served, _) = listener.accept().unwrap();
        let mut got = [0; 2];
        served.read_exact(&mut got).unwrap();
        assert_eq!(&got, b"hi");
        std::fs::remove_dir_all(root).unwrap();
    }
}
