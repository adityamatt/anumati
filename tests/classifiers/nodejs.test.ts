import { describe, it, expect } from "vitest";
import {
  extractModules,
  isSafeNodejsCode,
  KNOWN_SAFE_MODULES,
  ALWAYS_BLOCKED,
} from "../../src/classifiers/nodejs.js";

describe("extractModules", () => {
  it("extracts a single require", () => {
    expect(extractModules('require("path")')).toEqual(["path"]);
  });

  it("extracts a node:-prefixed require verbatim", () => {
    expect(extractModules('require("node:crypto")')).toEqual(["node:crypto"]);
  });

  it("extracts a static import", () => {
    expect(extractModules('import { join } from "path"')).toEqual(["path"]);
  });

  it("extracts a default static import", () => {
    expect(extractModules('import crypto from "crypto"')).toEqual(["crypto"]);
  });

  it("extracts a bare side-effect import", () => {
    expect(extractModules('import "util"')).toEqual(["util"]);
  });

  it("extracts a dynamic import() with a string literal", () => {
    expect(extractModules('import("crypto").then(c => c)')).toEqual(["crypto"]);
  });

  it("extracts every module across multiple requires", () => {
    expect(extractModules('const a=require("path"); const b=require("crypto")')).toEqual(["path", "crypto"]);
  });

  it("ignores substrings like prerequire/requires", () => {
    expect(extractModules("const prerequire = 1; requires++;")).toEqual([]);
  });

  // SECURITY: an unverifiable module reference must surface as null so the
  // caller blocks, never as an empty/partial list that looks safe.
  it("returns null for a dynamic require() argument", () => {
    expect(extractModules("require(userInput)")).toBeNull();
  });

  it("returns null for a dynamic import() argument", () => {
    expect(extractModules("import(userInput)")).toBeNull();
  });

  it("returns null for require used as a value (aliased)", () => {
    expect(extractModules("const r = require; r('fs')")).toBeNull();
  });
});

describe("isSafeNodejsCode — module gating", () => {
  it("allows a listed pure-compute module", () => {
    expect(isSafeNodejsCode('const {join}=require("path")', ["path"])).toBe(true);
  });

  it("blocks an ALWAYS_BLOCKED module even if listed", () => {
    expect(isSafeNodejsCode('require("fs")', ["fs"])).toBe(false);
  });

  it("blocks node:-prefixed ALWAYS_BLOCKED module", () => {
    expect(isSafeNodejsCode('require("node:child_process")', ["child_process"])).toBe(false);
  });

  it("blocks an unlisted module", () => {
    expect(isSafeNodejsCode('require("crypto")', ["path"])).toBe(false);
  });

  it("blocks a dangerous module hidden behind an allowed one", () => {
    expect(isSafeNodejsCode('require("path"); require("net")', ["path"])).toBe(false);
  });

  it("allows code with no modules at all", () => {
    expect(isSafeNodejsCode('console.log(1 + 1)', [])).toBe(true);
  });
});

describe("isSafeNodejsCode — dangerous builtins", () => {
  it("blocks eval()", () => {
    expect(isSafeNodejsCode('eval("1+1")', [])).toBe(false);
  });

  it("blocks the Function constructor", () => {
    expect(isSafeNodejsCode('Function("return process")()', [])).toBe(false);
  });

  it("blocks .constructor( escape", () => {
    expect(isSafeNodejsCode('(()=>{}).constructor("return 1")()', [])).toBe(false);
  });

  it("blocks process.binding", () => {
    expect(isSafeNodejsCode('process.binding("fs")', [])).toBe(false);
  });

  it("blocks a dynamic require even with no allowlist", () => {
    expect(isSafeNodejsCode("require(name)", [])).toBe(false);
  });
});

describe("KNOWN_SAFE_MODULES", () => {
  it("contains common pure-compute built-ins", () => {
    for (const mod of ["path", "crypto", "url", "util", "buffer", "zlib"]) {
      expect(KNOWN_SAFE_MODULES).toContain(mod);
    }
  });

  it("never overlaps with ALWAYS_BLOCKED", () => {
    for (const mod of KNOWN_SAFE_MODULES) {
      expect(ALWAYS_BLOCKED.has(mod)).toBe(false);
    }
  });

  it("excludes modules with file/network/subprocess/exec capability", () => {
    for (const unsafe of ["fs", "child_process", "net", "http", "os", "vm", "dns", "worker_threads"]) {
      expect(KNOWN_SAFE_MODULES).not.toContain(unsafe);
    }
  });

  it("every safe module passes isSafeNodejsCode when allowed", () => {
    for (const mod of KNOWN_SAFE_MODULES) {
      expect(isSafeNodejsCode(`require("${mod}")`, [mod])).toBe(true);
    }
  });
});

describe("isSafeNodejsCode — require() of a file path (allowed_paths)", () => {
  const PATHS = ["/Users/x/precog/"];

  it("allows requiring a file under an allowed path prefix", () => {
    expect(isSafeNodejsCode('const l=require("/Users/x/precog/package-lock.json")', [], PATHS)).toBe(true);
  });

  it("allows a relative ./ path when it resolves under an allowed prefix", () => {
    // relative specifiers are path-checked verbatim; a matching prefix passes
    expect(isSafeNodejsCode('require("/Users/x/precog/sub/data.json")', [], PATHS)).toBe(true);
  });

  it("blocks a file-path require when NO allowed_paths configured", () => {
    expect(isSafeNodejsCode('require("/Users/x/precog/pkg.json")', ["path"])).toBe(false);
  });

  it("blocks a path outside the allowlist", () => {
    expect(isSafeNodejsCode('require("/etc/passwd")', [], PATHS)).toBe(false);
  });

  it("blocks path traversal even under an allowed prefix", () => {
    expect(isSafeNodejsCode('require("/Users/x/precog/../../etc/passwd")', [], PATHS)).toBe(false);
  });

  it("still blocks fs even when allowed_paths is set (no filesystem module backdoor)", () => {
    expect(isSafeNodejsCode('require("fs")', ["fs"], PATHS)).toBe(false);
  });

  it("mixes a builtin module and an allowed file path", () => {
    expect(
      isSafeNodejsCode('const p=require("path"); const l=require("/Users/x/precog/l.json")', ["path"], PATHS),
    ).toBe(true);
  });

  it("blocks ./relative path when allowed_paths only lists absolute prefixes", () => {
    expect(isSafeNodejsCode('require("./local.json")', [], PATHS)).toBe(false);
  });
});
