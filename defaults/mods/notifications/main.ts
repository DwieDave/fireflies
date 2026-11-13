// Nocturne notifications: one place for everything agents need from the
// person, across every agent, tab, space and machine. Roles (props.role):
//
//   bell      the quiet indicator in the tab strip (the nocturne layout's
//             "notify" block): how many requests wait, in the needs-you
//             color; click (or cmd-shift-a, notifications.open)
//             opens the overview under it, or closes it. It also runs the engine (engine.ts): it
//             reads waiting agents' screens and hook records and keeps the
//             items in shared state for everything else here.
//   overview  a drop-down under the bell (open.ts), every request,
//             grouped: permissions, questions, other
//             (finished, errors, waiting for input); one at a time in full
//             on the right, answered from there (overview.ts)
//   ask       a block of questions answered like Claude Code's
//             AskUserQuestion, then submitted together (ask-dialog.ts)
//
// Answers go into the agent's terminal as keys, checked against its screen
// at every step (drive.ts, claude.ts); a request that changed or went away
// is refused, never answered blindly.
//
// Commands (keys.json, `herdr-app do`): notifications.open (the
// overview; on shared OPEN's terminal when a toast asked for it), .refresh.

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { props } from "herdr";
import { isString, object } from "./guard.ts";
import Bell from "./bell.ts";
import Overview from "./overview.ts";
import AskDialog from "./ask-dialog.ts";

/** One role of this mod (see the top). */
interface Role {
  init(p: Props | undefined, cx: AsyncContext): void;
  render(cx: Context): Element;
  closing?(): void;
}

const ROLES: ReadonlyMap<string, () => Role> = new Map<string, () => Role>([["bell", () => new Bell()], ["overview", () => new Overview()], ["ask", () => new AskDialog()]]);

/** Which role this copy plays (props.role; none: the bell). */
const isRoleProps = object({}, { role: isString });

const roleOf = (p?: Props): string => {
  const raw = props() ?? p;

  return (isRoleProps(raw) ? raw.role : undefined) ?? "bell";
};

export default class Notifications extends View {
  role: Role | null = null;

  override init(p: Props | undefined, cx: AsyncContext) {
    this.role = ROLES.get(roleOf(p))?.() ?? null;
    this.role?.init(p, cx);
  }

  override render(cx: Context) {
    if (!this.role) return div().child(`notifications: no role "${roleOf()}"`);

    return this.role.render(cx);
  }

  override async close() {
    await this.role?.closing?.();
  }
}
