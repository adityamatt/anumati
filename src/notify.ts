import { spawn } from "child_process";
import type { NotifyConfig } from "./types.js";

// Per-platform default sound command. Each is a best-effort, widely-available
// player invoked on a short, built-in system sound. If the binary is missing
// the spawn fails silently (see playSound) and we simply make no noise.
function defaultSoundCommand(platform: NodeJS.Platform): string[] | null {
  switch (platform) {
    case "darwin":
      return ["afplay", "/System/Library/Sounds/Funk.aiff"];
    case "linux":
      // paplay ships with PulseAudio/PipeWire; this sound is present on most desktops.
      return ["paplay", "/usr/share/sounds/freedesktop/stereo/message.oga"];
    case "win32":
      // Use PowerShell's built-in beep so we depend on no external file.
      return ["powershell", "-c", "[console]::beep(880,200)"];
    default:
      return null;
  }
}

// Resolve the command to run for the passthrough alert. A user-supplied
// `sound_command` (array form preferred; string is treated as a single argv0)
// always wins; otherwise fall back to the platform default.
export function resolveSoundCommand(
  notify: NotifyConfig | undefined,
  platform: NodeJS.Platform,
): string[] | null {
  const custom = notify?.sound_command;
  if (Array.isArray(custom) && custom.length > 0) return custom;
  if (typeof custom === "string" && custom.trim() !== "") return custom.split(/\s+/);
  return defaultSoundCommand(platform);
}

// Notifications are ON by default whenever a config is present; a user disables
// them with `notify.sound: false`.
export function isSoundEnabled(notify: NotifyConfig | undefined): boolean {
  return notify?.sound !== false;
}

/**
 * Play the passthrough alert sound, fire-and-forget. This never blocks the hook
 * and never throws: the child is fully detached and unref'd so the hook process
 * can exit immediately, and any spawn error (missing binary, etc.) is swallowed.
 * stdio is ignored so nothing leaks into the hook's stdout JSON.
 */
export function playSound(
  notify: NotifyConfig | undefined,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!isSoundEnabled(notify)) return;

  const argv = resolveSoundCommand(notify, platform);
  if (!argv || argv.length === 0) return;

  try {
    const child = spawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: "ignore",
    });
    // Don't let a failed spawn (e.g. ENOENT) crash the hook.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Swallow — a missing player must never affect the permission decision.
  }
}
