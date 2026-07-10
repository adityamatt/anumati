import { describe, it, expect } from "vitest";
import { isSafePipeConsumer, SAFE_PIPE_CONSUMERS } from "../../src/parser/pipe.js";

describe("isSafePipeConsumer — allow", () => {
  for (const c of ["head", "tail", "grep", "rg", "wc", "sort", "uniq", "cut", "jq", "less"]) {
    it(`allows ${c}`, () => expect(isSafePipeConsumer(`${c} -n 5`)).toBe(true));
  }

  it("allows an absolute path to a consumer (basename match)", () => {
    expect(isSafePipeConsumer("/usr/bin/grep foo")).toBe(true);
  });

  it("allows a read-only sed (print range)", () => {
    expect(isSafePipeConsumer("sed -n '1,80p'")).toBe(true);
  });
});

describe("isSafePipeConsumer — block", () => {
  it("blocks a non-consumer command", () => {
    expect(isSafePipeConsumer("sh")).toBe(false);
    expect(isSafePipeConsumer("xargs rm")).toBe(false);
    expect(isSafePipeConsumer("tee out.txt")).toBe(false);
  });

  it("blocks a consumer with a file redirect", () => {
    expect(isSafePipeConsumer("grep foo > out.txt")).toBe(false);
  });

  it("blocks a write-form sed (not read-only)", () => {
    expect(isSafePipeConsumer("sed -i 's/a/b/' file")).toBe(false);
    expect(isSafePipeConsumer("sed 's/a/b/'")).toBe(false);
  });

  it("blocks empty", () => {
    expect(isSafePipeConsumer("")).toBe(false);
  });
});

describe("SAFE_PIPE_CONSUMERS — shared set", () => {
  it("is the union covering both the old builtin and git-target sets", () => {
    // jq (was aws-only) and cut/column/tr/more (were git-only) are all present.
    for (const c of ["jq", "cut", "column", "nl", "tr", "more", "egrep", "fgrep"]) {
      expect(SAFE_PIPE_CONSUMERS.has(c)).toBe(true);
    }
  });
});
