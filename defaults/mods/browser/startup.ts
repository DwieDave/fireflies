// A web pane starting (main.ts init, after its role): its tabs restored, the
// address field and who has the keyboard, and the loops it lives on: the tabs
// shown lately, its web views' events, its commands.

import type { AsyncContext } from "gpui-kit";
import { InputState } from "gpui-base";
import { nextCommand } from "herdr";
import * as Tabs from "./tabs.ts";
import { available } from "./props.ts";
import { target, openCommand } from "./address.ts";
import { noteShown } from "./away.ts";
import { showCommand } from "./tab-menu.ts";
import type Browser from "./main.ts";

/** The tabs (tabs.ts), each its own web view: the ones saved, else one on
 *  the props' page (`url`), else the page this pane had before it kept tabs. A
 *  tab's view is created on its `start`; later pages go through navigate
 *  calls (new props would rebuild the view). */
export function restoreTabs(view: Browser, url: string | null | undefined): void {
  let saved: string | null = null, savedTabs: string | null = null, zoom = 0.9;

  try {
    saved = localStorage.getItem("url");
    savedTabs = localStorage.getItem("tabs");
    // Page zoom, per tab: a step under the UI's size by default.
    zoom = Number(localStorage.getItem("zoom")) || 0.9;
  } catch {
    /* none kept */
  }

  view.tabs = (savedTabs && Tabs.restore(savedTabs, zoom)) || Tabs.single(url ? target(url) : saved, zoom);
}

/** The address field and the keyboard: a blank pane types into the field; one
 *  opened as the focused pane (a link beside a terminal) gives the bar the keyboard. */
export function addressInput(view: Browser, cx: AsyncContext): void {
  const handle = cx.focus_handle();
  const input = InputState.new({ placeholder: "address or search" });

  view.handle = handle;
  view.input = input;
  input.on("submit", (_e, cx) => {
    view.go(input.value(), cx);
  });
  input.on("blur", (_e, cx) => {
    if (view.start) {
      view.editing = false;
      cx.notify();
    }
  });
  view.editing = !view.start;

  if (view.editing) cx.timer.after(150, () => input.focus());
  // Opened as the focused pane (a link beside a terminal): the bar takes the keyboard.
  else {
    for (const ms of [0, 120, 400]) {
      cx.timer.after(ms, () => {
        if (view.ownSlot && view.isFocusedPane() && !handle.is_focused() && !view.editing) {
          view.claim();
          handle.focus();
        }
      });
    }
  }
}

/** The loops the pane lives on: the tabs shown lately, its web views' events, its commands. */
export function listen(view: Browser, cx: AsyncContext): void {
  // The tabs shown lately (newest last, `{ space, tab }`): picture in picture
  // puts this tab away and shows the one before. Polled gently: a mod isn't
  // told when another tab shows.
  cx.timer.every(500, (cx) => {
    noteShown(view);
    view.takeShow(cx);
  });

  if (available()) {
    cx.spawn(async (cx) => {
      for (;;) {
        const e = await view.nextEvent();

        if (e === null) return;

        if (e) view.onEvent(e, cx);

        cx.notify();
      }
    });
  }

  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await nextCommand()).replace(/^browser\./, "");

      // "focus" comes to this copy alone (pane.go); the rest to every shown copy.
      // Sent too on a press into the page (it keeps AppKit's keyboard) and when
      // the window focuses this pane any other way (a tab switch, agent.next).
      // A blank pane: the address field it types into keeps the keyboard.
      if (c === "focus") {
        view.takeShow(cx);
        view.claim();

        if (view.editing && !view.start) view.input?.focus();
        else view.handle?.focus();
      }
      // A tab pinned to the shelf: the pane named by its slot shows it.
      else if (c.startsWith("show:")) showCommand(view, c.slice(5), cx);
      // A pick in a tab's menu (the menu is another copy): { slot, tab, act }.
      else if (c.startsWith("tab_act:")) view.tabAct(c.slice(8), cx);
      // open names its pane by slot (else the one that takes the rest).
      else if (c === "open" || c.startsWith("open:")) openCommand(view, c.slice(5), cx);
      else if (view.mine()) view.command(c, cx);

      cx.notify();
    }
  });
}
