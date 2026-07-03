import path from "path";
import { parseCompound, tokenize } from "../parser/shell.js";

/**
 * Approve a Bash command that is *only* `cd <dir>`, where <dir> resolves to the
 * current working directory or a folder beneath it. This covers the common case
 * of Claude changing into the directory it is already operating in (or a
 * subfolder) — a no-op for safety, since shell state does not persist between
 * Bash calls anyway.
 *
 * Deliberately narrow: a single bare `cd <one-arg>` segment, no operators, no
 * redirection, and no escaping the cwd subtree via `..`. A `cd` target outside
 * cwd (e.g. `cd /etc`, `cd ~`, `cd ..`) is not approved.
 */
export function matchCd(command: string, cwd: string): boolean {
  if (!cwd) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  // Must be exactly one segment with no trailing operator (`&`, `;`, `|`, …).
  if (segments.length !== 1 || segments[0].operator !== null) return false;

  const raw = segments[0].raw;
  if (raw.includes(">") || raw.includes("<")) return false;

  const argv = tokenize(raw);
  // Exactly `cd <dir>` — reject bare `cd` (goes home) and extra args.
  if (!argv || argv[0] !== "cd" || argv.length !== 2) return false;

  const root = path.resolve(cwd);
  const target = path.resolve(root, argv[1]);

  return target === root || target.startsWith(root + path.sep);
}
