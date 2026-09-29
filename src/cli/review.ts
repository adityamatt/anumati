import { readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, sep } from "path";
import { createInterface } from "readline/promises";
import type { Config, HookInput, Rule } from "../types.js";
import {
  defaultConfigPath,
  projectConfigPath,
  loadConfig,
  resolvePreferred,
  anumatiHome,
  legacyHome,
} from "../config.js";
import { evaluate } from "../matcher.js";
import { suggest } from "../suggest.js";
import { debugDiagnose } from "../debug.js";
import { parseCompound, tokenize } from "../parser/shell.js";
import { applyAdd, type AddOptions } from "./add.js";
import { configDeltaToAddOptions } from "./apply.js";
import { prettyPath } from "./init.js";

export interface ReviewOptions {
  /** Explicit config path (wins over `level`). */
  config?: string;
  /** Which config to target when no explicit path is given. Default: root. */
  level?: "root" | "project";
  /** Passthrough log to analyze. Defaults to the config's `audit.passthrough_file`. */
  log?: string;
  /** cwd used when replaying logged commands (the log does not store one). */
  cwd?: string;
}

/** A config change that would auto-approve one or more fall-through commands. */
export interface Proposal {
  matcher: string;
  /** Union of every suggestion's configDelta for this matcher. */
  delta: Record<string, unknown>;
  /** The `anumati add …` options this proposal applies (derived from `delta`). */
  addOptions: AddOptions;
  /** Whether the target config already has a rule for this matcher, and its state. */
  ruleState: "absent" | "disabled" | "enabled";
  /** Distinct fall-through commands this proposal would cover. */
  distinct: number;
  /** Total log occurrences (a command may repeat). */
  occurrences: number;
  /** Every distinct command this proposal covers (used to verify after applying). */
  triggers: string[];
}

/** Fall-through commands no config change can approve, grouped by reason. */
export interface UnapprovableGroup {
  code: string;
  /** Short, command-free label for display (e.g. `no matcher for "git"`). */
  label: string;
  distinct: number;
  occurrences: number;
  /** A few example commands, for context (not printed — kept for callers). */
  samples: string[];
}

export interface ReviewAnalysis {
  configPath: string;
  logPath: string;
  logFound: boolean;
  /** Total log lines read (all occurrences). */
  totalPassthroughs: number;
  /** Distinct normalized commands. */
  distinctCommands: number;
  /** Distinct commands the target config already auto-approves. */
  alreadyCovered: number;
  /** Actionable config extensions, most-covered first. */
  proposals: Proposal[];
  /** Everything else, grouped by why it can't be auto-approved. */
  unapprovable: UnapprovableGroup[];
}

/** The passthrough log anumati writes fall-through calls to, by convention. */
function defaultPassthroughLog(config: Config | null): string {
  return (
    config?.audit?.passthrough_file ??
    resolvePreferred([
      join(anumatiHome(), "anumati-passthrough.jsonl"),
      join(legacyHome(), "anumati-passthrough.jsonl"),
    ])
  );
}

function bashInput(command: string, cwd: string): HookInput {
  return { session_id: "review", tool_name: "Bash", tool_input: { command }, cwd };
}

// Array allowlist fields a suggestion's configDelta can carry (open.allowed_paths
// is nested and handled separately).
const ARRAY_DELTA_KEYS = [
  "allowed_domains",
  "allowed_imports",
  "allowed_modules",
  "allowed_packages",
  "allowed_scripts",
  "allowed_exec",
  "allowed_repos",
] as const;

// Union `from` into `into` so one proposal per matcher accumulates every param
// its covered commands need (e.g. all curl domains across the log). applyAdd
// merges the same way, so the union is exactly what enabling the matcher writes.
function mergeDelta(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const key of ARRAY_DELTA_KEYS) {
    const add = from[key];
    if (!Array.isArray(add)) continue;
    const current = Array.isArray(into[key]) ? (into[key] as unknown[]) : [];
    into[key] = [...new Set([...current, ...add])];
  }
  const fromPaths = (from.open as { allowed_paths?: unknown } | undefined)?.allowed_paths;
  if (Array.isArray(fromPaths)) {
    const intoOpen = (into.open as { allowed_paths?: unknown[] } | undefined) ?? { allowed_paths: [] };
    const current = Array.isArray(intoOpen.allowed_paths) ? intoOpen.allowed_paths : [];
    into.open = { allowed_paths: [...new Set([...current, ...fromPaths])] };
  }
}

// A consolidated root must be at least this many components deep (e.g.
// /Users/me/.claude), so merging never widens approval to "/", /Users, or ~.
const MIN_CONSOLIDATED_DEPTH = 3;

function pathComponents(p: string): string[] {
  return p.split(sep).filter(Boolean);
}

function componentsToDir(parts: string[]): string {
  return sep + parts.join(sep) + sep;
}

function isUnder(child: string[], parent: string[]): boolean {
  return parent.length <= child.length && parent.every((c, i) => child[i] === c);
}

/**
 * Collapse sibling allowed_paths into their deepest shared ancestor, so review
 * proposes `/a/b/c/` rather than `/a/b/c/d/` and `/a/b/c/e/`. Merges greedily,
 * deepest ancestor first, and only into an ancestor that is at least
 * MIN_CONSOLIDATED_DEPTH deep and is not the home directory (or above it).
 * Paths already under another listed path are dropped. Relative paths are kept
 * as-is — they resolve per-cwd, so a shared prefix means nothing.
 */
export function consolidatePaths(paths: string[]): string[] {
  const relative = [...new Set(paths.filter((p) => !isAbsolute(p)))];
  const home = pathComponents(homedir());
  const isSafeRoot = (parts: string[]) =>
    parts.length >= MIN_CONSOLIDATED_DEPTH && !isUnder(home, parts);

  // Keep the original spelling of each absolute path alongside its components.
  let entries = [...new Set(paths.filter((p) => isAbsolute(p)))].map((raw) => ({
    raw,
    parts: pathComponents(raw),
  }));
  const dropCovered = () => {
    entries = entries.filter(
      (e, i) =>
        !entries.some(
          (o, j) => j !== i && isUnder(e.parts, o.parts) && (o.parts.length < e.parts.length || j < i),
        ),
    );
  };
  dropCovered();

  for (;;) {
    let best: string[] | null = null;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].parts;
        const b = entries[j].parts;
        let n = 0;
        while (n < a.length && n < b.length && a[n] === b[n]) n++;
        const shared = a.slice(0, n);
        if (isSafeRoot(shared) && (!best || shared.length > best.length)) best = shared;
      }
    }
    if (!best) break;
    entries.push({ raw: componentsToDir(best), parts: best });
    dropCovered();
  }

  return [...entries.map((e) => e.raw), ...relative];
}

function ruleStateFor(rules: Rule[], matcher: string): Proposal["ruleState"] {
  const rule = rules.find((r) => r.matcher === matcher);
  if (!rule) return "absent";
  return rule.enabled === false ? "disabled" : "enabled";
}

// The command word a passthrough leads with (e.g. "git" for `git push`), used to
// keep the unapprovable rows specific without printing the whole command.
function leadingToken(cmd: string): string {
  const segments = parseCompound(cmd);
  const raw = segments && segments.length > 0 ? segments[0].raw : cmd;
  return tokenize(raw)?.[0] ?? cmd.trim().split(/\s+/)[0] ?? "?";
}

// A short, command-free label + a stable grouping key for an unapprovable
// command. Shape codes group on their own; the command-specific codes also group
// by leading command so the count is attributed correctly.
function unapprovableGroup(code: string, command: string): { key: string; label: string } {
  if (code === "no_matcher") {
    const head = leadingToken(command);
    return { key: `no_matcher:${head}`, label: `no matcher for "${head}"` };
  }
  if (code === "matcher_not_configured") {
    const head = leadingToken(command);
    return { key: `matcher_not_configured:${head}`, label: `"${head}" matcher exists but no rule approves this` };
  }
  if (code === "dangerous_command") {
    const head = leadingToken(command);
    return { key: `dangerous_command:${head}`, label: `dangerous command "${head}"` };
  }
  const labels: Record<string, string> = {
    shell_substitution: "uses shell substitution ($(…) or backticks)",
    file_redirection: "reads/writes a file (redirect)",
    unparseable: "could not be parsed (e.g. an unclosed quote)",
    unknown: "not auto-approvable",
  };
  return { key: code, label: labels[code] ?? "not auto-approvable" };
}

/**
 * Read the passthrough log and, for each unique fall-through command, ask the
 * real suggest engine what config change would cover it — grouping the answers
 * per matcher into applyable proposals. Commands the config already approves are
 * counted (alreadyCovered) but not proposed; commands no config change can fix
 * (destructive shapes, uncovered leading commands, `$(…)`, redirects) are grouped
 * under `unapprovable` with the deterministic reason from debugDiagnose.
 *
 * This is pure analysis — it never writes. Every proposal is safe by
 * construction: suggest() re-runs the real matcher before emitting anything, so
 * this can only ever propose changes anumati itself verified.
 */
export function analyzeReview(opts: ReviewOptions & { rules?: Rule[]; config?: string }): ReviewAnalysis {
  const configPath = opts.config ?? (opts.level === "project" ? projectConfigPath(opts.cwd ?? process.cwd()) : defaultConfigPath());
  const config = loadConfig(configPath);
  const rules = opts.rules ?? config?.allow ?? [];
  const cwd = opts.cwd ?? "";
  const logPath = opts.log ?? defaultPassthroughLog(config);

  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return {
      configPath,
      logPath,
      logFound: false,
      totalPassthroughs: 0,
      distinctCommands: 0,
      alreadyCovered: 0,
      proposals: [],
      unapprovable: [],
    };
  }

  // Dedupe by normalized command, keeping an occurrence count (mirrors scaffold).
  const byCommand = new Map<string, { command: string; count: number }>();
  let totalPassthroughs = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { command?: string; tool?: string };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // anumati vets Bash only; a passthrough entry for another tool can't be
    // covered by a matcher, so skip it here.
    if (obj.tool && obj.tool !== "Bash") continue;
    if (!obj.command) continue;
    totalPassthroughs++;
    const key = obj.command.replace(/\s+/g, " ").trim();
    const prev = byCommand.get(key);
    if (prev) prev.count++;
    else byCommand.set(key, { command: obj.command, count: 1 });
  }

  const proposalsByMatcher = new Map<string, Proposal>();
  const unapprovableByCode = new Map<string, UnapprovableGroup>();
  let alreadyCovered = 0;

  for (const { command, count } of byCommand.values()) {
    const input = bashInput(command, cwd);

    // Already approved by today's config → nothing to propose.
    if (evaluate(input, rules).decision === "allow") {
      alreadyCovered++;
      continue;
    }

    const s = suggest(input, rules);
    if (s?.matcher) {
      const group =
        proposalsByMatcher.get(s.matcher) ??
        ({
          matcher: s.matcher,
          delta: {},
          addOptions: { matcher: s.matcher },
          ruleState: ruleStateFor(rules, s.matcher),
          distinct: 0,
          occurrences: 0,
          triggers: [],
        } as Proposal);
      mergeDelta(group.delta, s.configDelta ?? {});
      group.distinct++;
      group.occurrences += count;
      group.triggers.push(command);
      proposalsByMatcher.set(s.matcher, group);
      continue;
    }

    // No config change can cover it — record why (deterministic taxonomy).
    // Group by the *shape* (reason code), and for the command-specific codes
    // (no_matcher / dangerous_command) also by the leading command, so the row
    // stays accurate and useful — `no matcher for "git"` rather than lumping
    // every uncovered command under one command's name. Never embed the raw
    // command in the label (it may be a huge multi-line script).
    const note = debugDiagnose(input, rules);
    const { key, label } = unapprovableGroup(note?.code ?? "unknown", note?.offending ?? command);
    const g = unapprovableByCode.get(key) ?? {
      code: note?.code ?? "unknown",
      label,
      distinct: 0,
      occurrences: 0,
      samples: [],
    };
    g.distinct++;
    g.occurrences += count;
    if (g.samples.length < 3) g.samples.push(command);
    unapprovableByCode.set(key, g);
  }

  // Consolidate sibling paths into a shared root, then finalize each proposal's
  // applyable options from its merged delta.
  for (const p of proposalsByMatcher.values()) {
    const open = p.delta.open as { allowed_paths?: string[] } | undefined;
    if (open?.allowed_paths) open.allowed_paths = consolidatePaths(open.allowed_paths);
  }
  const proposals = [...proposalsByMatcher.values()]
    .map((p) => ({ ...p, addOptions: configDeltaToAddOptions(p.matcher, p.delta) }))
    .sort((a, b) => b.occurrences - a.occurrences || b.distinct - a.distinct);

  const unapprovable = [...unapprovableByCode.values()].sort(
    (a, b) => b.occurrences - a.occurrences || b.distinct - a.distinct,
  );

  return {
    configPath,
    logPath,
    logFound: true,
    totalPassthroughs,
    distinctCommands: byCommand.size,
    alreadyCovered,
    proposals,
    unapprovable,
  };
}

export interface ApplyProposalsResult {
  /** Proposals whose rule was written to the config. */
  applied: number;
  /** Distinct commands the chosen proposals were meant to cover. */
  targeted: number;
  /** Of those, how many the config now auto-approves (verified by re-evaluation). */
  nowApproved: number;
}

/**
 * Apply the chosen proposals to `configPath` (via applyAdd — the single source of
 * truth for writing config), then re-load the config and re-evaluate every
 * targeted command to report how many now auto-approve. Verification is honest:
 * it counts only commands the fresh ruleset actually accepts.
 */
export function applyProposals(proposals: Proposal[], configPath: string): ApplyProposalsResult {
  for (const p of proposals) {
    applyAdd(configDeltaToAddOptions(p.matcher, p.delta, configPath));
  }

  const config = loadConfig(configPath);
  const rules = config?.allow ?? [];
  const targeted = new Set<string>();
  for (const p of proposals) for (const t of p.triggers) targeted.add(t);

  let nowApproved = 0;
  for (const command of targeted) {
    if (evaluate(bashInput(command, ""), rules).decision === "allow") nowApproved++;
  }

  return { applied: proposals.length, targeted: targeted.size, nowApproved };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface ReviewCmdOptions extends ReviewOptions {
  /** Apply every proposal without prompting. */
  all?: boolean;
  /** Print the plan and exit without applying (never writes). */
  dryRun?: boolean;
}

export function parseReviewArgs(args: string[]): ReviewCmdOptions {
  const opts: ReviewCmdOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all" || arg === "--yes" || arg === "-y") opts.all = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--root" || arg === "--global") opts.level = "root";
    else if (arg === "--project" || arg === "--local") opts.level = "project";
    else if (arg === "--config" || arg === "--log") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--config") opts.config = value;
      else opts.log = value;
    }
    // Unknown flag — ignore quietly, matching the other subcommands.
  }
  return opts;
}

function actionVerb(state: Proposal["ruleState"]): string {
  if (state === "absent") return "add rule";
  if (state === "disabled") return "enable matcher";
  return "extend rule";
}

// Usable terminal width, with a sane fallback when not attached to a TTY.
function termWidth(): number {
  const cols = process.stdout.columns;
  return cols && cols >= 40 ? cols : 100;
}

// Collapse whitespace (commands can be multi-line) to one line, then hard-cap
// the length with an ellipsis. For illustrative text only — never the values a
// user consents to, and never the copy-paste command.
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cap = Math.max(max, 12);
  return flat.length > cap ? flat.slice(0, cap - 1) + "…" : flat;
}

// The concrete additions a proposal writes, as [label, values] pairs. Values are
// shown in full — they are the scope the user is consenting to.
function additionPairs(opts: AddOptions): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  const add = (label: string, arr?: string[]) => {
    if (arr && arr.length > 0) out.push([label, arr]);
  };
  add("domains", opts.domains);
  add("imports", opts.imports);
  add("modules", opts.modules);
  add("packages", opts.packages);
  add("scripts", opts.scripts);
  add("exec", opts.exec);
  add("repos", opts.repos);
  add("paths", opts.paths);
  return out;
}

// The copy-pasteable `anumati add …` command a proposal corresponds to.
function addCommand(opts: AddOptions): string {
  const parts = [`anumati add ${opts.matcher}`];
  const flag = (name: string, arr?: string[]) => {
    if (arr && arr.length > 0) parts.push(`${name} ${arr.join(",")}`);
  };
  flag("--domain", opts.domains);
  flag("--imports", opts.imports);
  flag("--modules", opts.modules);
  flag("--packages", opts.packages);
  flag("--scripts", opts.scripts);
  flag("--exec", opts.exec);
  flag("--repos", opts.repos);
  flag("--paths", opts.paths);
  return parts.join(" ");
}

const MAX_UNAPPROVABLE_ROWS = 12;
const LABEL_INDENT = "       "; // aligns detail lines under a numbered proposal

function printAnalysis(a: ReviewAnalysis, showApply: boolean): void {
  if (!a.logFound) {
    console.log(`No passthrough log at ${prettyPath(a.logPath)}.`);
    console.log("Nothing to review yet — run some commands so anumati can log what falls");
    console.log("through, or point at a log with `--log <path>`.");
    return;
  }

  const width = termWidth();

  console.log(`anumati review — ${prettyPath(a.configPath)}`);
  console.log("");
  console.log(`  passthrough log : ${prettyPath(a.logPath)}`);
  console.log(
    `  ${a.totalPassthroughs} passthrough(s) · ${a.distinctCommands} distinct · ${a.alreadyCovered} already auto-approve`,
  );
  console.log("");

  if (a.proposals.length === 0) {
    console.log("  No config change would auto-approve any more of them.");
  } else {
    console.log(`  ${a.proposals.length} change(s) would auto-approve more:`);
    console.log("");
    // Align the "+ label" column across all proposals for a clean read.
    const labelWidth = Math.max(
      4,
      ...a.proposals.flatMap((p) => additionPairs(p.addOptions).map(([l]) => l.length)),
    );
    a.proposals.forEach((p, i) => {
      const cover = p.occurrences > p.distinct ? ` (${p.occurrences}×)` : "";
      console.log(`  ${i + 1}. ${p.matcher} · ${actionVerb(p.ruleState)} · covers ${p.distinct}${cover}`);
      for (const [label, values] of additionPairs(p.addOptions)) {
        console.log(`${LABEL_INDENT}+ ${label.padEnd(labelWidth)}  ${values.join(", ")}`);
      }
      console.log(`${LABEL_INDENT}e.g. ${oneLine(p.triggers[0], width - LABEL_INDENT.length - 6)}`);
      if (showApply) console.log(`${LABEL_INDENT}apply: ${addCommand(p.addOptions)}`);
      console.log("");
    });
  }

  if (a.unapprovable.length > 0) {
    const totalDistinct = a.unapprovable.reduce((n, g) => n + g.distinct, 0);
    console.log(`  ${totalDistinct} command(s) can't be auto-approved — no config change helps:`);
    const rows = a.unapprovable.slice(0, MAX_UNAPPROVABLE_ROWS);
    for (const g of rows) {
      console.log(`${LABEL_INDENT}${String(g.distinct).padStart(4)}×  ${g.label}`);
    }
    const hidden = a.unapprovable.length - rows.length;
    if (hidden > 0) console.log(`${LABEL_INDENT}      … and ${hidden} more`);
    console.log("");
  }
}

/** CLI entrypoint: `anumati review [--all|-y] [--dry-run] [--log P] [--config P] [--project|--root]` */
export async function runReview(argv: string[]): Promise<void> {
  const args = argv.slice(1); // drop the "review" token
  let opts: ReviewCmdOptions;
  try {
    opts = parseReviewArgs(args);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const configPath = opts.config ?? (opts.level === "project" ? projectConfigPath(process.cwd()) : defaultConfigPath());
  if (!loadConfig(configPath)) {
    console.error(
      `✗ ${prettyPath(configPath)} does not exist or is invalid. Run \`anumati init\` first.`,
    );
    process.exit(1);
  }

  // Interactive = a TTY with neither --all nor --dry-run. Only then do we prompt
  // per change (and hide the copy-paste `apply:` line, since the prompt covers
  // it); every other mode prints the command so it can be copied.
  const interactive = Boolean(process.stdin.isTTY) && !opts.all && !opts.dryRun;

  const analysis = analyzeReview({ config: configPath, log: opts.log, cwd: process.cwd() });
  printAnalysis(analysis, !interactive);

  if (!analysis.logFound || analysis.proposals.length === 0) return;

  // Dry run: show the plan, never write.
  if (opts.dryRun) {
    console.log("Dry run — nothing applied. Re-run without --dry-run to choose changes.");
    return;
  }

  // Decide which proposals to apply.
  let chosen: Proposal[];
  if (opts.all) {
    chosen = analysis.proposals;
  } else if (interactive) {
    chosen = await promptForProposals(analysis.proposals);
  } else {
    // No TTY and no --all: never write silently. Show how to apply.
    console.log("Re-run with `--all` (or `-y`) to apply all of these, or in an interactive");
    console.log("terminal to choose per change.");
    return;
  }

  if (chosen.length === 0) {
    console.log("Nothing applied.");
    return;
  }

  const result = applyProposals(chosen, configPath);
  console.log(`✓ Applied ${result.applied} change(s) to ${prettyPath(configPath)}.`);
  console.log(
    `  ${result.nowApproved} of ${result.targeted} previously passing-through command(s) now auto-approve.`,
  );
}

// Interactive per-proposal consent. y = apply this, n = skip, a = apply this and
// all remaining, q = stop (apply nothing further). Empty input = skip (explicit
// yes required — the whole point is deliberate consent before widening approval).
async function promptForProposals(proposals: Proposal[]): Promise<Proposal[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const chosen: Proposal[] = [];
  let acceptRest = false;
  try {
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      if (acceptRest) {
        chosen.push(p);
        continue;
      }
      const ans = (
        await rl.question(`  Apply #${i + 1} (${p.matcher})? [y]es / [N]o / [a]ll / [q]uit › `)
      )
        .trim()
        .toLowerCase();
      if (ans === "q") break;
      if (ans === "a") {
        acceptRest = true;
        chosen.push(p);
      } else if (ans === "y" || ans === "yes") {
        chosen.push(p);
      }
      // anything else (including empty) → skip this one
    }
  } finally {
    rl.close();
  }
  return chosen;
}
