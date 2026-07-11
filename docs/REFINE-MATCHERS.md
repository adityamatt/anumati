# Refining matchers from your passthrough log

Every line in `~/.claude/anumati-passthrough.jsonl` is a command anumati did
**not** auto-approve — so each is a candidate that some rule *might* have
approved. This workflow turns that log into action: it categorizes the
passthroughs, auto-applies the safe config tweaks, implements the safe new
matchers (with tests), and opens a PR — end to end.

There are two pieces:

1. **`scripts/triage-passthrough.js`** — a deterministic categorizer. Safe to
   run anytime; it never executes a logged command.
2. **`workflows/refine-matchers.js`** — the end-to-end workflow that
   runs the script, applies config, writes code, verifies, and ships a PR.

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
`.claude/`, so run it by **script path** rather than by name — ask Claude to:

```
use a workflow: run workflows/refine-matchers.js with stamp 2026-07-11
```

(Claude invokes it via `Workflow({ scriptPath: "workflows/refine-matchers.js", args: { stamp: "…" } })`.)
Pass today's date as `stamp` — it becomes the branch suffix, and `Date.now()`
is unavailable inside workflow scripts. It runs six phases:

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
6. **Ship** — create branch `anumati-triage/<stamp>`, stage **only** the
   matcher/test/doc files (never `git add -A`; the unrelated `package.json`
   version bump is explicitly excluded), commit, push, and open a PR against
   `main` with `gh`.

### Args

| Arg | Default | Meaning |
|---|---|---|
| `repo` | this repo path | Repo root. |
| `log` | `~/.claude/anumati-passthrough.jsonl` | Passthrough log. |
| `config` | `~/.claude/permissions.json` | Live config to extend. |
| `stamp` | `latest` | Branch suffix (`Date.now()` is unavailable in workflow scripts — pass a date). |
| `applyConfig` | `true` | Auto-apply verified config extensions. |
| `maxCandidates` | `12` | Cap on implementation units per run. |

### Safety properties

- Config extensions are only ever those anumati itself verified — the workflow
  runs the exact `anumati add` command, the single source of truth for writing
  config.
- No code change is committed unless the **full suite is green**.
- Commits are path-scoped; `git add -A` is never used.
- The safety gate stands between "coverable" and "implemented" — destructive /
  network / write / watch / privileged shapes are dropped before any code is
  written.

---

## Routine use

Run the triage script whenever you've accumulated passthroughs and want to see
what's coverable:

```bash
npm run build && node scripts/triage-passthrough.js
```

Skim `triage-report.md`. If there's a batch worth acting on, kick off the
workflow with today's date as the stamp and review the PR it opens.
