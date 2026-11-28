import crypto from "node:crypto";
import type { ProviderAlbum, ProviderArtist, ProviderPlaylist, ProviderTrack } from "../../providers/musicProvider";
import type { LyricLine } from "../../../src/lib/lyricTypes";
import { parseLrcEntries } from "../../utils/lyricParser";
import { getPrivateCloudPassword, type StoredPrivateCloudInstance } from "../privateCloudStore";
import { SourceError } from "../contract";

const SUBSONIC_API_VERSION = "1.16.1";
const SUBSONIC_CLIENT_NAME = "Aria";

type SubsonicSongRaw = {
  id?: string | number;
  title?: string;
  artist?: string;
  artistId?: string | number;
  album?: string;
  albumId?: string | number;
  coverArt?: string;
  duration?: number;
  bitRate?: number;
  samplingRate?: number;
  bitDepth?: number;
  suffix?: string;
  contentType?: string;
  size?: number;
};

type SubsonicAlbumRaw = {
  id?: string | number;
  name?: string;
  title?: string;
  artist?: string;
  artistId?: string | number;
  coverArt?: string;
  songCount?: number;
  year?: number;
  song?: SubsonicSongRaw[];
};

type SubsonicArtistRaw = {
  id?: string | number;
  name?: string;
  coverArt?: string;
  albumCount?: number;
  album?: SubsonicAlbumRaw[];
};

type SubsonicPlaylistRaw = {
  id?: string | number;
  name?: string;
  comment?: string;
  owner?: string;
  songCount?: number;
  coverArt?: string;
  entry?: SubsonicSongRaw[];
};

type SubsonicEnvelope = {
  "subsonic-response"?: {
    status?: string;
    version?: string;
    type?: string;
    serverVersion?: string;
    openSubsonic?: boolean;
    error?: { code?: number; message?: string };
    searchResult3?: {
      song?: SubsonicSongRaw[];
      album?: SubsonicAlbumRaw[];
      artist?: SubsonicArtistRaw[];
    };
    albumList2?: { album?: SubsonicAlbumRaw[] };
    album?: SubsonicAlbumRaw;
    artists?: { index?: Array<{ artist?: SubsonicArtistRaw[] }> };
    artist?: SubsonicArtistRaw;
    playlists?: { playlist?: SubsonicPlaylistRaw[] };
    playlist?: SubsonicPlaylistRaw;
    lyricsList?: {
      structuredLyrics?: Array<{
        synced?: boolean;
        line?: Array<{ start?: number; value?: string }>;
      }>;
    };
    lyrics?: { value?: string };
  };
};

export function buildSubsonicAuthParams(
  username: string,
  password: string,
  saltOverride?: string,
): Record<string, string> {
  const salt = saltOverride || crypto.randomBytes(5).toString("hex");
  const token = crypto.createHash("md5").update(`${password}${salt}`, "utf8").digest("hex");
  return {
    u: username,
    t: token,
    s: salt,
    v: SUBSONIC_API_VERSION,
    c: SUBSONIC_CLIENT_NAME,
    f: "json",
  };
}

export function buildSubsonicUrl(
  instance: StoredPrivateCloudInstance,
  endpoint: string,
  extraParams: Record<string, string | number | undefined> = {},
): string {
  const password = getPrivateCloudPassword(instance);
  const auth = buildSubsonicAuthParams(instance.username, password);
  const url = new URL(`${instance.baseUrl.replace(/\/+$/, "")}/rest/${endpoint.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries({ ...auth, ...extraParams })) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildSubsonicStreamUrl(
  instance: StoredPrivateCloudInstance,
  songId: string,
  options: { transcodeBitrate?: number } = {},
): string {
  const transcode = options.transcodeBitrate;
  if (typeof transcode === "number" && Number.isFinite(transcode) && transcode > 0) {
    return buildSubsonicUrl(instance, "stream.view", {
      id: songId,
      format: "opus",
      maxBitRate: Math.round(transcode),
    });
  }
  return buildSubsonicUrl(instance, "stream.view", {
    id: songId,
    format: "raw",
  });
}

export function buildSubsonicCoverUrl(
  instance: StoredPrivateCloudInstance,
  coverId: string,
  size?: number,
): string {
  return buildSubsonicUrl(instance, "getCoverArt.view", {
    id: coverId,
    ...(size && size > 0 ? { size: Math.round(size) } : {}),
  });
}

async function subsonicRequest(
  instance: StoredPrivateCloudInstance,
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<NonNullable<SubsonicEnvelope["subsonic-response"]>> {
  const url = buildSubsonicUrl(instance, endpoint, params);
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Aria/0.9.0" },
    signal,
  });
  if (!res.ok) {
    throw new SourceError("UPSTREAM_FAILED", `OpenSubsonic 请求失败 (${res.status})`, { source: "subsonic" });
  }
  const json = (await res.json()) as SubsonicEnvelope;
  const payload = json?.["subsonic-response"];
  if (!payload) {
    throw new SourceError("UPSTREAM_FAILED", "OpenSubsonic 响应格式无效", { source: "subsonic" });
  }
  if (payload.status === "failed") {
    const code = payload.error?.code;
    const msg = payload.error?.message || "OpenSubsonic 服务端拒绝了请求";
    throw new SourceError(code === 40 || code === 41 ? "AUTH_REQUIRED" : "UPSTREAM_FAILED", msg, {
      source: "subsonic",
    });
  }
  return payload;
}

function qualityFromSubsonicSong(song: SubsonicSongRaw): ProviderTrack["quality"] {
  const suffix = (song.suffix ?? "").toLowerCase();
  const sampleRate = Number(song.samplingRate ?? 0);
  const bitDepth = Number(song.bitDepth ?? 0);
  if (sampleRate > 48_000 || bitDepth >= 24) return "Hi-Res";
  if (suffix === "flac") return "FLAC";
  if (suffix === "wav" || suffix === "alac" || suffix === "ape" || suffix === "aiff") return "Lossless";
  if (suffix === "m4a" || suffix === "aac") return "AAC";
  if ((song.bitRate ?? 0) >= 256) return "320K";
  return "128K";
}

export function mapSubsonicSong(instance: StoredPrivateCloudInstance, song: SubsonicSongRaw): ProviderTrack {
  const nativeId = String(song.id ?? "");
  const compositeId = `${instance.id}:${nativeId}`;
  const quality = qualityFromSubsonicSong(song);
  const coverId = song.coverArt ? String(song.coverArt) : null;
  return {
    id: compositeId,
    title: String(song.title || "").trim() || "未命名曲目",
    artist: String(song.artist || "").trim() || "未知歌手",
    album: String(song.album || "").trim() || instance.name,
    duration: Math.max(0, Number(song.duration) || 0),
    quality,
    source: "subsonic",
    streamUrl: `/api/sources/subsonic/tracks/${encodeURIComponent(compositeId)}/stream`,
    coverUrl: coverId
      ? `/api/private-cloud/subsonic/${encodeURIComponent(instance.id)}/cover/${encodeURIComponent(coverId)}?size=300`
      : null,
    bitrate: song.bitRate ? Number(song.bitRate) * 1000 : null,
    sampleRate: song.samplingRate ? Number(song.samplingRate) : null,
    albumId: song.albumId ? `${instance.id}:${song.albumId}` : null,
    artistIds: song.artistId ? [`${instance.id}:${song.artistId}`] : undefined,
    currentLevel:
      quality === "Hi-Res"
        ? "hires"
        : quality === "FLAC" || quality === "Lossless"
          ? "lossless"
          : quality === "320K"
            ? "exhigh"
            : "standard",
  };
}

export function mapSubsonicAlbum(instance: StoredPrivateCloudInstance, album: SubsonicAlbumRaw): ProviderAlbum {
  const nativeId = String(album.id ?? "");
  const coverId = album.coverArt ? String(album.coverArt) : null;
  return {
    id: `${instance.id}:${nativeId}`,
    name: String(album.name || album.title || "未命名专辑"),
    source: "subsonic",
    artist: String(album.artist || "未知歌手"),
    artistId: album.artistId ? `${instance.id}:${album.artistId}` : null,
    coverUrl: coverId
      ? `/api/private-cloud/subsonic/${encodeURIComponent(instance.id)}/cover/${encodeURIComponent(coverId)}?size=300`
      : null,
    publishTime: album.year ? Date.UTC(Number(album.year), 0, 1) : null,
    trackCount: typeof album.songCount === "number" ? album.songCount : null,
  };
}

export function mapSubsonicArtist(instance: StoredPrivateCloudInstance, artist: SubsonicArtistRaw): ProviderArtist {
  const nativeId = String(artist.id ?? "");
  const coverId = artist.coverArt ? String(artist.coverArt) : null;
  return {
    id: `${instance.id}:${nativeId}`,
    name: String(artist.name || "未知歌手"),
    source: "subsonic",
    avatarUrl: coverId
      ? `/api/private-cloud/subsonic/${encodeURIComponent(instance.id)}/cover/${encodeURIComponent(coverId)}?size=300`
      : null,
    albumCount: typeof artist.albumCount === "number" ? artist.albumCount : null,
  };
}

export async function pingSubsonic(
  instance: StoredPrivateCloudInstance,
  signal?: AbortSignal,
): Promise<{ ok: boolean; latencyMs: number; openSubsonic?: boolean; serverVersion?: string; reason?: string }> {
  const startedAt = Date.now();
  try {
    const res = await subsonicRequest(instance, "ping.view", {}, signal);
    return {
      ok: true,
      latencyMs: Math.max(1, Date.now() - startedAt),
      openSubsonic: Boolean(res.openSubsonic),
      serverVersion: res.serverVersion || res.version || res.type || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - startedAt),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchSubsonic(
  instance: StoredPrivateCloudInstance,
  query: string,
  limit = 24,
  offset = 0,
  signal?: AbortSignal,
): Promise<{ tracks: ProviderTrack[]; albums: ProviderAlbum[]; artists: ProviderArtist[] }> {
  const res = await subsonicRequest(
    instance,
    "search3.view",
    {
      query,
      songCount: limit,
      songOffset: offset,
      albumCount: Math.min(limit, 16),
      albumOffset: offset,
      artistCount: Math.min(limit, 16),
      artistOffset: offset,
    },
    signal,
  );
  const block = res.searchResult3 ?? {};
  return {
    tracks: (block.song ?? []).map((song) => mapSubsonicSong(instance, song)),
    albums: (block.album ?? []).map((album) => mapSubsonicAlbum(instance, album)),
    artists: (block.artist ?? []).map((artist) => mapSubsonicArtist(instance, artist)),
  };
}

export async function listSubsonicAlbums(
  instance: StoredPrivateCloudInstance,
  type: "newest" | "frequent" | "random" = "newest",
  size = 24,
  offset = 0,
  signal?: AbortSignal,
): Promise<ProviderAlbum[]> {
  const res = await subsonicRequest(instance, "getAlbumList2.view", { type, size, offset }, signal);
  return (res.albumList2?.album ?? []).map((album) => mapSubsonicAlbum(instance, album));
}

export async function getSubsonicAlbum(
  instance: StoredPrivateCloudInstance,
  albumId: string,
  signal?: AbortSignal,
): Promise<{ album: ProviderAlbum; tracks: ProviderTrack[] }> {
  const res = await subsonicRequest(instance, "getAlbum.view", { id: albumId }, signal);
  if (!res.album) {
    throw new SourceError("UNAVAILABLE", "未找到该 OpenSubsonic 专辑", { source: "subsonic" });
  }
  return {
    album: mapSubsonicAlbum(instance, res.album),
    tracks: (res.album.song ?? []).map((song) => mapSubsonicSong(instance, song)),
  };
}

export async function listSubsonicRecentTracks(
  instance: StoredPrivateCloudInstance,
  type: "newest" | "frequent" | "random" = "newest",
  albumLimit = 10,
  signal?: AbortSignal,
): Promise<ProviderTrack[]> {
  const albums = await listSubsonicAlbums(instance, type, albumLimit, 0, signal);
  const out: ProviderTrack[] = [];
  for (const album of albums.slice(0, albumLimit)) {
    const [, nativeAlbumId] = album.id.split(":");
    if (!nativeAlbumId) continue;
    try {
      const detail = await getSubsonicAlbum(instance, nativeAlbumId, signal);
      out.push(...detail.tracks);
      if (out.length >= 200) break;
    } catch {
      // Skip individual failed album fetches.
    }
  }
  return out;
}

export async function getSubsonicArtists(
  instance: StoredPrivateCloudInstance,
  signal?: AbortSignal,
): Promise<ProviderArtist[]> {
  const res = await subsonicRequest(instance, "getArtists.view", {}, signal);
  const artists: ProviderArtist[] = [];
  for (const group of res.artists?.index ?? []) {
    for (const artist of group.artist ?? []) {
      artists.push(mapSubsonicArtist(instance, artist));
    }
  }
  return artists;
}

export async function getSubsonicArtist(
  instance: StoredPrivateCloudInstance,
  artistId: string,
  signal?: AbortSignal,
): Promise<{ artist: ProviderArtist; albums: ProviderAlbum[] }> {
  const res = await subsonicRequest(instance, "getArtist.view", { id: artistId }, signal);
  if (!res.artist) {
    throw new SourceError("UNAVAILABLE", "未找到该 OpenSubsonic 歌手", { source: "subsonic" });
  }
  return {
    artist: mapSubsonicArtist(instance, res.artist),
    albums: (res.artist.album ?? []).map((album) => mapSubsonicAlbum(instance, album)),
  };
}

export async function getSubsonicPlaylists(
  instance: StoredPrivateCloudInstance,
  signal?: AbortSignal,
): Promise<ProviderPlaylist[]> {
  const res = await subsonicRequest(instance, "getPlaylists.view", {}, signal);
  return (res.playlists?.playlist ?? []).map((playlist) => {
    const nativeId = String(playlist.id ?? "");
    const coverId = playlist.coverArt ? String(playlist.coverArt) : null;
    return {
      id: `${instance.id}:${nativeId}`,
      name: String(playlist.name || "未命名歌单"),
      source: "subsonic",
      trackCount: Number(playlist.songCount) || 0,
      subscribed: false,
      owned: true,
      canEdit: true,
      coverColor: "#6366f1",
      coverUrl: coverId
        ? `/api/private-cloud/subsonic/${encodeURIComponent(instance.id)}/cover/${encodeURIComponent(coverId)}?size=300`
        : null,
      description: playlist.comment || undefined,
      creatorName: playlist.owner || instance.name,
    };
  });
}

export async function getSubsonicPlaylistTracks(
  instance: StoredPrivateCloudInstance,
  playlistId: string,
  signal?: AbortSignal,
): Promise<{ title?: string; tracks: ProviderTrack[] }> {
  const res = await subsonicRequest(instance, "getPlaylist.view", { id: playlistId }, signal);
  const playlist = res.playlist;
  return {
    title: playlist?.name,
    tracks: (playlist?.entry ?? []).map((song) => mapSubsonicSong(instance, song)),
  };
}

export async function updateSubsonicPlaylist(
  instance: StoredPrivateCloudInstance,
  playlistId: string,
  options: { name?: string; songIdToAdd?: string; songIndexToRemove?: number },
  signal?: AbortSignal,
): Promise<boolean> {
  await subsonicRequest(
    instance,
    "updatePlaylist.view",
    {
      playlistId,
      name: options.name,
      songIdToAdd: options.songIdToAdd,
      songIndexToRemove: options.songIndexToRemove,
    },
    signal,
  );
  return true;
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export async function getSubsonicLyrics(
  instance: StoredPrivateCloudInstance,
  songId: string,
  signal?: AbortSignal,
): Promise<LyricLine[]> {
  try {
    const structured = await subsonicRequest(instance, "getLyricsBySongId.view", { id: songId }, signal);
    const list = structured.lyricsList?.structuredLyrics ?? [];
    const synced = list.find((item) => item.synced && Array.isArray(item.line) && item.line.length > 0);
    const chosen = synced ?? list.find((item) => Array.isArray(item.line) && item.line.length > 0);
    if (chosen?.line?.length) {
      const mapped: LyricLine[] = chosen.line
        .filter((entry) => typeof entry.value === "string" && entry.value.trim().length > 0)
        .map((entry, idx) => {
          const startSec = typeof entry.start === "number" && Number.isFinite(entry.start) ? entry.start / 1000 : idx * 3;
          return {
            time: formatSec(startSec),
            startTime: startSec,
            text: String(entry.value).trim(),
            timingVersion: 1,
          };
        });
      if (mapped.length) return mapped;
    }
  } catch {
    // Fall back to legacy getLyrics when server lacks OpenSubsonic extension.
  }

  try {
    const legacy = await subsonicRequest(instance, "getLyrics.view", { id: songId }, signal);
    const text = legacy.lyrics?.value ?? "";
    if (!text.trim()) return [];
    const parsed = parseLrcEntries(text);
    if (parsed.length) return parsed;
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        time: formatSec(index * 3),
        startTime: index * 3,
        text: line,
        timingVersion: 1,
      }));
  } catch {
    return [];
  }
}

export async function scrobbleSubsonic(
  instance: StoredPrivateCloudInstance,
  songId: string,
  submission = true,
  signal?: AbortSignal,
): Promise<boolean> {
  await subsonicRequest(
    instance,
    "scrobble.view",
    {
      id: songId,
      submission: submission ? "true" : "false",
      time: Date.now(),
    },
    signal,
  );
  return true;
}
