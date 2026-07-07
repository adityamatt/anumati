import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// cargo subcommands that are read-only / build / test / lint and safe to allow
const ALLOWED_SUBCOMMANDS = new Set([
  "check",
  "build",
  "b",
  "test",
  "t",
  "clippy",
  "fmt",
  "tree",
  "metadata",
  "doc",
  "bench",
  "version",
  "--version",
  "search",
  "verify-project",
  "locate-project",
  "pkgid",
]);

// Reject file-writing / input redirection (safe stream redirects like
// 2>/dev/null and 2>&1 are permitted); the parser leaves these in the raw text.
function hasRedirection(raw: string): boolean {
  return hasUnsafeRedirection(raw);
}

function isCargoSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;
  if (basename(argv[0]) !== "cargo") return false;

  const sub = argv[1];
  if (!sub || !ALLOWED_SUBCOMMANDS.has(sub)) return false;

  const rest = argv.slice(2);

  // fmt rewrites files unless --check is present
  if (sub === "fmt" && !rest.includes("--check")) return false;

  // doc --open launches a browser
  if (sub === "doc" && rest.includes("--open")) return false;

  return true;
}

function isCdSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchCargo(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only && (leading cd) and | (safe pipes) operators are permitted.
  // Reject ;, ||, & (including a trailing background &) outright.
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

  // First (non-cd) segment must be cargo
  if (!isCargoSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
