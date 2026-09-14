import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);

// Read-only query subcommands that are always safe (no allowlist needed).
// "config" is special-cased below (only "config get" is allowed).
const READONLY_SUBCOMMANDS = new Set([
  "ls",
  "list",
  "view",
  "outdated",
  "ping",
  "root",
  "prefix",
  "why",
]);

// Flags that only select WHERE a script runs (a workspace package or a
// directory), never WHAT runs. They may sit between the package manager and its
// subcommand — `pnpm -C apps/api test`, `pnpm --filter @x/y build`, `pnpm -r
// lint` — and are transparent to the allowedScripts gate: the script named after
// them is still the thing that must be allowlisted. Value-taking flags consume
// the next token (or fold it in as `--flag=value`); boolean flags stand alone.
const SELECTOR_VALUE_FLAGS = new Set(["-C", "--dir", "--prefix", "--cwd", "--filter", "-F"]);
const SELECTOR_BOOL_FLAGS = new Set(["-w", "--workspace-root", "-r", "--recursive"]);

// pnpm/yarn builtin subcommands that are NOT user scripts. They must never be
// approved via the bare `<pm> <script>` path (even under a "*" allowlist), since
// they install/mutate, run lifecycle scripts, or launch arbitrary binaries.
const RESERVED_SUBCOMMANDS = new Set([
  "install", "i", "add", "remove", "rm", "update", "up", "upgrade",
  "exec", "dlx", "create", "import", "patch", "publish", "pack",
  "link", "unlink", "dedupe", "prune", "rebuild", "store", "config",
  "init", "setup", "deploy",
]);

/**
 * Advance past any leading selector flags, starting at `i` (the token right after
 * the package manager). Returns the index of the first token that is NOT a
 * selector flag, or -1 if a value-taking flag is missing its value (a malformed
 * form we refuse to approve). Exported so `suggest` extracts the same script name.
 */
export function skipSelectorFlags(argv: string[], i: number): number {
  while (i < argv.length) {
    const tok = argv[i];
    if (SELECTOR_BOOL_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    if (SELECTOR_VALUE_FLAGS.has(tok)) {
      if (i + 1 >= argv.length) return -1; // flag with no value
      i += 2;
      continue;
    }
    // `--filter=@x/y`, `--dir=/path` — value folded into the same token.
    const eq = tok.indexOf("=");
    if (eq > 0 && SELECTOR_VALUE_FLAGS.has(tok.slice(0, eq))) {
      i += 1;
      continue;
    }
    break; // first non-selector token
  }
  return i;
}

// Rewrite `<pm> <selector-flags…> <sub> …` to the plain `<pm> <sub> …` the checks
// below expect, dropping the location selectors. Returns null for a malformed
// selector flag; leaves a non-package-manager argv untouched.
function stripSelectors(argv: string[]): string[] | null {
  if (!PACKAGE_MANAGERS.has(argv[0])) return argv;
  const subIdx = skipSelectorFlags(argv, 1);
  if (subIdx < 0) return null;
  if (subIdx === 1) return argv; // no selector flags — avoid a needless copy
  return [argv[0], ...argv.slice(subIdx)];
}

// Return the raw remainder of `raw` after dropping its first `n` whitespace-
// separated tokens, honoring quotes so a quoted argument is not miscounted. The
// remainder preserves the original text (pipes, spacing, redirects) after the cut.
function dropLeadingTokens(raw: string, n: number): string {
  let i = 0;
  let dropped = 0;
  let state: "normal" | "single" | "double" = "normal";
  while (dropped < n && i < raw.length) {
    while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) i++;
    if (i >= raw.length) break;
    while (i < raw.length) {
      const ch = raw[i];
      if (state === "single") {
        if (ch === "'") state = "normal";
      } else if (state === "double") {
        if (ch === '"') state = "normal";
      } else if (ch === "'") {
        state = "single";
      } else if (ch === '"') {
        state = "double";
      } else if (ch === " " || ch === "\t") {
        break; // token boundary
      }
      i++;
    }
    dropped++;
  }
  return raw.slice(i).replace(/^[ \t]+/, "");
}

/**
 * If `command` is a `<pm> [selector-flags] exec <tail…>` form, return the raw
 * `<tail…>` (everything after `exec`); otherwise null. `<pm> exec` runs a binary
 * from node_modules/.bin, which grants nothing beyond running `<tail>` directly —
 * so the caller approves it only when `<tail>` is itself independently approved.
 *
 * Deliberately narrow: only when the command has no sequential operator
 * (`&&`/`;`/`||`/`&`), so a chain like `pnpm exec a && pnpm exec b` is left to the
 * evaluator's sequential composition to split and check piece by piece. Pipes stay
 * with the tail (they never separate sub-commands), so `pnpm exec vitest | tail`
 * delegates the whole `vitest | tail` and the receiving matcher judges the pipe.
 */
function execWrapperTail(segments: ReturnType<typeof parseCompound>, command: string): string | null {
  if (!segments) return null;
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return null;
  }
  const argv = tokenize(segments[0].raw);
  if (!argv || !PACKAGE_MANAGERS.has(argv[0])) return null;
  const execIdx = skipSelectorFlags(argv, 1);
  if (execIdx < 0 || argv[execIdx] !== "exec") return null;
  if (execIdx + 1 >= argv.length) return null; // `exec` with nothing to run
  const tail = dropLeadingTokens(command.trim(), execIdx + 1);
  return tail.length > 0 ? tail : null;
}

/**
 * Parse a `<pm> [selectors] exec <bin> …` launcher into the delegated `tail`
 * (everything after `exec`) and the target `bin` (the first token's basename, so
 * `./node_modules/.bin/vitest` → `vitest`). Returns null if `command` is not an
 * exec launcher. Exported so both the matcher's gate and `suggest` agree on which
 * binary a launcher targets.
 */
export function npmExecInfo(command: string): { tail: string; bin: string } | null {
  const tail = execWrapperTail(parseCompound(command), command);
  if (tail === null) return null;
  const first = tokenize(tail)?.[0];
  if (!first) return null;
  return { tail, bin: basename(first) };
}

function hasRedirection(raw: string): boolean {
  return hasUnsafeRedirection(raw);
}

// npm/pnpm/yarn read-only queries — independent of allowedScripts.
function isReadonlyQuerySegment(argv: string[]): boolean {
  const pm = argv[0];
  if (!PACKAGE_MANAGERS.has(pm)) return false;

  const sub = argv[1];
  if (!sub) return false;

  if (sub === "config") {
    // Only `<pm> config get <key>` is read-only. Reject set/delete/etc.
    return argv[2] === "get" && argv.length === 4;
  }

  return READONLY_SUBCOMMANDS.has(sub);
}

// Package-manager run-script forms gated by allowedScripts.
function isRunScriptSegment(argv: string[], allowedScripts: string[]): boolean {
  const pm = argv[0];
  if (!PACKAGE_MANAGERS.has(pm)) return false;

  const sub = argv[1];
  if (!sub) return false;

  const allows = (script: string): boolean =>
    allowedScripts.includes("*") || allowedScripts.includes(script);

  // `npm run <script> [-- <args>]`, `pnpm run <script>`, `yarn run <script>`
  if (sub === "run") {
    const script = argv[2];
    if (!script) return false;
    if (!allows(script)) return false;
    // Anything after the script name is only permitted via `-- <args>`.
    if (argv.length === 3) return true;
    return argv[3] === "--";
  }

  // Bare `npm test` / `pnpm test` / `yarn test` — implicit test script.
  if (sub === "test") {
    return argv.length === 2 && allows("test");
  }

  // `yarn <script>` / `pnpm <script>` — bare script invocation (not npm).
  // npm requires the explicit `run` keyword, so do not accept `npm <script>`.
  if (pm === "yarn" || pm === "pnpm") {
    if (argv.length !== 2) return false;
    // Never let a package-manager builtin masquerade as a user script under a
    // wildcard allowlist. `install`/`add`/`update` run lifecycle (postinstall)
    // scripts — arbitrary code — and `exec`/`dlx` launch binaries; these must go
    // through their own gate (exec) or a prompt, not the bare-script path.
    if (RESERVED_SUBCOMMANDS.has(sub)) return false;
    return allows(sub);
  }

  return false;
}

function isEchoSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}

// A safe stream redirect (2>&1, >/dev/null, …) survives tokenization as a
// trailing argv token; drop such tokens so the argv checks below see just the
// command words. Unsafe (file) redirects are already rejected by hasRedirection.
function stripStreamRedirects(argv: string[]): string[] {
  return argv.filter((a) => !/^(\d*|&)?>>?/.test(a) && a !== "&1" && a !== "&2");
}

function isWorkSegment(raw: string, allowedScripts: string[]): boolean {
  if (hasRedirection(raw)) return false;
  const tokens = tokenize(raw);
  if (!tokens) return false;
  // Normalize away workspace/dir selector flags (`-C dir`, `--filter x`, …) so the
  // checks below see a plain `<pm> <sub> …` regardless of the selection prefix.
  const argv = stripSelectors(stripStreamRedirects(tokens));
  if (!argv) return false;
  if (isReadonlyQuerySegment(argv)) return true;
  if (isRunScriptSegment(argv, allowedScripts)) return true;
  return false;
}

/**
 * @param allowedExec - binaries a `<pm> exec <bin> …` launcher may reroute to
 *   ("*" = any, empty = none). A binary must be listed here AND its delegated
 *   tail independently approved for the exec form to pass.
 * @param isAllowed - evaluator the caller supplies so `<pm> exec <tail>` can be
 *   approved iff `<tail>` is independently approved by the full ruleset. Omitted
 *   (e.g. in unit tests or suggest) means exec tails cannot be verified, so any
 *   `<pm> exec …` is denied.
 */
export function matchNpmScript(
  command: string,
  allowedScripts: string[],
  allowedExec: string[] = [],
  isAllowed?: (command: string) => boolean,
): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // `<pm> exec <bin> <tail>` → reroute only when <bin> is opted in via allowedExec
  // AND the delegated tail is independently allowed by the ruleset.
  const execTail = execWrapperTail(segments, command);
  if (execTail !== null) {
    if (!isAllowed) return false;
    const bin = tokenize(execTail)?.[0];
    if (!bin) return false;
    const eligible = allowedExec.includes("*") || allowedExec.includes(basename(bin));
    return eligible && isAllowed(execTail);
  }

  // Only && (between work/echo) and | (piping into safe consumers) are allowed.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "&&" && seg.operator !== "|") return false;
  }

  let hasWork = false; // must have at least one real work segment
  let seenEcho = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // A segment reached via a pipe must be a safe read-only consumer (e.g.
    // `npm run build | tail`). This applies to any segment whose predecessor
    // was joined with `|`.
    if (i > 0 && segments[i - 1].operator === "|") {
      if (!isSafePipeConsumer(seg.raw)) return false;
      continue;
    }

    if (seenEcho) return false; // echo must be last (before any pipe)
    if (hasRedirection(seg.raw)) return false;

    if (isEchoSegment(seg.raw)) {
      seenEcho = true;
    } else if (isWorkSegment(seg.raw, allowedScripts)) {
      hasWork = true;
    } else {
      return false;
    }
  }

  return hasWork;
}
