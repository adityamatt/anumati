import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// eslint is a read-only linter in its default form — it reports problems and
// exits. The hazards are the flags that make it WRITE: `--fix`/`--fix-dry-run`
// rewrite source files, and `--init` scaffolds a config file. Everything else
// (paths, `--max-warnings`, `--format`, `--ext`, config selection, …) only
// selects what to lint / how to report, so any other args are fine.
const WRITE_FLAGS = new Set(["--fix", "--fix-dry-run", "--init"]);

// A lint invocation is either `npx eslint …` or a direct `eslint …`. Unlike
// vitest/build-tool there is no required subcommand — bare `eslint <paths>`
// lints and exits, so only the write flags are rejected.
function isEslintSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  let i = 0;
  if (basename(argv[0]) === "npx") i = 1;

  if (basename(argv[i] ?? "") !== "eslint") return false;

  const rest = argv.slice(i + 1);
  if (rest.some((a) => WRITE_FLAGS.has(a))) return false;
  return true;
}

function isCdSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchEslint(command: string): boolean {
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

  // First (non-cd) segment must be an eslint invocation.
  if (!isEslintSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
