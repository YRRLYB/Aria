import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBilibiliLyrics,
  parseBilibiliDuration,
  parseBilibiliTrackId,
  resetBilibiliStateForTests,
  resolveBilibiliStreamMeta,
  resolveBilibiliVideoMeta,
  searchBilibiliTracks,
} from "./client";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

const viewData = {
  bvid: "BV1xx411c7mD",
  cid: 114514,
  title: "测试视频",
  pic: "//i1.hdslb.com/bfs/archive/cover.jpg",
  duration: 267,
  owner: { name: "测试UP" },
  typename: "MV",
};

describe("Bilibili client", () => {
  beforeEach(() => {
    resetBilibiliStateForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses durations and track ids", () => {
    expect(parseBilibiliDuration("04:27")).toBe(267);
    expect(parseBilibiliDuration("1:02:03")).toBe(3723);
    expect(parseBilibiliDuration(125)).toBe(125);
    expect(parseBilibiliTrackId("BV1xx411c7mD")).toEqual({ bvid: "BV1xx411c7mD", cid: undefined });
    expect(parseBilibiliTrackId("BV1xx411c7mD:123")).toEqual({ bvid: "BV1xx411c7mD", cid: "123" });
    expect(() => parseBilibiliTrackId("not-a-bvid")).toThrow(/视频 ID/);
  });

  it("maps search rows and strips Bilibili title markup", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/; HttpOnly" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          result: [
            {
              type: "video",
              bvid: "BV1xx411c7mD",
              title: "【4K】<em class=\"keyword\">ninelie</em> 现场",
              author: "测试UP",
              pic: "//i1.hdslb.com/bfs/archive/cover.jpg",
              duration: "04:27",
              typename: "MV",
            },
            { type: "video", bvid: "bad", title: "ignored" },
          ],
        },
      }));

    const tracks = await searchBilibiliTracks("ninelie", 24, 0);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "BV1xx411c7mD",
      title: "【4K】ninelie 现场",
      artist: "测试UP",
      album: "B站 · MV",
      duration: 267,
      source: "bilibili",
      streamUrl: "/api/sources/bilibili/tracks/BV1xx411c7mD/stream",
      videoUrl: "/api/sources/bilibili/tracks/BV1xx411c7mD/video",
      coverUrl: "https://i1.hdslb.com/bfs/archive/cover.jpg",
      hasVideo: true,
    });
    expect(fetchMock.mock.calls[1][0]).toContain("search/type");
  });

  it("resolves DASH audio and a muxed video stream", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: viewData }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80, 64, 32, 16],
          accept_description: ["高清 1080P", "高清 720P", "清晰 480P", "流畅 360P"],
          dash: {
            audio: [
              { id: 30216, baseUrl: "https://cdn.test/audio-64.m4s", bandwidth: 64_000, codecs: "mp4a.40.2" },
              { id: 30280, baseUrl: "https://cdn.test/audio-192.m4s", bandwidth: 320_000, codecs: "mp4a.40.2" },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          quality: 16,
          accept_quality: [80, 16],
          accept_description: ["高清 1080P", "流畅 360P"],
          durl: [{ url: "https://cdn.test/video-360.mp4", size: 1000 }],
        },
      }));

    const audio = await resolveBilibiliStreamMeta("BV1xx411c7mD", { level: "hires" });
    expect(audio).toMatchObject({
      url: "https://cdn.test/audio-192.m4s",
      mimeType: "audio/mp4",
      currentLevel: "exhigh",
      bitrate: 320_000,
      availableLevels: ["exhigh", "standard"],
    });
    expect(audio.headers?.Referer).toBe("https://www.bilibili.com/");

    const video = await resolveBilibiliVideoMeta("BV1xx411c7mD", { level: "hires" });
    expect(video).toMatchObject({
      url: "https://cdn.test/video-360.mp4",
      mimeType: "video/mp4",
      quality: "流畅 360P",
    });
  });

  it("maps Bilibili CC subtitles to lyric lines", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: viewData }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              { lan: "ai-zh", subtitle_url: "//aisubtitle.hdslb.com/subtitle.json" },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        body: [
          { from: 1.25, content: "第一句" },
          { from: 3.5, content: "第二句" },
        ],
      }));

    const lyrics = await getBilibiliLyrics("BV1xx411c7mD");
    expect(lyrics).toEqual([
      { time: "00:01", startTime: 1.25, text: "第一句", timingVersion: 1 },
      { time: "00:03", startTime: 3.5, text: "第二句", timingVersion: 1 },
    ]);
  });
});
