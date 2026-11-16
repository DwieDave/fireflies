//! Chromium is not in the app: the person enables it in Settings, and this
//! downloads the pinned CEF build into the app's data folder (`set_home`,
//! `<app home>/chromium`), checks it against the hash fixed here, and unpacks
//! the framework only. `remove` deletes it again.
//!
//! Layout under the home:
//!
//! ```text
//! <home>/download/<archive>.part      while downloading (kept on cancel: resumes)
//! <home>/<CEF_VERSION>/Fireflies Chromium.app/Contents/
//!     Info.plist                      (crate::chromium: the processes' outer bundle)
//!     Frameworks/Chromium Embedded Framework.framework
//!     Frameworks/Fireflies Helper*.app (built from the app's helper on first start)
//! <home>/profile                      logins and cache (kept by `remove`)
//! ```
//!
//! The download and the unpacking run the system's own `curl` and `tar` as
//! child processes on a thread: curl resumes a cut download (`-C -`) and is
//! killed to cancel. Files made by this process carry no quarantine flag, so
//! Gatekeeper never assesses the framework; the app is signed ad hoc without
//! library validation, so it loads the framework's own ad-hoc signature.

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

/// CEF's version, as its archives and folders name it.
pub const CEF_VERSION: &str = "156.0.30+g6028375+chromium-156.0.8078.96";

/// Where the archives come from (CEF's official builds). `FIREFLIES_CEF_URL`
/// replaces it (tests: a local server).
pub const BASE_URL: &str = "https://cef-builds.spotifycdn.com";

/// One pinned archive: its file name, size and hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Archive {
    pub name: &'static str,
    pub size: u64,
    pub hash: Hash,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hash {
    /// Computed from the archive when it was pinned.
    Sha256(&'static str),
    /// From CEF's own index (cef-builds.spotifycdn.com/index.json), for the
    /// archive not downloaded when pinning.
    Sha1(&'static str),
}

pub const ARM64: Archive = Archive {
    name: "cef_binary_156.0.30+g6028375+chromium-156.0.8078.96_macosarm64_minimal.tar.bz2",
    size: 134_874_408,
    hash: Hash::Sha256("731b599e78c71bf33530d65bfa18963f7d1d59902c1f381f5452188e5116b855"),
};

pub const X64: Archive = Archive {
    name: "cef_binary_156.0.30+g6028375+chromium-156.0.8078.96_macosx64_minimal.tar.bz2",
    size: 141_703_045,
    hash: Hash::Sha1("d66ae063959536c86637c63560797713937f5116"),
};

/// The archive for this Mac, or None where Chromium isn't offered.
pub fn archive() -> Option<Archive> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    match std::env::consts::ARCH {
        "aarch64" => Some(ARM64),
        "x86_64" => Some(X64),
        _ => None,
    }
}

/// What the install is doing.
#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Idle,
    Downloading,
    Verifying,
    Unpacking,
    /// The last attempt failed: in words a person reads.
    Failed(String),
}

struct State {
    phase: Phase,
    /// The running curl or tar, to kill on cancel.
    child: Option<Child>,
    cancelled: bool,
}

fn state() -> &'static Arc<Mutex<State>> {
    static S: OnceLock<Arc<Mutex<State>>> = OnceLock::new();
    S.get_or_init(|| Arc::new(Mutex::new(State { phase: Phase::Idle, child: None, cancelled: false })))
}

static HOME: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

/// The folder Chromium lives in (`<app home>/chromium`). Set by the host once.
pub fn set_home(dir: PathBuf) {
    *HOME.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(dir);
}

pub fn home() -> Option<PathBuf> {
    HOME.get().and_then(|h| h.lock().unwrap().clone())
}

pub fn build_dir(home: &Path) -> PathBuf {
    home.join(CEF_VERSION)
}

pub fn frameworks_dir(home: &Path) -> PathBuf {
    build_dir(home).join("Fireflies Chromium.app/Contents/Frameworks")
}

pub const FRAMEWORK: &str = "Chromium Embedded Framework.framework";

/// Whether the pinned framework is unpacked in place.
pub fn installed(home: &Path) -> bool {
    frameworks_dir(home).join(FRAMEWORK).join("Chromium Embedded Framework").exists()
}

fn part_path(home: &Path, a: &Archive) -> PathBuf {
    home.join("download").join(format!("{}.part", a.name))
}

/// Bytes in a folder, recursively (symlinks not followed).
pub fn disk_size(dir: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => disk_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// The engine's and the profile's bytes on disk, counted at most every 5 s
/// (Settings asks several times a second; the framework is thousands of files).
fn sizes(home: &Path, installed: bool) -> (u64, u64) {
    static CACHE: OnceLock<Mutex<Option<(std::time::Instant, bool, u64, u64)>>> = OnceLock::new();
    let mut c = CACHE.get_or_init(|| Mutex::new(None)).lock().unwrap();
    if let Some((at, was, e, d)) = *c
        && was == installed
        && at.elapsed() < std::time::Duration::from_secs(5)
    {
        return (e, d);
    }
    let e = if installed { disk_size(&build_dir(home)) } else { 0 };
    let d = disk_size(&home.join("profile"));
    *c = Some((std::time::Instant::now(), installed, e, d));
    (e, d)
}

/// For `nativeViewCapabilities().chromium` (Settings reads it):
/// `{ available, installed, version, phase, done, total, error, engineBytes, dataBytes }`.
pub fn status() -> Value {
    let Some(a) = archive() else {
        return json!({ "available": false });
    };
    let Some(home) = home() else {
        return json!({ "available": false });
    };
    let phase = state().lock().unwrap().phase.clone();
    let (name, error) = match &phase {
        Phase::Idle => ("idle", None),
        Phase::Downloading => ("downloading", None),
        Phase::Verifying => ("verifying", None),
        Phase::Unpacking => ("unpacking", None),
        Phase::Failed(m) => ("failed", Some(m.clone())),
    };
    let done = std::fs::metadata(part_path(&home, &a)).map(|m| m.len()).unwrap_or(0);
    let installed = installed(&home);
    json!({
        "available": true,
        "installed": installed,
        "version": CEF_VERSION.split('+').next_back().unwrap_or(CEF_VERSION).trim_start_matches("chromium-"),
        "phase": name,
        "done": done,
        "total": a.size,
        "error": error,
        "engineBytes": sizes(&home, installed).0,
        "dataBytes": sizes(&home, installed).1,
    })
}

/// Starts the download (or resumes it) on a thread; `status` follows it.
pub fn install() -> Result<(), String> {
    let a = archive().ok_or("Chromium isn't offered on this computer")?;
    let home = home().ok_or("Chromium has no folder")?;
    if installed(&home) {
        return Ok(());
    }
    {
        let mut s = state().lock().unwrap();
        if matches!(s.phase, Phase::Downloading | Phase::Verifying | Phase::Unpacking) {
            return Ok(());
        }
        s.phase = Phase::Downloading;
        s.cancelled = false;
    }
    let base = std::env::var("FIREFLIES_CEF_URL").unwrap_or_else(|_| BASE_URL.to_owned());
    std::thread::spawn(move || {
        let r = run_install(&home, &a, &base);
        let mut s = state().lock().unwrap();
        s.child = None;
        s.phase = match r {
            Ok(()) => Phase::Idle,
            Err(_) if s.cancelled => Phase::Idle,
            Err(e) => Phase::Failed(e),
        };
    });
    Ok(())
}

/// Stops a running download (what came so far is kept: the next install
/// resumes it).
pub fn cancel() {
    let mut s = state().lock().unwrap();
    s.cancelled = true;
    if let Some(c) = s.child.as_mut() {
        let _ = c.kill();
    }
}

/// Deletes the engine: every downloaded build and a cut download. Keeps the
/// profile unless `data`. A running Chromium keeps its files open until the
/// app quits; nothing new starts from them.
pub fn remove(data: bool) -> Result<(), String> {
    cancel();
    let home = home().ok_or("Chromium has no folder")?;
    let Ok(rd) = std::fs::read_dir(&home) else { return Ok(()) };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == "profile" && !data {
            continue;
        }
        let p = e.path();
        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        r.map_err(|err| format!("couldn't remove {}: {err}", p.display()))?;
    }
    state().lock().unwrap().phase = Phase::Idle;
    Ok(())
}

fn set_phase(p: Phase) {
    state().lock().unwrap().phase = p;
}

/// Runs a child to its end, cancellable; returns its exit code and stderr.
fn run_child(mut cmd: Command) -> Result<(i32, String), String> {
    let child = cmd.stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let stderr = {
        let mut s = state().lock().unwrap();
        s.child = Some(child);
        s.child.as_mut().and_then(|c| c.stderr.take())
    };
    let mut err = String::new();
    if let Some(mut e) = stderr {
        use std::io::Read;
        let _ = e.read_to_string(&mut err);
    }
    let status = {
        let mut s = state().lock().unwrap();
        let c = s.child.as_mut().ok_or("cancelled")?;
        c.wait().map_err(|e| e.to_string())?
    };
    state().lock().unwrap().child = None;
    if state().lock().unwrap().cancelled {
        return Err("cancelled".into());
    }
    Ok((status.code().unwrap_or(-1), err))
}

/// curl's exit codes in words (`man curl`, EXIT CODES).
pub fn curl_words(code: i32) -> String {
    match code {
        6 => "Can't reach the download server: no network, or its name doesn't resolve.".into(),
        7 => "The download server doesn't answer.".into(),
        22 => "The download server refused the file.".into(),
        23 => "The file couldn't be written: is the disk full?".into(),
        28 => "The download stalled.".into(),
        35 | 60 => "A secure connection to the download server failed.".into(),
        52 | 56 | 18 => "The connection dropped during the download: Enable again to resume.".into(),
        c => format!("The download failed (curl error {c})."),
    }
}

fn run_install(home: &Path, a: &Archive, base: &str) -> Result<(), String> {
    let dl = home.join("download");
    std::fs::create_dir_all(&dl).map_err(|e| format!("couldn't make {}: {e}", dl.display()))?;
    let part = part_path(home, a);
    // An archive that's already whole (or longer, from a server that ignored
    // the range) isn't downloaded again; a longer one fails the hash and goes.
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have < a.size {
        let url = format!("{}/{}", base.trim_end_matches('/'), a.name.replace('+', "%2B"));
        let mut cmd = Command::new("/usr/bin/curl");
        cmd.args(["--fail", "--location", "--silent", "--show-error", "--retry", "3", "--connect-timeout", "20"])
            .args(["--speed-limit", "1024", "--speed-time", "60"])
            .arg("--continue-at")
            .arg("-")
            .arg("--output")
            .arg(&part)
            .arg(&url);
        let (code, err) = run_child(cmd)?;
        if code == 33 {
            // The server can't resume: start over.
            let _ = std::fs::remove_file(&part);
            return run_install(home, a, base);
        }
        if code != 0 {
            let _ = err;
            return Err(curl_words(code));
        }
    }
    set_phase(Phase::Verifying);
    if !matches_hash(&part, &a.hash)? {
        let _ = std::fs::remove_file(&part);
        return Err("The download didn't match Chromium's pinned build, so it was thrown away. Enable again to retry.".into());
    }
    set_phase(Phase::Unpacking);
    let top = a.name.trim_end_matches(".tar.bz2");
    let staging = home.join("download").join("unpack");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("/usr/bin/tar");
    cmd.arg("-xjf").arg(&part).arg("-C").arg(&staging).args(["--strip-components", "2"]).arg(format!("{top}/Release/{FRAMEWORK}"));
    let (code, err) = run_child(cmd)?;
    if code != 0 || !staging.join(FRAMEWORK).join("Chromium Embedded Framework").exists() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("The download couldn't be unpacked{}.", if err.trim().is_empty() { String::new() } else { format!(": {}", err.trim()) }));
    }
    let frameworks = frameworks_dir(home);
    std::fs::create_dir_all(&frameworks).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(frameworks.join(FRAMEWORK));
    std::fs::rename(staging.join(FRAMEWORK), frameworks.join(FRAMEWORK)).map_err(|e| format!("couldn't move the framework in place: {e}"))?;
    let _ = std::fs::remove_dir_all(&dl);
    Ok(())
}

/// Whether the file's hash is the pinned one.
pub fn matches_hash(path: &Path, hash: &Hash) -> Result<bool, String> {
    use std::io::Read;
    let (alg, want) = match hash {
        Hash::Sha256(h) => (&ring::digest::SHA256, *h),
        Hash::Sha1(h) => (&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, *h),
    };
    let mut ctx = ring::digest::Context::new(alg);
    let mut f = std::fs::File::open(path).map_err(|e| format!("the download is gone: {e}"))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        ctx.update(&buf[..n]);
    }
    let got: String = ctx.finish().as_ref().iter().map(|b| format!("{b:02x}")).collect();
    Ok(got == want)
}

/// For tests: run an install of `a` from `base` into `home` synchronously.
#[doc(hidden)]
pub fn install_now(home: &Path, a: &Archive, base: &str) -> Result<(), String> {
    state().lock().unwrap().cancelled = false;
    run_install(home, a, base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A stand-in CEF archive: `<top>/Release/<framework>/Chromium Embedded Framework`.
    fn fake_archive(dir: &Path, top: &str) -> (PathBuf, Vec<u8>) {
        let root = dir.join("src");
        let fw = root.join(top).join("Release").join(FRAMEWORK);
        std::fs::create_dir_all(&fw).unwrap();
        std::fs::write(fw.join("Chromium Embedded Framework"), b"not really a framework").unwrap();
        std::fs::write(root.join(top).join("README.txt"), b"readme").unwrap();
        let out = dir.join(format!("{top}.tar.bz2"));
        let ok = Command::new("/usr/bin/tar").arg("-cjf").arg(&out).arg("-C").arg(&root).arg(top).status().unwrap().success();
        assert!(ok);
        let bytes = std::fs::read(&out).unwrap();
        (out, bytes)
    }

    fn sha256_hex(b: &[u8]) -> String {
        ring::digest::digest(&ring::digest::SHA256, b).as_ref().iter().map(|x| format!("{x:02x}")).collect()
    }

    /// Serves `body` for any path, honouring `Range: bytes=N-`; answers `requests` requests.
    fn serve(body: Vec<u8>, requests: usize) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in l.incoming().take(requests) {
                let mut s = s.unwrap();
                let mut req = [0u8; 4096];
                let n = s.read(&mut req).unwrap_or(0);
                let text = String::from_utf8_lossy(&req[..n]).to_string();
                let from = text
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(|r| r.trim_end_matches('-').parse::<usize>().unwrap_or(0)))
                    .unwrap_or(0);
                let part = &body[from.min(body.len())..];
                let head = if from > 0 {
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n", part.len(), from, body.len() - 1, body.len())
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len())
                };
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(part);
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    /// The install state is one per process: these tests take turns.
    fn turn() -> std::sync::MutexGuard<'static, ()> {
        static T: Mutex<()> = Mutex::new(());
        T.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ff-cef-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn installs_the_framework_from_a_verified_archive() {
        let _turn = turn();
        let d = temp("ok");
        let top = "cef_binary_test_macosarm64_minimal";
        let (_, bytes) = fake_archive(&d, top);
        let hash: &'static str = Box::leak(sha256_hex(&bytes).into_boxed_str());
        let name: &'static str = Box::leak(format!("{top}.tar.bz2").into_boxed_str());
        let a = Archive { name, size: bytes.len() as u64, hash: Hash::Sha256(hash) };
        let home = d.join("home");
        let base = serve(bytes, 1);
        install_now(&home, &a, &base).unwrap();
        assert!(installed(&home), "framework in place");
        assert!(!home.join("download").exists(), "the archive is gone");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn resumes_a_cut_download() {
        let _turn = turn();
        let d = temp("resume");
        let top = "cef_binary_test_macosarm64_minimal";
        let (_, bytes) = fake_archive(&d, top);
        let hash: &'static str = Box::leak(sha256_hex(&bytes).into_boxed_str());
        let name: &'static str = Box::leak(format!("{top}.tar.bz2").into_boxed_str());
        let a = Archive { name, size: bytes.len() as u64, hash: Hash::Sha256(hash) };
        let home = d.join("home");
        // What a cancelled download left: the first half.
        std::fs::create_dir_all(home.join("download")).unwrap();
        std::fs::write(part_path(&home, &a), &bytes[..bytes.len() / 2]).unwrap();
        let base = serve(bytes, 1);
        install_now(&home, &a, &base).unwrap();
        assert!(installed(&home));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn throws_away_a_download_that_fails_the_hash() {
        let _turn = turn();
        let d = temp("bad");
        let top = "cef_binary_test_macosarm64_minimal";
        let (_, bytes) = fake_archive(&d, top);
        let name: &'static str = Box::leak(format!("{top}.tar.bz2").into_boxed_str());
        let a = Archive { name, size: bytes.len() as u64, hash: Hash::Sha256("00") };
        let home = d.join("home");
        let base = serve(bytes, 1);
        let err = install_now(&home, &a, &base).unwrap_err();
        assert!(err.contains("didn't match"), "{err}");
        assert!(!installed(&home));
        assert!(!part_path(&home, &a).exists(), "the bad download is deleted");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn a_server_that_refuses_says_so_in_words() {
        let _turn = turn();
        let d = temp("refused");
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Some(Ok(mut s)) = l.incoming().next() {
                let mut b = [0u8; 1024];
                let _ = s.read(&mut b);
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        let a = Archive { name: "x.tar.bz2", size: 10, hash: Hash::Sha256("00") };
        let err = install_now(&d.join("home"), &a, &format!("http://127.0.0.1:{port}")).unwrap_err();
        assert_eq!(err, "The download server refused the file.");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_pinned_archives_name_the_pinned_version() {
        for a in [ARM64, X64] {
            assert!(a.name.contains(CEF_VERSION), "{}", a.name);
            assert!(a.name.ends_with("_minimal.tar.bz2"));
        }
    }

    #[test]
    fn remove_keeps_the_profile_unless_asked() {
        let _turn = turn();
        let d = temp("remove");
        set_home(d.clone());
        std::fs::create_dir_all(frameworks_dir(&d).join(FRAMEWORK)).unwrap();
        std::fs::create_dir_all(d.join("profile")).unwrap();
        std::fs::write(d.join("profile/Cookies"), b"c").unwrap();
        remove(false).unwrap();
        assert!(!build_dir(&d).exists());
        assert!(d.join("profile/Cookies").exists());
        remove(true).unwrap();
        assert!(!d.join("profile").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
