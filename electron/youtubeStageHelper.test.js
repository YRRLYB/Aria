import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  YOUTUBE_STAGE_PARTITION,
  DEFAULT_CONSENT_SOCS,
  isValidYoutubeVideoId,
  buildYoutubeStageWatchUrl,
  isAllowedYoutubeStageUrl,
  isAllowedYoutubeStageNavigation,
  isBlockedYoutubeStageAdUrl,
  parseYoutubeCookieHeader,
} = require("./youtubeStageHelper.cjs");

describe("youtubeStageHelper", () => {
  it("validates 11-character YouTube video IDs and watch URLs", () => {
    expect(YOUTUBE_STAGE_PARTITION).toBe("aria-youtube-stage");
    expect(isValidYoutubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidYoutubeVideoId("abc_123-XYZ")).toBe(true);
    expect(isValidYoutubeVideoId("too-short")).toBe(false);
    expect(isValidYoutubeVideoId("bad?param=1")).toBe(false);

    expect(buildYoutubeStageWatchUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=zh-CN",
    );
    expect(buildYoutubeStageWatchUrl("invalid")).toBeNull();
  });

  it("restricts attached webview src and navigation origins", () => {
    expect(isAllowedYoutubeStageUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=zh-CN")).toBe(true);
    expect(isAllowedYoutubeStageUrl("https://www.youtube.com/")).toBe(false);
    expect(isAllowedYoutubeStageUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isAllowedYoutubeStageUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isAllowedYoutubeStageUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isAllowedYoutubeStageUrl("javascript:alert(1)")).toBe(false);

    expect(isAllowedYoutubeStageNavigation("https://consent.youtube.com/m?continue=abc")).toBe(true);
    expect(isAllowedYoutubeStageNavigation("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isAllowedYoutubeStageNavigation("https://accounts.google.com/")).toBe(false);
    expect(isAllowedYoutubeStageNavigation("https://www.youtube.com/results?search_query=test")).toBe(false);
  });

  it("parses cookie headers with __Host-, __Secure-, deduplication and SOCS default", () => {
    const cookies = parseYoutubeCookieHeader(
      "SID=old; __Secure-1PSID=sec1; __Host-GAPS=hostval; SID=new; PREF=tz=Asia.Shanghai; =broken",
      1_700_000_000_000,
    );
    const byName = new Map(cookies.map((c) => [c.name, c]));

    expect(byName.get("SID")?.value).toBe("new");
    expect(byName.get("SID")?.domain).toBe(".youtube.com");
    expect(byName.get("SID")?.secure).toBe(true);
    expect(byName.get("SID")?.sameSite).toBe("no_restriction");

    expect(byName.get("__Secure-1PSID")?.secure).toBe(true);
    expect(byName.get("__Secure-1PSID")?.sameSite).toBe("no_restriction");

    const hostCookie = byName.get("__Host-GAPS");
    expect(hostCookie).toBeDefined();
    expect("domain" in hostCookie).toBe(false);
    expect(hostCookie?.secure).toBe(true);
    expect(hostCookie?.url).toBe("https://www.youtube.com");

    expect(byName.get("SOCS")?.value).toBe(DEFAULT_CONSENT_SOCS);

    const customSocs = parseYoutubeCookieHeader("SOCS=custom_val", 1_700_000_000_000);
    expect(customSocs.find((c) => c.name === "SOCS")?.value).toBe("custom_val");
  });

  it("blocks known YouTube ad hosts and ad endpoints without touching playback streams", () => {
    expect(isBlockedYoutubeStageAdUrl("https://googleads.g.doubleclick.net/pagead/viewthroughconversion")).toBe(true);
    expect(isBlockedYoutubeStageAdUrl("https://pagead2.googlesyndication.com/pagead/js/lidar.js")).toBe(true);
    expect(isBlockedYoutubeStageAdUrl("https://www.youtube.com/pagead/interaction/?ai=1")).toBe(true);
    expect(isBlockedYoutubeStageAdUrl("https://www.youtube.com/api/stats/ads?ad_event=1")).toBe(true);
    expect(isBlockedYoutubeStageAdUrl("https://www.youtube.com/get_midroll_info?v=dQw4w9WgXcQ")).toBe(true);

    expect(isBlockedYoutubeStageAdUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=zh-CN")).toBe(false);
    expect(isBlockedYoutubeStageAdUrl("https://www.youtube.com/s/player/abc/base.js")).toBe(false);
    expect(isBlockedYoutubeStageAdUrl("https://rr1---sn-abc.googlevideo.com/videoplayback?id=1")).toBe(false);
  });
});
