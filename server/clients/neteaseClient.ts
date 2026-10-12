import neteaseApi from "NeteaseCloudMusicApi";
import sharp from "sharp";
import type {
  NeteaseSearchMode,
  NeteaseSearchResults,
  ProviderAlbum,
  ProviderArtist,
  ProviderDailyBundle,
  ProviderPlaylist,
  ProviderRoamOptions,
  ProviderTrack,
  ProviderUser,
} from "../providers/musicProvider";
import { getNeteaseAccountSummary } from "../services/neteaseService";
import { readStore } from "../store";
import { HttpError } from "../utils/httpError";
import { quantizeBitrate } from "../utils/bitrate";
import { clearCache, remember } from "../utils/memoryCache";
import { clearPersistent, rememberPersistent, setPersistent } from "../utils/persistentCache";

type NeteaseSong = {
  id: number | string;
  name: string;
  ar?: Array<{ id?: number | string; name: string }>;
  artists?: Array<{ id?: number | string; name: string }>;
  al?: { id?: number | string; name?: string; picUrl?: string };
  album?: { id?: number | string; name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
  lyrics?: string[] | string;
  l?: NeteaseQualityInfo | null;
  m?: NeteaseQualityInfo | null;
  hr?: NeteaseQualityInfo | null;
  sq?: NeteaseQualityInfo | null;
  h?: NeteaseQualityInfo | null;
  jymaster?: NeteaseQualityInfo | null;
  privilege?: {
    maxbr?: number;
    playMaxbr?: number;
    maxBrLevel?: string;
    playMaxBrLevel?: string;
  };
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
  userId?: number | string;
  creator?: { userId?: number | string; nickname?: string } | null;
  description?: string | null;
  tags?: string[];
  specialType?: number;
  trackIds?: NeteaseTrackId[];
  privacy?: number;
};

type NeteaseArtist = {
  id: number | string;
  name: string;
  picUrl?: string | null;
  img1v1Url?: string | null;
  musicSize?: number;
  albumSize?: number;
  cover?: string;
  avatar?: string;
  briefDesc?: string;
};

type NeteaseUser = {
  userId: number | string;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
  playlistCount?: number;
  followeds?: number;
  follows?: number;
};

type NeteaseAlbum = {
  id: number | string;
  name: string;
  artist?: { id?: number | string; name?: string };
  artists?: Array<{ id?: number | string; name?: string }>;
  picUrl?: string;
  publishTime?: number;
  size?: number;
  description?: string;
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
const maxLikedTracks = 2000;
const maxPlaylistTracks = 5000;

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
    const tracks = await rememberPersistent(`netease:liked:v2:${userId}`, shortTtl, async () => {
      const liked = await neteaseApi.likelist({ uid: userId, cookie });
      const ids = ((liked.body?.ids as Array<number | string> | undefined) ?? []).slice(0, maxLikedTracks);
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
    return remember(`netease:playlists:v2:${userId}`, 60_000, async () => {
      const pageSize = 100;
      const playlists: NeteasePlaylist[] = [];
      for (let offset = 0; offset < 500; offset += pageSize) {
        const body = await callNetease("user_playlist", { uid: userId, cookie, limit: pageSize, offset });
        const batch = (body.playlist as NeteasePlaylist[] | undefined) ?? [];
        playlists.push(...batch);
        if (batch.length < pageSize) break;
      }
      return playlists.map((playlist) => normalizePlaylist(playlist, userId));
    });
  }

  async createPlaylist(name: string, isPrivate = false): Promise<ProviderPlaylist> {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 40) {
      throw new HttpError(400, "歌单名称需要 1–40 个字符", "NETEASE_PLAYLIST_NAME_INVALID");
    }
    const { cookie, userId } = await this.requireSession();
    const response = await neteaseApi.playlist_create({
      name: trimmedName,
      privacy: isPrivate ? 10 : 0,
      cookie,
    }).catch((error: unknown) => {
      const upstream = error as { body?: { message?: string; msg?: string } } | null;
      throw new HttpError(
        502,
        upstream?.body?.message || upstream?.body?.msg || "网易云请求失败，请检查登录状态后重试",
        "NETEASE_PLAYLIST_CREATE_FAILED",
      );
    });
    const body = response.body as { code?: number; message?: string; msg?: string; playlist?: NeteasePlaylist } | undefined;
    if (body?.code !== 200 || !body.playlist?.id) {
      throw new HttpError(
        502,
        body?.message || body?.msg || "网易云暂时无法创建歌单，请稍后重试",
        "NETEASE_PLAYLIST_CREATE_FAILED",
      );
    }
    clearCache(`netease:playlists:v2:${userId}`);
    return normalizePlaylist({ ...body.playlist, userId, subscribed: false }, userId);
  }

  async getDailyRecommendations(): Promise<ProviderDailyBundle> {
    const { cookie, userId } = await this.requireSession();
    const bundle = await rememberPersistent(`netease:daily:v2:${userId}`, shortTtl, async () => {
      const response = await neteaseApi.recommend_songs({ cookie });
      const data = response.body?.data as { dailySongs?: NeteaseSong[] } | undefined;
      return {
        date: formatLocalDate(new Date()),
        tracks: (data?.dailySongs ?? []).map((song) => normalizeSong(song)),
        reason: "netease-daily-recommendations",
      };
    });
    return { ...bundle, tracks: await this.attachCachedMetadata(bundle.tracks) };
  }

  async getPrivateRoaming(limit = 18, options: ProviderRoamOptions = {}): Promise<ProviderDailyBundle> {
    const { cookie, userId } = await this.requireSession();
    const safeLimit = Math.max(3, Math.min(30, Math.floor(limit)));
    // v3 resolves original stream quality by default and keeps master
    // enhancement opt-in. Older bundles could label unplayed rows as master.
    const cacheKey = `netease:roam:v3:${userId}:${safeLimit}`;
    const excluded = new Set((options.excludeIds ?? []).map((id) => String(id)));
    const loadRoamBundle = async () => {
      const tracks: ProviderTrack[] = [];
      const seen = new Set<string>(excluded);
      const pushSong = (song: NeteaseSong) => {
        const id = String(song.id);
        if (seen.has(id)) return;
        seen.add(id);
        tracks.push(normalizeSong(song));
      };

      const maxAttempts = Math.max(8, Math.ceil(safeLimit / 3) + 6);
      for (let attempt = 0; attempt < maxAttempts && tracks.length < safeLimit; attempt += 1) {
        const response = await neteaseApi.personal_fm({ cookie, timestamp: Date.now() + attempt } as never);
        const batch = (response.body?.data as NeteaseSong[] | undefined) ?? [];
        for (const song of batch) {
          pushSong(song);
          if (tracks.length >= safeLimit) break;
        }
      }

      if (tracks.length < safeLimit) {
        const response = await neteaseApi.recommend_songs({ cookie, timestamp: Date.now() } as never);
        const data = response.body?.data as { dailySongs?: NeteaseSong[] } | undefined;
        for (const song of shuffleSongs(data?.dailySongs ?? [])) {
          pushSong(song);
          if (tracks.length >= safeLimit) break;
        }
      }

      const enrichedTracks = await this.attachRoamStreamMetadata(tracks, cookie);
      return {
        date: formatLocalDate(new Date()),
        tracks: enrichedTracks,
        reason: "netease-private-roaming",
      };
    };

    const bundle = options.refresh
      ? await loadRoamBundle().then(async (freshBundle) => {
          await setPersistent(cacheKey, 90_000, freshBundle);
          return freshBundle;
        })
      : await rememberPersistent(cacheKey, 90_000, loadRoamBundle);
    return { ...bundle, tracks: await this.attachCachedMetadata(bundle.tracks) };
  }

  async getPlaylistTracks(playlistId: string | number) {
    // Public playlist details can be read without linking an account. This
    // keeps a playlist found through search actionable for new users.
    const cookie = await this.getOptionalCookie();
    const userId = await this.getOptionalUserId();
    const tracks = await rememberPersistent(`netease:playlist-tracks:v3:${playlistId}:${userId ?? "public"}`, shortTtl, async () => {
      const songs: NeteaseSong[] = [];
      const pageSize = 1000;
      for (let offset = 0; offset < maxPlaylistTracks; offset += pageSize) {
        const body = await callNetease("playlist_track_all", {
          id: playlistId,
          limit: pageSize,
          offset,
          cookie,
        });
        const batch = (body.songs as NeteaseSong[] | undefined) ?? [];
        songs.push(...batch.slice(0, maxPlaylistTracks - songs.length));
        if (batch.length < pageSize || songs.length >= maxPlaylistTracks) break;
      }
      return songs.map((song) => normalizeSong(song));
    });
    return this.attachCachedMetadata(tracks);
  }

  async searchTracks(keywords: string, limit = 24) {
    // Public cloudsearch results do not require an account. Keep search useful
    // before the user links NetEase; playback and private data still use
    // requireSession below.
    const cookie = await this.getOptionalCookie();
    const safeKeywords = keywords.trim().slice(0, 120);
    if (!safeKeywords) return [];
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const tracks = await rememberPersistent(`netease:search:tracks:v2:${safeKeywords}:${safeLimit}`, 5 * 60_000, async () => {
      const response = await neteaseApi.cloudsearch({
        keywords: safeKeywords,
        type: 1,
        limit: safeLimit,
        cookie,
      });
      const result = response.body?.result as { songs?: NeteaseSong[] } | undefined;
      return (result?.songs ?? []).map((song) => normalizeSong(song));
    });
    return this.attachCachedMetadata(tracks);
  }

  async searchArtists(keywords: string, limit = 18) {
    const cookie = await this.getOptionalCookie();
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

  /** Search public playlists through NetEase's cloudsearch endpoint. */
  async searchPlaylists(keywords: string, limit = 18) {
    const cookie = await this.getOptionalCookie();
    const safeKeywords = keywords.trim().slice(0, 120);
    if (!safeKeywords) return [];
    const safeLimit = Math.max(1, Math.min(40, Math.floor(limit)));
    return rememberPersistent(`netease:search:playlists:${safeKeywords}:${safeLimit}`, shortTtl, async () => {
      const response = await neteaseApi.cloudsearch({
        keywords: safeKeywords,
        type: 1000,
        limit: safeLimit,
        cookie,
      });
      const result = response.body?.result as { playlists?: NeteasePlaylist[] } | undefined;
      return (result?.playlists ?? []).map((playlist) => normalizePlaylist(playlist));
    });
  }

  async getArtistTopTracks(artistId: string | number) {
    const cookie = await this.getOptionalCookie();
    const tracks = await rememberPersistent(`netease:artist-top:v2:${artistId}`, dayTtl, async () => {
      const response = await neteaseApi.artist_top_song({ id: artistId, cookie });
      const songs = (response.body?.songs as NeteaseSong[] | undefined) ?? [];
      return songs.slice(0, 60).map((song) => normalizeSong(song));
    });
    return this.attachCachedMetadata(tracks);
  }

  /** Query one result category, avoiding six provider requests per keystroke. */
  async search(keywords: string, mode: NeteaseSearchMode, limit = 24, offset = 0): Promise<NeteaseSearchResults> {
    const query = keywords.trim().slice(0, 120);
    const empty: NeteaseSearchResults = { query, mode, tracks: [], artists: [], playlists: [], users: [], albums: [], total: 0 };
    if (!query) return empty;
    const cookie = await this.getOptionalCookie();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.min(1000, Math.floor(offset)));
    const type = { tracks: 1, artists: 100, playlists: 1000, users: 1002, albums: 10, lyrics: 1006 }[mode];
    return remember(`netease:search:mode:${mode}:${query}:${safeLimit}:${safeOffset}`, shortTtl, async () => {
      const body = await callNetease("cloudsearch", { keywords: query, type, limit: safeLimit, offset: safeOffset, cookie });
      const result = (body.result ?? {}) as Record<string, unknown>;
      switch (mode) {
        case "tracks":
        case "lyrics": {
          const tracks = ((result.songs as NeteaseSong[] | undefined) ?? []).map((song) => normalizeSong(song));
          return { ...empty, tracks, total: Number(result.songCount ?? tracks.length) };
        }
        case "artists": {
          const artists = ((result.artists as NeteaseArtist[] | undefined) ?? []).map(normalizeArtist);
          return { ...empty, artists, total: Number(result.artistCount ?? artists.length) };
        }
        case "playlists": {
          const playlists = ((result.playlists as NeteasePlaylist[] | undefined) ?? []).map((playlist) => normalizePlaylist(playlist));
          return { ...empty, playlists, total: Number(result.playlistCount ?? playlists.length) };
        }
        case "users": {
          const users = ((result.userprofiles as NeteaseUser[] | undefined) ?? []).map(normalizeUser);
          return { ...empty, users, total: Number(result.userprofileCount ?? result.userCount ?? users.length) };
        }
        case "albums": {
          const albums = ((result.albums as NeteaseAlbum[] | undefined) ?? []).map(normalizeAlbum);
          return { ...empty, albums, total: Number(result.albumCount ?? albums.length) };
        }
      }
    });
  }

  async getSearchSuggestions(keywords: string) {
    const query = keywords.trim().slice(0, 120);
    if (!query) return [];
    const cookie = await this.getOptionalCookie();
    return remember(`netease:suggest:${query}`, shortTtl, async () => {
      const body = await callNetease("search_suggest", { keywords: query, type: "mobile", cookie });
      const result = body.result as { allMatch?: Array<{ keyword?: string }> } | undefined;
      return Array.from(new Set((result?.allMatch ?? []).map((item) => item.keyword ?? "").filter(Boolean))).slice(0, 8);
    });
  }

  async getUserDetail(userId: string) {
    assertNeteaseId(userId);
    const cookie = await this.getOptionalCookie();
    return remember(`netease:user:${userId}`, shortTtl, async () => {
      const body = await callNetease("user_detail", { uid: userId, cookie });
      const profile = body.profile as NeteaseUser | undefined;
      if (!profile?.userId) throw new HttpError(404, "该用户不存在或资料暂不可访问", "NETEASE_USER_UNAVAILABLE");
      return normalizeUser({ ...profile, playlistCount: Number(body.playlistCount ?? profile.playlistCount ?? 0) });
    });
  }

  async getUserPlaylists(userId: string, limit = 100, offset = 0) {
    assertNeteaseId(userId);
    const cookie = await this.getOptionalCookie();
    const currentUserId = await this.getOptionalUserId();
    return remember(`netease:user-playlists:${userId}:${currentUserId ?? "public"}:${limit}:${offset}`, 60_000, async () => {
      const body = await callNetease("user_playlist", { uid: userId, limit, offset, cookie });
      // Respect visibility: never synthesize private playlists from cached data.
      const playlists = ((body.playlist as NeteasePlaylist[] | undefined) ?? [])
        .filter((playlist) => playlist.privacy !== 10 || String(playlist.creator?.userId ?? playlist.userId) === currentUserId)
        .map((playlist) => normalizePlaylist(playlist, currentUserId ?? undefined));
      return { playlists, more: Boolean(body.more) };
    });
  }

  async getAlbum(albumId: string) {
    assertNeteaseId(albumId);
    const cookie = await this.getOptionalCookie();
    return remember(`netease:album:${albumId}`, dayTtl, async () => {
      const body = await callNetease("album", { id: albumId, cookie });
      const album = body.album as NeteaseAlbum | undefined;
      if (!album?.id) throw new HttpError(404, "该专辑暂不可访问", "NETEASE_ALBUM_UNAVAILABLE");
      return { album: normalizeAlbum(album), tracks: ((body.songs as NeteaseSong[] | undefined) ?? []).map((song) => normalizeSong(song)) };
    });
  }

  async getArtistDetail(artistId: string) {
    assertNeteaseId(artistId);
    const cookie = await this.getOptionalCookie();
    return remember(`netease:artist-detail:${artistId}`, dayTtl, async () => {
      const body = await callNetease("artist_detail", { id: artistId, cookie });
      const data = body.data as { artist?: NeteaseArtist } | undefined;
      if (!data?.artist?.id) throw new HttpError(404, "该歌手暂不可访问", "NETEASE_ARTIST_UNAVAILABLE");
      // The summary endpoint remains usable when the biography endpoint is restricted.
      let description = data.artist.briefDesc ?? "";
      let sections: Array<{ title: string; text: string }> = [];
      try {
        const biography = await callNetease("artist_desc", { id: artistId, cookie });
        description = String(biography.briefDesc ?? description);
        sections = ((biography.introduction as Array<{ ti?: string; txt?: string }> | undefined) ?? [])
          .map((section) => ({ title: section.ti ?? "", text: section.txt ?? "" })).filter((section) => section.text);
      } catch { /* Optional biography failure does not block the artist summary. */ }
      return { artist: normalizeArtist(data.artist), description, sections };
    });
  }

  async getArtistAlbums(artistId: string, limit = 30, offset = 0) {
    assertNeteaseId(artistId);
    const cookie = await this.getOptionalCookie();
    return remember(`netease:artist-albums:${artistId}:${limit}:${offset}`, dayTtl, async () => {
      const body = await callNetease("artist_album", { id: artistId, limit, offset, cookie });
      return { albums: ((body.hotAlbums as NeteaseAlbum[] | undefined) ?? []).map(normalizeAlbum), more: Boolean(body.more) };
    });
  }

  async getPlaylistDetail(playlistId: string) {
    const cookie = await this.getOptionalCookie();
    const currentUserId = await this.getOptionalUserId();
    const detail = await this.loadPlaylist(playlistId, cookie);
    return { playlist: normalizePlaylist(detail, currentUserId ?? undefined), tracks: await this.getPlaylistTracks(playlistId) };
  }

  async updatePlaylist(playlistId: string, changes: { name?: string; description?: string; tags?: string[] }) {
    if (changes.name !== undefined && (!changes.name.trim() || changes.name.trim().length > 40)) {
      throw new HttpError(400, "歌单名称需要 1–40 个字符", "NETEASE_PLAYLIST_NAME_INVALID");
    }
    if (changes.description !== undefined && changes.description.length > 1000) {
      throw new HttpError(400, "歌单介绍最多 1000 个字符", "NETEASE_PLAYLIST_DESCRIPTION_INVALID");
    }
    const { cookie, userId, playlist } = await this.requireOwnedPlaylist(playlistId);
    if (playlist.specialType === 5) throw new HttpError(403, "我喜欢的音乐由网易云管理，不能修改名称或封面", "NETEASE_PLAYLIST_SPECIAL");
    try {
      if (changes.name !== undefined) await callNetease("playlist_name_update", { id: playlistId, name: changes.name.trim(), cookie, timestamp: Date.now() });
      if (changes.description !== undefined) await callNetease("playlist_desc_update", { id: playlistId, desc: changes.description, cookie, timestamp: Date.now() });
      if (changes.tags !== undefined) await callNetease("playlist_tags_update", { id: playlistId, tags: changes.tags.join(";"), cookie, timestamp: Date.now() });
    } finally {
      await this.invalidatePlaylist(playlistId, userId);
    }
    return { playlist: normalizePlaylist(await this.loadPlaylist(playlistId, cookie), userId) };
  }

  async editPlaylistTracks(playlistId: string, trackIds: string[], operation: "add" | "del") {
    const ids = checkedTrackIds(trackIds);
    const { cookie, userId } = await this.requireOwnedPlaylist(playlistId);
    try {
      // The bundled module wraps a successful response in body.body. callNetease
      // unwraps it, and still rejects an inner 403/512 instead of claiming success.
      await callNetease("playlist_tracks", { pid: playlistId, tracks: ids.join(","), op: operation, cookie, timestamp: Date.now() });
    } finally {
      await this.invalidatePlaylist(playlistId, userId);
    }
    return { ok: true as const };
  }

  async reorderPlaylistTracks(playlistId: string, trackIds: string[]) {
    const ids = checkedTrackIds(trackIds, maxPlaylistTracks);
    const { cookie, userId, playlist } = await this.requireOwnedPlaylist(playlistId);
    const currentIds = (playlist.trackIds ?? []).map((track) => String(track.id));
    const currentSet = new Set(currentIds);
    if (ids.length !== currentIds.length || currentIds.length !== (playlist.trackCount ?? currentIds.length) || ids.some((id) => !currentSet.has(id))) {
      throw new HttpError(409, "歌单已更新，请重新打开后再排序；排序需包含全部歌曲", "NETEASE_PLAYLIST_ORDER_STALE");
    }
    try {
      await callNetease("song_order_update", { pid: playlistId, ids: JSON.stringify(ids), cookie, timestamp: Date.now() });
    } finally {
      await this.invalidatePlaylist(playlistId, userId);
    }
    return { ok: true as const };
  }

  async uploadPlaylistCover(playlistId: string, image: Buffer) {
    if (!image.length || image.length > 8 * 1024 * 1024) throw new HttpError(400, "封面图片需要小于 8 MB", "NETEASE_COVER_SIZE_INVALID");
    const { cookie, userId, playlist } = await this.requireOwnedPlaylist(playlistId);
    if (playlist.specialType === 5) throw new HttpError(403, "我喜欢的音乐的封面由网易云管理", "NETEASE_PLAYLIST_SPECIAL");
    let jpeg: Buffer;
    try {
      jpeg = await sharp(image, { limitInputPixels: 40_000_000, animated: false }).rotate()
        .resize(1000, 1000, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
    } catch {
      throw new HttpError(400, "无法读取封面图片，请选择 JPG、PNG 或 WebP 图片", "NETEASE_COVER_IMAGE_INVALID");
    }
    let coverUrl: string | undefined;
    try {
      const body = await callNetease("playlist_cover_update", { id: playlistId, imgFile: { name: "aria-playlist-cover.jpg", data: jpeg }, cookie, timestamp: Date.now() });
      coverUrl = (body.data as { url_pre?: string } | undefined)?.url_pre;
    } finally {
      await this.invalidatePlaylist(playlistId, userId);
    }
    const refreshed = normalizePlaylist(await this.loadPlaylist(playlistId, cookie), userId);
    return { playlist: coverUrl ? { ...refreshed, coverUrl } : refreshed };
  }

  async subscribePlaylist(playlistId: string, subscribed: boolean) {
    const { cookie, userId } = await this.requireSession();
    const playlist = await this.loadPlaylist(playlistId, cookie);
    if (String(playlist.creator?.userId ?? playlist.userId) === userId) {
      throw new HttpError(400, "自己的歌单无需收藏", "NETEASE_PLAYLIST_IS_OWNED");
    }
    try {
      await callNetease("playlist_subscribe", { id: playlistId, t: subscribed ? 1 : 2, cookie, timestamp: Date.now() });
    } finally {
      await this.invalidatePlaylist(playlistId, userId);
    }
    return { ok: true as const, subscribed };
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

  async warmupTracks(songIds: Array<string | number>, level: QualityLevel = "lossless") {
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

  private async getOptionalCookie() {
    const store = await readStore();
    return store.neteaseCookie ?? undefined;
  }

  private async getOptionalUserId() {
    if (!(await this.getOptionalCookie())) return null;
    try { return (await getNeteaseAccountSummary()).userId; } catch { return null; }
  }

  private async loadPlaylist(playlistId: string, cookie?: string) {
    assertNeteaseId(playlistId);
    // Always revalidate ownership and metadata with the provider before a write.
    const body = await callNetease("playlist_detail", { id: playlistId, cookie, timestamp: Date.now() });
    const playlist = body.playlist as NeteasePlaylist | undefined;
    if (!playlist?.id) throw new HttpError(404, "歌单不存在或暂不可访问", "NETEASE_PLAYLIST_UNAVAILABLE");
    return playlist;
  }

  private async requireOwnedPlaylist(playlistId: string) {
    const { cookie, userId } = await this.requireSession();
    const playlist = await this.loadPlaylist(playlistId, cookie);
    if (String(playlist.creator?.userId ?? playlist.userId ?? "") !== userId) {
      throw new HttpError(403, "只能编辑自己创建的歌单", "NETEASE_PLAYLIST_NOT_OWNED");
    }
    return { cookie, userId, playlist };
  }

  private async invalidatePlaylist(playlistId: string, userId: string) {
    clearCache(`netease:playlists:v2:${userId}`);
    clearCache(`netease:user-playlists:${userId}:`);
    // Playlist count/subscribed/cover metadata can occur in public search pages.
    clearCache("netease:search:mode:playlists:");
    await Promise.all([
      clearPersistent(`netease:playlist-tracks:v2:${playlistId}`),
      clearPersistent(`netease:playlist-tracks:v3:${playlistId}:`),
      clearPersistent("netease:search:playlists:"),
      clearPersistent(`netease:liked:v2:${userId}`),
      clearPersistent(`netease:liked-times:${userId}`),
    ]);
  }

  private async getLikedTimeMap(userId: string | number, cookie: string) {
    return rememberPersistent(`netease:liked-times:${userId}`, shortTtl, async () => {
      const playlists = await neteaseApi.user_playlist({ uid: userId, cookie, limit: 1 });
      const likedPlaylist = ((playlists.body?.playlist as NeteasePlaylist[] | undefined) ?? [])[0];
      if (!likedPlaylist?.id) return {} as Record<string, number>;

      const detail = await neteaseApi.playlist_detail({ id: likedPlaylist.id, cookie });
      const trackIds = ((detail.body?.playlist as { trackIds?: NeteaseTrackId[] } | undefined)?.trackIds ?? []).slice(
        0,
        maxLikedTracks,
      );
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

  /** Resolve actual stream bitrates for private-roaming rows before rendering. */
  private async attachRoamStreamMetadata(tracks: ProviderTrack[], cookie: string) {
    const enriched = tracks.slice();
    await promisePool(enriched, 3, async (track, index) => {
      // Personal-FM payloads expose a quality bucket whose bitrate can differ
      // from the URL ultimately returned by song_url_v1. Resolve every row so
      // the roaming list never presents the generic 320K bucket as fact.
      const preferredLevel = track.availableLevels?.filter((level) => level !== "jymaster").at(-1) ?? "hires";
      try {
        const meta = await this.getSongUrlCached(track.id, preferredLevel, cookie);
        enriched[index] = {
          ...track,
          quality: meta.currentLevel ? meta.quality : track.quality,
          bitrate: meta.bitrate ?? track.bitrate,
          sampleRate: meta.sampleRate ?? track.sampleRate,
          currentLevel: meta.currentLevel ?? track.currentLevel,
          availableLevels: meta.availableLevels.length ? meta.availableLevels : track.availableLevels,
        };
      } catch {
        // Restricted tracks may reject metadata requests; retain their summary.
      }
    });
    return enriched;
  }

  private async getLyricsCached(songId: string | number) {
    return rememberPersistent(`netease:lyrics:v2:${songId}`, weekTtl, async () => {
      const response = await neteaseApi.lyric({ id: songId });
      const lyric = (response.body?.lrc as { lyric?: string } | undefined)?.lyric ?? "";
      const translation = (response.body?.tlyric as { lyric?: string } | undefined)?.lyric ?? "";
      return parseLrc(lyric, translation);
    });
  }

  private async getSongUrlCached(songId: string | number, level: QualityLevel, cookie: string) {
    return rememberPersistent(`netease:url:v2:${songId}:${level}`, 25 * 60_000, async () => {
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
      const actualLevel = normalizeLevel(stream?.level) ?? (stream?.url ? level : null);
      return {
        url: stream?.url ?? null,
        bitrate: normalizeBitrate(stream?.br),
        sampleRate: normalizeSampleRate(stream?.sr),
        size: typeof stream?.size === "number" ? Math.round(stream.size) : null,
        quality: qualityFromLevel(actualLevel),
        currentLevel: actualLevel,
        availableLevels: uniqueLevels([...availableLevelsFromSong(song), ...(actualLevel ? [actualLevel] : [])]),
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

export function normalizeSong(song: NeteaseSong, extra: Partial<ProviderTrack> = {}): ProviderTrack {
  const availableLevels = availableLevelsFromSong(song);
  const currentLevel = extra.currentLevel ?? availableLevels.filter((level) => level !== "jymaster").at(-1) ?? null;
  const qualityInfo = qualityInfoForLevel(song, currentLevel) ?? song.hr ?? song.sq ?? song.h ?? song.m ?? song.l ?? null;
  return {
    id: String(song.id),
    title: song.name,
    artist: (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(" / ") || "Unknown Artist",
    album: song.al?.name ?? song.album?.name ?? "Unknown Album",
    albumId: song.al?.id != null ? String(song.al.id) : song.album?.id != null ? String(song.album.id) : null,
    artistIds: (song.ar ?? song.artists ?? []).flatMap((artist) => artist.id == null ? [] : [String(artist.id)]),
    matchedLyric: normalizeMatchedLyric(song.lyrics),
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
  const levels = qualityOrder.filter((level) => {
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
  const maxBitrate = Math.max(Number(song.privilege?.maxbr ?? 0), Number(song.privilege?.playMaxbr ?? 0));
  if ((maxBitrate >= 999_000 || song.privilege?.maxBrLevel === "jymaster" || song.privilege?.playMaxBrLevel === "jymaster") && !levels.includes("jymaster")) {
    levels.push("jymaster");
  }
  return levels;
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

export function qualityFromLevel(level: QualityLevel | null | undefined): ProviderTrack["quality"] {
  switch (level) {
    case "jymaster":
      return "臻品";
    case "hires":
      return "Hi-Res";
    case "lossless":
      return "Lossless";
    default:
      return "320K";
  }
}

function normalizeBitrate(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  const bps = value > 10_000 ? Math.round(value) : Math.round(value * 1000);
  return quantizeBitrate(bps);
}

function normalizeSampleRate(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function normalizePlaylist(playlist: NeteasePlaylist, currentUserId?: string): ProviderPlaylist {
  const ownerId = playlist.creator?.userId ?? playlist.userId ?? null;
  const owned = Boolean(currentUserId && ownerId != null && String(ownerId) === String(currentUserId));
  return {
    id: String(playlist.id),
    name: playlist.name,
    trackCount: playlist.trackCount ?? 0,
    subscribed: Boolean(playlist.subscribed),
    ownerId: ownerId == null ? null : String(ownerId),
    owned,
    canEdit: owned && playlist.specialType !== 5,
    coverColor: "#d85f6a",
    coverUrl: playlist.coverImgUrl ?? null,
    description: playlist.description ?? "",
    creatorName: playlist.creator?.nickname ?? "",
    tags: playlist.tags ?? [],
  };
}

function uniqueLevels(levels: QualityLevel[]) {
  return qualityOrder.filter((level) => levels.includes(level));
}

function normalizeArtist(artist: NeteaseArtist): ProviderArtist {
  return {
    id: String(artist.id),
    name: artist.name,
    source: "netease",
    avatarUrl: artist.avatar ?? artist.cover ?? artist.img1v1Url ?? artist.picUrl ?? null,
    trackCount: artist.musicSize ?? null,
    albumCount: artist.albumSize ?? null,
  };
}

function normalizeUser(user: NeteaseUser): ProviderUser {
  return {
    id: String(user.userId), nickname: user.nickname, avatarUrl: user.avatarUrl ?? null,
    signature: user.signature ?? "", playlistCount: user.playlistCount ?? null,
    followCount: user.follows ?? null, followerCount: user.followeds ?? null,
  };
}

function normalizeMatchedLyric(lyrics?: string[] | string): string | null {
  const lines = Array.isArray(lyrics) ? lyrics : lyrics ? [lyrics] : [];
  // Provider matches may contain <b>/<em> emphasis. Return plain text so the
  // renderer never needs to trust provider HTML for a lyric preview.
  const line = lines.find((item) => /<(?:b|em)>/i.test(item)) ?? lines.find((item) => item.trim());
  return line ? line.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim().slice(0, 200) || null : null;
}

function normalizeAlbum(album: NeteaseAlbum): ProviderAlbum {
  const artists = album.artists?.length ? album.artists : album.artist ? [album.artist] : [];
  return {
    id: String(album.id), name: album.name,
    artist: artists.map((artist) => artist.name).filter(Boolean).join(" / ") || "Unknown Artist",
    artistId: (album.artist?.id ?? artists[0]?.id) != null ? String(album.artist?.id ?? artists[0]?.id) : null,
    coverUrl: album.picUrl ?? null, publishTime: album.publishTime ?? null,
    trackCount: album.size ?? null, description: album.description ?? "",
  };
}

function assertNeteaseId(id: string) {
  if (!/^\d{1,20}$/.test(id)) throw new HttpError(400, "网易云资源编号无效", "NETEASE_ID_INVALID");
}

function checkedTrackIds(trackIds: string[], limit = 500) {
  if (!trackIds.length || trackIds.length > limit || new Set(trackIds).size !== trackIds.length) {
    throw new HttpError(400, `请选择 1–${limit} 首不重复的歌曲`, "NETEASE_TRACK_IDS_INVALID");
  }
  trackIds.forEach(assertNeteaseId);
  return trackIds;
}

/** Older NCM modules wrap responses; validate both outer and inner codes. */
async function callNetease(name: string, query: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fn = (neteaseApi as unknown as Record<string, (query: Record<string, unknown>) => Promise<{ body?: Record<string, unknown> }>>)[name];
  if (!fn) throw new HttpError(501, "当前网易云接口不支持该功能", "NETEASE_API_UNAVAILABLE");
  try {
    const response = await fn(query);
    let body = response.body ?? {};
    if (body.body && typeof body.body === "object") body = body.body as Record<string, unknown>;
    checkNeteaseBody(body);
    // playlist_cover_update always wraps code=200, even for a rejected update.
    if (body.data && typeof body.data === "object") checkNeteaseBody(body.data as Record<string, unknown>);
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const upstream = error as { body?: Record<string, unknown>; message?: string } | null;
    if (upstream?.body) checkNeteaseBody(upstream.body);
    throw new HttpError(502, String(upstream?.body?.message ?? upstream?.body?.msg ?? upstream?.message ?? "网易云请求失败，请稍后重试"), "NETEASE_REQUEST_FAILED");
  }
}

function checkNeteaseBody(body: Record<string, unknown>) {
  if (body.code == null || Number(body.code) === 200) return;
  const code = Number(body.code);
  const status = code === 301 || code === 401 ? 401 : code === 403 ? 403 : code === 404 ? 404 : 502;
  const fallback = status === 401 ? "请重新登录网易云" : status === 403 ? "网易云拒绝了操作，请检查歌单权限或稍后重试" : "网易云暂时无法完成该请求";
  throw new HttpError(status, String(body.message ?? body.msg ?? fallback), "NETEASE_REQUEST_FAILED");
}

function shuffleSongs(songs: NeteaseSong[]) {
  const copy = [...songs];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function promisePool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      const item = items[index];
      cursor += 1;
      await worker(item, index);
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

function parseLrc(lyric: string, translation = "") {
  const translatedByTime = new Map(parseLrcEntries(translation).map((line) => [line.time, line.text]));
  return parseLrcEntries(lyric).map((line) => ({
    ...line,
    translation: translatedByTime.get(line.time) || undefined,
  }));
}

function parseLrcEntries(lyric: string) {
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
