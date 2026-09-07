import {
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { legacyHome, anumatiHome, loadConfig } from "../config.js";
import type { Config } from "../types.js";
import { prettyPath } from "./init.js";

/**
 * `anumati migrate` — relocate anumati's files from the legacy `~/.claude/` home
 * to the host-neutral `~/.anumati/` home:
 *   • move `permissions.json` and leave a symlink at the old path, so existing
 *     wirings (Claude `settings.json`, Codex `hooks.json`) keep resolving with no
 *     re-wiring;
 *   • move the sidecar files that live beside the config — the audit log, the
 *     passthrough log, and the suggestions store — and rewrite the config's
 *     `audit.audit_file` / `audit.passthrough_file` to the new locations so
 *     logging keeps landing correctly.
 *
 * Decoupled from `anumati update` (npm-global-only), so it works on any install
 * including a local `npm link` sync. Idempotent and incremental: if the config
 * was already moved but the logs weren't, re-running finishes the logs. Never
 * leaves a broken state — if a symlink can't be created (Windows without
 * privilege) it rolls back and stays on `~/.claude/`.
 */

export interface MovedFile {
  from: string;
  to: string;
}

export type MigrateStatus =
  | "migrated" // config moved + symlinked this run
  | "already-migrated" // config already at ~/.anumati (logs may still move)
  | "nothing-to-migrate" // no config anywhere
  | "symlink-unsupported"; // couldn't symlink; rolled back, stayed on ~/.claude

export interface MigrateResult {
  status: MigrateStatus;
  from: string;
  to: string;
  symlinked: boolean;
  /** Sidecar files (logs / suggestions) relocated this run. */
  movedFiles: MovedFile[];
}

export interface MigrateOptions {
  claudePath?: string; // default ~/.claude/permissions.json
  anumatiPath?: string; // default ~/.anumati/permissions.json
  symlink?: (target: string, path: string) => void; // injectable for tests
}

function moveFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  unlinkSync(src);
}

// Relocate the sidecars that sit directly beside the legacy config (audit log,
// passthrough log, suggestions store) into the new home, rewriting the config's
// audit paths. Only touches files under `legacyDir` — custom paths elsewhere are
// left alone. Idempotent.
function relocateSidecars(configPath: string, legacyDir: string, anumatiDir: string): MovedFile[] {
  const moved: MovedFile[] = [];
  const cfg = loadConfig(configPath) as Config | null;
  if (!cfg) return moved;

  let changed = false;
  if (cfg.audit) {
    for (const key of ["audit_file", "passthrough_file"] as const) {
      const old = cfg.audit[key];
      if (!old || dirname(old) !== legacyDir) continue; // only relocate ~/.claude-home logs
      const dest = join(anumatiDir, basename(old));
      if (existsSync(old) && !existsSync(dest)) {
        moveFile(old, dest);
        moved.push({ from: old, to: dest });
      }
      cfg.audit[key] = dest; // repoint even if the file didn't exist yet
      changed = true;
    }
  }
  if (changed) writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");

  // The suggestions store isn't referenced in the config; relocate by convention.
  const oldSug = join(legacyDir, "anumati-suggestions.jsonl");
  const newSug = join(anumatiDir, "anumati-suggestions.jsonl");
  if (existsSync(oldSug) && !existsSync(newSug)) {
    moveFile(oldSug, newSug);
    moved.push({ from: oldSug, to: newSug });
  }

  return moved;
}

/** Perform the relocation. Does the file I/O; path inputs are injectable for tests. */
export function applyMigrate(opts: MigrateOptions = {}): MigrateResult {
  const from = opts.claudePath ?? join(legacyHome(), "permissions.json");
  const to = opts.anumatiPath ?? join(anumatiHome(), "permissions.json");
  const symlink = opts.symlink ?? ((target: string, path: string) => symlinkSync(target, path));
  const legacyDir = dirname(from);
  const anumatiDir = dirname(to);

  // Phase 1 — relocate the config (move + symlink), or note it's already done.
  let status: MigrateStatus;
  let symlinked = false;
  if (existsSync(to)) {
    status = "already-migrated";
  } else if (!existsSync(from)) {
    return { status: "nothing-to-migrate", from, to, symlinked: false, movedFiles: [] };
  } else {
    mkdirSync(anumatiDir, { recursive: true });
    copyFileSync(from, to);
    try {
      unlinkSync(from);
      symlink(to, from);
      symlinked = true;
      status = "migrated";
    } catch {
      if (!existsSync(from)) copyFileSync(to, from); // restore legacy file
      try {
        rmSync(to);
      } catch {
        // best effort
      }
      return { status: "symlink-unsupported", from, to, symlinked: false, movedFiles: [] };
    }
  }

  // Phase 2 — relocate the sidecars and repoint the config (incremental).
  const movedFiles = relocateSidecars(to, legacyDir, anumatiDir);
  return { status, from, to, symlinked, movedFiles };
}

/** CLI entrypoint: `anumati migrate` */
export function runMigrate(_argv: string[]): void {
  const r = applyMigrate();
  switch (r.status) {
    case "migrated":
      console.log(`✓ Moved ${prettyPath(r.from)} → ${prettyPath(r.to)} and symlinked the old path.`);
      break;
    case "already-migrated":
      console.log(`• ${prettyPath(r.to)} already exists — config left as-is.`);
      break;
    case "nothing-to-migrate":
      console.log(`• No ${prettyPath(r.from)} to migrate — new installs already use ${prettyPath(r.to)}.`);
      return;
    case "symlink-unsupported":
      console.log(`⚠ Couldn't create a symlink (needs privilege on Windows).`);
      console.log(`  Left your config at ${prettyPath(r.from)}, which is fully supported — no change made.`);
      return;
  }

  for (const m of r.movedFiles) {
    console.log(`✓ Moved ${prettyPath(m.from)} → ${prettyPath(m.to)}`);
  }
  if (r.status === "already-migrated" && r.movedFiles.length === 0) {
    console.log(`  Nothing else to move.`);
  } else {
    console.log(`  Claude and Codex keep working unchanged; everything now lives under ${prettyPath(anumatiHome())}/.`);
  }
}
