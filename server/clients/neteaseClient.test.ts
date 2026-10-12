import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  playlists: vi.fn(),
  store: vi.fn(),
  account: vi.fn(),
  search: vi.fn(), suggest: vi.fn(), user: vi.fn(), album: vi.fn(), artist: vi.fn(), artistDesc: vi.fn(), artistAlbums: vi.fn(),
  playlistDetail: vi.fn(), playlistTracks: vi.fn(), editTracks: vi.fn(), order: vi.fn(), name: vi.fn(), description: vi.fn(), tags: vi.fn(), cover: vi.fn(), subscribe: vi.fn(),
  persistent: new Map<string, unknown>(),
  rememberPersistent: vi.fn(), clearPersistent: vi.fn(), setPersistent: vi.fn(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({
  default: {
    playlist_create: mocks.create, user_playlist: mocks.playlists,
    cloudsearch: mocks.search, search_suggest: mocks.suggest, user_detail: mocks.user,
    album: mocks.album, artist_detail: mocks.artist, artist_desc: mocks.artistDesc, artist_album: mocks.artistAlbums,
    playlist_detail: mocks.playlistDetail, playlist_track_all: mocks.playlistTracks,
    playlist_tracks: mocks.editTracks, song_order_update: mocks.order,
    playlist_name_update: mocks.name, playlist_desc_update: mocks.description, playlist_tags_update: mocks.tags,
    playlist_cover_update: mocks.cover, playlist_subscribe: mocks.subscribe,
  },
}));
vi.mock("../store", () => ({ readStore: mocks.store }));
vi.mock("../services/neteaseService", () => ({ getNeteaseAccountSummary: mocks.account }));
vi.mock("../utils/persistentCache", () => ({ rememberPersistent: mocks.rememberPersistent, clearPersistent: mocks.clearPersistent, setPersistent: mocks.setPersistent }));

import sharp from "sharp";
import { NeteaseClient, normalizeSong, qualityFromLevel } from "./neteaseClient";
import { clearCache } from "../utils/memoryCache";

beforeEach(() => {
  vi.resetAllMocks();
  clearCache();
  mocks.persistent.clear();
  mocks.store.mockResolvedValue({ neteaseCookie: "test-cookie" });
  mocks.account.mockResolvedValue({ connected: true, userId: "7" });
  mocks.rememberPersistent.mockImplementation(async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
    if (mocks.persistent.has(key)) return mocks.persistent.get(key);
    const value = await loader(); mocks.persistent.set(key, value); return value;
  });
  mocks.clearPersistent.mockImplementation(async (prefix: string) => {
    for (const key of mocks.persistent.keys()) if (key.startsWith(prefix)) mocks.persistent.delete(key);
  });
});

describe("NetEase quality mapping", () => {
  it("keeps master quality distinct from the original Hi-Res recording", () => {
    expect(qualityFromLevel("jymaster")).toBe("臻品");
    expect(qualityFromLevel("hires")).toBe("Hi-Res");
    expect(qualityFromLevel("lossless")).toBe("Lossless");
  });

  it("does not advertise an unselected master enhancement as the original recording", () => {
    const song = { id: 43, name: "Song", sq: { br: 999000, sr: 44100 }, hr: { br: 1500000, sr: 96000 }, privilege: { maxbr: 999000 } };
    expect(normalizeSong(song)).toMatchObject({ quality: "Hi-Res", currentLevel: "hires", availableLevels: ["lossless", "hires", "jymaster"] });
    expect(normalizeSong({ ...song, hr: undefined })).toMatchObject({ quality: "Lossless", currentLevel: "lossless" });
    expect(normalizeSong(song, { currentLevel: "jymaster" })).toMatchObject({ quality: "臻品", currentLevel: "jymaster" });
  });
});

describe("NetEase playlist creation", () => {
  const client = new NeteaseClient();
  const created = { id: 42, name: "夜间", trackCount: 0, creator: { userId: 7 } };

  beforeEach(() => {
    mocks.create.mockResolvedValue({ body: { code: 200, playlist: created } });
  });

  it("creates an owned public playlist with a trimmed name", async () => {
    const playlist = await client.createPlaylist("  夜间  ");
    expect(mocks.create).toHaveBeenCalledWith({ name: "夜间", privacy: 0, cookie: "test-cookie" });
    expect(playlist).toMatchObject({ id: "42", name: "夜间", owned: true, subscribed: false, ownerId: "7", trackCount: 0 });
  });

  it("maps private visibility and refreshes an already cached playlist list", async () => {
    mocks.playlists.mockResolvedValueOnce({ body: { playlist: [] } });
    expect(await client.getPlaylists()).toEqual([]);
    await client.createPlaylist("夜间", true);
    mocks.playlists.mockResolvedValueOnce({ body: { playlist: [created] } });
    expect(await client.getPlaylists()).toHaveLength(1);
    expect(mocks.playlists).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith({ name: "夜间", privacy: 10, cookie: "test-cookie" });
  });

  it("does not send a write when no account is configured", async () => {
    mocks.store.mockResolvedValue({ neteaseCookie: null });
    await expect(client.createPlaylist("夜间")).rejects.toMatchObject({ status: 401 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects empty and overlong names before sending a write", async () => {
    await expect(client.createPlaylist("   ")).rejects.toMatchObject({ status: 400 });
    await expect(client.createPlaylist("夜".repeat(41))).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("surfaces an upstream failure instead of treating it as a new playlist", async () => {
    mocks.create.mockResolvedValue({ body: { code: 403, message: "操作过于频繁" } });
    await expect(client.createPlaylist("夜间")).rejects.toMatchObject({ status: 502, message: "操作过于频繁" });
  });

  it("preserves the error message when the API rejects its promise", async () => {
    mocks.create.mockRejectedValue({ body: { code: 403, message: "请重新登录" } });
    await expect(client.createPlaylist("夜间")).rejects.toMatchObject({ status: 502, message: "请重新登录" });
  });
});

describe("NetEase public discovery", () => {
  const client = new NeteaseClient();

  it("searches listener profiles without login or extra search requests", async () => {
    mocks.store.mockResolvedValue({ neteaseCookie: null });
    mocks.search.mockResolvedValue({ body: { code: 200, result: { userprofileCount: 12, userprofiles: [{ userId: 9, nickname: "听众", avatarUrl: "https://p1.music.126.net/avatar.jpg", signature: "一起听" }] } } });
    const result = await client.search(" 听众 ", "users", 18, 18);
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith({ keywords: "听众", type: 1002, limit: 18, offset: 18, cookie: undefined });
    expect(result).toMatchObject({ total: 12, users: [{ id: "9", nickname: "听众", signature: "一起听" }], artists: [], tracks: [] });
  });

  it.each(["albums", "lyrics"] as const)("uses a dedicated %s search category", async (mode) => {
    mocks.search.mockResolvedValue({ body: { code: 200, result: mode === "albums" ? { albums: [{ id: 1, name: "专辑", artist: { id: 2, name: "歌手" }, size: 3 }] } : { songs: [{ id: 1, name: "歌词找到的歌", al: { id: 4, name: "专辑" }, ar: [{ id: 2, name: "歌手" }], lyrics: ["下一句", "这是<b>一句歌词</b> &amp; 旋律"] }] } } });
    const result = await client.search("一句歌词", mode);
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(mocks.search.mock.calls[0][0].type).toBe(mode === "albums" ? 10 : 1006);
    if (mode === "albums") expect(result.albums[0]).toMatchObject({ id: "1", artistId: "2", trackCount: 3 });
    else expect(result.tracks[0]).toMatchObject({ id: "1", albumId: "4", artistIds: ["2"], matchedLyric: "这是一句歌词 & 旋律" });
  });

  it("deduplicates keyword suggestions and caches repeated input", async () => {
    mocks.suggest.mockResolvedValue({ body: { code: 200, result: { allMatch: [{ keyword: "夜曲" }, { keyword: "夜曲" }, { keyword: "夜" }, {}] } } });
    expect(await client.getSearchSuggestions(" 夜 ")).toEqual(["夜曲", "夜"]);
    expect(await client.getSearchSuggestions("夜")).toEqual(["夜曲", "夜"]);
    expect(mocks.suggest).toHaveBeenCalledOnce();
  });

  it("does not mark someone else's public playlists editable", async () => {
    mocks.store.mockResolvedValue({ neteaseCookie: null });
    mocks.playlists.mockResolvedValue({ body: { code: 200, more: false, playlist: [
      { id: 42, name: "公开", creator: { userId: 9, nickname: "听众" }, subscribed: false },
      { id: 43, name: "私密", creator: { userId: 9 }, privacy: 10 },
    ] } });
    expect(await client.getUserPlaylists("9")).toMatchObject({ playlists: [{ id: "42", owned: false, canEdit: false, creatorName: "听众" }], more: false });
  });

  it("normalizes profile counts and refuses an unavailable profile", async () => {
    mocks.user.mockResolvedValueOnce({ body: { code: 200, playlistCount: 3, profile: { userId: 9, nickname: "用户", follows: 5, followeds: 7 } } });
    expect(await client.getUserDetail("9")).toMatchObject({ id: "9", playlistCount: 3, followCount: 5, followerCount: 7 });
    mocks.user.mockResolvedValueOnce({ body: { code: 404, message: "不存在" } });
    await expect(client.getUserDetail("10")).rejects.toMatchObject({ status: 404, message: "不存在" });
  });

  it("loads an album and keeps the artist summary when optional biography fails", async () => {
    mocks.album.mockResolvedValue({ body: { code: 200, album: { id: 1, name: "完整专辑", artist: { id: 2, name: "歌手" }, description: "介绍" }, songs: [{ id: 3, name: "曲目" }] } });
    expect(await client.getAlbum("1")).toMatchObject({ album: { id: "1", description: "介绍" }, tracks: [{ id: "3" }] });
    mocks.artist.mockResolvedValue({ body: { code: 200, data: { artist: { id: 2, name: "歌手", cover: "cover", briefDesc: "概要" } } } });
    mocks.artistDesc.mockRejectedValue({ body: { code: 403 } });
    expect(await client.getArtistDetail("2")).toMatchObject({ artist: { id: "2", avatarUrl: "cover" }, description: "概要", sections: [] });
  });
});

describe("NetEase playlist editing", () => {
  const client = new NeteaseClient();
  const playlist = { id: 42, name: "歌单", trackCount: 2, creator: { userId: 7 }, trackIds: [{ id: 1 }, { id: 2 }] };

  beforeEach(() => {
    mocks.playlistDetail.mockResolvedValue({ body: { code: 200, playlist } });
    mocks.editTracks.mockResolvedValue({ body: { status: 200, body: { code: 200 } } });
    mocks.order.mockResolvedValue({ body: { code: 200 } });
    mocks.name.mockResolvedValue({ body: { code: 200 } });
    mocks.description.mockResolvedValue({ body: { code: 200 } });
    mocks.subscribe.mockResolvedValue({ body: { code: 200 } });
  });

  it("refuses unauthenticated and foreign-owned writes before sending changes", async () => {
    mocks.store.mockResolvedValueOnce({ neteaseCookie: null });
    await expect(client.editPlaylistTracks("42", ["1"], "add")).rejects.toMatchObject({ status: 401 });
    mocks.playlistDetail.mockResolvedValue({ body: { code: 200, playlist: { ...playlist, creator: { userId: 9 } } } });
    await expect(client.updatePlaylist("42", { name: "修改" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.editTracks).not.toHaveBeenCalled(); expect(mocks.name).not.toHaveBeenCalled();
  });

  it("invalidates persistent tracks and liked data after a successful edit", async () => {
    mocks.playlistTracks.mockResolvedValueOnce({ body: { code: 200, songs: [{ id: 1, name: "旧" }] } });
    expect(await client.getPlaylistTracks("42")).toMatchObject([{ id: "1" }]);
    await client.editPlaylistTracks("42", ["2"], "add");
    mocks.playlistTracks.mockResolvedValueOnce({ body: { code: 200, songs: [{ id: 2, name: "新" }] } });
    expect(await client.getPlaylistTracks("42")).toMatchObject([{ id: "2" }]);
    expect(mocks.editTracks).toHaveBeenCalledWith(expect.objectContaining({ tracks: "2", op: "add", pid: "42" }));
    expect(mocks.clearPersistent).toHaveBeenCalledWith("netease:liked:v2:7");
  });

  it("rejects an upstream error inside a successful HTTP wrapper", async () => {
    mocks.editTracks.mockResolvedValue({ body: { status: 200, body: { code: 403, message: "无权限" } } });
    await expect(client.editPlaylistTracks("42", ["1"], "del")).rejects.toMatchObject({ status: 403, message: "无权限" });
  });

  it("sends complete song order and refuses missing/duplicate or stale ids", async () => {
    expect(await client.reorderPlaylistTracks("42", ["2", "1"])).toEqual({ ok: true });
    expect(mocks.order).toHaveBeenCalledWith(expect.objectContaining({ pid: "42", ids: '["2","1"]' }));
    await expect(client.reorderPlaylistTracks("42", ["1"])).rejects.toMatchObject({ status: 409 });
    await expect(client.reorderPlaylistTracks("42", ["1", "1"])).rejects.toMatchObject({ status: 400 });
    expect(mocks.order).toHaveBeenCalledOnce();
  });

  it("edits quoted descriptions through structured endpoints and hides special-playlist editing", async () => {
    await client.updatePlaylist("42", { description: '他说 "晚安"\n下一行' });
    expect(mocks.description).toHaveBeenCalledWith(expect.objectContaining({ desc: '他说 "晚安"\n下一行' }));
    mocks.playlistDetail.mockResolvedValue({ body: { code: 200, playlist: { ...playlist, specialType: 5 } } });
    await expect(client.updatePlaylist("42", { name: "改名" })).rejects.toMatchObject({ status: 403 });
    mocks.playlistTracks.mockResolvedValue({ body: { code: 200, songs: [] } });
    expect((await client.getPlaylistDetail("42")).playlist).toMatchObject({ owned: true, canEdit: false });
  });

  it("reports a provider refusal and refreshes cached metadata after a partial update", async () => {
    mocks.description.mockRejectedValue({ body: { code: 403, message: "介绍保存失败" } });
    await expect(client.updatePlaylist("42", { name: "新名", description: "介绍" })).rejects.toMatchObject({ status: 403, message: "介绍保存失败" });
    expect(mocks.name).toHaveBeenCalledOnce();
    expect(mocks.clearPersistent).toHaveBeenCalledWith("netease:playlist-tracks:v3:42:");
  });

  it("converts image uploads to JPEG and rejects wrapped cover failures", async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    mocks.cover.mockResolvedValueOnce({ body: { code: 200, data: { code: 200, url_pre: "https://p1.music.126.net/new.jpg" } } });
    expect((await client.uploadPlaylistCover("42", png)).playlist.coverUrl).toBe("https://p1.music.126.net/new.jpg");
    const payload = mocks.cover.mock.calls[0][0];
    expect(Buffer.isBuffer(payload.imgFile.data)).toBe(true);
    expect(await sharp(payload.imgFile.data).metadata()).toMatchObject({ format: "jpeg", width: 1000, height: 1000 });
    mocks.cover.mockResolvedValueOnce({ body: { code: 200, data: { code: 403, message: "封面被拒绝" } } });
    await expect(client.uploadPlaylistCover("42", png)).rejects.toMatchObject({ status: 403, message: "封面被拒绝" });
    await expect(client.uploadPlaylistCover("42", Buffer.from("not an image"))).rejects.toMatchObject({ status: 400 });
    expect(mocks.cover).toHaveBeenCalledTimes(2);
  });

  it("supports collecting others' playlists while refusing to collect an owned playlist", async () => {
    await expect(client.subscribePlaylist("42", true)).rejects.toMatchObject({ status: 400 });
    mocks.playlistDetail.mockResolvedValue({ body: { code: 200, playlist: { ...playlist, creator: { userId: 9 } } } });
    expect(await client.subscribePlaylist("42", false)).toEqual({ ok: true, subscribed: false });
    expect(mocks.subscribe).toHaveBeenCalledWith(expect.objectContaining({ id: "42", t: 2 }));
  });
});
