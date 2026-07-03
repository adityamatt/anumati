import { describe, it, expect } from "vitest";
import { hasUnsafeRedirection } from "../../src/parser/redirect.js";

describe("hasUnsafeRedirection — safe (false)", () => {
  it("no redirection at all", () => expect(hasUnsafeRedirection("grep x file")).toBe(false));
  it("2>/dev/null", () => expect(hasUnsafeRedirection("grep -rn p /a /b 2>/dev/null")).toBe(false));
  it(">/dev/null", () => expect(hasUnsafeRedirection("cmd >/dev/null")).toBe(false));
  it("2>&1", () => expect(hasUnsafeRedirection("cmd 2>&1")).toBe(false));
  it("1>&2", () => expect(hasUnsafeRedirection("cmd 1>&2")).toBe(false));
  it(">&2", () => expect(hasUnsafeRedirection("cmd >&2")).toBe(false));
  it("&>/dev/null", () => expect(hasUnsafeRedirection("cmd &>/dev/null")).toBe(false));
  it("combined >/dev/null 2>&1", () => expect(hasUnsafeRedirection("cmd >/dev/null 2>&1")).toBe(false));
  it("2>/dev/null piped", () => expect(hasUnsafeRedirection("grep x f 2>/dev/null")).toBe(false));
});

describe("hasUnsafeRedirection — unsafe (true)", () => {
  it("> file", () => expect(hasUnsafeRedirection("cat foo > out.txt")).toBe(true));
  it(">> file", () => expect(hasUnsafeRedirection("echo x >> log")).toBe(true));
  it("2> file", () => expect(hasUnsafeRedirection("grep x f 2> errors.log")).toBe(true));
  it("input redirect <", () => expect(hasUnsafeRedirection("cat < in.txt")).toBe(true));
  it("> /dev/other", () => expect(hasUnsafeRedirection("cmd > /dev/tty")).toBe(true));
  it("file write alongside a safe stream redirect", () =>
    expect(hasUnsafeRedirection("cmd > out.log 2>&1")).toBe(true));
  it("redirect with a space before the filename", () =>
    expect(hasUnsafeRedirection("cat foo >  out.txt")).toBe(true));
});
