import { describe, expect, it } from "vitest";
import { normalizeSongCreators, normalizeSongWiki } from "./songEncyclopedia";

describe("song encyclopedia normalization", () => {
  it("extracts BPM, tags and background from basic blocks only", () => {
    const item = (label: string, content: unknown) => ({ uiElement: { mainTitle: { title: label }, textLinks: [{ text: content }] } });
    const result = normalizeSongWiki({ data: { blocks: [
      { code: "SONG_PLAY_ABOUT_SIMILAR_SONG", creatives: [item("advert", "skip")] },
      { code: "SONG_PLAY_ABOUT_SONG_BASIC", creatives: [
        item("BPM", "68"),
        { creativeType: "songComment", ...item("comment", "skip") },
        { uiElement: { mainTitle: { title: "Style" } }, resources: [
          { uiElement: { mainTitle: { title: "<b>Pop</b> &amp; Rock" }, descriptions: [{ description: "Background" }] } },
          { valid: false, uiElement: { mainTitle: { title: "invalid" } } },
        ] },
      ] },
    ] } });
    expect(result[0].items).toEqual([
      { label: "BPM", values: ["68"], descriptions: [] },
      { label: "Style", values: ["Pop & Rock"], descriptions: ["Background"] },
    ]);
  });

  it("deduplicates creators within roles and tolerates missing data", () => {
    expect(normalizeSongCreators({ data: { songCreatorsRoleVos: [
      { roleName: "Lyrics", creatorMetaVOS: [{ artistName: "A" }, { artistName: "A" }, { artistName: "<i>B</i>" }, null] },
      { roleName: "Empty" },
    ] } })).toEqual([{ role: "Lyrics", creators: [{ name: "A" }, { name: "B" }] }]);
    expect(normalizeSongWiki(null)).toEqual([]);
    expect(normalizeSongCreators(null)).toEqual([]);
  });
});
