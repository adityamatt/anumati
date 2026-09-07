import { describe, it, expect } from "vitest";
import {
  resolveSoundCommand,
  isSoundEnabled,
  playSound,
  resolveNotifyConfig,
} from "../src/notify.js";

describe("resolveNotifyConfig", () => {
  it("merges project over root field-by-field", () => {
    const project = { notify: { sound: false } };
    const root = { notify: { sound: true, sound_command: ["afplay", "/x.aiff"] } };
    expect(resolveNotifyConfig(project, root)).toEqual({
      sound: false, // project wins
      sound_command: ["afplay", "/x.aiff"], // falls back to root
    });
  });

  it("returns empty fields when neither config sets notify", () => {
    expect(resolveNotifyConfig(null, null)).toEqual({ sound: undefined, sound_command: undefined });
  });
});

describe("isSoundEnabled", () => {
  it("defaults to enabled when notify is absent", () => {
    expect(isSoundEnabled(undefined)).toBe(true);
  });

  it("defaults to enabled when sound is unset", () => {
    expect(isSoundEnabled({})).toBe(true);
  });

  it("is disabled only when sound is explicitly false", () => {
    expect(isSoundEnabled({ sound: false })).toBe(false);
    expect(isSoundEnabled({ sound: true })).toBe(true);
  });
});

describe("resolveSoundCommand — platform defaults", () => {
  it("uses afplay on macOS", () => {
    expect(resolveSoundCommand(undefined, "darwin")[0]).toBe("afplay");
  });

  it("uses paplay on Linux", () => {
    expect(resolveSoundCommand(undefined, "linux")[0]).toBe("paplay");
  });

  it("uses powershell beep on Windows", () => {
    expect(resolveSoundCommand(undefined, "win32")[0]).toBe("powershell");
  });

  it("returns null on an unknown platform", () => {
    expect(resolveSoundCommand(undefined, "aix" as NodeJS.Platform)).toBeNull();
  });
});

describe("resolveSoundCommand — overrides", () => {
  it("prefers an array sound_command", () => {
    expect(resolveSoundCommand({ sound_command: ["mplay", "/x.wav"] }, "darwin")).toEqual([
      "mplay",
      "/x.wav",
    ]);
  });

  it("splits a string sound_command on whitespace", () => {
    expect(resolveSoundCommand({ sound_command: "afplay /y.aiff" }, "linux")).toEqual([
      "afplay",
      "/y.aiff",
    ]);
  });

  it("ignores an empty array override and falls back to default", () => {
    expect(resolveSoundCommand({ sound_command: [] }, "darwin")[0]).toBe("afplay");
  });

  it("ignores a blank string override and falls back to default", () => {
    expect(resolveSoundCommand({ sound_command: "   " }, "darwin")[0]).toBe("afplay");
  });
});

describe("playSound — safety", () => {
  it("never throws when disabled", () => {
    expect(() => playSound({ sound: false })).not.toThrow();
  });

  it("never throws with a nonexistent binary override", () => {
    expect(() =>
      playSound({ sound_command: ["anumati-no-such-player-xyz"] }, "linux"),
    ).not.toThrow();
  });

  it("never throws on an unknown platform (no default command)", () => {
    expect(() => playSound(undefined, "aix" as NodeJS.Platform)).not.toThrow();
  });
});
