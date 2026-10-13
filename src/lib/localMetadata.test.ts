import { describe, expect, it } from "vitest";
import { metadataConfidence, metadataMatchScore, selectAutomaticMetadataCandidate } from "./localMetadata";

describe("local metadata confidence", () => {
  const track = { title: "Blue Moon", artist: "Alice / Bob", album: "Night Songs" };
  it("compares tags instead of trusting the order returned by search", () => {
    expect(metadataMatchScore(track, { ...track, artist: "Bob & Alice", title: "Ｂｌｕｅ　Ｍｏｏｎ" })).toBe(100);
    expect(metadataConfidence(metadataMatchScore(track, { ...track, title: "Something Else" }))).toBe("low");
  });
  it("keeps missing artists and different recordings out of high-confidence selection", () => {
    expect(metadataConfidence(metadataMatchScore({ ...track, artist: "Unknown Artist" }, track))).toBe("low");
    expect(metadataConfidence(metadataMatchScore(track, { ...track, title: "Blue Moon (Live)" }))).not.toBe("high");
    expect(metadataConfidence(metadataMatchScore(track, { ...track, artist: "Another Band" }))).not.toBe("high");
    const long = { ...track, title: "The Really Long Name of My Favorite Song" };
    expect(metadataConfidence(metadataMatchScore(long, { ...long, title: `${long.title} (Live)` }))).not.toBe("high");
  });
  it("does not penalize an unknown album when title and artist agree", () => {
    expect(metadataMatchScore({ ...track, album: "Unknown Album" }, track)).toBe(100);
  });
  it("automatically binds only a distinct high-confidence match", () => {
    const right = { ...track, id: "right" };
    const wrong = { ...track, id: "wrong", title: "Another Song" };
    expect(selectAutomaticMetadataCandidate(track, [wrong, right])?.id).toBe("right");
    expect(selectAutomaticMetadataCandidate(track, [right, { ...right, id: "ambiguous" }])).toBeUndefined();
    expect(selectAutomaticMetadataCandidate({ ...track, artist: "Unknown Artist" }, [right])).toBeUndefined();
    expect(selectAutomaticMetadataCandidate(track, [{ ...right, title: `${track.title} (Live)` }])).toBeUndefined();
  });
});
