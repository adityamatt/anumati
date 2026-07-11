import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { matchPython3Pipe } from "../../src/matchers/python3-pipe.js";

describe("matchPython3Pipe — inline -c", () => {
  it("allows -c with a listed import", () => {
    expect(matchPython3Pipe(`python3 -c "import json; print(json.dumps({}))"`, ["json"])).toBe(true);
  });

  it("allows -c with no imports", () => {
    expect(matchPython3Pipe(`python3 -c "print(1 + 1)"`, [])).toBe(true);
  });

  it("rejects -c importing a blocked module", () => {
    expect(matchPython3Pipe(`python3 -c "import os; print(os.getcwd())"`, ["os"])).toBe(false);
  });

  it("rejects -c importing an unlisted module", () => {
    expect(matchPython3Pipe(`python3 -c "import json"`, [])).toBe(false);
  });

  it("rejects -c using a dangerous builtin", () => {
    expect(matchPython3Pipe(`python3 -c "eval('1+1')"`, [])).toBe(false);
  });

  it("allows a pipe chain: grep | python3 -c", () => {
    expect(matchPython3Pipe(`grep foo f.txt | python3 -c "print(1)"`, [])).toBe(true);
  });

  it("rejects bare/flagged python3", () => {
    expect(matchPython3Pipe("python3", [])).toBe(false);
    expect(matchPython3Pipe("python3 -m http.server", [])).toBe(false);
  });
});

describe("matchPython3Pipe — script file", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "anumati-py-"));
    writeFileSync(join(dir, "safe.py"), "import json\nprint(json.dumps({'a': 1}))\n");
    writeFileSync(join(dir, "unsafe.py"), "import os\nprint(os.getcwd())\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows a script with only listed imports", () => {
    expect(matchPython3Pipe("python3 safe.py", ["json"], [], dir)).toBe(true);
  });

  it("rejects a script importing a blocked module", () => {
    expect(matchPython3Pipe("python3 unsafe.py", ["os"], [], dir)).toBe(false);
  });

  it("rejects when the script cannot be read", () => {
    expect(matchPython3Pipe("python3 missing.py", ["json"], [], dir)).toBe(false);
  });

  it("allows a safe script invoked with arguments", () => {
    expect(matchPython3Pipe("python3 safe.py --cwd /tmp --quiet", ["json"], [], dir)).toBe(true);
  });

  it("validates the script (not its args) when args are present", () => {
    expect(matchPython3Pipe("python3 unsafe.py --cwd /tmp", ["os"], [], dir)).toBe(false);
  });
});
