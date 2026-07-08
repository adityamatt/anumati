import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";
import { isSafePipeConsumer } from "../parser/pipe.js";

// `sed` is only safe in provably read-only forms. Its mini-language can write
// files (`-i`, the `w`/`W` commands, `s///w`) and even execute shell (`e`
// command, `s///e`), and `-f` runs an unverifiable external script — so we
// allow ONLY a strict grammar: read-only flags plus a script consisting solely
// of line addresses and the print/delete/quit/line-number commands.

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

function isSedSegment(raw: string): boolean {
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

export function matchSed(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  // Only | (pipe to safe consumers) allowed between segments.
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "|") return false;
  }

  // First segment must be a read-only sed; the rest safe pipe consumers.
  if (!isSedSegment(segments[0].raw)) return false;
  for (const seg of segments.slice(1)) {
    if (!isSafePipeConsumer(seg.raw)) return false;
  }

  return true;
}
