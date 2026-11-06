import type { MusicProvider } from "./musicProvider";
import { getQqAccount, getQqLikedTracks, getQqPlaylistTracks, getQqPlaylists } from "../sources/qq/client";

/**
 * QQ Music account layer (read-only): 我喜欢 plus the profile playlists.
 * Playlist writes stay netease-only until QQ documents a stable write API.
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
    throw new Error("QQ 音乐暂不支持每日推荐");
  },
  async getPrivateRoaming() {
    throw new Error("QQ 音乐暂不支持私人漫游");
  },
};
