import { describe, it, expect } from "vitest";
import { matchEslint } from "../../src/matchers/eslint.js";

describe("matchEslint — allow (read-only lint)", () => {
  it("npx eslint <path>", () =>
    expect(matchEslint("npx eslint src/index.ts")).toBe(true));

  it("direct eslint <path>", () =>
    expect(matchEslint("eslint lib/query/run-file.Handler.ts")).toBe(true));

  it("eslint with multiple paths", () =>
    expect(matchEslint("npx eslint src/a.ts src/b.ts src/c.ts")).toBe(true));

  it("eslint . (whole project)", () =>
    expect(matchEslint("npx eslint .")).toBe(true));

  it("eslint with report/select flags", () =>
    expect(matchEslint("npx eslint src --ext .ts,.tsx --max-warnings 0 --format json")).toBe(true));

  it("cd <dir> && npx eslint ...", () =>
    expect(
      matchEslint("cd /Users/a/DrashtaCombined/drashta/src/DrashtaCDK && npx eslint lib/query/run-file.Handler.ts"),
    ).toBe(true));

  it("eslint ... 2>&1 | head", () =>
    expect(matchEslint("npx eslint src 2>&1 | head")).toBe(true));

  it("eslint ... | grep error", () =>
    expect(matchEslint("eslint src | grep error")).toBe(true));
});

describe("matchEslint — block (writes / unsafe shapes)", () => {
  it("--fix blocked by default (rewrites source)", () =>
    expect(matchEslint("npx eslint src --fix")).toBe(false));

  it("--fix-dry-run blocked by default", () =>
    expect(matchEslint("npx eslint . --fix-dry-run")).toBe(false));

  it("--init (scaffolds a config file)", () =>
    expect(matchEslint("npx eslint --init")).toBe(false));

  it("file redirection", () =>
    expect(matchEslint("npx eslint src > out.txt")).toBe(false));

  it("chained with a non-cd command", () =>
    expect(matchEslint("npx eslint src && rm -rf /")).toBe(false));

  it("; separator", () =>
    expect(matchEslint("npx eslint src; rm x")).toBe(false));

  it("|| operator", () =>
    expect(matchEslint("npx eslint src || echo fail")).toBe(false));

  it("pipe to a non-safe target", () =>
    expect(matchEslint("npx eslint src | sh")).toBe(false));

  it("command substitution", () =>
    expect(matchEslint("npx eslint $(cat targets.txt)")).toBe(false));

  it("not eslint", () =>
    expect(matchEslint("npx prettier --write .")).toBe(false));

  it("empty", () => expect(matchEslint("")).toBe(false));
});

describe("matchEslint — allow_write opt-in", () => {
  it("--fix allowed when allowWrite=true", () =>
    expect(matchEslint("npx eslint src --fix", true)).toBe(true));

  it("--fix-dry-run allowed when allowWrite=true", () =>
    expect(matchEslint("npx eslint . --fix-dry-run", true)).toBe(true));

  it("cd && eslint --fix allowed when allowWrite=true", () =>
    expect(matchEslint("cd /Users/a/repo && npx eslint src --fix 2>&1 | tail", true)).toBe(true));

  it("plain lint still allowed when allowWrite=true", () =>
    expect(matchEslint("npx eslint src", true)).toBe(true));

  it("--init STILL blocked even when allowWrite=true (scaffolder, not a fix)", () =>
    expect(matchEslint("npx eslint --init", true)).toBe(false));

  it("--fix still rejects an unsafe pipe target even with allowWrite=true", () =>
    expect(matchEslint("npx eslint src --fix | sh", true)).toBe(false));
});
