import neteaseApi from "NeteaseCloudMusicApi";
import { withNeteaseIdentity } from "../clients/neteaseIdentity";
import { readStore } from "../store";
import { parseNeteaseLyrics, type NeteaseLyricBody } from "../utils/lyricParser";

export async function fetchNeteaseLyrics(songId: string | number) {
  const store = await readStore().catch(() => null);
  const cookie =
    typeof store?.neteaseCookie === "string" && store.neteaseCookie.trim().length > 0
      ? store.neteaseCookie.trim()
      : null;
  const query = cookie ? { id: songId, cookie } : { id: songId };
  try {
    const response = await neteaseApi.lyric_new(await withNeteaseIdentity(query));
    const body = (response.body ?? {}) as NeteaseLyricBody;
    if (body.code === undefined || body.code === 200) {
      const lines = parseNeteaseLyrics(body);
      if (lines.length) return lines;
    }
  } catch {
    // Word-level lyrics are optional; keep ordinary synchronized lyrics working.
  }
  const response = await neteaseApi.lyric(await withNeteaseIdentity(query));
  return parseNeteaseLyrics((response.body ?? {}) as NeteaseLyricBody);
}
