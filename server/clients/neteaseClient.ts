import neteaseApi from "NeteaseCloudMusicApi";
import type { ProviderDailyBundle, ProviderPlaylist, ProviderTrack } from "../providers/musicProvider";
import { getNeteaseAccountSummary } from "../services/neteaseService";
import { readStore } from "../store";
import { HttpError } from "../utils/httpError";
import { remember } from "../utils/memoryCache";

type NeteaseSong = {
  id: number | string;
  name: string;
  ar?: Array<{ name: string }>;
  artists?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
  hr?: unknown;
  sq?: unknown;
  h?: unknown;
};

type NeteasePlaylist = {
  id: number | string;
  name: string;
  trackCount?: number;
  subscribed?: boolean;
  coverImgUrl?: string;
};

export class NeteaseClient {
  async getAccount() {
    return getNeteaseAccountSummary();
  }

  async getLikedTracks() {
    const { cookie, userId } = await this.requireSession();
    return remember(`netease:liked:${userId}`, 60_000, async () => {
      const liked = await neteaseApi.likelist({ uid: userId, cookie });
      const ids = (liked.body?.ids as Array<number | string> | undefined) ?? [];
      if (!ids.length) return [];

      const detailChunks = await Promise.all(
        chunk(ids, 200).map((group) => neteaseApi.song_detail({ ids: group.join(","), cookie })),
      );
      return detailChunks
        .flatMap((details) => (details.body?.songs as NeteaseSong[] | undefined) ?? [])
        .map(normalizeSong);
    });
  }

  async getPlaylists() {
    const { cookie, userId } = await this.requireSession();
    return remember(`netease:playlists:${userId}`, 60_000, async () => {
      const response = await neteaseApi.user_playlist({ uid: userId, cookie, limit: 50 });
      return ((response.body?.playlist as NeteasePlaylist[] | undefined) ?? []).map(normalizePlaylist);
    });
  }

  async getDailyRecommendations(): Promise<ProviderDailyBundle> {
    const { cookie, userId } = await this.requireSession();
    return remember(`netease:daily:${userId}`, 60_000, async () => {
      const response = await neteaseApi.recommend_songs({ cookie });
      const data = response.body?.data as { dailySongs?: NeteaseSong[] } | undefined;
      return {
        date: formatLocalDate(new Date()),
        tracks: (data?.dailySongs ?? []).map(normalizeSong),
        reason: "netease-daily-recommendations",
      };
    });
  }

  async getPrivateRoaming(limit = 18): Promise<ProviderDailyBundle> {
    const { cookie, userId } = await this.requireSession();
    const safeLimit = Math.max(3, Math.min(30, Math.floor(limit)));
    return remember(`netease:roam:${userId}:${safeLimit}`, 20_000, async () => {
      const songs: NeteaseSong[] = [];
      const seen = new Set<string>();
      for (let attempt = 0; attempt < Math.ceil(safeLimit / 3) + 2 && songs.length < safeLimit; attempt += 1) {
        const response = await neteaseApi.personal_fm({ cookie, timestamp: Date.now() + attempt } as never);
        const batch = (response.body?.data as NeteaseSong[] | undefined) ?? [];
        for (const song of batch) {
          const id = String(song.id);
          if (seen.has(id)) continue;
          seen.add(id);
          songs.push(song);
          if (songs.length >= safeLimit) break;
        }
      }
      return {
        date: formatLocalDate(new Date()),
        tracks: songs.map(normalizeSong),
        reason: "netease-private-roaming",
      };
    });
  }

  async getPlaylistTracks(playlistId: string | number) {
    const { cookie } = await this.requireSession();
    return remember(`netease:playlist-tracks:${playlistId}`, 60_000, async () => {
      const response = await neteaseApi.playlist_track_all({
        id: playlistId,
        limit: 200,
        cookie,
      });
      const songs = (response.body?.songs as NeteaseSong[] | undefined) ?? [];
      return songs.map(normalizeSong);
    });
  }

  async getLyrics(songId: string | number) {
    await this.requireSession();
    const response = await neteaseApi.lyric({ id: songId });
    const lyric = (response.body?.lrc as { lyric?: string } | undefined)?.lyric ?? "";
    return parseLrc(lyric);
  }

  async getSongUrl(songId: string | number, level = "lossless") {
    const { cookie } = await this.requireSession();
    const response = await neteaseApi.song_url_v1({
      id: songId,
      level: level as never,
      cookie,
    });
    const data = response.body?.data as Array<{ url?: string | null }> | undefined;
    return data?.[0]?.url ?? null;
  }

  private async requireSession() {
    const store = await readStore();
    if (!store.neteaseCookie) {
      throw new HttpError(401, "Netease cookie is not configured", "NETEASE_COOKIE_REQUIRED");
    }

    const account = await getNeteaseAccountSummary();
    if (!account.userId) {
      throw new HttpError(401, "Netease account is unavailable", "NETEASE_ACCOUNT_UNAVAILABLE");
    }

    return { cookie: store.neteaseCookie, userId: account.userId };
  }
}

function normalizeSong(song: NeteaseSong): ProviderTrack {
  return {
    id: String(song.id),
    title: song.name,
    artist: (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(" / ") || "Unknown Artist",
    album: song.al?.name ?? song.album?.name ?? "Unknown Album",
    duration: Math.round((song.dt ?? song.duration ?? 0) / 1000),
    quality: song.hr ? "Hi-Res" : song.sq ? "Lossless" : song.h ? "320K" : "320K",
    source: "netease",
    streamUrl: `/api/providers/netease/tracks/${song.id}/stream`,
    coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
  };
}

function normalizePlaylist(playlist: NeteasePlaylist): ProviderPlaylist {
  return {
    id: String(playlist.id),
    name: playlist.name,
    trackCount: playlist.trackCount ?? 0,
    subscribed: Boolean(playlist.subscribed),
    coverColor: "#d85f6a",
    coverUrl: playlist.coverImgUrl ?? null,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLrc(lyric: string) {
  return lyric
    .split("\n")
    .map((line) => {
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.\d+)?\](.*)$/);
      if (!match) return null;
      const text = match[3].trim();
      if (!text) return null;
      return {
        time: `${match[1]}:${match[2]}`,
        text,
      };
    })
    .filter((line): line is { time: string; text: string } => Boolean(line));
}

export const neteaseClient = new NeteaseClient();
