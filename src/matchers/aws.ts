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
    "start-query",
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
  // High-level `aws s3` CLI. ONLY `ls` — it is the sole verb with no local side
  // effect. cp/sync/mv/rm are excluded: cp/sync/mv are direction-dependent (can
  // upload), rm deletes. Object downloads go through s3api get-object, which is
  // itself excluded because it writes a local file.
  s3: new Set([
    "ls",
  ]),
  // Low-level `aws s3api`. Pure metadata reads only — no get-object (writes a
  // local file), no put/create/delete/copy.
  s3api: new Set([
    "list-buckets",
    "list-objects",
    "list-objects-v2",
    "list-object-versions",
    "list-multipart-uploads",
    "head-bucket",
    "head-object",
    "get-bucket-location",
    "get-bucket-versioning",
    "get-bucket-tagging",
    "get-bucket-policy",
    "get-bucket-acl",
    "get-object-attributes",
    "get-object-tagging",
    "get-bucket-encryption",
    "get-bucket-lifecycle-configuration",
    "get-bucket-cors",
    "get-bucket-logging",
    "get-public-access-block",
  ]),
  // STS. Identity introspection only — get-caller-identity is the canonical
  // "who am I" read. Excluded: assume-role / get-session-token / get-federation-token,
  // which MINT credentials (a privileged side effect, not a read).
  sts: new Set([
    "get-caller-identity",
  ]),
  // IAM reads only. get-*/list-*/generate-*-report read policy/role/user
  // metadata. Every create/update/delete/attach/detach/put verb is excluded —
  // IAM writes change the account's permission surface.
  iam: new Set([
    "get-role",
    "get-role-policy",
    "get-user",
    "get-user-policy",
    "get-group",
    "get-group-policy",
    "get-policy",
    "get-policy-version",
    "get-instance-profile",
    "get-account-summary",
    "get-account-authorization-details",
    "get-account-password-policy",
    "list-roles",
    "list-role-policies",
    "list-attached-role-policies",
    "list-users",
    "list-user-policies",
    "list-attached-user-policies",
    "list-groups",
    "list-group-policies",
    "list-attached-group-policies",
    "list-groups-for-user",
    "list-policies",
    "list-policy-versions",
    "list-entities-for-policy",
    "list-instance-profiles",
    "list-instance-profiles-for-role",
    "list-access-keys",
    "list-account-aliases",
    "list-mfa-devices",
    "list-role-tags",
    "list-user-tags",
    "list-policy-tags",
  ]),
  // DynamoDB reads only. get/query/scan/batch-get read items; describe-*/list-*
  // read metadata. Excluded: put/update/delete-item, batch-write-item,
  // transact-write-items, create/update/delete-table (writes) and the PartiQL
  // execute-statement/execute-transaction/batch-execute-statement verbs, which
  // can mutate.
  dynamodb: new Set([
    "get-item",
    "batch-get-item",
    "query",
    "scan",
    "describe-table",
    "describe-continuous-backups",
    "describe-time-to-live",
    "describe-global-table",
    "describe-global-table-settings",
    "describe-kinesis-streaming-destination",
    "describe-contributor-insights",
    "describe-table-replica-auto-scaling",
    "describe-backup",
    "describe-export",
    "describe-import",
    "describe-limits",
    "describe-endpoints",
    "list-tables",
    "list-tags-of-resource",
    "list-backups",
    "list-exports",
    "list-imports",
    "list-global-tables",
    "list-contributor-insights",
  ]),
  // Lambda reads only. get-*/list-* read function/config/policy/layer metadata.
  // Excluded: invoke/invoke-async (execute the function and write the response
  // to a local file), and all create/update/delete/publish/add/remove verbs.
  lambda: new Set([
    "get-function",
    "get-function-configuration",
    "get-function-concurrency",
    "get-function-code-signing-config",
    "get-function-event-invoke-config",
    "get-function-url-config",
    "get-account-settings",
    "get-alias",
    "get-code-signing-config",
    "get-layer-version",
    "get-layer-version-by-arn",
    "get-layer-version-policy",
    "get-policy",
    "get-provisioned-concurrency-config",
    "get-runtime-management-config",
    "list-functions",
    "list-aliases",
    "list-versions-by-function",
    "list-event-source-mappings",
    "list-layers",
    "list-layer-versions",
    "list-tags",
    "list-function-event-invoke-configs",
    "list-function-url-configs",
    "list-provisioned-concurrency-configs",
    "list-code-signing-configs",
    "list-functions-by-code-signing-config",
  ]),
  // CloudFormation reads only. describe-*/list-*/get-* read stack, change-set,
  // stack-set, template, and export/import metadata. Every mutating verb is
  // excluded — create/update/delete-stack, deploy, execute-change-set,
  // cancel-update-stack, and set-stack-policy all change or roll out
  // infrastructure.
  cloudformation: new Set([
    "describe-stacks",
    "describe-stack-resources",
    "describe-stack-resource",
    "describe-stack-events",
    "describe-change-set",
    "describe-stack-set",
    "describe-stack-instance",
    "list-stacks",
    "list-stack-resources",
    "list-change-sets",
    "list-stack-sets",
    "list-exports",
    "list-imports",
    "get-template",
    "get-template-summary",
    "get-stack-policy",
  ]),
  // CloudWatch reads only. list-*/get-*/describe-* read metric, dashboard, and
  // alarm metadata plus metric data. Excluded: put-metric-data/put-metric-alarm/
  // put-dashboard/put-* (write metrics/alarms/dashboards), delete-* (remove them),
  // set-alarm-state (fakes an alarm transition), and enable/disable-alarm-actions
  // (change alarm behavior).
  cloudwatch: new Set([
    "list-metrics",
    "get-dashboard",
    "list-dashboards",
    "describe-alarms",
    "get-metric-data",
    "get-metric-statistics",
  ]),
  // `aws account`. Region introspection + contact info reads only. Excluded:
  // enable-region/disable-region (opt regions in/out), put-*/delete-* for
  // alternate-contact and contact-information (write account settings).
  account: new Set([
    "list-regions",
    "get-region-opt-status",
    "get-contact-information",
  ]),
  // `aws configure`. Reads of the local config/credentials only — `get` prints a
  // single value, `list`/`list-profiles` enumerate settings/profiles. Excluded:
  // set (writes a config value), import (writes credentials), and add-model
  // (writes a service model file) — all mutate local files.
  configure: new Set([
    "get",
    "list-profiles",
    "list",
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
