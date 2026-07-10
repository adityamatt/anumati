import { tokenize } from "./shell.js";
import { hasUnsafeRedirection } from "./redirect.js";

// `sed` is only safe in provably read-only forms. Its mini-language can write
// files (`-i`, the `w`/`W` commands, `s///w`) and even execute shell (`e`
// command, `s///e`), and `-f` runs an unverifiable external script — so we
// allow ONLY a strict grammar: read-only flags plus a script consisting solely
// of line addresses and the print/delete/quit/line-number commands.
//
// This check is shared by the standalone `sed` matcher and the composition
// points (safe-inspect chains, pipe-consumer tails) so a read-only `sed` can
// participate as one stage of an otherwise read-only pipeline.

// Boolean flags that do not change sed's read-only nature.
const SAFE_BOOLEAN_FLAGS = new Set([
  "-n", "--quiet", "--silent",
  "-E", "-r", "--regexp-extended",
  "-z", "--null-data",
  "-s", "--separate",
  "-u", "--unbuffered",
  "--posix",
]);

// A safe script: one or more `[address]command` units separated by `;`, where
// address is a line number or range, and command is p(rint) / d(elete from
// pattern space) / q(uit) / =(print line number). None of these touch disk or
// run commands. Substitution (`s///`) and file/exec commands are excluded.
// (The `$` last-line address is not modeled: the parser rejects any `$` up
// front as a shell-expansion risk, so such scripts never reach this matcher.)
const ADDR = String.raw`\d+(?:,\d+)?`;
const UNIT = String.raw`${ADDR}?[pdq=]`;
const SAFE_SED_SCRIPT = new RegExp(String.raw`^\s*${UNIT}(?:\s*;\s*${UNIT})*\s*$`);

/**
 * True if `raw` is a single, provably read-only `sed` invocation — read-only
 * flags plus a print/delete/quit/line-number script, no file write, in-place
 * edit, external script, exec, or unsafe redirection.
 */
export function isReadOnlySed(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;

  const argv = tokenize(raw);
  if (!argv || argv[0] !== "sed") return false;

  const scripts: string[] = [];
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("-")) {
      // In-place edit, external script file → hard reject.
      if (arg === "-i" || arg.startsWith("-i") || arg === "--in-place" || arg.startsWith("--in-place")) return false;
      if (arg === "-f" || arg === "--file" || arg.startsWith("--file=")) return false;

      // Explicit script via -e / --expression.
      if (arg === "-e" || arg === "--expression") {
        const script = argv[i + 1];
        if (script === undefined) return false;
        scripts.push(script);
        i += 2;
        continue;
      }
      if (arg.startsWith("--expression=")) {
        scripts.push(arg.slice("--expression=".length));
        i++;
        continue;
      }

      // Any other flag must be a known read-only boolean; unknown → reject.
      if (!SAFE_BOOLEAN_FLAGS.has(arg)) return false;
      i++;
      continue;
    }

    // First bare argument (when no -e was given) is the inline script; the rest
    // are file paths.
    if (scripts.length === 0) {
      scripts.push(arg);
    }
    i++;
  }

  if (scripts.length === 0) return false; // no script → nothing to verify
  return scripts.every((s) => SAFE_SED_SCRIPT.test(s));
}
