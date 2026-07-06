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
    SessionStart?: HookEntry[];
    [event: string]: unknown;
  };
  [key: string]: unknown;
}

// anumati vets Bash commands only. Read/Write/Edit safety is left to Claude
// Code's own permission flow (path allowlists, accept-edits mode) — anumati's
// value is deterministic vetting of shell commands, which is the hard part.
export const HOOK_MATCHER = "Bash";
export const HOOK_TIMEOUT = 5;
// SessionStart banner runs once at session start; a slightly longer timeout is
// harmless and avoids racing a cold Node start.
export const BANNER_TIMEOUT = 5;

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

/**
 * Build the SessionStart banner command — the same launcher as buildHookCommand
 * but invoking the `session-start` subcommand, with the config passed as the
 * arg after it so the banner describes the right config.
 */
export function buildBannerCommand(
  configPath: string,
  argv1: string,
  execPath: string,
): string {
  const cfg = shellQuote(configPath);
  if (basename(argv1) === "anumati") return `anumati session-start ${cfg}`;
  return `${shellQuote(execPath)} ${shellQuote(argv1)} session-start ${cfg}`;
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

function hasAnumatiBanner(settings: ClaudeSettings): boolean {
  const entries = settings.hooks?.SessionStart ?? [];
  return entries.some((e) =>
    (e.hooks ?? []).some(
      (h) => typeof h.command === "string" && h.command.includes("session-start"),
    ),
  );
}

/**
 * Return a copy of `settings` with an anumati SessionStart banner hook added.
 * Idempotent and non-destructive, mirroring mergeAnumatiHook. SessionStart hooks
 * take no matcher (they fire on every session start).
 */
export function mergeAnumatiBanner(
  settings: ClaudeSettings,
  command: string,
): { settings: ClaudeSettings; changed: boolean } {
  if (hasAnumatiBanner(settings)) return { settings, changed: false };

  const next: ClaudeSettings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const sessionStart = [...((next.hooks!.SessionStart as HookEntry[] | undefined) ?? [])];
  sessionStart.push({
    hooks: [{ type: "command", command, timeout: BANNER_TIMEOUT }],
  });
  next.hooks!.SessionStart = sessionStart;
  return { settings: next, changed: true };
}

/**
 * Merge both the PreToolUse hook and (when bannerCommand is given) the
 * SessionStart banner into the settings file, in a single read/write. Reading
 * once avoids a torn state where the first write invalidates the second's read.
 */
export function wireAnumatiHook(
  settingsPath: string,
  command: string,
  bannerCommand?: string,
): WireResult {
  const existing = loadSettings(settingsPath);
  const hookMerge = mergeAnumatiHook(existing, command);
  let settings = hookMerge.settings;
  let changed = hookMerge.changed;

  let bannerChanged = false;
  if (bannerCommand) {
    const bannerMerge = mergeAnumatiBanner(settings, bannerCommand);
    settings = bannerMerge.settings;
    bannerChanged = bannerMerge.changed;
  }

  if (changed || bannerChanged) {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { settingsPath, command, changed: changed || bannerChanged };
}
