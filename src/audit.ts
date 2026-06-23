import { appendFileSync } from "fs";
import type { HookInput, MatchResult, AuditConfig } from "./types.js";

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
    ts: new Date().toISOString(),
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
