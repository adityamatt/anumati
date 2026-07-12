import { describe, it, expect } from "vitest";
import { matchNodeScript } from "../../src/matchers/node-script.js";

const CWD = "/repo";
const ROOTS = ["/repo"];

describe("matchNodeScript — allow (trusted script by location)", () => {
  it("relative script under cwd", () =>
    expect(matchNodeScript("node scripts/triage-passthrough.js", CWD)).toBe(true));
  it("relative script with args (args are script argv, not shell)", () =>
    expect(matchNodeScript("node scripts/triage.js --log /x --json /y", CWD)).toBe(true));
  it("script under a configured allowed path", () =>
    expect(matchNodeScript("node tools/gen.js", "", ROOTS)).toBe(true));
  it("absolute path inside a root", () =>
    expect(matchNodeScript("node /repo/scripts/x.js", CWD)).toBe(true));
  it("piped to a safe consumer", () =>
    expect(matchNodeScript("node scripts/triage.js | tail -5", CWD)).toBe(true));
  it("dist entrypoint under cwd", () =>
    expect(matchNodeScript("node dist/index.js", CWD)).toBe(true));
});

describe("matchNodeScript — block (path escapes / no root)", () => {
  it("script outside any root via ..", () =>
    expect(matchNodeScript("node ../evil.js", CWD)).toBe(false));
  it("absolute path outside all roots", () =>
    expect(matchNodeScript("node /tmp/evil.js", CWD)).toBe(false));
  it("no cwd and no allowed paths", () =>
    expect(matchNodeScript("node scripts/x.js", "", [])).toBe(false));
});

describe("matchNodeScript — block (dangerous shape)", () => {
  it("runtime flag before script (-r preload)", () =>
    expect(matchNodeScript("node -r ./preload scripts/x.js", CWD)).toBe(false));
  it("--import before script", () =>
    expect(matchNodeScript("node --import ./x.js scripts/y.js", CWD)).toBe(false));
  it("inline -e is not a script (belongs to nodejs-pipe)", () =>
    expect(matchNodeScript('node -e "require(\'fs\')"', CWD)).toBe(false));
  it("-p print", () => expect(matchNodeScript('node -p "1+1"', CWD)).toBe(false));
  it("bare node (REPL)", () => expect(matchNodeScript("node", CWD)).toBe(false));
  it("file redirection", () =>
    expect(matchNodeScript("node scripts/x.js > out.txt", CWD)).toBe(false));
  it("pipe to an unsafe consumer", () =>
    expect(matchNodeScript("node scripts/x.js | sh", CWD)).toBe(false));
  it("sequential && chain (evaluate composes, not this matcher)", () =>
    expect(matchNodeScript("node scripts/x.js && rm y", CWD)).toBe(false));
  it("not node", () => expect(matchNodeScript("deno run x.js", CWD)).toBe(false));
  it("empty", () => expect(matchNodeScript("", CWD)).toBe(false));
});
