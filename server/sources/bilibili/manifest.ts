import type { SourceManifest } from "../contract";

export const bilibiliManifest: SourceManifest = {
  id: "bilibili",
  name: "哔哩哔哩",
  shortName: "B站",
  version: "1.0.0",
  artworkHosts: ["hdslb.com", "bilivideo.com", "bilibili.com"],
  capabilities: {
    searchModes: ["tracks"],
    playback: true,
    lyrics: true,
    wordLyrics: false,
    account: true,
    liked: true,
    playlistsRead: true,
    playlistsWrite: false,
    recommendations: false,
    artistDetail: false,
    albumDetail: false,
    qualitySelection: true,
    // MV is presented as an overlay on the shared Aria player, not a separate page.
    videoPlayback: true,
  },
};
