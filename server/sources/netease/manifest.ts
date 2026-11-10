import type { SourceManifest } from "../contract";

export const neteaseManifest: SourceManifest = {
  id: "netease",
  name: "网易云",
  shortName: "网易云",
  version: "1.0.0",
  artworkHosts: ["music.126.net", "music.163.com"],
  capabilities: {
    searchModes: ["tracks", "artists", "playlists", "albums"],
    playback: true,
    lyrics: true,
    wordLyrics: true,
    account: true,
    liked: true,
    playlistsRead: true,
    playlistsWrite: true,
    recommendations: true,
    artistDetail: true,
    albumDetail: true,
    qualitySelection: true,
    videoPlayback: false,
  },
};
