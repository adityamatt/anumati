export const meta = {
  name: 'refine-matchers',
  description: 'Triage the anumati passthrough log, auto-apply verified config extensions, implement/test safe new matchers on a branch, and open a PR',
  phases: [
    { title: 'Triage', detail: 'build + deterministic categorization of the passthrough log' },
    { title: 'Config', detail: 'auto-apply verified anumati add commands to live config' },
    { title: 'Safety gate', detail: 'one read-only reviewer per code candidate — keep only genuinely-safe ones' },
    { title: 'Implement', detail: 'sequentially write matcher + tests for each approved candidate' },
    { title: 'Verify', detail: 'full typecheck + test suite' },
    { title: 'Ship', detail: 'commit scoped changes on a branch and open a PR' },
  ],
};

// ── Inputs (all optional; args overrides defaults) ────────────────────────────
// This workflow is designed to be run with NO args — just "run the refine
// workflow". Everything it needs it derives itself. Because workflow scripts
// have no Node API access (no process.cwd()/os.homedir(); Date.now() is also
// unavailable), the two machine-specific paths are discovered by the Triage
// agent, which DOES have shell access:
//   • REPO  — the agent runs `git rev-parse --show-toplevel` in its cwd.
//   • LOG / CONFIG — left unset so the triage script uses its own ~/.claude
//     defaults (homedir-relative), which are correct on any machine.
// Anyone forking this repo can therefore run it with no args and no editing.
const ARG_REPO = args?.repo ?? null; // override only if the workflow isn't launched from the repo
const LOG = args?.log ?? null; // null → triage script's ~/.claude default
const CONFIG = args?.config ?? null; // null → triage script's ~/.claude default
const APPLY_CONFIG = args?.applyConfig ?? true; // auto-apply verified config extensions
const MAX_CANDIDATES = args?.maxCandidates ?? 12; // cap implementation units per run

// Scratch outputs, written into the repo root by the triage script. Resolved to
// absolute paths (`${REPO}/…`) once the Triage agent reports the repo root.
const REPORT_NAME = 'triage-report.md';
const JSON_NAME = 'triage-result.json';
let REPO; // set from the Triage agent's discovered repo root
let REPORT; // `${REPO}/${REPORT_NAME}`
let JSON_OUT; // `${REPO}/${JSON_NAME}` — the on-disk candidate data downstream agents read

// Optional flag strings: passed through only when the caller supplied an override.
const LOG_FLAG = LOG ? `--log ${JSON.stringify(LOG)}` : '';
const CONFIG_FLAG = CONFIG ? `--config ${JSON.stringify(CONFIG)}` : '';

// Files the workflow itself owns — the triage script, this workflow, its doc,
// and its scratch outputs. These must NEVER be staged by the Ship phase; only
// files that the Implement phase actually created/modified get committed. (They
// are already tracked on main, but listing them keeps the guard explicit.)
const NEVER_STAGE = [
  'workflows/refine-matchers.js',
  'scripts/triage-passthrough.js',
  'docs/REFINE-MATCHERS.md',
  'triage-report.md',
  'triage-result.json',
  'package.json',
];

// The triage script writes the full, faithful candidate data (examples, reasons,
// config deltas) to JSON_OUT on disk. Downstream agents READ THAT FILE directly
// rather than receiving the data relayed through the orchestrator — an LLM can
// paraphrase or drop fields when re-emitting a large nested structure, even under
// a schema. The orchestrator only passes tiny identifiers (lead strings) between
// phases. This is the fix for the first run, where the triage agent summarized
// the candidates and the safety gate got "no example commands".

// ── Schemas ───────────────────────────────────────────────────────────────────

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'repoRoot', 'stamp', 'totals', 'configExtensionCount', 'codeCandidateLeads'],
  properties: {
    ok: { type: 'boolean' },
    error: { type: 'string' },
    // Absolute repo root, from `git rev-parse --show-toplevel`. The workflow
    // sandbox can't call process.cwd(), so the agent discovers it and every
    // downstream path (scratch JSON, staging) is resolved against this.
    repoRoot: { type: 'string' },
    // Branch-name stamp: output of `date +%Y%m%d-%H%M%S` run by the agent, so
    // each run gets a unique branch without relying on Date.now() (unavailable
    // in workflow scripts) or a caller-supplied arg.
    stamp: { type: 'string' },
    totals: {
      type: 'object',
      additionalProperties: true,
      properties: {
        uniqueCommands: { type: 'integer' },
        resolved: { type: 'integer' },
        configExtension: { type: 'integer' },
        codeCandidate: { type: 'integer' },
        unapprovable: { type: 'integer' },
      },
    },
    configExtensionCount: { type: 'integer' },
    // Leading commands of the code candidates, in the priority order they appear
    // in the JSON (most-frequent first). Just the identifiers — the gate/impl
    // agents look each one up in JSON_OUT to get its full examples + reason.
    codeCandidateLeads: { type: 'array', items: { type: 'string' } },
  },
};

const SAFETY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lead', 'verdict', 'rationale', 'exampleCount'],
  properties: {
    lead: { type: 'string' },
    // How many example commands the agent actually found in the JSON for this
    // lead. A 0 here means the lookup failed — treat the verdict as unusable.
    exampleCount: { type: 'integer' },
    // safe-to-cover  → a matcher CAN and SHOULD auto-approve this shape
    // deliberate-block → the rejection is correct (destructive/network/write/watch/privileged); do nothing
    // needs-human    → genuinely ambiguous; leave for manual review
    verdict: { type: 'string', enum: ['safe-to-cover', 'deliberate-block', 'needs-human'] },
    rationale: { type: 'string', description: 'One or two sentences citing the specific safety reasoning, referencing an actual example command.' },
    approach: { type: 'string', description: 'If safe-to-cover: new matcher vs fix which matcher, and the exact read-only shape/grammar to allow.' },
  },
};

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lead', 'status', 'summary'],
  properties: {
    lead: { type: 'string' },
    // done      → matcher + tests written, build + vitest green
    // skipped   → on closer inspection not safe / not worth it (explain)
    // failed    → attempted but could not get to green; changes reverted
    status: { type: 'string', enum: ['done', 'skipped', 'failed'] },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' }, description: 'Files created/modified (repo-relative).' },
    matcher: { type: 'string', description: 'Matcher name added or fixed.' },
    testsAdded: { type: 'integer' },
  },
};

// Shared instruction for looking a candidate up in the on-disk triage JSON.
const LOOKUP = (lead) =>
  `Read the file ${JSON_OUT}. It has a "codeCandidates" array; find the entry whose "lead" === ${JSON.stringify(lead)}. That entry has: kind ("new-matcher" | "fix-existing"), owningMatcher (or null), reason, hint, and examples[] (each { command, count, offending }). Use the ACTUAL example commands from that entry — do not invent them.`;

// ── Phase 1: Triage (deterministic) ───────────────────────────────────────────
phase('Triage');
log('Building anumati and running deterministic triage over the passthrough log…');

// The agent discovers the repo root itself (git rev-parse), then runs the
// triage script from there. When the caller passed --repo, prefer that.
const repoHint = ARG_REPO
  ? `The repo root is ${ARG_REPO} — cd there first and use it as the root.`
  : `Discover the repo root by running \`git rev-parse --show-toplevel\` in your cwd; use that path as the root for every step below and return it as "repoRoot".`;

const triage = await agent(
  `Run a deterministic triage step for the anumati repo. ${repoHint} Do EXACTLY this and nothing else:

1. Run: date +%Y%m%d-%H%M%S    — capture its output verbatim as the "stamp".
2. From the repo root, run: npm run build
3. From the repo root, run: node scripts/triage-passthrough.js ${LOG_FLAG} ${CONFIG_FLAG} --cwd "<repoRoot>" --out "<repoRoot>/${REPORT_NAME}" --json "<repoRoot>/${JSON_NAME}"
   (substitute the actual repo-root path for <repoRoot>. Omit --log/--config when not shown above so the script uses its own ~/.claude defaults.)
4. Read <repoRoot>/${JSON_NAME}. It has { totals, configExtensions[], codeCandidates[] }.
5. Return ONLY: ok=true, repoRoot (absolute path), stamp (from step 1), the totals object, configExtensionCount = configExtensions.length, and codeCandidateLeads = the "lead" field of each entry in codeCandidates IN ORDER (do not reorder, do not include any other candidate detail — downstream steps read the file themselves).

Do NOT analyze safety, do NOT edit source, do NOT summarize the examples. If build or the script fails, return ok=false with the error text.`,
  { label: 'triage:run', phase: 'Triage', schema: TRIAGE_SCHEMA },
);

if (!triage || !triage.ok) {
  log(`Triage failed: ${triage?.error ?? 'no result'}. Aborting.`);
  return { aborted: true, reason: triage?.error ?? 'triage produced no result' };
}

// Resolve every repo-relative path from the discovered root.
REPO = ARG_REPO ?? triage.repoRoot;
if (!REPO) {
  log('Triage did not report a repo root. Aborting.');
  return { aborted: true, reason: 'no repo root discovered' };
}
REPORT = `${REPO}/${REPORT_NAME}`;
JSON_OUT = `${REPO}/${JSON_NAME}`;
log(`Repo root: ${REPO}`);

const STAMP = (triage.stamp && /^[0-9-]+$/.test(triage.stamp)) ? triage.stamp : 'latest';
const BRANCH = `anumati-triage/${STAMP}`;
log(`Branch for this run: ${BRANCH}`);

const totals = triage.totals ?? {};
const leads = (triage.codeCandidateLeads ?? []).slice(0, MAX_CANDIDATES);
log(`Triage: ${totals.resolved ?? 0} resolved · ${totals.configExtension ?? 0} config-extension · ${totals.codeCandidate ?? 0} code-candidate · ${totals.unapprovable ?? 0} unapprovable`);
log(`Config extensions: ${triage.configExtensionCount} · code candidates to review: ${leads.length}${(triage.codeCandidateLeads?.length ?? 0) > leads.length ? ` (capped from ${triage.codeCandidateLeads.length})` : ''}`);

// ── Phase 2: Auto-apply verified config extensions ────────────────────────────
phase('Config');
let configApplied = [];
if (APPLY_CONFIG && triage.configExtensionCount > 0) {
  log(`Applying ${triage.configExtensionCount} verified config extension(s) to ${CONFIG ?? 'the live ~/.claude config'}…`);
  const applier = await agent(
    `Apply anumati's VERIFIED config extensions to the live config. These were re-verified by anumati's real matcher, so they are safe by construction — do not second-guess them.

1. Read ${JSON_OUT}. Take its "configExtensions" array; each entry has a "command" field (an \`anumati add …\` invocation).
2. Run each command from ${REPO}, one at a time, but invoke it as \`node dist/index.js add …\` (replace the leading \`anumati\` with \`node dist/index.js\`, keeping all args identical). This form auto-approves via the node-script matcher, so the phase runs unattended; a bare \`anumati …\` would stall on a permission prompt.
3. Re-run: node scripts/triage-passthrough.js ${LOG_FLAG} ${CONFIG_FLAG} --cwd "${REPO}" --out /tmp/triage-after.md --json /tmp/triage-after.json --quiet
4. Read /tmp/triage-after.json and report totals.configExtension (should be ~0 now).

Return the exact list of commands you ran and the remaining config-extension count.`,
    {
      label: 'config:apply',
      phase: 'Config',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ranCommands', 'remainingConfigExtensions'],
        properties: {
          ranCommands: { type: 'array', items: { type: 'string' } },
          remainingConfigExtensions: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
  );
  configApplied = applier?.ranCommands ?? [];
  log(`Applied ${configApplied.length} config command(s); ${applier?.remainingConfigExtensions ?? '?'} config-extension item(s) remain.`);
} else {
  log('No config extensions to apply (or auto-apply disabled).');
}

// ── Phase 3: Safety gate (parallel, read-only) ────────────────────────────────
phase('Safety gate');
let approved = [];
if (leads.length === 0) {
  log('No code candidates to review.');
} else {
  log(`Safety-reviewing ${leads.length} code candidate(s) in parallel (read-only)…`);
  const verdicts = await parallel(
    leads.map((lead) => () =>
      agent(
        `You are a SECURITY reviewer for anumati, a tool that auto-approves shell commands so they skip a human permission prompt. Approving an unsafe shape is a serious defect.

${LOOKUP(lead)}

Then read ${REPO}/AGENT.md ("Available matchers" + "Adding a new named matcher") and the relevant files in ${REPO}/src/matchers and ${REPO}/src/classifiers.

Candidate lead: \`${lead}\`. Decide ONE verdict based on the ACTUAL example commands you found:
- "deliberate-block": the rejection is CORRECT and must stay. Choose this if ANY example is destructive (rm/mv/chmod/dd), network-mutating (git push/pull/fetch, cdk deploy, curl upload/-o to disk), a write/in-place form (sed -i, eslint --fix without opt-in), history-rewriting (git reset --hard, commit --amend), long-running/interactive (--watch, dev/serve, deploy, a bare REPL), privileged (sudo), or an interpreter that can run anything (bash -c, node -e touching fs/child_process). anumati is allow-only; when in doubt, prefer this.
- "safe-to-cover": EVERY example is provably read-only / side-effect-free (or a bounded, non-destructive build/query), AND a matcher can recognize a SAFE SUBSET with a strict grammar (like the existing read-only sed/jq/aws matchers). Describe that exact subset in "approach".
- "needs-human": genuinely ambiguous.

Set exampleCount to the number of examples you found (0 if the lookup failed — in that case return needs-human). Be conservative: a false "safe-to-cover" is far worse than a false "deliberate-block". Cite a real example command in your rationale.`,
        { label: `gate:${lead}`, phase: 'Safety gate', schema: SAFETY_SCHEMA },
      ).then((v) => (v ? { ...v, lead } : null)),
    ),
  );
  const clean = verdicts.filter(Boolean);
  // Guard: a verdict with 0 examples means the lookup failed — don't trust it.
  const usable = clean.filter((v) => v.exampleCount > 0);
  const lookupFailures = clean.filter((v) => v.exampleCount === 0);
  approved = usable.filter((v) => v.verdict === 'safe-to-cover');
  const blocked = usable.filter((v) => v.verdict === 'deliberate-block');
  const human = usable.filter((v) => v.verdict === 'needs-human');
  log(`Safety gate: ${approved.length} safe-to-cover · ${blocked.length} deliberate-block · ${human.length} needs-human${lookupFailures.length ? ` · ${lookupFailures.length} lookup-failed(ignored)` : ''}`);
  for (const v of approved) log(`  ✅ ${v.lead}: ${v.approach ?? v.rationale}`);
  for (const v of blocked) log(`  🚫 ${v.lead}: ${v.rationale}`);
}

// ── Phase 4: Implement (SEQUENTIAL — shared working tree) ──────────────────────
phase('Implement');
const implResults = [];
if (approved.length === 0) {
  log('Nothing approved for implementation. Skipping code changes.');
} else {
  log(`Implementing ${approved.length} matcher change(s) sequentially (they share matchers/index.ts, suggest.ts, AGENT.md)…`);
  for (const v of approved) {
    const r = await agent(
      `Implement a matcher change in ${REPO}. Follow existing conventions EXACTLY — read a comparable matcher first (src/matchers/sed.ts + src/parser/sed-safe.ts for a read-only-subset matcher; src/matchers/jq.ts for a simple one) and mirror its structure, comments, and test style.

${LOOKUP(v.lead)}

Lead: \`${v.lead}\`. Safety-approved approach (follow this — do NOT loosen it to admit any destructive/network/write/watch form):
${v.approach ?? v.rationale}

Steps:
1. Read AGENT.md "Adding a new named matcher" and a comparable matcher + its tests.
2. Implement. NEW matcher: add src/matchers/<name>.ts, wire into src/matchers/index.ts matchNamed(), add a suggest branch in src/suggest.ts, add a row to the AGENT.md matcher table; if it consumes piped output, validate trailing segments with isSafePipeConsumer from src/parser/pipe.ts (do not define a local consumer set). FIX: adjust the owning matcher minimally to admit only the safe shape.
3. Add tests in tests/matchers/<name>.test.ts (or extend the owning matcher's test file) covering BOTH the shapes that should now pass AND the dangerous shapes that must still be rejected (use the real examples from the JSON).
4. Run: npm run build   then   npx vitest run tests/matchers/<name>.test.ts
5. If green, run the FULL suite: npx vitest run. If anything you touched is red, fix it. If you cannot reach green, revert everything you changed (git checkout -- <files>; delete new files) and report status "failed".

Return which files you created/modified. Keep it tight and safe; if on closer look the shape isn't safely coverable, revert and report "skipped".`,
      { label: `impl:${v.lead}`, phase: 'Implement', schema: IMPL_SCHEMA },
    );
    if (r) {
      implResults.push(r);
      log(`  ${r.status === 'done' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'} ${r.lead}: ${r.summary}`);
    }
  }
}

const done = implResults.filter((r) => r.status === 'done');

// ── Phase 5: Verify (full suite, authoritatively) ─────────────────────────────
phase('Verify');
let verify = { pass: true, note: 'no code changes to verify' };
if (done.length > 0) {
  verify = await agent(
    `In ${REPO}, run a clean authoritative verification and report the result:
1. npm run build
2. npx tsc --noEmit
3. npx vitest run
Return { pass, testsPassed, testsFailed, note }. pass=true ONLY if build + typecheck succeed and zero tests fail.`,
    {
      label: 'verify:suite',
      phase: 'Verify',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['pass', 'note'],
        properties: {
          pass: { type: 'boolean' },
          testsPassed: { type: 'integer' },
          testsFailed: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
  );
  log(`Verify: ${verify?.pass ? 'PASS' : 'FAIL'} — ${verify?.note ?? ''}`);
}

// ── Phase 6: Ship (branch + scoped commit + PR) ───────────────────────────────
phase('Ship');
if (done.length === 0) {
  log('No code changes landed — nothing to commit. Config extensions (if any) were applied to the live config directly.');
  return {
    branch: null, prUrl: null, totals, configApplied,
    approved: approved.map((v) => v.lead),
    implemented: [],
    skipped: implResults.filter((r) => r.status !== 'done').map((r) => ({ lead: r.lead, status: r.status, summary: r.summary })),
    verify, report: REPORT,
  };
}

if (!verify?.pass) {
  log('Verification FAILED — refusing to commit. Leaving changes in the working tree for manual inspection.');
  return {
    branch: null, prUrl: null, committed: false, reason: 'verification failed',
    verify, implemented: done.map((r) => r.lead), report: REPORT,
  };
}

// Compute the EXACT set of files to stage — deterministically, in the script,
// not by the agent. Only files the Implement phase reported touching, with the
// workflow-owned / unrelated files filtered out. The agent runs `git add` on
// exactly this list and nothing else.
const stageList = [...new Set(done.flatMap((r) => r.files ?? []))]
  .map((f) => f.replace(/^\.?\//, '')) // normalize any leading ./ or /
  .filter((f) => !NEVER_STAGE.includes(f));

if (stageList.length === 0) {
  log('Implementation reported no stageable files (all touched files are workflow-owned or excluded). Not committing.');
  return {
    branch: null, prUrl: null, committed: false, reason: 'no stageable files',
    totals, configApplied, verify, report: REPORT,
    implemented: done.map((r) => r.lead),
  };
}

// Commit title from the actual implemented leads — no placeholder.
const leadNames = done.map((r) => r.lead).join(', ');
const commitTitle = `feat: auto-approve ${leadNames} from passthrough triage`;
const addCommands = stageList.map((f) => `git add ${f}`).join('\n   ');

log(`Staging ${stageList.length} file(s): ${stageList.join(', ')}`);

const ship = await agent(
  `Commit ALREADY-WRITTEN, ALREADY-VERIFIED matcher changes in ${REPO} on a new branch and open a PR. Do NOT edit any source — only run git/gh. The working tree contains unrelated changes (e.g. a package.json version edit) that must NOT be included.

Run these steps in order:
1. git checkout -b ${BRANCH}
2. Stage EXACTLY these files and NO others — run each command verbatim:
   ${addCommands}
   Do NOT run \`git add -A\`, \`git add .\`, or \`git add\` on any other path. In particular do NOT stage: ${NEVER_STAGE.join(', ')}.
3. Run \`git status --short\`. Verify BEFORE committing that the staged set (lines whose column-1 status letter is set) is EXACTLY these ${stageList.length} file(s): ${stageList.join(', ')}. If anything else is staged, unstage it with \`git restore --staged <path>\`. If any of the ${stageList.length} is missing from the index, re-run its \`git add\`. Do not proceed until the staged set matches exactly — this pre-commit check is what prevents a dropped-file commit (do NOT rely on \`git commit --amend\` to fix it afterward; --amend is blocked and will stall the run).
4. Commit with this exact title (use -m for the title, a second -m for the body):
   Title: ${JSON.stringify(commitTitle)}
   Body: list each matcher added/fixed (${done.map((r) => `${r.lead} → ${r.matcher ?? 'n/a'} (+${r.testsAdded ?? 0} tests)`).join('; ')}); note that verified config extensions were applied to the live config separately (not in this commit); note the full suite passed (${verify?.testsPassed ?? '?'} tests, 0 failures).
5. Run \`git show --stat HEAD\` and confirm the commit contains exactly the ${stageList.length} intended file(s). If a file is missing: \`git reset --soft HEAD~1\` (undo the commit, keep changes staged), \`git add\` the missing file, and commit again with the same title/body. (Avoid \`git commit --amend\` — it is blocked.)
6. git push -u origin ${BRANCH}
7. gh pr create --base main --title ${JSON.stringify(commitTitle)} --body with: the triage counts (resolved ${totals.resolved ?? '?'} / config ${totals.configExtension ?? '?'} / code ${totals.codeCandidate ?? '?'} / unapprovable ${totals.unapprovable ?? '?'}), the matchers implemented, that the full test suite passed, and a line pointing at ${REPORT} (which is intentionally NOT committed).
8. Return branch, commitSha, prUrl, and the exact stagedFiles list you committed.

If push or PR creation fails (e.g. auth), still return branch + commitSha and put the error in "note".`,
  {
    label: 'ship:pr',
    phase: 'Ship',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['branch', 'stagedFiles'],
      properties: {
        branch: { type: 'string' },
        commitSha: { type: 'string' },
        prUrl: { type: 'string' },
        stagedFiles: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
  },
);

log(`Shipped on ${ship?.branch ?? BRANCH}${ship?.prUrl ? ` → ${ship.prUrl}` : ''}`);
// Sanity-check: warn if the agent committed anything outside the intended set.
const committed = ship?.stagedFiles ?? [];
const unexpected = committed.filter((f) => !stageList.includes(f.replace(/^\.?\//, '')));
if (unexpected.length > 0) log(`⚠️ Ship committed unexpected file(s): ${unexpected.join(', ')} — review the PR.`);

return {
  branch: ship?.branch ?? BRANCH,
  prUrl: ship?.prUrl ?? null,
  commitSha: ship?.commitSha ?? null,
  commitTitle,
  totals, configApplied,
  implemented: done.map((r) => ({ lead: r.lead, matcher: r.matcher, files: r.files, testsAdded: r.testsAdded })),
  skipped: implResults.filter((r) => r.status !== 'done').map((r) => ({ lead: r.lead, status: r.status, summary: r.summary })),
  verify, report: REPORT,
  intendedStageList: stageList,
  stagedFiles: ship?.stagedFiles ?? [],
  note: ship?.note,
};
