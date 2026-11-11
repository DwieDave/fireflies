//! Syntax colors from tree-sitter: the code editor's (an `InputHighlighter`
//! installed into gpui-shell's `EditorState`s) and `herdr.highlight(text,
//! language)` for code a mod draws itself (the diff view's lines).
//!
//! A curated set of grammars is built in; each grammar's own highlights query
//! names what it captures (`keyword`, `function.method`, `string.escape`, ...).
//! Mods color those names (a dotted name falls back to its root: `keyword.return`
//! is `keyword` unless named). Grammars and their queries compile on first use.

use std::{
    collections::HashMap,
    ops::Range,
    sync::{Arc, LazyLock, Mutex},
};

use gpui::{Context, HighlightStyle, SharedString, Window};
use gpui_base::input::{EditorState, FoldRange, HighlightStyleResolver, InputEdit, InputHighlighter, Rope};
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator, Tree};

/// A language people edit: its id, the names and file names that select it,
/// and whether a grammar colors it. Data files without a grammar (csv) are
/// still a language: editors and servers key on the id.
pub struct Lang {
    pub id: &'static str,
    pub aliases: &'static [&'static str],
    pub extensions: &'static [&'static str],
    pub files: &'static [&'static str],
    grammar: Option<fn() -> (Language, String)>,
}

fn js() -> String {
    tree_sitter_javascript::HIGHLIGHT_QUERY.to_owned()
}

/// Every language the editor knows, in the order a lookup tries them.
pub static LANGS: &[Lang] = &[
    Lang { id: "rust", aliases: &["rs"], extensions: &["rs"], files: &[], grammar: Some(|| (tree_sitter_rust::LANGUAGE.into(), tree_sitter_rust::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "typescript", aliases: &["ts"], extensions: &["ts", "mts", "cts"], files: &[], grammar: Some(|| (tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), format!("{}\n{}", tree_sitter_typescript::HIGHLIGHTS_QUERY, js()))) },
    Lang { id: "tsx", aliases: &[], extensions: &["tsx"], files: &[], grammar: Some(|| (tree_sitter_typescript::LANGUAGE_TSX.into(), format!("{}\n{}\n{}", tree_sitter_typescript::HIGHLIGHTS_QUERY, tree_sitter_javascript::JSX_HIGHLIGHT_QUERY, js()))) },
    Lang { id: "javascript", aliases: &["js", "jsx", "node"], extensions: &["js", "mjs", "cjs", "jsx"], files: &[], grammar: Some(|| (tree_sitter_javascript::LANGUAGE.into(), format!("{}\n{}", tree_sitter_javascript::JSX_HIGHLIGHT_QUERY, js()))) },
    Lang { id: "python", aliases: &["py"], extensions: &["py", "pyi", "pyw"], files: &[], grammar: Some(|| (tree_sitter_python::LANGUAGE.into(), tree_sitter_python::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "go", aliases: &["golang"], extensions: &["go"], files: &[], grammar: Some(|| (tree_sitter_go::LANGUAGE.into(), tree_sitter_go::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "nix", aliases: &[], extensions: &["nix"], files: &[], grammar: Some(|| (tree_sitter_nix::LANGUAGE.into(), tree_sitter_nix::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "lua", aliases: &[], extensions: &["lua"], files: &[], grammar: Some(|| (tree_sitter_lua::LANGUAGE.into(), tree_sitter_lua::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "bash", aliases: &["sh", "shell", "zsh"], extensions: &["sh", "bash", "zsh"], files: &[".bashrc", ".zshrc", ".profile", ".bash_profile", ".envrc", "PKGBUILD"], grammar: Some(|| (tree_sitter_bash::LANGUAGE.into(), tree_sitter_bash::HIGHLIGHT_QUERY.into())) },
    Lang { id: "json", aliases: &["jsonc", "json5"], extensions: &["json", "jsonc", "json5", "geojson", "webmanifest"], files: &[".prettierrc", ".babelrc", ".eslintrc", "flake.lock"], grammar: Some(|| (tree_sitter_json::LANGUAGE.into(), tree_sitter_json::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "yaml", aliases: &["yml"], extensions: &["yaml", "yml"], files: &[".clang-format"], grammar: Some(|| (tree_sitter_yaml::LANGUAGE.into(), tree_sitter_yaml::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "toml", aliases: &[], extensions: &["toml"], files: &["Cargo.lock", "uv.lock", "poetry.lock"], grammar: Some(|| (tree_sitter_toml_ng::LANGUAGE.into(), tree_sitter_toml_ng::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "markdown", aliases: &["md"], extensions: &["md", "markdown", "mdx"], files: &[], grammar: Some(|| (tree_sitter_md::LANGUAGE.into(), tree_sitter_md::HIGHLIGHT_QUERY_BLOCK.into())) },
    Lang { id: "css", aliases: &["scss"], extensions: &["css"], files: &[], grammar: Some(|| (tree_sitter_css::LANGUAGE.into(), tree_sitter_css::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "html", aliases: &["htm", "xml", "svg"], extensions: &["html", "htm", "xhtml", "xml", "svg", "plist"], files: &[], grammar: Some(|| (tree_sitter_html::LANGUAGE.into(), tree_sitter_html::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "c", aliases: &["h", "cpp", "c++", "objc"], extensions: &["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm"], files: &[], grammar: Some(|| (tree_sitter_c::LANGUAGE.into(), tree_sitter_c::HIGHLIGHT_QUERY.into())) },
    Lang { id: "zig", aliases: &[], extensions: &["zig", "zon"], files: &[], grammar: Some(|| (tree_sitter_zig::LANGUAGE.into(), tree_sitter_zig::HIGHLIGHTS_QUERY.into())) },
    Lang { id: "csv", aliases: &["tsv"], extensions: &["csv", "tsv"], files: &[], grammar: None },
    Lang { id: "text", aliases: &["txt", "plain", "plaintext"], extensions: &["txt", "log"], files: &["LICENSE", "COPYING"], grammar: None },
];

/// The language for a name (`"rust"`, `"ts"`), else for a path's file name
/// or extension (`"src/main.rs"`, `"Cargo.lock"`), else none.
pub fn lang(name_or_path: &str) -> Option<&'static Lang> {
    let lower = name_or_path.to_ascii_lowercase();
    if let Some(l) = LANGS.iter().find(|l| l.id == lower || l.aliases.contains(&lower.as_str())) {
        return Some(l);
    }
    let file = name_or_path.rsplit(['/', '\\']).next().unwrap_or(name_or_path);
    if let Some(l) = LANGS.iter().find(|l| l.files.contains(&file)) {
        return Some(l);
    }
    let ext = file.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
    LANGS.iter().find(|l| l.extensions.contains(&ext.as_str()))
}

/// A compiled grammar and its highlights query.
pub struct Grammar {
    language: Language,
    query: Query,
    /// Capture index to the name it colors, or None for captures that
    /// don't color (`_private`, `none`, `spell`, `embedded`...).
    names: Vec<Option<&'static str>>,
}

static GRAMMARS: LazyLock<Mutex<HashMap<&'static str, Option<Arc<Grammar>>>>> = LazyLock::new(Default::default);

/// Interned capture names: queries are compiled once each, but names hand out
/// as `&'static str` to the editor's resolver.
fn intern(name: &str) -> &'static str {
    static NAMES: LazyLock<Mutex<HashMap<String, &'static str>>> = LazyLock::new(Default::default);
    let mut names = NAMES.lock().unwrap();
    if let Some(n) = names.get(name) {
        return n;
    }
    let leaked: &'static str = Box::leak(name.to_owned().into_boxed_str());
    names.insert(name.to_owned(), leaked);
    leaked
}

fn colored(name: &str) -> bool {
    !(name.starts_with('_') || matches!(name.split('.').next(), Some("none" | "spell" | "nospell" | "embedded" | "conceal" | "local" | "injection")))
}

/// The grammar for a language name or path, compiled on first use. None for
/// unknown languages, data files without a grammar, and queries that fail to
/// compile (logged once).
pub fn grammar(name_or_path: &str) -> Option<Arc<Grammar>> {
    let l = lang(name_or_path)?;
    let make = l.grammar?;
    let mut cache = GRAMMARS.lock().unwrap();
    cache
        .entry(l.id)
        .or_insert_with(|| {
            let (language, source) = make();
            match Query::new(&language, &source) {
                Ok(query) => {
                    let names = query.capture_names().iter().map(|n| colored(n).then(|| intern(n))).collect();
                    Some(Arc::new(Grammar { language, query, names }))
                }
                Err(e) => {
                    tracing::warn!("{} highlights query: {e}", l.id);
                    None
                }
            }
        })
        .clone()
}

/// Named spans of `text` within `range`: ordered, non-overlapping, uncolored
/// text left out. The innermost capture wins; for the same node, the earlier
/// pattern in the query (tree-sitter's convention).
fn spans(g: &Grammar, tree: &Tree, text: &[u8], range: Range<usize>) -> Vec<(Range<usize>, &'static str)> {
    let mut found: Vec<(usize, usize, usize, &'static str)> = Vec::new();
    let mut cursor = QueryCursor::new();
    cursor.set_byte_range(range.clone());
    let mut captures = cursor.captures(&g.query, tree.root_node(), text);
    while let Some((m, i)) = captures.next() {
        let c = m.captures()[*i];
        if let Some(&Some(name)) = g.names.get(c.index as usize) {
            let r = c.node.byte_range();
            if r.start < r.end {
                found.push((r.start, r.end, m.pattern_index, name));
            }
        }
    }
    // Outer before inner; for one node, the earliest pattern first.
    found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    found.dedup_by(|b, a| a.0 == b.0 && a.1 == b.1);

    let mut out: Vec<(Range<usize>, &'static str)> = Vec::new();
    let emit = |out: &mut Vec<(Range<usize>, &'static str)>, r: Range<usize>, name: &'static str| {
        let r = r.start.max(range.start)..r.end.min(range.end);
        if r.start >= r.end {
            return;
        }
        match out.last_mut() {
            Some((last, n)) if last.end == r.start && *n == name => last.end = r.end,
            _ => out.push((r, name)),
        }
    };
    // A stack of open spans: what's on top paints until it ends or a child starts.
    let mut stack: Vec<(usize, &'static str)> = Vec::new();
    let mut pos = 0usize;
    for (start, end, _, name) in found {
        while let Some(&(top_end, top_name)) = stack.last() {
            if top_end > start {
                break;
            }
            emit(&mut out, pos..top_end, top_name);
            pos = pos.max(top_end);
            stack.pop();
        }
        if let Some(&(_, top_name)) = stack.last() {
            emit(&mut out, pos..start, top_name);
        }
        pos = pos.max(start);
        // Partial overlaps (rare) are clipped to the enclosing span.
        let end = stack.last().map_or(end, |&(top_end, _)| end.min(top_end));
        if end > pos {
            stack.push((end, name));
        }
    }
    while let Some((top_end, top_name)) = stack.pop() {
        emit(&mut out, pos..top_end, top_name);
        pos = pos.max(top_end);
    }
    out
}

fn parser(g: &Grammar) -> Option<Parser> {
    let mut p = Parser::new();
    p.set_language(&g.language).ok()?;
    Some(p)
}

/// Text larger than this isn't parsed for a one-off highlight (a mod drawing
/// a huge blob), so a slow parse can't stall the window.
const HIGHLIGHT_LIMIT: usize = 2 * 1024 * 1024;

/// `herdr.highlight(text, language)`: `[[start, end, name], ...]` in UTF-16
/// code units (JavaScript string offsets), ordered and non-overlapping.
/// Empty for an unknown language.
pub fn highlight(text: &str, language: &str) -> Vec<(usize, usize, &'static str)> {
    if text.len() > HIGHLIGHT_LIMIT {
        return Vec::new();
    }
    let Some(g) = grammar(language) else { return Vec::new() };
    let Some(tree) = parser(&g).and_then(|mut p| p.parse(text, None)) else { return Vec::new() };
    let spans = spans(&g, &tree, text.as_bytes(), 0..text.len());
    // Byte offsets to UTF-16 offsets, walking the text once.
    let mut out = Vec::with_capacity(spans.len());
    let mut unit = 0usize;
    let mut chars = text.char_indices().peekable();
    let mut to_unit = |target: usize| {
        while let Some(&(b, c)) = chars.peek() {
            if b >= target {
                break;
            }
            unit += c.len_utf16();
            chars.next();
        }
        unit
    };
    for (r, name) in spans {
        let s = to_unit(r.start);
        let e = to_unit(r.end);
        out.push((s, e, name));
    }
    out
}

/// Fold candidates: multi-line nodes, the outermost per starting line.
fn folds(tree: &Tree) -> Vec<FoldRange> {
    let mut out: Vec<FoldRange> = Vec::new();
    let mut seen_start = std::collections::HashSet::new();
    let mut cursor = tree.walk();
    let mut depth = 0usize;
    loop {
        let node = cursor.node();
        let (s, e) = (node.start_position().row, node.end_position().row);
        // The root and very deep nodes don't fold.
        if depth > 0 && depth < 64 && node.is_named() && e > s && node.child_count() > 1 && seen_start.insert(s) {
            out.push(FoldRange::new(s, e));
        }
        if depth < 64 && cursor.goto_first_child() {
            depth += 1;
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                out.sort_by_key(|f| f.start_line);
                return out;
            }
            depth -= 1;
        }
    }
}

/// The editor's highlighter: incremental parses as the person types; styles
/// for the rows on screen are queried on demand and kept until the next edit.
pub struct Highlighter {
    grammar: Arc<Grammar>,
    language: SharedString,
    parser: Parser,
    tree: Option<Tree>,
    text: String,
    folds: Vec<FoldRange>,
    cache: std::cell::RefCell<Option<(Range<usize>, Vec<(Range<usize>, &'static str)>)>>,
}

impl Highlighter {
    pub fn new(language: &str) -> Option<Self> {
        let grammar = grammar(language)?;
        let parser = parser(&grammar)?;
        Some(Self { language: language.to_owned().into(), grammar, parser, tree: None, text: String::new(), folds: Vec::new(), cache: Default::default() })
    }

    fn reparse(&mut self, edits: &[InputEdit], text: &Rope, folding: bool) {
        if let Some(tree) = self.tree.as_mut() {
            for e in edits {
                tree.edit(&tree_sitter::InputEdit {
                    start_byte: e.start_byte,
                    old_end_byte: e.old_end_byte,
                    new_end_byte: e.new_end_byte,
                    start_position: tree_sitter::Point::new(e.start_position.row, e.start_position.column),
                    old_end_position: tree_sitter::Point::new(e.old_end_position.row, e.old_end_position.column),
                    new_end_position: tree_sitter::Point::new(e.new_end_position.row, e.new_end_position.column),
                });
            }
        }
        self.text = text.to_string();
        // Without an edit to apply, the old tree no longer matches the text.
        let old = if edits.is_empty() { None } else { self.tree.as_ref() };
        self.tree = self.parser.parse(&self.text, old);
        self.folds = match (&self.tree, folding) {
            (Some(t), true) => folds(t),
            _ => Vec::new(),
        };
        self.cache.replace(None);
    }
}

impl InputHighlighter for Highlighter {
    fn language(&self) -> SharedString {
        self.language.clone()
    }

    fn update(&mut self, edit: Option<InputEdit>, text: &Rope, folding: bool, _window: &mut Window, _cx: &mut Context<EditorState>) {
        let edits: Vec<InputEdit> = edit.into_iter().collect();
        self.reparse(&edits, text, folding);
    }

    fn update_batch(&mut self, edits: &[(InputEdit, Rope)], folding: bool, _window: &mut Window, _cx: &mut Context<EditorState>) {
        let Some((_, last)) = edits.last() else { return };
        let only: Vec<InputEdit> = edits.iter().map(|(e, _)| *e).collect();
        self.reparse(&only, last, folding);
    }

    fn styles(&self, range: &Range<usize>, resolver: &dyn HighlightStyleResolver) -> Vec<(Range<usize>, HighlightStyle)> {
        let Some(tree) = &self.tree else { return vec![(range.clone(), HighlightStyle::default())] };
        let mut cache = self.cache.borrow_mut();
        // Query a little around what's asked, so scrolling a line doesn't requery.
        if !cache.as_ref().is_some_and(|(r, _)| r.start <= range.start && r.end >= range.end) {
            let start = range.start.saturating_sub(4096);
            let end = (range.end + 4096).min(self.text.len());
            *cache = Some((start..end, spans(&self.grammar, tree, self.text.as_bytes(), start..end)));
        }
        let (_, spans) = cache.as_ref().unwrap();
        let first = spans.partition_point(|(r, _)| r.end <= range.start);
        let mut runs = Vec::new();
        let mut at = range.start;
        for (r, name) in &spans[first..] {
            if r.start >= range.end {
                break;
            }
            let (s, e) = (r.start.max(range.start), r.end.min(range.end));
            if s >= e || e <= at {
                continue;
            }
            if at < s {
                runs.push((at..s, HighlightStyle::default()));
            }
            runs.push((s.max(at)..e, resolver.style(name).unwrap_or_default()));
            at = e;
        }
        if at < range.end {
            runs.push((at..range.end, HighlightStyle::default()));
        }
        runs
    }

    fn fold_ranges(&self, _text: &Rope) -> Vec<FoldRange> {
        self.folds.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_resolve_by_name_alias_extension_and_file_name() {
        assert_eq!(lang("rust").unwrap().id, "rust");
        assert_eq!(lang("ts").unwrap().id, "typescript");
        assert_eq!(lang("src/app.tsx").unwrap().id, "tsx");
        assert_eq!(lang("/x/Cargo.lock").unwrap().id, "toml");
        assert_eq!(lang("data/rows.CSV").unwrap().id, "csv");
        assert_eq!(lang("flake.nix").unwrap().id, "nix");
        assert!(lang("photo.png").is_none());
        assert!(lang("Makefile").is_none());
    }

    #[test]
    fn every_grammar_query_compiles() {
        for l in LANGS.iter().filter(|l| l.grammar.is_some()) {
            assert!(grammar(l.id).is_some(), "{} did not compile", l.id);
        }
        assert!(grammar("csv").is_none(), "data files without a grammar stay plain");
    }

    #[test]
    fn rust_spans_name_keywords_strings_and_functions() {
        let text = "fn main() { let s = \"hi\"; }";
        let names: Vec<_> = highlight(text, "rust").into_iter().map(|(s, e, n)| (&text[s..e], n.split('.').next().unwrap())).collect();
        assert!(names.contains(&("fn", "keyword")), "{names:?}");
        assert!(names.contains(&("main", "function")), "{names:?}");
        assert!(names.iter().any(|(t, n)| t.contains("hi") && *n == "string"), "{names:?}");
    }

    #[test]
    fn spans_are_ordered_and_never_overlap() {
        for (text, lang) in [
            ("const a = { b: [1, 'x', `t${y}`] }; // c\nfunction f() { return a?.b }", "tsx"),
            ("[package]\nname = \"x\"\n[dependencies]\nserde = { version = \"1\" }", "toml"),
            ("# T\n\nsome *text*\n\n```rs\nfn x(){}\n```\n", "markdown"),
            ("{ pkgs, ... }: { x = pkgs.hello; y = \"${pkgs.z}/bin\"; }", "nix"),
        ] {
            let spans = highlight(text, lang);
            assert!(!spans.is_empty(), "{lang} had no spans");
            for w in spans.windows(2) {
                assert!(w[0].1 <= w[1].0, "{lang}: {:?} overlaps {:?}", w[0], w[1]);
            }
        }
    }

    #[test]
    fn offsets_are_utf16_for_javascript_strings() {
        // "é" is two bytes but one UTF-16 unit; "😀" is four bytes, two units.
        let text = "let é = \"😀\"; fn x() {}";
        let spans = highlight(text, "rust");
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let (s, e, _) = spans.iter().rev().find(|(_, _, n)| n.starts_with("keyword")).copied().unwrap();
        assert_eq!(String::from_utf16(&utf16[s..e]).unwrap(), "fn");
    }

    #[test]
    fn unknown_languages_and_huge_text_have_no_spans() {
        assert!(highlight("x", "cobol").is_empty());
        assert!(highlight(&"a".repeat(HIGHLIGHT_LIMIT + 1), "rust").is_empty());
    }
}
