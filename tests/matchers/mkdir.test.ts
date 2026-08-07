import { describe, it, expect } from "vitest";
import { matchMkdir } from "../../src/matchers/mkdir.js";

describe("matchMkdir — allow", () => {
  it("mkdir -p absolute path", () =>
    expect(matchMkdir("mkdir -p /Users/adityatx/adityatx/open-source/anumati/.claude/workflows")).toBe(true));
  it("mkdir -p another absolute path", () =>
    expect(matchMkdir("mkdir -p /Users/adityatx/adityatx/open-source/anumati/workflows")).toBe(true));
  it("mkdir -p relative path", () => expect(matchMkdir("mkdir -p tests")).toBe(true));
  it("mkdir -p deep path", () =>
    expect(matchMkdir("mkdir -p /Users/adityatx/adityatx/DrashtaCombined/analysis/path_actual_cpt/raw")).toBe(true));
  it("mkdir -p with safe stream redirect", () =>
    expect(matchMkdir("mkdir -p /Users/adityatx/adityatx/DrashtaCombined/drashta/src/DrashtaCDK/scripts/reconcile-repro/data 2>&1")).toBe(true));
  it("mkdir -p worktrees", () =>
    expect(matchMkdir("mkdir -p /Users/adityatx/adityatx/DrashtaCombined/worktrees")).toBe(true));
  it("plain mkdir (no flags)", () => expect(matchMkdir("mkdir build")).toBe(true));
  it("mkdir --parents long flag", () => expect(matchMkdir("mkdir --parents a/b/c")).toBe(true));
  it("mkdir -v verbose", () => expect(matchMkdir("mkdir -v out")).toBe(true));
  it("mkdir -p -v combined", () => expect(matchMkdir("mkdir -p -v a/b")).toBe(true));
  it("mkdir multiple paths", () => expect(matchMkdir("mkdir -p a b c")).toBe(true));
});

describe("matchMkdir — block", () => {
  it("bare mkdir (no path operand)", () => expect(matchMkdir("mkdir")).toBe(false));
  it("mkdir -p with no path", () => expect(matchMkdir("mkdir -p")).toBe(false));
  it("mkdir -m mode (permission-setting)", () => expect(matchMkdir("mkdir -m 777 x")).toBe(false));
  it("mkdir --mode long flag", () => expect(matchMkdir("mkdir --mode=700 x")).toBe(false));
  it("unknown flag (fail closed)", () => expect(matchMkdir("mkdir -Z x")).toBe(false));
  it("file redirection (write)", () => expect(matchMkdir("mkdir x > out.txt")).toBe(false));
  it("append redirection", () => expect(matchMkdir("mkdir x >> log")).toBe(false));
  it("chained ; (composition handles this)", () => expect(matchMkdir("mkdir -p tests; rm -rf /")).toBe(false));
  it("chained &&", () => expect(matchMkdir("mkdir x && rm y")).toBe(false));
  it("piped", () => expect(matchMkdir("mkdir x | sh")).toBe(false));
  it("command substitution", () => expect(matchMkdir("mkdir $(whoami)")).toBe(false));
  it("not mkdir", () => expect(matchMkdir("rmdir x")).toBe(false));
  it("empty", () => expect(matchMkdir("")).toBe(false));
});
