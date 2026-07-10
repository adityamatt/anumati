import { describe, it, expect } from "vitest";
import { matchSafeInspect } from "../../src/matchers/safe-inspect.js";

describe("matchSafeInspect — allow", () => {
  it("standalone ls", () => {
    expect(matchSafeInspect("ls")).toBe(true);
  });

  it("ls with flags and path", () => {
    expect(matchSafeInspect("ls -la /tmp")).toBe(true);
  });

  it("cat a file", () => {
    expect(matchSafeInspect("cat foo.txt")).toBe(true);
  });

  it("head with -n", () => {
    expect(matchSafeInspect("head -n 20 file")).toBe(true);
  });

  it("tail", () => {
    expect(matchSafeInspect("tail -f does-not-execute")).toBe(true);
  });

  it("piped cat | grep | head", () => {
    expect(matchSafeInspect("cat foo | grep bar | head")).toBe(true);
  });

  it("find with -name", () => {
    expect(matchSafeInspect("find . -name '*.ts'")).toBe(true);
  });

  it("find with -type and -maxdepth", () => {
    expect(matchSafeInspect("find . -type f -maxdepth 2")).toBe(true);
  });

  it("bare env", () => {
    expect(matchSafeInspect("env")).toBe(true);
  });

  it("printenv with one variable", () => {
    expect(matchSafeInspect("printenv PATH")).toBe(true);
  });

  it("bare printenv", () => {
    expect(matchSafeInspect("printenv")).toBe(true);
  });

  it("wc piped", () => {
    expect(matchSafeInspect("cat file | wc -l")).toBe(true);
  });

  it("sort | uniq | tac chain", () => {
    expect(matchSafeInspect("sort file | uniq | tac")).toBe(true);
  });

  it("realpath / readlink", () => {
    expect(matchSafeInspect("realpath ./foo")).toBe(true);
    expect(matchSafeInspect("readlink -f ./foo")).toBe(true);
  });

  it("grep with 2>/dev/null (safe stream redirect)", () => {
    expect(matchSafeInspect('grep -rn "A\\|B" /a /b 2>/dev/null')).toBe(true);
  });

  it("piped chain with a trailing 2>&1", () => {
    expect(matchSafeInspect("cat foo | grep bar 2>&1")).toBe(true);
  });

  it("semicolon-separated safe reads", () => {
    expect(matchSafeInspect("grep -rn x /bin 2>/dev/null | head; ls /bin 2>/dev/null")).toBe(true);
  });

  it("&&-separated safe reads", () => {
    expect(matchSafeInspect("ls src && cat foo.txt")).toBe(true);
  });

  it("mixed | ; && chain of safe reads", () => {
    expect(matchSafeInspect("cat a | grep b; ls && wc -l c")).toBe(true);
  });

  it("read-only sed as a pipe stage", () => {
    expect(matchSafeInspect("cat foo | sed -n '1,80p' | grep bar")).toBe(true);
  });

  it("standalone read-only sed", () => {
    expect(matchSafeInspect("sed -n '1,80p' file")).toBe(true);
  });

  it("read-only sed leading a chain", () => {
    expect(matchSafeInspect("sed -n '1,80p' file | head")).toBe(true);
  });

  it("cat 2>/dev/null | sed -n range | grep (the original passthrough case)", () => {
    expect(
      matchSafeInspect(
        "cat /a/b/http.d.ts 2>/dev/null | sed -n '1,80p' | grep -nA25 \"interface HttpRequest\"",
      ),
    ).toBe(true);
  });
});

describe("matchSafeInspect — block", () => {
  it("find . -delete", () => {
    expect(matchSafeInspect("find . -delete")).toBe(false);
  });

  it("find . -exec rm", () => {
    expect(matchSafeInspect("find . -exec rm {} \\;")).toBe(false);
  });

  it("find . -execdir", () => {
    expect(matchSafeInspect("find . -execdir rm {} \\;")).toBe(false);
  });

  it("find . -ok", () => {
    expect(matchSafeInspect("find . -ok rm {} \\;")).toBe(false);
  });

  it("cat redirect to file", () => {
    expect(matchSafeInspect("cat foo > bar")).toBe(false);
  });

  it("cat append redirect", () => {
    expect(matchSafeInspect("cat a >> b")).toBe(false);
  });

  it("input redirect", () => {
    expect(matchSafeInspect("cat < file")).toBe(false);
  });

  it("ls && rm -rf /", () => {
    expect(matchSafeInspect("ls && rm -rf /")).toBe(false);
  });

  it("cat foo; rm x", () => {
    expect(matchSafeInspect("cat foo; rm x")).toBe(false);
  });

  it("|| operator", () => {
    expect(matchSafeInspect("ls || echo fail")).toBe(false);
  });

  it("|| rejected even when both segments are safe reads", () => {
    expect(matchSafeInspect("ls || cat foo")).toBe(false);
  });

  it("background operator", () => {
    expect(matchSafeInspect("ls & cat foo")).toBe(false);
  });

  it("backgrounding rejected even with safe segments", () => {
    expect(matchSafeInspect("ls src & cat foo")).toBe(false);
  });

  it("in-place sed -i is not allowed", () => {
    expect(matchSafeInspect("sed -i 's/a/b/' file")).toBe(false);
  });

  it("sed substitution is not allowed", () => {
    expect(matchSafeInspect("cat f | sed 's/a/b/'")).toBe(false);
  });

  it("sed write command in a chain blocks the chain", () => {
    expect(matchSafeInspect("cat f | sed -n '1,5w out.txt' | grep x")).toBe(false);
  });

  it("awk is not allowed", () => {
    expect(matchSafeInspect("awk '{print}' file")).toBe(false);
  });

  it("xargs is not allowed", () => {
    expect(matchSafeInspect("xargs rm")).toBe(false);
  });

  it("tee is not allowed", () => {
    expect(matchSafeInspect("cat foo | tee bar")).toBe(false);
  });

  it("env FOO=1 sh", () => {
    expect(matchSafeInspect("env FOO=1 sh")).toBe(false);
  });

  it("env running a command", () => {
    expect(matchSafeInspect("env ls")).toBe(false);
  });

  it("printenv with too many args", () => {
    expect(matchSafeInspect("printenv FOO BAR")).toBe(false);
  });

  it("piped target not in allowlist", () => {
    expect(matchSafeInspect("cat foo | sh")).toBe(false);
  });

  it("unknown command", () => {
    expect(matchSafeInspect("rm -rf /")).toBe(false);
  });

  it("subshell expansion blocked", () => {
    expect(matchSafeInspect("cat $(cat /etc/passwd)")).toBe(false);
  });

  it("backtick expansion blocked", () => {
    expect(matchSafeInspect("cat `whoami`")).toBe(false);
  });

  it("one bad segment in pipe blocks whole chain", () => {
    expect(matchSafeInspect("cat foo | grep bar | rm baz")).toBe(false);
  });

  it("empty command", () => {
    expect(matchSafeInspect("")).toBe(false);
  });
});
