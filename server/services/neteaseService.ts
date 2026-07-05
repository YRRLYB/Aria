import neteaseApi from "NeteaseCloudMusicApi";
import { readStore, updateStore } from "../store";

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
  cookiePreview: string | null;
};

export async function saveNeteaseCookie(cookie: string) {
  await updateStore((store) => ({ ...store, neteaseCookie: cookie }));
  return getNeteaseAccountSummary();
}

export async function getNeteaseAccountSummary(): Promise<NeteaseAccountSummary> {
  const store = await readStore();
  if (!store.neteaseCookie) {
    return {
      connected: false,
      nickname: null,
      userId: null,
      avatarUrl: null,
      cookiePreview: null,
    };
  }

  try {
    const response = await neteaseApi.user_account({ cookie: store.neteaseCookie });
    const profile = response.body?.profile as
      | {
          userId?: number | string;
          nickname?: string;
          avatarUrl?: string;
        }
      | undefined;

    if (response.body?.code === 200 && profile?.userId) {
      return {
        connected: true,
        nickname: profile.nickname ?? "Netease Account",
        userId: String(profile.userId),
        avatarUrl: profile.avatarUrl ?? null,
        cookiePreview: maskCookie(store.neteaseCookie),
      };
    }
  } catch {
    // A saved cookie exists, but the remote profile could not be read right now.
  }

  return {
    connected: false,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview: maskCookie(store.neteaseCookie),
  };
}

function maskCookie(cookie: string) {
  const compact = cookie.replace(/\s+/g, "");
  if (compact.length <= 18) return "saved";
  return `${compact.slice(0, 10)}...${compact.slice(-6)}`;
}
