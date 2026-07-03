import { readFileSync, existsSync } from "fs";
import type { Config } from "../types.js";
import { defaultConfigPath, projectConfigPath, loadConfig } from "../config.js";
import { prettyPath } from "./init.js";

export interface StatsCmdOptions {
  config?: string; // explicit path (wins over level)
  level?: "root" | "project";
  cwd?: string;
}

export interface Stats {
  allowed: number;
  passthrough: number;
  total: number;
  /** allowed / total, 0 when total is 0. */
  ratio: number;
  /** allowed count per tool, most-frequent first. */
  byToolAllowed: Array<{ tool: string; count: number }>;
  /** passthrough count per tool, most-frequent first. */
  byToolPassthrough: Array<{ tool: string; count: number }>;
  /** files actually read (deduped, existing). */
  sources: string[];
}

interface Entry {
  tool?: string;
  decision?: string;
}

function resolveTarget(opts: StatsCmdOptions): string {
  if (opts.config) return opts.config;
  if (opts.level === "project") return projectConfigPath(opts.cwd ?? process.cwd());
  return defaultConfigPath(); // default: root
}

// The log files a config writes to: approvals go to audit_file, passthroughs to
// passthrough_file (or, in the legacy single-file setup, both to audit_file).
export function statsSources(config: Config): string[] {
  const files: string[] = [];
  const audit = config.audit?.audit_file;
  const passthrough = config.audit?.passthrough_file;
  if (audit) files.push(audit);
  if (passthrough && passthrough !== audit) files.push(passthrough);
  return files;
}

// Tally allow vs passthrough by reading the log(s) and classifying each line by
// its `decision` field — robust whether approvals and passthroughs live in one
// file or two. Malformed lines are skipped.
export function computeStats(config: Config): Stats {
  const allowByTool = new Map<string, number>();
  const passByTool = new Map<string, number>();
  const sources: string[] = [];

  for (const file of statsSources(config)) {
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    sources.push(file);

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry: Entry;
      try {
        entry = JSON.parse(line) as Entry;
      } catch {
        continue; // skip malformed line
      }
      const tool = entry.tool ?? "unknown";
      const target = entry.decision === "allow" ? allowByTool : passByTool;
      target.set(tool, (target.get(tool) ?? 0) + 1);
    }
  }

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const rank = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));

  const allowed = sum(allowByTool);
  const passthrough = sum(passByTool);
  const total = allowed + passthrough;

  return {
    allowed,
    passthrough,
    total,
    ratio: total === 0 ? 0 : allowed / total,
    byToolAllowed: rank(allowByTool),
    byToolPassthrough: rank(passByTool),
    sources,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bar(fraction: number, width = 24): string {
  const filled = Math.round(fraction * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatStats(stats: Stats, configPath: string): string {
  const lines: string[] = [];
  lines.push(`anumati stats — ${prettyPath(configPath)}`);

  if (stats.sources.length === 0) {
    lines.push("");
    lines.push("No audit logs found. Enable auditing (see `audit` in the config,");
    lines.push("or run `anumati init`) so decisions are recorded.");
    return lines.join("\n");
  }

  if (stats.total === 0) {
    lines.push("");
    lines.push("Logs exist but contain no decisions yet.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`  Auto-approved : ${String(stats.allowed).padStart(6)}  (${pct(stats.ratio)})`);
  lines.push(`  Passed through: ${String(stats.passthrough).padStart(6)}  (${pct(1 - stats.ratio)})`);
  lines.push(`  Total         : ${String(stats.total).padStart(6)}`);
  lines.push("");
  lines.push(`  approve rate  ${bar(stats.ratio)} ${pct(stats.ratio)}`);

  if (stats.byToolAllowed.length > 0) {
    lines.push("");
    lines.push("  Auto-approved by tool:");
    for (const { tool, count } of stats.byToolAllowed) {
      lines.push(`    ${tool.padEnd(10)} ${count}`);
    }
  }
  if (stats.byToolPassthrough.length > 0) {
    lines.push("");
    lines.push("  Passed through by tool:");
    for (const { tool, count } of stats.byToolPassthrough) {
      lines.push(`    ${tool.padEnd(10)} ${count}`);
    }
  }

  return lines.join("\n");
}

export function parseStatsArgs(args: string[]): StatsCmdOptions {
  const opts: StatsCmdOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "--global") {
      opts.level = "root";
    } else if (arg === "--project" || arg === "--local") {
      opts.level = "project";
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

/** CLI entrypoint: `anumati stats [--root|--project] [--config <path>]` */
export function runStats(argv: string[]): void {
  const args = argv.slice(1); // drop the "stats" token
  let opts: StatsCmdOptions;
  try {
    opts = parseStatsArgs(args);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const configPath = resolveTarget(opts);
  const config = loadConfig(configPath);
  if (!config) {
    console.error(
      `✗ ${prettyPath(configPath)} does not exist or is invalid. Run \`anumati init\` first.`,
    );
    process.exit(1);
  }

  console.log(formatStats(computeStats(config), configPath));
}
