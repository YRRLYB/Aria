import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { ImmersivePlayerView, PlayerSurface } from "./PlayerViews";
import { AddToPlaylistDialog } from "./PlaylistActions";

describe("player and playlist surfaces", () => {
  it("renders the online song search when opening an empty playlist selection", () => {
    const markup = renderToStaticMarkup(<AddToPlaylistDialog initialTracks={[]} playlists={[]} connected onClose={vi.fn()} onRequireLogin={vi.fn()} onAdd={vi.fn()} onCreate={vi.fn()} />);
    expect(markup).toContain("搜索要加入的歌曲");
    expect(markup).toContain("搜索并选择要加入歌单的网易云歌曲");
  });

  it("shows the chosen QQ tier independently from cached actual quality", () => {
    const track = { ...tracks[0], source: "qq" as const, quality: "FLAC" as const, currentLevel: "lossless" as const, availableLevels: ["standard", "lossless"] as const };
    const markup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...track, availableLevels: [...track.availableLevels] }} palette={{ primary: "#777777", secondary: "#999999" }}
      playing={false} visualizerPlaying={false} visualizerActive={false} shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode={false} onToggleVideoMode={vi.fn()} videoActive={false} videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={50} onVolumeChange={vi.fn()} qualityLevel="standard" onQualityLevelChange={vi.fn()} hifiEnabled={false} masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={200} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="original" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);
    const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons.find((button) => button.includes(">标准</button>"))).toContain('aria-pressed="true"');
    expect(buttons.find((button) => button.includes(">无损</button>"))).toContain('aria-pressed="false"');
    expect(markup).toMatch(/>无损 <span class="text-neutral-400">/); // actual stream detail remains visible
    expect(markup).toContain('aria-label="当前曲目无视频"');
  });

  it("mounts the Bilibili live video curtain without tearing down the underlying player surface", () => {
    const biliTrack = {
      ...tracks[0],
      id: "bilibili:BV1xx411c7mD",
      source: "bilibili" as const,
      videoUrl: "/api/sources/bilibili/tracks/BV1xx411c7mD/video",
      quality: "Hi-Res" as const,
      currentLevel: "hires" as const,
      availableLevels: ["standard", "hires"] as const,
    };
    const markup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...biliTrack, availableLevels: [...biliTrack.availableLevels] }} palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
      playing visualizerPlaying visualizerActive shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode onToggleVideoMode={vi.fn()} videoActive videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={72} onVolumeChange={vi.fn()} qualityLevel="hires" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={266} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="bilingual" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);

    expect(markup).toContain('aria-label="B站实时视频舞台"');
    expect(markup).toContain('aria-label="收起实时视频"');
    expect(markup).toContain('aria-label="沉浸全屏观看"');
    expect(markup).toContain('aria-label="音质选择"');
    expect(markup).toContain("音质 · Hi-Res");
    expect(markup).toContain('aria-label="静音"');
    expect(markup).toContain("aria-eq");
    expect(markup).not.toContain(`将 ${biliTrack.title} 加入歌单`);
    expect(markup).not.toContain(">沉浸</button>");
    expect(markup).not.toContain(">收起</span>");
    expect(markup).toContain('data-taskbar-anchor="player-cover"');
    expect(markup).toContain(">Hi-Res</button>");
  });

  it("promotes the unified MV curtain in-place when immersive=true without hiding audio bitrate on long titles", () => {
    const longTitleTrack = {
      ...tracks[0],
      id: "bilibili:BV1longtitle99",
      title: "An Extremely Long Classical Symphony Title That Would Otherwise Push Out Bitrate Badges In Flex Containers",
      artist: "Some Very Long Orchestra Name",
      source: "bilibili" as const,
      videoUrl: "/api/sources/bilibili/tracks/BV1longtitle99/video",
      quality: "Hi-Res" as const,
      currentLevel: "hires" as const,
      bitrate: 1_920_000,
      sampleRate: 96_000,
      availableLevels: ["standard", "hires"] as const,
    };
    const markup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...longTitleTrack, availableLevels: [...longTitleTrack.availableLevels] }}
      palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
      playing visualizerPlaying visualizerActive shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()}
      onOpenImmersive={vi.fn()} immersive onCloseImmersive={vi.fn()}
      videoMode onToggleVideoMode={vi.fn()} videoActive videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={80} onVolumeChange={vi.fn()} qualityLevel="hires" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={266} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="bilingual" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);

    expect(markup).toContain("aria-mv-immersive");
    expect(markup).toContain('aria-label="退出沉浸全屏"');
    expect(markup).toContain("1920k");
    expect(markup).toContain("96kHz");
    expect(markup).not.toContain("hidden shrink-0 text-xs text-neutral-400 xl:inline");
  });

  it("respects lyricDisplayMode in ImmersivePlayerView and pairs bilingual translations cleanly", () => {
    const bilingualTrack = {
      ...tracks[0],
      source: "netease" as const,
      lyricStatus: "linked" as const,
      lyrics: [
        { time: "00:10", startTime: 10, text: "Take my hand tonight", translation: "今晚牵起我的手" },
      ],
    };

    const bilingualMarkup = renderToStaticMarkup(
      <ImmersivePlayerView
        activeTrack={bilingualTrack}
        palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
        playing={false}
        visualizerPlaying={false}
        durationSeconds={200}
        analyserRef={{ current: null }}
        visualizerMode="system"
        volume={60}
        onVolumeChange={vi.fn()}
        visualizerActive={false}
        lyricDisplayMode="bilingual"
        onClose={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        videoMode={false}
        onToggleVideoMode={vi.fn()}
        videoControlRef={{ current: null }}
        onVideoDuration={vi.fn()}
        onVideoEnded={vi.fn()}
        onVideoError={vi.fn()}
        videoActive={false}
      />,
    );
    expect(bilingualMarkup).toContain("Take my hand tonight");
    expect(bilingualMarkup).toContain("今晚牵起我的手");

    const originalOnlyMarkup = renderToStaticMarkup(
      <ImmersivePlayerView
        activeTrack={bilingualTrack}
        palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
        playing={false}
        visualizerPlaying={false}
        durationSeconds={200}
        analyserRef={{ current: null }}
        visualizerMode="system"
        volume={60}
        onVolumeChange={vi.fn()}
        visualizerActive={false}
        lyricDisplayMode="original"
        onClose={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        videoMode={false}
        onToggleVideoMode={vi.fn()}
        videoControlRef={{ current: null }}
        onVideoDuration={vi.fn()}
        onVideoEnded={vi.fn()}
        onVideoError={vi.fn()}
        videoActive={false}
      />,
    );
    expect(originalOnlyMarkup).toContain("Take my hand tonight");
    expect(originalOnlyMarkup).not.toContain("今晚牵起我的手");
  });

  it("uses shared video stage and button labels for both Bilibili and YouTube", () => {
    const youtubeTrack = {
      ...tracks[0],
      id: "youtube:yt123456789",
      providerId: "yt123456789",
      source: "youtube" as const,
      videoUrl: "/api/sources/youtube/tracks/yt123456789/video",
      quality: "AAC" as const,
      currentLevel: "exhigh" as const,
      availableLevels: ["standard", "higher", "exhigh"] as const,
    };
    const markup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...youtubeTrack, availableLevels: [...youtubeTrack.availableLevels] }}
      palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
      playing visualizerPlaying visualizerActive shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode onToggleVideoMode={vi.fn()} videoActive videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={72} onVolumeChange={vi.fn()} qualityLevel="exhigh" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={200} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="bilingual" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);

    expect(markup).toContain('aria-label="YouTube 实时视频舞台"');
    expect(markup).toContain('aria-label="收起实时视频"');

    const localTrack = { ...tracks[0], source: "local" as const, videoUrl: undefined };
    const noVideoMarkup = renderToStaticMarkup(<PlayerSurface
      activeTrack={localTrack} palette={{ primary: "#777777", secondary: "#999999" }}
      playing={false} visualizerPlaying={false} visualizerActive={false} shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode={false} onToggleVideoMode={vi.fn()} videoActive={false} videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={50} onVolumeChange={vi.fn()} qualityLevel="lossless" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={200} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="original" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);

    expect(noVideoMarkup).toContain("支持 B站与 YouTube 曲目");
    expect(noVideoMarkup).not.toContain("仅 B站");
  });
});
