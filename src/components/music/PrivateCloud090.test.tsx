import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { tracks, type Track } from "@/data/music";
import { buildBackupSnapshot } from "@/lib/configBackup";
import { defaultKeyboardShortcuts } from "@/lib/keyboardShortcuts";
import { EqualizerPanel } from "./EqualizerPanel";
import { AppNavigation } from "./AppNavigation";
import { PrivateCloudSurface } from "./PrivateCloudSurface";
import { SettingsPanel } from "./SettingsPanels";
import { SourceBadge, SourceLogo } from "./SourceLogos";

describe("Aria v0.9.0 UI Surfaces (PrivateCloudSurface, SourceBadges, BackupRoamingCard, Safe Normalize)", () => {
  it("renders PrivateCloudSurface with OpenSubsonic and WebDAV instances and lossless tracks", () => {
    const privateTracks: Track[] = [
      {
        ...tracks[0],
        id: "subsonic:inst-sub:song-1",
        providerId: "inst-sub:song-1",
        source: "subsonic",
        title: "Navidrome Studio Master",
        artist: "Aria Quartet",
        album: "Private Cloud Vol. 1",
        quality: "Hi-Res",
        bitrate: 2304000,
        sampleRate: 96000,
      },
      {
        ...tracks[0],
        id: "webdav:sha1track1",
        providerId: "sha1track1",
        source: "webdav",
        title: "Alist NAS Symphony",
        artist: "Homelab Orchestra",
        album: "WebDAV Lossless",
        quality: "FLAC",
        bitrate: 1050000,
        sampleRate: 44100,
      },
    ];

    const markup = renderToStaticMarkup(
      <PrivateCloudSurface
        instances={[
          {
            id: "inst-sub",
            kind: "subsonic",
            name: "家庭 Navidrome",
            baseUrl: "https://music.example.com",
            username: "audiophile",
            hasPassword: true,
            rootPath: "/",
            enabled: true,
            mobileTranscodeBitrate: 192,
            createdAt: 1,
            updatedAt: 2,
            lastSyncAt: Date.now(),
            trackCount: 128,
            scanning: false,
          },
          {
            id: "inst-dav",
            kind: "webdav",
            name: "Alist 私有网盘",
            baseUrl: "https://alist.example.com/dav",
            username: "admin",
            hasPassword: true,
            rootPath: "/Lossless",
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
            lastSyncAt: Date.now(),
            trackCount: 64,
            scanning: false,
          },
        ]}
        tracks={privateTracks}
        loading={false}
        error={null}
        activeTrackId="subsonic:inst-sub:song-1"
        onRefreshInstances={async () => undefined}
        onRefreshTracks={async () => undefined}
        onPickTrack={vi.fn()}
        onPlayNext={vi.fn()}
        onNotice={vi.fn()}
      />,
    );

    expect(markup).toContain("私有云曲库");
    expect(markup).toContain("家庭 Navidrome");
    expect(markup).toContain("Alist 私有网盘");
    expect(markup).toContain("OpenSubsonic");
    expect(markup).toContain("WebDAV");
    expect(markup).toContain("Navidrome Studio Master");
    expect(markup).toContain("Alist NAS Symphony");
    expect(markup).toContain("增量扫库");
  });

  it("renders SourceLogo and SourceBadge for subsonic and webdav sources", () => {
    const badges = renderToStaticMarkup(
      <div>
        <SourceLogo source="subsonic" />
        <SourceLogo source="webdav" />
        <SourceBadge source="subsonic" />
        <SourceBadge source="webdav" />
      </div>,
    );
    expect(badges).toContain("source-badge-subsonic");
    expect(badges).toContain("source-badge-webdav");
    expect(badges).toContain("私有云");
    expect(badges).toContain("WebDAV");
  });

  it("renders Private Cloud entry and BackupRoamingCard in SettingsPanel, plus one-click safe normalize in EqualizerPanel", () => {
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
        trackCount={20}
        likedCount={5}
        lyricProgress={80}
        volume={60}
        onVolumeChange={vi.fn()}
        audioOutputDevices={[{ id: "default", label: "系统默认输出" }]}
        onRefreshAudioOutputDevices={vi.fn()}
        selectedSinkId="default"
        onSelectedSinkIdChange={vi.fn()}
        hifiEnabled
        onHifiEnabledChange={vi.fn()}
        masterQualityEnabled={false}
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
        onOpenPrivateCloud={vi.fn()}
        onBuildBackupSnapshot={(mods) => buildBackupSnapshot({ appVersion: "0.9.0" }, mods)}
        onApplyBackupSnapshot={() => ({ summary: "已恢复" })}
        onClose={vi.fn()}
      />,
    );

    expect(settingsMarkup).toContain("私有云 (OpenSubsonic / WebDAV)");
    expect(settingsMarkup).toContain("管理私有云");
    expect(settingsMarkup).toContain("配置备份与 WebDAV 漫游");
    expect(settingsMarkup).toContain("导出配置");
    expect(settingsMarkup).toContain("导入配置");
    expect(settingsMarkup).toContain("增量合并");
    expect(settingsMarkup).toContain("覆盖替换");

    const eqMarkup = renderToStaticMarkup(
      <EqualizerPanel
        enabled
        bands={[6, 4, 2, 0, 1, 2, 1, 0, 2, 3]}
        preset="custom"
        customPresets={[]}
        onEnabledChange={vi.fn()}
        onBandsChange={vi.fn()}
        onPresetChange={vi.fn()}
        onSavePreset={() => true}
        onDeletePreset={vi.fn()}
        onImportPresets={vi.fn()}
      />,
    );
    expect(eqMarkup).toContain("一键安全归一化");

    const navMarkup = renderToStaticMarkup(
      <AppNavigation activeView="playlists" onPick={vi.fn()} />,
    );
    expect(navMarkup).toContain("歌单");
    expect(navMarkup).not.toContain("私有云");

    const emptyQuickStartMarkup = renderToStaticMarkup(
      <PrivateCloudSurface
        instances={[]}
        tracks={[]}
        loading={false}
        error={null}
        onRefreshInstances={async () => undefined}
        onRefreshTracks={async () => undefined}
        onPickTrack={vi.fn()}
        onPlayNext={vi.fn()}
        onNotice={vi.fn()}
      />,
    );
    expect(emptyQuickStartMarkup).toContain("Alist 网盘挂载");
    expect(emptyQuickStartMarkup).toContain("Navidrome 音乐库");
    expect(emptyQuickStartMarkup).toContain("飞牛 / 群晖 / 极空间 NAS");
    expect(emptyQuickStartMarkup).toContain("坚果云 WebDAV");
  });
});
