#!/usr/bin/env node
/**
 * Refine anumati matchers from your passthrough log — as a plain script.
 *
 * This is the no-orchestration sibling of `workflows/refine-matchers.js`. That
 * version runs as a Claude Code *Workflow* and must route EVERY step through a
 * subagent, because a workflow orchestrator has no shell of its own. This script
 * DOES have a shell, so it owns all the deterministic control flow directly and
 * only shells out to `claude -p` at the two steps that genuinely need LLM
 * judgment: the safety gate and the implementation.
 *
 *   Phase           Who does it here
 *   ─────           ────────────────
 *   1 Triage        this script  (spawns scripts/triage-passthrough.js)
 *   2 Config        this script  (spawns the verified `anumati add …` commands)
 *   3 Safety gate   claude -p     (one call per code candidate, in parallel)
 *   4 Implement     claude -p     (one call per approved candidate, sequential)
 *   5 Verify        this script  (build + tsc + vitest)
 *   6 Ship          this script  (git + gh with a script-computed file list)
 *
 * Run it:
 *   npm run build                 # the triage step imports from dist/
 *   node scripts/refine-matchers.js
 *   node scripts/refine-matchers.js --dry-run          # stop after the safety gate
 *   node scripts/refine-matchers.js --no-ship          # implement + verify, no PR
 *
 * Requires the `claude` CLI on PATH (Claude Code headless mode). Nothing here
 * ever executes a logged command — triage only asks the matcher "would this be
 * allowed?"; the LLM steps write/verify code but never replay a passthrough.
 */

const { spawn, spawnSync } = require("child_process");
const { readFileSync, mkdtempSync } = require("fs");
const { tmpdir } = require("os");
const { join, resolve } = require("path");

// ── Colors (match scripts/try.js) ─────────────────────────────────────────────
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function log(msg) {
  console.log(msg);
}
function phase(title) {
  console.log(`\n${BOLD}── ${title} ──${RESET}`);
}

// ── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = {
  repo: resolve(__dirname, ".."), // this script lives in <repo>/scripts
  log: null, // null → triage script's ~/.claude default
  config: null, // null → triage script's ~/.claude default
  applyConfig: true,
  maxCandidates: 12,
  model: null, // null → claude's configured default
  dryRun: false, // stop after the safety gate (no code written)
  ship: true, // open a PR at the end
  base: "main",
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--repo") opts.repo = resolve(argv[++i]);
  else if (a === "--log") opts.log = argv[++i];
  else if (a === "--config") opts.config = argv[++i];
  else if (a === "--no-config") opts.applyConfig = false;
  else if (a === "--max-candidates") opts.maxCandidates = parseInt(argv[++i], 10);
  else if (a === "--model") opts.model = argv[++i];
  else if (a === "--dry-run") opts.dryRun = true;
  else if (a === "--no-ship") opts.ship = false;
  else if (a === "--base") opts.base = argv[++i];
  else if (a === "-h" || a === "--help") {
    console.log(
      "Usage: node scripts/refine-matchers.js [--repo <dir>] [--log <path>] [--config <path>]\n" +
        "         [--no-config] [--max-candidates <n>] [--model <name>] [--dry-run] [--no-ship] [--base <branch>]",
    );
    process.exit(0);
  }
}

const REPO = opts.repo;

// Files the workflow itself owns — never stage these. (Same list as the
// Workflow's NEVER_STAGE, plus this script.)
const NEVER_STAGE = new Set([
  "workflows/refine-matchers.js",
  "scripts/refine-matchers.js",
  "scripts/triage-passthrough.js",
  "docs/REFINE-MATCHERS.md",
  "triage-report.md",
  "triage-result.json",
  "package.json",
]);

// ── Shell helpers ─────────────────────────────────────────────────────────────

// Run a command synchronously in REPO; return { code, stdout, stderr }.
function run(cmd, args, { cwd = REPO, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (r.status !== 0 && !allowFail) {
    console.error(`${RED}✗ ${cmd} ${args.join(" ")}${RESET}`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Parse a JSON object out of possibly-fenced LLM text.
function parseJsonLoose(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // Fall back to the first {...} span if there is leading/trailing prose.
  if (t[0] !== "{" && t[0] !== "[") {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// Invoke `claude -p` headlessly and return the parsed JSON object the prompt
// asked for (from the envelope's `result` text). Resolves to { data, costUsd }.
// tools: comma-separated allowedTools string. mode: --permission-mode value.
function claude(prompt, { tools, mode = "acceptEdits", label = "claude" }) {
  return new Promise((resolvePromise) => {
    const args = ["-p", prompt, "--output-format", "json", "--permission-mode", mode];
    if (tools) args.push("--allowedTools", tools);
    if (opts.model) args.push("--model", opts.model);

    const child = spawn("claude", args, { cwd: REPO });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      log(`${RED}  ✗ ${label}: could not spawn claude (${e.message})${RESET}`);
      resolvePromise({ data: null, costUsd: 0 });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        log(`${RED}  ✗ ${label}: claude exited ${code}${RESET}`);
        if (err.trim()) log(`${DIM}${err.trim().slice(0, 400)}${RESET}`);
        return resolvePromise({ data: null, costUsd: 0 });
      }
      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        log(`${RED}  ✗ ${label}: unparseable claude envelope${RESET}`);
        return resolvePromise({ data: null, costUsd: 0 });
      }
      const data = parseJsonLoose(envelope.result);
      resolvePromise({ data, costUsd: envelope.total_cost_usd ?? 0 });
    });
  });
}

let totalCost = 0;
const trackCost = (c) => {
  totalCost += c || 0;
};

// ── Main (async IIFE — CommonJS file, so top-level await isn't allowed) ────────
(async () => {

// ── Phase 1: Triage (deterministic) ───────────────────────────────────────────
phase("Triage");
log("Building anumati and running the deterministic triage over the passthrough log…");

const build = run("npm", ["run", "build"]);
if (build.code !== 0) {
  console.error(`${RED}Build failed — aborting.${RESET}`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "anumati-refine-"));
const jsonOut = join(scratch, "triage.json");
const mdOut = join(scratch, "triage.md");

const triageArgs = ["scripts/triage-passthrough.js", "--cwd", REPO, "--out", mdOut, "--json", jsonOut, "--quiet"];
if (opts.log) triageArgs.push("--log", opts.log);
if (opts.config) triageArgs.push("--config", opts.config);

const triage = run("node", triageArgs);
if (triage.code !== 0) {
  console.error(`${RED}Triage script failed — aborting.${RESET}`);
  process.exit(1);
}

let result;
try {
  result = JSON.parse(readFileSync(jsonOut, "utf-8"));
} catch (e) {
  console.error(`${RED}Could not read triage JSON: ${e.message}${RESET}`);
  process.exit(1);
}

const totals = result.totals ?? {};
const configExtensions = result.configExtensions ?? [];
const codeCandidates = (result.codeCandidates ?? []).slice(0, opts.maxCandidates);

log(
  `Triage: ${GREEN}${totals.resolved ?? 0} resolved${RESET} · ` +
    `${totals.configExtension ?? 0} config-extension · ` +
    `${totals.codeCandidate ?? 0} code-candidate · ` +
    `${DIM}${totals.unapprovable ?? 0} unapprovable${RESET}`,
);
log(`Config extensions: ${configExtensions.length} · code candidates to review: ${codeCandidates.length}`);
log(`${DIM}Full report: ${mdOut}${RESET}`);

// ── Phase 2: Auto-apply verified config extensions ─────────────────────────────
phase("Config");
const configApplied = [];
if (opts.applyConfig && configExtensions.length > 0) {
  log(`Applying ${configExtensions.length} verified config extension(s)…`);
  for (const ext of configExtensions) {
    // ext.command is an `anumati add …` invocation, verified by anumati itself.
    // Run it as `node dist/index.js add …` (drop the leading `anumati`).
    const cmd = String(ext.command).trim();
    const rest = cmd.replace(/^anumati\s+/, "");
    const r = run("node", ["dist/index.js", ...rest.split(/\s+/)]);
    if (r.code === 0) {
      configApplied.push(cmd);
      log(`  ${GREEN}✓${RESET} ${cmd}`);
    } else {
      log(`  ${RED}✗${RESET} ${cmd}`);
    }
  }
} else {
  log(opts.applyConfig ? "No config extensions to apply." : "Config auto-apply disabled (--no-config).");
}

// ── Phase 3: Safety gate (parallel, read-only claude calls) ────────────────────
phase("Safety gate");
let approved = [];
if (codeCandidates.length === 0) {
  log("No code candidates to review.");
} else {
  log(`Safety-reviewing ${codeCandidates.length} candidate(s) in parallel (read-only)…`);

  const gatePrompt = (c) => {
    const examples = (c.examples ?? [])
      .slice(0, 6)
      .map((e) => `  - \`${e.command}\`${e.count > 1 ? ` ×${e.count}` : ""}${e.offending ? `   (offending: \`${e.offending}\`)` : ""}`)
      .join("\n");
    return `You are a SECURITY reviewer for anumati, a tool that auto-approves shell commands so they skip a human permission prompt. Approving an unsafe shape is a serious defect.

Candidate leading command: \`${c.lead}\`
Kind: ${c.kind}${c.owningMatcher ? ` (owning matcher family: \`${c.owningMatcher}\`)` : ""}
Why it falls through: ${c.reason ?? "n/a"}
Example commands actually seen in the passthrough log:
${examples || "  (none)"}

Read ${REPO}/AGENT.md ("Available matchers" + "Adding a new named matcher") and the relevant files in ${REPO}/src/matchers and ${REPO}/src/classifiers to understand the existing conventions.

Decide ONE verdict based on the ACTUAL example commands above:
- "deliberate-block": the rejection is CORRECT and must stay. Choose this if ANY example is destructive (rm/mv/chmod/dd), network-mutating (git push/pull/fetch, cdk deploy, curl upload/-o to disk), a write/in-place form (sed -i, eslint --fix without opt-in), history-rewriting (git reset --hard, commit --amend), long-running/interactive (--watch, dev/serve, deploy, a bare REPL), privileged (sudo), or an interpreter that can run anything (bash -c, node -e touching fs/child_process). anumati is allow-only; when in doubt, prefer this.
- "safe-to-cover": EVERY example is provably read-only / side-effect-free (or a bounded, non-destructive build/query) AND a matcher can recognize a SAFE SUBSET with a strict grammar (like the existing read-only sed/jq/aws matchers). Describe that exact subset in "approach".
- "needs-human": genuinely ambiguous.

Be conservative: a false "safe-to-cover" is far worse than a false "deliberate-block". Cite a real example command in your rationale.

Respond with ONLY a JSON object (no prose, no code fence) of this exact shape:
{"lead": "${c.lead}", "verdict": "safe-to-cover|deliberate-block|needs-human", "rationale": "…", "approach": "…if safe-to-cover: new matcher vs fix which matcher, and the exact read-only shape to allow…"}`;
  };

  const verdicts = await Promise.all(
    codeCandidates.map(async (c) => {
      const { data, costUsd } = await claude(gatePrompt(c), {
        tools: "Read,Grep,Glob",
        mode: "default",
        label: `gate:${c.lead}`,
      });
      trackCost(costUsd);
      if (!data) return null;
      return { ...data, lead: c.lead, candidate: c };
    }),
  );

  const clean = verdicts.filter(Boolean);
  approved = clean.filter((v) => v.verdict === "safe-to-cover");
  const blocked = clean.filter((v) => v.verdict === "deliberate-block");
  const human = clean.filter((v) => v.verdict === "needs-human");
  log(
    `Safety gate: ${GREEN}${approved.length} safe-to-cover${RESET} · ` +
      `${blocked.length} deliberate-block · ${human.length} needs-human` +
      `${clean.length < codeCandidates.length ? ` · ${DIM}${codeCandidates.length - clean.length} failed${RESET}` : ""}`,
  );
  for (const v of approved) log(`  ${GREEN}✅ ${v.lead}${RESET}: ${v.approach ?? v.rationale}`);
  for (const v of blocked) log(`  ${DIM}🚫 ${v.lead}: ${v.rationale}${RESET}`);
}

if (opts.dryRun) {
  phase("Dry run — stopping before implementation");
  log(`${approved.length} candidate(s) would be implemented: ${approved.map((v) => v.lead).join(", ") || "(none)"}`);
  log(`Config applied: ${configApplied.length}. Estimated LLM cost so far: $${totalCost.toFixed(4)}.`);
  process.exit(0);
}

// ── Phase 4: Implement (SEQUENTIAL — shared working tree) ──────────────────────
phase("Implement");
const implResults = [];
if (approved.length === 0) {
  log("Nothing approved for implementation.");
} else {
  log(`Implementing ${approved.length} matcher change(s) sequentially…`);
  for (const v of approved) {
    const c = v.candidate;
    const examples = (c.examples ?? [])
      .slice(0, 6)
      .map((e) => `  - \`${e.command}\`${e.offending ? `   (offending: \`${e.offending}\`)` : ""}`)
      .join("\n");
    const prompt = `Implement a matcher change in the anumati repo (${REPO}). Follow existing conventions EXACTLY — read a comparable matcher first (src/matchers/sed.ts + src/parser/sed-safe.ts for a read-only-subset matcher; src/matchers/jq.ts for a simple one) and mirror its structure, comments, and test style.

Candidate lead: \`${v.lead}\`  (kind: ${c.kind}${c.owningMatcher ? `, owning family: \`${c.owningMatcher}\`` : ""})
Safety-approved approach (follow this — do NOT loosen it to admit any destructive/network/write/watch form):
${v.approach ?? v.rationale}

Example commands that SHOULD become auto-approved (from the real passthrough log):
${examples || "  (none)"}

Steps:
1. Read AGENT.md "Adding a new named matcher" and a comparable matcher + its tests.
2. Implement. NEW matcher: add src/matchers/<name>.ts, wire into src/matchers/index.ts matchNamed(), add a suggest branch in src/suggest.ts, add a row to the AGENT.md matcher table; if it consumes piped output, validate trailing segments with isSafePipeConsumer from src/parser/pipe.ts (do not define a local consumer set). FIX: adjust the owning matcher minimally to admit only the safe shape.
3. Add tests in tests/matchers/<name>.test.ts (or extend the owning matcher's test file) covering BOTH the shapes that should now pass AND the dangerous shapes that must still be rejected (use the real examples above).
4. Run: npm run build   then   npx vitest run tests/matchers/<name>.test.ts
5. If green, run the FULL suite: npx vitest run. If anything you touched is red, fix it. If you cannot reach green, revert everything you changed (git checkout -- <files>; delete new files) and report status "failed".

Respond with ONLY a JSON object (no prose, no code fence):
{"lead": "${v.lead}", "status": "done|skipped|failed", "summary": "…", "files": ["repo-relative paths you created/modified"], "matcher": "matcher name added or fixed", "testsAdded": <int>}`;

    const { data, costUsd } = await claude(prompt, {
      tools: "Read,Edit,Write,Bash,Grep,Glob",
      mode: "acceptEdits",
      label: `impl:${v.lead}`,
    });
    trackCost(costUsd);
    if (data) {
      implResults.push(data);
      const icon = data.status === "done" ? "✅" : data.status === "skipped" ? "⏭️" : "❌";
      log(`  ${icon} ${data.lead}: ${data.summary}`);
    } else {
      log(`  ${RED}❌ ${v.lead}: no result from claude${RESET}`);
    }
  }
}

const done = implResults.filter((r) => r.status === "done");

// ── Phase 5: Verify (full suite, deterministic) ────────────────────────────────
phase("Verify");
let verifyPass = true;
if (done.length === 0) {
  log("No code changes to verify.");
} else {
  const b = run("npm", ["run", "build"], { allowFail: true });
  const tc = run("npx", ["tsc", "--noEmit"], { allowFail: true });
  const vt = run("npx", ["vitest", "run"], { allowFail: true });
  verifyPass = b.code === 0 && tc.code === 0 && vt.code === 0;
  log(`Build: ${b.code === 0 ? GREEN + "ok" : RED + "FAIL"}${RESET} · tsc: ${tc.code === 0 ? GREEN + "ok" : RED + "FAIL"}${RESET} · vitest: ${vt.code === 0 ? GREEN + "ok" : RED + "FAIL"}${RESET}`);
  if (!verifyPass && vt.code !== 0) log(`${DIM}${vt.stdout.trim().split("\n").slice(-12).join("\n")}${RESET}`);
}

// ── Phase 6: Ship (branch + scoped commit + PR) ────────────────────────────────
phase("Ship");

function finish(extra) {
  log(`\n${BOLD}Done.${RESET} LLM cost this run: ${GREEN}$${totalCost.toFixed(4)}${RESET}`);
  return extra;
}

if (done.length === 0) {
  log("No code changes landed — nothing to commit. Config extensions (if any) were applied to the live config.");
  finish();
  process.exit(0);
}

if (!verifyPass) {
  log(`${RED}Verification FAILED — refusing to commit.${RESET} Changes left in the working tree for inspection.`);
  finish();
  process.exit(1);
}

if (!opts.ship) {
  log("--no-ship: verified changes left staged-free in the working tree. Commit manually when ready.");
  finish();
  process.exit(0);
}

// Compute the EXACT set of files to stage — only what Implement touched, minus
// the workflow-owned / unrelated denylist.
const stageList = [...new Set(done.flatMap((r) => r.files ?? []))]
  .map((f) => f.replace(/^\.?\//, ""))
  .filter((f) => !NEVER_STAGE.has(f));

if (stageList.length === 0) {
  log("Implementation reported no stageable files (all excluded). Not committing.");
  finish();
  process.exit(0);
}

// Unique branch stamp — this is a plain Node script, so Date is available.
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const branch = `anumati-triage/${stamp}`;
const leadNames = done.map((r) => r.lead).join(", ");
const commitTitle = `feat: auto-approve ${leadNames} from passthrough triage`;
const commitBody =
  done.map((r) => `${r.lead} → ${r.matcher ?? "n/a"} (+${r.testsAdded ?? 0} tests)`).join("; ") +
  `. Verified config extensions were applied to the live config separately. Full suite passed.`;

log(`Branch: ${branch}`);
log(`Staging ${stageList.length} file(s): ${stageList.join(", ")}`);

const co = run("git", ["checkout", "-b", branch]);
if (co.code !== 0) {
  log(`${RED}Could not create branch — aborting ship.${RESET}`);
  finish();
  process.exit(1);
}

for (const f of stageList) run("git", ["add", f]);

// Pre-commit guard: confirm ONLY the intended files are staged.
const staged = run("git", ["diff", "--cached", "--name-only"]).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
const unexpected = staged.filter((f) => !stageList.includes(f));
if (unexpected.length > 0) {
  log(`${RED}Unexpected staged files: ${unexpected.join(", ")} — unstaging.${RESET}`);
  for (const f of unexpected) run("git", ["restore", "--staged", f]);
}
const missing = stageList.filter((f) => !staged.includes(f));
if (missing.length > 0) log(`${YELLOW}Warning: expected files not staged: ${missing.join(", ")}${RESET}`);

run("git", ["commit", "-m", commitTitle, "-m", commitBody]);
const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
log(`Committed ${sha.slice(0, 8)}: ${commitTitle}`);

const push = run("git", ["push", "-u", "origin", branch], { allowFail: true });
if (push.code !== 0) {
  log(`${YELLOW}Push failed — commit is on local branch ${branch}. Push/PR manually.${RESET}`);
  finish();
  process.exit(0);
}

const prBody = `Automated by \`scripts/refine-matchers.js\`.\n\nTriage counts: resolved ${totals.resolved ?? "?"} / config ${totals.configExtension ?? "?"} / code ${totals.codeCandidate ?? "?"} / unapprovable ${totals.unapprovable ?? "?"}.\n\nMatchers implemented:\n${done.map((r) => `- ${r.lead} → ${r.matcher ?? "n/a"} (+${r.testsAdded ?? 0} tests)`).join("\n")}\n\nFull test suite passed.`;
const pr = run("gh", ["pr", "create", "--base", opts.base, "--title", commitTitle, "--body", prBody], { allowFail: true });
if (pr.code === 0) {
  log(`${GREEN}PR opened:${RESET} ${pr.stdout.trim()}`);
} else {
  log(`${YELLOW}gh pr create failed — open the PR manually for branch ${branch}.${RESET}`);
}

finish();

})().catch((e) => {
  console.error(`${RED}refine-matchers crashed: ${e?.stack ?? e}${RESET}`);
  process.exit(1);
});
