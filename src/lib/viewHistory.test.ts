import { describe, expect, it } from "vitest";
import {
  createViewHistory,
  pushViewSnapshot,
  stepViewHistory,
  type ViewHistorySnapshot,
} from "./viewHistory";

function snap(overrides: Partial<ViewHistorySnapshot> = {}): ViewHistorySnapshot {
  return {
    view: "home",
    query: "",
    artist: null,
    album: null,
    user: null,
    playlistSource: null,
    neteasePlaylist: null,
    qqPlaylist: null,
    bilibiliPlaylist: null,
    youtubePlaylist: null,
    localPlaylistId: null,
    ...overrides,
  };
}

describe("viewHistory", () => {
  it("records search -> artist -> album transitions and steps back and forward", () => {
    let history = createViewHistory(snap({ view: "home" }));
    history = pushViewSnapshot(history, snap({ view: "home", query: "Aimer" }));
    history = pushViewSnapshot(
      history,
      snap({
        view: "artists",
        artist: { id: "netease:1", name: "Aimer", source: "netease", providerId: "1", providerSource: "netease", trackCount: 12 },
      }),
    );
    history = pushViewSnapshot(
      history,
      snap({
        view: "artists",
        artist: { id: "netease:1", name: "Aimer", source: "netease", providerId: "1", providerSource: "netease", trackCount: 12 },
        album: {
          id: "alb-1",
          name: "Daydream",
          artist: "Aimer",
          artistId: "1",
          coverUrl: null,
          publishTime: null,
          trackCount: 13,
        },
      }),
    );

    expect(history.entries).toHaveLength(4);
    expect(history.index).toBe(3);

    const backToArtist = stepViewHistory(history, -1);
    expect(backToArtist?.target.album).toBeNull();
    expect(backToArtist?.target.artist?.name).toBe("Aimer");

    const backToSearch = stepViewHistory(backToArtist!.state, -1);
    expect(backToSearch?.target.query).toBe("Aimer");

    const forwardAgain = stepViewHistory(backToSearch!.state, 1);
    expect(forwardAgain?.target.artist?.name).toBe("Aimer");
  });

  it("deduplicates same-identity hydration updates and truncates forward branch on new push", () => {
    let history = createViewHistory(snap({ view: "home" }));
    history = pushViewSnapshot(
      history,
      snap({ view: "playlists", neteasePlaylist: { id: "p1", name: " stub ", trackCount: 0, subscribed: false, coverColor: "#777", coverUrl: null } }),
    );
    history = pushViewSnapshot(
      history,
      snap({ view: "playlists", neteasePlaylist: { id: "p1", name: "Hydrated", trackCount: 28, subscribed: false, coverColor: "#777", coverUrl: "x" } }),
    );
    expect(history.entries).toHaveLength(2);
    expect(history.entries[1].neteasePlaylist?.name).toBe("Hydrated");

    const back = stepViewHistory(history, -1)!;
    const branched = pushViewSnapshot(back.state, snap({ view: "local" }));
    expect(branched.entries).toHaveLength(2);
    expect(branched.entries[1].view).toBe("local");
    expect(stepViewHistory(branched, 1)).toBeNull();
  });
});
