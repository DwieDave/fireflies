// The Actions tab's panels (actions.ts places them): the runs (and their
// right-click menu), the run's job graph, the job's steps and the step's
// log, each drawn from the tab's state; clicks move its selection and focus
// as its keys do.

import { div } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import type { Pt } from "@fireflies/menu-place";
import { h_flex, v_virtual_list, v_flex } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Option } from "effect";
import type { LogLine, Run } from "./model.ts";
import type { PickRow } from "./host.ts";
import { tone, duration, ago } from "./model.ts";
import type { Tone } from "./model.ts";
import { dither, dithered, lit, pip, panel, empty, TONE_WORD, sweep, stop, unzoom, unzoomSize, chip, within } from "./kit.ts";
import { canvas, layout, NW, NH } from "./graph.ts";
import type { default as Actions } from "./actions.ts";
import { ROW, STEP, LINE } from "./actions.ts";
import { edge } from "@fireflies/tones";
import { rectOf, rowAt } from "./menus.ts";

/** A row's hover: nocturne's edge tone at a third, upstream's hover fill. */
export const hovered = (t: Theme): Color => (dithered() ? `${edge(t)}55` : t.hover);

/** A run's time: how long while it runs, how long ago once it passed, else how it ended. */
function runWhen(r: Run, k: Tone, now: number): string {
  if (k === "working" || k === "queued") return duration(r.run_started_at, null, now);

  return k === "done" ? ago(r.updated_at, now) : TONE_WORD[k];
}

/** A run in the list: its tone, workflow and title; number, branch, event, how long or how long ago. */
export function runRow(t: Theme, r: Run, sel: boolean, active: boolean, now: number): Element {
  const k = tone(r.status, r.conclusion);
  const live = k === "working" || k === "queued";
  const row = v_flex().id(`run-${r.id}`).relative().h(ROW).w_full().pl(10).pr(8).justify_center().flex_none().overflow_hidden().hover((s) => s.bg(hovered(t)));

  return (sel ? lit(t, row, active) : row)
    .when(k === "working", (el) => el.child(sweep(t, t.working, 420)))
    .child(h_flex().relative().gap(7).items_center().text_size(12)
      .child(pip(t, k, 7))
      .child(div().flex_none().text_color(sel ? t.foreground : t.muted).child(r.name ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.display_title ?? "")))
    .child(h_flex().relative().gap(6).pl(14).items_center().text_size(10).text_color(t.dim)
      .child(div().flex_none().text_color(sel ? t.accent : t.muted).child(`#${r.run_number ?? ""}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.ansi5).child(r.head_branch ?? ""))
      .child(div().flex_none().child(r.event ?? ""))
      .child(div().flex_none().text_color(live ? t.working : t.dim).child(runWhen(r, k, now))));
}

/** The runs list's word on the right of its title: waiting for a dispatched run, how many run, how many there are. */
function runsWord(v: Actions, list: readonly Run[]): string {
  if (v.waiting !== null) return "waiting for the run…";

  const running = Arr.filter(list, (r) => r.status === "in_progress").length;

  if (running > 0) return `${running} running`;

  return v.runs === null ? "" : `${list.length}`;
}

/** A run's place in the list by its row key. */
const runAt = (list: readonly Run[], key: string): number => Option.getOrElse(Arr.findFirstIndex(list, (r) => String(r.id) === key), () => -1);

/** The runs down the left, the run-workflow chip on its title; right-click for the menu. */
export function runsPanel(v: Actions, t: Theme): Element {
  const list = v.list(), cur = v.run(), active = v.focus === "runs", now = v.app.now();

  const body = v.runs === null ? empty(t, "Reading runs…", null, { small: true })
    : list.length === 0 ? empty(t, "No runs", v.filter === null ? "This repo hasn't run a workflow yet." : `Nothing ran on ${v.filter.label}. b shows every run.`, { moon: 1 })
    : div().size_full().pt(2)
      .on_bounds_change((b) => v.app.keepBox("runs", rectOf(b)))
      .on_mouse_down("left", (_e, cx) => {
        v.focus = "runs";
        v.app.focusSelf();
        cx.stop_propagation();
      })
      .child(v_virtual_list("runs", list.length, ROW, (i) => String(list[i]?.id ?? i),
        (range) => Arr.map(within(list, range.start, range.end), (r) => runRow(t, r, r === cur, active, now)))
        .on_item_click((key, cx) => {
          v.focus = "runs";
          v.selectRun(runAt(list, key));
          cx.notify();
        })
        // A right-click on a run: that run's menu, at the pointer.
        .on_item_secondary_click((key, e, cx) => {
          cx.stop_propagation();
          v.focus = "runs";
          v.selectRun(runAt(list, key));
          runsMenu(v, e);
          cx.notify();
        })
        .size_full().track_scroll(v.runsScroll));

  const right = h_flex().gap(6).items_center()
    .child(div().text_color(v.waiting === null ? t.dim : t.working).child(runsWord(v, list)))
    .child(chip(t, "run-workflow", "▶ run workflow", false, (cx) => v.runWorkflow(cx), t.accent));

  return panel(t, "runs", v.filter === null ? "Runs" : `Runs · ${v.filter.label}`, active, body, { right })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      runsMenu(v, e);
      cx.notify();
    });
}

/** The runs' menu: what can be done from here, at the press `e`, else beside the selected run. */
export function runsMenu(v: Actions, e: { readonly position: Pt } | null = null): void {
  const r = v.run();
  const rows: PickRow[] = [{ label: "Run a workflow…", sub: "n", go: (cx) => v.runWorkflow(cx) }];

  if (r !== null) {
    const n = r.run_number ?? "";
    const url = r.html_url ?? "";

    rows.push({ label: `Re-run the failed jobs of #${n}`, sub: "R", go: (cx) => v.act("failed", cx) },
      { label: `Re-run #${n}`, sub: "A", go: (cx) => v.act("all", cx) },
      { label: `Cancel #${n}`, sub: "X", go: (cx) => v.act("cancel", cx) });

    if (url !== "") rows.push({ label: `#${n} in the browser`, sub: "o", go: (cx) => v.app.openUrl(url, cx) });
  }

  v.app.picker = { title: "ACTIONS", at: 0, rows, near: e === null ? rowAt(v.app, "runs", v.runIndex(), ROW, v.runsScroll, 2) : v.app.pressAt(e) };
}

/** Where the graph's top left corner stands in its panel. */
interface Pan {
  readonly x: number;
  readonly y: number;
}

/** Where the graph stands in its panel: centred when it fits, else panned to keep the selected job in view. */
function graphPan(v: Actions, g: ReturnType<typeof layout>): Pan {
  if (v.pan !== null) return v.pan;

  const n = Option.getOrNull(Arr.findFirst(g.nodes, (x) => x.job.id === v.jobSel));
  const { width: W, height: H } = v.graphSize;
  let px = g.width <= W ? Math.round((W - g.width) / 2) : 0, py = g.height <= H ? Math.round((H - g.height) / 2) : 0;

  if (n !== null && g.width > W) px = Math.min(0, Math.max(W - g.width, Math.round(W / 2 - (n.x + NW / 2))));

  if (n !== null && g.height > H) py = Math.min(0, Math.max(H - g.height, Math.round(H / 2 - (n.y + NH / 2))));

  return { x: px, y: py };
}

/** The graph's ground: dragged (or scrolled) to move it, double-clicked to bring the selected job back. */
function graphGround(v: Actions, at: Pan, el: Element): Element {
  const { width: W, height: H } = v.graphSize;

  const end = (cx: Context) => {
    if (v.drag === null) return;

    v.drag = null;
    cx.notify();
  };

  return div().id("graph-view").relative().size_full().overflow_hidden()
    .when(v.drag !== null, (d) => d.cursor_grabbing()).when(v.drag === null, (d) => d.cursor_grab())
    .on_size_change((drawn, cx) => {
      const size = unzoomSize(drawn);

      if (Math.abs(size.width - W) > 1 || Math.abs(size.height - H) > 1) {
        v.graphSize = size;
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      v.pan = { x: Math.round(at.x + unzoom(e.delta.x)), y: Math.round(at.y + unzoom(e.delta.y)) };
      cx.notify();
    })
    .on_mouse_down("left", (e, cx) => {
      v.focus = "graph";
      v.app.focusSelf();
      cx.stop_propagation();
      v.pan = e.click_count === 2 ? null : v.pan;
      v.drag = e.click_count === 2 ? null : { x: e.position.x, y: e.position.y, from: at };
      cx.notify();
    })
    .on_mouse_move((e, cx) => {
      const d = v.drag;

      if (d === null) return;

      v.pan = { x: Math.round(d.from.x + unzoom(e.position.x - d.x)), y: Math.round(d.from.y + unzoom(e.position.y - d.y)) };
      cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => end(cx))
    .on_hover((h, cx) => {
      if (!h) end(cx);
    })
    .child(el);
}

/** The selected run's jobs as a graph: panned to keep the selected job in view, dragged or scrolled by hand. */
export function graphPanel(v: Actions, t: Theme): Element {
  const r = v.run(), cols = v.columns(), active = v.focus === "graph";
  const title = r === null ? "Run" : `${r.name ?? ""} #${r.run_number ?? ""}`;

  if (r === null) return panel(t, "graph", title, active, empty(t, "No run selected", null, { small: true }));

  if (v.jobsOf(r) === null) return panel(t, "graph", title, active, empty(t, "Reading jobs…", null, { small: true }));

  if (cols.length === 0) return panel(t, "graph", title, active, empty(t, "No jobs yet", "The run hasn't started its jobs.", { small: true }));

  const now = v.app.now();
  const at = graphPan(v, layout(cols, v.parents(), r));

  const c = canvas(t, r, cols, v.parents(), v.jobSel, active, (node, cx) => {
    v.focus = "graph";
    v.jobSel = node.job.id;
    v.stepSel = null;
    v.loadLog();
    v.app.focusSelf();
    cx.notify();
  }, at.x, at.y, now);

  const k = tone(r.status, r.conclusion);
  const right = `${TONE_WORD[k]} · ${duration(r.run_started_at, k === "working" || k === "queued" ? null : r.updated_at, now)}`;

  return panel(t, "graph", title, active, graphGround(v, at, c.el), { right });
}

/** A step's color: running, failed, else dim. */
const stepColor = (t: Theme, k: Tone): Color => {
  if (k === "working") return t.working;

  return k === "failed" ? t.blocked : t.dim;
};

/** A step's name's color: skipped dim, the chosen one bright. */
const stepName = (t: Theme, k: Tone, sel: boolean): Color => {
  if (k === "skipped") return t.dim;

  return sel ? t.foreground : t.muted;
};

/** The selected job's steps as a timeline, the chosen one in view. */
export function stepsPanel(v: Actions, t: Theme): Element {
  const j = v.job(), steps = v.steps(), cur = v.step(), active = v.focus === "steps", now = v.app.now();

  if (j === null) return panel(t, "steps", "Steps", active, empty(t, "No job selected", null, { small: true }));

  const rows = Arr.map(steps, (s) => {
    const k = tone(s.status, s.conclusion), sel = s === cur;

    const row = h_flex().id(`step-${s.number}`).relative().h(STEP).px(10).gap(8).items_center().flex_none().text_size(11).overflow_hidden()
      .hover((st) => st.bg(hovered(t)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        v.focus = "steps";
        v.stepSel = s.number;
        v.logAt = 0;
        v.app.focusSelf();
        cx.notify();
      });

    return (sel ? lit(t, row, active) : row)
      .when(k === "working", (el) => el.child(sweep(t, t.working, 360)))
      // The timeline's thread: a line through every pip (dithered in nocturne).
      .child(div().absolute().left(13).top(0).bottom(0).w(1).child(dither(edge(t), 1)))
      .child(div().relative().w(8).flex_none().flex().justify_center().child(pip(t, k, 7)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(stepName(t, k, sel)).child(s.name))
      .child(div().relative().flex_none().text_color(stepColor(t, k)).child(k === "skipped" ? "skipped" : duration(s.started_at, s.completed_at, now)));
  });

  const k = tone(j.status, j.conclusion);

  // The chosen step stays in view: j / k past the edge, a new job whose
  // running or failed step is further down.
  const at = cur === null ? -1 : Option.getOrElse(Arr.findFirstIndex(steps, (s) => s === cur), () => -1), key = `${j.id}:${at}`;

  if (at >= 0 && key !== v.stepsAt) {
    v.stepsAt = key;
    v.stepsScroll.scroll_to_item(at);
  }

  const body = steps.length === 0 ? empty(t, k === "queued" ? "Waiting for a runner…" : "No steps", null, { small: true })
    : div().id("steps-body").size_full().overflow_y_scroll().track_scroll(v.stepsScroll).py(2).children(rows);

  return panel(t, "steps", j.name ?? "", active, body, { right: `${Arr.filter(steps, (s) => s.status === "completed").length}/${steps.length}` });
}

/** What the log panel says while its job runs: the step's state. */
function runningWord(name: string, sk: Tone, started: string | null | undefined, now: number): string {
  if (sk === "working") return `${name} is running · ${duration(started, null, now)}`;

  return sk === "queued" ? "Not started yet" : `${name}: ${TONE_WORD[sk]}`;
}

/** The log's lines, one row each (an error's on a red ground). */
function logLines(v: Actions, t: Theme, id: string, lines: readonly LogLine[]): Element {
  const code = settings().font_family === "" ? "JetBrains Mono" : settings().font_family;
  const color = { group: t.accent, error: t.blocked, warning: t.ansi3, notice: t.ansi4, debug: t.dim, plain: t.muted } satisfies { readonly [K in LogLine["kind"]]: Color };

  return div().size_full().px(8).py(2)
    .on_size_change((size, cx) => {
      const shown = Math.max(1, Math.floor((unzoom(size.height) - 4) / LINE));

      if (shown !== v.logVis) {
        v.logVis = shown;
        cx.notify();
      }
    })
    .on_mouse_down("left", (_e, cx) => {
      v.focus = "log";
      v.app.focusSelf();
      cx.stop_propagation();
    })
    .child(v_virtual_list(id, lines.length, LINE, (i) => String(i),
      (range) => Arr.map(within(lines, range.start, range.end), (l, n) => h_flex().h(LINE).w_full().gap(8).items_center().font_family(code).text_size(11.5)
        .when(l.kind === "error", (el) => el.bg(`${t.blocked}1c`))
        .child(div().w(38).flex_none().text_right().text_color(edge(t)).child(String(range.start + n + 1)))
        .child(div().flex_1().min_w(0).truncate().text_color(color[l.kind]).child(l.kind === "group" ? `▸ ${l.text}` : l.text === "" ? " " : l.text))))
      .size_full().track_scroll(v.logScroll));
}

/** The chosen step's log (once the job is done: GitHub hands out no partial logs). */
export function logPanel(v: Actions, t: Theme): Element {
  const j = v.job(), s = v.step(), active = v.focus === "log";
  const title = s === null ? "Log" : `Log · ${s.name}`;

  if (j === null || s === null) return panel(t, "log", title, active, empty(t, "Pick a step", null, { small: true }));

  const k = tone(j.status, j.conclusion), sk = tone(s.status, s.conclusion);
  const got = v.logs.get(j.id);
  const lines = v.logLines();
  let body: Element;

  if (j.status !== "completed") {
    body = empty(t, runningWord(s.name, sk, s.started_at, v.app.now()),
      "GitHub hands out a job's log once the job finishes; the steps move live meanwhile, and the log lands here when it's done.", { moon: k === "working" ? 4 : 0 });
  } else if (got === undefined) body = empty(t, "Reading the log…", null, { small: true });
  else if ("error" in got) body = empty(t, "The log didn't come", got.error, { small: true });
  else if (lines.length === 0) body = empty(t, sk === "skipped" ? "Skipped" : "Nothing logged for this step", null, { small: true });
  else body = logLines(v, t, `log-${j.id}-${s.number}`, lines);

  return panel(t, "log", title, active, body, { right: got !== undefined && !("error" in got) ? `${lines.length} lines` : "" });
}
