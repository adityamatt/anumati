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

1. **File redirections.** Writing or reading a file via `> file`, `>> file`,
   `2> file`, or `< file` turns a read-only command into one with a side effect,
   so matchers reject it. **Safe stream redirects are allowed**, though: ones
   that only discard or merge output — `2>/dev/null`, `>/dev/null`, `2>&1`,
   `>&2` — pass fine (e.g. `grep -rn foo src 2>/dev/null` auto-approves).

2. **`||` and backgrounding `&`.** Read-only inspection chains through pipes
   `|` and sequencing `;` / `&&` **only when every segment is itself a safe
   read** — but `||` and a trailing `&` are never accepted. (Build/test matchers
   like `npx-tsc`/`cargo`/`vitest` are stricter: a single command, optionally
   `cd <dir> &&`-prefixed and piped to a builtin — no `;` chains.)

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
  printenv realpath readlink nl fold comm tac`. No file redirection; pipes and
  safe stream redirects (`2>/dev/null`, `2>&1`) are fine.

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

## Recipes — common tasks, the approvable way

Real patterns that keep falling through, with the drop-in replacement. The
left column is what *not* to reach for; the right column auto-approves.

### Type-check / build / test — don't wrap in a logfile

The "redirect to a log, echo the exit code, tail the log" wrapper is the single
most common false start. It stacks a file redirect, a `$?` substitution, `echo`
scaffolding, and `;` chaining — all disqualifiers. The tool prints its output to
the terminal anyway, so the wrapper buys nothing.

```bash
# AVOID — falls through (file redirect + $? + ; chain)
npx tsc --noEmit > /tmp/tsc.log 2>&1 ; echo "tsc exit: $?" ; tail -8 /tmp/tsc.log
npx vitest run > /tmp/vt.log 2>&1 && echo OK || (echo FAIL; cat /tmp/vt.log)

# PREFER — auto-approves, and you still see errors on failure
npx tsc --noEmit
npx vitest run lib/query
npx vitest run lib/query | tail -20        # pipe to a builtin is fine
```

### Never redirect to a file just to read it back

`> file … ; tail file` is always two disqualifiers (a file write, then a
sequence). Pipe directly instead.

```bash
# AVOID
cmd > /tmp/out.log 2>&1 ; tail -20 /tmp/out.log
# PREFER — merge stderr into the pipe (2>&1 is a safe stream redirect)
cmd 2>&1 | tail -20
```

### Don't use `$?`, `$(...)`, or backticks

Any `$` or backtick makes anumati refuse to parse the command at all. If you
need a computed value, run it as its own step and use the result.

```bash
# AVOID
echo "exit: $?"            # inspect the exit code out of band, not inline
ls "$(git rev-parse --show-toplevel)"
# PREFER
git rev-parse --show-toplevel    # one call
ls <the-path-it-printed>         # next call
```

### Reading a JSON/file in `python3 -c`

`open()` is allowed **only** under a path in the rule's `open.allowed_paths`. If
a read falls through, the fix is to add the prefix (`anumati add python3-pipe
--paths /tmp`), not to rephrase the code. Keep imports to the allowlisted
pure-stdlib set (`json`, `math`, …).

```bash
# Auto-approves once /tmp is in allowed_paths:
python3 -c "import json; d=json.load(open('/tmp/result.json')); print(len(d['dataPoints']))"
```

### Inspecting files — prefer the dedicated tools

```bash
# AVOID (bash)                          # PREFER (tool call)
cat config.json                          Read  config.json
grep -rn "foo" src                       Grep  "foo" in src
find . -name '*.ts'                      Glob  **/*.ts
```
Bash `grep`/`ls`/`cat` still auto-approve when you do need them — but the tools
are cleaner and never trip a shell-parsing edge case.

## Quick rules of thumb

- One command per Bash call; use separate calls instead of `;` / `&&` chains.
- No file redirects (`> file`, `>> file`, `2> file`, `< file`); stream redirects (`2>/dev/null`, `2>&1`) are fine.
- No `echo` headers, no `$(...)`, no backticks.
- Reach for **Read / Grep / Glob / Edit / Write** before shelling out.
- Pipes into read-only builtins (`| head`, `| grep`, `| wc -l`) are fine.

Following these keeps the vast majority of routine work on the silent
auto-approve path, and reserves manual prompts for the genuinely unusual.
