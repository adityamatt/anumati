import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  wireSteerFile,
  claudeMdFileFor,
  steerBlock,
  STEER_BEGIN,
  STEER_END,
} from "../../src/cli/steer.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-steer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("claudeMdFileFor", () => {
  it("resolves CLAUDE.md beside the config", () => {
    expect(claudeMdFileFor("/a/b/.claude/permissions.json")).toBe("/a/b/.claude/CLAUDE.md");
  });
});

describe("wireSteerFile", () => {
  it("creates a fresh CLAUDE.md with the managed block", () => {
    const path = join(dir, "CLAUDE.md");
    const res = wireSteerFile(path);
    expect(res.created).toBe(true);
    expect(res.changed).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain(STEER_BEGIN);
    expect(content).toContain(STEER_END);
    expect(content).toContain("One command per Bash call");
  });

  it("creates parent directories if missing", () => {
    const path = join(dir, "nested", ".claude", "CLAUDE.md");
    wireSteerFile(path);
    expect(existsSync(path)).toBe(true);
  });

  it("appends the block to an existing CLAUDE.md, preserving content", () => {
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, "# My rules\n\nAlways be nice.\n");
    const res = wireSteerFile(path);
    expect(res.created).toBe(false);
    expect(res.changed).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("Always be nice.");
    expect(content).toContain(STEER_BEGIN);
  });

  it("is idempotent — a second run makes no change", () => {
    const path = join(dir, "CLAUDE.md");
    wireSteerFile(path);
    const first = readFileSync(path, "utf-8");
    const res = wireSteerFile(path);
    expect(res.changed).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe(first);
  });

  it("does not duplicate the block across runs", () => {
    const path = join(dir, "CLAUDE.md");
    wireSteerFile(path);
    wireSteerFile(path);
    wireSteerFile(path);
    const content = readFileSync(path, "utf-8");
    expect(count(content, STEER_BEGIN)).toBe(1);
    expect(count(content, STEER_END)).toBe(1);
  });

  it("replaces a stale block in place, keeping surrounding content", () => {
    const path = join(dir, "CLAUDE.md");
    const stale = `# Top\n\n${STEER_BEGIN}\nOLD GUIDANCE\n${STEER_END}\n\n# Bottom\n`;
    writeFileSync(path, stale);
    const res = wireSteerFile(path);
    expect(res.changed).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("# Top");
    expect(content).toContain("# Bottom");
    expect(content).not.toContain("OLD GUIDANCE");
    expect(count(content, STEER_BEGIN)).toBe(1);
  });

  it("treats a whitespace-only file as empty", () => {
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, "   \n\n");
    wireSteerFile(path);
    const content = readFileSync(path, "utf-8");
    expect(content.startsWith(STEER_BEGIN)).toBe(true);
  });
});

describe("steerBlock", () => {
  it("is wrapped in begin/end markers", () => {
    const block = steerBlock();
    expect(block.startsWith(STEER_BEGIN)).toBe(true);
    expect(block.endsWith(STEER_END)).toBe(true);
  });
});
