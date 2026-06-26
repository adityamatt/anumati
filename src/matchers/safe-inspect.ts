import { parseCompound, tokenize } from "../parser/shell.js";

// Read-only inspection builtins. Conservative allowlist — anything that can
// write (sed -i, awk, tee, xargs) or run other programs is deliberately omitted.
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
  // Reject any redirection — parseCompound preserves these in raw
  if (raw.includes(">") || raw.includes("<")) return false;

  const argv = tokenize(raw);
  if (!argv || argv.length === 0) return false;

  const cmd = argv[0];
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

export function matchSafeInspect(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let hasInspect = false;

  for (const segment of segments) {
    // Only pipes (or nothing) allowed between segments
    if (segment.operator !== null && segment.operator !== "|") return false;
    if (!isSafeInspectSegment(segment.raw)) return false;
    hasInspect = true;
  }

  return hasInspect;
}
