# anumati — agent context

PreToolUse hook for Claude Code. Intercepts tool calls, evaluates them against a JSON config, returns `allow`/`deny`/`ask` without showing a permission dialog.

## Architecture

```
stdin (JSON from Claude Code)
  └── src/index.ts          CLI entry; routes `add`/`apply` subcommands, else runs the hook
        ├── src/config.ts   defaultConfigPath / projectConfigPath / loadConfig
        ├── src/matcher.ts  evaluate() — (1) whole-command: first rule whose matcher accepts the
        │                   full command wins; (2) sequential composition: else split on top-level
        │                   && / ; / || (and newlines, treated as ;) and approve iff every
        │                   sub-command is accepted by some rule.
        │                   Pipes are kept inside a sub-command (never composed across rules);
        │                   backgrounding & is not composed (changes execution semantics).
        │     └── rule.matcher → src/matchers/index.ts → matchNamed()
        │           ├── curl / gh / python3-pipe / nodejs-pipe / pip3-install / npm-script  (parameterized)
        │           └── cargo / go / git-read / git-write / npx-tsc / safe-inspect / cd / vitest / aws / sleep / echo / sed
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
  scheme?: "http" | "https";   // curl — required scheme for allowed_domains (default https)
  allowed_imports?: string[];  // python3-pipe
  allowed_modules?: string[];  // nodejs-pipe
  // open.allowed_paths — path prefixes for python3 open() AND nodejs file-path require()/import
  allowed_repos?: string[];    // gh
  allowed_packages?: string[]; // pip3-install
  allowed_scripts?: string[];  // npm-script
  allowed_git_ops?: string[];  // git-write
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
  "matcher": "Bash",
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
| `curl` | Bash | allow curl to specific domains (https default, or http via `scheme`; + pipe to safe builtins) | `allowed_domains`, `scheme` |
| `gh` | Bash | allow read-only `gh api repos/<owner/repo>/...` (no write methods) | `allowed_repos` |
| `python3-pipe` | Bash | allow `python3 -c`/script with allowlisted imports, no dangerous builtins/dynamic open() | `allowed_imports`, `open.allowed_paths` |
| `nodejs-pipe` | Bash | allow `node -e`/`-p`/script with allowlisted built-in modules; fs/network/child_process/vm/os always blocked, no eval/Function/dynamic require; file-path require()/import allowed only under open.allowed_paths (path-checked, no `..`) | `allowed_modules`, `open.allowed_paths` |
| `pip3-install` | Bash | allow `pip/pip3 install` of allowlisted packages (+ venv create, `&& echo`) | `allowed_packages` |
| `npm-script` | Bash | allow `npm/pnpm/yarn run <script>` for allowlisted scripts + read-only queries (ls/view/outdated); trailing `&& echo`, safe stream redirects, and pipe-to-consumer allowed | `allowed_scripts` |
| `cargo` | Bash | allow cargo check/build/test/clippy/fmt --check/tree/… (+ cd && variant, pipe to builtins) | — |
| `go` | Bash | allow go build/test/vet/fmt/list/doc/env(read)/mod(read) (+ cd && variant, pipe to builtins) | — |
| `git-read` | Bash | allow read-only git subcommands (status/log/diff/show/branch-list/config --get/…), pipe to safe builtins | — |
| `git-write` | Bash | allow allowlisted git write ops (single command); NETWORK_OPS (push/pull/fetch/clone/remote) + DESTRUCTIVE_OPS (reset/rebase/clean/gc/…) + dangerous flags (--force/--hard/-D/--amend) hard-blocked regardless of allowlist; `worktree` restricted to the `add` sub-subcommand (remove/prune/move blocked); chaining via evaluate() composition | `allowed_git_ops` |
| `npx-tsc` | Bash | allow npx tsc --noEmit (+ cd && variant, pipe to consumers) | — |
| `safe-inspect` | Bash | allow read-only inspection builtins, standalone or piped (ls/cat/head/tail/grep/rg/find/stat/wc/…) | — |
| `sed` | Bash | allow read-only sed: strict script grammar of `[N[,M]]` addresses + p/d/q/= commands only; reject `-i`/`--in-place`/`-f`/`w`/`W`/`e`/`s///`; unknown flags rejected (+ pipe to consumers) | — |
| `cd` | Bash | allow a bare `cd <dir>` where the resolved target is the cwd or a subfolder (no operators, no redirection, no `..` escaping cwd) | — |
| `vitest` | Bash | allow `[npx] vitest run [paths/flags]` (+ cd && variant, pipe to builtins); `run` subcommand required so interactive watch mode is blocked | — |
| `aws` | Bash | nested composite: dispatches on service (`logs`, `stepfunctions`, `s3`/`s3api`) to a per-service read-only subcommand allowlist (list/describe/get/filter; s3 = `ls` only, s3api = metadata reads, no get-object); all writes + local-write commands blocked (+ cd && variant, pipe to builtins) | — |
| `sleep` | Bash | allow a single bare `sleep <seconds>` (one integer arg); no operators/redirection — chaining is handled by evaluate() composition | — |

## Adding a new named matcher

1. Add `src/matchers/<name>.ts` — export a function taking `(command: string)` or `(filePath: string)`
2. Add case in `src/matchers/index.ts` `matchNamed()` switch — unpack from `input`
3. Add tests in `tests/matchers/<name>.test.ts`
4. If the command shape is recognizable, teach `src/suggest.ts` to suggest it (add a `suggestNewRule` branch, and a near-miss branch if it has an allowlist param)

For a segment-independent matcher (the command produces output that read-only
consumers pipe from — cargo/go/git-read/vitest/aws), validate trailing pipe
segments with `isSafePipeConsumer` from `src/parser/pipe.ts`. Do NOT define a
local `SAFE_PIPE_BUILTINS` set — the shared consumer allowlist is the single
source of truth, and keeping the pipe tail a curated consumer set (never another
arbitrary matched command) is what preserves the "one rule covers the whole
command" boundary.

## Suggest engine (src/suggest.ts)

Runs only on passthrough. Two strategies:

1. **Near-miss** — an existing rule with an allowlist (`curl`/`python3-pipe`/`nodejs-pipe`/`pip3-install`/`npm-script`/`gh`) that would match if a domain/import/module/package/script/repo were added.
2. **New rule** — classify the command and suggest adding a matcher that doesn't exist in the config yet. Specific families are tried before the broad `safe-inspect` (e.g. `git log` → `git-read`, not `safe-inspect`).

**Invariant — suggestions are verified, never hand-rolled.** Each suggestor extracts candidate params, then re-runs the *real matcher* with those params added; a `Suggestion` is emitted only if the matcher then accepts the command. This guarantees suggestions can't drift from matcher logic and can never propose something unsafe — `ALWAYS_BLOCKED` imports, `gh` write methods, dynamic `open()`, `..` traversal, and shell substitution all make the matcher reject, so no suggestion is produced. When extending a matcher, the suggestor stays correct automatically as long as it re-verifies.

`storeSuggestion` appends to the JSONL store fire-and-forget (never throws). `anumati apply` re-parses each stored suggestion's own `command` string through `applyAdd` — the `add` CLI is the single source of truth for writing config.
