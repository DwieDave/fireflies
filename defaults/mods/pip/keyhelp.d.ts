// The types of keyhelp.js, which stays JavaScript until all its copies (one in
// every nocturne mod) turn TypeScript together. TypeScript reads this file for
// `import ... from "./keyhelp.js"`; the engine runs keyhelp.js. A copy of this
// file sits beside keyhelp.js in each TypeScript mod, byte for byte
// (scripts/mods-typescript.test.ts).

import type { Context, Element } from "gpui-kit";
import type { Theme } from "herdr";

/** One row: the key, what it does, and (git's runnable rows) what a press runs. */
export type KeyRow = readonly [key: string, what: string, go?: (cx: Context) => void];

export interface KeySection {
  readonly title: string | null;
  readonly keys: readonly KeyRow[];
}

/** [[key, what], ...], or sections. */
export type KeyList = readonly KeyRow[] | readonly KeySection[];

export const SECTION: number;

export function hint(t: Theme, id: string, key: string, what?: string | null): Element;

export function keysHint(t: Theme, id: string, on: boolean, toggle: (cx: Context) => void, key?: string): Element;

export function hintBar(t: Theme, id: string, list: readonly KeyRow[], options?: {
  readonly right?: Element | null;
  readonly keys?: { readonly on: boolean; readonly toggle: (cx: Context) => void } | null;
  readonly foot?: boolean;
  readonly px?: number;
}): Element;

export function sectionsOf(list: KeyList): readonly KeySection[];

export function rowsOf(list: KeyList): readonly KeyRow[];

export function keysHeight(list: KeyList, width: number): number;

/** A key as keysKey reads it. */
export interface KeyPress {
  readonly key?: string | undefined;
  readonly key_char?: string | undefined;
  readonly modifiers?: { readonly platform?: boolean; readonly control?: boolean; readonly alt?: boolean } | undefined;
}

export function keysKey(e: KeyPress | null | undefined, open: boolean): "toggle" | "close" | null;

export function keysView(t: Theme, options?: {
  readonly id?: string;
  readonly title?: string;
  readonly list?: KeyList;
  readonly cursor?: number | null;
  readonly pick?: ((row: KeyRow, cx: Context) => void) | null;
  readonly close?: ((cx: Context) => void) | null;
  readonly narrow?: boolean;
}): Element;
