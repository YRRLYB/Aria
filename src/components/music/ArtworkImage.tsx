import { useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { artworkImageCandidates } from "@/lib/coverUrl";

type ArtworkImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackSrc?: string | null;
  cacheSize?: number;
};

/** Prefer Aria's persistent cache, then use the original CDN if it is unavailable. */
export function ArtworkImage({
  src,
  fallbackSrc,
  cacheSize = 320,
  onError,
  ...props
}: ArtworkImageProps) {
  const candidates = artworkImageCandidates(src, fallbackSrc, cacheSize);
  const sourceKey = JSON.stringify(candidates);
  const [attempt, setAttempt] = useState({ key: sourceKey, index: 0 });
  const index = attempt.key === sourceKey ? attempt.index : 0;
  const imageSrc = candidates[index];

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (index + 1 < candidates.length) {
      setAttempt({ key: sourceKey, index: index + 1 });
      return;
    }
    onError?.(event);
  };

  return <img {...props} src={imageSrc} onError={handleError} />;
}
