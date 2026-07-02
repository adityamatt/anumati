import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { audit } from "../src/audit.js";
import type { HookInput, MatchResult } from "../src/types.js";

const TMP = "/tmp/claude-permissions-test-audit.json";

function cleanup() {
  if (existsSync(TMP)) unlinkSync(TMP);
}

function lines() {
  return readFileSync(TMP, "utf-8").trim().split("\n").map(l => JSON.parse(l));
}

const bashInput: HookInput = {
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command: "curl -s https://example.com" },
};

const allowResult: MatchResult = {
  decision: "allow",
  rule: { matcher: "curl", desc: "curl allowed" },
};

const passthroughResult: MatchResult = { decision: null, rule: null };

beforeEach(cleanup);
afterEach(cleanup);

describe("audit — level: matched", () => {
  it("logs allow matches", () => {
    audit({ audit_file: TMP, audit_level: "matched" }, bashInput, allowResult);
    const [entry] = lines();
    expect(entry.decision).toBe("allow");
    expect(entry.tool).toBe("Bash");
    expect(entry.command).toBe("curl -s https://example.com");
    expect(entry.rule_desc).toBe("curl allowed");
  });

  it("writes ts with the local timezone offset, not UTC Z", () => {
    audit({ audit_file: TMP, audit_level: "matched" }, bashInput, allowResult);
    const [entry] = lines();
    // Local ISO 8601: ends with a numeric offset (+/-HH:MM), never the UTC "Z".
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(entry.ts).not.toMatch(/Z$/);
    // The instant it encodes must match the wall clock at write time.
    expect(Math.abs(new Date(entry.ts).getTime() - Date.now())).toBeLessThan(5000);
  });

  it("skips passthrough", () => {
    audit({ audit_file: TMP, audit_level: "matched" }, bashInput, passthroughResult);
    expect(existsSync(TMP)).toBe(false);
  });
});

describe("audit — level: all", () => {
  it("logs passthrough too", () => {
    audit({ audit_file: TMP, audit_level: "all" }, bashInput, passthroughResult);
    const [entry] = lines();
    expect(entry.decision).toBe("passthrough");
  });
});

describe("audit — passthrough_file routing", () => {
  const PASS = "/tmp/claude-permissions-test-passthrough.json";
  function passLines() {
    return readFileSync(PASS, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  }
  beforeEach(() => { if (existsSync(PASS)) unlinkSync(PASS); });
  afterEach(() => { if (existsSync(PASS)) unlinkSync(PASS); });

  it("routes passthrough to passthrough_file, not audit_file", () => {
    audit({ audit_file: TMP, passthrough_file: PASS, audit_level: "matched" }, bashInput, passthroughResult);
    expect(existsSync(TMP)).toBe(false); // approvals log untouched
    const [entry] = passLines();
    expect(entry.decision).toBe("passthrough");
    expect(entry.command).toBe("curl -s https://example.com");
  });

  it("still routes approvals to audit_file", () => {
    audit({ audit_file: TMP, passthrough_file: PASS, audit_level: "matched" }, bashInput, allowResult);
    expect(existsSync(PASS)).toBe(false); // denials log untouched
    const [entry] = lines();
    expect(entry.decision).toBe("allow");
  });

  it("records passthrough at level matched when passthrough_file is set", () => {
    // Without passthrough_file, level "matched" would skip passthrough entirely.
    audit({ audit_file: TMP, passthrough_file: PASS, audit_level: "matched" }, bashInput, passthroughResult);
    expect(passLines()).toHaveLength(1);
  });

  it("writes nothing to either file when level is off", () => {
    audit({ audit_file: TMP, passthrough_file: PASS, audit_level: "off" }, bashInput, passthroughResult);
    expect(existsSync(TMP)).toBe(false);
    expect(existsSync(PASS)).toBe(false);
  });
});

describe("audit — level: off", () => {
  it("writes nothing", () => {
    audit({ audit_file: TMP, audit_level: "off" }, bashInput, allowResult);
    expect(existsSync(TMP)).toBe(false);
  });
});

describe("audit — missing config", () => {
  it("writes nothing when no audit config", () => {
    audit(undefined, bashInput, allowResult);
    expect(existsSync(TMP)).toBe(false);
  });

  it("writes nothing when audit_file missing", () => {
    audit({ audit_level: "all" }, bashInput, allowResult);
    expect(existsSync(TMP)).toBe(false);
  });

  it("does not throw on bad file path", () => {
    expect(() =>
      audit({ audit_file: "/nonexistent/dir/file.json", audit_level: "all" }, bashInput, allowResult)
    ).not.toThrow();
  });
});

describe("audit — appends multiple entries", () => {
  it("appends one line per call", () => {
    audit({ audit_file: TMP, audit_level: "all" }, bashInput, allowResult);
    audit({ audit_file: TMP, audit_level: "all" }, bashInput, passthroughResult);
    expect(lines()).toHaveLength(2);
  });
});
