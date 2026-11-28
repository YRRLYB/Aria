import type { ProviderTrack } from "../../providers/musicProvider";
import { parseLrcEntries } from "../../utils/lyricParser";
import { SourceError, type MusicSource } from "../contract";
import { getPrivateCloudInstance, listEnabledPrivateCloudInstances } from "../privateCloudStore";
import { getWebdavFileText, testWebdavConnection } from "./client";
import { getWebdavIndexDb, type WebdavTrackRow } from "./db";
import { webdavManifest } from "./manifest";
import { buildWebdavBasicAuthHeader, buildWebdavRemoteUrl, fetchWebdavWithAuthStrip } from "./proxy";
import { getPrivateCloudPassword } from "../privateCloudStore";

function qualityFromWebdavRow(row: WebdavTrackRow): ProviderTrack["quality"] {
  if ((row.sampleRate ?? 0) > 48_000 || (row.bitDepth ?? 0) >= 24) return "Hi-Res";
  const fmt = (row.format ?? "").toLowerCase();
  if (fmt === "flac") return "FLAC";
  if (fmt === "wav" || fmt === "alac" || fmt === "ape" || fmt === "aiff") return "Lossless";
  if (fmt === "m4a" || fmt === "aac") return "AAC";
  if ((row.bitrateKbps ?? 0) >= 256) return "320K";
  return "128K";
}

export function mapWebdavRowToProviderTrack(row: WebdavTrackRow): ProviderTrack {
  const quality = qualityFromWebdavRow(row);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || "未知歌手",
    album: row.album || "WebDAV 曲库",
    duration: Math.max(0, Math.round(row.durationMs / 1000)),
    quality,
    source: "webdav",
    streamUrl: `/api/sources/webdav/tracks/${encodeURIComponent(row.id)}/stream`,
    coverUrl: row.coverPath ? `/api/private-cloud/webdav/cover/${encodeURIComponent(row.id)}` : null,
    bitrate: row.bitrateKbps ? row.bitrateKbps * 1000 : null,
    sampleRate: row.sampleRate,
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

export const webdavSource: MusicSource = {
  manifest: webdavManifest,

  async healthCheck(instanceId?: string) {
    if (instanceId) {
      const instance = await getPrivateCloudInstance(instanceId);
      if (!instance || instance.kind !== "webdav" || instance.enabled === false) {
        return { ok: false, reason: "对应的 WebDAV 实例不可用或已停用" };
      }
      return testWebdavConnection(instance);
    }
    const instances = await listEnabledPrivateCloudInstances("webdav");
    if (!instances.length) return { ok: false, reason: "尚未配置 WebDAV 实例" };
    return testWebdavConnection(instances[0]);
  },

  async search(query) {
    const enabled = await listEnabledPrivateCloudInstances("webdav");
    if (!enabled.length) return { tracks: [], artists: [], playlists: [], albums: [] };
    const rows = getWebdavIndexDb().searchTracks(
      query.query,
      query.limit,
      query.offset,
      enabled.map((item) => item.id),
    );
    return {
      tracks: rows.map(mapWebdavRowToProviderTrack),
      artists: [],
      playlists: [],
      albums: [],
    };
  },

  async resolveStreamMeta(trackId) {
    const row = getWebdavIndexDb().getTrackById(trackId);
    if (!row) {
      throw new SourceError("UNAVAILABLE", "未在 WebDAV 索引中找到该曲目", { source: "webdav" });
    }
    const instance = await getPrivateCloudInstance(row.instanceId);
    if (!instance || instance.kind !== "webdav" || instance.enabled === false) {
      throw new SourceError("UNAVAILABLE", "所属 WebDAV 实例不可用或已停用", { source: "webdav" });
    }
    const password = getPrivateCloudPassword(instance);
    const authHeader = instance.username || password ? buildWebdavBasicAuthHeader(instance.username, password) : null;
    const remoteUrl = buildWebdavRemoteUrl(instance.baseUrl, row.remotePath);
    const formatLower = (row.format ?? "").toLowerCase();
    const mimeType =
      formatLower === "flac"
        ? "audio/flac"
        : formatLower === "wav"
          ? "audio/wav"
          : formatLower === "mp3"
            ? "audio/mpeg"
            : formatLower === "m4a" || formatLower === "alac"
              ? "audio/mp4"
              : formatLower === "opus" || formatLower === "ogg"
                ? "audio/ogg"
                : null;

    return {
      url: remoteUrl,
      mimeType,
      bitrate: row.bitrateKbps ? row.bitrateKbps * 1000 : null,
      sampleRate: row.sampleRate,
      currentLevel:
        (row.sampleRate ?? 0) > 48_000 || (row.bitDepth ?? 0) >= 24
          ? "hires"
          : formatLower === "flac" || formatLower === "wav" || formatLower === "alac"
            ? "lossless"
            : "exhigh",
      fetcher: (targetUrl, init) =>
        fetchWebdavWithAuthStrip(targetUrl, authHeader, {
          method: init?.method,
          headers: (init?.headers as Record<string, string>) ?? {},
          signal: init?.signal ?? undefined,
        }),
    };
  },

  async getLyrics(trackId, signal) {
    const row = getWebdavIndexDb().getTrackById(trackId);
    if (!row?.lyricPath) return [];
    const instance = await getPrivateCloudInstance(row.instanceId);
    if (!instance || instance.kind !== "webdav" || instance.enabled === false) return [];
    try {
      const lrcText = await getWebdavFileText(instance, row.lyricPath, signal);
      return parseLrcEntries(lrcText);
    } catch {
      return [];
    }
  },
};
