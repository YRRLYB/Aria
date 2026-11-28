import { describe, expect, it } from "vitest";
import { buildBackupSnapshot, mergeBackupSnapshot, parseAndValidateBackup } from "./configBackup";

describe("configBackup", () => {
  it("strips sensitive cookies, passwords, tokens and TURN secrets from exported snapshots", () => {
    const snapshot = buildBackupSnapshot({
      appVersion: "0.9.0",
      eqPresets: [{ id: "eq-1", name: "Warm Studio", bands: [1, 2, 0] }],
      playlists: [{ id: "pl-1", name: "SuperMix", trackIds: ["netease:1"] }],
      preferences: {
        theme: "dark",
        volume: 60,
        neteaseCookie: "MUSIC_U=secret",
        password: "plaintext-password",
        encryptedPassword: "enc:v1:abc",
        turnCredential: "turn-secret",
      },
      desktopLyrics: { style: "glass", alwaysOnTop: true },
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("MUSIC_U");
    expect(serialized).not.toContain("plaintext-password");
    expect(serialized).not.toContain("enc:v1:abc");
    expect(serialized).not.toContain("turn-secret");
    expect(snapshot.modules.eqPresets).toHaveLength(1);
    expect(snapshot.modules.playlists).toHaveLength(1);
    expect(snapshot.modules.preferences).toEqual({ theme: "dark", volume: 60 });
    expect(snapshot.modules.desktopLyrics).toEqual({ style: "glass", alwaysOnTop: true });
  });

  it("validates incoming snapshots and supports both merge and overwrite strategies", () => {
    const parsed = parseAndValidateBackup(
      JSON.stringify({
        version: 1,
        exportedAt: "2026-11-28T00:00:00.000Z",
        appVersion: "0.9.0",
        modules: {
          eqPresets: [{ id: "eq-2", name: "Harman" }],
          preferences: { volume: 45, youtubeCookie: "leaked" },
        },
      }),
    );

    expect(parsed.modules.preferences).toEqual({ volume: 45 });

    const current = {
      appVersion: "0.9.0",
      eqPresets: [{ id: "eq-1", name: "Studio" }],
      preferences: { theme: "dark", volume: 70 },
    };

    const merged = mergeBackupSnapshot(current, parsed, "merge");
    expect(merged.eqPresets).toHaveLength(2);
    expect(merged.preferences).toEqual({ theme: "dark", volume: 45 });

    const overwritten = mergeBackupSnapshot(current, parsed, "overwrite");
    expect(overwritten.eqPresets).toHaveLength(1);
    expect(overwritten.preferences).toEqual({ volume: 45 });
  });
});
