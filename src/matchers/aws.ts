import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// Read-only AWS CLI subcommands, per service. Nested composite: the top-level
// `aws` matcher dispatches on the service token to a per-service allowlist, so
// new services can be added without touching the dispatch logic. Only commands
// that read state (list-*/describe-*/get-*/filter-*) are included — nothing that
// creates, updates, deletes, starts, stops, or sends.
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  logs: new Set([
    "describe-log-groups",
    "describe-log-streams",
    "filter-log-events",
    "get-log-events",
    "get-log-record",
    "get-query-results",
    "describe-queries",
    "describe-metric-filters",
    "describe-subscription-filters",
    "list-tags-log-group",
  ]),
  stepfunctions: new Set([
    "describe-execution",
    "describe-map-run",
    "describe-state-machine",
    "describe-state-machine-for-execution",
    "get-execution-history",
    "list-executions",
    "list-map-runs",
    "list-state-machines",
    "list-activities",
    "list-tags-for-resource",
  ]),
};

function isAwsSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv) return false;
  if (basename(argv[0]) !== "aws") return false;

  // aws <service> <subcommand> ... — the two tokens after `aws`. AWS accepts no
  // global options before the service name that we need to allow, so anything
  // other than `aws <service> <sub>` in the first three tokens is rejected.
  const service = argv[1];
  const sub = argv[2];
  if (!service || !sub) return false;

  const allowed = READ_ONLY_SUBCOMMANDS[service];
  if (!allowed) return false;
  return allowed.has(sub);
}

function isCdSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchAws(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only && (leading cd) and | (safe pipes) operators are permitted.
  // Reject ;, ||, & (including a trailing background &) outright.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "&&" && seg.operator !== "|") {
      return false;
    }
  }

  let index = 0;

  // Optional leading: cd <dir> &&
  if (
    segments.length >= 2 &&
    segments[0].operator === "&&" &&
    isCdSegment(segments[0].raw)
  ) {
    index = 1;
  }

  // First (non-cd) segment must be a read-only aws command.
  if (!isAwsSegment(segments[index].raw)) return false;
  index++;

  // Remaining segments must be piped safe consumers.
  for (let i = index; i < segments.length; i++) {
    if (segments[i - 1].operator !== "|") return false;
    if (!isSafePipeConsumer(segments[i].raw)) return false;
  }

  return true;
}
