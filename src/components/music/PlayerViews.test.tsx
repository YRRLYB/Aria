import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { ImmersivePlayerView, PlayerSurface } from "./PlayerViews";
import { PlayerSidePanel } from "./PlayerSidePanels";
import { AddToPlaylistDialog } from "./PlaylistActions";
import { AriaRoomSection } from "./AriaRoomSection";
import { ListenTogetherExitPromptDialog, ListenTogetherInviteToast, ListenTogetherView } from "./ListenTogetherDialog";

describe("player and playlist surfaces", () => {
  it("renders visual multi-playlist picker and search fallback when opening an empty playlist selection", () => {
    const emptyMarkup = renderToStaticMarkup(<AddToPlaylistDialog initialTracks={[]} playlists={[]} connected onClose={vi.fn()} onRequireLogin={vi.fn()} onAdd={vi.fn()} onCreate={vi.fn()} />);
    expect(emptyMarkup).toContain("从其他歌单");
    expect(emptyMarkup).toContain("曲库浏览");
    expect(emptyMarkup).toContain("搜索添加");
    expect(emptyMarkup).toContain("搜索要加入的歌曲");
    expect(emptyMarkup).toContain("按顺序加入 0 首");

    const catalogMarkup = renderToStaticMarkup(
      <AddToPlaylistDialog
        initialTracks={[]}
        initialPlaylistId="pl-target"
        playlists={[
          { id: "pl-target", name: "当前歌单", trackCount: 1, subscribed: false, owned: true, coverColor: "#7c5ce6" },
          { id: "pl-other", name: "深夜常听", trackCount: 12, subscribed: false, owned: true, coverColor: "#00aeec", coverUrl: "https://example.com/pl.jpg" },
        ]}
        connected
        onClose={vi.fn()}
        onRequireLogin={vi.fn()}
        onAdd={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(catalogMarkup).toContain("深夜常听");
    expect(catalogMarkup).toContain("从其他歌单");
  });

  it("renders the exit prompt dialog when switching to a non-NetEase track during Listen Together", () => {
    const qqTrack = { ...tracks[0], id: "qq:001", source: "qq" as const, title: "晴天" };
    const markup = renderToStaticMarkup(
      <ListenTogetherExitPromptDialog pendingTrack={qqTrack} onContinueTogether={vi.fn()} onConfirmExitAndPlay={vi.fn(async () => {})} />,
    );
    expect(markup).toContain("切换到其他音源将退出「一起听」");
    expect(markup).toContain("晴天");
    expect(markup).toContain("继续一起听");
    expect(markup).toContain("退出一起听并播放");
  });

  it("renders the real-time floating ListenTogetherInviteToast card", () => {
    const toastMarkup = renderToStaticMarkup(
      <ListenTogetherInviteToast
        invite={{
          roomId: "RM_TOAST",
          inviterId: "20001",
          songId: "186016",
          songTitle: "七里香",
          songCoverUrl: "https://example.com/cover.jpg",
          fromUser: { userId: "20001", nickname: "小晴", avatarUrl: null },
          message: "邀请你一起听",
          time: Date.now(),
        }}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(toastMarkup).toContain("小晴 邀请你加入一起听");
    expect(toastMarkup).toContain("正在听「七里香」");
    expect(toastMarkup).toContain("立即加入");
    expect(toastMarkup).toContain("暂不加入");
  });

  it("renders the ListenTogetherView editorial lobby and active paired room", () => {
    const neteaseTrack = { ...tracks[0], id: "netease:186016", source: "netease" as const, providerId: "186016", title: "晴天" };
    const lobbyMarkup = renderToStaticMarkup(
      <ListenTogetherView
        connected
        room={null}
        recoverableRoom={null}
        activeTrack={neteaseTrack}
        playing
        invites={[]}
        contacts={[]}
        sharedTracks={[]}
        loading={false}
        actionError={null}
        lastDriftMs={null}
        onBack={vi.fn()}
        onRequireLogin={vi.fn()}
        onCreateRoom={vi.fn(async () => {})}
        onJoinRoom={vi.fn(async () => {})}
        onResumeRecoverable={vi.fn(async () => {})}
        onDismissRecoverable={vi.fn(async () => {})}
        onLeaveRoom={vi.fn(async () => {})}
        onSyncNow={vi.fn(async () => {})}
        onRefreshInvites={vi.fn(async () => {})}
        onSendInviteMessage={vi.fn(async () => {})}
        onPickSharedTrack={vi.fn()}
      />,
    );
    expect(lobbyMarkup).toContain("开启一起听房间");
    expect(lobbyMarkup).toContain("加入好友房间");
    expect(lobbyMarkup).toContain("收到的私信邀请");

    const roomMarkup = renderToStaticMarkup(
      <ListenTogetherView
        connected
        room={{
          roomId: "RM_STUDIO",
          inviterId: "10001",
          creatorId: "10001",
          status: "AVAILABLE",
          roomUsers: [
            { userId: "10001", nickname: "阿音", avatarUrl: null },
            { userId: "10002", nickname: "小晴", avatarUrl: null },
          ],
          playInfo: { songId: "186016", playStatus: "PLAY", progressMs: 42000, clientSeq: 1 },
          shareUrl: "https://st.music.163.com/listen-together/share/?roomId=RM_STUDIO",
          serverTime: Date.now(),
        }}
        recoverableRoom={null}
        activeTrack={neteaseTrack}
        playing
        invites={[]}
        contacts={[]}
        sharedTracks={[neteaseTrack]}
        loading={false}
        actionError={null}
        lastDriftMs={120}
        onBack={vi.fn()}
        onRequireLogin={vi.fn()}
        onCreateRoom={vi.fn(async () => {})}
        onJoinRoom={vi.fn(async () => {})}
        onResumeRecoverable={vi.fn(async () => {})}
        onDismissRecoverable={vi.fn(async () => {})}
        onLeaveRoom={vi.fn(async () => {})}
        onSyncNow={vi.fn(async () => {})}
        onRefreshInvites={vi.fn(async () => {})}
        onSendInviteMessage={vi.fn(async () => {})}
        onPickSharedTrack={vi.fn()}
        onOpenPlayer={vi.fn()}
      />,
    );
    expect(roomMarkup).toContain("阿音");
    expect(roomMarkup).toContain("小晴");
    expect(roomMarkup).toContain("前往播放器");
    expect(roomMarkup).not.toContain('aria-label="上一首"');
    expect(roomMarkup).not.toContain('aria-label="下一首"');
    expect(roomMarkup).toContain("复制邀请链接");
    expect(roomMarkup).toContain("共享歌单队列");
    expect(roomMarkup).toContain("晴天");
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

  it("highlights the resolved fallback quality button when Hi-Res is unavailable", () => {
    const track = {
      ...tracks[0],
      source: "netease" as const,
      quality: "Lossless" as const,
      currentLevel: "lossless" as const,
      availableLevels: ["standard", "higher", "exhigh", "lossless"] as const,
    };
    const markup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...track, availableLevels: [...track.availableLevels] }} palette={{ primary: "#777777", secondary: "#999999" }}
      playing={false} visualizerPlaying={false} visualizerActive={false} shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode={false} onToggleVideoMode={vi.fn()} videoActive={false} videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={50} onVolumeChange={vi.fn()} qualityLevel="hires" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={200} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="original" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);
    const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons.find((button) => button.includes(">Hi-Res</button>"))).toContain('aria-pressed="false"');
    expect(buttons.find((button) => button.includes(">无损</button>"))).toContain('aria-pressed="true"');
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

    expect(noVideoMarkup).toContain("支持网易云、QQ 音乐、B站与 YouTube");
    expect(noVideoMarkup).not.toContain("仅 B站");
  });

  it("renders YouTube HD webview stage controls in audio-video fusion mode only", () => {
    const youtubeTrack = {
      ...tracks[0],
      id: "youtube:dQw4w9WgXcQ",
      providerId: "dQw4w9WgXcQ",
      source: "youtube" as const,
      videoUrl: "/api/sources/youtube/tracks/dQw4w9WgXcQ/video",
      quality: "AAC" as const,
      currentLevel: "exhigh" as const,
      availableLevels: ["standard", "higher", "exhigh"] as const,
    };

    const fusionMarkup = renderToStaticMarkup(<PlayerSurface
      activeTrack={{ ...youtubeTrack, availableLevels: [...youtubeTrack.availableLevels] }}
      palette={{ primary: "#7b61df", secondary: "#e06c9f" }}
      playing visualizerPlaying visualizerActive shuffleEnabled={false} repeatMode="all"
      onTogglePlay={vi.fn()} onToggleShuffle={vi.fn()} onCycleRepeatMode={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onOpenImmersive={vi.fn()}
      videoMode onToggleVideoMode={vi.fn()} videoActive videoControlRef={{ current: null }} onVideoDuration={vi.fn()} onVideoEnded={vi.fn()} onVideoError={vi.fn()}
      youtubeWebviewActive youtubeActiveQuality="4K" youtubeOffsetSeconds={0.2}
      onYoutubeOffsetChange={vi.fn()}
      equalizerEnabled={false} onOpenEqualizer={vi.fn()} onReplaceLocalArtwork={vi.fn(async () => undefined)} liked={false} onToggleLike={vi.fn()}
      volume={72} onVolumeChange={vi.fn()} qualityLevel="exhigh" onQualityLevelChange={vi.fn()} hifiEnabled masterQualityEnabled={false}
      onMasterQualityEnabledChange={vi.fn()} exclusiveMode={false} durationSeconds={200} analyserRef={{ current: null }} visualizerMode="system"
      lyricDisplayMode="bilingual" onLyricDisplayModeChange={vi.fn()} onSeek={vi.fn()} />);

    expect(fusionMarkup).toContain("YouTube Music · 音画融合 · 4K");
    expect(fusionMarkup).not.toContain("原声高清");
    expect(fusionMarkup).not.toContain('aria-label="YouTube 舞台模式"');
    expect(fusionMarkup).toContain('aria-label="音画偏移微调"');
    expect(fusionMarkup).toContain("+0.2s");
    expect(fusionMarkup).toContain('aria-label="音质选择"');
    expect(fusionMarkup).not.toContain('aria-label="画中画悬浮窗"');
  });

  it("hides synced lyrics and shows a notice when playing a standalone NetEase or QQ MV", () => {
    const neteaseMvTrack = {
      ...tracks[1],
      id: "netease:1901371647",
      providerId: "1901371647",
      source: "netease" as const,
      lyrics: [{ time: "00:10", text: "爱你孤身走暗巷" }],
      lyricStatus: "linked" as const,
    };

    const mvHiddenMarkup = renderToStaticMarkup(
      <PlayerSidePanel
        mode="lyrics"
        onModeChange={vi.fn()}
        track={neteaseMvTrack}
        palette={{ primary: "#e60026", secondary: "#7c5ce6" }}
        lyricDisplayMode="bilingual"
        mvLyricsUnavailable
        playing
        tracks={[neteaseMvTrack]}
        activeTrackId={neteaseMvTrack.id}
        onPickTrack={vi.fn()}
        onSeek={vi.fn()}
        onBindLyrics={vi.fn()}
      />,
    );

    expect(mvHiddenMarkup).toContain("MV 模式下暂不支持歌词同步");
    expect(mvHiddenMarkup).not.toContain("爱你孤身走暗巷");
    expect(mvHiddenMarkup).not.toContain("手动搜词绑定");

    const normalMarkup = renderToStaticMarkup(
      <PlayerSidePanel
        mode="lyrics"
        onModeChange={vi.fn()}
        track={neteaseMvTrack}
        palette={{ primary: "#e60026", secondary: "#7c5ce6" }}
        lyricDisplayMode="bilingual"
        mvLyricsUnavailable={false}
        playing
        tracks={[neteaseMvTrack]}
        activeTrackId={neteaseMvTrack.id}
        onPickTrack={vi.fn()}
        onSeek={vi.fn()}
        onBindLyrics={vi.fn()}
      />,
    );

    expect(normalMarkup).toContain("爱你孤身走暗巷");
    expect(normalMarkup).not.toContain("MV 模式下暂不支持歌词同步");
  });

  it("renders AriaRoomSection above embedded ListenTogetherView without duplicate page chrome", () => {
    const losslessTrack = {
      ...tracks[0],
      id: "netease:1901371647",
      source: "netease" as const,
      title: "孤勇者",
      quality: "Hi-Res" as const,
      bitrate: 1920,
      sampleRate: 96000,
    };

    const lobbyMarkup = renderToStaticMarkup(
      <AriaRoomSection
        snapshot={{
          active: false,
          role: null,
          roomId: null,
          myPeerId: null,
          maxMembers: 5,
          networkMode: "cloudflare",
          controlMode: "collaborative",
          signalingState: "idle",
          signalingConnectedIp: null,
          signalingLatencyMs: null,
          signalingError: null,
          directServer: {
            active: false,
            port: 3639,
            roomToken: null,
            lanAddresses: [],
            ipv6Addresses: [],
            publicHost: null,
            shareString: null,
            error: null,
          },
          guestDirectBaseUrl: null,
          guestDirectToken: null,
          members: [],
          playback: {
            nonce: null,
            track: null,
            nextTrack: null,
            queue: [],
            playing: false,
            positionSec: 0,
            updatedAtMs: 0,
            serverSeq: 0,
          },
          localCapabilities: {
            netease: "vip",
            qq: "none",
            bilibili: "free",
            youtube: "unreachable",
          },
          shareEnabled: true,
          iceConfig: { iceServers: [] },
        }}
        config={{
          signalingProvider: "cloudflare",
          signalingUrl: "https://signal.aria-listen.workers.dev",
          selfHostedSignalingUrl: "",
          preferredIps: [],
          autoPreferredIp: true,
          selectedPreferredIp: "104.16.132.229",
          directPort: 3639,
          publicHost: "",
          turnUrls: [],
          turnUsername: "",
          turnCredential: "",
        }}
        probeResults={[{ ip: "104.16.132.229", label: "104.16.132.229", ok: true, latencyMs: 29 }]}
        profile={{
          peerId: "aria-0001",
          mode: "inherit",
          preferredSource: "auto",
          customNickname: "",
          customAvatarDataUrl: null,
          shareEnabled: true,
        }}
        identity={{
          peerId: "aria-0001",
          nickname: "阿音",
          avatarUrl: null,
          isInherited: true,
          inheritedFromSource: "netease",
        }}
        accounts={[
          { source: "netease", connected: true, nickname: "阿音" },
          { source: "qq", connected: false },
          { source: "bilibili", connected: false },
          { source: "youtube", connected: false },
        ]}
        activeTrack={losslessTrack}
        loading={false}
        probingIps={false}
        actionError={null}
        rttMs={null}
        lastDriftMs={null}
        bufferProgress={null}
        superMixItems={[]}
        onBack={vi.fn()}
        onUpdateProfile={vi.fn()}
        onUploadAvatar={vi.fn(async () => {})}
        onCreateRoom={vi.fn(async () => ({}))}
        onJoinRoom={vi.fn(async () => ({}))}
        onLeaveRoom={vi.fn(async () => {})}
        onProbeIps={vi.fn(async () => [])}
        onUpdateNetworkConfig={vi.fn(async () => ({}))}
        onSetControlMode={vi.fn(async () => {})}
        onImportPlaylistTracks={vi.fn(async () => {})}
        onPickRoomTrack={vi.fn()}
        onOpenPlayer={vi.fn()}
      />,
    );

    expect(lobbyMarkup).toContain("一起听");
    expect(lobbyMarkup).toContain("创建房间");
    expect(lobbyMarkup).toContain("加入房间");
    expect(lobbyMarkup).toContain("网络设置");
    expect(lobbyMarkup).not.toContain("ARIA SYNC");
    expect(lobbyMarkup).not.toContain("VIP 权益接力共享");

    const activeMarkup = renderToStaticMarkup(
      <AriaRoomSection
        snapshot={{
          active: true,
          role: "host",
          roomId: "A7K9M2",
          myPeerId: "aria-0001",
          maxMembers: 5,
          networkMode: "hybrid",
          controlMode: "collaborative",
          signalingState: "connected",
          signalingConnectedIp: "104.16.132.229",
          signalingLatencyMs: 29,
          signalingError: null,
          directServer: {
            active: true,
            port: 3639,
            roomToken: "roomSecretToken123456",
            lanAddresses: ["192.168.1.50"],
            ipv6Addresses: [],
            publicHost: null,
            shareString: "aria-direct://v1?host=192.168.1.50&port=3639&token=roomSecretToken123456",
            error: null,
          },
          guestDirectBaseUrl: null,
          guestDirectToken: null,
          members: [
            { peerId: "aria-0001", nickname: "阿音", avatarUrl: null, role: "host", joinedAt: 1, connectedVia: "ws", presence: "active", online: true },
            { peerId: "aria-0002", nickname: "小晴", avatarUrl: null, role: "guest", joinedAt: 2, connectedVia: "webrtc", presence: "away", online: true },
          ],
          playback: {
            nonce: "trk_1",
            track: {
              nonce: "trk_1",
              id: losslessTrack.id,
              source: "netease",
              title: "孤勇者",
              artist: "陈奕迅",
              album: "孤勇者",
              duration: "04:16",
              quality: "Hi-Res",
              bitrate: 1920,
              sampleRate: 96000,
              dispatch: {
                mode: "direct_url",
                providerPeerId: "aria-0002",
                directUrl: "https://cdn.example/lossless.flac",
              },
            },
            nextTrack: null,
            queue: [
              {
                nonce: "trk_1",
                id: losslessTrack.id,
                source: "netease",
                title: "孤勇者",
                artist: "陈奕迅",
                album: "孤勇者",
                duration: "04:16",
                quality: "Hi-Res",
                bitrate: 1920,
                sampleRate: 96000,
              },
            ],
            playing: true,
            positionSec: 12,
            updatedAtMs: Date.now(),
            serverSeq: 1,
          },
          localCapabilities: {
            netease: "free",
            qq: "none",
            bilibili: "free",
            youtube: "unreachable",
          },
          shareEnabled: true,
          iceConfig: { iceServers: [] },
        }}
        config={{
          signalingProvider: "cloudflare",
          signalingUrl: "https://signal.aria-listen.workers.dev",
          selfHostedSignalingUrl: "",
          preferredIps: [],
          autoPreferredIp: true,
          selectedPreferredIp: "104.16.132.229",
          directPort: 3639,
          publicHost: "",
          turnUrls: [],
          turnUsername: "",
          turnCredential: "",
        }}
        probeResults={[]}
        profile={{
          peerId: "aria-0001",
          mode: "inherit",
          preferredSource: "auto",
          customNickname: "",
          customAvatarDataUrl: null,
          shareEnabled: true,
        }}
        identity={{
          peerId: "aria-0001",
          nickname: "阿音",
          avatarUrl: null,
          isInherited: true,
          inheritedFromSource: "netease",
        }}
        accounts={[
          { source: "netease", connected: true, nickname: "阿音" },
          { source: "qq", connected: false },
          { source: "bilibili", connected: false },
          { source: "youtube", connected: false },
        ]}
        activeTrack={losslessTrack}
        loading={false}
        probingIps={false}
        actionError={null}
        rttMs={24}
        lastDriftMs={12}
        bufferProgress={null}
        superMixItems={[
          {
            playlist: {
              id: "sm-1",
              name: "夜间无损Super混",
              kind: "super-mix",
              trackIds: [losslessTrack.id],
              createdAt: 1,
              updatedAt: 1,
            },
            tracks: [losslessTrack],
          },
        ]}
        onBack={vi.fn()}
        onUpdateProfile={vi.fn()}
        onUploadAvatar={vi.fn(async () => {})}
        onCreateRoom={vi.fn(async () => ({}))}
        onJoinRoom={vi.fn(async () => ({}))}
        onLeaveRoom={vi.fn(async () => {})}
        onProbeIps={vi.fn(async () => [])}
        onUpdateNetworkConfig={vi.fn(async () => ({}))}
        onSetControlMode={vi.fn(async () => {})}
        onImportPlaylistTracks={vi.fn(async () => {})}
        onPickRoomTrack={vi.fn()}
        onOpenPlayer={vi.fn()}
      />,
    );

    expect(activeMarkup).toContain("Aria 一起听");
    expect(activeMarkup).toContain("A7K9M2");
    expect(activeMarkup).toContain("2 / 5 人在席");
    expect(activeMarkup).toContain("邀请入座");
    expect(activeMarkup).toContain("打开播放器");
    expect(activeMarkup).toContain("房间信息");
    expect(activeMarkup).toContain("播放队列");
    expect(activeMarkup).toContain("夜间无损Super混");
    expect(activeMarkup).not.toContain('aria-label="房间播放进度"');
    expect(activeMarkup).not.toContain("暂离");
    expect(activeMarkup).not.toContain("VIP 接力");
    expect(activeMarkup).not.toContain("IN SYNC");

    const embeddedNeteaseMarkup = renderToStaticMarkup(
      <ListenTogetherView
        embedded
        connected
        room={null}
        recoverableRoom={null}
        activeTrack={losslessTrack}
        playing
        invites={[]}
        contacts={[]}
        sharedTracks={[]}
        loading={false}
        actionError={null}
        lastDriftMs={null}
        onBack={vi.fn()}
        onRequireLogin={vi.fn()}
        onCreateRoom={vi.fn(async () => {})}
        onJoinRoom={vi.fn(async () => {})}
        onResumeRecoverable={vi.fn(async () => {})}
        onDismissRecoverable={vi.fn(async () => {})}
        onLeaveRoom={vi.fn(async () => {})}
        onSyncNow={vi.fn(async () => {})}
        onRefreshInvites={vi.fn(async () => {})}
        onSendInviteMessage={vi.fn(async () => {})}
        onPickSharedTrack={vi.fn()}
      />,
    );

    expect(embeddedNeteaseMarkup).toContain("网易云一起听");
    expect(embeddedNeteaseMarkup).not.toContain('aria-label="返回上一页"');
  });
});
