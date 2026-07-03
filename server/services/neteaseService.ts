import { updateStore, readStore } from "../store";

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
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
      cookiePreview: null,
    };
  }

  const userId = parseCookieValue(store.neteaseCookie, "__csrf")?.slice(0, 8) ?? "local";

  return {
    connected: true,
    nickname: "网易云账号",
    userId,
    cookiePreview: maskCookie(store.neteaseCookie),
  };
}

function parseCookieValue(cookie: string, key: string) {
  const item = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  return item?.slice(key.length + 1);
}

function maskCookie(cookie: string) {
  const compact = cookie.replace(/\s+/g, "");
  if (compact.length <= 18) return "已保存";
  return `${compact.slice(0, 10)}...${compact.slice(-6)}`;
}
