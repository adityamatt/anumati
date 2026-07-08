# anumati configuration reference

Full reference for the config file, matchers, and CLI. For the pitch and a
quick start, see the [README](../README.md).

The config lives at `~/.claude/permissions.json` (root/global) or
`<cwd>/.claude/permissions.json` (project). Project is checked first, then root;
a call is approved if a rule in either matches.

## Writing a config by hand

`anumati init` scaffolds one for you (see [CLI](#cli), below), but you can write
it directly:

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
    { "tool": "Bash", "matcher": "git-read", "desc": "Read-only git" }
  ]
}
```

Then register the hook in `~/.claude/settings.json` (this is what `anumati init`
automates):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
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

## Rule fields

Each entry in `allow` is a rule. `tool` scopes the rule to a tool; `matcher`
selects a named matcher; the `allowed_*` fields parameterize it.

| Field                | Used by                       | Description                                                                                                                                                |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool`               | all                           | Tool name to match: `Bash`, `Read`, `Task`, …                                                                                                              |
| `matcher`            | all                           | Named matcher (see table below) — required; there is no regex fallback                                                                                     |
| `allowed_domains`    | `curl`                        | Hostnames allowed as curl targets (scheme per `scheme`, default https)                                                                                     |
| `scheme`             | `curl`                        | `https` (default) or `http` — the URL scheme required for `allowed_domains`. Use `http` for local/internal hosts; write a second rule for the other scheme |
| `allowed_imports`    | `python3-pipe`                | Python modules the code may import                                                                                                                         |
| `allowed_modules`    | `nodejs-pipe`                 | Node built-in modules the code may `require`/`import`                                                                                                      |
| `allowed_packages`   | `pip3-install`                | Packages `pip install` may install (`"*"` = any)                                                                                                           |
| `allowed_scripts`    | `npm-script`                  | `npm/pnpm/yarn run <script>` names (`"*"` = any)                                                                                                           |
| `allowed_git_ops`    | `git-write`                   | git write subcommands to allow (`add`, `commit`, `branch`, `checkout`, …); network + destructive ops are always blocked                                    |
| `allowed_repos`      | `gh`                          | `owner/repo` slugs allowed for `gh api repos/...` reads                                                                                                    |
| `open.allowed_paths` | `python3-pipe`, `nodejs-pipe` | Path prefixes a script may read — `open()` (python3) or a file-path `require()`/`import` (nodejs)                                                          |
| `subagent_type`      | `Task`                        | Exact subagent type string                                                                                                                                 |
| `desc`               | all                           | Human-readable note, logged on allow                                                                                                                       |

## Matchers

| Matcher        | Tool | Effect                                                                                                                                                                                                                                            | Key param                               |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `curl`         | Bash | allow `curl` to specific domains, https by default or http via `scheme` (+ pipe to safe builtins)                                                                                                                                                 | `allowed_domains`, `scheme`             |
| `gh`           | Bash | allow read-only `gh api repos/<owner/repo>/...`                                                                                                                                                                                                   | `allowed_repos`                         |
| `python3-pipe` | Bash | allow `python3 -c`/script with allowlisted imports, no dangerous builtins                                                                                                                                                                         | `allowed_imports`, `open.allowed_paths` |
| `nodejs-pipe`  | Bash | allow `node -e`/`-p`/script with allowlisted built-in modules, no `fs`/network/`child_process`/`eval`; a file-path `require()` is allowed only under `open.allowed_paths`                                                                         | `allowed_modules`, `open.allowed_paths` |
| `pip3-install` | Bash | allow `pip/pip3 install` of allowlisted packages (+ venv create)                                                                                                                                                                                  | `allowed_packages`                      |
| `npm-script`   | Bash | allow `npm/pnpm/yarn run <script>` + read-only queries (+ trailing `&& echo`, pipe to builtins)                                                                                                                                                   | `allowed_scripts`                       |
| `cargo`        | Bash | allow `cargo check/build/test/clippy/fmt --check/tree/…`                                                                                                                                                                                          | —                                       |
| `go`           | Bash | allow `go build/test/vet/fmt/list/doc/env(read)/mod(read)`                                                                                                                                                                                        | —                                       |
| `git-read`     | Bash | allow read-only git subcommands (status/log/diff/show/`worktree list`/…)                                                                                                                                                                          | —                                       |
| `git-write`    | Bash | allow allowlisted git write ops (add/commit/branch/checkout/`worktree add`/…); network (push/pull/fetch) and destructive/force forms (reset --hard, branch -D, --amend, rebase, clean -f, `worktree remove`) always blocked                       | `allowed_git_ops`                       |
| `npx-tsc`      | Bash | allow `npx tsc --noEmit` (+ `cd … &&` variant, pipe to builtins)                                                                                                                                                                                  | —                                       |
| `safe-inspect` | Bash | allow read-only inspection builtins (ls/cat/grep/rg/find/…)                                                                                                                                                                                       | —                                       |
| `cd`           | Bash | allow a bare `cd <dir>` into the current working directory or a subfolder                                                                                                                                                                         | —                                       |
| `vitest`       | Bash | allow `[npx] vitest run [paths/flags]` (+ `cd … &&` variant, pipe to builtins); watch mode blocked                                                                                                                                                | —                                       |
| `aws`          | Bash | allow read-only AWS CLI for supported services (`logs`, `stepfunctions`, `s3`/`s3api`) — list/describe/get/filter only; writes and local-write commands (`s3 cp`/`sync`/`rm`, `s3api get-object`) blocked (+ `cd … &&` variant, pipe to builtins) | —                                       |
| `sleep`        | Bash | allow a bare `sleep <seconds>` (single integer); no operators/redirection                                                                                                                                                                         | —                                       |
| `echo`         | Bash | allow a bare `echo …` (stdout only; file redirect blocked); common as `&& echo "=== … ==="` markers                                                                                                                                               | —                                       |
| `sed`          | Bash | allow read-only `sed` — print/delete/quit scripts (e.g. `sed -n '1,60p' file`); `-i`/`-f`/`w`/`e`/substitution blocked (+ pipe to builtins)                                                                                                       | —                                       |
| `jq`           | Bash | allow `jq <filter> [file]` (pure JSON transform; `-f` filter-file blocked; + pipe to builtins)                                                                                                                                                    | —                                       |
| `test-runner`  | Bash | allow `pytest` / `python -m pytest` / `[npx] jest` (+ `cd … &&`, pipe to builtins); `--watch`/`-u` blocked                                                                                                                                        | —                                       |

## Command composition

When no single matcher accepts the whole command, anumati splits it at top-level
`&&`, `;`, `||`, `&`, and newlines and approves only if **every** sub-command is
independently accepted by some rule. A disallowed sub-command still fails its own
check, so you can't slip a bad command past by chaining it onto a good one
(`git status && rm -rf /` is rejected).

- **Pipes are never split across rules.** `X | Y` is handed to a single matcher
  as one unit, because the pipe feeds data into `Y` and only the matcher owning
  the pipeline can judge that. (Coupled cases like `curl … | python3 -c …` are
  hand-vetted inside one matcher.)
- **`&&`, `;`, `||`, and `&` all compose**, including a background `&` — running
  independently-approved commands in parallel grants no capability that running
  them in sequence wouldn't.

## Audit

| Level     | Behavior                               |
| --------- | -------------------------------------- |
| `off`     | No logging                             |
| `matched` | Log only allow hits (default)          |
| `all`     | Log everything, including passthroughs |

Audit entries are appended as newline-delimited JSON to `audit_file`. `anumati
init` scaffolds an empty `anumati-audit.jsonl` next to the config and points
`audit_file` at it (`--no-audit` to skip). The path is taken verbatim with no
`~` expansion — use an absolute path when writing the config by hand. If
`audit_file` is unset, auditing is disabled.

### Passthrough reasons

Every **passthrough** entry (in `passthrough_file`, or `audit_file` at level
`all`) records _why_ the command was not auto-approved, so you don't have to
re-analyze it:

- `reason_code` — a stable, filterable code (below).
- `reason` — a one-line human-readable explanation.
- `offending` — for a composite command, the specific sub-command that blocked
  approval (e.g. `npm publish`), not just the first segment.

| `reason_code`        | Meaning                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `shell_substitution` | Contains `$(...)` or backticks — never parsed, for safety                                     |
| `unparseable`        | Could not be parsed (e.g. an unclosed quote)                                                  |
| `file_redirection`   | A segment writes/reads a file (`> out`, `< in`); stream redirects like `2>/dev/null` are fine |
| `dangerous_command`  | Leading command is an interpreter/shell/privileged tool, never auto-approved                  |
| `no_matcher`         | A (sub-)command that no configured rule covers — add or extend a matcher                      |

```json
{
  "ts": "…",
  "tool": "Bash",
  "command": "git status && npm publish",
  "decision": "passthrough",
  "reason_code": "no_matcher",
  "reason": "No matcher covers \"npm\".",
  "offending": "npm publish"
}
```

### Passthrough sound

When a call falls through, anumati plays a short sound to alert you a call may be
waiting. On by default, configured under `notify`:

```json
{
  "notify": {
    "sound": true,
    "sound_command": ["afplay", "/System/Library/Sounds/Funk.aiff"]
  }
}
```

| Field           | Description                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sound`         | `false` to silence the passthrough alert. Default: `true`.                                                                                                                                  |
| `sound_command` | Override the command played. Array is argv; a string is split on whitespace. When unset, a per-platform default is used: `afplay` (macOS), `paplay` (Linux), a PowerShell `beep` (Windows). |

The player is spawned detached and fire-and-forget — it never blocks the hook,
never affects the decision, and a missing player just makes no noise. The sound
fires on every _passthrough_, which is not always a visible prompt: if the tool
is already allowlisted in Claude Code's own settings, the call proceeds silently
but the sound still plays.

## Suggestion config

Tune suggestion behavior with an optional `suggest` block (all fields optional):

```json
{
  "suggest": {
    "enabled": true,
    "show": true,
    "file": "~/.claude/anumati-suggestions.jsonl",
    "debug": false
  }
}
```

| Field     | Default                               | Description                                                                                                          |
| --------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `enabled` | `true`                                | Generate suggestions on passthrough                                                                                  |
| `show`    | `true`                                | Surface the 💡 suggestion to the user (via the hook's `systemMessage`, shown with the permission prompt)             |
| `file`    | `~/.claude/anumati-suggestions.jsonl` | Where suggestions accumulate                                                                                         |
| `debug`   | `false`                               | When a command falls through and _no_ suggestion applies, print a 🔍 note explaining **why** it wasn't auto-approved |

## CLI

### `anumati init`

Scaffold a starter config, an audit log, the PreToolUse hook, a SessionStart
banner, and command-style guidance in one step:

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

Hooks are merged into existing settings (other hooks preserved) and are
idempotent. Refuses to overwrite an existing config unless `--force`; an existing
audit log is never clobbered; if `settings.json` is invalid JSON the hook step is
skipped with a warning (the config is still written). **Restart Claude Code after
init for the hooks to load.**

The **starter config** seeds broadly-useful, low-risk rules in two tiers:

- **Read-only / no-op / lint** — `safe-inspect`, `git-read`, `cd`, `sleep`,
  `echo`, `sed`, `jq`, `npx-tsc`, `cargo`, `go`.
- **Build / test runners** — `vitest`, `test-runner` (pytest/jest), `npm-script`
  (`allowed_scripts: ["*"]`). These **execute the project's own code** — remove
  them if you'd rather approve test/build runs manually.
- Plus `python3-pipe` / `nodejs-pipe` seeded with curated side-effect-free module
  sets (any `open()`/file-path `require()` is still path-checked).

Deliberately **not** seeded (opt in with `anumati add`): parameterized matchers
that are useless empty (`curl`, `gh`, `pip3-install`) and `git-write` (mutates
the repo).

### The startup banner

Each new (or resumed) session shows a one-line banner so you know anumati is
active:

```
⚡ anumati active — 15 rules, debug on
```

Surfaced via the SessionStart hook's `systemMessage`; stays silent if the config
has no rules; never disrupts startup. Skip with `--no-banner`.

### `anumati add`

Apply a suggestion (or write a rule directly). Creates the config if it doesn't
exist; merges into an existing rule of the same matcher without duplicating
values.

```bash
anumati add curl --domain api.openai.com
anumati add python3-pipe --imports pandas,numpy
anumati add nodejs-pipe --modules os,fs
anumati add pip3-install --packages flask
anumati add git-write --git-ops add,commit,branch
anumati add cargo
```

Flags: `--domain`/`--domains`, `--imports`, `--modules`, `--packages`,
`--scripts`, `--repos`, `--paths`, `--git-ops` (comma-separated or repeated).
Targets `~/.claude/permissions.json` by default; override with `--config <path>`.

### `anumati stats`

Report how many Bash calls were auto-approved vs passed through, with the
approval ratio:

```bash
anumati stats                 # root config's logs
anumati stats --project       # this folder's config
anumati stats --config <path> # a specific config
```

```
anumati stats — ~/.claude/permissions.json

  Auto-approved :    196  (43.2%)
  Passed through:    258  (56.8%)
  Total         :    454

  approve rate  ██████████░░░░░░░░░░░░░░ 43.2%
```

Counts come from `audit_file` (approvals) and `passthrough_file` (passthroughs),
classified by each entry's `decision`. Only **Bash** entries are counted. A low
approval ratio tells you where a new or extended matcher would help. Auditing
must be enabled for there to be anything to count.

### `anumati apply`

Review accumulated suggestions:

```bash
anumati apply            # list pending suggestions (deduplicated)
anumati apply --all      # apply all of them, then clear
anumati apply --clear    # discard without applying
```

### `anumati debug`

Toggle debug mode (explanations for why a passthrough wasn't approved) without
hand-editing the config:

```bash
anumati debug on            # turn on in the root config
anumati debug off           # turn off
anumati debug on --project  # target <cwd>/.claude/permissions.json instead
anumati debug on --config ./path/permissions.json
```

Some commands can't be auto-approved no matter what rule you add — a `$(...)`
substitution, a file redirection, or a command no matcher covers. With `debug`
on, anumati prints a 🔍 note explaining why instead of staying silent:

```
🔍 anumati [debug]: A segment redirects to/from a file ("> out.log"), which matchers reject.
   → Drop the file redirection so the command can be matched, or approve it manually.
```

Debug notes are surfaced via `systemMessage` (never stored), shown only on
passthrough, and always defer to a real 💡 suggestion when one is available.
`debug` works independently of `enabled`. Only flips `suggest.debug`, merging
into the existing config. Takes effect immediately (the hook re-reads the config
each call).

### `anumati --help` / `--version`

```bash
anumati --help     # usage for all subcommands (also -h)
anumati --version  # installed version (also -V)
```

Running `anumati` with no arguments in a terminal prints the same help. When
invoked as a hook, Claude Code pipes a JSON request on stdin, so the hook path
runs instead.
