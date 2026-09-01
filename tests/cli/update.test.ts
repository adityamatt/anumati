import { describe, it, expect } from "vitest";
import { compareSemver, planUpdate } from "../../src/cli/update.js";

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0); // numeric, not lexical
    expect(compareSemver("1.2.3", "1.2.2")).toBeGreaterThan(0);
    expect(compareSemver("0.3.0", "0.3.0")).toBe(0);
  });

  it("ignores prerelease/build suffixes (compares numeric core)", () => {
    expect(compareSemver("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3+build", "1.2.3")).toBe(0);
  });

  it("treats non-numeric / missing parts as 0 (unknown reads as oldest)", () => {
    expect(compareSemver("unknown", "0.0.1")).toBeLessThan(0);
    expect(compareSemver("1", "1.0.0")).toBe(0);
  });
});

describe("planUpdate", () => {
  const base = { checkOnly: false, isSource: false, force: false };

  it("installs when a newer version is available", () => {
    expect(planUpdate({ ...base, current: "0.3.0", latest: "0.4.0" })).toEqual({
      action: "update-available",
      shouldInstall: true,
    });
  });

  it("does not install under --check, but still reports availability", () => {
    expect(planUpdate({ ...base, checkOnly: true, current: "0.3.0", latest: "0.4.0" })).toEqual({
      action: "update-available",
      shouldInstall: false,
    });
  });

  it("is a no-op when already at (or ahead of) latest", () => {
    expect(planUpdate({ ...base, current: "0.4.0", latest: "0.4.0" }).action).toBe("up-to-date");
    expect(planUpdate({ ...base, current: "0.5.0", latest: "0.4.0" }).action).toBe("up-to-date");
    expect(planUpdate({ ...base, current: "0.4.0", latest: "0.4.0" }).shouldInstall).toBe(false);
  });

  it("reports unknown-latest (never installs) when latest couldn't be fetched", () => {
    expect(planUpdate({ ...base, current: "0.3.0", latest: null })).toEqual({
      action: "unknown-latest",
      shouldInstall: false,
    });
  });

  it("refuses in a source checkout unless forced — even when newer exists", () => {
    expect(planUpdate({ ...base, isSource: true, current: "0.3.0", latest: "0.9.0" })).toEqual({
      action: "source-checkout",
      shouldInstall: false,
    });
  });

  it("with --force, a source checkout proceeds like a normal install", () => {
    expect(planUpdate({ ...base, isSource: true, force: true, current: "0.3.0", latest: "0.4.0" })).toEqual({
      action: "update-available",
      shouldInstall: true,
    });
  });

  it("lets --check report from a source checkout (read-only, never installs)", () => {
    expect(planUpdate({ ...base, isSource: true, checkOnly: true, current: "0.3.0", latest: "0.4.0" })).toEqual({
      action: "update-available",
      shouldInstall: false,
    });
    expect(
      planUpdate({ ...base, isSource: true, checkOnly: true, current: "0.4.0", latest: "0.4.0" }).action,
    ).toBe("up-to-date");
  });

  it("source-checkout guard is checked before latest availability", () => {
    // isSource wins even if latest is unknown — we short-circuit to guidance.
    expect(planUpdate({ ...base, isSource: true, current: "0.3.0", latest: null }).action).toBe(
      "source-checkout",
    );
  });
});
