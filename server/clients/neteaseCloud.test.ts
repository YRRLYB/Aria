import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloud: vi.fn(), detail: vi.fn(), songDetail: vi.fn(), url: vi.fn(),
  store: vi.fn(), account: vi.fn(), persistent: new Map<string, unknown>(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({ default: {
  user_cloud: mocks.cloud, user_cloud_detail: mocks.detail,
  song_detail: mocks.songDetail, song_url_v1: mocks.url,
} }));
vi.mock("../store", () => ({ readStore: mocks.store }));
vi.mock("../services/neteaseService", () => ({ getNeteaseAccountSummary: mocks.account }));
vi.mock("../utils/persistentCache", () => ({
  rememberPersistent: async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
    if (mocks.persistent.has(key)) return mocks.persistent.get(key);
    const value = await loader(); mocks.persistent.set(key, value); return value;
  },
  clearPersistent: vi.fn(), setPersistent: vi.fn(),
}));

import { NeteaseClient, normalizeCloudSong } from "./neteaseClient";
import { clearCache } from "../utils/memoryCache";

const upload = {
  songId: 901, songName: "云端原声", fileName: "云端原声.flac", artist: "上传歌手", album: "录音室",
  fileSize: "42000000", bitrate: 900, addTime: 1720000000000,
  simpleSong: { id: 123, name: "公开匹配", ar: [{ id: 2, name: "上传歌手" }], al: { id: 3, name: "录音室", picUrl: "https://p1.music.126.net/cover.jpg" }, dt: 180000, sq: { br: 900000, sr: 44100 } },
};

beforeEach(() => {
  vi.resetAllMocks(); clearCache(); mocks.persistent.clear();
  mocks.store.mockResolvedValue({ neteaseCookie: "test-cookie" });
  mocks.account.mockResolvedValue({ connected: true, userId: "7" });
});

describe("NetEase cloud library", () => {
  const client = new NeteaseClient();

  it("keeps the upload's ID and metadata when matched to a public song", () => {
    expect(normalizeCloudSong(upload)).toMatchObject({
      track: { id: "901", title: "云端原声", duration: 180, artist: "上传歌手", album: "录音室", bitrate: 900000, quality: "Lossless", streamUrl: "/api/providers/netease/tracks/901/stream" },
      fileName: "云端原声.flac", fileSize: 42000000, uploadedAt: 1720000000000,
    });
  });

  it("retains private file metadata without a catalogue record", () => {
    expect(normalizeCloudSong({ songId: 903, fileName: "私人录音.wav", artist: "我", album: "现场", fileSize: -1 })).toMatchObject({
      track: { id: "903", title: "私人录音", artist: "我", album: "现场" }, fileSize: null, uploadedAt: null,
    });
  });

  it("paginates, reports capacity and caches only within the current account", async () => {
    mocks.cloud.mockResolvedValue({ body: { code: 200, data: [upload], count: 102, hasMore: true, size: "5000000000", maxSize: "100000000000" } });
    expect(await client.getCloudTracks(100, 100)).toMatchObject({ count: 102, more: true, nextOffset: 101, size: 5000000000, maxSize: 100000000000, items: [{ track: { id: "901" } }] });
    await client.getCloudTracks(100, 100);
    expect(mocks.cloud).toHaveBeenCalledOnce();
    expect(mocks.cloud).toHaveBeenCalledWith(expect.objectContaining({ cookie: "test-cookie", limit: 100, offset: 100 }));
    mocks.account.mockResolvedValue({ userId: "8" });
    await client.getCloudTracks(100, 100);
    expect(mocks.cloud).toHaveBeenCalledTimes(2);
  });

  it("refreshes cached pages and stops on an empty upstream page", async () => {
    mocks.cloud.mockResolvedValueOnce({ body: { code: 200, data: [upload], count: 1, hasMore: false } });
    await client.getCloudTracks();
    mocks.cloud.mockResolvedValueOnce({ body: { code: 200, data: [], count: 0, hasMore: true } });
    expect(await client.getCloudTracks(100, 0, true)).toMatchObject({ items: [], count: 0, more: false, nextOffset: 0 });
    expect(mocks.cloud).toHaveBeenCalledTimes(2);
  });

  it("requires a linked account and preserves upstream login expiry", async () => {
    mocks.store.mockResolvedValueOnce({ neteaseCookie: null });
    await expect(client.getCloudTracks()).rejects.toMatchObject({ status: 401 });
    expect(mocks.cloud).not.toHaveBeenCalled();
    mocks.cloud.mockRejectedValue({ body: { code: 301, message: "登录过期" } });
    await expect(client.getCloudTracks()).rejects.toMatchObject({ status: 401, message: "登录过期" });
  });

  it("loads the requested upload detail and rejects removed or invalid IDs", async () => {
    mocks.detail.mockResolvedValue({ body: { code: 200, data: [upload] } });
    expect(await client.getCloudTrackDetail("901")).toMatchObject({ track: { id: "901" } });
    expect(mocks.detail).toHaveBeenCalledWith({ id: "901", cookie: "test-cookie" });
    await expect(client.getCloudTrackDetail("902")).rejects.toMatchObject({ status: 404 });
    await expect(client.getCloudTrackDetail("abc")).rejects.toMatchObject({ status: 400 });
  });

  it("plays a private upload even when song_detail has no public record", async () => {
    mocks.songDetail.mockResolvedValue({ body: { songs: [] } });
    mocks.detail.mockResolvedValue({ body: { code: 200, data: [upload] } });
    mocks.url.mockResolvedValue({ body: { code: 200, data: [{ url: "https://music.126.net/private.flac", br: 900000, sr: 44100, level: "lossless" }] } });
    expect(await client.getStreamMeta("901", "lossless")).toMatchObject({ url: "https://music.126.net/private.flac", quality: "Lossless", availableLevels: ["lossless"] });
    expect(mocks.url).toHaveBeenCalledWith({ id: "901", level: "lossless", cookie: "test-cookie" });
  });

  it("does not reuse a private stream URL across accounts", async () => {
    mocks.songDetail.mockResolvedValue({ body: { songs: [upload.simpleSong] } });
    mocks.url.mockResolvedValue({ body: { code: 200, data: [{ url: "https://music.126.net/account7.flac", level: "lossless" }] } });
    expect((await client.getStreamMeta("901", "lossless")).url).toContain("account7");
    mocks.account.mockResolvedValue({ userId: "8" });
    mocks.store.mockResolvedValue({ neteaseCookie: "account8-cookie" });
    mocks.url.mockResolvedValue({ body: { code: 200, data: [{ url: "https://music.126.net/account8.flac", level: "lossless" }] } });
    expect((await client.getStreamMeta("901", "lossless")).url).toContain("account8");
    expect(mocks.url).toHaveBeenCalledTimes(2);
    expect(mocks.url.mock.calls[1][0].cookie).toBe("account8-cookie");
  });

  it("retains a catalogue network failure instead of disguising it as a missing upload", async () => {
    mocks.songDetail.mockRejectedValue(new Error("provider network unavailable"));
    await expect(client.getStreamMeta("901", "lossless")).rejects.toThrow("provider network unavailable");
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
