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

// Suggestions/debug notes are surfaced via the `systemMessage` JSON channel on
// stdout (exit-0 stderr is invisible in the Claude Code UI). Parse it out, and
// assert the call is still a passthrough (no permissionDecision).
function systemMessage(stdout: string): string {
  if (!stdout.trim()) return "";
  const j = JSON.parse(stdout);
  return j.systemMessage ?? "";
}
function isPassthroughMessage(stdout: string): boolean {
  if (!stdout.trim()) return false;
  const j = JSON.parse(stdout);
  return !!j.systemMessage && !j.hookSpecificOutput?.permissionDecision;
}

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
  it("surfaces a 💡 suggestion via systemMessage and stores it", () => {
    const suggestionsFile = join(dir, "suggestions.jsonl");
    writeFileSync(configPath, JSON.stringify({ suggest: { file: suggestionsFile }, allow: [] }));

    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cargo build" },
      cwd: dir,
    });

    // The message rides on stdout JSON, but as a passthrough (no decision).
    expect(isPassthroughMessage(res.stdout)).toBe(true);
    const msg = systemMessage(res.stdout);
    expect(msg).toContain("💡 anumati");
    expect(msg).toContain("anumati add cargo");
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
    expect(res.stdout).toBe(""); // nothing emitted
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
    expect(res.stdout).not.toContain("systemMessage");
  });
});

describe("hook — debug mode", () => {
  it("explains WHY a `;`-chained command fell through (via systemMessage)", () => {
    writeFileSync(configPath, JSON.stringify({ suggest: { debug: true }, allow: [] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cat a 2>/dev/null; cat b" },
      cwd: dir,
    });
    expect(isPassthroughMessage(res.stdout)).toBe(true); // still passthrough
    const msg = systemMessage(res.stdout);
    expect(msg).toContain("🔍 anumati [debug]");
    expect(msg).toContain(";");
  });

  it("is silent when debug is off (default)", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cat a; cat b" },
      cwd: dir,
    });
    expect(res.stdout).toBe("");
  });

  it("prefers a 💡 suggestion over a 🔍 debug note when one is available", () => {
    writeFileSync(configPath, JSON.stringify({ suggest: { debug: true }, allow: [] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cat foo.txt" }, // suggestable → safe-inspect
      cwd: dir,
    });
    const msg = systemMessage(res.stdout);
    expect(msg).toContain("💡 anumati");
    expect(msg).not.toContain("🔍");
  });

  it("works even when suggest.enabled is false", () => {
    writeFileSync(configPath, JSON.stringify({ suggest: { enabled: false, debug: true }, allow: [] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "kubectl get pods" },
      cwd: dir,
    });
    const msg = systemMessage(res.stdout);
    expect(msg).toContain("🔍 anumati [debug]");
    expect(msg).toContain("kubectl");
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

describe("cli — debug toggle", () => {
  it("turns debug on in an existing config", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [] }));
    const res = run(["debug", "on", "--config", configPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Debug mode on");
    expect(JSON.parse(readFileSync(configPath, "utf-8")).suggest.debug).toBe(true);
  });

  it("turns debug off and is idempotent", () => {
    writeFileSync(configPath, JSON.stringify({ suggest: { debug: true }, allow: [] }));
    expect(run(["debug", "off", "--config", configPath]).stdout).toContain("Debug mode off");
    expect(run(["debug", "off", "--config", configPath]).stdout).toContain("already off");
  });

  it("errors helpfully when the config is missing", () => {
    const res = run(["debug", "on", "--config", join(dir, "nope.json")]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("anumati init");
  });

  it("init --debug then the hook surfaces a 🔍 note on passthrough", () => {
    run(["init", "--config", configPath, "--debug", "--no-hook"]);
    const hook = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "kubectl get pods" },
      cwd: dir,
    });
    expect(systemMessage(hook.stdout)).toContain("🔍 anumati [debug]");
  });
});

describe("cli — init", () => {
  it("scaffolds a starter config that then works as a hook", () => {
    const res = run(["init", "--config", configPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("starter rules");
    expect(existsSync(configPath)).toBe(true);

    // The freshly-created config should auto-allow a read-only git command.
    const hook = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "git status" },
      cwd: dir,
    });
    expect(hook.stdout).toContain('"permissionDecision":"allow"');

    // …and that allow decision should land in the scaffolded audit log.
    const auditFile = join(dir, "anumati-audit.jsonl");
    expect(existsSync(auditFile)).toBe(true);
    const log = readFileSync(auditFile, "utf-8").trim();
    expect(log).toContain('"decision":"allow"');
    expect(log).toContain("git status");

    // …and the PreToolUse hook should be registered in settings.json beside it.
    expect(res.stdout).toContain("Registered the PreToolUse hook");
    const settingsPath = join(dir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toContain("index.js");
    expect(cmd).toContain(configPath);
  });

  it("merges into existing settings.json without clobbering other hooks", () => {
    const settingsPath = join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } }),
    );
    run(["init", "--config", configPath]);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.model).toBe("opus"); // preserved
    expect(settings.hooks.Stop).toBeDefined(); // preserved
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain("index.js"); // added
  });

  it("--no-hook skips settings.json wiring", () => {
    const res = run(["init", "--config", configPath, "--no-hook"]);
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
    expect(res.stdout).toContain("wire the hook into settings.json");
  });

  it("refuses to overwrite an existing config without --force", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [] }));
    const res = run(["init", "--config", configPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("already exists");
  });

  it("prints a status table for both config levels", () => {
    const res = run(["init", "--config", configPath]);
    expect(res.stdout).toContain("anumati config status:");
    expect(res.stdout).toContain("project (this folder)");
    expect(res.stdout).toContain("root (global)");
  });

  it("--project creates a config under the cwd's .claude/", () => {
    // spawnSync runs in ROOT by default; set cwd to the temp dir via a child cwd.
    const res = spawnSync("node", [BIN, "init", "--project"], {
      input: "",
      encoding: "utf-8",
      cwd: dir,
      env: { ...process.env, HOME: join(dir, "fakehome") },
    });
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, ".claude", "permissions.json"))).toBe(true);
  });

  it("errors (does not hang) when no level is given on a non-interactive stdin", () => {
    const res = run(["init"]); // run() pipes stdin → non-TTY
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--root");
    expect(res.stderr).toContain("--project");
  });
});

describe("cli — help & version", () => {
  const pkgVersion = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8"),
  ).version as string;

  it("--help prints usage and exits 0", () => {
    const res = run(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("anumati add <matcher>");
  });

  it("-h is an alias for --help", () => {
    const res = run(["-h"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
  });

  it("--version prints the package version", () => {
    const res = run(["--version"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(pkgVersion);
  });

  it("-V is an alias for --version", () => {
    const res = run(["-V"]);
    expect(res.stdout.trim()).toBe(pkgVersion);
  });

  it("does not show help when invoked as a hook (piped JSON still works)", () => {
    // A real hook call pipes JSON on a non-TTY stdin — must NOT print help.
    writeFileSync(configPath, JSON.stringify({ allow: [{ tool: "Bash", matcher: "cargo" }] }));
    const res = run([configPath], {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "cargo build" },
      cwd: dir,
    });
    expect(res.stdout).toContain('"permissionDecision":"allow"');
    expect(res.stdout).not.toContain("Usage:");
  });
});
