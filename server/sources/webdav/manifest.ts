import type { SourceManifest } from "../contract";

export const webdavManifest: SourceManifest = {
  id: "webdav",
  name: "WebDAV 私有网盘",
  shortName: "WebDAV",
  version: "1.0.0",
  artworkHosts: [],
  capabilities: {
    searchModes: ["tracks"],
    playback: true,
    lyrics: true,
    wordLyrics: false,
    account: false,
    liked: false,
    playlistsRead: false,
    playlistsWrite: false,
    recommendations: false,
    artistDetail: false,
    albumDetail: false,
    qualitySelection: false,
    videoPlayback: false,
    directShareable: false,
  },
};
