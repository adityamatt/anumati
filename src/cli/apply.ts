import {
  readSuggestions,
  clearSuggestions,
  type StoredSuggestion,
} from "../suggest-store.js";
import { applyAdd, type AddOptions, type AddResult } from "./add.js";

/** Collapse repeated suggestions, keeping the most recent of each `command`. */
export function deduplicateByCommand(
  suggestions: StoredSuggestion[],
): StoredSuggestion[] {
  const byCommand = new Map<string, StoredSuggestion>();
  for (const s of suggestions) byCommand.set(s.command, s);
  return [...byCommand.values()];
}

// Map a suggestion's structured configDelta to add options. We deliberately do
// NOT re-tokenize the human-readable `command` string — doing so would mangle
// any value containing whitespace (e.g. a path with a space), which could write
// a truncated, over-broad rule. The configDelta is the source of truth.
function suggestionToAddOptions(
  s: StoredSuggestion,
  config?: string,
): AddOptions {
  const d = (s.configDelta ?? {}) as Record<string, unknown>;
  const open = d.open as { allowed_paths?: unknown } | undefined;
  const asStrings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : undefined;

  return {
    matcher: s.matcher,
    config,
    domains: asStrings(d.allowed_domains),
    imports: asStrings(d.allowed_imports),
    packages: asStrings(d.allowed_packages),
    scripts: asStrings(d.allowed_scripts),
    repos: asStrings(d.allowed_repos),
    paths: asStrings(open?.allowed_paths),
  };
}

/** Apply a stored suggestion's structured delta as a config rule. */
export function applyOneSuggestion(
  s: StoredSuggestion,
  config?: string,
): AddResult | null {
  if (!s.matcher) return null;
  return applyAdd(suggestionToAddOptions(s, config));
}

/** CLI entrypoint: `anumati apply [--all] [--clear] [--config /path]` */
export function runApply(argv: string[]): void {
  const flags = argv.slice(1);
  const configIdx = flags.indexOf("--config");
  const config = configIdx !== -1 ? flags[configIdx + 1] : undefined;

  const suggestions = readSuggestions();
  if (suggestions.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  const unique = deduplicateByCommand(suggestions);

  if (flags.includes("--clear")) {
    clearSuggestions();
    console.log("✓ Suggestions cleared.");
    return;
  }

  console.log(`${unique.length} pending suggestion(s):\n`);
  for (let i = 0; i < unique.length; i++) {
    const s = unique[i];
    console.log(`  ${i + 1}. ${s.description}`);
    console.log(`     ${s.command}`);
    console.log();
  }

  if (flags.includes("--all")) {
    let applied = 0;
    for (const s of unique) {
      const result = applyOneSuggestion(s, config);
      if (result) applied++;
    }
    clearSuggestions();
    console.log(`✓ Applied ${applied} suggestion(s).`);
    return;
  }

  console.log("To apply individual suggestions, run the commands above.");
  console.log("To apply all:               anumati apply --all");
  console.log("To clear without applying:  anumati apply --clear");
}
