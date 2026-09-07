import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { applyMigrate } from "../../src/cli/migrate.js";

let dir: string;
let claudeDir: string;
let anumatiDir: string;
let claudePath: string;
let anumatiPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anumati-migrate-"));
  claudeDir = join(dir, "claude");
  anumatiDir = join(dir, "anumati");
  claudePath = join(claudeDir, "permissions.json");
  anumatiPath = join(anumatiDir, "permissions.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const opts = () => ({ claudePath, anumatiPath });

// Seed a legacy config that references sidecar logs beside it, and create those logs.
function seedLegacy() {
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    claudePath,
    JSON.stringify({
      audit: {
        audit_file: join(claudeDir, "anumati-audit.jsonl"),
        audit_level: "matched",
        passthrough_file: join(claudeDir, "anumati-passthrough.jsonl"),
      },
      allow: [{ tool: "Bash", matcher: "cargo" }],
    }),
  );
  writeFileSync(join(claudeDir, "anumati-audit.jsonl"), "audit-entry\n");
  writeFileSync(join(claudeDir, "anumati-passthrough.jsonl"), "passthrough-entry\n");
  writeFileSync(join(claudeDir, "anumati-suggestions.jsonl"), "suggestion\n");
}

describe("applyMigrate", () => {
  it("moves the config (+symlink) AND the sidecar logs, rewriting audit paths", () => {
    seedLegacy();

    const res = applyMigrate(opts());

    expect(res.status).toBe("migrated");
    expect(res.symlinked).toBe(true);

    // config: real file at new home, old path is a symlink resolving to it
    expect(realpathSync(claudePath)).toBe(realpathSync(anumatiPath));
    expect(lstatSync(claudePath).isSymbolicLink()).toBe(true);

    // logs + suggestions physically moved into the new home
    expect(existsSync(join(anumatiDir, "anumati-audit.jsonl"))).toBe(true);
    expect(existsSync(join(anumatiDir, "anumati-passthrough.jsonl"))).toBe(true);
    expect(existsSync(join(anumatiDir, "anumati-suggestions.jsonl"))).toBe(true);
    expect(existsSync(join(claudeDir, "anumati-audit.jsonl"))).toBe(false);
    expect(existsSync(join(claudeDir, "anumati-passthrough.jsonl"))).toBe(false);

    // config's audit paths rewritten to the new home
    const cfg = JSON.parse(readFileSync(anumatiPath, "utf-8"));
    expect(cfg.audit.audit_file).toBe(join(anumatiDir, "anumati-audit.jsonl"));
    expect(cfg.audit.passthrough_file).toBe(join(anumatiDir, "anumati-passthrough.jsonl"));

    expect(res.movedFiles.map((m) => m.to).sort()).toEqual(
      [
        join(anumatiDir, "anumati-audit.jsonl"),
        join(anumatiDir, "anumati-passthrough.jsonl"),
        join(anumatiDir, "anumati-suggestions.jsonl"),
      ].sort(),
    );
  });

  it("is incremental: config already moved, logs still legacy → finishes the logs", () => {
    // Config already at the new home, but its audit paths still point at legacy logs.
    mkdirSync(anumatiDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      anumatiPath,
      JSON.stringify({
        audit: {
          audit_file: join(claudeDir, "anumati-audit.jsonl"),
          passthrough_file: join(claudeDir, "anumati-passthrough.jsonl"),
        },
        allow: [],
      }),
    );
    writeFileSync(join(claudeDir, "anumati-audit.jsonl"), "a\n");
    writeFileSync(join(claudeDir, "anumati-passthrough.jsonl"), "p\n");

    const res = applyMigrate(opts());

    expect(res.status).toBe("already-migrated");
    expect(res.movedFiles).toHaveLength(2);
    expect(existsSync(join(anumatiDir, "anumati-audit.jsonl"))).toBe(true);
    const cfg = JSON.parse(readFileSync(anumatiPath, "utf-8"));
    expect(cfg.audit.audit_file).toBe(join(anumatiDir, "anumati-audit.jsonl"));
  });

  it("is fully idempotent — a second run moves nothing", () => {
    seedLegacy();
    applyMigrate(opts());
    const res2 = applyMigrate(opts());
    expect(res2.status).toBe("already-migrated");
    expect(res2.movedFiles).toEqual([]);
  });

  it("leaves custom (non-legacy-home) log paths alone", () => {
    mkdirSync(claudeDir, { recursive: true });
    const customLog = join(dir, "custom", "audit.jsonl");
    mkdirSync(dirname(customLog), { recursive: true });
    writeFileSync(customLog, "x\n");
    writeFileSync(
      claudePath,
      JSON.stringify({ audit: { audit_file: customLog }, allow: [] }),
    );

    const res = applyMigrate(opts());

    expect(res.movedFiles).toEqual([]); // custom path not under legacy home
    expect(existsSync(customLog)).toBe(true);
    expect(JSON.parse(readFileSync(anumatiPath, "utf-8")).audit.audit_file).toBe(customLog);
  });

  it("reports nothing-to-migrate when there's no legacy config", () => {
    const res = applyMigrate(opts());
    expect(res.status).toBe("nothing-to-migrate");
    expect(existsSync(anumatiPath)).toBe(false);
  });

  it("rolls back safely when a symlink can't be created (Windows fallback)", () => {
    seedLegacy();

    const res = applyMigrate({
      ...opts(),
      symlink: () => {
        throw new Error("EPERM: symlink not permitted");
      },
    });

    expect(res.status).toBe("symlink-unsupported");
    // legacy config restored as a real file; logs untouched (phase 2 never ran)
    expect(existsSync(claudePath)).toBe(true);
    expect(lstatSync(claudePath).isSymbolicLink()).toBe(false);
    expect(existsSync(anumatiPath)).toBe(false);
    expect(existsSync(join(claudeDir, "anumati-audit.jsonl"))).toBe(true);
    expect(res.movedFiles).toEqual([]);
  });
});
