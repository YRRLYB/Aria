// Cloud-only playback does not need to load an extra native image library.
let processor: Promise<typeof import("sharp")["default"]> | undefined;
let active = false;
const waiting: Array<() => void> = [];

export async function createCoverThumbnail(body: Buffer, size: 320 | 768): Promise<Buffer> {
  if (active) await new Promise<void>((resolve) => waiting.push(resolve));
  active = true;
  try {
    const sharp = await (processor ??= import("sharp").then(({ default: sharp }) => {
      // The disk cache owns reuse; retain no decoded originals in libvips.
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    }));
    return await sharp(body, { sequentialRead: true, limitInputPixels: 64 * 1024 * 1024 })
      .rotate().resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 }).toBuffer();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}
