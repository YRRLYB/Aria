import neteaseApi from "NeteaseCloudMusicApi";
import type { ProviderArtist, ProviderDailyBundle, ProviderPlaylist, ProviderTrack } from "../providers/musicProvider";
import { getNeteaseAccountSummary } from "../services/neteaseService";
import { readStore } from "../store";
import { HttpError } from "../utils/httpError";
import { clearCache, remember } from "../utils/memoryCache";
import { clearPersistent, rememberPersistent } from "../utils/persistentCache";

type NeteaseSong = {
  id: number | string;
  name: string;
  ar?: Array<{ name: string }>;
  artists?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
  l?: NeteaseQualityInfo | null;
  m?: NeteaseQualityInfo | null;
  hr?: NeteaseQualityInfo | null;
  sq?: NeteaseQualityInfo | null;
  h?: NeteaseQualityInfo | null;
  jymaster?: NeteaseQualityInfo | null;
};

type NeteaseQualityInfo = {
  br?: number;
  bitrate?: number;
  sr?: number;
  sampleRate?: number;
};

type NeteasePlaylist = {
  id: number | string;
  name: string;
  trackCount?: number;
  subscribed?: boolean;
  coverImgUrl?: string;
};

type NeteaseArtist = {
  id: number | string;
  name: string;
  picUrl?: string | null;
  img1v1Url?: string | null;
  musicSize?: number;
  albumSize?: number;
};

type NeteaseTrackId = {
  id?: number | string;
  time?: number;
  t?: number;
  at?: number;
};

const shortTtl = 5 * 60_000;
const dayTtl = 24 * 60 * 60_000;
const weekTtl = 7 * dayTtl;
const qualityOrder = ["standard", "higher", "exhigh", "lossless", "hires", "jymaster"] as const;

type QualityLevel = (typeof qualityOrder)[number];

type NeteaseStreamMeta = {
  url: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  size: number | null;
  quality: ProviderTrack["quality"];
  currentLevel: QualityLevel | null;
  availableLevels: QualityLevel[];
};

export class NeteaseClient {
  async getAccount() {
    return getNeteaseAccountSummary();
  }

  async getLikedTracks() {
    const { cookie, userId } = await this.requireSession();
    const tracks = await rememberPersistent(`netease:liked:${userId}`, shortTtl, async () => {
      const liked = await neteaseApi.likelist({ uid: userId, cookie });
      const ids = (liked.body?.ids as Array<number | string> | undefined) ?? [];
      if (!ids.length) return [];
      const likedAtById = await this.getLikedTimeMap(userId, cookie);

      const detailChunks = await Promise.all(
        chunk(ids, 200).map((group) => neteaseApi.song_detail({ ids: group.join(","), cookie })),
      );
      const orderById = new Map(ids.map((id, index) => [String(id), index]));
      return detailChunks
        .flatMap((details) => (details.body?.songs as NeteaseSong[] | undefined) ?? [])
        .map((song) => normalizeSong(song, { likedAt: likedAtById.get(String(song.id)) ?? null }))
        .sort((left, right) => {
          const byLikedAt = (right.likedAt ?? 0) - (left.likedAt ?? 0);
          if (byLikedAt !== 0) return byLikedAt;
          return (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0);
        });
    });
    return this.attachCachedMetadata(tracks);
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
    const bundle = await rememberPersistent(`netease:daily:${userId}`, shortTtl, async () => {
      const response = await neteaseApi.recommend_songs({ cookie });
      const data = response.body?.data as { dailySongs?: NeteaseSong[] } | undefined;
      return {
        date: formatLocalDate(new Date()),
        tracks: (data?.dailySongs ?? []).map(normalizeSong),
        reason: "netease-daily-recommendations",
      };
    });
    return { ...bundle, tracks: await this.attachCachedMetadata(bundle.tracks) };
  }

  async getPrivateRoaming(limit = 18): Promise<ProviderDailyBundle> {
    const { cookie, userId } = await this.requireSession();
    const safeLimit = Math.max(3, Math.min(30, Math.floor(limit)));
    const bundle = await rememberPersistent(`netease:roam:${userId}:${safeLimit}`, 90_000, async () => {
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
    return { ...bundle, tracks: await this.attachCachedMetadata(bundle.tracks) };
  }

  async getPlaylistTracks(playlistId: string | number) {
    const { cookie } = await this.requireSession();
    const tracks = await rememberPersistent(`netease:playlist-tracks:${playlistId}`, shortTtl, async () => {
      const songs: NeteaseSong[] = [];
      const pageSize = 1000;
      for (let offset = 0; offset < 20_000; offset += pageSize) {
        const response = await neteaseApi.playlist_track_all({
          id: playlistId,
          limit: pageSize,
          offset,
          cookie,
        });
        const batch = (response.body?.songs as NeteaseSong[] | undefined) ?? [];
        songs.push(...batch);
        if (batch.length < pageSize) break;
      }
      return songs.map(normalizeSong);
    });
    return this.attachCachedMetadata(tracks);
  }

  async searchTracks(keywords: string, limit = 24) {
    const { cookie } = await this.requireSession();
    const safeKeywords = keywords.trim().slice(0, 120);
    if (!safeKeywords) return [];
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const tracks = await rememberPersistent(`netease:search:tracks:${safeKeywords}:${safeLimit}`, 5 * 60_000, async () => {
      const response = await neteaseApi.cloudsearch({
        keywords: safeKeywords,
        type: 1,
        limit: safeLimit,
        cookie,
      });
      const result = response.body?.result as { songs?: NeteaseSong[] } | undefined;
      return (result?.songs ?? []).map(normalizeSong);
    });
    return this.attachCachedMetadata(tracks);
  }

  async searchArtists(keywords: string, limit = 18) {
    const { cookie } = await this.requireSession();
    const safeKeywords = keywords.trim().slice(0, 120);
    if (!safeKeywords) return [];
    const safeLimit = Math.max(1, Math.min(40, Math.floor(limit)));
    return rememberPersistent(`netease:search:artists:${safeKeywords}:${safeLimit}`, dayTtl, async () => {
      const response = await neteaseApi.cloudsearch({
        keywords: safeKeywords,
        type: 100,
        limit: safeLimit,
        cookie,
      });
      const result = response.body?.result as { artists?: NeteaseArtist[] } | undefined;
      return (result?.artists ?? []).map(normalizeArtist);
    });
  }

  async getArtistTopTracks(artistId: string | number) {
    const { cookie } = await this.requireSession();
    const tracks = await rememberPersistent(`netease:artist-top:${artistId}`, dayTtl, async () => {
      const response = await neteaseApi.artist_top_song({ id: artistId, cookie });
      const songs = (response.body?.songs as NeteaseSong[] | undefined) ?? [];
      return songs.slice(0, 60).map(normalizeSong);
    });
    return this.attachCachedMetadata(tracks);
  }

  async getLyrics(songId: string | number) {
    await this.requireSession();
    return this.getLyricsCached(songId);
  }

  async getSongUrl(songId: string | number, level = "lossless") {
    const { cookie } = await this.requireSession();
    const meta = await this.getSongUrlCached(songId, level as QualityLevel, cookie);
    return meta.url;
  }

  async getStreamMeta(songId: string | number, level = "lossless") {
    const { cookie } = await this.requireSession();
    return this.getSongUrlCached(songId, level as QualityLevel, cookie);
  }

  async setLike(songId: string | number, liked: boolean) {
    const { cookie, userId } = await this.requireSession();
    const likeFn = (neteaseApi as unknown as { like?: (query: Record<string, unknown>) => Promise<unknown> }).like;
    if (!likeFn) throw new HttpError(500, "Netease like API is unavailable", "NETEASE_LIKE_UNAVAILABLE");
    await likeFn({ id: songId, like: liked, cookie, timestamp: Date.now() });
    clearCache(`netease:liked:${userId}`);
    await clearPersistent(`netease:liked:${userId}`);
    await clearPersistent(`netease:liked-times:${userId}`);
    return { ok: true, liked };
  }

  async warmupTracks(songIds: Array<string | number>, level = "lossless") {
    const { cookie } = await this.requireSession();
    const uniqueIds = Array.from(new Set(songIds.map(String).filter(Boolean))).slice(0, 160);
    let cached = 0;
    await promisePool(uniqueIds, 4, async (songId) => {
      await Promise.allSettled([this.getLyricsCached(songId), this.getSongUrlCached(songId, level, cookie)]);
      cached += 1;
    });
    return cached;
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

  private async getLikedTimeMap(userId: string | number, cookie: string) {
    return rememberPersistent(`netease:liked-times:${userId}`, shortTtl, async () => {
      const playlists = await neteaseApi.user_playlist({ uid: userId, cookie, limit: 1 });
      const likedPlaylist = ((playlists.body?.playlist as NeteasePlaylist[] | undefined) ?? [])[0];
      if (!likedPlaylist?.id) return {} as Record<string, number>;

      const detail = await neteaseApi.playlist_detail({ id: likedPlaylist.id, cookie });
      const trackIds = ((detail.body?.playlist as { trackIds?: NeteaseTrackId[] } | undefined)?.trackIds ?? []);
      return trackIds.reduce<Record<string, number>>((result, item) => {
        if (!item.id) return result;
        const likedAt = item.time ?? item.at ?? item.t;
        if (typeof likedAt === "number" && likedAt > 0) result[String(item.id)] = likedAt;
        return result;
      }, {});
    }).then((items) => new Map(Object.entries(items)));
  }

  private async attachCachedMetadata(tracks: ProviderTrack[]) {
    return tracks.map((track) => ({ ...track, bpm: null }));
  }

  private async getLyricsCached(songId: string | number) {
    return rememberPersistent(`netease:lyrics:${songId}`, weekTtl, async () => {
      const response = await neteaseApi.lyric({ id: songId });
      const lyric = (response.body?.lrc as { lyric?: string } | undefined)?.lyric ?? "";
      return parseLrc(lyric);
    });
  }

  private async getSongUrlCached(songId: string | number, level: QualityLevel, cookie: string) {
    return rememberPersistent(`netease:url:${songId}:${level}`, 25 * 60_000, async () => {
      const song = await this.getSongDetailCached(songId, cookie);
      const response = await neteaseApi.song_url_v1({
        id: songId,
        level: level as never,
        cookie,
      });
      const data = response.body?.data as
        | Array<{
            url?: string | null;
            br?: number;
            sr?: number;
            size?: number;
            level?: string;
          }>
        | undefined;
      const stream = data?.[0];
      const actualLevel = normalizeLevel(stream?.level);
      return {
        url: stream?.url ?? null,
        bitrate: normalizeBitrate(stream?.br),
        sampleRate: normalizeSampleRate(stream?.sr),
        size: typeof stream?.size === "number" ? Math.round(stream.size) : null,
        quality: qualityFromLevel(actualLevel),
        currentLevel: actualLevel,
        availableLevels: availableLevelsFromSong(song),
      } satisfies NeteaseStreamMeta;
    });
  }

  private async getSongDetailCached(songId: string | number, cookie: string) {
    return rememberPersistent(`netease:song-detail:${songId}`, dayTtl, async () => {
      const detail = await neteaseApi.song_detail({ ids: String(songId), cookie });
      const song = (detail.body?.songs as NeteaseSong[] | undefined)?.[0];
      if (!song) throw new HttpError(404, "Track detail is unavailable", "NETEASE_TRACK_DETAIL_UNAVAILABLE");
      return song;
    });
  }
}

function normalizeSong(song: NeteaseSong, extra: Partial<ProviderTrack> = {}): ProviderTrack {
  const availableLevels = availableLevelsFromSong(song);
  const currentLevel = extra.currentLevel ?? availableLevels[availableLevels.length - 1] ?? null;
  const qualityInfo = qualityInfoForLevel(song, currentLevel) ?? song.hr ?? song.sq ?? song.h ?? song.m ?? song.l ?? null;
  return {
    id: String(song.id),
    title: song.name,
    artist: (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(" / ") || "Unknown Artist",
    album: song.al?.name ?? song.album?.name ?? "Unknown Album",
    duration: Math.round((song.dt ?? song.duration ?? 0) / 1000),
    quality: qualityFromLevel(currentLevel),
    source: "netease",
    streamUrl: `/api/providers/netease/tracks/${song.id}/stream`,
    coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
    likedAt: extra.likedAt ?? null,
    bpm: null,
    bitrate: extra.bitrate ?? normalizeBitrate(qualityInfo?.br ?? qualityInfo?.bitrate),
    sampleRate: extra.sampleRate ?? normalizeSampleRate(qualityInfo?.sr ?? qualityInfo?.sampleRate),
    currentLevel,
    availableLevels,
  };
}

function availableLevelsFromSong(song: NeteaseSong): QualityLevel[] {
  return qualityOrder.filter((level) => {
    switch (level) {
      case "standard":
        return Boolean(song.l);
      case "higher":
        return Boolean(song.m);
      case "exhigh":
        return Boolean(song.h);
      case "lossless":
        return Boolean(song.sq);
      case "hires":
        return Boolean(song.hr);
      case "jymaster":
        return Boolean(song.jymaster);
      default:
        return false;
    }
  });
}

function qualityInfoForLevel(song: NeteaseSong, level: QualityLevel | null | undefined) {
  switch (level) {
    case "standard":
      return song.l;
    case "higher":
      return song.m;
    case "exhigh":
      return song.h;
    case "lossless":
      return song.sq;
    case "hires":
      return song.hr;
    case "jymaster":
      return song.jymaster;
    default:
      return song.hr ?? song.sq ?? song.h ?? song.m ?? song.l ?? song.jymaster ?? null;
  }
}

function normalizeLevel(value?: string | null): QualityLevel | null {
  if (!value) return null;
  if (qualityOrder.includes(value as QualityLevel)) return value as QualityLevel;
  return null;
}

function qualityFromLevel(level: QualityLevel | null | undefined): ProviderTrack["quality"] {
  switch (level) {
    case "hires":
    case "jymaster":
      return "Hi-Res";
    case "lossless":
      return "Lossless";
    default:
      return "320K";
  }
}

function normalizeBitrate(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  return value > 10_000 ? Math.round(value) : Math.round(value * 1000);
}

function normalizeSampleRate(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  return Math.round(value);
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

function normalizeArtist(artist: NeteaseArtist): ProviderArtist {
  return {
    id: String(artist.id),
    name: artist.name,
    source: "netease",
    avatarUrl: artist.img1v1Url ?? artist.picUrl ?? null,
    trackCount: artist.musicSize ?? null,
    albumCount: artist.albumSize ?? null,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function promisePool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
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
