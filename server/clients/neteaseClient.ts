import type { ProviderDailyBundle, ProviderPlaylist, ProviderTrack } from "../providers/musicProvider";
import { readStore } from "../store";
import { HttpError } from "../utils/httpError";
import { remember } from "../utils/memoryCache";
import { getNeteaseAccountSummary } from "../services/neteaseService";

const mockLikedTracks: ProviderTrack[] = [
  {
    id: "netease-liked-1",
    title: "Mirror Drive",
    artist: "Lin & The Satellites",
    album: "Chrome Sleep",
    duration: 222,
    quality: "FLAC",
    source: "netease",
  },
  {
    id: "netease-liked-2",
    title: "After Rain Session",
    artist: "Northline",
    album: "Room Tone",
    duration: 238,
    quality: "320K",
    source: "netease",
  },
];

const mockPlaylists: ProviderPlaylist[] = [
  {
    id: "netease-playlist-liked",
    name: "我喜欢的音乐",
    trackCount: 382,
    subscribed: false,
    coverColor: "#d85f6a",
  },
  {
    id: "netease-playlist-collection",
    name: "收藏的歌单",
    trackCount: 96,
    subscribed: true,
    coverColor: "#5976b4",
  },
  {
    id: "netease-playlist-radar",
    name: "私人雷达",
    trackCount: 30,
    subscribed: true,
    coverColor: "#4c9f8f",
  },
];

export class NeteaseClient {
  async getAccount() {
    return getNeteaseAccountSummary();
  }

  async getLikedTracks() {
    await this.requireCookie();
    return remember("netease:liked", 60_000, async () => mockLikedTracks);
  }

  async getPlaylists() {
    await this.requireCookie();
    return remember("netease:playlists", 60_000, async () => mockPlaylists);
  }

  async getDailyRecommendations(): Promise<ProviderDailyBundle> {
    await this.requireCookie();
    return remember("netease:daily", 60_000, async () => ({
      date: new Date().toISOString().slice(0, 10),
      tracks: mockLikedTracks,
      reason: "基于最近播放与红心歌曲生成",
    }));
  }

  private async requireCookie() {
    const store = await readStore();
    if (!store.neteaseCookie) {
      throw new HttpError(401, "Netease cookie is not configured", "NETEASE_COOKIE_REQUIRED");
    }
    return store.neteaseCookie;
  }
}

export const neteaseClient = new NeteaseClient();
