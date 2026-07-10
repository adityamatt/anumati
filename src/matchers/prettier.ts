import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// prettier is read-only in its default and check forms — `prettier <file>`
// prints formatted output to stdout, and `--check`/`--list-different` only
// report which files would change. The one hazard is `--write`/`-w`, which
// rewrites source files in place — allowed ONLY when a rule opts in via
// `allow_write: true`. Any other flag (config selection, `--check`, ignore
// paths, …) only picks what to check / how to report, so it is fine.
const WRITE_FLAGS = new Set(["--write", "-w"]);

// A prettier invocation is either `npx prettier …` or a direct `prettier …`.
// No required subcommand — bare `prettier <paths>` prints to stdout and exits,
// so only the write flag is rejected (unless the rule opts into writes).
function isPrettierSegment(raw: string, allowWrite: boolean): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  let i = 0;
  if (basename(argv[0]) === "npx") i = 1;

  if (basename(argv[i] ?? "") !== "prettier") return false;

  const rest = argv.slice(i + 1);
  if (!allowWrite && rest.some((a) => WRITE_FLAGS.has(a))) return false;
  return true;
}

function isCdSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchPrettier(command: string, allowWrite = false): boolean {
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

  // First (non-cd) segment must be a prettier invocation.
  if (!isPrettierSegment(segments[index].raw, allowWrite)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
