import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createCoverThumbnail } from "./coverThumbnail";

describe("local cover thumbnails", () => {
  it("bounds decoded pixels and preserves aspect ratio for large embedded covers", async () => {
    const original = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#6789ab" } }).png().toBuffer();
    const [row, player] = await Promise.all([createCoverThumbnail(original, 320), createCoverThumbnail(original, 768)]);
    const small = await sharp(row).metadata();
    const large = await sharp(player).metadata();
    expect([small.width, small.height, small.format]).toEqual([320, 213, "webp"]);
    expect([large.width, large.height]).toEqual([768, 512]);
    expect(small.width! * small.height! * 4).toBeLessThan(3000 * 2000 * 4 / 80);
  });
  it("does not enlarge small artwork and recovers after an invalid image", async () => {
    await expect(createCoverThumbnail(Buffer.from("invalid"), 320)).rejects.toThrow();
    const original = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#6789ab" } }).png().toBuffer();
    const result = await sharp(await createCoverThumbnail(original, 320)).metadata();
    expect([result.width, result.height]).toEqual([64, 64]);
  });
});
