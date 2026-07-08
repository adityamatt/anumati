import { describe, it, expect } from "vitest";
import { matchGitWrite } from "../../src/matchers/git-write.js";

const OPS = ["add", "commit", "branch", "checkout", "switch", "stash", "restore", "merge", "tag", "mv"];

describe("matchGitWrite — allow (listed, non-destructive)", () => {
  it("git add .", () => expect(matchGitWrite("git add .", OPS)).toBe(true));
  it("git add -A", () => expect(matchGitWrite("git add -A", OPS)).toBe(true));
  it("git commit -m msg", () => expect(matchGitWrite('git commit -m "msg"', OPS)).toBe(true));
  it("git branch new-branch (create)", () => expect(matchGitWrite("git branch feature-x", OPS)).toBe(true));
  it("git checkout -b (create+switch)", () => expect(matchGitWrite("git checkout -b feature-x", OPS)).toBe(true));
  it("git switch -c", () => expect(matchGitWrite("git switch -c feature-x", OPS)).toBe(true));
  it("git stash", () => expect(matchGitWrite("git stash", OPS)).toBe(true));
  it("git restore file", () => expect(matchGitWrite("git restore src/x.ts", OPS)).toBe(true));
  it("git merge --ff-only", () => expect(matchGitWrite("git merge --ff-only main", OPS)).toBe(true));
});

describe("matchGitWrite — allowlist gating", () => {
  it("blocks an op not in the allowlist", () => expect(matchGitWrite("git commit -m x", ["add"])).toBe(false));
  it("allows once added to the allowlist", () => expect(matchGitWrite("git commit -m x", ["add", "commit"])).toBe(true));
  it("blocks everything with an empty allowlist", () => expect(matchGitWrite("git add .", [])).toBe(false));
});

describe("matchGitWrite — hard-block network ops (even if listed)", () => {
  const withNet = [...OPS, "push", "pull", "fetch", "clone", "remote"];
  it("git push", () => expect(matchGitWrite("git push", withNet)).toBe(false));
  it("git push --force", () => expect(matchGitWrite("git push --force origin main", withNet)).toBe(false));
  it("git pull", () => expect(matchGitWrite("git pull", withNet)).toBe(false));
  it("git fetch", () => expect(matchGitWrite("git fetch origin", withNet)).toBe(false));
  it("git clone", () => expect(matchGitWrite("git clone https://x/y", withNet)).toBe(false));
});

describe("matchGitWrite — hard-block destructive ops (even if listed)", () => {
  const withDestr = [...OPS, "reset", "rebase", "clean", "gc"];
  it("git reset --hard", () => expect(matchGitWrite("git reset --hard HEAD", withDestr)).toBe(false));
  it("git reset HEAD~1", () => expect(matchGitWrite("git reset HEAD~1", withDestr)).toBe(false));
  it("git rebase", () => expect(matchGitWrite("git rebase main", withDestr)).toBe(false));
  it("git clean -fd", () => expect(matchGitWrite("git clean -fd", withDestr)).toBe(false));
});

describe("matchGitWrite — block dangerous flag forms", () => {
  it("git commit --amend (rewrites history)", () => expect(matchGitWrite("git commit --amend", OPS)).toBe(false));
  it("git branch -D (delete)", () => expect(matchGitWrite("git branch -D feature-x", OPS)).toBe(false));
  it("git branch -d (delete)", () => expect(matchGitWrite("git branch -d feature-x", OPS)).toBe(false));
  it("git checkout -f (force)", () => expect(matchGitWrite("git checkout -f", OPS)).toBe(false));
  it("git switch --discard-changes", () => expect(matchGitWrite("git switch --discard-changes main", OPS)).toBe(false));
});

describe("matchGitWrite — worktree (add only)", () => {
  const withWt = [...OPS, "worktree"];
  it("allows git worktree add", () => expect(matchGitWrite("git worktree add ../x feature", withWt)).toBe(true));
  it("allows git worktree add -b", () => expect(matchGitWrite("git worktree add -b new ../x", withWt)).toBe(true));
  it("blocks git worktree remove", () => expect(matchGitWrite("git worktree remove ../x", withWt)).toBe(false));
  it("blocks git worktree prune", () => expect(matchGitWrite("git worktree prune", withWt)).toBe(false));
  it("blocks git worktree move", () => expect(matchGitWrite("git worktree move ../x ../y", withWt)).toBe(false));
  it("blocks worktree when not allowlisted", () => expect(matchGitWrite("git worktree add ../x", OPS)).toBe(false));
});

describe("matchGitWrite — block dangerous shapes", () => {
  it("not git", () => expect(matchGitWrite("npm publish", OPS)).toBe(false));
  it("git with no subcommand", () => expect(matchGitWrite("git", OPS)).toBe(false));
  it("-c config injection", () => expect(matchGitWrite("git -c user.email=x commit -m y", OPS)).toBe(false));
  it("file redirection", () => expect(matchGitWrite("git add . > out", OPS)).toBe(false));
  it("chained (single-command only; composition handles chaining)", () =>
    expect(matchGitWrite("git add . && git commit -m x", OPS)).toBe(false));
  it("command substitution", () => expect(matchGitWrite("git commit -m $(whoami)", OPS)).toBe(false));
  it("empty", () => expect(matchGitWrite("", OPS)).toBe(false));
});
