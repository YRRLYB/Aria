import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import type net from "node:net";
import path from "node:path";
import express from "express";
import { afterAll, describe, expect, it, vi } from "vitest";

const { tempDataDir } = vi.hoisted(() => ({
  tempDataDir: `${process.env.TEMP || process.env.TMP || "."}/aria-priv-cloud-090-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../utils/paths", () => ({
  dataDir: tempDataDir,
  cacheDir: `${tempDataDir}/cache`,
}));

import signalWorker from "../../cloudflare/aria-signal-worker/src/index";
import { RemoteCoverCache } from "../remoteCoverCache";
import { SourceError } from "../sources/contract";
import { getWebdavIndexDb } from "../sources/webdav/db";
import { HttpError } from "../utils/httpError";
import { resetSecretBoxCache } from "../utils/secretBox";
import { createBackupRouter } from "./backup";
import { createPrivateCloudRouter } from "./privateCloud";
import { createSourcesRouter } from "./sources";

afterAll(async () => {
  getWebdavIndexDb().close();
  resetSecretBoxCache();
  await rm(tempDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("Aria v0.9.0 Private Cloud (OpenSubsonic + WebDAV), Backup Roaming & TURN End-to-End", () => {
  it("runs full lifecycle: AES-256-GCM credential isolation, OpenSubsonic auth/search/lyrics/stream/scrobble, WebDAV PROPFIND + Range scan + 302 auth-strip stream, and WebDAV backup push/pull", async () => {
    const fakeAudioBytes = Buffer.alloc(4096, 0x42);
    const scrobbledSongs: Array<{ id: string; submission: string }> = [];
    const backupFiles = new Map<string, string>();
    let storageSawLeakedAuth = false;

    // 1. Mock S3/CDN storage target that rejects requests if Authorization header is leaked across 302 redirect.
    const cdnStorageServer = http.createServer((req, res) => {
      if (req.headers.authorization) {
        storageSawLeakedAuth = true;
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Leaked Authorization header on redirected CDN request");
        return;
      }
      if (req.url?.startsWith("/signed-audio.flac")) {
        const range = req.headers.range;
        if (range && /^bytes=0-(\d+)$/.test(range)) {
          const slice = fakeAudioBytes.subarray(0, 1024);
          res.writeHead(206, {
            "Content-Type": "audio/flac",
            "Content-Range": `bytes 0-${slice.byteLength - 1}/${fakeAudioBytes.byteLength}`,
            "Content-Length": String(slice.byteLength),
            "Accept-Ranges": "bytes",
          });
          res.end(slice);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "audio/flac",
          "Content-Length": String(fakeAudioBytes.byteLength),
          "Accept-Ranges": "bytes",
        });
        res.end(fakeAudioBytes);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => cdnStorageServer.listen(0, "127.0.0.1", () => resolve()));
    const cdnAddr = cdnStorageServer.address() as net.AddressInfo;

    // 2. Mock OpenSubsonic + WebDAV (Alist 302 style) upstream server.
    const upstreamServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || "/", "http://127.0.0.1");

      // --- OpenSubsonic endpoints ---
      if (reqUrl.pathname.startsWith("/rest/")) {
        const u = reqUrl.searchParams.get("u") || "";
        const t = reqUrl.searchParams.get("t") || "";
        const s = reqUrl.searchParams.get("s") || "";
        const expectedToken = crypto.createHash("md5").update(`sub-secret-pass${s}`, "utf8").digest("hex");
        if (u !== "navidrome" || t !== expectedToken) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "failed",
                version: "1.16.1",
                error: { code: 40, message: "Wrong username or password" },
              },
            }),
          );
          return;
        }

        const endpoint = reqUrl.pathname.slice("/rest/".length);
        if (endpoint === "ping.view") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "ok",
                version: "1.16.1",
                openSubsonic: true,
                serverVersion: "0.53.0",
              },
            }),
          );
          return;
        }

        const demoSong = {
          id: "song-sub-1",
          title: " Private Cloud Serenade ",
          artist: "Aria Ensemble",
          album: "Homelab Sessions",
          duration: 215,
          bitRate: 1411,
          samplingRate: 96000,
          bitDepth: 24,
          suffix: "flac",
          coverArt: "cov-sub-1",
        };

        if (endpoint === "getAlbumList2.view") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "ok",
                version: "1.16.1",
                albumList2: {
                  album: [{ id: "alb-1", name: "Homelab Sessions", artist: "Aria Ensemble", songCount: 1 }],
                },
              },
            }),
          );
          return;
        }

        if (endpoint === "getAlbum.view") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "ok",
                version: "1.16.1",
                album: {
                  id: "alb-1",
                  name: "Homelab Sessions",
                  artist: "Aria Ensemble",
                  song: [demoSong],
                },
              },
            }),
          );
          return;
        }

        if (endpoint === "search3.view") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "ok",
                version: "1.16.1",
                searchResult3: {
                  song: [demoSong],
                  album: [],
                  artist: [],
                },
              },
            }),
          );
          return;
        }

        if (endpoint === "getLyricsBySongId.view") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              "subsonic-response": {
                status: "ok",
                version: "1.16.1",
                lyricsList: {
                  structuredLyrics: [
                    {
                      synced: true,
                      line: [
                        { start: 0, value: "First line from OpenSubsonic" },
                        { start: 5000, value: "Second line in lossless" },
                      ],
                    },
                  ],
                },
              },
            }),
          );
          return;
        }

        if (endpoint === "stream.view") {
          expect(reqUrl.searchParams.get("format")).toBe("raw");
          res.writeHead(200, {
            "Content-Type": "audio/flac",
            "Content-Length": String(fakeAudioBytes.byteLength),
          });
          res.end(fakeAudioBytes);
          return;
        }

        if (endpoint === "scrobble.view") {
          scrobbledSongs.push({
            id: reqUrl.searchParams.get("id") || "",
            submission: reqUrl.searchParams.get("submission") || "",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ "subsonic-response": { status: "ok", version: "1.16.1" } }));
          return;
        }
      }

      // --- WebDAV endpoints ---
      if (reqUrl.pathname.startsWith("/dav")) {
        const expectedBasic = `Basic ${Buffer.from("davuser:dav-secret-pass", "utf8").toString("base64")}`;
        if (req.headers.authorization !== expectedBasic) {
          res.writeHead(401);
          res.end("Unauthorized WebDAV");
          return;
        }

        if (req.method === "PROPFIND") {
          res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
          res.end(`<?xml version="1.0" encoding="utf-8"?>
            <D:multistatus xmlns:D="DAV:">
              <D:response>
                <D:href>/dav/Music/</D:href>
                <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
              </D:response>
              <D:response>
                <D:href>/dav/Music/Yoasobi%20-%20Idol.flac</D:href>
                <D:propstat><D:prop>
                  <D:resourcetype/>
                  <D:getcontentlength>${fakeAudioBytes.byteLength}</D:getcontentlength>
                  <D:getetag>"etag-idol-v1"</D:getetag>
                  <D:getlastmodified>Sat, 28 Nov 2026 12:00:00 GMT</D:getlastmodified>
                </D:prop></D:propstat>
              </D:response>
              <D:response>
                <D:href>/dav/Music/Yoasobi%20-%20Idol.lrc</D:href>
                <D:propstat><D:prop>
                  <D:resourcetype/>
                  <D:getcontentlength>64</D:getcontentlength>
                </D:prop></D:propstat>
              </D:response>
              <D:response>
                <D:href>/dav/Music/cover.jpg</D:href>
                <D:propstat><D:prop>
                  <D:resourcetype/>
                  <D:getcontentlength>128</D:getcontentlength>
                </D:prop></D:propstat>
              </D:response>
            </D:multistatus>`);
          return;
        }

        if (req.method === "GET" && reqUrl.pathname === "/dav/Music/Yoasobi%20-%20Idol.flac") {
          // Simulate Alist 302 redirect to external signed CDN URL
          res.writeHead(302, {
            Location: `http://127.0.0.1:${cdnAddr.port}/signed-audio.flac?sig=alist123`,
          });
          res.end();
          return;
        }

        if (req.method === "GET" && reqUrl.pathname === "/dav/Music/Yoasobi%20-%20Idol.lrc") {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("[00:01.00]WebDAV sidecar lyric line 1\n[00:04.50]WebDAV sidecar lyric line 2\n");
          return;
        }

        if (req.method === "MKCOL") {
          res.writeHead(201);
          res.end();
          return;
        }

        if (req.method === "PUT" && reqUrl.pathname.endsWith(".aria-backup.json")) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          backupFiles.set(reqUrl.pathname, Buffer.concat(chunks).toString("utf8"));
          res.writeHead(201);
          res.end();
          return;
        }

        if (req.method === "GET" && reqUrl.pathname.endsWith(".aria-backup.json")) {
          const body = backupFiles.get(reqUrl.pathname);
          if (!body) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(body);
          return;
        }
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
    const upstreamAddr = upstreamServer.address() as net.AddressInfo;
    const upstreamBase = `http://127.0.0.1:${upstreamAddr.port}`;

    // 3. Spin up Express app mounting Private Cloud, Backup, and Sources routers.
    const app = express();
    app.use(express.json());
    const coverCache = new RemoteCoverCache(path.join(tempDataDir, "covers"));
    app.use("/api/private-cloud", createPrivateCloudRouter());
    app.use("/api/backup", createBackupRouter());
    app.use("/api/sources", createSourcesRouter(coverCache));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof SourceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    });

    const apiServer = http.createServer(app);
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", () => resolve()));
    const apiAddr = apiServer.address() as net.AddressInfo;
    const apiBase = `http://127.0.0.1:${apiAddr.port}`;

    try {
      // 0. Dry-run test-connection before saving, including automatic /app/#/album URL cleanup
      const draftRes = await fetch(`${apiBase}/api/private-cloud/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "subsonic",
          baseUrl: `${upstreamBase}/app/#/album`,
          username: "navidrome",
          password: "sub-secret-pass",
        }),
      });
      expect(draftRes.status).toBe(200);
      expect(await draftRes.json()).toMatchObject({
        ok: true,
        openSubsonic: true,
        normalizedUrl: upstreamBase,
      });

      // A. Create OpenSubsonic & WebDAV instances
      const createSubRes = await fetch(`${apiBase}/api/private-cloud/instances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "subsonic",
          name: "Home Navidrome",
          baseUrl: upstreamBase,
          username: "navidrome",
          password: "sub-secret-pass",
          mobileTranscodeBitrate: 192,
        }),
      });
      expect(createSubRes.status).toBe(200);
      const subJson = (await createSubRes.json()) as {
        instance: { id: string; hasPassword: boolean; password?: string; encryptedPassword?: string };
      };
      const subId = subJson.instance.id;
      expect(subJson.instance.hasPassword).toBe(true);
      expect(subJson.instance.password).toBeUndefined();
      expect(subJson.instance.encryptedPassword).toBeUndefined();

      const createDavRes = await fetch(`${apiBase}/api/private-cloud/instances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "webdav",
          name: "Alist NAS",
          baseUrl: `${upstreamBase}/dav`,
          username: "davuser",
          password: "dav-secret-pass",
          rootPath: "/Music",
        }),
      });
      expect(createDavRes.status).toBe(200);
      const davJson = (await createDavRes.json()) as {
        instance: { id: string; hasPassword: boolean; password?: string; encryptedPassword?: string };
      };
      const davId = davJson.instance.id;
      expect(davJson.instance.hasPassword).toBe(true);
      expect(davJson.instance.password).toBeUndefined();
      expect(davJson.instance.encryptedPassword).toBeUndefined();

      // Verify on-disk private-cloud.json stores AES-256-GCM ciphertext, never plaintext passwords
      const rawDiskJson = await readFile(path.join(tempDataDir, "private-cloud.json"), "utf8");
      expect(rawDiskJson).not.toContain("sub-secret-pass");
      expect(rawDiskJson).not.toContain("dav-secret-pass");
      expect(rawDiskJson).toContain("enc:v1:");

      // B. Health check & test connection routes
      const subTestRes = await fetch(`${apiBase}/api/private-cloud/instances/${subId}/test`, { method: "POST" });
      expect(subTestRes.status).toBe(200);
      expect(await subTestRes.json()).toMatchObject({ ok: true, openSubsonic: true });

      const davTestRes = await fetch(`${apiBase}/api/private-cloud/instances/${davId}/test`, { method: "POST" });
      expect(davTestRes.status).toBe(200);
      expect(await davTestRes.json()).toMatchObject({ ok: true });

      const subHealthRes = await fetch(`${apiBase}/api/sources/subsonic/health`);
      expect(subHealthRes.status).toBe(200);
      expect(await subHealthRes.json()).toMatchObject({ ok: true, sourceId: "subsonic" });

      const davHealthRes = await fetch(`${apiBase}/api/sources/webdav/health`);
      expect(davHealthRes.status).toBe(200);
      expect(await davHealthRes.json()).toMatchObject({ ok: true, sourceId: "webdav" });

      // C. Incremental WebDAV scan into node:sqlite
      const scan1Res = await fetch(`${apiBase}/api/private-cloud/instances/${davId}/scan`, { method: "POST" });
      expect(scan1Res.status).toBe(200);
      const scan1Json = (await scan1Res.json()) as {
        progress: { discovered: number; scanned: number; skipped: number; errors: number };
      };
      expect(scan1Json.progress).toMatchObject({
        discovered: 1,
        scanned: 1,
        skipped: 0,
        errors: 0,
      });

      // Second scan must skip unchanged etag/size without re-probing
      const scan2Res = await fetch(`${apiBase}/api/private-cloud/instances/${davId}/scan`, { method: "POST" });
      expect(scan2Res.status).toBe(200);
      const scan2Json = (await scan2Res.json()) as {
        progress: { discovered: number; scanned: number; skipped: number; errors: number };
      };
      expect(scan2Json.progress).toMatchObject({
        discovered: 1,
        scanned: 0,
        skipped: 1,
        errors: 0,
      });

      // D. List aggregated Private Cloud tracks (Subsonic + WebDAV)
      const listTracksRes = await fetch(`${apiBase}/api/private-cloud/tracks`);
      expect(listTracksRes.status).toBe(200);
      const listTracksJson = (await listTracksRes.json()) as {
        tracks: Array<{ id: string; title: string; artist: string; source: string; quality: string }>;
      };
      expect(listTracksJson.tracks.length).toBe(2);
      const subTrack = listTracksJson.tracks.find((t) => t.source === "subsonic")!;
      const davTrack = listTracksJson.tracks.find((t) => t.source === "webdav")!;
      expect(subTrack).toMatchObject({
        id: `${subId}:song-sub-1`,
        title: "Private Cloud Serenade",
        quality: "Hi-Res",
      });
      expect(davTrack).toMatchObject({
        title: "Idol",
        artist: "Yoasobi",
        quality: "FLAC",
      });

      // E. Search via unified /api/sources/:sourceId/search
      const subSearchRes = await fetch(`${apiBase}/api/sources/subsonic/search?q=Serenade&mode=tracks`);
      expect(subSearchRes.status).toBe(200);
      const subSearchJson = (await subSearchRes.json()) as { tracks: Array<{ id: string }> };
      expect(subSearchJson.tracks[0]?.id).toBe(`${subId}:song-sub-1`);

      const davSearchRes = await fetch(`${apiBase}/api/sources/webdav/search?q=Yoasobi&mode=tracks`);
      expect(davSearchRes.status).toBe(200);
      const davSearchJson = (await davSearchRes.json()) as { tracks: Array<{ id: string; title: string }> };
      expect(davSearchJson.tracks[0]?.title).toBe("Idol");

      // F. Lyrics via unified /api/sources/:sourceId/tracks/:trackId/lyrics
      const subLyricsRes = await fetch(
        `${apiBase}/api/sources/subsonic/tracks/${encodeURIComponent(subTrack.id)}/lyrics`,
      );
      expect(subLyricsRes.status).toBe(200);
      const subLyricsJson = (await subLyricsRes.json()) as { lyrics: Array<{ text: string }> };
      expect(subLyricsJson.lyrics[0]?.text).toBe("First line from OpenSubsonic");

      const davLyricsRes = await fetch(
        `${apiBase}/api/sources/webdav/tracks/${encodeURIComponent(davTrack.id)}/lyrics`,
      );
      expect(davLyricsRes.status).toBe(200);
      const davLyricsJson = (await davLyricsRes.json()) as { lyrics: Array<{ text: string }> };
      expect(davLyricsJson.lyrics[0]?.text).toBe("WebDAV sidecar lyric line 1");

      // G. Audio streaming via unified /api/sources/:sourceId/tracks/:trackId/stream (verifying 302 auth strip)
      const subStreamRes = await fetch(
        `${apiBase}/api/sources/subsonic/tracks/${encodeURIComponent(subTrack.id)}/stream`,
      );
      expect(subStreamRes.status).toBe(200);
      const subStreamBuf = Buffer.from(await subStreamRes.arrayBuffer());
      expect(subStreamBuf.byteLength).toBe(fakeAudioBytes.byteLength);

      const davStreamRes = await fetch(
        `${apiBase}/api/sources/webdav/tracks/${encodeURIComponent(davTrack.id)}/stream`,
      );
      expect(davStreamRes.status).toBe(200);
      const davStreamBuf = Buffer.from(await davStreamRes.arrayBuffer());
      expect(davStreamBuf.equals(fakeAudioBytes)).toBe(true);
      expect(storageSawLeakedAuth).toBe(false);

      // H. OpenSubsonic Scrobble reporting
      const scrobbleRes = await fetch(
        `${apiBase}/api/private-cloud/subsonic/${encodeURIComponent(subId)}/scrobble/song-sub-1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission: true }),
        },
      );
      expect(scrobbleRes.status).toBe(200);
      expect(scrobbledSongs).toEqual([{ id: "song-sub-1", submission: "true" }]);

      // I. WebDAV Backup Roaming push & pull + path traversal guard
      const sampleSnapshot = {
        version: 1,
        exportedAt: "2026-11-28T13:00:00.000Z",
        appVersion: "0.9.0",
        modules: {
          preferences: { theme: "dark", hifiEnabled: true },
        },
      };
      const pushRes = await fetch(`${apiBase}/api/backup/webdav/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: davId,
          remotePath: "/Aria/.aria-backup.json",
          snapshot: sampleSnapshot,
        }),
      });
      expect(pushRes.status).toBe(200);

      const pullRes = await fetch(`${apiBase}/api/backup/webdav/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: davId,
          remotePath: "/Aria/.aria-backup.json",
        }),
      });
      expect(pullRes.status).toBe(200);
      const pullJson = (await pullRes.json()) as { ok: boolean; snapshot: typeof sampleSnapshot };
      expect(pullJson.ok).toBe(true);
      expect(pullJson.snapshot).toEqual(sampleSnapshot);

      const traversalRes = await fetch(`${apiBase}/api/backup/webdav/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: davId,
          remotePath: "/../secret.json",
          snapshot: sampleSnapshot,
        }),
      });
      expect(traversalRes.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
      await new Promise<void>((resolve) => cdnStorageServer.close(() => resolve()));
    }
  });

  it("validates Cloudflare Worker /turn-credentials room code and degrades cleanly when TURN secrets are unset", async () => {
    const dummyRooms = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => new Response("ok") }),
    };

    // 1. Invalid room code -> 400
    const badRoomRes = await signalWorker.fetch(
      new Request("https://signal.example.com/turn-credentials?room=!!"),
      { ROOMS: dummyRooms },
    );
    expect(badRoomRes.status).toBe(400);

    // 2. Unconfigured TURN secrets -> 200 { available: false, iceServers: [] }
    const fallbackRes = await signalWorker.fetch(
      new Request("https://signal.example.com/turn-credentials?room=ARIA09"),
      { ROOMS: dummyRooms },
    );
    expect(fallbackRes.status).toBe(200);
    expect(await fallbackRes.json()).toEqual({ available: false, iceServers: [] });
  });
});
