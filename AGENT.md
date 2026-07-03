# anumati — agent context

PreToolUse hook for Claude Code. Intercepts tool calls, evaluates them against a JSON config, returns `allow`/`deny`/`ask` without showing a permission dialog.

## Architecture

```
stdin (JSON from Claude Code)
  └── src/index.ts          CLI entry; routes `add`/`apply` subcommands, else runs the hook
        ├── src/config.ts   defaultConfigPath / projectConfigPath / loadConfig
        ├── src/matcher.ts  evaluate() — iterates allow rules in order
        │     └── rule.matcher → src/matchers/index.ts → matchNamed()
        │           ├── curl / gh / python3-pipe / nodejs-pipe / pip3-install / npm-script  (parameterized)
        │           └── cargo / go / git-read / npx-tsc / safe-inspect / safe-read / safe-write / cd / vitest
        │           (most use parseCompound + tokenize from src/parser/shell.ts,
        │            classify from src/classifiers/index.ts, python3 safety from classifiers/python3.ts,
        │            nodejs safety from classifiers/nodejs.ts)
        ├── src/audit.ts    optional JSON audit log
        └── on passthrough:
              src/suggest.ts        suggest(input, allRules) → Suggestion | null
                                    (extracts candidate params, then re-runs the REAL matcher
                                     to verify the suggestion would actually allow the command)
              src/suggest-store.ts  append/read/clear ~/.claude/anumati-suggestions.jsonl
              src/cli/add.ts        applyAdd() — merge/create a rule in permissions.json
              src/cli/apply.ts      list/dedupe/apply accumulated suggestions
```

## Key types

```typescript
// src/types.ts
interface Rule {
  tool?: string;
  matcher?: string;            // named matcher (required — no regex fallback)
  allowed_domains?: string[];  // curl
  allowed_imports?: string[];  // python3-pipe
  allowed_modules?: string[];  // nodejs-pipe
  allowed_repos?: string[];    // gh
  allowed_packages?: string[]; // pip3-install
  allowed_scripts?: string[];  // npm-script
  open?: { allowed_paths: string[] }; // python3-pipe open()
  subagent_type?: string;
  desc?: string;
}

interface Config {
  allow?: Rule[];                  // allow-only; first match wins. No deny list.
  audit?: { audit_file?: string; audit_level?: "off" | "matched" | "all" };
  suggest?: { enabled?: boolean; show?: boolean; file?: string; debug?: boolean };
  //          show: surface 💡/🔍 to user (stderr = deprecated alias). debug: explain passthroughs.
}
```

## Surfacing messages to the user

PreToolUse hook **stderr is invisible in the UI on exit 0** (debug-log only). To show 💡 suggestions and 🔍 debug notes, the hook writes `{"systemMessage": "…"}` to **stdout** and omits `permissionDecision` — Claude Code displays the message while the call stays on its normal passthrough path. See `emitMessage()` in `src/index.ts`. An allow still emits `hookSpecificOutput.permissionDecision = "allow"` as before.

**SessionStart banner.** `anumati session-start [config]` (src/cli/session-start.ts) runs as a SessionStart hook and prints `{"systemMessage":"⚡ anumati active — N rules[, debug on]"}`. Note: for SessionStart, plain stdout is added to *Claude's context*, not shown to the user — so the banner MUST use `systemMessage` (not bare stdout). It stays silent (no output) when the config is missing or has no rules, and never throws. `anumati init` registers it (src/cli/settings.ts `buildBannerCommand`/`mergeAnumatiBanner`), skippable with `--no-banner`.

## Shell parser invariants

- `parseCompound()` returns `null` for: dangerous chars (`` ` `` `$`), unclosed quotes
- `raw` field on each `Segment` is the original substring (quotes preserved)
- `tokenize()` strips quotes for argv extraction
- Trailing background `&` → one segment with `operator: "&"`

## curl matcher rules

- Only `https://` URLs accepted
- Domain extracted via `new URL().hostname` (spoofing-proof)
- Only `|` operator between segments allowed — `;`, `&&`, `||`, `&` all rejected
- `safe-builtin` segments (grep/head/jq etc.) allowed only when piped from curl

## Commands

```
npm run build    # tsc → dist/
npm test         # vitest run
npm run dev      # ts-node src/index.ts (without build)
anumati add <matcher> [--domain/--imports/--modules/--packages/--scripts/--repos/--paths X[,Y]] [--config P]
anumati apply [--all|--clear] [--config P]
```

## Config location

Default: `~/.claude/permissions.json`. Pass alternate path as first arg.

## Hook wiring (in ~/.claude/settings.json)

```json
"PreToolUse": [{
  "matcher": "Bash|Read|Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "node /path/to/anumati/dist/index.js /path/to/permissions.json",
    "timeout": 5
  }]
}]
```

## Available matchers

anumati is **allow-only** — there is no deny list. Matchers approve safe patterns; anything unmatched falls through to Claude Code's dialog.

| Matcher | Tool | Effect | Key param |
|---|---|---|---|
| `curl` | Bash | allow curl to specific https domains (+ pipe to safe builtins) | `allowed_domains` |
| `gh` | Bash | allow read-only `gh api repos/<owner/repo>/...` (no write methods) | `allowed_repos` |
| `python3-pipe` | Bash | allow `python3 -c`/script with allowlisted imports, no dangerous builtins/dynamic open() | `allowed_imports`, `open.allowed_paths` |
| `nodejs-pipe` | Bash | allow `node -e`/`-p`/script with allowlisted built-in modules; fs/network/child_process/vm/os always blocked, no eval/Function/dynamic require | `allowed_modules` |
| `pip3-install` | Bash | allow `pip/pip3 install` of allowlisted packages (+ venv create, `&& echo`) | `allowed_packages` |
| `npm-script` | Bash | allow `npm/pnpm/yarn run <script>` for allowlisted scripts + read-only queries (ls/view/outdated) | `allowed_scripts` |
| `cargo` | Bash | allow cargo check/build/test/clippy/fmt --check/tree/… (+ cd && variant, pipe to builtins) | — |
| `go` | Bash | allow go build/test/vet/fmt/list/doc/env(read)/mod(read) (+ cd && variant, pipe to builtins) | — |
| `git-read` | Bash | allow read-only git subcommands (status/log/diff/show/branch-list/config --get/…), pipe to safe builtins | — |
| `npx-tsc` | Bash | allow npx tsc --noEmit (+ cd && variant) | — |
| `safe-inspect` | Bash | allow read-only inspection builtins, standalone or piped (ls/cat/head/tail/grep/rg/find/stat/wc/…) | — |
| `safe-read` | Read | allow file reads without .. traversal | — |
| `safe-write` | Write/Edit | allow writes whose resolved path is contained within an allowlisted directory | `allowed_write_paths` |
| `cd` | Bash | allow a bare `cd <dir>` where the resolved target is the cwd or a subfolder (no operators, no redirection, no `..` escaping cwd) | — |
| `vitest` | Bash | allow `[npx] vitest run [paths/flags]` (+ cd && variant, pipe to builtins); `run` subcommand required so interactive watch mode is blocked | — |

## Adding a new named matcher

1. Add `src/matchers/<name>.ts` — export a function taking `(command: string)` or `(filePath: string)`
2. Add case in `src/matchers/index.ts` `matchNamed()` switch — unpack from `input`
3. Add tests in `tests/matchers/<name>.test.ts`
4. If the command shape is recognizable, teach `src/suggest.ts` to suggest it (add a `suggestNewRule` branch, and a near-miss branch if it has an allowlist param)

## Suggest engine (src/suggest.ts)

Runs only on passthrough. Two strategies:

1. **Near-miss** — an existing rule with an allowlist (`curl`/`python3-pipe`/`nodejs-pipe`/`pip3-install`/`npm-script`/`gh`) that would match if a domain/import/module/package/script/repo were added.
2. **New rule** — classify the command and suggest adding a matcher that doesn't exist in the config yet. Specific families are tried before the broad `safe-inspect` (e.g. `git log` → `git-read`, not `safe-inspect`).

**Invariant — suggestions are verified, never hand-rolled.** Each suggestor extracts candidate params, then re-runs the *real matcher* with those params added; a `Suggestion` is emitted only if the matcher then accepts the command. This guarantees suggestions can't drift from matcher logic and can never propose something unsafe — `ALWAYS_BLOCKED` imports, `gh` write methods, dynamic `open()`, `..` traversal, and shell substitution all make the matcher reject, so no suggestion is produced. When extending a matcher, the suggestor stays correct automatically as long as it re-verifies.

`storeSuggestion` appends to the JSONL store fire-and-forget (never throws). `anumati apply` re-parses each stored suggestion's own `command` string through `applyAdd` — the `add` CLI is the single source of truth for writing config.
