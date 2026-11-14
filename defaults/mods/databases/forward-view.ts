// The ask before a connection whose port-forward is down (forward.ts): the
// overview Developer asked for (which context, namespace, target and port it
// reaches for, onto which local port, the exact kubectl command it runs), and
// what to do: start it and connect (enter), connect anyway (c), cancel (esc);
// a pod that's gone offers the Kubernetes window (k) to pick it again; a port
// another program holds offers the forward on another local port.

import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { chip, pip } from "./kit.ts";
import { forwardArgv } from "./kube.ts";
import { connectNow } from "./conns.ts";
import { openKubernetes, startForward } from "./forward.ts";
import type { ForwardAsk, Taken } from "./state.ts";
import type { default as DbView } from "./main.ts";

/** The ask's title. */
export function askTitle(a: ForwardAsk): string {
  const local = a.conn.forward?.local ?? a.local;

  if (a.why === "taken") return `localhost:${local} answers, but not as ${a.conn.name}'s database`;

  if (a.why === "gone") return `${a.conn.forward?.target ?? "its target"} isn't there any more`;

  return `No forward on localhost:${local}`;
}

/** The ask's buttons: key, words, what it does (the panel's chips and the keys are one list). */
export function askActions(v: DbView, a: ForwardAsk): { readonly key: string; readonly label: string; readonly go: (cx: Context) => void }[] {
  const start = { key: "enter", label: a.why === "taken" ? `start the forward on localhost:${a.local} and connect` : a.why === "gone" ? "try to start it again" : "start the forward and connect", go: (cx: Context) => void startForward(v, a, cx, (c) => void connectNow(v, c, cx)) };
  const anyway = { key: "c", label: "connect anyway", go: (cx: Context) => { v.forwardAsk = null; void connectNow(v, a.conn, cx); } };
  const k8s = { key: "k", label: "open Kubernetes to pick it again", go: () => openKubernetes(v, a.conn) };
  const cancel = { key: "esc", label: "cancel", go: () => { v.forwardAsk = null; } };

  // While it starts, only cancel (the ask goes; the forward keeps coming up).
  if (a.starting !== null) return [cancel];

  return [start, ...(a.why === "gone" && v.k8s ? [k8s] : []), ...(a.why === "taken" ? [] : [anyway]), cancel];
}

/** A key while the ask is up: its buttons' keys; the rest is taken (nothing types here). */
export function forwardAskKey(v: DbView, a: ForwardAsk, e: KeyEvent, cx: Context): Taken {
  const key = e.key === "escape" ? "esc" : e.key;
  askActions(v, a).find((x) => x.key === key)?.go(cx);
  cx.notify();

  return true;
}

/** One line of the overview: its name, its value. */
const fact = (t: Theme, name: string, value: string, color: Color): Element => h_flex().gap(10).items_start()
  .child(div().w(84).flex_none().text_color(t.dim).child(name))
  .child(div().flex_1().min_w(0).text_color(color).child(value));

/** The command it runs: one piece per argument, so a line breaks only between arguments; a click
 *  copies it. */
function commandRow(t: Theme, v: DbView, argv: readonly string[]): Element {
  const line = argv.join(" ");

  return h_flex().id("db-fwd-command").gap(10).items_start().cursor_pointer().tooltip("A click copies it")
    .on_click((_e, cx) => {
      cx.stop_propagation();
      cx.write_to_clipboard(line);
      v.say(`copied: ${line}`, "done");
      cx.notify();
    })
    .child(div().w(84).flex_none().text_color(t.dim).child("runs"))
    .child(h_flex().flex_1().min_w(0).flex_wrap().gap_x(6).children(argv.map((a, i) => div().id(`db-fwd-arg-${i}`).flex_none().text_color(t.ansi3).child(a))))
    .child(div().flex_none().text_color(t.accent).child("copy"));
}

/** The ask, over the window. */
export function forwardAskPanel(t: Theme, v: DbView, a: ForwardAsk, centered: (id: string, box: Element, close: (cx: Context) => void) => Element): Element {
  const f = a.conn.forward;

  if (!f) return div();

  const shown = { ...f, local: a.local };
  const secs = a.starting === null ? 0 : Math.floor((Date.now() - a.starting) / 1000);

  const box = v_flex().id("db-fwd-box").w(Math.min(620, v.size.width - 40)).bg(t.background).border(1).border_color(a.why === "down" ? t.accent : t.ansi3).p(14).gap(10)
    .child(div().text_color(t.foreground).child(askTitle(a)))
    .child(div().text_size(10).text_color(t.dim).child(a.why === "taken"
      ? "another program holds that port: the forward can run on another one (the connection follows it)"
      : `${a.conn.name} came from a port-forward; nothing is started unless you say so`))
    .child(v_flex().gap(4).text_size(11)
      .child(fact(t, "context", f.context, t.foreground))
      .child(fact(t, "namespace", f.namespace, t.foreground))
      .child(fact(t, "target", `${f.target} :${f.remote}  →  localhost:${a.local}`, t.ansi6))
      .child(commandRow(t, v, forwardArgv(shown))))
    .when(a.starting !== null, (el) => el.child(h_flex().id("db-fwd-starting").gap(6).items_center()
      .child(pip(t.working, 6, true)).child(div().text_color(t.muted).child(`starting the forward… ${secs} s · it stays up when this window closes`))))
    .when(a.note !== null, (el) => el.child(div().id("db-fwd-note").text_size(11).text_color(t.blocked).child(a.note ?? "")))
    .child(h_flex().gap(8).justify_end().flex_wrap()
      .children(askActions(v, a).map((x, i) => chip(t, `db-fwd-${i}`, `${x.key}  ${x.label}`, false, (cx) => x.go(cx), i === 0 ? t.accent : null))));

  return centered("db-fwd", box, () => {
    v.forwardAsk = null;
  });
}
