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
  getQqLyrics,
  normalizeQqSong,
  parseQqCookie,
  resolveQqStreamMeta,
  saveQqCookie,
  searchQqTracks,
} from "./client";

const searchSong = {
  mid: "0039MnYb0qxYhV",
  name: "晴天",
  interval: 269,
  singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }],
  album: { mid: "002eFUFm2XYZ7z", title: "叶惠美" },
  file: {
    media_mid: "MIDFILE001",
    size_128mp3: 4_200_000,
    size_320mp3: 10_800_000,
    size_flac: 32_000_000,
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
    expect(parseQqCookie("uin=o12345; qqmusic_key=Q_H_L_key1; other=x")).toEqual({ uin: "12345", key: "Q_H_L_key1" });
    expect(parseQqCookie("qm_keyst=keyst2; uin=67890;")).toEqual({ uin: "67890", key: "keyst2" });
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
    expect(track).toMatchObject({ id: "x1", quality: "320K", currentLevel: null, availableLevels: [] });
  });
});

describe("qq stream resolution", () => {
  it("picks the highest available tier at or below the request and prefixes the sip host", async () => {
    // Populate the file-info cache through a search first.
    fetchMock.mockResolvedValueOnce(musicuResponse("search", { body: { song: { list: [searchSong] } } }));
    await searchQqTracks("晴天", 1, 0);

    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [
          { filename: "F000MIDFILE001.flac", purl: "flacsegment", filesize: 32_000_000 },
          { filename: "M800MIDFILE001.mp3", purl: "" },
          { filename: "M500MIDFILE001.mp3", purl: "128segment" },
        ],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const meta = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "lossless" });
    expect(meta.currentLevel).toBe("lossless");
    expect(meta.url).toBe("http://ws.stream.qqmusic.qq.com/flacsegment");
    expect(meta.headers).toMatchObject({ Referer: "https://y.qq.com/" });
    expect(meta.expiresAt).toBeGreaterThan(Date.now());
    // One vkey call carries every candidate filename at once.
    const vkeyCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse((vkeyCall[1] as RequestInit).body as string) as {
      vkey: { param: { filename: string[] } };
    };
    expect(body.vkey.param.filename).toEqual([
      "F000MIDFILE001.flac",
      "M800MIDFILE001.mp3",
      "M500MIDFILE001.mp3",
    ]);
  });

  it("falls back to a lower tier when the requested one has no url", async () => {
    fetchMock.mockResolvedValueOnce(
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
    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M800MIDFILE001.mp3", purl: "cachedsegment" }],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const first = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh", refresh: true });
    const second = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh" });
    expect(second.url).toBe(first.url);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M800MIDFILE001.mp3", purl: "newsegment" }],
        sip: ["http://ws.stream.qqmusic.qq.com/"],
      }),
    );
    const refreshed = await resolveQqStreamMeta("0039MnYb0qxYhV", { level: "exhigh", refresh: true });
    expect(refreshed.url).toContain("newsegment");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports unavailability when no tier resolves", async () => {
    fetchMock.mockResolvedValueOnce(
      musicuResponse("vkey", {
        midurlinfo: [{ filename: "M500MIDFILE001.mp3", purl: "" }],
        sip: [],
      }),
    );
    await expect(resolveQqStreamMeta("0039MnYb0qxYhV", { level: "standard", refresh: true })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
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

describe("qq cookie login", () => {
  it("saves a valid cookie and returns the account summary", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qqmusic_key=k1" });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { creator: { nick: "听歌人", headpic: "https://gtimg.cn/a.jpg" } } })),
    );
    const account = await saveQqCookie("uin=o12345; qqmusic_key=k1");
    expect(account).toMatchObject({ connected: true, nickname: "听歌人" });
    expect(mocks.updateStore).toHaveBeenCalledTimes(1);
    const update = mocks.updateStore.mock.calls[0][0] as (store: Record<string, unknown>) => Record<string, unknown>;
    expect(update({})).toMatchObject({ qqCookie: "uin=o12345; qqmusic_key=k1" });
  });

  it("rejects cookies without usable credentials", async () => {
    await expect(saveQqCookie("hello=world")).rejects.toMatchObject({ code: "QQ_COOKIE_INVALID" });
    expect(mocks.updateStore).not.toHaveBeenCalled();
  });

  it("reports a disconnected account when the profile call fails", async () => {
    mocks.readStore.mockResolvedValue({ qqCookie: "uin=o12345; qqmusic_key=k1" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));

    const account = await saveQqCookie("uin=o12345; qqmusic_key=k1");
    expect(account).toMatchObject({ connected: false, nickname: null });
  });
});
