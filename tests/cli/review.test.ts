import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { analyzeReview, applyProposals, consolidatePaths, parseReviewArgs } from "../../src/cli/review.js";
import type { Config } from "../../src/types.js";

let dir: string;
let configPath: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-review-"));
  configPath = join(dir, "permissions.json");
  logPath = join(dir, "anumati-passthrough.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(config: Config): void {
  writeFileSync(configPath, JSON.stringify(config));
}
function writeLog(commands: string[]): void {
  const lines = commands.map((command) => JSON.stringify({ tool: "Bash", command, decision: "passthrough" }));
  writeFileSync(logPath, lines.join("\n") + "\n");
}
function read(): Config {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}
function analyze() {
  return analyzeReview({ config: configPath, log: logPath, cwd: dir });
}

describe("analyzeReview", () => {
  it("groups fall-through commands per matcher and merges their params", () => {
    writeConfig({ allow: [] });
    writeLog([
      "curl https://api.openai.com/v1/models",
      "curl https://api.openai.com/v1/models", // repeat → occurrences > distinct
      "curl -s https://example.com/data",
      "cargo test",
      "git status",
    ]);

    const a = analyze();
    const byMatcher = new Map(a.proposals.map((p) => [p.matcher, p]));

    const curl = byMatcher.get("curl")!;
    expect(curl.distinct).toBe(2); // two distinct curl commands
    expect(curl.occurrences).toBe(3); // one repeated
    expect((curl.delta.allowed_domains as string[]).sort()).toEqual([
      "api.openai.com",
      "example.com",
    ]);
    expect(curl.addOptions.domains!.sort()).toEqual(["api.openai.com", "example.com"]);
    expect(curl.ruleState).toBe("absent");

    expect(byMatcher.get("cargo")!.distinct).toBe(1);
    expect(byMatcher.get("git-read")!.distinct).toBe(1);
    // Most-covered proposal comes first.
    expect(a.proposals[0].matcher).toBe("curl");
  });

  it("does not propose commands the config already auto-approves", () => {
    writeConfig({ allow: [{ tool: "Bash", matcher: "cargo" }] });
    writeLog(["cargo test", "git status"]);

    const a = analyze();
    expect(a.alreadyCovered).toBe(1); // cargo test
    expect(a.proposals.map((p) => p.matcher)).toEqual(["git-read"]);
  });

  it("marks a disabled placeholder as enableable, not absent", () => {
    writeConfig({ allow: [{ tool: "Bash", matcher: "cargo", enabled: false }] });
    writeLog(["cargo test"]);

    const a = analyze();
    expect(a.proposals[0].matcher).toBe("cargo");
    expect(a.proposals[0].ruleState).toBe("disabled");
  });

  it("groups commands no config change can cover, by reason", () => {
    writeConfig({ allow: [] });
    writeLog([
      "rm -rf /tmp/x", // no matcher covers rm
      "ls -la > out.txt", // file redirection
      "echo $(whoami)", // shell substitution
    ]);

    const a = analyze();
    expect(a.proposals).toEqual([]);
    const codes = new Map(a.unapprovable.map((g) => [g.code, g]));
    expect(codes.get("no_matcher")!.distinct).toBe(1);
    expect(codes.get("file_redirection")!.distinct).toBe(1);
    expect(codes.get("shell_substitution")!.distinct).toBe(1);
  });

  it("labels unapprovable groups cleanly, never embedding the raw command", () => {
    writeConfig({ allow: [] });
    // A multi-line command whose reason string would otherwise inline the whole
    // thing (a `>` inside the script trips the file-redirection check).
    const multiline = 'node -e "\nconst x = 1 > 0;\nconsole.log(x);\n"';
    writeLog(["git push origin main", "gh pr merge 12", multiline]);

    const a = analyze();
    for (const g of a.unapprovable) {
      expect(g.label).not.toContain("\n");
      expect(g.label.length).toBeLessThan(80);
      expect(g.label).not.toContain("console.log");
    }
    const labels = a.unapprovable.map((g) => g.label);
    // git has a matcher family, so it is labeled as configured-but-unapproving,
    // still keyed by the leading command (not the whole command).
    expect(labels).toContain('"git" matcher exists but no rule approves this');
  });

  it("groups uncovered commands by leading command, not one command's name", () => {
    writeConfig({ allow: [] });
    // kubectl has no matcher (true no_matcher); git has one but no rule (configured).
    writeLog(["kubectl get pods", "kubectl top nodes", "git push origin main"]);

    const a = analyze();
    const byLabel = new Map(a.unapprovable.map((g) => [g.label, g]));
    expect(byLabel.get('no matcher for "kubectl"')!.distinct).toBe(2);
    expect(byLabel.get('"git" matcher exists but no rule approves this')!.distinct).toBe(1);
  });

  it("returns logFound:false when the log is missing (no crash)", () => {
    writeConfig({ allow: [] });
    const a = analyzeReview({ config: configPath, log: join(dir, "nope.jsonl"), cwd: dir });
    expect(a.logFound).toBe(false);
    expect(a.proposals).toEqual([]);
    expect(a.totalPassthroughs).toBe(0);
  });

  it("tolerates malformed log lines", () => {
    writeConfig({ allow: [] });
    writeFileSync(
      logPath,
      `not json\n${JSON.stringify({ tool: "Bash", command: "cargo test" })}\n\n{bad\n`,
    );
    const a = analyze();
    expect(a.proposals.map((p) => p.matcher)).toEqual(["cargo"]);
  });

  it("ignores passthrough entries for non-Bash tools", () => {
    writeConfig({ allow: [] });
    writeFileSync(
      logPath,
      [
        JSON.stringify({ tool: "Read", command: "/etc/passwd", decision: "passthrough" }),
        JSON.stringify({ tool: "Bash", command: "cargo test", decision: "passthrough" }),
      ].join("\n") + "\n",
    );
    const a = analyze();
    expect(a.totalPassthroughs).toBe(1);
    expect(a.proposals.map((p) => p.matcher)).toEqual(["cargo"]);
  });

  it("captures nodejs-pipe modules in the proposal (regression: modules must flow through)", () => {
    writeConfig({ allow: [] });
    writeLog(["node -e \"const path=require('path'); console.log(path.basename('/a/b'))\""]);

    const a = analyze();
    const node = a.proposals.find((p) => p.matcher === "nodejs-pipe");
    expect(node).toBeTruthy();
    expect(node!.addOptions.modules).toContain("path");
  });
});

describe("applyProposals", () => {
  it("writes the chosen rules and verifies which commands now auto-approve", () => {
    writeConfig({ allow: [] });
    writeLog([
      "curl https://api.openai.com/v1/models",
      "curl -s https://example.com/data",
      "cargo test",
    ]);

    const a = analyze();
    const result = applyProposals(a.proposals, configPath);

    expect(result.applied).toBe(a.proposals.length);
    expect(result.nowApproved).toBe(result.targeted); // everything proposed now approves

    const rules = read().allow!;
    const curl = rules.find((r) => r.matcher === "curl")!;
    expect(curl.allowed_domains!.sort()).toEqual(["api.openai.com", "example.com"]);
    expect(rules.find((r) => r.matcher === "cargo")).toBeTruthy();
  });

  it("enables a disabled placeholder (clears the flag) when applied", () => {
    writeConfig({ allow: [{ tool: "Bash", matcher: "cargo", enabled: false }] });
    writeLog(["cargo test"]);

    const a = analyze();
    applyProposals(a.proposals, configPath);

    const cargo = read().allow!.find((r) => r.matcher === "cargo")!;
    expect(cargo.enabled).toBeUndefined(); // turned on
  });

  it("applies nodejs-pipe modules so the command actually approves afterward", () => {
    writeConfig({ allow: [] });
    writeLog(["node -e \"const path=require('path'); console.log(path.basename('/a/b'))\""]);

    const a = analyze();
    const result = applyProposals(a.proposals, configPath);

    const node = read().allow!.find((r) => r.matcher === "nodejs-pipe")!;
    expect(node.allowed_modules).toContain("path");
    expect(result.nowApproved).toBe(1); // proves modules were written, not dropped
  });
});

describe("parseReviewArgs", () => {
  it("parses apply/dry-run/scope/log/config flags", () => {
    expect(parseReviewArgs(["--all"])).toMatchObject({ all: true });
    expect(parseReviewArgs(["-y"])).toMatchObject({ all: true });
    expect(parseReviewArgs(["--dry-run"])).toMatchObject({ dryRun: true });
    expect(parseReviewArgs(["--project"])).toMatchObject({ level: "project" });
    expect(parseReviewArgs(["--log", "/tmp/l.jsonl"])).toMatchObject({ log: "/tmp/l.jsonl" });
    expect(parseReviewArgs(["--config", "/tmp/c.json"])).toMatchObject({ config: "/tmp/c.json" });
  });

  it("throws when a value flag is missing its value", () => {
    expect(() => parseReviewArgs(["--log"])).toThrow(/--log requires a value/);
    expect(() => parseReviewArgs(["--config", "--all"])).toThrow(/--config requires a value/);
  });
});

describe("consolidatePaths", () => {
  it("collapses siblings into their deepest shared root", () => {
    expect(consolidatePaths(["/a/b/c/d/", "/a/b/c/e/"])).toEqual(["/a/b/c/"]);
  });

  it("merges deepest first and keeps unrelated paths separate", () => {
    expect(
      consolidatePaths(["/a/b/c/d/x/", "/a/b/c/d/y/", "/a/b/c/e/", "/p/q/r/s/"]).sort(),
    ).toEqual(["/a/b/c/", "/p/q/r/s/"]);
  });

  it("never widens to a shallow root, the home dir, or above it", () => {
    expect(consolidatePaths(["/a/b/x/", "/a/y/"]).sort()).toEqual(["/a/b/x/", "/a/y/"]);
    const home = homedir();
    const inHome = [join(home, "one") + "/", join(home, "two") + "/"];
    expect(consolidatePaths(inHome).sort()).toEqual(inHome.sort());
  });

  it("drops paths already covered by another and leaves relative paths alone", () => {
    expect(consolidatePaths(["/a/b/c/", "/a/b/c/d/", "data/", "logs/"])).toEqual([
      "/a/b/c/",
      "data/",
      "logs/",
    ]);
  });
});
