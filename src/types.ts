export interface OpenConfig {
  allowed_paths: string[];
}

export interface Rule {
  tool?: string;
  matcher?: string;
  allowed_domains?: string[];
  /**
   * URL scheme the `curl` matcher requires for `allowed_domains`. "https"
   * (default) permits only https:// targets; "http" permits http:// (use for
   * local/internal hosts). Write two rules to allow both — e.g. one http rule
   * for localhost and one https rule for external domains.
   */
  scheme?: "http" | "https";
  allowed_imports?: string[];
  allowed_modules?: string[];
  allowed_repos?: string[];
  allowed_packages?: string[];
  allowed_scripts?: string[];
  /**
   * Git write subcommands the `git-write` matcher may allow, e.g.
   * ["add","commit","branch","checkout"]. Only non-destructive, local ops can
   * be enabled — network ops (push/pull/fetch) and destructive/history-rewriting
   * forms (push --force, reset --hard, branch -D, clean -f, rebase, …) are
   * hard-blocked regardless of this list.
   */
  allowed_git_ops?: string[];
  open?: OpenConfig;
  subagent_type?: string;
  desc?: string;
}

export interface AuditConfig {
  audit_file?: string;
  audit_level?: "off" | "matched" | "all";
  /**
   * When set, non-approved (passthrough) calls are logged here instead of to
   * `audit_file`, keeping approvals and denials in separate files. Independent
   * of `audit_level`: passthroughs are recorded whenever this is set (unless
   * level is "off"). If unset, passthroughs go to `audit_file` only at level
   * "all".
   */
  passthrough_file?: string;
}

export interface SuggestConfig {
  /** Generate config suggestions on passthrough. Default: true. */
  enabled?: boolean;
  /** Where accumulated suggestions are appended. Default: ~/.claude/anumati-suggestions.jsonl */
  file?: string;
  /**
   * Surface suggestions/debug notes to the user (via the hook's `systemMessage`,
   * shown alongside the permission prompt). Default: true.
   */
  show?: boolean;
  /**
   * Debug mode: when a command falls through and no suggestion fires, surface a
   * 🔍 note explaining WHY it was not auto-approved (e.g. a `;` separator, a
   * redirection, an uncovered command). Useful while expanding your ruleset.
   * Default: false.
   */
  debug?: boolean;
}

export interface NotifyConfig {
  /**
   * Play a sound when a tool call falls through to Claude Code's own permission
   * flow (i.e. anumati did not auto-approve it), alerting the user that a call
   * may be waiting on them. Enabled by default when a config is present; set to
   * `false` to silence. Default: true.
   */
  sound?: boolean;
  /**
   * Override the command played on passthrough. Array form is argv
   * (["afplay", "/path/to.aiff"]); a string is split on whitespace. When unset,
   * a per-platform default is used (afplay on macOS, paplay on Linux, a
   * PowerShell beep on Windows).
   */
  sound_command?: string[] | string;
}

export interface Config {
  audit?: AuditConfig;
  suggest?: SuggestConfig;
  notify?: NotifyConfig;
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
