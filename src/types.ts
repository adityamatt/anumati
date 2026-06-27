export interface OpenConfig {
  allowed_paths: string[];
}

export interface Rule {
  tool?: string;
  matcher?: string;
  allowed_domains?: string[];
  allowed_imports?: string[];
  allowed_repos?: string[];
  allowed_packages?: string[];
  allowed_scripts?: string[];
  open?: OpenConfig;
  subagent_type?: string;
  desc?: string;
}

export interface AuditConfig {
  audit_file?: string;
  audit_level?: "off" | "matched" | "all";
}

export interface SuggestConfig {
  /** Generate config suggestions on passthrough. Default: true. */
  enabled?: boolean;
  /** Where accumulated suggestions are appended. Default: ~/.claude/anumati-suggestions.jsonl */
  file?: string;
  /** Print the suggestion to stderr alongside the permission prompt. Default: true. */
  stderr?: boolean;
}

export interface Config {
  audit?: AuditConfig;
  suggest?: SuggestConfig;
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
