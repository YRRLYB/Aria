import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import type { Track } from "@/data/music";
import { copyArtworkToClipboard, copyTrackTextToClipboard, type TrackCopyField } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

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
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
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
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(track.coverUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [track.id, track.coverUrl]);

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
      onContextMenu={copyArtwork}
      onDragStart={(event) => event.preventDefault()}
    >
      {hasImage ? (
        <>
          {fit === "contain" && (
            <img
              key={`blur-${track.coverUrl}`}
              src={track.coverUrl}
              alt=""
              loading={large ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
              className="absolute inset-0 size-full scale-110 object-cover opacity-55 blur-2xl"
              onDragStart={(event) => event.preventDefault()}
              onError={() => setImageFailed(true)}
            />
          )}
          <img
            key={track.coverUrl}
            src={track.coverUrl}
            alt=""
            loading={large ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            className={cn("absolute inset-0 size-full", fit === "contain" ? "object-contain" : "object-cover")}
            onDragStart={(event) => event.preventDefault()}
            onError={() => setImageFailed(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-white/8" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 opacity-95" style={{ background: track.cover }} />
          <div className="absolute inset-0 bg-gradient-to-br from-white/22 via-transparent to-black/32" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.12),transparent_42%,rgba(0,0,0,0.18))]" />
          {large && (
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
