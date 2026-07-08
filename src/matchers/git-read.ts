import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Read-only git subcommands that are safe to allow.
const READ_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "remote", "stash",
  "rev-parse", "blame", "describe", "config", "ls-files", "ls-tree",
  "shortlog", "tag", "reflog", "cat-file", "symbolic-ref", "whatchanged",
  "show-ref", "rev-list", "name-rev", "var", "count-objects",
  "for-each-ref", "merge-base", "cherry", "diff-tree", "diff-index",
  "worktree",
]);

// branch flags that mutate state — reject if any appear.
const BRANCH_MUTATING_FLAGS = new Set([
  "-d", "-D", "-m", "-M", "-c", "-C", "-f",
  "--delete", "--move", "--copy", "--force",
  "--edit-description", "--set-upstream-to", "--unset-upstream",
]);

// branch flags that are read-only listing forms.
const BRANCH_READ_FLAGS = new Set([
  "-a", "-r", "-v", "-vv", "--list", "--all", "--remotes",
  "--verbose", "--contains", "--no-contains", "--merged", "--no-merged",
  "--points-at", "--sort", "--color", "--no-color", "--format", "--show-current",
]);

// tag flags that mutate state — reject if any appear.
const TAG_MUTATING_FLAGS = new Set([
  "-d", "-D", "-a", "-s", "-m", "-f",
  "--delete", "--annotate", "--sign", "--force", "--message",
]);

// tag flags that are read-only listing forms.
const TAG_READ_FLAGS = new Set([
  "-l", "-n", "-v",
  "--list", "--contains", "--no-contains", "--points-at",
  "--merged", "--no-merged", "--sort", "--format", "--color", "--no-color",
]);

// config read flags — anything not in this set is rejected.
const CONFIG_READ_FLAGS = new Set([
  "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l",
]);

// Returns the index of the subcommand token (after global options), or -1.
function findSubcommandIndex(argv: string[]): number {
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "-c") return -1; // -c can set config for the command — reject
    if (arg === "-C") { i += 2; continue; } // -C <dir> pair — harmless for reads
    if (arg.startsWith("-")) { i++; continue; } // bare flag (--no-pager, --paginate, ...)
    return i;
  }
  return -1;
}

function isAllowedBranch(args: string[]): boolean {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (BRANCH_MUTATING_FLAGS.has(arg)) return false;
      // Allow known read flags; reject anything we don't recognise.
      if (!BRANCH_READ_FLAGS.has(arg)) return false;
    }
    // Non-flag args (branch name / pattern) are fine for listing forms.
  }
  return true;
}

function isAllowedTag(args: string[]): boolean {
  // A bare arg is only a listing pattern if an explicit list flag is present;
  // otherwise it means creating/operating on a tag — reject.
  const hasListFlag = args.some((a) => a === "-l" || a === "--list");
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (TAG_MUTATING_FLAGS.has(arg)) return false;
      if (!TAG_READ_FLAGS.has(arg)) return false;
    } else if (!hasListFlag) {
      return false;
    }
  }
  return true;
}

function isAllowedConfig(args: string[]): boolean {
  // Require an explicit read flag; reject everything else (sets, unsets, edits).
  let hasReadFlag = false;
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!CONFIG_READ_FLAGS.has(arg)) return false;
      hasReadFlag = true;
    }
    // Non-flag args are keys/patterns for the read flag, which is fine.
  }
  return hasReadFlag;
}

function isAllowedStash(args: string[]): boolean {
  // Only `git stash list` / `git stash show`. Bare `git stash` is push.
  return args[0] === "list" || args[0] === "show";
}

function isAllowedRemote(args: string[]): boolean {
  // git remote, git remote -v, git remote show ..., git remote get-url ...
  if (args.length === 0) return true;
  if (args[0] === "-v" || args[0] === "--verbose") return true;
  return args[0] === "show" || args[0] === "get-url";
}

function isAllowedReflog(args: string[]): boolean {
  // git reflog, git reflog show. Reject delete / expire.
  if (args.length === 0) return true;
  return args[0] === "show";
}

function isAllowedWorktree(args: string[]): boolean {
  // Only `git worktree list` is a read. add/remove/prune/move/lock/unlock/repair
  // all mutate — those go through git-write (add) or are blocked (remove/prune).
  return args[0] === "list";
}

function isGitReadSegment(raw: string): boolean {
  const argv = tokenize(raw);
  if (!argv || argv[0] !== "git") return false;

  const subIdx = findSubcommandIndex(argv);
  if (subIdx === -1) return false;

  const sub = argv[subIdx];
  if (!READ_SUBCOMMANDS.has(sub)) return false;

  const args = argv.slice(subIdx + 1);

  switch (sub) {
    case "branch": return isAllowedBranch(args);
    case "tag": return isAllowedTag(args);
    case "config": return isAllowedConfig(args);
    case "stash": return isAllowedStash(args);
    case "remote": return isAllowedRemote(args);
    case "reflog": return isAllowedReflog(args);
    case "worktree": return isAllowedWorktree(args);
    default: return true;
  }
}

// Reject file-writing / input redirection in any segment's raw text; safe
// stream redirects (2>/dev/null, 2>&1, …) are permitted.
function hasRedirection(raw: string): boolean {
  return hasUnsafeRedirection(raw);
}

export function matchGitRead(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  for (const seg of segments) {
    if (hasRedirection(seg.raw)) return false;
  }

  // Only pipes are allowed between segments.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return false;
  }

  // First segment must be an allowed git read command.
  if (!isGitReadSegment(segments[0].raw)) return false;

  // Subsequent segments must be safe pipe consumers.
  for (const seg of segments.slice(1)) {
    if (!isSafePipeConsumer(seg.raw)) return false;
  }

  return true;
}
