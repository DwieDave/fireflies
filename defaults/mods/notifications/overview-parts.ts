// The overview's parts that need none of its state: its constants, its props,
// which requests this mod can answer, and the plates and screen tails it draws.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { props } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Option, Schema, String as Str } from "effect";
import { boxed, edge } from "@fireflies/look";
import { fill } from "./kit.ts";
import type { Item, ItemType } from "./model.ts";
import type { OptionKind, PermissionRequest, QuestionRequest } from "./request.ts";

// The key bar's hints in the order a narrow drop-down leaves them out (the ?
// list has them all); esc close goes last.
export const BAR_DROP = ["⇥ but…", "g go to", "p peek", "x put away", "↑↓ choose", "j k requests", "1-9 answer", "↵ answer", "↵ go to", "esc close"];

export const TITLE = { permission: "Permissions", question: "Questions", other: "Needs a look" } as const satisfies { readonly [K in ItemType]: string };
export const KIND_COLOR = { yes: "done", always: "accent", auto: "working", no: "blocked" } as const satisfies { readonly [K in OptionKind]: keyof Theme };
export const HOOK_DOC = "Claude Code's hook: see ~/.config/fireflies/app/AGENTS.md, Notifications";

/** `text`, or `otherwise` when it says nothing. */
export const orSay = (text: string, otherwise: string): string => (Str.isEmpty(text) ? otherwise : text);

/** The overview's props: the terminal it opens on, its most height, its overlay. */
const OverviewPropsSchema = Schema.Struct({ terminal: Schema.optionalKey(Schema.NullOr(Schema.String)), most: Schema.optionalKey(Schema.Finite), overlay: Schema.optionalKey(Schema.String) });

const readOverviewProps = Schema.decodeUnknownOption(OverviewPropsSchema);

export const overviewProps = (given?: Props): typeof OverviewPropsSchema.Type => Option.getOrElse(readOverviewProps(props() ?? given), () => ({}));

/** How long after opening it takes the keyboard (its window is up by then). */
export const FOCUS_LATER = "400 millis";

/** An item that is a permission this mod can answer, with its request. */
export type Answerable = Item & { readonly request: PermissionRequest };

export const permissionOf = (it: Item | null): Answerable | null => (it?.type === "permission" && it.answerable && it.request?.type === "permission" ? { ...it, request: it.request } : null);

/** An item that is a block of questions this mod can answer, with its request. */
export const questionsOf = (it: Item | null): QuestionRequest | null => (it?.type === "question" && it.answerable && it.request?.type === "question" ? it.request : null);

/** A request's plate: its lines on a fill of the edge tone. */
export function plate(t: Theme, kids: readonly Element[]): Element {
  return v_flex().relative().mx(20).px(12).py(10).gap(4).flex_none()
    .child(div().absolute().top(0).left(0).size_full().opacity(0.9).child(fill(edge(t), 1)))
    .children(Arr.map(kids, (k) => k.relative()));
}

/** The end of the agent's screen, for anything without a structured request. */
export function screenTail(t: Theme, it: Item): Element {
  if (it.tail === null || Str.isEmpty(it.tail)) return div();

  const ls = Arr.takeRight(Str.split(it.tail, "\n"), 12);

  return boxed(t, v_flex().mx(20).mt(10).px(10).py(8).gap(1)).flex_none()
    .children(Arr.map(ls, (l) => div().truncate().text_color(t.muted).child(Str.isEmpty(l) ? " " : l)));
}
