import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

// Git subcommands that touch the network — never auto-approvable, even if a
// user lists them in allowed_git_ops.
const NETWORK_OPS = new Set(["push", "pull", "fetch", "clone", "remote"]);

// Inherently destructive / history-rewriting subcommands — hard-blocked
// wholesale, regardless of the allowlist or flags.
const DESTRUCTIVE_OPS = new Set([
  "reset", "rebase", "clean", "filter-branch", "reflog", "gc", "prune",
]);

// Flags that turn an otherwise-local write into a destructive / force /
// history-rewriting form. If any appears, the command is blocked even when the
// op itself is allowlisted.
const DANGEROUS_FLAGS = new Set([
  "-f", "--force", "--force-with-lease",
  "--hard",
  "-D", "--delete", "-d",
  "--amend", // rewrites the previous commit
  "--discard-changes",
]);

// The subcommand token (after global options), or -1. `-c key=val` can set
// config for the command, so its presence disqualifies the command.
function findSubcommandIndex(argv: string[]): number {
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "-c") return -1;
    if (arg === "-C") { i += 2; continue; } // -C <dir>
    if (arg.startsWith("-")) { i++; continue; }
    return i;
  }
  return -1;
}

function isGitWriteSegment(raw: string, allowedOps: string[]): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "git") return false;

  const subIdx = findSubcommandIndex(argv);
  if (subIdx === -1) return false;

  const op = argv[subIdx];

  // Hard blocks — never allowed regardless of the allowlist.
  if (NETWORK_OPS.has(op) || DESTRUCTIVE_OPS.has(op)) return false;

  // Must be explicitly allowlisted.
  if (!allowedOps.includes(op)) return false;

  const args = argv.slice(subIdx + 1);

  // No dangerous flag form (force / delete / --amend / --hard / …).
  for (const arg of args) {
    if (arg.startsWith("-") && DANGEROUS_FLAGS.has(arg)) return false;
  }

  // `git worktree` has its own sub-subcommand: only `add` creates (safe);
  // remove/prune/move/lock/unlock all mutate existing worktrees — block them.
  if (op === "worktree" && args[0] !== "add") return false;

  return true;
}

export function matchGitWrite(command: string, allowedOps: string[]): boolean {
  if (allowedOps.length === 0) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  // A git write is a single command — no chaining, no piping here. Composition
  // in evaluate() still lets `git add . && git commit -m x` approve when both
  // ops are allowlisted, by matching each segment on its own.
  if (segments.length !== 1 || segments[0].operator !== null) return false;

  return isGitWriteSegment(segments[0].raw, allowedOps);
}
