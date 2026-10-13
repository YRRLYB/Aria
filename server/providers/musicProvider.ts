export type ProviderAccount = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
};

export type ProviderTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  quality: "臻品" | "Hi-Res" | "FLAC" | "Lossless" | "320K";
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
};

export type ProviderPlaylist = {
  id: string;
  name: string;
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
  artist: string;
  artistId: string | null;
  coverUrl: string | null;
  publishTime: number | null;
  trackCount: number | null;
  description?: string;
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

export type ProviderRoamOptions = {
  refresh?: boolean;
  excludeIds?: string[];
};

export type MusicProvider = {
  id: string;
  name: string;
  getAccount(): Promise<ProviderAccount>;
  getLikedTracks(): Promise<ProviderTrack[]>;
  getPlaylists(): Promise<ProviderPlaylist[]>;
  getDailyRecommendations(): Promise<ProviderDailyBundle>;
  getPrivateRoaming(limit?: number, options?: ProviderRoamOptions): Promise<ProviderDailyBundle>;
};
