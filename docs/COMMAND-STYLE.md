# Writing commands anumati can auto-approve

anumati approves tool calls with **deterministic, single-command matchers**. It
does not interpret arbitrary shell scripts — it recognizes specific, safe
*shapes*. If you emit commands in those shapes, they auto-approve silently; if
you bundle, redirect, or obscure them, they fall through to a manual permission
prompt.

This guide describes how to phrase work so it lands on the approvable path.
These are **preferences, not hard rules** — when a task genuinely needs a
complex one-off command, write it; just don't reach for that shape by default.

## The core principle: one command per call

anumati matches **one command** (optionally piped into read-only builtins). It
does **not** approve multi-statement scripts. Prefer separate tool calls over
bundling.

**Avoid** (falls through — a 5-statement script):
```bash
cd src/app; echo "=== files ==="; ls -la 2>&1; cat config.json | head -40; grep -n foo cfg.ts
```

**Prefer** (each auto-approves on its own):
```
Read      config.json                     # not `cat`
Grep      "foo" in cfg.ts                  # not bash grep
Bash      ls -la src/app                   # single command
```

## Prefer dedicated tools over Bash

The dedicated tools are always cleaner for anumati to reason about than shelling
out:

| Instead of Bash… | Use the tool | Matcher |
|---|---|---|
| `cat` / `head` / `tail` a file | **Read** | `safe-read` |
| `grep` / `rg` for content | **Grep** | (tool, not Bash) |
| `find` / `ls` to locate files | **Glob** | (tool, not Bash) |
| `echo >` / `cat >` to write a file | **Write** / **Edit** | `safe-write` |

Reserve Bash for things that genuinely need a shell.

## What blocks auto-approval (avoid these in Bash)

1. **Redirections — including `2>&1` and `2>/dev/null`.** Any `>` or `<` in a
   command disqualifies the read-only inspection matcher, and `2>&1` additionally
   breaks the parser (the bare `&` is read as a background operator). Drop stderr
   redirects; if you need to see stderr, just run the command.

2. **Statement separators `;`, `&&`, `||`, newlines** (for inspection commands).
   Read-only inspection only chains through **pipes** `|`. Split sequenced
   statements into separate Bash calls.

3. **`echo` scaffolding / section headers.** Don't narrate output with
   `echo "=== step ==="`. It's an uncovered command that sinks the whole chain.

4. **Command substitution `$(...)` and backticks.** anumati rejects *any*
   command containing `$` or a backtick outright. Compute values in a separate
   step instead of inlining substitutions.

5. **`cd` prefixing arbitrary commands.** A bare `cd <subfolder-of-cwd>` on its
   own is approvable, but `cd foo && <anything>` is only recognized by a few
   build matchers (see below). Prefer passing the path as an argument
   (`ls src/app`) over `cd src/app && ls`.

## Shapes that DO auto-approve

- **Read-only inspection**, standalone or piped into read-only builtins:
  ```bash
  ls -la src
  grep -n "TODO" file.ts | head -20
  sort names.txt | uniq -c | sort -rn
  find . -name '*.ts' -type f
  ```
  Allowed builtins include: `ls cat head tail wc file stat du df tree pwd which
  type basename dirname date grep rg sort uniq cut tr diff column find env
  printenv realpath readlink nl fold comm tac`. No redirection, pipes only.

- **Read-only git**, optionally piped to those builtins:
  ```bash
  git status
  git log --oneline -20 | grep fix
  git diff HEAD~1
  ```
  Mutating git (`push`, `commit`, `checkout`, `branch -d`, …) always prompts.

- **`cd` into the current dir or a subfolder** (standalone only):
  ```bash
  cd src/DrashtaCDK
  ```

- **Type-check / build / test** (each optionally prefixed with `cd <dir> &&`):
  ```bash
  npx tsc --noEmit -p tsconfig.json
  cargo check
  go test ./...
  npm run build            # only scripts on your allowlist
  ```

- **Pure-compute `python3 -c` / `node -e`** using only allowlisted,
  side-effect-free modules (no file/network/subprocess). A trailing
  `|| echo <fallback>` is tolerated for these.

## Quick rules of thumb

- One command per Bash call; use separate calls instead of `;` / `&&` chains.
- No `>`, `>>`, `<`, `2>&1`, `2>/dev/null` — drop the redirect.
- No `echo` headers, no `$(...)`, no backticks.
- Reach for **Read / Grep / Glob / Edit / Write** before shelling out.
- Pipes into read-only builtins (`| head`, `| grep`, `| wc -l`) are fine.

Following these keeps the vast majority of routine work on the silent
auto-approve path, and reserves manual prompts for the genuinely unusual.
