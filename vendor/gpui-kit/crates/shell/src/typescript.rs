//! HERDR: TypeScript sources, run by blanking their types.
//!
//! An application may write any of its files in TypeScript (`.ts`, `.mts`).
//! The loader does not compile them: it replaces every type annotation,
//! interface, type alias, `import type` and the like with spaces and evaluates
//! what is left. That is the rule Node's type stripping and TypeScript's
//! `erasableSyntaxOnly` share, so the output keeps every byte offset, line and
//! column of the source: an exception thrown at line 40 of `main.ts` reports
//! line 40 of `main.ts`, with no source map anywhere.
//!
//! Syntax that would need code generated for it (`enum`, `namespace`,
//! constructor parameter properties, `<T>x` assertions) is refused with the
//! file, line and column, like any other error a module fails to load with.
//! Types are not checked here: that is `tsc --noEmit`'s job, before the code
//! ever reaches the runtime.
//!
//! JavaScript files never pass through this module, so a `.js` application
//! loads exactly as it did before TypeScript was accepted.
//!
//! Tested in Fireflies (`src/mods/typescript_tests.rs`): this crate's own
//! tests do not build outside gpui-kit's workspace.

use std::path::Path;

/// Extensions of the files the runtime evaluates: what a reload is triggered by
/// and what an import may name. `.d.ts` files are declarations and never run.
pub const SOURCE_EXTENSIONS: [&str; 4] = ["js", "mjs", "ts", "mts"];

/// Whether a file name is script source the runtime would evaluate.
pub fn is_source(name: &str) -> bool {
    !is_declaration(name)
        && name
            .rsplit_once('.')
            .is_some_and(|(_, extension)| SOURCE_EXTENSIONS.contains(&extension))
}

/// Whether a path is TypeScript the loader has to strip before evaluating it.
pub fn is_typescript(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !is_declaration(name) && (name.ends_with(".ts") || name.ends_with(".mts"))
}

fn is_declaration(name: &str) -> bool {
    name.ends_with(".d.ts") || name.ends_with(".d.mts")
}

/// The entry an application directory without a manifest starts at:
/// `main.js`, or `main.ts` when that is the one present. With both, `main.js`
/// wins, so a TypeScript copy left beside a JavaScript application changes
/// nothing.
pub fn default_entry(directory: &Path) -> &'static str {
    if !directory.join("main.js").is_file() && directory.join("main.ts").is_file() {
        "main.ts"
    } else {
        "main.js"
    }
}

#[cfg(feature = "quickjs")]
pub use strip::strip;

#[cfg(feature = "quickjs")]
mod strip {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::rc::Rc;
    use std::sync::Mutex;

    use swc_common::errors::{DiagnosticBuilder, Emitter, HANDLER, Handler};
    use swc_common::sync::Lrc;
    use swc_common::{GLOBALS, Globals, SourceMap};

    /// The last source stripped per file, and its result. A reload re-reads
    /// every file of an application, and most of them did not change: those
    /// are answered from here instead of being parsed again.
    static CACHE: Mutex<Option<HashMap<PathBuf, (String, String)>>> = Mutex::new(None);

    /// Bounds the cache the way the watcher bounds a tree: past this many
    /// files it starts over rather than growing for the life of the process.
    const MAX_CACHED_FILES: usize = 1024;

    struct Collect(Rc<RefCell<Vec<String>>>, Lrc<SourceMap>);

    impl Emitter for Collect {
        fn emit(&mut self, diagnostic: &mut DiagnosticBuilder<'_>) {
            let at = diagnostic.span.primary_span().map(|span| {
                let place = self.1.lookup_char_pos(span.lo);
                (place.line, place.col_display + 1)
            });
            let message = diagnostic.message();
            self.0.borrow_mut().push(match at {
                Some((line, column)) => format!("{line}:{column}: {message}"),
                None => message,
            });
        }
    }

    /// Blanks the types out of `source`, read from `path`. The result has the
    /// same length and the same lines. The error names the file, the line and
    /// the column of each construct that cannot simply be removed.
    pub fn strip(path: &Path, source: &str) -> Result<String, String> {
        if let Some(stripped) = CACHE.lock().ok().and_then(|cache| {
            let (text, stripped) = cache.as_ref()?.get(path)?;
            (text == source).then(|| stripped.clone())
        }) {
            return Ok(stripped);
        }

        let stripped = strip_uncached(path, source)?;
        if let Ok(mut cache) = CACHE.lock() {
            let cache = cache.get_or_insert_with(HashMap::new);
            if cache.len() >= MAX_CACHED_FILES {
                cache.clear();
            }
            cache.insert(path.to_path_buf(), (source.to_owned(), stripped.clone()));
        }
        Ok(stripped)
    }

    fn strip_uncached(path: &Path, source: &str) -> Result<String, String> {
        let map: Lrc<SourceMap> = Default::default();
        let diagnostics = Rc::new(RefCell::new(Vec::new()));
        let handler = Handler::with_emitter(
            true,
            false,
            Box::new(Collect(diagnostics.clone(), map.clone())),
        );
        let options = swc_ts_fast_strip::Options {
            module: Some(true),
            filename: Some(path.to_string_lossy().into_owned()),
            mode: swc_ts_fast_strip::Mode::StripOnly,
            ..Default::default()
        };
        let result = GLOBALS.set(&Globals::new(), || {
            HANDLER.set(&handler, || {
                swc_ts_fast_strip::operate(&map, &handler, source.to_owned(), options)
            })
        });
        match result {
            Ok(output) => Ok(output.code),
            Err(error) => {
                let diagnostics = diagnostics.borrow();
                let unsupported = matches!(
                    error.code,
                    swc_ts_fast_strip::ErrorCode::UnsupportedSyntax
                );
                let mut message = String::new();
                for diagnostic in diagnostics.iter() {
                    message.push_str(&format!("{}:{diagnostic}\n", path.display()));
                }
                if diagnostics.is_empty() {
                    message.push_str(&format!("{}: {}\n", path.display(), error.message));
                }
                if unsupported {
                    message.push_str(
                        "TypeScript here runs with its types removed, so only syntax that \
                         erases to JavaScript works (tsc's erasableSyntaxOnly): a const object \
                         instead of an enum, a module instead of a namespace, a declared field \
                         instead of a constructor parameter property, `x as T` instead of `<T>x`.",
                    );
                }
                Err(message.trim_end().to_owned())
            }
        }
    }
}
