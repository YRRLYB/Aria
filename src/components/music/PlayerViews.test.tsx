import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { PlayerSurface } from "./PlayerViews";
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
});
