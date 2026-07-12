import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

// `git push` is a NETWORK-MUTATING write, so git-write hard-blocks it wholesale.
// This matcher carves out a single, provably-bounded safe shape:
//
//     git push [-u|--set-upstream] [-q|--quiet] <remote> <branch>
//
// i.e. push an explicit, non-protected branch to an allowlisted remote. It
// rejects everything that could clobber a shared ref or fan out:
//   - force forms       (--force / -f / --force-with-lease)
//   - deletions         (--delete / -d)
//   - bulk pushes       (--all / --mirror / --tags / --prune)
//   - hook bypass       (--no-verify)
//   - protected targets (a refspec whose destination is main/master/…)
//   - a bare `git push` (no explicit branch — target can't be verified)
//   - any unknown flag  (fail closed)
//
// Chaining is handled by evaluate() composition, so this matcher only ever sees
// a single command.

// Remotes a push may target. A bare rule defaults to origin only.
const DEFAULT_REMOTES = ["origin"];

// Branch names that must never be an auto-approved push target. A bare rule
// defaults to the common protected names; a rule may extend the list.
const DEFAULT_PROTECTED = ["main", "master", "release", "production", "prod"];

// Flags that are safe and take no value.
const SAFE_BOOLEAN_FLAGS = new Set([
  "-u", "--set-upstream",
  "-q", "--quiet",
  "--progress", "--no-progress",
]);

// The destination ref of a refspec: `src:dst` → dst; `branch` → branch. A
// leading `+` (force refspec) or a `refs/heads/` prefix is stripped so the
// protected-name check can't be evaded by spelling.
function refspecDestination(refspec: string): string {
  let s = refspec.startsWith("+") ? refspec.slice(1) : refspec; // + = force refspec
  const colon = s.indexOf(":");
  if (colon !== -1) s = s.slice(colon + 1); // src:dst → dst
  s = s.replace(/^refs\/heads\//, "").replace(/^heads\//, "");
  return s;
}

function isGitPushSegment(
  raw: string,
  remotes: string[],
  protectedBranches: string[],
): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "git" || argv[1] !== "push") return false;

  const positionals: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("-")) {
      // A `+` refspec is a force push spelled as a refspec, not a flag.
      if (!SAFE_BOOLEAN_FLAGS.has(arg)) return false; // unknown/dangerous flag → fail closed
      continue;
    }
    positionals.push(arg);
  }

  // Require EXACTLY `<remote> <branch>` — a bare push (target unknowable) or a
  // multi-refspec push both fall through to a manual prompt.
  if (positionals.length !== 2) return false;

  const [remote, refspec] = positionals;
  if (!remotes.includes(remote)) return false;

  // A leading `+` is a force refspec (overwrites the remote ref non-fast-forward)
  // — reject it outright, same as --force.
  if (refspec.startsWith("+")) return false;

  const dst = refspecDestination(refspec);
  if (!dst) return false;
  if (protectedBranches.includes(dst)) return false;

  return true;
}

export function matchGitPush(
  command: string,
  remotes: string[] = DEFAULT_REMOTES,
  protectedBranches: string[] = DEFAULT_PROTECTED,
): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Single command only; chaining is evaluate()'s job.
  if (segments.length !== 1 || segments[0].operator !== null) return false;

  const effectiveRemotes = remotes.length > 0 ? remotes : DEFAULT_REMOTES;
  // Protected list is ADDITIVE with the defaults — a rule can add names but
  // never shrink the built-in protection of main/master/….
  const effectiveProtected = [...new Set([...DEFAULT_PROTECTED, ...protectedBranches])];

  return isGitPushSegment(segments[0].raw, effectiveRemotes, effectiveProtected);
}
