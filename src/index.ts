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
import { playSound } from "./notify.js";
import { debugDiagnose, formatDebugNote } from "./debug.js";
import {
  storeSuggestion,
  defaultSuggestionsFile,
} from "./suggest-store.js";
import { runInit } from "./cli/init.js";
import { runAdd } from "./cli/add.js";
import { runApply } from "./cli/apply.js";
import { runDebug } from "./cli/debug.js";
import { runSessionStart } from "./cli/session-start.js";
import type {
  Config,
  HookInput,
  MatchResult,
  NotifyConfig,
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
    show: project.show ?? root.show ?? true,
    file: project.file ?? root.file ?? defaultSuggestionsFile(),
    debug: project.debug ?? root.debug ?? false,
  };
}

// Merge notify config across configs; project overrides root field-by-field.
function resolveNotifyConfig(
  projectConfig: Config | null,
  rootConfig: Config | null,
): NotifyConfig {
  const root = rootConfig?.notify ?? {};
  const project = projectConfig?.notify ?? {};
  return {
    sound: project.sound ?? root.sound,
    sound_command: project.sound_command ?? root.sound_command,
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

  // Passthrough — the call is heading to Claude Code's own permission flow.
  // Play the alert sound (fire-and-forget; never blocks or affects the decision)
  // so the user knows a call may be waiting on them.
  playSound(resolveNotifyConfig(projectConfig, rootConfig));

  // Try to suggest a config change that would auto-approve this.
  const sc = resolveSuggestConfig(projectConfig, rootConfig);

  const allRules: Rule[] = [
    ...(projectConfig?.allow ?? []),
    ...(rootConfig?.allow ?? []),
  ];

  const suggestion = sc.enabled ? suggest(input, allRules) : null;

  if (suggestion) {
    // Always persist to the store (for `anumati apply`), regardless of display.
    storeSuggestion(suggestion, sc.file);
    if (sc.show) {
      emitMessage(
        `💡 anumati: ${suggestion.description}\n` +
          `   Run: ${suggestion.command}`
      );
    }
    return;
  }

  // No actionable suggestion. In debug mode, explain WHY this fell through so
  // the user can decide how to expand their config.
  if (sc.debug && sc.show) {
    const note = debugDiagnose(input);
    if (note) emitMessage(formatDebugNote(note).trimEnd());
  }
}

// Wrap a (possibly multi-line) message in a box so it reads as a distinct
// dialog. Uses Unicode box-drawing chars rather than ASCII `|`/`-`: systemMessage
// is rendered as markdown, where a leading `|` starts a table and `---` becomes a
// horizontal rule — `│`/`─` are plain text and survive untouched. A left gutter
// (no right border) is intentional: emoji count as one JS char but occupy two
// terminal cells, so any right edge would misalign — the top/bottom rules give
// the enclosed look without that fragility.
function boxMessage(message: string): string {
  const lines = message.split("\n");
  const width = Math.min(Math.max(...lines.map((l) => l.length)) + 1, 60);
  const rule = "─".repeat(width);
  const body = lines.map((l) => `│ ${l}`).join("\n");
  return `┌${rule}\n${body}\n└${rule}`;
}

// Surface an informational message to the user WITHOUT changing the decision.
// PreToolUse hook stderr is only shown in the debug log on exit 0, so we use
// the `systemMessage` JSON channel instead, which Claude Code displays inline.
// Omitting permissionDecision keeps the call on its normal passthrough path;
// suppressOutput keeps the raw JSON out of the transcript (only the rendered
// systemMessage shows). Shared with the session-start banner for consistency.
function emitMessage(message: string): void {
  process.stdout.write(JSON.stringify({ systemMessage: boxMessage(message), suppressOutput: true }));
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
  anumati init [--root|--project]  Create a starter config with safe default rules.
                                   Prompts for the level if not specified; --force to overwrite.
                                   Also scaffolds an audit log, registers the PreToolUse hook,
                                   adds a SessionStart "⚡ anumati active" banner, and writes
                                   command-style guidance to the sibling CLAUDE.md
                                   (--no-audit / --no-hook / --no-banner / --no-steer to skip;
                                   --debug to start with debug mode on).
  anumati add <matcher> [flags]    Add or extend an allow rule in a config.
  anumati apply [--all|--clear]    Review accumulated suggestions; apply or discard them.
  anumati debug <on|off>           Toggle debug mode (explains why passthroughs weren't approved).
                                   Targets the root config; --project / --config <path> to retarget.
  anumati --help | -h              Show this help.
  anumati --version | -V           Show the installed version.

add flags:
  --domain X[,Y]     domains for the "curl" matcher
  --imports X[,Y]    Python modules for the "python3-pipe" matcher
  --modules X[,Y]    Node built-in modules for the "nodejs-pipe" matcher
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

  if (subcommand === "init") {
    runInit(process.argv.slice(2)).catch((err) => {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    });
    return;
  }
  if (subcommand === "add") {
    runAdd(process.argv.slice(2));
    return;
  }
  if (subcommand === "apply") {
    runApply(process.argv.slice(2));
    return;
  }
  if (subcommand === "debug") {
    runDebug(process.argv.slice(2));
    return;
  }
  if (subcommand === "session-start") {
    // The SessionStart hook pipes JSON (with the real cwd) on stdin. Read it
    // when piped; fall back to process.cwd() when run interactively.
    let cwd = process.cwd();
    if (!process.stdin.isTTY) {
      try {
        const parsed = JSON.parse(readStdin()) as { cwd?: string };
        if (parsed.cwd) cwd = parsed.cwd;
      } catch {
        // no/invalid stdin → use process.cwd()
      }
    }
    runSessionStart(process.argv.slice(2), cwd);
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
