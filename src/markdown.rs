//! Markdown extras for every rendered Markdown view in the app (mods'
//! `TextView.markdown`: the Markdown viewer, the editor's preview, the GitHub
//! window): math (`$…$`, `$$…$$`, a ```math fence) typeset by RaTeX and
//! mermaid diagrams (a ```mermaid fence) laid out by mermaid-rs-renderer, both
//! drawn as images in the theme's colors, in-process with no network; and
//! tree-sitter colors (src/syntax.rs) for fenced code.
//!
//! The plugins only take the source while parsing (which may run off the main
//! thread); drawing renders once per formula, color and size, then reuses it.

use std::{
    collections::{BTreeMap, HashMap},
    hash::{Hash, Hasher},
    ops::Range,
    sync::{Arc, LazyLock, Mutex, RwLock},
};

use gpui::{
    App, HighlightStyle, Hsla, Image, ImageFormat, InteractiveElement, IntoElement, ParentElement, SharedString,
    Styled, Window, div, img, px,
};
use gpui_base::{InlineElement, InlineRenderContext, MarkdownExtensions, MarkdownNode, MarkdownParseContext, MarkdownPlugin, TextViewDefaults, markdown_ast::Node};

/// Math is drawn this much larger than the text around it (as KaTeX does).
const MATH_SCALE: f32 = 1.1;
/// Space around a formula's ink, in pixels, so antialiased edges aren't cut.
const PAD: f32 = 1.0;
/// Formulas and diagrams longer than this are shown as their source.
const SOURCE_LIMIT: usize = 20_000;
/// Rendered formulas and diagrams kept (each a small SVG).
const CACHE_LIMIT: usize = 2_000;

/// The theme's colors the plugins draw with.
#[derive(Clone, Default)]
struct Palette {
    colors: BTreeMap<String, String>,
    revision: u64,
}

static PALETTE: LazyLock<RwLock<Arc<Palette>>> = LazyLock::new(|| RwLock::new(Arc::new(Palette::default())));

fn palette() -> Arc<Palette> {
    PALETTE.read().map(|p| p.clone()).unwrap_or_default()
}

impl Palette {
    fn hex(&self, name: &str, fallback: &str) -> String {
        self.colors.get(name).filter(|v| v.starts_with('#')).map(|v| v[..v.len().min(7)].to_string()).unwrap_or_else(|| fallback.to_string())
    }
}

/// Installs the plugins and the code colors for every Markdown view; call once,
/// after the shell is set up. [`set_theme`] follows theme changes.
pub fn install(cx: &mut App) {
    let extensions = MarkdownExtensions::default()
        .plugin(MathInline)
        .plugin(MathBlock)
        .plugin(Mermaid);
    gpui_shell::set_host_markdown_extensions(extensions);
    set_theme(cx);
    // The first formula loads RaTeX's fonts and the first diagram the system's;
    // do both before anyone waits for them.
    std::thread::spawn(|| {
        let _ = math_svg("x^2", false, 0xffffffff, 14.0);
        let _ = mermaid_rs_renderer::render("flowchart LR\n  a --> b\n");
    });
}

/// Follows the theme: code colors for fenced code, diagram colors.
pub fn set_theme(cx: &mut App) {
    let theme = crate::settings::theme();
    let mut p = Palette { colors: (*theme).clone(), revision: 0 };
    if let Ok(mut slot) = PALETTE.write() {
        p.revision = slot.revision + 1;
        *slot = Arc::new(p.clone());
    }
    let colors: Arc<HashMap<&'static str, Hsla>> = Arc::new(
        syntax_colors(&p.colors).into_iter().filter_map(|(k, v)| Some((k, crate::settings::parse_hex(&v)?))).collect(),
    );
    TextViewDefaults::global(cx)
        .with_code_block_highlighter(move |block| {
            let Some(lang) = block.lang() else { return Vec::new() };
            code_styles(&block.code(), &lang, &colors)
        })
        .install(cx);
}

/// Moonfly's roles from the theme's 16 colors (as nocturne-editor/logic.js `syntaxColors`).
fn syntax_colors(t: &BTreeMap<String, String>) -> Vec<(&'static str, String)> {
    let a = |i: usize| t.get(&format!("ansi{i}")).cloned().unwrap_or_default();
    let fg = t.get("foreground").cloned().unwrap_or_default();
    vec![
        ("keyword", a(5)), ("keyword.operator", a(9)), ("conditional", a(5)), ("repeat", a(5)), ("include", a(5)),
        ("function", a(12)), ("function.builtin", a(4)), ("function.macro", a(13)), ("constructor", a(10)),
        ("type", a(10)), ("type.builtin", a(10)), ("tag", a(10)), ("attribute", a(13)), ("namespace", a(6)), ("module", a(6)),
        ("string", a(11)), ("string.escape", a(9)), ("string.special", a(3)), ("string.regex", a(3)), ("character", a(11)), ("escape", a(9)),
        ("number", a(3)), ("float", a(3)), ("boolean", a(3)), ("constant", a(3)), ("constant.builtin", a(3)),
        ("comment", a(8)), ("comment.documentation", a(8)),
        ("property", a(6)), ("field", a(6)), ("label", a(3)), ("operator", a(9)),
        ("variable.builtin", a(4)), ("variable.parameter", fg.clone()), ("embedded", fg),
        ("text.title", a(4)), ("text.literal", a(11)), ("text.uri", a(6)), ("text.reference", a(12)), ("text.emphasis", a(5)), ("text.strong", a(5)),
        ("punctuation.special", a(9)),
    ]
}

/// Colored runs of a fenced code block: tree-sitter spans, each in its
/// capture's color (or its root's), uncolored where none applies.
fn code_styles(code: &str, lang: &str, colors: &HashMap<&'static str, Hsla>) -> Vec<(Range<usize>, HighlightStyle)> {
    let color_of = |name: &str| -> Option<Hsla> {
        if let Some(c) = colors.get(name) {
            return Some(*c);
        }
        let mut n = name;
        while let Some(i) = n.rfind('.') {
            n = &n[..i];
            if let Some(c) = colors.get(n) {
                return Some(*c);
            }
        }
        None
    };
    crate::syntax::highlight_bytes(code, lang)
        .into_iter()
        .filter_map(|(r, name)| Some((r, HighlightStyle { color: Some(color_of(name)?), ..Default::default() })))
        .collect()
}

// ---- math

#[derive(Clone)]
struct Math {
    tex: String,
    display: bool,
}

/// Whether `$…$` in running text is meant as math: as Pandoc and GitHub read
/// it, the formula doesn't start or end with a space and no digit follows the
/// closing `$`, so "it costs $5 and $10" stays prose.
fn inline_math_ok(source: &str, value: &str, after: Option<char>) -> bool {
    if source.starts_with("$$") {
        return !value.trim().is_empty();
    }
    !value.is_empty()
        && !value.starts_with(char::is_whitespace)
        && !value.ends_with(char::is_whitespace)
        && !after.is_some_and(|c| c.is_ascii_digit())
}

struct MathInline;

impl MarkdownPlugin for MathInline {
    fn name(&self) -> &str {
        "herdr-math"
    }

    fn parse(&self, node: &Node, cx: &MarkdownParseContext<'_>) -> Option<MarkdownNode> {
        let Node::InlineMath(m) = node else { return None };
        let source = cx.node_source(node)?;
        let end = node.position()?.end.offset;
        let after = cx.source().get(end..).and_then(|s| s.chars().next());
        if !inline_math_ok(source, &m.value, after) || m.value.len() > SOURCE_LIMIT {
            return None;
        }
        let display = source.starts_with("$$");
        Some(MarkdownNode::new(self.name().to_string(), Math { tex: m.value.clone(), display }).text(source.to_string()).markdown(source.to_string()))
    }

    fn render_inline(&self, node: &MarkdownNode, context: &InlineRenderContext, _window: &mut Window, _cx: &mut App) -> Option<InlineElement> {
        let math = node.data::<Math>()?;
        let color = context.text_style().color;
        let size = f32::from(context.font_size()) * MATH_SCALE;
        Some(match rendered_math(&math.tex, math.display, color, size) {
            Ok(r) => InlineElement::new(img(r.image.clone()).w(px(r.width)).h(px(r.height)).flex_none()).with_baseline(px(r.baseline)),
            Err(_) => InlineElement::new(div().text_color(error_color()).child(SharedString::from(node.as_text().to_string()))),
        })
    }
}

struct MathBlock;

impl MarkdownPlugin for MathBlock {
    fn is_block(&self) -> bool {
        true
    }

    fn name(&self) -> &str {
        "herdr-math-block"
    }

    fn parse(&self, node: &Node, cx: &MarkdownParseContext<'_>) -> Option<MarkdownNode> {
        let tex = match node {
            Node::Math(m) => m.value.clone(),
            Node::Code(c) if c.lang.as_deref().is_some_and(|l| l.eq_ignore_ascii_case("math")) => c.value.clone(),
            _ => return None,
        };
        if tex.len() > SOURCE_LIMIT {
            return None;
        }
        let source = cx.node_source(node).unwrap_or_default().to_string();
        Some(MarkdownNode::new(self.name().to_string(), Math { tex, display: true }).text(source.clone()).markdown(source))
    }

    fn render(&self, node: &MarkdownNode, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let style = window.text_style();
        let size = f32::from(style.font_size.to_pixels(window.rem_size())) * MATH_SCALE;
        let math = node.data::<Math>().cloned().unwrap_or(Math { tex: String::new(), display: true });
        let id = SharedString::from(format!("herdr-math-{:x}", hash(&(&math.tex, node.source_range().map(|r| r.start)))));
        let shell = div().id(id).w_full().py(px(4.)).flex().justify_center();
        match rendered_math(&math.tex, true, style.color, size) {
            Ok(r) => shell.child(fitted(&r)),
            Err(e) => shell.child(source_with_error(&math.tex, &e)),
        }
    }
}

/// A formula drawn for one color and size.
#[derive(Clone)]
struct Rendered {
    image: Arc<Image>,
    width: f32,
    height: f32,
    baseline: f32,
}

static MATH_CACHE: LazyLock<Mutex<HashMap<u64, Result<Rendered, String>>>> = LazyLock::new(Default::default);

fn rendered_math(tex: &str, display: bool, color: Hsla, size: f32) -> Result<Rendered, String> {
    let rgba = gpui::Rgba::from(color);
    let packed = ((rgba.r * 255.0) as u32) << 24 | ((rgba.g * 255.0) as u32) << 16 | ((rgba.b * 255.0) as u32) << 8 | (rgba.a * 255.0) as u32;
    let size = (size * 2.0).round() / 2.0;
    let key = hash(&(tex, display, packed, size.to_bits()));
    if let Some(hit) = MATH_CACHE.lock().ok().and_then(|c| c.get(&key).cloned()) {
        return hit;
    }
    let made = math_svg(tex, display, packed, size).map(|(svg, width, height, baseline)| Rendered {
        image: Arc::new(Image::from_bytes(ImageFormat::Svg, svg.into_bytes())),
        width,
        height,
        baseline,
    });
    if let Ok(mut c) = MATH_CACHE.lock() {
        if c.len() >= CACHE_LIMIT {
            c.clear();
        }
        c.insert(key, made.clone());
    }
    made
}

/// A formula as a self-contained SVG (glyphs as outlines) in `rgba`
/// (0xRRGGBBAA) at `size` pixels per em -> (svg, width, height, baseline from the top).
fn math_svg(tex: &str, display: bool, rgba: u32, size: f32) -> Result<(String, f32, f32, f32), String> {
    use ratex_layout::{layout, layout_options::LayoutOptions, to_display_list};
    use ratex_types::{color::Color, math_style::MathStyle};
    let ast = ratex_parser::parse(tex).map_err(|e| e.to_string())?;
    let color = Color { r: (rgba >> 24) as f32 / 255.0, g: ((rgba >> 16) & 255) as f32 / 255.0, b: ((rgba >> 8) & 255) as f32 / 255.0, a: (rgba & 255) as f32 / 255.0 };
    let options = LayoutOptions::default().with_style(if display { MathStyle::Display } else { MathStyle::Text }).with_color(color);
    let list = to_display_list(&layout(&ast, &options));
    let svg = ratex_svg::render_to_svg(
        &list,
        &ratex_svg::SvgOptions { font_size: size as f64, padding: PAD as f64, stroke_width: (size / 20.0).max(1.0) as f64, embed_glyphs: true, font_dir: String::new() },
    );
    let width = list.width as f32 * size + 2.0 * PAD;
    let height = (list.height + list.depth) as f32 * size + 2.0 * PAD;
    Ok((svg, width, height, PAD + list.height as f32 * size))
}

// ---- mermaid

#[derive(Clone)]
struct Diagram {
    source: String,
}

struct Mermaid;

impl MarkdownPlugin for Mermaid {
    fn is_block(&self) -> bool {
        true
    }

    fn name(&self) -> &str {
        "herdr-mermaid"
    }

    fn parse(&self, node: &Node, cx: &MarkdownParseContext<'_>) -> Option<MarkdownNode> {
        let Node::Code(c) = node else { return None };
        if !c.lang.as_deref().is_some_and(|l| l.eq_ignore_ascii_case("mermaid")) || c.value.len() > SOURCE_LIMIT {
            return None;
        }
        let source = cx.node_source(node).unwrap_or_default().to_string();
        Some(MarkdownNode::new(self.name().to_string(), Diagram { source: c.value.clone() }).text(c.value.clone()).markdown(source))
    }

    fn render(&self, node: &MarkdownNode, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let source = node.data::<Diagram>().map(|d| d.source.clone()).unwrap_or_default();
        let id = SharedString::from(format!("herdr-mermaid-{:x}", hash(&(&source, node.source_range().map(|r| r.start)))));
        let shell = div().id(id).w_full().py(px(6.)).flex().justify_center();
        match rendered_diagram(&source) {
            Ok(r) => shell.child(fitted(&r)),
            Err(e) => shell.child(source_with_error(&source, &e)),
        }
    }
}

static DIAGRAM_CACHE: LazyLock<Mutex<HashMap<u64, Result<Rendered, String>>>> = LazyLock::new(Default::default);

fn rendered_diagram(source: &str) -> Result<Rendered, String> {
    let p = palette();
    let key = hash(&(source, p.revision));
    if let Some(hit) = DIAGRAM_CACHE.lock().ok().and_then(|c| c.get(&key).cloned()) {
        return hit;
    }
    let made = diagram_svg(source, &p).map(|(svg, width, height)| Rendered {
        image: Arc::new(Image::from_bytes(ImageFormat::Svg, svg.into_bytes())),
        width,
        height,
        baseline: height,
    });
    if let Ok(mut c) = DIAGRAM_CACHE.lock() {
        if c.len() >= CACHE_LIMIT / 10 {
            c.clear();
        }
        c.insert(key, made.clone());
    }
    made
}

/// The diagram as SVG in the theme's colors -> (svg, width, height).
fn diagram_svg(source: &str, p: &Palette) -> Result<(String, f32, f32), String> {
    let options = mermaid_rs_renderer::RenderOptions { theme: mermaid_theme(p), ..Default::default() };
    // A parse error is an Err; some inputs panic deep in layout: those are errors too.
    let svg = std::panic::catch_unwind(|| mermaid_rs_renderer::render_with_options(source, options))
        .map_err(|_| "this diagram can't be drawn".to_string())?
        .map_err(|e| e.to_string().lines().next().unwrap_or("not a diagram").to_string())?;
    let (w, h) = svg_size(&svg).unwrap_or((400.0, 300.0));
    Ok((svg, w.max(1.0), h.max(1.0)))
}

/// The `width` and `height` on an SVG's root element, in its units.
fn svg_size(svg: &str) -> Option<(f32, f32)> {
    let root = &svg[svg.find("<svg")?..];
    let root = &root[..root.find('>')?];
    let attr = |name: &str| -> Option<f32> {
        let at = root.find(&format!(" {name}=\""))? + name.len() + 3;
        let value = &root[at..];
        value[..value.find('"')?].trim_end_matches("px").parse().ok()
    };
    Some((attr("width")?, attr("height")?))
}

/// Mermaid's dark theme in the app theme's colors.
fn mermaid_theme(p: &Palette) -> mermaid_rs_renderer::Theme {
    let fg = p.hex("foreground", "#c6c6c6");
    let bg = p.hex("background", "#080808");
    let raised = p.hex("raised", &p.hex("ansi0", "#323437"));
    let border = p.hex("ansi8", "#949494");
    let muted = p.hex("muted", "#9e9e9e");
    let a = |i: usize, f: &str| p.hex(&format!("ansi{i}"), f);
    let mut t = mermaid_rs_renderer::Theme::dark();
    t.primary_color = raised.clone();
    t.primary_text_color = fg.clone();
    t.primary_border_color = border.clone();
    t.line_color = muted.clone();
    t.secondary_color = p.hex("surface", &raised);
    t.tertiary_color = bg.clone();
    t.edge_label_background = bg.clone();
    t.cluster_background = p.hex("surface", &bg);
    t.cluster_border = a(0, "#323437");
    t.background = "none".into();
    t.sequence_actor_fill = raised.clone();
    t.sequence_actor_border = border.clone();
    t.sequence_actor_line = muted.clone();
    t.sequence_note_fill = bg.clone();
    t.sequence_note_border = a(3, "#e3c78a");
    t.sequence_activation_fill = raised.clone();
    t.sequence_activation_border = border;
    t.text_color = fg.clone();
    let accents = [a(4, "#80a0ff"), a(2, "#8cc85f"), a(5, "#cf87e8"), a(3, "#e3c78a"), a(6, "#79dac8"), a(1, "#ff5d5d"), a(12, "#74b2ff"), a(10, "#36c692")];
    t.git_colors = accents.clone();
    t.git_inv_colors = accents.clone().map(|_| bg.clone());
    t.git_branch_label_colors = accents.clone().map(|_| bg.clone());
    t.git_commit_label_color = fg.clone();
    t.git_commit_label_background = raised.clone();
    t.git_tag_label_color = fg.clone();
    t.git_tag_label_background = raised;
    t.git_tag_label_border = muted;
    t.pie_colors = std::array::from_fn(|i| accents[i % accents.len()].clone());
    t.pie_title_text_color = fg.clone();
    t.pie_section_text_color = bg;
    t.pie_legend_text_color = fg;
    t.pie_stroke_color = p.hex("background", "#080808");
    t.pie_outer_stroke_color = a(0, "#323437");
    t
}

// ---- shared

/// A drawn block at its own size, scaled down (keeping its shape) when the text is narrower.
fn fitted(r: &Rendered) -> impl IntoElement {
    img(r.image.clone()).w(px(r.width)).max_w_full().aspect_ratio(r.width / r.height.max(1.))
}

fn error_color() -> Hsla {
    crate::settings::parse_hex(&palette().hex("ansi1", "#ff5d5d")).unwrap_or(gpui::red())
}

/// What couldn't be drawn: its source, and why, in the error color.
fn source_with_error(source: &str, error: &str) -> impl IntoElement {
    let color = error_color();
    gpui::div()
        .flex()
        .flex_col()
        .gap(px(4.))
        .w_full()
        .child(div().text_color(color).text_size(px(11.)).child(SharedString::from(error.to_string())))
        .child(div().opacity(0.75).child(SharedString::from(source.to_string())))
}

fn hash<T: Hash + ?Sized>(value: &T) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dollars_in_prose_stay_prose() {
        assert!(inline_math_ok("$x^2$", "x^2", Some(' ')));
        assert!(inline_math_ok("$x$", "x", None));
        assert!(!inline_math_ok("$5 and $", "5 and ", Some('1')));
        assert!(!inline_math_ok("$ x$", " x", None));
        assert!(!inline_math_ok("$x$", "x", Some('5')));
        assert!(inline_math_ok("$$a+b$$", "a+b", None));
    }

    #[test]
    fn formulas_render_to_svg_with_a_baseline_inside_their_box() {
        let (svg, w, h, base) = math_svg(r"\frac{a}{b} + \sqrt{x^2} \sum_{n=1}^\infty \mathbb{R}", false, 0xc6c6c6ff, 16.0).unwrap();
        assert!(svg.starts_with("<svg") && svg.contains("<path"), "glyphs are outlines: {}", &svg[..svg.len().min(200)]);
        assert!(w > 50.0 && h > 16.0 && base > 0.0 && base < h);
        for tex in [r"\begin{pmatrix}a&b\\c&d\end{pmatrix}", r"f(x)=\begin{cases}1&x>0\\0&\text{else}\end{cases}", r"\ce{H2O}", r"\vec{E}\cdot\nabla"] {
            assert!(math_svg(tex, true, 0xffffffff, 16.0).is_ok(), "{tex}");
        }
        assert!(math_svg(r"\frac{a}{b", true, 0xffffffff, 16.0).is_err());
    }

    #[test]
    fn diagrams_render_in_the_theme_and_errors_say_so() {
        let mut p = Palette::default();
        p.colors.insert("foreground".into(), "#c6c6c6".into());
        p.colors.insert("ansi8".into(), "#949494".into());
        let (svg, w, h) = diagram_svg("flowchart LR\n  A[Editor] --> B(Preview)\n", &p).unwrap();
        assert!(svg.contains("Editor") && svg.contains("#c6c6c6"));
        assert!(w > 50.0 && h > 20.0);
        let (seq, _, _) = diagram_svg("sequenceDiagram\n  A->>B: hi\n", &p).unwrap();
        assert!(seq.contains("hi"));
        assert!(diagram_svg("this is not mermaid", &p).is_err());
    }

    #[test]
    fn svg_sizes_come_from_the_root_element() {
        assert_eq!(svg_size(r#"<svg xmlns="x" width="649.5" height="169" viewBox="0 0 1 1"><rect width="3" height="4"/></svg>"#), Some((649.5, 169.0)));
        assert_eq!(svg_size("<svg viewBox='0 0 1 1'></svg>"), None);
    }

    #[test]
    fn code_blocks_color_by_capture_with_root_fallback() {
        let colors: HashMap<&'static str, Hsla> = HashMap::from([("keyword", gpui::red()), ("string", gpui::green())]);
        let runs = code_styles("fn main() { let s = \"hi\"; }", "rs", &colors);
        assert!(runs.iter().any(|(r, s)| r == &(0..2) && s.color == Some(gpui::red())));
        assert!(runs.iter().any(|(_, s)| s.color == Some(gpui::green())));
        assert!(code_styles("x", "no-such-language", &colors).is_empty());
    }
}
