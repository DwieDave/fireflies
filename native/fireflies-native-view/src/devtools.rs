//! Chromium's DevTools in a pane. CEF can't put its own DevTools window into a
//! parent view on macOS (ShowDevTools allows a parent only in Chrome style,
//! which macOS refuses for one: a CHECK ends the app), so an inspector pane
//! is a plain Chromium view on the DevTools frontend CEF ships
//! (`devtools://devtools/bundled/inspector.html`), and the frontend talks to
//! the inspected page through this bridge: a WebSocket on 127.0.0.1 that only
//! answers a path with a token made for that one inspector (and only the
//! frontend's origin), whose messages go to the page with CEF's in-process
//! `SendDevToolsMessage` and come back through a DevTools message observer.
//! No remote-debugging port is opened.
//!
//! Threads: the listener and each connection's reader run on threads of
//! their own; what they read waits in INBOX until the main thread's pump
//! (crate::chromium) hands it to CEF. What CEF answers (main thread) goes to
//! the connection's writer thread.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, OnceLock};

/// What the frontend's WebSocket path looks like: `/devtools/<token>`.
const PATH: &str = "/devtools/";

struct Bridge {
    port: u16,
    /// token → the inspected view's key.
    targets: Mutex<HashMap<String, String>>,
    /// token → the open connection (its number) and its writer.
    writers: Mutex<HashMap<String, (u64, Sender<Vec<u8>>)>>,
    /// What the frontends sent, for the main thread: (token, message).
    inbox: Mutex<Vec<(String, Vec<u8>)>>,
}

fn bridge() -> Result<&'static Bridge, String> {
    static B: OnceLock<Result<Bridge, String>> = OnceLock::new();
    B.get_or_init(|| {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("DevTools bridge: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        std::thread::Builder::new()
            .name("devtools-bridge".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    std::thread::spawn(move || {
                        let _ = serve(stream);
                    });
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Bridge { port, targets: Mutex::new(HashMap::new()), writers: Mutex::new(HashMap::new()), inbox: Mutex::new(Vec::new()) })
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// A fresh token: 128 random bits, hex.
fn token() -> Result<String, String> {
    use ring::rand::SecureRandom;
    let mut b = [0u8; 16];
    ring::rand::SystemRandom::new().fill(&mut b).map_err(|_| "no randomness")?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// The frontend's address for an inspector of the view `target`, and its token
/// (forget it when the inspector goes).
pub fn frontend(target: &str) -> Result<(String, String), String> {
    let b = bridge()?;
    let t = token()?;
    b.targets.lock().unwrap().insert(t.clone(), target.to_owned());
    Ok((format!("devtools://devtools/bundled/inspector.html?ws=127.0.0.1:{}{PATH}{t}", b.port), t))
}

/// The inspector is gone: its token stops answering and its connection closes.
pub fn forget(token: &str) {
    if let Ok(b) = bridge() {
        b.targets.lock().unwrap().remove(token);
        b.writers.lock().unwrap().remove(token);
    }
}

/// The inspected view of a token.
pub fn target_of(token: &str) -> Option<String> {
    bridge().ok()?.targets.lock().unwrap().get(token).cloned()
}

/// What the frontends sent since the last call (main thread: the pump).
pub fn take_inbox() -> Vec<(String, Vec<u8>)> {
    bridge().map(|b| std::mem::take(&mut *b.inbox.lock().unwrap())).unwrap_or_default()
}

/// A message from the page for the frontend of `token`.
pub fn to_frontend(token: &str, message: &[u8]) {
    if let Ok(b) = bridge()
        && let Some((_, w)) = b.writers.lock().unwrap().get(token)
    {
        let _ = w.send(message.to_vec());
    }
}

/// The WebSocket handshake's answer key (RFC 6455 §4.2.2).
pub fn accept_key(key: &str) -> String {
    let d = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes());
    base64(d.as_ref())
}

pub fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The request's path and headers (lowercase names), from its head.
pub fn parse_request(head: &str) -> Option<(String, HashMap<String, String>)> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    if first.next()? != "GET" {
        return None;
    }
    let path = first.next()?.to_owned();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    Some((path, headers))
}

/// Whether a handshake may go on: a known token, the frontend's origin (or
/// none: not a web page), and a WebSocket upgrade.
pub fn admitted(path: &str, headers: &HashMap<String, String>, known: impl Fn(&str) -> bool) -> Option<String> {
    let token = path.strip_prefix(PATH)?;
    let origin_ok = headers.get("origin").is_none_or(|o| o == "devtools://devtools");
    let upgrade = headers.get("upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
    (known(token) && origin_ok && upgrade && headers.contains_key("sec-websocket-key")).then(|| token.to_owned())
}

fn serve(mut s: TcpStream) -> std::io::Result<()> {
    // The head, up to its blank line (bounded).
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 || s.read(&mut byte)? == 0 {
            return Ok(());
        }
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    let Some((path, headers)) = parse_request(&head) else { return Ok(()) };
    let Some(token) = admitted(&path, &headers, |t| target_of(t).is_some()) else {
        s.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    };
    let key = headers.get("sec-websocket-key").cloned().unwrap_or_default();
    s.write_all(format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n", accept_key(&key)).as_bytes())?;
    let (tx, rx) = channel::<Vec<u8>>();
    let Ok(b) = bridge() else { return Ok(()) };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    b.writers.lock().unwrap().insert(token.clone(), (id, tx));
    let mut w = s.try_clone()?;
    std::thread::spawn(move || {
        for m in rx {
            if w.write_all(&frame(1, &m)).is_err() {
                break;
            }
        }
    });
    let mut message = Vec::new();
    loop {
        let Some((fin, opcode, payload)) = read_frame(&mut s)? else { break };
        match opcode {
            0 | 1 | 2 => {
                message.extend_from_slice(&payload);
                if fin {
                    b.inbox.lock().unwrap().push((token.clone(), std::mem::take(&mut message)));
                }
            }
            8 => break,
            9 => {
                let _ = s.write_all(&frame(10, &payload));
            }
            _ => {}
        }
    }
    // Closed: this connection's writer goes (unless a newer one took its place).
    let mut ws = b.writers.lock().unwrap();
    if ws.get(&token).is_some_and(|(i, _)| *i == id) {
        ws.remove(&token);
    }
    Ok(())
}

/// One frame from the client (masked); None at the end of the stream.
pub fn read_frame(s: &mut impl Read) -> std::io::Result<Option<(bool, u8, Vec<u8>)>> {
    let mut h = [0u8; 2];
    if s.read_exact(&mut h).is_err() {
        return Ok(None);
    }
    let fin = h[0] & 0x80 != 0;
    let opcode = h[0] & 0x0f;
    let masked = h[1] & 0x80 != 0;
    let mut len = (h[1] & 0x7f) as u64;
    if len == 126 {
        let mut b = [0u8; 2];
        s.read_exact(&mut b)?;
        len = u16::from_be_bytes(b) as u64;
    } else if len == 127 {
        let mut b = [0u8; 8];
        s.read_exact(&mut b)?;
        len = u64::from_be_bytes(b);
    }
    if len > 256 * 1024 * 1024 {
        return Ok(None);
    }
    let mut mask = [0u8; 4];
    if masked {
        s.read_exact(&mut mask)?;
    }
    let mut payload = vec![0u8; len as usize];
    s.read_exact(&mut payload)?;
    if masked {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i % 4];
        }
    }
    Ok(Some((fin, opcode, payload)))
}

/// One frame to the client (a server's frames aren't masked).
pub fn frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0x80 | opcode];
    match payload.len() {
        n if n < 126 => out.push(n as u8),
        n if n <= u16::MAX as usize => {
            out.push(126);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            out.push(127);
            out.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    out.extend_from_slice(payload);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_handshake_key_is_rfc_6455s() {
        // The example from RFC 6455 §1.3.
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"a"), "YQ==");
    }

    #[test]
    fn only_a_known_token_from_the_frontend_is_admitted() {
        let head = "GET /devtools/abc HTTP/1.1\r\nHost: 127.0.0.1:1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nOrigin: devtools://devtools\r\n\r\n";
        let (path, h) = parse_request(head).unwrap();
        assert_eq!(admitted(&path, &h, |t| t == "abc").as_deref(), Some("abc"));
        assert_eq!(admitted(&path, &h, |t| t == "other"), None);
        let page = head.replace("devtools://devtools", "https://evil.example");
        let (path, h) = parse_request(&page).unwrap();
        assert_eq!(admitted(&path, &h, |t| t == "abc"), None, "a web page's origin");
        let (path, h) = parse_request("GET /json/list HTTP/1.1\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\n\r\n").unwrap();
        assert_eq!(admitted(&path, &h, |_| true), None, "not a bridge path");
    }

    #[test]
    fn frames_round_trip_masked_and_long() {
        for len in [5usize, 300, 70_000] {
            let payload: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            // A client's frame: masked.
            let mask = [1u8, 2, 3, 4];
            let mut f = frame(1, &payload);
            let at = f.len() - payload.len();
            f[1] |= 0x80;
            let masked: Vec<u8> = payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]).collect();
            f.truncate(at);
            f.extend_from_slice(&mask);
            f.extend_from_slice(&masked);
            let (fin, op, got) = read_frame(&mut f.as_slice()).unwrap().unwrap();
            assert!(fin);
            assert_eq!(op, 1);
            assert_eq!(got, payload);
        }
    }
}
