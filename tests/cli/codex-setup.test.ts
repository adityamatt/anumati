import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { codexHookCommand, planCodexSetup } from "../../src/cli/codex-setup.js";
import { STARTER_RULES } from "../../src/cli/init.js";

let dir: string;
let configPath: string;
let hooksFilePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-codex-setup-"));
  configPath = join(dir, "permissions.json");
  hooksFilePath = join(dir, "codex", "hooks.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readHooks() {
  return JSON.parse(readFileSync(hooksFilePath, "utf-8"));
}

describe("codexHookCommand", () => {
  it("uses the bin form when launched as `anumati`", () => {
    expect(codexHookCommand("/c/permissions.json", "/usr/local/bin/anumati", "/usr/bin/node")).toBe(
      "anumati codex-hook /c/permissions.json",
    );
  });

  it("pins to node + script when launched via a dist path", () => {
    expect(codexHookCommand("/c/permissions.json", "/repo/dist/index.js", "/usr/bin/node")).toBe(
      "/usr/bin/node /repo/dist/index.js codex-hook /c/permissions.json",
    );
  });

  it("quotes a config path with spaces", () => {
    expect(codexHookCommand("/my dir/permissions.json", "/x/anumati", "/usr/bin/node")).toBe(
      'anumati codex-hook "/my dir/permissions.json"',
    );
  });
});

describe("planCodexSetup", () => {
  const opts = () => ({
    config: configPath,
    hooksFilePath,
    argv1: "/usr/local/bin/anumati",
    execPath: "/usr/bin/node",
  });

  it("writes the shared ruleset and auto-writes both Codex hooks pointing at it", () => {
    const res = planCodexSetup(opts());

    expect(res.createdConfig).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf-8")).allow).toEqual(STARTER_RULES);
    expect(res.command).toBe(`anumati codex-hook ${configPath}`);

    expect(res.wire.changed).toBe(true);
    expect(res.wire.created).toBe(true);
    expect(res.wire.addedEvents.sort()).toEqual(["PermissionRequest", "SessionStart"]);
    expect(existsSync(hooksFilePath)).toBe(true);

    const hooks = readHooks().hooks;
    expect(hooks.PermissionRequest[0].hooks[0]).toEqual({
      type: "command",
      command: `anumati codex-hook ${configPath}`,
      timeout: 5,
    });
    expect(hooks.SessionStart[0].hooks[0]).toEqual({
      type: "command",
      command: `anumati session-start ${configPath}`,
      timeout: 5,
      async: true, // banner runs async so Codex shows it as a visible Warning
    });
  });

  it("reuses an existing ruleset without overwriting it", () => {
    writeFileSync(configPath, JSON.stringify({ allow: [{ tool: "Bash", matcher: "cargo" }] }));
    const res = planCodexSetup(opts());
    expect(res.createdConfig).toBe(false);
    expect(JSON.parse(readFileSync(configPath, "utf-8")).allow).toEqual([
      { tool: "Bash", matcher: "cargo" },
    ]);
  });

  it("is idempotent — a second run leaves hooks.json unchanged", () => {
    planCodexSetup(opts());
    const first = readFileSync(hooksFilePath, "utf-8");
    const res2 = planCodexSetup(opts());
    expect(res2.wire.changed).toBe(false);
    expect(readFileSync(hooksFilePath, "utf-8")).toBe(first);
    expect(readHooks().hooks.PermissionRequest).toHaveLength(1); // not duplicated
  });
});
