//! HERDR: library modules, JavaScript or TypeScript the host ships for every
//! application to import by a bare name.
//!
//! An application may import only its own files, and each application's
//! modules are evaluated under its own generation, so a library copied into
//! every application is parsed, evaluated and kept once per application. A
//! library the host registers here is resolved by name for all of them and
//! evaluated once per runtime: one copy in memory however many applications
//! import it, one version for all of them.
//!
//! A library is a set of files under virtual paths (`effect/index.js`,
//! `@fireflies/kit/http.ts`). A bare specifier names one: the path itself,
//! or the path with `.ts`, `.js`, `/index.ts` or `/index.js` added
//! (`effect` is `effect/index.js`, `@fireflies/kit/live` is
//! `@fireflies/kit/live.ts`). A library file's relative imports resolve among
//! its own library's files, never outside it; its bare imports go through
//! the rest of the chain as an application's do. `.ts` files are stripped of
//! their types when they load, as an application's are.
//!
//! The set is fixed before an application loads: a module the engine has
//! evaluated stays evaluated, so replacing a library afterwards would leave
//! two versions running side by side.

use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, RwLock},
};

/// The registered files, by virtual path.
static LIBRARIES: RwLock<BTreeMap<String, Arc<str>>> = RwLock::new(BTreeMap::new());

/// Registers library files (virtual path, source), replacing any registered
/// before. Call it before the first application loads.
pub fn export_libraries<P: Into<String>, S: Into<Arc<str>>>(files: impl IntoIterator<Item = (P, S)>) {
    let files: BTreeMap<String, Arc<str>> = files.into_iter().map(|(path, source)| (path.into(), source.into())).collect();
    if let Ok(mut libraries) = LIBRARIES.write() {
        *libraries = files;
    }
}

/// The registered paths (for diagnostics and tests).
pub fn library_paths() -> Vec<String> {
    LIBRARIES.read().map(|libraries| libraries.keys().cloned().collect()).unwrap_or_default()
}

/// The library a virtual path belongs to: its first segment, or two for a scoped name (`@scope/name`).
fn library_root(path: &str) -> &str {
    let mut segments = path.match_indices('/').map(|(at, _)| at);
    let end = if path.starts_with('@') {
        segments.nth(1)
    } else {
        segments.next()
    };
    end.map_or(path, |at| &path[..at])
}

/// The registered path a bare specifier names, if any.
pub(crate) fn resolve_bare(name: &str) -> Option<String> {
    let libraries = LIBRARIES.read().ok()?;
    [
        name.to_owned(),
        format!("{name}.ts"),
        format!("{name}.js"),
        format!("{name}/index.ts"),
        format!("{name}/index.js"),
    ]
    .into_iter()
    .find(|candidate| libraries.contains_key(candidate))
}

/// The registered path a relative import from library file `base` names, if
/// any: within `base`'s own library only.
pub(crate) fn resolve_relative(base: &str, name: &str) -> Option<String> {
    let libraries = LIBRARIES.read().ok()?;
    if !libraries.contains_key(base) {
        return None;
    }
    let mut parts: Vec<&str> = base.split('/').collect();
    parts.pop();
    for segment in name.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            segment => parts.push(segment),
        }
    }
    let joined = parts.join("/");
    if library_root(&joined) != library_root(base) {
        return None;
    }
    [joined.clone(), format!("{joined}.ts"), format!("{joined}.js")]
        .into_iter()
        .find(|candidate| libraries.contains_key(candidate))
}

/// The source of a registered path, its types stripped when it is TypeScript.
pub(crate) fn source(path: &str) -> Option<Result<String, String>> {
    let text = LIBRARIES.read().ok()?.get(path)?.clone();
    if crate::typescript::is_typescript(Path::new(path)) {
        Some(crate::typescript::strip(Path::new(path), &text))
    } else {
        Some(Ok(text.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_names_and_relative_imports_resolve_within_their_library() {
        export_libraries([
            ("lib/index.js", "export * from \"./chunk-a.js\";"),
            ("lib/http/index.js", "import \"../chunk-a.js\";"),
            ("lib/chunk-a.js", ""),
            ("@scope/kit/index.ts", ""),
            ("@scope/kit/live.ts", ""),
            ("other/index.js", ""),
        ]);
        assert_eq!(resolve_bare("lib").as_deref(), Some("lib/index.js"));
        assert_eq!(resolve_bare("lib/http").as_deref(), Some("lib/http/index.js"));
        assert_eq!(resolve_bare("@scope/kit").as_deref(), Some("@scope/kit/index.ts"));
        assert_eq!(resolve_bare("@scope/kit/live").as_deref(), Some("@scope/kit/live.ts"));
        assert_eq!(resolve_bare("nothing"), None);
        assert_eq!(resolve_relative("lib/http/index.js", "../chunk-a.js").as_deref(), Some("lib/chunk-a.js"));
        assert_eq!(resolve_relative("@scope/kit/index.ts", "./live.ts").as_deref(), Some("@scope/kit/live.ts"));
        // Never out of its own library, nor from a file that isn't one.
        assert_eq!(resolve_relative("lib/index.js", "../other/index.js"), None);
        assert_eq!(resolve_relative("/an/app/main.ts", "./live.ts"), None);
    }

    #[test]
    fn library_roots_take_a_scope_with_them() {
        assert_eq!(library_root("effect/index.js"), "effect");
        assert_eq!(library_root("@fireflies/kit/http.ts"), "@fireflies/kit");
        assert_eq!(library_root("effect"), "effect");
    }
}
