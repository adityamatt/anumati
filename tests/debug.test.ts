import { describe, it, expect } from "vitest";
import { debugDiagnose, formatDebugNote } from "../src/debug.js";
import type { HookInput } from "../src/types.js";

function bash(command: string): HookInput {
  return { session_id: "t", tool_name: "Bash", tool_input: { command }, cwd: "/tmp" };
}
function read(file_path: string): HookInput {
  return { session_id: "t", tool_name: "Read", tool_input: { file_path }, cwd: "/tmp" };
}

describe("debugDiagnose — Bash blockers", () => {
  it("flags a `;` separator as never accepted", () => {
    const n = debugDiagnose(bash("cat a; cat b"));
    expect(n?.reason).toContain(";");
    expect(n?.hint).toContain("separate");
  });

  it("flags `||` as never accepted", () => {
    expect(debugDiagnose(bash("cat a || echo b"))?.reason).toContain("||");
  });

  it("flags a trailing background &", () => {
    expect(debugDiagnose(bash("sleep 1 &"))?.reason).toContain("&");
  });

  it("flags file redirection", () => {
    const n = debugDiagnose(bash("cat foo > out.txt"));
    expect(n?.reason).toContain("redirects to/from a file");
    expect(n?.hint).toContain("file redirection");
  });

  it("does NOT flag safe stream redirects like 2>/dev/null", () => {
    // `cat foo 2>/dev/null` is now matchable by safe-inspect, so it should not
    // reach the redirection branch — the diagnosis (if any) is about something else.
    const n = debugDiagnose(bash("cat foo 2>/dev/null"));
    expect(n?.reason ?? "").not.toContain("redirect");
  });

  it("flags shell substitution before parsing", () => {
    expect(debugDiagnose(bash("cat $(ls)"))?.reason).toContain("substitution");
    expect(debugDiagnose(bash("echo `id`"))?.reason).toContain("substitution");
  });

  it("names an uncovered leading command", () => {
    const n = debugDiagnose(bash("kubectl get pods"));
    expect(n?.reason).toContain("kubectl");
    expect(n?.hint).toContain("matcher");
  });

  it("identifies a dangerous interpreter", () => {
    const n = debugDiagnose(bash("bash script.sh"));
    expect(n?.reason).toContain("dangerous");
    expect(n?.reason).toContain("bash");
  });

  it("returns null for an empty command", () => {
    expect(debugDiagnose(bash(""))).toBeNull();
  });

  it("prioritizes substitution over a `;` that also appears", () => {
    // substitution check runs first because parseCompound bails on $/`
    expect(debugDiagnose(bash("cat $(x); cat y"))?.reason).toContain("substitution");
  });
});

describe("debugDiagnose — Read", () => {
  it("flags path traversal", () => {
    expect(debugDiagnose(read("/a/../etc/passwd"))?.reason).toContain("traversal");
  });

  it("returns null for a clean read path", () => {
    expect(debugDiagnose(read("/home/user/file.txt"))).toBeNull();
  });
});

describe("debugDiagnose — other tools", () => {
  it("returns null for non-Bash/Read tools", () => {
    expect(debugDiagnose({ session_id: "t", tool_name: "Task", tool_input: {} })).toBeNull();
  });
});

describe("formatDebugNote", () => {
  it("renders reason with the 🔍 prefix", () => {
    expect(formatDebugNote({ reason: "because" })).toBe("🔍 anumati [debug]: because\n");
  });

  it("appends the hint on its own line when present", () => {
    const out = formatDebugNote({ reason: "r", hint: "do x" });
    expect(out).toContain("🔍 anumati [debug]: r");
    expect(out).toContain("\n   → do x\n");
  });
});
