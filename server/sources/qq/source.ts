import type { MusicSource, SourceSearchPage } from "../contract";
import { SourceError } from "../contract";
import {
  clearQqCookie,
  getQqAccount,
  getQqDailyRecommendTracks,
  getQqLyrics,
  getQqRoamTracks,
  resolveQqStreamMeta,
  saveQqCookie,
  searchQqTracks,
} from "./client";
import { checkQqQrLogin, startQqQrLogin } from "./qrLogin";
import { qqManifest } from "./manifest";

/** QQ Music source: search / stream / lyrics / cookie or QR login. */
export const qqSource: MusicSource = {
  manifest: qqManifest,

  async search({ query, mode, limit, offset }): Promise<SourceSearchPage> {
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
