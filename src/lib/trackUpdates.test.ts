import { describe, expect, it } from "vitest";
import type { Track } from "@/data/music";
import { updateTracksById } from "./trackUpdates";

describe("updateTracksById", () => {
  it("updates only the matching song, including duplicate references", () => {
    const first = { id: "qq:a", quality: "FLAC" } as Track;
    const other = { id: "bilibili:b", quality: "128K" } as Track;
    const tracks = [first, other, first];
    const result = updateTracksById(tracks, "qq:a", (track) => ({ ...track, quality: "320K" }));
    expect(result.map((track) => track.quality)).toEqual(["320K", "128K", "320K"]);
    expect(result[1]).toBe(other);
    expect(tracks[0]).toBe(first);
  });

  it("reuses the array if the target is absent or unchanged", () => {
    const tracks = [{ id: "qq:a" } as Track];
    expect(updateTracksById(tracks, "qq:b", (track) => ({ ...track }))).toBe(tracks);
    expect(updateTracksById(tracks, "qq:a", (track) => track)).toBe(tracks);
  });
});
