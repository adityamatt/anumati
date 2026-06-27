import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  deduplicateByCommand,
  applyOneSuggestion,
} from "../../src/cli/apply.js";
import type { StoredSuggestion } from "../../src/suggest-store.js";
import type { Config } from "../../src/types.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-apply-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stored(over: Partial<StoredSuggestion>): StoredSuggestion {
  return {
    ts: "2026-01-01T00:00:00Z",
    command: "anumati add curl --domain a.com",
    description: "d",
    matcher: "curl",
    configDelta: {},
    risk: "low",
    trigger: "t",
    ...over,
  };
}

describe("deduplicateByCommand", () => {
  it("collapses repeated commands keeping the latest", () => {
    const a = stored({ command: "anumati add go", ts: "1" });
    const b = stored({ command: "anumati add go", ts: "2" });
    const c = stored({ command: "anumati add cargo" });
    const out = deduplicateByCommand([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.command === "anumati add go")!.ts).toBe("2");
  });
});

describe("applyOneSuggestion", () => {
  it("applies a parameterized suggestion from its configDelta", () => {
    const res = applyOneSuggestion(
      stored({ matcher: "curl", configDelta: { allowed_domains: ["x.com"] } }),
      configPath,
    );
    expect(res).not.toBeNull();
    const cfg: Config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.allow![0]).toEqual({ tool: "Bash", matcher: "curl", allowed_domains: ["x.com"] });
  });

  it("applies a no-param matcher suggestion", () => {
    applyOneSuggestion(stored({ matcher: "cargo", configDelta: { matcher: "cargo" } }), configPath);
    const cfg: Config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.allow![0]).toEqual({ tool: "Bash", matcher: "cargo" });
  });

  it("applies open.allowed_paths and preserves spaces in paths", () => {
    // Round-tripping via the command string would truncate "my file" → "my".
    applyOneSuggestion(
      stored({ matcher: "python3-pipe", configDelta: { open: { allowed_paths: ["/tmp/my file/"] } } }),
      configPath,
    );
    const cfg: Config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.allow![0].open).toEqual({ allowed_paths: ["/tmp/my file/"] });
  });

  it("returns null when the suggestion has no matcher", () => {
    expect(applyOneSuggestion(stored({ matcher: "" as any }), configPath)).toBeNull();
  });
});
