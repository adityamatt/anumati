import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { wireCodexHooks, type CodexHookSpec } from "../../src/cli/codex-hooks-file.js";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-codex-hooks-"));
  path = join(dir, "sub", "hooks.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const read = () => JSON.parse(readFileSync(path, "utf-8"));

const PERM: CodexHookSpec = {
  event: "PermissionRequest",
  command: "anumati codex-hook /home/u/.anumati/permissions.json",
  timeout: 5,
  marker: "codex-hook",
};
const BANNER: CodexHookSpec = {
  event: "SessionStart",
  command: "anumati session-start /home/u/.anumati/permissions.json",
  timeout: 5,
  marker: "session-start",
  async: true,
};

describe("wireCodexHooks", () => {
  it("creates hooks.json with both events (nested under `hooks`)", () => {
    const res = wireCodexHooks([PERM, BANNER], path);
    expect(res).toMatchObject({ path, created: true, changed: true });
    expect(res.addedEvents.sort()).toEqual(["PermissionRequest", "SessionStart"]);
    expect(read()).toEqual({
      hooks: {
        PermissionRequest: [{ hooks: [{ type: "command", command: PERM.command, timeout: 5 }] }],
        SessionStart: [
          { hooks: [{ type: "command", command: BANNER.command, timeout: 5, async: true }] },
        ],
      },
    });
  });

  it("is idempotent — a second call adds nothing", () => {
    wireCodexHooks([PERM, BANNER], path);
    const res2 = wireCodexHooks([PERM, BANNER], path);
    expect(res2.changed).toBe(false);
    expect(res2.addedEvents).toEqual([]);
    expect(read().hooks.PermissionRequest).toHaveLength(1);
    expect(read().hooks.SessionStart).toHaveLength(1);
  });

  it("adds only the missing event when one is already wired", () => {
    wireCodexHooks([PERM], path); // only PermissionRequest present
    const res = wireCodexHooks([PERM, BANNER], path);
    expect(res.addedEvents).toEqual(["SessionStart"]);
    expect(read().hooks.PermissionRequest).toHaveLength(1); // not duplicated
    expect(read().hooks.SessionStart).toHaveLength(1);
  });

  it("preserves existing hooks and unrelated fields (non-destructive merge)", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        description: "keep me",
        hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "other" }] }] },
      }),
    );

    const res = wireCodexHooks([PERM, BANNER], path);

    expect(res.changed).toBe(true);
    expect(res.created).toBe(false);
    const f = read();
    expect(f.description).toBe("keep me");
    expect(f.hooks.PostToolUse).toEqual([{ hooks: [{ type: "command", command: "other" }] }]);
    expect(f.hooks.PermissionRequest[0].hooks[0].command).toBe(PERM.command);
    expect(f.hooks.SessionStart[0].hooks[0].command).toBe(BANNER.command);
  });

  it("throws on an existing invalid-JSON file (never clobbers)", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    expect(() => wireCodexHooks([PERM], path)).toThrow(/not valid JSON/);
    expect(readFileSync(path, "utf-8")).toBe("{ not json"); // untouched
  });
});
