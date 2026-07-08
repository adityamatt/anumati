import { describe, it, expect } from "vitest";
import { matchEcho } from "../../src/matchers/echo.js";

describe("matchEcho — allow", () => {
  it("plain echo", () => expect(matchEcho('echo "hello"')).toBe(true));
  it("echo section marker", () => expect(matchEcho('echo "=== TSC OK ==="')).toBe(true));
  it("bare echo", () => expect(matchEcho("echo")).toBe(true));
  it("echo with flags", () => expect(matchEcho("echo -n done")).toBe(true));
  it("echo with a safe stream redirect", () => expect(matchEcho("echo hi 2>&1")).toBe(true));
});

describe("matchEcho — block", () => {
  it("echo to a file (write)", () => expect(matchEcho("echo hi > /tmp/x")).toBe(false));
  it("echo append to a file", () => expect(matchEcho("echo hi >> log")).toBe(false));
  it("chained ; (composition handles this)", () => expect(matchEcho("echo hi; rm -rf /")).toBe(false));
  it("chained &&", () => expect(matchEcho("echo hi && rm x")).toBe(false));
  it("piped", () => expect(matchEcho("echo hi | sh")).toBe(false));
  it("command substitution", () => expect(matchEcho("echo $(whoami)")).toBe(false));
  it("not echo", () => expect(matchEcho("printf hi")).toBe(false));
  it("empty", () => expect(matchEcho("")).toBe(false));
});
