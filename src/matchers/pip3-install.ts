import { basename } from "path";
import { parseCompound, tokenize } from "../parser/shell.js";

const ALLOWED_FLAGS = new Set(["-q", "--quiet", "-U", "--upgrade", "--user"]);

function parsePackageName(spec: string): string {
  return spec.split(/[=<>!~]/)[0];
}

// Accepts pip3, pip, or any absolute path whose basename is pip/pip3
function isPipInstallSegment(raw: string, allowedPackages: string[]): boolean {
  const argv = tokenize(raw);
  if (!argv) return false;
  const cmd = basename(argv[0]);
  if (cmd !== "pip" && cmd !== "pip3") return false;
  if (argv[1] !== "install") return false;

  let hasPackage = false;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("-")) {
      if (!ALLOWED_FLAGS.has(arg)) return false;
    } else {
      if (!allowedPackages.includes("*") && !allowedPackages.includes(parsePackageName(arg))) return false;
      hasPackage = true;
    }
  }

  return hasPackage;
}

// python3 -m venv <path> — no extra flags
function isVenvSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "python3" && argv[1] === "-m" && argv[2] === "venv" && argv.length === 4;
}

function isEchoSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}

export function matchPip3Install(command: string, allowedPackages: string[]): boolean {
  if (allowedPackages.length === 0) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  // All operators must be &&
  for (const seg of segments) {
    if (seg.operator !== null && seg.operator !== "&&") return false;
  }

  let hasWork = false; // must have at least one venv or pip segment
  let seenEcho = false;

  for (const seg of segments) {
    if (seenEcho) return false; // echo must be last

    if (isEchoSegment(seg.raw)) {
      seenEcho = true;
    } else if (isVenvSegment(seg.raw)) {
      hasWork = true;
    } else if (isPipInstallSegment(seg.raw, allowedPackages)) {
      hasWork = true;
    } else {
      return false;
    }
  }

  return hasWork;
}
