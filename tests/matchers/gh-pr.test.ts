import { describe, it, expect } from "vitest";
import { matchGhPr } from "../../src/matchers/gh-pr.js";

describe("matchGhPr — allow (non-destructive pr subcommands)", () => {
  it("pr create", () => expect(matchGhPr('gh pr create --base main --title "x" --body "y"')).toBe(true));
  it("pr create with fill", () => expect(matchGhPr("gh pr create --fill")).toBe(true));
  it("pr edit", () => expect(matchGhPr('gh pr edit 1 --add-label bug')).toBe(true));
  it("pr comment", () => expect(matchGhPr('gh pr comment 1 --body "note"')).toBe(true));
  it("pr ready", () => expect(matchGhPr("gh pr ready 1")).toBe(true));
  it("pr view", () => expect(matchGhPr("gh pr view 1")).toBe(true));
  it("pr list", () => expect(matchGhPr("gh pr list")).toBe(true));
  it("pr status", () => expect(matchGhPr("gh pr status")).toBe(true));
  it("pr diff", () => expect(matchGhPr("gh pr diff 1")).toBe(true));
  it("pr checks", () => expect(matchGhPr("gh pr checks 1")).toBe(true));
});

describe("matchGhPr — block (state-mutating pr subcommands)", () => {
  it("pr merge", () => expect(matchGhPr("gh pr merge 1 --squash")).toBe(false));
  it("pr close", () => expect(matchGhPr("gh pr close 1")).toBe(false));
  it("pr reopen", () => expect(matchGhPr("gh pr reopen 1")).toBe(false));
  it("pr review", () => expect(matchGhPr("gh pr review 1 --approve")).toBe(false));
  it("pr lock", () => expect(matchGhPr("gh pr lock 1")).toBe(false));
  it("pr delete-branch is not in the safe set", () => expect(matchGhPr("gh pr delete 1")).toBe(false));
});

describe("matchGhPr — block (shape / scope)", () => {
  it("no subcommand", () => expect(matchGhPr("gh pr")).toBe(false));
  it("flag where subcommand expected", () => expect(matchGhPr("gh pr --help")).toBe(false));
  it("gh api (belongs to the read-only gh matcher)", () =>
    expect(matchGhPr("gh api repos/o/r/pulls")).toBe(false));
  it("gh release create (out of scope)", () => expect(matchGhPr("gh release create v1")).toBe(false));
  it("gh repo delete (out of scope)", () => expect(matchGhPr("gh repo delete o/r")).toBe(false));
  it("unknown pr subcommand fails closed", () => expect(matchGhPr("gh pr frobnicate")).toBe(false));
  it("chained && is not a single command", () =>
    expect(matchGhPr("gh pr create --fill && gh pr merge 1")).toBe(false));
  it("file redirection", () => expect(matchGhPr("gh pr view 1 > out.txt")).toBe(false));
  it("not gh", () => expect(matchGhPr("git pr create")).toBe(false));
  it("empty", () => expect(matchGhPr("")).toBe(false));
});
