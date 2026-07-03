import path from "path";

/**
 * Approve a write only when the target file resolves to a location inside one
 * of the configured allowed directories. Unlike `safe-read`, which merely
 * rejects `..`, this fully resolves both the target and each allowed root so
 * that `..` traversal that escapes a root simply lands outside every root and
 * is rejected — and so that `/foo/barbaz` is not treated as inside `/foo/bar`.
 */
export function matchSafeWrite(
  filePath: string,
  allowedPaths: string[],
  cwd: string,
): boolean {
  if (!filePath) return false;
  if (!allowedPaths || allowedPaths.length === 0) return false;

  const base = cwd || process.cwd();
  const target = path.resolve(base, filePath);

  for (const allowed of allowedPaths) {
    if (!allowed) continue;
    const root = path.resolve(base, allowed);
    if (target === root || target.startsWith(root + path.sep)) return true;
  }

  return false;
}
