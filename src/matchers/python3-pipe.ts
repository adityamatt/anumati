import { readFileSync } from "fs";
import { resolve } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";
import { classify } from "../classifiers/index.js";
import { isSafePython3Code } from "../classifiers/python3.js";

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

export function matchPython3Pipe(command: string, allowedImports: string[], allowedPaths: string[] = [], cwd: string = ""): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let i = 0;
  let hasPython = false;

  // Optional leading: which <cmd> && (one or more)
  while (i < segments.length && isWhichSegment(segments[i].raw) && segments[i].operator === "&&") {
    i++;
  }

  // Main body: python3 + safe-builtins joined by |
  // The last segment of the body may have operator || (signals optional echo fallback follows)
  for (; i < segments.length; i++) {
    const seg = segments[i];
    const isLastBeforeEcho = seg.operator === "||";

    if (!isLastBeforeEcho && seg.operator !== null && seg.operator !== "|") return false;

    const c = classify(seg.raw);
    switch (c.kind) {
      case "python3-c": {
        const code = c.argv[c.argv.indexOf("-c") + 1] ?? "";
        if (!isSafePython3Code(code, allowedImports, allowedPaths)) return false;
        hasPython = true;
        break;
      }
      case "python3-script": {
        const code = readScript(c.argv[1], cwd);
        if (code === null) return false;
        if (!isSafePython3Code(code, allowedImports, allowedPaths)) return false;
        hasPython = true;
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

  return hasPython && i === segments.length;
}
