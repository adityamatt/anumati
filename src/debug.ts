import type { HookInput, Rule } from "./types.js";
import { parseCompound, tokenize } from "./parser/shell.js";
import { hasUnsafeRedirection } from "./parser/redirect.js";
import { classify } from "./classifiers/index.js";
import { evaluate, decomposeSequential } from "./matcher.js";

/**
 * Stable, enumerable reason codes for why a command was not auto-approved.
 * Logged alongside the human-readable `reason` so passthrough entries are
 * self-explanatory and filterable without re-analysis.
 */
export type PassthroughCode =
  | "shell_substitution" // contains $(...) or backticks — never parsed
  | "unparseable" // could not be parsed (e.g. unclosed quote)
  | "unsupported_operator" // ||, or a backgrounding & — never composed
  | "file_redirection" // redirect that writes/reads a file
  | "dangerous_command" // interpreter/shell/privileged leading command
  | "no_matcher" // a (sub-)command no configured rule covers
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

// `||` and a backgrounding `&` are never composed across matchers.
const NEVER_ACCEPTED_OPS = new Set(["||", "&"]);
const SUBSTITUTION_RE = /[`$]/;

// Diagnose a SINGLE command (no top-level && / ; / newline composition).
function diagnoseSingle(cmd: string): DebugNote {
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

  const blockedOp = segments.find((s) => s.operator !== null && NEVER_ACCEPTED_OPS.has(s.operator));
  if (blockedOp) {
    return {
      code: "unsupported_operator",
      reason: `Command chains segments with "${blockedOp.operator}", which no matcher accepts (it means independent commands).`,
      hint: "Run the segments as separate commands so each can be matched on its own.",
    };
  }

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
        return { ...diagnoseSingle(sub), offending: sub };
      }
    }
  }

  return diagnoseSingle(cmd);
}

/** Render a DebugNote for display, mirroring the 💡 suggestion format. */
export function formatDebugNote(note: DebugNote): string {
  const hint = note.hint ? `\n   → ${note.hint}` : "";
  return `🔍 anumati [debug]: ${note.reason}${hint}\n`;
}
