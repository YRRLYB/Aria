import { describe, expect, it } from "vitest";
import { appendAvatarHistory, resolveAriaRoomIdentity, type AriaRoomProfile } from "./ariaRoomProfile";

const baseProfile: AriaRoomProfile = {
  peerId: "aria-ab12cd34ef56",
  mode: "inherit",
  preferredSource: "auto",
  customNickname: "",
  customAvatarDataUrl: null,
  shareEnabled: true,
};

describe("ariaRoomProfile identity resolution", () => {
  it("inherits primary connected music account in priority order", () => {
    const resolved = resolveAriaRoomIdentity(baseProfile, [
      { source: "netease", connected: false, nickname: "OldNetease", avatarUrl: "https://n.jpg" },
      { source: "qq", connected: true, nickname: "QQListener", avatarUrl: "https://qq.jpg" },
      { source: "bilibili", connected: true, nickname: "BiliUser", avatarUrl: "https://b.jpg" },
    ]);
    expect(resolved.isInherited).toBe(true);
    expect(resolved.inheritedFromSource).toBe("qq");
    expect(resolved.nickname).toBe("QQListener");
    expect(resolved.avatarUrl).toBe("https://qq.jpg");
  });

  it("respects explicit preferred source override", () => {
    const resolved = resolveAriaRoomIdentity(
      { ...baseProfile, preferredSource: "bilibili" },
      [
        { source: "netease", connected: true, nickname: "NeteaseUser", avatarUrl: "https://n.jpg" },
        { source: "bilibili", connected: true, nickname: "BiliUser", avatarUrl: "https://b.jpg" },
      ],
    );
    expect(resolved.inheritedFromSource).toBe("bilibili");
    expect(resolved.nickname).toBe("BiliUser");
  });

  it("supports zero-account custom mode and anonymous local fallback", () => {
    const custom = resolveAriaRoomIdentity(
      {
        ...baseProfile,
        mode: "custom",
        customNickname: "HifiExplorer",
        customAvatarDataUrl: "data:image/jpeg;base64,AAA",
      },
      [],
    );
    expect(custom.isInherited).toBe(false);
    expect(custom.nickname).toBe("HifiExplorer");
    expect(custom.avatarUrl).toBe("data:image/jpeg;base64,AAA");

    const anon = resolveAriaRoomIdentity(baseProfile, []);
    expect(anon.isInherited).toBe(false);
    expect(anon.nickname).toBe("Aria 听友-EF56");
    expect(anon.avatarUrl).toBeNull();
  });

  it("supports direct avatar selection override and deduplicated avatar history capped at 16", () => {
    const picked = resolveAriaRoomIdentity(
      { ...baseProfile, mode: "custom", customNickname: "MyAlias", selectedAvatarUrl: "https://b.jpg" },
      [{ source: "netease", connected: true, nickname: "NeteaseUser", avatarUrl: "https://n.jpg" }],
    );
    expect(picked.nickname).toBe("MyAlias");
    expect(picked.avatarUrl).toBe("https://b.jpg");

    let history: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      history = appendAvatarHistory(history, `data:image/jpeg;base64,IMG_${i}`);
    }
    expect(history).toHaveLength(16);
    expect(history[0]).toBe("data:image/jpeg;base64,IMG_19");

    // Re-adding an existing item promotes it to the front without duplicating
    const promoted = appendAvatarHistory(history, "data:image/jpeg;base64,IMG_10");
    expect(promoted).toHaveLength(16);
    expect(promoted[0]).toBe("data:image/jpeg;base64,IMG_10");
    expect(promoted.filter((item) => item === "data:image/jpeg;base64,IMG_10")).toHaveLength(1);
  });
});
