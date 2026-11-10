import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { get as httpGet, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RemoteCoverCache, type RemoteCoverCache as RemoteCoverCacheType } from "../remoteCoverCache";
import { HttpError } from "../utils/httpError";
import type { LyricLine } from "../../src/lib/lyricTypes";
import type { MusicSource, SourceManifest } from "../sources/contract";
import { SourceError } from "../sources/contract";
import { createSourcesRouter } from "./sources";

const mocks = vi.hoisted(() => ({
  getSource: vi.fn(),
  listStates: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("../sources/registry", () => ({
  getSource: mocks.getSource,
  listSourceStates: mocks.listStates,
  setSourceEnabled: mocks.setEnabled,
}));

const sourceCapabilities = {
  searchModes: ["tracks", "artists", "playlists", "albums"] as const,
  playback: true,
  lyrics: true,
  wordLyrics: false,
  account: true,
  liked: true,
  playlistsRead: true,
  playlistsWrite: false,
  recommendations: true,
  artistDetail: true,
  albumDetail: true,
  qualitySelection: true,
  videoPlayback: false,
};

const qqManifest: SourceManifest = {
  id: "qq",
  name: "QQ音乐",
  shortName: "QQ",
  version: "1.0.0",
  artworkHosts: ["gtimg.cn"],
  capabilities: { ...sourceCapabilities, searchModes: [...sourceCapabilities.searchModes] },
};

const neteaseManifest: SourceManifest = {
  id: "netease",
  name: "网易云",
  shortName: "网易云",
  version: "1.0.0",
  artworkHosts: ["music.126.net"],
  capabilities: { ...sourceCapabilities, searchModes: [...sourceCapabilities.searchModes] },
};

const fakeTrack = {
  id: "0039MnYb0qxYhV",
  title: "晴天",
  artist: "周杰伦",
  album: "叶惠美",
  duration: 269,
  quality: "FLAC" as const,
  source: "qq",
  streamUrl: "/api/sources/qq/tracks/0039MnYb0qxYhV/stream",
  coverUrl: null,
};

const qqSource: MusicSource = {
  manifest: qqManifest,
  search: vi.fn(async () => ({ tracks: [fakeTrack], artists: [], playlists: [] })),
  resolveStreamMeta: vi.fn(async (_trackId, options) =>
    options.refresh
      ? { url: "https://upstream.test/audio-new", headers: { Referer: "https://y.qq.com/" }, bitrate: 320_000, currentLevel: "exhigh" }
      : {
          url: "https://upstream.test/audio-old",
          headers: { Referer: "https://y.qq.com/", Cookie: "secret=1" },
          bitrate: 1_000_000,
          currentLevel: "lossless",
          availableLevels: ["standard", "lossless"],
        },
  ),
  getLyrics: vi.fn(async () => [{ time: "00:01", startTime: 1, text: "你好", timingVersion: 1 } as LyricLine]),
  getAccount: vi.fn(async () => ({ connected: true, nickname: "听歌人", userId: "12345", avatarUrl: null })),
};

const neteaseSource: MusicSource = {
  manifest: neteaseManifest,
  search: vi.fn(async () => ({ tracks: [], artists: [], playlists: [] })),
  resolveStreamMeta: vi.fn(async () => ({ url: "https://upstream.test/netease", bitrate: null, currentLevel: null })),
};

const fetchMock = vi.fn<typeof fetch>();
let coverCache: RemoteCoverCacheType;
let directory: string;

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  directory = await mkdtemp(path.join(tmpdir(), "aria-sources-routes-"));
  coverCache = new RemoteCoverCache({
    directory: path.join(directory, "covers"),
    allowedHosts: ["gtimg.cn"],
    sizing: null,
    errorPrefix: "QQ_COVER",
    fetcher: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { headers: { "content-type": "image/jpeg" } }),
    ),
  });
  mocks.getSource.mockImplementation(async (id: string) => {
    if (id === "qq") return qqSource;
    if (id === "netease") return neteaseSource;
    throw new SourceError("UNAVAILABLE", `未知的播放源: ${id}`);
  });
  mocks.listStates.mockResolvedValue([
    { manifest: qqManifest, enabled: true, unavailableUntil: null },
    { manifest: neteaseManifest, enabled: true, unavailableUntil: null },
  ]);
  mocks.setEnabled.mockImplementation(async (id: string, enabled: boolean) => [
    { manifest: qqManifest, enabled: id === "qq" ? enabled : true, unavailableUntil: null },
    { manifest: neteaseManifest, enabled: id === "netease" ? enabled : true, unavailableUntil: null },
  ]);
});

afterEach(async () => {
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

type LocalResponse = { status: number | undefined; headers: IncomingHttpHeaders; body: Buffer };

/** Local requests bypass the stubbed global fetch on purpose. */
function request(url: string, headers: Record<string, string> = {}): Promise<LocalResponse> {
  return new Promise((resolve, reject) => {
    httpGet(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    }).on("error", reject);
  });
}

function post(url: string, payload: unknown): Promise<LocalResponse> {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: "POST", headers: { "content-type": "application/json", "content-length": String(body.length) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function jsonOf(response: LocalResponse): Record<string, unknown> {
  return JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;
}

async function listen() {
  const app = express();
  app.use(express.json());
  app.use("/api/sources", createSourcesRouter({ coverCaches: { qq: coverCache } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Bad request", issues: error.issues });
      return;
    }
    const http = error instanceof SourceError ? error.toHttpError() : error instanceof HttpError ? error : null;
    if (http) {
      res.status(http.status).json({ error: http.message, code: http.code });
      return;
    }
    res.status(500).json({ error: String(error) });
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const base = `http://127.0.0.1:${address.port}/api/sources`;
  return {
    base,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("unified source routes", () => {
  it("lists registered source manifests", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(base);
      expect(response.status).toBe(200);
      expect(jsonOf(response)).toEqual({
        sources: [
          { ...qqManifest, enabled: true, unavailableUntil: null },
          { ...neteaseManifest, enabled: true, unavailableUntil: null },
        ],
      });
    } finally {
      await close();
    }
  });

  it("toggles a source and returns the refreshed switches", async () => {
    const { base, close } = await listen();
    try {
      const response = await post(`${base}/netease/enabled`, { enabled: false });
      expect(response.status).toBe(200);
      expect(mocks.setEnabled).toHaveBeenCalledWith("netease", false);
      expect(jsonOf(response)).toMatchObject({
        ok: true,
        sources: [{ id: "qq", enabled: true }, { id: "netease", enabled: false }],
      });
    } finally {
      await close();
    }
  });

  it("rejects a toggle without a boolean flag", async () => {
    const { base, close } = await listen();
    try {
      const response = await post(`${base}/qq/enabled`, { enabled: "yes" });
      expect(response.status).toBe(400);
      expect(mocks.setEnabled).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("dispatches searches with normalized query parameters", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/qq/search?q=${encodeURIComponent("晴天")}&limit=5&offset=10&mode=playlists`);
      expect(response.status).toBe(200);
      expect(jsonOf(response)).toEqual({ sourceId: "qq", tracks: [fakeTrack], artists: [], playlists: [] });
      expect(qqSource.search).toHaveBeenCalledWith(
        { query: "晴天", mode: "playlists", limit: 5, offset: 10 },
      );
    } finally {
      await close();
    }
  });

  it("maps unknown sources to 404 without touching any client", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/spotify/search?q=x`);
      expect(response.status).toBe(404);
      expect(jsonOf(response)).toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    } finally {
      await close();
    }
  });

  it("exposes stream metadata without upstream headers", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/qq/tracks/t1/stream-meta?level=lossless`);
      const body = jsonOf(response);
      expect(response.status).toBe(200);
      expect(body.url).toBe("https://upstream.test/audio-old");
      expect(body.currentLevel).toBe("lossless");
      expect(body.headers).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("rejects unknown quality levels", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/qq/tracks/t1/stream-meta?level=flac`);
      expect(response.status).toBe(400);
      expect(jsonOf(response)).toMatchObject({ code: "SOURCE_UNSUPPORTED" });
    } finally {
      await close();
    }
  });

  it("proxies audio with Range passthrough and re-resolves once after upstream expiry", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        new Response("audio-bytes", {
          status: 206,
          headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-10/100", "accept-ranges": "bytes" },
        }),
      );
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/qq/tracks/t1/stream?level=lossless`, { Range: "bytes=0-1023" });
      expect(response.status).toBe(206);
      expect(response.headers["content-range"]).toBe("bytes 0-10/100");
      expect(response.headers["x-aria-bitrate"]).toBe("320000");
      expect(response.headers["x-aria-level"]).toBe("exhigh");
      expect(response.body.toString("utf8")).toBe("audio-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstCall = fetchMock.mock.calls[0];
      const secondCall = fetchMock.mock.calls[1];
      expect(firstCall[0]).toBe("https://upstream.test/audio-old");
      expect(secondCall[0]).toBe("https://upstream.test/audio-new");
      expect((secondCall[1] as RequestInit).headers).toMatchObject({
        Referer: "https://y.qq.com/",
        Range: "bytes=0-1023",
      });
      // The refreshed resolution bypassed the cache.
      expect(qqSource.resolveStreamMeta).toHaveBeenLastCalledWith("t1", { level: "lossless", refresh: true });
    } finally {
      await close();
    }
  });

  it("serves lyrics when supported and errors when not", async () => {
    const { base, close } = await listen();
    try {
      const supported = await request(`${base}/qq/tracks/t1/lyrics`);
      expect(supported.status).toBe(200);
      expect(jsonOf(supported)).toEqual({ lyrics: [{ time: "00:01", startTime: 1, text: "你好", timingVersion: 1 }] });

      const unsupported = await request(`${base}/netease/tracks/t1/lyrics`);
      expect(unsupported.status).toBe(400);
      expect(jsonOf(unsupported)).toMatchObject({ code: "SOURCE_UNSUPPORTED" });
    } finally {
      await close();
    }
  });

  it("returns account state through the unified route", async () => {
    const { base, close } = await listen();
    try {
      const response = await request(`${base}/qq/account`);
      expect(response.status).toBe(200);
      expect(jsonOf(response)).toEqual({
        account: { connected: true, nickname: "听歌人", userId: "12345", avatarUrl: null },
      });
    } finally {
      await close();
    }
  });

  it("restricts the cover proxy to the manifest hosts and returns 404 for unregistered sources", async () => {
    const { base, close } = await listen();
    try {
      const foreign = await request(`${base}/qq/cover?url=${encodeURIComponent("https://evil.example/x.jpg")}`);
      expect(foreign.status).toBe(400);
      expect(jsonOf(foreign)).toMatchObject({ code: "QQ_COVER_HOST_UNSUPPORTED" });

      const unregistered = await request(`${base}/netease/cover?url=${encodeURIComponent("https://y.gtimg.cn/x.jpg")}`);
      expect(unregistered.status).toBe(404);
      expect(jsonOf(unregistered)).toMatchObject({ code: "SOURCE_UNAVAILABLE" });

      const ok = await request(`${base}/qq/cover?url=${encodeURIComponent("https://y.gtimg.cn/cover.jpg")}&size=320y320`);
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toBe("image/jpeg");
    } finally {
      await close();
    }
  });
});
