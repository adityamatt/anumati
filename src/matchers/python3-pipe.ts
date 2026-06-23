import { readFileSync } from "fs";
import { resolve } from "path";
import { parseCompound } from "../parser/shell.js";
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

export function matchPython3Pipe(command: string, allowedImports: string[], allowedPaths: string[] = [], cwd: string = ""): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  let hasPython = false;

  for (const segment of segments) {
    if (segment.operator !== null && segment.operator !== "|") return false;

    const c = classify(segment.raw);

    switch (c.kind) {
      case "python3-c": {
        const code = c.argv[c.argv.indexOf("-c") + 1] ?? "";
        if (!isSafePython3Code(code, allowedImports, allowedPaths)) return false;
        hasPython = true;
        break;
      }
      case "python3-script": {
        const code = readScript(c.argv[1], cwd);
        if (code === null) return false; // can't read → block
        if (!isSafePython3Code(code, allowedImports, allowedPaths)) return false;
        hasPython = true;
        break;
      }
      case "safe-builtin":
        break;
      default:
        return false;
    }
  }

  return hasPython;
}
