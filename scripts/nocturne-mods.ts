// The mods that grew out of the Nocturne layout (defaults/mods/<name>): once
// named nocturne-<name>, now on their own (src/layout.rs RENAMED_MODS maps the
// old names). Tests that check every one of them (copied files, commands)
// list them from here, since no prefix tells them apart from the stock mods.
export const NOCTURNE_MODS = [
  "agent-graph", "browser", "databases", "diff", "editor", "equalize-panes", "file-tree", "finder", "git", "github",
  "markdown", "notifications", "pip", "preview", "procs", "scripts", "usage",
] as const;

/** Old name → name now: src/layout.rs RENAMED_MODS. */
export const RENAMED_MODS: Record<string, string> = {
  ...Object.fromEntries(NOCTURNE_MODS.map((m) => [`nocturne-${m}`, m])),
  "nocturne-agents": "agent-graph", "nocturne-files": "file-tree", "nocturne-picker": "finder", "nocturne-image": "preview",
};
delete RENAMED_MODS["nocturne-agent-graph"];
delete RENAMED_MODS["nocturne-file-tree"];
delete RENAMED_MODS["nocturne-finder"];
delete RENAMED_MODS["nocturne-databases"]; // born after the rename: it never had the old name

/** An action as the app reads it (src/keys.rs current()): a renamed mod's
 *  `nocturne-editor.save` is `editor.save`. */
export function actionNow(action: string): string {
  const dot = action.indexOf(".");
  const now = dot > 0 ? RENAMED_MODS[action.slice(0, dot)] : undefined;
  return now ? now + action.slice(dot) : action;
}

/** A keys.json's text as herdr.keys() hands it to the mods (src/keys.rs
 *  listing): `mod:<old>` sections and old commands under the names now. */
export function keysNow(text: string): Record<string, Record<string, unknown>> {
  const sections = JSON.parse(text) as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(sections).map(([section, keys]) => [
    section.startsWith("mod:") ? `mod:${RENAMED_MODS[section.slice(4)] ?? section.slice(4)}` : section,
    Object.fromEntries(Object.entries(keys).map(([k, a]) => [k, typeof a === "string" ? actionNow(a) : a])),
  ]));
}
