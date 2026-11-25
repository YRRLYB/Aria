import { useEffect, useRef, useState, type RefObject } from "react";
import type { Track } from "@/data/music";
import { useVideoPlayback, type VideoControl } from "@/hooks/useVideoPlayback";
import { cn } from "@/lib/utils";
import { YoutubeWebviewStage } from "./YoutubeWebviewStage";

function HtmlVideoStage({
  track,
  src,
  audioSrc,
  standaloneAudio = false,
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
  standaloneAudio?: boolean;
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
    standaloneAudio,
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
      muted={!standaloneAudio}
      playsInline
      preload="auto"
      poster={hasFrame ? undefined : track.coverUrl}
      onLoadedData={() => setHasFrame(true)}
      className={cn("size-full bg-black object-contain", className)}
      aria-label={`${track.title} 实时视频画面`}
    />
  );
}

export function VideoStage({
  track,
  src,
  audioSrc,
  standaloneAudio = false,
  active,
  playing,
  volume,
  controlRef,
  onDuration,
  onEnded,
  onError,
  youtubeWebviewEnabled = false,
  youtubeQualityId = null,
  youtubeOffsetSeconds = 0,
  onYoutubeQualities,
  onYoutubeWebviewFallback,
  className,
}: {
  track: Track;
  src?: string;
  audioSrc?: string;
  standaloneAudio?: boolean;
  active: boolean;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
  youtubeWebviewEnabled?: boolean;
  youtubeQualityId?: number | null;
  youtubeOffsetSeconds?: number;
  onYoutubeQualities?: (qualities: Array<{ id: number; label: string }>, activeLabel: string | null) => void;
  onYoutubeWebviewFallback?: (reason: string) => void;
  className?: string;
}) {
  if (youtubeWebviewEnabled && track.source === "youtube" && track.providerId) {
    return (
      <YoutubeWebviewStage
        track={track}
        active={active}
        playing={playing}
        qualityId={youtubeQualityId}
        offsetSeconds={youtubeOffsetSeconds}
        controlRef={controlRef}
        onQualities={onYoutubeQualities}
        onFallback={(reason) => onYoutubeWebviewFallback?.(reason)}
        className={className}
      />
    );
  }

  return (
    <HtmlVideoStage
      track={track}
      src={src}
      audioSrc={audioSrc}
      standaloneAudio={standaloneAudio}
      active={active}
      playing={playing}
      volume={volume}
      controlRef={controlRef}
      onDuration={onDuration}
      onEnded={onEnded}
      onError={onError}
      className={className}
    />
  );
}
