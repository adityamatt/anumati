import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyAdd, parseAddArgs } from "../../src/cli/add.js";
import type { Config } from "../../src/types.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-add-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): Config {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

describe("parseAddArgs", () => {
  it("parses matcher and comma-separated list flags", () => {
    const o = parseAddArgs(["curl", "--domain", "a.com,b.com"]);
    expect(o.matcher).toBe("curl");
    expect(o.domains).toEqual(["a.com", "b.com"]);
  });

  it("accumulates repeated list flags", () => {
    const o = parseAddArgs(["pip3-install", "--packages", "a", "--packages", "b"]);
    expect(o.packages).toEqual(["a", "b"]);
  });

  it("parses --config", () => {
    const o = parseAddArgs(["safe-read", "--config", "/x/y.json"]);
    expect(o.config).toBe("/x/y.json");
  });

  it("throws when a list flag is missing its value", () => {
    expect(() => parseAddArgs(["pip3-install", "--packages"])).toThrow(/requires a value/);
  });

  it("throws when --config is missing its value", () => {
    expect(() => parseAddArgs(["safe-read", "--config"])).toThrow(/requires a value/);
  });

  it("throws when a flag value is itself another flag", () => {
    expect(() => parseAddArgs(["curl", "--domain", "--config", "/x"])).toThrow(/requires a value/);
  });

  it("supports all list flag aliases", () => {
    const o = parseAddArgs([
      "python3-pipe",
      "--imports", "json,csv",
      "--paths", "/data/",
      "--scripts", "build",
      "--repos", "o/r",
      "--domains", "x.com",
    ]);
    expect(o.imports).toEqual(["json", "csv"]);
    expect(o.paths).toEqual(["/data/"]);
    expect(o.scripts).toEqual(["build"]);
    expect(o.repos).toEqual(["o/r"]);
    expect(o.domains).toEqual(["x.com"]);
  });
});

describe("applyAdd", () => {
  it("creates a config file when none exists", () => {
    const res = applyAdd({ matcher: "curl", domains: ["a.com"], config: configPath });
    expect(res.created).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const cfg = read();
    expect(cfg.allow).toEqual([
      { tool: "Bash", matcher: "curl", allowed_domains: ["a.com"] },
    ]);
  });

  it("creates nested config directory if missing", () => {
    const nested = join(dir, "deep", "nested", "permissions.json");
    applyAdd({ matcher: "git-read", config: nested });
    expect(existsSync(nested)).toBe(true);
  });

  it("merges a new domain into an existing curl rule without duplicates", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ allow: [{ tool: "Bash", matcher: "curl", allowed_domains: ["a.com"] }] }),
    );
    applyAdd({ matcher: "curl", domains: ["a.com", "b.com"], config: configPath });
    expect(read().allow![0].allowed_domains).toEqual(["a.com", "b.com"]);
  });

  it("adds a Read tool for safe-read", () => {
    const res = applyAdd({ matcher: "safe-read", config: configPath });
    expect(res.rule.tool).toBe("Read");
  });

  it("nests open.allowed_paths for --paths", () => {
    applyAdd({ matcher: "python3-pipe", paths: ["/data/"], config: configPath });
    expect(read().allow![0].open).toEqual({ allowed_paths: ["/data/"] });
  });

  it("accumulates across multiple adds", () => {
    applyAdd({ matcher: "npm-script", scripts: ["build"], config: configPath });
    applyAdd({ matcher: "npm-script", scripts: ["lint"], config: configPath });
    const rule = read().allow!.find((r) => r.matcher === "npm-script");
    expect(rule!.allowed_scripts).toEqual(["build", "lint"]);
    expect(read().allow).toHaveLength(1); // extended, not duplicated
  });

  it("preserves existing audit / unrelated config", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ audit: { audit_file: "/tmp/a.json" }, allow: [] }),
    );
    applyAdd({ matcher: "go", config: configPath });
    expect(read().audit).toEqual({ audit_file: "/tmp/a.json" });
  });
});
