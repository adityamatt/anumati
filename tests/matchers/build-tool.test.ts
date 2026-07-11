import { describe, it, expect } from "vitest";
import { matchBuildTool } from "../../src/matchers/build-tool.js";

describe("matchBuildTool — allow (one-shot build)", () => {
  it("npx vite build", () => expect(matchBuildTool("npx vite build")).toBe(true));
  it("npx vite build 2>&1 | tail -4", () => expect(matchBuildTool("npx vite build 2>&1 | tail -4")).toBe(true));
  it("direct vite build", () => expect(matchBuildTool("vite build")).toBe(true));
  it("cd && npx vite build", () => expect(matchBuildTool("cd app && npx vite build")).toBe(true));
  it("next build", () => expect(matchBuildTool("npx next build")).toBe(true));
  it("webpack (builds by default)", () => expect(matchBuildTool("webpack")).toBe(true));
  it("webpack with flags", () => expect(matchBuildTool("npx webpack --mode production")).toBe(true));
  it("rollup -c", () => expect(matchBuildTool("rollup -c")).toBe(true));
  it("esbuild bundle", () => expect(matchBuildTool("esbuild src/x.ts --bundle")).toBe(true));
  // Real passthrough-log shapes (triage npx examples) — the exact safe subset
  // build-tool must admit so `npx vite build` stops falling through.
  it("npx vite build 2>&1 | tail -15", () => expect(matchBuildTool("npx vite build 2>&1 | tail -15")).toBe(true));
  it("npx vite build 2>&1 | tail -3", () => expect(matchBuildTool("npx vite build 2>&1 | tail -3")).toBe(true));
  it("npx vite build 2>&1 | tail -2", () => expect(matchBuildTool("npx vite build 2>&1 | tail -2")).toBe(true));
});

describe("matchBuildTool — block long-running / server modes", () => {
  it("bare vite (dev server)", () => expect(matchBuildTool("npx vite")).toBe(false));
  it("vite dev", () => expect(matchBuildTool("npx vite dev")).toBe(false));
  it("vite serve", () => expect(matchBuildTool("vite serve")).toBe(false));
  it("vite preview", () => expect(matchBuildTool("vite preview")).toBe(false));
  it("vite build --watch (rebuilds forever)", () => expect(matchBuildTool("npx vite build --watch")).toBe(false));
  it("next dev", () => expect(matchBuildTool("next dev")).toBe(false));
  it("webpack --watch", () => expect(matchBuildTool("webpack --watch")).toBe(false));
  it("webpack -w", () => expect(matchBuildTool("webpack -w")).toBe(false));
  it("webpack serve", () => expect(matchBuildTool("webpack serve")).toBe(false));
  it("rollup -c --watch", () => expect(matchBuildTool("rollup -c --watch")).toBe(false));
});

describe("matchBuildTool — block other shapes", () => {
  it("bare next (no build subcommand)", () => expect(matchBuildTool("next")).toBe(false));
  it("file redirection", () => expect(matchBuildTool("npx vite build > out.log")).toBe(false));
  it("chained command", () => expect(matchBuildTool("npx vite build && rm -rf /")).toBe(false));
  it("pipe to unsafe target", () => expect(matchBuildTool("npx vite build | sh")).toBe(false));
  it("not a build tool", () => expect(matchBuildTool("npx eslint .")).toBe(false));
  it("command substitution", () => expect(matchBuildTool("npx vite build $(echo x)")).toBe(false));
  it("empty", () => expect(matchBuildTool("")).toBe(false));
});
