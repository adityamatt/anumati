import { describe, it, expect } from "vitest";
import { matchPrettier } from "../../src/matchers/prettier.js";

describe("matchPrettier — allow (read-only / check)", () => {
  it("npx prettier --check <paths>", () =>
    expect(matchPrettier("npx prettier --check wiki scripts/publish-wiki.mjs")).toBe(true));

  it("direct prettier --check", () =>
    expect(matchPrettier("prettier --check src")).toBe(true));

  it("prettier <file> (prints to stdout)", () =>
    expect(matchPrettier("npx prettier src/index.ts")).toBe(true));

  it("prettier --list-different", () =>
    expect(matchPrettier("npx prettier --list-different .")).toBe(true));

  it("cd <dir> && npx prettier --check ...", () =>
    expect(matchPrettier("cd /Users/a/repo && npx prettier --check src")).toBe(true));

  it("prettier --check ... 2>&1 | tail", () =>
    expect(matchPrettier("npx prettier --check wiki 2>&1 | tail -5")).toBe(true));
});

describe("matchPrettier — block (writes / unsafe shapes)", () => {
  it("--write blocked by default (rewrites files)", () =>
    expect(matchPrettier("npx prettier --write scripts/publish-wiki.mjs")).toBe(false));

  it("-w short form blocked by default", () =>
    expect(matchPrettier("prettier -w .")).toBe(false));

  it("file redirection", () =>
    expect(matchPrettier("npx prettier src > out.txt")).toBe(false));

  it("chained with a non-cd command", () =>
    expect(matchPrettier("npx prettier --check src && rm -rf /")).toBe(false));

  it("; separator", () =>
    expect(matchPrettier("npx prettier --check src; rm x")).toBe(false));

  it("pipe to a non-safe target", () =>
    expect(matchPrettier("npx prettier --check src | sh")).toBe(false));

  it("command substitution", () =>
    expect(matchPrettier("npx prettier --check $(cat files.txt)")).toBe(false));

  it("not prettier", () =>
    expect(matchPrettier("npx eslint src")).toBe(false));

  it("empty", () => expect(matchPrettier("")).toBe(false));
});

describe("matchPrettier — allow_write opt-in", () => {
  it("--write allowed when allowWrite=true", () =>
    expect(matchPrettier("npx prettier --write scripts/publish-wiki.mjs", true)).toBe(true));

  it("-w allowed when allowWrite=true", () =>
    expect(matchPrettier("prettier -w .", true)).toBe(true));

  it("cd && prettier --write allowed when allowWrite=true", () =>
    expect(matchPrettier("cd /Users/a/repo && npx prettier --write src 2>&1 | tail", true)).toBe(true));

  it("--check still allowed when allowWrite=true", () =>
    expect(matchPrettier("npx prettier --check src", true)).toBe(true));

  it("--write still rejects a file redirect even with allowWrite=true", () =>
    expect(matchPrettier("npx prettier --write src > out", true)).toBe(false));
});
