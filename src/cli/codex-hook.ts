import { readSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import type { Config, HookInput, MatchResult } from "../types.js";
import { evaluate } from "../matcher.js";
import { audit } from "../audit.js";
import { debugDiagnose } from "../debug.js";
import { playSound, resolveNotifyConfig } from "../notify.js";
import {
  loadConfig,
  defaultConfigPath,
  projectConfigPath,
  anumatiHome,
} from "../config.js";

/**
 * `anumati codex-hook [config]` — the OpenAI Codex adapter.
 *
 * Codex invokes this as a `PermissionRequest` command hook: it pipes a JSON
 * payload on stdin and reads a decision from stdout. anumati is ALLOW-ONLY here
 * (D3): it emits `allow` for the safe subset its matchers recognize and emits
 * nothing otherwise, letting Codex fall through to its normal approval flow.
 *
 * The contract was verified empirically on Codex 0.153.2 (see docs/MULTI-AGENT.md
 * §3): input `tool_input.command` is a raw string, `tool_name` is "Bash", `cwd`
 * is top-level; the accepted allow output REQUIRES `hookEventName`. Any shape we
 * don't recognize → emit nothing (fail open — a bug can never wrongly allow).
 */

// Exact stdout Codex accepts for an auto-approve (the `hookEventName` field is
// mandatory — omitting it makes Codex treat the output as invalid and fall
// through, which we confirmed on 0.153.2).
export const CODEX_ALLOW_OUTPUT = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: { behavior: "allow" },
  },
});

export interface CodexPayload {
  tool_name?: string;
  tool_input?: { command?: string; [k: string]: unknown };
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
}

/**
 * Build an anumati HookInput from a Codex PermissionRequest payload, or null if
 * this isn't a shell command we should judge. Per D4 we key on the PRESENCE of a
 * command string rather than the tool name, so we're not coupled to whatever
 * Codex names its shell tool across versions.
 */
export function hookInputFromCodexPayload(p: CodexPayload | null | undefined): HookInput | null {
  const command = p?.tool_input?.command;
  if (typeof command !== "string" || command.length === 0) return null;
  return {
    session_id: "codex",
    tool_name: p?.tool_name ?? "Bash",
    tool_input: { command },
    cwd: p?.cwd,
    permission_mode: p?.permission_mode,
  };
}

/**
 * Allow-only decision over the project→root cascade (mirrors the Claude hook's
 * cascade in index.ts): approve if either config's matchers approve. Never
 * denies — anumati only ever loosens.
 */
export function codexDecision(
  input: HookInput,
  projectConfig: Config | null,
  rootConfig: Config | null,
): "allow" | null {
  if (projectConfig && evaluate(input, projectConfig.allow ?? []).decision === "allow") return "allow";
  if (rootConfig && evaluate(input, rootConfig.allow ?? []).decision === "allow") return "allow";
  return null;
}

// Read all of stdin synchronously from fd 0 (same approach as the Claude hook in
// index.ts): retry EAGAIN on a non-blocking pipe, stop at EOF.
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let bytes: number;
    try {
      bytes = readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") continue;
      if (code === "EOF") break;
      throw err;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// D9 debug aid: append the raw payload to ~/.anumati/codex-hook-debug.jsonl so a
// user can confirm the live contract. Never affects the decision (always declines).
function appendDebug(raw: string): void {
  try {
    const file = join(anumatiHome(), "codex-hook-debug.jsonl");
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, raw.trim() + "\n");
  } catch {
    // debug logging must never break the hook
  }
}

/** CLI entrypoint: `anumati codex-hook [config] [--debug]` (reads the payload on stdin). */
export function runCodexHook(argv: string[]): void {
  const args = argv.slice(1); // drop the "codex-hook" token
  const debug = args.includes("--debug");
  const configArg = args.find((a) => !a.startsWith("--"));

  const raw = readStdin();
  if (debug) appendDebug(raw);

  let payload: CodexPayload;
  try {
    payload = JSON.parse(raw) as CodexPayload;
  } catch {
    return; // unparseable → emit nothing (fail open)
  }
  if (debug) return; // debug mode only captures; never decides

  const input = hookInputFromCodexPayload(payload);
  if (!input) return; // not a shell command → decline

  const rootConfig = loadConfig(configArg ?? defaultConfigPath());
  const projectConfig = input.cwd ? loadConfig(projectConfigPath(input.cwd)) : null;
  if (!projectConfig && !rootConfig) return; // no config anywhere → decline

  try {
    // Per-config results (mirrors the Claude hook's cascade) so we can audit each
    // config independently and tag the entries host="codex" for `anumati stats`.
    const projectResult: MatchResult = projectConfig
      ? evaluate(input, projectConfig.allow ?? [])
      : { decision: null, rule: null };
    const rootResult: MatchResult =
      projectResult.decision !== "allow" && rootConfig
        ? evaluate(input, rootConfig.allow ?? [])
        : { decision: null, rule: null };
    const approved = projectResult.decision === "allow" || rootResult.decision === "allow";

    // On decline, record WHY (same reason codes the Claude hook logs).
    const note = approved
      ? null
      : debugDiagnose(input, [...(projectConfig?.allow ?? []), ...(rootConfig?.allow ?? [])]);
    if (projectConfig) audit(projectConfig.audit, input, projectResult, note, "codex");
    if (rootConfig && projectResult.decision !== "allow") {
      audit(rootConfig.audit, input, rootResult, note, "codex");
    }

    if (approved) {
      process.stdout.write(CODEX_ALLOW_OUTPUT);
    } else {
      // Passthrough — anumati is stepping aside, so Codex will surface its own
      // approval flow. Alert the user with the same sound as the Claude hook
      // (fire-and-forget; honors the `notify` config; never affects the decision).
      playSound(resolveNotifyConfig(projectConfig, rootConfig));
    }
  } catch {
    // engine threw → emit nothing (fail open)
  }
}
