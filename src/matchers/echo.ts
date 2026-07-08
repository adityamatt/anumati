import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

/**
 * Approve a bare `echo …` — it only writes to stdout and has no side effects.
 * Very common as progress/section markers in compound commands
 * (`… && echo "=== done ==="`), which compose via evaluate().
 *
 * Rejects a file-writing redirect (`echo x > file`) — that mutates the
 * filesystem. Safe stream redirects (2>&1, etc.) are fine. A single `echo`
 * segment only; chaining is handled by composition.
 */
export function matchEcho(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  if (segments.length !== 1 || segments[0].operator !== null) return false;
  const raw = segments[0].raw;
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}
