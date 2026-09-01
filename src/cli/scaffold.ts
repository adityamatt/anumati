import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Config, Rule } from "../types.js";
import { defaultConfigPath } from "../config.js";
import { MATCHERS, type MatcherInfo } from "../matchers/registry.js";

export interface ScaffoldOptions {
  config?: string;
}

export interface ScaffoldResult {
  configPath: string;
  created: boolean; // whether the config file was newly created
  added: MatcherInfo[]; // matchers written as disabled placeholders this run
  alreadyPresent: string[]; // matcher names that already had a rule (any state)
}

/**
 * Advertise the full matcher catalog in a config. For every matcher anumati
 * supports (src/matchers/registry.ts) that does NOT already have a rule, add a
 * DISABLED placeholder — `{ tool, matcher, enabled: false, desc }`. That makes
 * the matcher visible in the config (and printable by the CLI) without turning
 * it on: evaluate() skips `enabled:false` rules, and suggest() treats them as
 * absent. Enabling one is a deliberate `anumati add <matcher>`, which clears the
 * flag.
 *
 * A matcher counts as "present" if any rule already names it — enabled OR
 * disabled — so this is idempotent and never disturbs a rule you turned on.
 * Pure with respect to argv (takes parsed options); mirrors applyAdd's file I/O.
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

  return { configPath, created, added, alreadyPresent };
}

function parseScaffoldArgs(args: string[]): ScaffoldOptions {
  const opts: ScaffoldOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--config requires a value");
      }
      opts.config = value;
    }
    // Unknown flags ignored quietly, matching `anumati add`.
  }
  return opts;
}

/** CLI entrypoint: `anumati scaffold [--config /path]` */
export function runScaffold(argv: string[]): void {
  const args = argv.slice(1); // drop the "scaffold" token

  let result: ScaffoldResult;
  try {
    result = applyScaffold(parseScaffoldArgs(args));
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
  }
  console.log(`  Enable one with: anumati add <matcher>`);
}
