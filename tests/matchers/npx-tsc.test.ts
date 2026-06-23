import { describe, it, expect } from "vitest";
import { matchNpxTsc } from "../../src/matchers/npx-tsc.js";

describe("matchNpxTsc — allowed", () => {
  it("matches npx tsc --noEmit", () => expect(matchNpxTsc("npx tsc --noEmit")).toBe(true));
  it("matches with extra flags", () => expect(matchNpxTsc("npx tsc --noEmit --strict")).toBe(true));
  it("matches cd dir && npx tsc --noEmit", () => expect(matchNpxTsc("cd /project && npx tsc --noEmit")).toBe(true));
});

describe("matchNpxTsc — blocked", () => {
  it("blocks npx tsc without --noEmit", () => expect(matchNpxTsc("npx tsc")).toBe(false));
  it("blocks npx tsc chained with dangerous command", () => expect(matchNpxTsc("npx tsc --noEmit && rm -rf /")).toBe(false));
  it("blocks three segments", () => expect(matchNpxTsc("cd /a && cd /b && npx tsc --noEmit")).toBe(false));
  it("blocks different npx tool", () => expect(matchNpxTsc("npx eslint .")).toBe(false));
  it("blocks dangerous chars", () => expect(matchNpxTsc("npx tsc --noEmit $EXTRA")).toBe(false));
});
