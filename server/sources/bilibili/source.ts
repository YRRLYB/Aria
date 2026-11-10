import type { MusicSource, SourceSearchPage } from "../contract";
import {
  getBilibiliLyrics,
  resolveBilibiliStreamMeta,
  resolveBilibiliVideoMeta,
  searchBilibiliTracks,
} from "./client";
import { bilibiliManifest } from "./manifest";

/** Bilibili source: anonymous video search, DASH audio and optional CC subtitles. */
export const bilibiliSource: MusicSource = {
  manifest: bilibiliManifest,

  async search({ query, mode, limit, offset }): Promise<SourceSearchPage> {
    if (mode !== "tracks") {
      // Bilibili has no artist/album/playlist catalogue. Returning an empty
      // page keeps the fused search stable; the source chip/capabilities hide
      // the unsupported modes in the UI.
      return { tracks: [], artists: [], playlists: [], albums: [] };
    }
    return {
      tracks: await searchBilibiliTracks(query, limit, offset),
      artists: [],
      playlists: [],
      albums: [],
    };
  },

  resolveStreamMeta(trackId, options, signal) {
    return resolveBilibiliStreamMeta(trackId, options, signal);
  },

  resolveVideoMeta(trackId, options, signal) {
    return resolveBilibiliVideoMeta(trackId, options, signal);
  },

  getLyrics(trackId, signal) {
    return getBilibiliLyrics(trackId, signal);
  },
};
