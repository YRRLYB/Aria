import type { MusicSource, SourceSearchPage } from "../contract";
import { SourceError } from "../contract";
import {
  clearYoutubeCookie,
  getYoutubeAccount,
  getYoutubeDailyRecommendTracks,
  getYoutubeDiscovery,
  getYoutubeLikedTracks,
  getYoutubePlaylistTracks,
  getYoutubePlaylists,
  getYoutubeRoamTracks,
  resolveYoutubeStreamMeta,
  resolveYoutubeVideoMeta,
  saveYoutubeCookie,
  searchYoutubeTracks,
  setYoutubeLike,
} from "./client";
import { checkYoutubeDeviceLogin, startYoutubeDeviceLogin } from "./deviceLogin";
import { youtubeManifest } from "./manifest";

/**
 * YouTube Music source: anonymous search over the music.youtube.com innertube
 * API plus audio/video stream resolution, with optional account binding
 * (cookie / window / device login) that unlocks the user's liked songs &
 * playlists. Streams, covers and every API call can be routed through a
 * user-configured proxy; see client.ts.
 */
export const youtubeSource: MusicSource = {
  manifest: youtubeManifest,

  async search({ query, mode, limit, offset }): Promise<SourceSearchPage> {
    if (mode !== "tracks") {
      // No artist/album/playlist catalogue in v1; an empty page keeps the
      // fused search stable and the capability flags hide the modes in the UI.
      return { tracks: [], artists: [], playlists: [], albums: [] };
    }
    if (offset > 0 && offset % Math.max(1, Math.min(limit || 24, 40)) !== 0) {
      throw new SourceError("UNSUPPORTED", "YouTube 搜索分页步长不正确", { source: "youtube" });
    }
    return {
      tracks: await searchYoutubeTracks(query, limit, offset),
      artists: [],
      playlists: [],
      albums: [],
    };
  },

  resolveStreamMeta(trackId, options) {
    return resolveYoutubeStreamMeta(trackId, options);
  },

  resolveVideoMeta(trackId, options) {
    return resolveYoutubeVideoMeta(trackId, options);
  },

  getAccount() {
    return getYoutubeAccount();
  },

  getLikedTracks() {
    return getYoutubeLikedTracks();
  },

  setLike(trackId, liked) {
    return setYoutubeLike(trackId, liked);
  },

  saveCookie(cookie) {
    return saveYoutubeCookie(cookie);
  },

  clearCookie() {
    return clearYoutubeCookie();
  },

  getPlaylists() {
    return getYoutubePlaylists();
  },

  getPlaylistTracks(playlistId) {
    return getYoutubePlaylistTracks(playlistId);
  },

  getDailyRecommendTracks() {
    return getYoutubeDailyRecommendTracks();
  },

  getRoamTracks(limit, excludeIds) {
    return getYoutubeRoamTracks(limit, excludeIds);
  },

  getDiscovery() {
    return getYoutubeDiscovery();
  },

  // 设备码（RFC 8628）扫码式登录：复用 QQ/B站的泛型 /qr/start + /qr/check
  // 路由，从结构上绕开 Google 对嵌入浏览器的登录拦截；成功后服务端直接
  // 换取并保存 youtube.com 会话 Cookie，与窗口登录共用账号管线。
  startQrLogin() {
    return startYoutubeDeviceLogin();
  },

  checkQrLogin(key) {
    return checkYoutubeDeviceLogin(key);
  },
};

