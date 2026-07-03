import type { LyricCandidate } from "@/data/music";

export type ApiScannedTrack = {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  quality: string;
  format: string;
  size: number;
};

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  cookiePreview: string | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health() {
    return request<{ ok: boolean; name: string }>("/api/health");
  },
  scanLibrary(folderPath: string) {
    return request<{ tracks: ApiScannedTrack[] }>("/api/library/scan", {
      method: "POST",
      body: JSON.stringify({ folderPath }),
    });
  },
  searchLyrics(query: { title: string; artist?: string; album?: string }) {
    const params = new URLSearchParams();
    params.set("title", query.title);
    if (query.artist) params.set("artist", query.artist);
    if (query.album) params.set("album", query.album);
    return request<{ candidates: LyricCandidate[] }>(`/api/lyrics/search?${params}`);
  },
  bindLyric(trackId: string, candidateId: string) {
    return request<{ ok: boolean; lyricBindings: Record<string, string> }>("/api/lyrics/bind", {
      method: "POST",
      body: JSON.stringify({ trackId, candidateId }),
    });
  },
  getSettings() {
    return request<{
      hasNeteaseCookie: boolean;
      neteaseAccount: NeteaseAccountSummary;
      lyricBindings: Record<string, string>;
    }>("/api/settings");
  },
  saveNeteaseCookie(cookie: string) {
    return request<{ ok: boolean; account: NeteaseAccountSummary }>("/api/settings/netease-cookie", {
      method: "POST",
      body: JSON.stringify({ cookie }),
    });
  },
};
