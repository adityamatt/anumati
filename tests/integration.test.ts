import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "..");
const BIN = join(ROOT, "dist", "index.js");

// Run the built binary. stdinJson is piped; argv are extra CLI args.
// Uses spawnSync so stdout AND stderr are captured regardless of exit code.
function run(
  argv: string[],
  stdinJson?: object,
  env?: Record<string, string>,
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync("node", [BIN, ...argv], {
    input: stdinJson !== undefined ? JSON.stringify(stdinJson) : "",
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 1,
  };
}

let dir: string;
let configPath: string;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore" });
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-int-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hook — suggestion on passthrough", () => {
  it("writes a 💡 suggestion to stderr and stores it", () => {
    const suggestionsFile = join(dir, "suggestions.jsonl");
    writeFileSync(configPath, JSON.stringify({ suggest: { file: suggestionsFile }, allow: [] }));

    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cargo build" },
      cwd: dir,
    });

    expect(res.stdout).toBe(""); // passthrough — no stdout
    expect(res.stderr).toContain("💡 anumati");
    expect(res.stderr).toContain("anumati add cargo");
    expect(existsSync(suggestionsFile)).toBe(true);
    const stored = JSON.parse(readFileSync(suggestionsFile, "utf-8").trim());
    expect(stored.matcher).toBe("cargo");
    expect(typeof stored.ts).toBe("string");
  });

  it("respects suggest.enabled=false", () => {
    const suggestionsFile = join(dir, "s2.jsonl");
    writeFileSync(configPath, JSON.stringify({ suggest: { enabled: false, file: suggestionsFile }, allow: [] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cargo build" },
      cwd: dir,
    });
    expect(res.stderr).not.toContain("💡");
    expect(existsSync(suggestionsFile)).toBe(false);
  });

  it("emits allow JSON (not a suggestion) when a rule matches", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [{ tool: "Bash", matcher: "cargo" }] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cargo build" },
      cwd: dir,
    });
    expect(res.stdout).toContain('"permissionDecision":"allow"');
    expect(res.stderr).not.toContain("💡");
  });
});

describe("cli — add", () => {
  it("creates and updates the config", () => {
    const res = run(["add", "curl", "--domain", "example.com", "--config", configPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Created");
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.allow[0]).toEqual({ tool: "Bash", matcher: "curl", allowed_domains: ["example.com"] });
  });

  it("exits non-zero with usage when matcher is missing", () => {
    const res = run(["add"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
  });
});

describe("cli — apply", () => {
  it("reports no pending suggestions when the store is empty", () => {
    // HOME → temp dir so the default suggestions file resolves to an empty location.
    const res = run(["apply"], undefined, { HOME: dir });
    expect(res.stdout).toContain("No pending suggestions.");
  });
});
