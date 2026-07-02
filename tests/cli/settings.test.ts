import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  settingsFileFor,
  shellQuote,
  buildHookCommand,
  buildBannerCommand,
  loadSettings,
  mergeAnumatiHook,
  mergeAnumatiBanner,
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

describe("buildBannerCommand", () => {
  it("uses the bare bin form with the session-start subcommand", () => {
    const cmd = buildBannerCommand("/c/permissions.json", "/usr/local/bin/anumati", "/usr/bin/node");
    expect(cmd).toBe("anumati session-start /c/permissions.json");
  });

  it("pins node + script + session-start when launched via node dist/index.js", () => {
    const cmd = buildBannerCommand("/c/permissions.json", "/repo/dist/index.js", "/usr/bin/node");
    expect(cmd).toBe("/usr/bin/node /repo/dist/index.js session-start /c/permissions.json");
  });
});

describe("mergeAnumatiBanner", () => {
  it("adds a SessionStart hook (no matcher) to empty settings", () => {
    const { settings, changed } = mergeAnumatiBanner({}, "anumati session-start /c.json");
    expect(changed).toBe(true);
    const entry = settings.hooks!.SessionStart![0];
    expect(entry.matcher).toBeUndefined();
    expect(entry.hooks[0].command).toBe("anumati session-start /c.json");
  });

  it("is idempotent when a session-start hook already exists", () => {
    const first = mergeAnumatiBanner({}, "anumati session-start /c.json").settings;
    expect(mergeAnumatiBanner(first, "anumati session-start /c.json").changed).toBe(false);
  });

  it("preserves other SessionStart hooks", () => {
    const existing: ClaudeSettings = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other-startup" }] }] },
    };
    const { settings } = mergeAnumatiBanner(existing, "anumati session-start /c.json");
    expect(settings.hooks!.SessionStart).toHaveLength(2);
    expect(settings.hooks!.SessionStart![0].hooks[0].command).toBe("other-startup");
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

  it("registers both PreToolUse and SessionStart when a banner command is given", () => {
    const res = wireAnumatiHook(settingsPath, "anumati /c.json", "anumati session-start /c.json");
    expect(res.changed).toBe(true);
    const s = read();
    expect(s.hooks!.PreToolUse![0].hooks[0].command).toBe("anumati /c.json");
    expect(s.hooks!.SessionStart![0].hooks[0].command).toBe("anumati session-start /c.json");
  });

  it("adds only the banner when the PreToolUse hook already exists", () => {
    wireAnumatiHook(settingsPath, "anumati /c.json"); // hook only, no banner
    const res = wireAnumatiHook(settingsPath, "anumati /c.json", "anumati session-start /c.json");
    expect(res.changed).toBe(true); // banner was newly added
    expect(read().hooks!.SessionStart).toHaveLength(1);
    expect(read().hooks!.PreToolUse).toHaveLength(1); // not duplicated
  });

  it("is fully idempotent when both already exist", () => {
    wireAnumatiHook(settingsPath, "anumati /c.json", "anumati session-start /c.json");
    const res = wireAnumatiHook(settingsPath, "anumati /c.json", "anumati session-start /c.json");
    expect(res.changed).toBe(false);
  });
});
