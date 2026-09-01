/**
 * The canonical catalog of every named matcher anumati supports.
 *
 * This is the single source of truth for commands that ENUMERATE matchers —
 * today that is `anumati scaffold`, which writes one disabled placeholder per
 * entry so the full catalog is discoverable in a config without turning
 * anything on. The matching LOGIC still lives in each `src/matchers/<name>.ts`
 * and is dispatched by the switch in `matchNamed()` (index.ts); this file only
 * names and describes them.
 *
 * INVARIANT: every `name` here must have a corresponding `case` in
 * `matchNamed()`, and vice versa. `tests/matchers/registry.test.ts` parses the
 * switch and asserts the two stay in lockstep, so a matcher added to the code
 * without a catalog entry (or vice versa) fails the build.
 *
 * Descriptions are the one-line summaries shown when scaffold prints what it
 * added, and are written into each placeholder's `desc`. Keep them terse and in
 * sync with the "Available matchers" table in AGENT.md.
 */
export interface MatcherInfo {
  /** The matcher name, as used in a rule's `matcher` field and `anumati add <name>`. */
  name: string;
  /** One-line, human-readable summary of what the matcher approves. */
  desc: string;
}

// Ordered to mirror the switch in matchNamed() for easy side-by-side review.
export const MATCHERS: MatcherInfo[] = [
  { name: "curl", desc: "curl to allowlisted domains (+ pipe to safe builtins)" },
  { name: "npx-tsc", desc: "npx tsc --noEmit type checks" },
  { name: "python3-pipe", desc: "python3 -c / script.py with allowlisted imports; dangerous builtins & dynamic open() blocked" },
  { name: "nodejs-pipe", desc: "node -e / script.js with allowlisted built-in modules; fs/network/child_process/vm always blocked" },
  { name: "gh", desc: "read-only gh api repos/<owner/repo>/… (no write methods)" },
  { name: "pip3-install", desc: "pip/pip3 install of allowlisted packages" },
  { name: "safe-inspect", desc: "read-only inspection builtins (ls/cat/head/tail/grep/rg/find/stat/wc/…)" },
  { name: "git-read", desc: "read-only git subcommands (status/log/diff/show/branch-list/…)" },
  { name: "git-write", desc: "allowlisted LOCAL git write ops; network + destructive/history-rewriting forms hard-blocked" },
  { name: "npm-script", desc: "npm/pnpm/yarn run <script> for allowlisted scripts + read-only queries (ls/view/outdated)" },
  { name: "cargo", desc: "cargo check/build/test/clippy/fmt --check/tree/…" },
  { name: "go", desc: "go build/test/vet/fmt/list/doc + read-only env/mod" },
  { name: "cd", desc: "bare cd into cwd, a subfolder, or a configured allowed_paths root" },
  { name: "vitest", desc: "vitest run (via npx or <pm> exec); interactive watch mode blocked" },
  { name: "aws", desc: "read-only AWS CLI reads (list/describe/get/query/scan) per-service allowlist; all writes blocked" },
  { name: "sleep", desc: "a single bare sleep <seconds>" },
  { name: "echo", desc: "bare echo of literal text (no file redirection)" },
  { name: "sed", desc: "read-only sed: p/d/q/= commands only; -i/-f/s/// and other writes rejected" },
  { name: "jq", desc: "jq <filter> [file] — pure JSON transform; no fs/network/exec, -f rejected" },
  { name: "test-runner", desc: "pytest / python -m pytest / jest; watch modes and snapshot-writing rejected" },
  { name: "build-tool", desc: "one-shot frontend builds (vite/next build, webpack/rollup/esbuild); dev/serve/watch rejected" },
  { name: "eslint", desc: "read-only eslint lint runs; --fix only with allow_write, --init always blocked" },
  { name: "prettier", desc: "prettier --check / stdout; --write only with allow_write" },
  { name: "git-push", desc: "the one bounded shape git push [-u] <remote> <branch>; force/delete/bulk & protected branches rejected" },
  { name: "gh-pr", desc: "non-destructive gh pr subcommands (create/edit/comment/view/list/…); merge/close/review blocked" },
  { name: "node-script", desc: "run a TRUSTED local node script by location (inside cwd or a configured allowed_paths root)" },
  { name: "mkdir", desc: "mkdir [-p/-v] <path…>; -m/--mode and redirection rejected" },
  { name: "docker-read", desc: "read-only docker inspection (ps/images/inspect/logs/version/info/…); all mutating/exec/network blocked" },
];

/** Just the names, in catalog order. */
export const MATCHER_NAMES: string[] = MATCHERS.map((m) => m.name);
