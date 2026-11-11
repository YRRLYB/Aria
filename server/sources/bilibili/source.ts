import type { MusicSource, SourceSearchPage } from "../contract";
import {
  checkBilibiliQrLogin,
  clearBilibiliCookie,
  getBilibiliAccount,
  getBilibiliLikedTracks,
  getBilibiliLyrics,
  resolveBilibiliStreamMeta,
  resolveBilibiliVideoMeta,
  resolveBilibiliLink,
  saveBilibiliCookie,
  searchBilibiliTracks,
  setBilibiliLike,
  startBilibiliQrLogin,
} from "./client";
import { bilibiliManifest } from "./manifest";

/** Bilibili source: anonymous search, DASH audio and optional CC subtitles. */
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

  getAccount(signal) {
    return getBilibiliAccount(signal);
  },

  getLikedTracks() {
    return getBilibiliLikedTracks();
  },

  resolveLink(url) {
    return resolveBilibiliLink(url);
  },

  setLike(trackId, liked) {
    return setBilibiliLike(trackId, liked);
  },

  saveCookie(cookie) {
    return saveBilibiliCookie(cookie);
  },

  clearCookie() {
    return clearBilibiliCookie();
  },

  startQrLogin() {
    return startBilibiliQrLogin();
  },

  checkQrLogin(key) {
    return checkBilibiliQrLogin(key);
  },
};
