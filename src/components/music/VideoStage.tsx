import { useRef, type RefObject } from "react";
import type { Track } from "@/data/music";
import { useVideoPlayback, type VideoControl } from "@/hooks/useVideoPlayback";
import { cn } from "@/lib/utils";

export function VideoStage({
  track,
  active,
  playing,
  volume,
  controlRef,
  onDuration,
  onEnded,
  onError,
  className,
}: {
  track: Track;
  active: boolean;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration: (seconds: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useVideoPlayback({
    videoRef,
    active,
    videoUrl: track.videoUrl,
    playing,
    volume,
    controlRef,
    onDuration,
    onEnded,
    onError,
  });

  return (
    <video
      ref={videoRef}
      className={cn("size-full bg-black object-contain", className)}
      poster={track.coverUrl}
      playsInline
      preload="metadata"
      aria-label={`${track.title} 视频`}
    />
  );
}
