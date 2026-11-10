import type { LyricCandidate, LyricLine } from "@/data/music";
import type { LocalMetadataApplyOptions, LocalMetadataOverride, LocalMetadataPreview } from "./localMetadata";

declare global {
  interface Window {
    ariaDesktop?: {
      /** `win32` | `darwin` | `linux` — lets the shell render platform-correct chrome. */
      platform?: string;
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
          normalizationEnabled?: boolean;
          equalizerEnabled?: boolean;
          equalizerBands?: number[];
        }) => Promise<unknown>;
        loadNext?: (payload: { trackId: string; url: string }) => Promise<unknown>;
        setPaused?: (paused: boolean) => Promise<unknown>;
        seek?: (position: number) => Promise<unknown>;
        setVolume?: (volume: number) => Promise<unknown>;
        configure?: (payload: {
          exclusive?: boolean;
          deviceId?: string;
          volume?: number;
          normalizationEnabled?: boolean;
          equalizerEnabled?: boolean;
          equalizerBands?: number[];
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
      qqLoginWindow?: () => Promise<{ ok: boolean; cookie?: string; message?: string }>;
      getRemoteAccess?: () => Promise<{ enabled: boolean; token: string; port: number; addresses: string[] }>;
      setRemoteAccess?: (enabled: boolean) => Promise<{ enabled: boolean; token: string }>;
      updateTaskbarPlayback?: (payload: { title?: string; artist?: string; playing?: boolean }) => Promise<boolean>;
      updateMediaSession?: (payload: { active: boolean; title: string; artist: string; album: string; artwork: string | null; playing: boolean; canPrevious: boolean; canNext: boolean }) => Promise<boolean>;
      setTaskbarPreviewRect?: (rect: { x: number; y: number; width: number; height: number } | null) => Promise<boolean>;
      setTaskbarIconicThumb?: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<boolean>;
      setTaskbarIconicLive?: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<boolean>;
      clearTaskbarIconicThumb?: () => Promise<boolean>;
      getTaskbarIconicStats?: () => Promise<Record<string, number | boolean> | null>;
      updates?: {
        getState: () => Promise<UpdateState>;
        check: () => Promise<UpdateState>;
        download: () => Promise<UpdateState>;
        install: () => Promise<boolean>;
        onState: (callback: (state: UpdateState) => void) => () => void;
      };
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

export type UpdateState = {
  supported: boolean;
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "up-to-date" | "error" | "unsupported";
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  percent: number | null;
  bytesPerSecond: number | null;
  error: string | null;
  checkedAt: number | null;
  reason: string | null;
};

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
  metadata?: LocalMetadataOverride;
};

export type ApiLibraryIndex = {
  updatedAt: string | null;
  roots: string[];
  tracks: ApiScannedTrack[];
};

export type ApiLibraryWatchState = {
  enabled: boolean;
  scanningRoots: string[];
  lastScanAt: number | null;
  lastError: string | null;
};

/** Account snapshot shared by every non-NetEase source (`/api/sources/<id>/account`). */
export type SourceAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
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

export type SourceCapabilities = {
  searchModes: Array<"tracks" | "artists" | "playlists" | "albums">;
  playback: boolean;
  lyrics: boolean;
  wordLyrics: boolean;
  account: boolean;
  liked: boolean;
  playlistsRead: boolean;
  playlistsWrite: boolean;
  recommendations: boolean;
  artistDetail: boolean;
  albumDetail: boolean;
  qualitySelection: boolean;
  videoPlayback: boolean;
};

export type SourceManifestInfo = {
  id: string;
  name: string;
  shortName: string;
  version: string;
  artworkHosts: string[];
  capabilities: SourceCapabilities;
  /** False when the user switched this source off in settings. */
  enabled?: boolean;
  /** ms timestamp while the source is skipped after repeated upstream errors. */
  unavailableUntil?: number | null;
};

export type ProviderTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  quality: "臻品" | "Hi-Res" | "FLAC" | "Lossless" | "320K" | "128K" | "AAC";
  source: string;
  streamUrl?: string | null;
  coverUrl?: string | null;
  likedAt?: number | null;
  bpm?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  currentLevel?: "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster" | null;
  availableLevels?: Array<"standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster">;
  albumId?: string | null;
  artistIds?: string[];
  matchedLyric?: string | null;
  /** Muxed video stream route (Bilibili); audio playback still uses streamUrl. */
  videoUrl?: string | null;
  hasVideo?: boolean;
  videoQuality?: string | null;
  /** QQ 音乐等源的会员专属标记：true 表示无 VIP 账号大概率拿不到播放地址。 */
  vip?: boolean;
};

export type ProviderStyle = {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string | null;
};

export type ProviderStyleGroup = {
  id: string;
  name: string;
  styles: ProviderStyle[];
};

export type ProviderStylePage = {
  style: ProviderStyle;
  tracks: ProviderTrack[];
  cursor: string | null;
  more: boolean;
};

export type ProviderPlaylist = {
  id: string;
  name: string;
  source?: "netease" | "qq";
  trackCount: number;
  subscribed: boolean;
  ownerId?: string | null;
  owned?: boolean;
  canEdit?: boolean;
  coverColor: string;
  coverUrl?: string | null;
  description?: string;
  creatorName?: string;
  tags?: string[];
};

export type ProviderCloudTrack = {
  track: ProviderTrack;
  fileName: string;
  fileSize: number | null;
  uploadedAt: number | null;
};

export type ProviderCloudPage = {
  items: ProviderCloudTrack[];
  count: number;
  more: boolean;
  nextOffset: number;
  size: number | null;
  maxSize: number | null;
};

export type ProviderArtist = {
  id: string;
  name: string;
  source: string;
  avatarUrl?: string | null;
  trackCount?: number | null;
  albumCount?: number | null;
};

export type ProviderUser = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  signature: string;
  playlistCount: number | null;
  followCount: number | null;
  followerCount: number | null;
};

export type ProviderAlbum = {
  id: string;
  name: string;
  source?: "netease" | "qq";
  artist: string;
  artistId: string | null;
  coverUrl: string | null;
  publishTime: number | null;
  trackCount: number | null;
  description?: string;
};

export type ProviderArtistDetail = {
  artist: ProviderArtist;
  description: string;
  sections: Array<{ title: string; text: string }>;
};

export type NeteaseSearchMode = "tracks" | "artists" | "playlists" | "users" | "albums" | "lyrics";

export type NeteaseSearchResults = {
  query: string;
  mode: NeteaseSearchMode;
  tracks: ProviderTrack[];
  artists: ProviderArtist[];
  playlists: ProviderPlaylist[];
  users: ProviderUser[];
  albums: ProviderAlbum[];
  total: number;
};

export type ProviderDailyBundle = {
  date: string;
  tracks: ProviderTrack[];
  reason: string;
};

export type ProviderDiscoveryBundle = {
  hotSearches: string[];
  rankings: ProviderPlaylist[];
  playlists: ProviderPlaylist[];
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

const startupRequestDeadline = Date.now() + 12_000;
const startupRetryStatuses = new Set([502, 503, 504]);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithStartupRetry(url: string, init?: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    const canRetry = (!init?.method || init.method.toUpperCase() === "GET") &&
      !init?.signal?.aborted &&
      Date.now() < startupRequestDeadline;
    try {
      const response = await fetch(apiUrl(url), {
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
        ...init,
      });
      if (!canRetry || !startupRetryStatuses.has(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (!canRetry) throw error;
    }
    await wait(Math.min(1200, 150 * 2 ** attempt));
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithStartupRetry(url, init);

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
  getLibraryWatchState() {
    return request<ApiLibraryWatchState>("/api/library/watch-state");
  },
  setLibraryAutoScan(enabled: boolean) {
    return request<ApiLibraryWatchState>("/api/library/auto-scan", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  },
  removeLibraryRoot(root: string) {
    return request<ApiLibraryIndex>("/api/library/roots", {
      method: "DELETE",
      body: JSON.stringify({ root }),
    });
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
  previewLocalMetadata(trackIds: string[]) {
    return request<LocalMetadataPreview>("/api/library/metadata/preview", { method: "POST", body: JSON.stringify({ trackIds }) });
  },
  applyLocalMetadata(previewId: string, entries: Array<{ trackId: string; candidateId: string; hasArtwork?: boolean; hasLyrics?: boolean }>, options: LocalMetadataApplyOptions) {
    return request<{ tracks: ApiScannedTrack[]; lyricBindings: Record<string, string>; undoId: string | null; failed: Array<{ trackId: string; error: string }> }>("/api/library/metadata/apply", {
      method: "POST", body: JSON.stringify({ previewId, entries, options }),
    });
  },
  undoLocalMetadata(undoId: string) {
    return request<{ tracks: ApiScannedTrack[]; lyricBindings: Record<string, string>; skipped: string[]; restoredLyrics: string[] }>("/api/library/metadata/undo", { method: "POST", body: JSON.stringify({ undoId }) });
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
  bindLyric(trackId: string, candidateId: string, expectedBinding?: string | null) {
    return request<{
      ok: boolean;
      accepted: boolean;
      lyricBindings: Record<string, string>;
      lyrics: LyricLine[];
    }>("/api/lyrics/bind", {
      method: "POST",
      body: JSON.stringify({ trackId, candidateId, expectedBinding }),
    });
  },
  getSettings() {
    return request<{
      hasNeteaseCookie: boolean;
      hasQqCookie?: boolean;
      hasBilibiliCookie?: boolean;
      neteaseAccount: NeteaseAccountSummary;
      /** Opt-in mainland egress IP used for NetEase's 460 mitigation. */
      neteaseRealIp?: string | null;
      lyricBindings: Record<string, string>;
    }>("/api/settings");
  },
  getNeteaseAccount() {
    return request<{ account: NeteaseAccountSummary }>("/api/settings/netease-account");
  },
  saveNeteaseCookie(cookie: string) {
    return request<{ ok: boolean; account: NeteaseAccountSummary }>("/api/settings/netease-cookie", {
      method: "POST",
      body: JSON.stringify({ cookie }),
    });
  },
  clearNeteaseCookie() {
    return request<{ ok: boolean; account: NeteaseAccountSummary }>("/api/settings/netease-cookie", {
      method: "DELETE",
    });
  },
  /**
   * Pins the mainland IP NetEase should see. Pass an empty string to clear it
   * and go back to the machine's real connection.
   */
  saveNeteaseRealIp(realIP: string) {
    return request<{ ok: boolean; realIP: string | null }>("/api/settings/netease-real-ip", {
      method: "POST",
      body: JSON.stringify({ realIP }),
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
  setQqLike(trackId: string, liked: boolean) {
    return request<{ ok: boolean; liked: boolean }>(`/api/providers/qq/tracks/${encodeURIComponent(trackId)}/like`, {
      method: "POST",
      body: JSON.stringify({ liked }),
    });
  },
  getProviderPlaylists(providerId = "netease") {
    return request<{ playlists: ProviderPlaylist[] }>(`/api/providers/${providerId}/playlists`);
  },
  getProviderPlaylistTracks(providerId: string, playlistId: string) {
    return request<{ tracks: ProviderTrack[] }>(`/api/providers/${encodeURIComponent(providerId)}/playlists/${encodeURIComponent(playlistId)}/tracks`);
  },
  getSongEncyclopedia(trackId: string) {
    return request<import("./songEncyclopedia").SongEncyclopedia>(`/api/providers/netease/tracks/${encodeURIComponent(trackId)}/encyclopedia`);
  },
  getNeteaseCloud(limit = 100, offset = 0, refresh = false) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (refresh) params.set("refresh", "1");
    return request<ProviderCloudPage>(`/api/providers/netease/cloud?${params}`);
  },
  getNeteaseCloudTrack(trackId: string) {
    return request<{ item: ProviderCloudTrack }>(`/api/providers/netease/cloud/${encodeURIComponent(trackId)}`);
  },
  createNeteasePlaylist(name: string, isPrivate = false) {
    return request<{ playlist: ProviderPlaylist }>("/api/providers/netease/playlists", {
      method: "POST",
      body: JSON.stringify({ name, isPrivate }),
    });
  },
  deleteNeteasePlaylist(playlistId: string) {
    return request<{ ok: true }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}`, {
      method: "DELETE",
    });
  },
  getNeteasePlaylistTracks(playlistId: string) {
    return request<{ tracks: ProviderTrack[] }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/tracks`);
  },
  getNeteasePlaylistDetail(playlistId: string) {
    return request<{ playlist: ProviderPlaylist; tracks: ProviderTrack[] }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}`);
  },
  updateNeteasePlaylist(playlistId: string, changes: { name?: string; description?: string; tags?: string[] }) {
    return request<{ playlist: ProviderPlaylist }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}`, {
      method: "PATCH", body: JSON.stringify(changes),
    });
  },
  editNeteasePlaylistTracks(playlistId: string, trackIds: string[], operation: "add" | "del") {
    return request<{ ok: true }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "POST", body: JSON.stringify({ trackIds, operation }),
    });
  },
  reorderNeteasePlaylistTracks(playlistId: string, trackIds: string[]) {
    return request<{ ok: true }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/tracks/order`, {
      method: "PUT", body: JSON.stringify({ trackIds }),
    });
  },
  uploadNeteasePlaylistCover(playlistId: string, file: File) {
    return request<{ playlist: ProviderPlaylist }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/cover`, {
      method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
    });
  },
  subscribeNeteasePlaylist(playlistId: string, subscribed: boolean) {
    return request<{ ok: true; subscribed: boolean }>(`/api/providers/netease/playlists/${encodeURIComponent(playlistId)}/subscription`, {
      method: "POST", body: JSON.stringify({ subscribed }),
    });
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
  searchLibraryAndStream(query: string, limit = 24, mode?: NeteaseSearchMode | "local") {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (mode) params.set("mode", mode);
    return request<{
      query: string;
      localTracks: ApiScannedTrack[];
      neteaseTracks: ProviderTrack[];
      artists: ProviderArtist[];
      playlists: ProviderPlaylist[];
    }>(`/api/search?${params}`);
  },
  searchNetease(query: string, mode: NeteaseSearchMode, limit = 24, offset = 0) {
    const params = new URLSearchParams({ q: query, mode, limit: String(limit), offset: String(offset) });
    return request<NeteaseSearchResults>(`/api/providers/netease/search?${params}`);
  },
  getNeteaseSearchSuggestions(query: string) {
    const params = new URLSearchParams({ q: query });
    return request<{ suggestions: string[] }>(`/api/providers/netease/search/suggestions?${params}`);
  },
  getNeteaseStyles() {
    return request<{ groups: ProviderStyleGroup[] }>("/api/providers/netease/styles");
  },
  getNeteaseStyle(styleId: string, options: { cursor?: string | null; sort?: "hot" | "new"; limit?: number } = {}) {
    const params = new URLSearchParams({ sort: options.sort ?? "hot", limit: String(options.limit ?? 24) });
    if (options.cursor) params.set("cursor", options.cursor);
    return request<ProviderStylePage>(`/api/providers/netease/styles/${encodeURIComponent(styleId)}?${params}`);
  },
  getNeteaseSportRadio(bpm = 100, refresh = false) {
    const params = new URLSearchParams({ bpm: String(bpm) });
    if (refresh) params.set("refresh", "1");
    return request<{ tracks: ProviderTrack[]; bpm: number }>(`/api/providers/netease/sport-radio?${params}`);
  },
  getNeteaseDiscovery(limit = 12) {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<ProviderDiscoveryBundle>(`/api/providers/netease/discovery?${params}`);
  },
  getNeteaseUserDetail(userId: string) {
    return request<{ user: ProviderUser }>(`/api/providers/netease/users/${encodeURIComponent(userId)}`);
  },
  getNeteaseUserPlaylists(userId: string, limit = 100, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request<{ playlists: ProviderPlaylist[]; more: boolean }>(`/api/providers/netease/users/${encodeURIComponent(userId)}/playlists?${params}`);
  },
  getNeteaseAlbum(albumId: string) {
    return request<{ album: ProviderAlbum; tracks: ProviderTrack[] }>(`/api/providers/netease/albums/${encodeURIComponent(albumId)}`);
  },
  getNeteaseArtistDetail(artistId: string) {
    return request<ProviderArtistDetail>(`/api/providers/netease/artists/${encodeURIComponent(artistId)}`);
  },
  getNeteaseArtistAlbums(artistId: string, limit = 30, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request<{ albums: ProviderAlbum[]; more: boolean }>(`/api/providers/netease/artists/${encodeURIComponent(artistId)}/albums?${params}`);
  },
  getSourceArtistDetail(sourceId: string, artistId: string) {
    return request<ProviderArtistDetail>(`/api/sources/${encodeURIComponent(sourceId)}/artists/${encodeURIComponent(artistId)}`);
  },
  getSourceArtistAlbums(sourceId: string, artistId: string, limit = 30, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request<{ albums: ProviderAlbum[]; more: boolean }>(`/api/sources/${encodeURIComponent(sourceId)}/artists/${encodeURIComponent(artistId)}/albums?${params}`);
  },
  getSourceArtistTracks(sourceId: string, artistId: string, limit = 60, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request<{ tracks: ProviderTrack[]; more: boolean }>(`/api/sources/${encodeURIComponent(sourceId)}/artists/${encodeURIComponent(artistId)}/tracks?${params}`);
  },
  getSourceAlbum(sourceId: string, albumId: string) {
    return request<{ album: ProviderAlbum; tracks: ProviderTrack[] }>(`/api/sources/${encodeURIComponent(sourceId)}/albums/${encodeURIComponent(albumId)}`);
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
  // Unified built-in source contract (/api/sources/:sourceId/...). New sources
  // plug in here without per-source API copies.
  listSources() {
    return request<{ sources: SourceManifestInfo[] }>("/api/sources");
  },
  setSourceEnabled(sourceId: string, enabled: boolean) {
    return request<{ ok: boolean; sources: SourceManifestInfo[] }>(
      `/api/sources/${encodeURIComponent(sourceId)}/enabled`,
      { method: "POST", body: JSON.stringify({ enabled }) },
    );
  },
  searchSource(sourceId: string, query: string, mode: "tracks" | "artists" | "playlists" | "albums" = "tracks", limit = 24, offset = 0) {
    const params = new URLSearchParams({ q: query, mode, limit: String(limit), offset: String(offset) });
    return request<{ sourceId: string; tracks: ProviderTrack[]; artists: ProviderArtist[]; playlists: ProviderPlaylist[]; albums?: ProviderAlbum[] }>(
      `/api/sources/${encodeURIComponent(sourceId)}/search?${params}`,
    );
  },
  getSourceStreamUrl(sourceId: string, trackId: string, level?: string) {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const suffix = params.size ? `?${params}` : "";
    return apiUrl(`/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/stream${suffix}`);
  },
  getSourceStreamMetaUrl(sourceId: string, trackId: string, level?: string) {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const suffix = params.size ? `?${params}` : "";
    return apiUrl(`/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/stream-meta${suffix}`);
  },
  getSourceStreamMeta(sourceId: string, trackId: string, level?: string) {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const suffix = params.size ? `?${params}` : "";
    return request<{
      url: string;
      bitrate?: number | null;
      sampleRate?: number | null;
      quality?: ProviderTrack["quality"] | null;
      currentLevel?: "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster" | null;
      availableLevels?: Array<"standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster">;
    }>(`/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/stream-meta${suffix}`);
  },
  getSourceVideoUrl(sourceId: string, trackId: string, level?: string) {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const suffix = params.size ? `?${params}` : "";
    return apiUrl(`/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/video${suffix}`);
  },
  getSourceVideoMetaUrl(sourceId: string, trackId: string, level?: string) {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    const suffix = params.size ? `?${params}` : "";
    return apiUrl(`/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/video-meta${suffix}`);
  },
  getSourceLyrics(sourceId: string, trackId: string) {
    return request<{ lyrics: LyricLine[] }>(
      `/api/sources/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/lyrics`,
    );
  },
  getSourceAccount(sourceId: string) {
    return request<{ account: SourceAccountSummary }>(
      `/api/sources/${encodeURIComponent(sourceId)}/account`,
    );
  },
  getSourceLikedTracks(sourceId: string) {
    return request<{ tracks: ProviderTrack[] }>(`/api/sources/${encodeURIComponent(sourceId)}/liked`);
  },
  saveSourceCookie(sourceId: string, cookie: string) {
    return request<{ ok: boolean; account: SourceAccountSummary }>(
      `/api/sources/${encodeURIComponent(sourceId)}/cookie`,
      { method: "POST", body: JSON.stringify({ cookie }) },
    );
  },
  clearSourceCookie(sourceId: string) {
    return request<{ ok: boolean; account: SourceAccountSummary }>(
      `/api/sources/${encodeURIComponent(sourceId)}/cookie`,
      { method: "DELETE" },
    );
  },
  startSourceQrLogin(sourceId: string) {
    return request<{ key: string; qrImage: string; expiresIn: number }>(
      `/api/sources/${encodeURIComponent(sourceId)}/qr/start`,
      { method: "POST" },
    );
  },
  checkSourceQrLogin(sourceId: string, key: string) {
    const params = new URLSearchParams({ key });
    return request<{
      code: number;
      status: "waiting" | "scanned" | "expired" | "success";
      message: string;
      account: SourceAccountSummary | null;
    }>(`/api/sources/${encodeURIComponent(sourceId)}/qr/check?${params}`);
  },
  setSourceLike(sourceId: string, trackId: string, liked: boolean) {
    return request<{ ok: boolean; liked: boolean }>(
      `/api/providers/${encodeURIComponent(sourceId)}/tracks/${encodeURIComponent(trackId)}/like`,
      { method: "POST", body: JSON.stringify({ liked }) },
    );
  },
  getSourceDailyTracks(sourceId: string) {
    return request<{ sourceId: string; tracks: ProviderTrack[] }>(`/api/sources/${encodeURIComponent(sourceId)}/daily`);
  },
  getSourceRoamTracks(sourceId: string, limit = 30, excludeIds: string[] = []) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (excludeIds.length) params.set("exclude", excludeIds.join(","));
    return request<{ sourceId: string; tracks: ProviderTrack[] }>(`/api/sources/${encodeURIComponent(sourceId)}/roam?${params}`);
  },
  getSourceCoverUrl(sourceId: string, sourceUrl: string) {
    return apiUrl(`/api/sources/${encodeURIComponent(sourceId)}/cover?url=${encodeURIComponent(sourceUrl)}`);
  },
  saveQqCookie(cookie: string) {
    return request<{ ok: boolean; account: SourceAccountSummary }>(
      "/api/settings/qq-cookie",
      { method: "POST", body: JSON.stringify({ cookie }) },
    );
  },
  clearQqCookie() {
    return request<{ ok: boolean; account: SourceAccountSummary }>(
      "/api/settings/qq-cookie",
      { method: "DELETE" },
    );
  },
  startQqQrLogin() {
    return request<{ key: string; qrImage: string; expiresIn: number }>("/api/settings/qq-qr/start", {
      method: "POST",
    });
  },
  checkQqQrLogin(key: string) {
    const params = new URLSearchParams({ key });
    return request<{
      code: number;
      status: "waiting" | "scanned" | "expired" | "success";
      message: string;
      account: SourceAccountSummary | null;
    }>(`/api/settings/qq-qr/check?${params}`);
  },
};
