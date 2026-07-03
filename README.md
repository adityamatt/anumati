# anumati

*अनुमति — Sanskrit/Hindi for "permission"*

A `PreToolUse` hook for [Claude Code](https://code.claude.com) that auto-allows safe tool calls based on a JSON config of **named matchers** — so you stop getting prompted for the same commands repeatedly. When a command falls through, anumati can **suggest** the exact config change that would auto-approve it next time, so your config builds itself from real usage.

## How it works

Every time Claude Code is about to run a tool (Bash, Read, …), this hook intercepts the request and checks it against your allow rules. anumati is **allow-only**: it can auto-approve a call or stay out of the way, but it never blocks anything itself.

1. **A rule matches** → the call is auto-approved, with no prompt.
2. **No rule matches** → Claude Code shows its normal permission dialog, and anumati surfaces a 💡 suggestion (via the hook's `systemMessage`) showing how to allow it next time.

Because every rule can only ever *allow*, rule order doesn't affect the decision — if any rule matches, the call is approved. (Internally the first match wins and short-circuits, which is what gets recorded in the audit log.)

Configs cascade: a project config at `<cwd>/.claude/permissions.json` is checked first, then your global `~/.claude/permissions.json`. A call is approved if a rule in *either* matches.

### One rule must cover the whole command

A command is approved only if a **single** rule's matcher accepts it in full — including every `&&`, `|`, and `;` segment. anumati never stitches multiple rules together to cover different parts of one command, so you can't slip a disallowed command past the gate by chaining it onto an allowed one. For example, with `cargo` and `curl` rules configured, `cargo build && curl https://evil.com` is **not** approved: the `cargo` rule rejects the `curl` segment, the `curl` rule rejects the `cargo` segment, and the call falls through to the permission dialog.

Matchers do understand compound commands within their own safe vocabulary. The `curl` matcher, for instance, allows piping into read-only builtins (`curl https://api.github.com/repos | jq .`), and `cargo`/`go` allow a leading `cd <dir> &&`. But that awareness is scoped to the one matcher — it is never a license to mix segments belonging to different rules.

## Install

```bash
npm install -g anumati
```

Or run without installing via `npx anumati ~/.claude/permissions.json`.

## Setup

The fastest way — one command does everything:

```bash
anumati init
```

`anumati init` prompts whether to set up a **project** config (this folder) or a **root** config (global, applies everywhere), shows which already exist, and then:

1. **Writes a starter config** of low-risk rules so anumati is useful immediately: `safe-read`, `safe-inspect`, `git-read`, `npx-tsc`, a `python3-pipe` rule pre-allowing a curated set of **pure-stdlib** Python modules (`json`, `math`, `statistics`, `datetime`, `re`, `hashlib`, …), and a `nodejs-pipe` rule pre-allowing the equivalent set of **pure-compute** Node built-ins (`path`, `crypto`, `url`, `util`, `buffer`, `zlib`, …). Those modules have no file, network, or code-execution entry points. For python3 any `open()` in your script is still path-checked; for node the filesystem module `fs` (along with `child_process`/`net`/`http`/`os`/`vm`) is blocked outright — so blessing these doesn't widen file or network access. (Libraries with I/O side channels like `numpy`/`pandas`, and any npm package, are deliberately **not** included; add them explicitly with `anumati add` if you accept the risk.)
2. **Scaffolds an audit log** (`anumati-audit.jsonl`) next to the config.
3. **Registers the PreToolUse hook** in the `settings.json` beside the config, so Claude Code actually calls anumati — merging into any existing settings without clobbering them. **Restart Claude Code (or run `/hooks`)** for it to take effect.
4. **Adds a SessionStart banner** — a `⚡ anumati active — N rules` message shown at the start of each session so you can see at a glance that anumati is wired up.

Pass `--project` / `--root` to skip the prompt, `--force` to overwrite an existing config, and `--no-audit` / `--no-hook` / `--no-banner` / `--no-steer` to skip those steps. Add more rules as you go with `anumati add` (see below).

---

Prefer to do it by hand? Write the config yourself — a fuller example:

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

…then wire it into `~/.claude/settings.json` yourself (this is what `anumati init` automates):

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
| `allowed_modules` | `nodejs-pipe` | Node built-in modules the code may `require`/`import` |
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
| `nodejs-pipe` | Bash | allow `node -e`/`-p`/script with allowlisted built-in modules, no `fs`/network/`child_process`/`eval` | `allowed_modules` |
| `pip3-install` | Bash | allow `pip/pip3 install` of allowlisted packages (+ venv create) | `allowed_packages` |
| `npm-script` | Bash | allow `npm/pnpm/yarn run <script>` + read-only queries | `allowed_scripts` |
| `cargo` | Bash | allow `cargo check/build/test/clippy/fmt --check/tree/…` | — |
| `go` | Bash | allow `go build/test/vet/fmt/list/doc/env(read)/mod(read)` | — |
| `git-read` | Bash | allow read-only git subcommands (status/log/diff/show/…) | — |
| `npx-tsc` | Bash | allow `npx tsc --noEmit` (+ `cd … &&` variant) | — |
| `safe-inspect` | Bash | allow read-only inspection builtins (ls/cat/grep/rg/find/…) | — |
| `safe-read` | Read | allow file reads without `..` path traversal | — |
| `safe-write` | Write/Edit | allow writes whose resolved path stays within an allowlisted directory | `allowed_write_paths` |
| `cd` | Bash | allow a bare `cd <dir>` into the current working directory or a subfolder | — |

### Audit levels

| Level | Behavior |
|-------|----------|
| `off` | No logging |
| `matched` | Log only allow hits (default) |
| `all` | Log everything, including passthroughs |

Audit entries are appended as newline-delimited JSON to `audit_file`. `anumati init` sets this up for you — it scaffolds an empty `anumati-audit.jsonl` next to the config and points `audit_file` at it (pass `--no-audit` to skip). The path is taken verbatim with no `~` expansion, so set an absolute path if you write the config by hand. If `audit_file` is unset, auditing is disabled entirely.

### Passthrough sound

When a call falls through (anumati did not auto-approve it, so Claude Code's own permission flow takes over — often a prompt), anumati plays a short sound to alert you that a call may be waiting. It's **on by default** and configured under `notify`:

```json
{
  "notify": {
    "sound": true,
    "sound_command": ["afplay", "/System/Library/Sounds/Funk.aiff"]
  }
}
```

| Field | Description |
|-------|-------------|
| `sound` | `false` to silence the passthrough alert. Default: `true`. |
| `sound_command` | Override the command played. Array is argv; a string is split on whitespace. When unset, a per-platform default is used: `afplay` (macOS), `paplay` (Linux), a PowerShell `beep` (Windows). |

The player is spawned detached and fire-and-forget — it never blocks the hook, never affects the permission decision, and a missing player just makes no noise. Note the sound fires on every *passthrough*, which is not always a visible prompt: if the tool is already allowlisted in Claude Code's own settings, the call proceeds silently but the sound still plays.

## Suggestions — let the config build itself

When a command falls through to the permission dialog, anumati analyzes it and prints the exact config change that would auto-approve it:

```
┌───────────────────────────────────────────────
│ 💡 anumati: Auto-approve curl to api.openai.com
│    Run: anumati add curl --domain api.openai.com
└───────────────────────────────────────────────
```

Every suggestion is **verified** — anumati only suggests a change if re-running the real matcher with that change would actually allow the command. Commands that can never be safely approved (e.g. `python3 -c "import os"`, `gh api ... -X POST`, anything with shell substitution) produce **no** suggestion.

Suggestions are also appended to `~/.claude/anumati-suggestions.jsonl` so you can review them in a batch later.

## Command-style guide for the LLM

The complement to matchers is teaching the agent to *emit* approvable commands
in the first place — one command per call, no stray redirections or `echo`
scaffolding, dedicated tools over shelling out.

`anumati init` writes this guidance automatically: it adds a managed block to
the `CLAUDE.md` beside your config (created if absent, and updated in place on
re-run without touching your own content), so Claude Code loads it into every
session and keeps routine work on the silent auto-approve path. Skip it with
`--no-steer`. The full, in-depth version lives in
[`docs/COMMAND-STYLE.md`](docs/COMMAND-STYLE.md) for reference.

### `anumati init`

Scaffold a starter config, an audit log, and the PreToolUse hook in one step:

```bash
anumati init             # prompts: project (this folder) or root (global)?
anumati init --project   # write <cwd>/.claude/permissions.json (skip prompt)
anumati init --root      # write ~/.claude/permissions.json (skip prompt)
anumati init --force     # overwrite an existing config
anumati init --no-audit  # don't scaffold the audit log
anumati init --no-hook   # don't register the hook in settings.json
anumati init --no-banner # don't add the SessionStart "⚡ anumati active" banner
anumati init --no-steer  # don't add command-style guidance to the sibling CLAUDE.md
anumati init --debug     # start with debug mode on (explains passthroughs)
```

Shows which configs already exist, then writes the chosen config, an empty `anumati-audit.jsonl`, a PreToolUse hook, and a SessionStart banner in the `settings.json` beside it. Hooks are merged into existing settings (other hooks preserved) and are idempotent. Refuses to overwrite an existing config unless `--force` is given; an existing audit log is never clobbered, and if `settings.json` is invalid JSON the hook step is skipped with a warning (the config is still written). **Restart Claude Code after init for the hooks to load.**

### The startup banner

Once wired, each new (or resumed) session shows a one-line banner so you know anumati is active:

```
⚡ anumati active — 5 rules, debug on
```

It reports the rule count and whether debug mode is on. It's surfaced via the SessionStart hook's `systemMessage`, stays silent if the config has no rules, and never disrupts startup. Skip it with `anumati init --no-banner`.

### `anumati add`

Apply a suggestion (or write a rule directly). Creates the config file if it doesn't exist; merges into an existing rule of the same matcher without duplicating values.

```bash
anumati add curl --domain api.openai.com
anumati add python3-pipe --imports pandas,numpy
anumati add nodejs-pipe --modules os,fs
anumati add pip3-install --packages flask
anumati add cargo
anumati add safe-read
```

Flags: `--domain`/`--domains`, `--imports`, `--modules`, `--packages`, `--scripts`, `--repos`, `--paths` (comma-separated or repeated). Targets `~/.claude/permissions.json` by default; override with `--config <path>`.

### `anumati apply`

Review accumulated suggestions:

```bash
anumati apply            # list pending suggestions (deduplicated)
anumati apply --all      # apply all of them, then clear
anumati apply --clear    # discard without applying
```

### `anumati --help` / `--version`

```bash
anumati --help     # usage for all subcommands (also -h)
anumati --version  # installed version (also -V)
```

Running `anumati` with no arguments in a terminal prints the same help. When invoked as a hook, Claude Code pipes a JSON request on stdin, so the hook path runs instead.

### Suggestion config

Tune behavior with an optional `suggest` block (all fields optional):

```json
{
  "suggest": {
    "enabled": true,
    "show": true,
    "file": "~/.claude/anumati-suggestions.jsonl",
    "debug": false
  },
  "allow": []
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Generate suggestions on passthrough |
| `show` | `true` | Surface the 💡 suggestion to the user (via the hook's `systemMessage`, shown with the permission prompt) |
| `file` | `~/.claude/anumati-suggestions.jsonl` | Where suggestions accumulate |
| `debug` | `false` | When a command falls through and *no* suggestion applies, print a 🔍 note explaining **why** it wasn't auto-approved |

### Debug mode — why didn't this get approved?

Some commands can't be auto-approved no matter what rule you add — a `;`-separated chain, a redirection like `2>/dev/null`, `$(...)` substitution, or a command no matcher covers. Normally anumati stays silent in those cases (no actionable suggestion exists). Turn on `debug` while expanding your config to get an explanation instead:

```
🔍 anumati [debug]: Command chains segments with ";", which no matcher accepts (it means independent commands).
   → Split this into separate tool calls, or use `&&` if a matcher supports it (e.g. `cd X && cargo build`).
```

Debug notes are surfaced via the hook's `systemMessage` (never stored), shown only on passthrough, and always defer to a real 💡 suggestion when one is available. `debug` works independently of `enabled`, so you can keep suggestions off and still get diagnostics.

Toggle it without hand-editing the config:

```bash
anumati debug on            # turn on in the root config (~/.claude/permissions.json)
anumati debug off           # turn off
anumati debug on --project  # target <cwd>/.claude/permissions.json instead
anumati debug on --config ./path/permissions.json
```

`anumati debug` only flips `suggest.debug`, merging into the existing config (rules, audit, and other suggest fields are preserved). It needs a config to already exist — run `anumati init` (or `anumati init --debug` to start with it on) first. Because the hook re-reads the config on every call, a toggle takes effect immediately — no restart needed.

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
