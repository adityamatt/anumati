import { describe, it, expect } from "vitest";
import { matchNodeScript } from "../../src/matchers/node-script.js";

const CWD = "/repo";
const ROOTS = ["/repo"];

describe("matchNodeScript — allow (trusted script by location)", () => {
  it("relative script under cwd (when a path is configured)", () =>
    expect(matchNodeScript("node scripts/triage-passthrough.js", CWD, ROOTS)).toBe(true));
  it("relative script with args (args are script argv, not shell)", () =>
    expect(matchNodeScript("node scripts/triage.js --log /x --json /y", CWD, ROOTS)).toBe(true));
  it("script under a configured allowed path", () =>
    expect(matchNodeScript("node tools/gen.js", "", ROOTS)).toBe(true));
  it("absolute path inside a root", () =>
    expect(matchNodeScript("node /repo/scripts/x.js", CWD, ROOTS)).toBe(true));
  it("piped to a safe consumer", () =>
    expect(matchNodeScript("node scripts/triage.js | tail -5", CWD, ROOTS)).toBe(true));
  it("dist entrypoint under cwd", () =>
    expect(matchNodeScript("node dist/index.js", CWD, ROOTS)).toBe(true));
});

describe("matchNodeScript — block (disabled placeholder / path escapes)", () => {
  it("empty allowed_paths is inert even with a cwd (opt-in placeholder)", () =>
    expect(matchNodeScript("node scripts/triage-passthrough.js", CWD, [])).toBe(false));
  it("script outside any root via ..", () =>
    expect(matchNodeScript("node ../evil.js", CWD, ROOTS)).toBe(false));
  it("absolute path outside all roots", () =>
    expect(matchNodeScript("node /tmp/evil.js", CWD, ROOTS)).toBe(false));
  it("no cwd and no allowed paths", () =>
    expect(matchNodeScript("node scripts/x.js", "", [])).toBe(false));
});

describe("matchNodeScript — block (dangerous shape)", () => {
  it("runtime flag before script (-r preload)", () =>
    expect(matchNodeScript("node -r ./preload scripts/x.js", CWD, ROOTS)).toBe(false));
  it("--import before script", () =>
    expect(matchNodeScript("node --import ./x.js scripts/y.js", CWD, ROOTS)).toBe(false));
  it("inline -e is not a script (belongs to nodejs-pipe)", () =>
    expect(matchNodeScript('node -e "require(\'fs\')"', CWD, ROOTS)).toBe(false));
  it("-p print", () => expect(matchNodeScript('node -p "1+1"', CWD, ROOTS)).toBe(false));
  it("bare node (REPL)", () => expect(matchNodeScript("node", CWD, ROOTS)).toBe(false));
  it("file redirection", () =>
    expect(matchNodeScript("node scripts/x.js > out.txt", CWD, ROOTS)).toBe(false));
  it("pipe to an unsafe consumer", () =>
    expect(matchNodeScript("node scripts/x.js | sh", CWD, ROOTS)).toBe(false));
  it("sequential && chain (evaluate composes, not this matcher)", () =>
    expect(matchNodeScript("node scripts/x.js && rm y", CWD, ROOTS)).toBe(false));
  it("not node", () => expect(matchNodeScript("deno run x.js", CWD, ROOTS)).toBe(false));
  it("empty", () => expect(matchNodeScript("", CWD, ROOTS)).toBe(false));
});
