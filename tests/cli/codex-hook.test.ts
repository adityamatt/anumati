import { describe, it, expect } from "vitest";
import {
  CODEX_ALLOW_OUTPUT,
  hookInputFromCodexPayload,
  codexDecision,
  type CodexPayload,
} from "../../src/cli/codex-hook.js";
import type { Config } from "../../src/types.js";

// A payload shaped like the one Codex 0.153.2 actually sends (see docs/MULTI-AGENT.md §3).
function payload(command: string, extra: Partial<CodexPayload> = {}): CodexPayload {
  return {
    tool_name: "Bash",
    tool_input: { command, description: "…" } as CodexPayload["tool_input"],
    cwd: "/repo",
    hook_event_name: "PermissionRequest",
    permission_mode: "default",
    ...extra,
  };
}

const SAFE_INSPECT: Config = { allow: [{ tool: "Bash", matcher: "safe-inspect" }] };
const GIT_READ: Config = { allow: [{ tool: "Bash", matcher: "git-read" }] };

describe("CODEX_ALLOW_OUTPUT", () => {
  it("is the exact shape Codex accepts (hookEventName is required)", () => {
    expect(JSON.parse(CODEX_ALLOW_OUTPUT)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  });
});

describe("hookInputFromCodexPayload", () => {
  it("maps a shell payload to a HookInput (raw command string, cwd, tool_name)", () => {
    const input = hookInputFromCodexPayload(payload("ls -la"));
    expect(input).toEqual({
      session_id: "codex",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      cwd: "/repo",
      permission_mode: "default",
    });
  });

  it("returns null when there is no command (non-shell tool call) — D4 presence-detection", () => {
    expect(hookInputFromCodexPayload({ tool_name: "Read", tool_input: {} })).toBeNull();
    expect(hookInputFromCodexPayload({ tool_name: "Bash", tool_input: {} })).toBeNull();
    expect(hookInputFromCodexPayload(null)).toBeNull();
    expect(hookInputFromCodexPayload({})).toBeNull();
  });

  it("defaults tool_name to Bash when absent", () => {
    expect(hookInputFromCodexPayload({ tool_input: { command: "ls" } })?.tool_name).toBe("Bash");
  });
});

describe("codexDecision — allow-only over the cascade", () => {
  it("allows when the root config's matcher approves", () => {
    const input = hookInputFromCodexPayload(payload("ls -la"))!;
    expect(codexDecision(input, null, SAFE_INSPECT)).toBe("allow");
  });

  it("allows when the project config approves (project wins first)", () => {
    const input = hookInputFromCodexPayload(payload("git status"))!;
    expect(codexDecision(input, GIT_READ, null)).toBe("allow");
    expect(codexDecision(input, GIT_READ, SAFE_INSPECT)).toBe("allow");
  });

  it("declines (null) when no config approves — anumati never denies", () => {
    const input = hookInputFromCodexPayload(payload("rm -rf /"))!;
    expect(codexDecision(input, GIT_READ, SAFE_INSPECT)).toBeNull();
  });

  it("declines when the command isn't covered by the (allow-only) rules", () => {
    const input = hookInputFromCodexPayload(payload("git push origin main"))!;
    expect(codexDecision(input, null, GIT_READ)).toBeNull(); // git-read doesn't cover push
  });

  it("respects cwd for cwd-dependent matchers", () => {
    const CD: Config = { allow: [{ tool: "Bash", matcher: "cd", open: { allowed_paths: ["/repo"] } }] };
    const input = hookInputFromCodexPayload(payload("cd /repo/src", { cwd: "/repo" }))!;
    expect(codexDecision(input, null, CD)).toBe("allow");
  });
});
