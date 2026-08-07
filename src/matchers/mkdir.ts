import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

// `mkdir` only creates directories — it cannot clobber an existing file or
// truncate data, so path operands are unconstrained (absolute or relative are
// equally safe). We keep the flag set to a strict, non-destructive subset:
// `-p`/`--parents` (create intermediate dirs) and `-v`/`--verbose` (chatter).
// Everything else is rejected fail-closed — notably `-m`/`--mode`, which sets
// permissions and is deliberately kept out of the safe subset.
//
// A single `mkdir` segment only; `&&`/`;`/`&` chaining and any pipe are handled
// by evaluate() composition across other matched sub-commands.
export function matchMkdir(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  if (segments.length !== 1 || segments[0].operator !== null) return false;
  const raw = segments[0].raw;
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "mkdir") return false;

  // Accept only the safe flags; require at least one non-flag path operand.
  let paths = 0;
  for (const arg of argv.slice(1)) {
    if (arg === "-p" || arg === "--parents" || arg === "-v" || arg === "--verbose") {
      continue;
    }
    if (arg.startsWith("-")) return false; // unknown flag (incl. -m/--mode) — fail closed
    paths++;
  }

  return paths >= 1;
}
