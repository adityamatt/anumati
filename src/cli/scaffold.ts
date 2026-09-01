import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { Config, HookInput, Rule } from "../types.js";
import { defaultConfigPath } from "../config.js";
import { evaluate } from "../matcher.js";
import { suggest } from "../suggest.js";
import { MATCHERS, type MatcherInfo } from "../matchers/registry.js";

export interface ScaffoldOptions {
  config?: string;
  /** Passthrough log to analyze for per-matcher coverage. Defaults to the
   *  config's `audit.passthrough_file`, else ~/.claude/anumati-passthrough.jsonl. */
  log?: string;
  /** Skip reading the passthrough log entirely (no coverage annotations). */
  skipLog?: boolean;
  /** cwd used when replaying logged commands through the matchers (the log does
   *  not store one; a wrong cwd only ever under-counts, never over-approves). */
  cwd?: string;
}

/** How many passthrough commands a single matcher would cover if enabled. */
export interface PassthroughStat {
  matcher: string;
  distinct: number; // distinct commands attributed to this matcher
  occurrences: number; // total log lines (a command may repeat)
}

export interface PassthroughCoverage {
  logPath: string;
  found: boolean;
  totalPassthroughs: number; // total log lines read (all occurrences)
  byMatcher: PassthroughStat[]; // matchers with ≥1 hit, most occurrences first
}

export interface ScaffoldResult {
  configPath: string;
  created: boolean; // whether the config file was newly created
  added: MatcherInfo[]; // matchers written as disabled placeholders this run
  alreadyPresent: string[]; // matcher names that already had a rule (any state)
  coverage: PassthroughCoverage | null; // null when log analysis was skipped
}

/** The passthrough log anumati writes fall-through calls to, by convention. */
function defaultPassthroughLog(config: Config | null): string {
  return (
    config?.audit?.passthrough_file ??
    join(homedir(), ".claude", "anumati-passthrough.jsonl")
  );
}

// Rebuild the hook input for a logged entry so we can replay it through the
// real matchers. Read/Write/Edit carry a file_path; everything else a command.
function inputFor(command: string, tool: string, cwd: string): HookInput {
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    return { session_id: "scaffold", tool_name: tool, tool_input: { file_path: command }, cwd };
  }
  return { session_id: "scaffold", tool_name: tool, tool_input: { command }, cwd };
}

/**
 * Read the passthrough log and, for each unique command NOT already auto-approved
 * by the current (enabled) rules, ask the real suggest engine which matcher would
 * cover it. Grouping those answers gives, per matcher, how many fall-through
 * commands enabling it would address — the same evaluate()/suggest() logic the
 * live hook uses, so the count can never disagree with what the hook would do.
 */
export function analyzePassthroughCoverage(
  logPath: string,
  rules: Rule[],
  cwd = "",
): PassthroughCoverage {
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return { logPath, found: false, totalPassthroughs: 0, byMatcher: [] };
  }

  // Dedupe by normalized command, keeping an occurrence count (mirrors the
  // triage script). Store one rebuilt input per distinct command.
  const byCommand = new Map<string, { input: HookInput; count: number }>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { command?: string; file_path?: string; tool?: string };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const command = obj.command ?? obj.file_path;
    if (!command) continue;
    const key = String(command).replace(/\s+/g, " ").trim();
    const prev = byCommand.get(key);
    if (prev) {
      prev.count++;
      continue;
    }
    byCommand.set(key, { input: inputFor(command, obj.tool ?? "Bash", cwd), count: 1 });
  }

  // Baseline: rules currently in force. Disabled placeholders are already
  // ignored by evaluate/suggest, but filter explicitly so the intent is clear.
  const active = rules.filter((r) => r.enabled !== false);

  const stats = new Map<string, PassthroughStat>();
  let totalPassthroughs = 0;
  for (const { input, count } of byCommand.values()) {
    totalPassthroughs += count;
    // Already covered by today's config → enabling anything new wouldn't help it.
    if (evaluate(input, active).decision === "allow") continue;
    const s = suggest(input, active);
    if (!s?.matcher) continue;
    const cur = stats.get(s.matcher) ?? { matcher: s.matcher, distinct: 0, occurrences: 0 };
    cur.distinct += 1;
    cur.occurrences += count;
    stats.set(s.matcher, cur);
  }

  const byMatcher = [...stats.values()].sort(
    (a, b) => b.occurrences - a.occurrences || b.distinct - a.distinct,
  );
  return { logPath, found: true, totalPassthroughs, byMatcher };
}

/**
 * Advertise the full matcher catalog in a config. For every matcher anumati
 * supports (src/matchers/registry.ts) that does NOT already have a rule, add a
 * DISABLED placeholder — `{ tool, matcher, enabled: false, desc }`. That makes
 * the matcher visible in the config without turning it on: evaluate() skips
 * `enabled:false` rules, and suggest() treats them as absent. Enabling one is a
 * deliberate `anumati add <matcher>`, which clears the flag.
 *
 * Additionally analyzes the passthrough log so the caller can show, per added
 * matcher, how many fall-through commands enabling it would cover.
 *
 * A matcher counts as "present" if any rule already names it — enabled OR
 * disabled — so this is idempotent and never disturbs a rule you turned on.
 */
export function applyScaffold(opts: ScaffoldOptions = {}): ScaffoldResult {
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
  const present = new Set(rules.filter((r) => r.matcher).map((r) => r.matcher));

  const added: MatcherInfo[] = [];
  const alreadyPresent: string[] = [];
  for (const m of MATCHERS) {
    if (present.has(m.name)) {
      alreadyPresent.push(m.name);
      continue;
    }
    // `enabled: false` is what marks this "available but off"; the desc stays
    // the plain catalog summary (no "run anumati add …" hint) so it doesn't go
    // stale once the user enables the rule. How-to-enable is printed by the CLI.
    rules.push({ tool: "Bash", matcher: m.name, enabled: false, desc: m.desc });
    added.push(m);
  }

  config.allow = rules;

  // Only touch disk when something changed (or the file didn't exist yet), so a
  // no-op scaffold doesn't rewrite a config the user hand-formatted.
  if (added.length > 0 || created) {
    const dir = dirname(configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  const coverage = opts.skipLog
    ? null
    : analyzePassthroughCoverage(opts.log ?? defaultPassthroughLog(config), rules, opts.cwd ?? "");

  return { configPath, created, added, alreadyPresent, coverage };
}

function parseScaffoldArgs(args: string[]): ScaffoldOptions {
  const opts: ScaffoldOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-log") {
      opts.skipLog = true;
      continue;
    }
    if (arg === "--config" || arg === "--log") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--config") opts.config = value;
      else opts.log = value;
      continue;
    }
    // Unknown flags ignored quietly, matching `anumati add`.
  }
  return opts;
}

// One tab-indented coverage line under a matcher, or "" when it has no hits.
function coverageLine(matcher: string, coverage: PassthroughCoverage | null): string {
  const stat = coverage?.byMatcher.find((s) => s.matcher === matcher);
  if (!stat) return "";
  const extra = stat.occurrences > stat.distinct ? ` (${stat.occurrences} occurrences)` : "";
  return `\t↳ ${stat.distinct} passthrough command(s) this matcher would cover${extra}`;
}

/** CLI entrypoint: `anumati scaffold [--config /path] [--log /path] [--no-log]` */
export function runScaffold(argv: string[]): void {
  const args = argv.slice(1); // drop the "scaffold" token

  let result: ScaffoldResult;
  try {
    result = applyScaffold({ ...parseScaffoldArgs(args), cwd: process.cwd() });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  if (result.created) console.log(`✓ Created ${result.configPath}`);
  else console.log(`✓ Updated ${result.configPath}`);

  if (result.added.length === 0) {
    console.log(
      `  All ${result.alreadyPresent.length} supported matcher(s) already present — nothing to add.`,
    );
    return;
  }

  console.log(
    `  Added ${result.added.length} matcher(s) as disabled placeholders` +
      `${result.alreadyPresent.length ? ` (${result.alreadyPresent.length} already present)` : ""}:`,
  );
  for (const m of result.added) {
    console.log(`    • ${m.name} — ${m.desc}`);
    const cov = coverageLine(m.name, result.coverage);
    if (cov) console.log(cov);
  }
  console.log(`  Enable one with: anumati add <matcher>`);

  // Footnote so the numbers are attributable (or their absence explained).
  if (result.coverage && !result.coverage.found) {
    console.log(`  (no passthrough log at ${result.coverage.logPath} — skipping coverage counts)`);
  } else if (result.coverage) {
    console.log(
      `  Coverage counts from ${result.coverage.logPath} (${result.coverage.totalPassthroughs} passthrough(s) analyzed).`,
    );
  }
}
