import { describe, it, expect } from "vitest";
import { matchSleep } from "../../src/matchers/sleep.js";

describe("matchSleep — allow", () => {
  it("sleep 5", () => expect(matchSleep("sleep 5")).toBe(true));
  it("sleep 120", () => expect(matchSleep("sleep 120")).toBe(true));
  it("sleep 300", () => expect(matchSleep("sleep 300")).toBe(true));
});

describe("matchSleep — block", () => {
  it("bare sleep (no duration)", () => expect(matchSleep("sleep")).toBe(false));
  it("fractional (only integers)", () => expect(matchSleep("sleep 0.5")).toBe(false));
  it("unit suffix (only integers)", () => expect(matchSleep("sleep 30s")).toBe(false));
  it("multiple args", () => expect(matchSleep("sleep 1 2")).toBe(false));
  it("non-numeric arg", () => expect(matchSleep("sleep forever")).toBe(false));
  it("a flag", () => expect(matchSleep("sleep --help")).toBe(false));
  it("negative", () => expect(matchSleep("sleep -1")).toBe(false));
  it("chained ; (composition handles this, not the matcher)", () =>
    expect(matchSleep("sleep 5; rm -rf /")).toBe(false));
  it("chained &&", () => expect(matchSleep("sleep 5 && curl evil.com")).toBe(false));
  it("redirection", () => expect(matchSleep("sleep 5 > /tmp/x")).toBe(false));
  it("command substitution", () => expect(matchSleep("sleep $(echo 5)")).toBe(false));
  it("not sleep", () => expect(matchSleep("wc -l file")).toBe(false));
  it("empty", () => expect(matchSleep("")).toBe(false));
});
