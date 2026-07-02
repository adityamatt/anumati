# Feature: Suggest Config Changes on Passthrough

## Goal

When anumati passes a command through (no rule matched), analyze the command and emit a suggestion to stderr showing the user exactly what config change would auto-approve it next time. This makes the config self-building — users start with zero config and expand it organically from real usage.

## Constraints

- The hook protocol only has: stdout JSON (allow/deny/passthrough), stderr (displayed to user), exit code
- There is no interactive UI — no buttons, no clicks
- Suggestions must NOT slow down the hook (5s timeout enforced by Claude Code)
- Suggestions must never change the current decision — they are informational only
- The passthrough behavior (no stdout output) must be preserved

## Architecture

```
stdin (JSON from Claude Code)
  └── src/index.ts          CLI entry, reads config, calls evaluate()
        ├── evaluate() → allow? → stdout JSON, done
        └── evaluate() → null (passthrough)?
              └── src/suggest.ts    NEW: suggest(input, allRules) → Suggestion | null
                    └── per-matcher suggestors
              └── stderr output (user sees alongside permission prompt)
              └── src/suggest-store.ts  NEW: append to suggestions file
```

## New Types

```typescript
// src/suggest.ts

export interface Suggestion {
  /** The anumati CLI command to run to apply this suggestion */
  command: string;
  /** Human-readable one-liner explaining what this does */
  description: string;
  /** What matcher would handle this */
  matcher: string;
  /** The specific config fields that would need to be added/changed */
  configDelta: Record<string, unknown>;
  /** The original command/input that triggered this */
  trigger: string;
}
```

## Suggest Engine Logic

`suggest(input: HookInput, allRules: Rule[]): Suggestion | null`

The suggest engine runs ONLY when evaluate() returned null. It does two things:

### 1. Check "near miss" — existing rule that almost matched

For each rule in the config, check if the command would have matched if the rule's allowlist was expanded. Examples:

| Matcher        | Near-miss condition                                                                                    | Suggestion                           |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `curl`         | Command is `curl https://X` and X is not in `allowed_domains`                                          | "Add `X` to allowed_domains"         |
| `python3-pipe` | Command is `python3 -c "import foo"` and `foo` not in `allowed_imports` but also not in ALWAYS_BLOCKED | "Add `foo` to allowed_imports"       |
| `python3-pipe` | Script uses `open("/path/...")` and path not in `open.allowed_paths`                                   | "Add `/path/` to open.allowed_paths" |
| `nodejs-pipe`  | Command is `node -e "require('foo')"` and `foo` not in `allowed_modules` but also not in ALWAYS_BLOCKED | "Add `foo` to allowed_modules"       |
| `pip3-install` | Command is `pip3 install X` and X not in `allowed_packages`                                            | "Add `X` to allowed_packages"        |
| `npm-script`   | Command is `npm run X` and X not in `allowed_scripts`                                                  | "Add `X` to allowed_scripts"         |
| `gh`           | Command is `gh api repos/owner/repo/...` and repo not in `allowed_repos`                               | "Add `owner/repo` to allowed_repos"  |

### 2. Check "no rule at all" — recognizable command without any matching rule

If no near-miss was found, classify the command and suggest adding a new rule entirely:

| Classified as                        | Suggestion                                              |
| ------------------------------------ | ------------------------------------------------------- |
| `curl` (to domain X)                 | `anumati add curl --domain X`                           |
| `python3-c` or `python3-script`      | `anumati add python3-pipe --imports <detected imports>` |
| `nodejs-e` or `nodejs-script`        | `anumati add nodejs-pipe --modules <detected modules>`  |
| `git` (read-only subcommand)         | `anumati add git-read`                                  |
| `safe-builtin` (ls, cat, grep, etc.) | `anumati add safe-inspect`                              |
| Tool is `Read`                       | `anumati add safe-read`                                 |
| Cargo subcommand                     | `anumati add cargo`                                     |
| Go subcommand                        | `anumati add go`                                        |
| npm/pnpm/yarn run X                  | `anumati add npm-script --scripts X`                    |
| pip3 install X                       | `anumati add pip3-install --packages X`                 |

## Implementation: suggest.ts

```typescript
import type { HookInput, Rule } from "./types.js";
import { parseCompound, tokenize } from "./parser/shell.js";
import { classify } from "./classifiers/index.js";
import { extractImports, ALWAYS_BLOCKED } from "./classifiers/python3.js";

export interface Suggestion {
  command: string;
  description: string;
  matcher: string;
  configDelta: Record<string, unknown>;
  trigger: string;
}

export function suggest(input: HookInput, allRules: Rule[]): Suggestion | null {
  // Only suggest for Bash and Read tools
  if (input.tool_name === "Bash") return suggestBash(input, allRules);
  if (input.tool_name === "Read") return suggestRead(input, allRules);
  return null;
}

function suggestBash(input: HookInput, allRules: Rule[]): Suggestion | null {
  const cmd = input.tool_input.command ?? "";
  if (!cmd) return null;

  // Try near-miss first
  const nearMiss = findNearMiss(cmd, allRules, input);
  if (nearMiss) return nearMiss;

  // Try classifying the command for a fresh rule suggestion
  return suggestNewRule(cmd, input);
}

function suggestRead(input: HookInput, allRules: Rule[]): Suggestion | null {
  const filePath = input.tool_input.file_path ?? "";
  if (!filePath) return null;

  // Check if there's already a safe-read rule
  const hasReadRule = allRules.some((r) => r.matcher === "safe-read");
  if (hasReadRule) return null; // Rule exists, file just has traversal — don't suggest

  return {
    command: `anumati add safe-read`,
    description: "Auto-approve file reads (blocks path traversal)",
    matcher: "safe-read",
    configDelta: { tool: "Read", matcher: "safe-read" },
    trigger: filePath,
  };
}
```

### Near-miss detection (per matcher):

```typescript
function findNearMiss(
  cmd: string,
  allRules: Rule[],
  input: HookInput,
): Suggestion | null {
  // For each Bash rule, check if the command is "close" to matching
  for (const rule of allRules) {
    if (rule.tool && rule.tool !== "Bash") continue;
    if (!rule.matcher) continue;

    switch (rule.matcher) {
      case "curl": {
        const miss = nearMissCurl(cmd, rule);
        if (miss) return miss;
        break;
      }
      case "python3-pipe": {
        const miss = nearMissPython3(cmd, rule, input.cwd ?? "");
        if (miss) return miss;
        break;
      }
      case "pip3-install": {
        const miss = nearMissPip3(cmd, rule);
        if (miss) return miss;
        break;
      }
      case "npm-script": {
        const miss = nearMissNpmScript(cmd, rule);
        if (miss) return miss;
        break;
      }
      case "gh": {
        const miss = nearMissGh(cmd, rule);
        if (miss) return miss;
        break;
      }
    }
  }
  return null;
}
```

Each `nearMissX` function reuses the same parsing logic as the matcher but identifies exactly what blocked it (which domain, which import, which package, which script).

## Implementation: suggest-store.ts

```typescript
import { appendFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Suggestion } from "./suggest.js";

const SUGGESTIONS_FILE = join(
  homedir(),
  ".claude",
  "anumati-suggestions.jsonl",
);

export function storeSuggestion(suggestion: Suggestion): void {
  const entry = {
    ts: new Date().toISOString(),
    ...suggestion,
  };
  try {
    appendFileSync(SUGGESTIONS_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // never block execution
  }
}

export function readSuggestions(): (Suggestion & { ts: string })[] {
  if (!existsSync(SUGGESTIONS_FILE)) return [];
  try {
    return readFileSync(SUGGESTIONS_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function clearSuggestions(): void {
  try {
    writeFileSync(SUGGESTIONS_FILE, "");
  } catch {}
}
```

## Implementation: Changes to src/index.ts

```typescript
// After the existing evaluate logic, when passthrough:
import { suggest } from "./suggest.js";
import { storeSuggestion } from "./suggest-store.js";

// ... existing main() logic ...

if (projectResult.decision === "allow" || rootResult.decision === "allow") {
  // ... existing allow output ...
} else {
  // Passthrough — generate suggestion
  const allRules = [
    ...(projectConfig?.allow ?? []),
    ...(rootConfig?.allow ?? []),
  ];
  const suggestion = suggest(input, allRules);

  if (suggestion) {
    process.stderr.write(
      `💡 anumati: ${suggestion.description}\n` +
        `   Run: ${suggestion.command}\n`,
    );
    storeSuggestion(suggestion);
  }
}
```

## Implementation: `anumati add` CLI subcommand

### Routing in src/index.ts

The binary entrypoint needs to detect whether it's being called as a hook (stdin piped from Claude Code) or as a CLI subcommand:

```typescript
// At the top of main():
const subcommand = process.argv[2];
if (subcommand === "add") {
  runAdd();
  return;
}
if (subcommand === "apply") {
  runApply();
  return;
}
// ... otherwise proceed with hook logic (config path is now argv[2] only if it's a file path)
```

### src/cli/add.ts

```typescript
import { readFileSync, writeFileSync } from "fs";
import { resolveConfigPath } from "../config.js";

/**
 * anumati add <matcher> [--domain X] [--imports X,Y] [--packages X] [--scripts X] [--repos X]
 *
 * Adds or extends a rule in permissions.json
 */
export function runAdd(): void {
  const args = process.argv.slice(3); // after "anumati add"
  const matcher = args[0];
  if (!matcher) {
    console.error(
      "Usage: anumati add <matcher> [--domain X] [--imports X,Y] ...",
    );
    process.exit(1);
  }

  const opts = parseAddArgs(args.slice(1));
  const configPath = opts.config ?? resolveConfigPath();
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const rules: Rule[] = config.allow ?? [];

  // Find existing rule with same matcher, or create new
  let rule = rules.find((r) => r.matcher === matcher);
  if (!rule) {
    rule = { tool: toolForMatcher(matcher), matcher };
    rules.push(rule);
  }

  // Merge new values into rule
  if (opts.domains) mergeArray(rule, "allowed_domains", opts.domains);
  if (opts.imports) mergeArray(rule, "allowed_imports", opts.imports);
  if (opts.packages) mergeArray(rule, "allowed_packages", opts.packages);
  if (opts.scripts) mergeArray(rule, "allowed_scripts", opts.scripts);
  if (opts.repos) mergeArray(rule, "allowed_repos", opts.repos);
  if (opts.paths) {
    if (!rule.open) rule.open = { allowed_paths: [] };
    mergeArray(rule.open, "allowed_paths", opts.paths);
  }

  config.allow = rules;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`✓ Updated ${configPath}`);
  console.log(`  Rule: ${matcher} — ${JSON.stringify(rule)}`);
}

function toolForMatcher(matcher: string): string {
  if (matcher === "safe-read") return "Read";
  return "Bash";
}

function mergeArray(obj: any, key: string, values: string[]): void {
  obj[key] = [...new Set([...(obj[key] ?? []), ...values])];
}
```

### src/cli/apply.ts

```typescript
import { readSuggestions, clearSuggestions } from "../suggest-store.js";

/**
 * anumati apply — interactively review and apply accumulated suggestions
 */
export function runApply(): void {
  const suggestions = readSuggestions();

  if (suggestions.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  // Deduplicate by command (same suggestion may fire multiple times)
  const unique = deduplicateByCommand(suggestions);

  console.log(`${unique.length} pending suggestion(s):\n`);
  for (let i = 0; i < unique.length; i++) {
    const s = unique[i];
    console.log(`  ${i + 1}. ${s.description}`);
    console.log(`     ${s.command}`);
    console.log();
  }

  console.log("To apply individual suggestions, run the commands above.");
  console.log("To apply all: anumati apply --all");
  console.log("To clear without applying: anumati apply --clear");

  if (process.argv.includes("--all")) {
    for (const s of unique) {
      // Execute each add command programmatically
      applyOneSuggestion(s);
    }
    clearSuggestions();
    console.log(`\n✓ Applied ${unique.length} suggestions.`);
  } else if (process.argv.includes("--clear")) {
    clearSuggestions();
    console.log("✓ Suggestions cleared.");
  }
}
```

## stderr Output Format

Keep it concise — Claude Code shows this inline with the permission prompt:

```
💡 anumati: Auto-approve "python3 analyze.py" → add "pandas" to allowed_imports
   Run: anumati add python3-pipe --imports pandas
```

For new rules:

```
💡 anumati: Auto-approve cargo commands
   Run: anumati add cargo
```

For curl domains:

```
💡 anumati: Auto-approve curl to api.openai.com
   Run: anumati add curl --domain api.openai.com
```

## Config Changes

Add optional `suggest` field to Config:

```typescript
export interface SuggestConfig {
  enabled?: boolean; // default: true
  file?: string; // default: ~/.claude/anumati-suggestions.jsonl
  stderr?: boolean; // default: true (show in terminal)
}

export interface Config {
  audit?: AuditConfig;
  suggest?: SuggestConfig;
  allow?: Rule[];
}
```

## Testing Strategy

### Unit tests for suggest.ts

For each matcher's near-miss logic:

- Command that would match if domain/import/package/script was added → returns correct Suggestion
- Command that wouldn't match regardless (e.g., shell injection) → returns null
- Command that already matches (rule works) → suggest not called (evaluate handles it)

### Unit tests for cli/add.ts

- Adding a domain to an existing curl rule → merges without duplicates
- Adding an import to a new python3-pipe rule → creates rule with correct structure
- Multiple adds → accumulate correctly
- Nonexistent config file → helpful error message

### Integration test

- End-to-end: pipe a HookInput that doesn't match → verify stderr contains suggestion
- End-to-end: run `anumati add curl --domain example.com` → verify config file updated

## File Structure (new/modified files)

```
src/
  index.ts              ← MODIFIED: add routing for subcommands, call suggest on passthrough
  suggest.ts            ← NEW: suggest engine
  suggest-store.ts      ← NEW: read/write suggestions JSONL file
  classifiers/
    python3.ts          ← MODIFIED: export extractImports and ALWAYS_BLOCKED (currently private)
  cli/
    add.ts              ← NEW: `anumati add` subcommand
    apply.ts            ← NEW: `anumati apply` subcommand
tests/
  suggest.test.ts       ← NEW
  cli/
    add.test.ts         ← NEW
    apply.test.ts       ← NEW
```

## Edge Cases

1. **Performance**: suggest() must not slow the hook. All analysis is in-process (no file I/O except writing the suggestion). The suggest-store write is fire-and-forget.

2. **Repeated suggestions**: The suggestions JSONL file may accumulate duplicates. `anumati apply` deduplicates by `command` field.

3. **Dangerous commands**: If a command contains shell injection patterns (`$()`, backticks), `parseCompound()` returns null. suggest() returns null too — we don't suggest rules for unsafe commands.

4. **ALWAYS_BLOCKED imports**: If python3 code imports `os` or `subprocess`, don't suggest adding it to allowed_imports. Instead, return null (no suggestion — this command shouldn't be auto-approved).

5. **No config file exists**: If neither root nor project config exists, and a suggestion would make sense, suggest creating the config: `anumati init` (stretch goal).

6. **Config path resolution**: `anumati add` needs to know which config to modify. Default: `~/.claude/permissions.json`. Flag: `--config /path/to/file`.

## Implementation Order

1. Export `extractImports` and `ALWAYS_BLOCKED` from `classifiers/python3.ts`
2. Implement `src/suggest.ts` with near-miss logic for curl, python3-pipe, pip3-install, npm-script, gh
3. Implement `src/suggest.ts` new-rule classification fallback
4. Implement `src/suggest-store.ts`
5. Modify `src/index.ts` to call suggest on passthrough and output stderr
6. Implement `src/cli/add.ts`
7. Implement `src/cli/apply.ts`
8. Add subcommand routing to `src/index.ts`
9. Write tests
10. Update AGENT.md
