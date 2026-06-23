#!/usr/bin/env node
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { evaluate } from "./matcher.js";
import { audit } from "./audit.js";
import type { Config, HookInput, MatchResult } from "./types.js";

function readStdin(): string {
  return readFileSync("/dev/stdin", "utf-8");
}

function resolveRootConfigPath(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  return join(homedir(), ".claude", "permissions.json");
}

function loadConfig(path: string): Config | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Config;
  } catch {
    return null;
  }
}

function main(): void {
  let input: HookInput;
  try {
    input = JSON.parse(readStdin()) as HookInput;
  } catch {
    process.exit(0); // unparseable input → passthrough
  }

  const rootConfig = loadConfig(resolveRootConfigPath());
  const projectConfig = input.cwd
    ? loadConfig(join(input.cwd, ".claude", "permissions.json"))
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
  }
  // no output → passthrough to Claude Code permission dialog
}

main();
