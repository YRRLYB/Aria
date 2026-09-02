const artworkOverrideKey = "aria-local-artwork-overrides";
const maxStoredArtwork = 16;
const maxArtworkDataUrlLength = 900_000;

type ArtworkOverrideEntry = {
  dataUrl: string;
  updatedAt: number;
};

type ArtworkOverrideCache = Record<string, ArtworkOverrideEntry>;

// Parsed once per session; localTrackToUiTrack reads this per library track and
// re-parsing the (dataURL-heavy) localStorage blob each time is far too costly.
let artworkOverrideState: ArtworkOverrideCache | null = null;

export function readCachedArtworkOverride(trackId?: string) {
  if (!trackId) return undefined;
  return readArtworkOverrideCache()[trackId]?.dataUrl;
}

export function writeCachedArtworkOverride(trackId: string, dataUrl: string) {
  if (!trackId || !dataUrl) return;
  const cache = readArtworkOverrideCache();
  cache[trackId] = { dataUrl, updatedAt: Date.now() };
  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
      .slice(-maxStoredArtwork),
  );
  artworkOverrideState = trimmed;

  try {
    window.localStorage.setItem(artworkOverrideKey, JSON.stringify(trimmed));
  } catch {
    try {
      window.localStorage.setItem(artworkOverrideKey, JSON.stringify({ [trackId]: cache[trackId] }));
    } catch {
      // Artwork persistence is best-effort; the UI can still use the selected cover immediately.
    }
  }
}

export async function createArtworkOverrideDataUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image.");
  }

  const drawable = await decodeImage(file);
  const sourceWidth = drawable.width;
  const sourceHeight = drawable.height;
  const targetSize = Math.min(1024, Math.max(560, Math.max(sourceWidth, sourceHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  context.fillStyle = "#f4f5f7";
  context.fillRect(0, 0, targetSize, targetSize);

  const scale = Math.min(targetSize / sourceWidth, targetSize / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = (targetSize - drawWidth) / 2;
  const y = (targetSize - drawHeight) / 2;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(drawable, x, y, drawWidth, drawHeight);

  if ("close" in drawable && typeof drawable.close === "function") {
    drawable.close();
  }

  let bestDataUrl = canvas.toDataURL("image/jpeg", 0.88);
  for (const quality of [0.8, 0.72, 0.64]) {
    if (bestDataUrl.length <= maxArtworkDataUrlLength) break;
    bestDataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return bestDataUrl;
}

function readArtworkOverrideCache(): ArtworkOverrideCache {
  if (artworkOverrideState) return artworkOverrideState;
  try {
    const raw = window.localStorage.getItem(artworkOverrideKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ArtworkOverrideEntry | string>) : {};
    artworkOverrideState = Object.fromEntries(
      Object.entries(parsed)
        .map(([trackId, value]) => {
          if (typeof value === "string") {
            return [trackId, { dataUrl: value, updatedAt: 0 }] as const;
          }
          if (value && typeof value.dataUrl === "string") {
            return [trackId, { dataUrl: value.dataUrl, updatedAt: Number(value.updatedAt) || 0 }] as const;
          }
          return null;
        })
        .filter((entry): entry is readonly [string, ArtworkOverrideEntry] => Boolean(entry)),
    );
  } catch {
    artworkOverrideState = {};
  }
  return artworkOverrideState;
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall back to HTMLImageElement decoding below.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
