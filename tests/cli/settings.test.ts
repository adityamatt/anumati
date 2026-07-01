import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  settingsFileFor,
  shellQuote,
  buildHookCommand,
  loadSettings,
  mergeAnumatiHook,
  wireAnumatiHook,
  HOOK_MATCHER,
  type ClaudeSettings,
} from "../../src/cli/settings.js";

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-settings-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): ClaudeSettings {
  return JSON.parse(readFileSync(settingsPath, "utf-8"));
}

describe("settingsFileFor", () => {
  it("resolves settings.json next to the config", () => {
    expect(settingsFileFor("/a/b/.claude/permissions.json")).toBe("/a/b/.claude/settings.json");
  });
});

describe("shellQuote", () => {
  it("leaves simple paths unquoted", () => {
    expect(shellQuote("/usr/bin/anumati")).toBe("/usr/bin/anumati");
  });
  it("quotes paths with spaces", () => {
    expect(shellQuote("/my path/x.js")).toBe('"/my path/x.js"');
  });
});

describe("buildHookCommand", () => {
  it("uses the bare bin form when launched via the anumati bin", () => {
    const cmd = buildHookCommand("/c/permissions.json", "/usr/local/bin/anumati", "/usr/bin/node");
    expect(cmd).toBe("anumati /c/permissions.json");
  });

  it("pins node + script when launched via node dist/index.js", () => {
    const cmd = buildHookCommand("/c/permissions.json", "/repo/dist/index.js", "/usr/bin/node");
    expect(cmd).toBe("/usr/bin/node /repo/dist/index.js /c/permissions.json");
  });

  it("quotes a config path containing spaces", () => {
    const cmd = buildHookCommand("/my dir/permissions.json", "/x/anumati", "/usr/bin/node");
    expect(cmd).toBe('anumati "/my dir/permissions.json"');
  });
});

describe("loadSettings", () => {
  it("returns {} when the file is absent", () => {
    expect(loadSettings(settingsPath)).toEqual({});
  });
  it("parses an existing file", () => {
    writeFileSync(settingsPath, JSON.stringify({ model: "opus" }));
    expect(loadSettings(settingsPath)).toEqual({ model: "opus" });
  });
  it("throws (does not return {}) on invalid JSON, so callers never clobber", () => {
    writeFileSync(settingsPath, "{ not json");
    expect(() => loadSettings(settingsPath)).toThrow(/not valid JSON/);
  });
});

describe("mergeAnumatiHook", () => {
  it("adds a PreToolUse hook to empty settings", () => {
    const { settings, changed } = mergeAnumatiHook({}, "anumati /c.json");
    expect(changed).toBe(true);
    const entry = settings.hooks!.PreToolUse![0];
    expect(entry.matcher).toBe(HOOK_MATCHER);
    expect(entry.hooks[0]).toEqual({ type: "command", command: "anumati /c.json", timeout: 5 });
  });

  it("is idempotent — no second hook when one already invokes anumati", () => {
    const first = mergeAnumatiHook({}, "anumati /c.json").settings;
    const { changed } = mergeAnumatiHook(first, "anumati /c.json");
    expect(changed).toBe(false);
  });

  it("preserves unrelated settings and other hooks", () => {
    const existing: ClaudeSettings = {
      model: "opus",
      hooks: {
        PreToolUse: [{ matcher: "WebFetch", hooks: [{ type: "command", command: "other" }] }],
        Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
      },
    };
    const { settings } = mergeAnumatiHook(existing, "anumati /c.json");
    expect(settings.model).toBe("opus");
    expect(settings.hooks!.Stop).toBeDefined();
    expect(settings.hooks!.PreToolUse).toHaveLength(2);
    expect(settings.hooks!.PreToolUse![0].hooks[0].command).toBe("other");
  });
});

describe("wireAnumatiHook", () => {
  it("writes settings.json and reports changed=true", () => {
    const res = wireAnumatiHook(settingsPath, "anumati /c.json");
    expect(res.changed).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    expect(read().hooks!.PreToolUse![0].hooks[0].command).toBe("anumati /c.json");
  });

  it("does not rewrite when already present (changed=false)", () => {
    wireAnumatiHook(settingsPath, "anumati /c.json");
    const res = wireAnumatiHook(settingsPath, "anumati /c.json");
    expect(res.changed).toBe(false);
  });

  it("throws on invalid existing settings without overwriting", () => {
    writeFileSync(settingsPath, "{ broken");
    expect(() => wireAnumatiHook(settingsPath, "anumati /c.json")).toThrow(/not valid JSON/);
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ broken");
  });
});
