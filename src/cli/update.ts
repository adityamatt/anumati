import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

/**
 * `anumati update` — pull the latest published version so consumers don't have
 * to remember `npm install -g anumati@latest`.
 *
 * Because the PreToolUse hook is wired as `anumati <config>` (see
 * cli/settings.ts buildHookCommand), it resolves the `anumati` bin through PATH
 * on every call — so a global reinstall is picked up on the next command with no
 * re-wiring and no restart. This command therefore only has to (1) find the
 * latest version, (2) compare, and (3) run the global install when newer.
 *
 * The decision is a pure function (planUpdate) so it can be unit-tested without
 * a network or npm; runUpdate is the thin I/O shell around it.
 */

/** npm binary name — `.cmd` shim on Windows, plain `npm` elsewhere. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

// Compare two semver-ish strings by their numeric core (major.minor.patch),
// ignoring any prerelease/build suffix. Returns <0 if a<b, 0 if equal, >0 if
// a>b. Non-numeric parts count as 0, so an unparseable current version reads as
// "older" and offers the update rather than blocking it.
export function compareSemver(a: string, b: string): number {
  const core = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export type UpdateAction =
  | "up-to-date" // current >= latest
  | "update-available" // a newer version exists
  | "unknown-latest" // couldn't determine the latest version
  | "source-checkout"; // running inside a dev clone; global install isn't the fix

export interface UpdateDecision {
  action: UpdateAction;
  /** Whether runUpdate should actually run `npm install -g`. */
  shouldInstall: boolean;
}

export interface PlanInput {
  current: string;
  latest: string | null;
  checkOnly: boolean;
  isSource: boolean;
  force: boolean;
}

/** Pure decision: what should `update` do, given the facts it gathered? */
export function planUpdate({ current, latest, checkOnly, isSource, force }: PlanInput): UpdateDecision {
  // A source checkout is updated with git, not a global reinstall. Refuse unless
  // forced, so a developer doesn't accidentally shadow their clone. --check is
  // read-only (never installs), so it's allowed through to just report status.
  if (isSource && !force && !checkOnly) return { action: "source-checkout", shouldInstall: false };
  if (!latest) return { action: "unknown-latest", shouldInstall: false };
  if (compareSemver(current, latest) >= 0) return { action: "up-to-date", shouldInstall: false };
  return { action: "update-available", shouldInstall: !checkOnly };
}

// The package root that contains this install's package.json. dist/cli/update.js
// (or src/cli/update.ts under ts-node) sits two levels below it.
function packageRoot(): string {
  return resolve(__dirname, "..", "..");
}

function readCurrentVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// A published/global install ships only dist/docs/README/LICENSE (see the
// package.json "files" allowlist) — never src/. Its presence means this is a
// working copy, where `npm install -g` would install a *separate* global copy
// rather than updating the checkout.
function isSourceCheckout(root: string): boolean {
  return existsSync(join(root, "src"));
}

/** Ask npm for the version behind the `latest` dist-tag. null on any failure. */
function fetchLatestVersion(): string | null {
  const r = spawnSync(NPM, ["view", "anumati", "version"], { encoding: "utf-8", timeout: 20000 });
  if (r.status !== 0 || !r.stdout) return null;
  const v = r.stdout.trim();
  return v.length > 0 ? v : null;
}

/** CLI entrypoint: `anumati update [--check] [--force]` */
export function runUpdate(argv: string[]): void {
  const args = argv.slice(1); // drop the "update" token
  const checkOnly = args.includes("--check");
  const force = args.includes("--force");

  const root = packageRoot();
  const current = readCurrentVersion(root);
  const isSource = isSourceCheckout(root);

  // Source checkout without --force: no network needed, just guide. (--check is
  // read-only, so let it through to report the published version instead.)
  if (isSource && !force && !checkOnly) {
    console.log(`This looks like an anumati source checkout (${root}).`);
    console.log(`  \`anumati update\` targets a global npm install; it won't touch a working copy.`);
    console.log(`  To update this checkout:  git pull && npm install && npm run build`);
    console.log(`  To install the latest published version globally anyway:  anumati update --force`);
    return;
  }

  const latest = fetchLatestVersion();
  const { action, shouldInstall } = planUpdate({ current, latest, checkOnly, isSource, force });

  switch (action) {
    case "unknown-latest":
      console.error(`✗ Could not determine the latest version (offline, or npm unavailable).`);
      console.error(`  Update manually: ${NPM} install -g anumati@latest`);
      process.exit(1);
      return;

    case "up-to-date":
      console.log(`✓ anumati is up to date (${current}).`);
      return;

    case "update-available":
      if (!shouldInstall) {
        // --check
        console.log(`↑ Update available: ${current} → ${latest}. Run \`anumati update\` to install.`);
        return;
      }
      console.log(`Updating anumati ${current} → ${latest}…`);
      if (isSource) {
        console.log(`  (source checkout + --force: installing a global copy separate from ${root})`);
      }
      {
        const r = spawnSync(NPM, ["install", "-g", "anumati@latest"], { stdio: "inherit" });
        if (r.status !== 0) {
          console.error(`✗ \`${NPM} install -g anumati@latest\` failed (exit ${r.status ?? "?"}).`);
          console.error(`  If this is a permissions error, your global npm prefix may need sudo.`);
          process.exit(r.status ?? 1);
          return;
        }
      }
      console.log(`✓ Updated anumati ${current} → ${latest}.`);
      console.log(`  The PreToolUse hook picks up the new version on its next command — no restart needed.`);
      return;

    case "source-checkout":
      // Unreachable (handled above before the network call), but kept exhaustive.
      return;
  }
}
