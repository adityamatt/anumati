import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// jq is a pure JSON transformer: no filesystem writes, no network, no subprocess
// or eval. It reads stdin or the file arguments and prints to stdout. The only
// input that reads an extra file is `-f/--from-file <filter-file>` (a jq program
// file) — harmless (it's a jq filter, not shell), but we reject it to keep the
// command self-contained and verifiable.
function isJqSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "jq") return false;
  if (argv.length < 2) return false; // bare `jq` waits on stdin with no filter

  // Reject reading a filter from a file — keep the filter inline & visible.
  for (const arg of argv.slice(1)) {
    if (arg === "-f" || arg === "--from-file") return false;
  }

  return true;
}

export function matchJq(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only | (pipe to safe consumers) allowed between segments.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return false;
  }

  // First segment must be jq; the rest safe pipe consumers (jq | jq | head, …).
  if (!isJqSegment(segments[0].raw)) return false;
  for (const seg of segments.slice(1)) {
    if (!isSafePipeConsumer(seg.raw)) return false;
  }

  return true;
}
