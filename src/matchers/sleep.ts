import { parseCompound, tokenize } from "../parser/shell.js";

/**
 * Approve a bare `sleep <seconds>` — it only pauses execution and has no side
 * effects. Exactly one integer argument (the form the agent actually emits,
 * e.g. `sleep 300`).
 *
 * Deliberately narrow: a single `sleep` segment, no operators, no redirection.
 * Chaining `sleep` with other commands (e.g. `sleep 120; wc -l file`) is handled
 * by sequential composition in evaluate(), where each segment is matched on its
 * own — so this matcher only needs to recognize `sleep` itself.
 */
export function matchSleep(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Exactly one segment, no trailing operator, no redirection.
  if (segments.length !== 1 || segments[0].operator !== null) return false;
  const raw = segments[0].raw;
  if (raw.includes(">") || raw.includes("<")) return false;

  const argv = tokenize(raw);
  // Exactly `sleep <integer>`.
  return !!argv && argv[0] === "sleep" && argv.length === 2 && /^\d+$/.test(argv[1]);
}
