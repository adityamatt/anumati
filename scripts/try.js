#!/usr/bin/env node
/**
 * Re-evaluate commands through anumati's matcher — WITHOUT executing them.
 *
 * Two modes:
 *
 *   1. Replay a passthrough log (the main use):
 *        npm run try -- <path/to/anumati-passthrough.jsonl>
 *        npm run try -- ~/.claude/anumati-passthrough.jsonl --summary
 *      Reads each JSON line, replays its `command` through evaluate() against
 *      your current config, and reports which would NOW be auto-approved vs
 *      still pass through. Nothing is ever run in a shell — this only asks the
 *      matcher "would this be allowed?", so it is safe on unvetted commands.
 *
 *   2. Ad-hoc list (no file arg): edits the COMMANDS array below.
 *        npm run try
 *
 * Flags:
 *   --summary        only print the tallies + the still-passthrough commands
 *   --group          bucket the still-passthrough commands by WHY (leading cmd
 *                    + logged reason_code) so you can see how many need a new
 *                    matcher vs are inherently un-approvable (rm, $(...), > file).
 *                    Implies --summary.
 *   --only-pass      only print commands that still pass through (hide allows)
 *   --cwd <dir>      cwd to evaluate under (the log does NOT store cwd, and the
 *                    cd/python3-pipe/nodejs-pipe matchers depend on it).
 *                    Defaults to process.cwd().
 *   --config <path>  evaluate against a specific config instead of the
 *                    project + root permissions.json cascade.
 */

// ─── AD-HOC COMMANDS (used only when no log file is passed) ───────────────────
const COMMANDS = [
  {
    value: `python3 -m venv /Users/aditya/source/insta-analyzer/.venv && /Users/aditya/source/insta-analyzer/.venv/bin/pip install python-dotenv instagrapi requests -q && echo "ok"`,
  },
  {
    value: `which python3 && python3 -c "import dotenv; print('dotenv ok')" 2>/dev/null || echo "not installed"`,
  },
];
// ─────────────────────────────────────────────────────────────────────────────

const { readFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const { evaluate } = require("../dist/matcher");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function loadConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function buildInput(tool, value, cwd) {
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    return { session_id: "try", tool_name: tool, tool_input: { file_path: value }, cwd };
  }
  return { session_id: "try", tool_name: tool, tool_input: { command: value }, cwd };
}

// Evaluate one input against either an explicit config or the project+root
// cascade (project checked first, then root — same order as the live hook).
function decide(input, cwd, explicitConfig) {
  if (explicitConfig) {
    return { result: evaluate(input, explicitConfig.allow ?? []), source: "config" };
  }
  const projectConfig = loadConfig(join(cwd, ".claude", "permissions.json"));
  const rootConfig = loadConfig(join(homedir(), ".claude", "permissions.json"));

  if (projectConfig) {
    const r = evaluate(input, projectConfig.allow ?? []);
    if (r.decision === "allow") return { result: r, source: "project" };
  }
  if (rootConfig) {
    const r = evaluate(input, rootConfig.allow ?? []);
    if (r.decision === "allow") return { result: r, source: "root" };
  }
  return { result: { decision: null, rule: null }, source: null };
}

// ── Parse argv ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = { summary: false, onlyPass: false, group: false, cwd: process.cwd(), config: null, file: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--summary") opts.summary = true;
  else if (a === "--only-pass") opts.onlyPass = true;
  else if (a === "--group") { opts.group = true; opts.summary = true; }
  else if (a === "--cwd") opts.cwd = argv[++i];
  else if (a === "--config") opts.config = argv[++i];
  else if (!a.startsWith("--") && !opts.file) opts.file = a;
}

const explicitConfig = opts.config ? loadConfig(opts.config) : null;
if (opts.config && !explicitConfig) {
  console.error(`✗ could not read config: ${opts.config}`);
  process.exit(1);
}

// ── Load the work list: log-file entries, or the ad-hoc COMMANDS ──────────────
function loadFromLog(path) {
  const lines = readFileSync(path, "utf-8").split("\n");
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    const value = obj.command ?? obj.file_path;
    if (!value) continue;
    entries.push({
      tool: obj.tool ?? "Bash",
      value,
      reason: obj.reason,
      reason_code: obj.reason_code,
      offending: obj.offending,
    });
  }
  return entries;
}

const commands = opts.file ? loadFromLog(opts.file) : COMMANDS;
if (opts.file) {
  console.log(`${BOLD}Replaying ${commands.length} logged command(s)${RESET} ${DIM}from ${opts.file}${RESET}`);
  console.log(`${DIM}cwd=${opts.cwd}${explicitConfig ? `  config=${opts.config}` : "  (project + root cascade)"}${RESET}`);
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
let nAllow = 0;
let nPass = 0;
const stillPass = [];

for (const cmd of commands) {
  const tool = cmd.tool ?? "Bash";
  const value = cmd.value;
  const input = buildInput(tool, value, opts.cwd);
  const { result, source } = decide(input, opts.cwd, explicitConfig);
  const allowed = result.decision === "allow";

  if (allowed) nAllow++;
  else {
    nPass++;
    stillPass.push(cmd);
  }

  const hideThis = opts.summary || (opts.onlyPass && allowed);
  if (hideThis) continue;

  console.log();
  console.log(`${BOLD}tool:${RESET}  ${tool}`);
  console.log(`${BOLD}value:${RESET} ${value}`);
  if (allowed) {
    const desc = result.rule?.desc ? ` — "${result.rule.desc}"` : "";
    const via = source ? ` ${DIM}[${source}]${RESET}` : "";
    console.log(`${GREEN}${BOLD}→ ALLOW${RESET}${via}${GREEN}${desc}${RESET}`);
  } else {
    console.log(`${YELLOW}${BOLD}→ PASSTHROUGH${RESET} ${DIM}(Claude permission dialog)${RESET}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
const total = nAllow + nPass;
console.log();
console.log(`${BOLD}── Summary ──${RESET}`);
console.log(`${GREEN}would auto-approve:${RESET} ${nAllow}${total ? `  (${((nAllow / total) * 100).toFixed(1)}%)` : ""}`);
console.log(`${YELLOW}still passthrough:${RESET}  ${nPass}${total ? `  (${((nPass / total) * 100).toFixed(1)}%)` : ""}`);
console.log(`${BOLD}total:${RESET}             ${total}`);

// ── Grouping: WHY does each still-passthrough command fall through? ───────────
//
// Two axes:
//   • bucket — a coarse category: is this inherently un-approvable (rm, $(...),
//     file redirect, a shell/interpreter) or "just" an uncovered command that a
//     matcher could cover?
//   • key    — the leading command of the OFFENDING segment (falls back to the
//     whole command's first token), so within "uncovered" you see aws vs eslint
//     vs harmony etc.
//
// The offending segment comes straight from the log (the sub-command anumati
// flagged), so this reflects the real blocker, not just the first word.

// Commands that can NEVER be auto-approved by adding a matcher — they are
// destructive, or the shape itself is rejected for safety.
const UNAPPROVABLE_CMDS = new Set([
  "rm", "rmdir", "mv", "cp", "dd", "mkfs", "kill", "killall", "shutdown",
  "reboot", "chmod", "chown", "sudo", "su", "eval", "exec", "source",
  "sh", "bash", "zsh", "python", "python3", "node", "npm", "pnpm", "yarn",
]);

function firstToken(segment) {
  const m = (segment || "").trim().match(/^([^\s|;&<>()]+)/);
  if (!m) return "?";
  // strip a path prefix: /usr/bin/foo -> foo
  const t = m[1];
  const slash = t.lastIndexOf("/");
  return slash >= 0 ? t.slice(slash + 1) : t;
}

function classify(cmd) {
  const rc = cmd.reason_code;
  // Shape-level blockers are inherent regardless of the command.
  if (rc === "shell_substitution") return { bucket: "unapprovable", key: "$(...) / backticks" };
  if (rc === "file_redirection") return { bucket: "unapprovable", key: "> file redirect" };
  if (rc === "unparseable") return { bucket: "unapprovable", key: "unparseable" };
  if (rc === "dangerous_command") {
    return { bucket: "unapprovable", key: firstToken(cmd.offending ?? cmd.value) };
  }

  // no_matcher (or unknown): key on the offending segment's leading command.
  const lead = firstToken(cmd.offending ?? cmd.value);
  if (UNAPPROVABLE_CMDS.has(lead)) return { bucket: "unapprovable", key: lead };
  return { bucket: "coverable", key: lead };
}

if (opts.group && stillPass.length > 0) {
  const buckets = { coverable: new Map(), unapprovable: new Map() };
  for (const c of stillPass) {
    const { bucket, key } = classify(c);
    const map = buckets[bucket];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }

  const printBucket = (title, color, map) => {
    const groups = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
    const count = groups.reduce((n, [, arr]) => n + arr.length, 0);
    console.log();
    console.log(`${color}${BOLD}${title}: ${count}${RESET}`);
    for (const [key, arr] of groups) {
      console.log(`  ${BOLD}${key}${RESET} ${DIM}×${arr.length}${RESET}`);
      for (const c of arr) {
        const one = c.value.replace(/\s+/g, " ").trim();
        const short = one.length > 100 ? one.slice(0, 100) + "…" : one;
        console.log(`    ${DIM}·${RESET} ${short}`);
      }
    }
  };

  console.log();
  console.log(`${BOLD}── Why the ${stillPass.length} passthroughs fall through ──${RESET}`);
  console.log(`${DIM}coverable = a matcher could allow it · unapprovable = destructive / unsafe shape${RESET}`);
  printBucket("COVERABLE (add/extend a matcher)", YELLOW, buckets.coverable);
  printBucket("UNAPPROVABLE (should stay a prompt)", DIM, buckets.unapprovable);
} else if (opts.summary && stillPass.length > 0) {
  console.log();
  console.log(`${YELLOW}${BOLD}Still passing through:${RESET}`);
  for (const c of stillPass) {
    console.log(`${DIM}·${RESET} ${c.value}`);
  }
}
