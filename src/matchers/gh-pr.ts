import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

// The `gh` matcher only allows read-only `gh api repos/<owner/repo>` GETs, so
// `gh pr create` (a network write that opens a PR) falls through. This matcher
// permits the NON-DESTRUCTIVE pr subcommands only:
//
//     gh pr create | edit | comment | ready | view | list | status | diff | checks
//
// and hard-blocks the ones that change merge/lifecycle state or run arbitrary
// API writes:
//
//     gh pr merge | close | reopen | review | lock | unlock | delete
//
// Rationale: create/edit/comment produce a reviewable artifact that a human
// still approves before it lands; merge/close mutate the shared repo state
// directly. Only `pr` is handled — `gh api`, `gh release`, `gh repo`, `gh run`,
// etc. remain the read-only `gh` matcher's domain (or blocked).

const SAFE_PR_SUBCOMMANDS = new Set([
  "create", "edit", "comment", "ready",
  "view", "list", "status", "diff", "checks",
]);

// Enumerated for clarity / intent; anything NOT in SAFE_PR_SUBCOMMANDS is
// rejected anyway (fail closed), but listing these documents the boundary.
const BLOCKED_PR_SUBCOMMANDS = new Set([
  "merge", "close", "reopen", "review", "lock", "unlock", "delete",
]);

function isGhPrSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "gh" || argv[1] !== "pr") return false;

  const sub = argv[2];
  if (!sub || sub.startsWith("-")) return false; // need an explicit subcommand
  if (BLOCKED_PR_SUBCOMMANDS.has(sub)) return false;
  if (!SAFE_PR_SUBCOMMANDS.has(sub)) return false; // fail closed on anything new

  return true;
}

export function matchGhPr(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Single command only; chaining is evaluate()'s job. (No pipe tail either —
  // gh pr create's output is a URL, not something we compose here.)
  if (segments.length !== 1 || segments[0].operator !== null) return false;

  return isGhPrSegment(segments[0].raw);
}
