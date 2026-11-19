import type { Track } from "@/data/music";

/**
 * Feature switches and transition rules for source-specific playback features.
 */
export const BILIBILI_VIDEO_ENABLED = true;
export const BILIBILI_LYRICS_ENABLED = false;

export function canPlayTrackVideo(
  track: Pick<Track, "source" | "videoUrl">,
  enabled = BILIBILI_VIDEO_ENABLED,
): boolean {
  return Boolean(enabled && track.source === "bilibili" && track.videoUrl);
}

/**
 * Keeps live video open across consecutive Bilibili tracks, automatically
 * closes it when switching to a non-Bilibili source, and stays closed until
 * the listener explicitly clicks the camera button again.
 */
export function resolveNextVideoMode(
  currentVideoMode: boolean,
  nextTrack: Pick<Track, "source" | "videoUrl">,
  enabled = BILIBILI_VIDEO_ENABLED,
): boolean {
  if (!currentVideoMode) return false;
  return canPlayTrackVideo(nextTrack, enabled);
}
