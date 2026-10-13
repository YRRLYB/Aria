import { useEffect, useState, type CSSProperties } from "react";
import type { LyricLine } from "@/data/music";
import { getLyricWordProgress } from "@/lib/lyricTiming";

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
  currentTime: number;
  playing: boolean;
  color?: string;
  pendingColor?: string;
}) {
  const [visualSample, setVisualSample] = useState({ sourceTime: currentTime, time: currentTime });
  const hasWords = Boolean(line.words?.length);
  useEffect(() => {
    setVisualSample({ sourceTime: currentTime, time: currentTime });
    if (!active || !playing || !hasWords) return;
    const anchor = performance.now();
    let frame = 0;
    let lastFrame = anchor;
    const draw = (now: number) => {
      if (now - lastFrame >= 32) {
        lastFrame = now;
        // Smooth only the active lyric between playback clock samples. The cap
        // prevents a buffered/stalled audio source from running ahead visually.
        setVisualSample({ sourceTime: currentTime, time: currentTime + Math.min(0.4, (now - anchor) / 1000) });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, currentTime, hasWords, playing]);

  if (!active || !line.words?.length) return <>{line.text}</>;
  // Pausing and seeking use the actual sample immediately, including backwards.
  const time = playing && visualSample.sourceTime === currentTime ? visualSample.time : currentTime;
  return (
    <span aria-label={line.text} data-word-lyrics="true">
      {line.words.map((word, index) => {
        const progress = getLyricWordProgress(word, time) * 100;
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
