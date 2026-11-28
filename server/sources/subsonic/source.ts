import { SourceError, type MusicSource } from "../contract";
import { getPrivateCloudInstance, listEnabledPrivateCloudInstances } from "../privateCloudStore";
import {
  buildSubsonicStreamUrl,
  getSubsonicAlbum,
  getSubsonicArtist,
  getSubsonicLyrics,
  getSubsonicPlaylists,
  getSubsonicPlaylistTracks,
  pingSubsonic,
  searchSubsonic,
} from "./client";
import { subsonicManifest } from "./manifest";

function splitCompositeId(composite: string): { instanceId: string; nativeId: string } {
  const idx = composite.indexOf(":");
  if (idx <= 0 || idx === composite.length - 1) {
    throw new SourceError("UNAVAILABLE", `无效的 OpenSubsonic 资源标识: ${composite}`, { source: "subsonic" });
  }
  return {
    instanceId: composite.slice(0, idx),
    nativeId: composite.slice(idx + 1),
  };
}

async function requireInstance(instanceId: string) {
  const instance = await getPrivateCloudInstance(instanceId);
  if (!instance || instance.kind !== "subsonic" || instance.enabled === false) {
    throw new SourceError("UNAVAILABLE", "对应的 OpenSubsonic 私有云实例不可用或已停用", { source: "subsonic" });
  }
  return instance;
}

export const subsonicSource: MusicSource = {
  manifest: subsonicManifest,

  async healthCheck(instanceId?: string) {
    if (instanceId) {
      const instance = await requireInstance(instanceId);
      return pingSubsonic(instance);
    }
    const instances = await listEnabledPrivateCloudInstances("subsonic");
    if (!instances.length) return { ok: false, reason: "尚未配置 OpenSubsonic 实例" };
    return pingSubsonic(instances[0]);
  },

  async search(query, signal) {
    const instances = await listEnabledPrivateCloudInstances("subsonic");
    if (!instances.length) return { tracks: [], artists: [], playlists: [], albums: [] };
    const settled = await Promise.allSettled(
      instances.map((instance) => searchSubsonic(instance, query.query, query.limit, query.offset, signal)),
    );
    const tracks = [];
    const albums = [];
    const artists = [];
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      tracks.push(...item.value.tracks);
      albums.push(...item.value.albums);
      artists.push(...item.value.artists);
    }
    return {
      tracks: tracks.slice(0, query.limit),
      albums: albums.slice(0, query.limit),
      artists: artists.slice(0, query.limit),
      playlists: [],
    };
  },

  async resolveStreamMeta(trackId, options) {
    const { instanceId, nativeId } = splitCompositeId(trackId);
    const instance = await requireInstance(instanceId);
    const transcodeBitrate = options.level === "standard" ? instance.mobileTranscodeBitrate : undefined;
    const url = buildSubsonicStreamUrl(instance, nativeId, {
      ...(transcodeBitrate ? { transcodeBitrate } : {}),
    });
    return {
      url,
      headers: { "User-Agent": "Aria/0.9.0" },
      currentLevel: transcodeBitrate ? "standard" : "lossless",
    };
  },

  async getLyrics(trackId, signal) {
    const { instanceId, nativeId } = splitCompositeId(trackId);
    const instance = await requireInstance(instanceId);
    return getSubsonicLyrics(instance, nativeId, signal);
  },

  async getPlaylists() {
    const instances = await listEnabledPrivateCloudInstances("subsonic");
    const settled = await Promise.allSettled(instances.map((inst) => getSubsonicPlaylists(inst)));
    return settled.flatMap((res) => (res.status === "fulfilled" ? res.value : []));
  },

  async getPlaylistTracks(playlistId) {
    const { instanceId, nativeId } = splitCompositeId(playlistId);
    const instance = await requireInstance(instanceId);
    return getSubsonicPlaylistTracks(instance, nativeId);
  },

  async getAlbum(albumId) {
    const { instanceId, nativeId } = splitCompositeId(albumId);
    const instance = await requireInstance(instanceId);
    return getSubsonicAlbum(instance, nativeId);
  },

  async getArtistDetail(artistId) {
    const { instanceId, nativeId } = splitCompositeId(artistId);
    const instance = await requireInstance(instanceId);
    const { artist, albums } = await getSubsonicArtist(instance, nativeId);
    return {
      artist,
      description: `来自私有云实例 ${instance.name}，共 ${albums.length} 张专辑。`,
      sections: [],
    };
  },

  async getArtistAlbums(artistId, limit, offset) {
    const { instanceId, nativeId } = splitCompositeId(artistId);
    const instance = await requireInstance(instanceId);
    const { albums } = await getSubsonicArtist(instance, nativeId);
    return {
      albums: albums.slice(offset, offset + limit),
      more: offset + limit < albums.length,
    };
  },
};
