import { parseCompound } from "../parser/shell.js";
import { classify } from "../classifiers/index.js";
import { isSafePython3Code } from "../classifiers/python3.js";

// Extract the hostname of a URL token, but only if it uses the required scheme.
// Default is https; a rule may opt into http (e.g. for local/internal hosts).
function extractHostname(token: string, scheme: "http" | "https"): string | null {
  const wanted = scheme === "http" ? "http:" : "https:";
  try {
    const url = new URL(token);
    if (url.protocol !== wanted) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function curlDomainAllowed(argv: string[], allowedDomains: string[], scheme: "http" | "https"): boolean {
  const urls = argv.slice(1).map((t) => extractHostname(t, scheme)).filter((h): h is string => h !== null);
  if (urls.length === 0) return false;
  return urls.every(h => allowedDomains.includes(h));
}

export function matchCurl(command: string, allowedDomains: string[], allowedImports: string[] = [], allowedPaths: string[] = [], scheme: "http" | "https" = "https"): boolean {
  if (allowedDomains.length === 0) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  let hasCurl = false;

  for (const segment of segments) {
    // Reject non-pipe operators: &&, ||, ;, & mean independent commands
    if (segment.operator !== null && segment.operator !== "|") return false;

    const c = classify(segment.raw);

    switch (c.kind) {
      case "curl":
        if (!curlDomainAllowed(c.argv, allowedDomains, scheme)) return false;
        hasCurl = true;
        break;
      case "safe-builtin":
        break;
      case "python3-c": {
        const code = c.argv[c.argv.indexOf("-c") + 1] ?? "";
        if (!isSafePython3Code(code, allowedImports, allowedPaths)) return false;
        break;
      }
      default:
        return false;
    }
  }

  return hasCurl;
}
