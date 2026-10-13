import type { LyricLine, LyricWord } from "./lyricTypes";

export function getLyricStartTime(line: LyricLine) {
  if (typeof line.startTime === "number" && Number.isFinite(line.startTime)) return line.startTime;
  const [minutes, seconds] = line.time.split(":").map(Number);
  return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : 0;
}

export function getLyricWordProgress(word: LyricWord, currentTime: number) {
  if (currentTime < word.startTime) return 0;
  if (word.duration <= 0) return 1;
  return Math.min(1, Math.max(0, (currentTime - word.startTime) / word.duration));
}
