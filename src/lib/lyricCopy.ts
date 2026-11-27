import type { LyricLine } from "@/data/music";

export function formatSingleLyricLine(line: LyricLine, includeTranslation: boolean): string {
  const main = line.text.trim();
  const translation = includeTranslation ? line.translation?.trim() ?? "" : "";
  if (main && translation) return `${main}\n${translation}`;
  return main || translation;
}

export function formatFullLyrics(lines: LyricLine[], mode: "original" | "bilingual"): string {
  const includeTranslation = mode === "bilingual";
  const formatted = lines
    .map((line) => formatSingleLyricLine(line, includeTranslation))
    .filter((entry) => entry.length > 0);
  return formatted.join(includeTranslation ? "\n\n" : "\n");
}
