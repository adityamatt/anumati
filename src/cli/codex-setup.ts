import { existsSync } from "fs";
import { basename } from "path";
import { defaultConfigPath } from "../config.js";
import { shellQuote } from "./settings.js";
import { applyInit, prettyPath } from "./init.js";
import {
  wireCodexHooks,
  codexHooksFilePath,
  type CodexWireResult,
} from "./codex-hooks-file.js";

/**
 * `anumati codex-setup [config]` — wire anumati into OpenAI Codex.
 *
 * Auto-writes an anumati-owned `hooks.json` in Codex's config home (D5) — the
 * same auto-wire init does for Claude's settings.json — registering two hooks:
 *   • PermissionRequest → `anumati codex-hook` (auto-approve the safe subset)
 *   • SessionStart      → `anumati session-start` (the "⚡ anumati active" banner)
 * Then prints the D11 trust reminder: Codex silently skips untrusted hooks, so
 * the user must approve them once for anumati to be active there.
 */

export const CODEX_HOOK_TIMEOUT = 5;

// Build a `anumati <sub> <config>` command, matching how anumati was launched.
function codexCommand(sub: string, configPath: string, argv1: string, execPath: string): string {
  const cfg = shellQuote(configPath);
  if (basename(argv1) === "anumati") return `anumati ${sub} ${cfg}`;
  return `${shellQuote(execPath)} ${shellQuote(argv1)} ${sub} ${cfg}`;
}

/** The PermissionRequest hook command (auto-approve adapter). */
export function codexHookCommand(configPath: string, argv1: string, execPath: string): string {
  return codexCommand("codex-hook", configPath, argv1, execPath);
}

/** The SessionStart hook command (the "⚡ anumati active" banner). */
export function codexSessionStartCommand(configPath: string, argv1: string, execPath: string): string {
  return codexCommand("session-start", configPath, argv1, execPath);
}

export interface CodexSetupResult {
  configPath: string; // the shared ruleset the Codex hooks point at
  createdConfig: boolean; // whether a starter ruleset was written now
  command: string; // the PermissionRequest hook command
  wire: CodexWireResult; // the hooks.json write outcome
}

export interface CodexSetupOptions {
  config?: string;
  argv1?: string;
  execPath?: string;
  debug?: boolean;
  /** Override the hooks.json path (for tests); defaults to $CODEX_HOME/hooks.json. */
  hooksFilePath?: string;
}

/**
 * Ensure the shared ruleset exists, then auto-write the Codex hooks.json entries
 * (PermissionRequest + SessionStart). Reuses `applyInit` (ruleset + audit only)
 * when the config is missing; never overwrites an existing config, and the
 * hooks.json merge is non-destructive.
 */
export function planCodexSetup(opts: CodexSetupOptions = {}): CodexSetupResult {
  const configPath = opts.config ?? defaultConfigPath();
  let createdConfig = false;
  if (!existsSync(configPath)) {
    applyInit({ config: configPath, hook: false, banner: false, steer: false, debug: opts.debug });
    createdConfig = true;
  }
  const argv1 = opts.argv1 ?? process.argv[1] ?? "anumati";
  const execPath = opts.execPath ?? process.execPath;
  const command = codexHookCommand(configPath, argv1, execPath);
  const banner = codexSessionStartCommand(configPath, argv1, execPath);
  const wire = wireCodexHooks(
    [
      // PermissionRequest is a blocking decision — must stay SYNC.
      { event: "PermissionRequest", command, timeout: CODEX_HOOK_TIMEOUT, marker: "codex-hook" },
      // SessionStart is a fire-and-forget banner — ASYNC so Codex surfaces its
      // systemMessage as a visible Warning (a sync hook's message is only a dim,
      // easily-missed `↳ Hook · …` cell, and isn't shown by `codex exec` at all).
      { event: "SessionStart", command: banner, timeout: CODEX_HOOK_TIMEOUT, marker: "session-start", async: true },
    ],
    opts.hooksFilePath ?? codexHooksFilePath(),
  );
  return { configPath, createdConfig, command, wire };
}

/** Print the outcome + the D11 trust guidance. */
export function printCodexSetup(result: CodexSetupResult): void {
  if (result.createdConfig) {
    console.log(`✓ Created shared ruleset ${prettyPath(result.configPath)}.`);
  } else {
    console.log(`• Using existing ruleset ${prettyPath(result.configPath)}.`);
  }

  if (result.wire.changed) {
    const verb = result.wire.created ? "Created" : "Updated";
    console.log(
      `✓ ${verb} ${prettyPath(result.wire.path)} — anumati hooks: ${result.wire.addedEvents.join(", ")}.`,
    );
  } else {
    console.log(`• ${prettyPath(result.wire.path)} already wires anumati — left as-is.`);
  }

  console.log(
    `\nIMPORTANT — approve the hooks once when Codex next prompts to review them.` +
      `\nUntil you do, Codex silently skips untrusted hooks, so anumati stays inactive there.` +
      `\n(anumati is allow-only on Codex: it auto-approves the safe subset and stays out of the way otherwise.` +
      `\n The SessionStart hook prints "⚡ anumati active" once approved.)`,
  );
}

/** CLI entrypoint: `anumati codex-setup [config]` */
export function runCodexSetup(argv: string[]): void {
  const args = argv.slice(1); // drop the "codex-setup" token
  const config = args.find((a) => !a.startsWith("--"));
  try {
    printCodexSetup(planCodexSetup({ config }));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
