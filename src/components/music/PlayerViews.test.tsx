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
  });
});
