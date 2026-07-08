import { appendFileSync } from "fs";
import type { HookInput, MatchResult, AuditConfig } from "./types.js";
import type { DebugNote } from "./debug.js";

// Formats a Date as an ISO 8601 string in the machine's local timezone,
// preserving the UTC offset (e.g. "2026-07-02T14:30:00.000-07:00") instead
// of normalizing to UTC like Date.prototype.toISOString() does.
function localISOString(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`
  );
}

function writeEntry(
  file: string,
  input: HookInput,
  result: MatchResult,
  note?: DebugNote | null,
): void {
  const entry: Record<string, unknown> = {
    ts: localISOString(new Date()),
    tool: input.tool_name,
    command: input.tool_input.command,
    file_path: input.tool_input.file_path,
    decision: result.decision ?? "passthrough",
    rule_desc: result.rule?.desc,
  };

  // On passthrough, record WHY it was not auto-approved so the log is
  // self-explanatory (no need to re-analyze the command later).
  if (result.decision === null && note) {
    entry.reason_code = note.code;
    entry.reason = note.reason;
    if (note.offending) entry.offending = note.offending;
  }

  try {
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // audit failure must not block execution
  }
}

export function audit(
  config: AuditConfig | undefined,
  input: HookInput,
  result: MatchResult,
  note?: DebugNote | null,
): void {
  const level = config?.audit_level ?? "matched";
  if (level === "off") return;

  const auditFile = config?.audit_file;
  const passthroughFile = config?.passthrough_file;

  if (result.decision === null) {
    // Non-approved (passthrough) call. Route to its own file when configured;
    // otherwise fall back to audit_file only when level is "all" (legacy behavior
    // where approvals and passthroughs share one file).
    const target = passthroughFile ?? (level === "all" ? auditFile : undefined);
    if (target) writeEntry(target, input, result, note);
    return;
  }

  // Approved call — always logged (for both "matched" and "all") to audit_file.
  if (auditFile) writeEntry(auditFile, input, result);
}
