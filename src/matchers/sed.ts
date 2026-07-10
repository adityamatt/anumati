import { parseCompound } from "../parser/shell.js";
import { isSafePipeConsumer } from "../parser/pipe.js";
import { isReadOnlySed } from "../parser/sed-safe.js";

// `sed` is only safe in provably read-only forms; the grammar it must satisfy
// lives in parser/sed-safe.ts (isReadOnlySed), shared with the composition
// points so a read-only sed can also appear as a pipe stage in an inspection
// chain.

export function matchSed(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only | (pipe to safe consumers) allowed between segments.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return false;
  }

  // First segment must be a read-only sed; the rest safe pipe consumers.
  if (!isReadOnlySed(segments[0].raw)) return false;
  for (const seg of segments.slice(1)) {
    if (!isSafePipeConsumer(seg.raw)) return false;
  }

  return true;
}
