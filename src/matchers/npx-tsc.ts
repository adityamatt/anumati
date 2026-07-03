import { parseCompound, tokenize } from "../parser/shell.js";
import { hasUnsafeRedirection } from "../parser/redirect.js";

function isTscSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "npx" && argv[1] === "tsc" && argv.includes("--noEmit");
}

function isCdSegment(raw: string): boolean {
  if (hasUnsafeRedirection(raw)) return false;
  const argv = tokenize(raw);
  return !!argv && argv[0] === "cd" && argv.length === 2;
}

export function matchNpxTsc(command: string): boolean {
  const segments = parseCompound(command);
  if (!segments) return false;

  if (segments.length === 1) {
    return isTscSegment(segments[0].raw);
  }

  if (segments.length === 2) {
    // Allow: cd <dir> && npx tsc --noEmit only
    return segments[0].operator === "&&"
      && isCdSegment(segments[0].raw)
      && isTscSegment(segments[1].raw);
  }

  return false;
}
