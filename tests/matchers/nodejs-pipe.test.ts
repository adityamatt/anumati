import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { matchNodejsPipe } from "../../src/matchers/nodejs-pipe.js";

describe("matchNodejsPipe — allowed", () => {
  it("node -e with a listed module", () => {
    expect(matchNodejsPipe(`node -e "const {join}=require('path'); console.log(join('a','b'))"`, ["path"])).toBe(true);
  });

  it("node --eval long form", () => {
    expect(matchNodejsPipe(`node --eval "console.log(require('crypto').randomUUID())"`, ["crypto"])).toBe(true);
  });

  it("node -p print form", () => {
    expect(matchNodejsPipe(`node -p "1 + 1"`, [])).toBe(true);
  });

  it("node -e with no modules", () => {
    expect(matchNodejsPipe(`node -e "console.log('hello')"`, [])).toBe(true);
  });

  it("static import in -e", () => {
    expect(matchNodejsPipe(`node -e "import { join } from 'path'; console.log(join('a'))"`, ["path"])).toBe(true);
  });

  it("pipe chain: grep | node -e", () => {
    expect(matchNodejsPipe(`grep foo f.txt | node -e "console.log(1)"`, [])).toBe(true);
  });

  it("node -e | grep", () => {
    expect(matchNodejsPipe(`node -e "console.log('x')" | grep x`, [])).toBe(true);
  });

  it("which node && node -e", () => {
    expect(matchNodejsPipe(`which node && node -e "console.log(1)"`, [])).toBe(true);
  });

  it("node -e || echo fallback", () => {
    expect(matchNodejsPipe(`node -e "console.log(1)" || echo failed`, [])).toBe(true);
  });
});

describe("matchNodejsPipe — rejected", () => {
  it("rejects an unlisted module", () => {
    expect(matchNodejsPipe(`node -e "require('crypto')"`, ["path"])).toBe(false);
  });

  it("rejects an ALWAYS_BLOCKED module even if listed", () => {
    expect(matchNodejsPipe(`node -e "require('fs')"`, ["fs"])).toBe(false);
  });

  it("rejects node:child_process", () => {
    expect(matchNodejsPipe(`node -e "require('node:child_process')"`, ["child_process"])).toBe(false);
  });

  it("rejects eval()", () => {
    expect(matchNodejsPipe(`node -e "eval('1+1')"`, [])).toBe(false);
  });

  it("rejects Function constructor", () => {
    expect(matchNodejsPipe(`node -e "Function('return 1')()"`, [])).toBe(false);
  });

  it("rejects dynamic require", () => {
    expect(matchNodejsPipe(`node -e "require(process.argv[2])"`, [])).toBe(false);
  });

  it("rejects && chained non-node command", () => {
    expect(matchNodejsPipe(`node -e "console.log(1)" && rm -rf /`, [])).toBe(false);
  });

  it("rejects node with no -e and no script (REPL/flags)", () => {
    expect(matchNodejsPipe(`node --inspect`, [])).toBe(false);
  });

  it("rejects a bare node command with no code", () => {
    expect(matchNodejsPipe(`node`, [])).toBe(false);
  });
});

describe("matchNodejsPipe — script file", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "anumati-node-"));
    writeFileSync(join(dir, "safe.js"), "const {join}=require('path');\nconsole.log(join('a','b'));\n");
    writeFileSync(join(dir, "unsafe.js"), "const fs=require('fs');\nfs.readFileSync('/etc/passwd');\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows a script with only listed modules", () => {
    expect(matchNodejsPipe("node safe.js", ["path"], dir)).toBe(true);
  });

  it("rejects a script that requires fs", () => {
    expect(matchNodejsPipe("node unsafe.js", ["path", "fs"], dir)).toBe(false);
  });

  it("rejects when the script cannot be read", () => {
    expect(matchNodejsPipe("node missing.js", ["path"], dir)).toBe(false);
  });

  it("allows a safe script invoked with arguments", () => {
    expect(matchNodejsPipe("node safe.js --out /tmp/x --quiet", ["path"], dir)).toBe(true);
  });

  it("validates the script (not its args) when args are present", () => {
    expect(matchNodejsPipe("node unsafe.js --out /tmp/x", ["path", "fs"], dir)).toBe(false);
  });
});
