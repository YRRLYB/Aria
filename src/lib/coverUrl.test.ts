import { expect, it } from "vitest";
import { artworkImageCandidates, cachedArtworkUrl, directArtworkUrl, sizedCoverUrl } from "./coverUrl";

it("requests bounded local covers while preserving existing query parameters", () => {
  expect(sizedCoverUrl("http://localhost/api/library/tracks/one/cover?v=2&size=768", 320))
    .toBe("http://localhost/api/library/tracks/one/cover?v=2&size=320");
  expect(sizedCoverUrl("data:image/png;base64,aaa", 320)).toBe("data:image/png;base64,aaa");
  expect(sizedCoverUrl(undefined, 320)).toBeUndefined();
});

it("routes remote covers and avatars through the persistent cache without double-proxying", () => {
  for (const source of [
    "https://p1.music.126.net/cover.jpg?param=100y100",
    "http://p3.music.163.com/avatar.jpg",
  ]) {
    const cached = cachedArtworkUrl(source, 128)!;
    const url = new URL(cached, "http://localhost");
    expect(url.pathname).toBe("/api/providers/netease/cover");
    expect(url.searchParams.get("url")).toBe(source);
    expect(url.searchParams.get("size")).toBe("128y128");
    expect(cachedArtworkUrl(cached, 128)).toBe(cached);
  }
});

it("replaces thumbnail size while preserving the proxy source and authentication", () => {
  const source = "http://localhost/api/providers/netease/cover?url=https%3A%2F%2Fp1.music.126.net%2Fcover.jpg&token=test-token&size=300y300";
  const url = new URL(cachedArtworkUrl(source, 512)!);
  expect(url.searchParams.get("token")).toBe("test-token");
  expect(url.searchParams.getAll("size")).toEqual(["512y512"]);
  expect(url.searchParams.get("url")).toBe("https://p1.music.126.net/cover.jpg");
});

it("leaves local, custom and unrelated images intact", () => {
  for (const source of [
    "data:image/png;base64,aaa",
    "blob:http://localhost/artwork",
    "/api/library/tracks/one/cover?v=2",
    "https://example.com/cover.jpg",
    "https://notmusic.126.net/cover.jpg",
  ]) expect(cachedArtworkUrl(source)).toBe(source);
  expect(cachedArtworkUrl(undefined)).toBeUndefined();
  expect(cachedArtworkUrl(null)).toBeUndefined();
});

it("recovers a cached avatar or cover using its original HTTPS URL after proxy failure", () => {
  const original = "http://p3.music.126.net/avatar.jpg?param=100y100";
  const proxy = cachedArtworkUrl(original, 128)!;
  expect(artworkImageCandidates(proxy, undefined, 128)).toEqual([
    proxy,
    "https://p3.music.126.net/avatar.jpg?param=100y100",
  ]);
  expect(artworkImageCandidates(original, undefined, 128)).toEqual([
    proxy,
    "https://p3.music.126.net/avatar.jpg?param=100y100",
  ]);
  expect(directArtworkUrl(proxy)).toBe("https://p3.music.126.net/avatar.jpg?param=100y100");
});

it("retains a CDN fallback when player artwork has been decoded to a temporary blob", () => {
  const original = "https://p1.music.126.net/cover.jpg";
  expect(artworkImageCandidates("blob:http://localhost/artwork", original, 512)).toEqual([
    "blob:http://localhost/artwork",
    cachedArtworkUrl(original, 512),
    original,
  ]);
  expect(artworkImageCandidates("data:image/png;base64,aaa")).toEqual(["data:image/png;base64,aaa"]);
  expect(artworkImageCandidates(undefined)).toEqual([]);
});

it("does not bypass host validation when an invalid image proxy URL fails", () => {
  for (const original of [
    "https://evil.example/cover.jpg", "http://127.0.0.1/private",
    "https://music.126.net.example.org/cover.jpg", "https://user:secret@p1.music.126.net/cover.jpg",
  ]) {
    expect(directArtworkUrl(`/api/providers/netease/cover?url=${encodeURIComponent(original)}`)).toBeUndefined();
  }
  expect(directArtworkUrl("/api/providers/netease/cover")).toBeUndefined();
});
