#!/usr/bin/env node
/**
 * Paste commands here and run: npm run try
 * Each entry: { tool, value, cwd? }
 * tool defaults to "Bash"; cwd defaults to process.cwd()
 */

// ─── ADD COMMANDS HERE ────────────────────────────────────────────────────────
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
    return {
      session_id: "try",
      tool_name: tool,
      tool_input: { file_path: value },
      cwd,
    };
  }
  return {
    session_id: "try",
    tool_name: tool,
    tool_input: { command: value },
    cwd,
  };
}

function label(name, config, result) {
  if (!config) return `${DIM}${name}: no config${RESET}`;
  if (result.decision === "allow") {
    const desc = result.rule?.desc ? ` — "${result.rule.desc}"` : "";
    return `${GREEN}${name}: allow${desc}${RESET}`;
  }
  return `${DIM}${name}: no match${RESET}`;
}

function run({ tool = "Bash", value, cwd = process.cwd() }) {
  const rootConfig = loadConfig(join(homedir(), ".claude", "permissions.json"));
  const projectConfig = loadConfig(join(cwd, ".claude", "permissions.json"));
  const input = buildInput(tool, value, cwd);

  let projectResult = { decision: null, rule: null };
  let rootResult = { decision: null, rule: null };

  if (projectConfig) projectResult = evaluate(input, projectConfig.allow ?? []);
  if (projectResult.decision !== "allow" && rootConfig)
    rootResult = evaluate(input, rootConfig.allow ?? []);

  const allowed =
    projectResult.decision === "allow" || rootResult.decision === "allow";

  console.log();
  console.log(`${BOLD}tool:${RESET}  ${tool}`);
  console.log(`${BOLD}value:${RESET} ${value}`);
  console.log(label("project", projectConfig, projectResult));
  console.log(label("root   ", rootConfig, rootResult));
  console.log(
    allowed
      ? `${GREEN}${BOLD}→ ALLOW${RESET}`
      : `${YELLOW}${BOLD}→ PASSTHROUGH${RESET} ${DIM}(Claude permission dialog)${RESET}`,
  );
}

for (const cmd of COMMANDS) run(cmd);
