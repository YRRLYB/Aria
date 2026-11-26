import { rm } from "node:fs/promises";
import http from "node:http";
import type net from "node:net";
import { afterAll, describe, expect, it, vi } from "vitest";
const { tempDataDir } = vi.hoisted(() => ({
  tempDataDir: `${process.env.TEMP || process.env.TMP || "."}/aria-room-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));
vi.mock("../utils/paths", () => ({
  dataDir: tempDataDir,
  cacheDir: `${tempDataDir}/cache`,
}));
import { TrackByteCache } from "./byteCache";
import {
  AriaRoomManager,
  extractNetworkAddresses,
  formatHostForUrl,
  parseDirectPublicHost,
  rankRelayCandidates,
  sanitizeSafeHeaders,
  timingSafeTokenMatch,
} from "./roomManager";
import { acceptWebSocketUpgrade, connectWebSocket, isSelfHostedSignalingUrl } from "./wsProtocol";
// @ts-expect-error Standalone zero-dependency ESM module without ambient .d.ts
import { createAriaSignalServer } from "../../deploy/aria-signal-node/server.mjs";

afterAll(async () => {
  await rm(tempDataDir, { recursive: true, force: true });
});

describe("AriaRoomManager Direct Port, Bit-Exact Range, Security & 5-Member Cap", () => {
  it("validates scoped tokens in constant time", () => {
    expect(timingSafeTokenMatch("tok_abc123", "tok_abc123")).toBe(true);
    expect(timingSafeTokenMatch("tok_abc123", "tok_abc124")).toBe(false);
    expect(timingSafeTokenMatch("tok_abc123", "short")).toBe(false);
    expect(timingSafeTokenMatch(null, "tok_abc123")).toBe(false);
  });

  it("isolates routes (404 outside whitelist), enforces token & brute-force rate limit, streams bit-exact 206 ranges, and caps rooms at 5 members", async () => {
    const flacPayload = Buffer.alloc(64 * 1024);
    for (let i = 0; i < flacPayload.byteLength; i += 1) {
      flacPayload[i] = i % 251;
    }

    // Mock upstream audio endpoint on localApiPort serving bit-exact lossless bytes.
    const mockApi = http.createServer((req, res) => {
      if (req.url === "/api/mock/lossless") {
        res.writeHead(200, {
          "Content-Type": "audio/flac",
          "Content-Length": String(flacPayload.byteLength),
          "X-Aria-Bitrate": "2116",
          "X-Aria-Sample-Rate": "96000",
          "X-Aria-Level": "hires",
        });
        res.end(flacPayload);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => mockApi.listen(0, "127.0.0.1", () => resolve()));
    const apiAddr = mockApi.address() as net.AddressInfo;

    const manager = new AriaRoomManager({ localApiPort: apiAddr.port });
    const guestSockets: Array<{ close: () => void }> = [];

    try {
      const snap = await manager.createRoom({
        peerId: "host-1",
        nickname: "AriaHost",
        networkMode: "direct",
        controlMode: "collaborative",
        directPort: 0,
        track: {
          nonce: "trk_lossless_1",
          id: "cloud:1",
          source: "cloud",
          title: "Lossless Track",
          artist: "Aria",
          album: "Master",
          duration: "03:00",
          quality: "Hi-Res",
          bitrate: 2116,
          sampleRate: 96000,
          currentLevel: "hires",
          streamUrl: "/api/mock/lossless",
        },
        playing: true,
        positionSec: 0,
      });

      const port = snap.directServer.port;
      const token = snap.directServer.roomToken!;
      expect(snap.directServer.active).toBe(true);
      expect(token.length).toBeGreaterThan(16);

      // 1. Unrelated host endpoints strictly return 404 (never expose library/settings).
      const rootRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(rootRes.status).toBe(404);
      const settingsRes = await fetch(`http://127.0.0.1:${port}/api/settings`);
      expect(settingsRes.status).toBe(404);

      // 2. Bit-exact HTTP 206 Range streaming with valid scoped token.
      await new Promise((r) => setTimeout(r, 120));
      const rangeRes = await fetch(`http://127.0.0.1:${port}/aria-room/tracks/trk_lossless_1/stream`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: "bytes=100-199",
        },
      });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get("content-range")).toBe(`bytes 100-199/${flacPayload.byteLength}`);
      expect(rangeRes.headers.get("x-aria-bitrate")).toBe("2116");
      expect(rangeRes.headers.get("x-aria-sample-rate")).toBe("96000");
      const sliced = Buffer.from(await rangeRes.arrayBuffer());
      expect(sliced.equals(flacPayload.subarray(100, 200))).toBe(true);

      // 3. Enforce 5-member cap (host-1 + 4 guests allowed, 5th guest rejected with ROOM_FULL).
      for (let idx = 2; idx <= 5; idx += 1) {
        const { ws } = await connectWebSocket(
          `ws://127.0.0.1:${port}/aria-room/ws?token=${encodeURIComponent(token)}`,
        );
        guestSockets.push(ws);
        ws.sendJson({
          type: "hello",
          role: "guest",
          member: {
            peerId: `guest-${idx}`,
            nickname: `Guest ${idx}`,
            avatarUrl: null,
            role: "guest",
            joinedAt: Date.now(),
            connectedVia: "direct",
          },
        });
      }
      await new Promise((r) => setTimeout(r, 80));
      expect(manager.getSnapshot().members.length).toBe(5);

      const { ws: overflowWs } = await connectWebSocket(
        `ws://127.0.0.1:${port}/aria-room/ws?token=${encodeURIComponent(token)}`,
      );
      guestSockets.push(overflowWs);
      const rejection = await new Promise<Record<string, unknown>>((resolve) => {
        overflowWs.on("message", (raw: string) => {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed.type === "error") resolve(parsed);
        });
        overflowWs.sendJson({
          type: "hello",
          role: "guest",
          member: {
            peerId: "guest-6",
            nickname: "Overflow Guest",
            avatarUrl: null,
            role: "guest",
            joinedAt: Date.now(),
            connectedVia: "direct",
          },
        });
      });
      expect(rejection.code).toBe("ROOM_FULL");

      // 4. Invalid token fails with 401 and brute-force lock triggers 429 on 10th attempt.
      let lastStatus = 0;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const badRes = await fetch(`http://127.0.0.1:${port}/aria-room/tracks/trk_lossless_1/stream`, {
          headers: { Authorization: "Bearer wrong-token" },
        });
        lastStatus = badRes.status;
        if (attempt < 10) expect(lastStatus).toBe(401);
      }
      expect(lastStatus).toBe(429);

      // Clean leaveRoom shuts down Direct Server.
      const leftSnap = await manager.leaveRoom();
      expect(leftSnap.active).toBe(false);
      expect(leftSnap.directServer.active).toBe(false);
    } finally {
      for (const s of guestSockets) {
        try {
          s.close();
        } catch {
          // ignore
        }
      }
      await manager.leaveRoom();
      await new Promise<void>((resolve) => mockApi.close(() => resolve()));
    }
  });

  it("connects via mocked Cloudflare signaling WS and handles P2P guest byte ingestion", async () => {
    const rooms = new Map<string, Map<string, ReturnType<typeof acceptWebSocketUpgrade>>>();
    const mockCf = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    mockCf.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("room") ?? "DEFAULT";
      const peer = url.searchParams.get("peer") ?? "unknown";
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room)!.set(peer, ws);
      ws.on("message", (raw: string) => {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        for (const [otherId, otherWs] of rooms.get(room) ?? []) {
          if (otherId !== peer && otherWs.isOpen) {
            if (msg.type === "hello") {
              otherWs.sendJson({ type: "peer_joined", member: msg.member });
            } else {
              otherWs.send(raw);
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => mockCf.listen(0, "127.0.0.1", () => resolve()));
    const cfAddr = mockCf.address() as net.AddressInfo;

    const hostMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestMgr = new AriaRoomManager({ localApiPort: 0 });

    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "cf-host",
        nickname: "HostUser",
        networkMode: "cloudflare",
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      expect(hostSnap.active).toBe(true);
      expect(hostSnap.signalingState).toBe("connected");
      expect(hostSnap.roomId).toBeTruthy();

      const guestSnap = await guestMgr.joinRoom({
        peerId: "cf-guest",
        nickname: "GuestUser",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      expect(guestSnap.active).toBe(true);
      expect(guestSnap.signalingState).toBe("connected");

      // Ingest a bit-exact chunk directly into guest progressive buffer.
      const sample = Buffer.from("fLaC\x00\x00\x00\x22exact-bytes");
      const entry = await guestMgr.ingestGuestChunk({
        nonce: "trk_cf_1",
        offset: 0,
        chunk: sample,
        eof: true,
        totalBytes: sample.byteLength,
        mimeType: "audio/flac",
        bitrate: 1411,
        sampleRate: 44100,
      });
      expect(entry.completed).toBe(true);
      expect(entry.downloadedBytes).toBe(sample.byteLength);
      const progress = guestMgr.getBufferProgress("trk_cf_1");
      expect(progress?.completed).toBe(true);
      expect(progress?.totalBytes).toBe(sample.byteLength);

      // Verify clean failure & no stranded room when Cloudflare URL is missing or returns 404.
      const unconfiguredMgr = new AriaRoomManager({ localApiPort: 0 });
      await expect(
        unconfiguredMgr.createRoom({
          peerId: "no-cf-host",
          nickname: "Host",
          networkMode: "cloudflare",
          signalingUrl: "",
        }),
      ).rejects.toThrow(/信令/);
      expect(unconfiguredMgr.getSnapshot().active).toBe(false);

      const server404 = http.createServer((_req, res) => {
        res.writeHead(404);
        res.end("Not Found");
      });
      await new Promise<void>((resolve) => server404.listen(0, "127.0.0.1", () => resolve()));
      const addr404 = server404.address() as net.AddressInfo;

      const brokenMgr = new AriaRoomManager({ localApiPort: 0 });
      try {
        await expect(
          brokenMgr.createRoom({
            peerId: "bad-cf-host",
            nickname: "Host",
            networkMode: "cloudflare",
            signalingUrl: `ws://127.0.0.1:${addr404.port}`,
          }),
        ).rejects.toThrow(/404/);
        expect(brokenMgr.getSnapshot().active).toBe(false);
      } finally {
        await brokenMgr.leaveRoom();
        await new Promise<void>((resolve) => server404.close(() => resolve()));
      }
    } finally {
      await hostMgr.leaveRoom();
      await guestMgr.leaveRoom();
      await new Promise<void>((resolve) => mockCf.close(() => resolve()));
    }
  });

  it("strips sensitive headers via sanitizeSafeHeaders and ranks VIP relay candidates accurately", () => {
    expect(
      sanitizeSafeHeaders({
        Cookie: "MUSIC_U=secret",
        Authorization: "Bearer super-secret",
        "X-Token": "abc",
        Referer: "https://music.163.com/",
        Origin: "https://music.163.com",
        "User-Agent": "Aria/0.8.5",
      }),
    ).toEqual({
      Referer: "https://music.163.com/",
      Origin: "https://music.163.com",
      "User-Agent": "Aria/0.8.5",
    });

    const ranked = rankRelayCandidates(
      [
        {
          peerId: "guest-vip",
          nickname: "GuestVIP",
          avatarUrl: null,
          role: "guest",
          joinedAt: 20,
          connectedVia: "ws",
          shareEnabled: true,
          capabilities: { netease: "vip", qq: "none", bilibili: "free", youtube: "unreachable" },
        },
        {
          peerId: "host-free",
          nickname: "HostFree",
          avatarUrl: null,
          role: "host",
          joinedAt: 10,
          connectedVia: "ws",
          shareEnabled: true,
          capabilities: { netease: "free", qq: "none", bilibili: "free", youtube: "unreachable" },
        },
        {
          peerId: "guest-optout",
          nickname: "OptOut",
          avatarUrl: null,
          role: "guest",
          joinedAt: 5,
          connectedVia: "ws",
          shareEnabled: false,
          capabilities: { netease: "vip", qq: "vip", bilibili: "free", youtube: "reachable" },
        },
      ],
      "netease",
      "host-free",
    );
    expect(ranked.map((m) => m.peerId)).toEqual(["guest-vip", "host-free"]);
  });

  it("prioritizes physical interfaces (e.g. macOS en0) and filters 169.254 link-local IPv4 addresses", () => {
    const extracted = extractNetworkAddresses({
      lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
      utun3: [{ address: "198.18.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "198.18.0.1/16" }],
      awdl0: [
        { address: "169.254.12.34", netmask: "255.255.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "169.254.12.34/16" },
        { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "00:00:00:00:00:00", internal: false, cidr: "fe80::1/64", scopeid: 1 },
      ],
      en0: [
        { address: "192.168.1.88", netmask: "255.255.255.0", family: "IPv4", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "192.168.1.88/24" },
        { address: "240e:1234::88", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "240e:1234::88/64", scopeid: 0 },
      ],
    });
    expect(extracted.lanAddresses).toEqual(["192.168.1.88", "198.18.0.1"]);
    expect(extracted.ipv6Addresses).toEqual(["240e:1234::88"]);
  });

  it("relays NetEase VIP from a guest when host only gets a 30s trial, handles 3s timeout, and recovers 403 CDN errors via P2P proxy", { timeout: 15_000 }, async () => {
    const rooms = new Map<string, Map<string, ReturnType<typeof acceptWebSocketUpgrade>>>();
    const vipAudio = Buffer.from("fLaC\x00\x00\x00\x22vip-lossless-relay-bytes");

    const upstreamServer = http.createServer((req, res) => {
      if (req.url === "/cdn/forbidden.flac") {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden IP");
        return;
      }
      if (req.url === "/cdn/provider-vip.flac" || req.url === "/api/mock/provider-vip") {
        res.writeHead(200, {
          "Content-Type": "audio/flac",
          "Content-Length": String(vipAudio.byteLength),
        });
        res.end(vipAudio);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
    const upstreamAddr = upstreamServer.address() as net.AddressInfo;

    const mockCf = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json", "x-aria-signal": "1" });
        res.end(JSON.stringify({ ok: true, service: "aria-signal-worker" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    mockCf.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("room") ?? "DEFAULT";
      const peer = url.searchParams.get("peer") ?? "unknown";
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room)!.set(peer, ws);
      ws.on("message", (raw: string) => {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        const targetMap = rooms.get(room);
        if (!targetMap) return;
        if (typeof msg.toPeerId === "string") {
          const targetWs = targetMap.get(msg.toPeerId);
          if (targetWs?.isOpen) {
            targetWs.send(raw);
          }
          return;
        }
        for (const [otherId, otherWs] of targetMap) {
          if (otherId !== peer && otherWs.isOpen) {
            if (msg.type === "hello") {
              otherWs.sendJson({ type: "peer_joined", member: msg.member });
            } else {
              otherWs.send(raw);
            }
          }
        }
      });
    });
    await new Promise<void>((resolve) => mockCf.listen(0, "127.0.0.1", () => resolve()));
    const cfAddr = mockCf.address() as net.AddressInfo;

    let guestVipResolveBehavior: "vip" | "hang" = "vip";
    const hostMgr = new AriaRoomManager({
      localApiPort: upstreamAddr.port,
      localResolver: async () => ({
        ok: true,
        directUrl: "https://cdn.example/trial-only.mp3",
        isTrial: true,
        reason: "NETEASE_TRIAL_ONLY",
      }),
    });
    const guestVipMgr = new AriaRoomManager({
      localApiPort: upstreamAddr.port,
      localResolver: async (track) => {
        if (guestVipResolveBehavior === "hang") {
          return new Promise(() => undefined);
        }
        return {
          ok: true,
          directUrl:
            track.nonce === "trk_vip_403"
              ? `http://127.0.0.1:${upstreamAddr.port}/cdn/forbidden.flac`
              : `http://127.0.0.1:${upstreamAddr.port}/cdn/provider-vip.flac`,
          safeHeaders: {
            Referer: "https://music.163.com/",
            Cookie: "MUSIC_U=MUST_BE_STRIPPED",
          },
          mimeType: "audio/flac",
          bitrate: 1411,
          sampleRate: 44100,
          quality: "Lossless",
          currentLevel: "lossless",
        };
      },
    });
    const guestFreeMgr = new AriaRoomManager({
      localApiPort: upstreamAddr.port,
      localResolver: async () => ({
        ok: true,
        directUrl: `http://127.0.0.1:${upstreamAddr.port}/cdn/provider-vip.flac`,
        safeHeaders: { Referer: "https://music.163.com/" },
        mimeType: "audio/flac",
        bitrate: 320,
        sampleRate: 44100,
        quality: "320K",
      }),
    });

    let detachSse: (() => void) | null = null;
    let guestHttpServer: http.Server | null = null;
    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "host-free",
        nickname: "HostFree",
        networkMode: "cloudflare",
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
        capabilities: { netease: "free", qq: "none", bilibili: "free", youtube: "unreachable" },
        shareEnabled: true,
      });

      await guestVipMgr.joinRoom({
        peerId: "guest-vip",
        nickname: "GuestVIP",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
        capabilities: { netease: "vip", qq: "none", bilibili: "free", youtube: "unreachable" },
        shareEnabled: true,
      });
      await guestFreeMgr.joinRoom({
        peerId: "guest-free",
        nickname: "GuestFree",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
        capabilities: { netease: "free", qq: "none", bilibili: "free", youtube: "unreachable" },
        shareEnabled: true,
      });
      await new Promise((r) => setTimeout(r, 120));

      // 1. Host gets trial clip -> delegates to guest-vip -> gets direct_url with stripped Cookie header.
      const prepared = await hostMgr.hostPrepareAndUpdateState({
        track: {
          nonce: "trk_vip_1",
          id: "netease:1901371647",
          providerId: "1901371647",
          source: "netease",
          title: "VIP Lossless",
          artist: "Artist",
          album: "Album",
          duration: "04:00",
          quality: "Lossless",
        },
        playing: true,
        positionSec: 0,
      });
      expect(prepared.playback.track?.dispatch).toMatchObject({
        mode: "direct_url",
        providerPeerId: "guest-vip",
        safeHeaders: { Referer: "https://music.163.com/" },
      });
      expect(prepared.playback.track?.dispatch?.safeHeaders?.Cookie).toBeUndefined();

      // 2. Host calls prefetchNextTrack and pre-resolves next queue item via VIP guest.
      const prefetched = await hostMgr.prefetchNextTrack({
        nonce: "trk_vip_next",
        id: "netease:2002",
        providerId: "2002",
        source: "netease",
        title: "Next VIP Track",
        artist: "Artist",
        album: "Album",
        duration: "03:30",
        quality: "Lossless",
      });
      expect(prefetched?.dispatch?.mode).toBe("direct_url");
      expect(prefetched?.dispatch?.providerPeerId).toBe("guest-vip");

      // 3. When 1st VIP candidate stalls > 3s timeout, cascade falls through cleanly to next candidate.
      guestVipResolveBehavior = "hang";
      const cascadeSnap = await hostMgr.hostPrepareAndUpdateState({
        track: {
          nonce: "trk_vip_cascade",
          id: "netease:3003",
          providerId: "3003",
          source: "netease",
          title: "Cascade Track",
          artist: "Artist",
          album: "Album",
          duration: "03:00",
          quality: "Lossless",
        },
      });
      expect(cascadeSnap.playback.track?.dispatch?.mode).toBe("direct_url");
      expect(cascadeSnap.playback.track?.dispatch?.providerPeerId).toBe("guest-free");

      // 4. Guest hits 403 on direct_url -> sends proxy_fallback_request -> provider emits proxy_serve_request.
      guestVipResolveBehavior = "vip";
      const sseEvents: Array<{ event: string; data: unknown }> = [];
      const fakeSseRes = {
        writableEnded: false,
        writeHead: () => undefined,
        write: (chunk: string) => {
          const evMatch = /^event:\s*(.+)$/m.exec(chunk);
          const dataMatch = /^data:\s*(.+)$/m.exec(chunk);
          if (evMatch && dataMatch) {
            sseEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
          }
          return true;
        },
        setHeader: () => undefined,
        flushHeaders: () => undefined,
      } as unknown as import("express").Response;
      detachSse = hostMgr.attachSseClient(fakeSseRes);
      const fallbackTrack = {
        nonce: "trk_vip_403",
        id: "cloud:403",
        source: "cloud" as const,
        title: "403 Recover",
        artist: "Artist",
        album: "Album",
        duration: "02:30",
        quality: "Lossless" as const,
        streamUrl: "/api/mock/provider-vip",
        dispatch: {
          mode: "direct_url" as const,
          providerPeerId: "host-free",
          directUrl: `http://127.0.0.1:${upstreamAddr.port}/cdn/forbidden.flac`,
        },
      };
      // Host prepares audio bytes in byteCache while guest requests direct_url returning 403.
      await hostMgr.prepareHostTrackInternal(fallbackTrack);
      (guestFreeMgr as unknown as { playback: { track: typeof fallbackTrack } }).playback.track = fallbackTrack;

      guestHttpServer = http.createServer((req, res) => {
        void guestFreeMgr.serveGuestTrackStream(
          req as unknown as import("express").Request,
          res as unknown as import("express").Response,
          "trk_vip_403",
        );
      });
      await new Promise<void>((resolve) => guestHttpServer!.listen(0, "127.0.0.1", () => resolve()));
      const guestHttpAddr = guestHttpServer.address() as net.AddressInfo;

      const streamPromise = fetch(`http://127.0.0.1:${guestHttpAddr.port}/stream`);
      await new Promise((r) => setTimeout(r, 150));

      const serveReq = sseEvents.find((e) => e.event === "proxy_serve_request")?.data as
        | { targetPeerId: string; nonce: string }
        | undefined;
      expect(serveReq).toEqual({ targetPeerId: "guest-free", nonce: "trk_vip_403" });

      const slice = await hostMgr.readHostTrackSlice("trk_vip_403", 0, 65536);
      await guestFreeMgr.ingestGuestChunk({
        nonce: "trk_vip_403",
        offset: 0,
        chunk: slice.chunk,
        eof: true,
        totalBytes: slice.totalBytes,
        mimeType: slice.mimeType,
      });

      const guestStreamRes = await streamPromise;
      expect(guestStreamRes.status).toBe(200);
      expect(Buffer.from(await guestStreamRes.arrayBuffer()).equals(vipAudio)).toBe(true);
    } finally {
      detachSse?.();
      if (guestHttpServer) {
        await new Promise<void>((resolve) => guestHttpServer!.close(() => resolve()));
      }
      await hostMgr.leaveRoom();
      await guestVipMgr.leaveRoom();
      await guestFreeMgr.leaveRoom();
      await new Promise<void>((resolve) => mockCf.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    }
  });

  it("propagates host play_at to guest snapshot + SSE state and preserves anchor during prefetchNextTrack", async () => {
    const rooms = new Map<string, Map<string, ReturnType<typeof acceptWebSocketUpgrade>>>();
    const mockCf = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    mockCf.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("room") ?? "SYNC";
      const peer = url.searchParams.get("peer") ?? "unknown";
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room)!.set(peer, ws);
      ws.on("message", (raw: string) => {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        for (const [otherId, otherWs] of rooms.get(room) ?? []) {
          if (otherId !== peer && otherWs.isOpen) {
            if (msg.type === "hello") {
              otherWs.sendJson({ type: "peer_joined", member: msg.member });
            } else {
              otherWs.send(raw);
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => mockCf.listen(0, "127.0.0.1", () => resolve()));
    const cfAddr = mockCf.address() as net.AddressInfo;

    const hostMgr = new AriaRoomManager({
      localApiPort: 0,
      localResolver: async (track) => ({
        ok: true,
        directUrl: `https://cdn.example.com/${track.id}.flac`,
        mimeType: "audio/flac",
      }),
    });
    const guestMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestSseEvents: Array<{ event: string; data: unknown }> = [];
    const detachGuestSse = guestMgr.attachSseClient({
      writableEnded: false,
      writeHead: () => undefined,
      write: (chunk: string) => {
        const evMatch = /^event:\s*(.+)$/m.exec(chunk);
        const dataMatch = /^data:\s*(.+)$/m.exec(chunk);
        if (evMatch && dataMatch) {
          guestSseEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
        }
        return true;
      },
      setHeader: () => undefined,
      flushHeaders: () => undefined,
    } as unknown as import("express").Response);

    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "host-pause",
        nickname: "HostPaused",
        networkMode: "cloudflare",
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
        track: {
          nonce: "trk_sync_1",
          id: "netease:1001",
          source: "netease",
          title: "Paused Start",
          artist: "Artist",
          album: "Album",
          duration: "03:30",
          quality: "Lossless",
        },
        playing: false,
        positionSec: 0,
      });

      await guestMgr.joinRoom({
        peerId: "guest-sync",
        nickname: "GuestSync",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      await new Promise((r) => setTimeout(r, 120));

      expect(guestMgr.getSnapshot().playback.nonce).toBe("trk_sync_1");
      expect(guestMgr.getSnapshot().playback.playing).toBe(false);
      guestSseEvents.length = 0;

      const scheduledStartMs = Date.now() + 200;
      hostMgr.hostBroadcastPlaybackSync({
        kind: "play_at",
        nonce: "trk_sync_1",
        positionSec: 0,
        startAtHostMs: scheduledStartMs,
      });
      await new Promise((r) => setTimeout(r, 120));

      const updatedGuest = guestMgr.getSnapshot();
      expect(updatedGuest.playback.playing).toBe(true);
      expect(updatedGuest.playback.updatedAtMs).toBe(scheduledStartMs);
      expect(guestSseEvents.some((e) => e.event === "playback_sync")).toBe(true);
      const emittedState = guestSseEvents.filter((e) => e.event === "state").pop()?.data as
        | { playback?: { playing?: boolean; updatedAtMs?: number } }
        | undefined;
      expect(emittedState?.playback?.playing).toBe(true);
      expect(emittedState?.playback?.updatedAtMs).toBe(scheduledStartMs);

      const anchorBeforePrefetch = hostMgr.getSnapshot().playback.updatedAtMs;
      await new Promise((r) => setTimeout(r, 30));
      await hostMgr.prefetchNextTrack({
        nonce: "trk_sync_2",
        id: "netease:1002",
        source: "netease",
        title: "Next Track",
        artist: "Artist",
        album: "Album",
        duration: "03:45",
        quality: "Lossless",
      });
      expect(hostMgr.getSnapshot().playback.updatedAtMs).toBe(anchorBeforePrefetch);
    } finally {
      detachGuestSse();
      await hostMgr.leaveRoom();
      await guestMgr.leaveRoom();
      await new Promise<void>((resolve) => mockCf.close(() => resolve()));
    }
  });

  it("allows guest-owned local tracks in hybrid rooms without host disk errors and skips Cloudflare IPs for custom HTTP nodes", async () => {
    expect(isSelfHostedSignalingUrl("http://1.2.3.4:8787")).toBe(true);
    expect(isSelfHostedSignalingUrl("ws://127.0.0.1:8787")).toBe(true);
    expect(isSelfHostedSignalingUrl("https://localhost:8443")).toBe(true);
    expect(isSelfHostedSignalingUrl("https://signal.example.com")).toBe(false);

    const signalNode = createAriaSignalServer({ host: "127.0.0.1", port: 0 });
    const nodeAddr = await signalNode.listen();
    const customUrl = `http://127.0.0.1:${nodeAddr.port}`;

    const hostMgr = new AriaRoomManager({ localApiPort: 0 });
    try {
      await hostMgr.createRoom({
        peerId: "host-hybrid",
        nickname: "HostHybrid",
        networkMode: "hybrid",
        signalingUrl: customUrl,
        directPort: 0,
        track: null,
        queue: [],
      });

      const snap = await hostMgr.hostPrepareAndUpdateState({
        track: {
          nonce: "trk_guest_local",
          id: "local:missing-on-host",
          source: "local",
          title: "Guest Local Song",
          artist: "Indie",
          album: "Desk",
          duration: "03:10",
          quality: "FLAC",
          streamUrl: "/api/library/tracks/local%3Amissing-on-host/stream",
          addedByPeerId: "guest-owner-1",
          addedByName: "Guest",
        },
        nextTrack: null,
        queue: [],
        playing: true,
        positionSec: 0,
      });

      expect(snap.playback.track?.dispatch).toEqual({
        mode: "stream_proxy",
        providerPeerId: "guest-owner-1",
      });

      const probeResults = await hostMgr.probePreferredIps(customUrl);
      expect(probeResults).toHaveLength(1);
      expect(probeResults[0]).toMatchObject({
        ip: null,
        label: "自建节点直连",
        ok: true,
        statusCode: 200,
      });
    } finally {
      await hostMgr.leaveRoom();
      await signalNode.close();
    }
  });

  it("prioritizes publicHost & physical IPv4 over IPv6/WSL virtual NICs and parses IPv4:port cleanly", async () => {
    expect(parseDirectPublicHost("203.0.113.10:3639")).toEqual({ host: "203.0.113.10", port: 3639 });
    expect(parseDirectPublicHost("http://203.0.113.10:8787/")).toEqual({ host: "203.0.113.10", port: 8787 });
    expect(parseDirectPublicHost("[2408:8207::1]:4000")).toEqual({ host: "2408:8207::1", port: 4000 });
    expect(parseDirectPublicHost("2408:8207::1")).toEqual({ host: "2408:8207::1", port: null });
    expect(formatHostForUrl("203.0.113.10:3639")).toBe("203.0.113.10:3639");
    expect(formatHostForUrl("2408:8207::1")).toBe("[2408:8207::1]");

    const extracted = extractNetworkAddresses({
      "vEthernet (WSL)": [
        { address: "172.27.96.1", netmask: "255.255.240.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "172.27.96.1/20" },
      ],
      Meta: [
        { address: "198.18.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "198.18.0.1/16" },
      ],
      以太网: [
        { address: "192.168.10.22", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "192.168.10.22/24" },
        { address: "240e:3b4:1::5", netmask: "ffff:ffff::", family: "IPv6", mac: "00:00:00:00:00:00", internal: false, cidr: "240e:3b4:1::5/64" },
      ],
    });
    expect(extracted.lanAddresses).toEqual(["192.168.10.22", "172.27.96.1", "198.18.0.1"]);
    expect(extracted.ipv6Addresses).toEqual(["240e:3b4:1::5"]);

    const hostMgr = new AriaRoomManager({ localApiPort: 0 });
    try {
      const snap = await hostMgr.createRoom({
        peerId: "host-direct-v4",
        nickname: "DirectHost",
        networkMode: "direct",
        directPort: 0,
        track: null,
        queue: [],
      });

      // Default priority must NOT pick IPv6 ahead of IPv4 when lanAddresses[0] is available.
      if (snap.directServer.lanAddresses[0]) {
        expect(snap.directServer.ipv4ShareString).toContain(`host=${snap.directServer.lanAddresses[0]}`);
        expect(snap.directServer.shareString).toBe(snap.directServer.ipv4ShareString);
      }
      if (snap.directServer.ipv6Addresses[0]) {
        expect(snap.directServer.ipv6ShareString).toContain(encodeURIComponent(snap.directServer.ipv6Addresses[0]));
      }

      // Updating publicHost (including IPv4:port) while live in room updates directServer.shareString immediately.
      await hostMgr.updateConfig({ publicHost: "203.0.113.88:4444" });
      const liveSnap = hostMgr.getSnapshot();
      expect(liveSnap.directServer.resolvedPublicEndpoint).toEqual({ host: "203.0.113.88", port: 4444 });
      expect(liveSnap.directServer.publicShareString).toContain("host=203.0.113.88&port=4444");
      expect(liveSnap.directServer.shareString).toBe(liveSnap.directServer.publicShareString);
    } finally {
      await hostMgr.leaveRoom();
    }
  });

  it("keeps Cloudflare and self-hosted signaling URLs coexisting cleanly and switches providers", async () => {
    const signalNode = createAriaSignalServer({ host: "127.0.0.1", port: 0 });
    const nodeAddr = await signalNode.listen();
    const mgr = new AriaRoomManager({ localApiPort: 0 });
    try {
      const saved = await mgr.updateConfig({
        signalingProvider: "self-hosted",
        signalingUrl: "https://signal.example.com",
        selfHostedSignalingUrl: `127.0.0.1:${nodeAddr.port}`,
        preferredIps: ["104.16.132.229"],
      });

      expect(saved.signalingProvider).toBe("self-hosted");
      expect(saved.signalingUrl).toBe("https://signal.example.com");
      expect(saved.selfHostedSignalingUrl).toBe(`http://127.0.0.1:${nodeAddr.port}`);
      expect(saved.preferredIps).toEqual(["104.16.132.229"]);

      const probeSelf = await mgr.probePreferredIps(saved.selfHostedSignalingUrl, "self-hosted");
      expect(probeSelf[0]).toMatchObject({ label: "自建节点直连", ok: true, statusCode: 200 });

      await mgr.createRoom({
        peerId: "host-self-hosted",
        nickname: "SelfHost",
        networkMode: "cloudflare",
        track: null,
        queue: [],
      });
      expect(mgr.getSnapshot().signalingState).toBe("connected");
      await mgr.leaveRoom();

      const switched = await mgr.updateConfig({ signalingProvider: "cloudflare" });
      expect(switched.signalingProvider).toBe("cloudflare");
      expect(switched.signalingUrl).toBe("https://signal.example.com");
      expect(switched.selfHostedSignalingUrl).toBe(`http://127.0.0.1:${nodeAddr.port}`);
    } finally {
      await mgr.leaveRoom();
      await signalNode.close();
    }
  });

  it("relays Bilibili VIP Hi-Res streams with availableLevels and delivers remote resolve over Direct WS rooms", async () => {
    const hostMgr = new AriaRoomManager({
      localApiPort: 0,
      localResolver: async () => ({ ok: false, reason: "TRIAL_ONLY" }),
    });
    const guestVipMgr = new AriaRoomManager({
      localApiPort: 0,
      localResolver: async (track) => ({
        ok: true,
        mode: "direct_url",
        directUrl: `https://upos-sz.bilivideo.com/${track.providerId ?? "track"}-hires.m4a`,
        safeHeaders: {
          Referer: "https://www.bilibili.com/",
          "User-Agent": "Mozilla/5.0",
        },
        mimeType: "audio/mp4",
        bitrate: 1850,
        sampleRate: 48000,
        quality: "Hi-Res",
        currentLevel: "hires",
        availableLevels: ["standard", "exhigh", "lossless", "hires"],
      }),
    });

    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "bili-direct-host",
        nickname: "BiliFreeHost",
        networkMode: "direct",
        directPort: 0,
        capabilities: { netease: "none", qq: "none", bilibili: "free", youtube: "unreachable" },
        shareEnabled: true,
      });

      await guestVipMgr.joinRoom({
        peerId: "bili-direct-vip",
        nickname: "BiliVipGuest",
        mode: "direct",
        directHost: "127.0.0.1",
        directPort: hostSnap.directServer.port,
        directToken: hostSnap.directServer.roomToken,
        capabilities: { netease: "none", qq: "none", bilibili: "vip", youtube: "unreachable" },
        shareEnabled: true,
      });
      await new Promise((r) => setTimeout(r, 150));

      const prepared = await hostMgr.hostPrepareAndUpdateState({
        track: {
          nonce: "trk_bili_vip_1",
          id: "bilibili:BV1xx411c7mD",
          providerId: "BV1xx411c7mD",
          source: "bilibili",
          title: "Bili Hi-Res Test",
          artist: "UP",
          album: "Bilibili",
          duration: "04:00",
          quality: "320K",
        },
        playing: true,
        positionSec: 0,
      });

      expect(prepared.playback.track?.dispatch).toMatchObject({
        mode: "direct_url",
        providerPeerId: "bili-direct-vip",
        directUrl: "https://upos-sz.bilivideo.com/BV1xx411c7mD-hires.m4a",
      });
      expect(prepared.playback.track?.quality).toBe("Hi-Res");
      expect(prepared.playback.track?.currentLevel).toBe("hires");
      expect(prepared.playback.track?.availableLevels).toEqual([
        "standard",
        "exhigh",
        "lossless",
        "hires",
      ]);
    } finally {
      await hostMgr.leaveRoom();
      await guestVipMgr.leaveRoom();
    }
  });

  it("serves unreachable YouTube guest covers immediately via coverDataUrl with Access-Control-Allow-Origin: *", async () => {
    const thumbBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const guestMgr = new AriaRoomManager({ localApiPort: 0 });
    const internalMgr = guestMgr as unknown as {
      playback: { track: unknown; nextTrack: unknown; queue: unknown[] };
      myCapabilities: { netease: string; qq: string; bilibili: string; youtube: string };
    };
    internalMgr.myCapabilities = {
      netease: "none",
      qq: "none",
      bilibili: "none",
      youtube: "unreachable",
    };
    internalMgr.playback.track = {
      nonce: "trk_yt_cover_1",
      id: "youtube:dQw4w9WgXcQ",
      providerId: "dQw4w9WgXcQ",
      source: "youtube",
      title: "YT Cover",
      artist: "Creator",
      album: "YT",
      duration: "03:33",
      quality: "320K",
      coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      coverDataUrl: `data:image/jpeg;base64,${thumbBytes.toString("base64")}`,
    };

    const guestHttpServer = http.createServer((req, res) => {
      void guestMgr.serveGuestTrackCover(
        req as unknown as import("express").Request,
        res as unknown as import("express").Response,
        "trk_yt_cover_1",
      );
    });
    await new Promise<void>((resolve) => guestHttpServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = guestHttpServer.address() as net.AddressInfo;

    try {
      const startedAt = Date.now();
      const res = await fetch(`http://127.0.0.1:${addr.port}/cover`);
      const elapsedMs = Date.now() - startedAt;

      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(Buffer.from(await res.arrayBuffer()).equals(thumbBytes)).toBe(true);
      expect(elapsedMs).toBeLessThan(1_000);
    } finally {
      await new Promise<void>((resolve) => guestHttpServer.close(() => resolve()));
      await guestMgr.leaveRoom();
    }
  });

  it("synchronizes both host and guest to single-hop server timestamps embedded in WSS heartbeat pong without double-hop clock_ping", async () => {
    const serverShiftMs = 30_000;
    let doubleHopClockPings = 0;
    const rooms = new Map<string, Map<string, ReturnType<typeof acceptWebSocketUpgrade>>>();
    const mockCf = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    mockCf.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("room") ?? "HBCLOCK";
      const peer = url.searchParams.get("peer") ?? "unknown";
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room)!.set(peer, ws);
      ws.on("message", (raw: string) => {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "ping") {
          const t1 = Date.now() + serverShiftMs;
          const t0 = typeof msg.t0 === "number" ? msg.t0 : typeof msg.ts === "number" ? msg.ts : t1;
          const t2 = Date.now() + serverShiftMs;
          ws.sendJson({ type: "pong", ts: msg.ts ?? t1, t0, t1, t2, serverTs: t2 });
          return;
        }
        if (msg.type === "clock_ping") {
          doubleHopClockPings += 1;
        }
        for (const [otherId, otherWs] of rooms.get(room) ?? []) {
          if (otherId !== peer && otherWs.isOpen) {
            if (msg.type === "hello") {
              otherWs.sendJson({ type: "peer_joined", member: msg.member });
            } else {
              otherWs.send(raw);
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => mockCf.listen(0, "127.0.0.1", () => resolve()));
    const cfAddr = mockCf.address() as net.AddressInfo;

    const hostMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestSseEvents: Array<{ event: string; data: unknown }> = [];
    const detachGuestSse = guestMgr.attachSseClient({
      writableEnded: false,
      writeHead: () => undefined,
      write: (chunk: string) => {
        const evMatch = /^event:\s*(.+)$/m.exec(chunk);
        const dataMatch = /^data:\s*(.+)$/m.exec(chunk);
        if (evMatch && dataMatch) {
          guestSseEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
        }
        return true;
      },
      setHeader: () => undefined,
      flushHeaders: () => undefined,
    } as unknown as import("express").Response);

    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "hb-host",
        nickname: "HbHost",
        networkMode: "cloudflare",
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
        track: {
          nonce: "trk_hb_1",
          id: "netease:1001",
          source: "netease",
          title: "HB Sync",
          artist: "Artist",
          album: "Album",
          duration: "03:00",
          quality: "Lossless",
        },
        playing: true,
        positionSec: 0,
      });

      const localNowAfterHost = Date.now();
      expect(hostSnap.playback.updatedAtMs - localNowAfterHost).toBeGreaterThan(serverShiftMs - 2_000);
      expect(hostSnap.playback.updatedAtMs - localNowAfterHost).toBeLessThan(serverShiftMs + 2_000);

      const syncEv = hostMgr.hostBroadcastPlaybackSync({
        kind: "play_at",
        nonce: "trk_hb_1",
        positionSec: 1.5,
        startAtHostMs: Date.now() + 200,
      });
      expect(syncEv.serverTimeMs - Date.now()).toBeGreaterThan(serverShiftMs - 1_500);
      expect(syncEv.startAtHostMs - Date.now()).toBeGreaterThan(serverShiftMs - 1_200);

      await guestMgr.joinRoom({
        peerId: "hb-guest",
        nickname: "HbGuest",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      guestMgr.sendClockPing();
      await new Promise((r) => setTimeout(r, 120));

      const clockPongs = guestSseEvents.filter((e) => e.event === "clock_pong");
      expect(clockPongs.length).toBeGreaterThan(0);
      const latestPong = clockPongs.at(-1)!.data as { t0: number; t1: number; t2: number; t3: number };
      const measuredOffset = (latestPong.t1 - latestPong.t0 + (latestPong.t2 - latestPong.t3)) / 2;
      expect(Math.abs(measuredOffset - serverShiftMs)).toBeLessThan(500);
      expect(doubleHopClockPings).toBe(0);
    } finally {
      detachGuestSse();
      await hostMgr.leaveRoom();
      await guestMgr.leaveRoom();
      await new Promise<void>((resolve) => mockCf.close(() => resolve()));
    }
  });

  it("falls back to legacy double-hop clock_ping when signaling server returns bare pong without serverTs", async () => {
    let forwardedClockPings = 0;
    const rooms = new Map<string, Map<string, ReturnType<typeof acceptWebSocketUpgrade>>>();
    const mockCf = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    mockCf.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("room") ?? "LEGACY";
      const peer = url.searchParams.get("peer") ?? "unknown";
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room)!.set(peer, ws);
      ws.on("message", (raw: string) => {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "ping") {
          ws.sendJson({ type: "pong", ts: msg.ts ?? Date.now() });
          return;
        }
        if (msg.type === "clock_ping") {
          forwardedClockPings += 1;
        }
        for (const [otherId, otherWs] of rooms.get(room) ?? []) {
          if (otherId !== peer && otherWs.isOpen) {
            if (msg.type === "hello") {
              otherWs.sendJson({ type: "peer_joined", member: msg.member });
            } else {
              otherWs.send(raw);
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => mockCf.listen(0, "127.0.0.1", () => resolve()));
    const cfAddr = mockCf.address() as net.AddressInfo;

    const hostMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestMgr = new AriaRoomManager({ localApiPort: 0 });
    const guestSseEvents: Array<{ event: string; data: unknown }> = [];
    const detachGuestSse = guestMgr.attachSseClient({
      writableEnded: false,
      writeHead: () => undefined,
      write: (chunk: string) => {
        const evMatch = /^event:\s*(.+)$/m.exec(chunk);
        const dataMatch = /^data:\s*(.+)$/m.exec(chunk);
        if (evMatch && dataMatch) {
          guestSseEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
        }
        return true;
      },
      setHeader: () => undefined,
      flushHeaders: () => undefined,
    } as unknown as import("express").Response);

    try {
      const hostSnap = await hostMgr.createRoom({
        peerId: "legacy-host",
        nickname: "LegacyHost",
        networkMode: "cloudflare",
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      await guestMgr.joinRoom({
        peerId: "legacy-guest",
        nickname: "LegacyGuest",
        mode: "cloudflare",
        roomId: hostSnap.roomId!,
        signalingUrl: `ws://127.0.0.1:${cfAddr.port}`,
      });
      guestMgr.sendClockPing();
      await new Promise((r) => setTimeout(r, 150));

      const clockPongs = guestSseEvents.filter((e) => e.event === "clock_pong");
      expect(forwardedClockPings).toBeGreaterThanOrEqual(1);
      expect(clockPongs.length).toBeGreaterThanOrEqual(1);
    } finally {
      detachGuestSse();
      await hostMgr.leaveRoom();
      await guestMgr.leaveRoom();
      await new Promise<void>((resolve) => mockCf.close(() => resolve()));
    }
  });

  it("validates custom room codes, excludes offline & none-tier relay peers, and pre-caches directUrl tracks onto disk", async () => {
    const signalNode = createAriaSignalServer({ host: "127.0.0.1", port: 0, hostGraceMs: 2_000 });
    const nodeAddr = await signalNode.listen();
    const mgr = new AriaRoomManager({ localApiPort: 0 });
    const byteCache = new TrackByteCache(`test-${Date.now()}`);

    const sampleBytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    const cdnServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "audio/flac",
        "Content-Length": String(sampleBytes.byteLength),
      });
      res.end(sampleBytes);
    });
    await new Promise<void>((resolve) => cdnServer.listen(0, "127.0.0.1", () => resolve()));
    const cdnAddr = cdnServer.address() as net.AddressInfo;

    try {
      await expect(
        mgr.createRoom({
          peerId: "host-custom",
          nickname: "CustomHost",
          networkMode: "cloudflare",
          signalingUrl: `http://127.0.0.1:${nodeAddr.port}`,
          roomId: "invalid!code",
        }),
      ).rejects.toThrow(/自定义房间号/);

      const snap = await mgr.createRoom({
        peerId: "host-custom",
        nickname: "CustomHost",
        networkMode: "cloudflare",
        signalingUrl: `http://127.0.0.1:${nodeAddr.port}`,
        roomId: "aria_party-01",
      });
      expect(snap.roomId).toBe("ARIA_PARTY-01");

      const ranked = rankRelayCandidates(
        [
          {
            peerId: "vip-offline",
            nickname: "Off",
            avatarUrl: null,
            role: "guest",
            joinedAt: 1,
            connectedVia: "ws",
            online: false,
            presence: "offline",
            shareEnabled: true,
            capabilities: { netease: "vip", qq: "vip", bilibili: "vip", youtube: "reachable" },
          },
          {
            peerId: "no-qq",
            nickname: "None",
            avatarUrl: null,
            role: "guest",
            joinedAt: 2,
            connectedVia: "ws",
            online: true,
            presence: "active",
            shareEnabled: true,
            capabilities: { netease: "vip", qq: "none", bilibili: "vip", youtube: "reachable" },
          },
          {
            peerId: "qq-vip-live",
            nickname: "Live",
            avatarUrl: null,
            role: "guest",
            joinedAt: 3,
            connectedVia: "ws",
            online: true,
            presence: "active",
            shareEnabled: true,
            capabilities: { netease: "free", qq: "vip", bilibili: "free", youtube: "unreachable" },
          },
        ],
        "qq",
        "host-custom",
      );
      expect(ranked.map((m) => m.peerId)).toEqual(["qq-vip-live"]);

      const cacheTrack = {
        nonce: "direct_precache_1",
        id: "qq:direct1",
        source: "qq" as const,
        title: "Direct Track",
        artist: "Artist",
        album: "Album",
        duration: "03:00",
        quality: "FLAC" as const,
      };
      const directEntry = await byteCache.prepareDirectUrlTrack(
        cacheTrack,
        `http://127.0.0.1:${cdnAddr.port}/song.flac`,
      );
      const deadline = Date.now() + 2_000;
      while (!directEntry.completed && !directEntry.failedError && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(directEntry.completed).toBe(true);
      expect(directEntry.downloadedBytes).toBe(sampleBytes.byteLength);

      // Concurrent chunk ingestion stays serialized cleanly
      const chunkTrack = { ...cacheTrack, nonce: "chunk_serial_1" };
      await Promise.all([
        byteCache.appendGuestChunk({ track: chunkTrack, offset: 0, chunk: Buffer.from("ABCD"), eof: false, totalBytes: 8 }),
        byteCache.appendGuestChunk({ track: chunkTrack, offset: 4, chunk: Buffer.from("EFGH"), eof: true, totalBytes: 8 }),
      ]);
      const chunkEntry = byteCache.getEntry("chunk_serial_1");
      expect(chunkEntry?.completed).toBe(true);
      expect(chunkEntry?.downloadedBytes).toBe(8);
    } finally {
      await byteCache.clearAll();
      await mgr.leaveRoom();
      await new Promise<void>((resolve) => cdnServer.close(() => resolve()));
      await signalNode.close();
    }
  });
});
