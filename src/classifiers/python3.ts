const DANGEROUS_BUILTINS = [
  /\bexec\s*\(/,
  /\beval\s*\(/,
  /\bcompile\s*\(/,
  /\b__import__\s*\(/,
];

// Modules that are always blocked regardless of allowed_imports
export const ALWAYS_BLOCKED = new Set([
  "os", "os.path", "subprocess", "socket", "requests",
  "urllib.request", "urllib.error", "http.client", "httplib",
  "ftplib", "smtplib", "imaplib", "poplib", "telnetlib",
  "pickle", "shelve", "importlib", "ctypes", "cffi",
  "multiprocessing", "threading", "concurrent",
  "pty", "code", "codeop", "pdb",
  "gc", "inspect", "dis", "ast", "py_compile",
  "pkgutil", "pkg_resources", "setuptools", "distutils",
]);

export function extractImports(code: string): string[] {
  const imports: string[] = [];
  const re = /\bimport\s+([\w.]+)|\bfrom\s+([\w.]+)\s+import/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    imports.push(m[1] ?? m[2]);
  }
  return imports;
}

// Returns extracted literal paths, or null if any open() call uses a dynamic arg
export function extractOpenPaths(code: string): string[] | null {
  const paths: string[] = [];
  let i = 0;
  while (i < code.length) {
    const idx = code.indexOf("open(", i);
    if (idx === -1) break;
    i = idx + 5;
    while (i < code.length && (code[i] === " " || code[i] === "\t")) i++;
    const q = code[i];
    if (q !== '"' && q !== "'") return null; // dynamic arg → can't verify
    i++;
    let path = "";
    while (i < code.length && code[i] !== q) {
      if (code[i] === "\\") { i++; } // skip escape char, take next literally
      else path += code[i];
      i++;
    }
    paths.push(path);
    i++; // skip closing quote
  }
  return paths;
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  if (path.includes("..")) return false;
  return allowedPaths.some(dir => path.startsWith(dir));
}

export function isSafePython3Code(
  code: string,
  allowedImports: string[],
  allowedPaths: string[] = [],
): boolean {
  for (const pattern of DANGEROUS_BUILTINS) {
    if (pattern.test(code)) return false;
  }

  for (const mod of extractImports(code)) {
    if (ALWAYS_BLOCKED.has(mod)) return false;
    if (!allowedImports.includes(mod)) return false;
  }

  const openPaths = extractOpenPaths(code);
  if (openPaths === null) return false; // dynamic open() → block
  if (openPaths.length > 0) {
    if (allowedPaths.length === 0) return false; // open() present but no paths configured
    for (const p of openPaths) {
      if (!pathAllowed(p, allowedPaths)) return false;
    }
  }

  return true;
}
