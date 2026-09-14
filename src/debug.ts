import type { HookInput, Rule } from "./types.js";
import { parseCompound, tokenize } from "./parser/shell.js";
import { hasUnsafeRedirection } from "./parser/redirect.js";
import { classify } from "./classifiers/index.js";
import { evaluate, decomposeSequential } from "./matcher.js";
import { LEAD_TO_MATCHERS } from "./matchers/registry.js";

/**
 * Stable, enumerable reason codes for why a command was not auto-approved.
 * Logged alongside the human-readable `reason` so passthrough entries are
 * self-explanatory and filterable without re-analysis.
 */
export type PassthroughCode =
  | "shell_substitution" // contains $(...) or backticks — never parsed
  | "unparseable" // could not be parsed (e.g. unclosed quote)
  | "file_redirection" // redirect that writes/reads a file
  | "dangerous_command" // interpreter/shell/privileged leading command
  | "no_matcher" // no matcher exists for this leading command at all
  | "matcher_not_configured" // a matcher for it EXISTS, but no enabled rule approved this form
  | "unknown"; // fell through for a reason we could not pin down

export interface DebugNote {
  /** Stable machine-readable code. */
  code: PassthroughCode;
  /** One-line human-readable reason the command could not be auto-approved. */
  reason: string;
  /** Optional concrete hint on how to make it approvable. */
  hint?: string;
  /** For composite commands, the specific sub-command that blocked approval. */
  offending?: string;
}

const SUBSTITUTION_RE = /[`$]/;

// Diagnose a SINGLE command (composable operators &&/;/||/& have already been
// split out by debugDiagnose before this is called). `allRules` lets the
// no-matcher branch tell "no matcher exists" apart from "a matcher exists but no
// rule is configured/enabled to approve this form".
function diagnoseSingle(cmd: string, allRules: Rule[] = []): DebugNote {
  if (SUBSTITUTION_RE.test(cmd)) {
    return {
      code: "shell_substitution",
      reason: "Command uses shell substitution (`$(...)` or backticks), which anumati never parses for safety.",
      hint: "Run the substituted part as a separate command, or approve this manually.",
    };
  }

  const segments = parseCompound(cmd);
  if (!segments) {
    return { code: "unparseable", reason: "Command could not be parsed (an unclosed quote, most likely)." };
  }

  // Note: all operators (&&/;/||/&) now compose, so there is no "unsupported
  // operator" branch here — a composite command is decomposed by debugDiagnose
  // and the offending sub-command is diagnosed individually below.
  const redirSeg = segments.find((s) => hasUnsafeRedirection(s.raw));
  if (redirSeg) {
    return {
      code: "file_redirection",
      reason: `A segment redirects to/from a file ("${redirSeg.raw.trim()}"), which matchers reject.`,
      hint: "Drop the file redirection (e.g. `> out.log`) so the command can be matched, or approve it manually. Stream redirects like `2>/dev/null` are allowed.",
    };
  }

  const first = segments[0];
  const c = classify(first.raw);
  const head = tokenize(first.raw)?.[0];

  if (c.kind === "dangerous") {
    return {
      code: "dangerous_command",
      reason: `Leading command "${head}" is treated as dangerous (interpreter/shell/privileged), so it is never auto-approved.`,
    };
  }

  if (head) {
    const owners = LEAD_TO_MATCHERS[head];
    if (owners && owners.length > 0) {
      // A matcher for this command EXISTS — the block is missing/insufficient
      // config, not a missing matcher. We don't guess which owner is the fix (a
      // family like git splits read/write/push across matchers), so name them all
      // and let the user pick; the shape may also be intentionally unapprovable.
      const fixHint =
        owners.length === 1
          ? `\`anumati add ${owners[0]} …\``
          : `the matching one of: ${owners.join(", ")}`;
      return {
        code: "matcher_not_configured",
        reason: `A matcher for "${head}" exists (${owners.join(", ")}) but no enabled rule approved this command — its allowlist may not cover this form, or the form is intentionally blocked (e.g. a destructive/network/write shape).`,
        hint: `If this command is safe in your workflow, enable or extend ${fixHint} (see AGENT.md for its options).`,
      };
    }
    return {
      code: "no_matcher",
      reason: `No matcher covers "${head}".`,
      hint: `If "${head}" is safe in your workflow, add or extend a matcher for it (see AGENT.md "Adding a new named matcher").`,
    };
  }

  return { code: "unknown", reason: "Command was not auto-approved." };
}

/**
 * Explain why a Bash command fell through. When `allRules` is provided and the
 * command is a sequential composite (&& / ; / newline), the diagnosis pinpoints
 * the specific sub-command that no rule accepted — so the reason reflects the
 * *actual* blocker, not just the first segment.
 */
export function debugDiagnose(input: HookInput, allRules: Rule[] = []): DebugNote | null {
  if (input.tool_name !== "Bash") return null;
  const cmd = input.tool_input.command ?? "";
  if (!cmd) return null;

  // If this is a sequential composite, find the sub-command that actually
  // blocked approval and diagnose that one — that is the real reason.
  const subs = decomposeSequential(cmd);
  if (subs && allRules.length > 0) {
    for (const sub of subs) {
      const subInput: HookInput = { ...input, tool_input: { ...input.tool_input, command: sub } };
      if (evaluate(subInput, allRules).decision !== "allow") {
        return { ...diagnoseSingle(sub, allRules), offending: sub };
      }
    }
  }

  return diagnoseSingle(cmd, allRules);
}

/** Render a DebugNote for display, mirroring the 💡 suggestion format. */
export function formatDebugNote(note: DebugNote): string {
  const hint = note.hint ? `\n   → ${note.hint}` : "";
  return `🔍 anumati [debug]: ${note.reason}${hint}\n`;
}
