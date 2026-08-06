# Refining matchers from your passthrough log

Every line in `~/.claude/anumati-passthrough.jsonl` is a command anumati did
**not** auto-approve — so each is a candidate that some rule *might* have
approved. This workflow turns that log into action: it categorizes the
passthroughs, auto-applies the safe config tweaks, implements the safe new
matchers (with tests), and opens a PR — end to end.

There are three pieces:

1. **`scripts/triage-passthrough.js`** — a deterministic categorizer. Safe to
   run anytime; it never executes a logged command.
2. **`workflows/refine-matchers.js`** — the end-to-end *Workflow* (multi-agent
   orchestration) that runs the script, applies config, writes code, verifies,
   and ships a PR.
3. **`scripts/refine-matchers.js`** — the same end-to-end run as a *plain
   script*: it owns the deterministic phases directly and only calls headless
   `claude -p` for the safety gate and implementation. Run it from any terminal
   with no orchestration runtime (see §3).

---

## 1. The triage script (deterministic, safe)

```bash
npm run build            # the script imports from dist/
node scripts/triage-passthrough.js
```

Flags (all optional):

| Flag | Default | Meaning |
|---|---|---|
| `--log <path>` | `~/.claude/anumati-passthrough.jsonl` | Passthrough log to read. |
| `--config <path>` | `~/.claude/permissions.json` | Config to evaluate/suggest against. |
| `--cwd <dir>` | `process.cwd()` | cwd to evaluate under (the log doesn't store it; `cd`/`python3-pipe`/`nodejs-pipe` depend on it). A wrong cwd only ever *under*-approves. |
| `--out <path>` | `triage-report.md` | Human-readable Markdown report. |
| `--json <path>` | `triage-result.json` | Machine-readable result (the workflow consumes this). |
| `--quiet` | off | Suppress the stdout summary. |

It sorts every **unique** passthrough command into four buckets:

| Bucket | Meaning | Action |
|---|---|---|
| ✅ **resolved** | `evaluate()` now approves it — a matcher/config added since it was logged already covers it. | None. |
| ⚙️ **config-extension** | `suggest()` returns a **verified** config change (near-miss on an existing rule, or a new rule for a matcher that already exists). | `anumati add …` (the exact command is in the report). |
| 🛠️ **code-candidate** | Coverable, but no config change suffices — a matcher must be **created** (no matcher owns the leading command) or **fixed** (a matcher owns it but rejects this shape). | Write/patch a matcher. |
| 🚫 **unapprovable** | Destructive or an inherently unsafe shape (`rm`, `sudo`, `$(…)`, a file redirect, an interpreter). | Should stay a manual prompt. |

### Why this is trustworthy

The script does not re-implement any safety logic. It reuses anumati's own
tested functions:

- `evaluate()` — "would the live hook approve this now?"
- `suggest()` — the **same** near-miss/new-rule engine the hook uses, which
  re-runs the *real matcher* with the proposed param before emitting anything.
  So every config-extension is safe by construction.
- `debugDiagnose()` — the stable `reason_code` taxonomy
  (`shell_substitution` / `file_redirection` / `dangerous_command` /
  `no_matcher` / …).

### Reading the code-candidate bucket carefully

A **`fix-existing`** candidate means an owning matcher *saw* the command and
declined it. That is usually **deliberate and correct** —
`git push` (network), `git reset --hard` (destructive), `sed -i` (write),
`jest --watch` (hangs), `cdk deploy` (network mutation) all show up here and
must **not** be "fixed" into approval. Occasionally it's an accidental
over-rejection (e.g. the historical quoted-`>` false positive in a commit
message). The script can't tell these apart — it flags the candidate and the
workflow's safety-gate agent makes the call. The report's "Why it falls
through" line is written to prime that decision.

Also check the 🚫 `file_redirection` list: if an entry has no *real* redirect
(a quoted `>` in a message), that's a matcher false positive hiding in the
unapprovable bucket.

---

## 2. The end-to-end workflow

> Requires multi-agent orchestration (say **"use a workflow"** / ultracode).

This script lives in the repo (`workflows/refine-matchers.js`), not in
`.claude/`, so run it by **script path**. It takes **no arguments** — just ask:

```
use a workflow: run workflows/refine-matchers.js
```

(Claude invokes it via `Workflow({ scriptPath: "workflows/refine-matchers.js" })`.)
The workflow derives everything itself, including a unique branch name
(`anumati-triage/<YYYYMMDD-HHMMSS>`, stamped by the triage agent via `date`,
since `Date.now()` is unavailable inside workflow scripts). It runs six phases:

1. **Triage** — `npm run build`, run the script, load the JSON.
2. **Config** — auto-apply every verified `anumati add …` to your live
   `~/.claude/permissions.json` (safe by construction), then re-triage to
   confirm they cleared.
3. **Safety gate** — one **read-only** reviewer per code-candidate, in
   parallel. Each returns `safe-to-cover` / `deliberate-block` / `needs-human`.
   The bar is deliberately conservative: a false "safe" is far worse than a
   false "block".
4. **Implement** — **sequential** (candidates share `matchers/index.ts`,
   `suggest.ts`, `AGENT.md`). For each approved candidate an agent writes the
   matcher + tests following existing conventions, then runs build + vitest.
   Anything that can't reach green is reverted.
5. **Verify** — one authoritative `build` + `tsc --noEmit` + full `vitest run`.
   A red result **blocks the commit**.
6. **Ship** — create the branch, then stage **only** the exact files the
   Implement phase reported touching. The script computes that list itself and
   hands the agent explicit `git add <path>` commands — never `git add -A`. The
   workflow's own files (`workflows/refine-matchers.js`, `scripts/triage-*.js`,
   `docs/REFINE-MATCHERS.md`), the triage outputs, and `package.json` are on a
   hard **`NEVER_STAGE`** denylist so the workflow can never commit itself or
   unrelated edits. The commit title is built from the real implemented leads
   (no placeholder). Then commit, push, and open a PR against `main` with `gh`.

### Args (all optional — the default is to run with none)

| Arg | Default | Meaning |
|---|---|---|
| `repo` | this repo path | Repo root. |
| `log` | `~/.claude/anumati-passthrough.jsonl` | Passthrough log. |
| `config` | `~/.claude/permissions.json` | Live config to extend. |
| `applyConfig` | `true` | Auto-apply verified config extensions. |
| `maxCandidates` | `12` | Cap on implementation units per run. |

The branch name is not an arg — the triage agent stamps it with `date` so every
run gets a unique `anumati-triage/<YYYYMMDD-HHMMSS>` branch.

### Running fully unattended

The workflow issues shell commands through the anumati hook like any other
session, so it only runs start-to-finish without prompts if those commands are
auto-approved. Three matchers exist for exactly the commands this workflow runs
that anumati otherwise (correctly) blocks — enable them once and every phase is
silent:

```bash
node dist/index.js add node-script --paths /Users/<you>/<code-root>/   # run trusted repo scripts (triage script, node dist/index.js add …)
node dist/index.js add git-push --remotes origin                       # push a NEW branch to origin (force / protected-branch / delete all blocked)
node dist/index.js add gh-pr                                           # gh pr create/edit/comment (merge / close blocked)
```

These are real network-write carve-outs applied **globally**, so weigh them:
- `git-push` allows only `git push [-u] origin <branch>` to a non-protected
  branch — never `--force`, `--delete`, `--all/--mirror/--tags`, or a push to
  `main`/`master`/`release`/`production`/`prod`.
- `gh-pr` allows only the non-destructive `gh pr` subcommands — never `merge`,
  `close`, `reopen`, `review`.
- `node-script` trusts a script **by location** (inside an allowed root), so
  scope `--paths` to your code root, not `/`.

Two commands stay a manual prompt by design and are NOT part of the happy path:
bare `anumati add …` (the workflow uses `node dist/index.js add …` instead,
which `node-script` approves) and `git commit --amend` (history-rewriting — the
Ship phase avoids it, using a pre-commit staging check plus a `reset --soft`
redo only as a rare fallback).

### Safety properties

- Config extensions are only ever those anumati itself verified — the workflow
  runs the exact `anumati add` command, the single source of truth for writing
  config.
- No code change is committed unless the **full suite is green**.
- Commits are path-scoped: the script computes the exact file list from the
  Implement phase and issues explicit `git add <path>` commands. `git add -A` is
  never used, and a `NEVER_STAGE` denylist keeps the workflow's own files, the
  triage outputs, and `package.json` out of every commit — so a run can never
  commit itself or unrelated working-tree edits.
- The safety gate stands between "coverable" and "implemented" — destructive /
  network / write / watch / privileged shapes are dropped before any code is
  written.

---

## 3. The standalone script (no orchestration)

> Requires the `claude` CLI on your PATH. No multi-agent runtime, no "use a
> workflow" — just run it.

`scripts/refine-matchers.js` is the no-orchestration sibling of the Workflow.
It runs the **same six phases**, but instead of routing every step through a
subagent it owns all the deterministic control flow directly and only shells out
to `claude -p` (headless Claude Code) at the two steps that need judgment:

| Phase | Who does it |
|---|---|
| Triage | the script (spawns `triage-passthrough.js`) |
| Config | the script (spawns the verified `anumati add …` commands) |
| **Safety gate** | **`claude -p`** — one call per candidate, in parallel |
| **Implement** | **`claude -p`** — one call per approved candidate, sequential |
| Verify | the script (`build` + `tsc --noEmit` + `vitest run`) |
| Ship | the script (`git` + `gh` with a script-computed file list) |

Only 2 of 6 phases call the LLM. The script holds the triage data in memory (no
"read the JSON file back" workaround needed) and computes the exact `git add`
list itself, filtering the same `NEVER_STAGE` denylist as the Workflow.

```bash
npm run refine                       # build + full run: triage → PR
node scripts/refine-matchers.js --dry-run    # stop after the safety gate (no code, no cost past the gate)
node scripts/refine-matchers.js --no-ship    # implement + verify, but don't commit/push/PR
```

Flags (all optional):

| Flag | Default | Meaning |
|---|---|---|
| `--repo <dir>` | this repo | Repo root. |
| `--log <path>` | `~/.claude/anumati-passthrough.jsonl` | Passthrough log. |
| `--config <path>` | `~/.claude/permissions.json` | Live config to extend. |
| `--no-config` | off | Skip auto-applying config extensions. |
| `--max-candidates <n>` | `12` | Cap on code candidates reviewed/implemented. |
| `--model <name>` | claude default | Pin the model for the `claude -p` calls. |
| `--dry-run` | off | Run triage + config + safety gate, then stop (no code written). |
| `--no-ship` | off | Implement + verify, but leave changes in the working tree. |
| `--base <branch>` | `main` | PR base branch. |

Each `claude -p` call is scoped: the safety gate is read-only
(`--allowedTools Read,Grep,Glob`, `--permission-mode default`); the implementer
gets edit tools (`--allowedTools Read,Edit,Write,Bash,Grep,Glob`,
`--permission-mode acceptEdits`). The script prints a running LLM cost total
(summed from each call's `total_cost_usd`).

**Workflow vs standalone — which to use?** The Workflow gives you the live
`/workflows` progress tree and token-budget integration and is the right call
inside a Claude Code session ("use a workflow"). The standalone script is for
running it *outside* a session — from a plain terminal, a `Makefile`, or cron —
anywhere you just want `node scripts/refine-matchers.js` to do the whole thing.
Both share `triage-passthrough.js` and apply the same safety gate.

---

## Routine use

Run the triage script whenever you've accumulated passthroughs and want to see
what's coverable:

```bash
npm run build && node scripts/triage-passthrough.js
```

Skim `triage-report.md`. If there's a batch worth acting on, either kick off the
Workflow (inside a Claude Code session) or run `npm run refine` (a plain
terminal) — both open a PR for you to review.
