import { tokenize } from "../parser/shell.js";
import type { ClassifiedCommand } from "./types.js";

// Output-processing tools that are safe after any allowed command
const SAFE_BUILTINS = new Set([
  "head", "tail", "grep", "egrep", "fgrep", "rg",
  "cat", "ls", "echo", "wc", "sort", "uniq", "jq",
  "cut", "tr", "awk", "sed", "find", "xargs",
  "which", "type", "date", "pwd", "basename", "dirname",
  "column", "tee", "diff", "less", "more",
  "base64",
]);

// Interpreters and shells — always dangerous as pipe targets
const DANGEROUS_COMMANDS = new Set([
  "sh", "bash", "zsh", "fish", "ksh", "dash", "csh",
  "python", "python3", "node", "ruby", "perl", "php", "lua",
  "sudo", "su", "eval", "exec", "env", "xargs",
]);

// Remove xargs from safe builtins since it's in dangerous too (it can exec)
SAFE_BUILTINS.delete("xargs");

export function classify(raw: string): ClassifiedCommand {
  const argv = tokenize(raw);

  if (!argv || argv.length === 0) {
    return { kind: "unknown", argv: [], raw };
  }

  const cmd = argv[0];

  if (cmd === "gh") {
    if (argv[1] === "api") return { kind: "gh-api", argv, raw };
    return { kind: "dangerous", argv, raw };
  }
  if (cmd === "python3") {
    // script file: python3 script.py [args...]. When the first arg is a
    // non-flag it is the script path; everything after it is passed to the
    // script (sys.argv), NOT interpreted as a python flag. Checking this BEFORE
    // -c is required: in `python3 script.py -c x` the `-c` belongs to the
    // script, so it must not be mistaken for python's own -c.
    if (argv.length >= 2 && !argv[1].startsWith("-")) {
      return { kind: "python3-script", argv, raw };
    }
    const dashCIdx = argv.indexOf("-c");
    if (dashCIdx !== -1 && argv[dashCIdx + 1] !== undefined) {
      return { kind: "python3-c", argv, raw };
    }
    return { kind: "dangerous", argv, raw };
  }
  if (cmd === "node") {
    // script file: node script.js [args...]. A leading non-flag arg is the
    // script path; trailing args go to process.argv, not to node. Checked
    // before -e/-p for the same reason as python3 above.
    if (argv.length >= 2 && !argv[1].startsWith("-")) {
      return { kind: "nodejs-script", argv, raw };
    }
    // Inline eval: -e/--eval "code" (also -p/--print, which evals then prints).
    const evalIdx = argv.findIndex((a) => a === "-e" || a === "--eval" || a === "-p" || a === "--print");
    if (evalIdx !== -1 && argv[evalIdx + 1] !== undefined) {
      return { kind: "nodejs-e", argv, raw };
    }
    return { kind: "dangerous", argv, raw };
  }
  if (DANGEROUS_COMMANDS.has(cmd)) return { kind: "dangerous", argv, raw };
  if (cmd === "curl") return { kind: "curl", argv, raw };
  if (cmd === "git") return { kind: "git", argv, raw };
  if (SAFE_BUILTINS.has(cmd)) return { kind: "safe-builtin", argv, raw };

  return { kind: "unknown", argv, raw };
}
