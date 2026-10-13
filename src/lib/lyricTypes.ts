// Timing values are absolute seconds on the audio timeline, not line-relative.
export type LyricWord = {
  text: string;
  startTime: number;
  duration: number;
};

export type LyricLine = {
  time: string;
  text: string;
  translation?: string;
  startTime?: number;
  duration?: number;
  words?: LyricWord[];
  // Allows old line-only caches to be refreshed once after upgrading Aria.
  timingVersion?: 1;
};
