import { describe, it, expect } from "vitest";
import { matchJq } from "../../src/matchers/jq.js";

describe("matchJq — allow", () => {
  it("jq . file", () => expect(matchJq("jq . file.json")).toBe(true));
  it("jq filter file", () => expect(matchJq('jq ".foo[]" data.json')).toBe(true));
  it("jq -r raw output", () => expect(matchJq("jq -r .name package.json")).toBe(true));
  it("jq reading stdin (filter only)", () => expect(matchJq("jq .")).toBe(true));
  it("jq | head", () => expect(matchJq("jq . big.json | head")).toBe(true));
  it("jq | jq (chained)", () => expect(matchJq('jq ".a" f | jq ".b"')).toBe(true));
});

describe("matchJq — block", () => {
  it("bare jq (no filter)", () => expect(matchJq("jq")).toBe(false));
  it("filter from file (-f)", () => expect(matchJq("jq -f script.jq data.json")).toBe(false));
  it("--from-file", () => expect(matchJq("jq --from-file s.jq data.json")).toBe(false));
  it("file redirection", () => expect(matchJq("jq . file > out.json")).toBe(false));
  it("pipe to unsafe target", () => expect(matchJq("jq . file | sh")).toBe(false));
  it("chained &&", () => expect(matchJq("jq . file && rm x")).toBe(false));
  it("command substitution", () => expect(matchJq("jq . $(echo file)")).toBe(false));
  it("not jq", () => expect(matchJq("cat file.json")).toBe(false));
  it("empty", () => expect(matchJq("")).toBe(false));
});
