export type ScannedTrack = {
  id: string;
  path: string;
  libraryRoot: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: number | null;
  quality: string;
  format: string;
  size: number;
  trackNumber?: number | null;
  discNumber?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  bpm?: number | null;
  hasCover?: boolean;
  streamUrl?: string | null;
  mediaKind?: "file" | "audio-cd";
  nativeStart?: string | null;
  nativeEnd?: string | null;
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
