export interface OpenConfig {
  allowed_paths: string[];
}

export interface Rule {
  tool?: string;
  matcher?: string;
  allowed_domains?: string[];
  allowed_imports?: string[];
  allowed_repos?: string[];
  open?: OpenConfig;
  subagent_type?: string;
  desc?: string;
}

export interface AuditConfig {
  audit_file?: string;
  audit_level?: "off" | "matched" | "all";
}

export interface Config {
  audit?: AuditConfig;
  allow?: Rule[];
}

export interface ToolInput {
  command?: string;
  file_path?: string;
  subagent_type?: string;
  [key: string]: unknown;
}

export interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: ToolInput;
  cwd?: string;
  permission_mode?: string;
}

export interface MatchResult {
  decision: "allow" | null;
  rule: Rule | null;
}
