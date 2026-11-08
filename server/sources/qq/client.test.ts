import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("../../store", () => ({
  readStore: mocks.readStore,
  updateStore: mocks.updateStore,
}));

import {
  availableQqLevels,
  clearQqCookie,
  getQqAccount,
  getQqAlbum,
  getQqArtistAlbums,
  getQqDailyRecommendTracks,
  getQqArtistDetail,
  getQqArtistTracks,
  getQqLikedTracks,
  getQqLyrics,
  getQqPlaylistTracks,
  getQqPlaylists,
  getQqRoamTracks,
  normalizeQqSong,
  parseQqCookie,
  resetQqStreamStateForTests,
  resolveQqStreamMeta,
  saveQqCookie,
  searchQqAlbums,
  searchQqArtists,
  searchQqPlaylists,
  searchQqTracks,
  setQqLike,
} from "./client";
import { encodeAg1Response } from "./signing";

const searchSong = {
  mid: "0039MnYb0qxYhV",
  name: "晴天",
  interval: 269,
  singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }],
  album: { mid: "002eFUFm2XYZ7z", title: "叶惠美" },
  pay: { pay_play: 1 },
  file: {
    media_mid: "MIDFILE001",
    size_128mp3: 4_200_000,
    size_320mp3: 10_800_000,
    size_flac: 32_000_000,
    size_hires: "",
  },
};

const freeSong = {
  mid: "001xQmoR2e6asc",
  name: "莉莉安",
  interval: 254,
  singer: [{ mid: "002lGKlY0PZd0V", name: "徐佳莹" }],
  album: { mid: "003iV1vP3yLdDk", title: "我是歌手第四季" },
  pay: { pay_play: 0 },
  file: {
    media_mid: "MIDFILE001",
    size_128mp3: 4_200_000,
    size_320mp3: 0,
    size_flac: 0,
    size_hires: "",
  },
};

function musicuResponse(requestKey: string, data: unknown) {
  return new Response(JSON.stringify({ [requestKey]: { code: 0, data } }), {
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // 档位/付费标记/账号能力是模块级状态,每个用例从干净状态开始。
  resetQqStreamStateForTests();
  mocks.readStore.mockResolvedValue({ qqCookie: null });
  mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) =>
    update({ qqCookie: null }),
  );
});

afterEach(() => {
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("qq cookie parsing", () => {
  it("extracts uin and key from both legacy and modern cookie names", () => {
    expect(parseQqCookie("uin=o12345; qqmusic_key=Q_H_L_key1; other=x")).toEqual({ uin: "12345", key: "Q_H_L_key1", loginType: 1 });
    expect(parseQqCookie("qm_keyst=keyst2; uin=67890;")).toEqual({ uin: "67890", key: "keyst2", loginType: 1 });
  });

  it("rejects cookies without the required fields", () => {
    expect(parseQqCookie("uin=o12345")).toBeNull();
    expect(parseQqCookie("qqmusic_key=key")).toBeNull();
    expect(parseQqCookie("")).toBeNull();
  });
});

describe("qq search mapping", () => {
  it("maps search results into provider tracks with unified stream paths", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    const tracks = await searchQqTracks("晴天", 24, 0);
    expect(tracks).toHaveLength(1);
    const track = tracks[0];
    expect(track).toMatchObject({
      id: "0039MnYb0qxYhV",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      duration: 269,
      source: "qq",
      streamUrl: "/api/sources/qq/tracks/0039MnYb0qxYhV/stream",
      coverUrl: "https://y.gtimg.cn/music/photo_new/T002R300x300M000002eFUFm2XYZ7z.jpg",
      currentLevel: "lossless",
      availableLevels: ["standard", "exhigh", "lossless"],
      quality: "FLAC",
    });
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toContain("musicu.fcg");
    expect((request[1] as RequestInit).headers).toMatchObject({ Referer: "https://y.qq.com/" });
  });

  it("derives available levels from file sizes only", () => {
    expect(availableQqLevels(searchSong.file)).toEqual(["standard", "exhigh", "lossless"]);
    expect(availableQqLevels({ media_mid: "x", size_hires: 1 })).toEqual(["hires"]);
    expect(availableQqLevels(undefined)).toEqual([]);
  });

  it("keeps track mapping stable without file metadata", () => {
    const track = normalizeQqSong({ mid: "x1", name: "歌", singer: [{ name: "A" }, { name: "B" }] });
    expect(track).toMatchObject({ id: "x1", quality: "320K", currentLevel: null, availableLevels: [], vip: false });
  });

  it("only flags VIP when pay_play says the whole song needs membership", () => {
    // 缺失 pay 不是 VIP；pay_down/pay_month 只影响下载或高音质，也不能标 VIP。
    expect(normalizeQqSong({ mid: "free", name: "免费", pay: { pay_play: 0 } }).vip).toBe(false);
    expect(normalizeQqSong({ mid: "vip", name: "会员", pay: { pay_play: 1 } }).vip).toBe(true);
    expect(normalizeQqSong({ mid: "unknown", name: "未知" }).vip).toBe(false);
  });

  it("estimates a display bitrate from the per-tier file size", () => {
    const lossless = normalizeQqSong(searchSong);
    // 32,000,000 bytes * 8 / 269s ~= 952k
    expect(lossless).toMatchObject({ currentLevel: "lossless", quality: "FLAC", bitrate: 952_000 });

    const standard = normalizeQqSong(freeSong);
    // 4,200,000 bytes * 8 / 254s ~= 132k
    expect(standard).toMatchObject({ currentLevel: "standard", quality: "128K", bitrate: 132_000 });
  });
});

describe("qq multi-mode search and detail", () => {
  it("maps artist, album and playlist search results with qq source markers", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("music.search.SearchCgiService", {
      body: {
        singer: {
          list: [{ singerMID: "0025NhlN2yWrP4", singerName: "周杰伦", singerPic: "https://y.gtimg.cn/artist.jpg", songNum: 1234, albumNum: 40 }],
        },
      },
    }));
    await expect(searchQqArtists("周杰伦", 10, 0)).resolves.toMatchObject([{
      id: "0025NhlN2yWrP4",
      name: "周杰伦",
      source: "qq",
      avatarUrl: "https://y.gtimg.cn/artist.jpg",
      trackCount: 1234,
      albumCount: 40,
    }]);

    fetchMock.mockResolvedValueOnce(musicuResponse("music.search.SearchCgiService", {
      body: {
        album: {
          list: [{
            albumMID: "000MkMni1zB4iZ",
            albumName: "叶惠美",
            singerName: "周杰伦",
            singerMID: "0025NhlN2yWrP4",
            publicTime: "2003-07-31",
            song_count: 11,
          }],
        },
      },
    }));
    await expect(searchQqAlbums("叶惠美", 10, 0)).resolves.toMatchObject([{
      id: "000MkMni1zB4iZ",
      name: "叶惠美",
      source: "qq",
      artist: "周杰伦",
      artistId: "0025NhlN2yWrP4",
      trackCount: 11,
    }]);

    fetchMock.mockResolvedValueOnce(musicuResponse("music.search.SearchCgiService", {
      body: {
        songlist: {
          list: [{
            dissid: "7695177222",
            dissname: "华语精选",
            song_count: 244,
            imgurl: "http://qpic.y.qq.com/cover.jpg",
            introduction: "简介",
            creator: { name: "莹火虫" },
          }],
        },
      },
    }));
    await expect(searchQqPlaylists("华语", 10, 0)).resolves.toMatchObject([{
      id: "7695177222",
      name: "华语精选",
      source: "qq",
      trackCount: 244,
      coverUrl: "https://qpic.y.qq.com/cover.jpg",
      creatorName: "莹火虫",
    }]);
  });

  it("loads artist detail, songs and albums from the QQ endpoints", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("req_0", {
      singer_info: { mid: "0025NhlN2yWrP4", name: "周杰伦" },
      singer_brief: "华语流行歌手",
      total_song: 1234,
      total_album: 40,
    }));
    await expect(getQqArtistDetail("0025NhlN2yWrP4")).resolves.toMatchObject({
      artist: { id: "0025NhlN2yWrP4", name: "周杰伦", source: "qq", trackCount: 1234, albumCount: 40 },
      description: "华语流行歌手",
      sections: [{ title: "艺人简介", text: "华语流行歌手" }],
    });

    fetchMock.mockResolvedValueOnce(musicuResponse("req_0", {
      totalNum: 1,
      songList: [{ songInfo: searchSong }],
    }));
    await expect(getQqArtistTracks("0025NhlN2yWrP4", 20, 0)).resolves.toMatchObject({
      tracks: [{ id: "0039MnYb0qxYhV", title: "晴天", source: "qq" }],
      more: false,
    });

    fetchMock.mockResolvedValueOnce(musicuResponse("req_0", {
      total: 1,
      albumList: [{
        albumMid: "000MkMni1zB4iZ",
        albumName: "叶惠美",
        singerName: "周杰伦",
        publishDate: "2003-07-31",
        totalNum: 11,
      }],
    }));
    await expect(getQqArtistAlbums("0025NhlN2yWrP4", 20, 0)).resolves.toMatchObject({
      albums: [{ id: "000MkMni1zB4iZ", name: "叶惠美", source: "qq", trackCount: 11 }],
      more: false,
    });
  });

  it("loads album detail and tracks", async () => {
    fetchMock
      .mockResolvedValueOnce(musicuResponse("req_0", {
        basicInfo: { albumMid: "000MkMni1zB4iZ", albumName: "叶惠美", publishDate: "2003-07-31", desc: "专辑介绍" },
        singer: { singerList: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }] },
      }))
      .mockResolvedValueOnce(musicuResponse("req_0", {
        totalNum: 1,
        songList: [{ songInfo: searchSong }],
      }));
    await expect(getQqAlbum("000MkMni1zB4iZ")).resolves.toMatchObject({
      album: { id: "000MkMni1zB4iZ", name: "叶惠美", source: "qq", artist: "周杰伦", description: "专辑介绍", trackCount: 1 },
      tracks: [{ id: "0039MnYb0qxYhV", source: "qq" }],
    });
  });

  it("follows the subtype 510 daily playlist before falling back to toplists", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(musicuResponse("req_0", {
        v_shelf: [{ v_card: [{ subtype: 510, id: "88990011" }] }],
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        cdlist: [{ dissname: "每日30首", songnum: 1, songlist: [searchSong] }],
      })));
    await expect(getQqDailyRecommendTracks()).resolves.toMatchObject([{
      id: "0039MnYb0qxYhV",
      title: "晴天",
      source: "qq",
    }]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("disstid=88990011");
  });

  it("uses the official radar feed for roam when it returns songs", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("req_0", {
      VecSongs: [{ Track: searchSong }],
      HasMore: false,
    }));
    await expect(getQqRoamTracks(5, [])).resolves.toMatchObject([{
      id: "0039MnYb0qxYhV",
      title: "晴天",
      source: "qq",
    }]);
  });
});

describe("qq stream resolution", () => {
  it("never mixes paid-tier filenames into a free song's request and degrades to 128k", async () => {
    // Populate the file-info cache (free song) through a search first.
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [freeSong] } } }));
    await searchQqTracks("莉莉安", 1, 0);

    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M500MIDFILE001.mp3", purl: "128segment", filesize: 4_200_000 }],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const meta = await resolveQqStreamMeta("001xQmoR2e6asc", { level: "lossless", refresh: true });
    // 免费歌即使请求无损也只发免费候选,拿到的就是 128k 明文。
    expect(meta.currentLevel).toBe("standard");
    expect(meta.quality).toBe("128K");
    expect(meta.url).toBe("http://ws.stream.qqmusic.qq.com/128segment");
    expect(meta.headers).toMatchObject({ Referer: "https://y.qq.com/" });
    expect(meta.expiresAt).toBeGreaterThan(Date.now());
    const vkeyCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse((vkeyCall[1] as RequestInit).body as string) as {
      vkey: { param: { filename: string[] } };
    };
    // 关键断言:请求里绝不允许出现付费档位文件名——混入会让免费账号整个请求被拒。
    expect(body.vkey.param.filename).toEqual([
      "M500MIDFILE001.mp3",
      "C400MIDFILE001.m4a",
    ]);
  });

  it("probes paid tiers separately for VIP songs and remembers the account capability", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);

    // 第一发:免费候选(对 VIP 歌必然空);第二发:付费探测命中 FLAC。
    fetchMock
      .mockResolvedValueOnce(
        musicuResponse("vkey", {
          midurlinfo: [
            { filename: "M500MIDFILE001.mp3", purl: "" },
            { filename: "C400MIDFILE001.m4a", purl: "" },
          ],
          sip: [],
        }),
      )
      .mockResolvedValueOnce(
        musicuResponse("vkey", {
          midurlinfo: [{ filename: "F000MIDFILE001.flac", purl: "flacsegment", filesize: 32_000_000 }],
          sip: ["http://ws.stream.qqmusic.qq.com/"],
        }),
      );
    const meta = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless", refresh: true });
    expect(meta.currentLevel).toBe("lossless");
    expect(meta.quality).toBe("FLAC");
    expect(meta.url).toContain("flacsegment");

    // 能力记住后,下一次 VIP 歌直接命中 20 分钟 purl 缓存,不再打接口。
    fetchMock.mockClear();
    const again = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless" });
    expect(again.url).toContain("flacsegment");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks the account incapable after a confirmed VIP song returns no paid url", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);

    // 免费候选空 + 付费探测也空 → 账号无 VIP,后续 VIP 歌不再打接口。
    fetchMock
      .mockResolvedValueOnce(musicuResponse("vkey", { midurlinfo: [], sip: [] }))
      .mockResolvedValueOnce(musicuResponse("vkey", { midurlinfo: [], sip: [] }));
    await expect(resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless", refresh: true })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });

    fetchMock.mockClear();
    await expect(resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless", refresh: true })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a lower paid tier when the requested one has no url for a capable account", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);

    fetchMock
      .mockResolvedValueOnce(musicuResponse("vkey", { midurlinfo: [], sip: [] }))
      .mockResolvedValueOnce(
        musicuResponse("vkey", {
          midurlinfo: [
            { filename: "F000MIDFILE001.flac", purl: "" },
            { filename: "M800MIDFILE001.mp3", purl: "320segment" },
          ],
          sip: ["http://ws.stream.qqmusic.qq.com/"],
        }),
      );
    const meta = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless", refresh: true });
    expect(meta.currentLevel).toBe("exhigh");
    expect(meta.url).toContain("320segment");
  });

  it("caches purls and only re-resolves on refresh", async () => {
    // capable 账号:首次探测命中后缓存,第二次不再打接口。
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);
    fetchMock
      .mockResolvedValueOnce(musicuResponse("vkey", { midurlinfo: [], sip: [] }))
      .mockResolvedValueOnce(
        musicuResponse("vkey", {
          midurlinfo: [{ filename: "M800MIDFILE001.mp3", purl: "cachedsegment" }],
          sip: ["http://ws.stream.qqmusic.qq.com/"],
        }),
      );
    const first = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh", refresh: true });
    const second = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh" });
    expect(second.url).toBe(first.url);
    expect(fetchMock).toHaveBeenCalledTimes(3); // search + free probe + paid hit

    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M800MIDFILE001.mp3", purl: "newsegment" }],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const refreshed = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh", refresh: true });
    expect(refreshed.url).toContain("newsegment");
  });

  it("reports unavailability when no tier resolves", async () => {
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [freeSong] } } }));
    await searchQqTracks("莉莉安", 1, 0);
    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M500MIDFILE001.mp3", purl: "" }, { filename: "C400MIDFILE001.m4a", purl: "" }],
        sip: [],
      }),
    );
    await expect(resolveQqStreamMeta("001xQmoR2e6asc", { level: "standard", refresh: true })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("falls back to the plaintext AAC tier and derives its bitrate from the file size", async () => {
    // Populate the file-info cache (duration 269s) through a search first.
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);

    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "C400MIDFILE001.m4a", purl: "aacsegment", filesize: 4_304_000 }],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const meta = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "standard", refresh: true });
    expect(meta.currentLevel).toBe("standard");
    expect(meta.quality).toBe("AAC");
    expect(meta.url).toContain("aacsegment");
    // 4_304_000 bytes * 8 / 269s ~= 128k
    expect(meta.bitrate).toBe(128_000);
  });
});

describe("qq lyrics", () => {
  it("decodes base64 LRC and merges the translation", async () => {
    const lrc = Buffer.from("[00:01.00]你好\n[00:03.50]世界").toString("base64");
    const trans = Buffer.from("[00:01.00]hello\n[00:03.50]world").toString("base64");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ lyric: lrc, trans })));
    const lines = await getQqLyrics("0039MnYb0qxYhV");
    expect(lines.map((line) => line.text)).toEqual(["你好", "世界"]);
    expect(lines[0].translation).toBe("hello");
    expect(lines[1].translation).toBe("world");
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain("fcg_query_lyric_new.fcg");
  });

  it("returns no lines when the song has no lyrics", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ lyric: "" })));
    expect(await getQqLyrics("0039MnYb0qxYhV")).toEqual([]);
  });
});

describe("qq playlists and liked tracks", () => {
  const profileResponse = () =>
    new Response(JSON.stringify({
      data: {
        mymusic: [{ id: "8742739449", title: "我喜欢", type: 1 }],
        mydiss: {
          num: 1,
          list: [{ dissid: 777001, diss_name: "通勤歌单", song_cnt: 12, picurl: "http://y.gtimg.cn/a.jpg" }],
        },
      },
    }));

  it("requires a cookie before reading the account playlist list", async () => {
    await expect(getQqPlaylists()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("reads a public playlist anonymously", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      cdlist: [{ dissname: "公开歌单", songnum: 1, songlist: [searchSong] }],
    })));
    await expect(getQqPlaylistTracks("7695177222")).resolves.toMatchObject([{
      id: "0039MnYb0qxYhV",
      source: "qq",
    }]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Cookie: "" });
  });

  it("lists 我喜欢 plus the profile playlists", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock.mockResolvedValueOnce(profileResponse());
    const playlists = await getQqPlaylists();
    expect(playlists).toHaveLength(2);
    expect(playlists[0]).toMatchObject({ id: "8742739449", name: "我喜欢", owned: true });
    expect(playlists[1]).toMatchObject({ id: "777001", name: "通勤歌单", trackCount: 12, coverUrl: "http://y.gtimg.cn/a.jpg" });
  });

  it("maps playlist songs through the shared track mapping", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      cdlist: [{ dissname: "通勤歌单", songnum: 1, songlist: [searchSong] }],
    })));
    const tracks = await getQqPlaylistTracks("777001");
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "0039MnYb0qxYhV",
      title: "晴天",
      source: "qq",
      streamUrl: "/api/sources/qq/tracks/0039MnYb0qxYhV/stream",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("fcg_ucc_getcdinfo_byids_cp.fcg");
    expect(String(url)).toContain("disstid=777001");
    expect((init as RequestInit).headers).toMatchObject({ Cookie: "uin=o12345; qm_keyst=k1" });
  });

  it("normalizes the legacy fcg playlist song shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      cdlist: [{
        dissname: "公开歌单",
        songnum: 1,
        songlist: [{
          songid: 560063927,
          songmid: "001P6YOB0eXLlj",
          songname: "第57次取消发送",
          songtype: 0,
          interval: 180,
          singer: [{ mid: "003KKQQw1xxf8W", name: "菲菲公主" }],
          albummid: "000KrDC019mc82",
          albumname: "第57次取消发送",
          strMediaMid: "0015C3UU0jn4ZU",
          size128: 2_890_403,
          size320: 7_225_538,
          sizeflac: 37_103_475,
          pay: { payplay: 1 },
        }],
      }],
    })));
    await expect(getQqPlaylistTracks("7695177222")).resolves.toMatchObject([{
      id: "001P6YOB0eXLlj",
      title: "第57次取消发送",
      artist: "菲菲公主",
      album: "第57次取消发送",
      source: "qq",
      currentLevel: "lossless",
      vip: true,
    }]);
  });

  it("chains the profile lookup into the liked playlist read", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, cdlist: [{ dissname: "我喜欢", songnum: 0, songlist: [] }] })));
    const tracks = await getQqLikedTracks();
    expect(tracks).toEqual([]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("disstid=8742739449");
  });

  it("falls back to the created-diss endpoint when the profile has no 我喜欢 entry", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { mymusic: [], mydiss: { num: 0, list: [] } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { disslist: [{ dirid: 201, tid: 8742739449 }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, cdlist: [{ dissname: "我喜欢", songnum: 0, songlist: [] }] })));
    expect(await getQqLikedTracks()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("fcg_user_created_diss");
    expect(String(fetchMock.mock.calls[2][0])).toContain("disstid=8742739449");
  });

  it("maps an expired session on the playlist detail to AUTH_REQUIRED", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 2001 })));
    await expect(getQqPlaylistTracks("777001")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("qq likes", () => {
  it("resolves the numeric id, signs the 201 write and decrypts the response", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(musicuResponse("req_1", { track_info: { id: 260678, type: 0 } }))
      .mockResolvedValueOnce(new Response(encodeAg1Response('{"code":0,"req_0":{"code":0,"data":{"retCode":0}}}')));

    await expect(setQqLike("003aAPj81VWrbL", true)).resolves.toEqual({ ok: true, liked: true });

    const [detailUrl, detailInit] = fetchMock.mock.calls[0];
    expect(String(detailUrl)).toContain("musicu.fcg");
    expect(String((detailInit as RequestInit).body)).toContain("get_song_detail_yqq");
    const [writeUrl, writeInit] = fetchMock.mock.calls[1];
    expect(String(writeUrl)).toContain("u6.y.qq.com/cgi-bin/musics.fcg");
    expect(String(writeUrl)).toContain("encoding=ag-1");
    expect(String(writeUrl)).toContain("sign=zzc");
    expect((writeInit as RequestInit).headers).toMatchObject({
      Referer: "https://y.qq.com/",
      Cookie: "uin=o12345; qm_keyst=k1",
      "Content-Type": "text/plain",
    });
    expect((writeInit as RequestInit).body).toBeInstanceOf(Uint8Array);
  });

  it("turns a business retCode into a real failure instead of a fake success", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(musicuResponse("req_1", { track_info: { id: 260678, type: 0 } }))
      .mockResolvedValueOnce(new Response(encodeAg1Response('{"code":0,"req_0":{"code":80105,"data":{"retCode":0}}}')));

    await expect(setQqLike("003aAPj81VWrbL", false)).rejects.toMatchObject({ code: "UPSTREAM_FAILED" });
  });

  it("requires a QQ login before writing", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: null });
    await expect(setQqLike("003aAPj81VWrbL", true)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("qq cookie login", () => {
  it("saves a valid cookie and returns the account summary", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qqmusic_key=k1" });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ req_0: { code: 0, data: { info: { nick: "听歌人", logo: "https://gtimg.cn/a.jpg" } } } })),
    );
    const account = await saveQqCookie("uin=o12345; qqmusic_key=k1");
    expect(account).toMatchObject({ connected: true, nickname: "听歌人" });
    expect(mocks.updateStore).toHaveBeenCalledTimes(1);
    const update = mocks.updateStore.mock.calls[0][0] as (store: Record<string, unknown>) => Record<string, unknown>;
    expect(update({})).toMatchObject({ qqCookie: "uin=o12345; qqmusic_key=k1" });
  });

  it("probes the android profile and upgrades the avatar to https", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          req_0: { code: 0, data: { info: { nick: "YRRLYB", logo: "http://thirdqq.qlogo.cn/g?b=sdk&k=abc&s=140" } } },
        }),
      ),
    );

    const account = await getQqAccount();

    expect(account).toEqual({
      connected: true,
      nickname: "YRRLYB",
      userId: "12345",
      avatarUrl: "https://thirdqq.qlogo.cn/g?b=sdk&k=abc&s=140",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("musicu.fcg");
    const body = JSON.parse(String((init as RequestInit).body)) as {
      comm: { ct: number; authst: string; qq: string };
      req_0: { module: string; method: string };
    };
    // The web profile (ct 24 / yqq.json) rejects the session with 500003, so the
    // account probe must use the android client profile.
    expect(body.comm).toMatchObject({ ct: 11, authst: "k1", qq: "12345" });
    expect(body.req_0.module).toBe("music.UserInfo.userInfoServer");
    expect(body.req_0.method).toBe("GetLoginUserInfo");
    expect(String((init as RequestInit).headers && (init as RequestInit).headers!["Cookie"])).toContain("qqmusic_uin=12345");
  });

  it("falls back to the profile-homepage endpoint when the android probe is rejected", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ req_0: { code: 500003, subcode: 860100001 } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: { creator: { nick: "YRRLYB", headpic: "http://thirdqq.qlogo.cn/g?b=sdk&k=abc&s=140", uin: 0 } },
          }),
        ),
      );

    const account = await getQqAccount();

    expect(account).toMatchObject({ connected: true, nickname: "YRRLYB", avatarUrl: "https://thirdqq.qlogo.cn/g?b=sdk&k=abc&s=140" });
    const fallbackUrl = String(fetchMock.mock.calls[1][0]);
    expect(fallbackUrl).toContain("fcg_get_profile_homepage.fcg");
    expect(fallbackUrl).toContain("userid=12345");
  });

  it("rejects cookies without usable credentials", async () => {
    await expect(saveQqCookie("hello=world")).rejects.toMatchObject({ code: "QQ_COOKIE_INVALID" });
    expect(mocks.updateStore).not.toHaveBeenCalled();
  });

  it("reports a disconnected account when both probes fail", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qqmusic_key=k1" });
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));

    const account = await saveQqCookie("uin=o12345; qqmusic_key=k1");
    expect(account).toMatchObject({ connected: false, nickname: null });
  });

  it("clears the stored cookie on sign out", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qm_keyst=k1" });

    const account = await clearQqCookie();

    expect(mocks.updateStore).toHaveBeenCalledTimes(1);
    const update = mocks.updateStore.mock.calls[0][0] as (store: Record<string, unknown>) => Record<string, unknown>;
    expect(update({ qqCookie: "uin=o12345; qm_keyst=k1" })).toMatchObject({ qqCookie: null });
    expect(account).toMatchObject({ connected: false, nickname: null });
  });
});
