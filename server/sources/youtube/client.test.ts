import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyAgent } from "undici";
import {
  clearYoutubeCookie,
  getYoutubeAccount,
  getYoutubeLikedTracks,
  getYoutubePlaylistTracks,
  getYoutubePlaylists,
  normalizeYoutubeProxyInput,
  resetYoutubeStateForTests,
  resolveYoutubeStreamMeta,
  resolveYoutubeVideoMeta,
  saveYoutubeCookie,
  searchYoutubeTracks,
  setYoutubeLike,
} from "./client";

const storeMocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("../../store", () => ({
  readStore: storeMocks.readStore,
  updateStore: storeMocks.updateStore,
}));

const undiciMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("undici", () => ({
  ProxyAgent: vi.fn(),
  fetch: undiciMocks.fetch,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function shelfRow(videoId: string, title: string, subtitle: string, duration: string) {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: subtitle }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: duration }] } } },
      ],
      overlay: {
        musicItemRendererOverlay: {
          content: {
            musicPlayButtonRenderer: {
              playNavigationEndpoint: { watchEndpoint: { videoId } },
            },
          },
        },
      },
    },
  };
}

function searchResponse(rows: Array<ReturnType<typeof shelfRow>>, token?: string) {
  const shelfContents: Array<Record<string, unknown>> = [...rows];
  if (token) {
    shelfContents.push({ continuationItemRenderer: { continuationCommand: { token } } });
  }
  return jsonResponse({
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        title: { runs: [{ text: "歌曲" }] },
                        contents: shelfContents,
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  });
}

function playerResponse(
  status: string,
  formats?: Array<Record<string, unknown>>,
  muxedFormats?: Array<Record<string, unknown>>,
) {
  return jsonResponse({
    playabilityStatus: { status, ...(status === "ERROR" ? { reason: "Video unavailable" } : {}) },
    videoDetails: { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", author: "Rick Astley", lengthSeconds: "213" },
    ...(formats || muxedFormats
      ? {
          streamingData: {
            expiresInSeconds: 21540,
            ...(formats ? { adaptiveFormats: formats } : {}),
            ...(muxedFormats ? { formats: muxedFormats } : {}),
          },
        }
      : {}),
  });
}

const AAC_140 = {
  itag: 140,
  url: "https://rr3---sn.googlevideo.com/videoplayback?itag=140",
  mimeType: "audio/mp4; codecs=mp4a.40.2",
  bitrate: 130_000,
  audioSampleRate: "44100",
  audioQuality: "AUDIO_QUALITY_MEDIUM",
};
const OPUS_251 = {
  itag: 251,
  url: "https://rr3---sn.googlevideo.com/videoplayback?itag=251",
  mimeType: "audio/webm; codecs=opus",
  bitrate: 142_000,
  audioSampleRate: "48000",
  audioQuality: "AUDIO_QUALITY_HIGH",
};

describe("YouTube Music client", () => {
  beforeEach(() => {
    resetYoutubeStateForTests();
    undiciMocks.fetch.mockReset();
    undiciMocks.fetch.mockResolvedValue(jsonResponse({}));
    storeMocks.readStore.mockReset();
    storeMocks.readStore.mockResolvedValue({ youtubeProxy: null });
    storeMocks.updateStore.mockReset();
  });

  it("normalizes proxy input forms and rejects garbage", () => {
    expect(normalizeYoutubeProxyInput("7890")).toBe("http://127.0.0.1:7890");
    expect(normalizeYoutubeProxyInput("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(normalizeYoutubeProxyInput("http://192.168.1.5:8118")).toBe("http://192.168.1.5:8118/");
    expect(normalizeYoutubeProxyInput("https://127.0.0.1:10808/")).toBe("http://127.0.0.1:10808");
    expect(normalizeYoutubeProxyInput("https://localhost:7890")).toBe("http://localhost:7890");
    // undici ProxyAgent 只支持 HTTP(S)；socks 一律拒绝并让设置页给出明确文案。
    expect(normalizeYoutubeProxyInput("socks5://127.0.0.1:1080")).toBeNull();
    expect(normalizeYoutubeProxyInput("abc")).toBeNull();
    expect(normalizeYoutubeProxyInput("127.0.0.1:notaport")).toBeNull();
    expect(normalizeYoutubeProxyInput("")).toBeNull();
    expect(normalizeYoutubeProxyInput(null)).toBeNull();
  });

  it("maps innertube search rows into playable provider tracks", async () => {
    undiciMocks.fetch.mockResolvedValue(
      searchResponse(
        [
          shelfRow("abc123DEF-_4", "Never Gonna Give You Up", "Rick Astley • 欧美精选", "3:33"),
          shelfRow("xyz987GHI-_1", "Lemon", "米津玄师 • LEMON", "4:05"),
          // 无 videoId 的专辑卡片应被丢弃。
          {
            musicResponsiveListItemRenderer: {
              flexColumns: [
                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "专辑" }] } } },
              ],
              overlay: { musicItemRendererOverlay: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { browseEndpoint: { browseId: "MPREb_x" } } } } } },
            },
          },
        ],
        "next-token",
      ),
    );

    const tracks = await searchYoutubeTracks("never gonna give you up", 24, 0);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: "abc123DEF-_4",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      album: "欧美精选",
      duration: 213,
      quality: "AAC",
      bitrate: 128_000,
      sampleRate: 44_100,
      source: "youtube",
      streamUrl: "/api/sources/youtube/tracks/abc123DEF-_4/stream",
      coverUrl: "https://i.ytimg.com/vi/abc123DEF-_4/hqdefault.jpg",
      availableLevels: ["standard", "higher", "exhigh"],
    });
    expect(tracks[1]).toMatchObject({ id: "xyz987GHI-_1", artist: "米津玄师", duration: 245 });

    const call = undiciMocks.fetch.mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body)) as { query?: string; params?: string };
    expect(body.query).toBe("never gonna give you up");
    expect(String(call?.[0])).toContain("music.youtube.com/youtubei/v1/search");
  });

  it("follows the continuation token for the second page and stops when it expires", async () => {
    undiciMocks.fetch.mockResolvedValueOnce(searchResponse([shelfRow("firstpage1", "第一页", "A • B", "3:00")], "token-2"));
    const first = await searchYoutubeTracks("query", 24, 0);
    expect(first.map((track) => track.id)).toEqual(["firstpage1"]);

    undiciMocks.fetch.mockResolvedValueOnce(searchResponse([shelfRow("secondpage", "第二页", "A • B", "3:00")]));
    const second = await searchYoutubeTracks("query", 24, 24);
    expect(second.map((track) => track.id)).toEqual(["secondpage"]);
    const secondBody = JSON.parse(String(undiciMocks.fetch.mock.calls.at(-1)?.[1]?.body)) as { continuation?: string; query?: string };
    expect(secondBody.continuation).toBe("token-2");
    expect(secondBody.query).toBeUndefined();

    // 未记录过的分页位置返回空页，而不是打上游。
    const callsBefore = undiciMocks.fetch.mock.calls.length;
    const third = await searchYoutubeTracks("query", 24, 72);
    expect(third).toEqual([]);
    expect(undiciMocks.fetch.mock.calls.length).toBe(callsBefore);
  });

  it("resolves the best audio format for the requested level with graceful degradation", async () => {
    storeMocks.readStore.mockResolvedValue({
      youtubeCookie: "SID=logged; HSID=1; SSID=1; SAPISID=1",
      youtubeProxy: null,
    });
    undiciMocks.fetch.mockImplementation(async () => playerResponse("OK", [AAC_140, OPUS_251]));

    const exhigh = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "exhigh" });
    expect(exhigh.url).toBe(OPUS_251.url);
    // 登录会话必须随流解析请求一起发送，降低人机验证概率。
    const playerHeaders = (undiciMocks.fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(playerHeaders.cookie).toContain("SID=logged");
    expect(exhigh.currentLevel).toBe("exhigh");
    expect(exhigh.mimeType).toBe("audio/webm");
    expect(exhigh.bitrate).toBe(142_000);
    expect(exhigh.sampleRate).toBe(48_000);
    expect(exhigh.availableLevels).toEqual(["standard", "exhigh"]);

    resetYoutubeStateForTests();
    undiciMocks.fetch.mockClear();
    undiciMocks.fetch.mockResolvedValue(playerResponse("OK", [AAC_140, OPUS_251]));

    // 请求 YouTube 不存在的无损档位时降级到最高可用档（exhigh）。
    const hires = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "lossless" });
    expect(hires.currentLevel).toBe("exhigh");
    expect(hires.url).toBe(OPUS_251.url);

    resetYoutubeStateForTests();
    undiciMocks.fetch.mockClear();
    undiciMocks.fetch.mockResolvedValue(playerResponse("OK", [AAC_140]));

    const standard = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "standard" });
    expect(standard.currentLevel).toBe("standard");
    expect(standard.url).toBe(AAC_140.url);
    expect(standard.mimeType).toBe("audio/mp4");
  });

  it("falls back to the next innertube client when one is rejected", async () => {
    undiciMocks.fetch
      .mockResolvedValueOnce(playerResponse("LOGIN_REQUIRED"))
      .mockResolvedValueOnce(playerResponse("OK", [AAC_140, OPUS_251]));

    const meta = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", {});
    expect(meta.url).toBe(OPUS_251.url);
    expect(meta.currentLevel).toBe("exhigh");
    expect(undiciMocks.fetch).toHaveBeenCalledTimes(2);
    const androidBody = JSON.parse(String(undiciMocks.fetch.mock.calls[0]?.[1]?.body)) as { context?: { client?: { clientName?: string } } };
    const iosBody = JSON.parse(String(undiciMocks.fetch.mock.calls[1]?.[1]?.body)) as { context?: { client?: { clientName?: string } } };
    expect(androidBody.context?.client?.clientName).toBe("ANDROID");
    expect(iosBody.context?.client?.clientName).toBe("IOS");
  });

  it("surfaces an actionable error when every client is blocked", async () => {
    undiciMocks.fetch
      .mockResolvedValueOnce(playerResponse("LOGIN_REQUIRED"))
      .mockResolvedValueOnce(playerResponse("LOGIN_REQUIRED"))
      .mockResolvedValueOnce(playerResponse("LOGIN_REQUIRED"));

    await expect(resolveYoutubeStreamMeta("dQw4w9WgXcQ", {})).rejects.toThrow(/人机验证|代理/);
  });

  it("reports upstream failure when all player contexts error out", async () => {
    undiciMocks.fetch
      .mockResolvedValueOnce(playerResponse("ERROR"))
      .mockResolvedValueOnce(playerResponse("UNPLAYABLE"))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }));

    await expect(resolveYoutubeStreamMeta("dQw4w9WgXcQ", {})).rejects.toThrow(/无法播放|解析失败/);
  });

  it("maps proxy connection failures to a friendly upstream error", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeProxy: "127.0.0.1:9" });
    undiciMocks.fetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(searchYoutubeTracks("test", 24, 0)).rejects.toMatchObject({
      code: "UPSTREAM_FAILED",
      message: expect.stringContaining("代理"),
    });
  });

  it("routes ProxyAgent through global __ariaEnsureYoutubeProxyRelay when available", async () => {
    const relaySpy = vi.fn(async () => "http://127.0.0.1:54321");
    (globalThis as { __ariaEnsureYoutubeProxyRelay?: (uri: string) => Promise<string | null> }).__ariaEnsureYoutubeProxyRelay =
      relaySpy;
    storeMocks.readStore.mockResolvedValue({ youtubeProxy: "127.0.0.1:10809" });
    undiciMocks.fetch.mockResolvedValue(searchResponse([]));
    try {
      await searchYoutubeTracks("hello", 1, 0);
      expect(relaySpy).toHaveBeenCalledWith("http://127.0.0.1:10809");
      expect(vi.mocked(ProxyAgent)).toHaveBeenCalledWith(expect.objectContaining({ uri: "http://127.0.0.1:54321" }));
    } finally {
      delete (globalThis as { __ariaEnsureYoutubeProxyRelay?: unknown }).__ariaEnsureYoutubeProxyRelay;
    }
  });

  it("caches stream metadata and refresh bypasses the cache", async () => {
    undiciMocks.fetch.mockImplementation(async () => playerResponse("OK", [AAC_140, OPUS_251]));
    await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "standard" });
    await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "standard" });
    expect(undiciMocks.fetch).toHaveBeenCalledTimes(1);

    await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "standard", refresh: true });
    expect(undiciMocks.fetch).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------
  // 账号（Cookie 绑定）与歌单
  // -----------------------------------------------------------------

  const VALID_COOKIE = "SID=test; HSID=test; SSID=test; SAPISID=test; __Secure-1P_SID=test";

  function playerWithLoggedin(loggedin: boolean) {
    return jsonResponse({
      playabilityStatus: { status: "OK" },
      responseContext: { mainAppWebResponseContext: { loggedin } },
    });
  }

  function playlistsShelfResponse(cards: Array<Record<string, unknown>>) {
    return jsonResponse({
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      { gridRenderer: { items: cards } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    });
  }

  function playlistCard(playlistId: string, title: string, subtitle: string) {
    return {
      musicTwoRowItemRenderer: {
        playlistId,
        navigationEndpoint: { browseEndpoint: { browseId: `VL${playlistId}` } },
        title: { runs: [{ text: title }] },
        subtitle: { runs: [{ text: subtitle }] },
        thumbnail: {
          musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://yt3.ggpht.com/pl.jpg" }] } },
        },
      },
    };
  }

  it("reports signed out without a stored cookie", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: null });
    const account = await getYoutubeAccount();
    expect(account).toEqual({ connected: false, nickname: null, userId: null, avatarUrl: null });
  });

  it("validates the session via the player loggedin flag and sends the cookie", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch.mockResolvedValue(playerWithLoggedin(true));

    const account = await getYoutubeAccount();
    expect(account.connected).toBe(true);
    const headers = (undiciMocks.fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toContain("SID=test");
    // 探测必须用 WEB 客户端上下文（loggedin 标记在那里最可靠）。
    const probeBody = JSON.parse(String(undiciMocks.fetch.mock.calls[0]?.[1]?.body)) as { context?: { client?: { clientName?: string } } };
    expect(probeBody.context?.client?.clientName).toBe("WEB");

    resetYoutubeStateForTests();
    undiciMocks.fetch.mockClear();
    undiciMocks.fetch.mockResolvedValue(playerWithLoggedin(false));
    const expired = await getYoutubeAccount();
    expect(expired.connected).toBe(false);
  });

  it("keeps the cookie saved when the probe cannot reach YouTube", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    const account = await getYoutubeAccount();
    expect(account.connected).toBe(true);
  });

  it("rejects pasted cookies without a SID field and persists valid ones", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: null });
    storeMocks.updateStore.mockImplementation(async (updater: (store: Record<string, unknown>) => Record<string, unknown>) =>
      updater({ youtubeCookie: null }));
    undiciMocks.fetch.mockResolvedValue(playerWithLoggedin(true));

    await expect(saveYoutubeCookie("garbage without session fields")).rejects.toThrow(/SID/);
    // 保存后 readStore 返回已保存的 Cookie，探测走 player loggedin 路径。
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    const account = await saveYoutubeCookie(VALID_COOKIE);
    expect(account.connected).toBe(true);
    expect(storeMocks.updateStore).toHaveBeenCalled();

    storeMocks.readStore.mockResolvedValue({ youtubeCookie: null });
    const cleared = await clearYoutubeCookie();
    expect(cleared.connected).toBe(false);
  });

  it("requires login for the account playlist list and pins liked music first", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: null });
    await expect(getYoutubePlaylists()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    resetYoutubeStateForTests();
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch.mockResolvedValue(
      playlistsShelfResponse([
        playlistCard("PLabc1234567890", "深夜编码", "播放列表 · 12 首"),
        playlistCard("PLxyz0987654321", "通勤电台", "播放列表 · 3 首"),
      ]),
    );

    const playlists = await getYoutubePlaylists();
    expect(playlists.map((playlist) => playlist.id)).toEqual(["FEmusic_liked_songs", "PLabc1234567890", "PLxyz0987654321"]);
    expect(playlists[0]).toMatchObject({ name: "喜欢的音乐", owned: true, canEdit: false, coverColor: "#FF0033" });
    expect(playlists[1]).toMatchObject({ name: "深夜编码", trackCount: 12, coverUrl: "https://yt3.ggpht.com/pl.jpg" });

    const body = JSON.parse(String(undiciMocks.fetch.mock.calls[0]?.[1]?.body)) as { browseId?: string };
    expect(body.browseId).toBe("FEmusic_playlists");
  });

  it("loads playlist tracks with the VL prefix, split columns and continuations", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });

    const detailRow = (videoId: string, title: string, artist: string, album: string, duration: string) => ({
      musicResponsiveListItemRenderer: {
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: artist }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: album }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: duration }] } } },
        ],
        playlistItemData: { videoId },
      },
    });

    undiciMocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          header: { musicDetailHeaderRenderer: { title: { runs: [{ text: "深夜编码" }] } } },
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicPlaylistShelfRenderer: {
                              title: { runs: [{ text: "深夜编码" }] },
                              contents: [detailRow("pltrack00001", "Track A", "Artist A", "Album A", "3:21")],
                              continuations: [{ next: { continuation: "cont-token" } }],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          continuationContents: {
            musicPlaylistShelfContinuation: {
              contents: [detailRow("pltrack00002", "Track B", "Artist B", "Album B", "4:02")],
            },
          },
        }),
      );

    const { title, tracks } = await getYoutubePlaylistTracks("PLabc1234567890");
    expect(title).toBe("深夜编码");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: "pltrack00001",
      title: "Track A",
      artist: "Artist A",
      album: "Album A",
      duration: 201,
      source: "youtube",
    });
    expect(tracks[1]).toMatchObject({ id: "pltrack00002", title: "Track B" });

    const firstBody = JSON.parse(String(undiciMocks.fetch.mock.calls[0]?.[1]?.body)) as { browseId?: string; continuation?: string };
    expect(firstBody.browseId).toBe("VLPLabc1234567890");
    const secondBody = JSON.parse(String(undiciMocks.fetch.mock.calls[1]?.[1]?.body)) as { browseId?: string; continuation?: string };
    expect(secondBody.continuation).toBe("cont-token");
  });

  it("reads liked music directly by its browse id and allows an empty liked list", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicPlaylistShelfRenderer: {
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    flexColumns: [
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Liked Song" }] } } },
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Someone • Album" }] } } },
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "2:30" }] } } },
                                    ],
                                    overlay: {
                                      musicItemRendererOverlay: {
                                        content: {
                                          musicPlayButtonRenderer: {
                                            playNavigationEndpoint: { watchEndpoint: { videoId: "likedtrack01" } },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [{ musicPlaylistShelfRenderer: { contents: [] } }],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      );

    const first = await getYoutubePlaylistTracks("FEmusic_liked_songs");
    expect(first.tracks).toHaveLength(1);
    expect(first.tracks[0]).toMatchObject({ id: "likedtrack01", title: "Liked Song", artist: "Someone", album: "Album", duration: 150 });
    const firstBody = JSON.parse(String(undiciMocks.fetch.mock.calls[0]?.[1]?.body)) as { browseId?: string };
    expect(firstBody.browseId).toBe("FEmusic_liked_songs");

    // 「喜欢的音乐」为空是合法状态：返回空列表而不是报错。
    const second = await getYoutubePlaylistTracks("FEmusic_liked_songs");
    expect(second.tracks).toEqual([]);
  });

  it("extracts nickname, handle and avatarUrl via SAPISIDHASH account_menu", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch.mockImplementation(async (url) => {
      if (String(url).includes("account_menu")) {
        return jsonResponse({
          actions: [
            {
              openPopupAction: {
                popup: {
                  multiPageMenuRenderer: {
                    header: {
                      activeAccountHeaderRenderer: {
                        accountName: { runs: [{ text: "YRRLYB" }] },
                        channelHandle: { runs: [{ text: "@YRRLYB" }] },
                        accountPhoto: {
                          thumbnails: [
                            { url: "https://yt3.ggpht.com/small.jpg", width: 48 },
                            { url: "https://yt3.ggpht.com/large.jpg", width: 108 },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        });
      }
      return playerWithLoggedin(true);
    });

    const account = await getYoutubeAccount();
    expect(account).toEqual({
      connected: true,
      nickname: "YRRLYB",
      userId: "@YRRLYB",
      avatarUrl: "https://yt3.ggpht.com/large.jpg",
    });
    const menuCall = undiciMocks.fetch.mock.calls.find(([url]) => String(url).includes("account_menu"));
    const menuHeaders = (menuCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(menuHeaders.authorization).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}/);
  });

  it("reads liked tracks with VLLM fallback, fixedColumns duration, and syncs setLike", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    undiciMocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400 } }), { status: 400 }))
      .mockResolvedValueOnce(
        jsonResponse({
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicPlaylistShelfRenderer: {
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    flexColumns: [
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Liked MV" }] } } },
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "YOASOBI" }] } } },
                                    ],
                                    fixedColumns: [
                                      { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: "3:45" }] } } },
                                    ],
                                    playlistItemData: { videoId: "Kt_ZgTS3eJA" },
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    const tracks = await getYoutubeLikedTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "Kt_ZgTS3eJA",
      title: "Liked MV",
      artist: "YOASOBI",
      duration: 225,
      videoUrl: "/api/sources/youtube/tracks/Kt_ZgTS3eJA/video",
      hasVideo: true,
    });
    const fallbackBody = JSON.parse(String(undiciMocks.fetch.mock.calls[1]?.[1]?.body)) as { browseId?: string };
    expect(fallbackBody.browseId).toBe("VLLM");

    const likedResult = await setYoutubeLike("Kt_ZgTS3eJA", true);
    expect(likedResult).toEqual({ ok: true, liked: true });
    expect(String(undiciMocks.fetch.mock.calls[2]?.[0])).toContain("like/like");
  });

  it("resolves YouTube video meta preferring requested height and H.264 codec", async () => {
    const video720Vp9 = {
      itag: 247,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=247",
      mimeType: 'video/webm; codecs="vp09.00.31.08"',
      bitrate: 1_900_000,
      width: 1280,
      height: 720,
      qualityLabel: "720p",
    };
    const video720H264 = {
      itag: 136,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=136",
      mimeType: 'video/mp4; codecs="avc1.4D401F"',
      bitrate: 2_250_000,
      width: 1280,
      height: 720,
      qualityLabel: "720p",
    };
    const video1080H264 = {
      itag: 137,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=137",
      mimeType: 'video/mp4; codecs="avc1.640028"',
      bitrate: 4_400_000,
      width: 1920,
      height: 1080,
      qualityLabel: "1080p",
    };
    undiciMocks.fetch.mockResolvedValue(playerResponse("OK", [video720Vp9, video720H264, video1080H264, AAC_140, OPUS_251]));

    const meta720 = await resolveYoutubeVideoMeta("dQw4w9WgXcQ", { qn: 720, level: "exhigh" });
    expect(meta720.url).toBe(video720H264.url);
    expect(meta720.audioUrl).toBe(OPUS_251.url);
    expect(meta720.qualityId).toBe(720);
    expect(meta720.mode).toBe("dash");
    expect(meta720.availableQualities?.map((item) => item.id)).toEqual([1080, 720]);
    expect(typeof meta720.fetcher).toBe("function");
  });

  it("upgrades to adaptive Opus/1080p DASH when readable and falls back to itag 18 when 403-gated", async () => {
    const muxed18 = {
      itag: 18,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=18",
      mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      width: 640,
      height: 360,
      qualityLabel: "360p",
    };
    const video1080H264 = {
      itag: 137,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=137",
      mimeType: 'video/mp4; codecs="avc1.640028"',
      bitrate: 4_400_000,
      width: 1920,
      height: 1080,
      qualityLabel: "1080p",
    };
    const aac256Premium = {
      itag: 141,
      url: "https://rr3---sn.googlevideo.com/videoplayback?itag=141",
      mimeType: "audio/mp4; codecs=mp4a.40.2",
      bitrate: 256_000,
      audioSampleRate: "44100",
      audioQuality: "AUDIO_QUALITY_HIGH",
    };

    // Case 1: PO-token gated (probe gets 403) -> falls back to progressive itag 18.
    undiciMocks.fetch.mockImplementation(async (url) => {
      if (String(url).includes("googlevideo.com")) return new Response(null, { status: 403 });
      return playerResponse("OK", [AAC_140, OPUS_251, video1080H264], [muxed18]);
    });

    const fallbackStream = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "exhigh" });
    expect(fallbackStream.url).toBe(muxed18.url);
    expect(fallbackStream.mimeType).toBe("audio/mp4");
    expect(fallbackStream.currentLevel).toBe("standard");
    expect(fallbackStream.availableLevels).toEqual(["standard"]);
    expect(fallbackStream.headers?.["User-Agent"]).toContain("com.google.android.youtube");

    const fallbackVideo = await resolveYoutubeVideoMeta("dQw4w9WgXcQ", { qn: 1080, level: "exhigh" });
    expect(fallbackVideo.url).toBe(muxed18.url);
    expect(fallbackVideo.mode).toBe("muxed");
    expect(fallbackVideo.qualityId).toBe(360);
    expect(fallbackVideo.audioUrl).toBeNull();

    // Case 2: Un-gated (probe gets 206) -> upgrades to 256k/Opus audio & 1080p DASH video.
    resetYoutubeStateForTests();
    undiciMocks.fetch.mockImplementation(async (url) => {
      if (String(url).includes("googlevideo.com")) return new Response(null, { status: 206 });
      return playerResponse("OK", [AAC_140, OPUS_251, aac256Premium, video1080H264], [muxed18]);
    });

    const upgradedStream = await resolveYoutubeStreamMeta("dQw4w9WgXcQ", { level: "exhigh" });
    expect(upgradedStream.url).toBe(aac256Premium.url);
    expect(upgradedStream.currentLevel).toBe("exhigh");
    expect(upgradedStream.bitrate).toBe(256_000);

    const upgradedVideo = await resolveYoutubeVideoMeta("dQw4w9WgXcQ", { qn: 1080, level: "exhigh" });
    expect(upgradedVideo.url).toBe(video1080H264.url);
    expect(upgradedVideo.audioUrl).toBe(aac256Premium.url);
    expect(upgradedVideo.mode).toBe("dash");
    expect(upgradedVideo.qualityId).toBe(1080);
  });

  it("collects >100 liked tracks across appendContinuationItemsAction continuation pages", async () => {
    storeMocks.readStore.mockResolvedValue({ youtubeCookie: VALID_COOKIE });
    const makeRow = (index: number) => shelfRow(`trk_${String(index).padStart(7, "0")}`, `Song ${index}`, "Artist • Album", "3:15");
    const page1Rows = Array.from({ length: 75 }, (_, i) => makeRow(i));
    const page2Rows = Array.from({ length: 75 }, (_, i) => makeRow(75 + i));

    undiciMocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400 } }), { status: 400 }))
      .mockResolvedValueOnce(
        jsonResponse({
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicPlaylistShelfRenderer: {
                              contents: [
                                ...page1Rows,
                                { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "vllm-page-2" } } } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          onResponseReceivedActions: [
            {
              appendContinuationItemsAction: {
                continuationItems: page2Rows,
              },
            },
          ],
        }),
      );

    const liked = await getYoutubeLikedTracks();
    expect(liked).toHaveLength(150);
    expect(liked[0]?.id).toBe("trk_0000000");
    expect(liked[149]?.id).toBe("trk_0000149");
  });
});
