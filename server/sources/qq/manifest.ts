import type { SourceManifest } from "../contract";

export const qqManifest: SourceManifest = {
  id: "qq",
  name: "QQ音乐",
  shortName: "QQ",
  version: "1.0.0",
  artworkHosts: ["gtimg.cn", "qpic.y.qq.com"],
  capabilities: {
    searchModes: ["tracks", "artists", "playlists", "albums"],
    playback: true,
    lyrics: true,
    wordLyrics: false,
    account: true,
    liked: true,
    playlistsRead: true,
    playlistsWrite: false,
    recommendations: true,
    artistDetail: true,
    albumDetail: true,
    qualitySelection: true,
    videoPlayback: false,
  },
};
