import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";

// go subcommands that are read-only / build / test / lint and safe to allow.
// Notably excluded (run arbitrary code or mutate state): run, install, get,
// clean, generate, fix, telemetry, bug, tool, work.
const ALLOWED_SUBCOMMANDS = new Set([
  "build",
  "test",
  "vet",
  "fmt",
  "list",
  "doc",
  "version",
  "env",
  "mod",
]);

// Builtins safe to receive go output via a pipe
const SAFE_PIPE_BUILTINS = new Set([
  "head",
  "tail",
  "grep",
  "cat",
  "wc",
  "less",
  "sort",
  "uniq",
  "rg",
]);

// `go mod` subcommands that only read / fetch (no writes to go.mod, go.sum, or vendor)
const ALLOWED_MOD_SUBCOMMANDS = new Set([
  "graph",
  "verify",
  "why",
  "download",
]);

// Reject redirections, which the parser does not catch on its own
function hasRedirection(raw: string): boolean {
  return raw.includes(">") || raw.includes("<");
}

function isGoSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  const cmd = basename(argv[0]);

  // gofmt only formats (reads stdin / lists files) unless -w rewrites in place
  if (cmd === "gofmt") {
    return !argv.slice(1).includes("-w");
  }

  if (cmd !== "go") return false;

  const sub = argv[1];
  if (!sub || !ALLOWED_SUBCOMMANDS.has(sub)) return false;

  const rest = argv.slice(2);

  // `go env -w` / `go env -u` mutate persistent config; only allow the read form
  if (sub === "env" && (rest.includes("-w") || rest.includes("-u"))) return false;

  // `go test -exec <wrapper>` runs an arbitrary command around test binaries
  if (sub === "test" && rest.includes("-exec")) return false;

  // `go mod` may write go.mod/go.sum/vendor. Allow only read/fetch subcommands,
  // plus `go mod edit -print` (prints to stdout, does not write).
  if (sub === "mod") {
    const modSub = rest[0];
    if (!modSub) return false;
    if (modSub === "edit") return rest.includes("-print");
    return ALLOWED_MOD_SUBCOMMANDS.has(modSub);
  }

  // `go fmt` rewrites files, but gofmt formatting is idempotent and does not
  // change program logic, so it is treated as safe (and is extremely common).
  return true;
}

function isCdSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

function isSafePipeSegment(raw: string): boolean {
  if (hasRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && SAFE_PIPE_BUILTINS.has(basename(argv[0]));
}

export function matchGo(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let index = 0;

  // Optional leading: cd <dir> &&
  if (
    segments.length >= 2 &&
    segments[0].operator === "&&" &&
    isCdSegment(segments[0].raw)
  ) {
    index = 1;
  }

  // First (non-cd) segment must be go / gofmt
  if (!isGoSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe builtins
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeSegment(segments[i].raw)) return false;
  }

  return true;
}
