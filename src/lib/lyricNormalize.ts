import type { LyricLine } from "./lyricTypes";
import { getLyricStartTime } from "./lyricTiming";

const PLACEHOLDER_TRANSLATION_RE = /^[/／\-—·.~_=\s]+$/;
const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const SAME_TIMESTAMP_EPSILON_SECONDS = 0.06;

export function isPlaceholderTranslation(text?: string | null): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  return !trimmed || PLACEHOLDER_TRANSLATION_RE.test(trimmed);
}

function sameLyricTimestamp(first: LyricLine, second: LyricLine): boolean {
  const firstHasNumber = typeof first.startTime === "number" && Number.isFinite(first.startTime);
  const secondHasNumber = typeof second.startTime === "number" && Number.isFinite(second.startTime);
  if (firstHasNumber && secondHasNumber) {
    return Math.abs(first.startTime! - second.startTime!) < SAME_TIMESTAMP_EPSILON_SECONDS;
  }
  const firstTime = first.time?.trim();
  const secondTime = second.time?.trim();
  if (firstTime && secondTime && firstTime === secondTime) {
    return Math.abs(getLyricStartTime(first) - getLyricStartTime(second)) < SAME_TIMESTAMP_EPSILON_SECONDS;
  }
  return false;
}

/**
 * Merges consecutive same-timestamp bilingual LRC entries (e.g. an English or
 * Japanese line followed at the identical timestamp by its Chinese translation)
 * into a single unified `{ text, translation }` row while stripping empty `"//"`
 * placeholder translations.
 */
export function normalizeBilingualLyrics(lines: LyricLine[]): LyricLine[] {
  if (!lines.length) return lines;

  const result: LyricLine[] = [];
  for (const rawLine of lines) {
    const text = rawLine.text?.trim() ?? "";
    if (!text) continue;

    const cleanTranslation = isPlaceholderTranslation(rawLine.translation)
      ? undefined
      : rawLine.translation!.trim();

    const line: LyricLine = cleanTranslation
      ? { ...rawLine, text, translation: cleanTranslation }
      : rawLine.translation !== undefined
        ? { ...rawLine, text, translation: undefined }
        : { ...rawLine, text };

    if (!result.length) {
      if (!isPlaceholderTranslation(line.text)) result.push(line);
      continue;
    }

    const previous = result[result.length - 1];
    if (!sameLyricTimestamp(previous, line)) {
      if (!isPlaceholderTranslation(line.text)) result.push(line);
      continue;
    }

    // Same timestamp as the previous entry: ignore placeholder fillers or exact duplicates.
    if (isPlaceholderTranslation(line.text) || line.text === previous.text) {
      if (!previous.translation && line.translation && line.translation !== previous.text) {
        result[result.length - 1] = { ...previous, translation: line.translation };
      }
      continue;
    }

    if (!previous.translation) {
      result[result.length - 1] = {
        ...previous,
        translation: line.text,
      };
      continue;
    }

    if (line.text === previous.translation) {
      continue;
    }

    // Some trilingual LRC files put [original] + [romaji] + [中文翻译] at the same timestamp.
    // Prefer keeping the Chinese translation when the existing translation has no CJK characters.
    if (!CJK_CHAR_RE.test(previous.translation) && CJK_CHAR_RE.test(line.text)) {
      result[result.length - 1] = {
        ...previous,
        translation: line.text,
      };
      continue;
    }

    result[result.length - 1] = {
      ...previous,
      translation: `${previous.translation} · ${line.text}`,
    };
  }

  return result;
}
