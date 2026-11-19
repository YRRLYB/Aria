import { useEffect, useRef, useState, type RefObject } from "react";
import type { Track } from "@/data/music";
import { useVideoPlayback, type VideoControl } from "@/hooks/useVideoPlayback";
import { cn } from "@/lib/utils";

export function VideoStage({
  track,
  src,
  audioSrc,
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
  src?: string;
  audioSrc?: string;
  active: boolean;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    setHasFrame(false);
  }, [track.id]);

  useVideoPlayback({
    videoRef,
    active,
    videoUrl: src ?? track.videoUrl,
    audioUrl: audioSrc,
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
      muted
      playsInline
      preload="auto"
      poster={hasFrame ? undefined : track.coverUrl}
      onLoadedData={() => setHasFrame(true)}
      className={cn("size-full bg-black object-contain", className)}
      aria-label={`${track.title} 实时视频画面`}
    />
  );
}
