import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Test runners execute the project's test code — the same trust already granted
// by the `vitest`/`cargo`/`go` (test) matchers. This covers pytest and jest.
// Watch mode is rejected (it hangs the hook), and flags that shell out / rewrite
// files are rejected.

// Flags that make a test run do more than run tests: launch an interactive
// watcher (hangs), or (jest) update snapshots on disk.
const REJECTED_FLAGS = new Set([
  "--watch", "-w", "--watchAll",
  "-u", "--updateSnapshot", // jest: rewrites snapshot files
]);

function hasRejectedFlag(args: string[]): boolean {
  return args.some((a) => REJECTED_FLAGS.has(a));
}

// pytest, or `python -m pytest` / `python3 -m pytest`.
function isPytest(argv: string[]): boolean {
  const cmd = basename(argv[0]);
  if (cmd === "pytest") return !hasRejectedFlag(argv.slice(1));
  if ((cmd === "python" || cmd === "python3") && argv[1] === "-m" && argv[2] === "pytest") {
    return !hasRejectedFlag(argv.slice(3));
  }
  return false;
}

// jest, or `npx jest`.
function isJest(argv: string[]): boolean {
  let i = 0;
  if (basename(argv[i]) === "npx") i = 1;
  if (basename(argv[i] ?? "") !== "jest") return false;
  return !hasRejectedFlag(argv.slice(i + 1));
}

function isTestRunnerSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  if (!argv) return false;
  return isPytest(argv) || isJest(argv);
}

function isCdSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchTestRunner(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only && (leading cd) and | (safe pipes) operators permitted.
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

  // First (non-cd) segment must be a test runner.
  if (!isTestRunnerSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
