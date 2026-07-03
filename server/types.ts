export type ScannedTrack = {
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

export type LyricCandidate = {
  id: string;
  source: "网易云" | "QQ音乐" | "酷狗";
  title: string;
  artist: string;
  album: string;
  score: number;
  preview: string[];
};

export type AppStore = {
  neteaseCookie: string | null;
  lyricBindings: Record<string, string>;
};
