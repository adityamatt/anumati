import { describe, it, expect } from "vitest";
import {
  extractImports,
  isSafePython3Code,
  KNOWN_SAFE_IMPORTS,
  ALWAYS_BLOCKED,
} from "../../src/classifiers/python3.js";

describe("extractImports", () => {
  it("extracts a single bare import", () => {
    expect(extractImports("import json")).toEqual(["json"]);
  });

  it("extracts a dotted module", () => {
    expect(extractImports("import a.b.c")).toEqual(["a.b.c"]);
  });

  it("extracts the module from a `from … import` form", () => {
    expect(extractImports("from collections import defaultdict")).toEqual(["collections"]);
  });

  // SECURITY REGRESSION: comma-separated imports must ALL be surfaced, or a
  // blocked module can hide behind an allowed one and bypass the safety check.
  it("extracts every module in a comma-separated import", () => {
    expect(extractImports("import json, subprocess")).toEqual(["json", "subprocess"]);
    expect(extractImports("import os, sys")).toEqual(["os", "sys"]);
  });

  it("strips `as` aliases across multiple imports", () => {
    expect(extractImports("import numpy as np, pandas as pd")).toEqual(["numpy", "pandas"]);
  });

  it("handles semicolon-chained imports", () => {
    expect(extractImports("import json;import os")).toEqual(["json", "os"]);
  });

  it("ignores trailing comments", () => {
    expect(extractImports("import json  # a comment")).toEqual(["json"]);
  });
});

describe("isSafePython3Code — comma-import escape is closed", () => {
  it("blocks a dangerous module hidden behind an allowed one", () => {
    // json allowed, subprocess is ALWAYS_BLOCKED — must be rejected.
    expect(isSafePython3Code("import json, subprocess", ["json"])).toBe(false);
  });

  it("blocks an un-allowed module hidden behind an allowed one", () => {
    expect(isSafePython3Code("import json, numpy", ["json"])).toBe(false);
  });

  it("allows when every comma-imported module is allowed", () => {
    expect(isSafePython3Code("import json, math", ["json", "math"])).toBe(true);
  });
});

describe("KNOWN_SAFE_IMPORTS", () => {
  it("contains common pure-stdlib modules", () => {
    for (const mod of ["json", "math", "statistics", "datetime", "re", "hashlib"]) {
      expect(KNOWN_SAFE_IMPORTS).toContain(mod);
    }
  });

  it("never overlaps with ALWAYS_BLOCKED", () => {
    for (const mod of KNOWN_SAFE_IMPORTS) {
      expect(ALWAYS_BLOCKED.has(mod)).toBe(false);
    }
  });

  it("excludes modules with file/network/exec capability", () => {
    for (const unsafe of ["os", "subprocess", "socket", "requests", "pickle", "codecs", "io", "pathlib"]) {
      expect(KNOWN_SAFE_IMPORTS).not.toContain(unsafe);
    }
  });

  it("every safe module actually passes isSafePython3Code when allowed", () => {
    for (const mod of KNOWN_SAFE_IMPORTS) {
      expect(isSafePython3Code(`import ${mod}`, [mod])).toBe(true);
    }
  });
});
