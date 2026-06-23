import type { Rule, HookInput, MatchResult } from "./types.js";
import { matchNamed } from "./matchers/index.js";

function ruleMatches(rule: Rule, input: HookInput): boolean {
  if (rule.tool && rule.tool !== input.tool_name) return false;

  if (rule.matcher) {
    return matchNamed(rule.matcher, input, rule);
  }

  if (rule.subagent_type && input.tool_input.subagent_type !== rule.subagent_type) return false;

  return true;
}

export function evaluate(input: HookInput, allowRules: Rule[]): MatchResult {
  for (const rule of allowRules) {
    if (ruleMatches(rule, input)) {
      return { decision: "allow", rule };
    }
  }
  return { decision: null, rule: null };
}
