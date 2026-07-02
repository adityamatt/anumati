import { resolve } from "path";
import { loadConfig, defaultConfigPath, projectConfigPath } from "../config.js";
import type { Config } from "../types.js";

export interface ResolvedBannerConfig {
  config: Config;
  /** Absolute path of the config file that was loaded. */
  path: string;
}

/**
 * Build the startup banner for a resolved config, or null when anumati isn't
 * meaningfully configured (no rules) — in which case we stay silent rather than
 * announce an inert hook. When a path is given it is appended on a second line
 * (as an absolute path, so terminals render it as a clickable link).
 */
export function buildBanner(config: Config | null, path?: string): string | null {
  if (!config) return null;
  const rules = config.allow ?? [];
  if (rules.length === 0) return null;

  const parts = [`${rules.length} rule${rules.length === 1 ? "" : "s"}`];
  if (config.suggest?.debug) parts.push("debug on");
  const headline = `⚡ anumati active — ${parts.join(", ")}`;
  return path ? `${headline}\n   ${path}` : headline;
}

/**
 * Resolve the config a SessionStart banner should describe, and the absolute
 * path it came from. Mirrors the hook's cascade: prefer a project config in cwd,
 * else the root config. A config path passed as argv wins (matches how the hook
 * is wired). Returns null when nothing loads.
 */
export function resolveBannerConfig(
  configArg: string | undefined,
  cwd: string,
): ResolvedBannerConfig | null {
  if (configArg) {
    const c = loadConfig(configArg);
    if (c) return { config: c, path: configArg };
  }
  if (cwd) {
    const projectPath = projectConfigPath(cwd);
    const project = loadConfig(projectPath);
    if (project) return { config: project, path: projectPath };
  }
  const rootPath = configArg ?? defaultConfigPath();
  const root = loadConfig(rootPath);
  return root ? { config: root, path: rootPath } : null;
}

/**
 * CLI entrypoint for the SessionStart hook: `anumati session-start [config]`.
 * Emits a user-visible banner via `systemMessage` (plain stdout on SessionStart
 * would go into Claude's context, not the UI). Always exits 0 and never throws —
 * a startup hook must not disrupt the session.
 */
export function runSessionStart(argv: string[], cwd: string = process.cwd()): void {
  try {
    // argv: ["session-start", "<optional-config-path>"]
    const configArg = argv[1];
    const resolved = resolveBannerConfig(configArg, cwd);
    if (!resolved) return;
    // Absolute path so the terminal renders it as a clickable link.
    const absPath = resolve(cwd, resolved.path);
    const banner = buildBanner(resolved.config, absPath);
    if (banner) {
      process.stdout.write(JSON.stringify({ systemMessage: banner, suppressOutput: true }));
    }
  } catch {
    // Never disrupt session startup.
  }
}
