import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// `docker` is only safe in provably read-only, one-shot forms. The daemon can
// run arbitrary code (run/exec/build), mutate state (rm/create/start/stop),
// reach the network (push/pull), write files (cp/save/export), and stream
// forever (logs -f/attach/events/stats) — so we admit ONLY a strict allowlist
// of inspection subcommands and fail closed on everything else.
//
// A leading env-var prefix is permitted, but restricted to docker-specific
// connection variables. An arbitrary `VAR=` prefix is UNTRUSTED here: it could
// set LD_PRELOAD / PATH to run attacker code before docker ever starts, so any
// name outside this set is rejected.
const DOCKER_ENV_VARS = new Set([
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
]);

// Read-only subcommands whose every flag is inspection-only — they print state
// and exit. `ps` flags (-a/-q/--format/--filter/-n/-s/…) are all read-only, and
// `inspect`/`version`/`info`/`top`/`port` likewise only read. `images` is the
// listing form of `image ls`.
const READ_SUBCOMMANDS = new Set([
  "ps", "images", "inspect", "version", "info", "top", "port",
]);

// True if `raw` is a single, provably read-only `docker` invocation: an optional
// docker-specific env prefix, then `docker <read-only subcommand>`, no file
// write / input redirection. Mutating/exec subcommands (run/exec/rm/rmi/build/
// create/start/stop/restart/kill/cp/commit/tag/push/pull/save/load/export/
// import/login/prune, system/volume/network/compose writes) and long-running or
// interactive forms (`logs -f`, `attach`, `events`, `wait`, streaming `stats`)
// all fail closed — the allowlist below only ever returns true.
function isDockerReadSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;

  // Strip a leading run of docker-specific env-var assignments; reject on the
  // first VAR= whose name is not in the connection allowlist (fail closed).
  let i = 0;
  while (i < argv.length) {
    const m = argv[i].match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) break;
    if (!DOCKER_ENV_VARS.has(m[1])) return false;
    i++;
  }

  if (argv[i] !== "docker") return false;

  const sub = argv[i + 1];
  if (sub === undefined) return false; // bare `docker` — no read subcommand
  const args = argv.slice(i + 2);

  switch (sub) {
    case "ps":
    case "images":
    case "inspect":
    case "version":
    case "info":
    case "top":
    case "port":
      return true;
    case "image":
      // Only the read-only listing form `docker image ls`; rm/prune/build/… on
      // the `image` management command all mutate.
      return args[0] === "ls";
    case "logs":
      // Read-only unless it follows the stream — `-f`/`--follow` never returns
      // and would hang the hook.
      return !args.some((a) => a === "-f" || a === "--follow");
    case "stats":
      // `stats` streams continuously by default; only the one-shot
      // `--no-stream` snapshot form is safe.
      return args.includes("--no-stream");
    default:
      return false;
  }
}

export function matchDockerRead(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only | (pipe to safe consumers) allowed between segments; &&/;/& chaining is
  // handled by evaluate() composition across matched sub-commands.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return false;
  }

  // First segment must be a read-only docker command; the rest safe pipe
  // consumers (docker ps | grep …, docker inspect x | jq …).
  if (!isDockerReadSegment(segments[0].raw)) return false;
  for (const seg of segments.slice(1)) {
    if (!isSafePipeConsumer(seg.raw)) return false;
  }

  return true;
}
