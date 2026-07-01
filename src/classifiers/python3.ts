const DANGEROUS_BUILTINS = [
  /\bexec\s*\(/,
  /\beval\s*\(/,
  /\bcompile\s*\(/,
  /\b__import__\s*\(/,
];

// Pure-computation stdlib modules that are safe to bless wholesale: they have
// no file, network, subprocess, or code-execution entry points of their own.
// Deliberately EXCLUDES anything with I/O side channels — e.g. pandas/numpy
// (read_pickle/load = arbitrary file+code), pathlib/tempfile/io (filesystem),
// and everything in ALWAYS_BLOCKED. open() in user code is still path-checked
// separately, so blessing these imports does not widen file access.
export const KNOWN_SAFE_IMPORTS = [
  "json", "math", "cmath", "statistics", "decimal", "fractions",
  "random", "secrets", "string", "re", "textwrap", "difflib", "unicodedata",
  "collections", "collections.abc", "itertools", "functools", "operator",
  "heapq", "bisect", "array", "enum", "dataclasses", "typing", "types",
  "copy", "numbers", "datetime", "time", "calendar",
  "hashlib", "hmac", "uuid", "base64", "binascii", "struct",
  "pprint", "reprlib", "contextlib", "abc", "warnings",
];

// Excluded despite seeming innocuous — these have file/network entry points
// that bypass the open() path check: codecs (codecs.open), zoneinfo (reads tz
// files), io/pathlib/tempfile (filesystem), and anything in ALWAYS_BLOCKED.

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
  // Two forms:
  //   from MODULE import ...            → captures MODULE (group 1)
  //   import MOD [as X][, MOD2 ...]     → captures the full clause (group 2)
  // The `from` alternative is tried first so the trailing `import` of a
  // from-statement is consumed and never re-matched as a bare import. Capturing
  // the WHOLE import clause (not just the first module) is critical: a bare
  // `import json, subprocess` must surface BOTH names, or a blocked module
  // could hide behind an allowed one and bypass the safety check.
  const re = /\bfrom\s+([\w.]+)\s+import\b|\bimport\s+([^\n;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1] !== undefined) {
      imports.push(m[1]);
      continue;
    }
    // Bare import: split the clause on commas, drop any `as alias`, and take
    // the leading dotted identifier of each part (trims trailing comments).
    for (const part of m[2].split(",")) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim();
      const id = /^[\w.]+/.exec(mod);
      if (id) imports.push(id[0]);
    }
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
