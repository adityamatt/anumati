import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join } from "path";
import {
  anumatiHome,
  legacyHome,
  resolvePreferred,
  defaultConfigPath,
  projectConfigPath,
} from "../src/config.js";

describe("home helpers", () => {
  it("anumatiHome is ~/.anumati", () => {
    expect(anumatiHome()).toBe(join(homedir(), ".anumati"));
  });
  it("legacyHome is ~/.claude", () => {
    expect(legacyHome()).toBe(join(homedir(), ".claude"));
  });
});

describe("resolvePreferred", () => {
  const A = "/home/u/.anumati/permissions.json";
  const C = "/home/u/.claude/permissions.json";

  it("returns the first candidate when it exists (prefer new)", () => {
    expect(resolvePreferred([A, C], (p) => p === A || p === C)).toBe(A);
  });

  it("falls back to the legacy candidate when only it exists", () => {
    expect(resolvePreferred([A, C], (p) => p === C)).toBe(C);
  });

  it("defaults to the first candidate (canonical) when nothing exists", () => {
    expect(resolvePreferred([A, C], () => false)).toBe(A);
  });

  it("prefers the first even when both exist", () => {
    expect(resolvePreferred([A, C], () => true)).toBe(A);
  });
});

describe("path builders resolve to one of the candidates", () => {
  it("defaultConfigPath is the .anumati or legacy .claude permissions.json", () => {
    const p = defaultConfigPath();
    expect([
      join(anumatiHome(), "permissions.json"),
      join(legacyHome(), "permissions.json"),
    ]).toContain(p);
  });

  it("projectConfigPath is the cwd's .anumati or .claude permissions.json", () => {
    const cwd = "/tmp/proj";
    const p = projectConfigPath(cwd);
    expect([
      join(cwd, ".anumati", "permissions.json"),
      join(cwd, ".claude", "permissions.json"),
    ]).toContain(p);
  });
});
