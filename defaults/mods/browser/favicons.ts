// A web tab's favicon. The page's main frame names its icon (the native view's
// `web.icon { href }`: its `link[rel~=icon]`, null when it has none); the pane
// fetches it once per origin (that link, else the origin's /favicon.ico; nothing
// goes to an icon service) into the app's cache folder, where image() reads it
// and where it stays for the next start and the shelf. One file per origin,
// named by its host: `cache/browser-icons/<host>` (a port as `_<port>`).

import type { Tab } from "./tabs.ts";

/** The icons' folder, under the app's folder (image() takes this path as is). */
export const ICON_DIR = "cache/browser-icons";

/** A page's origin: its `origin` (scheme, host, port) and its icon's file name. */
export interface Origin {
  readonly origin: string;
  readonly key: string;
}

/** An http(s) page's origin, else null (a blank tab, file://, about:). */
export function originOf(href: string | null | undefined): Origin | null {
  if (!href) return null;

  let url: URL;

  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host) return null;

  const key = url.host.toLowerCase().replace(/[^a-z0-9.-]/g, "_");

  return key.replace(/[._-]/g, "") ? { origin: url.origin, key } : null;
}

/** The icon file of a cached origin, as image() takes it. */
export const iconPath = (key: string): string => `${ICON_DIR}/${key}`;

/** What the fetch tries, in order: the page's own link (http(s) only), then the origin's /favicon.ico. */
export function iconUrls(o: Origin, link: string | null): string[] {
  const own = `${o.origin}/favicon.ico`;

  return link && /^https?:\/\//i.test(link) && link !== own ? [link, own] : [own];
}

/** Fetches the first of the URLs ($3 on) that is an image into $1/$2: at most 1 MiB,
 *  10 s each, http(s) also on redirects, kept only when `file` calls it an image (an
 *  error page served as 200 isn't). Written beside it first, then moved in whole. */
export const FETCH = [
  'd=$1; f=$2; shift 2; mkdir -p "$d" || exit 2; t="$d/.$f.part"',
  'for u in "$@"; do',
  '  if curl -fsL --proto =http,https --proto-redir =http,https --max-time 10 --max-filesize 1048576 -o "$t" "$u" && [ -s "$t" ] && file -b --mime-type "$t" | grep -q "^image/"; then mv -f "$t" "$d/$f"; exit 0; fi',
  "done",
  'rm -f "$t"; exit 1',
].join("\n");

/** The origins cached already, from a listing of ICON_DIR (one name a line; dot files are partial). */
export const listed = (out: string): Set<string> =>
  new Set(out.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith(".")));

/** Each tab's icon (its page's origin cached), by tab id; tabs without one are left out. */
export function tabIcons(tabs: readonly Tab[], cached: ReadonlySet<string>): Map<string, string> {
  return new Map(tabs.flatMap((t) => {
    const o = originOf(t.page.href ?? t.start);

    return o && cached.has(o.key) ? [[t.id, iconPath(o.key)]] : [];
  }));
}
