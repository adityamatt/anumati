import { parseCompound, tokenize } from "../parser/shell.js";

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

function hasRedirection(raw: string): boolean {
  return raw.includes(">") || raw.includes("<");
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
    return allows(sub);
  }

  return false;
}

function isEchoSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}

function isWorkSegment(raw: string, allowedScripts: string[]): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  if (!argv) return false;
  if (isReadonlyQuerySegment(argv)) return true;
  if (isRunScriptSegment(argv, allowedScripts)) return true;
  return false;
}

export function matchNpmScript(command: string, allowedScripts: string[]): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // All operators must be &&
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "&&") return false;
  }

  let hasWork = false; // must have at least one real work segment
  let seenEcho = false;

  for (const seg of segments) {
    if (seenEcho) return false; // echo must be last

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
