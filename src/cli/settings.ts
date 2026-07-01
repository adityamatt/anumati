import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";

// Shape of the slice of Claude Code's settings.json that we touch. Everything
// else in the file is preserved verbatim via the index signatures.
export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}
export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}
export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookEntry[];
    [event: string]: unknown;
  };
  [key: string]: unknown;
}

// Tools anumati evaluates. Matches the wiring documented in the README.
export const HOOK_MATCHER = "Bash|Read|Write|Edit";
export const HOOK_TIMEOUT = 5;

/** settings.json lives alongside permissions.json (same .claude/ directory). */
export function settingsFileFor(configPath: string): string {
  return join(dirname(configPath), "settings.json");
}

/** Quote a path for a shell command only when it contains whitespace/specials. */
export function shellQuote(s: string): string {
  if (!/[\s"'$`\\]/.test(s)) return s;
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Build the hook command, registering anumati the way init was invoked:
 *   - via the `anumati` bin (global or linked) → `anumati <config>` (stable
 *     across rebuilds and survives `npm i -g anumati`)
 *   - via `node /path/dist/index.js` → pin to that exact script + node binary
 *     (robust for local development against a specific build)
 */
export function buildHookCommand(
  configPath: string,
  argv1: string,
  execPath: string,
): string {
  const cfg = shellQuote(configPath);
  if (basename(argv1) === "anumati") return `anumati ${cfg}`;
  return `${shellQuote(execPath)} ${shellQuote(argv1)} ${cfg}`;
}

/** Read settings.json. Missing → {}. Present-but-invalid → throw (never clobber). */
export function loadSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ClaudeSettings;
  } catch {
    throw new Error(
      `${path} exists but is not valid JSON — fix it before wiring the hook.`,
    );
  }
}

function hasAnumatiHook(settings: ClaudeSettings): boolean {
  const entries = settings.hooks?.PreToolUse ?? [];
  return entries.some((e) =>
    (e.hooks ?? []).some(
      (h) => typeof h.command === "string" && h.command.includes("anumati"),
    ),
  );
}

/**
 * Return a copy of `settings` with an anumati PreToolUse hook added. Idempotent:
 * if a hook already invokes anumati, returns the input unchanged with
 * changed=false. All unrelated settings/hooks are preserved.
 */
export function mergeAnumatiHook(
  settings: ClaudeSettings,
  command: string,
): { settings: ClaudeSettings; changed: boolean } {
  if (hasAnumatiHook(settings)) return { settings, changed: false };

  const next: ClaudeSettings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const preToolUse = [...((next.hooks!.PreToolUse as HookEntry[] | undefined) ?? [])];
  preToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }],
  });
  next.hooks!.PreToolUse = preToolUse;
  return { settings: next, changed: true };
}

export interface WireResult {
  settingsPath: string;
  command: string;
  changed: boolean; // false when an anumati hook was already present
}

/** Merge the anumati hook into the settings file at `settingsPath`. */
export function wireAnumatiHook(settingsPath: string, command: string): WireResult {
  const existing = loadSettings(settingsPath);
  const { settings, changed } = mergeAnumatiHook(existing, command);
  if (changed) {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { settingsPath, command, changed };
}
