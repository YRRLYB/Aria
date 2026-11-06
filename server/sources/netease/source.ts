import { NETEASE_NO_PLAYABLE_URL_MESSAGE, neteaseClient } from "../../clients/neteaseClient";
import { getNeteaseAccountSummary } from "../../services/neteaseService";
import { HttpError } from "../../utils/httpError";
import type { MusicSource, SourceSearchPage, SourceStreamMeta } from "../contract";
import { neteaseManifest } from "./manifest";

/**
 * Thin adapter into the unified source contract. Only the shared core
 * (search / stream / lyrics / account) lives here; playlist writes, likes,
 * daily recommendations, cloud disk, encyclopedia and styles keep their
 * dedicated NetEase routes in server/index.ts.
 */
export const neteaseSource: MusicSource = {
  manifest: neteaseManifest,

  async search({ query, mode, limit, offset }): Promise<SourceSearchPage> {
    const page: SourceSearchPage = { tracks: [], artists: [], playlists: [] };
    if (mode === "artists") {
      page.artists = await neteaseClient.searchArtists(query, limit);
    } else if (mode === "playlists") {
      page.playlists = await neteaseClient.searchPlaylists(query, limit);
    } else {
      page.tracks = (await neteaseClient.search(query, "tracks", limit, offset)).tracks;
    }
    return page;
  },

  async resolveStreamMeta(trackId, { level }): Promise<SourceStreamMeta> {
    const meta = await neteaseClient.getStreamMeta(trackId, level ?? "lossless");
    if (!meta.url) {
      throw new HttpError(404, NETEASE_NO_PLAYABLE_URL_MESSAGE, "NETEASE_URL_UNAVAILABLE");
    }
    return { ...meta, url: meta.url };
  },

  async getLyrics(trackId) {
    return neteaseClient.getLyrics(trackId);
  },

  async getAccount() {
    const account = await getNeteaseAccountSummary();
    return {
      connected: account.connected,
      nickname: account.nickname,
      userId: account.userId,
      avatarUrl: account.avatarUrl,
    };
  },
};
