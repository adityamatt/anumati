import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MATCHERS, MATCHER_NAMES } from "../../src/matchers/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "../../src/matchers/index.ts"), "utf-8");

// The names the matchNamed() switch actually dispatches on — every `case "x":`.
function switchCases(): string[] {
  const cases: string[] = [];
  const re = /case\s+"([^"]+)":/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexSrc)) !== null) cases.push(m[1]);
  return cases;
}

describe("matcher registry", () => {
  it("has no duplicate names", () => {
    expect(new Set(MATCHER_NAMES).size).toBe(MATCHER_NAMES.length);
  });

  it("every entry has a non-empty name and description", () => {
    for (const m of MATCHERS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.desc.trim().length).toBeGreaterThan(0);
    }
  });

  // The core invariant: the catalog and the dispatch switch must not drift. If
  // this fails, a matcher was added to one but not the other.
  it("matches the matchNamed() switch cases exactly", () => {
    const cases = switchCases();
    expect([...cases].sort()).toEqual([...MATCHER_NAMES].sort());
  });
});
