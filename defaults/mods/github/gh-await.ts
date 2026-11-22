// The seam while the window's views still await promises (main.ts, prs.ts,
// actions.ts, the forms, projects): gh.ts's effects run on the window's
// runtime (fx.ts), with the guards (guard.ts) those views still pass taken as
// schemas. Each view moves to gh.ts's effects in its own conversion; this file
// goes with the last one.

import { Effect, Option, Schema } from "effect";
import { appHome } from "herdr";
import type { Context } from "gpui-kit";
import { Redraw } from "@fireflies/kit";
import type { Guard } from "./guard.ts";
import type { ApiOptions, Fetched, GraphqlOptions, Read, Repo, RepoPlace, Where } from "./gh.ts";
import * as Gh from "./gh.ts";
import type { Entry } from "./cache.ts";
import type { GqlVar } from "./model.ts";
import * as store from "./store.ts";
import type { Slugged } from "./remotes.ts";
import { nowMs, runtime } from "./fx.ts";

export type { Repo } from "./gh.ts";

/** A guard as a schema: what passes it decodes as itself. */
const schemaOf = <T>(guard: Guard<T>) => Schema.declare(guard);

/** Runs a read of GitHub; a failure rejects with its tagged error (its `message` in a person's words). */
const run = <A, E>(effect: Effect.Effect<A, E, Gh.GhServices | store.StoreServices>): Promise<A> => runtime.runtime.runPromise(effect);

/** Runs a tab's read (an effect that redraws) for window-reads.ts, which still awaits: redrawn through `cx`. */
export const awaitRead = <E>(effect: Effect.Effect<void, E, Gh.GhServices | Redraw>, cx: Context | null): Promise<void> =>
  run(Effect.provideService(effect, Redraw, Redraw.of({ now: Effect.sync(() => cx?.notify()) })));

/** An answer kept as it came. */
export const plain = <T>(guard: Guard<T>): Read<T, T> => Gh.plain(schemaOf(guard));

/** An answer kept slim. */
export const slimmed = <R, T>(answer: Guard<R>, slim: (raw: R) => T, kept: Guard<T>): Read<R, T> => Gh.slimmed(schemaOf(answer), slim, schemaOf(kept));

/** gh.ts api. */
export const api = <R, T>(repo: Where, path: string, read: Read<R, T>, options: ApiOptions<T> = {}): Promise<Fetched<T>> => run(Gh.api(repo, path, read, options));

/** gh.ts graphql, its answer passing `guard`. */
export const graphql = <T>(repo: Where, query: string, guard: Guard<T>, vars: readonly GqlVar[] = [], options: GraphqlOptions = {}): Promise<T> =>
  run(Gh.graphql(repo, query, schemaOf(guard), vars, options));

/** gh.ts mutate. */
export const mutate = (repo: Where, query: string, vars: readonly GqlVar[] = []): Promise<void> => run(Gh.mutate(repo, query, vars));

/** gh.ts ghJson, its answer passing `guard`. */
export const ghJson = <T>(repo: Where, args: readonly string[], guard: Guard<T>): Promise<T> => run(Gh.ghJson(repo, args, schemaOf(guard)));

/** What a gh command run for its text or its effect did. */
export interface Ran {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

/** gh.ts ghRun as { ok, out, err }: gh's refusal in `err`, never a rejection. */
export const ghRun = (repo: Where, args: readonly string[], { timeout }: { readonly timeout?: number } = {}): Promise<Ran> =>
  run(Effect.match(Gh.ghRun(repo, args, timeout), {
    onFailure: (e): Ran => ({ ok: false, out: "", err: e.message }),
    onSuccess: (out): Ran => ({ ok: true, out, err: "" }),
  }));

/** gh.ts fileAt: the file's text, or null when GitHub has none or the read failed (the graph then lays out by time). */
export const fileAt = (repo: Where, path: string, ref: string): Promise<string | null> =>
  run(Effect.orElseSucceed(Effect.map(Gh.fileAt(repo, path, ref), Option.getOrNull), () => null));

/** gh.ts repoOf. */
export const repoOf = (folder: string | null | undefined, on: string | null): Promise<Repo | null> => run(Gh.repoOf(folder, on));

/** gh.ts viewRepo. */
export const viewRepo = (want: Slugged | null, place: RepoPlace, { quiet = false } = {}): Promise<Repo | null> => run(Gh.viewRepo(want, place, quiet));

// ---- the cache file (store.ts), for window-reads.ts

/** The cache file of this app. */
const cacheFile = (): string => store.cachePath(appHome());

/** store.ts save at the window's time: true once written, false when it couldn't be. */
export const saveCache = (folder: string | null, entry: Entry): Promise<boolean> =>
  run(Effect.match(store.save(cacheFile(), folder, entry, nowMs()), { onFailure: () => false, onSuccess: () => true }));
