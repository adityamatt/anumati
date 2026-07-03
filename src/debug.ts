import type { HookInput } from "./types.js";
import { parseCompound, tokenize } from "./parser/shell.js";
import { hasUnsafeRedirection } from "./parser/redirect.js";
import { classify } from "./classifiers/index.js";

/**
 * Debug diagnosis for a passthrough. Runs ONLY when `suggest.debug` is enabled
 * and a normal Suggestion did not fire — its job is to explain *why* a command
 * fell through so the user can decide how to expand their config. Unlike
 * suggest(), this never claims a config change would auto-approve the command;
 * it reports observations and, where applicable, a fixable reason.
 */
export interface DebugNote {
  /** One-line reason the command could not be auto-approved. */
  reason: string;
  /** Optional concrete hint on how to make it approvable. */
  hint?: string;
}

// Operators a command can be split on; only some are accepted by matchers, and
// each matcher decides which. `||` and backgrounding `&` are never accepted by
// any matcher, so they are always worth calling out. (`;` and `&&` are accepted
// by some matchers — e.g. safe-inspect chains read-only segments — so they are
// not flagged here; the real blocker in those cases is an uncovered segment.)
const NEVER_ACCEPTED_OPS = new Set(["||", "&"]);

const SUBSTITUTION_RE = /[`$]/;

export function debugDiagnose(input: HookInput): DebugNote | null {
  if (input.tool_name === "Read") {
    const fp = input.tool_input.file_path ?? "";
    if (fp.includes("..")) {
      return {
        reason: `Read path contains ".." (path traversal), which safe-read refuses.`,
        hint: "Use a path without .. segments, or approve this read manually.",
      };
    }
    return null;
  }

  if (input.tool_name !== "Bash") return null;
  const cmd = input.tool_input.command ?? "";
  if (!cmd) return null;

  // 1. Shell substitution — parseCompound bails entirely on these.
  if (SUBSTITUTION_RE.test(cmd)) {
    return {
      reason: "Command uses shell substitution (`$(...)` or backticks), which anumati never parses for safety.",
      hint: "Run the substituted part as a separate command, or approve this manually.",
    };
  }

  const segments = parseCompound(cmd);
  if (!segments) {
    return {
      reason: "Command could not be parsed (an unclosed quote, most likely).",
    };
  }

  // 2. Operators no matcher will ever accept (;, ||, trailing &).
  const blockedOp = segments.find(
    (s) => s.operator !== null && NEVER_ACCEPTED_OPS.has(s.operator),
  );
  if (blockedOp) {
    const op = blockedOp.operator;
    return {
      reason: `Command chains segments with "${op}", which no matcher accepts (it means independent commands).`,
      hint: "Run the segments as separate commands so each can be matched on its own.",
    };
  }

  // 3. Unsafe redirections — matchers reject redirects that write a file or
  //    read from one. Safe stream redirects (2>/dev/null, 2>&1, …) are fine and
  //    are not flagged here.
  const redirSeg = segments.find((s) => hasUnsafeRedirection(s.raw));
  if (redirSeg) {
    return {
      reason: `A segment redirects to/from a file ("${redirSeg.raw.trim()}"), which matchers reject.`,
      hint: "Drop the file redirection (e.g. `> out.log`) so the command can be matched, or approve it manually. Stream redirects like `2>/dev/null` are allowed.",
    };
  }

  // 4. Recognizable-but-uncovered: name the leading command's family so the
  //    user knows which matcher would need to exist or be extended.
  const first = segments[0];
  const c = classify(first.raw);
  const argv = tokenize(first.raw);
  const head = argv?.[0];

  if (c.kind === "dangerous") {
    return {
      reason: `Leading command "${head}" is treated as dangerous (interpreter/shell/privileged), so it is never auto-approved.`,
    };
  }

  if (head) {
    return {
      reason: `No matcher covers "${head}".`,
      hint: `If "${head}" is safe in your workflow, add or extend a matcher for it (see AGENT.md "Adding a new named matcher").`,
    };
  }

  return null;
}

/** Render a DebugNote for display, mirroring the 💡 suggestion format. */
export function formatDebugNote(note: DebugNote): string {
  const hint = note.hint ? `\n   → ${note.hint}` : "";
  return `🔍 anumati [debug]: ${note.reason}${hint}\n`;
}
