import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// The managed block is delimited by these markers so init can update it in
// place on re-run without touching the user's own CLAUDE.md content.
export const STEER_BEGIN = "<!-- BEGIN anumati command-style guidance (managed) -->";
export const STEER_END = "<!-- END anumati command-style guidance (managed) -->";

// The guidance is inlined (not an @import to docs/COMMAND-STYLE.md) because the
// repo docs are not shipped in the npm package — a self-contained block works
// for every install path.
export const STEER_BODY = `## anumati-friendly command style

anumati auto-approves tool calls that match deterministic, single-command
matchers. Prefer phrasing work in approvable shapes so routine commands run
without a manual permission prompt:

- **One command per Bash call** — avoid \`;\` / \`&&\` chains and multi-statement scripts. Use separate calls.
- **No file redirections** — drop \`> file\`, \`>> file\`, \`2> file\`, \`< file\` (they write/read files). Stream redirects that only discard or merge output (\`2>/dev/null\`, \`>/dev/null\`, \`2>&1\`) are fine.
- **No \`echo\` section headers, no \`$(...)\` command substitution, no backticks.**
- **Prefer dedicated tools over shelling out:** Read (not \`cat\`), Grep (not bash \`grep\`), Glob (not \`find\`/\`ls\`), Edit/Write (not \`echo >\`).
- Pipes into read-only builtins (\`| head\`, \`| grep\`, \`| wc -l\`) are fine.

Common fixes:
- Type-check/test: run \`npx tsc --noEmit\` or \`npx vitest run <path>\` directly — don't wrap in \`> log 2>&1 ; echo $? ; tail log\`. Errors still print to the terminal.
- Need stderr with output? \`cmd 2>&1 | tail -20\` (not \`cmd > file 2>&1 ; tail file\`).
- \`python3 -c\` reading a file: fine if the path is in the rule's \`open.allowed_paths\` (add one with \`anumati add python3-pipe --paths <dir>\`).

Doing this keeps routine work on the silent auto-approve path and reserves
manual prompts for genuinely unusual commands.`;

/** The CLAUDE.md that sits beside a given anumati config. */
export function claudeMdFileFor(configPath: string): string {
  return join(dirname(configPath), "CLAUDE.md");
}

/** The full managed block, markers included. */
export function steerBlock(): string {
  return `${STEER_BEGIN}\n${STEER_BODY}\n${STEER_END}`;
}

export interface SteerResult {
  claudeMdPath: string;
  created: boolean; // the CLAUDE.md file did not exist and was created
  changed: boolean; // the managed block was added or updated
}

/**
 * Add or refresh the anumati command-style block in the CLAUDE.md beside the
 * config. Idempotent and non-destructive: an existing managed block is replaced
 * in place; any other user content is preserved; a fresh file is created if
 * none exists. If an identical block is already present, nothing changes.
 */
export function wireSteerFile(claudeMdPath: string): SteerResult {
  const block = steerBlock();
  const existed = existsSync(claudeMdPath);
  const current = existed ? readFileSync(claudeMdPath, "utf-8") : "";

  const begin = current.indexOf(STEER_BEGIN);
  if (begin !== -1) {
    // Replace the existing managed block (from BEGIN through END) in place.
    const endMarker = current.indexOf(STEER_END, begin);
    const end = endMarker === -1 ? current.length : endMarker + STEER_END.length;
    const before = current.slice(0, begin);
    const after = current.slice(end);
    const next = before + block + after;
    if (next === current) {
      return { claudeMdPath, created: false, changed: false };
    }
    writeFileSync(claudeMdPath, next);
    return { claudeMdPath, created: false, changed: true };
  }

  // No managed block yet — append it (with a blank-line gap) or create the file.
  const dir = dirname(claudeMdPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let next: string;
  if (!existed || current.trim() === "") {
    next = block + "\n";
  } else {
    const sep = current.endsWith("\n") ? "\n" : "\n\n";
    next = current + sep + block + "\n";
  }
  writeFileSync(claudeMdPath, next);
  return { claudeMdPath, created: !existed, changed: true };
}
