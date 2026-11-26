import { describe, expect, it } from "vitest";
import {
  ClockSyncTracker,
  applyPlaybackSyncToState,
  ariaPayloadToGuestTrack,
  ariaPayloadToHostTrack,
  canonicalTrackId,
  canonicalizeTrackForLibrary,
  computeExpectedPlaybackSec,
  computeScheduledStartDelayMs,
  decodeAriaJoinInput,
  decodeMediaPacket,
  encodeMediaPacket,
  evaluateAriaRoomDrift,
  formatAriaBitrateKbps,
  mergeIncomingPlaybackState,
  normalizeAriaRoomCode,
  normalizePortableApiUrl,
  rankRelayCandidates,
  trackToAriaPayload,
} from "./ariaRoomSync";
import type { AriaRoomPlaybackState } from "./api";

describe("ariaRoomSync utilities", () => {
  it("tracks min-RTT NTP samples, exposes hasSamples(), and filters latency spikes", () => {
    const tracker = new ClockSyncTracker(8);
    expect(tracker.hasSamples()).toBe(false);
    // Low RTT sample: true offset = +200ms
    tracker.record({ t0: 1000, t1: 1215, t2: 1215, t3: 1030 });
    tracker.record({ t0: 2000, t1: 2212, t2: 2212, t3: 2024 });
    // Asymmetric jitter spike (huge RTT = 800ms)
    tracker.record({ t0: 3000, t1: 3900, t2: 3900, t3: 3800 });

    expect(tracker.hasSamples()).toBe(true);
    const best = tracker.getBestEstimate();
    expect(best.rttMs).toBeLessThan(35);
    expect(best.offsetMs).toBe(200);

    tracker.reset();
    expect(tracker.hasSamples()).toBe(false);
  });

  it("computes scheduled PLAY_AT start delay and listener-first drift calibration", () => {
    const delay = computeScheduledStartDelayMs({
      startAtHostMs: 5500,
      localNowMs: 5000,
      clockOffsetMs: 200,
    });
    expect(delay).toBe(300);

    // < 350ms: completely untouched bit-exact playback
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 40.25, playing: true }),
    ).toMatchObject({ action: "none", speed: 1, shouldSeek: false });

    // 350..1200ms behind: imperceptible catch-up at 1.015x without seeking
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 39.4, playing: true }),
    ).toMatchObject({ action: "speed", speed: 1.015, shouldSeek: false });

    // 350..1200ms ahead: imperceptible slow-down at 0.985x without seeking
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 40.8, playing: true }),
    ).toMatchObject({ action: "speed", speed: 0.985, shouldSeek: false });

    // 1200..2500ms behind/ahead: gentle 1.03x / 0.97x catch-up without hard seek
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 38.0, playing: true }),
    ).toMatchObject({ action: "speed", speed: 1.03, shouldSeek: false });
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 42.2, playing: true }),
    ).toMatchObject({ action: "speed", speed: 0.97, shouldSeek: false });

    // > 2500ms: hard seek to prevent lingering out-of-sync playback
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 37.0, playing: true }),
    ).toMatchObject({ action: "seek", speed: 1, shouldSeek: true });
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 43.0, playing: true }),
    ).toMatchObject({ action: "seek", speed: 1, shouldSeek: true });

    // Paused: threshold at 500ms
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 40.3, playing: false }),
    ).toMatchObject({ action: "none", speed: 1, shouldSeek: false });
    expect(
      evaluateAriaRoomDrift({ expectedSec: 40, actualSec: 40.55, playing: false }),
    ).toMatchObject({ action: "seek", speed: 1, shouldSeek: true });
  });

  it("applies playback_sync deterministically, guards stale state_update rollbacks, and extrapolates safely", () => {
    const baseState: AriaRoomPlaybackState = {
      nonce: "trk_a",
      track: null,
      nextTrack: null,
      queue: [],
      playing: false,
      positionSec: 0,
      updatedAtMs: 1_000,
      serverSeq: 1,
    };

    // play_at promotes paused room state to playing using startAtHostMs anchor
    const started = applyPlaybackSyncToState(baseState, {
      seq: 2,
      kind: "play_at",
      nonce: "trk_a",
      positionSec: 0,
      startAtHostMs: 2_250,
      serverTimeMs: 2_000,
    });
    expect(started).toMatchObject({
      playing: true,
      positionSec: 0,
      updatedAtMs: 2_250,
      serverSeq: 2,
    });

    // Stale seq or mismatched track nonce is ignored
    expect(
      applyPlaybackSyncToState(started, {
        seq: 2,
        kind: "pause",
        nonce: "trk_a",
        positionSec: 0,
        startAtHostMs: 0,
        serverTimeMs: 2_500,
      }),
    ).toBe(started);
    expect(
      applyPlaybackSyncToState(started, {
        seq: 3,
        kind: "pause",
        nonce: "trk_other",
        positionSec: 0,
        startAtHostMs: 0,
        serverTimeMs: 2_500,
      }),
    ).toBe(started);

    // seek keeps playing=true and updates position + anchor (serverTimeMs)
    const sought = applyPlaybackSyncToState(started, {
      seq: 4,
      kind: "seek",
      nonce: "trk_a",
      positionSec: 42,
      startAtHostMs: 5_100,
      serverTimeMs: 5_000,
    });
    expect(sought).toMatchObject({
      playing: true,
      positionSec: 42,
      updatedAtMs: 5_000,
      serverSeq: 4,
    });

    // Older state_update on the same nonce cannot revert newer playback_sync
    const mergedSameTrack = mergeIncomingPlaybackState(sought, baseState);
    expect(mergedSameTrack).toMatchObject({
      playing: true,
      positionSec: 42,
      updatedAtMs: 5_000,
      serverSeq: 4,
    });

    // New track nonce supersedes cleanly
    const nextTrackState: AriaRoomPlaybackState = { ...baseState, nonce: "trk_b", serverSeq: 5 };
    expect(mergeIncomingPlaybackState(sought, nextTrackState)).toBe(nextTrackState);

    // Expected position never extrapolates when uncalibrated or paused
    expect(
      computeExpectedPlaybackSec({
        playback: sought,
        localNowMs: 9_000,
        clockOffsetMs: 0,
        clockSynced: false,
      }),
    ).toBe(42);
    expect(
      computeExpectedPlaybackSec({
        playback: applyPlaybackSyncToState(sought, {
          seq: 5,
          kind: "pause",
          nonce: "trk_a",
          positionSec: 46,
          startAtHostMs: 0,
          serverTimeMs: 9_000,
        }),
        localNowMs: 14_000,
        clockOffsetMs: 500,
        clockSynced: true,
      }),
    ).toBe(46);

    // Calibrated & playing extrapolates cleanly and respects maxDurationSec
    expect(
      computeExpectedPlaybackSec({
        playback: sought,
        localNowMs: 7_500,
        clockOffsetMs: 500,
        clockSynced: true,
        maxDurationSec: 50,
      }),
    ).toBe(45);
    expect(
      computeExpectedPlaybackSec({
        playback: sought,
        localNowMs: 30_000,
        clockOffsetMs: 500,
        clockSynced: true,
        maxDurationSec: 50,
      }),
    ).toBe(50);
  });

  it("ranks VIP relay candidates excluding members who disabled sharing", () => {
    const ranked = rankRelayCandidates(
      [
        {
          peerId: "guest-free",
          nickname: "Free",
          avatarUrl: null,
          role: "guest",
          joinedAt: 1,
          connectedVia: "ws",
          shareEnabled: true,
          capabilities: { netease: "free", qq: "none", bilibili: "free", youtube: "unreachable" },
        },
        {
          peerId: "guest-vip-optout",
          nickname: "OptOut",
          avatarUrl: null,
          role: "guest",
          joinedAt: 2,
          connectedVia: "ws",
          shareEnabled: false,
          capabilities: { netease: "vip", qq: "vip", bilibili: "free", youtube: "reachable" },
        },
        {
          peerId: "guest-vip",
          nickname: "VIP",
          avatarUrl: null,
          role: "guest",
          joinedAt: 3,
          connectedVia: "ws",
          shareEnabled: true,
          capabilities: { netease: "vip", qq: "none", bilibili: "free", youtube: "unreachable" },
        },
        {
          peerId: "guest-none",
          nickname: "NoAccount",
          avatarUrl: null,
          role: "guest",
          joinedAt: 4,
          connectedVia: "ws",
          shareEnabled: true,
          capabilities: { netease: "none", qq: "none", bilibili: "none", youtube: "unreachable" },
        },
        {
          peerId: "guest-offline",
          nickname: "Offline",
          avatarUrl: null,
          role: "guest",
          joinedAt: 5,
          connectedVia: "ws",
          shareEnabled: true,
          online: false,
          presence: "offline",
          capabilities: { netease: "vip", qq: "vip", bilibili: "vip", youtube: "reachable" },
        },
      ],
      "netease",
      "host-1",
    );
    expect(ranked.map((m) => m.peerId)).toEqual(["guest-vip", "guest-free"]);
  });

  it("parses Cloudflare & custom room codes and direct host share links (IPv4 & IPv6)", () => {
    expect(decodeAriaJoinInput("a7k9m2")).toEqual({ kind: "cloudflare", roomId: "A7K9M2" });
    expect(decodeAriaJoinInput("aria_party-01")).toEqual({ kind: "cloudflare", roomId: "ARIA_PARTY-01" });
    expect(normalizeAriaRoomCode(" ab1 ")).toBe("AB1");
    expect(normalizeAriaRoomCode("my_room-99")).toBe("MY_ROOM-99");
    expect(normalizeAriaRoomCode("x")).toBeNull();
    expect(normalizeAriaRoomCode("bad room!")).toBeNull();
    expect(decodeAriaJoinInput("bad!code")).toBeNull();
    expect(
      decodeAriaJoinInput("aria-direct://v1?host=play.example.com&port=3639&token=secretTok"),
    ).toEqual({
      kind: "direct",
      host: "play.example.com",
      port: 3639,
      token: "secretTok",
    });
    expect(decodeAriaJoinInput("[240e::1]:3639#tok6")).toEqual({
      kind: "direct",
      host: "240e::1",
      port: 3639,
      token: "tok6",
    });
    expect(decodeAriaJoinInput("")).toBeNull();
  });

  it("encodes and decodes bit-exact WebRTC media packets cleanly", () => {
    const raw = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x01, 0x02, 0xff]).buffer;
    const packet = encodeMediaPacket(
      {
        nonce: "trk_1",
        offset: 65536,
        totalBytes: 1234567,
        eof: false,
        mimeType: "audio/flac",
        bitrate: 1411,
        sampleRate: 44100,
        currentLevel: "lossless",
      },
      raw,
    );
    const decoded = decodeMediaPacket(packet);
    expect(decoded.header.nonce).toBe("trk_1");
    expect(decoded.header.bitrate).toBe(1411);
    expect(decoded.header.sampleRate).toBe(44100);
    expect(Array.from(decoded.payload)).toEqual([0x66, 0x4c, 0x61, 0x43, 0x01, 0x02, 0xff]);
  });

  it("normalizes bps/kbps bitrates and preserves non-local artwork URLs with CSS gradient fallback", () => {
    expect(formatAriaBitrateKbps(1058000)).toBe("1058 kbps");
    expect(formatAriaBitrateKbps(1411)).toBe("1411 kbps");
    expect(formatAriaBitrateKbps(320)).toBe("320 kbps");
    expect(formatAriaBitrateKbps(null)).toBeNull();

    const remoteTrack = ariaPayloadToGuestTrack({
      nonce: "n_1",
      id: "netease:1087",
      source: "netease",
      title: "表白",
      artist: "萧亚轩",
      album: "1087",
      duration: "03:45",
      quality: "Lossless",
      bitrate: 1058000,
      sampleRate: 44100,
      coverUrl: "https://p1.music.126.net/cover.jpg",
    });
    expect(remoteTrack.coverUrl).toBe("https://p1.music.126.net/cover.jpg");
    expect(remoteTrack.cover).toContain("linear-gradient(");

    const localTrack = ariaPayloadToGuestTrack({
      nonce: "loc_1",
      id: "local:1",
      source: "local",
      title: "Local FLAC",
      artist: "Artist",
      album: "Album",
      duration: "04:00",
      quality: "FLAC",
      coverUrl: "/api/library/tracks/local%3A1/cover",
    });
    expect(localTrack.coverUrl).toBe("/api/aria-room/guest/cover/loc_1");
  });

  it("normalizes loopback API URLs and reconstructs host-playable tracks for guest-owned songs", () => {
    expect(normalizePortableApiUrl("http://127.0.0.1:41234/api/library/tracks/abc/stream")).toBe(
      "/api/library/tracks/abc/stream",
    );
    expect(normalizePortableApiUrl("https://cdn.example.com/song.jpg")).toBe(
      "https://cdn.example.com/song.jpg",
    );

    const payload = trackToAriaPayload(
      {
        id: "local:guest-file",
        source: "local",
        title: "Guest Local Track",
        artist: "Tester",
        album: "Vault",
        duration: "03:20",
        quality: "FLAC",
        streamUrl: "http://127.0.0.1:51234/api/library/tracks/local%3Aguest-file/stream",
        coverUrl: "http://localhost:51234/api/library/tracks/local%3Aguest-file/cover",
        cover: "linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)",
        accent: "#38bdf8",
        waveform: [],
        lyrics: [],
        lyricStatus: "searchable",
      },
      "loc_guest",
      { peerId: "guest-1", nickname: "Guest" },
    );
    expect(payload.streamUrl).toBe("/api/library/tracks/local%3Aguest-file/stream");
    expect(payload.coverUrl).toBe("/api/library/tracks/local%3Aguest-file/cover");

    const hostViewOfGuestLocal = ariaPayloadToHostTrack(payload, "host-1");
    expect(hostViewOfGuestLocal.id).toBe("local:guest-file");
    expect(hostViewOfGuestLocal.streamUrl).toBe("/api/aria-room/guest/stream/loc_guest");
    expect(hostViewOfGuestLocal.coverUrl).toBe("/api/aria-room/guest/cover/loc_guest");

    const hostViewOfGuestVipRelay = ariaPayloadToHostTrack(
      {
        nonce: "qq_vip_1",
        id: "qq:001abc",
        providerId: "001abc",
        source: "qq",
        title: "VIP Track",
        artist: "Singer",
        album: "Album",
        duration: "04:10",
        quality: "FLAC",
        addedByPeerId: "guest-1",
        dispatch: {
          mode: "direct_url",
          providerPeerId: "guest-1",
          directUrl: "https://cdn.example.com/vip.flac",
        },
      },
      "host-1",
    );
    expect(hostViewOfGuestVipRelay.streamUrl).toBe("/api/aria-room/guest/stream/qq_vip_1");

    const hostViewOfHostOnline = ariaPayloadToHostTrack(
      {
        nonce: "ne_1",
        id: "netease:555",
        providerId: "555",
        source: "netease",
        title: "Own Track",
        artist: "Singer",
        album: "Album",
        duration: "03:00",
        quality: "Lossless",
        addedByPeerId: "host-1",
        dispatch: {
          mode: "direct_url",
          providerPeerId: "host-1",
          directUrl: "https://cdn.example.com/own.flac",
        },
      },
      "host-1",
    );
    expect(hostViewOfHostOnline.streamUrl).toBe("/api/providers/netease/stream/555");
  });

  it("canonicalizes aria-room tracks, prioritizes Bilibili VIP relay, and routes YouTube covers through guest proxy first when relay data exists", () => {
    const guestTrack = {
      id: "aria-room:trk_guest_9",
      originTrackId: "netease:987654",
      providerId: "987654",
      source: "netease" as const,
      title: "Guest Song",
      artist: "Artist",
      album: "Album",
      duration: "04:00",
      quality: "Lossless" as const,
      streamUrl: "/api/aria-room/guest/stream/trk_guest_9",
      cover: "linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)",
      accent: "#38bdf8",
      waveform: [],
      lyrics: [],
      lyricStatus: "searchable" as const,
    };
    expect(canonicalTrackId(guestTrack)).toBe("netease:987654");
    const canonicalized = canonicalizeTrackForLibrary(guestTrack);
    expect(canonicalized.id).toBe("netease:987654");
    expect(canonicalized.streamUrl).toBe("/api/providers/netease/stream/987654");

    const ranked = rankRelayCandidates(
      [
        {
          peerId: "host",
          nickname: "Host",
          avatarUrl: null,
          role: "host",
          joinedAt: 1,
          connectedVia: "ws",
          capabilities: { netease: "none", qq: "none", bilibili: "free", youtube: "unreachable" },
          shareEnabled: true,
        },
        {
          peerId: "guest-vip",
          nickname: "VIP",
          avatarUrl: null,
          role: "guest",
          joinedAt: 2,
          connectedVia: "ws",
          capabilities: { netease: "none", qq: "none", bilibili: "vip", youtube: "unreachable" },
          shareEnabled: true,
        },
      ],
      "bilibili",
      "host",
    );
    expect(ranked.map((m) => m.peerId)).toEqual(["guest-vip", "host"]);

    const ytGuestTrack = ariaPayloadToGuestTrack({
      nonce: "trk_yt_1",
      id: "youtube:dQw4w9WgXcQ",
      providerId: "dQw4w9WgXcQ",
      source: "youtube",
      title: "YT Song",
      artist: "Creator",
      album: "YT",
      duration: "03:33",
      quality: "320K",
      coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      coverDataUrl: "data:image/jpeg;base64,AA==",
      dispatch: {
        mode: "stream_proxy",
        providerPeerId: "host",
      },
    });
    expect(ytGuestTrack.coverUrl).toContain("/api/aria-room/guest/cover/trk_yt_1");
    expect(ytGuestTrack.coverFallbackUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");

    const sanitizedPayload = trackToAriaPayload({
      id: "x".repeat(250),
      source: "local",
      title: "T".repeat(400),
      artist: "A".repeat(400),
      album: "B".repeat(400),
      duration: "03:00",
      quality: "FLAC",
      coverUrl: "data:image/png;base64,AAAA",
      streamUrl: "https://example.com/" + "a".repeat(2000),
      cover: "linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)",
      accent: "#38bdf8",
      waveform: [],
      lyrics: [],
      lyricStatus: "searchable",
    });
    expect(sanitizedPayload.id.length).toBe(200);
    expect(sanitizedPayload.title.length).toBe(300);
    expect(sanitizedPayload.coverUrl).toBeNull();
    expect(sanitizedPayload.streamUrl?.length).toBe(1500);
  });
});
