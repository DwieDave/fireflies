//! The app's shared world, the same for every layout: spaces, each with
//! tabs (named pieces of work), each tab holding its terminals and
//! how they're split. Plus which pane has focus and agent attention (done vs
//! seen) with Fireflies' rollup. Pure data; the window drives it.

use crate::layout::{Axis, Content, Edge, Node};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};

/// A named piece of work in a space: its terminals and how they're split.
#[derive(Clone, Debug)]
pub struct Tab {
    pub id: String,
    pub name: String,
    /// The arrangement: a row/column tree of terminal blocks. Its id is the tab's.
    pub root: Node,
    pub focused: Option<String>,
    /// Panes focused before, most recent last: closing the focused pane goes back.
    pub before: Vec<String>,
    pub zoomed: Option<String>,
    /// Panes whose terminal text is bigger or smaller than the app's
    /// (`pane.font_bigger`): its multiplier on `settings::font_size()`.
    pub font_zoom: BTreeMap<String, f32>,
    /// Put away (ms since the epoch): out of the lists, still running. Comes
    /// back when it's shown or one of its agents needs the person.
    pub settled: Option<u64>,
    /// Fields of its document entry this build doesn't read (a newer build's),
    /// written back as they were.
    pub rest: serde_json::Map<String, serde_json::Value>,
    /// Panes parked in the tab's bottom row (`pane.park`), in the row's
    /// order: out of the arrangement, still running.
    pub parked: Vec<Parked>,
}

/// A pane parked in its tab's bottom row: out of the arrangement (its
/// terminal keeps running), back in place with `pane.unpark`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Parked {
    pub pane: Node,
    /// What it sat beside when parked, and on which side of it: where it goes back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    #[serde(default)]
    pub side: Edge,
}

/// A place to work, plus the folder its new terminals start in.
#[derive(Clone, Debug)]
pub struct Space {
    pub id: String,
    /// The name someone gave it; empty: named after where its first
    /// terminal is (Fireflies' way, `Model::space_name`).
    pub name: String,
    pub folder: String,
    /// `folder` was chosen (space.new folder, space.folder): the space's repo is
    /// there. Otherwise it is only where the space was made, and the space goes
    /// by where its terminals are now.
    pub attached: bool,
    /// The machine its terminals run on (`hc machine ls`); None: this one.
    pub machine: Option<String>,
    pub tabs: Vec<Tab>,
    /// The selected tab.
    pub active: Option<String>,
    /// Fields of its document entry this build doesn't read (a newer build's),
    /// written back as they were.
    pub rest: serde_json::Map<String, serde_json::Value>,
}

/// A closed space, so opening it again doesn't ask for its name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Recent {
    pub name: String,
    pub folder: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Alert {
    /// Needs the person (blocked or error).
    Blocked,
    /// Finished while the person wasn't looking.
    Done,
}

/// What core and the user's attention say about one terminal.
#[derive(Clone, Debug, Default)]
pub struct Agent {
    /// The program's 7501 word (working, idle, done, blocked, error), if it reports.
    pub word: Option<String>,
    /// The agent's name from its 7501 report (`app`), e.g. "claude-code".
    pub app: Option<String>,
    /// Whether the person has seen it since it last stopped working.
    pub seen: bool,
    /// Core's turn counter: goes up each time it stops working.
    pub turn: u64,
    /// The last turn a person looked at on any client (`herdr.seen`, docs/labels.md).
    /// None: no client shares it yet, so `seen` decides.
    pub seen_turn: Option<u64>,
    /// Bumped on every state change (for "most recent" ordering).
    pub seq: u64,
    /// When the state last changed, ms since the epoch (0: not since the app started).
    pub since: u64,
    /// The 7501 report's message (what it's doing now), if any.
    pub msg: Option<String>,
    /// When its current step began: the word or the message last changed, ms.
    pub step: u64,
    /// Working, and the step is a shell command still running (`agent_command`).
    pub command: bool,
}

#[derive(Default)]
pub struct Model {
    pub spaces: Vec<Space>,
    /// The selected space.
    pub active: Option<String>,
    pub recent: Vec<Recent>,
    /// Each pane's live folder, for its display name.
    pub pane_folders: BTreeMap<String, String>,
    pub agents: HashMap<String, Agent>,
    seq: u64,
    /// Where each terminal works now: its repo (worktrees included) and branch.
    pub folder_info: HashMap<String, FolderInfo>,
}

/// Where `pane.move` takes a pane (`Model::move_to_tab`).
#[derive(Clone, Debug, PartialEq)]
pub enum MoveInto {
    /// Into an existing tab: beside `target` on `edge`, else beside its focused pane.
    Tab { tab: String, target: Option<String>, edge: Option<Edge> },
    /// As the only pane of a new tab (`tab`, its id) in `space`.
    New { space: String, tab: String, name: String },
}

/// Where a split puts the new pane beside its target (`pane.split {direction}`,
/// `terminal.open {place}`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Right,
    Down,
    Left,
    Up,
    /// Across the target's parent: below panes side by side, right of stacked ones.
    Auto,
}

impl Direction {
    pub fn parse(s: &str) -> Option<Direction> {
        Some(match s {
            "right" => Direction::Right,
            "down" => Direction::Down,
            "left" => Direction::Left,
            "up" => Direction::Up,
            "auto" => Direction::Auto,
            _ => return None,
        })
    }
}

/// Fireflies' attention priority: blocked > done > working > idle > nothing.
pub fn priority(status: Option<&str>) -> u8 {
    match status {
        Some("blocked") => 4,
        Some("done") => 3,
        Some("working") => 2,
        Some("idle") => 1,
        _ => 0,
    }
}

impl Tab {
    /// A tab with one terminal pane.
    pub fn new(id: &str, name: &str, pane_id: &str, address: &str) -> Tab {
        Tab::with_pane(id, name, pane(pane_id, address))
    }

    /// A tab with one pane (a terminal or a mod).
    pub fn with_pane(id: &str, name: &str, pane: Node) -> Tab {
        Tab {
            id: id.to_owned(),
            name: name.to_owned(),
            focused: Some(pane.id.clone()),
            before: Vec::new(),
            root: Node::container(id, Axis::Row, vec![pane]),
            zoomed: None,
            font_zoom: BTreeMap::new(),
            settled: None,
            rest: Default::default(),
            parked: Vec::new(),
        }
    }

    /// Every terminal the tab holds: its arrangement's, then its parked ones.
    pub fn addresses(&self) -> Vec<String> {
        let mut out = addresses(&self.root);
        out.extend(self.parked.iter().filter_map(|p| p.pane.terminal().map(str::to_owned)));
        out
    }

    /// Where a parked pane sits in the bottom row.
    pub fn parked_index(&self, pane: &str) -> Option<usize> {
        self.parked.iter().position(|p| p.pane.id == pane)
    }

    /// After `pane` left the arrangement: focus goes back to the pane focused
    /// before it that's still here, else the first.
    fn refocus_without(&mut self, pane: &str) {
        let here: Vec<String> = self.root.panes().iter().map(|n| n.id.clone()).collect();
        self.before.retain(|p| p != pane && here.contains(p));
        if self.focused.as_deref() == Some(pane) || self.focused.is_none() {
            self.focused = self.before.pop().or_else(|| here.first().cloned());
        }
    }

    /// Focuses a pane and remembers the one it leaves. A zoomed tab shows the
    /// pane it focuses, never a hidden one.
    pub fn focus(&mut self, pane: &str) {
        if self.zoomed.is_some() {
            self.zoomed = Some(pane.to_owned());
        }
        if let Some(old) = self.focused.take().filter(|o| o != pane) {
            self.before.retain(|p| *p != old && p != pane);
            self.before.push(old);
            if self.before.len() > 32 {
                self.before.remove(0);
            }
        }
        self.focused = Some(pane.to_owned());
    }

    /// The focused pane, else the first one.
    pub fn focused_pane(&self) -> Option<String> {
        self.focused.clone().filter(|p| self.root.find(p).is_some()).or_else(|| self.root.panes().first().map(|n| n.id.clone()))
    }

    /// What's drawn: only the zoomed pane when one is zoomed.
    pub fn shown(&self) -> &Node {
        self.zoomed.as_deref().and_then(|z| self.root.find(z)).unwrap_or(&self.root)
    }
}

impl Space {
    pub fn tab(&self, id: &str) -> Option<&Tab> {
        self.tabs.iter().find(|c| c.id == id)
    }

    /// The selected tab, else the first.
    pub fn active_tab(&self) -> Option<&Tab> {
        self.active.as_deref().and_then(|a| self.tab(a)).or(self.tabs.first())
    }

    fn select(&mut self, ctx: &str) {
        if self.tab(ctx).is_some() {
            self.active = Some(ctx.to_owned());
        }
    }
}

impl Model {
    pub fn fresh_id(&mut self, prefix: &str) -> String {
        use std::hash::{BuildHasher, Hasher};
        let random = || std::collections::hash_map::RandomState::new().build_hasher().finish();
        format!("{prefix}{:016x}{:016x}", random(), random())
    }

    pub fn fresh_id_on(&mut self, prefix: &str, machine: Option<&str>) -> String {
        crate::mirror::qualify(&self.fresh_id(prefix), machine)
    }

    /// Machine blocks have one order on every screen; order inside each stays shared.
    pub fn order_spaces(&mut self) {
        self.spaces.sort_by(|a, b| a.machine.cmp(&b.machine));
    }

    pub fn move_space(&mut self, id: &str, index: usize) -> bool {
        self.order_spaces();
        let Some(from) = self.spaces.iter().position(|s| s.id == id) else { return false };
        let machine = self.spaces[from].machine.clone();
        let first = self.spaces.iter().position(|s| s.machine == machine).unwrap();
        let last = self.spaces.iter().rposition(|s| s.machine == machine).unwrap();
        let to = index.saturating_sub(1).clamp(first, last);
        let space = self.spaces.remove(from);
        self.spaces.insert(to, space);
        true
    }

    pub fn active_index(&self) -> Option<usize> {
        let id = self.active.as_deref()?;
        self.spaces.iter().position(|p| p.id == id).or((!self.spaces.is_empty()).then_some(0))
    }

    pub fn active_space(&self) -> Option<&Space> {
        self.active_index().map(|i| &self.spaces[i])
    }

    pub fn active_tab(&self) -> Option<&Tab> {
        self.active_space()?.active_tab()
    }

    pub fn space(&self, id: &str) -> Option<&Space> {
        self.spaces.iter().find(|p| p.id == id)
    }

    pub fn space_mut(&mut self, id: &str) -> Option<&mut Space> {
        self.spaces.iter_mut().find(|p| p.id == id)
    }

    pub fn tabs(&self) -> impl Iterator<Item = &Tab> {
        self.spaces.iter().flat_map(|p| p.tabs.iter())
    }

    pub fn tab(&self, id: &str) -> Option<&Tab> {
        self.tabs().find(|c| c.id == id)
    }

    pub fn tab_mut(&mut self, id: &str) -> Option<&mut Tab> {
        self.spaces.iter_mut().flat_map(|p| p.tabs.iter_mut()).find(|c| c.id == id)
    }

    /// The space holding a tab or a node inside one.
    pub fn space_of(&self, node: &str) -> Option<&Space> {
        self.spaces.iter().find(|p| p.tabs.iter().any(|c| c.id == node || c.root.find(node).is_some() || c.parked_index(node).is_some()))
    }

    /// The tab holding a pane, placed or parked.
    pub fn tab_holding(&self, pane: &str) -> Option<&Tab> {
        self.tabs().find(|c| c.root.find(pane).is_some() || c.parked_index(pane).is_some())
    }

    /// The tab a pane is parked in.
    pub fn parked_tab_of(&self, pane: &str) -> Option<&Tab> {
        self.tabs().find(|c| c.parked_index(pane).is_some())
    }

    fn parked_tab_of_mut(&mut self, pane: &str) -> Option<&mut Tab> {
        self.spaces.iter_mut().flat_map(|p| p.tabs.iter_mut()).find(|c| c.parked_index(pane).is_some())
    }

    /// The tab holding a node (pane, container).
    pub fn tab_of(&self, node: &str) -> Option<&Tab> {
        self.tabs().find(|c| c.root.find(node).is_some())
    }

    fn tab_of_mut(&mut self, node: &str) -> Option<&mut Tab> {
        self.spaces.iter_mut().flat_map(|p| p.tabs.iter_mut()).find(|c| c.root.find(node).is_some())
    }

    /// Adds a space at the end and selects it.
    /// What a space is called: its name, else its first terminal's checkout
    /// (a worktree's own folder; outside git its folder), as Fireflies names workspaces.
    pub fn space_name(&self, p: &Space, home: &str) -> String {
        if !p.name.is_empty() {
            return p.name.clone();
        }
        let first = p.tabs.iter().flat_map(|c| c.root.terminals()).next();
        let folder = first
            .and_then(|n| n.terminal().and_then(|a| self.folder_info.get(a)).map(|f| f.top.clone()).or_else(|| self.pane_folders.get(&n.id).cloned()))
            .unwrap_or_else(|| p.folder.clone());
        folder_name(&folder, home)
    }

    /// What a tab is called: its name, else its place in its space (1, 2, ...).
    pub fn tab_name(p: &Space, c: &Tab) -> String {
        if !c.name.is_empty() {
            return c.name.clone();
        }
        (p.tabs.iter().position(|x| x.id == c.id).unwrap_or(0) + 1).to_string()
    }

    pub fn add_space(&mut self, id: &str, name: &str, folder: &str, ctx: Tab) {
        let active = Some(ctx.id.clone());
        self.spaces.push(Space { id: id.to_owned(), name: name.to_owned(), folder: folder.to_owned(), attached: false, machine: None, tabs: vec![ctx], active, rest: Default::default() });
        self.recent.retain(|r| r.name != name);
        self.active = Some(id.to_owned());
    }

    /// Adds a tab after the space's selected one and selects it (not the space).
    pub fn add_tab(&mut self, space: &str, ctx: Tab) -> bool {
        let Some(p) = self.space_mut(space) else { return false };
        let at = p.active.as_deref().and_then(|a| p.tabs.iter().position(|c| c.id == a)).map_or(p.tabs.len(), |i| i + 1);
        let id = ctx.id.clone();
        p.tabs.insert(at, ctx);
        p.active = Some(id);
        true
    }

    /// Splits `target` (a pane) with a new terminal pane and focuses it.
    pub fn split(&mut self, target: &str, axis: Axis, new_pane: &str, address: &str) -> bool {
        self.split_with(target, axis, pane(new_pane, address))
    }

    /// Splits a pane with any block: a terminal, or a mod (a viewer beside the shell).
    pub fn split_with(&mut self, target: &str, axis: Axis, block: Node) -> bool {
        self.split_at(target, axis, false, block)
    }

    /// Splits a pane toward a direction (`pane.split {direction}`).
    pub fn split_toward(&mut self, target: &str, dir: Direction, block: Node) -> bool {
        let (axis, before) = self.split_side(target, dir);
        self.split_at(target, axis, before, block)
    }

    /// Which way a split of `target` toward `dir` runs, and whether the new
    /// pane goes before it. `Auto` alternates with the target's parent: beside
    /// panes side by side it goes below, below panes stacked it goes right; a
    /// lone pane gets a neighbor on the right.
    pub fn split_side(&self, target: &str, dir: Direction) -> (Axis, bool) {
        match dir {
            Direction::Right => (Axis::Row, false),
            Direction::Down => (Axis::Column, false),
            Direction::Left => (Axis::Row, true),
            Direction::Up => (Axis::Column, true),
            Direction::Auto => {
                let parent = self.tab_of(target).and_then(|c| c.root.parent_of(target)).filter(|p| p.children().len() > 1);
                match parent.and_then(Node::axis) {
                    Some(Axis::Row) => (Axis::Column, false),
                    _ => (Axis::Row, false),
                }
            }
        }
    }

    fn split_at(&mut self, target: &str, axis: Axis, before: bool, block: Node) -> bool {
        let machine = self.space_of(target).and_then(|s| s.machine.clone());
        let container = self.fresh_id_on("s", machine.as_deref());
        let new_pane = block.id.clone();
        let Some(c) = self.tab_of_mut(target) else { return false };
        if !c.root.split_at(target, axis, before, block, container) {
            return false;
        }
        c.zoomed = None;
        c.focus(&new_pane);
        true
    }

    /// Adds a pane along one edge of a whole tab (`pane.split {edge}`),
    /// spanning it, and focuses it; a `px` size on `block` stays fixed.
    pub fn split_edge(&mut self, tab: &str, edge: Edge, block: Node) -> bool {
        let machine = self.space_of(tab).and_then(|s| s.machine.clone());
        let container = self.fresh_id_on("s", machine.as_deref());
        let new_pane = block.id.clone();
        let Some(c) = self.tab_mut(tab) else { return false };
        if !c.root.add_at_edge(edge, block, container) {
            return false;
        }
        c.zoomed = None;
        c.focus(&new_pane);
        true
    }

    /// Rearranges existing panes in one tab without changing their terminal addresses.
    /// No edge swaps their places; an edge places the source beside the target.
    pub fn move_pane(&mut self, source: &str, target: &str, edge: Option<crate::layout::Edge>) -> bool {
        if source == target {
            return false;
        }
        let Some(tab) = self.tab_of(source) else { return false };
        if !tab.root.find(source).is_some_and(Node::is_pane) || !tab.root.find(target).is_some_and(Node::is_pane) {
            return false;
        }
        let mut root = tab.root.clone();
        if let Some(edge) = edge {
            let mut pane = root.remove(source).unwrap();
            pane.size = None;
            let axis = if matches!(edge, Edge::Left | Edge::Right) { Axis::Row } else { Axis::Column };
            let machine = self.space_of(source).and_then(|s| s.machine.clone());
            let container = self.fresh_id_on("s", machine.as_deref());
            if !root.split(target, axis, pane, container) {
                return false;
            }
            if matches!(edge, Edge::Left | Edge::Top) {
                root.swap(source, target);
            }
        } else if !root.swap(source, target) {
            return false;
        }
        let tab = self.tab_of_mut(source).unwrap();
        tab.root = root;
        tab.focus(source);
        true
    }

    /// Moves a pane (placed or parked; a terminal or a mod) out of its tab into
    /// another one, keeping its id and terminal, and focuses it there. `into`:
    /// beside `target` (a pane of that tab) on `edge`, else beside the tab's
    /// focused pane (as `pane.split` auto); `New`: as the only pane of a new
    /// tab in a space. The tab it leaves closes when it was its last pane (and
    /// its space when that was the last tab). Returns the tab it landed in.
    pub fn move_to_tab(&mut self, pane_id: &str, into: MoveInto) -> Result<String, String> {
        let from = self.tab_holding(pane_id).ok_or_else(|| format!("no pane {pane_id:?}"))?;
        let from_id = from.id.clone();
        let mut node = from.root.find(pane_id).filter(|n| n.is_pane()).cloned()
            .or_else(|| from.parked.iter().find(|p| p.pane.id == pane_id).map(|p| p.pane.clone()))
            .ok_or_else(|| format!("{pane_id:?} is not a pane"))?;
        let from_machine = self.space_of(&from_id).and_then(|s| s.machine.clone());
        node.size = None;
        let zoom = from.font_zoom.get(pane_id).copied();
        match &into {
            MoveInto::Tab { tab, target, .. } => {
                if *tab == from_id {
                    return Err("the pane is in that tab already (pane.swap or a drag moves it inside its tab)".into());
                }
                let dest = self.tab(tab).ok_or_else(|| format!("no tab {tab:?}"))?;
                if let Some(t) = target && !dest.root.find(t).is_some_and(Node::is_pane) {
                    return Err(format!("target {t:?} is not a placed pane of tab {tab:?}"));
                }
                if self.space_of(tab).and_then(|s| s.machine.clone()) != from_machine {
                    return Err("A terminal's pane must stay on its own machine.".into());
                }
            }
            MoveInto::New { space, .. } => {
                let s = self.space(space).ok_or_else(|| format!("no space {space:?}"))?;
                if s.machine != from_machine {
                    return Err("A terminal's pane must stay on its own machine.".into());
                }
                if from.root.panes().len() + from.parked.len() == 1 && self.space_of(&from_id).is_some_and(|s| s.id == *space) {
                    return Err("the pane is its tab's only one already".into());
                }
            }
        }
        // Out of its tab, as a close would (focus goes back, a parked pane
        // fills an empty arrangement, an empty tab closes), but nothing ends.
        self.remove_pane(pane_id);
        let landed = match into {
            MoveInto::Tab { tab, target, edge } => {
                let target = target.or_else(|| {
                    let t = self.tab(&tab)?;
                    t.focused.clone().filter(|f| t.root.find(f).is_some_and(Node::is_pane)).or_else(|| t.root.panes().first().map(|p| p.id.clone()))
                });
                let placed = match (target, edge) {
                    (Some(target), Some(edge)) => {
                        let axis = if matches!(edge, Edge::Left | Edge::Right) { Axis::Row } else { Axis::Column };
                        self.split_at(&target, axis, matches!(edge, Edge::Left | Edge::Top), node)
                    }
                    (Some(target), None) => self.split_toward(&target, Direction::Auto, node),
                    // A tab of parked panes only can't be: it keeps one in place.
                    (None, _) => false,
                };
                if !placed {
                    return Err(format!("could not place the pane in tab {tab:?}"));
                }
                tab
            }
            MoveInto::New { space, tab, name } => {
                // The space may have closed with the pane's old tab: none to add to.
                if self.space(&space).is_none() {
                    return Err(format!("no space {space:?}"));
                }
                self.add_tab(&space, Tab::with_pane(&tab, &name, node));
                tab
            }
        };
        if let Some(z) = zoom && let Some(t) = self.tab_mut(&landed) {
            t.font_zoom.insert(pane_id.to_owned(), z);
        }
        self.focus_pane(pane_id);
        Ok(landed)
    }

    pub fn swap_panes(&mut self, pane: &str, target: &str) -> Result<(), String> {
        let is_pane = |m: &Model, id: &str| m.tab_of(id).and_then(|c| c.root.find(id)).is_some_and(Node::is_pane);
        if !is_pane(self, pane) {
            return Err(format!("no pane {pane:?}"));
        }
        if !is_pane(self, target) {
            return Err(format!("no target pane {target:?}"));
        }
        if pane == target {
            return Err("pane.swap target is the pane itself".into());
        }
        let Some(c) = self.tab_of_mut(pane) else { return Err(format!("no pane {pane:?}")) };
        if c.root.find(target).is_none() {
            return Err(format!("pane.swap target {target:?} is in another tab"));
        }
        c.root.swap(pane, target);
        Ok(())
    }

    /// `pane.equalize`: even shares in `pane`'s tab (all, or its row or column).
    pub fn equalize(&mut self, pane: &str, scope: crate::equalize::Scope) -> Result<bool, String> {
        let Some(c) = self.tab_of_mut(pane) else { return Err(format!("no pane {pane:?}")) };
        c.root.equalize(pane, scope).ok_or_else(|| {
            let axis = if scope == crate::equalize::Scope::Row { "row (no panes side by side)" } else { "column (no panes stacked)" };
            format!("pane {pane:?} is in no {axis}")
        })
    }

    /// `pane.resize`: moves `pane`'s divider one `step` toward `dir`
    /// (crate::pane_resize). A zoomed tab shows one pane: nothing moves.
    pub fn resize_pane(&mut self, pane: &str, dir: crate::pane_resize::Direction, step: f32, length: impl Fn(&str) -> Option<f32>) -> Result<bool, String> {
        let Some(c) = self.tab_of_mut(pane).filter(|c| c.root.find(pane).is_some_and(Node::is_pane)) else { return Err(format!("no pane {pane:?}")) };
        if c.zoomed.is_some() {
            return Ok(false);
        }
        crate::pane_resize::resize(&mut c.root, pane, dir, step, length)
    }

    /// Removes a pane. Returns what else closed: the tab, and the space if it was its last.
    pub fn remove_pane(&mut self, pane_id: &str) -> (bool, bool) {
        if let Some(c) = self.parked_tab_of_mut(pane_id) {
            c.parked.retain(|p| p.pane.id != pane_id);
            c.font_zoom.remove(pane_id);
            return (false, false);
        }
        let Some(c) = self.tab_of_mut(pane_id) else { return (false, false) };
        c.root.remove(pane_id);
        if c.zoomed.as_deref() == Some(pane_id) {
            c.zoomed = None;
        }
        c.font_zoom.remove(pane_id);
        // The arrangement's last pane gone: the first parked one takes its place.
        if c.root.panes().is_empty() && !c.parked.is_empty() {
            let mut back = c.parked.remove(0).pane;
            back.size = None;
            if let Some(children) = c.root.children_mut() {
                children.clear();
                children.push(back);
            }
        }
        if !c.root.panes().is_empty() {
            c.before.retain(|p| p != pane_id);
            if c.focused.as_deref() == Some(pane_id) {
                // Back to the pane focused before it that's still here, else the first.
                let here: Vec<String> = c.root.panes().iter().map(|n| n.id.clone()).collect();
                c.before.retain(|p| here.contains(p));
                c.focused = c.before.pop().or_else(|| here.first().cloned());
            }
            return (false, false);
        }
        let id = c.id.clone();
        let (_, space_closed) = self.remove_tab(&id);
        (true, space_closed)
    }

    /// Removes a tab. Returns its terminal addresses and whether its space closed.
    pub fn remove_tab(&mut self, ctx: &str) -> (Vec<String>, bool) {
        let Some(pi) = self.spaces.iter().position(|p| p.tab(ctx).is_some()) else { return (vec![], false) };
        let p = &mut self.spaces[pi];
        let ci = p.tabs.iter().position(|c| c.id == ctx).unwrap();
        let removed = p.tabs.remove(ci);
        if p.active.as_deref() == Some(ctx) {
            // The tab that slides into the slot, or the last one.
            p.active = p.tabs.get(ci).or(p.tabs.last()).map(|c| c.id.clone());
        }
        let closed = p.tabs.is_empty();
        if closed {
            let id = p.id.clone();
            self.remove_space(&id);
        }
        (removed.addresses(), closed)
    }

    /// Removes a space (remembered in `recent`). Returns its terminal addresses.
    pub fn remove_space(&mut self, id: &str) -> Vec<String> {
        let Some(pi) = self.spaces.iter().position(|p| p.id == id) else { return vec![] };
        let was_active = self.active_index() == Some(pi);
        let p = self.spaces.remove(pi);
        self.recent.retain(|r| r.name != p.name);
        self.recent.insert(0, Recent { name: p.name.clone(), folder: p.folder.clone() });
        self.recent.truncate(20);
        if was_active {
            self.active = self.spaces.get(pi).or(self.spaces.last()).map(|p| p.id.clone());
        }
        p.tabs.iter().flat_map(Tab::addresses).collect()
    }

    /// The focused pane of the selected space's selected tab.
    pub fn focused_pane(&self) -> Option<String> {
        self.active_tab()?.focused_pane()
    }

    /// Selects a tab and its space. Shown again, a settled tab is back.
    pub fn select_tab(&mut self, ctx: &str) -> bool {
        let Some(p) = self.spaces.iter_mut().find(|p| p.tab(ctx).is_some()) else { return false };
        p.select(ctx);
        self.active = Some(p.id.clone());
        self.unsettle(ctx);
        true
    }

    /// Puts a tab away. The shown one hands over to the next unsettled
    /// tab of its space, if there is one.
    pub fn settle(&mut self, ctx: &str, now: u64) -> bool {
        let Some(c) = self.tab_mut(ctx) else { return false };
        c.settled = Some(now);
        let Some(p) = self.spaces.iter_mut().find(|p| p.tab(ctx).is_some()) else { return true };
        if p.active_tab().is_some_and(|c| c.id == ctx) {
            let i = p.tabs.iter().position(|c| c.id == ctx).unwrap_or(0);
            let n = p.tabs.len();
            if let Some(next) = (1..n).map(|k| &p.tabs[(i + k) % n]).find(|c| c.settled.is_none()) {
                p.active = Some(next.id.clone());
            }
        }
        true
    }

    pub fn unsettle(&mut self, ctx: &str) -> bool {
        self.tab_mut(ctx).is_some_and(|c| c.settled.take().is_some())
    }

    /// Focuses a pane anywhere: selects its space and tab.
    pub fn focus_pane(&mut self, pane_id: &str) -> bool {
        // Focusing a parked pane brings it back.
        if self.parked_tab_of(pane_id).is_some() && self.unpark_pane(pane_id, None).is_err() {
            return false;
        }
        let Some(c) = self.tab_of_mut(pane_id) else { return false };
        c.focus(pane_id);
        let ctx = c.id.clone();
        self.select_tab(&ctx)
    }

    /// The address shown in a pane block (placed or parked).
    pub fn address_of(&self, pane_id: &str) -> Option<String> {
        self.tabs()
            .find_map(|c| c.root.find(pane_id).or_else(|| c.parked.iter().map(|p| &p.pane).find(|p| p.id == pane_id)))
            .and_then(|n| n.terminal())
            .map(str::to_owned)
    }

    /// The pane holding a terminal, placed or parked.
    pub fn pane_of(&self, address: &str) -> Option<String> {
        self.placed_pane_of(address).or_else(|| {
            self.tabs().flat_map(|c| &c.parked).find(|p| p.pane.terminal() == Some(address)).map(|p| p.pane.id.clone())
        })
    }

    /// The pane showing a terminal in its tab's arrangement (not parked).
    pub fn placed_pane_of(&self, address: &str) -> Option<String> {
        self.tabs().flat_map(|c| c.root.terminals()).find(|n| n.terminal() == Some(address)).map(|n| n.id.clone())
    }

    /// Every terminal in every tab, in space → tab → pane order (parked ones last in their tab).
    pub fn all_addresses(&self) -> Vec<String> {
        self.tabs().flat_map(Tab::addresses).collect()
    }

    /// Parks a pane in its tab's bottom row (at `index`, default the end), or
    /// moves a parked one there. A tab keeps one pane in its arrangement.
    pub fn park_pane(&mut self, pane: &str, index: Option<usize>) -> Result<(), String> {
        if let Some(c) = self.parked_tab_of_mut(pane) {
            let i = c.parked_index(pane).unwrap();
            let p = c.parked.remove(i);
            let at = index.unwrap_or(c.parked.len()).min(c.parked.len());
            c.parked.insert(at, p);
            return Ok(());
        }
        let c = self.tab_of_mut(pane).ok_or_else(|| format!("no pane {pane:?}"))?;
        if !c.root.find(pane).is_some_and(Node::is_pane) {
            return Err(format!("{pane:?} is not a pane"));
        }
        if c.root.panes().len() < 2 {
            return Err("A tab keeps one pane in place: split it first, or float the pane (pane.float).".into());
        }
        let (near, side) = park_spot(&c.root, pane);
        let mut node = c.root.remove(pane).unwrap();
        node.size = None;
        if c.zoomed.as_deref() == Some(pane) {
            c.zoomed = None;
        }
        c.refocus_without(pane);
        let at = index.unwrap_or(c.parked.len()).min(c.parked.len());
        c.parked.insert(at, Parked { pane: node, near, side });
        Ok(())
    }

    /// Puts a parked pane back into its tab and focuses it: beside `to` (a
    /// pane of that tab) on `edge`, or in its place with no edge (`to` is
    /// parked in its stead), or by default where it was parked from.
    pub fn unpark_pane(&mut self, pane: &str, to: Option<(&str, Option<Edge>)>) -> Result<(), String> {
        let machine = self.space_of(pane).and_then(|s| s.machine.clone());
        let container = self.fresh_id_on("s", machine.as_deref());
        let c = self.parked_tab_of_mut(pane).ok_or_else(|| format!("no parked pane {pane:?}"))?;
        if let Some((target, _)) = to
            && !c.root.find(target).is_some_and(Node::is_pane)
        {
            return Err(format!("no pane {target:?} in the parked pane's tab"));
        }
        let i = c.parked_index(pane).unwrap();
        let parked = c.parked.remove(i);
        let mut node = parked.pane.clone();
        node.size = None;
        match to {
            Some((target, None)) => {
                // In the target's place; the target takes the parked one's spot in the row.
                let slot = c.root.find_mut(target).unwrap();
                node.size = slot.size.take();
                let mut out = std::mem::replace(slot, node);
                out.size = None;
                c.parked.insert(i, Parked { pane: out, near: Some(pane.to_owned()), side: Edge::Right });
                if c.zoomed.as_deref() == Some(target) {
                    c.zoomed = None;
                }
                c.before.retain(|p| p != target);
                if c.focused.as_deref() == Some(target) {
                    c.focused = None;
                }
            }
            _ => {
                let (target, side) = match to {
                    Some((t, Some(e))) => (t.to_owned(), e),
                    _ => {
                        let near = parked.near.clone().filter(|n| *n != c.root.id && c.root.find(n).is_some());
                        let fallback = || c.focused_pane().unwrap_or_else(|| c.root.id.clone());
                        (near.unwrap_or_else(fallback), parked.side)
                    }
                };
                let axis = if side.vertical() { Axis::Row } else { Axis::Column };
                let before = matches!(side, Edge::Left | Edge::Top);
                if target == c.root.id {
                    // An empty arrangement: just put it back.
                    if let Some(children) = c.root.children_mut() {
                        children.push(node);
                    }
                } else if !c.root.split_at(&target, axis, before, node, container) {
                    c.parked.insert(i, parked);
                    return Err(format!("cannot put {pane:?} back beside {target:?}"));
                }
            }
        }
        c.zoomed = None;
        c.focus(pane);
        Ok(())
    }

    /// Applies a status word from core (Fireflies' seen rules).
    pub fn set_word(&mut self, address: &str, word: Option<String>, app: Option<String>, looking: bool) -> bool {
        let a = self.agents.entry(address.to_owned()).or_insert_with(|| Agent { seen: true, ..Default::default() });
        a.app = app.or(a.app.take());
        if a.word == word {
            return false;
        }
        let was_busy = matches!(a.word.as_deref(), Some("working" | "blocked"));
        match word.as_deref() {
            Some("working" | "blocked") => a.seen = true,
            // A finish you didn't watch is "done" until you look at it.
            Some(_) if was_busy => a.seen = looking,
            _ => {}
        }
        a.word = word;
        self.seq += 1;
        a.seq = self.seq;
        a.since = now_ms();
        a.step = a.since;
        true
    }

    /// A new 7501 message starts a new step (see `Agent::step`).
    pub fn set_msg(&mut self, address: &str, msg: Option<String>) {
        let Some(a) = self.agents.get_mut(address) else { return };
        if a.msg != msg {
            a.msg = msg;
            a.step = now_ms();
        }
    }

    /// Whether the agent waits on a command now; true if that changed.
    pub fn set_command(&mut self, address: &str, command: bool) -> bool {
        let Some(a) = self.agents.get_mut(address) else { return false };
        let command = command && a.word.as_deref() == Some("working");
        std::mem::replace(&mut a.command, command) != command
    }

    /// Fireflies' attention rule for a change of 7501 word: needing you always
    /// alerts; finishing alerts only if the person wasn't looking.
    pub fn alert(prev: Option<&str>, new: Option<&str>, looking: bool) -> Option<Alert> {
        let blocked = |w: Option<&str>| matches!(w, Some("blocked" | "error"));
        let busy = |w: Option<&str>| matches!(w, Some("working" | "blocked" | "error"));
        if blocked(new) && !blocked(prev) {
            Some(Alert::Blocked)
        } else if busy(prev) && new.is_some() && !busy(new) && !looking {
            Some(Alert::Done)
        } else {
            None
        }
    }

    /// `alert` for one terminal: only ours ring. A sub-agent reports to its
    /// parent; a terminal in none of the spaces (another machine's, another
    /// app's) isn't the person's business here.
    pub fn alert_for(&self, addr: &str, sub_agent: bool, prev: Option<&str>, new: Option<&str>, looking: bool) -> Option<Alert> {
        if sub_agent || self.pane_of(addr).is_none() {
            return None;
        }
        Self::alert(prev, new, looking)
    }

    /// Marks what the person is looking at as seen.
    pub fn mark_seen(&mut self, addresses: &[String]) -> bool {
        let mut changed = false;
        for addr in addresses {
            if let Some(a) = self.agents.get_mut(addr)
                && !a.seen
            {
                a.seen = true;
                changed = true;
            }
        }
        changed
    }

    /// Core's turn and the shared seen turn for an agent; true when either changed.
    pub fn set_turn(&mut self, address: &str, turn: u64, seen_turn: Option<u64>) -> bool {
        let Some(a) = self.agents.get_mut(address) else { return false };
        let changed = (a.turn, a.seen_turn) != (turn, seen_turn);
        (a.turn, a.seen_turn) = (turn, seen_turn);
        changed
    }

    /// What the UI shows: working, blocked, done (finished, unseen), idle, or None (not an agent).
    pub fn status(&self, address: &str) -> Option<&'static str> {
        let a = self.agents.get(address)?;
        Some(match a.word.as_deref()? {
            "working" => "working",
            "blocked" | "error" => "blocked",
            _ if a.seen_turn.map_or(!a.seen, |s| a.turn > s) => "done",
            _ => "idle",
        })
    }

    /// When something in a tab last changed state, ms (None: nothing since the app started).
    pub fn changed_at(&self, c: &Tab) -> Option<u64> {
        c.addresses().iter().filter_map(|a| self.agents.get(a)).map(|a| a.since).filter(|t| *t > 0).max()
    }

    /// Since when an agent in a tab has been working, ms (the earliest, if several).
    pub fn working_since(&self, c: &Tab) -> Option<u64> {
        c.addresses()
            .iter()
            .filter_map(|a| self.agents.get(a))
            .filter(|a| a.word.as_deref() == Some("working") && a.since > 0)
            .map(|a| a.since)
            .min()
    }

    /// The most urgent status among some terminals.
    pub fn rollup<'a>(&self, addresses: impl IntoIterator<Item = &'a String>) -> Option<&'static str> {
        addresses.into_iter().filter_map(|a| self.status(a)).max_by_key(|s| priority(Some(s)))
    }


}

pub fn pane(id: &str, address: &str) -> Node {
    Node::block(id, Content::Terminal { terminal: address.to_owned() })
}

/// A folder as a name: its last part, `~` for the home folder (`/` and `\` both).
pub fn folder_name(path: &str, home: &str) -> String {
    let full = path;
    let path = path.trim_end_matches(['/', '\\']);
    let home = home.trim_end_matches(['/', '\\']);
    let same = if cfg!(windows) { path.eq_ignore_ascii_case(home) } else { path == home };
    if full.is_empty() || same {
        return "~".into();
    }
    if path.is_empty() {
        return full[..1].to_owned();
    }
    path.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(path).to_owned()
}

/// Terminal addresses in a subtree, in tree order.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Where a pane being parked goes back: the sibling it sat beside, and its
/// side of it (after the one before it, else before the one after it).
fn park_spot(root: &Node, pane: &str) -> (Option<String>, Edge) {
    let Some(parent) = root.parent_of(pane) else { return (None, Edge::Right) };
    let children = parent.children();
    let i = children.iter().position(|n| n.id == pane).unwrap_or(0);
    let column = parent.axis() == Some(Axis::Column);
    let (after, before) = if column { (Edge::Bottom, Edge::Top) } else { (Edge::Right, Edge::Left) };
    match (i.checked_sub(1).and_then(|j| children.get(j)), children.get(i + 1)) {
        (Some(prev), _) => (Some(prev.id.clone()), after),
        (None, Some(next)) => (Some(next.id.clone()), before),
        _ => (None, Edge::Right),
    }
}

pub fn addresses(node: &Node) -> Vec<String> {
    node.terminals().iter().filter_map(|n| n.terminal().map(str::to_owned)).collect()
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FolderInfo {
    /// The checkout's top folder (a worktree's own), else the folder itself.
    pub top: String,
    pub branch: Option<String>,
}

/// A space as mods see it. `name` is what to call it; `named`: someone gave it
/// (else it's Fireflies' automatic name, which a mod may show its own way).
pub fn space_json(m: &Model, p: &Space, index: usize, branch: Option<&str>, home: &str) -> Value {
    let active = p.active_tab().map(|c| c.id.clone());
    let tabs: Vec<Value> = p
        .tabs
        .iter()
        .enumerate()
        .map(|(i, c)| {
            json!({
                "id": c.id,
                "index": i + 1,
                "name": Model::tab_name(p, c),
                "named": !c.name.is_empty(),
                "active": Some(&c.id) == active.as_ref(),
                "status": m.rollup(&c.addresses()),
                "panes": c.root.panes().len(),
                "parked": c.parked.len(),
                "zoomed": c.zoomed.is_some(),
                "settled": c.settled.is_some(),
                "settled_at": c.settled,
                "changed_at": m.changed_at(c),
                "working_since": m.working_since(c),
            })
        })
        .collect();
    let all: Vec<String> = p.tabs.iter().flat_map(Tab::addresses).collect();
    json!({
        "id": p.id,
        "index": index + 1,
        "name": m.space_name(p, home),
        "named": !p.name.is_empty(),
        "folder": p.folder,
        "attached": p.attached,
        "machine": p.machine,
        "branch": branch,
        "active": m.active.as_deref() == Some(&p.id),
        "status": m.rollup(&all),
        "tabs": tabs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_name_as_in_herdr_on_every_system() {
        assert_eq!(folder_name("/home/can", "/home/can"), "~");
        assert_eq!(folder_name("/home/can/", "/home/can"), "~");
        assert_eq!(folder_name("/Users/can/Projects/herdr", "/Users/can"), "herdr");
        assert_eq!(folder_name("/", "/home/can"), "/");
        assert_eq!(folder_name("", "/home/can"), "~");
        assert_eq!(folder_name(r"C:\Users\can\src\api", r"C:\Users\can"), "api");
        assert_eq!(folder_name(r"\\?\C:\Users\can\src\api\", r"C:\Users\can"), "api");
        assert_eq!(folder_name("C:/Users/can/src/web", r"C:\Users\can"), "web");
    }

    #[test]
    fn unnamed_spaces_follow_their_first_terminal_and_tabs_count() {
        let mut m = Model::default();
        m.add_space("p1", "", "/home/me", Tab::new("c1", "", "x1", "t1"));
        m.add_tab("p1", Tab::new("c2", "review", "x2", "t2"));
        m.add_tab("p1", Tab::new("c3", "", "x3", "t3"));
        let p = m.space("p1").unwrap().clone();
        assert_eq!(m.space_name(&p, "/home/me"), "~");
        m.pane_folders.insert("x1".into(), "/src/notes".into());
        assert_eq!(m.space_name(&p, "/home/me"), "notes");
        m.folder_info.insert("t1".into(), FolderInfo { top: "/src/herdr".into(), branch: Some("main".into()) });
        assert_eq!(m.space_name(&p, "/home/me"), "herdr");
        let names: Vec<String> = p.tabs.iter().map(|c| Model::tab_name(&p, c)).collect();
        assert_eq!(names.iter().map(String::as_str).collect::<Vec<_>>(), ["1", "review", "3"]);
        m.space_mut("p1").unwrap().name = "api".into();
        assert_eq!(m.space_name(m.space("p1").unwrap(), "/home/me"), "api");
    }

    #[test]
    fn alerts_follow_herdr() {
        let alert = Model::alert;
        assert_eq!(alert(Some("working"), Some("blocked"), true), Some(Alert::Blocked));
        assert_eq!(alert(Some("blocked"), Some("error"), false), None);
        assert_eq!(alert(Some("working"), Some("idle"), false), Some(Alert::Done));
        assert_eq!(alert(Some("blocked"), Some("done"), false), Some(Alert::Done));
        assert_eq!(alert(Some("working"), Some("idle"), true), None);
        assert_eq!(alert(None, Some("idle"), false), None);
        assert_eq!(alert(Some("working"), None, false), None);
    }

    #[test]
    fn only_our_own_agents_alert() {
        let m = model_with_one();
        // In a space: it rings.
        assert_eq!(m.alert_for("t1", false, Some("working"), Some("done"), false), Some(Alert::Done));
        // Another machine's, or another app's, in none of the spaces: quiet.
        assert_eq!(m.alert_for("vps/t7", false, Some("working"), Some("done"), false), None);
        assert_eq!(m.alert_for("t9", false, Some("working"), Some("blocked"), false), None);
        // A sub-agent reports to its parent, not to the person.
        assert_eq!(m.alert_for("t1", true, Some("working"), Some("blocked"), false), None);
    }

    fn model_with_one() -> Model {
        let mut m = Model::default();
        m.add_space("p1", "api", "/src/api", Tab::new("c1", "fix login", "x1", "t1"));
        m
    }

    #[test]
    fn settling_the_shown_tab_hands_over_and_showing_it_brings_it_back() {
        let mut m = model_with_one();
        m.add_tab("p1", Tab::new("c2", "docs", "x2", "t2"));
        m.select_tab("c1");
        assert!(m.settle("c1", 5));
        assert_eq!(m.active_tab().map(|c| c.id.as_str()), Some("c2"));
        assert_eq!(m.tab("c1").unwrap().settled, Some(5));
        // The last unsettled one stays shown, settled.
        assert!(m.settle("c2", 6));
        assert_eq!(m.active_tab().map(|c| c.id.as_str()), Some("c2"));
        m.select_tab("c1");
        assert_eq!(m.tab("c1").unwrap().settled, None);
    }

    #[test]
    fn closing_the_last_pane_closes_tab_then_space_and_remembers_it() {
        let mut m = model_with_one();
        m.add_tab("p1", Tab::new("c2", "docs", "x2", "t2"));
        m.add_space("p2", "web", "/src/web", Tab::new("c3", "deploy", "x3", "t3"));
        assert_eq!(m.active.as_deref(), Some("p2"));
        assert_eq!(m.remove_pane("x3"), (true, true));
        assert_eq!(m.active.as_deref(), Some("p1"));
        assert_eq!(m.recent, [Recent { name: "web".into(), folder: "/src/web".into() }]);
        // A tab closes with its last pane; the space stays while it has another.
        assert_eq!(m.remove_pane("x2"), (true, false));
        assert_eq!(m.active_tab().map(|c| c.id.as_str()), Some("c1"));
        // Opening it again takes it off the recent list.
        m.add_space("p4", "web", "/src/web", Tab::new("c4", "x", "x4", "t4"));
        assert!(m.recent.is_empty());
    }

    #[test]
    fn parking_takes_a_pane_out_and_unparking_puts_it_back_where_it_was() {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Column, "x3", "t3");
        let before = m.tab("c1").unwrap().root.clone();
        assert!(m.park_pane("x3", None).is_ok());
        let c = m.tab("c1").unwrap();
        assert!(c.root.find("x3").is_none());
        assert_eq!(c.parked.iter().map(|p| p.pane.id.as_str()).collect::<Vec<_>>(), ["x3"]);
        assert_eq!((c.parked[0].near.as_deref(), c.parked[0].side), (Some("x2"), Edge::Bottom));
        // Still the tab's: its terminal, its status, closing the tab ends it.
        assert_eq!(m.pane_of("t3").as_deref(), Some("x3"));
        assert_eq!(m.placed_pane_of("t3"), None);
        assert_eq!(m.address_of("x3").as_deref(), Some("t3"));
        assert_eq!(m.tab_holding("x3").map(|t| t.id.as_str()), Some("c1"));
        assert_eq!(m.space_of("x3").map(|s| s.id.as_str()), Some("p1"));
        assert!(m.all_addresses().contains(&"t3".to_owned()));
        // Focus left it for a pane still in place.
        assert_ne!(m.focused_pane().as_deref(), Some("x3"));
        assert!(m.unpark_pane("x3", None).is_ok());
        let c = m.tab("c1").unwrap();
        assert!(c.parked.is_empty());
        assert_eq!(c.focused.as_deref(), Some("x3"));
        let ids = |n: &Node| n.panes().iter().map(|p| p.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&c.root), ids(&before));
        assert_eq!(c.root.parent_of("x3").and_then(Node::axis), Some(Axis::Column));
    }

    #[test]
    fn the_parking_row_reorders_and_a_tab_keeps_one_pane_in_place() {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Row, "x3", "t3");
        m.park_pane("x2", None).unwrap();
        m.park_pane("x3", Some(0)).unwrap();
        let order = |m: &Model| m.tab("c1").unwrap().parked.iter().map(|p| p.pane.id.clone()).collect::<Vec<_>>();
        assert_eq!(order(&m), ["x3", "x2"]);
        m.park_pane("x3", Some(9)).unwrap();
        assert_eq!(order(&m), ["x2", "x3"]);
        assert!(m.park_pane("x1", None).is_err());
        assert!(m.park_pane("nope", None).is_err());
        // Focusing a parked pane brings it back.
        assert!(m.focus_pane("x2"));
        assert_eq!(order(&m), ["x3"]);
        assert_eq!(m.focused_pane().as_deref(), Some("x2"));
    }

    #[test]
    fn unparking_onto_a_pane_takes_its_side_or_its_place() {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Row, "x3", "t3");
        m.park_pane("x3", None).unwrap();
        m.unpark_pane("x3", Some(("x1", Some(Edge::Left)))).unwrap();
        let ids = |m: &Model| m.tab("c1").unwrap().root.panes().iter().map(|p| p.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&m), ["x3", "x1", "x2"]);
        m.park_pane("x3", None).unwrap();
        // No edge: it takes the target's place and the target is parked instead.
        m.unpark_pane("x3", Some(("x2", None))).unwrap();
        assert_eq!(ids(&m), ["x1", "x3"]);
        assert_eq!(m.tab("c1").unwrap().parked[0].pane.id, "x2");
        assert!(m.unpark_pane("x2", Some(("nope", None))).is_err());
        assert_eq!(m.tab("c1").unwrap().parked.len(), 1);
    }

    #[test]
    fn closing_parked_panes_and_the_last_placed_one() {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Row, "x3", "t3");
        m.park_pane("x2", None).unwrap();
        m.park_pane("x3", None).unwrap();
        assert_eq!(m.remove_pane("x3"), (false, false));
        assert_eq!(m.address_of("x3"), None);
        // The last placed pane gone: a parked one comes back rather than the tab closing.
        assert_eq!(m.remove_pane("x1"), (false, false));
        let c = m.tab("c1").unwrap();
        assert_eq!(c.root.panes().iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["x2"]);
        assert!(c.parked.is_empty());
        assert_eq!(m.focused_pane().as_deref(), Some("x2"));
        // Closing the tab ends parked terminals too.
        m.split("x2", Axis::Row, "x4", "t4");
        m.park_pane("x4", None).unwrap();
        assert_eq!(m.remove_tab("c1").0, ["t2", "t4"]);
    }

    #[test]
    fn a_mod_is_a_pane_beside_terminals() {
        let mut m = model_with_one();
        let viewer = Node::block("x2", Content::Mod { name: "markdown".into(), props: json!({ "file": "README.md" }) });
        assert!(m.split_with("x1", Axis::Row, viewer));
        let c = m.tab("c1").unwrap();
        assert_eq!(c.root.panes().len(), 2);
        assert_eq!(c.focused.as_deref(), Some("x2"));
        // It has no terminal: nothing to restart or kill, and the tab survives
        // its terminal pane closing.
        assert_eq!(m.address_of("x2"), None);
        assert_eq!(m.remove_pane("x1"), (false, false));
        assert_eq!(m.tab("c1").unwrap().root.panes().len(), 1);
    }

    #[test]
    fn pane_moves_preserve_terminals_and_focus_for_swap_and_every_edge() {
        use crate::layout::Edge;
        for edge in [None, Some(Edge::Left), Some(Edge::Right), Some(Edge::Top), Some(Edge::Bottom)] {
            let mut m = model_with_one();
            m.split("x1", Axis::Row, "x2", "t2");
            m.split("x2", Axis::Column, "x3", "t3");
            assert!(m.move_pane("x1", "x3", edge));
            assert_eq!(m.focused_pane().as_deref(), Some("x1"));
            for (pane, address) in [("x1", "t1"), ("x2", "t2"), ("x3", "t3")] {
                assert_eq!(m.address_of(pane).as_deref(), Some(address));
            }
            let root = &m.active_tab().unwrap().root;
            assert_eq!(root.panes().len(), 3);
            if let Some(edge) = edge {
                let parent = root.parent_of("x1").unwrap();
                let expected_axis = if matches!(edge, Edge::Left | Edge::Right) { Axis::Row } else { Axis::Column };
                assert_eq!(parent.axis(), Some(expected_axis));
                let ids: Vec<_> = parent.children().iter().map(|n| n.id.as_str()).collect();
                let source = ids.iter().position(|id| *id == "x1").unwrap();
                let target = ids.iter().position(|id| *id == "x3").unwrap();
                assert_eq!(source < target, matches!(edge, Edge::Left | Edge::Top));
                assert_eq!(source.abs_diff(target), 1);
            }
        }
    }

    #[test]
    fn cross_axis_pane_moves_split_equally_not_with_the_old_slot_size() {
        use crate::layout::{Edge, Size};
        for old_size in [Some(Size::Weight { weight: 0.5 }), Some(Size::Px { px: 200. })] {
            let mut m = model_with_one();
            m.split("x1", Axis::Row, "x2", "t2");
            m.tab_of_mut("x2").unwrap().root.find_mut("x2").unwrap().size = old_size;
            assert!(m.move_pane("x2", "x1", Some(Edge::Bottom)));
            let parent = m.active_tab().unwrap().root.parent_of("x2").unwrap();
            assert_eq!(parent.children()[0].size, None);
            assert_eq!(parent.children()[1].size, None);
        }
    }

    #[test]
    fn invalid_pane_moves_leave_the_model_alone() {
        let mut m = model_with_one();
        m.add_tab("p1", Tab::new("c2", "docs", "x2", "t2"));
        let before = format!("{:?}", m.spaces);
        for (source, target) in [("x1", "x1"), ("x1", "missing"), ("missing", "x1"), ("x1", "x2"), ("c1", "x1")] {
            assert!(!m.move_pane(source, target, None));
            assert_eq!(format!("{:?}", m.spaces), before);
        }
    }

    #[test]
    fn new_tabs_go_after_the_selected_one() {
        let mut m = model_with_one();
        m.add_tab("p1", Tab::new("c2", "b", "x2", "t2"));
        m.select_tab("c1");
        m.add_tab("p1", Tab::new("c3", "c", "x3", "t3"));
        let order: Vec<&str> = m.spaces[0].tabs.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(order, ["c1", "c3", "c2"]);
        assert_eq!(m.active_tab().map(|c| c.id.as_str()), Some("c3"));
    }

    fn three_panes_and_another_tab() -> Model {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Row, "x3", "t3");
        m.add_tab("p1", Tab::new("c2", "docs", "x4", "t4"));
        m.select_tab("c1");
        m.focus_pane("x1");
        m
    }

    #[test]
    fn a_lone_pane_moves_into_a_grid_tab_and_its_empty_tab_closes() {
        let mut m = three_panes_and_another_tab();
        let into = MoveInto::Tab { tab: "c1".into(), target: None, edge: None };
        assert_eq!(m.move_to_tab("x4", into), Ok("c1".into()));
        assert!(m.tab("c2").is_none(), "its tab, left empty, closes");
        assert_eq!(m.address_of("x4").as_deref(), Some("t4"));
        assert_eq!(m.tab_of("x4").unwrap().id, "c1");
        assert_eq!(m.focused_pane().as_deref(), Some("x4"));
        assert_eq!(m.active_tab().unwrap().id, "c1");
    }

    #[test]
    fn a_moved_pane_lands_beside_its_target_on_the_edge_asked() {
        use crate::layout::Edge;
        let mut m = three_panes_and_another_tab();
        let into = MoveInto::Tab { tab: "c2".into(), target: Some("x4".into()), edge: Some(Edge::Left) };
        assert_eq!(m.move_to_tab("x2", into), Ok("c2".into()));
        assert_eq!(pane_order(&m, "c2"), ["x2", "x4"]);
        assert_eq!(pane_order(&m, "c1"), ["x1", "x3"]);
        assert_eq!(m.tab("c1").unwrap().focused.as_deref(), Some("x1"));
    }

    #[test]
    fn a_pane_moves_to_a_tab_of_another_space_and_the_emptied_space_closes() {
        let mut m = three_panes_and_another_tab();
        m.add_space("p2", "pip", "/src/pip", Tab::new("c9", "pip-fixes", "x9", "t9"));
        let into = MoveInto::Tab { tab: "c1".into(), target: None, edge: None };
        assert_eq!(m.move_to_tab("x9", into), Ok("c1".into()));
        assert!(m.space("p2").is_none());
        assert_eq!(m.active_space().unwrap().id, "p1");
        assert_eq!(pane_order(&m, "c1").len(), 4);
    }

    #[test]
    fn a_parked_pane_moves_and_a_new_tab_takes_one() {
        let mut m = three_panes_and_another_tab();
        m.park_pane("x3", None).unwrap();
        let into = MoveInto::Tab { tab: "c2".into(), target: None, edge: None };
        assert_eq!(m.move_to_tab("x3", into), Ok("c2".into()));
        assert!(m.tab("c1").unwrap().parked.is_empty());
        let new = MoveInto::New { space: "p1".into(), tab: "c7".into(), name: "".into() };
        assert_eq!(m.move_to_tab("x2", new), Ok("c7".into()));
        assert_eq!(pane_order(&m, "c7"), ["x2"]);
        assert_eq!(m.address_of("x2").as_deref(), Some("t2"));
    }

    #[test]
    fn moves_that_cannot_be_leave_the_model_alone() {
        let mut m = three_panes_and_another_tab();
        let before = format!("{:?}", m.spaces);
        let same = MoveInto::Tab { tab: "c1".into(), target: None, edge: None };
        assert!(m.move_to_tab("x1", same).is_err());
        let missing = MoveInto::Tab { tab: "nope".into(), target: None, edge: None };
        assert!(m.move_to_tab("x1", missing).is_err());
        let bad_target = MoveInto::Tab { tab: "c2".into(), target: Some("x1".into()), edge: None };
        assert!(m.move_to_tab("x1", bad_target).is_err());
        let lone = MoveInto::New { space: "p1".into(), tab: "c7".into(), name: "".into() };
        assert!(m.move_to_tab("x4", lone).is_err());
        m.add_space("p2", "remote", "/", Tab::new("r1", "", "y1", "box/t1"));
        m.spaces.last_mut().unwrap().machine = Some("box".into());
        let across = MoveInto::Tab { tab: "r1".into(), target: None, edge: None };
        assert!(m.move_to_tab("x1", across).is_err());
        m.remove_space("p2");
        assert_eq!(format!("{:?}", m.spaces), before);
    }

    fn pane_order(m: &Model, tab: &str) -> Vec<String> {
        m.tab(tab).unwrap().root.panes().iter().map(|n| n.id.clone()).collect()
    }

    #[test]
    fn swapping_panes_by_id_trades_places_and_keeps_focus_on_the_same_id() {
        let mut m = three_panes_and_another_tab();
        assert_eq!(m.swap_panes("x1", "x3"), Ok(()));
        assert_eq!(pane_order(&m, "c1"), ["x3", "x2", "x1"]);
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
        assert_eq!(m.address_of("x1").as_deref(), Some("t1"));
        assert_eq!(m.swap_panes("x2", "x3"), Ok(()));
        assert_eq!(pane_order(&m, "c1"), ["x2", "x3", "x1"]);
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
    }

    #[test]
    fn equalizing_evens_a_tab_after_halving_splits() {
        use crate::equalize::Scope;
        use crate::layout::Size;
        let mut m = three_panes_and_another_tab();
        let weights = |m: &Model| m.tab("c1").unwrap().root.panes().iter().map(|n| n.size).collect::<Vec<_>>();
        assert_ne!(weights(&m)[0], weights(&m)[2]);
        assert_eq!(m.equalize("x2", Scope::Row), Ok(true));
        let w = weights(&m);
        assert!(w.iter().all(|s| matches!(s, Some(Size::Weight { .. })) && *s == w[0]), "{w:?}");
        assert_eq!(m.equalize("x2", Scope::Column), Err("pane \"x2\" is in no column (no panes stacked)".into()));
        assert_eq!(m.equalize("nope", Scope::All), Err("no pane \"nope\"".into()));
    }

    #[test]
    fn resizing_moves_a_divider_but_not_in_a_zoomed_or_one_pane_tab() {
        use crate::pane_resize::{Direction, STEP};
        let mut m = three_panes_and_another_tab();
        let sizes = |m: &Model| m.tab("c1").unwrap().root.panes().iter().map(|n| n.size).collect::<Vec<_>>();
        let drawn = |_: &str| Some(300.0);
        let before = sizes(&m);
        // Zoomed: one pane shows, nothing moves.
        m.tab_mut("c1").unwrap().zoomed = Some("x2".into());
        assert_eq!(m.resize_pane("x2", Direction::Right, STEP, drawn), Ok(false));
        assert_eq!(sizes(&m), before);
        m.tab_mut("c1").unwrap().zoomed = None;
        assert_eq!(m.resize_pane("x2", Direction::Right, STEP, drawn), Ok(true));
        assert_ne!(sizes(&m), before);
        // No stacked split: up does nothing.
        assert_eq!(m.resize_pane("x2", Direction::Up, STEP, drawn), Ok(false));
        // One pane in its tab.
        assert_eq!(m.resize_pane("x4", Direction::Left, STEP, drawn), Ok(false));
        assert_eq!(m.resize_pane("nope", Direction::Left, STEP, drawn), Err("no pane \"nope\"".into()));
    }

    #[test]
    fn swapping_panes_by_id_refuses_each_bad_pair_without_changes() {
        let mut m = three_panes_and_another_tab();
        let cases = [
            ("nope", "x2", "no pane \"nope\""),
            ("x1", "nope", "no target pane \"nope\""),
            ("x1", "x1", "pane.swap target is the pane itself"),
            ("x1", "x4", "pane.swap target \"x4\" is in another tab"),
        ];
        for (pane, target, error) in cases {
            assert_eq!(m.swap_panes(pane, target), Err(error.to_owned()), "{pane} {target}");
            assert_eq!(pane_order(&m, "c1"), ["x1", "x2", "x3"], "{pane} {target}");
            assert_eq!(pane_order(&m, "c2"), ["x4"], "{pane} {target}");
            assert_eq!(m.focused_pane().as_deref(), Some("x1"), "{pane} {target}");
        }
    }

    #[test]
    fn swapping_refuses_a_container_as_pane_or_target() {
        let mut m = three_panes_and_another_tab();
        let container = m.tab("c1").unwrap().root.id.clone();
        assert_eq!(m.swap_panes(&container, "x1"), Err(format!("no pane {container:?}")));
        assert_eq!(m.swap_panes("x1", &container), Err(format!("no target pane {container:?}")));
        assert_eq!(pane_order(&m, "c1"), ["x1", "x2", "x3"]);
    }

    #[test]
    fn auto_splits_alternate_with_the_parent_and_left_up_go_before() {
        let mut m = model_with_one();
        // A lone pane gets a neighbor on the right.
        assert_eq!(m.split_side("x1", Direction::Auto), (Axis::Row, false));
        assert!(m.split_toward("x1", Direction::Auto, pane("x2", "t2")));
        let root = &m.tab("c1").unwrap().root;
        assert_eq!(root.axis(), Some(Axis::Row));
        assert_eq!(root.children().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["x1", "x2"]);
        // Side by side: the next one goes below.
        assert_eq!(m.split_side("x2", Direction::Auto), (Axis::Column, false));
        assert!(m.split_toward("x2", Direction::Auto, pane("x3", "t3")));
        let parent = m.tab("c1").unwrap().root.parent_of("x3").unwrap();
        assert_eq!(parent.axis(), Some(Axis::Column));
        assert_eq!(parent.children().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["x2", "x3"]);
        // Stacked: right again.
        assert_eq!(m.split_side("x3", Direction::Auto), (Axis::Row, false));
        assert_eq!(m.focused_pane().as_deref(), Some("x3"));
        // Left and up put the new pane before the target.
        assert_eq!(m.split_side("x1", Direction::Left), (Axis::Row, true));
        assert!(m.split_toward("x1", Direction::Left, pane("x4", "t4")));
        let ids: Vec<_> = m.tab("c1").unwrap().root.children().iter().map(|n| n.id.clone()).collect();
        assert_eq!(ids[..2], ["x4".to_owned(), "x1".to_owned()]);
        assert!(m.split_toward("x3", Direction::Up, pane("x5", "t5")));
        let parent = m.tab("c1").unwrap().root.parent_of("x3").unwrap();
        assert_eq!(parent.children().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["x2", "x5", "x3"]);
        assert_eq!(Direction::parse("auto"), Some(Direction::Auto));
        assert_eq!(Direction::parse("sideways"), None);
    }

    #[test]
    fn edge_splits_span_the_whole_tab_and_keep_a_fixed_size() {
        use crate::layout::Size;
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        // Right edge of a side-by-side tab: one more column at the end, fixed px.
        let mut side = pane("x3", "t3");
        side.size = Some(Size::Px { px: 320. });
        assert!(m.split_edge("c1", Edge::Right, side));
        let root = &m.tab("c1").unwrap().root;
        assert_eq!(root.id, "c1");
        assert_eq!(root.axis(), Some(Axis::Row));
        assert_eq!(root.children().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["x1", "x2", "x3"]);
        assert_eq!(root.children()[2].size, Some(Size::Px { px: 320. }));
        assert_eq!(m.focused_pane().as_deref(), Some("x3"));
        // Bottom edge: everything so far goes in one row above it, full width.
        assert!(m.split_edge("c1", Edge::Bottom, pane("x4", "t4")));
        let root = &m.tab("c1").unwrap().root;
        assert_eq!(root.id, "c1");
        assert_eq!(root.axis(), Some(Axis::Column));
        assert_eq!(root.children().len(), 2);
        assert_eq!(root.children()[0].axis(), Some(Axis::Row));
        assert_eq!(root.children()[0].children().len(), 3);
        assert_eq!(root.children()[1].id, "x4");
        // Top edge goes first; later splits of a pane stay in the remaining region.
        assert!(m.split_edge("c1", Edge::Top, pane("x5", "t5")));
        assert_eq!(m.tab("c1").unwrap().root.children()[0].id, "x5");
        assert!(m.split("x2", Axis::Row, "x6", "t6"));
        let root = &m.tab("c1").unwrap().root;
        assert_eq!(root.children().len(), 3);
        let row: Vec<_> = root.parent_of("x6").unwrap().children().iter().map(|n| n.id.as_str()).collect();
        assert_eq!(row, ["x1", "x2", "x6", "x3"]);
        // A lone pane: the root just turns.
        let mut m = model_with_one();
        assert!(m.split_edge("c1", Edge::Left, pane("x2", "t2")));
        let root = &m.tab("c1").unwrap().root;
        assert_eq!(root.children().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["x2", "x1"]);
        assert!(!m.split_edge("missing", Edge::Left, pane("x9", "t9")));
    }

    #[test]
    fn splits_focus_the_new_pane_and_closing_it_moves_focus() {
        let mut m = model_with_one();
        assert!(m.split("x1", Axis::Row, "x9", "t9"));
        assert_eq!(m.focused_pane().as_deref(), Some("x9"));
        assert_eq!(m.remove_pane("x9"), (false, false));
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
        // The arrangement keeps the tab's id with one pane left.
        assert_eq!(m.active_tab().unwrap().root.id, "c1");
    }

    #[test]
    fn closing_the_focused_pane_goes_back_to_the_one_before() {
        let mut m = model_with_one();
        m.split("x1", Axis::Row, "x2", "t2");
        m.split("x2", Axis::Row, "x3", "t3");
        // From x2 to x3; closing x3 lands on x2, not on the first pane.
        m.remove_pane("x3");
        assert_eq!(m.focused_pane().as_deref(), Some("x2"));
        // Clicked around: x1, then x2; close x2 and it's x1.
        m.split("x2", Axis::Row, "x4", "t4");
        m.focus_pane("x1");
        m.focus_pane("x4");
        m.remove_pane("x4");
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
        // The one before is gone too: the next one back that's still there.
        m.split("x2", Axis::Row, "x5", "t5");
        m.focus_pane("x2");
        m.remove_pane("x5");
        m.remove_pane("x2");
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
    }

    #[test]
    fn finishes_you_did_not_watch_are_done_until_seen() {
        let mut m = model_with_one();
        m.set_word("t1", Some("working".into()), Some("claude".into()), false);
        assert_eq!(m.status("t1"), Some("working"));
        m.set_word("t1", Some("idle".into()), None, false);
        assert_eq!(m.status("t1"), Some("done"));
        assert_eq!(m.rollup(&m.all_addresses()), Some("done"));
        m.mark_seen(&["t1".into()]);
        assert_eq!(m.status("t1"), Some("idle"));
        // Watching it finish: straight to idle.
        m.set_word("t1", Some("working".into()), None, true);
        m.set_word("t1", Some("done".into()), None, true);
        assert_eq!(m.status("t1"), Some("idle"));
        m.set_word("t1", Some("blocked".into()), None, true);
        assert_eq!(m.rollup(&m.all_addresses()), Some("blocked"));
    }

    #[test]
    fn a_shared_seen_turn_decides_over_this_screen() {
        let mut m = model_with_one();
        m.set_word("t1", Some("working".into()), None, true);
        m.set_word("t1", Some("idle".into()), None, true);
        assert_eq!(m.status("t1"), Some("idle"));
        // Another client hasn't seen turn 3 (marked unread): done, though we watched.
        assert!(m.set_turn("t1", 3, Some(2)));
        assert_eq!(m.status("t1"), Some("done"));
        assert!(!m.set_turn("t1", 3, Some(2)));
        // Seen elsewhere: idle, though we didn't watch.
        m.set_word("t1", Some("working".into()), None, false);
        m.set_word("t1", Some("idle".into()), None, false);
        m.set_turn("t1", 4, Some(4));
        assert_eq!(m.status("t1"), Some("idle"));
        // Needing you or working beats seen.
        m.set_word("t1", Some("blocked".into()), None, false);
        assert_eq!(m.status("t1"), Some("blocked"));
        // No label: this screen's own rule.
        m.set_word("t1", Some("idle".into()), None, false);
        m.set_turn("t1", 5, None);
        assert_eq!(m.status("t1"), Some("done"));
    }

    #[test]
    fn focusing_another_pane_in_a_zoomed_tab_moves_the_zoom() {
        let mut m = model_with_one();
        assert!(m.split("x1", Axis::Row, "x2", "t2"));
        m.tab_mut("c1").unwrap().zoomed = Some("x2".into());
        assert!(m.focus_pane("x1"));
        assert_eq!(m.tab("c1").unwrap().zoomed.as_deref(), Some("x1"));
        // A tab nobody zoomed stays unzoomed when focus moves.
        m.tab_mut("c1").unwrap().zoomed = None;
        assert!(m.focus_pane("x2"));
        assert_eq!(m.tab("c1").unwrap().zoomed, None);
    }

    #[test]
    fn focus_follows_panes_across_tabs_and_spaces() {
        let mut m = model_with_one();
        m.add_tab("p1", Tab::new("c2", "b", "x2", "t2"));
        assert_eq!(m.focused_pane().as_deref(), Some("x2"));
        m.add_space("p2", "web", "/w", Tab::new("c3", "c", "x3", "t3"));
        assert!(m.focus_pane("x1"));
        assert_eq!(m.active.as_deref(), Some("p1"));
        assert_eq!(m.focused_pane().as_deref(), Some("x1"));
        assert_eq!(m.active_tab().map(|c| addresses(c.shown())).unwrap_or_default(), ["t1"]);
    }

    #[test]
    fn a_command_is_only_while_working_and_a_new_message_is_a_new_step() {
        let mut m = Model::default();
        m.set_word("t1", Some("working".into()), None, false);
        m.agents.get_mut("t1").unwrap().step = 1;
        m.set_msg("t1", Some("Running cargo test".into()));
        assert!(m.agents["t1"].step > 1);
        let step = m.agents["t1"].step;
        m.set_msg("t1", Some("Running cargo test".into()));
        assert_eq!(m.agents["t1"].step, step);
        assert!(m.set_command("t1", true));
        assert!(!m.set_command("t1", true));
        assert_eq!(m.status("t1"), Some("working"));
        m.set_word("t1", Some("idle".into()), None, false);
        assert!(m.set_command("t1", true));
        assert!(!m.agents["t1"].command);
    }
}
