//! The DMG has no installer to put the app's CLI on PATH.
//!
//! The app answers to two commands, `fireflies` and `herdr-app` (kept for
//! good: scripts, skills and setups call it), both links to the bundle's
//! executable in `~/.local/bin`.

use std::io;
use std::path::Path;

/// Bundle and executable names of an install: `Fireflies.app` from this
/// fork's installers, `Herdr.app` from earlier ones and from Herdr itself.
const NAMES: [&str; 2] = ["Fireflies", "Herdr"];
/// The commands linked to the running bundle.
const LINKS: [&str; 2] = ["fireflies", "herdr-app"];

fn app_bundle(exe: &Path) -> bool {
    exe.is_absolute() && NAMES.iter().any(|b| NAMES.iter().any(|e| exe.ends_with(format!("{b}.app/Contents/MacOS/{e}"))))
}

fn installed_bundle(exe: &Path) -> bool {
    app_bundle(exe)
        && !exe.starts_with("/Volumes")
        && !exe.components().any(|c| c.as_os_str() == "AppTranslocation" || c.as_os_str() == "target")
}

pub(super) fn ensure(home: &Path, exe: &Path) -> io::Result<()> {
    if !installed_bundle(exe) {
        return Ok(());
    }
    let mut first_error = None;
    for name in LINKS {
        if let Err(e) = link(&home.join(".local/bin").join(name), exe) {
            first_error.get_or_insert(e);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Points `link` at `exe` unless it's someone else's: a file, or a link to
/// something that isn't an app bundle.
fn link(link: &Path, exe: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(link) {
        Ok(meta) if meta.file_type().is_symlink() => {
            let target = std::fs::read_link(link)?;
            if target == exe {
                return Ok(());
            }
            let resolved = if target.is_absolute() { target } else { link.parent().unwrap().join(target) };
            if !app_bundle(&resolved) {
                return Ok(());
            }
            std::fs::remove_file(link)?;
        }
        Ok(_) => return Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    std::fs::create_dir_all(link.parent().unwrap())?;
    std::os::unix::fs::symlink(exe, link)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn repairs_only_our_cli_link() {
        let home = std::env::temp_dir().join(format!("herdr-cli-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let exe = home.join("Applications/Herdr.app/Contents/MacOS/Herdr");
        let link = home.join(".local/bin/herdr-app");
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        // Running it again leaves the same link alone.
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);

        for old in [
            home.join("old/Herdr.app/Contents/MacOS/Herdr"),
            "../../Applications/Herdr.app/Contents/MacOS/Herdr".into(),
            "/Volumes/Herdr/Herdr.app/Contents/MacOS/Herdr".into(),
            "/private/var/folders/AppTranslocation/old/d/Herdr.app/Contents/MacOS/Herdr".into(),
        ] {
            std::fs::remove_file(&link).unwrap();
            symlink(old, &link).unwrap();
            ensure(&home, &exe).unwrap();
            assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        }
        let old = home.join("previous/Herdr.app/Contents/MacOS/Herdr");
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(&old, "previous executable").unwrap();
        std::fs::remove_file(&link).unwrap();
        symlink(&old, &link).unwrap();
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        assert_eq!(std::fs::read_to_string(&old).unwrap(), "previous executable");

        std::fs::remove_file(&link).unwrap();
        std::fs::write(&link, "personal CLI").unwrap();
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "personal CLI");
        std::fs::remove_file(&link).unwrap();
        let foreign = home.join("other-app");
        symlink(&foreign, &link).unwrap();
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), foreign);
        std::fs::remove_file(&link).unwrap();

        for skipped in [
            "/Volumes/Herdr/Herdr.app/Contents/MacOS/Herdr",
            "/private/var/folders/AppTranslocation/random/d/Herdr.app/Contents/MacOS/Herdr",
            "/work/target/debug/Herdr.app/Contents/MacOS/Herdr",
            "/work/target/debug/herdr-app",
            "/Applications/Other.app/Contents/MacOS/Herdr",
        ] {
            ensure(&home, Path::new(skipped)).unwrap();
            assert!(link.symlink_metadata().is_err(), "{skipped}");
        }
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn links_both_commands_to_a_fireflies_bundle() {
        let home = std::env::temp_dir().join(format!("herdr-cli-link-both-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        let exe = home.join("Applications/Fireflies.app/Contents/MacOS/Fireflies");
        let fireflies = home.join(".local/bin/fireflies");
        let herdr_app = home.join(".local/bin/herdr-app");
        // herdr-app still points at the Herdr.app an earlier installer made: it moves over.
        symlink(home.join("Applications/Herdr.app/Contents/MacOS/Herdr"), &herdr_app).unwrap();
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_link(&fireflies).unwrap(), exe);
        assert_eq!(std::fs::read_link(&herdr_app).unwrap(), exe);

        // Someone else's `fireflies` (a file, or a link elsewhere) stays; herdr-app is still linked.
        std::fs::remove_file(&fireflies).unwrap();
        std::fs::remove_file(&herdr_app).unwrap();
        std::fs::write(&fireflies, "another fireflies").unwrap();
        ensure(&home, &exe).unwrap();
        assert_eq!(std::fs::read_to_string(&fireflies).unwrap(), "another fireflies");
        assert_eq!(std::fs::read_link(&herdr_app).unwrap(), exe);

        for skipped in [
            "/Volumes/Fireflies/Fireflies.app/Contents/MacOS/Fireflies",
            "/work/target/release/Fireflies.app/Contents/MacOS/Fireflies",
            "/Applications/Other.app/Contents/MacOS/Fireflies",
        ] {
            std::fs::remove_file(&herdr_app).unwrap();
            ensure(&home, Path::new(skipped)).unwrap();
            assert!(herdr_app.symlink_metadata().is_err(), "{skipped}");
            symlink(&exe, &herdr_app).unwrap();
        }
        // Both name pairs count as this app's bundle.
        for name in ["Fireflies.app/Contents/MacOS/Herdr", "Herdr.app/Contents/MacOS/Fireflies"] {
            assert!(app_bundle(&Path::new("/Applications").join(name)), "{name}");
        }
        std::fs::remove_dir_all(home).unwrap();
    }
}
