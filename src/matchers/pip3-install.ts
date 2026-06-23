import { parseCompound, tokenize } from "../parser/shell.js";

const ALLOWED_FLAGS = new Set(["-q", "--quiet", "-U", "--upgrade", "--user"]);

function parsePackageName(spec: string): string {
  return spec.split(/[=<>!~]/)[0];
}

function isPip3InstallSegment(raw: string, allowedPackages: string[]): boolean {
  const argv = tokenize(raw);
  if (!argv || argv[0] !== "pip3" || argv[1] !== "install") return false;

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

function isEchoSegment(raw: string): boolean {
  const argv = tokenize(raw);
  return !!argv && argv[0] === "echo";
}

export function matchPip3Install(command: string, allowedPackages: string[]): boolean {
  if (allowedPackages.length === 0) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  if (segments.length === 1) {
    return isPip3InstallSegment(segments[0].raw, allowedPackages);
  }

  if (segments.length === 2) {
    return (
      segments[0].operator === "&&" &&
      isPip3InstallSegment(segments[0].raw, allowedPackages) &&
      isEchoSegment(segments[1].raw)
    );
  }

  return false;
}
