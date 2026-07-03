import { describe, it, expect } from "vitest";
import { matchVitest } from "../../src/matchers/vitest.js";

describe("matchVitest — allow", () => {
  it("npx vitest run", () => {
    expect(matchVitest("npx vitest run")).toBe(true);
  });

  it("npx vitest run <path>", () => {
    expect(matchVitest("npx vitest run lib/query/")).toBe(true);
  });

  it("npx vitest run multiple paths", () => {
    expect(matchVitest("npx vitest run a.test.ts b.test.ts")).toBe(true);
  });

  it("direct vitest run (no npx)", () => {
    expect(matchVitest("vitest run")).toBe(true);
  });

  it("run with flags", () => {
    expect(matchVitest("npx vitest run --coverage --reporter dot")).toBe(true);
  });

  it("cd <dir> && npx vitest run <path>", () => {
    expect(matchVitest("cd /Users/foo/repo && npx vitest run lib/query")).toBe(true);
  });

  it("npx vitest run | tail -8", () => {
    expect(matchVitest("npx vitest run lib/query | tail -8")).toBe(true);
  });

  it("allows safe stream redirect 2>&1", () => {
    expect(matchVitest("npx vitest run 2>&1")).toBe(true);
  });

  it("allows 2>/dev/null", () => {
    expect(matchVitest("npx vitest run lib/query 2>/dev/null")).toBe(true);
  });

  it("cd <dir> && npx vitest run | tail", () => {
    expect(matchVitest("cd /tmp && npx vitest run | tail -20")).toBe(true);
  });
});

describe("matchVitest — block", () => {
  it("bare npx vitest (interactive watch)", () => {
    expect(matchVitest("npx vitest")).toBe(false);
  });

  it("vitest watch", () => {
    expect(matchVitest("npx vitest watch")).toBe(false);
  });

  it("vitest dev", () => {
    expect(matchVitest("vitest dev")).toBe(false);
  });

  it("redirection to a file", () => {
    expect(matchVitest("npx vitest run > /tmp/vt.log")).toBe(false);
  });

  it("redirect then tail via ;", () => {
    expect(matchVitest("npx vitest run > /tmp/vt.log 2>&1; tail -8 /tmp/vt.log")).toBe(false);
  });

  it("pipe to a non-safe target", () => {
    expect(matchVitest("npx vitest run | sh")).toBe(false);
  });

  it("chained with && echo", () => {
    expect(matchVitest("npx vitest run && echo done")).toBe(false);
  });

  it("chained with a second command via ;", () => {
    expect(matchVitest("npx vitest run; npx prettier --write x")).toBe(false);
  });

  it("cd not the leading segment", () => {
    expect(matchVitest("npx vitest run && cd /tmp")).toBe(false);
  });

  it("cd with too many args", () => {
    expect(matchVitest("cd a b && npx vitest run")).toBe(false);
  });

  it("command substitution", () => {
    expect(matchVitest("npx vitest run $(echo lib)")).toBe(false);
  });

  it("not vitest", () => {
    expect(matchVitest("npx jest run")).toBe(false);
  });

  it("empty command", () => {
    expect(matchVitest("")).toBe(false);
  });
});
