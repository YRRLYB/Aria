import type { MusicSource, SourceSearchPage } from "../contract";
import { SourceError } from "../contract";
import {
  clearQqCookie,
  getQqAccount,
  getQqAlbum,
  getQqArtistAlbums,
  getQqArtistDetail,
  getQqArtistTracks,
  getQqDailyRecommendTracks,
  getQqLyrics,
  getQqRoamTracks,
  resolveQqStreamMeta,
  saveQqCookie,
  searchQqAlbums,
  searchQqArtists,
  searchQqPlaylists,
  searchQqTracks,
  setQqLike,
} from "./client";
import { checkQqQrLogin, startQqQrLogin } from "./qrLogin";
import { qqManifest } from "./manifest";

/** QQ Music source: search / stream / lyrics / cookie or QR login. */
export const qqSource: MusicSource = {
  manifest: qqManifest,

  async search({ query, mode, limit, offset }): Promise<SourceSearchPage> {
    if (mode === "artists") {
      return { tracks: [], artists: await searchQqArtists(query, limit, offset), playlists: [] };
    }
    if (mode === "albums") {
      return { tracks: [], artists: [], playlists: [], albums: await searchQqAlbums(query, limit, offset) };
    }
    if (mode === "playlists") {
      return { tracks: [], artists: [], playlists: await searchQqPlaylists(query, limit, offset) };
    }
    if (mode !== "tracks") {
      throw new SourceError("UNSUPPORTED", "QQ音乐暂不支持该搜索类型", { source: "qq" });
    }
    return { tracks: await searchQqTracks(query, limit, offset), artists: [], playlists: [] };
  },

  resolveStreamMeta(trackId, options) {
    return resolveQqStreamMeta(trackId, options);
  },

  getLyrics(trackId) {
    return getQqLyrics(trackId);
  },

  getAccount() {
    return getQqAccount();
  },

  setLike(trackId, liked) {
    return setQqLike(trackId, liked);
  },

  getArtistDetail(artistId) {
    return getQqArtistDetail(artistId);
  },

  getArtistAlbums(artistId, limit, offset) {
    return getQqArtistAlbums(artistId, limit, offset);
  },

  getArtistTracks(artistId, limit, offset) {
    return getQqArtistTracks(artistId, limit, offset);
  },

  getAlbum(albumId) {
    return getQqAlbum(albumId);
  },

  async getDailyRecommendTracks() {
    return getQqDailyRecommendTracks();
  },

  async getRoamTracks(limit, excludeIds) {
    return getQqRoamTracks(limit, excludeIds);
  },

  saveCookie(cookie) {
    return saveQqCookie(cookie);
  },

  clearCookie() {
    return clearQqCookie();
  },

  startQrLogin() {
    return startQqQrLogin();
  },

  checkQrLogin(key) {
    return checkQqQrLogin(key);
  },
};
