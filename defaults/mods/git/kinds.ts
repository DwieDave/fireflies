// Which changed files are tests, config, assets or docs, so review can hide
// them and leave the business code. Decided by path alone (diff's).

const TEST_DIR = /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright|fixtures|testdata)\//i;
const TEST_FILE = /(\.|_|-)(test|spec)s?\.[^/]+$|(^|\/)test_[^/]+\.py$|(^|\/)[^/]+Tests?\.(swift|kt|java|cs|m)$|(^|\/)conftest\.py$/i;

const DOC_DIR = /(^|\/)(docs?|documentation|man)\//i;
const DOC_FILE = /\.(md|mdx|markdown|rst|adoc|asciidoc|txt|org)$|(^|\/)(README|CHANGELOG|CHANGES|LICENSE|LICENCE|NOTICE|CONTRIBUTING|AUTHORS|HISTORY)(\.[^/]*)?$/i;

// Config: tool and build settings, CI, containers and lockfiles. Generic
// .json and source languages (.nix included) stay code: they often are.
const CONFIG_DIR = /(^|\/)(\.github|\.gitlab|\.circleci|\.husky|\.vscode|\.idea|\.devcontainer)\//i;

const CONFIG_FILE = new RegExp([
  /(^|\/)\.[^/]*rc(\.(js|cjs|mjs|ts|json|ya?ml))?$/,           // .eslintrc, .prettierrc.json, .npmrc
  /(^|\/)\.(editorconfig|gitignore|gitattributes|gitmodules|dockerignore|npmignore|prettierignore|eslintignore|env[^/]*|nvmrc|tool-versions|envrc)$/,
  /\.(ya?ml|toml|ini|cfg|conf|properties)$/,
  /(^|\/)[^/]+\.config\.[^/]+$/,                                // vite.config.ts, tailwind.config.js
  /(^|\/)(ts|js)config[^/]*\.json$/,
  /(^|\/)(package|composer|deno|biome|turbo|nx|lerna|vercel|netlify|renovate|app)\.json$/,
  /(^|\/)(Dockerfile|Containerfile|docker-compose[^/]*|compose\.ya?ml|Makefile|Justfile|Procfile|Gemfile|Pipfile|requirements[^/]*\.txt|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod)$/,
  /(^|\/)[^/]*\.lock$|(^|\/)(package-lock\.json|go\.sum|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/,
].map((r) => r.source).join("|"), "i");

// Assets go by extension only: a folder named assets/ can hold code.
const ASSET = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|icns|svg|heic|psd|ai|sketch|fig|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|aac|m4a|mp4|mov|webm|mkv|avi|pdf|zip|gz|tar|lottie)$/i;

/** What a file counts as when it isn't code. */
export type Kind = "tests" | "config" | "assets" | "docs";

/** Each kind and its name in the review's menu. */
export const KINDS: readonly (readonly [Kind, string])[] = [
  ["tests", "tests"],
  ["config", "config"],
  ["assets", "assets"],
  ["docs", "docs"],
];

/** The kind a file counts as, or null for code. First match wins: a test
 *  fixture is a test, a requirements.txt is config, not docs. */
export function kind(f: { readonly path: string; readonly binary?: boolean }): Kind | null {
  const p = f.path;

  if (TEST_DIR.test(p) || TEST_FILE.test(p)) return "tests";

  if (CONFIG_DIR.test(p) || CONFIG_FILE.test(p)) return "config";

  if (DOC_DIR.test(p) || DOC_FILE.test(p)) return "docs";

  if (ASSET.test(p) || f.binary) return "assets";

  return null;
}
