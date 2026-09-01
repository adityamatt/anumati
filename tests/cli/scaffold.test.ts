import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyScaffold } from "../../src/cli/scaffold.js";
import { applyAdd } from "../../src/cli/add.js";
import { evaluate } from "../../src/matcher.js";
import { MATCHER_NAMES, MATCHERS } from "../../src/matchers/registry.js";
import type { Config, HookInput } from "../../src/types.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-scaffold-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): Config {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}
function bash(command: string): HookInput {
  return { session_id: "test", tool_name: "Bash", tool_input: { command } };
}

describe("applyScaffold", () => {
  it("creates a config and adds every catalog matcher as a disabled placeholder", () => {
    const res = applyScaffold({ config: configPath, skipLog: true });

    expect(res.created).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    expect(res.added.map((m) => m.name).sort()).toEqual([...MATCHER_NAMES].sort());
    expect(res.alreadyPresent).toEqual([]);

    const rules = read().allow!;
    expect(rules).toHaveLength(MATCHER_NAMES.length);
    const descOf = new Map(MATCHERS.map((m) => [m.name, m.desc]));
    for (const r of rules) {
      expect(r.tool).toBe("Bash");
      expect(r.enabled).toBe(false);
      expect(r.desc).toBe(descOf.get(r.matcher!)); // plain catalog desc, no hint suffix
    }
  });

  it("is idempotent — a second run adds nothing", () => {
    applyScaffold({ config: configPath, skipLog: true });
    const res2 = applyScaffold({ config: configPath, skipLog: true });

    expect(res2.added).toEqual([]);
    expect(res2.alreadyPresent.sort()).toEqual([...MATCHER_NAMES].sort());
    expect(read().allow!).toHaveLength(MATCHER_NAMES.length); // no duplicates
  });

  it("skips matchers already present and only fills the gaps", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        allow: [{ tool: "Bash", matcher: "curl", allowed_domains: ["a.com"] }],
      }),
    );

    const res = applyScaffold({ config: configPath, skipLog: true });

    expect(res.alreadyPresent).toContain("curl");
    expect(res.added.map((m) => m.name)).not.toContain("curl");
    expect(res.added).toHaveLength(MATCHER_NAMES.length - 1);

    // The pre-existing enabled rule is left untouched.
    const curl = read().allow!.find((r) => r.matcher === "curl");
    expect(curl).toEqual({ tool: "Bash", matcher: "curl", allowed_domains: ["a.com"] });
  });

  it("treats an already-disabled matcher as present (never re-adds or re-enables)", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ allow: [{ tool: "Bash", matcher: "docker-read", enabled: false }] }),
    );

    const res = applyScaffold({ config: configPath, skipLog: true });

    expect(res.alreadyPresent).toContain("docker-read");
    expect(read().allow!.filter((r) => r.matcher === "docker-read")).toHaveLength(1);
  });

  it("preserves unrelated config (audit, etc.)", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ audit: { audit_file: "/tmp/a.json" }, allow: [] }),
    );
    applyScaffold({ config: configPath, skipLog: true });
    expect(read().audit).toEqual({ audit_file: "/tmp/a.json" });
  });

  it("scaffolded placeholders never auto-approve anything (evaluate skips them)", () => {
    applyScaffold({ config: configPath, skipLog: true });
    const rules = read().allow!;

    // safe-inspect would normally approve `ls -la`, but as a disabled
    // placeholder it must NOT — the whole point is "advertised, not on".
    expect(evaluate(bash("ls -la"), rules).decision).toBeNull();
    expect(evaluate(bash("git status"), rules).decision).toBeNull();
  });
});

describe("applyScaffold — passthrough coverage", () => {
  let logPath: string;

  function writeLog(entries: Array<Record<string, unknown>>): void {
    logPath = join(dir, "anumati-passthrough.jsonl");
    writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  const pass = (command: string) => ({ tool: "Bash", command, decision: "passthrough" });

  it("attributes fall-through commands to the matcher that would cover them", () => {
    writeLog([
      pass("docker ps"),
      pass("docker ps"), // repeat → occurrences > distinct
      pass("docker images"),
      pass("git status"),
      pass("ls -la"),
      pass("rm -rf /tmp/x"), // destructive → no matcher, uncounted
      pass("docker run -it ubuntu bash"), // mutating docker → docker-read rejects, uncounted
    ]);

    const res = applyScaffold({ config: configPath, log: logPath });
    const by = new Map(res.coverage!.byMatcher.map((s) => [s.matcher, s]));

    expect(res.coverage!.found).toBe(true);
    expect(by.get("docker-read")).toEqual({ matcher: "docker-read", distinct: 2, occurrences: 3 });
    expect(by.get("git-read")!.distinct).toBe(1);
    expect(by.get("safe-inspect")!.distinct).toBe(1);
    // Destructive / mutating shapes are never attributed to a matcher.
    expect([...by.keys()]).not.toContain(undefined);
    expect(res.coverage!.byMatcher.reduce((n, s) => n + s.distinct, 0)).toBe(4);
  });

  it("does not count commands already auto-approved by an enabled rule", () => {
    // safe-inspect is already ON, so its `ls` passthroughs are historical and
    // must not be attributed as 'would cover'.
    writeFileSync(
      configPath,
      JSON.stringify({ allow: [{ tool: "Bash", matcher: "safe-inspect" }] }),
    );
    writeLog([pass("ls -la"), pass("docker ps")]);

    const res = applyScaffold({ config: configPath, log: logPath });
    const by = new Map(res.coverage!.byMatcher.map((s) => [s.matcher, s]));

    expect(by.has("safe-inspect")).toBe(false); // already covered → not counted
    expect(by.get("docker-read")!.distinct).toBe(1);
  });

  it("reports found:false when the log is missing (no crash)", () => {
    const res = applyScaffold({ config: configPath, log: join(dir, "nope.jsonl") });
    expect(res.coverage).toEqual({
      logPath: join(dir, "nope.jsonl"),
      found: false,
      totalPassthroughs: 0,
      byMatcher: [],
    });
  });

  it("skips analysis entirely with skipLog", () => {
    const res = applyScaffold({ config: configPath, skipLog: true });
    expect(res.coverage).toBeNull();
  });

  it("tolerates malformed log lines", () => {
    logPath = join(dir, "anumati-passthrough.jsonl");
    writeFileSync(logPath, `not json\n${JSON.stringify(pass("docker ps"))}\n\n{bad\n`);
    const res = applyScaffold({ config: configPath, log: logPath });
    expect(res.coverage!.byMatcher.find((s) => s.matcher === "docker-read")!.distinct).toBe(1);
  });
});

describe("scaffold + add integration", () => {
  it("`anumati add` turns on a scaffolded (disabled) matcher", () => {
    applyScaffold({ config: configPath, skipLog: true });
    expect(evaluate(bash("ls -la"), read().allow!).decision).toBeNull();

    applyAdd({ matcher: "safe-inspect", config: configPath });

    const rule = read().allow!.find((r) => r.matcher === "safe-inspect");
    expect(rule!.enabled).toBeUndefined(); // flag cleared → enabled
    expect(evaluate(bash("ls -la"), read().allow!).decision).toBe("allow");
  });
});
