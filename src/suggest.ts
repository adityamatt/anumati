import { readFileSync } from "fs";
import { basename, dirname, resolve, sep } from "path";
import type { HookInput, Rule } from "./types.js";
import { parseCompound, tokenize } from "./parser/shell.js";
import { classify } from "./classifiers/index.js";
import {
  extractImports,
  extractOpenPaths,
  ALWAYS_BLOCKED,
  KNOWN_SAFE_IMPORTS,
} from "./classifiers/python3.js";
import { matchCurl } from "./matchers/curl.js";
import { matchPython3Pipe } from "./matchers/python3-pipe.js";
import { matchPip3Install } from "./matchers/pip3-install.js";
import { matchNpmScript } from "./matchers/npm-script.js";
import { matchGh } from "./matchers/gh.js";
import { matchCargo } from "./matchers/cargo.js";
import { matchGo } from "./matchers/go.js";
import { matchGitRead } from "./matchers/git-read.js";
import { matchSafeInspect } from "./matchers/safe-inspect.js";
import { matchNpxTsc } from "./matchers/npx-tsc.js";
import { matchSafeRead } from "./matchers/safe-read.js";

export interface Suggestion {
  /** The anumati CLI command to run to apply this suggestion */
  command: string;
  /** Human-readable one-liner explaining what this does */
  description: string;
  /** What matcher would handle this */
  matcher: string;
  /** The specific config fields that would need to be added/changed */
  configDelta: Record<string, unknown>;
  /** Risk assessment */
  risk: "low" | "medium" | "high";
  /** Why this risk level */
  riskReason?: string;
  /** The original command/input that triggered this */
  trigger: string;
}

// Fast lookup for risk classification of python3 import suggestions.
const KNOWN_SAFE_SET = new Set(KNOWN_SAFE_IMPORTS);

/**
 * Generate a config-change suggestion for an input that fell through to the
 * permission dialog. Returns null when nothing useful (or safe) can be
 * suggested. This runs ONLY when evaluate() returned passthrough.
 */
export function suggest(input: HookInput, allRules: Rule[]): Suggestion | null {
  if (input.tool_name === "Bash") return suggestBash(input, allRules);
  if (input.tool_name === "Read") return suggestRead(input, allRules);
  return null;
}

function suggestBash(input: HookInput, allRules: Rule[]): Suggestion | null {
  const cmd = input.tool_input.command ?? "";
  if (!cmd) return null;

  // Near-miss: an existing rule that would match if its allowlist was expanded.
  const nearMiss = findNearMiss(cmd, allRules, input.cwd ?? "");
  if (nearMiss) return nearMiss;

  // No near-miss — classify the command and suggest a brand-new rule.
  return suggestNewRule(cmd, allRules, input.cwd ?? "");
}

function suggestRead(input: HookInput, allRules: Rule[]): Suggestion | null {
  const filePath = input.tool_input.file_path ?? "";
  if (!filePath) return null;

  // A safe-read rule already exists — the file just has traversal we won't approve.
  if (allRules.some((r) => r.matcher === "safe-read")) return null;

  // Verify: adding safe-read would actually auto-approve this path (no `..`).
  if (!matchSafeRead(filePath)) return null;

  return {
    command: "anumati add safe-read",
    description: "Auto-approve file reads (blocks path traversal)",
    matcher: "safe-read",
    configDelta: { tool: "Read", matcher: "safe-read" },
    risk: "low",
    trigger: filePath,
  };
}

// ── Near-miss detection ──────────────────────────────────────────────────────

function findNearMiss(
  cmd: string,
  allRules: Rule[],
  cwd: string,
): Suggestion | null {
  for (const rule of allRules) {
    if (rule.tool && rule.tool !== "Bash") continue;
    if (!rule.matcher) continue;

    let miss: Suggestion | null = null;
    switch (rule.matcher) {
      case "curl":
        miss = nearMissCurl(cmd, rule);
        break;
      case "python3-pipe":
        miss = nearMissPython3(cmd, rule, cwd);
        break;
      case "pip3-install":
        miss = nearMissPip3(cmd, rule);
        break;
      case "npm-script":
        miss = nearMissNpmScript(cmd, rule);
        break;
      case "gh":
        miss = nearMissGh(cmd, rule);
        break;
    }
    if (miss) return miss;
  }
  return null;
}

function nearMissCurl(cmd: string, rule: Rule): Suggestion | null {
  const allowed = rule.allowed_domains ?? [];
  const hosts = curlHostnames(cmd);
  if (hosts.length === 0) return null; // not an https curl command

  const missing = unique(hosts.filter((h) => !allowed.includes(h)));
  if (missing.length === 0) return null;

  const candidate = unique([...allowed, ...missing]);
  if (
    !matchCurl(
      cmd,
      candidate,
      rule.allowed_imports ?? [],
      rule.open?.allowed_paths ?? [],
    )
  ) {
    return null; // adding the domain wouldn't fix it (e.g. unsafe pipe target)
  }

  return curlSuggestion(missing, cmd);
}

function nearMissPython3(cmd: string, rule: Rule, cwd: string): Suggestion | null {
  const codes = python3Codes(cmd, cwd);
  if (!codes) return null;

  const allowedImports = rule.allowed_imports ?? [];
  const allowedPaths = rule.open?.allowed_paths ?? [];
  const delta = python3Delta(codes, allowedImports, allowedPaths);
  if (!delta) return null; // blocked import / dynamic open / traversal — never approvable
  if (delta.imports.length === 0 && delta.paths.length === 0) return null;

  const candImports = unique([...allowedImports, ...delta.imports]);
  const candPaths = unique([...allowedPaths, ...delta.paths]);
  if (!matchPython3Pipe(cmd, candImports, candPaths, cwd)) return null;

  return python3Suggestion(delta.imports, delta.paths, cmd);
}

function nearMissPip3(cmd: string, rule: Rule): Suggestion | null {
  const allowed = rule.allowed_packages ?? [];
  if (allowed.includes("*")) return null; // already allows everything
  const pkgs = pipPackages(cmd);
  if (pkgs.length === 0) return null;

  const missing = unique(pkgs.filter((p) => !allowed.includes(p)));
  if (missing.length === 0) return null;

  const candidate = unique([...allowed, ...missing]);
  if (!matchPip3Install(cmd, candidate)) return null;

  return pip3Suggestion(missing, cmd);
}

function nearMissNpmScript(cmd: string, rule: Rule): Suggestion | null {
  const allowed = rule.allowed_scripts ?? [];
  if (allowed.includes("*")) return null;
  const scripts = npmScripts(cmd);
  if (scripts.length === 0) return null;

  const missing = unique(scripts.filter((s) => !allowed.includes(s)));
  if (missing.length === 0) return null;

  const candidate = unique([...allowed, ...missing]);
  if (!matchNpmScript(cmd, candidate)) return null;

  return npmScriptSuggestion(missing, cmd);
}

function nearMissGh(cmd: string, rule: Rule): Suggestion | null {
  const allowed = rule.allowed_repos ?? [];
  const repos = ghRepos(cmd);
  if (repos.length === 0) return null;

  const missing = unique(repos.filter((r) => !allowed.includes(r)));
  if (missing.length === 0) return null;

  const candidate = unique([...allowed, ...missing]);
  if (
    !matchGh(
      cmd,
      candidate,
      rule.allowed_imports ?? [],
      rule.open?.allowed_paths ?? [],
    )
  ) {
    return null;
  }

  return ghSuggestion(missing, cmd);
}

// ── New-rule classification ──────────────────────────────────────────────────

function suggestNewRule(
  cmd: string,
  allRules: Rule[],
  cwd: string,
): Suggestion | null {
  const has = (m: string) => allRules.some((r) => r.matcher === m);

  // Parameterized matchers first (most specific), then no-param families.
  if (!has("curl")) {
    const hosts = unique(curlHostnames(cmd));
    if (hosts.length > 0 && matchCurl(cmd, hosts)) return curlSuggestion(hosts, cmd);
  }
  if (!has("gh")) {
    const repos = unique(ghRepos(cmd));
    if (repos.length > 0 && matchGh(cmd, repos)) return ghSuggestion(repos, cmd);
  }
  if (!has("pip3-install")) {
    const pkgs = unique(pipPackages(cmd));
    if (pkgs.length > 0 && matchPip3Install(cmd, pkgs)) return pip3Suggestion(pkgs, cmd);
  }
  if (!has("npm-script")) {
    const scripts = unique(npmScripts(cmd));
    // Read-only npm queries (npm ls/outdated/…) match with no scripts at all.
    if (matchNpmScript(cmd, scripts)) return npmScriptSuggestion(scripts, cmd);
  }
  if (!has("python3-pipe")) {
    const codes = python3Codes(cmd, cwd);
    if (codes) {
      const delta = python3Delta(codes, [], []);
      if (delta && matchPython3Pipe(cmd, delta.imports, delta.paths, cwd)) {
        return python3Suggestion(delta.imports, delta.paths, cmd);
      }
    }
  }
  if (!has("cargo") && matchCargo(cmd)) {
    return noParamSuggestion(
      "cargo",
      "Auto-approve cargo check/build/test/clippy commands",
      "medium",
      "compiles and writes build artifacts locally",
      cmd,
    );
  }
  if (!has("go") && matchGo(cmd)) {
    return noParamSuggestion(
      "go",
      "Auto-approve go build/test/vet/fmt commands",
      "medium",
      "compiles and writes build artifacts locally",
      cmd,
    );
  }
  if (!has("git-read") && matchGitRead(cmd)) {
    return noParamSuggestion(
      "git-read",
      "Auto-approve read-only git commands",
      "low",
      undefined,
      cmd,
    );
  }
  if (!has("npx-tsc") && matchNpxTsc(cmd)) {
    return noParamSuggestion(
      "npx-tsc",
      "Auto-approve npx tsc --noEmit type checks",
      "low",
      undefined,
      cmd,
    );
  }
  // safe-inspect is the broadest matcher — try it last so more specific
  // families (git-read, cargo, go) win when they also apply.
  if (!has("safe-inspect") && matchSafeInspect(cmd)) {
    return noParamSuggestion(
      "safe-inspect",
      "Auto-approve read-only inspection commands (ls/cat/grep/…)",
      "low",
      undefined,
      cmd,
    );
  }
  return null;
}

// ── Suggestion builders ──────────────────────────────────────────────────────

function curlSuggestion(domains: string[], cmd: string): Suggestion {
  return {
    command: `anumati add curl --domain ${domains.join(",")}`,
    description: `Auto-approve curl to ${domains.join(", ")}`,
    matcher: "curl",
    configDelta: { allowed_domains: domains },
    risk: "medium",
    riskReason: "allows network requests to this domain",
    trigger: cmd,
  };
}

function ghSuggestion(repos: string[], cmd: string): Suggestion {
  return {
    command: `anumati add gh --repos ${repos.join(",")}`,
    description: `Auto-approve gh api reads for ${repos.join(", ")}`,
    matcher: "gh",
    configDelta: { allowed_repos: repos },
    risk: "medium",
    riskReason: "allows GitHub API reads for this repo",
    trigger: cmd,
  };
}

function pip3Suggestion(packages: string[], cmd: string): Suggestion {
  return {
    command: `anumati add pip3-install --packages ${packages.join(",")}`,
    description: `Auto-approve pip install of ${packages.join(", ")}`,
    matcher: "pip3-install",
    configDelta: { allowed_packages: packages },
    risk: "high",
    riskReason: "pip install runs setup code and fetches from the network",
    trigger: cmd,
  };
}

function npmScriptSuggestion(scripts: string[], cmd: string): Suggestion {
  if (scripts.length === 0) {
    return {
      command: "anumati add npm-script",
      description: "Auto-approve read-only npm/pnpm/yarn queries",
      matcher: "npm-script",
      configDelta: { matcher: "npm-script" },
      risk: "low",
      trigger: cmd,
    };
  }
  return {
    command: `anumati add npm-script --scripts ${scripts.join(",")}`,
    description: `Auto-approve npm run ${scripts.join(", ")}`,
    matcher: "npm-script",
    configDelta: { allowed_scripts: scripts },
    risk: "medium",
    riskReason: "runs package scripts which may build or modify files",
    trigger: cmd,
  };
}

function python3Suggestion(
  imports: string[],
  paths: string[],
  cmd: string,
): Suggestion {
  const flags: string[] = [];
  if (imports.length > 0) flags.push(`--imports ${imports.join(",")}`);
  if (paths.length > 0) flags.push(`--paths ${paths.join(",")}`);

  const configDelta: Record<string, unknown> = {};
  if (imports.length > 0) configDelta.allowed_imports = imports;
  if (paths.length > 0) configDelta.open = { allowed_paths: paths };

  const parts: string[] = [];
  if (imports.length > 0) parts.push(`imports ${imports.join(", ")}`);
  if (paths.length > 0) parts.push(`file access to ${paths.join(", ")}`);
  const what = parts.length > 0 ? ` (${parts.join("; ")})` : "";

  // Low-risk only when every new import is a vetted pure-stdlib module AND the
  // script needs no file access — otherwise python3 can touch local files.
  const allImportsKnownSafe =
    imports.length > 0 && imports.every((i) => KNOWN_SAFE_SET.has(i));
  const lowRisk = paths.length === 0 && allImportsKnownSafe;

  return {
    command: `anumati add python3-pipe${flags.length ? " " + flags.join(" ") : ""}`,
    description: `Auto-approve python3${what}`,
    matcher: "python3-pipe",
    configDelta,
    risk: lowRisk ? "low" : "medium",
    riskReason: lowRisk ? undefined : "python3 can read and write local files",
    trigger: cmd,
  };
}

function noParamSuggestion(
  matcher: string,
  description: string,
  risk: Suggestion["risk"],
  riskReason: string | undefined,
  cmd: string,
): Suggestion {
  return {
    command: `anumati add ${matcher}`,
    description,
    matcher,
    configDelta: { matcher },
    risk,
    riskReason,
    trigger: cmd,
  };
}

// ── Extraction helpers ───────────────────────────────────────────────────────
//
// These pull *candidate* params (domains, imports, packages, …) out of a
// command. They intentionally duplicate small bits of matcher parsing (e.g.
// httpsHostname mirrors curl.ts's extractHostname). That duplication is SAFE by
// construction: every suggestion is gated behind a re-run of the real matcher
// with the extracted params added (see nearMiss*/suggestNewRule above). If an
// extractor ever drifts from its matcher, the worst outcome is a *missed*
// suggestion — never a wrong or unsafe one, because the matcher has the final
// say on acceptance. Keep extractors permissive; let the matcher be the gate.

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function httpsHostname(token: string): string | null {
  try {
    const url = new URL(token);
    if (url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function curlHostnames(cmd: string): string[] {
  const segments = parseCompound(cmd);
  if (!segments) return [];
  const hosts: string[] = [];
  for (const seg of segments) {
    const c = classify(seg.raw);
    if (c.kind !== "curl") continue;
    for (const tok of c.argv.slice(1)) {
      const h = httpsHostname(tok);
      if (h) hosts.push(h);
    }
  }
  return hosts;
}

function ghRepos(cmd: string): string[] {
  const segments = parseCompound(cmd);
  if (!segments) return [];
  const repos: string[] = [];
  for (const seg of segments) {
    const c = classify(seg.raw);
    if (c.kind !== "gh-api") continue;
    // Find the first non-flag arg of the form repos/owner/name (flags with
    // values are skipped exactly as the gh matcher does).
    let i = 2;
    while (i < c.argv.length) {
      const arg = c.argv[i];
      if (!arg.startsWith("-")) {
        const m = arg.match(/^repos\/([^/]+\/[^/]+)/);
        if (m) repos.push(m[1]);
        break;
      }
      if (GH_FLAGS_WITH_VALUE.has(arg)) i++;
      i++;
    }
  }
  return repos;
}

const GH_FLAGS_WITH_VALUE = new Set([
  "--jq", "-q", "--header", "-H",
  "--field", "-F", "--raw-field", "-f",
  "--method", "-X", "--input", "--template", "-t",
  "--cache", "--hostname",
]);

function pipPackages(cmd: string): string[] {
  const segments = parseCompound(cmd);
  if (!segments) return [];
  const pkgs: string[] = [];
  for (const seg of segments) {
    const argv = tokenize(seg.raw);
    if (!argv) continue;
    const base = basename(argv[0]);
    if ((base !== "pip" && base !== "pip3") || argv[1] !== "install") continue;
    for (const arg of argv.slice(2)) {
      if (arg.startsWith("-")) continue;
      pkgs.push(arg.split(/[=<>!~]/)[0]);
    }
  }
  return pkgs;
}

const NPM_PMS = new Set(["npm", "pnpm", "yarn"]);
const NPM_READONLY = new Set(["ls", "list", "view", "outdated", "ping", "root", "prefix", "why", "config"]);

function npmScripts(cmd: string): string[] {
  const segments = parseCompound(cmd);
  if (!segments) return [];
  const scripts: string[] = [];
  for (const seg of segments) {
    const argv = tokenize(seg.raw);
    if (!argv) continue;
    const pm = argv[0];
    if (!NPM_PMS.has(pm)) continue;
    const sub = argv[1];
    if (!sub) continue;
    if (NPM_READONLY.has(sub)) continue; // read-only query, no script needed
    if (sub === "run") {
      if (argv[2]) scripts.push(argv[2]);
    } else if (sub === "test") {
      scripts.push("test");
    } else if ((pm === "yarn" || pm === "pnpm") && argv.length === 2) {
      scripts.push(sub);
    }
  }
  return scripts;
}

interface Python3Delta {
  imports: string[];
  paths: string[];
}

/**
 * Compute the imports / open-paths that would need allowing for the given
 * python3 code blocks. Returns null when the command can never be safely
 * approved (a blocked import, a dynamic open(), or a `..` traversal path).
 */
function python3Delta(
  codes: string[],
  allowedImports: string[],
  allowedPaths: string[],
): Python3Delta | null {
  const imports = new Set<string>();
  const paths = new Set<string>();
  for (const code of codes) {
    for (const imp of extractImports(code)) {
      if (ALWAYS_BLOCKED.has(imp)) return null;
      if (!allowedImports.includes(imp)) imports.add(imp);
    }
    const openPaths = extractOpenPaths(code);
    if (openPaths === null) return null; // dynamic open() — unverifiable
    for (const p of openPaths) {
      if (p.includes("..")) return null; // traversal — never allowed
      if (!allowedPaths.some((d) => p.startsWith(d))) paths.add(suggestedPath(p));
    }
  }
  return { imports: [...imports], paths: [...paths] };
}

function python3Codes(cmd: string, cwd: string): string[] | null {
  const segments = parseCompound(cmd);
  if (!segments) return null;
  const codes: string[] = [];
  let sawPython = false;
  for (const seg of segments) {
    const c = classify(seg.raw);
    if (c.kind === "python3-c") {
      sawPython = true;
      codes.push(c.argv[c.argv.indexOf("-c") + 1] ?? "");
    } else if (c.kind === "python3-script") {
      sawPython = true;
      try {
        codes.push(readFileSync(resolve(cwd, c.argv[1]), "utf-8"));
      } catch {
        return null; // can't read the script — can't suggest
      }
    }
  }
  return sawPython ? codes : null;
}

// For an open() path, suggest its directory (broadest useful prefix), unless
// the path is bare or rooted at "/", in which case suggest the literal path.
function suggestedPath(p: string): string {
  const dir = dirname(p);
  if (dir === "." || dir === "" || dir === "/" || dir === sep) return p;
  return dir.endsWith(sep) ? dir : dir + sep;
}

