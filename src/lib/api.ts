import type { LyricCandidate } from "@/data/music";

declare global {
  interface Window {
    ariaDesktop?: {
      apiBase?: string;
      minimizeToTray?: () => void;
      minimizeWindow?: () => void;
      toggleMaximizeWindow?: () => void;
      closeWindow?: () => void;
      onWindowVisibilityChange?: (callback: (visible: boolean) => void) => () => void;
      showApp?: () => void;
      quitApp?: () => void;
      setBackgroundEnabled?: (enabled: boolean) => void;
    };
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  bitrate?: number | null;
  sampleRate?: number | null;
  bpm?: number | null;
  hasCover?: boolean;
};

export type ApiLibraryIndex = {
  updatedAt: string | null;
  roots: string[];
  tracks: ApiScannedTrack[];
};

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
  cookiePreview: string | null;
};

export type ProviderTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  quality: "Hi-Res" | "FLAC" | "Lossless" | "320K";
  source: string;
  streamUrl?: string | null;
  coverUrl?: string | null;
};

export type ProviderPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  subscribed: boolean;
  coverColor: string;
  coverUrl?: string | null;
};

export type ProviderDailyBundle = {
  date: string;
  tracks: ProviderTrack[];
  reason: string;
};

const API_BASE = window.ariaDesktop?.apiBase ?? "";

export function apiUrl(url: string) {
  if (!API_BASE || /^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the generic message when the server does not return JSON.
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  resolveUrl(url: string) {
    return apiUrl(url);
  },
  health() {
    return request<{ ok: boolean; name: string }>("/api/health");
  },
  scanLibrary(folderPath: string, persist = true) {
    return request<{ tracks: ApiScannedTrack[]; library: ApiLibraryIndex | null }>("/api/library/scan", {
      method: "POST",
      body: JSON.stringify({ folderPath, persist }),
    });
  },
  getLibrary() {
    return request<ApiLibraryIndex>("/api/library");
  },
  clearLibrary() {
    return request<ApiLibraryIndex>("/api/library", {
      method: "DELETE",
    });
  },
  getTrackStreamUrl(trackId: string) {
    return apiUrl(`/api/library/tracks/${encodeURIComponent(trackId)}/stream`);
  },
  getTrackCoverUrl(trackId: string) {
    return apiUrl(`/api/library/tracks/${encodeURIComponent(trackId)}/cover`);
  },
  getNeteaseCoverUrl(sourceUrl: string) {
    return apiUrl(`/api/providers/netease/cover?url=${encodeURIComponent(sourceUrl)}`);
  },
  searchLyrics(query: { title: string; artist?: string; album?: string }) {
    const params = new URLSearchParams();
    params.set("title", query.title);
    if (query.artist) params.set("artist", query.artist);
    if (query.album) params.set("album", query.album);
    return request<{ candidates: LyricCandidate[] }>(`/api/lyrics/search?${params}`);
  },
  bindLyric(trackId: string, candidateId: string) {
    return request<{
      ok: boolean;
      lyricBindings: Record<string, string>;
      lyrics: Array<{ time: string; text: string }>;
    }>("/api/lyrics/bind", {
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
  listProviders() {
    return request<{
      providers: Array<{
        id: string;
        name: string;
        account: {
          connected: boolean;
          nickname: string | null;
          userId: string | null;
          avatarUrl: string | null;
        };
      }>;
    }>("/api/providers");
  },
  getProviderLiked(providerId = "netease") {
    return request<{ tracks: ProviderTrack[] }>(`/api/providers/${providerId}/liked`);
  },
  getProviderPlaylists(providerId = "netease") {
    return request<{ playlists: ProviderPlaylist[] }>(`/api/providers/${providerId}/playlists`);
  },
  getNeteasePlaylistTracks(playlistId: string) {
    return request<{ tracks: ProviderTrack[] }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/tracks`);
  },
  getProviderDaily(providerId = "netease") {
    return request<ProviderDailyBundle>(`/api/providers/${providerId}/daily`);
  },
  getProviderRoam(providerId = "netease", limit = 18) {
    return request<ProviderDailyBundle>(`/api/providers/${providerId}/roam?limit=${limit}`);
  },
  getNeteaseLyrics(trackId: string) {
    return request<{ lyrics: Array<{ time: string; text: string }> }>(
      `/api/providers/netease/tracks/${encodeURIComponent(trackId)}/lyrics`,
    );
  },
};
