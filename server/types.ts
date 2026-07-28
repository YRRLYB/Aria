export type ScannedTrack = {
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

export type LyricCandidate = {
  id: string;
  source: "网易云" | "QQ音乐" | "酷狗";
  title: string;
  artist: string;
  album: string;
  coverUrl?: string | null;
  score: number;
  preview: string[];
};

export type AppStore = {
  neteaseCookie: string | null;
  lyricBindings: Record<string, string>;
};
