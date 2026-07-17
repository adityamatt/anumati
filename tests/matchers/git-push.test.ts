import { describe, it, expect } from "vitest";
import { matchGitPush } from "../../src/matchers/git-push.js";

describe("matchGitPush — allow (bounded safe push)", () => {
  it("push branch to origin", () => expect(matchGitPush("git push origin feature-x")).toBe(true));
  it("push -u origin branch", () => expect(matchGitPush("git push -u origin feature-x")).toBe(true));
  it("push --set-upstream origin branch", () => expect(matchGitPush("git push --set-upstream origin feature-x")).toBe(true));
  it("push -q origin branch", () => expect(matchGitPush("git push -q origin feature-x")).toBe(true));
  it("push a slashed branch name", () => expect(matchGitPush("git push -u origin anumati-triage/20260712-101500")).toBe(true));
  it("push to an explicitly allowed remote", () =>
    expect(matchGitPush("git push upstream feature-x", ["origin", "upstream"])).toBe(true));
  it("refs/heads/ prefixed non-protected branch", () =>
    expect(matchGitPush("git push origin refs/heads/feature-x")).toBe(true));
});

describe("matchGitPush — block (force / destructive / bulk)", () => {
  it("--force", () => expect(matchGitPush("git push --force origin feature-x")).toBe(false));
  it("-f", () => expect(matchGitPush("git push -f origin feature-x")).toBe(false));
  it("--force-with-lease", () => expect(matchGitPush("git push --force-with-lease origin feature-x")).toBe(false));
  it("+refspec (force spelled as refspec)", () => expect(matchGitPush("git push origin +feature-x")).toBe(false));
  it("--delete", () => expect(matchGitPush("git push --delete origin feature-x")).toBe(false));
  it("-d", () => expect(matchGitPush("git push -d origin feature-x")).toBe(false));
  it("--all", () => expect(matchGitPush("git push --all origin")).toBe(false));
  it("--mirror", () => expect(matchGitPush("git push --mirror origin")).toBe(false));
  it("--tags", () => expect(matchGitPush("git push --tags origin")).toBe(false));
  it("--prune", () => expect(matchGitPush("git push --prune origin feature-x")).toBe(false));
  it("--no-verify (hook bypass)", () => expect(matchGitPush("git push --no-verify origin feature-x")).toBe(false));
});

describe("matchGitPush — block (protected targets)", () => {
  it("push to main", () => expect(matchGitPush("git push origin main")).toBe(false));
  it("push to master", () => expect(matchGitPush("git push origin master")).toBe(false));
  it("push src:main refspec", () => expect(matchGitPush("git push origin feature-x:main")).toBe(false));
  it("push refs/heads/main", () => expect(matchGitPush("git push origin refs/heads/main")).toBe(false));
  it("custom protected branch", () =>
    expect(matchGitPush("git push origin develop", ["origin"], ["develop"])).toBe(false));
  it("built-in protection cannot be shrunk by an empty protected list", () =>
    expect(matchGitPush("git push origin main", ["origin"], [])).toBe(false));
});

describe("matchGitPush — block (shape)", () => {
  it("bare git push (target unknown)", () => expect(matchGitPush("git push")).toBe(false));
  it("git push origin (no branch)", () => expect(matchGitPush("git push origin")).toBe(false));
  it("unknown remote", () => expect(matchGitPush("git push evil feature-x")).toBe(false));
  it("three positionals (multi-refspec)", () => expect(matchGitPush("git push origin a b")).toBe(false));
  it("unknown flag fails closed", () => expect(matchGitPush("git push --frobnicate origin feature-x")).toBe(false));
  it("not a push", () => expect(matchGitPush("git commit -m x")).toBe(false));
  it("chained && is not a single command", () => expect(matchGitPush("git push origin x && rm y")).toBe(false));
  it("file redirection", () => expect(matchGitPush("git push origin feature-x > out.txt")).toBe(false));
  it("empty", () => expect(matchGitPush("")).toBe(false));
});
