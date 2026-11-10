// The Pull requests tab, lazygit's way: the open PRs and the selected one's
// checks down the left, the PR itself on the right (description and the
// conversation, rendered markdown). h / l move between the three panels,
// j / k inside one; J / K scroll the PR from anywhere.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle, TextareaState, Textarea } from "gpui-base";
import { ghJson, ghRun, api, graphql } from "./gh.js";
import { checkRows, rollupTone, rowTone, prListQuery, prRows, ago, duration, readAgo, SLOW } from "./model.js";
import { slimPr, slimPrRow, slimReviewComment, newest, LIMITS } from "./cache.js";
import { markdown } from "./markdown.js";
import { dither, pip, panel, empty, band, toneColor, TONE_WORD, stop, eyebrow, splitter, unzoom, unzoomSize } from "./kit.js";

// What the right panel draws (no state, no mergeable: GitHub computes those slowly).
const VIEW = "number,title,body,author,isDraft,baseRefName,headRefName,labels,reviewDecision,statusCheckRollup,url,createdAt,updatedAt,comments,reviews,additions,deletions,changedFiles";
const FILTERS = ["all", "mine", "review"];
const FILTER_WORD = { all: "open", mine: "mine", review: "to review" };
const FILTER_ARGS = { all: [], mine: ["--author", "@me"], review: ["--search", "review-requested:@me"] };
// While the selected PR's checks still run, its view is read this often.
const CHECKS_LIVE = 8000;
const ROW = 38, CHECK_ROW = 22;
const PANELS = ["list", "checks", "main"];

const REVIEW = { APPROVED: ["approved", "done"], CHANGES_REQUESTED: ["changes requested", "failed"], REVIEW_REQUIRED: ["review required", "queued"] };

export default class Prs {
  constructor(app, kept = {}) {
    this.app = app;
    this.filter = FILTERS.includes(kept.filter) ? kept.filter : "all";
    this.sel = kept.sel ?? null; // PR number
    this.focus = "list";
    this.list = null;
    this.listAt = 0;
    this.lists = {}; // filter -> { list, at }: each filter's last list (cached between openings)
    this.details = new Map(); // number -> { pr, review: [], reviewTag, at }
    this.checkSel = 0;
    this.scrollY = 0;
    this.contentH = 0;
    this.viewH = 400;
    this.listScroll = VirtualListScrollHandle.new();
    this.composer = null; // TextareaState while writing a comment
    this.error = "";
    this.sizes = { ...(kept.sizes ?? {}) }; // dragged splitters: left (width), top (height, narrow), checks (height)
  }

  save() { return { filter: this.filter, sel: this.sel, sizes: this.sizes }; }

  /** Shows what an earlier opening read (cache.js entry.prs), until GitHub answers. */
  hydrate(c) {
    this.lists = {};
    for (const [f, l] of Object.entries(c?.lists ?? {})) if (FILTERS.includes(f) && Array.isArray(l?.list)) this.lists[f] = { list: l.list, at: l.at ?? 0 };
    this.details = new Map(Object.entries(c?.details ?? {}).map(([n, d]) => [Number(n), { pr: d.pr, review: d.review ?? [], reviewTag: d.reviewTag ?? null, at: d.at ?? 0 }]));
    const l = this.lists[this.filter];
    this.list = l?.list ?? null; this.listAt = l?.at ?? 0;
    if (this.list && (this.sel == null || !this.list.some((p) => p.number === this.sel))) this.sel = this.list[0]?.number ?? null;
  }

  /** What's worth keeping for the next opening (slim: only what's drawn). */
  snapshot() {
    const lists = {};
    for (const [f, l] of Object.entries(this.lists)) lists[f] = { list: l.list.map(slimPrRow), at: l.at };
    const details = {};
    for (const [n, d] of this.details) if (d.pr) details[n] = { pr: slimPr(d.pr), review: (d.review ?? []).map(slimReviewComment), reviewTag: d.reviewTag ?? null, at: d.at };
    return { lists, details: newest(details, LIMITS.details) };
  }

  /** When the shown list was read (0: never). */
  readAt() { return this.listAt; }

  // ---- data

  current() { return this.list?.find((p) => p.number === this.sel) ?? this.list?.[0] ?? null; }
  detail() { const p = this.current(); return p ? this.details.get(p.number) ?? null : null; }
  checks() { const d = this.detail(); return checkRows((d?.pr ?? this.current())?.statusCheckRollup); }

  /** When the visible data wants reading again. */
  interval() {
    const live = this.checks().some((c) => c.tone === "working" || c.tone === "queued");
    return live ? CHECKS_LIVE : SLOW;
  }

  /** Reads GitHub: the list, and the shown PR's view beside it (both at once).
   *  all: past the timers; fresh: past the ETags. */
  async poll({ all = false, fresh = false } = {}, cx) {
    const repo = this.app.repo;
    if (!repo) return;
    const now = Date.now(), filter = this.filter;
    const list = all || !this.list || now - this.listAt >= SLOW ? this.readList(repo, filter) : null;
    // The PR shown now (a cached list's) is read while the list is.
    const first = this.current();
    const view = first && this.wantsDetail(first, all, now) ? this.readDetail(repo, first, fresh) : null;
    view?.catch(() => {}); // awaited below; not unhandled if the list fails first
    if (list) {
      const rows = await list;
      if (this.filter !== filter || this.app.repo !== repo) return;
      this.lists[filter] = { list: rows, at: Date.now() };
      this.list = rows; this.listAt = this.lists[filter].at;
      if (this.sel == null || !rows.some((p) => p.number === this.sel)) this.sel = rows[0]?.number ?? null;
      this.follow();
      cx?.notify();
    }
    await view;
    const p = this.current();
    if (p && p !== first && p.number !== first?.number && this.wantsDetail(p, all, now)) await this.readDetail(repo, p, fresh);
    this.follow();
  }

  wantsDetail(p, all, now) {
    const d = this.details.get(p.number);
    return all || !d || now - d.at >= this.interval() - 500;
  }

  async readList(repo, filter) {
    const { query, vars } = prListQuery(filter, repo.full);
    return prRows(await graphql(repo, query, vars));
  }

  async readDetail(repo, p, fresh) {
    const d = this.details.get(p.number);
    const [pr, review] = await Promise.all([
      ghJson(repo, ["pr", "view", String(p.number), "--json", VIEW]),
      api(repo, `repos/${repo.full}/pulls/${p.number}/comments?per_page=100`, { fresh, prior: d?.reviewTag ? { etag: d.reviewTag, data: d.review } : null, slim: (a) => (a ?? []).map(slimReviewComment) })
        .catch(() => ({ data: d?.review ?? [], etag: d?.reviewTag ?? null })),
    ]);
    if (this.app.repo !== repo) return;
    this.details.set(p.number, { pr, review: review.data ?? [], reviewTag: review.etag ?? null, at: Date.now() });
    if (this.details.size > LIMITS.details * 2) {
      const keep = new Set(Object.keys(newest(Object.fromEntries(this.details), LIMITS.details)).map(Number));
      for (const n of this.details.keys()) if (!keep.has(n)) this.details.delete(n);
    }
  }

  /** The list's rows follow what their PR's view read (checks, review, title). */
  follow() {
    for (const p of this.list ?? []) {
      const d = this.details.get(p.number);
      if (!d?.pr || d.at < this.listAt - 1000) continue;
      Object.assign(p, { tone: rollupTone(checkRows(d.pr.statusCheckRollup)), reviewDecision: d.pr.reviewDecision, title: d.pr.title });
    }
  }

  /** The conversation: comments, reviews and review comments, oldest first. */
  timeline(d) {
    const out = [];
    for (const c of d.pr.comments ?? []) out.push({ kind: "comment", who: c.author?.login, body: c.body, at: c.createdAt, url: c.url });
    for (const r of d.pr.reviews ?? []) {
      if (!r.body && r.state === "COMMENTED") continue;
      out.push({ kind: "review", state: r.state, who: r.author?.login, body: r.body, at: r.submittedAt });
    }
    for (const c of d.review ?? []) {
      out.push({ kind: "line", who: c.user?.login, body: c.body, at: c.created_at, path: c.path, line: c.line ?? c.original_line, reply: Boolean(c.in_reply_to_id), url: c.html_url });
    }
    return out.sort((a, b) => Date.parse(a.at ?? 0) - Date.parse(b.at ?? 0));
  }

  // ---- moves

  select(i, cx) {
    const list = this.list ?? [];
    if (!list.length) return;
    const k = Math.max(0, Math.min(list.length - 1, i));
    if (list[k].number !== this.sel) { this.sel = list[k].number; this.scrollY = 0; this.checkSel = 0; this.app.kick(cx); }
    this.listScroll.scroll_to_item(k);
  }

  scroll(dy) {
    const max = Math.max(0, this.contentH - this.viewH);
    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  cycleFilter(cx) {
    this.filter = FILTERS[(FILTERS.indexOf(this.filter) + 1) % FILTERS.length];
    const l = this.lists[this.filter];
    this.list = l?.list ?? null; this.listAt = l?.at ?? 0; this.sel = null;
    if (this.list) this.sel = this.list[0]?.number ?? null;
    this.app.refresh(cx, true);
  }

  openCheck(c, cx) {
    if (!c) return;
    if (c.runId) this.app.showRun(c.runId, c.jobId, cx);
    else if (c.url) this.app.openUrl(c.url, cx);
  }

  /** Keys while this tab shows; true when one was used. */
  key(k, e, cx) {
    if (this.composer) return this.composeKey(k, e, cx);
    const list = this.list ?? [], p = this.current(), i = list.indexOf(p);
    const checks = this.checks();
    const page = Math.max(80, this.viewH / 2);
    const at = PANELS.indexOf(this.focus);
    if (k === "l" || k === "right") this.focus = PANELS[Math.min(PANELS.length - 1, at + 1 + (at === 0 && !checks.length ? 1 : 0))];
    else if (k === "h" || k === "left") this.focus = PANELS[Math.max(0, at - 1 - (at === 2 && !checks.length ? 1 : 0))];
    else if (k === "tab") this.focus = PANELS[(at + 1) % PANELS.length];
    else if (k === "escape" && this.focus !== "list") this.focus = "list";
    else if (this.focus === "list" && (k === "j" || k === "down")) this.select(i + 1, cx);
    else if (this.focus === "list" && (k === "k" || k === "up")) this.select(i - 1, cx);
    else if (this.focus === "list" && (k === "g" || k === "home")) this.select(0, cx);
    else if (this.focus === "list" && (k === "G" || k === "end")) this.select(list.length - 1, cx);
    else if (this.focus === "list" && k === "enter") this.focus = "main";
    else if (this.focus === "checks" && (k === "j" || k === "down")) this.checkSel = Math.min(checks.length - 1, this.checkSel + 1);
    else if (this.focus === "checks" && (k === "k" || k === "up")) this.checkSel = Math.max(0, this.checkSel - 1);
    else if (this.focus === "checks" && k === "enter") this.openCheck(checks[this.checkSel], cx);
    else if (this.focus === "main" && (k === "j" || k === "down")) this.scroll(60);
    else if (this.focus === "main" && (k === "k" || k === "up")) this.scroll(-60);
    else if (this.focus === "main" && (k === "g" || k === "home")) this.scrollY = 0;
    else if (this.focus === "main" && (k === "G" || k === "end")) this.scroll(1e9);
    else if (k === "J" || k === "pagedown" || (k === "d" && e.modifiers?.control)) this.scroll(page);
    else if (k === "K" || k === "pageup" || (k === "u" && e.modifiers?.control)) this.scroll(-page);
    else if (k === "f") this.cycleFilter(cx);
    else if (k === "d" && p) this.app.openDiff(p.number);
    else if (k === "c" && p) this.startComment(cx);
    else if (k === "C" && p) this.app.ask(`Check out #${p.number} (${p.headRefName}) in ${this.app.repo.root}?`, () => this.checkout(p, cx));
    else if (k === "o" && p) this.app.openUrl(this.detail()?.pr?.url ?? `${this.app.repo.url}/pull/${p.number}`, cx);
    else if (k === "a" && p) this.app.showRuns({ branch: p.headRefName, label: `#${p.number}` }, cx);
    else return false;
    return true;
  }

  checkout(p, cx) {
    this.app.act(ghRun(this.app.repo, ["pr", "checkout", String(p.number)], { timeout: 120000 }), `Checked out #${p.number}.`, cx);
  }

  startComment(cx) {
    this.composer = TextareaState.new({ placeholder: "Leave a comment (markdown). cmd-enter posts, esc cancels." });
    this.composer.set_auto_grow(3, 10);
    this.composer.focus();
    cx.notify();
  }

  composeKey(k, e, cx) {
    if (k === "escape") { this.composer.release(); this.composer = null; this.app.focusSelf(); return true; }
    if (k === "enter" && (e.modifiers?.platform || e.modifiers?.control)) {
      const body = this.composer.value().trim(), p = this.current();
      if (!body || !p) return true;
      this.composer.release(); this.composer = null; this.app.focusSelf();
      this.app.act(ghRun(this.app.repo, ["pr", "comment", String(p.number), "--body", body]), `Commented on #${p.number}.`, cx, () => { this.details.delete(p.number); this.scroll(1e9); });
      return true;
    }
    return "typing"; // the textarea's own: don't let the window act on it
  }

  hints() {
    if (this.composer) return [["cmd-enter", "post"], ["esc", "cancel"]];
    const base = [["j/k", "move"], ["h/l", "panel"]];
    if (this.focus === "checks") return [...base, ["enter", "open run"], ["d", "diff"], ["?", "keys"]];
    if (this.focus === "main") return [...base, ["J/K", "page"], ["c", "comment"], ["d", "diff"], ["?", "keys"]];
    return [...base, ["d", "diff"], ["c", "comment"], ["a", "actions"], ["f", FILTER_WORD[this.filter]], ["?", "keys"]];
  }

  static help() {
    return [
      ["j k ↓ ↑", "move in the panel"], ["h l ← → tab", "previous / next panel"], ["g G", "first / last"],
      ["J K pgup pgdn", "scroll the pull request"], ["enter", "read it / open the check's run"], ["f", "open · mine · to review"],
      ["d", "its diff (nocturne-diff)"], ["c", "comment"], ["C", "check it out here"], ["a", "its Actions runs"],
      ["o", "in the browser"], ["r", "refresh"],
    ];
  }

  // ---- drawing

  prRow(t, p, sel, active) {
    const tone = rowTone(p);
    const [rev, revTone] = REVIEW[p.reviewDecision] ?? [null, null];
    return v_flex().id(`pr-${p.number}`).relative().h(ROW).w_full().pl(10).pr(8).justify_center().flex_none()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(sel, (el) => el.children(band(t, active)))
      .child(h_flex().relative().gap(7).items_center().text_size(12)
        .child(pip(t, tone ?? (p.isDraft ? "skipped" : null), 7))
        .child(div().flex_none().text_color(sel ? t.accent : t.ansi8).child(`#${p.number}`))
        .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : p.isDraft ? t.dim : t.muted).child(p.title)))
      .child(h_flex().relative().gap(6).pl(14).items_center().text_size(10).text_color(t.dim)
        .child(div().flex_none().child(p.author?.login ?? ""))
        .child(div().flex_1().min_w(0).truncate().child(p.headRefName ?? ""))
        .when(Boolean(rev), (el) => el.child(div().flex_none().text_color(toneColor(t, revTone)).child(rev)))
        .when(p.isDraft, (el) => el.child(div().flex_none().child("draft")))
        .child(div().flex_none().text_color(t.ansi2).child(`+${p.additions ?? 0}`))
        .child(div().flex_none().text_color(t.ansi1).child(`-${p.deletions ?? 0}`))
        .child(div().flex_none().child(ago(p.updatedAt))));
  }

  listPanel(t) {
    const list = this.list ?? [], cur = this.current(), active = this.focus === "list";
    const body = !this.list ? empty(t, "Reading pull requests…", null, { small: true })
      : !list.length ? empty(t, `No ${FILTER_WORD[this.filter]} pull requests`, this.filter === "all" ? "A quiet night." : "f shows the others.", { moon: 2 })
      : div().size_full().pt(2)
          .on_mouse_down("left", (_e, cx) => { this.focus = "list"; this.app.focusSelf(); cx.stop_propagation(); })
          .child(v_virtual_list("prs", list.length, ROW, (i) => String(list[i].number),
            (range) => list.slice(range.start, range.end).map((p) => this.prRow(t, p, p === cur, active)))
            .on_item_click((key, cx) => { this.focus = "list"; this.select(list.findIndex((p) => String(p.number) === key), cx); cx.notify(); })
            .size_full().track_scroll(this.listScroll));
    return panel(t, "pr-list", `Pull requests · ${FILTER_WORD[this.filter]}`, active, body, { right: this.list ? `${list.length}` : "" }).flex_1();
  }

  checksPanel(t) {
    const checks = this.checks(), active = this.focus === "checks";
    if (!checks.length) return null;
    this.checkSel = Math.min(this.checkSel, checks.length - 1);
    const passed = checks.filter((c) => c.tone === "done").length;
    const rows = checks.map((c, i) => {
      const sel = active && i === this.checkSel;
      return h_flex().id(`check-${i}`).relative().h(CHECK_ROW).px(10).gap(7).items_center().flex_none().text_size(11)
        .hover((s) => s.bg(t.ansi0 + "55"))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.focus = "checks"; this.checkSel = i; this.openCheck(c, cx); this.app.focusSelf(); cx.notify(); })
        .when(sel, (el) => el.children(band(t, true)))
        .when(c.tone === "working", (el) => el.child(div().absolute().inset_0().overflow_hidden().child(sweepLite(t))))
        .child(pip(t, c.tone, 7))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
        .child(div().relative().flex_none().text_color(c.tone === "working" ? t.working : t.dim).child(c.started ? duration(c.started, c.ended) : TONE_WORD[c.tone] ?? ""));
    });
    const h = this.checksH ?? Math.min(checks.length, 8) * CHECK_ROW + 26;
    return panel(t, "pr-checks", "Checks", active,
      div().id("checks-body").size_full().overflow_y_scroll().pt(2).children(rows),
      { right: `${passed}/${checks.length} passed` }).h(h).flex_none();
  }

  /** The PR on the right: header, labels, the description, then the conversation. */
  mainPanel(t) {
    const p = this.current(), d = this.detail(), active = this.focus === "main";
    if (!p) return panel(t, "pr-main", "Pull request", active, empty(t, "Nothing selected", null, { moon: 0 })).flex_1().h_full();
    const pr = d?.pr ?? p;
    const [rev, revTone] = REVIEW[pr.reviewDecision] ?? [null, null];
    const head = v_flex().gap(6).pb(10)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(15).text_color(t.accent).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).text_size(15).text_color(t.foreground).child(pr.title)))
      .child(h_flex().flex_wrap().gap_x(10).gap_y(3).items_center().text_size(11).text_color(t.muted)
        .child(div().child(pr.author?.login ?? ""))
        .child(h_flex().gap(4).child(div().text_color(t.ansi5).child(pr.headRefName ?? "")).child(div().text_color(t.dim).child("→")).child(div().text_color(t.ansi4).child(pr.baseRefName ?? "")))
        .when(Boolean(rev), (el) => el.child(h_flex().gap(5).items_center().child(pip(t, revTone, 6)).child(div().text_color(toneColor(t, revTone)).child(rev))))
        .when(pr.isDraft, (el) => el.child(div().text_color(t.dim).child("draft")))
        .child(div().text_color(t.ansi2).child(`+${pr.additions ?? 0}`)).child(div().text_color(t.ansi1).child(`-${pr.deletions ?? 0}`))
        .when(pr.changedFiles != null, (el) => el.child(div().text_color(t.dim).child(`${pr.changedFiles} files`)))
        .child(div().text_color(t.dim).child(`opened ${ago(pr.createdAt)} ago`)))
      .when((pr.labels ?? []).length > 0, (el) => el.child(h_flex().flex_wrap().gap(5).children(pr.labels.map((l, i) =>
        div().id(`label-${i}`).relative().px(6).h(18).flex().items_center().text_size(10).text_color(t.foreground)
          .child(dither(`#${l.color ?? "666666"}88`, 1)).child(div().relative().child(l.name))))))
      .child(div().relative().h(2).mt(4).child(dither(t.ansi0, 1)));
    const md = (id, text) => markdown(t, id, text?.trim() ? text : "_No description._", { onLink: (url, cx) => this.app.openUrl(url, cx) });
    const items = d ? this.timeline(d) : [];
    const card = (c, i) => {
      const [what, tone] = c.kind === "review" ? (REVIEW[c.state] ?? [String(c.state ?? "").toLowerCase().replace(/_/g, " "), null])
        : c.kind === "line" ? [`on ${c.path}${c.line ? `:${c.line}` : ""}`, null] : ["", null];
      return v_flex().id(`c-${i}`).relative().gap(4).pl(c.reply ? 26 : 12).pr(4).py(8)
        .child(div().absolute().left(c.reply ? 16 : 2).top(8).bottom(8).w(2).child(dither(tone ? toneColor(t, tone) : t.ansi0, 1)))
        .child(h_flex().gap(8).items_center().text_size(11)
          .child(div().text_color(t.accent).child(c.who ?? "ghost"))
          .when(Boolean(what), (el) => el.child(h_flex().gap(4).items_center().when(Boolean(tone), (e2) => e2.child(pip(t, tone, 6))).child(div().text_color(tone ? toneColor(t, tone) : t.muted).truncate().child(what))))
          .child(div().flex_1())
          .child(div().text_color(t.dim).child(ago(c.at))))
        .when(Boolean(c.body?.trim()), (el) => el.child(md(`c-md-${i}`, c.body)));
    };
    const content = v_flex().absolute().left(0).right(0).top(-this.scrollY).px(16).py(12)
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);
        if (Math.abs(h - this.contentH) > 1) { this.contentH = h; this.scroll(0); cx.notify(); }
      })
      .child(head)
      .child(md(`body-${pr.number}`, d ? pr.body : "_Reading…_"))
      .when(items.length > 0, (el) => el.child(h_flex().pt(18).pb(4).gap(8).items_center()
        .child(eyebrow(t, `Conversation · ${items.length}`))
        .child(div().flex_1().h(2).relative().child(dither(t.ansi0, 1)))))
      .children(items.map(card))
      .when(Boolean(this.composer), (el) => el.child(v_flex().mt(12).gap(6).p(8).border(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(eyebrow(t, "Your comment"))
        .child(Textarea.new(this.composer).w_full().text_size(12).text_color(t.foreground))))
      .child(div().h(24));
    const max = Math.max(1, this.contentH - this.viewH);
    const shown = Math.min(1, this.viewH / Math.max(1, this.contentH));
    const view = div().id("pr-view").relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);
        if (Math.abs(h - this.viewH) > 1) { this.viewH = h; this.scroll(0); cx.notify(); }
      })
      .on_scroll_wheel((e, cx) => { this.scroll(-unzoom(e.delta?.y ?? 0)); cx.notify(); })
      .on_mouse_down("left", (_e, cx) => { this.focus = "main"; cx.stop_propagation(); })
      .child(content)
      // A thin dithered thumb shows where you are.
      .when(shown < 1, (el) => el.child(div().absolute().right(1).w(3).top(Math.round((this.scrollY / max) * this.viewH * (1 - shown))).h(Math.max(16, Math.round(this.viewH * shown)))
        .child(dither(active ? t.accent : t.ansi8, 1))));
    const right = !d ? "reading…" : `read ${readAgo(d.at)}`;
    return panel(t, "pr-main", "Pull request", active, view, { right }).flex_1().h_full();
  }

  render(t, size) {
    const app = this.app, wide = size.width >= 820;
    const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(lo, hi), Math.max(lo, v)));
    const lw = clamp(this.sizes.left ?? Math.min(460, Math.max(300, size.width * 0.38)), 220, size.width - 320);
    const th = clamp(this.sizes.top ?? size.height * 0.45, 120, size.height - 140);
    const leftH = wide ? size.height : th;
    this.checksH = this.sizes.checks ? clamp(this.sizes.checks, 60, leftH - 100) : null;
    const checks = this.checksPanel(t);
    const left = v_flex().min_h(0).h_full()
      .when(wide, (el) => el.w(lw))
      .when(!wide, (el) => el.w_full())
      .child(this.listPanel(t))
      .when(Boolean(checks), (el) => el
        .child(splitter(t, "pr-split-checks", "y", app.dragged("checks"), (e) => app.resize(e, "checks", "y", this.checksH ?? Math.min(this.checks().length, 8) * CHECK_ROW + 26,
          (v) => { this.sizes.checks = v; }, { min: 60, max: leftH - 100, sign: -1 })))
        .child(checks));
    if (!wide) {
      return v_flex().size_full()
        .child(left.h(th).flex_none())
        .child(splitter(t, "pr-split-top", "y", app.dragged("top"), (e) => app.resize(e, "top", "y", th, (v) => { this.sizes.top = v; }, { min: 120, max: size.height - 140 })))
        .child(this.mainPanel(t));
    }
    return h_flex().size_full()
      .child(left.flex_none())
      .child(splitter(t, "pr-split-left", "x", app.dragged("left"), (e) => app.resize(e, "left", "x", lw, (v) => { this.sizes.left = v; }, { min: 220, max: size.width - 320 })))
      .child(this.mainPanel(t));
  }
}

/** A faint sweep for a running check's row. */
function sweepLite(t) {
  return div().absolute().top(0).bottom(0).w(40).opacity(0.35).child(dither(t.working, 1))
    .loop("left", { from: -40, to: 600, period: 2200, easing: "linear" });
}
