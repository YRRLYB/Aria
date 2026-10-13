import neteaseApi from "NeteaseCloudMusicApi";
import { parseNeteaseLyrics, type NeteaseLyricBody } from "../utils/lyricParser";

export async function fetchNeteaseLyrics(songId: string | number) {
  try {
    const response = await neteaseApi.lyric_new({ id: songId });
    const body = (response.body ?? {}) as NeteaseLyricBody;
    if (body.code === undefined || body.code === 200) {
      const lines = parseNeteaseLyrics(body);
      if (lines.length) return lines;
    }
  } catch {
    // Word-level lyrics are optional; keep ordinary synchronized lyrics working.
  }
  const response = await neteaseApi.lyric({ id: songId });
  return parseNeteaseLyrics((response.body ?? {}) as NeteaseLyricBody);
}
