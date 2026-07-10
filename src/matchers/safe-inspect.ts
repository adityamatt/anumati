import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isReadOnlySed } from "../parser/sed-safe.js";

// Read-only inspection builtins. Conservative allowlist — anything that can
// write (awk, tee, xargs) or run other programs is deliberately omitted. `sed`
// is handled specially below: only its provably read-only forms are accepted
// (see isReadOnlySed), so `sed -i` / write / exec forms stay rejected.
const SAFE_INSPECT = new Set([
  "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df",
  "tree", "pwd", "which", "type", "basename", "dirname", "date",
  "grep", "egrep", "fgrep", "rg", "sort", "uniq", "cut", "tr",
  "diff", "column", "find", "env", "printenv", "realpath", "readlink",
  "nl", "fold", "comm", "tac",
]);

// find options that can write, delete, or execute arbitrary commands
const FIND_DANGEROUS = new Set([
  "-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprintf",
]);

function isSafeInspectSegment(raw: string): boolean {
  // Reject file-writing / input redirection; safe stream redirects
  // (2>/dev/null, 2>&1, &>/dev/null, …) are allowed.
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv.length === 0) return false;

  const cmd = argv[0];
  // A provably read-only `sed` (sed -n '1,80p', etc.) is a valid inspection
  // stage — vetted by its own grammar so a chain like
  // `cat f | sed -n '1,80p' | grep foo` composes as one read-only pipeline.
  if (cmd === "sed") return isReadOnlySed(raw);
  if (!SAFE_INSPECT.has(cmd)) return false;

  if (cmd === "find") {
    for (const arg of argv.slice(1)) {
      if (FIND_DANGEROUS.has(arg)) return false;
    }
  }

  // env with any args could set vars or run a command — only allow bare env
  if (cmd === "env" && argv.length !== 1) return false;

  // printenv takes at most one variable name argument
  if (cmd === "printenv" && argv.length > 2) return false;

  return true;
}

// Operators permitted between inspection segments. `|` (pipeline), `;` and `&&`
// (sequencing) are pure control flow — they only decide whether the next
// command runs. Since every segment must independently be a safe read-only
// inspection, a chain of them can only ever run safe reads. `||` and a
// backgrounding `&` are deliberately excluded.
const ALLOWED_CHAIN_OPS = new Set(["|", ";", "&&"]);

export function matchSafeInspect(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let hasInspect = false;

  for (const segment of segments) {
    if (segment.operator !== null && !ALLOWED_CHAIN_OPS.has(segment.operator)) return false;
    if (!isSafeInspectSegment(segment.raw)) return false;
    hasInspect = true;
  }

  return hasInspect;
}
