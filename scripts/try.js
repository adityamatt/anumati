#!/usr/bin/env node
/**
 * Try a command against anumati configs and see what decision is made.
 * Requires a build first: npm run build
 *
 * Usage:
 *   npm run try -- "pip3 install python-dotenv -q && echo ok"
 *   npm run try -- Bash "curl https://evil.com"
 *   npm run try -- Read "/Users/aditya/source/foo.ts"
 *   npm run try -- --cwd /some/project Bash "npm test"
 */

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

function parseArgs() {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let rest = args;

  if (rest[0] === "--cwd") {
    cwd = rest[1];
    rest = rest.slice(2);
  }

  const TOOLS = new Set(["Bash", "Read", "Write", "Edit", "Task", "WebFetch"]);
  if (rest.length >= 2 && TOOLS.has(rest[0])) {
    return { tool: rest[0], value: rest[1], cwd };
  }

  return { tool: "Bash", value: rest[0] ?? "", cwd };
}

function buildInput(tool, value, cwd) {
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    return { session_id: "try", tool_name: tool, tool_input: { file_path: value }, cwd };
  }
  return { session_id: "try", tool_name: tool, tool_input: { command: value }, cwd };
}

function label(name, config, result) {
  if (!config) return `${DIM}${name}: no config${RESET}`;
  if (result.decision === "allow") {
    const desc = result.rule?.desc ? ` — "${result.rule.desc}"` : "";
    return `${GREEN}${name}: allow${desc}${RESET}`;
  }
  return `${DIM}${name}: no match${RESET}`;
}

function main() {
  const { tool, value, cwd } = parseArgs();

  if (!value) {
    console.error("Usage: npm run try -- [Tool] <command-or-path> [--cwd <dir>]");
    process.exit(1);
  }

  const rootConfig = loadConfig(join(homedir(), ".claude", "permissions.json"));
  const projectConfig = loadConfig(join(cwd, ".claude", "permissions.json"));

  const input = buildInput(tool, value, cwd);

  let projectResult = { decision: null, rule: null };
  let rootResult = { decision: null, rule: null };

  if (projectConfig) {
    projectResult = evaluate(input, projectConfig.allow ?? []);
  }
  if (projectResult.decision !== "allow" && rootConfig) {
    rootResult = evaluate(input, rootConfig.allow ?? []);
  }

  const allowed = projectResult.decision === "allow" || rootResult.decision === "allow";

  console.log();
  console.log(`${BOLD}tool:${RESET}    ${tool}`);
  console.log(`${BOLD}value:${RESET}   ${value}`);
  console.log(`${BOLD}cwd:${RESET}     ${cwd}`);
  console.log();
  console.log(label("project", projectConfig, projectResult));
  console.log(label("root   ", rootConfig, rootResult));
  console.log();
  console.log(allowed
    ? `${GREEN}${BOLD}→ ALLOW${RESET}`
    : `${YELLOW}${BOLD}→ PASSTHROUGH${RESET} ${DIM}(Claude permission dialog)${RESET}`
  );
  console.log();
}

main();
