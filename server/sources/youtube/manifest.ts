import type { SourceManifest } from "../contract";

export const youtubeManifest: SourceManifest = {
  id: "youtube",
  name: "YouTube Music",
  shortName: "YouTube",
  version: "1.0.0",
  // Proxied artwork domains. youtube itself resolves these from the track's
  // coverUrl (i.ytimg.com/vi/<id>/hqdefault.jpg) and account avatar URLs.
  artworkHosts: ["ytimg.com", "googlevideo.com", "youtube.com", "ggpht.com", "googleusercontent.goog", "googleusercontent.com"],
  capabilities: {
    // v1: songs only. No artist/album browsing; playlists & liked music arrive
    // through the account cookie binding.
    searchModes: ["tracks"],
    playback: true,
    // Timed captions exist on some videos, but the quality is unreliable for
    // music lyrics; leave off until a curated lyric path lands.
    lyrics: false,
    wordLyrics: false,
    // Cookie / browser-window binding, unlocking liked songs & playlists.
    account: true,
    liked: true,
    playlistsRead: true,
    playlistsWrite: false,
    recommendations: true,
    artistDetail: false,
    albumDetail: false,
    // AAC 128k / Opus ~70k / Opus ~160k tier selection.
    qualitySelection: true,
    videoPlayback: true,
    directShareable: false,
    usesDedicatedProxy: true,
  },
};
