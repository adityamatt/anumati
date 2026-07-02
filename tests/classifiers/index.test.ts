import { describe, it, expect } from "vitest";
import { classify } from "../../src/classifiers/index.js";

describe("classify — curl", () => {
  it("classifies curl command", () => {
    expect(classify("curl -s https://example.com").kind).toBe("curl");
  });

  it("exposes argv", () => {
    const c = classify("curl -s https://example.com");
    expect(c.argv).toEqual(["curl", "-s", "https://example.com"]);
  });
});

describe("classify — git", () => {
  it("classifies git command", () => {
    expect(classify("git status").kind).toBe("git");
    expect(classify("git log --oneline").kind).toBe("git");
  });
});

describe("classify — safe builtins", () => {
  const safe = ["head", "tail", "grep", "rg", "cat", "ls", "echo",
    "wc", "sort", "uniq", "jq", "cut", "tr", "awk", "sed",
    "find", "which", "date", "pwd", "tee", "diff"];

  for (const cmd of safe) {
    it(`classifies ${cmd} as safe-builtin`, () => {
      expect(classify(`${cmd} some args`).kind).toBe("safe-builtin");
    });
  }
});

describe("classify — dangerous", () => {
  const dangerous = ["sh", "bash", "zsh", "fish",
    "python", "python3", "node", "ruby", "perl",
    "sudo", "su", "eval", "exec", "env"];

  for (const cmd of dangerous) {
    it(`classifies ${cmd} as dangerous`, () => {
      expect(classify(`${cmd} some args`).kind).toBe("dangerous");
    });
  }
});

describe("classify — nodejs", () => {
  it("classifies node -e as nodejs-e", () => {
    expect(classify(`node -e "console.log(1)"`).kind).toBe("nodejs-e");
  });
  it("classifies node --eval as nodejs-e", () => {
    expect(classify(`node --eval "1+1"`).kind).toBe("nodejs-e");
  });
  it("classifies node -p / --print as nodejs-e", () => {
    expect(classify(`node -p "1+1"`).kind).toBe("nodejs-e");
    expect(classify(`node --print "1+1"`).kind).toBe("nodejs-e");
  });
  it("classifies node script.js as nodejs-script", () => {
    expect(classify("node script.js").kind).toBe("nodejs-script");
  });
  it("classifies bare/flagged node as dangerous", () => {
    expect(classify("node").kind).toBe("dangerous");
    expect(classify("node --inspect app.js").kind).toBe("dangerous");
  });
});

describe("classify — unknown", () => {
  it("classifies unknown command", () => {
    expect(classify("my-custom-tool --flag").kind).toBe("unknown");
  });

  it("classifies empty string as unknown", () => {
    expect(classify("").kind).toBe("unknown");
  });

  it("classifies dangerous-char string as unknown (tokenize fails)", () => {
    expect(classify("curl $URL").kind).toBe("unknown");
  });
});
