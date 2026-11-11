//! Language servers for mods: a server process per argv and workspace root,
//! spoken to in LSP's JSON-RPC over its stdin and stdout, and shared by every
//! mod copy that asks for the same one. Herdr only carries messages: it starts
//! the server, initializes it once, answers the requests a server makes of its
//! client generically, and stops it a while after the last copy lets go. What
//! to send (documents, hovers, diagnostics) is the mod's.
//!
//! `herdr.lspStart`, `lspRequest`, `lspNotify`, `lspNextMessage`, `lspRelease`,
//! `lspSessions` (see herdr.d.ts).

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde_json::{Value, json};

/// A server nobody uses is shut down after this long.
const IDLE: Duration = Duration::from_secs(90);
/// A request the server hasn't answered by then fails.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Initialization can take a while (rust-analyzer loading a workspace).
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const STDERR_LINES: usize = 200;

type Reply = async_channel::Sender<Result<Value, String>>;

struct Session {
    id: u64,
    argv: Vec<String>,
    root: String,
    settings: Value,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    next_request: AtomicI64,
    pending: Mutex<HashMap<i64, (Reply, Instant)>>,
    /// Server notifications go to every copy that uses the session.
    subscribers: Mutex<HashMap<u64, async_channel::Sender<Value>>>,
    users: Mutex<HashSet<u64>>,
    idle_since: Mutex<Option<Instant>>,
    alive: AtomicBool,
    stderr: Mutex<VecDeque<String>>,
    /// The `initialize` result, once there is one; waiters until then.
    ready: Mutex<Readiness>,
    /// Open documents by URI and the copies that have them open: the server
    /// sees one didOpen and one didClose however many copies show a file.
    docs: Mutex<HashMap<String, HashSet<u64>>>,
    /// The last diagnostics published for each document, for a copy that
    /// opens one already open.
    diagnostics: Mutex<HashMap<String, Value>>,
}

#[derive(Default)]
struct Readiness {
    result: Option<Result<Value, String>>,
    waiters: Vec<Reply>,
}

static SESSIONS: LazyLock<Mutex<Vec<Arc<Session>>>> = LazyLock::new(Default::default);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

fn find(id: u64) -> Result<Arc<Session>, String> {
    SESSIONS.lock().unwrap().iter().find(|s| s.id == id).cloned().ok_or_else(|| format!("no language server session {id}"))
}

/// Writes one LSP frame.
fn frame(body: &Value) -> Vec<u8> {
    let body = body.to_string();
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

/// Reads one LSP frame's JSON, or None at the end of the stream.
fn read_frame(r: &mut impl BufRead) -> std::io::Result<Option<Value>> {
    let mut length = None;
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let header = line.trim_end();
        if header.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse::<usize>().ok();
        }
    }
    let mut body = vec![0; length.unwrap_or(0)];
    r.read_exact(&mut body)?;
    Ok(Some(serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

impl Session {
    fn send(&self, message: &Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().unwrap();
        let w = stdin.as_mut().ok_or("the language server has exited")?;
        w.write_all(&frame(message)).and_then(|_| w.flush()).map_err(|e| format!("writing to the language server: {e}"))
    }

    fn request(&self, method: &str, params: Value) -> async_channel::Receiver<Result<Value, String>> {
        let (tx, rx) = async_channel::bounded(1);
        let id = self.next_request.fetch_add(1, Ordering::Relaxed);
        self.pending.lock().unwrap().insert(id, (tx.clone(), Instant::now()));
        if let Err(e) = self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            self.pending.lock().unwrap().remove(&id);
            let _ = tx.try_send(Err(e));
        }
        rx
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn broadcast(&self, message: Value) {
        self.subscribers.lock().unwrap().retain(|_, tx| tx.try_send(message.clone()).is_ok() || !tx.is_closed());
    }

    /// What Herdr answers when the server asks its client something.
    fn answer(&self, method: &str, params: &Value) -> Result<Value, (i64, String)> {
        match method {
            // Each item's section of the person's server_settings, else null.
            "workspace/configuration" => Ok(Value::Array(
                params.get("items").and_then(Value::as_array).into_iter().flatten()
                    .map(|item| match item.get("section").and_then(Value::as_str) {
                        Some(section) => section.split('.').try_fold(&self.settings, |v, k| v.get(k)).cloned().unwrap_or(Value::Null),
                        None => self.settings.clone(),
                    })
                    .collect(),
            )),
            "workspace/workspaceFolders" => Ok(json!([{ "uri": file_uri(&self.root), "name": folder_name(&self.root) }])),
            "client/registerCapability" | "client/unregisterCapability" | "window/workDoneProgress/create" | "window/showMessageRequest" | "workspace/diagnostic/refresh" | "workspace/semanticTokens/refresh" | "workspace/inlayHint/refresh" | "workspace/codeLens/refresh" => Ok(Value::Null),
            "workspace/applyEdit" => Ok(json!({ "applied": false, "failureReason": "this editor applies edits itself" })),
            _ => Err((-32601, format!("{method} is not supported"))),
        }
    }

    /// Routes one message from the server.
    fn dispatch(&self, message: Value) {
        let method = message.get("method").and_then(Value::as_str).map(str::to_owned);
        match (message.get("id").cloned(), method) {
            (Some(id), Some(method)) => {
                let reply = match self.answer(&method, message.get("params").unwrap_or(&Value::Null)) {
                    Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                    Err((code, text)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } }),
                };
                let _ = self.send(&reply);
            }
            (Some(id), None) => {
                let Some(id) = id.as_i64() else { return };
                let Some((tx, _)) = self.pending.lock().unwrap().remove(&id) else { return };
                let result = match message.get("error") {
                    Some(e) if !e.is_null() => Err(e.get("message").and_then(Value::as_str).unwrap_or("the language server refused").to_owned()),
                    _ => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = tx.try_send(result);
            }
            (None, Some(method)) => {
                let note = json!({ "method": method, "params": message.get("params").cloned().unwrap_or(Value::Null) });
                if method == "textDocument/publishDiagnostics"
                    && let Some(uri) = note["params"]["uri"].as_str()
                {
                    self.diagnostics.lock().unwrap().insert(uri.to_owned(), note.clone());
                }
                self.broadcast(note);
            }
            (None, None) => {}
        }
    }

    fn exited(&self) {
        if !self.alive.swap(false, Ordering::SeqCst) {
            return;
        }
        self.stdin.lock().unwrap().take();
        for (_, (tx, _)) in self.pending.lock().unwrap().drain() {
            let _ = tx.try_send(Err("the language server has exited".into()));
        }
        let stderr: Vec<String> = self.stderr.lock().unwrap().iter().rev().take(20).rev().cloned().collect();
        self.set_ready(Err(format!("the language server exited: {}", stderr.last().cloned().unwrap_or_default())));
        self.broadcast(json!({ "method": "$/exit", "params": { "stderr": stderr } }));
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.wait();
        }
        SESSIONS.lock().unwrap().retain(|s| s.id != self.id);
    }

    fn set_ready(&self, result: Result<Value, String>) {
        let mut ready = self.ready.lock().unwrap();
        if ready.result.is_some() {
            return;
        }
        for w in ready.waiters.drain(..) {
            let _ = w.try_send(result.clone());
        }
        ready.result = Some(result);
    }

    fn info(&self) -> Value {
        json!({
            "id": self.id, "argv": self.argv, "root": self.root,
            "users": self.users.lock().unwrap().len(),
            "alive": self.alive.load(Ordering::SeqCst),
            "ready": self.ready.lock().unwrap().result.as_ref().map(|r| r.is_ok()),
            "stderr": self.stderr.lock().unwrap().iter().rev().take(20).rev().cloned().collect::<Vec<_>>(),
        })
    }

    /// Asks the server to stop, then makes sure it does.
    fn shut_down(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || {
            let rx = me.request("shutdown", Value::Null);
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline && rx.is_empty() && me.alive.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = me.notify("exit", Value::Null);
            std::thread::sleep(Duration::from_millis(500));
            if let Some(child) = me.child.lock().unwrap().as_mut() {
                let _ = child.kill();
            }
            me.exited();
        });
    }
}

pub fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    #[cfg(windows)]
    out.push('/');
    for b in path.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.~:".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn folder_name(root: &str) -> String {
    root.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(root).to_owned()
}

fn initialize_params(root: &str, settings: &Value) -> Value {
    json!({
        "processId": std::process::id(),
        "clientInfo": { "name": "herdr-app", "version": env!("CARGO_PKG_VERSION") },
        "rootUri": file_uri(root),
        "rootPath": root,
        "workspaceFolders": [{ "uri": file_uri(root), "name": folder_name(root) }],
        "initializationOptions": if settings.is_object() { settings.clone() } else { Value::Null },
        "capabilities": {
            "general": { "positionEncodings": ["utf-16"] },
            "window": { "workDoneProgress": true, "showMessage": {} },
            "workspace": { "configuration": true, "workspaceFolders": true, "didChangeConfiguration": { "dynamicRegistration": false } },
            "textDocument": {
                "synchronization": { "didSave": true, "willSave": false, "dynamicRegistration": false },
                "hover": { "contentFormat": ["markdown", "plaintext"] },
                "definition": { "linkSupport": true },
                "typeDefinition": { "linkSupport": true },
                "references": {},
                "formatting": {},
                "publishDiagnostics": { "relatedInformation": true, "versionSupport": true, "codeDescriptionSupport": true, "dataSupport": true, "tagSupport": { "valueSet": [1, 2] } },
                "diagnostic": { "dynamicRegistration": false, "relatedDocumentSupport": false },
            },
        },
    })
}

/// Starts the reaper once: it fails requests past their time and stops
/// servers nobody has used for a while.
fn reaper() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(1));
            let sessions: Vec<Arc<Session>> = SESSIONS.lock().unwrap().clone();
            for s in sessions {
                let now = Instant::now();
                s.pending.lock().unwrap().retain(|_, (tx, at)| {
                    let late = now.duration_since(*at) > REQUEST_TIMEOUT;
                    if late {
                        let _ = tx.try_send(Err("the language server didn't answer in time".into()));
                    }
                    !late
                });
                let idle = *s.idle_since.lock().unwrap();
                if idle.is_some_and(|t| now.duration_since(t) > IDLE) && s.users.lock().unwrap().is_empty() {
                    *s.idle_since.lock().unwrap() = None;
                    SESSIONS.lock().unwrap().retain(|x| x.id != s.id);
                    s.shut_down();
                }
            }
        });
    });
}

fn spawn(argv: Vec<String>, root: String, settings: Value) -> Result<Arc<Session>, String> {
    let (program, args) = argv.split_first().ok_or("a language server needs a command")?;
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't start {program}: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let session = Arc::new(Session {
        id: NEXT_SESSION.fetch_add(1, Ordering::Relaxed),
        argv,
        root,
        settings,
        stdin: Mutex::new(child.stdin.take()),
        child: Mutex::new(Some(child)),
        next_request: AtomicI64::new(1),
        pending: Default::default(),
        subscribers: Default::default(),
        users: Default::default(),
        idle_since: Default::default(),
        alive: AtomicBool::new(true),
        stderr: Default::default(),
        ready: Default::default(),
        docs: Default::default(),
        diagnostics: Default::default(),
    });
    let s = session.clone();
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        while let Ok(Some(message)) = read_frame(&mut r) {
            s.dispatch(message);
        }
        s.exited();
    });
    let s = session.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut lines = s.stderr.lock().unwrap();
            if lines.len() == STDERR_LINES {
                lines.pop_front();
            }
            lines.push_back(line);
        }
    });
    // Initialize in the background; starters wait on `ready`.
    let s = session.clone();
    std::thread::spawn(move || {
        let rx = s.request("initialize", initialize_params(&s.root, &s.settings));
        let started = Instant::now();
        let result = loop {
            if let Ok(r) = rx.try_recv() {
                break r;
            }
            if !s.alive.load(Ordering::SeqCst) {
                break Err("the language server exited while starting".into());
            }
            if started.elapsed() > INIT_TIMEOUT {
                break Err("the language server didn't start in time".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        if result.is_ok() {
            let _ = s.notify("initialized", json!({}));
            if s.settings.is_object() {
                let _ = s.notify("workspace/didChangeConfiguration", json!({ "settings": s.settings }));
            }
        }
        s.set_ready(result.map(|r| r.get("capabilities").cloned().unwrap_or(Value::Null)));
    });
    Ok(session)
}

/// `lspStart`: the session for this argv and root (started if needed), once
/// initialized: `{ id, capabilities }`. The copy uses it until it releases it
/// or goes away.
pub fn start(copy: u64, argv: Vec<String>, root: String, settings: Value) -> async_channel::Receiver<Result<Value, String>> {
    reaper();
    let (tx, rx) = async_channel::bounded(1);
    let session = {
        let mut sessions = SESSIONS.lock().unwrap();
        match sessions.iter().find(|s| s.argv == argv && s.root == root && s.alive.load(Ordering::SeqCst)) {
            Some(s) => Ok(s.clone()),
            None => spawn(argv, root, settings).inspect(|s| sessions.push(s.clone())),
        }
    };
    let session = match session {
        Ok(s) => s,
        Err(e) => {
            let _ = tx.try_send(Err(e));
            return rx;
        }
    };
    session.users.lock().unwrap().insert(copy);
    *session.idle_since.lock().unwrap() = None;
    subscribe(&session, copy);
    let id = session.id;
    let (ready_tx, ready_rx) = async_channel::bounded(1);
    {
        let mut ready = session.ready.lock().unwrap();
        match &ready.result {
            Some(r) => {
                let _ = ready_tx.try_send(r.clone());
            }
            None => ready.waiters.push(ready_tx),
        }
    }
    std::thread::spawn(move || {
        let result = ready_rx.recv_blocking().unwrap_or_else(|_| Err("lost".into()));
        let _ = tx.send_blocking(result.map(|capabilities| json!({ "id": id, "capabilities": capabilities })));
    });
    rx
}

/// Each copy's queue of a session's notifications.
static RECEIVERS: LazyLock<Mutex<HashMap<(u64, u64), async_channel::Receiver<Value>>>> = LazyLock::new(Default::default);

fn subscribe(session: &Session, copy: u64) -> async_channel::Receiver<Value> {
    let mut receivers = RECEIVERS.lock().unwrap();
    if let Some(rx) = receivers.get(&(copy, session.id)) {
        return rx.clone();
    }
    let (tx, rx) = async_channel::bounded(4096);
    session.subscribers.lock().unwrap().insert(copy, tx);
    receivers.insert((copy, session.id), rx.clone());
    rx
}

/// `lspNextMessage`: the next notification the server sent (`{ method, params }`),
/// for this copy. `$/exit` when the server is gone.
pub fn next_message(copy: u64, id: u64) -> Result<async_channel::Receiver<Value>, String> {
    let key = (copy, id);
    if let Some(rx) = RECEIVERS.lock().unwrap().get(&key) {
        return Ok(rx.clone());
    }
    Ok(subscribe(&*find(id)?, copy))
}

pub fn request(id: u64, method: &str, params: Value) -> Result<async_channel::Receiver<Result<Value, String>>, String> {
    let session = find(id)?;
    if !session.alive.load(Ordering::SeqCst) {
        return Err("the language server has exited".into());
    }
    Ok(session.request(method, params))
}

/// Sends a notification for `copy`. Documents are counted per copy: the
/// server hears didOpen when the first copy opens a file (a later copy's
/// didOpen becomes a didChange with its text, and gets the file's last
/// diagnostics) and didClose when the last copy closes it.
pub fn notify(copy: u64, id: u64, method: &str, params: Value) -> Result<(), String> {
    let s = find(id)?;
    let uri = params["textDocument"]["uri"].as_str().map(str::to_owned);
    match (method, uri) {
        ("textDocument/didOpen", Some(uri)) => {
            let first = {
                let mut docs = s.docs.lock().unwrap();
                let copies = docs.entry(uri.clone()).or_default();
                let first = copies.is_empty();
                copies.insert(copy);
                first
            };
            if first {
                return s.notify(method, params);
            }
            let doc = &params["textDocument"];
            s.notify("textDocument/didChange", json!({
                "textDocument": { "uri": uri, "version": doc["version"] },
                "contentChanges": [{ "text": doc["text"] }],
            }))?;
            if let Some(last) = s.diagnostics.lock().unwrap().get(&uri).cloned()
                && let Some(tx) = s.subscribers.lock().unwrap().get(&copy)
            {
                let _ = tx.try_send(last);
            }
            Ok(())
        }
        ("textDocument/didClose", Some(uri)) => {
            if close_doc(&s, copy, &uri) {
                s.notify(method, params)?;
            }
            Ok(())
        }
        _ => s.notify(method, params),
    }
}

/// Forgets that `copy` has `uri` open; true when no copy has it open now.
fn close_doc(s: &Session, copy: u64, uri: &str) -> bool {
    let mut docs = s.docs.lock().unwrap();
    let Some(copies) = docs.get_mut(uri) else { return false };
    if !copies.remove(&copy) {
        return false;
    }
    if copies.is_empty() {
        docs.remove(uri);
        s.diagnostics.lock().unwrap().remove(uri);
        return true;
    }
    false
}

/// The copy no longer uses session `id`; with no users left it stops after a while.
pub fn release(copy: u64, id: u64) {
    if let Ok(s) = find(id) {
        // Documents only this copy had open are closed.
        let uris: Vec<String> = s.docs.lock().unwrap().iter().filter(|(_, c)| c.contains(&copy)).map(|(u, _)| u.clone()).collect();
        for uri in uris {
            if close_doc(&s, copy, &uri) {
                let _ = s.notify("textDocument/didClose", json!({ "textDocument": { "uri": uri } }));
            }
        }
        let mut users = s.users.lock().unwrap();
        users.remove(&copy);
        s.subscribers.lock().unwrap().remove(&copy);
        RECEIVERS.lock().unwrap().remove(&(copy, id));
        if users.is_empty() {
            *s.idle_since.lock().unwrap() = Some(Instant::now());
        }
    }
}

/// The copy went away: it lets go of every session.
pub fn release_copy(copy: u64) {
    let ids: Vec<u64> = SESSIONS.lock().unwrap().iter().map(|s| s.id).collect();
    for id in ids {
        release(copy, id);
    }
}

/// `lspSessions`: every running server, for a status line or a look.
pub fn sessions() -> Value {
    Value::Array(SESSIONS.lock().unwrap().iter().map(|s| s.info()).collect())
}

/// Drops a copy's sessions when its module goes.
pub struct CopyGuard(pub u64);

impl Drop for CopyGuard {
    fn drop(&mut self) {
        release_copy(self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_tolerate_extra_headers() {
        let message = json!({ "jsonrpc": "2.0", "id": 1, "result": { "ok": "é" } });
        let mut bytes = b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n".to_vec();
        bytes.extend(frame(&message));
        bytes.extend(frame(&json!({ "method": "x" })));
        let mut r = std::io::Cursor::new(bytes);
        assert_eq!(read_frame(&mut r).unwrap(), Some(message));
        assert_eq!(read_frame(&mut r).unwrap(), Some(json!({ "method": "x" })));
        assert_eq!(read_frame(&mut r).unwrap(), None);
    }

    #[test]
    fn uris_encode_spaces_and_unicode() {
        assert_eq!(file_uri("/a b/ü.rs"), if cfg!(windows) { "file:///" } else { "file://" }.to_owned() + "/a%20b/%C3%BC.rs");
    }

    /// A tiny language server in Python: answers initialize and hover,
    /// publishes diagnostics on didOpen, asks for its configuration.
    const FAKE: &str = r#"
import sys, json
def read():
    n = None
    while True:
        line = sys.stdin.buffer.readline()
        if not line: sys.exit(0)
        line = line.strip()
        if not line: break
        k, v = line.split(b':', 1)
        if k.lower() == b'content-length': n = int(v)
    return json.loads(sys.stdin.buffer.read(n))
def send(m):
    b = json.dumps(m).encode()
    sys.stdout.buffer.write(b'Content-Length: %d\r\n\r\n' % len(b) + b); sys.stdout.buffer.flush()
while True:
    m = read()
    meth = m.get('method')
    if meth == 'initialize':
        send({'jsonrpc': '2.0', 'id': m['id'], 'result': {'capabilities': {'hoverProvider': True}}})
        send({'jsonrpc': '2.0', 'id': 900, 'method': 'workspace/configuration', 'params': {'items': [{'section': 'fake.level'}]}})
    elif meth == 'textDocument/didOpen':
        send({'jsonrpc': '2.0', 'method': 'textDocument/publishDiagnostics', 'params': {'uri': m['params']['textDocument']['uri'], 'diagnostics': [{'message': 'bad'}]}})
    elif meth == 'textDocument/hover':
        send({'jsonrpc': '2.0', 'id': m['id'], 'result': {'contents': 'a hover'}})
    elif m.get('id') == 900:
        send({'jsonrpc': '2.0', 'method': 'echo/config', 'params': m.get('result')})
    elif meth == 'shutdown':
        send({'jsonrpc': '2.0', 'id': m['id'], 'result': None})
    elif meth == 'exit':
        sys.exit(0)
"#;

    #[test]
    fn a_session_initializes_routes_replies_and_broadcasts_notifications() {
        if Command::new("python3").arg("--version").output().is_err() {
            eprintln!("no python3: skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("herdr-lsp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake.py");
        std::fs::write(&script, FAKE).unwrap();
        let argv = vec!["python3".to_owned(), script.to_string_lossy().into_owned()];
        let root = dir.to_string_lossy().into_owned();
        let settings = json!({ "fake": { "level": 3 } });

        let started = start(1, argv.clone(), root.clone(), settings.clone()).recv_blocking().unwrap().unwrap();
        let id = started["id"].as_u64().unwrap();
        assert_eq!(started["capabilities"]["hoverProvider"], json!(true));
        // A second copy shares it.
        let again = start(2, argv.clone(), root.clone(), settings).recv_blocking().unwrap().unwrap();
        assert_eq!(again["id"].as_u64(), Some(id));

        let one = next_message(1, id).unwrap();
        let two = next_message(2, id).unwrap();
        // The configuration answer came back from Herdr's reply to the server.
        // (Copy 2 joined after this was sent: only copy 1 sees it.)
        assert_eq!(one.recv_blocking().unwrap(), json!({ "method": "echo/config", "params": [3] }));

        let open = json!({ "textDocument": { "uri": "file:///x.rs", "text": "", "version": 1, "languageId": "rust" } });
        notify(1, id, "textDocument/didOpen", open.clone()).unwrap();
        assert_eq!(one.recv_blocking().unwrap()["method"], "textDocument/publishDiagnostics");
        assert_eq!(two.recv_blocking().unwrap()["params"]["diagnostics"][0]["message"], "bad");
        // Copy 2 opening the same file: the server isn't told twice, and copy 2
        // gets the file's last diagnostics at once.
        notify(2, id, "textDocument/didOpen", open).unwrap();
        assert_eq!(two.recv_blocking().unwrap()["params"]["diagnostics"][0]["message"], "bad");
        assert_eq!(find(id).unwrap().docs.lock().unwrap()["file:///x.rs"].len(), 2);
        notify(1, id, "textDocument/didClose", json!({ "textDocument": { "uri": "file:///x.rs" } })).unwrap();
        assert!(find(id).unwrap().docs.lock().unwrap().contains_key("file:///x.rs"), "still open in copy 2");

        let hover = request(id, "textDocument/hover", json!({})).unwrap().recv_blocking().unwrap().unwrap();
        assert_eq!(hover["contents"], "a hover");

        release(1, id);
        release_copy(2);
        assert!(find(id).unwrap().docs.lock().unwrap().is_empty(), "the last copy's release closed it");
        assert!(sessions().as_array().unwrap().iter().any(|s| s["id"] == json!(id) && s["users"] == json!(0)));
        find(id).unwrap().shut_down();
        let deadline = Instant::now() + Duration::from_secs(5);
        while find(id).is_ok() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(find(id).is_err(), "the server stopped");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
