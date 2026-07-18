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
  if (!track.coverUrl) {
    await copyTrackTextToClipboard(track);
    return;
  }

  const ClipboardItemCtor = window.ClipboardItem;
  try {
    if (navigator.clipboard?.write && ClipboardItemCtor) {
      const response = await fetch(track.coverUrl);
      if (response.ok) {
        const blob = await response.blob();
        const type = blob.type || "image/png";
        await navigator.clipboard.write([new ClipboardItemCtor({ [type]: blob })]);
        return;
      }
    }
  } catch {
    // Cross-origin cover images can reject binary clipboard writes. The URL is still useful.
  }

  await copyTextToClipboard(track.coverUrl);
}
