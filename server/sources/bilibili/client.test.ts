import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkBilibiliQrLogin,
  getBilibiliAccount,
  getBilibiliLikedTracks,
  getBilibiliLyrics,
  parseBilibiliDuration,
  parseBilibiliTrackId,
  resetBilibiliStateForTests,
  resolveBilibiliLink,
  resolveBilibiliStreamMeta,
  resolveBilibiliVideoMeta,
  searchBilibiliTracks,
  setBilibiliLike,
  startBilibiliQrLogin,
} from "./client";

const storeMocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("../../store", () => ({
  readStore: storeMocks.readStore,
  updateStore: storeMocks.updateStore,
}));

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
    storeMocks.readStore.mockReset();
    storeMocks.updateStore.mockReset();
    storeMocks.readStore.mockResolvedValue({ bilibiliCookie: null });
    storeMocks.updateStore.mockResolvedValue({});
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
      qualityId: 16,
      availableQualities: [
        { id: 80, label: "高清 1080P" },
        { id: 16, label: "流畅 360P" },
      ],
    });
  });

  it("exposes Bilibili FLAC and Dolby tracks for Big Members", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: viewData }))
      .mockImplementation(async () => jsonResponse({
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80, 64, 32, 16],
          accept_description: ["高清 1080P", "高清 720P", "清晰 480P", "流畅 360P"],
          dash: {
            audio: [
              { id: 30216, baseUrl: "https://cdn.test/audio-64.m4s", bandwidth: 64_000 },
              { id: 30280, baseUrl: "https://cdn.test/audio-192.m4s", bandwidth: 320_000 },
            ],
            flac: {
              display: true,
              audio: {
                id: 30251,
                baseUrl: "https://cdn.test/audio-hires.flac",
                bandwidth: 900_000,
                codecs: "fLaC",
              },
            },
            dolby: {
              type: 1,
              audio: {
                id: 30250,
                baseUrl: "https://cdn.test/audio-dolby.mp4",
                bandwidth: 448_000,
              },
            },
          },
        },
      }));

    const hires = await resolveBilibiliStreamMeta("BV1xx411c7mD", { level: "hires" });
    expect(hires).toMatchObject({
      url: "https://cdn.test/audio-hires.flac",
      mimeType: "audio/flac",
      currentLevel: "hires",
      bitrate: 900_000,
    });
    expect(hires.availableLevels).toEqual(expect.arrayContaining(["lossless", "hires", "exhigh", "standard"]));

    const dolby = await resolveBilibiliStreamMeta("BV1xx411c7mD", { level: "lossless" });
    expect(dolby).toMatchObject({
      url: "https://cdn.test/audio-dolby.mp4",
      currentLevel: "lossless",
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
          wbi_img: {
            img_url: "https://i0.hdslb.com/bfs/wbi/abcdef.png",
            sub_url: "https://i0.hdslb.com/bfs/wbi/123456.png",
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              { lan: "zh-CN", subtitle_url: "//aisubtitle.hdslb.com/subtitle.json" },
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

  it("starts a QR session and reports the waiting state", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=abc",
          qrcode_key: "qr-key",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { code: 86101, message: "未扫码" },
      }));

    const started = await startBilibiliQrLogin();
    expect(started.key).toBe("qr-key");
    expect(started.qrImage.startsWith("data:image/png;base64,")).toBe(true);
    expect(started.expiresIn).toBe(180);

    const check = await checkBilibiliQrLogin(started.key);
    expect(check).toMatchObject({ code: 86101, status: "waiting", account: null });
  });

  it("stores the login cookie and account after QR confirmation", async () => {
    const pollHeaders = new Headers();
    pollHeaders.append("set-cookie", "SESSDATA=test-sess; Path=/; Domain=.bilibili.com");
    pollHeaders.append("set-cookie", "bili_jct=test-csrf; Path=/; Domain=.bilibili.com");
    pollHeaders.append("set-cookie", "DedeUserID=42; Path=/; Domain=.bilibili.com");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=abc",
          qrcode_key: "qr-key",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { code: 0, message: "登录成功" },
      }), { status: 200, headers: pollHeaders }))
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { isLogin: true, mid: 42, uname: "测试用户", face: "//i0.hdslb.com/face.jpg" },
      }));

    const started = await startBilibiliQrLogin();
    const check = await checkBilibiliQrLogin(started.key);
    expect(check).toMatchObject({
      code: 0,
      status: "success",
      account: {
        connected: true,
        nickname: "测试用户",
        userId: "42",
        avatarUrl: "https://i0.hdslb.com/face.jpg",
      },
    });
    expect(storeMocks.updateStore).toHaveBeenCalled();
    const stored = storeMocks.updateStore.mock.calls[0][0]({}) as { bilibiliCookie: string };
    expect(stored.bilibiliCookie).toContain("SESSDATA=test-sess");
    expect(stored.bilibiliCookie).toContain("bili_jct=test-csrf");
  });

  it("adds and removes a video in the Aria favourite folder", async () => {
    storeMocks.readStore.mockResolvedValue({
      bilibiliCookie: "SESSDATA=test-sess; bili_jct=test-csrf; DedeUserID=42",
    });
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { isLogin: true, mid: 42, uname: "测试用户", face: "//i0.hdslb.com/face.jpg" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { ...viewData, aid: 12345 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { list: [] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { id: 123, title: "Aria" },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));

    const result = await setBilibiliLike("BV1xx411c7mD", true);
    expect(result).toEqual({ ok: true, liked: true });
    const dealCall = fetchMock.mock.calls.find(([url]) => String(url).includes("fav/resource/deal"));
    expect(dealCall).toBeTruthy();
    const init = dealCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    const body = String(init?.body);
    expect(body).toContain("rid=12345");
    expect(body).toContain("add_media_ids=123");
    expect(body).toContain("csrf=test-csrf");
    expect(body).not.toContain("del_media_ids=123");
    const folderAddCall = fetchMock.mock.calls.find(([url]) => String(url).includes("fav/folder/add"));
    expect(folderAddCall).toBeTruthy();
    expect(String((folderAddCall?.[1] as RequestInit | undefined)?.body)).toContain("title=Aria");
  });

  it("maps the Aria favourite folder into liked tracks", async () => {
    storeMocks.readStore.mockResolvedValue({
      bilibiliCookie: "SESSDATA=test-sess; bili_jct=test-csrf; DedeUserID=42",
    });
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { isLogin: true, mid: 42, uname: "测试用户", face: "//i0.hdslb.com/face.jpg" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { list: [{ id: 123, title: "Aria", media_count: 2 }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          medias: [
            {
              type: 2,
              attr: 0,
              bvid: "BV1xx411c7mD",
              title: "收藏视频",
              cover: "//i0.hdslb.com/fav.jpg",
              duration: 100,
              fav_time: 1_700_000_000,
              upper: { name: "收藏UP" },
            },
            { type: 2, attr: 1, bvid: "BV1deleted" },
          ],
          has_more: false,
        },
      }))
      .mockImplementation(async () => jsonResponse({ code: 0, data: { medias: [], has_more: false } }));

    const account = await getBilibiliAccount();
    expect(account).toMatchObject({ connected: true, nickname: "测试用户", userId: "42" });

    const tracks = await getBilibiliLikedTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "BV1xx411c7mD",
      title: "收藏视频",
      artist: "收藏UP",
      album: "B站 · Aria",
      duration: 100,
      source: "bilibili",
      likedAt: 1_700_000_000_000,
      hasVideo: true,
      coverUrl: "https://i0.hdslb.com/fav.jpg",
    });
    const folderCall = fetchMock.mock.calls.find(([url]) => String(url).includes("fav/folder/created/list-all"));
    expect(String(folderCall?.[0])).toContain("up_mid=42");
    const resourceCall = fetchMock.mock.calls.find(([url]) => String(url).includes("fav/resource/list"));
    const headers = (resourceCall?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.Cookie).toContain("SESSDATA=test-sess");
  });

  it("resolves pasted Bilibili video and favourite-folder links", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: viewData }));
    const video = await resolveBilibiliLink("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(video).toMatchObject({
      kind: "video",
      title: "测试视频",
      tracks: [
        {
          id: "BV1xx411c7mD",
          artist: "测试UP",
          videoUrl: "/api/sources/bilibili/tracks/BV1xx411c7mD/video",
          hasVideo: true,
        },
      ],
    });

    resetBilibiliStateForTests();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 200,
        headers: { "set-cookie": "buvid3=test-buvid; Path=/" },
      }))
      .mockResolvedValue(jsonResponse({
        code: 0,
        data: {
          info: { title: "别人的收藏夹", media_count: 1 },
          medias: [{
            type: 2,
            attr: 0,
            bvid: "BV1xx411c7mD",
            title: "收藏视频",
            cover: "//i0.hdslb.com/fav.jpg",
            duration: 100,
            fav_time: 1_700_000_000,
            upper: { name: "收藏UP" },
          }],
          has_more: false,
        },
      }));
    const folder = await resolveBilibiliLink("https://space.bilibili.com/123/favlist?fid=456");
    expect(folder).toMatchObject({
      kind: "folder",
      title: "别人的收藏夹",
      tracks: [{ id: "BV1xx411c7mD", album: "B站 · 别人的收藏夹" }],
    });
  });
});
