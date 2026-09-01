# Contributing to anumati

Thanks for helping improve anumati! This guide covers local setup — including
running Claude Code against your **local build** instead of the npm global
package — plus how to test, add a matcher, and open a PR.

For the internals (architecture, the matcher/suggest model, adding a matcher),
[`AGENT.md`](AGENT.md) is the source of truth. This file is about the workflow
of contributing.

## Prerequisites

- **[Claude Code](https://code.claude.com)** — anumati is a PreToolUse hook for
  Claude Code, so you need it installed to run the hook end-to-end (link → init →
  watch commands get auto-approved). The unit tests and `npm run try` don't need
  it, but exercising the actual hook does.
- **Node.js ≥ 18** (CI runs on Node 20) and npm.
- A clone of the repo:

```bash
git clone https://github.com/adityamatt/anumati.git
cd anumati
npm install
```

`dist/` is gitignored, so you always build from source.

## Build & test

```bash
npm run build         # tsc → dist/
npm run build:watch   # rebuild on every change (handy during local dev)
npm test              # vitest run (the full suite)
npm run test:watch    # vitest in watch mode
npx tsc --noEmit      # type-check without emitting
```

Run a single test file:

```bash
npx vitest run tests/matchers/docker-read.test.ts
```

The three checks a PR must pass are `npm run build`, `npx tsc --noEmit`, and
`npm test` — all green.

## Run your local build via `npm link` (recommended local setup)

anumati installs a single `anumati` binary (`bin` → `dist/index.js`). The
PreToolUse hook that `anumati init` writes is just `anumati <config>`, which the
shell resolves through `PATH` on **every** invocation. `npm link` points the
global `anumati` at *your checkout's* `dist/`, so Claude Code runs your local
build instead of the published package — no other wiring changes.

### 1. Link the checkout

```bash
npm install       # first time only
npm run build     # npm link needs a built dist/ (bin → dist/index.js)
npm link          # symlink the global `anumati` → this checkout
```

Verify the global `anumati` now points at your checkout:

```bash
npm ls -g anumati              # → anumati@x.y.z -> ./<path to this repo>  (the "->" means linked)
anumati --version
```

### 2. Wire the hook (if you haven't already)

If this machine has never run `anumati init`:

```bash
anumati init          # writes the config + registers the `anumati <config>` hook
```

If you already used the published package and ran `init` before, there's
**nothing to do** — the hook string is `anumati <config>` either way, so the
link transparently takes over. Restart Claude Code (or run `/hooks`) once so the
hook is loaded.

### 3. Iterate

Edit `src/`, rebuild, and the **next** Bash command in Claude Code uses the new
code — the hook spawns `anumati` fresh on each call, so there's no restart and
no session reload:

```bash
npm run build:watch   # leave running in a spare terminal
```

### 4. Go back to the published version

```bash
npm rm -g anumati        # remove the link
npm install -g anumati   # reinstall the registry version (or: anumati update)
```

### Alternative: pin the hook to the checkout without a global link

If you'd rather not touch the global `anumati`, wire the hook directly at the
built script. Because `buildHookCommand` (in `src/cli/settings.ts`) only emits
the bare `anumati <config>` form when it was launched *as* the `anumati` bin,
invoking it as a script instead pins the hook to that absolute path:

```bash
node dist/index.js init --project    # hook becomes: node <abs>/dist/index.js <config>
```

Trade-off: this pins to the exact `dist/index.js` path, so it survives rebuilds
but not moving the checkout, and it won't be affected by `anumati update`.

## Trying commands without Claude Code

`npm run try` replays commands through the real matchers **without executing
them** — it only asks "would this be auto-approved?", so it's safe on unvetted
input:

```bash
npm run try -- ~/.claude/anumati-passthrough.jsonl            # replay a passthrough log
npm run try -- ~/.claude/anumati-passthrough.jsonl --group    # bucket the still-passthrough ones by why
npm run try                                                   # ad-hoc list (edit COMMANDS in scripts/try.js)
```

For quick CLI iteration you can also run a subcommand straight from source
without building: `npm run dev -- <args>` (ts-node).

## Adding a matcher

Follow the numbered steps in [`AGENT.md` → "Adding a new named matcher"](AGENT.md).
In short: add `src/matchers/<name>.ts`, wire it into the `matchNamed()` switch in
`src/matchers/index.ts`, add a `{ name, desc }` entry to
`src/matchers/registry.ts` (a test fails the build if the registry and the
switch drift), add a row to the matcher table in `AGENT.md` **and**
`docs/CONFIGURATION.md`, add `tests/matchers/<name>.test.ts`, and — if the shape
is recognizable — teach `src/suggest.ts` to suggest it.

**Safety bar for matchers.** anumati is allow-only and must be safe by
construction: a matcher may approve only read-only / build / test shapes, with a
strict grammar that fails closed on anything it doesn't recognize. Tests must
cover **both** the shapes that should be approved **and** the dangerous shapes
that must still be rejected (write/in-place forms, network, `--watch`, redirects,
interpreters, privilege). When in doubt, reject. Suggestions must stay verified —
never hand-roll a config change; extract candidate params and re-run the real
matcher (see the "suggestions are verified" invariant in `AGENT.md`).

## Auto-generate matchers from your passthrough log

As you use anumati, commands that fall through get logged to your passthrough
file (`~/.claude/anumati-passthrough.jsonl`). anumati ships a pipeline that uses
**your Claude Code** to turn that log into contributions: it triages the log,
safety-reviews each coverable command, implements + tests the safe new matchers,
runs the full suite, and opens a PR. It never executes a logged command — it
only asks the matchers "would this be allowed?" and uses the LLM to write and
verify code.

Prerequisites: the `claude` CLI on `PATH` (used headlessly for the judgment
steps) and — for the PR step — the `gh` CLI authenticated with push access (fork
or write). There are two ways to run it.

### As an npm script (standalone)

```bash
npm run refine                          # triage → config → safety-gate → implement → verify → branch + PR
npm run refine -- --dry-run             # stop after the safety gate (writes nothing, opens no PR)
npm run refine -- --no-ship             # implement + verify locally, don't open a PR
npm run refine -- --no-config           # don't auto-apply verified `anumati add …` config extensions
npm run refine -- --log <path> --max-candidates 20
```

Note: unless `--no-config` is passed, the pipeline auto-applies **verified**
config extensions (near-misses / new rules for existing matchers) to your live
`~/.claude/permissions.json` — these are re-verified by the real matcher, so
they're safe by construction, but it does modify your config. Use `--dry-run`
first if you want to preview.

### As a Claude Code workflow (dynamic, orchestrated)

Open Claude Code in this repo and ask it to run the refine-matchers workflow
(defined in `workflows/refine-matchers.js`), optionally pointing at a specific
log:

> run the refine-matchers workflow for the log at ~/.claude/anumati-passthrough.jsonl

Same six phases — **triage → auto-apply verified config extensions → safety gate
→ implement → verify → ship** — ending in a branch and a PR, with each phase run
as its own subagent.

Full phase-by-phase details and safety properties are in
[`docs/REFINE-MATCHERS.md`](docs/REFINE-MATCHERS.md).

## Coding conventions

- Match the surrounding style — naming, comment density, and idiom. Read a
  comparable matcher (`src/matchers/sed.ts` + `src/parser/sed-safe.ts` for a
  read-only-subset matcher; `src/matchers/jq.ts` for a simple one) before writing
  a new one.
- Keep changes focused; prefer small, well-tested units.
- Update the docs when behavior changes: `AGENT.md` (internals), the matcher
  table + `docs/CONFIGURATION.md`, and `README.md` for anything user-facing.

## Opening a pull request

1. Branch off `main`.
2. Make sure `npm run build`, `npx tsc --noEmit`, and `npm test` all pass.
3. Use a conventional-commit-style subject (`feat:`, `fix:`, `chore:`, `docs:`),
   matching the existing history.
4. Do **not** bump the version or edit `package.json`'s `version` — releases are
   automated (see below).
5. Open the PR against `main` with a short description of what changed and why,
   including the shapes newly approved/rejected if you touched a matcher.

## Releasing (maintainers)

Publishing is **manual and CI-only** — never from a laptop. Trigger it from
**Actions → Publish to npm → Run workflow**, picking `patch` / `minor` / `major`.
The workflow builds, tests, bumps the version with `npm version`, tags
`v<x.y.z>`, pushes the bump back, and publishes with provenance. There's a dry
run option that stops after `npm pack`. Contributors never hand-edit the version.
