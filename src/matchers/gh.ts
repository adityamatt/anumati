import { parseCompound } from "../parser/shell.js";
import { classify } from "../classifiers/index.js";
import { isSafePython3Code } from "../classifiers/python3.js";

// Flags that consume the next token as their value
const FLAGS_WITH_VALUE = new Set([
  "--jq", "-q", "--header", "-H",
  "--field", "-F", "--raw-field", "-f",
  "--method", "-X", "--input", "--template", "-t",
  "--cache", "--hostname",
]);

function extractRepo(argv: string[]): string | null {
  // argv[0]="gh", argv[1]="api", find first non-flag arg
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      const m = arg.match(/^repos\/([^/]+\/[^/]+)/);
      return m ? m[1] : null;
    }
    if (FLAGS_WITH_VALUE.has(arg)) i++; // skip flag value
    i++;
  }
  return null;
}

function hasWriteMethod(argv: string[]): boolean {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--method" || argv[i] === "-X") {
      return argv[i + 1].toUpperCase() !== "GET";
    }
  }
  return false;
}

function ghApiAllowed(argv: string[], allowedRepos: string[]): boolean {
  if (hasWriteMethod(argv)) return false;
  const repo = extractRepo(argv);
  if (!repo) return false;
  return allowedRepos.includes(repo);
}

export function matchGh(command: string, allowedRepos: string[], allowedImports: string[] = [], allowedPaths: string[] = []): boolean {
  if (allowedRepos.length === 0) return false;

  const segments = parseCompound(command);
  if (!segments) return false;

  let hasGh = false;

  for (const segment of segments) {
    if (segment.operator !== null && segment.operator !== "|") return false;

    const c = classify(segment.raw);

    switch (c.kind) {
      case "gh-api":
        if (!ghApiAllowed(c.argv, allowedRepos)) return false;
        hasGh = true;
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

  return hasGh;
}
