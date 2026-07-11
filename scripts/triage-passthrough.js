#!/usr/bin/env node
/**
 * Triage the anumati passthrough log into actionable buckets.
 *
 * Every line in the passthrough log is a command anumati did NOT auto-approve —
 * i.e. a candidate a rule *might* have approved. This script re-evaluates each
 * one against your CURRENT config + matcher code and sorts it into:
 *
 *   • resolved         — evaluate() now allows it (a matcher/config added since
 *                        it was logged already covers it). Nothing to do.
 *   • config-extension — suggest() returns a VERIFIED config change (near-miss
 *                        on an existing rule, or a new rule for a matcher that
 *                        already exists in code). Fixable by `anumati add …`,
 *                        no code change. The suggested CLI command is included.
 *   • code-candidate   — coverable, but no config change suffices: a matcher
 *                        must be created (no matcher owns the leading command)
 *                        or fixed (a matcher owns it but rejects this shape).
 *   • unapprovable     — destructive or an inherently unsafe shape (rm, sudo,
 *                        $(...), a file redirect, an interpreter). Should stay a
 *                        manual prompt; surfaced only so you can confirm.
 *
 * SAFETY: this never executes a logged command. It only asks the matcher
 * "would this be allowed?" and "what config change would allow it?", reusing
 * anumati's own tested evaluate()/suggest()/debugDiagnose() — so the triage can
 * never drift from, or be less safe than, the live hook.
 *
 * Usage:
 *   node scripts/triage-passthrough.js [flags]
 *
 * Flags:
 *   --log <path>      passthrough log to read
 *                     (default ~/.claude/anumati-passthrough.jsonl)
 *   --config <path>   config to evaluate/suggest against
 *                     (default ~/.claude/permissions.json)
 *   --cwd <dir>       cwd to evaluate under. The log does NOT store cwd, and the
 *                     cd/python3-pipe/nodejs-pipe matchers depend on it; a wrong
 *                     cwd only ever *under*-approves here. Default process.cwd().
 *   --out <path>      markdown report path (default triage-report.md)
 *   --json <path>     machine-readable result path (default triage-result.json)
 *   --quiet           don't print the human summary to stdout
 */

const { readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");

const { evaluate } = require("../dist/matcher");
const { suggest } = require("../dist/suggest");
const { debugDiagnose } = require("../dist/debug");

// ── Classification tables ─────────────────────────────────────────────────────

// Leading commands that can NEVER be made auto-approvable by adding a matcher —
// destructive, privileged, or an interpreter/shell that can run anything.
const UNAPPROVABLE_CMDS = new Set([
  "rm", "rmdir", "mv", "cp", "dd", "mkfs", "kill", "killall", "shutdown",
  "reboot", "chmod", "chown", "sudo", "su", "eval", "exec", "source",
  "sh", "bash", "zsh", "fish", "ksh",
]);

// Leading command → the matcher family that already owns it in the codebase.
// If a command with one of these leads still passes through, the fix is to
// EXTEND/FIX that matcher, not write a new one. Anything not here that is
// coverable implies a brand-new matcher.
const LEAD_TO_MATCHER = new Map([
  ["git", "git-read/git-write"],
  ["cargo", "cargo"],
  ["go", "go"],
  ["sed", "sed"],
  ["jq", "jq"],
  ["aws", "aws"],
  ["vitest", "vitest"],
  ["eslint", "eslint"],
  ["prettier", "prettier"],
  ["curl", "curl"],
  ["gh", "gh"],
  ["pip", "pip3-install"],
  ["pip3", "pip3-install"],
  ["npm", "npm-script"],
  ["pnpm", "npm-script"],
  ["yarn", "npm-script"],
  ["python", "python3-pipe/test-runner"],
  ["python3", "python3-pipe/test-runner"],
  ["node", "nodejs-pipe"],
  ["pytest", "test-runner"],
  ["jest", "test-runner"],
  ["tsc", "npx-tsc"],
  ["cd", "cd"],
  ["sleep", "sleep"],
  ["echo", "echo"],
  ["ls", "safe-inspect"],
  ["cat", "safe-inspect"],
  ["grep", "safe-inspect"],
  ["find", "safe-inspect"],
]);

function firstToken(segment) {
  const m = (segment || "").trim().match(/^([^\s|;&<>()]+)/);
  if (!m) return "?";
  const t = m[1];
  const slash = t.lastIndexOf("/");
  return slash >= 0 ? t.slice(slash + 1) : t;
}

function loadConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ── Args ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = {
  log: join(homedir(), ".claude", "anumati-passthrough.jsonl"),
  config: join(homedir(), ".claude", "permissions.json"),
  cwd: process.cwd(),
  out: "triage-report.md",
  json: "triage-result.json",
  quiet: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--log") opts.log = argv[++i];
  else if (a === "--config") opts.config = argv[++i];
  else if (a === "--cwd") opts.cwd = argv[++i];
  else if (a === "--out") opts.out = argv[++i];
  else if (a === "--json") opts.json = argv[++i];
  else if (a === "--quiet") opts.quiet = true;
}

const config = loadConfig(opts.config);
if (!config) {
  console.error(`✗ could not read config: ${opts.config}`);
  process.exit(1);
}
const allRules = config.allow ?? [];

// ── Load + dedupe the log ───────────────────────────────────────────────────

function loadLog(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    console.error(`✗ could not read log: ${path}`);
    process.exit(1);
  }
  const byCommand = new Map(); // normalized command → { command, tool, count, reason_code, offending, ts }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const command = obj.command ?? obj.file_path;
    if (!command) continue;
    const key = command.replace(/\s+/g, " ").trim();
    const prev = byCommand.get(key);
    if (prev) {
      prev.count++;
      prev.ts = obj.ts ?? prev.ts; // keep the latest occurrence's metadata
      prev.reason_code = obj.reason_code ?? prev.reason_code;
      prev.offending = obj.offending ?? prev.offending;
    } else {
      byCommand.set(key, {
        command,
        tool: obj.tool ?? "Bash",
        count: 1,
        reason_code: obj.reason_code,
        reason: obj.reason,
        offending: obj.offending,
        ts: obj.ts,
      });
    }
  }
  return [...byCommand.values()];
}

const entries = loadLog(opts.log);

// ── Categorize each unique command ────────────────────────────────────────────

function buildInput(entry) {
  if (entry.tool === "Read" || entry.tool === "Write" || entry.tool === "Edit") {
    return { session_id: "triage", tool_name: entry.tool, tool_input: { file_path: entry.command }, cwd: opts.cwd };
  }
  return { session_id: "triage", tool_name: entry.tool, tool_input: { command: entry.command }, cwd: opts.cwd };
}

const buckets = {
  resolved: [],
  configExtension: [],
  codeCandidate: [],
  unapprovable: [],
};

for (const entry of entries) {
  const input = buildInput(entry);

  // 1. Already covered by the current config/matchers?
  if (evaluate(input, allRules).decision === "allow") {
    buckets.resolved.push(entry);
    continue;
  }

  // 2. A verified config change (near-miss or new rule for an existing matcher)?
  const s = suggest(input, allRules);
  if (s) {
    buckets.configExtension.push({ ...entry, suggestion: s });
    continue;
  }

  // 3. No config change suffices. Diagnose WHY and split coverable (needs code)
  //    from inherently unapprovable (destructive / unsafe shape).
  const note = debugDiagnose(input, allRules);
  const code = note?.code ?? entry.reason_code ?? "unknown";
  const lead = firstToken(entry.offending ?? note?.offending ?? entry.command);

  const shapeBlocked =
    code === "shell_substitution" ||
    code === "file_redirection" ||
    code === "unparseable" ||
    code === "dangerous_command";

  if (shapeBlocked || UNAPPROVABLE_CMDS.has(lead)) {
    buckets.unapprovable.push({ ...entry, code, lead, reason: note?.reason ?? entry.reason });
    continue;
  }

  // Coverable via code: new matcher (no family owns the lead) or a fix to the
  // matcher that already owns it but rejected this shape.
  //
  // IMPORTANT: a "fix-existing" candidate means an owning matcher SAW this
  // command and declined it. That is often DELIBERATE (git push is network,
  // git reset --hard is destructive, sed -i writes, jest --watch hangs) — the
  // matcher is right and must not be loosened. Only sometimes is it an
  // accidental over-rejection (the quoted-`>` false positive, a safe flag not
  // yet recognized). The deterministic pass cannot tell these apart; it flags
  // the candidate and leaves the safe-vs-deliberate judgment to the workflow's
  // safety-gate agent. The reason text below primes that decision.
  const owningMatcher = LEAD_TO_MATCHER.get(lead) ?? null;
  const kind = owningMatcher ? "fix-existing" : "new-matcher";
  const reason =
    kind === "fix-existing"
      ? `Matcher family \`${owningMatcher}\` owns \`${lead}\` but no rule accepted this form. Determine whether the rejection is DELIBERATE (destructive/network/write/watch form — leave as-is) or an accidental over-rejection of a safe shape (fix the matcher).`
      : note?.reason ?? entry.reason;
  buckets.codeCandidate.push({
    ...entry,
    code,
    lead,
    kind,
    owningMatcher,
    reason,
    hint: note?.hint,
  });
}

// Group code candidates by leading command so each becomes one unit of work.
function groupCodeCandidates(items) {
  const byLead = new Map();
  for (const it of items) {
    if (!byLead.has(it.lead)) {
      byLead.set(it.lead, {
        lead: it.lead,
        kind: it.kind,
        owningMatcher: it.owningMatcher,
        reason: it.reason,
        hint: it.hint,
        examples: [],
      });
    }
    byLead.get(it.lead).examples.push({ command: it.command, count: it.count, offending: it.offending });
  }
  return [...byLead.values()].sort(
    (a, b) =>
      b.examples.reduce((n, e) => n + e.count, 0) -
      a.examples.reduce((n, e) => n + e.count, 0),
  );
}

// Group config extensions by the exact `anumati add` command so we apply each once.
function groupConfigExtensions(items) {
  const byCmd = new Map();
  for (const it of items) {
    const key = it.suggestion.command;
    if (!byCmd.has(key)) {
      byCmd.set(key, {
        command: key,
        description: it.suggestion.description,
        matcher: it.suggestion.matcher,
        configDelta: it.suggestion.configDelta,
        triggers: [],
      });
    }
    byCmd.get(key).triggers.push({ command: it.command, count: it.count });
  }
  return [...byCmd.values()].sort(
    (a, b) =>
      b.triggers.reduce((n, t) => n + t.count, 0) -
      a.triggers.reduce((n, t) => n + t.count, 0),
  );
}

const codeGroups = groupCodeCandidates(buckets.codeCandidate);
const configGroups = groupConfigExtensions(buckets.configExtension);

// ── Emit JSON (for the workflow to consume) ───────────────────────────────────

const result = {
  log: opts.log,
  config: opts.config,
  cwd: opts.cwd,
  totals: {
    uniqueCommands: entries.length,
    resolved: buckets.resolved.length,
    configExtension: buckets.configExtension.length,
    codeCandidate: buckets.codeCandidate.length,
    unapprovable: buckets.unapprovable.length,
  },
  configExtensions: configGroups,
  codeCandidates: codeGroups,
  unapprovable: buckets.unapprovable.map((e) => ({
    command: e.command,
    count: e.count,
    lead: e.lead,
    code: e.code,
    reason: e.reason,
  })),
};

writeFileSync(opts.json, JSON.stringify(result, null, 2) + "\n");

// ── Emit Markdown report ──────────────────────────────────────────────────────

function truncate(s, n) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function mdReport() {
  const t = result.totals;
  const lines = [];
  lines.push("# anumati passthrough triage");
  lines.push("");
  lines.push(`_Log: \`${opts.log}\`_  ·  _Config: \`${opts.config}\`_`);
  lines.push("");
  lines.push("| Bucket | Unique commands | Meaning |");
  lines.push("|---|---:|---|");
  lines.push(`| ✅ resolved | ${t.resolved} | Now auto-approved by current config/matchers — no action. |`);
  lines.push(`| ⚙️ config-extension | ${t.configExtension} | Fixable by \`anumati add …\` (verified). Auto-applied by the workflow. |`);
  lines.push(`| 🛠️ code-candidate | ${t.codeCandidate} | Needs a new or fixed matcher. Implemented by the workflow. |`);
  lines.push(`| 🚫 unapprovable | ${t.unapprovable} | Destructive / unsafe shape — should stay a manual prompt. |`);
  lines.push("");

  lines.push("## ⚙️ Config extensions (auto-appliable)");
  lines.push("");
  if (configGroups.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("Each is a **verified** change: anumati re-ran the real matcher with the");
    lines.push("added param and confirmed it then approves. Safe to apply as-is.");
    lines.push("");
    for (const g of configGroups) {
      const hits = g.triggers.reduce((n, x) => n + x.count, 0);
      lines.push(`### \`${g.command}\``);
      lines.push(`- **${g.description}** (matcher \`${g.matcher}\`) · ${g.triggers.length} distinct command(s), ${hits} occurrence(s)`);
      lines.push(`- Config delta: \`${JSON.stringify(g.configDelta)}\``);
      lines.push("- Triggered by:");
      for (const tr of g.triggers.slice(0, 5)) {
        lines.push(`  - \`${truncate(tr.command, 100)}\`${tr.count > 1 ? ` ×${tr.count}` : ""}`);
      }
      lines.push("");
    }
  }

  lines.push("## 🛠️ Code candidates (new / fixed matcher)");
  lines.push("");
  if (codeGroups.length === 0) {
    lines.push("_None._");
  } else {
    for (const g of codeGroups) {
      const hits = g.examples.reduce((n, e) => n + e.count, 0);
      const tag = g.kind === "new-matcher" ? "🆕 new matcher" : `🔧 fix \`${g.owningMatcher}\``;
      lines.push(`### \`${g.lead}\` — ${tag}`);
      lines.push(`- ${g.examples.length} distinct command(s), ${hits} occurrence(s)`);
      if (g.reason) lines.push(`- Why it falls through: ${g.reason}`);
      if (g.hint) lines.push(`- Hint: ${g.hint}`);
      lines.push("- Examples:");
      for (const e of g.examples.slice(0, 6)) {
        lines.push(`  - \`${truncate(e.command, 110)}\`${e.count > 1 ? ` ×${e.count}` : ""}`);
      }
      lines.push("");
    }
  }

  lines.push("## 🚫 Unapprovable (stays a manual prompt)");
  lines.push("");
  if (result.unapprovable.length === 0) {
    lines.push("_None._");
  } else {
    const byCode = new Map();
    for (const u of result.unapprovable) {
      if (!byCode.has(u.code)) byCode.set(u.code, []);
      byCode.get(u.code).push(u);
    }
    for (const [code, arr] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`### ${code} — ${arr.length}`);
      for (const u of arr.slice(0, 8)) {
        lines.push(`- \`${truncate(u.command, 110)}\`${u.count > 1 ? ` ×${u.count}` : ""}`);
      }
      lines.push("");
    }
    lines.push("> **Note:** if a `file_redirection` entry has no real redirect (e.g. a");
    lines.push("> quoted `>` inside a commit message), that is a matcher false positive —");
    lines.push("> a code-candidate in disguise. Scan this list before dismissing it.");
  }

  lines.push("");
  return lines.join("\n");
}

writeFileSync(opts.out, mdReport());

// ── Console summary ────────────────────────────────────────────────────────────

if (!opts.quiet) {
  const t = result.totals;
  console.log(`anumati triage — ${t.uniqueCommands} unique passthrough command(s)`);
  console.log(`  ✅ resolved:          ${t.resolved}`);
  console.log(`  ⚙️  config-extension:  ${t.configExtension}  (${configGroups.length} distinct add command(s))`);
  console.log(`  🛠️  code-candidate:    ${t.codeCandidate}  (${codeGroups.length} matcher(s) to build/fix)`);
  console.log(`  🚫 unapprovable:      ${t.unapprovable}`);
  console.log("");
  console.log(`Report: ${opts.out}`);
  console.log(`JSON:   ${opts.json}`);
}
