// The Pull requests tab's pieces drawn from data alone (prs.ts places them):
// a row of the list, a row of the checks (a sweep while it runs), the PR's
// header, an entry of its conversation, and the words for a review's verdict.

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { isNumber } from "./guard.ts";
import type { CheckRow, PrRow, PrView, Tone } from "./model.ts";
import { rowTone, ago, duration } from "./model.ts";
import { dither, pip, band, toneColor, TONE_WORD, stop } from "./kit.ts";

/** A row of the list, and of the checks, is this tall. */
export const ROW = 38, CHECK_ROW = 22;

/** A review's verdict, as words and a tone. */
export const REVIEW = new Map<string, readonly [string, Tone]>([
  ["APPROVED", ["approved", "done"]], ["CHANGES_REQUESTED", ["changes requested", "failed"]], ["REVIEW_REQUIRED", ["review required", "queued"]],
]);

/** One entry of the conversation, oldest first: a comment, a review, a comment on a line. */
export type Said =
  | { readonly kind: "comment"; readonly who: string | null; readonly body: string; readonly at: string | null; readonly url: string | null }
  | { readonly kind: "review"; readonly state: string; readonly who: string | null; readonly body: string; readonly at: string | null }
  | {
    readonly kind: "line"; readonly who: string | null; readonly body: string; readonly at: string | null; readonly path: string;
    readonly line: number | null; readonly reply: boolean; readonly url: string | null;
  };

/** A row of the list: its number and title, then author, branch, review, size and age. */
export function prRow(t: Theme, p: PrRow, sel: boolean, active: boolean): Element {
  const tone = rowTone(p);
  const [rev, revTone] = REVIEW.get(p.reviewDecision ?? "") ?? [null, null];

  return v_flex().id(`pr-${p.number}`).relative().h(ROW).w_full().pl(10).pr(8).justify_center().flex_none()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(sel, (el) => el.children(band(t, active)))
    .child(h_flex().relative().gap(7).items_center().text_size(12)
      .child(pip(t, tone ?? (p.isDraft ? "skipped" : null), 7))
      .child(div().flex_none().text_color(sel ? t.accent : t.ansi8).child(`#${p.number}`))
      .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : p.isDraft ? t.dim : t.muted).child(p.title)))
    .child(h_flex().relative().gap(6).pl(14).items_center().text_size(10).text_color(t.dim)
      .child(div().flex_none().child(p.author?.login ?? ""))
      .child(div().flex_1().min_w(0).truncate().child(p.headRefName ?? ""))
      .when(rev !== null, (el) => el.child(div().flex_none().text_color(toneColor(t, revTone)).child(rev ?? "")))
      .when(p.isDraft, (el) => el.child(div().flex_none().child("draft")))
      .child(div().flex_none().text_color(t.ansi2).child(`+${p.additions}`))
      .child(div().flex_none().text_color(t.ansi1).child(`-${p.deletions}`))
      .child(div().flex_none().child(ago(p.updatedAt))));
}

/** The PR's header on the right: number and title, who, branches, review, size, age; its labels. */
export function prHead(t: Theme, pr: PrView): Element {
  const [rev, revTone] = REVIEW.get(pr.reviewDecision ?? "") ?? [null, null];
  const labels = pr.labels ?? [];
  const opened = ago(pr.createdAt);

  return v_flex().gap(6).pb(10)
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_size(15).text_color(t.accent).child(`#${pr.number}`))
      .child(div().flex_1().min_w(0).text_size(15).text_color(t.foreground).child(pr.title)))
    .child(h_flex().flex_wrap().gap_x(10).gap_y(3).items_center().text_size(11).text_color(t.muted)
      .child(div().child(pr.author?.login ?? ""))
      .child(h_flex().gap(4).child(div().text_color(t.ansi5).child(pr.headRefName ?? "")).child(div().text_color(t.dim).child("→")).child(div().text_color(t.ansi4).child(pr.baseRefName ?? "")))
      .when(rev !== null, (el) => el.child(h_flex().gap(5).items_center().child(pip(t, revTone, 6)).child(div().text_color(toneColor(t, revTone)).child(rev ?? ""))))
      .when(Boolean(pr.isDraft), (el) => el.child(div().text_color(t.dim).child("draft")))
      .child(div().text_color(t.ansi2).child(`+${pr.additions ?? 0}`)).child(div().text_color(t.ansi1).child(`-${pr.deletions ?? 0}`))
      .when(isNumber(pr.changedFiles), (el) => el.child(div().text_color(t.dim).child(`${pr.changedFiles ?? 0} files`)))
      // A list row has no createdAt (the list's query doesn't ask): the words wait for the PR's view.
      .when(opened !== "", (el) => el.child(div().text_color(t.dim).child(`opened ${opened} ago`))))
    .when(labels.length > 0, (el) => el.child(h_flex().flex_wrap().gap(5).children(labels.map((l, i) =>
      div().id(`label-${i}`).relative().px(6).h(18).flex().items_center().text_size(10).text_color(t.foreground)
        .child(dither(`#${l.color ?? "666666"}88`, 1)).child(div().relative().child(l.name))))))
    .child(div().relative().h(2).mt(4).child(dither(t.ansi0, 1)));
}

/** One entry of the conversation: who and what (a review's verdict, the line a comment is on), when, its words (`md` draws them). */
export function saidCard(t: Theme, c: Said, i: number, md: (id: string, text: string) => Element): Element {
  const [what, tone] = c.kind === "review" ? REVIEW.get(c.state) ?? [c.state.toLowerCase().replace(/_/g, " "), null]
    : c.kind === "line" ? [`on ${c.path}${c.line ? `:${c.line}` : ""}`, null] : ["", null];

  const reply = c.kind === "line" && c.reply;

  return v_flex().id(`c-${i}`).relative().gap(4).pl(reply ? 26 : 12).pr(4).py(8)
    .child(div().absolute().left(reply ? 16 : 2).top(8).bottom(8).w(2).child(dither(tone ? toneColor(t, tone) : t.ansi0, 1)))
    .child(h_flex().gap(8).items_center().text_size(11)
      .child(div().text_color(t.accent).child(c.who ?? "ghost"))
      .when(Boolean(what), (el) => el.child(h_flex().gap(4).items_center().when(tone !== null, (e2) => e2.child(pip(t, tone, 6))).child(div().text_color(tone ? toneColor(t, tone) : t.muted).truncate().child(what))))
      .child(div().flex_1())
      .child(div().text_color(t.dim).child(ago(c.at))))
    .when(Boolean(c.body.trim()), (el) => el.child(md(`c-md-${i}`, c.body)));
}

/** A check of the selected PR: its tone, workflow / name, how long it ran (a sweep while it runs); `onClick` opens it. */
export function checkRow(t: Theme, c: CheckRow, i: number, sel: boolean, onClick: (cx: Context) => void): Element {
  return h_flex().id(`check-${i}`).relative().h(CHECK_ROW).px(10).gap(7).items_center().flex_none().text_size(11)
    .hover((s) => s.bg(`${t.ansi0}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => onClick(cx))
    .when(sel, (el) => el.children(band(t, true)))
    .when(c.tone === "working", (el) => el.child(div().absolute().inset_0().overflow_hidden().child(sweepLite(t))))
    .child(pip(t, c.tone, 7))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
    .child(div().relative().flex_none().text_color(c.tone === "working" ? t.working : t.dim).child(c.started ? duration(c.started, c.ended) : TONE_WORD[c.tone]));
}

/** A faint sweep for a running check's row. */
function sweepLite(t: Theme): Element {
  return div().absolute().top(0).bottom(0).w(40).opacity(0.35).child(dither(t.working, 1))
    .loop("left", { from: -40, to: 600, period: 2200, easing: "linear" });
}
