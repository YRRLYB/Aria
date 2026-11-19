import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { HomeSurface } from "./HomeDashboard";
import { FloatingNav } from "./FloatingNav";
import { ExploreSurface } from "./ExploreSurface";
import { HistorySurface } from "./HomeSurfaces";
import { BilibiliLogo, NeteaseLogo, QqLogo, SourceBadge } from "./SourceLogos";
import { StatsSurface } from "./CollectionSurfaces";
import { EqualizerPanel } from "./EqualizerPanel";
import { PlayerSidePanel } from "./PlayerSidePanels";

describe("Aria v0.7.4 surfaces and polish", () => {
  it("uses 年度声迹 and hides the old top-right expand/headphone chrome on HomeDashboard", () => {
    const markup = renderToStaticMarkup(
      <HomeSurface
        activeTrack={tracks[0]}
        playHistory={[{ track: tracks[0], playedAt: Date.now(), count: 2 }]}
        playing={false}
        onTogglePlay={vi.fn()}
        onPickTrack={vi.fn()}
        onOpenPlayer={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(markup).toContain("年度声迹");
    expect(markup).not.toContain("聆听绿格子");
    expect(markup).not.toContain("home-heatmap-expand");
    expect(markup).not.toContain("home-today-icon");
  });

  it("renders FloatingNav without the artists rainbow badge", () => {
    const markup = renderToStaticMarkup(
      <FloatingNav
        activeView="artists"
        open
        onOpenChange={vi.fn()}
        onRequestClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    expect(markup).not.toContain("floating-nav-artists-badge");
    expect(markup).toContain('aria-label="歌手"');
  });

  it("renders the redesigned ExploreSurface without 节拍电台 / BPM controls", () => {
    const markup = renderToStaticMarkup(
      <ExploreSurface
        styleGroups={[{ id: "g1", name: "流行", styles: [{ id: "s1", name: "Synthpop" }] }]}
        selectedStyle={{ id: "s1", name: "Synthpop", description: "合成器流行" }}
        tracks={tracks.slice(0, 2)}
        activeTab="discover"
        selectedStyleId="s1"
        stylesLoading={false}
        loading={false}
        loadingMore={false}
        styleError={null}
        discovery={{
          hotSearches: ["City Pop", "Yoasobi"],
          rankings: [{ id: "1", name: "热歌榜", coverUrl: null, coverColor: "#7c5ce6", trackCount: 50, subscribed: false, owned: false, description: "每日热歌", source: "netease" }],
          playlists: [{ id: "2", name: "午夜霓虹", coverUrl: null, coverColor: "#ec4899", trackCount: 25, subscribed: false, owned: false, description: "夜色清单", source: "netease" }],
        }}
        discoveryLoading={false}
        discoveryError={null}
        sort="hot"
        onSelectStyle={vi.fn()}
        onRetryStyles={vi.fn()}
        onSortChange={vi.fn()}
        onLoadMore={vi.fn()}
        onLoadDiscovery={vi.fn()}
        onRetryDiscovery={vi.fn()}
        onSearchHot={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onPickTrack={vi.fn()}
        onTabChange={vi.fn()}
      />,
    );

    expect(markup).toContain("探索发现");
    expect(markup).toContain("榜单与精选");
    expect(markup).toContain("曲风漫游");
    expect(markup).toContain("热歌榜");
    expect(markup).toContain("午夜霓虹");
    expect(markup).not.toContain("节拍电台");
    expect(markup).not.toContain("BPM");
  });

  it("renders the redesigned HistorySurface with color-coded source badges and audio bitrate", () => {
    const entries = [
      {
        track: { ...tracks[0], source: "netease" as const, quality: "FLAC" as const, bitrate: 980_000, sampleRate: 44_100 },
        playedAt: Date.now(),
        count: 3,
      },
      {
        track: { ...tracks[0], id: "qq:mid1", source: "qq" as const, quality: "Hi-Res" as const, bitrate: 1_850_000, sampleRate: 96_000 },
        playedAt: Date.now() - 60_000,
        count: 1,
      },
      {
        track: { ...tracks[0], id: "bilibili:BV1xx411c7mD", source: "bilibili" as const, quality: "320K" as const, bitrate: 192_000, sampleRate: 48_000 },
        playedAt: Date.now() - 120_000,
        count: 2,
      },
    ];
    const markup = renderToStaticMarkup(
      <HistorySurface history={entries} activeTrackId={entries[0].track.id} playing onPickTrack={vi.fn()} />,
    );

    expect(markup).toContain("history-surface");
    expect(markup).toContain("source-badge-netease");
    expect(markup).toContain("source-badge-qq");
    expect(markup).toContain("source-badge-bilibili");
    expect(markup).toContain("980k");
    expect(markup).toContain("1850k");
    expect(markup).toContain("192k");
  });

  it("renders distinct color-coded SourceBadges and suppresses buggy Bilibili CC banners", () => {
    const badges = renderToStaticMarkup(
      <div>
        <SourceBadge source="local" compact />
        <SourceBadge source="netease" compact />
        <SourceBadge source="qq" compact />
        <SourceBadge source="bilibili" compact />
        <SourceBadge source="cloud" compact />
      </div>,
    );
    expect(badges).toContain("source-badge-local");
    expect(badges).toContain("source-badge-netease");
    expect(badges).toContain("source-badge-qq");
    expect(badges).toContain("source-badge-bilibili");
    expect(badges).toContain("source-badge-cloud");

    const biliPanel = renderToStaticMarkup(
      <PlayerSidePanel
        mode="lyrics"
        onModeChange={vi.fn()}
        track={{ ...tracks[0], id: "bilibili:BV1test", source: "bilibili", lyricStatus: "missing", lyrics: [] }}
        palette={{ primary: "#7c5ce6", secondary: "#e06c9f" }}
        lyricDisplayMode="bilingual"
        tracks={[]}
        activeTrackId="bilibili:BV1test"
        onPickTrack={vi.fn()}
        onSeek={vi.fn()}
      />,
    );
    expect(biliPanel).toContain("B站曲目默认不加载歌词");
    expect(biliPanel).not.toContain("CC 字幕");
  });

  it("renders official vector paths for NetEase, QQ Music, and Bilibili logos", () => {
    const logos = renderToStaticMarkup(
      <div>
        <NeteaseLogo />
        <QqLogo />
        <BilibiliLogo />
      </div>,
    );
    expect(logos).toContain("#E60026");
    expect(logos).toContain("#FDCD18");
    expect(logos).toContain("#0DAF52");
    expect(logos).toContain("#00AEEC");
  });

  it("renders redesigned StatsSurface insights and scientific HiFi EqualizerPanel", () => {
    const stats = renderToStaticMarkup(
      <StatsSurface
        tracks={tracks}
        playCounts={{ [tracks[0].id]: 4 }}
        playHistory={[{ track: tracks[0], playedAt: Date.now(), count: 4 }]}
        activeTrackId={tracks[0].id}
        playing
        onPickTrack={vi.fn()}
      />,
    );
    expect(stats).toContain("听歌洞察");
    expect(stats).toContain("24 小时听歌节律");
    expect(stats).toContain("多音源聆听版图");
    expect(stats).toContain("单曲循环榜");

    const eq = renderToStaticMarkup(
      <EqualizerPanel
        enabled
        bands={[3, 2, 0, 0, 1, 2, 1, 0, 1, 2]}
        preset="harman"
        customPresets={[]}
        onEnabledChange={vi.fn()}
        onBandsChange={vi.fn()}
        onPresetChange={vi.fn()}
        onSavePreset={() => true}
        onDeletePreset={vi.fn()}
        onImportPresets={vi.fn()}
      />,
    );
    expect(eq).toContain("IIR Biquad Peaking");
    expect(eq).toContain("防削波余量");
    expect(eq).toContain("哈曼目标");
    expect(eq).toContain("处理激活");
  });
});
