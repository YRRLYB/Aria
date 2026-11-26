import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  send_text: vi.fn(),
  send_song: vi.fn(),
  listentogether_status: vi.fn(),
  listentogether_sync_playlist_get: vi.fn(),
  listentogether_sync_list_command: vi.fn(),
  getTracksByIds: vi.fn(),
  readStore: vi.fn(),
  getAccount: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({
  default: {
    batch: mocks.batch,
    send_text: mocks.send_text,
    send_song: mocks.send_song,
    listentogether_status: mocks.listentogether_status,
    listentogether_sync_playlist_get: mocks.listentogether_sync_playlist_get,
    listentogether_sync_list_command: mocks.listentogether_sync_list_command,
  },
}));
vi.mock("../../clients/neteaseClient", () => ({
  neteaseClient: {
    getTracksByIds: mocks.getTracksByIds,
  },
}));
vi.mock("../../store", () => ({
  readStore: mocks.readStore,
}));
vi.mock("../../clients/neteaseIdentity", () => ({
  withNeteaseIdentity: async <T extends Record<string, unknown>>(q: T) => q,
}));
vi.mock("../../services/neteaseService", () => ({
  getNeteaseAccountSummary: mocks.getAccount,
}));

import {
  extractInboxListenTogetherInvites,
  getListenTogetherRoomState,
  resolveShortListenTogetherUrl,
  sendListenTogetherInviteMessage,
  syncListenTogetherPlaylist,
} from "./listenTogether";

describe("NetEase Listen Together invites", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.readStore.mockResolvedValue({ neteaseCookie: "MUSIC_U=test-cookie" });
    mocks.getAccount.mockResolvedValue({
      connected: true,
      userId: "10001",
      nickname: "Tester",
      avatarUrl: "https://p1.music.126.net/avatar.jpg",
      cookiePreview: "MUSIC_U=...",
    });
  });

  it("defaults to song_card when songId is numeric, sending send_song with compact 163cn.tv shortlink", async () => {
    mocks.batch.mockResolvedValue({
      body: {
        "/api/middle/shorturl/generate": {
          code: 200,
          data: { shortUrl: "https://163cn.tv/abc123XY" },
        },
        code: 200,
      },
    });
    mocks.send_song.mockResolvedValue({ body: { code: 200 } });

    const res = await sendListenTogetherInviteMessage({
      targetUserId: "20002",
      roomId: "room_card_test",
      songId: "1844160090",
      songTitle: "Crystal Gravity",
    });

    expect(res).toEqual({ ok: true, modeUsed: "song_card" });
    expect(mocks.send_text).not.toHaveBeenCalled();
    expect(mocks.send_song).toHaveBeenCalledWith({
      id: "1844160090",
      user_ids: "20002",
      msg: "我的耳机分你一半，和我一起听歌吧~ https://163cn.tv/abc123XY",
      cookie: "MUSIC_U=test-cookie",
    });
  });

  it("sends compact copy with short 163cn.tv link via send_text when mode is short_link", async () => {
    mocks.batch.mockResolvedValue({
      body: {
        "/api/middle/shorturl/generate": {
          code: 200,
          data: { shortUrl: "https://163cn.tv/abc123XY" },
        },
        code: 200,
      },
    });
    mocks.send_text.mockResolvedValue({ body: { code: 200 } });

    const res = await sendListenTogetherInviteMessage({
      targetUserId: "20002",
      roomId: "room_short_test",
      songId: "1844160090",
      songTitle: "Crystal Gravity",
      mode: "short_link",
    });

    expect(res).toEqual({ ok: true, modeUsed: "short_link" });
    expect(mocks.send_song).not.toHaveBeenCalled();
    expect(mocks.send_text).toHaveBeenCalledWith({
      user_ids: "20002",
      msg: "我的耳机分你一半，和我一起听歌吧~ https://163cn.tv/abc123XY",
      cookie: "MUSIC_U=test-cookie",
    });
  });

  it("falls back to send_text with canonical shareUrl if shortlink and send_song fail", async () => {
    mocks.batch.mockRejectedValue(new Error("network timeout"));
    mocks.send_song.mockRejectedValue(new Error("card rejected"));
    mocks.send_text.mockResolvedValue({ body: { code: 200 } });

    const res = await sendListenTogetherInviteMessage({
      targetUserId: "20002",
      roomId: "room_fallback_test",
      songId: "1844160090",
    });

    expect(res).toEqual({ ok: true, modeUsed: "short_link" });
    expect(mocks.send_text).toHaveBeenCalledWith({
      user_ids: "20002",
      msg: "我的耳机分你一半，和我一起听歌吧~ https://st.music.163.com/listen-together/share/?roomId=room_fallback_test&inviterId=10001&songId=1844160090",
      cookie: "MUSIC_U=test-cookie",
    });
  });

  it("extracts official type 23 cards and flags 163cn.tv Listen Together invites", () => {
    const native = "orpheus://nm/play/listenTogether?roomId=r_official_1&inviterId=30003&listenTogetherRefer=inbox_invite";
    const cardPayload = JSON.stringify({
      type: 23,
      msg: "我的耳机分你一半，和我一起听歌吧~",
      generalMsg: {
        title: "加入一起听",
        inboxBriefContent: "我的耳机分你一半，和我一起听歌吧~",
        nativeUrl: `orpheus://open?url1=${encodeURIComponent(native)}&url2=${encodeURIComponent("https://st.music.163.com/app-upgrade/index/index.html?type=listenTogether")}`,
      },
    });
    const shortTextPayload = JSON.stringify({
      type: 6,
      msg: "我的耳机分你一半，和我一起听歌吧~ https://163cn.tv/xyz789",
    });

    const parsed = extractInboxListenTogetherInvites(
      {
        msgs: [
          {
            fromUser: { userId: "30003", nickname: "Alice", avatarUrl: "https://p1.music.126.net/a.jpg" },
            toUser: { userId: "10001" },
            lastMsg: cardPayload,
            lastMsgTime: 1_700_000_000_000,
          },
          {
            fromUser: { userId: "40004", nickname: "Bob", avatarUrl: null },
            toUser: { userId: "10001" },
            lastMsg: shortTextPayload,
            lastMsgTime: 1_700_000_050_000,
          },
        ],
      },
      "10001",
    );

    expect(parsed.invites).toEqual([
      {
        roomId: "r_official_1",
        inviterId: "30003",
        songId: null,
        fromUser: { userId: "30003", nickname: "Alice", avatarUrl: "https://p1.music.126.net/a.jpg" },
        message: "我的耳机分你一半，和我一起听歌吧~",
        time: 1_700_000_000_000,
      },
    ]);
    expect(parsed.pendingShortInvites).toEqual([
      {
        shortUrl: "https://163cn.tv/xyz789",
        fromUser: { userId: "40004", nickname: "Bob", avatarUrl: null },
        message: "我的耳机分你一半，和我一起听歌吧~",
        time: 1_700_000_050_000,
      },
    ]);
  });

  it("resolves 163cn.tv redirects only to official music.163.com / orpheus targets", async () => {
    mocks.fetch.mockResolvedValueOnce({
      headers: new Headers({
        location: "https://st.music.163.com/listen-together/share/?roomId=room_short_ok&inviterId=50005&songId=42",
      }),
    });
    await expect(resolveShortListenTogetherUrl("https://163cn.tv/valid01")).resolves.toEqual({
      roomId: "room_short_ok",
      inviterId: "50005",
      songId: "42",
    });

    mocks.fetch.mockResolvedValueOnce({
      headers: new Headers({
        location: "https://evil.example/?roomId=bad&inviterId=1",
      }),
    });
    await expect(resolveShortListenTogetherUrl("https://163cn.tv/evil02")).resolves.toBeNull();
  });

  it("does not collapse sharedTracks to [activeSongId] when displayList is empty, and preserves per-user version increment", async () => {
    mocks.listentogether_status.mockResolvedValue({
      body: {
        code: 200,
        data: {
          inRoom: true,
          roomInfo: {
            roomId: "room_ver_1",
            creatorId: "10001",
            status: "PLAYING",
            roomUsers: [{ userId: "10001", nickname: "Tester", avatarUrl: "" }],
            playInfo: { songId: "1844160090", playStatus: "PLAY", progress: 5000, clientSeq: 2 },
          },
        },
      },
    });
    mocks.listentogether_sync_playlist_get.mockResolvedValue({
      body: {
        code: 200,
        data: {
          playlist: {
            version: [
              { userId: "10001", version: 2 },
              { userId: "20002", version: 5 },
            ],
            displayList: [],
          },
        },
      },
    });
    mocks.getTracksByIds.mockResolvedValue([
      {
        id: "1844160090",
        source: "netease",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        duration: "03:00",
        quality: "FLAC",
        streamUrl: "/api/providers/netease/stream/1844160090",
      },
    ]);

    const state = await getListenTogetherRoomState("room_ver_1", true);
    expect(state.inRoom).toBe(true);
    expect(state.sharedTracks).toEqual([]);
    expect(state.activeTrack?.id).toBe("1844160090");
    expect(state.playlistVersion).toBe(7);

    mocks.listentogether_sync_list_command.mockResolvedValue({ body: { code: 200 } });
    const syncRes = await syncListenTogetherPlaylist({
      roomId: "room_ver_1",
      version: 99,
      displayList: ["111", "222"],
    });
    expect(mocks.listentogether_sync_list_command).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room_ver_1",
        userId: "10001",
        version: 3,
        displayList: "111,222",
      }),
    );
    expect(syncRes).toEqual({ ok: true, version: 8, displayList: ["111", "222"] });
  });
});
