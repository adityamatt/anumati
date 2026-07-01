import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Config } from "../types.js";
import { defaultConfigPath, projectConfigPath } from "../config.js";
import { prettyPath } from "./init.js";

export interface DebugCmdOptions {
  enable: boolean; // true → on, false → off
  config?: string; // explicit path (wins over level)
  level?: "root" | "project";
  cwd?: string;
}

export interface DebugCmdResult {
  configPath: string;
  enabled: boolean;
  changed: boolean; // false when already in the requested state
}

function resolveTarget(opts: DebugCmdOptions): string {
  if (opts.config) return opts.config;
  if (opts.level === "project") return projectConfigPath(opts.cwd ?? process.cwd());
  return defaultConfigPath(); // default: root
}

/**
 * Toggle `suggest.debug` in a config, merging into the existing `suggest` block
 * so other suggestion settings are preserved. Throws if the config is missing
 * or invalid (we never create one here — `anumati init` owns creation).
 */
export function applyDebug(opts: DebugCmdOptions): DebugCmdResult {
  const configPath = resolveTarget(opts);

  if (!existsSync(configPath)) {
    throw new Error(
      `${prettyPath(configPath)} does not exist. Run \`anumati init\` first.`,
    );
  }

  let config: Config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
  } catch {
    throw new Error(`${prettyPath(configPath)} is not valid JSON — fix it first.`);
  }

  const current = config.suggest?.debug === true;
  if (current === opts.enable) {
    return { configPath, enabled: opts.enable, changed: false };
  }

  config.suggest = { ...(config.suggest ?? {}), debug: opts.enable };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return { configPath, enabled: opts.enable, changed: true };
}

export function parseDebugArgs(args: string[]): DebugCmdOptions {
  const action = args[0];
  if (action !== "on" && action !== "off") {
    throw new Error("Usage: anumati debug <on|off> [--root|--project] [--config <path>]");
  }
  const opts: DebugCmdOptions = { enable: action === "on" };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "--global") {
      opts.level = "root";
    } else if (arg === "--project" || arg === "--local") {
      opts.level = "project";
    } else if (arg === "--config") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--config requires a value");
      }
      opts.config = value;
    }
    // Unknown flag — ignore quietly, matching the other subcommands.
  }
  return opts;
}

/** CLI entrypoint: `anumati debug <on|off> [--root|--project] [--config <path>]` */
export function runDebug(argv: string[]): void {
  const args = argv.slice(1); // drop the "debug" token
  let result: DebugCmdResult;
  try {
    result = applyDebug(parseDebugArgs(args));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const state = result.enabled ? "on" : "off";
  if (result.changed) {
    console.log(`✓ Debug mode ${state} in ${prettyPath(result.configPath)}.`);
    if (result.enabled) {
      console.log(
        "  Passthroughs with no suggestion now print a 🔍 note explaining why.",
      );
    }
  } else {
    console.log(`• Debug mode already ${state} in ${prettyPath(result.configPath)}.`);
  }
}
