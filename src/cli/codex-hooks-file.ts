import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

/**
 * anumati wires Codex by writing an anumati-owned `hooks.json` in Codex's config
 * home — a file Codex discovers per config layer (verified on 0.153.2). It's JSON
 * (not the user's TOML `config.toml`), so anumati can parse + merge it safely and
 * non-destructively, giving init the same auto-wire it does for Claude's
 * settings.json — without a TOML dependency or clobber risk (D5).
 *
 * Two hooks are wired: `PermissionRequest` (auto-approve the safe subset) and
 * `SessionStart` (the "⚡ anumati active" banner, via `systemMessage`). Shape
 * (HooksFile): events nested under a top-level `hooks` object.
 */

/** Codex's config home: $CODEX_HOME if set, else ~/.codex. */
export function codexHome(): string {
  const env = process.env.CODEX_HOME;
  return env && env.length > 0 ? env : join(homedir(), ".codex");
}

/** The hooks file Codex discovers in the user layer. */
export function codexHooksFilePath(): string {
  return join(codexHome(), "hooks.json");
}

// Only the parts we touch are typed; every unknown field is preserved verbatim.
interface CommandHandler {
  type: string;
  command?: string;
  timeout?: number;
  [k: string]: unknown;
}
interface MatcherGroup {
  matcher?: string;
  hooks?: CommandHandler[];
  [k: string]: unknown;
}
interface HooksFile {
  description?: string;
  hooks?: { [event: string]: MatcherGroup[] | undefined };
  [k: string]: unknown;
}

/** One anumati command hook to ensure present under an event. */
export interface CodexHookSpec {
  event: string; // "PermissionRequest" | "SessionStart"
  command: string;
  timeout?: number;
  /** Substring identifying an anumati hook of this kind, for idempotency. */
  marker: string;
  /**
   * Run the hook asynchronously. Codex surfaces an async hook's `systemMessage`
   * as a first-class, visible `Warning` event; a SYNC hook's message is only a
   * dim, collapsible `↳ Hook · …` cell (and `codex exec` doesn't show it at all).
   * Use async for fire-and-forget banners (SessionStart). Leave sync (false) for
   * a blocking decision hook (PermissionRequest) — async would defeat it.
   */
  async?: boolean;
}

export interface CodexWireResult {
  path: string;
  created: boolean; // whether the hooks.json file was newly created
  changed: boolean; // whether anything was added this run
  addedEvents: string[]; // events a hook was added to (empty when already present)
}

function eventHasMarker(groups: MatcherGroup[], marker: string): boolean {
  return groups.some((g) =>
    (g.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(marker)),
  );
}

/**
 * Merge anumati command hooks into Codex's `hooks.json`. Idempotent and
 * non-destructive: preserves existing hooks/fields, and adds a spec only when no
 * anumati hook of that kind is already present under its event. Throws only if
 * the file exists but is invalid JSON (never clobber).
 */
export function wireCodexHooks(
  specs: CodexHookSpec[],
  path = codexHooksFilePath(),
): CodexWireResult {
  let file: HooksFile = {};
  let created = true;
  if (existsSync(path)) {
    created = false;
    try {
      file = JSON.parse(readFileSync(path, "utf-8")) as HooksFile;
    } catch {
      throw new Error(`${path} exists but is not valid JSON — fix it before wiring the Codex hook.`);
    }
  }

  const next: HooksFile = { ...file, hooks: { ...(file.hooks ?? {}) } };
  const addedEvents: string[] = [];
  for (const spec of specs) {
    const groups = [...(next.hooks![spec.event] ?? [])];
    if (eventHasMarker(groups, spec.marker)) continue;
    // No `matcher` — the adapter keys on the presence of a shell command (D4).
    const handler: CommandHandler = { type: "command", command: spec.command, timeout: spec.timeout ?? 5 };
    if (spec.async) handler.async = true; // omit when false to keep the file minimal
    groups.push({ hooks: [handler] });
    next.hooks![spec.event] = groups;
    addedEvents.push(spec.event);
  }

  const changed = addedEvents.length > 0;
  if (changed || created) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  }
  return { path, created, changed, addedEvents };
}
