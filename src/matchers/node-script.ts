import path from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Run a TRUSTED local Node script by path: `node <script.js> [args…]`.
//
// The nodejs-pipe matcher only covers `node -e/-p` inline code (and scripts
// whose SOURCE passes the pure-compute check) — it rejects any script that
// touches fs/child_process/network. But some repo scripts legitimately read and
// write files (e.g. scripts/triage-passthrough.js writes its report), so they
// can never pass that content check. This matcher takes a different, explicit
// stance: it trusts a script BY LOCATION — the resolved script path must sit
// inside a configured allowed root (open.allowed_paths). You are vouching for
// the scripts under those roots, exactly as you would when running them by hand.
//
// It stays narrow on the command SHAPE:
//   - leading command is exactly `node` (or an absolute path whose basename is
//     node) with a script-file first arg (not a flag),
//   - the script path resolves INSIDE an allowed root (no `..` escape),
//   - no dangerous node runtime flags before the script
//     (--experimental-*, -r/--require, --loader/--import can preload arbitrary
//     code, so a flag before the script is rejected),
//   - trailing args after the script are fine — they are the script's argv,
//     not shell tokens,
//   - no file redirection; a pipe tail must be a safe read-only consumer.

// node runtime flags are rejected wholesale (fail closed): the safe invocation
// is `node <script> [scriptargs]` with nothing between `node` and the script.
function isNodeScriptSegment(raw: string, roots: string[]): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv.length < 2) return false;
  if (path.basename(argv[0]) !== "node") return false;

  // The first arg must be the script path — a flag here means a runtime option
  // (e.g. -r ./evil, --import ./evil), which we do not auto-approve.
  const scriptArg = argv[1];
  if (scriptArg.startsWith("-")) return false;

  // Resolve the script path and require it to land inside an allowed root. An
  // absolute path is tested as-is; a relative one is resolved against each root.
  const candidates = scriptArg.startsWith("/")
    ? [path.resolve(scriptArg)]
    : roots.map((r) => path.resolve(r, scriptArg));

  return candidates.some((abs) =>
    roots.some((root) => {
      const R = path.resolve(root);
      return abs === R || abs.startsWith(R + path.sep);
    }),
  );
}

export function matchNodeScript(command: string, cwd: string = "", allowedPaths: string[] = []): boolean {
  if (allowedPaths.length === 0 && !cwd) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  // Roots the script may live under: cwd (the repo being operated in) plus any
  // configured allowed paths.
  const roots: string[] = [];
  if (cwd) roots.push(path.resolve(cwd));
  for (const p of allowedPaths) if (p) roots.push(path.resolve(p));
  if (roots.length === 0) return false;

  // First segment must be the node-script invocation; any trailing segments must
  // be safe read-only pipe consumers.
  if (!isNodeScriptSegment(segments[0].raw, roots)) return false;
  for (const seg of segments.slice(1)) {
    if (seg.operator !== null && seg.operator !== "|") return false;
    if (!isSafePipeConsumer(seg.raw)) return false;
  }
  // The node segment itself must connect to the tail only via a pipe (not && etc);
  // sequential chaining across commands is evaluate()'s job, not this matcher's.
  if (segments.length > 1 && segments[0].operator !== "|") return false;

  return true;
}
