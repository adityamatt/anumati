import { describe, it, expect } from "vitest";
import { parseCompound, tokenize } from "../../src/parser/shell.js";

describe("parseCompound — simple commands", () => {
  it("single command → one segment", () => {
    const s = parseCompound("curl -s https://example.com");
    expect(s).toHaveLength(1);
    expect(s![0].raw).toBe("curl -s https://example.com");
    expect(s![0].operator).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCompound("")).toBeNull();
  });
});

describe("parseCompound — newlines as separators", () => {
  it("treats a newline like a ; separator", () => {
    const s = parseCompound("cd /a/b\nnpx tsc --noEmit");
    expect(s).toHaveLength(2);
    expect(s![0].raw).toBe("cd /a/b");
    expect(s![0].operator).toBe(";");
    expect(s![1].raw).toBe("npx tsc --noEmit");
    expect(s![1].operator).toBeNull();
  });

  it("does not add a phantom segment for a trailing && before a newline", () => {
    const s = parseCompound("cmd1 &&\n  cmd2");
    expect(s).toHaveLength(2);
    expect(s![0].raw).toBe("cmd1");
    expect(s![0].operator).toBe("&&");
    expect(s![1].raw).toBe("cmd2");
  });

  it("splits multiple lines", () => {
    const s = parseCompound("ls\nwc -l x\ngit status");
    expect(s).toHaveLength(3);
  });
});

describe("parseCompound — operators", () => {
  it("splits on pipe", () => {
    const s = parseCompound("curl -s https://example.com | head -5");
    expect(s).toHaveLength(2);
    expect(s![0].raw).toBe("curl -s https://example.com");
    expect(s![0].operator).toBe("|");
    expect(s![1].raw).toBe("head -5");
    expect(s![1].operator).toBeNull();
  });

  it("splits on &&", () => {
    const s = parseCompound("curl https://example.com && echo done");
    expect(s).toHaveLength(2);
    expect(s![0].operator).toBe("&&");
  });

  it("splits on ||", () => {
    const s = parseCompound("curl https://example.com || echo failed");
    expect(s).toHaveLength(2);
    expect(s![0].operator).toBe("||");
  });

  it("splits on semicolon", () => {
    const s = parseCompound("curl https://example.com; echo done");
    expect(s).toHaveLength(2);
    expect(s![0].operator).toBe(";");
  });

  it("splits on background &", () => {
    const s = parseCompound("curl https://example.com &");
    expect(s).toHaveLength(1);
    expect(s![0].operator).toBe("&");
  });

  it("splits three-segment chain", () => {
    const s = parseCompound("curl -s https://example.com | grep foo | head -3");
    expect(s).toHaveLength(3);
    expect(s![0].operator).toBe("|");
    expect(s![1].operator).toBe("|");
    expect(s![2].operator).toBeNull();
  });
});

describe("parseCompound — quote handling", () => {
  it("does not split on | inside double quotes", () => {
    const s = parseCompound('grep "hello | world" file.txt');
    expect(s).toHaveLength(1);
    expect(s![0].raw).toBe('grep "hello | world" file.txt');
  });

  it("does not split on | inside single quotes", () => {
    const s = parseCompound("grep 'hello | world' file.txt");
    expect(s).toHaveLength(1);
  });

  it("does not split on && inside double quotes", () => {
    const s = parseCompound('echo "a && b"');
    expect(s).toHaveLength(1);
  });

  it("returns null for unclosed double quote", () => {
    expect(parseCompound('curl "https://example.com')).toBeNull();
  });

  it("returns null for unclosed single quote", () => {
    expect(parseCompound("curl 'https://example.com")).toBeNull();
  });
});

describe("parseCompound — dangerous chars", () => {
  it("returns null for backtick", () => {
    expect(parseCompound("curl `whoami`")).toBeNull();
  });

  it("returns null for $", () => {
    expect(parseCompound("curl $URL")).toBeNull();
  });

  it("returns null for $()", () => {
    expect(parseCompound("curl $(cat /etc/passwd)")).toBeNull();
  });
});

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("curl -s https://example.com")).toEqual(["curl", "-s", "https://example.com"]);
  });

  it("strips double quotes", () => {
    expect(tokenize('curl "https://example.com"')).toEqual(["curl", "https://example.com"]);
  });

  it("strips single quotes", () => {
    expect(tokenize("curl 'https://example.com'")).toEqual(["curl", "https://example.com"]);
  });

  it("preserves spaces inside quotes", () => {
    expect(tokenize('grep "hello world"')).toEqual(["grep", "hello world"]);
  });

  it("returns null for unclosed quote", () => {
    expect(tokenize('curl "https://example.com')).toBeNull();
  });

  it("returns null for dangerous chars", () => {
    expect(tokenize("curl $URL")).toBeNull();
  });
});
