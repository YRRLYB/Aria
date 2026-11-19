import type { LyricLine, LyricWord } from "../../src/lib/lyricTypes";
import { isPlaceholderTranslation, normalizeBilingualLyrics } from "../../src/lib/lyricNormalize";

export type NeteaseLyricBody = {
  code?: number;
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
};

function displayTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function parseLrcEntries(lyric: string): LyricLine[] {
  const offset = Number(lyric.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  const lines: LyricLine[] = [];
  for (const raw of lyric.split(/\r?\n/)) {
    const matches = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const last = matches[matches.length - 1];
    const text = raw.slice((last.index ?? 0) + last[0].length).trim();
    if (!text) continue;
    for (const match of matches) {
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      const startTime = Math.max(0, Number(match[1]) * 60 + Number(match[2]) + fraction + offset);
      lines.push({ time: displayTime(startTime), startTime, text, timingVersion: 1 });
    }
  }
  return lines.sort((a, b) => a.startTime! - b.startTime!);
}

export function parseYrcEntries(lyric: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lyric.split(/\r?\n/)) {
    const lineMatch = raw.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!lineMatch) continue;
    const wordMatches = [...lineMatch[3].matchAll(/\((\d+),(\d+),\d+\)/g)];
    const words: LyricWord[] = wordMatches.map((word, index) => ({
      startTime: Number(word[1]) / 1000,
      duration: Number(word[2]) / 1000,
      text: lineMatch[3].slice((word.index ?? 0) + word[0].length, wordMatches[index + 1]?.index),
    })).filter((word) => word.text.length > 0);
    const text = words.map((word) => word.text).join("");
    if (!text.trim()) continue;
    const startTime = Number(lineMatch[1]) / 1000;
    lines.push({ time: displayTime(startTime), startTime, duration: Number(lineMatch[2]) / 1000, text, words, timingVersion: 1 });
  }
  return lines.sort((a, b) => a.startTime! - b.startTime!);
}

function findMatchingTranslation(
  targetTime: number,
  translation: LyricLine[],
  usedIndices: Set<number>,
): { index: number; text: string } | null {
  let bestIndex = -1;
  let bestDiff = Infinity;

  for (let index = 0; index < translation.length; index += 1) {
    if (usedIndices.has(index)) continue;
    const item = translation[index];
    const diff = Math.abs(item.startTime! - targetTime);
    if (diff < 0.001) {
      return { index, text: item.text };
    }
    if (diff <= 0.8 && diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, text: translation[bestIndex].text } : null;
}

export function parseNeteaseLyrics(body: NeteaseLyricBody): LyricLine[] {
  const rawWords = parseYrcEntries(body.yrc?.lyric ?? "");
  const rawLrc = parseLrcEntries(body.lrc?.lyric ?? "");
  const inlinePairedWords = normalizeBilingualLyrics(rawWords);
  const inlinePairedLrc = normalizeBilingualLyrics(rawLrc);

  const usingWords = inlinePairedWords.length > 0;
  const lines = usingWords ? inlinePairedWords : inlinePairedLrc;
  const rawTranslation = parseLrcEntries(
    (usingWords ? body.ytlrc?.lyric : undefined) || body.tlyric?.lyric || "",
  );
  const translation = rawTranslation.filter((item) => !isPlaceholderTranslation(item.text));
  const usedTranslationIndices = new Set<number>();

  return lines.map((line) => {
    const matched = findMatchingTranslation(line.startTime!, translation, usedTranslationIndices);
    if (matched) {
      usedTranslationIndices.add(matched.index);
      if (!isPlaceholderTranslation(matched.text)) {
        return { ...line, translation: matched.text };
      }
    }
    if (usingWords && !line.translation && inlinePairedLrc.length) {
      const lrcFallback = inlinePairedLrc.find(
        (item) => Boolean(item.translation) && Math.abs((item.startTime ?? 0) - (line.startTime ?? 0)) < 0.6,
      );
      if (lrcFallback?.translation) {
        return { ...line, translation: lrcFallback.translation };
      }
    }
    return line;
  });
}
