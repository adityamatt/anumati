import { appendFileSync } from "fs";
import type { HookInput, MatchResult, AuditConfig } from "./types.js";

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

export function audit(
  config: AuditConfig | undefined,
  input: HookInput,
  result: MatchResult
): void {
  const level = config?.audit_level ?? "matched";
  const file = config?.audit_file;

  if (level === "off" || !file) return;
  if (level === "matched" && result.decision === null) return;

  const entry = {
    ts: localISOString(new Date()),
    tool: input.tool_name,
    command: input.tool_input.command,
    file_path: input.tool_input.file_path,
    decision: result.decision ?? "passthrough",
    rule_desc: result.rule?.desc,
  };

  try {
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // audit failure must not block execution
  }
}
