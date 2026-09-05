import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import type { Track } from "@/data/music";
import { copyArtworkToClipboard, copyTrackTextToClipboard, type TrackCopyField } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type CoverLoadState = "loading" | "ready" | "error";

// Keep a small session-level decode index. Browser image caches are opaque to
// React, and without this index every surface briefly paints its generated
// poster before discovering that the same cover was already loaded elsewhere.
const coverLoadStates = new Map<string, CoverLoadState>();
const maxCoverLoadStates = 96;

// Player-size artwork decodes through an offscreen bitmap so oversized covers
// (embedded FLAC artwork can exceed 3000px) shrink before they reach
// Chromium's decoded image cache. Only a few object URLs are retained; the
// rest are revoked after a grace period so exiting panels keep painting.
const maxBoundedCoverPixels = 768;
const maxBoundedCoverEntries = 4;
const boundedCoverUrlGraceMs = 60_000;
const boundedCoverUrls = new Map<string, string>();
const pendingBoundedCoverUrls = new Map<string, Promise<string | null>>();

export function getBoundedCoverUrl(url?: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const cached = boundedCoverUrls.get(url);
  if (cached) {
    boundedCoverUrls.delete(url);
    boundedCoverUrls.set(url, cached);
    return Promise.resolve(cached);
  }

  const pending = pendingBoundedCoverUrls.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) return url;
      const bitmap = await createImageBitmap(await response.blob());
      try {
        if (bitmap.width <= maxBoundedCoverPixels && bitmap.height <= maxBoundedCoverPixels) return url;

        const scale = Math.min(1, maxBoundedCoverPixels / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) return url;
        context.drawImage(bitmap, 0, 0, width, height);
        const encoded = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
        const boundedUrl = URL.createObjectURL(encoded);
        boundedCoverUrls.set(url, boundedUrl);
        while (boundedCoverUrls.size > maxBoundedCoverEntries) {
          const oldest = boundedCoverUrls.keys().next().value;
          if (oldest === undefined) break;
          const staleUrl = boundedCoverUrls.get(oldest);
          boundedCoverUrls.delete(oldest);
          if (staleUrl) window.setTimeout(() => URL.revokeObjectURL(staleUrl), boundedCoverUrlGraceMs);
        }
        return boundedUrl;
      } finally {
        bitmap.close();
      }
    } catch {
      return url;
    }
  })();

  pendingBoundedCoverUrls.set(url, request);
  void request.finally(() => {
    if (pendingBoundedCoverUrls.get(url) === request) pendingBoundedCoverUrls.delete(url);
  });
  return request;
}

function markCoverReady(url?: string | null) {
  if (!url) return;
  coverLoadStates.delete(url);
  coverLoadStates.set(url, "ready");
  trimCoverLoadStates();
}

function trimCoverLoadStates() {
  while (coverLoadStates.size > maxCoverLoadStates) {
    const oldest = coverLoadStates.keys().next().value;
    if (oldest === undefined) break;
    coverLoadStates.delete(oldest);
  }
}

export function StatTile({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-[1.15rem] bg-white/58 p-4 shadow-sm">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className={cn("mt-2 truncate font-semibold", compact ? "text-xl" : "text-3xl")}>{value}</p>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[1.15rem] border border-dashed border-neutral-300/70 bg-white/45 p-5 text-sm text-neutral-500">
      {text}
    </div>
  );
}

export function ArtistAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imageSrc =
    avatarUrl && avatarUrl.includes("/api/providers/netease/cover")
      ? `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}size=320y320`
      : avatarUrl;

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-neutral-200 via-white to-neutral-300 text-neutral-500 shadow-sm",
        className,
      )}
    >
      {imageSrc && !failed ? (
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onDragStart={(event) => event.preventDefault()}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <UserRound className="size-1/2" />
          <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2 py-1 text-xs font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </span>
        </>
      )}
    </div>
  );
}

export function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/62 px-2 py-3">
      <p className="text-base font-semibold text-neutral-950">{value}</p>
      <p className="mt-1">{label}</p>
    </div>
  );
}

// Oversized embedded artwork is decoded into a bounded bitmap before it is
// handed to the player <img>; while that resolves, the caller keeps painting
// its generated poster instead of decoding the full-resolution image.
function useLargeCoverSrc(url: string | undefined, large: boolean) {
  const normalizedUrl =
    large && url && url.includes("/api/providers/netease/cover")
      ? `${url}${url.includes("?") ? "&" : "?"}size=512y512`
      : url;
  const needsBoundedCover = Boolean(
    large && normalizedUrl && !normalizedUrl.startsWith("data:"),
  );
  const [src, setSrc] = useState<string | undefined>(needsBoundedCover ? undefined : normalizedUrl);

  useEffect(() => {
    if (!needsBoundedCover) {
      setSrc(normalizedUrl);
      return;
    }
    let mounted = true;
    setSrc(undefined);
    void getBoundedCoverUrl(normalizedUrl).then((resolved) => {
      if (mounted && resolved) setSrc(resolved);
    });
    return () => {
      mounted = false;
    };
  }, [needsBoundedCover, normalizedUrl]);

  return src;
}

export function CoverArt({
  track,
  className,
  large = false,
  fit = "cover",
  onArtworkContextMenu,
}: {
  track: Track;
  className?: string;
  large?: boolean;
  fit?: "cover" | "contain";
  onArtworkContextMenu?: (event: MouseEvent<HTMLElement>, track: Track) => void;
}) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  // List rows render at ~56px; ask the NetEase proxy for a 300px thumbnail so
  // full-resolution artwork is only decoded for the player surfaces.
  const largeCoverSrc = useLargeCoverSrc(track.coverUrl, large);
  const thumbnailSrc =
    track.coverUrl && track.coverUrl.includes("/api/providers/netease/cover")
      ? `${track.coverUrl}${track.coverUrl.includes("?") ? "&" : "?"}size=300y300`
      : track.coverUrl;
  const imageSrc = large ? largeCoverSrc : thumbnailSrc;
  const previewSrc = null;
  const hasImage = Boolean(imageSrc) && failedImageSrc !== imageSrc;
  const [imageReady, setImageReady] = useState(() => imageSrc ? coverLoadStates.get(imageSrc) === "ready" : false);

  useEffect(() => {
    setFailedImageSrc(null);
    if (!imageSrc) {
      setImageReady(false);
      return;
    }
    if (imageSrc.startsWith("data:") || coverLoadStates.get(imageSrc) === "ready") {
      setImageReady(true);
      return;
    }
    // Let the visible <img> own the only decoder for this cover. A separate
    // preload Image followed by the visible element doubled decoded memory.
  }, [imageSrc, large]);

  const copyArtwork = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (onArtworkContextMenu) {
      onArtworkContextMenu(event, track);
      return;
    }
    void copyArtworkToClipboard(track);
  };

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-neutral-950", className)}
      style={{ background: track.cover }}
      aria-hidden="true"
      data-cover-ready={!hasImage || imageReady ? "true" : "false"}
      onContextMenu={copyArtwork}
      onDragStart={(event) => event.preventDefault()}
    >
      {hasImage ? (
        <>
          {previewSrc && (
            <img
              src={previewSrc}
              alt=""
              loading="eager"
              decoding="async"
              fetchPriority="high"
              draggable={false}
              className="absolute inset-0 size-full object-cover"
              onDragStart={(event) => event.preventDefault()}
            />
          )}
          {fit === "contain" && (
            <img
              src={imageSrc}
              alt=""
              loading={large ? "eager" : "lazy"}
              decoding={large ? "sync" : "async"}
              fetchPriority={large ? "high" : "auto"}
              draggable={false}
              className="absolute inset-0 size-full scale-110 object-cover opacity-55 blur-2xl"
              onDragStart={(event) => event.preventDefault()}
            />
          )}
          <img
            src={imageSrc}
            alt=""
            loading={large ? "eager" : "lazy"}
            decoding={large ? "sync" : "async"}
            fetchPriority={large ? "high" : "auto"}
            draggable={false}
            className={cn("absolute inset-0 size-full", fit === "contain" ? "object-contain" : "object-cover")}
            onDragStart={(event) => event.preventDefault()}
            onLoad={() => {
              markCoverReady(imageSrc);
              setImageReady(true);
            }}
            onError={() => {
              setFailedImageSrc(imageSrc ?? null);
              setImageReady(false);
            }}
            />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-white/8" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 opacity-95" style={{ background: track.cover }} />
          <div className="absolute inset-0 bg-gradient-to-br from-white/22 via-transparent to-black/32" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.12),transparent_42%,rgba(0,0,0,0.18))]" />
          {large && track.id !== "idle" && (
            <div className="absolute inset-x-7 bottom-7 z-10 text-white">
              <p className="line-clamp-3 text-3xl font-semibold leading-tight drop-shadow">{track.title}</p>
              <p className="mt-2 truncate text-sm font-medium text-white/74">{track.artist}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CopyableTrackText({
  track,
  field = "summary",
  className,
  children,
}: {
  track: Track;
  field?: TrackCopyField;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn("cursor-copy", className)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyTrackTextToClipboard(track, field);
      }}
    >
      {children ?? (field === "artist" ? track.artist : field === "album" ? track.album : field === "title" ? track.title : `${track.title} - ${track.artist}`)}
    </span>
  );
}
