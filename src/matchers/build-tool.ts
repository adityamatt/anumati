import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Frontend build tools. A one-shot build writes to a dist/ dir — the same trust
// tier as `cargo build` / `npm run build`. The hazard is the *other* mode every
// one of these has: a long-running dev server / watcher, which would hang the
// hook. So we allow only the build form and reject anything server/watch.

// Tools whose bare invocation starts a dev server — the explicit `build`
// subcommand is REQUIRED (e.g. `vite build`, `next build`).
const BUILD_SUBCOMMAND_TOOLS = new Set(["vite", "next"]);

// Tools that build by default (no subcommand needed), but can be switched into
// a watch/serve mode via a subcommand or flag (caught by LONG_RUNNING below).
const BUILD_DEFAULT_TOOLS = new Set(["webpack", "rollup", "esbuild"]);

// Subcommands / flags that turn a build into a long-running process (dev server
// or file watcher). Rejected for every tool, even alongside `build`
// (e.g. `vite build --watch` rebuilds forever).
const LONG_RUNNING = new Set([
  "dev", "serve", "preview", "start", "watch",
  "--watch", "-w", "--serve", "--dev",
]);

function hasRedirection(raw: string): boolean {
  return hasUnsafeRedirection(raw);
}

function isBuildSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  let i = 0;
  if (basename(argv[0]) === "npx") i = 1;

  const tool = basename(argv[i] ?? "");
  const rest = argv.slice(i + 1);

  // No watch/serve subcommand or flag, regardless of tool.
  if (rest.some((a) => LONG_RUNNING.has(a))) return false;

  if (BUILD_SUBCOMMAND_TOOLS.has(tool)) return rest[0] === "build";
  if (BUILD_DEFAULT_TOOLS.has(tool)) return true;
  return false;
}

function isCdSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchBuildTool(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only && (leading cd) and | (safe pipes) operators are permitted.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "&&" && seg.operator !== "|") {
      return false;
    }
  }

  let index = 0;

  // Optional leading: cd <dir> &&
  if (
    segments.length >= 2 &&
    segments[0].operator === "&&" &&
    isCdSegment(segments[0].raw)
  ) {
    index = 1;
  }

  // First (non-cd) segment must be a build invocation.
  if (!isBuildSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
