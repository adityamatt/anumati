import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Reject file-writing / input redirection (safe stream redirects like
// 2>/dev/null and 2>&1 are permitted); the parser leaves these in the raw text.
function hasRedirection(raw: string): boolean {
  return hasUnsafeRedirection(raw);
}

// A vitest invocation is either `npx vitest run …` or a direct `vitest run …`.
// The `run` subcommand is REQUIRED: bare `vitest` (and `vitest watch`/`dev`)
// launches interactive watch mode, which would hang the hook. `run` selection
// args (paths, --coverage, --reporter, etc.) only pick what to run, so any
// trailing args are fine. Test code execution itself is inherent to running
// tests — the same trust already granted by the `cargo`/`go` (test) matchers.
function isVitestSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  let i = 0;
  if (basename(argv[0]) === "npx") {
    i = 1;
  }

  if (basename(argv[i] ?? "") !== "vitest") return false;
  return argv[i + 1] === "run";
}

function isCdSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchVitest(command: string): boolean {
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

  // First (non-cd) segment must be vitest run.
  if (!isVitestSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
