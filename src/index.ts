#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { evaluate } from "./matcher.js";
import { audit } from "./audit.js";
import {
  defaultConfigPath,
  projectConfigPath,
  loadConfig,
} from "./config.js";
import { suggest } from "./suggest.js";
import {
  storeSuggestion,
  defaultSuggestionsFile,
} from "./suggest-store.js";
import { runAdd } from "./cli/add.js";
import { runApply } from "./cli/apply.js";
import type {
  Config,
  HookInput,
  MatchResult,
  Rule,
  SuggestConfig,
} from "./types.js";

function readStdin(): string {
  return readFileSync("/dev/stdin", "utf-8");
}

function resolveRootConfigPath(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  return defaultConfigPath();
}

// Merge suggest config across configs; project overrides root field-by-field.
function resolveSuggestConfig(
  projectConfig: Config | null,
  rootConfig: Config | null,
): Required<SuggestConfig> {
  const root = rootConfig?.suggest ?? {};
  const project = projectConfig?.suggest ?? {};
  return {
    enabled: project.enabled ?? root.enabled ?? true,
    stderr: project.stderr ?? root.stderr ?? true,
    file: project.file ?? root.file ?? defaultSuggestionsFile(),
  };
}

function runHook(): void {
  let input: HookInput;
  try {
    input = JSON.parse(readStdin()) as HookInput;
  } catch {
    process.exit(0); // unparseable input → passthrough
  }

  const rootConfig = loadConfig(resolveRootConfigPath());
  const projectConfig = input.cwd
    ? loadConfig(projectConfigPath(input.cwd))
    : null;

  if (!projectConfig && !rootConfig) {
    process.exit(0); // no config anywhere → passthrough
  }

  // Cascade: project first, root only if project didn't allow
  let projectResult: MatchResult = { decision: null, rule: null };
  let rootResult: MatchResult = { decision: null, rule: null };

  if (projectConfig) {
    projectResult = evaluate(input, projectConfig.allow ?? []);
  }
  if (projectResult.decision !== "allow" && rootConfig) {
    rootResult = evaluate(input, rootConfig.allow ?? []);
  }

  // Audit each config independently; root only audited when actually consulted
  if (projectConfig) {
    audit(projectConfig.audit, input, projectResult);
  }
  if (rootConfig && projectResult.decision !== "allow") {
    audit(rootConfig.audit, input, rootResult);
  }

  if (projectResult.decision === "allow" || rootResult.decision === "allow") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      })
    );
    return;
  }

  // Passthrough — try to suggest a config change that would auto-approve this.
  const sc = resolveSuggestConfig(projectConfig, rootConfig);
  if (!sc.enabled) return;

  const allRules: Rule[] = [
    ...(projectConfig?.allow ?? []),
    ...(rootConfig?.allow ?? []),
  ];

  const suggestion = suggest(input, allRules);
  if (!suggestion) return;

  if (sc.stderr) {
    const riskNote =
      suggestion.risk !== "low"
        ? `\n   ⚠️  ${suggestion.risk} risk: ${suggestion.riskReason ?? ""}`
        : "";
    process.stderr.write(
      `💡 anumati: ${suggestion.description}\n` +
        `   Run: ${suggestion.command}${riskNote}\n`
    );
  }
  storeSuggestion(suggestion, sc.file);
}

function readVersion(): string {
  // package.json sits one level above dist/ (this file is dist/index.js at runtime).
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8")
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const HELP = `anumati — a PreToolUse hook for Claude Code that auto-allows safe tool calls.

Usage:
  anumati [config-path]            Run as a PreToolUse hook (reads a JSON request on stdin).
                                   config-path defaults to ~/.claude/permissions.json.
  anumati add <matcher> [flags]    Add or extend an allow rule in a config.
  anumati apply [--all|--clear]    Review accumulated suggestions; apply or discard them.
  anumati --help | -h              Show this help.
  anumati --version | -V           Show the installed version.

add flags:
  --domain X[,Y]     domains for the "curl" matcher
  --imports X[,Y]    Python modules for the "python3-pipe" matcher
  --packages X[,Y]   packages for the "pip3-install" matcher
  --scripts X[,Y]    script names for the "npm-script" matcher
  --repos X[,Y]      owner/repo slugs for the "gh" matcher
  --paths X[,Y]      open() path prefixes for the "python3-pipe" matcher
  --config <path>    target a specific config file (default: ~/.claude/permissions.json)

Config cascade: a project config at <cwd>/.claude/permissions.json is checked
before your global ~/.claude/permissions.json.

Docs: https://github.com/adityamatt/anumati#readme`;

function main(): void {
  const subcommand = process.argv[2];

  if (subcommand === "add") {
    runAdd(process.argv.slice(2));
    return;
  }
  if (subcommand === "apply") {
    runApply(process.argv.slice(2));
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    return;
  }
  if (subcommand === "--version" || subcommand === "-V") {
    console.log(readVersion());
    return;
  }

  // The hook reads a JSON request on stdin, which Claude Code always pipes in.
  // If stdin is an interactive terminal, this was a human running `anumati`
  // (with no recognized subcommand) — show help instead of blocking on stdin.
  if (process.stdin.isTTY) {
    console.log(HELP);
    return;
  }

  // Otherwise act as a PreToolUse hook (argv[2], if present, is a config path).
  runHook();
}

main();
