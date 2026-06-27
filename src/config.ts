import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "./types.js";

/** The default global config location: ~/.claude/permissions.json */
export function defaultConfigPath(): string {
  return join(homedir(), ".claude", "permissions.json");
}

/** The project-scoped config location for a given cwd: <cwd>/.claude/permissions.json */
export function projectConfigPath(cwd: string): string {
  return join(cwd, ".claude", "permissions.json");
}

/** Parse a config file, returning null if it is missing or invalid. */
export function loadConfig(path: string): Config | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Config;
  } catch {
    return null;
  }
}
