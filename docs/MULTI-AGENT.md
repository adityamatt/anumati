# anumati across Claude Code and Codex — one config, two agents

**Status:** design + decisions (pre-implementation)
**Goal:** run anumati as the deterministic auto-approve layer for **both** Claude
Code and OpenAI Codex CLI, driven by a **single shared ruleset** — you maintain
one `permissions.json`, and the same matchers decide for both agents.

This document records how that works, where every file lives, and the decisions
we're committing to before writing the Codex adapter.

---

## 1. Why this is cheap: the engine is already host-agnostic

anumati already separates cleanly into:

- **A pure decision engine** — `src/matcher.ts` (`evaluate`), `src/matchers/*`,
  `src/suggest.ts`, `src/debug.ts`, `src/parser/*`, `src/classifiers/*`,
  `src/config.ts`, `src/types.ts`. Input: a command string + cwd. Output:
  `allow` / passthrough. **Zero references to Claude Code.**
- **A Claude Code adapter** — `runHook()` in `src/index.ts` (reads Claude's
  PreToolUse JSON, emits `hookSpecificOutput.permissionDecision`), plus the
  wiring in `src/cli/settings.ts` / `src/cli/init.ts` / `src/cli/session-start.ts`.

So supporting Codex means **adding one adapter + one wiring path** over the same
engine and the same ruleset. Nothing in the engine changes; the Claude path is
untouched.

```
                    ┌───────────────────────────────┐
                    │   anumati engine (pure)        │
   permissions.json →   evaluate() / suggest()       → allow | passthrough
        (shared)    │   matchers, parser, classifiers│
                    └───────────────────────────────┘
                        ▲                        ▲
        Claude PreToolUse JSON            Codex PermissionRequest JSON
        (runHook, index.ts)              (codex-hook adapter — NEW)
                        │                        │
                  ~/.claude/settings.json   ~/.codex/config.toml
                  hooks.PreToolUse          [[hooks.PermissionRequest]]
```

---

## 2. Where the files live

### anumati's own files (shared across both agents)

| What | Path (default) | Notes |
|---|---|---|
| The binary | global npm bin `anumati` (or `npm link`) | Both hosts invoke this same bin. |
| **Ruleset (source of truth)** | `~/.anumati/permissions.json` | The matchers + allowlists. **Read by both adapters.** Host-neutral home (see D2). Legacy fallback: `~/.claude/permissions.json`. Override with a path arg / `--config`. |
| Project ruleset (cascade) | `<cwd>/.anumati/permissions.json` | Checked before the global one. Legacy fallback: `<cwd>/.claude/permissions.json`. |
| Passthrough log | `~/.anumati/anumati-passthrough.jsonl` | Feeds `scaffold`/`triage`/`refine`. Shared (see D7). |
| Audit log | per `audit.audit_file` in config | Approvals. |
| Suggestions store | `~/.anumati/anumati-suggestions.jsonl` | For `anumati apply`. |

### Host-specific wiring (this is all that differs per agent)

| Host | Wiring file | What we register |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` | `hooks.PreToolUse` → `anumati <config>` (+ SessionStart banner). Written by `anumati init`. |
| **Codex** | `~/.codex/hooks.json` | Anumati-owned `PermissionRequest` (`anumati codex-hook`) + `SessionStart` banner (`anumati session-start`) command hooks. Auto-written by `init` (D5); merged non-destructively. |
| **Codex (native, not ours)** | `~/.codex/rules/*.rules` | Codex's own Starlark execpolicy. Coexists; anumati does not touch it (see Decision 8). |

**The single-config trick:** both wirings point their hook command at the *same*
`permissions.json`. Passing the same path to `anumati <config>` (Claude) and
`anumati codex-hook <config>` (Codex) is all it takes — the engine and ruleset are
identical; only the I/O envelope differs.

---

## 3. The Codex hook contract — verified on Codex 0.153.2

Codex's `PermissionRequest` hook runs an external command **in the approval path,
before the prompt / auto-review**, at top precedence. The shapes below were
**confirmed empirically** on `codex 0.153.2` (tag `rust-v0.153.2`) with a debug
hook — not just read from source.

**Input — one JSON object on stdin.** Observed payload:
```json
{"session_id":"…","turn_id":"…","transcript_path":"…",
 "cwd":"/abs/cwd","hook_event_name":"PermissionRequest",
 "model":"…","permission_mode":"default","tool_name":"Bash",
 "tool_input":{"command":"mkdir /tmp/x","description":"…"}}
```
- **`tool_input.command` is the raw command string** — *not* an argv array, *not*
  wrapped in `zsh -lc`/`bash -lc` (that wrapper is only Codex's executor). It drops
  straight into anumati's `evaluate()` — **no normalization needed** (D4).
- `tool_name` is `"Bash"` (same token Claude Code uses); `cwd` is top-level.
- `agent_id` / `agent_type` / `tool_use_id` may be absent (omitted when null).

**Output — one JSON object on stdout, exit 0.** `hookEventName` is **required** —
omitting it makes Codex treat the output as invalid (logged `PermissionRequest
Failed`) and fall through:
```json
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
```
- `behavior:"allow"` → auto-approve, no prompt. `behavior:"deny"` (+ optional
  `decision.message`) → **blocks the command before it runs** (verified: the probe
  was `Rejected("<message>")`). **anumati never emits deny.**
- **Empty stdout (exit 0), or unrecognized JSON → no decision → Codex continues its
  normal approval flow** (prompt / auto-review). This "emit nothing" path is what
  anumati uses for everything it doesn't auto-approve — and it's the fail-open
  default, so a bug can't wrongly allow.
- Alternative deny: exit code 2 + a stderr message. `continue:false`, `stopReason`,
  `suppressOutput`, `updatedInput`, `updatedPermissions`, `interrupt` are rejected
  as unsupported — do not emit them.

anumati's mapping is therefore trivial and **allow-only**:

```
evaluate(tool_input.command, cwd) == "allow"
   →  emit {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
otherwise
   →  emit nothing (exit 0)  → Codex's normal approval flow
```

> **Hook trust (verified):** Codex silently skips any *untrusted* command hook —
> no log line, no warning (confirmed empirically: writing the hook alone is a
> **silent no-op**). Trust is a record in the **user** `config.toml`:
> `[hooks.state."<key>"] trusted_hash = "sha256:<hex>"`, where the hash is a plain
> SHA-256 over the canonical hook identity (event + matcher + handler) — no
> signature. Normal trust is a **one-time interactive review prompt** in Codex;
> there's no `codex hooks trust` command and no persistent pre-trust toggle
> (`--dangerously-bypass-hook-trust` is per-invocation only). How `init --host
> codex` handles this is **D11**. Contract verified on 0.153.2 — treat it as
> version-pinned and fail closed on any shape we don't recognize (D9).

---

## 4. Decisions we're taking

### D1 — One ruleset, two thin adapters
**Chosen:** a single `permissions.json` is the source of truth; per-host adapters
only translate the I/O envelope. **Rationale:** the engine is already
host-agnostic; duplicating rules per host would defeat the entire point ("single
configuration for both").

### D2 — anumati's home is host-neutral `~/.anumati/`
**Context:** `permissions.json` is *anumati's* file (Claude Code's own settings
are in `~/.claude/settings.json`; Claude does not read `permissions.json`). Sitting
under `~/.claude/` was only convenience — with two agents it's misleading.
**Chosen:** anumati's own files live in **`~/.anumati/`** — the ruleset
(`~/.anumati/permissions.json`), the passthrough log, and the suggestions store.
Both host adapters read the same `~/.anumati/permissions.json`. Project cascade
becomes `<cwd>/.anumati/permissions.json`.
**Backward compatibility — and it requires moving nobody's files.** Existing
customers wired the hook as `anumati <explicit ~/.claude/… path>` (or bare
`anumati`). Two invariants make the change safe: (1) an **explicit path always
wins and always keeps resolving**; (2) an **empty `~/.anumati/` never shadows a
real `~/.claude/` config**.

Read resolution (`defaultConfigPath()`), used only when no explicit path is passed:
1. `~/.anumati/permissions.json`, if it exists;
2. `~/.claude/permissions.json` (legacy), if it exists;
3. otherwise `~/.anumati/permissions.json` (fresh-install write target).
Same order for the project cascade, passthrough log, and suggestions store.

**Anti-shadow guard:** anumati never *creates* an empty
`~/.anumati/permissions.json` while `~/.claude/permissions.json` exists. Any
command that would create the new file (a re-`init`, `anumati init --host codex`)
**seeds it by copying the legacy file**, so a customer's rules can never be
silently replaced by an empty default.

**Layered strategy — do both: (A) always on, (B) on update.**
- **(A) Co-existence — the always-on baseline.** The resolver + anti-shadow guard
  above mean existing customers are never touched: their explicit-path wiring keeps
  reading `~/.claude/permissions.json`, and they gain Codex support by pointing the
  new Codex hook at that same existing file. New installs default to `~/.anumati/`.
  `~/.claude/` is supported indefinitely. This holds whether or not (B) ever runs.
- **(B) Relocation via `anumati migrate` — layered on top (implemented,
  `src/cli/migrate.ts`).** A **standalone** command (decoupled from `update`,
  which is npm-global-only — so it works on any install, including a local
  `npm link` sync): if `~/.claude/permissions.json` exists and `~/.anumati/`
  doesn't, it **moves** the file to `~/.anumati/` and leaves a **symlink**
  `~/.claude/permissions.json → ~/.anumati/permissions.json`. Existing
  explicit-path wirings (Claude `settings.json`, Codex `hooks.json`) then resolve
  through the symlink with **no re-wiring**. It **also relocates the sidecars** —
  the audit log, passthrough log, and suggestions store that live beside the
  config — and **rewrites the config's `audit.audit_file` / `audit.passthrough_file`**
  to the new home (only files directly under `~/.claude/`; custom paths are left
  alone). Idempotent **and incremental**: if the config was moved but the logs
  weren't, re-running finishes the logs. Where symlinks aren't available (Windows
  without privilege) it **rolls back** and stays on `~/.claude/` (fully supported),
  never a broken state. `anumati update` can call it for global users; it's never
  run from the per-command hook.

**(A) and (B) compose safely.** (A) guarantees correctness for everyone at all
times; (B) only *opportunistically tidies* updaters into `~/.anumati/`. Because the
resolver and the symlink keep every path resolving, a skipped, partial, or
Windows-disabled (B) can never break anyone — the worst case is a customer stays on
the fully-supported legacy path.

**Never migrate from the hook.** The PreToolUse / PermissionRequest hook stays
read-only and fast — it only *reads* via the resolution order above. All file
moves and settings rewrites happen only in explicit commands (`update`, `init`,
`migrate`).

**Touch-points:** `src/config.ts` (`defaultConfigPath`, `projectConfigPath`),
`src/suggest-store.ts` (`defaultSuggestionsFile`), the passthrough-log default in
`scripts/triage-passthrough.js` / `src/cli/scaffold.ts`, `src/cli/init.ts` (write
target + anti-shadow seed), and — for strategy (B) — `src/cli/update.ts` (the
one-time migration step). Not the engine — only path resolution.
**Alternative considered:** `~/.config/anumati/` (XDG). Rejected for now to match
the sibling `~/.claude` / `~/.codex` convention; `$XDG_CONFIG_HOME` support can
come later.

### D3 — Codex integration = `PermissionRequest`, allow-only
**Chosen:** emit `allow` for the matched-safe subset; **decline** (no decision)
otherwise so Codex prompts as normal. Never `deny`.
**Rationale:** matches anumati's allow-only philosophy — it loosens (removes
prompts for safe commands) and never blocks. Tightening stays with Codex's own
policy/`rules`. (This is also why we don't need upstream issue #28437, which is
about hooks *tightening*.)

### D4 — Don't hard-code the tool name; act on `tool_input.command`
**Chosen:** the adapter decides only when `tool_input.command` is present (a
shell-like call); for anything else it declines. We will **not** rely on a
`matcher = "Bash"` value in the Codex config.
**Rationale:** keying on the presence of a command is robust regardless of the tool
name; the adapter declines cleanly for any non-shell tool call.
**Resolved by the D9 experiment (Codex 0.153.2):** the earlier worry — that the
command might arrive as an argv array or a `bash -lc "…"` wrapper needing
normalization — did **not** materialize. The captured payload shows
`tool_input.command` is the **raw command string** (`"mkdir /tmp/x"`), `tool_name`
is **`"Bash"`**, and `cwd` is top-level. So the adapter passes `tool_input.command`
straight into `evaluate()` with **no normalization** — and, as it happens, a
`matcher = "Bash"` in the Codex config *would* also work, though we still prefer
presence-detection so we're not coupled to the tool name across versions. The
adapter still fails closed on any payload shape it doesn't recognize.

### D5 — Wiring: auto-write an anumati-owned `hooks.json` (not `config.toml`)
**Options:** (a) print the `[[hooks.PermissionRequest]]` block for the user to
paste into `config.toml`; (b) merge it into the user's `~/.codex/config.toml`
automatically; (c) auto-write an anumati-owned `hooks.json` that Codex also
discovers.
**Chosen: (c).** `init` auto-writes `$CODEX_HOME/hooks.json` (default
`~/.codex/hooks.json`) — the same auto-wire it does for Claude's `settings.json`.
**Rationale:** `hooks.json` is JSON, so anumati can parse + merge it safely and
non-destructively (idempotent; preserves existing hooks) with **no TOML-parser
dependency and no risk of clobbering the user's hand-edited `config.toml`** — the
exact concern that ruled out (b). Verified on Codex 0.153.2: a `hooks.json` in the
config home is discovered and its hook fires (events nested under a top-level
`hooks` key). Implemented in `src/cli/codex-hooks-file.ts` (`wireCodexHooksFile`).
**Still requires D11 trust:** writing the file doesn't make the hook run — Codex
silently skips it until the user approves it once. `init` prints that reminder.

### D6 — Fail closed
**Chosen:** on any adapter error — unparseable payload, engine throw, timeout,
unknown contract shape — emit **no decision** (decline → Codex prompts). Never
emit `allow` on uncertainty. **Rationale:** identical to the Claude adapter's
"on error → passthrough"; a false auto-approve is the one outcome we must never
produce.

### D7 — Shared logs tagged by host; per-host `stats` (implemented)
**Chosen:** one passthrough log and one audit log for both agents, each entry
stamped with `host` (`"claude"` | `"codex"`). `anumati stats` shows the combined
totals plus a **By host** breakdown.
**Implemented:**
- `src/audit.ts` `audit()` takes a `host` and stamps it on the entry.
- The Claude hook (`index.ts`) tags its entries `"claude"`.
- The Codex adapter (`codex-hook.ts`) now **logs** each decision (mirroring the
  Claude cascade) tagged `"codex"` — allow → `audit_file`, decline → `passthrough_file`.
- `stats` groups by `host`, **defaulting a missing `host` to `"claude"`** so
  pre-tag logs classify correctly; the `By host` section shows only when >1 host.
**Rationale:** `scaffold`/`triage`/`refine`/`stats` already assume one shared log,
so both agents feed the same coverage data; the tag lets you see each agent's
approve rate separately.
**Known limitation:** the Codex adapter only sees commands that reach Codex's
approval path (`NeedsApproval`); commands Codex auto-runs (`Skip`) never hit the
hook, so Codex stats reflect approval-path traffic, not every command.

### D8 — Coexist with Codex's native `rules`; don't manage them
**Chosen:** leave `~/.codex/rules/` alone. anumati is the richer allow layer via
the hook; Codex's Starlark `rules` remain available for prefix rules.
**Rationale:** they're complementary and non-conflicting — if both would allow a
command, the result is still "allowed" (harmless). (A future `anumati export
--target codex` could seed `rules/` from the enumerable matchers, but that's out
of scope here.)

### D9 — Contract verified empirically; still version-pinned
**Done:** the contract was confirmed on **Codex 0.153.2** (tag `rust-v0.153.2`) with
a debug hook (see §3). Findings: input `tool_input.command` is a raw string,
`tool_name` is `"Bash"`, `cwd` is top-level; output requires
`hookSpecificOutput.hookEventName = "PermissionRequest"` alongside
`decision.behavior` (allow blocks-nothing / deny blocks-before-run were both
observed); missing/invalid output fails **open** (logged "Failed" → normal flow).
**Still chosen:** ship the adapter with a `--debug` dump mode, pin the contract with
adapter tests, and **fail closed** on any unrecognized shape (D6) — the hooks
feature isn't in Codex's published docs, so the JSON may drift across versions.
**New unknown surfaced:** Codex gates hooks behind *persisted trust* (untrusted
hooks don't run; `--dangerously-bypass-hook-trust` is the one-shot override). How
trust is persisted — and how `init --host codex` should establish it — is the open
item (see Open questions).

### D10 — CLI surface & host-aware `anumati init`
**Chosen:**
- `anumati codex-hook [config]` — the Codex stdin→decision adapter.
- **`anumati init` becomes host-aware.** Interactively (a TTY, no flags) it prompts
  for **(1) which agent(s) — Claude / Codex / Both**, pre-selecting agents it
  detects (`~/.claude/`, `~/.codex/`), then **(2) scope — root / project**
  (unchanged). Non-interactive via `--host claude|codex|both` (with `--root` /
  `--project`).
- The **shared ruleset is written once** (`~/.anumati/permissions.json`, with the
  D2 anti-shadow seed); each selected host is then wired with its own mechanism:
  - **Claude:** `~/.claude/settings.json` PreToolUse hook + SessionStart banner +
    `CLAUDE.md` guidance.
  - **Codex:** auto-writes `~/.codex/hooks.json` (per D5) with **two** hooks —
    `PermissionRequest` (auto-approve, `anumati codex-hook`, **sync** — it's a
    blocking decision) and `SessionStart` (the "⚡ anumati active" banner, reusing
    `anumati session-start`, **`async: true`**) — then prints the D11 trust reminder.
    The banner **must be async**: Codex surfaces an async hook's `systemMessage` as a
    first-class, visible `Warning`, whereas a *sync* hook's message is only a dim
    `↳ Hook · …` cell that the TUI can drop and `codex exec` doesn't show at all.
    Verified end-to-end (the async banner surfaces as `⚡ anumati active — N rules`).
    **Note:** because `async` is part of the hook's trust identity, flipping a
    previously-trusted sync banner to async invalidates its trust → Codex re-prompts
    to approve it once. (`AGENTS.md` steer is an optional follow-up.)

**Backward compatibility:** an existing user re-running `anumati init` and choosing
Claude gets exactly today's behavior — the anti-shadow guard preserves their rules,
and `--force` still overwrites. Scripted `anumati init --root` / `--project`
*without* `--host` defaults to **Claude-only**, so existing automation is unchanged.

### D11 — Codex hook trust: respect Codex's review (no forging)
**Decision (final): approve-in-Codex.** `init --host codex` writes the hooks and
tells the user to approve them once in Codex's own review prompt. The `--trust-hook`
forging option below was **declined** — even reverse-engineered accurately (the
recipe is fully known: snake_case `event_name`, normalized handler, sort-keys →
compact JSON → `sha256:`, written to `[hooks.state]` in the user `config.toml`), it
(a) forges Codex's human-approval attestation / bypasses its review UI, (b) is
version-coupled and fails **silently** on any canonicalization drift, and (c) can't
be verified without a Codex-written reference hash. Not worth defeating another
tool's safety gate. Kept here only as a documented non-goal.

**Context:** an untrusted Codex hook is **silently skipped**, so `init --host codex`
must get the hook trusted or it's a no-op. Trust is an unauthenticated SHA-256
record in the user `config.toml` (`[hooks.state]`); the only normal way to write it
is Codex's **one-time interactive review prompt** (no CLI command, no persistent
pre-trust toggle).
**Chosen:**
- **Default — respect Codex's review.** `init --host codex` writes the hook, then
  **clearly tells the user to approve it once** in Codex's prompt on next launch,
  and states plainly that until then anumati is inactive on Codex (because untrusted
  = silent no-op). Honest, robust to Codex version changes, and preserves the
  human-in-the-loop control.
- **Opt-in `--trust-hook`** — for automation, anumati computes and writes the
  `trusted_hash` itself (the persistent equivalent of
  `--dangerously-bypass-hook-trust`). Gated behind an **explicit flag + a printed
  warning that it bypasses Codex's hook review**. Never done in a plain `init`.
**Rationale:** silently forging a human-approval attestation would defeat a security
control that exists specifically to require review before a command hook runs
arbitrary shell — and it's fragile (must reproduce Codex's exact key-path +
canonicalization byte-for-byte, or it silently fails, and it breaks across Codex
versions). A security-adjacent tool must not disable another tool's safeguard
without explicit consent.
**Verify, don't assume:** because untrusted = silent, `init --host codex` should
also offer a check (e.g. a one-shot probe) so the user can confirm the hook is
actually live rather than silently skipped.

---

## 5. Setup (target UX)

```bash
# 1. Install once (serves both agents)
npm install -g anumati

# 2. Set up — interactively pick Claude / Codex / Both, or pass --host
anumati init                 # prompts: which agent(s)? then root/project
anumati init --host both     # non-interactive: wire both agents
anumati init --host codex    # Codex only
```

For Codex, `init` **auto-writes** `~/.codex/hooks.json` (D5) — you don't paste
anything. The file it writes:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          { "type": "command",
            "command": "anumati codex-hook /Users/<you>/.anumati/permissions.json",
            "timeout": 5 }
        ]
      }
    ]
  }
}
```

Then **approve the hook once** when Codex prompts to review it (until then Codex
silently skips it — D11). Restart Claude Code / reload Codex. Both now auto-approve
the same safe commands from the same `permissions.json`; anything unmatched prompts
as usual in each.

---

## 6. Open questions / risks

- **✅ RESOLVED — Codex hook contract** (input + output) verified on 0.153.2; see
  §3 and D9. `tool_name` is `"Bash"`, `tool_input.command` is a raw string, output
  needs `hookEventName`.
- **✅ RESOLVED — Hook trust.** Mechanism mapped (unauthenticated `sha256`
  `[hooks.state]` record in user `config.toml`; untrusted = silently skipped;
  normal trust = one-time interactive review). Handling decided in **D11**:
  respect the review by default, forge only under an explicit `--trust-hook`.
  Remaining detail before implementing `--trust-hook`: reproduce Codex's exact
  `key_source` path-string + `NormalizedHookIdentity` canonicalization byte-for-byte
  (or the forged hash silently fails).
- **Hook contract drift** — mitigated by D6/D9 (fail closed on any unrecognized shape).
- **Project-config cascade** — moves to `<cwd>/.anumati/permissions.json` (D2),
  with `<cwd>/.claude/permissions.json` as legacy fallback; whether to also honor
  `<cwd>/.codex/` is deferred.
- **Async/relay** — Codex has open requests to let `PermissionRequest` race the
  prompt (#39447 / #39835). anumati is synchronous and fast, so this doesn't
  affect us; noted only for awareness.
```
