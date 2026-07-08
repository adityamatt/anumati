import { describe, it, expect } from "vitest";
import { matchTestRunner } from "../../src/matchers/test-runner.js";

describe("matchTestRunner — pytest", () => {
  it("bare pytest", () => expect(matchTestRunner("pytest")).toBe(true));
  it("pytest with path + flags", () => expect(matchTestRunner("pytest tests/ -v")).toBe(true));
  it("python -m pytest", () => expect(matchTestRunner("python -m pytest")).toBe(true));
  it("python3 -m pytest path", () => expect(matchTestRunner("python3 -m pytest tests/test_x.py")).toBe(true));
  it("cd && pytest", () => expect(matchTestRunner("cd /proj && pytest tests/")).toBe(true));
  it("pytest | tail", () => expect(matchTestRunner("pytest -q | tail -20")).toBe(true));
});

describe("matchTestRunner — jest", () => {
  it("bare jest", () => expect(matchTestRunner("jest")).toBe(true));
  it("npx jest", () => expect(matchTestRunner("npx jest")).toBe(true));
  it("npx jest --coverage", () => expect(matchTestRunner("npx jest --coverage")).toBe(true));
  it("jest with a path", () => expect(matchTestRunner("jest src/foo.test.js")).toBe(true));
});

describe("matchTestRunner — block", () => {
  it("jest --watch (hangs)", () => expect(matchTestRunner("jest --watch")).toBe(false));
  it("jest --watchAll", () => expect(matchTestRunner("npx jest --watchAll")).toBe(false));
  it("jest -u (updates snapshots)", () => expect(matchTestRunner("npx jest -u")).toBe(false));
  it("pytest --watch", () => expect(matchTestRunner("pytest --watch")).toBe(false));
  it("file redirection", () => expect(matchTestRunner("pytest > out.log")).toBe(false));
  it("chained bad command", () => expect(matchTestRunner("pytest && rm -rf /")).toBe(false));
  it("pipe to unsafe target", () => expect(matchTestRunner("pytest | sh")).toBe(false));
  it("cd with extra args", () => expect(matchTestRunner("cd a b && pytest")).toBe(false));
  it("command substitution", () => expect(matchTestRunner("pytest $(echo tests)")).toBe(false));
  it("not a test runner", () => expect(matchTestRunner("python script.py")).toBe(false));
  it("python -m something-else", () => expect(matchTestRunner("python -m http.server")).toBe(false));
  it("empty", () => expect(matchTestRunner("")).toBe(false));
});
