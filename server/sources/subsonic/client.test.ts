import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredPrivateCloudInstance } from "../privateCloudStore";
import {
  buildSubsonicAuthParams,
  buildSubsonicStreamUrl,
  getSubsonicLyrics,
  pingSubsonic,
  searchSubsonic,
} from "./client";
import { subsonicManifest } from "./manifest";

const demoInstance: StoredPrivateCloudInstance = {
  id: "sub-home",
  kind: "subsonic",
  name: "Home Navidrome",
  baseUrl: "https://music.example.local",
  username: "alice",
  encryptedPassword: "secret-password",
  enabled: true,
  mobileTranscodeBitrate: 192,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenSubsonic client", () => {
  it("generates salted MD5 auth tokens without exposing plaintext passwords", () => {
    const params = buildSubsonicAuthParams("alice", "my-pass", "ab12cd34ef");
    expect(params.u).toBe("alice");
    expect(params.s).toBe("ab12cd34ef");
    expect(params.v).toBe("1.16.1");
    expect(params.c).toBe("Aria");
    expect(params.f).toBe("json");
    expect(params.t).toBe(crypto.createHash("md5").update("my-passab12cd34ef").digest("hex"));
    expect(JSON.stringify(params)).not.toContain("my-pass");
  });

  it("uses format=raw for desktop and format=opus&maxBitRate=192 for mobile transcode", () => {
    const rawUrl = new URL(buildSubsonicStreamUrl(demoInstance, "song-9"));
    expect(rawUrl.pathname).toBe("/rest/stream.view");
    expect(rawUrl.searchParams.get("id")).toBe("song-9");
    expect(rawUrl.searchParams.get("format")).toBe("raw");
    expect(rawUrl.searchParams.get("maxBitRate")).toBeNull();

    const mobileUrl = new URL(buildSubsonicStreamUrl(demoInstance, "song-9", { transcodeBitrate: 192 }));
    expect(mobileUrl.searchParams.get("format")).toBe("opus");
    expect(mobileUrl.searchParams.get("maxBitRate")).toBe("192");
    expect(subsonicManifest.capabilities.directShareable).toBe(false);
  });

  it("pings, searches, and maps OpenSubsonic structured synced lyrics cleanly", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/ping.view")) {
        return new Response(
          JSON.stringify({
            "subsonic-response": {
              status: "ok",
              version: "1.16.1",
              openSubsonic: true,
              serverVersion: "Navidrome 0.54.0",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/rest/search3.view")) {
        return new Response(
          JSON.stringify({
            "subsonic-response": {
              status: "ok",
              searchResult3: {
                song: [
                  {
                    id: "42",
                    title: "Blue Hour",
                    artist: "Aria Band",
                    album: "Night Tape",
                    duration: 215,
                    bitRate: 1411,
                    samplingRate: 96000,
                    bitDepth: 24,
                    suffix: "flac",
                    coverArt: "al-1",
                  },
                ],
                album: [],
                artist: [],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/rest/getLyricsBySongId.view")) {
        return new Response(
          JSON.stringify({
            "subsonic-response": {
              status: "ok",
              lyricsList: {
                structuredLyrics: [
                  {
                    synced: true,
                    line: [
                      { start: 12500, value: "First synced line" },
                      { start: 25000, value: "Second synced line" },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ping = await pingSubsonic(demoInstance);
    expect(ping.ok).toBe(true);
    expect(ping.openSubsonic).toBe(true);
    expect(ping.serverVersion).toBe("Navidrome 0.54.0");

    const results = await searchSubsonic(demoInstance, "Blue");
    expect(results.tracks).toHaveLength(1);
    expect(results.tracks[0]).toMatchObject({
      id: "sub-home:42",
      title: "Blue Hour",
      quality: "Hi-Res",
      source: "subsonic",
      sampleRate: 96000,
    });

    const lyrics = await getSubsonicLyrics(demoInstance, "42");
    expect(lyrics).toHaveLength(2);
    expect(lyrics[0]).toMatchObject({ time: "00:12", startTime: 12.5, text: "First synced line" });
  });
});
