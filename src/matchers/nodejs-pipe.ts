import { readFileSync } from "fs";
import { resolve } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { classify } from "../classifiers/index.js";
import { isSafeNodejsCode } from "../classifiers/nodejs.js";

function readScript(scriptPath: string, cwd: string): string | null {
  try {
    const abs = resolve(cwd, scriptPath);
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

// which <cmd> — single arg, read-only probe
function isWhichSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "which" && argv.length === 2;
}

function isEchoSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}

// Pull the code string out of a `node -e/-p/--eval/--print "code"` argv.
function evalCode(argv: string[]): string {
  const idx = argv.findIndex((a) => a === "-e" || a === "--eval" || a === "-p" || a === "--print");
  return idx !== -1 ? (argv[idx + 1] ?? "") : "";
}

export function matchNodejsPipe(command: string, allowedModules: string[], cwd: string = ""): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let i = 0;
  let hasNode = false;

  // Optional leading: which <cmd> && (one or more)
  while (i < segments.length && isWhichSegment(segments[i].raw) && segments[i].operator === "&&") {
    i++;
  }

  // Main body: node + safe-builtins joined by |
  // The last segment of the body may have operator || (signals optional echo fallback follows)
  for (; i < segments.length; i++) {
    const seg = segments[i];
    const isLastBeforeEcho = seg.operator === "||";

    if (!isLastBeforeEcho && seg.operator !== null && seg.operator !== "|") return false;

    const c = classify(seg.raw);
    switch (c.kind) {
      case "nodejs-e": {
        if (!isSafeNodejsCode(evalCode(c.argv), allowedModules)) return false;
        hasNode = true;
        break;
      }
      case "nodejs-script": {
        const code = readScript(c.argv[1], cwd);
        if (code === null) return false;
        if (!isSafeNodejsCode(code, allowedModules)) return false;
        hasNode = true;
        break;
      }
      case "safe-builtin":
        break;
      default:
        return false;
    }

    if (isLastBeforeEcho) {
      i++;
      break;
    }
  }

  // Optional trailing echo (after ||)
  if (i < segments.length) {
    const last = segments[i];
    if (!isEchoSegment(last.raw)) return false;
    if (last.operator !== null) return false;
    i++;
  }

  return hasNode && i === segments.length;
}
