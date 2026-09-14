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

  it("does NOT flag composable operators (&& / ; / || / &) as hard blockers", () => {
    // All sequential operators compose now; none is a never-accepted blocker.
    for (const cmd of ["cat a || cat b", "cat a & cat b", "cat a; cat b"]) {
      const n = debugDiagnose(bash(cmd));
      expect(n?.code).not.toBe("unsupported_operator");
    }
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
  it("codes a bare backgrounded command by its inner command (no rules)", () => {
    // `&` composes: `sleep 1 &` diagnoses the stripped `sleep 1`. A sleep matcher
    // exists but no rule is enabled, so this is matcher_not_configured, not no_matcher.
    expect(debugDiagnose(bash("sleep 1 &"), [])?.code).toBe("matcher_not_configured");
  });
  it("codes a file redirection", () => {
    expect(debugDiagnose(bash("ls > out.txt"))?.code).toBe("file_redirection");
  });
  it("codes a dangerous leading command", () => {
    expect(debugDiagnose(bash("bash -c whatever"))?.code).toBe("dangerous_command");
  });
  it("codes a truly uncovered command (no matcher exists) as no_matcher", () => {
    const note = debugDiagnose(bash("kubectl get pods"));
    expect(note?.code).toBe("no_matcher");
    expect(note?.reason).toContain('No matcher covers "kubectl"');
  });

  it("codes an owned-but-unconfigured command as matcher_not_configured", () => {
    // A git matcher family exists; with no git rule enabled, `git commit` is not
    // 'no matcher' — it's a matcher that isn't configured to approve this form.
    const note = debugDiagnose(bash("git commit -m x"), []);
    expect(note?.code).toBe("matcher_not_configured");
    expect(note?.reason).toContain("git-write");
    expect(note?.hint).toContain("git-write");
  });

  it("still matcher_not_configured when a sibling matcher is enabled but doesn't cover this shape", () => {
    // git-read enabled, but `git push` needs git-push — the message names the family.
    const note = debugDiagnose(bash("git push origin main"), [{ tool: "Bash", matcher: "git-read" }]);
    expect(note?.code).toBe("matcher_not_configured");
    expect(note?.reason).toContain("git-push");
  });

  it("names the single owning matcher directly in the hint", () => {
    const note = debugDiagnose(bash("mkdir -m 700 secret"), []);
    expect(note?.code).toBe("matcher_not_configured");
    expect(note?.hint).toContain("anumati add mkdir");
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
    expect(note?.code).toBe("matcher_not_configured");
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
