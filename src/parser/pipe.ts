import { basename } from "path";
import { tokenize } from "./shell.js";
import { hasUnsafeRedirection } from "./redirect.js";
import { isReadOnlySed } from "./sed-safe.js";

// Pure read-only output *consumers* that are safe to receive any command's
// output via a pipe. These have no side effects, no network, and no file writes
// — they only transform or display text on stdin. This set is shared by the
// segment-independent matchers (cargo/go/git-read/vitest/aws): after the matched
// command, every remaining `|`-segment must be one of these.
//
// NOTE: this is deliberately a curated consumer allowlist, NOT "any approvable
// command". anumati never composes different rules across a pipe (see README),
// so a pipe tail can only ever be one of these builtins — never another
// arbitrary matched command.
export const SAFE_PIPE_CONSUMERS = new Set([
  "head", "tail", "grep", "egrep", "fgrep", "rg",
  "cat", "wc", "less", "more", "sort", "uniq", "cut", "column", "nl", "tr",
  "jq",
]);

// True if `raw` is a single safe read-only consumer command (no unsafe
// redirection). Used to validate each trailing pipe segment. A provably
// read-only `sed` (e.g. `sed -n '1,80p'`) also qualifies — its full grammar is
// vetted by isReadOnlySed, which rejects -i / write / exec / -f forms.
export function isSafePipeConsumer(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  if (!argv) return false;
  if (SAFE_PIPE_CONSUMERS.has(basename(argv[0]))) return true;
  return isReadOnlySed(raw);
}
