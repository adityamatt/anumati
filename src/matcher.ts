import type { Rule, HookInput, MatchResult } from "./types.js";
import { matchNamed } from "./matchers/index.js";
import { parseCompound } from "./parser/shell.js";

function ruleMatches(rule: Rule, input: HookInput): boolean {
  if (rule.tool && rule.tool !== input.tool_name) return false;

  if (rule.matcher) {
    return matchNamed(rule.matcher, input, rule);
  }

  if (rule.subagent_type && input.tool_input.subagent_type !== rule.subagent_type) return false;

  return true;
}

// First rule that accepts the whole input, or null.
function firstMatchingRule(input: HookInput, allowRules: Rule[]): Rule | null {
  for (const rule of allowRules) {
    if (ruleMatches(rule, input)) return rule;
  }
  return null;
}

// Sequential (control-flow only) separators: no data flows between the pieces,
// so composing them is safe when every sub-command is independently approved.
// `&&` (on success), `;` (unconditional), and `||` (on failure) all qualify.
// A backgrounding `&` is deliberately excluded — it detaches a process and
// changes execution semantics, a different risk class.
const SEQUENTIAL_OPS = new Set(["&&", ";", "||"]);

/**
 * Split a command into sub-commands at top-level `&&`, `;`, and `||` — the
 * purely *sequential* operators, where no data flows between the pieces. Pipes
 * are kept INSIDE each sub-command (rejoined with ` | `), so a piped chain is
 * always handed to a single matcher as one unit and never composed across rules
 * — the pipe is a data-flow channel whose safety only the receiving matcher can
 * judge.
 *
 * Returns null (do not decompose) when the command:
 *   - does not parse,
 *   - contains a backgrounding `&` (changes execution semantics — not composed),
 *   - or yields fewer than 2 sub-commands (nothing to compose).
 */
export function decomposeSequential(command: string): string[] | null {
  const segments = parseCompound(command);
  if (!segments) return null;

  for (const s of segments) {
    if (s.operator === "&") return null;
  }

  const subs: string[] = [];
  let group: string[] = [];
  for (const s of segments) {
    group.push(s.raw);
    // A sequential operator ends the current sub-command; `|` (or null) keeps
    // accumulating so a pipeline stays glued into one sub-command.
    if (s.operator !== null && SEQUENTIAL_OPS.has(s.operator)) {
      subs.push(group.join(" | "));
      group = [];
    }
  }
  if (group.length > 0) subs.push(group.join(" | "));

  return subs.length >= 2 ? subs : null;
}

/**
 * Decide whether an input is allowed. Two strategies, in order:
 *
 *   1. Whole-command — a single rule's matcher accepts the entire command.
 *      This is where matchers apply their own compound vocabulary (a matcher may
 *      accept its own `cd … &&`, pipes into safe consumers, etc.).
 *
 *   2. Sequential composition — if no single rule covers the whole command,
 *      split it on `&&`/`;`/`||` and approve only if EVERY sub-command is
 *      independently accepted by some rule. Because a disallowed segment fails
 *      its own check, you still can't smuggle a bad command in by chaining it
 *      onto a good one. Pipes are never split across matchers (see
 *      decomposeSequential).
 */
export function evaluate(input: HookInput, allowRules: Rule[]): MatchResult {
  // 1. Whole-command.
  const whole = firstMatchingRule(input, allowRules);
  if (whole) return { decision: "allow", rule: whole };

  // 2. Sequential composition (Bash commands only).
  const command = input.tool_input.command;
  if (!command) return { decision: null, rule: null };

  const subs = decomposeSequential(command);
  if (!subs) return { decision: null, rule: null };

  for (const sub of subs) {
    const subInput: HookInput = {
      ...input,
      tool_input: { ...input.tool_input, command: sub },
    };
    if (!firstMatchingRule(subInput, allowRules)) {
      return { decision: null, rule: null };
    }
  }

  return {
    decision: "allow",
    rule: { desc: `composite: ${subs.length} sub-commands joined by && / ;` },
  };
}
