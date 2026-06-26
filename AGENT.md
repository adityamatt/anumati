# anumati — agent context

PreToolUse hook for Claude Code. Intercepts tool calls, evaluates them against a JSON config, returns `allow`/`deny`/`ask` without showing a permission dialog.

## Architecture

```
stdin (JSON from Claude Code)
  └── src/index.ts          CLI entry, reads config, calls evaluate()
        └── src/matcher.ts  ruleMatches() — iterates deny then allow rules
              └── rule.matcher → src/matchers/index.ts → matchNamed()
                    ├── curl          → src/matchers/curl.ts
                    ├── rm-destructive → src/matchers/rm.ts
                    ├── sudo          → src/matchers/sudo.ts
                    ├── git-push-force → src/matchers/git.ts
                    ├── npx-tsc       → src/matchers/npx-tsc.ts
                    └── safe-read     → src/matchers/safe-read.ts
                    (curl/rm/sudo/git/npx-tsc use parseCompound + tokenize from src/parser/shell.ts)
        └── src/audit.ts    optional JSON audit log
```

## Key types

```typescript
// src/types.ts
interface Rule {
  tool?: string;
  matcher?: string;           // named matcher (required — no regex fallback)
  allowed_domains?: string[]; // used by "curl" matcher
  subagent_type?: string;
  desc?: string;
}

interface Config {
  allow: Rule[];
  deny: Rule[];
  audit?: { audit_file: string; audit_level: "all" | "matched" | "none" };
}
```

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
npm test         # vitest run (121 tests)
npm run dev      # ts-node src/index.ts (without build)
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

| Matcher | Tool | Effect | Key param |
|---|---|---|---|
| `curl` | Bash | allow curl to specific domains | `allowed_domains` |
| `rm-destructive` | Bash | deny rm -rf on / or ~ | — |
| `sudo` | Bash | deny any sudo invocation | — |
| `git-push-force` | Bash | deny git push --force / -f | — |
| `npx-tsc` | Bash | allow npx tsc --noEmit (+ cd && variant) | — |
| `safe-inspect` | Bash | allow read-only inspection builtins, standalone or piped (ls/cat/head/tail/grep/rg/find/stat/wc/…) | — |
| `git-read` | Bash | allow read-only git subcommands (status/log/diff/show/branch-list/config --get/…), pipe to safe builtins | — |
| `npm-script` | Bash | allow `npm/pnpm/yarn run <script>` for allowlisted scripts + read-only queries (ls/view/outdated) | `allowed_scripts` |
| `cargo` | Bash | allow cargo check/build/test/clippy/fmt --check/tree/… (+ cd && variant, pipe to builtins) | — |
| `go` | Bash | allow go build/test/vet/fmt/list/doc/env(read)/mod(read) (+ cd && variant, pipe to builtins) | — |
| `safe-read` | Read | allow file reads without .. traversal | — |

## Adding a new named matcher

1. Add `src/matchers/<name>.ts` — export a function taking `(command: string)` or `(filePath: string)`
2. Add case in `src/matchers/index.ts` `matchNamed()` switch — unpack from `input`
3. Add tests in `tests/matchers/<name>.test.ts`
