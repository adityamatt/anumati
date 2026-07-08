import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Config, Rule } from "../types.js";
import { defaultConfigPath } from "../config.js";

export interface AddOptions {
  matcher: string;
  domains?: string[];
  imports?: string[];
  modules?: string[];
  packages?: string[];
  scripts?: string[];
  repos?: string[];
  paths?: string[];
  gitOps?: string[];
  config?: string;
}

export interface AddResult {
  configPath: string;
  rule: Rule;
  created: boolean; // whether the config file was newly created
}

// The tool a fresh rule for this matcher should target. anumati vets Bash
// commands only, so every matcher targets Bash.
function toolForMatcher(_matcher: string): string {
  return "Bash";
}

function mergeArray(
  obj: Record<string, unknown>,
  key: string,
  values: string[],
): void {
  const existing = (obj[key] as string[] | undefined) ?? [];
  obj[key] = [...new Set([...existing, ...values])];
}

/**
 * Add or extend a rule in a permissions config. Pure with respect to argv —
 * takes already-parsed options and performs the file read/write. Returns the
 * resulting rule and config path. Reused by `anumati apply`.
 */
export function applyAdd(opts: AddOptions): AddResult {
  const configPath = opts.config ?? defaultConfigPath();

  let config: Config;
  let created = false;
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
  } else {
    config = { allow: [] };
    created = true;
  }

  const rules: Rule[] = config.allow ?? [];

  let rule = rules.find((r) => r.matcher === opts.matcher);
  if (!rule) {
    rule = { tool: toolForMatcher(opts.matcher), matcher: opts.matcher };
    rules.push(rule);
  }

  const r = rule as unknown as Record<string, unknown>;
  if (opts.domains) mergeArray(r, "allowed_domains", opts.domains);
  if (opts.imports) mergeArray(r, "allowed_imports", opts.imports);
  if (opts.modules) mergeArray(r, "allowed_modules", opts.modules);
  if (opts.packages) mergeArray(r, "allowed_packages", opts.packages);
  if (opts.scripts) mergeArray(r, "allowed_scripts", opts.scripts);
  if (opts.repos) mergeArray(r, "allowed_repos", opts.repos);
  if (opts.gitOps) mergeArray(r, "allowed_git_ops", opts.gitOps);
  if (opts.paths) {
    if (!rule.open) rule.open = { allowed_paths: [] };
    mergeArray(rule.open as unknown as Record<string, unknown>, "allowed_paths", opts.paths);
  }

  config.allow = rules;

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  return { configPath, rule, created };
}

const LIST_FLAGS: Record<string, keyof AddOptions> = {
  "--domain": "domains",
  "--domains": "domains",
  "--imports": "imports",
  "--modules": "modules",
  "--packages": "packages",
  "--scripts": "scripts",
  "--repos": "repos",
  "--paths": "paths",
  "--git-ops": "gitOps",
};

// A flag's value must exist and not itself be another flag.
function takeValue(args: string[], i: number, flag: string): string {
  const value = args[i];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseAddArgs(args: string[]): AddOptions {
  const matcher = args[0];
  const opts: AddOptions = { matcher };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") {
      opts.config = takeValue(args, ++i, arg);
      continue;
    }
    const key = LIST_FLAGS[arg];
    if (key) {
      const value = takeValue(args, ++i, arg);
      const items = value.split(",").map((s) => s.trim()).filter(Boolean);
      const prev = (opts[key] as string[] | undefined) ?? [];
      (opts[key] as string[]) = [...prev, ...items];
      continue;
    }
    // Unknown flag — ignore quietly so the CLI stays forgiving.
  }

  return opts;
}

/** CLI entrypoint: `anumati add <matcher> [flags]` */
export function runAdd(argv: string[]): void {
  const args = argv.slice(1); // drop the "add" token
  const matcher = args[0];
  if (!matcher || matcher.startsWith("--")) {
    console.error(
      "Usage: anumati add <matcher> [--domain X] [--imports X,Y] [--modules X,Y] [--packages X] [--scripts X] [--repos X] [--paths X] [--git-ops X,Y] [--config /path]",
    );
    process.exit(1);
  }

  let result: AddResult;
  try {
    result = applyAdd(parseAddArgs(args));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  if (result.created) console.log(`✓ Created ${result.configPath}`);
  else console.log(`✓ Updated ${result.configPath}`);
  console.log(`  Rule: ${result.rule.matcher} — ${JSON.stringify(result.rule)}`);
}
