import path from "path";
import { parseCompound, tokenize } from "../parser/shell.js";

/**
 * Approve a Bash command that is *only* `cd <dir>`, where <dir> resolves to the
 * current working directory (or a folder beneath it), or to any configured
 * `allowedPaths` root (or a folder beneath one). The cwd case covers Claude
 * changing into the directory it is already operating in; `allowedPaths` opts in
 * additional roots — e.g. a sibling repo you frequently `cd` into. Either way
 * this is a no-op for safety, since shell state does not persist between Bash
 * calls anyway.
 *
 * Deliberately narrow: a single bare `cd <one-arg>` segment, no operators, no
 * redirection. A relative target is resolved against cwd, so `cd ..` and other
 * escapes out of cwd are only approved when they land inside an allowed root.
 */
export function matchCd(command: string, cwd: string, allowedPaths: string[] = []): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Must be exactly one segment with no trailing operator (`&`, `;`, `|`, …).
  if (segments.length !== 1 || segments[0].operator !== null) return false;

  const raw = segments[0].raw;
  if (raw.includes(">") || raw.includes("<")) return false;

  const argv = tokenize(raw);
  // Exactly `cd <dir>` — reject bare `cd` (goes home) and extra args.
  if (!argv || argv[0] !== "cd" || argv.length !== 2) return false;

  // The roots the target may resolve into: cwd (when known) plus any configured
  // allowed paths. A relative target still resolves against cwd, but is then
  // accepted if it lands under ANY of these roots.
  const roots: string[] = [];
  if (cwd) roots.push(path.resolve(cwd));
  for (const p of allowedPaths) {
    if (p) roots.push(path.resolve(p));
  }
  if (roots.length === 0) return false;

  const base = cwd ? path.resolve(cwd) : path.resolve(roots[0]);
  const target = path.resolve(base, argv[1]);

  return roots.some((root) => target === root || target.startsWith(root + path.sep));
}
