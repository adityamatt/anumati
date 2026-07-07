// Dynamic code-execution and native-escape entry points that make a node
// script impossible to reason about statically — always blocked, mirroring
// python3.ts's DANGEROUS_BUILTINS (exec/eval/compile/__import__).
//   eval(…) / Function(…)          → run arbitrary source
//   .constructor(…)                → (fn).constructor is Function — same escape
//   process.binding / process.dlopen → load native/internal modules directly
const DANGEROUS_BUILTINS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\.\s*constructor\s*\(/,
  /\bprocess\s*\.\s*binding\b/,
  /\bprocess\s*\.\s*dlopen\b/,
];

// Pure-computation built-in modules that are safe to bless wholesale: they have
// no file, network, subprocess, or code-execution entry points of their own.
// Deliberately EXCLUDES anything with I/O side channels — fs (filesystem),
// child_process/net/http/dns/tls/dgram (subprocess+network), os (host info),
// vm/module/repl/inspector (code loading), worker_threads/cluster — all of
// which live in ALWAYS_BLOCKED. Since fs is blocked outright, node-pipe scripts
// cannot touch the filesystem at all, so no per-path check is needed (unlike
// python3-pipe's open() allowlist).
export const KNOWN_SAFE_MODULES = [
  "assert", "assert/strict",
  "buffer", "crypto", "zlib",
  "events", "stream", "stream/promises", "stream/web",
  "path", "path/posix", "path/win32",
  "querystring", "string_decoder", "punycode", "url",
  "util", "util/types",
  "timers", "timers/promises",
];

// Modules that are always blocked regardless of allowed_modules — each has a
// file, network, subprocess, host-info, or code-loading entry point. Names are
// compared AFTER stripping the optional `node:` prefix, so `node:fs` and `fs`
// are both caught. Submodule forms (fs/promises, dns/promises) are listed
// explicitly so a blocked base can't sneak back in via a subpath.
export const ALWAYS_BLOCKED = new Set([
  "fs", "fs/promises",
  "child_process",
  "net", "http", "https", "http2", "dgram", "tls",
  "dns", "dns/promises",
  "cluster", "worker_threads",
  "vm", "module", "repl", "inspector",
  "os", "v8", "perf_hooks",
  "readline", "readline/promises", "tty",
  "process", "async_hooks", "diagnostics_channel", "trace_events",
  "sea", "sqlite", "test",
]);

// Strip a leading `node:` scheme so `node:fs` and `fs` normalize to one name.
function normalize(mod: string): string {
  return mod.startsWith("node:") ? mod.slice(5) : mod;
}

// A require()/import specifier is a FILE PATH (not a bare module name) when it
// begins with "/", "./", or "../" — Node's own rule. `require("./x.json")` reads
// a file off disk, so such specifiers are path-checked against allowed_paths
// (mirroring python3-pipe's open() allowlist) rather than the module allowlist.
function isPathSpecifier(spec: string): boolean {
  return spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../");
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  if (path.includes("..")) return false;
  return allowedPaths.some((dir) => path.startsWith(dir));
}

// Scan every standalone `require` token. A `require` must appear as a call with
// a string-literal argument (`require("path")`); anything else — a bare
// reference (`const r = require`), a dynamic arg (`require(name)`), or
// `require.resolve` — is unverifiable, so we return null and the caller blocks.
function scanRequire(code: string): string[] | null {
  const mods: string[] = [];
  let i = 0;
  while (i < code.length) {
    const idx = code.indexOf("require", i);
    if (idx === -1) break;
    i = idx + 7;
    // Must be a whole-word `require` (not part of `prerequire`/`requires`).
    const before = code[idx - 1];
    const after = code[idx + 7];
    if (before !== undefined && /[\w$]/.test(before)) continue;
    if (after !== undefined && /[\w$]/.test(after)) continue;

    let k = idx + 7;
    while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
    if (code[k] !== "(") return null; // require used as a value/alias — unverifiable
    k++;
    while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
    const q = code[k];
    if (q !== '"' && q !== "'") return null; // dynamic require() arg
    k++;
    let name = "";
    while (k < code.length && code[k] !== q) {
      if (code[k] === "\\") k++; // skip escape, take next char literally
      else name += code[k];
      k++;
    }
    mods.push(name);
    i = k + 1;
  }
  return mods;
}

// Scan dynamic `import(...)` calls. Like require(), the argument must be a
// string literal; a dynamic arg returns null (block). Static `import … from
// "x"` statements are NOT calls and are handled by the regexes below.
function scanDynamicImport(code: string): string[] | null {
  const mods: string[] = [];
  let i = 0;
  while (i < code.length) {
    const idx = code.indexOf("import", i);
    if (idx === -1) break;
    i = idx + 6;
    const before = code[idx - 1];
    const after = code[idx + 6];
    if (before !== undefined && /[\w$]/.test(before)) continue;
    if (after !== undefined && /[\w$]/.test(after)) continue;

    let k = idx + 6;
    while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
    if (code[k] !== "(") continue; // static import — handled by regex, not here
    k++;
    while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;
    const q = code[k];
    if (q !== '"' && q !== "'") return null; // dynamic import() arg
    k++;
    let name = "";
    while (k < code.length && code[k] !== q) {
      if (code[k] === "\\") k++;
      else name += code[k];
      k++;
    }
    mods.push(name);
    i = k + 1;
  }
  return mods;
}

// Static ES imports: `import x from "mod"`, `import { y } from "mod"`, and the
// side-effect form `import "mod"`. Both quote styles supported.
const STATIC_IMPORT_FROM = /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const STATIC_IMPORT_BARE = /\bimport\s*['"]([^'"]+)['"]/g;

/**
 * Extract every module a node snippet pulls in, via require(), dynamic
 * import(), or a static import statement. Returns null when the code contains
 * an unverifiable module reference (dynamic/aliased require, dynamic import) —
 * the caller treats null as "cannot prove safe" and blocks.
 */
export function extractModules(code: string): string[] | null {
  const reqs = scanRequire(code);
  if (reqs === null) return null;
  const dyn = scanDynamicImport(code);
  if (dyn === null) return null;

  const mods = [...reqs, ...dyn];
  let m: RegExpExecArray | null;
  while ((m = STATIC_IMPORT_FROM.exec(code)) !== null) mods.push(m[1]);
  STATIC_IMPORT_FROM.lastIndex = 0;
  while ((m = STATIC_IMPORT_BARE.exec(code)) !== null) mods.push(m[1]);
  STATIC_IMPORT_BARE.lastIndex = 0;

  return mods;
}

export function isSafeNodejsCode(
  code: string,
  allowedModules: string[],
  allowedPaths: string[] = [],
): boolean {
  for (const pattern of DANGEROUS_BUILTINS) {
    if (pattern.test(code)) return false;
  }

  const specs = extractModules(code);
  if (specs === null) return false; // dynamic/aliased require or import → block

  for (const raw of specs) {
    if (isPathSpecifier(raw)) {
      // A file-path require()/import — read from disk. Allowed only when the
      // path sits under a configured allowed_paths prefix (and has no `..`).
      if (allowedPaths.length === 0) return false;
      if (!pathAllowed(raw, allowedPaths)) return false;
      continue;
    }
    const mod = normalize(raw);
    if (ALWAYS_BLOCKED.has(mod)) return false;
    if (!allowedModules.includes(mod)) return false;
  }

  return true;
}
