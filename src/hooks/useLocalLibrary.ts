import { useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import { createArtworkOverrideDataUrl, writeCachedArtworkOverride } from "@/lib/artworkOverrides";
import { memoryLimits, trimStringSet, warmupBatchLimits } from "@/lib/memoryCache";
import { mergeTracks } from "@/lib/playerPresentation";
import { materializeQueueIds } from "@/lib/playQueue";
import { localTrackToUiTrack } from "@/lib/trackMappers";

// Owns the local music library: scanning (folders + CD), cover warmup and
// per-track artwork resolution/overrides.
export function useLocalLibrary(options: {
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
  activeTrackId: string;
  shuffleEnabled: boolean;
  setPlayQueueIds: (updater: (ids: string[]) => string[]) => void;
  onLibraryOpened: () => void;
  onTrackScanned: (trackId: string) => void;
  resetPendingSeek: () => void;
}) {
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [libraryMeta, setLibraryMeta] = useState({ roots: 0, updatedAt: null as string | null });
  const [folderName, setFolderName] = useState("未选择");
  const artworkSyncingRef = useRef<Set<string>>(new Set());
  const localCoverWarmupRef = useRef<Set<string>>(new Set());
  const preloadedCoverUrlsRef = useRef<Set<string>>(new Set());

  function preloadTrackCovers(tracksToWarm: Track[], limit = warmupBatchLimits.preloadedImages) {
    // Only warm small NetEase thumbnails. Local cover endpoints can contain
    // multi-megapixel embedded artwork; eager-decoding those images was the
    // main source of renderer memory growth while browsing a large library.
    const urls = tracksToWarm
      .map((track) => track.coverUrl)
      .filter((url): url is string => Boolean(url))
      .filter((url) => url.includes("/api/providers/netease/cover"))
      .map((url) => `${url}${url.includes("?") ? "&" : "?"}size=300y300`)
      .filter((url) => {
        if (preloadedCoverUrlsRef.current.has(url)) return false;
        preloadedCoverUrlsRef.current.add(url);
        return true;
      })
      .slice(0, limit);
    trimStringSet(preloadedCoverUrlsRef, 48);

    urls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      const release = () => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
      };
      image.onload = release;
      image.onerror = release;
      image.src = url;
    });
  }

  function warmLocalCoverCache(tracksToWarm: Track[]) {
    preloadTrackCovers(tracksToWarm);
    const ids = tracksToWarm
      .filter((track) => track.source === "local" && track.coverUrl && !track.coverUrl.startsWith("data:"))
      .map((track) => track.id)
      .filter((id) => {
        if (localCoverWarmupRef.current.has(id)) return false;
        localCoverWarmupRef.current.add(id);
        return true;
      })
      .slice(0, warmupBatchLimits.localCovers);
    if (!ids.length) return;
    trimStringSet(localCoverWarmupRef, memoryLimits.localCoverWarmup);
    api.warmLocalCovers(ids).catch(() => {
      ids.forEach((id) => localCoverWarmupRef.current.delete(id));
    });
  }

  function applyArtworkToTrack(trackId: string, coverUrl?: string | null) {
    if (!coverUrl) return;
    const proxiedCoverUrl = api.getNeteaseCoverUrl(coverUrl);
    options.applyTrackUpdate(trackId, (track) => (track.id === trackId ? { ...track, coverUrl: proxiedCoverUrl } : track), {
      includeHistory: false,
    });
  }

  async function scanBackendPath(scanPath: string) {
    const result = await api.scanLibrary(scanPath);
    const nextTracks = result.library?.tracks ?? result.tracks;
    const nextUiTracks = nextTracks.map(localTrackToUiTrack);
    options.resetPendingSeek();
    setLocalTracks(nextUiTracks);
    warmLocalCoverCache(nextUiTracks);
    options.setPlayQueueIds(() => materializeQueueIds(nextUiTracks, nextUiTracks[0]?.id ?? options.activeTrackId, options.shuffleEnabled));
    setLibraryMeta({
      roots: result.library?.roots.length ?? 1,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    if (nextTracks[0]) options.onTrackScanned(nextTracks[0].id);
    options.onLibraryOpened();
  }

  async function scanCdLibrary(qualityMode: "high" | "low") {
    const result = await api.scanCdDrives(true, qualityMode);
    const scannedCdTracks = result.tracks.map(localTrackToUiTrack);
    if (!result.library && !scannedCdTracks.length) {
      setFolderName("未检测到音频光盘");
      options.onLibraryOpened();
      return;
    }
    const nextUiTracks = result.library?.tracks
      ? result.library.tracks.map(localTrackToUiTrack)
      : mergeTracks([...localTracks, ...scannedCdTracks]);
    const queue = scannedCdTracks.length ? scannedCdTracks : nextUiTracks;

    options.resetPendingSeek();
    setLocalTracks(nextUiTracks);
    warmLocalCoverCache(nextUiTracks);
    if (queue.length) {
      options.setPlayQueueIds(() => materializeQueueIds(queue, queue[0].id, options.shuffleEnabled));
    }
    setLibraryMeta({
      roots: result.library?.roots.length ?? result.drives.length,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    setFolderName(scannedCdTracks.length ? "光盘库" : folderName);
    options.onLibraryOpened();
  }

  async function replaceLocalArtwork(trackId: string, file: File) {
    const dataUrl = await createArtworkOverrideDataUrl(file);
    writeCachedArtworkOverride(trackId, dataUrl);
    const updateTrack = (track: Track) =>
      track.id === trackId && track.source === "local" ? { ...track, coverUrl: dataUrl } : track;
    options.applyTrackUpdate(trackId, updateTrack, { includeHistory: true });
  }

  return {
    localTracks,
    setLocalTracks,
    libraryMeta,
    setLibraryMeta,
    folderName,
    setFolderName,
    artworkSyncingRef,
    localCoverWarmupRef,
    preloadTrackCovers,
    warmLocalCoverCache,
    applyArtworkToTrack,
    scanBackendPath,
    scanCdLibrary,
    replaceLocalArtwork,
  };
}
