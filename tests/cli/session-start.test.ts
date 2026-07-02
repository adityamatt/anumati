import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBanner, resolveBannerConfig } from "../../src/cli/session-start.js";
import type { Config } from "../../src/types.js";

describe("buildBanner", () => {
  it("returns null for a null config", () => {
    expect(buildBanner(null)).toBeNull();
  });

  it("returns null when there are no rules (nothing meaningful to announce)", () => {
    expect(buildBanner({ allow: [] })).toBeNull();
    expect(buildBanner({})).toBeNull();
  });

  it("reports the rule count", () => {
    const c: Config = { allow: [{ matcher: "git-read" }, { matcher: "cargo" }] };
    expect(buildBanner(c)).toBe("⚡ anumati active — 2 rules");
  });

  it("uses singular for a single rule", () => {
    expect(buildBanner({ allow: [{ matcher: "git-read" }] })).toBe("⚡ anumati active — 1 rule");
  });

  it("appends debug state when debug is on", () => {
    const c: Config = { allow: [{ matcher: "git-read" }], suggest: { debug: true } };
    expect(buildBanner(c)).toBe("⚡ anumati active — 1 rule, debug on");
  });

  it("omits debug when off", () => {
    const c: Config = { allow: [{ matcher: "git-read" }], suggest: { debug: false } };
    expect(buildBanner(c)).toBe("⚡ anumati active — 1 rule");
  });

  it("appends the config path on a second line when given", () => {
    const c: Config = { allow: [{ matcher: "git-read" }] };
    const banner = buildBanner(c, "/home/u/.claude/permissions.json");
    expect(banner).toBe("⚡ anumati active — 1 rule\n   /home/u/.claude/permissions.json");
  });
});

describe("resolveBannerConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anumati-banner-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads an explicit config path when given, returning config + path", () => {
    const p = join(dir, "custom.json");
    writeFileSync(p, JSON.stringify({ allow: [{ matcher: "cargo" }] }));
    const r = resolveBannerConfig(p, dir);
    expect(r?.config.allow?.[0].matcher).toBe("cargo");
    expect(r?.path).toBe(p);
  });

  it("prefers a project config in cwd over the explicit fallback", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const projectPath = join(dir, ".claude", "permissions.json");
    writeFileSync(projectPath, JSON.stringify({ allow: [{ matcher: "git-read" }] }));
    // No explicit arg → should find the project config under cwd.
    const r = resolveBannerConfig(undefined, dir);
    expect(r?.config.allow?.[0].matcher).toBe("git-read");
    expect(r?.path).toBe(projectPath);
  });

  it("returns null when nothing resolves", () => {
    expect(resolveBannerConfig(join(dir, "missing.json"), dir)).toBeNull();
  });
});
