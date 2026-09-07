import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "./types.js";

/**
 * anumati's own config/state home — host-neutral. `permissions.json` is
 * anumati's file (not Claude Code's, whose settings live in
 * `~/.claude/settings.json`), so with more than one agent it belongs here.
 */
export function anumatiHome(): string {
  return join(homedir(), ".anumati");
}

/**
 * The legacy home: anumati used to keep its files under Claude Code's directory.
 * Still fully supported — existing installs are never forced to move.
 */
export function legacyHome(): string {
  return join(homedir(), ".claude");
}

/**
 * First existing candidate, else the first (canonical) candidate. Pure — the
 * `exists` probe is injectable for testing. This is the whole backward-compat
 * story: prefer the new `~/.anumati/` location, fall back to the legacy
 * `~/.claude/` one when only it exists, and default a fresh install to the new
 * location (the first candidate).
 */
export function resolvePreferred(
  candidates: string[],
  exists: (p: string) => boolean = existsSync,
): string {
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return candidates[0];
}

/** The default global config location. Prefers ~/.anumati/, falls back to legacy ~/.claude/. */
export function defaultConfigPath(): string {
  return resolvePreferred([
    join(anumatiHome(), "permissions.json"),
    join(legacyHome(), "permissions.json"),
  ]);
}

/** The project-scoped config location for a cwd: <cwd>/.anumati/…, legacy <cwd>/.claude/…. */
export function projectConfigPath(cwd: string): string {
  return resolvePreferred([
    join(cwd, ".anumati", "permissions.json"),
    join(cwd, ".claude", "permissions.json"),
  ]);
}

/** Parse a config file, returning null if it is missing or invalid. */
export function loadConfig(path: string): Config | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Config;
  } catch {
    return null;
  }
}
