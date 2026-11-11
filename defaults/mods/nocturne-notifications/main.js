// Nocturne notifications: one place for everything agents need from the
// person, across every agent, tab, space and machine. Roles (props.role):
//
//   bell      the quiet indicator in the tab strip (the nocturne layout's
//             "notify" block): how many requests wait, in the needs-you
//             color; click (or cmd-shift-a, nocturne-notifications.open)
//             opens the overview under it, or closes it. It also runs the engine (engine.js): it
//             reads waiting agents' screens and hook records and keeps the
//             items in shared state for everything else here.
//   overview  a drop-down under the bell (open.js), every request,
//             grouped: permissions, questions, other
//             (finished, errors, waiting for input); one at a time in full
//             on the right, answered from there (overview.js)
//   ask       a block of questions answered like Claude Code's
//             AskUserQuestion, then submitted together (ask-dialog.js)
//
// Answers go into the agent's terminal as keys, checked against its screen
// at every step (drive.js, claude.js); a request that changed or went away
// is refused, never answered blindly.
//
// Commands (keys.json, `herdr-app do`): nocturne-notifications.open (the
// overview; on shared OPEN's terminal when a toast asked for it), .refresh.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import Bell from "./bell.js";
import Overview from "./overview.js";
import AskDialog from "./ask-dialog.js";

const ROLES = { bell: Bell, overview: Overview, ask: AskDialog };

export default class Notifications extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const R = ROLES[pr.role ?? "bell"];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    if (!this.role) return div().child(`nocturne-notifications: no role "${props()?.role}"`);
    return this.role.render(cx);
  }

  async close(cx) {
    await this.role?.closing?.(cx);
  }
}
