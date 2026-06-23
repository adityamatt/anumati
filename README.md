# anumati

*अनुमति — Sanskrit/Hindi for "permission"*

A `PreToolUse` hook for [Claude Code](https://code.claude.com) that auto-allows or blocks tool calls based on configurable TOML rules — so you stop getting prompted for the same commands repeatedly.

## How it works

Every time Claude Code is about to run a tool (Bash, Read, Write, etc.), this hook intercepts the request and checks it against your rules:

1. **Deny rules** checked first — block dangerous commands
2. **Allow rules** checked second — auto-approve safe patterns
3. **No match** — Claude Code shows the normal permission dialog

## Install

```bash
npm install -g anumati
```

Or use without installing via `npx`:

```bash
npx anumati ~/.claude/permissions.toml
```

## Setup

**1. Create a config file** at `~/.claude/permissions.toml`:

```toml
[audit]
audit_file = "/tmp/anumati.json"
audit_level = "matched"  # off | matched | all

[[deny]]
tool = "Bash"
command_regex = "rm\\s+-rf\\s+[/~]"
reason = "Destructive rm on root/home blocked"

[[deny]]
tool = "Bash"
command_regex = "sudo "
reason = "sudo blocked"

[[allow]]
tool = "Bash"
command_regex = "^curl\\s.*https://raw\\.githubusercontent\\.com"
reason = "GitHub raw file reads"

[[allow]]
tool = "Bash"
command_regex = "^npx tsc --noEmit"
reason = "TypeScript type checking"
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
            "command": "anumati ~/.claude/permissions.toml",
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

| Field | Applies to | Description |
|-------|-----------|-------------|
| `tool` | all | Tool name to match: `Bash`, `Read`, `Write`, `Edit`, `Task` |
| `command_regex` | Bash | Regex matched against the full command string |
| `command_exclude_regex` | Bash | If this matches, the rule is skipped (safety escape hatch) |
| `file_path_regex` | Read/Write/Edit | Regex matched against the file path |
| `file_path_exclude_regex` | Read/Write/Edit | If this matches, the rule is skipped |
| `subagent_type` | Task | Exact match on subagent type string |
| `reason` | all | Human-readable description shown on deny; logged on allow |

All fields are optional — omitting a field means "match anything" for that dimension.

### Audit levels

| Level | Behavior |
|-------|----------|
| `off` | No logging |
| `matched` | Log only allow/deny hits (default) |
| `all` | Log everything including passthroughs |

Audit entries are appended as newline-delimited JSON to `audit_file`.

### Example rules

```toml
# Allow curl to a specific domain
[[allow]]
tool = "Bash"
command_regex = "^curl\\s.*https://api\\.example\\.com"
reason = "example.com API reads"

# Block path traversal in file reads
[[allow]]
tool = "Read"
file_path_regex = ".*"
file_path_exclude_regex = "\\.\\."

# Allow TypeScript checks in subdirectories
[[allow]]
tool = "Bash"
command_regex = "^cd .* && npx tsc --noEmit"
reason = "TypeScript type checking in subdir"

# Block curl piped to shell
[[deny]]
tool = "Bash"
command_regex = "curl[^|]*\\|\\s*(ba)?sh"
reason = "curl pipe to shell blocked"

# Allow a specific subagent
[[allow]]
tool = "Task"
subagent_type = "codebase-analyzer"
```

## Development

```bash
git clone https://github.com/your-username/anumati
cd anumati
npm install
npm run build
npm test
```

## Comparison

TypeScript/npm port of [kornysietsma/claude-code-permissions-hook](https://github.com/kornysietsma/claude-code-permissions-hook) (Rust). Same TOML config format, no Rust toolchain required.

## License

MIT
