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
  // python3/node are handled separately below: a non-flag first arg makes them
  // a script invocation, so `python3 some args` is NOT dangerous.
  const dangerous = ["sh", "bash", "zsh", "fish",
    "ruby", "perl",
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
  it("classifies node script.js with args as nodejs-script", () => {
    expect(classify("node script.js --out /tmp/x --quiet").kind).toBe("nodejs-script");
  });
  it("treats a script's own -e/-p args as script args, not node flags", () => {
    // First arg is the script → script kind; the -e belongs to the script.
    expect(classify("node cli.js -e foo").kind).toBe("nodejs-script");
  });
  it("classifies bare/flagged node as dangerous", () => {
    expect(classify("node").kind).toBe("dangerous");
    expect(classify("node --inspect app.js").kind).toBe("dangerous");
  });
});

describe("classify — python3", () => {
  it("classifies python3 -c as python3-c", () => {
    expect(classify(`python3 -c "print(1)"`).kind).toBe("python3-c");
  });
  it("classifies python3 script.py as python3-script", () => {
    expect(classify("python3 script.py").kind).toBe("python3-script");
  });
  it("classifies python3 script.py with args as python3-script", () => {
    expect(classify("python3 script.py --cwd /tmp --quiet").kind).toBe("python3-script");
  });
  it("treats a script's own -c arg as a script arg, not python's -c", () => {
    expect(classify("python3 tool.py -c config.ini").kind).toBe("python3-script");
  });
  it("classifies bare/flagged python3 as dangerous", () => {
    expect(classify("python3").kind).toBe("dangerous");
    expect(classify("python3 -m http.server").kind).toBe("dangerous");
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
