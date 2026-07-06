import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { homedir } from "os";
import {
  applyInit,
  parseInitArgs,
  configStatus,
  resolveInitTarget,
  prettyPath,
  auditFileFor,
  passthroughFileFor,
  STARTER_RULES,
} from "../../src/cli/init.js";
import { defaultConfigPath, projectConfigPath } from "../../src/config.js";
import { evaluate } from "../../src/matcher.js";
import type { Config, HookInput } from "../../src/types.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-init-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): Config {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

describe("parseInitArgs", () => {
  it("defaults to no config and no force", () => {
    expect(parseInitArgs([])).toEqual({});
  });

  it("parses --force and -f", () => {
    expect(parseInitArgs(["--force"]).force).toBe(true);
    expect(parseInitArgs(["-f"]).force).toBe(true);
  });

  it("parses --config", () => {
    expect(parseInitArgs(["--config", "/x/y.json"]).config).toBe("/x/y.json");
  });

  it("throws when --config is missing its value", () => {
    expect(() => parseInitArgs(["--config"])).toThrow(/requires a value/);
  });

  it("parses --root / --global as the root level", () => {
    expect(parseInitArgs(["--root"]).level).toBe("root");
    expect(parseInitArgs(["--global"]).level).toBe("root");
  });

  it("parses --project / --local as the project level", () => {
    expect(parseInitArgs(["--project"]).level).toBe("project");
    expect(parseInitArgs(["--local"]).level).toBe("project");
  });

  it("parses --no-audit", () => {
    expect(parseInitArgs(["--no-audit"]).audit).toBe(false);
    expect(parseInitArgs([]).audit).toBeUndefined(); // defaults on at apply time
  });

  it("parses --debug", () => {
    expect(parseInitArgs(["--debug"]).debug).toBe(true);
    expect(parseInitArgs([]).debug).toBeUndefined(); // off unless requested
  });

  it("parses --no-steer", () => {
    expect(parseInitArgs(["--no-steer"]).steer).toBe(false);
    expect(parseInitArgs([]).steer).toBeUndefined(); // defaults on at apply time
  });
});

describe("resolveInitTarget", () => {
  it("returns null when neither config nor level is given (must prompt)", () => {
    expect(resolveInitTarget({})).toBeNull();
  });

  it("explicit --config wins over level", () => {
    expect(resolveInitTarget({ config: "/x.json", level: "root" })).toBe("/x.json");
  });

  it("--root resolves to the global config path", () => {
    expect(resolveInitTarget({ level: "root" })).toBe(defaultConfigPath());
  });

  it("--project resolves under the given cwd", () => {
    expect(resolveInitTarget({ level: "project", cwd: "/tmp/proj" })).toBe(
      projectConfigPath("/tmp/proj"),
    );
  });
});

describe("configStatus", () => {
  it("reports a project config as existing once created", () => {
    // Create a project config under the temp dir via applyInit (makes .claude/).
    const projConfig = projectConfigPath(dir);
    applyInit({ config: projConfig, level: "project" });
    const status = configStatus(dir);
    const project = status.find((s) => s.level === "project")!;
    expect(project.exists).toBe(true);
    expect(project.path).toBe(projConfig);
  });

  it("reports a not-yet-created project config as absent", () => {
    const status = configStatus(dir);
    expect(status.find((s) => s.level === "project")!.exists).toBe(false);
    expect(status.find((s) => s.level === "root")!.path).toBe(defaultConfigPath());
  });
});

describe("prettyPath", () => {
  it("collapses the home directory to ~", () => {
    expect(prettyPath(join(homedir(), ".claude", "permissions.json"))).toBe(
      "~/.claude/permissions.json",
    );
  });

  it("leaves non-home paths unchanged", () => {
    expect(prettyPath("/tmp/x.json")).toBe("/tmp/x.json");
  });
});

describe("applyInit", () => {
  it("creates a starter config when none exists", () => {
    const res = applyInit({ config: configPath });
    expect(existsSync(configPath)).toBe(true);
    expect(res.ruleCount).toBe(STARTER_RULES.length);
    expect(read().allow).toEqual(STARTER_RULES);
  });

  it("creates nested directories if missing", () => {
    const nested = join(dir, "a", "b", "permissions.json");
    applyInit({ config: nested });
    expect(existsSync(nested)).toBe(true);
  });

  it("seeds a nodejs-pipe rule that auto-approves pure-compute node", () => {
    applyInit({ config: configPath });
    const rules = read().allow ?? [];
    const input: HookInput = {
      session_id: "t",
      tool_name: "Bash",
      tool_input: { command: `node -e "console.log(require('path').sep)"` },
    };
    expect(evaluate(input, rules).decision).toBe("allow");
  });

  it("refuses to overwrite an existing config without --force", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [{ matcher: "cargo" }] }));
    expect(() => applyInit({ config: configPath })).toThrow(/already exists/);
    // original content untouched
    expect(read().allow).toEqual([{ matcher: "cargo" }]);
  });

  it("overwrites with --force", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [{ matcher: "cargo" }] }));
    applyInit({ config: configPath, force: true });
    expect(read().allow).toEqual(STARTER_RULES);
  });
});

describe("applyInit — audit log", () => {
  it("scaffolds an audit log next to the config by default", () => {
    const res = applyInit({ config: configPath });
    const expected = auditFileFor(configPath);
    expect(res.auditFile).toBe(expected);
    expect(expected).toBe(join(dir, "anumati-audit.jsonl"));
    expect(existsSync(expected)).toBe(true);
  });

  it("references the audit log from the config with audit_level matched + passthrough_file", () => {
    applyInit({ config: configPath });
    expect(read().audit).toEqual({
      audit_file: auditFileFor(configPath),
      audit_level: "matched",
      passthrough_file: passthroughFileFor(configPath),
    });
  });

  it("creates the audit log empty", () => {
    applyInit({ config: configPath });
    expect(readFileSync(auditFileFor(configPath), "utf-8")).toBe("");
  });

  it("scaffolds a passthrough log next to the config", () => {
    const res = applyInit({ config: configPath });
    expect(res.passthroughFile).toBe(passthroughFileFor(configPath));
    expect(existsSync(passthroughFileFor(configPath))).toBe(true);
    expect(readFileSync(passthroughFileFor(configPath), "utf-8")).toBe("");
  });

  it("does not clobber an existing audit log on --force re-init", () => {
    applyInit({ config: configPath });
    writeFileSync(auditFileFor(configPath), '{"existing":"entry"}\n');
    applyInit({ config: configPath, force: true });
    expect(readFileSync(auditFileFor(configPath), "utf-8")).toContain("existing");
  });

  it("omits audit entirely with audit:false", () => {
    const res = applyInit({ config: configPath, audit: false });
    expect(res.auditFile).toBeUndefined();
    expect(read().audit).toBeUndefined();
    expect(existsSync(auditFileFor(configPath))).toBe(false);
  });

  it("seeds suggest.debug when debug:true", () => {
    applyInit({ config: configPath, debug: true, hook: false });
    expect(read().suggest).toEqual({ debug: true });
  });

  it("does not add a suggest block by default", () => {
    applyInit({ config: configPath, hook: false });
    expect(read().suggest).toBeUndefined();
  });
});

describe("applyInit — steer file (CLAUDE.md)", () => {
  const claudeMd = () => join(dir, "CLAUDE.md");

  it("writes command-style guidance to CLAUDE.md beside the config by default", () => {
    const res = applyInit({ config: configPath, hook: false });
    expect(res.steer?.claudeMdPath).toBe(claudeMd());
    expect(res.steer?.changed).toBe(true);
    expect(existsSync(claudeMd())).toBe(true);
    expect(readFileSync(claudeMd(), "utf-8")).toContain("anumati-friendly command style");
  });

  it("skips the steer file with steer:false", () => {
    const res = applyInit({ config: configPath, hook: false, steer: false });
    expect(res.steer).toBeUndefined();
    expect(existsSync(claudeMd())).toBe(false);
  });

  it("does not duplicate the block on --force re-init", () => {
    applyInit({ config: configPath, hook: false });
    const res = applyInit({ config: configPath, hook: false, force: true });
    expect(res.steer?.changed).toBe(false);
    const content = readFileSync(claudeMd(), "utf-8");
    expect(content.split("BEGIN anumati").length - 1).toBe(1);
  });

  it("preserves pre-existing CLAUDE.md content", () => {
    writeFileSync(claudeMd(), "# Existing\n\nKeep me.\n");
    applyInit({ config: configPath, hook: false });
    const content = readFileSync(claudeMd(), "utf-8");
    expect(content).toContain("Keep me.");
    expect(content).toContain("anumati-friendly command style");
  });
});

describe("applyInit — hook wiring", () => {
  const settingsPath = () => join(dir, "settings.json");
  const readSettings = () => JSON.parse(readFileSync(settingsPath(), "utf-8"));
  // Inject launch context so the command form is deterministic in tests.
  const launchedViaBin = { argv1: "/usr/local/bin/anumati", execPath: "/usr/bin/node" };

  it("registers a PreToolUse hook in settings.json beside the config", () => {
    const res = applyInit({ config: configPath, ...launchedViaBin });
    expect(res.hook?.changed).toBe(true);
    expect(existsSync(settingsPath())).toBe(true);
    const cmd = readSettings().hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toBe(`anumati ${configPath}`);
  });

  it("is idempotent across repeated inits", () => {
    applyInit({ config: configPath, ...launchedViaBin });
    const res = applyInit({ config: configPath, force: true, ...launchedViaBin });
    expect(res.hook?.changed).toBe(false);
    expect(readSettings().hooks.PreToolUse).toHaveLength(1);
  });

  it("skips wiring with hook:false", () => {
    const res = applyInit({ config: configPath, hook: false });
    expect(res.hook).toBeUndefined();
    expect(existsSync(settingsPath())).toBe(false);
  });

  it("reports a non-fatal hookError when settings.json is invalid (config still written)", () => {
    writeFileSync(settingsPath(), "{ broken json");
    const res = applyInit({ config: configPath, ...launchedViaBin });
    expect(res.hookError).toMatch(/not valid JSON/);
    expect(res.hook).toBeUndefined();
    // config + audit still succeeded
    expect(existsSync(configPath)).toBe(true);
    expect(read().allow).toEqual(STARTER_RULES);
    // broken settings left untouched
    expect(readFileSync(settingsPath(), "utf-8")).toBe("{ broken json");
  });
});

describe("starter config — functional", () => {
  // The whole point of init: the generated rules must actually auto-allow.
  function bash(command: string): HookInput {
    return { session_id: "t", tool_name: "Bash", tool_input: { command }, cwd: dir };
  }

  it("auto-allows the commands its rules cover", () => {
    applyInit({ config: configPath });
    const rules = read().allow!;
    expect(evaluate(bash("git status"), rules).decision).toBe("allow");
    expect(evaluate(bash("ls -la"), rules).decision).toBe("allow");
    expect(evaluate(bash("npx tsc --noEmit"), rules).decision).toBe("allow");
  });

  it("auto-allows python3 using only pre-seeded safe stdlib modules", () => {
    applyInit({ config: configPath });
    const rules = read().allow!;
    expect(
      evaluate(bash(`python3 -c "import json, statistics; print(statistics.mean([1,2]))"`), rules).decision,
    ).toBe("allow");
  });

  it("still passes through commands outside the safe defaults", () => {
    applyInit({ config: configPath });
    const rules = read().allow!;
    expect(evaluate(bash("curl https://example.com"), rules).decision).toBeNull();
    expect(evaluate(bash("rm -rf /"), rules).decision).toBeNull();
    // A non-stdlib python import is NOT covered by the seeded safe set.
    expect(evaluate(bash(`python3 -c "import pandas"`), rules).decision).toBeNull();
    // Comma-hidden blocked module must not slip through the seeded json import.
    expect(evaluate(bash(`python3 -c "import json, subprocess"`), rules).decision).toBeNull();
  });
});
