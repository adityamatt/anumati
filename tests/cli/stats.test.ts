import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeStats,
  statsSources,
  formatStats,
  parseStatsArgs,
} from "../../src/cli/stats.js";
import type { Config } from "../../src/types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-stats-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const auditPath = () => join(dir, "audit.jsonl");
const passPath = () => join(dir, "pass.jsonl");

function line(tool: string, decision: string): string {
  return JSON.stringify({ ts: "t", tool, decision }) + "\n";
}

function twoFileConfig(): Config {
  return { audit: { audit_file: auditPath(), passthrough_file: passPath() } };
}

describe("statsSources", () => {
  it("returns audit + passthrough files", () => {
    expect(statsSources(twoFileConfig())).toEqual([auditPath(), passPath()]);
  });

  it("dedupes when both point at the same file", () => {
    const cfg: Config = { audit: { audit_file: auditPath(), passthrough_file: auditPath() } };
    expect(statsSources(cfg)).toEqual([auditPath()]);
  });

  it("is empty when no audit config", () => {
    expect(statsSources({})).toEqual([]);
  });
});

describe("computeStats — two-file setup", () => {
  it("counts allow vs passthrough across both files", () => {
    writeFileSync(auditPath(), line("Bash", "allow") + line("Read", "allow") + line("Bash", "allow"));
    writeFileSync(passPath(), line("Bash", "passthrough") + line("Write", "passthrough"));
    const s = computeStats(twoFileConfig());
    expect(s.allowed).toBe(3);
    expect(s.passthrough).toBe(2);
    expect(s.total).toBe(5);
    expect(s.ratio).toBeCloseTo(0.6);
  });

  it("ranks tools by frequency", () => {
    writeFileSync(auditPath(), line("Bash", "allow") + line("Bash", "allow") + line("Read", "allow"));
    const s = computeStats(twoFileConfig());
    expect(s.byToolAllowed[0]).toEqual({ tool: "Bash", count: 2 });
    expect(s.byToolAllowed[1]).toEqual({ tool: "Read", count: 1 });
  });
});

describe("computeStats — legacy single-file setup", () => {
  it("classifies by the decision field when both share one file", () => {
    const cfg: Config = { audit: { audit_file: auditPath(), passthrough_file: auditPath() } };
    writeFileSync(auditPath(), line("Bash", "allow") + line("Bash", "passthrough") + line("Bash", "allow"));
    const s = computeStats(cfg);
    expect(s.allowed).toBe(2);
    expect(s.passthrough).toBe(1);
    expect(s.sources).toEqual([auditPath()]);
  });
});

describe("computeStats — edge cases", () => {
  it("returns zeros with no files present", () => {
    const s = computeStats(twoFileConfig());
    expect(s.total).toBe(0);
    expect(s.ratio).toBe(0);
    expect(s.sources).toEqual([]);
  });

  it("skips malformed lines", () => {
    writeFileSync(auditPath(), line("Bash", "allow") + "not json\n" + "\n" + line("Read", "allow"));
    const s = computeStats(twoFileConfig());
    expect(s.allowed).toBe(2);
  });

  it("labels entries with no tool as 'unknown'", () => {
    writeFileSync(auditPath(), JSON.stringify({ decision: "allow" }) + "\n");
    const s = computeStats(twoFileConfig());
    expect(s.byToolAllowed[0]).toEqual({ tool: "unknown", count: 1 });
  });
});

describe("formatStats", () => {
  it("notes when no logs are found", () => {
    const out = formatStats(computeStats(twoFileConfig()), "/x/permissions.json");
    expect(out).toContain("No audit logs found");
  });

  it("notes when logs exist but are empty", () => {
    writeFileSync(auditPath(), "");
    const out = formatStats(computeStats(twoFileConfig()), "/x/permissions.json");
    expect(out).toContain("no decisions yet");
  });

  it("renders counts and ratio", () => {
    writeFileSync(auditPath(), line("Bash", "allow") + line("Read", "allow") + line("Bash", "allow"));
    writeFileSync(passPath(), line("Bash", "passthrough"));
    const out = formatStats(computeStats(twoFileConfig()), "/x/permissions.json");
    expect(out).toContain("Auto-approved");
    expect(out).toContain("75.0%");
    expect(out).toContain("Passed through");
  });
});

describe("parseStatsArgs", () => {
  it("defaults to no options (root)", () => {
    expect(parseStatsArgs([])).toEqual({});
  });

  it("parses --project / --root", () => {
    expect(parseStatsArgs(["--project"]).level).toBe("project");
    expect(parseStatsArgs(["--root"]).level).toBe("root");
  });

  it("parses --config", () => {
    expect(parseStatsArgs(["--config", "/a/b.json"]).config).toBe("/a/b.json");
  });

  it("throws when --config has no value", () => {
    expect(() => parseStatsArgs(["--config"])).toThrow(/requires a value/);
  });
});
