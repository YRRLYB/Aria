import { useEffect, useRef, type CSSProperties } from "react";
import type { LyricLine } from "@/data/music";
import { getLyricWordProgress } from "@/lib/lyricTiming";
import { getPlaybackTime, subscribePlaybackTime } from "@/lib/playbackClock";

export function WordLyricText({
  line,
  active,
  currentTime,
  playing,
  color = "#6d4bc3",
  pendingColor = "#a3a3a3",
}: {
  line: LyricLine;
  active: boolean;
  currentTime?: number;
  playing: boolean;
  color?: string;
  pendingColor?: string;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const hasWords = Boolean(line.words?.length);

  useEffect(() => {
    const words = line.words;
    const container = containerRef.current;
    if (!active || !hasWords || !words?.length || !container) return;

    const lastQuantized = new Int16Array(words.length).fill(-1);
    const applyWordProgress = (time: number) => {
      const children = container.children;
      for (let index = 0; index < words.length; index += 1) {
        const element = children[index] as HTMLElement | undefined;
        if (!element) continue;
        const progress = getLyricWordProgress(words[index], time) * 100;
        const quantized = Math.round(progress * 2);
        if (lastQuantized[index] === quantized) continue;
        lastQuantized[index] = quantized;
        const pct = quantized / 2;
        element.style.backgroundImage = `linear-gradient(90deg, ${color} ${pct}%, ${pendingColor} ${pct}%)`;
      }
    };

    let anchorTime = typeof currentTime === "number" ? currentTime : getPlaybackTime();
    let anchorNow = performance.now();
    applyWordProgress(anchorTime);

    const unsubscribe = typeof currentTime === "number"
      ? undefined
      : subscribePlaybackTime(() => {
          anchorTime = getPlaybackTime();
          anchorNow = performance.now();
          if (!document.hidden) applyWordProgress(anchorTime);
        });

    if (!playing) return () => unsubscribe?.();

    let frame = 0;
    let lastFrame = anchorNow;
    const schedule = () => {
      if (frame || document.hidden) return;
      frame = requestAnimationFrame(draw);
    };
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (now - lastFrame >= 42) {
        lastFrame = now;
        // Smooth only the active lyric between playback clock samples. The cap
        // prevents a buffered/stalled audio source from running ahead visually.
        const sampleTime = anchorTime + Math.min(0.4, (now - anchorNow) / 1000);
        applyWordProgress(sampleTime);
      }
      schedule();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      } else {
        anchorTime = typeof currentTime === "number" ? currentTime : getPlaybackTime();
        anchorNow = performance.now();
        applyWordProgress(anchorTime);
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe?.();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, color, currentTime, hasWords, line.words, pendingColor, playing]);

  if (!active || !line.words?.length) return <>{line.text}</>;
  const renderTime = typeof currentTime === "number" ? currentTime : getPlaybackTime();
  return (
    <span ref={containerRef} aria-label={line.text} data-word-lyrics="true">
      {line.words.map((word, index) => {
        const progress = getLyricWordProgress(word, renderTime) * 100;
        const style: CSSProperties = {
          backgroundImage: `linear-gradient(90deg, ${color} ${progress}%, ${pendingColor} ${progress}%)`,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent",
        };
        return <span key={`${word.startTime}-${index}`} aria-hidden="true" style={style}>{word.text}</span>;
      })}
    </span>
  );
}
