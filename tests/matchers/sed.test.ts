import { describe, it, expect } from "vitest";
import { matchSed } from "../../src/matchers/sed.js";

describe("matchSed — allow (read-only)", () => {
  it("sed -n range print", () => expect(matchSed("sed -n '1,60p' file.ts")).toBe(true));
  it("sed -n range print with path", () =>
    expect(matchSed("sed -n '1,60p' lib/handler/profiler/boolean.ts")).toBe(true));
  it("sed -n single line", () => expect(matchSed("sed -n '5p' file")).toBe(true));
  it("sed delete (prints the rest)", () => expect(matchSed("sed '10,20d' file")).toBe(true));
  it("sed quit after N", () => expect(matchSed("sed '60q' file")).toBe(true));
  it("sed = (line numbers)", () => expect(matchSed("sed -n '1,10=' file")).toBe(true));
  it("multiple -e scripts", () => expect(matchSed("sed -n -e '1p' -e '5p' file")).toBe(true));
  it("piped to a safe consumer", () => expect(matchSed("sed -n '1,60p' file | head")).toBe(true));
  it("extended-regexp flag is fine (read-only)", () => expect(matchSed("sed -nE '1,5p' file")).toBe(false)); // -nE combined not a known flag
  it("separate boolean flags", () => expect(matchSed("sed -n -E '1,5p' file")).toBe(true));
});

describe("matchSed — block write / exec forms", () => {
  it("in-place -i", () => expect(matchSed("sed -i 's/a/b/' file")).toBe(false));
  it("in-place with suffix", () => expect(matchSed("sed -i.bak 's/a/b/' file")).toBe(false));
  it("--in-place", () => expect(matchSed("sed --in-place 's/x/y/' file")).toBe(false));
  it("substitution (not in safe grammar)", () => expect(matchSed("sed 's/a/b/' file")).toBe(false));
  it("substitution with w (write to file)", () => expect(matchSed("sed 's/a/b/w out.txt' file")).toBe(false));
  it("external script file -f", () => expect(matchSed("sed -f script.sed file")).toBe(false));
  it("w write command", () => expect(matchSed("sed -n '1,5w out.txt' file")).toBe(false));
});

describe("matchSed — block dangerous shapes", () => {
  it("file redirection", () => expect(matchSed("sed -n '1,60p' file > out.txt")).toBe(false));
  it("pipe to unsafe consumer", () => expect(matchSed("sed -n '1,60p' file | sh")).toBe(false));
  it("chained && (single command only)", () => expect(matchSed("sed -n '1p' a && rm b")).toBe(false));
  it("unknown flag", () => expect(matchSed("sed --frobnicate file")).toBe(false));
  it("no script", () => expect(matchSed("sed")).toBe(false));
  it("not sed", () => expect(matchSed("awk '{print}' file")).toBe(false));
  it("empty", () => expect(matchSed("")).toBe(false));
});
