// Redirect classification shared by the command matchers.
//
// parseCompound does not tokenize redirects — it leaves them in a segment's
// raw text — so matchers must judge them here. The distinction that matters:
//
//   > file  /  >> file  /  2> file     → WRITES a file (a real side effect)
//   2>/dev/null  />/dev/null  2>&1  >&2 → discards/merges a stream (no file, no exec)
//
// The first class must stay rejected on otherwise read-only commands; the
// second is pure noise-suppression and is safe to allow. Input redirection
// (`<`) is always treated as unsafe here — it is rare on the commands we match
// and conservatively left out of scope.

// A redirect operator (optional fd or `&`, then `>`/`>>`) followed by its
// destination (an fd dup like `&1`/`&-`, or a filename token).
const REDIRECT_RE = /(?:\d+|&)?>>?\s*(&\d+|&-|\S+)/g;

function isSafeDestination(dest: string): boolean {
  // /dev/null is the one file we treat as safe (a discard sink); fd duplications
  // (&1, &2, &-) merge/close streams and write no file.
  return dest === "/dev/null" || /^&(\d+|-)$/.test(dest);
}

/**
 * True if `raw` contains a redirection that is NOT a known-safe stream
 * discard/merge — i.e. a redirect that writes a file, an input redirect, or a
 * `>` we cannot confidently classify. Safe stream redirects (`2>/dev/null`,
 * `>/dev/null`, `2>&1`, `>&2`, `&>/dev/null`, …) return false.
 */
export function hasUnsafeRedirection(raw: string): boolean {
  if (raw.includes("<")) return true;
  if (!raw.includes(">")) return false;

  let coveredGt = 0;
  let match: RegExpExecArray | null;
  REDIRECT_RE.lastIndex = 0;
  while ((match = REDIRECT_RE.exec(raw)) !== null) {
    if (!isSafeDestination(match[1])) return true; // redirect to a real file
    coveredGt += (match[0].match(/>/g) ?? []).length;
  }

  // Every `>` must have been part of a recognized (and safe) redirect. A `>`
  // the regex did not cover (e.g. inside a quoted arg) is treated as unsafe.
  const totalGt = (raw.match(/>/g) ?? []).length;
  return coveredGt !== totalGt;
}
