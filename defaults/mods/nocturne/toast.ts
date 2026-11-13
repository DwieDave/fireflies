// Notifications ({ role: "toast" }), in Nocturne's look: a square card with
// a dithered edge in the level's color, a pip, the title and one body line.
// Fireflies opens one per notify() with the notification as props
// ({ title, body, level, icon, action, overlay }), 340 x 72, bottom right.
// Click runs its action (e.g. go to the agent) and dismisses it.
// An agent's own toast (Fireflies' "… needs you", going to the agent) says what
// it asks when the notifications mod knows (shared ITEMS: "wants to run a
// command", the command), and a click opens that request in its overview.
//
// By key: every toast on screen is listed in shared(TOASTS), newest last;
// nocturne.toast runs the newest one's action as a click would, and
// nocturne.toast-close (or its alias nocturne.toast-dismiss) dismisses it
// (sky.ts's command loop calls toastKey).

import { div, svg, image } from "gpui-kit";
import type { Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";
import { isNumber, isString, nullable, object, readSharedList, sharedKey, sharedListKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { argsOf, commandOf, isStoredCommand, storedCommand } from "./guards.ts";
import type { Command } from "./guards.ts";
import { ART, dither } from "./kit.ts";

// The level's theme color: the same words the fireflies use for status.
const COLOR: ReadonlyMap<string, "blocked" | "working" | "done" | "accent"> = new Map([["error", "blocked"], ["warning", "working"], ["success", "done"], ["info", "accent"]]);

/** The props a toast is opened with: the notification (Fireflies' notify()); its level is
 *  info, success, warning or error (another reads as info). */
const isToastProps = object({}, {
  title: isString, body: isString, level: isString, icon: isString, action: nullable(isStoredCommand), overlay: isString,
});

/** A toast's notification, as the mod reads it: its action a command. */
export interface ToastProps {
  readonly title?: string;
  readonly body?: string;
  readonly level?: string;
  readonly icon?: string;
  readonly action: Command | null;
  readonly overlay?: string;
}

/** A toast's props, read. */
function toastOf(p: Guarded<typeof isToastProps>): ToastProps {
  const { action, ...rest } = p;

  return { ...rest, action: action ? commandOf(action) : null };
}

/** This toast's props, proven (else none). */
const toastProps = (): ToastProps => {
  const p = props();

  return isToastProps(p) ? toastOf(p) : { action: null };
};

// notifications' items and the request its overview opens on.
/** An item of the notifications mod (its model.ts), as far as a toast reads it. */
const isItem = object({ address: isString, type: isString }, { title: nullable(isString), line: nullable(isString) });

type Item = Guarded<typeof isItem>;

const ITEMS = sharedListKey("notifications.items", isItem);
const OPEN = sharedKey("notifications.open", object({ terminal: isString, at: isNumber }));

/** shared() key: the toasts on screen, [{ overlay, action, at }], newest last. */
export const TOASTS = "nocturne.toasts";

const isListed = object({ overlay: isString, at: isNumber }, { action: nullable(isStoredCommand) });

/** A toast on screen: its overlay, its action, when it came. */
interface Listed {
  readonly overlay: string;
  readonly action: Command | null;
  readonly at: number;
}

const TOASTS_KEY = sharedListKey(TOASTS, isListed);

// A toast that went without saying so (the app quit) is forgotten after this.
const STALE = 10 * 60_000;

const listed = (): Listed[] => readSharedList(shared, TOASTS_KEY).flatMap((x) => (Date.now() - x.at < STALE ? [{ overlay: x.overlay, at: x.at, action: x.action ? commandOf(x.action) : null }] : []));
const store = (list: readonly Listed[]) => setShared(TOASTS, list.map((x) => ({ overlay: x.overlay, action: x.action ? storedCommand(x.action) : null, at: x.at })));

/** What a click on a toast does: its request's overview, else its action; then it goes. */
export function act(p: Pick<ToastProps, "action" | "overlay">): void {
  const ask = request(p);

  if (ask) {
    writeShared(setShared, OPEN, { terminal: ask.address, at: Date.now() });
    run("notifications.open");
  } else if (p.action?.name) run(p.action.name, argsOf(p.action));

  if (p.overlay) closeOverlay(p.overlay);
}

/** nocturne.toast (run the newest toast's action) and nocturne.toast-close /
 *  nocturne.toast-dismiss (dismiss it). */
export function toastKey(command: string): boolean {
  const last = listed().at(-1);

  if (!last) return false;

  store(listed().filter((x) => x.overlay !== last.overlay));

  if (command === "toast") act(last);
  else closeOverlay(last.overlay);

  return true;
}

/** The notifications mod's request for an agent's toast, if it has one. */
function request(p: Pick<ToastProps, "action">): Item | null {
  const action = p.action;

  if (action?.name !== "agent.focus") return null;

  const terminal = action.args?.get("terminal");

  return readSharedList(shared, ITEMS).find((x) => x.address === terminal && x.type !== "other") ?? null;
}

export default class Toast {
  init(raw: Props | undefined): void {
    const overlay = isToastProps(raw) ? raw.overlay : undefined;

    if (!overlay) return;

    store([...listed().filter((x) => x.overlay !== overlay), { overlay, action: isToastProps(raw) ? toastOf(raw).action : null, at: Date.now() }]);
  }

  /** The toast is going (timed out, clicked, dismissed): off the list. */
  closing(): void {
    const id = toastProps().overlay;

    if (listed().some((x) => x.overlay === id)) store(listed().filter((x) => x.overlay !== id));
  }

  render(): Element {
    const t = theme();
    const p = toastProps();
    const ask = request(p);
    const color = t[COLOR.get(p.level ?? "") ?? "accent"];
    const urgent = p.level === "error" || p.level === "warning";

    const mark = p.icon
      ? image(p.icon).size(16).flex_none()
      : svg(`${ART}/pip.svg`).size(8).flex_none().text_color(color)
        .when(urgent, (el) => el.loop("opacity", { from: 0.25, to: 1, period: p.level === "error" ? 700 : 1400, easing: "linear" }));

    const line = ask?.line ?? p.body;

    return h_flex().id("nocturne-toast").relative().size_full().bg(t.background).border(1).border_color(t.ansi0)
      .cursor_pointer()
      .on_click(() => act(p))
      // A dithered stripe down the left edge in the level's color.
      .child(div().relative().w(6).h_full().flex_none().child(dither(color, 1)))
      .child(h_flex().relative().flex_1().min_w(0).h_full().px(12).gap(12).items_center()
        .hover((s) => s.bg(`${t.ansi0}55`))
        .child(div().w(16).flex_none().flex().items_center().justify_center().child(mark))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().truncate().text_size(12).text_color(urgent ? color : t.foreground).child(ask?.title ?? p.title ?? ""))
          .when(Boolean(line), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(line ?? "")))))
      // The horizon line, like the tab strip's.
      .child(div().absolute().left(6).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }
}
