import type { SourceManifest } from "../contract";

export const subsonicManifest: SourceManifest = {
  id: "subsonic",
  name: "私有云 (OpenSubsonic)",
  shortName: "私有云",
  version: "1.0.0",
  artworkHosts: [],
  capabilities: {
    searchModes: ["tracks", "albums", "artists"],
    playback: true,
    lyrics: true,
    wordLyrics: false,
    account: false,
    liked: false,
    playlistsRead: true,
    playlistsWrite: true,
    recommendations: false,
    artistDetail: true,
    albumDetail: true,
    qualitySelection: false,
    videoPlayback: false,
    directShareable: false,
  },
};
