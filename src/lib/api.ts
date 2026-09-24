import type { LyricCandidate, LyricLine } from "@/data/music";

declare global {
  interface Window {
    ariaDesktop?: {
      nativeAudio?: {
        supported?: boolean;
        isSupported?: () => Promise<boolean>;
        listDevices?: () => Promise<Array<{ id: string; label: string }>>;
        getState?: () => Promise<{
          supported: boolean;
          ready: boolean;
          active: boolean;
          trackId: string | null;
          url: string | null;
          position: number;
          duration: number;
          paused: boolean;
          volume: number;
          exclusive: boolean;
          deviceId: string;
          bitrate: number | null;
          gaplessGeneration?: number;
          kind?: string;
        }>;
        load?: (payload: {
          trackId: string;
          url: string;
          position?: number;
          paused?: boolean;
          volume?: number;
          exclusive?: boolean;
          deviceId?: string;
          nativeDevice?: string | null;
          startChapter?: string | null;
          endChapter?: string | null;
          cdReadQuality?: "high" | "low";
        }) => Promise<unknown>;
        loadNext?: (payload: { trackId: string; url: string }) => Promise<unknown>;
        setPaused?: (paused: boolean) => Promise<unknown>;
        seek?: (position: number) => Promise<unknown>;
        setVolume?: (volume: number) => Promise<unknown>;
        configure?: (payload: {
          exclusive?: boolean;
          deviceId?: string;
          volume?: number;
        }) => Promise<unknown>;
        stop?: () => Promise<unknown>;
        onEvent?: (callback: (payload: {
          supported: boolean;
          ready: boolean;
          active: boolean;
          trackId: string | null;
          url: string | null;
          position: number;
          duration: number;
          paused: boolean;
          volume: number;
          exclusive: boolean;
          deviceId: string;
          bitrate: number | null;
          gaplessGeneration?: number;
          kind?: string;
        }) => void) => () => void;
      };
      apiBase?: string;
      minimizeToTray?: () => void;
      minimizeWindow?: () => void;
      toggleMaximizeWindow?: () => void;
      closeWindow?: () => void;
      onWindowVisibilityChange?: (callback: (visible: boolean) => void) => () => void;
      onPlaybackCommand?: (callback: (command: "toggle" | "play" | "pause" | "previous" | "next") => void) => () => void;
      showApp?: () => void;
      quitApp?: () => void;
      setBackgroundEnabled?: (enabled: boolean) => void;
      chooseMusicFolder?: () => Promise<string | null>;
      getRemoteAccess?: () => Promise<{ enabled: boolean; token: string; port: number; addresses: string[] }>;
      setRemoteAccess?: (enabled: boolean) => Promise<{ enabled: boolean; token: string }>;
      updateTaskbarPlayback?: (payload: { title?: string; artist?: string; playing?: boolean }) => Promise<boolean>;
      updateMediaSession?: (payload: { active: boolean; title: string; artist: string; album: string; artwork: string | null; playing: boolean; canPrevious: boolean; canNext: boolean }) => Promise<boolean>;
      setTaskbarPreviewRect?: (rect: { x: number; y: number; width: number; height: number } | null) => Promise<boolean>;
      setTaskbarIconicThumb?: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<boolean>;
      setTaskbarIconicLive?: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<boolean>;
      clearTaskbarIconicThumb?: () => Promise<boolean>;
      getTaskbarIconicStats?: () => Promise<Record<string, number | boolean> | null>;
      configureGlobalShortcuts?: (payload: Record<"toggle" | "previous" | "next" | "show", string>) => Promise<unknown>;
      copyImageToClipboard?: (payload: { url?: string; dataUrl?: string }) => Promise<boolean>;
      log?: (payload: {
        level?: "debug" | "info" | "warn" | "error";
        source?: string;
        message?: string;
        stack?: string;
        filename?: string;
        line?: number;
        column?: number;
        context?: Record<string, unknown>;
      }) => Promise<unknown>;
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
  albumArtist?: string | null;
  duration: number | null;
  quality: string;
  format: string;
  size: number;
  bitrate?: number | null;
  sampleRate?: number | null;
  bpm?: number | null;
  hasCover?: boolean;
  trackNumber?: number | null;
  discNumber?: number | null;
  libraryRoot?: string;
  mediaKind?: "file" | "audio-cd";
  nativeDevice?: string | null;
  streamUrl?: string | null;
  nativeStart?: string | null;
  nativeEnd?: string | null;
  cdReadQuality?: "high" | "low";
  requiresNativePlayback?: boolean;
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

export type NeteaseQrStart = {
  key: string;
  qrUrl: string;
  qrImage: string;
  expiresIn: number;
};

export type NeteaseQrCheck = {
  code: number;
  status: "waiting" | "scanned" | "expired" | "success";
  message: string;
  account: NeteaseAccountSummary | null;
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
  likedAt?: number | null;
  bpm?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  currentLevel?: "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster" | null;
  availableLevels?: Array<"standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster">;
};

export type ProviderPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  subscribed: boolean;
  ownerId?: string | null;
  owned?: boolean;
  coverColor: string;
  coverUrl?: string | null;
};

export type ProviderArtist = {
  id: string;
  name: string;
  source: string;
  avatarUrl?: string | null;
  trackCount?: number | null;
  albumCount?: number | null;
};

export type ProviderDailyBundle = {
  date: string;
  tracks: ProviderTrack[];
  reason: string;
};

// Connection layer: where the Aria backend lives and how to authenticate.
// - Desktop (Electron): preload injects apiBase for the embedded loopback
//   server, which never asks for a token (loopback is exempt).
// - Web / Aria mobile: the backend is a remote Aria desktop over the LAN,
//   configured at runtime and persisted in localStorage. Every URL gains
//   ?token= because <audio>/<img> requests cannot send headers.
export type ApiConnection = {
  serverUrl: string;
  token: string;
};

const CONNECTION_STORAGE_KEY = "aria-connection";

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed || /^data:/i.test(trimmed)) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function readStoredConnection(): ApiConnection {
  if (typeof window === "undefined") return { serverUrl: "", token: "" };
  if (window.ariaDesktop?.apiBase) {
    return { serverUrl: window.ariaDesktop.apiBase, token: "" };
  }
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return { serverUrl: "", token: "" };
    const parsed = JSON.parse(raw) as Partial<ApiConnection>;
    return {
      serverUrl: typeof parsed.serverUrl === "string" ? normalizeServerUrl(parsed.serverUrl) : "",
      token: typeof parsed.token === "string" ? parsed.token.trim() : "",
    };
  } catch {
    return { serverUrl: "", token: "" };
  }
}

let apiConnection: ApiConnection = readStoredConnection();

export function getApiConnection(): ApiConnection {
  return { ...apiConnection };
}

export function hasRemoteConnection(): boolean {
  return Boolean(apiConnection.serverUrl);
}

export function setApiConnection(connection: Partial<ApiConnection> | null): ApiConnection {
  apiConnection = {
    serverUrl: normalizeServerUrl(connection?.serverUrl ?? ""),
    token: (connection?.token ?? "").trim(),
  };
  try {
    if (apiConnection.serverUrl || apiConnection.token) {
      localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(apiConnection));
    } else {
      localStorage.removeItem(CONNECTION_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (e.g. private mode); keep the in-memory value.
  }
  return { ...apiConnection };
}

function appendToken(url: string): string {
  const token = apiConnection.token;
  if (!token || !/^https?:/i.test(url) || /[?&]token=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export function apiUrl(url: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return appendToken(url);
  const resolved = apiConnection.serverUrl ? `${apiConnection.serverUrl}${url}` : url;
  return appendToken(resolved);
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
  startLibraryScan(folderPath: string, persist = true) {
    return request<{ jobId: string }>("/api/library/scan/start", {
      method: "POST",
      body: JSON.stringify({ folderPath, persist }),
    });
  },
  getLibraryScanProgress(jobId: string) {
    return request<{
      status: "running" | "complete" | "error";
      phase: "discovering" | "metadata" | "saving" | "complete";
      processed: number;
      total: number;
      folderPath: string;
      error: string | null;
      tracks?: ApiScannedTrack[];
      library?: ApiLibraryIndex | null;
    }>(`/api/library/scan/progress/${encodeURIComponent(jobId)}`);
  },
  scanCdDrives(persist = true, qualityMode: "high" | "low" = "high") {
    return request<{
      tracks: ApiScannedTrack[];
      drives: Array<{ drive: string; label: string }>;
      library: ApiLibraryIndex | null;
    }>("/api/library/scan-cd", {
      method: "POST",
      body: JSON.stringify({ persist, qualityMode }),
    });
  },
  getCdDrives() {
    return request<{ drives: Array<{ drive: string; label: string }> }>("/api/library/cd-drives");
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
  warmLocalCovers(trackIds: string[]) {
    return request<{ ok: boolean; warmed: number }>("/api/library/tracks/covers/warmup", {
      method: "POST",
      body: JSON.stringify({ trackIds }),
    });
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
      lyrics: LyricLine[];
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
  startNeteaseQrLogin() {
    return request<NeteaseQrStart>("/api/settings/netease-qr/start", {
      method: "POST",
    });
  },
  checkNeteaseQrLogin(key: string) {
    const params = new URLSearchParams({ key });
    return request<NeteaseQrCheck>(`/api/settings/netease-qr/check?${params}`);
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
  setNeteaseLike(trackId: string, liked: boolean) {
    return request<{ ok: boolean; liked: boolean }>(`/api/providers/netease/tracks/${encodeURIComponent(trackId)}/like`, {
      method: "POST",
      body: JSON.stringify({ liked }),
    });
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
  getProviderRoam(providerId = "netease", limit = 18, options: { refresh?: boolean; excludeIds?: string[] } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.refresh) params.set("refresh", "1");
    if (options.excludeIds?.length) params.set("exclude", options.excludeIds.join(","));
    return request<ProviderDailyBundle>(`/api/providers/${providerId}/roam?${params}`);
  },
  searchLibraryAndStream(query: string, limit = 24) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return request<{
      query: string;
      localTracks: ApiScannedTrack[];
      neteaseTracks: ProviderTrack[];
      artists: ProviderArtist[];
    }>(`/api/search?${params}`);
  },
  lookupArtist(name: string) {
    const params = new URLSearchParams({ name });
    return request<{ artist: ProviderArtist | null }>(`/api/artists/lookup?${params}`);
  },
  getNeteaseArtistTracks(artistId: string) {
    return request<{ tracks: ProviderTrack[] }>(`/api/providers/netease/artists/${encodeURIComponent(artistId)}/tracks`);
  },
  getNeteaseLyrics(trackId: string) {
    return request<{ lyrics: LyricLine[] }>(
      `/api/providers/netease/tracks/${encodeURIComponent(trackId)}/lyrics`,
    );
  },
  getNeteaseStreamMeta(trackId: string, level: "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster") {
    const params = new URLSearchParams({ level });
    return request<{
      url: string | null;
      bitrate: number | null;
      sampleRate: number | null;
      size: number | null;
      quality: ProviderTrack["quality"];
      currentLevel: ProviderTrack["currentLevel"];
      availableLevels: NonNullable<ProviderTrack["availableLevels"]>;
    }>(`/api/providers/netease/tracks/${encodeURIComponent(trackId)}/stream-meta?${params}`);
  },
  warmNeteaseCache(trackIds: string[], level = "lossless") {
    return request<{ ok: boolean; cached: number }>("/api/providers/netease/cache/warmup", {
      method: "POST",
      body: JSON.stringify({ trackIds, level }),
    });
  },
};
