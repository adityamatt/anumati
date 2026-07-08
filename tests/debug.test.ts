import { describe, it, expect } from "vitest";
import { debugDiagnose, formatDebugNote } from "../src/debug.js";
import type { HookInput } from "../src/types.js";

function bash(command: string): HookInput {
  return { session_id: "t", tool_name: "Bash", tool_input: { command }, cwd: "/tmp" };
}

describe("debugDiagnose — Bash blockers", () => {
  it("does NOT flag `;` as a hard blocker (some matchers chain safe reads)", () => {
    // `cat a; cat b` is now approvable by safe-inspect, so the `;` operator is
    // not reported as a never-accepted blocker.
    const n = debugDiagnose(bash("cat a; cat b"));
    expect(n?.reason ?? "").not.toContain('chains segments with ";"');
  });

  it("does NOT flag `||` as a hard blocker (it is now composed)", () => {
    // `||` is composed like && / ; , so it is not a never-accepted operator.
    const n = debugDiagnose(bash("cat a || cat b"));
    expect(n?.reason ?? "").not.toContain('chains segments with "||"');
  });

  it("flags a trailing background & as a never-accepted operator", () => {
    const n = debugDiagnose(bash("sleep 1 &"));
    expect(n?.reason).toContain("&");
    expect(n?.hint).toContain("separate");
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

describe("debugDiagnose — other tools", () => {
  it("returns null for non-Bash tools (incl. Read/Write)", () => {
    expect(debugDiagnose({ session_id: "t", tool_name: "Task", tool_input: {} })).toBeNull();
    expect(debugDiagnose({ session_id: "t", tool_name: "Read", tool_input: { file_path: "/a/../etc/passwd" } })).toBeNull();
  });
});

describe("formatDebugNote", () => {
  it("renders reason with the 🔍 prefix", () => {
    expect(formatDebugNote({ code: "unknown", reason: "because" })).toBe("🔍 anumati [debug]: because\n");
  });

  it("appends the hint on its own line when present", () => {
    const out = formatDebugNote({ code: "no_matcher", reason: "r", hint: "do x" });
    expect(out).toContain("🔍 anumati [debug]: r");
    expect(out).toContain("\n   → do x\n");
  });
});

describe("debugDiagnose — reason codes", () => {
  it("codes shell substitution", () => {
    expect(debugDiagnose(bash("cat $(whoami)"))?.code).toBe("shell_substitution");
  });
  it("codes an unsupported operator (backgrounding &)", () => {
    expect(debugDiagnose(bash("sleep 1 &"))?.code).toBe("unsupported_operator");
  });
  it("codes a file redirection", () => {
    expect(debugDiagnose(bash("ls > out.txt"))?.code).toBe("file_redirection");
  });
  it("codes a dangerous leading command", () => {
    expect(debugDiagnose(bash("bash -c whatever"))?.code).toBe("dangerous_command");
  });
  it("codes an uncovered command", () => {
    expect(debugDiagnose(bash("kubectl get pods"))?.code).toBe("no_matcher");
  });
});

describe("debugDiagnose — composition-aware offending sub-command", () => {
  const rules = [
    { tool: "Bash", matcher: "git-read" },
    { tool: "Bash", matcher: "safe-inspect" },
  ];

  it("pinpoints the failing sub-command in a && chain", () => {
    const note = debugDiagnose(bash("git status && npm publish"), rules);
    expect(note?.offending).toBe("npm publish");
    expect(note?.code).toBe("no_matcher");
    expect(note?.reason).toContain("npm");
  });

  it("does not blame the first segment when it is fine", () => {
    const note = debugDiagnose(bash("ls && rm -rf /"), rules);
    expect(note?.offending).toBe("rm -rf /");
  });

  it("has no offending field for a single command", () => {
    expect(debugDiagnose(bash("kubectl get pods"), rules)?.offending).toBeUndefined();
  });
});
