import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { createInterface } from "readline/promises";
import type { Config, Rule } from "../types.js";
import { defaultConfigPath, projectConfigPath } from "../config.js";
import { KNOWN_SAFE_IMPORTS } from "../classifiers/python3.js";
import { KNOWN_SAFE_MODULES } from "../classifiers/nodejs.js";
import {
  settingsFileFor,
  buildHookCommand,
  buildBannerCommand,
  wireAnumatiHook,
  type WireResult,
} from "./settings.js";
import { claudeMdFileFor, wireSteerFile, type SteerResult } from "./steer.js";

// Safe, parameter-free starter rules. All low-risk and broadly useful, so a
// fresh user gets immediate value without having to hand-write any allowlists.
// Parameterized matchers needing user-specific values (curl/pip3-install/
// npm-script/gh) are omitted — add those later via `anumati add`. The
// python3-pipe rule is seeded with a curated pure-stdlib import set: those
// modules have no file/network/exec capability, and any open() in user code is
// still path-checked separately, so this does not widen filesystem access.
export const STARTER_RULES: Rule[] = [
  { tool: "Read", matcher: "safe-read", desc: "File reads (no path traversal)" },
  { tool: "Bash", matcher: "safe-inspect", desc: "Read-only inspection (ls/cat/grep/find/…)" },
  { tool: "Bash", matcher: "git-read", desc: "Read-only git (status/log/diff/…)" },
  { tool: "Bash", matcher: "npx-tsc", desc: "TypeScript type checking (npx tsc --noEmit)" },
  {
    tool: "Bash",
    matcher: "python3-pipe",
    allowed_imports: [...KNOWN_SAFE_IMPORTS],
    desc: "python3 using pure-stdlib modules (no file/network/exec)",
  },
  {
    tool: "Bash",
    matcher: "nodejs-pipe",
    allowed_modules: [...KNOWN_SAFE_MODULES],
    desc: "node using pure-compute built-in modules (no fs/network/child_process)",
  },
];

// The audit log lives next to the config it belongs to, as newline-delimited
// JSON. An absolute path is used because the audit writer does no cwd
// resolution — a relative path would land wherever the hook happens to run.
export function auditFileFor(configPath: string): string {
  return join(dirname(configPath), "anumati-audit.jsonl");
}

// Non-approved (passthrough) calls are logged separately from approvals, in a
// sibling file — same directory + absolute-path rationale as auditFileFor.
export function passthroughFileFor(configPath: string): string {
  return join(dirname(configPath), "anumati-passthrough.jsonl");
}

export function starterConfig(auditFile?: string, debug = false, passthroughFile?: string): Config {
  const config: Config = {};
  if (auditFile) {
    // "matched" logs only allow hits — low-noise but useful for review. A
    // separate passthrough_file captures the calls that fell through, so denials
    // are recorded without mixing them into the approvals log.
    config.audit = { audit_file: auditFile, audit_level: "matched" };
    if (passthroughFile) config.audit.passthrough_file = passthroughFile;
  }
  if (debug) {
    config.suggest = { debug: true };
  }
  config.allow = STARTER_RULES;
  return config;
}

export type InitLevel = "root" | "project";

export interface InitOptions {
  config?: string; // explicit path override (wins over level)
  level?: InitLevel;
  cwd?: string; // for resolving the project path; defaults to process.cwd()
  force?: boolean;
  audit?: boolean; // scaffold an audit block + log file (default: true)
  hook?: boolean; // register the PreToolUse hook in settings.json (default: true)
  banner?: boolean; // register the SessionStart "anumati active" banner (default: true)
  steer?: boolean; // add the command-style guidance block to CLAUDE.md (default: true)
  debug?: boolean; // seed suggest.debug in the starter config (default: false)
  // How anumati was launched — used to build the hook command. Injected for
  // testability; default to the real process values in runInit().
  argv1?: string;
  execPath?: string;
}

export interface InitResult {
  configPath: string;
  ruleCount: number;
  auditFile?: string; // set when an audit log was scaffolded
  passthroughFile?: string; // set when a passthrough (denials) log was scaffolded
  hook?: WireResult; // set when hook wiring succeeded
  hookError?: string; // set when hook wiring failed (non-fatal — config still written)
  steer?: SteerResult; // set when the CLAUDE.md guidance block was written
  steerError?: string; // set when steer wiring failed (non-fatal — config still written)
}

export interface LevelStatus {
  level: InitLevel;
  path: string;
  exists: boolean;
}

/** Replace the home directory prefix with ~ for friendlier display. */
export function prettyPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** Report whether a config already exists at each level for the given cwd. */
export function configStatus(cwd: string): LevelStatus[] {
  const project = projectConfigPath(cwd);
  const root = defaultConfigPath();
  return [
    { level: "project", path: project, exists: existsSync(project) },
    { level: "root", path: root, exists: existsSync(root) },
  ];
}

/** Resolve which file an init should target, or null if it must be chosen interactively. */
export function resolveInitTarget(opts: InitOptions): string | null {
  if (opts.config) return opts.config;
  if (opts.level === "root") return defaultConfigPath();
  if (opts.level === "project") return projectConfigPath(opts.cwd ?? process.cwd());
  return null;
}

/**
 * Scaffold a starter permissions config at `configPath`. Refuses to overwrite
 * an existing file unless `force` is set. Pure with respect to argv. Throws on
 * an existing file (without force) or a write failure.
 */
export function applyInit(opts: InitOptions & { config: string }): InitResult {
  const configPath = opts.config;

  if (existsSync(configPath) && !opts.force) {
    throw new Error(
      `${prettyPath(configPath)} already exists. Use --force to overwrite, or edit it directly / use \`anumati add\`.`,
    );
  }

  const withAudit = opts.audit !== false; // default on
  const auditFile = withAudit ? auditFileFor(configPath) : undefined;
  const passthroughFile = withAudit ? passthroughFileFor(configPath) : undefined;
  const config = starterConfig(auditFile, opts.debug === true, passthroughFile);

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Create the logs empty so they are immediately visible next to the config.
  // Never clobber an existing log (only the config write is gated by --force).
  if (auditFile && !existsSync(auditFile)) {
    writeFileSync(auditFile, "");
  }
  if (passthroughFile && !existsSync(passthroughFile)) {
    writeFileSync(passthroughFile, "");
  }

  // Register the PreToolUse hook in the settings.json beside this config, so
  // Claude Code actually invokes anumati. Idempotent and non-destructive: it
  // merges into existing settings and skips if an anumati hook already exists.
  // A wiring failure (e.g. settings.json is invalid JSON) is reported but NOT
  // fatal — the config + audit log were already written successfully.
  let hook: WireResult | undefined;
  let hookError: string | undefined;
  if (opts.hook !== false) {
    const argv1 = opts.argv1 ?? process.argv[1] ?? "anumati";
    const execPath = opts.execPath ?? process.execPath;
    const command = buildHookCommand(configPath, argv1, execPath);
    // Also register the SessionStart banner unless opted out.
    const bannerCommand =
      opts.banner !== false
        ? buildBannerCommand(configPath, argv1, execPath)
        : undefined;
    try {
      hook = wireAnumatiHook(settingsFileFor(configPath), command, bannerCommand);
    } catch (err) {
      hookError = (err as Error).message;
    }
  }

  // Add the command-style guidance to the CLAUDE.md beside this config, so the
  // agent is steered toward emitting auto-approvable commands. Idempotent and
  // non-destructive: it updates only its own managed block, preserving any
  // existing CLAUDE.md content. Non-fatal on failure — the config is written.
  let steer: SteerResult | undefined;
  let steerError: string | undefined;
  if (opts.steer !== false) {
    try {
      steer = wireSteerFile(claudeMdFileFor(configPath));
    } catch (err) {
      steerError = (err as Error).message;
    }
  }

  return { configPath, ruleCount: config.allow?.length ?? 0, auditFile, passthroughFile, hook, hookError, steer, steerError };
}

export function parseInitArgs(args: string[]): InitOptions {
  const opts: InitOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      opts.force = true;
    } else if (arg === "--root" || arg === "--global") {
      opts.level = "root";
    } else if (arg === "--project" || arg === "--local") {
      opts.level = "project";
    } else if (arg === "--no-audit") {
      opts.audit = false;
    } else if (arg === "--no-hook") {
      opts.hook = false;
    } else if (arg === "--no-banner") {
      opts.banner = false;
    } else if (arg === "--no-steer") {
      opts.steer = false;
    } else if (arg === "--debug") {
      opts.debug = true;
    } else if (arg === "--config") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--config requires a value");
      }
      opts.config = value;
    }
    // Unknown flag — ignore quietly, matching the other subcommands.
  }
  return opts;
}

function printStatus(cwd: string): void {
  console.log("anumati config status:");
  for (const s of configStatus(cwd)) {
    const label = s.level === "project" ? "project (this folder)" : "root (global)     ";
    const mark = s.exists ? "✓ exists    " : "– not created";
    console.log(`  ${label}  ${mark}  ${prettyPath(s.path)}`);
  }
  console.log();
}

// Prompt the user to choose a level in an interactive terminal. Returns the
// resolved path, or null if they cancel.
async function promptForTarget(cwd: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(
        "Where do you want to create a starter config?\n" +
          "  [p] project (this folder only)\n" +
          "  [r] root (global — applies to every project)\n" +
          "  [q] cancel\n> ",
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "p" || answer === "project") return projectConfigPath(cwd);
    if (answer === "r" || answer === "root") return defaultConfigPath();
    return null; // q / anything else → cancel
  } finally {
    rl.close();
  }
}

// Ask y/N before overwriting an existing config in interactive mode.
async function promptOverwrite(path: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${prettyPath(path)} already exists. Overwrite? [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function printResult(result: InitResult): void {
  console.log(`✓ Created ${prettyPath(result.configPath)} with ${result.ruleCount} starter rules:`);
  for (const r of STARTER_RULES) {
    console.log(`  • ${r.matcher} — ${r.desc}`);
  }
  if (result.auditFile) {
    console.log(`\nAudit log (allow decisions): ${prettyPath(result.auditFile)}`);
  }
  if (result.passthroughFile) {
    console.log(`Passthrough log (non-approved calls): ${prettyPath(result.passthroughFile)}`);
  }

  if (result.hookError) {
    console.log(`\n⚠️  Could not register the PreToolUse hook: ${result.hookError}`);
    console.log(`    The config above was still created. Wire the hook manually:`);
    console.log(`    "PreToolUse": [{ "matcher": "Bash|Read|Write|Edit",`);
    console.log(`      "hooks": [{ "type": "command", "command": "anumati ${prettyPath(result.configPath)}", "timeout": 5 }] }]`);
  } else if (result.hook) {
    const { settingsPath, command, changed } = result.hook;
    if (changed) {
      console.log(`\n✓ Registered the PreToolUse hook in ${prettyPath(settingsPath)}:`);
      console.log(`    ${command}`);
      console.log(`\nRestart Claude Code (or run /hooks) for it to take effect.`);
    } else {
      console.log(`\n• ${prettyPath(settingsPath)} already invokes anumati — left as-is.`);
    }
  } else {
    console.log(`\nNext: wire the hook into settings.json so Claude Code calls anumati:`);
    console.log(`    "PreToolUse": [{ "matcher": "Bash|Read|Write|Edit",`);
    console.log(`      "hooks": [{ "type": "command", "command": "anumati ${prettyPath(result.configPath)}", "timeout": 5 }] }]`);
  }

  if (result.steerError) {
    console.log(`\n⚠️  Could not update ${prettyPath(claudeMdFileFor(result.configPath))}: ${result.steerError}`);
  } else if (result.steer?.changed) {
    const verb = result.steer.created ? "Created" : "Updated";
    console.log(`\n✓ ${verb} ${prettyPath(result.steer.claudeMdPath)} with command-style guidance for the agent.`);
  } else if (result.steer) {
    console.log(`\n• ${prettyPath(result.steer.claudeMdPath)} already has the guidance block — left as-is.`);
  }

  console.log(`\nAdd more rules as you go, e.g. \`anumati add curl --domain api.github.com\`.`);
}

/** CLI entrypoint: `anumati init [--root|--project] [--config <path>] [--force]` */
export async function runInit(argv: string[]): Promise<void> {
  const args = argv.slice(1); // drop the "init" token
  let opts: InitOptions;
  try {
    opts = parseInitArgs(args);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const cwd = opts.cwd ?? process.cwd();

  // Always show where configs already exist so the choice is informed.
  printStatus(cwd);

  let target = resolveInitTarget({ ...opts, cwd });

  if (!target) {
    if (!process.stdin.isTTY) {
      console.error(
        "✗ Specify a level: `anumati init --root` (global) or `anumati init --project` (this folder).",
      );
      process.exit(1);
    }
    target = await promptForTarget(cwd);
    if (!target) {
      console.log("Cancelled. No config created.");
      return;
    }
  }

  // Handle an existing target: honor --force, otherwise prompt in a TTY, else error.
  if (existsSync(target) && !opts.force) {
    if (process.stdin.isTTY) {
      const ok = await promptOverwrite(target);
      if (!ok) {
        console.log("Cancelled. Existing config left unchanged.");
        return;
      }
      opts.force = true;
    } else {
      console.error(
        `✗ ${prettyPath(target)} already exists. Use --force to overwrite, or edit it directly / use \`anumati add\`.`,
      );
      process.exit(1);
    }
  }

  try {
    const result = applyInit({ ...opts, config: target });
    printResult(result);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
