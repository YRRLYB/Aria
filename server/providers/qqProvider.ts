import type { MusicProvider } from "./musicProvider";
import {
  getQqAccount,
  getQqDailyRecommendTracks,
  getQqLikedTracks,
  getQqPlaylistTracks,
  getQqPlaylists,
  getQqRoamTracks,
} from "../sources/qq/client";

/**
 * QQ Music account layer: 我喜欢 reads/writes plus the profile playlists.
 * Playlist editing stays read-only in Aria; only the 201 liked list is written.
 */
export const qqProvider: MusicProvider = {
  id: "qq",
  name: "QQ 音乐",
  async getAccount() {
    const account = await getQqAccount();
    return {
      connected: account.connected,
      nickname: account.nickname,
      userId: account.userId,
      avatarUrl: account.avatarUrl,
    };
  },
  async getLikedTracks() {
    return getQqLikedTracks();
  },
  async getPlaylists() {
    return getQqPlaylists();
  },
  async getPlaylistTracks(playlistId: string) {
    return getQqPlaylistTracks(playlistId);
  },
  async getDailyRecommendations() {
    return {
      date: new Date().toISOString().slice(0, 10),
      tracks: await getQqDailyRecommendTracks(),
      reason: "QQ 音乐官方榜单聚合",
    };
  },
  async getPrivateRoaming(limit = 30, options = {}) {
    return {
      date: new Date().toISOString().slice(0, 10),
      tracks: await getQqRoamTracks(limit, options.excludeIds ?? []),
      reason: "从 QQ 音乐官方榜单里随机发现",
    };
  },
};
