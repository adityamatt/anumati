#!/usr/bin/env node
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { evaluate } from "./matcher.js";
import { audit } from "./audit.js";
import type { Config, HookInput } from "./types.js";

function readStdin(): string {
  return readFileSync("/dev/stdin", "utf-8");
}

function resolveConfigPath(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  return join(homedir(), ".claude", "permissions.json");
}

function main(): void {
  let input: HookInput;
  try {
    input = JSON.parse(readStdin()) as HookInput;
  } catch {
    process.exit(0); // unparseable input → passthrough
  }

  let config: Config;
  try {
    const raw = readFileSync(resolveConfigPath(), "utf-8");
    config = JSON.parse(raw) as Config;
  } catch {
    process.exit(0); // missing config → passthrough
  }

  const result = evaluate(input, config.allow ?? []);

  audit(config.audit, input, result);

  if (result.decision === "allow") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      })
    );
  }
  // null → no output → Claude Code shows normal permission dialog
}

main();
