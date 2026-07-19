import type { Track } from "@/data/music";

export type TrackCopyField = "summary" | "title" | "artist" | "album";

export async function copyTextToClipboard(text: string) {
  const value = text.trim();
  if (!value) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall back to the hidden textarea path below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function formatTrackCopyText(track: Track, field: TrackCopyField = "summary") {
  if (field === "title") return track.title;
  if (field === "artist") return track.artist;
  if (field === "album") return track.album;
  return `${track.title} - ${track.artist}`;
}

export function copyTrackTextToClipboard(track: Track, field: TrackCopyField = "summary") {
  return copyTextToClipboard(formatTrackCopyText(track, field));
}

export async function copyArtworkToClipboard(track: Track) {
  const copyImageToClipboard = window.ariaDesktop?.copyImageToClipboard;
  if (copyImageToClipboard) {
    try {
      const copied = await copyImageToClipboard(
        track.coverUrl?.startsWith("data:")
          ? { dataUrl: track.coverUrl }
          : track.coverUrl
            ? { url: track.coverUrl }
            : {},
      );
      if (copied) return;
    } catch {
      // Use the renderer fallback below when the native bridge rejects.
    }
  }

  const ClipboardItemCtor = window.ClipboardItem;
  if (track.coverUrl && (await copyArtworkUrlToClipboard(track.coverUrl, ClipboardItemCtor))) return;

  try {
    if (navigator.clipboard?.write && ClipboardItemCtor) {
      const blob = await createFallbackArtworkBlob(track);
      await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })]);
      return;
    }
  } catch {
    // Fall through to URL/text clipboard below.
  }

  await copyTextToClipboard(track.coverUrl ?? formatTrackCopyText(track));
}

async function copyArtworkUrlToClipboard(url: string, ClipboardItemCtor: typeof ClipboardItem | undefined) {
  try {
    if (!navigator.clipboard?.write || !ClipboardItemCtor) return false;
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    const type = blob.type || "image/png";
    await navigator.clipboard.write([new ClipboardItemCtor({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

async function createFallbackArtworkBlob(track: Track) {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#f6f7f9");
  gradient.addColorStop(0.5, track.accent || "#8b93a3");
  gradient.addColorStop(1, "#171717");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.fillStyle = "rgba(255,255,255,0.18)";
  context.beginPath();
  context.arc(size * 0.78, size * 0.18, size * 0.34, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(0,0,0,0.32)";
  context.fillRect(0, size * 0.68, size, size * 0.32);

  context.fillStyle = "#ffffff";
  context.font = "700 74px Inter, system-ui, sans-serif";
  wrapCanvasText(context, track.title, 76, size * 0.78, size - 152, 86, 2);
  context.font = "500 36px Inter, system-ui, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.78)";
  wrapCanvasText(context, track.artist, 76, size * 0.93, size - 152, 44, 1);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Artwork export failed.");
  return blob;
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words.length ? words : [text]) {
    const testLine = current ? `${current} ${word}` : word;
    if (context.measureText(testLine).width <= maxWidth || !current) {
      current = testLine;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  lines.slice(0, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, maxWidth);
  });
}
