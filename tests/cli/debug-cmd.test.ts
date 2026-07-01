import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyDebug, parseDebugArgs } from "../../src/cli/debug.js";
import type { Config } from "../../src/types.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-debugcmd-"));
  configPath = join(dir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(config: Config): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
function read(): Config {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

describe("parseDebugArgs", () => {
  it("parses on / off", () => {
    expect(parseDebugArgs(["on"]).enable).toBe(true);
    expect(parseDebugArgs(["off"]).enable).toBe(false);
  });

  it("throws without on/off", () => {
    expect(() => parseDebugArgs([])).toThrow(/Usage/);
    expect(() => parseDebugArgs(["maybe"])).toThrow(/Usage/);
  });

  it("parses --root / --project / --config", () => {
    expect(parseDebugArgs(["on", "--root"]).level).toBe("root");
    expect(parseDebugArgs(["on", "--project"]).level).toBe("project");
    expect(parseDebugArgs(["on", "--config", "/x.json"]).config).toBe("/x.json");
  });

  it("throws when --config has no value", () => {
    expect(() => parseDebugArgs(["on", "--config"])).toThrow(/requires a value/);
  });
});

describe("applyDebug", () => {
  it("turns debug on, merging into an existing suggest block", () => {
    write({ suggest: { enabled: false, file: "/x.jsonl" }, allow: [] });
    const res = applyDebug({ enable: true, config: configPath });
    expect(res.changed).toBe(true);
    expect(read().suggest).toEqual({ enabled: false, file: "/x.jsonl", debug: true });
  });

  it("turns debug off", () => {
    write({ suggest: { debug: true }, allow: [] });
    applyDebug({ enable: false, config: configPath });
    expect(read().suggest!.debug).toBe(false);
  });

  it("adds a suggest block when none exists", () => {
    write({ allow: [] });
    applyDebug({ enable: true, config: configPath });
    expect(read().suggest).toEqual({ debug: true });
  });

  it("is idempotent — changed=false when already in the requested state", () => {
    write({ suggest: { debug: true }, allow: [] });
    expect(applyDebug({ enable: true, config: configPath }).changed).toBe(false);
  });

  it("preserves rules and audit when toggling", () => {
    write({ audit: { audit_file: "/a" }, allow: [{ matcher: "cargo" }] });
    applyDebug({ enable: true, config: configPath });
    const c = read();
    expect(c.audit).toEqual({ audit_file: "/a" });
    expect(c.allow).toEqual([{ matcher: "cargo" }]);
  });

  it("throws a helpful error when the config does not exist", () => {
    expect(() => applyDebug({ enable: true, config: join(dir, "nope.json") })).toThrow(
      /does not exist.*anumati init/,
    );
  });

  it("throws on invalid JSON without rewriting", () => {
    writeFileSync(configPath, "{ broken");
    expect(() => applyDebug({ enable: true, config: configPath })).toThrow(/not valid JSON/);
    expect(readFileSync(configPath, "utf-8")).toBe("{ broken");
  });
});
