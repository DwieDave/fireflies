// What the git window's popups are: the options each kind opens with (a menu,
// a confirm, a prompt, the commit message, the keys overview), the popup as
// popups.ts keeps it, and what they need of the window.

import type { Context } from "gpui-kit";
import type { InputState, TextareaState } from "gpui-base";
import type { KeyRow, KeySection } from "@fireflies/keyhelp";
import type { Anchor } from "@fireflies/menu-place";
import type { Ink } from "./draw.ts";

/** What the popups need of the window. */
export interface PopupHost {
  /** The window's own keyboard back. */
  focusSelf(): void;
  /** The commit message esc left (lazygit keeps it). */
  draft: string | null;
  /** Runs `fn` a moment later (after the next frame). */
  later(fn: (cx: Context) => void): void;
  /** What a commit takes, for the commit message's frame. */
  commitWhat(): string | null;
}

/** A menu's row: a section's head, or an item (its own key runs it; `off` greys it out). */
export type MenuItem =
  | { readonly section: string; readonly key?: never; readonly label?: never; readonly sub?: never; readonly danger?: never; readonly off?: never; readonly go?: never }
  | { readonly section?: never; readonly key?: string; readonly label: string; readonly sub?: string | null; readonly danger?: boolean; readonly off?: boolean; readonly go?: ((cx: Context) => void) | null };

/** A confirm's toggle: its key flips it. */
export interface Check {
  readonly key: string;
  readonly label: string;
  on: boolean;
}

/** A line more a confirm says: its text and color (a theme's by name, muted when none). */
export type Line = readonly [text: string, ink?: Ink];

/** A prompt's completion: what it puts in, what it says beside. */
export interface Suggestion {
  readonly value: string;
  readonly sub?: string | null;
}

export interface KeysOptions {
  readonly title: string;
  readonly sections: readonly KeySection[];
}

export interface MenuOptions {
  readonly title: string;
  readonly items: readonly MenuItem[];
  /** What it stands at (menu-place.ts): the press (a right-click), the selected row (its key),
   *  else (null) centered; left out: the view's menuNear. */
  readonly at?: Anchor;
  /** What it says with no items. */
  readonly empty?: string | null;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly text: string;
  readonly danger?: boolean;
  readonly go?: ((cx: Context, checks: readonly Check[]) => void) | null;
  /** An error: one button, which closes it. */
  readonly error?: boolean;
  readonly lines?: readonly Line[];
  readonly checks?: readonly Check[];
}

export interface PromptOptions {
  readonly title: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly ok: (text: string, cx: Context) => void;
  /** Earlier answers, newest first (↑↓). */
  readonly history?: readonly string[] | null;
  readonly note?: string | null;
  readonly suggest?: ((text: string) => readonly Suggestion[] | null) | null;
}

export interface CommitOptions {
  readonly title: string;
  readonly value?: string;
  readonly ok: (message: string, cx: Context) => void;
  /** A new commit: esc keeps what's typed as the draft, and the draft comes back. */
  readonly draft?: boolean;
}

/** The popup that's open. */
export type Popup =
  | { readonly kind: "keys"; readonly title: string; readonly sections: readonly KeySection[]; readonly rows: readonly KeyRow[]; sel: number }
  | { readonly kind: "menu"; readonly title: string; readonly items: readonly MenuItem[]; sel: number; readonly at: Anchor; readonly empty: string | null }
  | ConfirmPopup
  | PromptPopup
  | CommitPopup;

export interface ConfirmPopup {
  readonly kind: "confirm";
  readonly title: string;
  readonly text: string;
  readonly danger: boolean;
  readonly go: ((cx: Context, checks: readonly Check[]) => void) | null;
  readonly error: boolean;
  readonly lines: readonly Line[];
  readonly checks: readonly Check[];
  /** The focused stop. */
  at: number;
}

export interface PromptPopup {
  readonly kind: "prompt";
  readonly title: string;
  readonly input: InputState;
  readonly ok: (text: string, cx: Context) => void;
  readonly history: readonly string[] | null;
  /** The history entry shown, -1 none. */
  hi: number;
  readonly note: string | null;
  readonly suggest: ((text: string) => readonly Suggestion[] | null) | null;
  /** The completion picked, -1 none. */
  pick: number;
}

export interface CommitPopup {
  readonly kind: "commit";
  readonly title: string;
  readonly input: InputState;
  readonly desc: TextareaState;
  readonly ok: (message: string, cx: Context) => void;
  at: number;
  readonly draft: boolean;
}

/** The form popups (form-keys.ts stops). */
export type FormPopup = ConfirmPopup | CommitPopup;

/** The window's size. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A popup frame's red edge (`danger`) and its top right note. */
export interface FrameOptions {
  readonly danger?: boolean;
  readonly right?: string | null;
}
