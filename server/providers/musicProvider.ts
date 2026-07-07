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

export type MusicProvider = {
  id: string;
  name: string;
  getAccount(): Promise<ProviderAccount>;
  getLikedTracks(): Promise<ProviderTrack[]>;
  getPlaylists(): Promise<ProviderPlaylist[]>;
  getDailyRecommendations(): Promise<ProviderDailyBundle>;
  getPrivateRoaming(limit?: number): Promise<ProviderDailyBundle>;
};
