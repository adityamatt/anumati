import { describe, it, expect } from "vitest";
import { matchSafeWrite } from "../../src/matchers/safe-write.js";

const ROOTS = ["/Users/aditya/project", "/tmp/scratch"];

describe("matchSafeWrite", () => {
  it("allows a file inside an allowed root", () =>
    expect(matchSafeWrite("/Users/aditya/project/src/index.ts", ROOTS, "")).toBe(true));

  it("allows a file in a second allowed root", () =>
    expect(matchSafeWrite("/tmp/scratch/out.json", ROOTS, "")).toBe(true));

  it("allows the root directory itself", () =>
    expect(matchSafeWrite("/Users/aditya/project", ROOTS, "")).toBe(true));

  it("resolves a relative path against cwd", () =>
    expect(matchSafeWrite("src/index.ts", ROOTS, "/Users/aditya/project")).toBe(true));

  it("blocks a file outside all roots", () =>
    expect(matchSafeWrite("/etc/passwd", ROOTS, "")).toBe(false));

  it("blocks a sibling dir that shares a prefix", () =>
    expect(matchSafeWrite("/Users/aditya/project-evil/x.ts", ROOTS, "")).toBe(false));

  it("blocks .. traversal that escapes the root", () =>
    expect(matchSafeWrite("/Users/aditya/project/../../../etc/passwd", ROOTS, "")).toBe(false));

  it("allows .. that stays inside the root", () =>
    expect(matchSafeWrite("/Users/aditya/project/src/../lib/x.ts", ROOTS, "")).toBe(true));

  it("blocks when no roots configured", () =>
    expect(matchSafeWrite("/Users/aditya/project/x.ts", [], "")).toBe(false));

  it("blocks empty file path", () =>
    expect(matchSafeWrite("", ROOTS, "")).toBe(false));

  it("ignores empty entries in the allowed list", () =>
    expect(matchSafeWrite("/etc/passwd", ["", "/tmp/scratch"], "")).toBe(false));
});
