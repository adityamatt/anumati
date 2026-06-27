# anumati

*अनुमति — Sanskrit/Hindi for "permission"*

A `PreToolUse` hook for [Claude Code](https://code.claude.com) that auto-allows safe tool calls based on a JSON config of **named matchers** — so you stop getting prompted for the same commands repeatedly. When a command falls through, anumati can **suggest** the exact config change that would auto-approve it next time, so your config builds itself from real usage.

## How it works

Every time Claude Code is about to run a tool (Bash, Read, …), this hook intercepts the request and checks it against your allow rules:

1. **Allow rules** are evaluated in order — the first matching rule auto-approves the call.
2. **No match** — Claude Code shows the normal permission dialog, and anumati prints a 💡 suggestion to stderr showing how to allow it next time.

Configs cascade: a project config at `<cwd>/.claude/permissions.json` is checked first, then your global `~/.claude/permissions.json`.

## Install

```bash
npm install -g anumati
```

Or run without installing via `npx anumati ~/.claude/permissions.json`.

## Setup

**1. Create a config file** at `~/.claude/permissions.json`:

```json
{
  "audit": {
    "audit_file": "/tmp/anumati.json",
    "audit_level": "matched"
  },
  "allow": [
    {
      "tool": "Bash",
      "matcher": "curl",
      "allowed_domains": ["raw.githubusercontent.com", "api.github.com"],
      "desc": "GitHub reads"
    },
    { "tool": "Bash", "matcher": "npx-tsc", "desc": "TypeScript type checking" },
    { "tool": "Bash", "matcher": "git-read", "desc": "Read-only git" },
    { "tool": "Read", "matcher": "safe-read", "desc": "File reads (no path traversal)" }
  ]
}
```

**2. Wire into `~/.claude/settings.json`**:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "anumati ~/.claude/permissions.json",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## Config reference

### Rule fields

Each entry in `allow` is a rule. `tool` scopes the rule to a tool; `matcher` selects a named matcher; the `allowed_*` fields parameterize it.

| Field | Used by | Description |
|-------|---------|-------------|
| `tool` | all | Tool name to match: `Bash`, `Read`, `Task`, … |
| `matcher` | all | Named matcher (see table below) — required; there is no regex fallback |
| `allowed_domains` | `curl` | Hostnames allowed as `https://` curl targets |
| `allowed_imports` | `python3-pipe` | Python modules the code may import |
| `allowed_packages` | `pip3-install` | Packages `pip install` may install (`"*"` = any) |
| `allowed_scripts` | `npm-script` | `npm/pnpm/yarn run <script>` names (`"*"` = any) |
| `allowed_repos` | `gh` | `owner/repo` slugs allowed for `gh api repos/...` reads |
| `open.allowed_paths` | `python3-pipe` | Path prefixes a script may `open()` |
| `subagent_type` | `Task` | Exact subagent type string |
| `desc` | all | Human-readable note, logged on allow |

### Available matchers

| Matcher | Tool | Effect | Key param |
|---|---|---|---|
| `curl` | Bash | allow `curl` to specific https domains (+ pipe to safe builtins) | `allowed_domains` |
| `gh` | Bash | allow read-only `gh api repos/<owner/repo>/...` | `allowed_repos` |
| `python3-pipe` | Bash | allow `python3 -c`/script with allowlisted imports, no dangerous builtins | `allowed_imports`, `open.allowed_paths` |
| `pip3-install` | Bash | allow `pip/pip3 install` of allowlisted packages (+ venv create) | `allowed_packages` |
| `npm-script` | Bash | allow `npm/pnpm/yarn run <script>` + read-only queries | `allowed_scripts` |
| `cargo` | Bash | allow `cargo check/build/test/clippy/fmt --check/tree/…` | — |
| `go` | Bash | allow `go build/test/vet/fmt/list/doc/env(read)/mod(read)` | — |
| `git-read` | Bash | allow read-only git subcommands (status/log/diff/show/…) | — |
| `npx-tsc` | Bash | allow `npx tsc --noEmit` (+ `cd … &&` variant) | — |
| `safe-inspect` | Bash | allow read-only inspection builtins (ls/cat/grep/rg/find/…) | — |
| `safe-read` | Read | allow file reads without `..` path traversal | — |

### Audit levels

| Level | Behavior |
|-------|----------|
| `off` | No logging |
| `matched` | Log only allow hits (default) |
| `all` | Log everything, including passthroughs |

Audit entries are appended as newline-delimited JSON to `audit_file`.

## Suggestions — let the config build itself

When a command falls through to the permission dialog, anumati analyzes it and prints the exact config change that would auto-approve it:

```
💡 anumati: Auto-approve curl to api.openai.com
   Run: anumati add curl --domain api.openai.com
   ⚠️  medium risk: allows network requests to this domain
```

Every suggestion is **verified** — anumati only suggests a change if re-running the real matcher with that change would actually allow the command. Commands that can never be safely approved (e.g. `python3 -c "import os"`, `gh api ... -X POST`, anything with shell substitution) produce **no** suggestion.

Suggestions are also appended to `~/.claude/anumati-suggestions.jsonl` so you can review them in a batch later.

### `anumati add`

Apply a suggestion (or write a rule directly). Creates the config file if it doesn't exist; merges into an existing rule of the same matcher without duplicating values.

```bash
anumati add curl --domain api.openai.com
anumati add python3-pipe --imports pandas,numpy
anumati add pip3-install --packages flask
anumati add cargo
anumati add safe-read
```

Flags: `--domain`/`--domains`, `--imports`, `--packages`, `--scripts`, `--repos`, `--paths` (comma-separated or repeated). Targets `~/.claude/permissions.json` by default; override with `--config <path>`.

### `anumati apply`

Review accumulated suggestions:

```bash
anumati apply            # list pending suggestions (deduplicated)
anumati apply --all      # apply all of them, then clear
anumati apply --clear    # discard without applying
```

### Suggestion config

Tune behavior with an optional `suggest` block (all fields optional):

```json
{
  "suggest": {
    "enabled": true,
    "stderr": true,
    "file": "~/.claude/anumati-suggestions.jsonl"
  },
  "allow": []
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Generate suggestions on passthrough |
| `stderr` | `true` | Print the 💡 suggestion inline with the permission prompt |
| `file` | `~/.claude/anumati-suggestions.jsonl` | Where suggestions accumulate |

## Development

```bash
git clone https://github.com/your-username/anumati
cd anumati
npm install
npm run build
npm test
```

## License

MIT
