import { describe, it, expect } from "vitest";
import { matchCd } from "../../src/matchers/cd.js";

const CWD = "/Users/aditya/project";

describe("matchCd — allow", () => {
  it("cd into cwd itself (absolute)", () =>
    expect(matchCd("cd /Users/aditya/project", CWD)).toBe(true));

  it("cd into a subfolder (absolute)", () =>
    expect(matchCd("cd /Users/aditya/project/src/lib", CWD)).toBe(true));

  it("cd into a subfolder (relative)", () =>
    expect(matchCd("cd src/lib", CWD)).toBe(true));

  it("cd . (current dir)", () =>
    expect(matchCd("cd .", CWD)).toBe(true));

  it("cd ./src", () =>
    expect(matchCd("cd ./src", CWD)).toBe(true));

  it("relative path with .. that stays inside cwd", () =>
    expect(matchCd("cd src/../lib", CWD)).toBe(true));
});

describe("matchCd — block", () => {
  it("bare cd (goes home)", () =>
    expect(matchCd("cd", CWD)).toBe(false));

  it("cd .. (escapes cwd)", () =>
    expect(matchCd("cd ..", CWD)).toBe(false));

  it("cd to an unrelated absolute path", () =>
    expect(matchCd("cd /etc", CWD)).toBe(false));

  it("cd to a prefix-sibling of cwd", () =>
    expect(matchCd("cd /Users/aditya/project-evil", CWD)).toBe(false));

  it("relative .. that escapes cwd", () =>
    expect(matchCd("cd ../other", CWD)).toBe(false));

  it("cd with extra args", () =>
    expect(matchCd("cd a b", CWD)).toBe(false));

  it("cd chained with another command", () =>
    expect(matchCd("cd src && ls", CWD)).toBe(false));

  it("cd chained with ;", () =>
    expect(matchCd("cd src; rm -rf .", CWD)).toBe(false));

  it("cd with redirection", () =>
    expect(matchCd("cd src > out", CWD)).toBe(false));

  it("not a cd command", () =>
    expect(matchCd("ls src", CWD)).toBe(false));

  it("empty cwd", () =>
    expect(matchCd("cd src", "")).toBe(false));

  it("empty command", () =>
    expect(matchCd("", CWD)).toBe(false));

  it("command substitution blocked by parser", () =>
    expect(matchCd("cd $(echo /etc)", CWD)).toBe(false));
});

describe("matchCd — allowed_paths (configured roots)", () => {
  const EXTRA = ["/Users/aditya/DrashtaCombined/drashta"];

  it("cd into a configured root itself", () =>
    expect(matchCd("cd /Users/aditya/DrashtaCombined/drashta", CWD, EXTRA)).toBe(true));

  it("cd into a subfolder of a configured root", () =>
    expect(matchCd("cd /Users/aditya/DrashtaCombined/drashta/src/DrashtaCDK", CWD, EXTRA)).toBe(true));

  it("cwd still works when allowed_paths is set", () =>
    expect(matchCd("cd /Users/aditya/project/src", CWD, EXTRA)).toBe(true));

  it("still blocks paths outside both cwd and configured roots", () =>
    expect(matchCd("cd /etc", CWD, EXTRA)).toBe(false));

  it("still blocks a prefix-sibling of a configured root", () =>
    expect(matchCd("cd /Users/aditya/DrashtaCombined/drashta-evil", CWD, EXTRA)).toBe(false));

  it("works with empty cwd when a configured root matches (absolute)", () =>
    expect(matchCd("cd /Users/aditya/DrashtaCombined/drashta/src", "", EXTRA)).toBe(true));

  it("multiple configured roots", () =>
    expect(matchCd("cd /srv/repo-b/pkg", CWD, ["/srv/repo-a", "/srv/repo-b"])).toBe(true));
});
