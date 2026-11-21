import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { localDateKey } from "@/lib/dailyActivity";
import { defaultKeyboardShortcuts, shortcutDefinitions } from "@/lib/keyboardShortcuts";
import { HomeSurface } from "./HomeDashboard";
import { FloatingNav } from "./FloatingNav";
import { ExploreSurface } from "./ExploreSurface";
import { HistorySurface } from "./HomeSurfaces";
import { BilibiliLogo, NeteaseLogo, QqLogo, SourceBadge } from "./SourceLogos";
import { StatsSurface } from "./CollectionSurfaces";
import { EqualizerPanel } from "./EqualizerPanel";
import { PlayerSidePanel } from "./PlayerSidePanels";
import { CopyableTrackText } from "./shared";
import { SettingsPanel } from "./SettingsPanels";
import { PlayerSurface } from "./PlayerViews";

describe("Aria v0.7.4 surfaces and polish", () => {
  it("uses 年度声迹 with a compact two-month home preview and hides verbose log-note chrome on HomeDashboard", () => {
    const todayKey = localDateKey(new Date());
    const markup = renderToStaticMarkup(
      <HomeSurface
        activeTrack={tracks[0]}
        playHistory={[{ track: tracks[0], playedAt: Date.now(), count: 2 }]}
        dailyActivity={{ [todayKey]: { plays: 3, seconds: 660 } }}
        playing={false}
        onTogglePlay={vi.fn()}
        onPickTrack={vi.fn()}
        onOpenPlayer={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(markup).toContain("年度声迹");
    expect(markup).toContain("月 · 放大");
    expect(markup).toContain("近两月 3 次播放");
    // 紧凑两月预览（8-10 列 + 5 个图例格），而不是旧的 18 周 126 格。
    const cellCount = (markup.match(/home-heatmap-cell(?=[" ])/g) ?? []).length;
    expect(cellCount).toBeGreaterThanOrEqual(61);
    expect(cellCount).toBeLessThanOrEqual(75);
    expect(markup).not.toContain("var(--home-heatmap-cell)");
    expect(markup).toContain("minmax(0, 1fr)");
    expect(markup).not.toContain("按每日聆听日志统计");
    expect(markup).not.toContain("home-today-note");
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

  it("marks single-line titles for slow marquee scrolling unless explicitly disabled or non-title", () => {
    const titleMarkup = renderToStaticMarkup(
      <CopyableTrackText track={tracks[0]} field="title">
        <span>{tracks[0].title}</span>
      </CopyableTrackText>,
    );
    expect(titleMarkup).toContain("aria-slow-marquee");

    const disabledMarqueeMarkup = renderToStaticMarkup(
      <CopyableTrackText track={tracks[0]} field="title" marquee={false}>
        <span>{tracks[0].title}</span>
      </CopyableTrackText>,
    );
    expect(disabledMarqueeMarkup).not.toContain("aria-slow-marquee");

    const artistMarkup = renderToStaticMarkup(
      <CopyableTrackText track={tracks[0]} field="artist">
        <span>{tracks[0].artist}</span>
      </CopyableTrackText>,
    );
    expect(artistMarkup).not.toContain("aria-slow-marquee");
  });

  it("renders redesigned SettingsPanel with category tabs, preserved HiFi/臻品 chain, and all 10 shortcuts", () => {
    const settingsMarkup = renderToStaticMarkup(
      <SettingsPanel
        backgroundEnabled={false}
        onBackgroundEnabledChange={vi.fn()}
        neteaseAccount={null}
        libraryMeta={{ roots: [], updatedAt: null }}
        libraryAutoScanEnabled
        libraryWatchState={null}
        onAddLibraryFolder={vi.fn()}
        onRemoveLibraryRoot={vi.fn()}
        onToggleLibraryAutoScan={vi.fn()}
        trackCount={12}
        likedCount={4}
        lyricProgress={75}
        volume={68}
        onVolumeChange={vi.fn()}
        audioOutputDevices={[{ id: "default", label: "系统默认输出" }]}
        onRefreshAudioOutputDevices={vi.fn()}
        selectedSinkId="default"
        onSelectedSinkIdChange={vi.fn()}
        hifiEnabled
        onHifiEnabledChange={vi.fn()}
        masterQualityEnabled
        onMasterQualityEnabledChange={vi.fn()}
        gaplessEnabled
        onGaplessEnabledChange={vi.fn()}
        normalizationEnabled={false}
        onNormalizationEnabledChange={vi.fn()}
        normalizationError={null}
        nativeAudioSupported={false}
        nativeAudioState={null}
        audioOutputMode="system"
        onAudioOutputModeChange={vi.fn()}
        exclusiveMode={false}
        keyboardShortcuts={defaultKeyboardShortcuts}
        onKeyboardShortcutsChange={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(settingsMarkup).toContain("全部");
    expect(settingsMarkup).toContain("音频与音质");
    expect(settingsMarkup).toContain("播放源与账号");
    expect(settingsMarkup).toContain("快捷键与曲库");
    expect(settingsMarkup).toContain("系统与外观");
    expect(settingsMarkup).toContain("HiFi 优先");
    expect(settingsMarkup).toContain("臻品增强");
    expect(settingsMarkup).toContain("臻品母带 24bit/192kHz");
    expect(settingsMarkup).toContain("Hi-Res");
    expect(settingsMarkup).toContain("无损 FLAC");
    expect(settingsMarkup).toContain("320K");
    expect(settingsMarkup).toContain('aria-label="切换音量标准化"');
    expect(settingsMarkup).toContain('aria-label="返回上一页"');
    expect(settingsMarkup).toContain('aria-label="刷新播放设备"');
    expect(settingsMarkup).toContain("刷新设备");
    expect(settingsMarkup).toContain("应用内快捷键");
    expect(settingsMarkup).not.toContain("settings-rail");
    expect(settingsMarkup).not.toContain("已同步「我喜欢」、歌单、每日推荐与云盘");
    expect(settingsMarkup).not.toContain("可同步「我喜欢」、歌单与每日推荐");
    expect(settingsMarkup).not.toContain("已同步「Aria」收藏夹与账号收藏列表");
    expect(settingsMarkup).not.toContain("网络环境补偿");
    expect(settingsMarkup).not.toContain("窗口扫码登录");
    for (const def of shortcutDefinitions) {
      expect(settingsMarkup).toContain(def.label);
    }
  });

  it("renders unified 6-tier quality strip on PlayerSurface with unavailable YouTube/Bilibili tiers as empty slots", () => {
    const baseProps = {
      palette: {
        primary: "#7c5ce6",
        secondary: "#9db2ff",
        tint: "rgba(124,92,230,0.12)",
        glow: "rgba(124,92,230,0.22)",
        ink: "#17171b",
      },
      playing: false,
      visualizerPlaying: false,
      visualizerActive: false,
      shuffleEnabled: false,
      repeatMode: "all" as const,
      onTogglePlay: vi.fn(),
      onToggleShuffle: vi.fn(),
      onCycleRepeatMode: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
      onOpenImmersive: vi.fn(),
      videoMode: false,
      onToggleVideoMode: vi.fn(),
      videoActive: false,
      videoControlRef: { current: null },
      onVideoDuration: vi.fn(),
      onVideoEnded: vi.fn(),
      onVideoError: vi.fn(),
      equalizerEnabled: false,
      onOpenEqualizer: vi.fn(),
      onReplaceLocalArtwork: vi.fn(async () => undefined),
      liked: false,
      onToggleLike: vi.fn(),
      volume: 70,
      onVolumeChange: vi.fn(),
      qualityLevel: "hires" as const,
      onQualityLevelChange: vi.fn(),
      hifiEnabled: true,
      masterQualityEnabled: false,
      onMasterQualityEnabledChange: vi.fn(),
      exclusiveMode: false,
      durationSeconds: 180,
      analyserRef: { current: null },
      visualizerMode: "system" as const,
      lyricDisplayMode: "original" as const,
      onLyricDisplayModeChange: vi.fn(),
      onSeek: vi.fn(),
    };

    const ytMarkup = renderToStaticMarkup(
      <PlayerSurface
        {...baseProps}
        activeTrack={{
          ...tracks[0],
          id: "youtube:dQw4w9WgXcQ",
          providerId: "dQw4w9WgXcQ",
          source: "youtube",
          availableLevels: ["standard"],
          currentLevel: "standard",
        }}
      />,
    );
    const ytQualitySection = ytMarkup.slice(ytMarkup.indexOf("player-quality-group"));
    expect((ytQualitySection.match(/player-quality-option/g) ?? []).length).toBe(6);
    expect((ytQualitySection.match(/is-empty-slot/g) ?? []).length).toBe(5);
    expect(ytQualitySection).toContain(">标准</button>");
    expect(ytQualitySection).toContain(">臻品</button>");

    const biliMarkup = renderToStaticMarkup(
      <PlayerSurface
        {...baseProps}
        activeTrack={{
          ...tracks[0],
          id: "bilibili:BV1xx411c7mD",
          providerId: "BV1xx411c7mD",
          source: "bilibili",
          availableLevels: ["standard", "exhigh"],
          currentLevel: "exhigh",
        }}
      />,
    );
    const biliQualitySection = biliMarkup.slice(biliMarkup.indexOf("player-quality-group"));
    expect((biliQualitySection.match(/player-quality-option/g) ?? []).length).toBe(6);
    expect((biliQualitySection.match(/is-empty-slot/g) ?? []).length).toBe(4);
  });
});
