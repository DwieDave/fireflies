//! Finding files and text in a folder for mods (the picker): fff's index of a
//! folder (git-ignored files left out, kept current by a watcher), its
//! typo-resistant fuzzy file matching and its live grep. An index is built on
//! the first search of a folder, kept while it's searched, and dropped after a
//! few idle minutes. `herdr.findFiles`, `herdr.grep`.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

use fff_search::{
    FFFMode, FilePickerOptions, FuzzySearchOptions, PaginationArgs, QueryParser, SharedFilePicker, SharedFrecency,
    file_picker::FilePicker,
    grep::{Casing, GrepMode, GrepSearchOptions, parse_grep_query},
};
use serde_json::{Value, json};

/// An index nobody searched for this long is dropped (its watcher stops).
const IDLE: Duration = Duration::from_secs(10 * 60);
/// At most this many folders are indexed at once; the least recently used goes.
const MAX_INDEXES: usize = 6;
/// A search waits this long for a folder's first scan, then answers with
/// what's indexed so far (`scanning: true`).
const FIRST_SCAN: Duration = Duration::from_millis(1500);
/// Live grep stops after this and answers with what it found.
const GREP_BUDGET_MS: u64 = 150;

struct Index {
    picker: SharedFilePicker,
    used: Mutex<Instant>,
}

static INDEXES: LazyLock<Mutex<HashMap<PathBuf, Arc<Index>>>> = LazyLock::new(Default::default);

fn index(root: &Path) -> Result<Arc<Index>, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    if std::env::home_dir().is_some_and(|h| h == root) || root.parent().is_none() {
        return Err("pick a project folder: searching all of home or / isn't offered".into());
    }
    let mut indexes = INDEXES.lock().unwrap();
    let now = Instant::now();
    indexes.retain(|_, i| now.duration_since(*i.used.lock().unwrap()) < IDLE);
    if let Some(i) = indexes.get(root) {
        *i.used.lock().unwrap() = now;
        return Ok(i.clone());
    }
    while indexes.len() >= MAX_INDEXES {
        let oldest = indexes.iter().min_by_key(|(_, i)| *i.used.lock().unwrap()).map(|(k, _)| k.clone());
        match oldest {
            Some(k) => indexes.remove(&k),
            None => break,
        };
    }
    let picker = SharedFilePicker::default();
    FilePicker::new_with_shared_state(
        picker.clone(),
        SharedFrecency::default(),
        FilePickerOptions { base_path: root.to_string_lossy().into_owned(), mode: FFFMode::Neovim, watch: true, ..Default::default() },
    )
    .map_err(|e| format!("couldn't index {}: {e}", root.display()))?;
    let i = Arc::new(Index { picker, used: Mutex::new(now) });
    indexes.insert(root.to_path_buf(), i.clone());
    Ok(i)
}

/// One letter for a file's git state, as the diff pane writes them.
fn git_letter(status: Option<git2::Status>) -> Value {
    let Some(s) = status else { return Value::Null };
    let letter = if s.is_conflicted() {
        "!"
    } else if s.is_wt_new() {
        "U"
    } else if s.is_index_new() {
        "A"
    } else if s.is_wt_deleted() || s.is_index_deleted() {
        "D"
    } else if s.is_wt_renamed() || s.is_index_renamed() {
        "R"
    } else if s.is_wt_modified() || s.is_index_modified() || s.is_wt_typechange() || s.is_index_typechange() {
        "M"
    } else {
        return Value::Null;
    };
    json!(letter)
}

/// Byte offsets in `s` to UTF-16 offsets (JavaScript string indices).
fn utf16_ranges(s: &str, ranges: impl IntoIterator<Item = (u32, u32)>) -> Vec<[usize; 2]> {
    let unit = |b: usize| s.get(..b.min(s.len())).map_or(0, |p| p.encode_utf16().count());
    ranges.into_iter().map(|(a, b)| [unit(a as usize), unit(b as usize)]).collect()
}

/// `findFiles(root, query, { limit })`: files under `root` matching `query`
/// fuzzily, best first: `{ files: [{ path, git, ranges }], total, indexed, scanning }`.
pub fn find_files(root: &Path, query: &str, limit: usize) -> Result<Value, String> {
    let index = index(root)?;
    let scanning = !index.picker.wait_for_scan(FIRST_SCAN);
    let guard = index.picker.read().map_err(|e| e.to_string())?;
    let picker = guard.as_ref().ok_or("the index isn't ready")?;
    let parsed = QueryParser::default().parse(query);
    let found = picker.fuzzy_search(
        &parsed,
        None,
        FuzzySearchOptions { max_threads: 0, pagination: PaginationArgs { offset: 0, limit: limit.clamp(1, 500) }, ..Default::default() },
    );
    let files: Vec<Value> = found
        .items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let path = item.relative_path(picker);
            let ranges = found.match_byte_offsets.get(i).map(|r| utf16_ranges(&path, r.iter().copied())).unwrap_or_default();
            json!({ "path": path, "git": git_letter(item.git_status), "ranges": ranges })
        })
        .collect();
    Ok(json!({ "files": files, "total": found.total_matched, "indexed": found.total_files, "scanning": scanning }))
}

/// `grep(root, query, { limit, regex, fuzzy, case })`: lines under `root`
/// matching `query`: `{ matches: [{ path, line, col, text, ranges }], files,
/// truncated, error }`. Lines are one-based, `col` and `ranges` in the
/// line's JavaScript string units.
pub fn grep(root: &Path, query: &str, limit: usize, mode: &str, case: &str) -> Result<Value, String> {
    let index = index(root)?;
    let scanning = !index.picker.wait_for_scan(FIRST_SCAN);
    let guard = index.picker.read().map_err(|e| e.to_string())?;
    let picker = guard.as_ref().ok_or("the index isn't ready")?;
    if query.trim().is_empty() {
        return Ok(json!({ "matches": [], "files": 0, "truncated": false, "scanning": scanning }));
    }
    let parsed = parse_grep_query(query);
    let options = GrepSearchOptions {
        max_file_size: 4 * 1024 * 1024,
        max_matches_per_file: 50,
        casing: Some(match case {
            "sensitive" => Casing::Sensitive,
            "insensitive" => Casing::Insensitive,
            _ => Casing::Smart,
        }),
        page_limit: limit.clamp(1, 2000),
        mode: match mode {
            "regex" => GrepMode::Regex,
            "fuzzy" => GrepMode::Fuzzy,
            _ => GrepMode::PlainText,
        },
        time_budget_ms: GREP_BUDGET_MS,
        enforce_time_budget: true,
        ..Default::default()
    };
    let result = picker.grep(&parsed, &options);
    let matches: Vec<Value> = result
        .matches
        .iter()
        .filter_map(|m| {
            let file = result.files.get(m.file_index)?;
            let text = &m.line_content;
            let col = utf16_ranges(text, [(m.col as u32, m.col as u32)])[0][0];
            Some(json!({
                "path": file.relative_path(picker),
                "line": m.line_number,
                "col": col,
                "text": text,
                "ranges": utf16_ranges(text, m.match_byte_offsets.iter().copied()),
            }))
        })
        .collect();
    Ok(json!({
        "matches": matches,
        "files": result.files_with_matches,
        "truncated": result.next_file_offset > 0 && result.next_file_offset < result.total_files,
        "error": result.regex_fallback_error,
        "scanning": scanning,
    }))
}

/// Runs a search off the window's thread.
pub fn background(work: impl FnOnce() -> Result<Value, String> + Send + 'static) -> async_channel::Receiver<Result<Value, String>> {
    let (tx, rx) = async_channel::bounded(1);
    std::thread::spawn(move || {
        let _ = tx.send_blocking(work());
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("herdr-search-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src/picker")).unwrap();
        std::fs::create_dir_all(dir.join("target")).unwrap();
        std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        std::fs::write(dir.join("src/picker/main.rs"), "fn main() {\n    let needle = 1;\n}\n").unwrap();
        std::fs::write(dir.join("src/lib.rs"), "pub fn haystack() {}\n// needle here, é\n").unwrap();
        std::fs::write(dir.join("target/needle.rs"), "needle\n").unwrap();
        // fff reads .gitignore inside a git repository.
        let _ = std::process::Command::new("git").arg("init").arg("-q").current_dir(&dir).status();
        dir
    }

    #[test]
    fn files_match_fuzzily_and_git_ignored_ones_stay_out() {
        let dir = folder("files");
        let found = find_files(&dir, "pkmain", 20).unwrap();
        let paths: Vec<&str> = found["files"].as_array().unwrap().iter().map(|f| f["path"].as_str().unwrap()).collect();
        assert_eq!(paths.first().copied(), Some("src/picker/main.rs"), "{found}");
        let all = find_files(&dir, "needle", 20).unwrap();
        assert!(!all["files"].as_array().unwrap().iter().any(|f| f["path"].as_str().unwrap().starts_with("target/")), "{all}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn grep_finds_lines_with_their_place() {
        let dir = folder("grep");
        let found = grep(&dir, "needle", 100, "plain", "smart").unwrap();
        let matches = found["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 2, "{found}");
        let main = matches.iter().find(|m| m["path"] == "src/picker/main.rs").unwrap();
        assert_eq!(main["line"], 2);
        assert_eq!(main["col"], 8);
        assert_eq!(main["ranges"], json!([[8, 14]]));
        assert!(grep(&dir, "  ", 10, "plain", "smart").unwrap()["matches"].as_array().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn utf16_offsets_count_javascript_units() {
        assert_eq!(utf16_ranges("é😀ab", [(6, 7)]), vec![[3, 4]]);
    }

    #[test]
    fn home_and_missing_folders_are_refused() {
        assert!(index(Path::new("/definitely/not/here")).is_err());
        if let Some(home) = std::env::home_dir() {
            assert!(index(&home).is_err());
        }
    }
}
