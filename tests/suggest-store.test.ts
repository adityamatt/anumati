import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  storeSuggestion,
  readSuggestions,
  clearSuggestions,
} from "../src/suggest-store.js";
import type { Suggestion } from "../src/suggest.js";

const SAMPLE: Suggestion = {
  command: "anumati add curl --domain example.com",
  description: "Auto-approve curl to example.com",
  matcher: "curl",
  configDelta: { allowed_domains: ["example.com"] },
  trigger: "curl https://example.com",
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-store-"));
  file = join(dir, "suggestions.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("suggest-store", () => {
  it("returns [] when the file does not exist", () => {
    expect(readSuggestions(file)).toEqual([]);
  });

  it("appends and reads back a suggestion with a timestamp", () => {
    storeSuggestion(SAMPLE, file);
    const all = readSuggestions(file);
    expect(all).toHaveLength(1);
    expect(all[0].command).toBe(SAMPLE.command);
    expect(typeof all[0].ts).toBe("string");
  });

  it("appends multiple entries", () => {
    storeSuggestion(SAMPLE, file);
    storeSuggestion({ ...SAMPLE, command: "anumati add go" }, file);
    expect(readSuggestions(file)).toHaveLength(2);
  });

  it("skips malformed lines rather than throwing", () => {
    writeFileSync(file, JSON.stringify({ ...SAMPLE, ts: "x" }) + "\n{ not json }\n");
    const all = readSuggestions(file);
    expect(all).toHaveLength(1);
  });

  it("clearSuggestions truncates the file", () => {
    storeSuggestion(SAMPLE, file);
    clearSuggestions(file);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("");
    expect(readSuggestions(file)).toEqual([]);
  });

  it("storeSuggestion never throws on an unwritable path", () => {
    expect(() => storeSuggestion(SAMPLE, "/nonexistent-dir/x/y.jsonl")).not.toThrow();
  });
});
