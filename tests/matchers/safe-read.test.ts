import { describe, it, expect } from "vitest";
import { matchSafeRead } from "../../src/matchers/safe-read.js";

describe("matchSafeRead", () => {
  it("allows absolute path", () => expect(matchSafeRead("/Users/aditya/project/src/index.ts")).toBe(true));
  it("allows relative path", () => expect(matchSafeRead("src/index.ts")).toBe(true));
  it("blocks path traversal with ..", () => expect(matchSafeRead("/Users/foo/../../../etc/passwd")).toBe(false));
  it("blocks .. in middle of path", () => expect(matchSafeRead("/foo/../bar")).toBe(false));
  it("blocks empty path", () => expect(matchSafeRead("")).toBe(false));
});
