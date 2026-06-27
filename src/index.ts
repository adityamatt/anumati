#!/usr/bin/env node
import { readFileSync } from "fs";
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
  // Otherwise act as a PreToolUse hook (argv[2], if present, is a config path).
  runHook();
}

main();
