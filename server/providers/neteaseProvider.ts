import type { MusicProvider } from "./musicProvider";
import { neteaseClient } from "../clients/neteaseClient";

export const neteaseProvider: MusicProvider = {
  id: "netease",
  name: "网易云音乐",
  async getAccount() {
    const account = await neteaseClient.getAccount();
    return {
      connected: account.connected,
      nickname: account.nickname,
      userId: account.userId,
      avatarUrl: account.avatarUrl,
    };
  },
  async getLikedTracks() {
    return neteaseClient.getLikedTracks();
  },
  async getPlaylists() {
    return neteaseClient.getPlaylists();
  },
  async getDailyRecommendations() {
    return neteaseClient.getDailyRecommendations();
  },
  async getPrivateRoaming(limit?: number) {
    return neteaseClient.getPrivateRoaming(limit);
  },
};
