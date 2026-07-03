import type { MusicProvider } from "./musicProvider";
import { getNeteaseAccountSummary } from "../services/neteaseService";

export const neteaseProvider: MusicProvider = {
  id: "netease",
  name: "网易云音乐",
  async getAccount() {
    const account = await getNeteaseAccountSummary();
    return {
      connected: account.connected,
      nickname: account.nickname,
      userId: account.userId,
    };
  },
};
