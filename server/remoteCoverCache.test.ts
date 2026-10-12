import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRemoteCoverUrl, RemoteCoverCache } from "./remoteCoverCache";

const artwork = Buffer.from("test cover bytes");
const coverUrl = "https://p1.music.126.net/album.jpg";
const imageResponse = () => new Response(artwork, { headers: { "content-type": "image/jpeg" } });

describe("persistent remote image cache", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aria-image-cache-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves a cover after backend restart without reaching the CDN and keeps sizes separate", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => imageResponse());
    const first = await new RemoteCoverCache({ directory, fetcher }).read(coverUrl, "320y320");
    expect(await readFile(first.filePath!)).toEqual(artwork);
    const restarted = new RemoteCoverCache({ directory, fetcher });
    const second = await restarted.read(coverUrl, "320y320");
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const large = await restarted.read(coverUrl, "768y768");
    expect(large.filePath).not.toEqual(second.filePath);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain("param=320y320");
    expect(await readdir(directory)).not.toContainEqual(expect.stringMatching(/\.tmp$/));
  });

  it("accepts the image/jpg MIME returned by real NetEase covers and account avatars", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(artwork, {
      headers: { "content-type": "image/jpg" },
    }));
    const cache = new RemoteCoverCache({ directory, fetcher });
    const cover = await cache.read(coverUrl, "128y128");
    expect(cover.contentType).toBe("image/jpeg");
    expect(await readFile(cover.filePath!)).toEqual(artwork);
    const restarted = await new RemoteCoverCache({ directory, fetcher }).read(coverUrl, "128y128");
    expect(restarted).toEqual(cover);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("normalizes legacy MIME aliases in cached metadata and compatible CDN responses", async () => {
    const normalized = normalizeRemoteCoverUrl(coverUrl);
    const key = createHash("sha1").update(normalized).digest("hex");
    await writeFile(path.join(directory, `${key}.img`), artwork);
    await writeFile(path.join(directory, `${key}.json`), JSON.stringify({ contentType: "IMAGE/JPG; charset=binary" }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(artwork, {
      headers: { "content-type": "image/x-png" },
    }));
    const cache = new RemoteCoverCache({ directory, fetcher });
    expect((await cache.read(coverUrl)).contentType).toBe("image/jpeg");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await cache.read("https://p2.music.126.net/avatar.png")).contentType).toBe("image/png");
  });

  it("reuses covers written by previous versions and repairs missing or truncated blobs", async () => {
    const normalized = normalizeRemoteCoverUrl(coverUrl);
    const key = createHash("sha1").update(normalized).digest("hex");
    const filePath = path.join(directory, `${key}.img`);
    const metaPath = path.join(directory, `${key}.json`);
    await writeFile(filePath, artwork);
    await writeFile(metaPath, JSON.stringify({ contentType: "image/jpeg" }));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => imageResponse());
    const cache = new RemoteCoverCache({ directory, fetcher });
    expect((await cache.read(coverUrl)).filePath).toBe(filePath);
    expect(fetcher).not.toHaveBeenCalled();
    await unlink(filePath);
    await cache.read(coverUrl);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await writeFile(filePath, "truncated");
    await cache.read(coverUrl);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readFile(filePath)).toEqual(artwork);
  });

  it("deduplicates simultaneous requests and retries after a failed fetch", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network offline"))
      .mockImplementation(async () => imageResponse());
    const cache = new RemoteCoverCache({ directory, fetcher });
    const failed = await Promise.allSettled([cache.read(coverUrl), cache.read(coverUrl)]);
    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [first, second] = await Promise.all([cache.read(coverUrl), cache.read(coverUrl)]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects foreign hosts, credentials and unsafe redirects before fetching their destination", async () => {
    for (const url of [
      "https://notmusic.126.net/album.jpg", "https://music.126.net.example.org/album.jpg",
      "file://music.126.net/album.jpg", "https://user:password@p1.music.126.net/album.jpg",
      "https://p1.music.126.net:1234/album.jpg",
    ]) {
      expect(() => normalizeRemoteCoverUrl(url)).toThrow("Unsupported cover host");
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: "http://127.0.0.1/private" },
    }));
    await expect(new RemoteCoverCache({ directory, fetcher }).read(coverUrl)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(normalizeRemoteCoverUrl("https://p1.music.163.com/avatar.jpg", "9999x10")).toContain("param=1024y64");
  });

  it("follows CDN redirects with the same bounded request signal", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://p2.music.126.net/image.jpg" } }))
      .mockResolvedValueOnce(imageResponse());
    await new RemoteCoverCache({ directory, fetcher }).read(coverUrl);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[1][1]?.signal).toBe(fetcher.mock.calls[0][1]?.signal);
  });

  it("never caches HTML errors or responses beyond the advertised or streamed byte limit", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("error page", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(artwork, { headers: { "content-type": "image/jpeg", "content-length": "1000" } }))
      .mockResolvedValueOnce(imageResponse());
    const cache = new RemoteCoverCache({ directory, fetcher, maxAssetBytes: 8 });
    await expect(cache.read(coverUrl)).rejects.toMatchObject({ code: "NETEASE_COVER_UPSTREAM_FAILED" });
    await expect(cache.read(coverUrl)).rejects.toMatchObject({ code: "NETEASE_COVER_TOO_LARGE" });
    await expect(cache.read(coverUrl)).rejects.toMatchObject({ code: "NETEASE_COVER_TOO_LARGE" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("still displays an image if persistent storage is unavailable", async () => {
    const blockedDirectory = path.join(directory, "not-a-directory");
    await writeFile(blockedDirectory, "occupied");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => imageResponse());
    const cover = await new RemoteCoverCache({ directory: blockedDirectory, fetcher }).read(coverUrl);
    expect(cover.body).toEqual(artwork);
    expect(cover.filePath).toBeUndefined();
  });

  it("prunes the oldest blobs and their metadata to keep the cache bounded", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => imageResponse());
    const cache = new RemoteCoverCache({ directory, fetcher, maxFiles: 2, maxCacheBytes: artwork.length * 2 });
    const oldest = await cache.read(coverUrl);
    await utimes(oldest.filePath!, new Date(0), new Date(0));
    await cache.read("https://p1.music.126.net/second.jpg");
    await cache.read("https://p1.music.126.net/third.jpg");
    await cache.prune();
    const files = await readdir(directory);
    expect(files.filter((file) => file.endsWith(".img"))).toHaveLength(2);
    expect(files.filter((file) => file.endsWith(".json"))).toHaveLength(2);
    expect(files).not.toContain(path.basename(oldest.filePath!));
  });
});
