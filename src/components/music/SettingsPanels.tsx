import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, Cookie, Copy, Download, FolderPlus, FolderSearch, Keyboard, LogIn, LogOut, Monitor, Moon, QrCode, Radio, RefreshCw, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Sun, Trash2, Upload, Volume2, X } from "lucide-react";
import QRCode from "qrcode";
import { AriaSelect } from "@/components/ui/aria-select";
import { Button } from "@/components/ui/button";
import { api, type ApiLibraryWatchState, type NeteaseAccountSummary, type NeteaseQrStart, type PrivateCloudInstancePublic, type SourceAccountSummary, type UpdateState } from "@/lib/api";
import {
  parseAndValidateBackup,
  type AriaBackupSnapshot,
  type BackupMergeStrategy,
  type BackupModuleKey,
} from "@/lib/configBackup";
import { formatTransferSpeed } from "@/components/music/UpdateBanner";
import { SourceLogo, type SourceLogoOption } from "@/components/music/SourceLogos";
import type { NativeAudioState } from "@/lib/audioTypes";
import {
  bilibiliAudioQualityOptions,
  bilibiliVideoQualityOptions,
  type AudioOutputMode,
  type BilibiliDefaultAudioLevel,
  type BilibiliDefaultVideoQn,
} from "@/lib/playerPresentation";
import { ariaThemeOptions, type AriaTheme } from "@/lib/theme";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  isMacPlatform,
  shortcutDefinitions,
  shortcutFromKeyboardEvent,
  shortcutsConflict,
  type KeyboardShortcuts,
  type ShortcutCommand,
} from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { ArtworkImage } from "./ArtworkImage";

function UpdateCard() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const updates = window.ariaDesktop?.updates;
    if (!updates) return;
    let alive = true;
    updates.getState().then((next) => { if (alive) setState(next); }).catch(() => undefined);
    const dispose = updates.onState((next) => { if (alive) setState(next); });
    return () => { alive = false; dispose?.(); };
  }, []);

  async function run(action: () => Promise<UpdateState | boolean>) {
    setBusy(true);
    try {
      const next = await action();
      if (next && typeof next === "object") setState(next);
    } finally {
      setBusy(false);
    }
  }

  if (typeof window === "undefined" || !window.ariaDesktop?.updates) {
    return (
      <div className="py-4">
        <p className="text-sm font-medium text-neutral-900">版本与更新</p>
        <p className="mt-1 text-xs text-neutral-500">当前是浏览器模式；桌面安装包支持自动检查更新。</p>
      </div>
    );
  }

  const statusText = (() => {
    if (!state) return "正在读取更新状态…";
    if (state.status === "checking") return "正在检查更新…";
    if (state.status === "available") return `发现新版本 ${state.availableVersion ?? ""}`;
    if (state.status === "downloading") {
      const speed = formatTransferSpeed(state.bytesPerSecond);
      return `正在下载${state.percent != null ? ` ${Math.round(state.percent)}%` : "…"}${speed ? ` · ${speed}` : ""}`;
    }
    if (state.status === "downloaded") return "更新已下载，重启 Aria 后安装。";
    if (state.status === "installing") return "正在关闭后台并启动安装程序…";
    if (state.status === "up-to-date") return "已经是最新版本。";
    if (state.status === "error") return state.error ?? "检查更新失败";
    if (state.status === "unsupported") return state.reason ?? "当前平台不支持自动更新";
    return "尚未检查更新";
  })();
  const checkedTimeText = state?.checkedAt
    ? new Date(state.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">版本与更新</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            当前版本 {state?.currentVersion ?? "—"} · {statusText}
            {checkedTimeText ? `（上次检查 ${checkedTimeText}）` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="subtle" disabled={busy || !state?.supported || state.status === "downloading" || state.status === "installing"} onClick={() => void run(() => window.ariaDesktop!.updates!.check())}>
            <RefreshCw className={cn((busy || state?.status === "checking") && "animate-spin")} />
            检查更新
          </Button>
          {state?.status === "available" && state.manualDownloadOnly && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.openReleases?.() ?? Promise.resolve(false))}>
              <Download />前往下载 {state.availableVersion}
            </Button>
          )}
          {state?.status === "available" && !state.manualDownloadOnly && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.download())}>
              <Download />下载 {state.availableVersion}
            </Button>
          )}
          {state?.status === "error" && state.availableVersion && !state.manualDownloadOnly && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.download())}>
              <Download />重试下载
            </Button>
          )}
          {state?.status === "downloaded" && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.install())}>
              重启并安装
            </Button>
          )}
          {(state?.status === "error" || state?.manualDownloadOnly) && window.ariaDesktop?.updates?.openReleases && (
            <Button size="sm" variant="glass" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.openReleases!())}>
              打开发布页
            </Button>
          )}
        </div>
      </div>
      {state?.releaseNotes && (
        <p className="settings-inline-well mt-2.5 max-h-28 overflow-y-auto whitespace-pre-line rounded-lg px-3 py-2 text-xs leading-relaxed text-neutral-500">
          {state.releaseNotes}
        </p>
      )}
      {state?.status === "downloading" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-neutral-950 transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]" style={{ width: `${Math.max(2, Math.min(100, state.percent ?? 0))}%` }} />
        </div>
      )}
    </div>
  );
}

type SettingsSection = "all" | "audio" | "sources" | "shortcuts" | "system";

const settingsSections: Array<{ id: SettingsSection; label: string }> = [
  { id: "all", label: "全部" },
  { id: "audio", label: "音频与音质" },
  { id: "sources", label: "播放源与账号" },
  { id: "shortcuts", label: "快捷键与曲库" },
  { id: "system", label: "系统与外观" },
];

function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("settings-row-divider flex items-center justify-between gap-4 border-b py-3.5 last:border-b-0", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-neutral-500">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingSwitch({
  checked,
  onToggle,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "bg-neutral-950" : "bg-neutral-200",
      )}
    >
      <span className={cn("size-5 rounded-full bg-white shadow-sm transition", checked && "translate-x-5")} />
    </button>
  );
}

export function SettingsPanel({
  backgroundEnabled,
  onBackgroundEnabledChange,
  neteaseAccount,
  libraryMeta,
  libraryAutoScanEnabled,
  libraryWatchState,
  onAddLibraryFolder,
  onRemoveLibraryRoot,
  onToggleLibraryAutoScan,
  trackCount,
  likedCount,
  lyricProgress,
  volume,
  onVolumeChange,
  audioOutputDevices,
  onRefreshAudioOutputDevices,
  selectedSinkId,
  onSelectedSinkIdChange,
  hifiEnabled,
  onHifiEnabledChange,
  masterQualityEnabled,
  onMasterQualityEnabledChange,
  gaplessEnabled,
  onGaplessEnabledChange,
  normalizationEnabled,
  onNormalizationEnabledChange,
  normalizationError,
  nativeAudioSupported,
  nativeAudioState,
  audioOutputMode,
  onAudioOutputModeChange,
  exclusiveMode,
  keyboardShortcuts,
  onKeyboardShortcutsChange,
  theme,
  onThemeChange,
  windowMaterial = "default",
  onWindowMaterialChange,
  bilibiliDefaultVideoQn = 120,
  onBilibiliDefaultVideoQnChange,
  bilibiliDefaultAudioLevel = "hires",
  onBilibiliDefaultAudioLevelChange,
  onNeteaseAccountChange,
  onSourceAccountChange,
  onOpenPrivateCloud,
  onBuildBackupSnapshot,
  onApplyBackupSnapshot,
  onClose,
}: {
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  neteaseAccount: NeteaseAccountSummary | null;
  libraryMeta: { roots: string[]; updatedAt: string | null };
  libraryAutoScanEnabled: boolean;
  libraryWatchState: ApiLibraryWatchState | null;
  onAddLibraryFolder: () => void;
  onRemoveLibraryRoot: (root: string) => void;
  onToggleLibraryAutoScan: (enabled: boolean) => void;
  trackCount: number;
  likedCount: number;
  lyricProgress: number;
  volume: number;
  onVolumeChange: (value: number) => void;
  audioOutputDevices: Array<{ id: string; label: string }>;
  onRefreshAudioOutputDevices?: () => Promise<void> | void;
  selectedSinkId: string;
  onSelectedSinkIdChange: (value: string) => void;
  hifiEnabled: boolean;
  onHifiEnabledChange: (value: boolean) => void;
  masterQualityEnabled: boolean;
  onMasterQualityEnabledChange: (value: boolean) => void;
  gaplessEnabled: boolean;
  onGaplessEnabledChange: (value: boolean) => void;
  normalizationEnabled: boolean;
  onNormalizationEnabledChange: (value: boolean) => void;
  normalizationError: string | null;
  nativeAudioSupported: boolean;
  nativeAudioState: NativeAudioState | null;
  audioOutputMode: AudioOutputMode;
  onAudioOutputModeChange: (value: AudioOutputMode) => void;
  exclusiveMode: boolean;
  keyboardShortcuts: KeyboardShortcuts;
  onKeyboardShortcutsChange: (shortcuts: KeyboardShortcuts) => void;
  theme: AriaTheme;
  onThemeChange: (theme: AriaTheme) => void;
  windowMaterial?: "default" | "translucent";
  onWindowMaterialChange?: (mode: "default" | "translucent") => void;
  bilibiliDefaultVideoQn?: BilibiliDefaultVideoQn;
  onBilibiliDefaultVideoQnChange?: (qn: BilibiliDefaultVideoQn) => void;
  bilibiliDefaultAudioLevel?: BilibiliDefaultAudioLevel;
  onBilibiliDefaultAudioLevelChange?: (level: BilibiliDefaultAudioLevel) => void;
  /** Fired after NetEase signs in or out from Settings so the header can refresh. */
  onNeteaseAccountChange?: (account: NeteaseAccountSummary) => void;
  /** Fired after a non-NetEase source account changes so the header can refresh. */
  onSourceAccountChange?: () => void;
  onOpenPrivateCloud?: () => void;
  onBuildBackupSnapshot?: (modules: BackupModuleKey[]) => AriaBackupSnapshot;
  onApplyBackupSnapshot?: (
    snapshot: AriaBackupSnapshot,
    strategy: BackupMergeStrategy,
    modules: BackupModuleKey[],
  ) => { summary: string };
  onClose: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>("all");
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const desktopReady = typeof window !== "undefined" && Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);
  // macOS reaches the native engine through a Homebrew/system mpv binary, so the
  // "only the browser engine works" case is normal there and needs an explicit
  // hint instead of three silently disabled buttons.
  const isMac = isMacPlatform();
  const outputModeLabel = isMac
    ? audioOutputMode === "exclusive"
      ? "CoreAudio 独占"
      : audioOutputMode === "shared"
        ? "CoreAudio 共享"
        : "系统音频"
    : audioOutputMode === "exclusive"
      ? "WASAPI Exclusive"
      : audioOutputMode === "shared"
        ? "WASAPI Shared"
        : "System";
  const showSection = (id: Exclude<SettingsSection, "all">) => section === "all" || section === id;
  const qualityModeLabel = !hifiEnabled ? "标准 320K" : masterQualityEnabled ? "臻品母带优先" : "Hi-Res 无损优先";
  const qualityStages = [
    { label: "臻品母带 24bit/192kHz", active: hifiEnabled && masterQualityEnabled },
    { label: "Hi-Res", active: hifiEnabled },
    { label: "无损 FLAC", active: hifiEnabled },
    { label: "320K", active: true },
  ];

  async function handleRefreshDevices() {
    if (!onRefreshAudioOutputDevices || refreshingDevices) return;
    setRefreshingDevices(true);
    try {
      await Promise.allSettled([
        Promise.resolve(onRefreshAudioOutputDevices()),
        new Promise<void>((resolve) => window.setTimeout(resolve, 260)),
      ]);
    } finally {
      setRefreshingDevices(false);
    }
  }

  function refreshApiState() {
    setApiState("checking");
    api
      .health()
      .then(() => setApiState("online"))
      .catch(() => setApiState("offline"));
  }

  useEffect(() => {
    let mounted = true;
    setApiState("checking");
    api
      .health()
      .then(() => {
        if (mounted) setApiState("online");
      })
      .catch(() => {
        if (mounted) setApiState("offline");
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="glass settings-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem]">
      <header className="settings-header flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回上一页" onClick={onClose} title="返回上一页">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-neutral-950">设置</h1>
              <span className="text-[11px] font-medium text-neutral-400">v{__APP_VERSION__}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {desktopReady ? "桌面端" : "网页端"} · {apiState === "online" ? "服务在线" : apiState === "offline" ? "服务离线" : "检测中"} · {outputModeLabel}
            </p>
          </div>
        </div>

        <nav className="settings-segment inline-flex flex-wrap items-center gap-0.5 rounded-xl p-1" role="tablist" aria-label="设置分类">
          {settingsSections.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(item.id)}
                className={cn(
                  "settings-segment-item rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  active && "is-active",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-[820px] space-y-8">
          {showSection("audio") && (
            <section className="settings-section pb-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-neutral-950">音频与音质</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">当前策略：{qualityModeLabel} · {exclusiveReady ? "独占直通" : outputModeLabel}</p>
                </div>
                <span className="text-xs font-medium text-neutral-500">音量 {volume}%</span>
              </div>

              <div className="settings-inline-well mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5">
                <span className="text-xs font-medium text-neutral-600">解析链路降级策略</span>
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                  {qualityStages.map((stage, index) => (
                    <div key={stage.label} className="flex items-center gap-1.5">
                      {index > 0 && <ArrowRight className="size-3 text-neutral-400" />}
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 transition",
                          stage.active
                            ? "bg-neutral-950 text-white"
                            : "text-neutral-400 line-through decoration-neutral-400/70",
                        )}
                      >
                        {stage.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <SettingRow title="HiFi 优先" description="优先最高原始音质 Hi-Res，不支持时按上方阶梯自动降级。">
                  <SettingSwitch
                    checked={hifiEnabled}
                    onToggle={() => {
                      const nextEnabled = !hifiEnabled;
                      onHifiEnabledChange(nextEnabled);
                      if (!nextEnabled) onMasterQualityEnabledChange(false);
                    }}
                    ariaLabel="切换 HiFi 优先"
                  />
                </SettingRow>

                {hifiEnabled && (
                  <SettingRow title="臻品增强" description="独立开启臻品音质；不支持的歌曲使用原始最高音质。">
                    <SettingSwitch
                      checked={masterQualityEnabled}
                      onToggle={() => onMasterQualityEnabledChange(!masterQualityEnabled)}
                      ariaLabel="切换臻品增强"
                    />
                  </SettingRow>
                )}

                <SettingRow title="音量标准化" description="平衡不同曲目的响度差异，避免音量忽大忽小。">
                  <SettingSwitch
                    checked={normalizationEnabled}
                    onToggle={() => onNormalizationEnabledChange(!normalizationEnabled)}
                    ariaLabel="切换音量标准化"
                  />
                </SettingRow>
                {normalizationError && <p role="alert" className="settings-status-banner is-error mb-2 rounded-lg px-3 py-1.5 text-xs">{normalizationError}</p>}

                <SettingRow title="无缝衔接" description="提前预加载下一首，消除切歌时的空白停顿。">
                  <SettingSwitch
                    checked={gaplessEnabled}
                    onToggle={() => onGaplessEnabledChange(!gaplessEnabled)}
                    ariaLabel="切换无缝衔接"
                  />
                </SettingRow>

                {(onBilibiliDefaultVideoQnChange || onBilibiliDefaultAudioLevelChange) && (
                  <div className="settings-row-divider border-b py-3.5">
                    <BilibiliDefaultQualityControls
                      defaultVideoQn={bilibiliDefaultVideoQn}
                      onDefaultVideoQnChange={onBilibiliDefaultVideoQnChange}
                      defaultAudioLevel={bilibiliDefaultAudioLevel}
                      onDefaultAudioLevelChange={onBilibiliDefaultAudioLevelChange}
                    />
                  </div>
                )}

                <div className="settings-row-divider border-b py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">默认音量</p>
                      <p className="mt-0.5 text-xs text-neutral-500">应用启动或恢复播放时的输出电平</p>
                    </div>
                    <span className="w-10 text-right font-mono text-xs text-neutral-600 tabular-nums">{volume}%</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <Volume2 className="size-4 shrink-0 text-neutral-500" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volume}
                      onChange={(event) => onVolumeChange(Number(event.target.value))}
                      className="aria-range w-full"
                      style={
                        {
                          "--range-color": "#171717",
                          "--range-value": Math.min(1, Math.max(0, volume / 100)),
                        } as CSSProperties
                      }
                    />
                  </div>
                </div>

                <div className="settings-row-divider border-b py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">输出模式</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {audioOutputMode === "exclusive"
                          ? "独占音频端点直通 DAC 或声卡"
                          : audioOutputMode === "shared"
                            ? "独立 Aria 音频会话，可与其它软件共用设备"
                            : isMac
                              ? "浏览器音频引擎，跟随 macOS 默认输出"
                              : "WASAPI 共享混音输出，频谱直接跟随播放器"}
                      </p>
                    </div>
                    <div className="settings-segment inline-flex rounded-xl p-1">
                      {[
                        { mode: "system" as const, label: "系统音频", Icon: Volume2 },
                        { mode: "shared" as const, label: isMac ? "CoreAudio 共享" : "WASAPI 共享", Icon: Radio },
                        { mode: "exclusive" as const, label: isMac ? "CoreAudio 独占" : "WASAPI 独占", Icon: Sparkles },
                      ].map(({ mode, label, Icon }) => {
                        const disabled = mode !== "system" && !nativeAudioSupported;
                        const active = audioOutputMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            disabled={disabled}
                            onClick={() => onAudioOutputModeChange(mode)}
                            className={cn(
                              "settings-segment-item inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                              active && "is-active",
                            )}
                          >
                            <Icon className="size-3.5" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {!nativeAudioSupported && (
                    <p className="settings-status-banner mt-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed">
                      {isMac
                        ? "未检测到 MPV：仅可使用浏览器音频引擎。安装正式版 DMG 或执行 brew install mpv 后重启 Aria 即可解锁 CoreAudio 输出。"
                        : "未检测到 MPV：当前走浏览器音频引擎，共享与独占直通暂不可用。"}
                    </p>
                  )}
                </div>

                <div className="pt-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">播放设备</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {nativeAudioState?.deviceId ? `当前设备：${nativeAudioState.deviceId}` : "当前设备：系统默认输出"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">{deviceSwitchSupported ? "可切换" : "系统默认"}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="刷新播放设备"
                        onClick={() => void handleRefreshDevices()}
                        disabled={refreshingDevices || !onRefreshAudioOutputDevices}
                      >
                        <RefreshCw className={cn("size-3.5", refreshingDevices && "animate-spin")} />
                        刷新设备
                      </Button>
                    </div>
                  </div>
                  <div className="settings-inline-well settings-divider no-scrollbar mt-2.5 max-h-44 overflow-y-auto rounded-xl">
                    {audioOutputDevices.map((device) => {
                      const active = selectedSinkId === device.id;
                      return (
                        <button
                          key={device.id}
                          type="button"
                          disabled={!deviceSwitchSupported}
                          onClick={() => onSelectedSinkIdChange(device.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50",
                            active && "font-semibold text-neutral-950",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{device.label}</span>
                          {active && <Check className="size-3.5 shrink-0 text-neutral-900" />}
                        </button>
                      );
                    })}
                    {!audioOutputDevices.length && (
                      <div className="px-3 py-3 text-xs text-neutral-500">没有检测到可用输出设备。</div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {showSection("sources") && (
            <section className="settings-section pb-7">
              <div className="pb-2">
                <h2 className="text-base font-semibold tracking-tight text-neutral-950">播放源与账号</h2>
                <p className="mt-0.5 text-xs text-neutral-500">管理在线音源登录状态与启用开关；关闭的音源不会参与搜索或请求。</p>
              </div>
              <div className="settings-divider">
                <NeteaseSourceCard account={neteaseAccount} onAccountChange={onNeteaseAccountChange} />
                <QqSourceCard onAccountChange={onSourceAccountChange} />
                <BilibiliSourceCard onAccountChange={onSourceAccountChange} />
                <YoutubeSourceCard onAccountChange={onSourceAccountChange} />
                <div className="py-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
                      <Cloud className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">私有云 (OpenSubsonic / WebDAV)</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        管理 Navidrome / Subsonic 与 Alist / NAS WebDAV 实例，凭据已采用 AES-256-GCM 本地加密保存。
                      </p>
                    </div>
                  </div>
                  {onOpenPrivateCloud && (
                    <Button size="sm" variant="subtle" onClick={onOpenPrivateCloud}>
                      <Cloud />
                      管理私有云
                    </Button>
                  )}
                </div>
              </div>
            </section>
          )}

          {showSection("shortcuts") && (
            <section className="settings-section pb-7">
              <KeyboardShortcutSettings
                shortcuts={keyboardShortcuts}
                onChange={onKeyboardShortcutsChange}
              />

              <div className="settings-row-divider mt-7 border-t pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-neutral-950">本地音乐目录</h2>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      共 {trackCount} 首曲目 · {likedCount} 首喜欢 · {lyricProgress}% 已匹配歌词
                    </p>
                  </div>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={onAddLibraryFolder}
                    disabled={typeof window === "undefined" || !window.ariaDesktop?.chooseMusicFolder}
                  >
                    <FolderPlus />
                    添加文件夹
                  </Button>
                </div>

                {libraryMeta.roots.length > 0 ? (
                  <div className="settings-inline-well settings-divider mt-3 rounded-xl">
                    {libraryMeta.roots.map((root) => (
                      <div key={root} className="flex items-center gap-2.5 px-3 py-2">
                        <FolderSearch className="size-4 shrink-0 text-neutral-500" />
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800" title={root}>{root}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`移除目录 ${root}`}
                          title="从曲库移除（不会删除音频文件）"
                          onClick={() => onRemoveLibraryRoot(root)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-inline-well mt-3 rounded-xl px-3.5 py-3 text-xs text-neutral-500">
                    还没有添加本地音乐目录。添加后 Aria 会自动扫描歌曲、封面与内嵌歌词。
                  </p>
                )}

                <SettingRow title="自动扫描新歌" description="监听目录变化，新加入的文件会自动入库。">
                  <SettingSwitch
                    checked={libraryAutoScanEnabled}
                    onToggle={() => onToggleLibraryAutoScan(!libraryAutoScanEnabled)}
                    ariaLabel="切换自动扫描新歌"
                  />
                </SettingRow>
                <p className={cn("pt-2 text-xs", libraryWatchState?.lastError ? "text-rose-500" : "text-neutral-500")}>
                  {libraryWatchState?.scanningRoots.length
                    ? `正在扫描 ${libraryWatchState.scanningRoots.length} 个目录…`
                    : libraryWatchState?.lastError
                      ? `自动扫描：${libraryWatchState.lastError}`
                      : !libraryAutoScanEnabled
                        ? "自动扫描已关闭，添加目录时仍会手动扫描一次。"
                        : libraryWatchState?.lastScanAt
                          ? `上次自动扫描：${new Date(libraryWatchState.lastScanAt).toLocaleString()}`
                          : "自动扫描已开启，Aria 启动后会补扫离线期间新增的文件。"}
                </p>
              </div>
            </section>
          )}

          {showSection("system") && (
            <section className="settings-section pb-7">
              <div className="pb-2">
                <h2 className="text-base font-semibold tracking-tight text-neutral-950">系统与外观</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {isMac ? "界面主题、后台菜单栏托管、局域网远程访问与版本更新。" : "界面主题、后台托盘托管、局域网远程访问与版本更新。"}
                </p>
              </div>

              <div className="settings-divider">
                <div className="py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">外观主题</p>
                      <p className="mt-0.5 text-xs text-neutral-500">深色模式同步覆盖首页、播放页与设置页</p>
                    </div>
                    <div className="settings-segment inline-flex rounded-xl p-1">
                      {ariaThemeOptions.map((option) => {
                        const active = theme === option.value;
                        const Icon = option.value === "light" ? Sun : option.value === "dark" ? Moon : Monitor;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onThemeChange(option.value)}
                            className={cn(
                              "settings-segment-item inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                              active && "is-active",
                            )}
                          >
                            <Icon className="size-3.5" />
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {desktopReady && onWindowMaterialChange && (
                  <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">窗口材质</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {isMac ? "启用 macOS Vibrancy 窗口毛玻璃景深" : "启用 Windows 11 Mica 半透明窗口景深"}
                      </p>
                    </div>
                    <div className="settings-segment inline-flex rounded-xl p-1">
                      {(
                        [
                          { value: "default", label: "标准" },
                          { value: "translucent", label: "半透明材质" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={windowMaterial === option.value}
                          onClick={() => onWindowMaterialChange(option.value)}
                          className={cn(
                            "settings-segment-item inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                            windowMaterial === option.value && "is-active",
                          )}
                        >
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900">{isMac ? "后台菜单栏托管" : "后台托盘托管"}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {desktopReady
                        ? isMac
                          ? "关闭窗口时保持菜单栏与程序坞常驻，全球热键继续生效"
                          : "关闭窗口时保持托盘常驻与全局热键监听"
                        : "当前为网页预览模式"} · 后端 {apiState === "online" ? "在线" : apiState === "offline" ? "离线" : "检测中"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={refreshApiState}>
                      <RefreshCw />
                      刷新
                    </Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={!desktopReady}
                      onClick={() => window.ariaDesktop?.minimizeToTray?.()}
                    >
                      <SlidersHorizontal />
                      {isMac ? "隐藏到菜单栏" : "隐藏到托盘"}
                    </Button>
                    <SettingSwitch
                      checked={backgroundEnabled}
                      onToggle={() => onBackgroundEnabledChange(!backgroundEnabled)}
                      ariaLabel="切换后台托管"
                    />
                  </div>
                </div>

                <RemoteAccessSettings />

                <BackupRoamingCard
                  onBuildSnapshot={onBuildBackupSnapshot}
                  onApplySnapshot={onApplyBackupSnapshot}
                  onOpenPrivateCloud={onOpenPrivateCloud}
                />

                <UpdateCard />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyboardShortcutSettings({
  shortcuts,
  onChange,
}: {
  shortcuts: KeyboardShortcuts;
  onChange: (shortcuts: KeyboardShortcuts) => void;
}) {
  const isMac = isMacPlatform();
  const [recording, setRecording] = useState<ShortcutCommand | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;

    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        setMessage(null);
        return;
      }

      const candidate = shortcutFromKeyboardEvent(event);
      if (!candidate) {
        setMessage(isMac ? "请按住 ⌃、⌥、⇧ 或 ⌘，再按一个功能键。" : "请按住 Ctrl、Alt、Shift 或 Win，再按一个功能键。");
        return;
      }
      if (shortcutsConflict(shortcuts, recording, candidate)) {
        setMessage("该组合已分配给其他操作。");
        return;
      }

      onChange({ ...shortcuts, [recording]: candidate });
      setRecording(null);
      setMessage(null);
    };

    window.addEventListener("keydown", captureShortcut, true);
    return () => window.removeEventListener("keydown", captureShortcut, true);
  }, [isMac, onChange, recording, shortcuts]);

  const inAppShortcuts = [
    { key: "Space", action: "播放 / 暂停" },
    { key: isMac ? "⌥ + ← / →" : "Alt + ← / →", action: "上一首 / 下一首" },
    ...(isMac ? [{ key: "⌘ + ,", action: "打开设置" }] : []),
    { key: "I", action: "切换沉浸模式" },
    { key: "Esc", action: "退出全屏 / 沉浸" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-950">全局快捷键</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            后台托管或切换到其他应用时依然生效，共 {shortcutDefinitions.length} 项；点击右侧按键即可录制修改。
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ ...defaultKeyboardShortcuts });
            setRecording(null);
            setMessage(null);
          }}
        >
          <RotateCcw />
          恢复默认
        </Button>
      </div>

      <div className="settings-inline-well mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-3.5 py-2 text-xs text-neutral-700">
        <span className="font-medium text-neutral-900">应用内快捷键</span>
        {inAppShortcuts.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <kbd className="rounded-md border border-neutral-950/10 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-800">
              {item.key}
            </kbd>
            <span className="text-neutral-500">{item.action}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
        {shortcutDefinitions.map((definition) => {
          const isRecording = recording === definition.command;
          return (
            <div key={definition.command} className="settings-row-divider flex items-center justify-between gap-3 border-b py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-neutral-900">{definition.label}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{definition.description}</p>
              </div>
              <button
                type="button"
                className={cn(
                  "min-w-24 shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs font-medium transition",
                  isRecording
                    ? "border-neutral-950 bg-neutral-950 text-white"
                    : "border-neutral-950/10 bg-white/80 text-neutral-800 hover:border-neutral-950/25",
                )}
                onClick={() => {
                  setRecording(definition.command);
                  setMessage(null);
                }}
              >
                {isRecording ? "按下组合键" : formatShortcut(shortcuts[definition.command])}
              </button>
            </div>
          );
        })}
      </div>
      {message && <p className="mt-2.5 text-xs font-medium text-rose-500">{message}</p>}
    </div>
  );
}

export function AccountPanel({
  onClose,
  sourceAccounts = [],
  onManageSources,
}: {
  onClose: () => void;
  sourceAccounts?: { id: string; label: string; connected: boolean; nickname: string | null; avatarUrl?: string | null }[];
  onManageSources?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22 }}
      className="glass z-50 w-[min(25rem,calc(100vw-2rem))] rounded-[1.4rem] p-4 absolute right-0 top-14"
    >
      <div className="flex items-center justify-between gap-3 pb-2">
        <p className="text-sm font-semibold">播放源账号</p>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      {/* 头像与平台标识分离：头像代表当前账号，右下角小徽标标明所属平台。 */}
      <div className="settings-divider mt-1">
        {sourceAccounts.map((source) => {
          const logo = source.id === "qq" ? "qq" : source.id === "bilibili" ? "bilibili" : source.id === "youtube" ? "youtube" : "netease";
          return (
            <div key={source.id} className="flex items-center gap-3 py-2.5">
              <div className="relative shrink-0">
                {source.avatarUrl && source.connected ? (
                  <ArtworkImage src={source.avatarUrl} cacheSize={128} alt="" draggable={false} className="size-10 rounded-full object-cover shadow-xs" />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-full bg-white/80 shadow-xs">
                    <SourceLogo source={logo} className="size-5" />
                  </div>
                )}
                <span className="settings-qr-box absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full !p-0.5 shadow-xs ring-1 ring-black/5">
                  <SourceLogo source={logo} className="size-3" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {source.connected ? source.nickname ?? "已登录" : source.label}
                </p>
                <p className={cn("mt-0.5 text-xs", source.connected ? "text-emerald-600" : "text-neutral-400")}>
                  {source.connected ? source.label : "未登录"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {onManageSources && (
        <Button className="mt-3 w-full" size="sm" onClick={onManageSources}>
          <Settings2 />
          前往设置管理账号
        </Button>
      )}
    </motion.div>
  );
}

/** NetEase source row in Settings: QR/cookie login and live account state. */
function NeteaseSourceCard({
  account: initialAccount,
  onAccountChange,
  embedded = false,
}: {
  account: NeteaseAccountSummary | null;
  onAccountChange?: (account: NeteaseAccountSummary) => void;
  embedded?: boolean;
}) {
  const [account, setAccount] = useState<NeteaseAccountSummary | null>(initialAccount);
  const [cookie, setCookie] = useState("");
  const [qrLogin, setQrLogin] = useState<NeteaseQrStart | null>(null);
  const [qrStatus, setQrStatus] = useState("点击扫码登录，使用网易云音乐手机端扫描二维码。");
  const [showCookie, setShowCookie] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const accountChangeRef = useRef(onAccountChange);
  accountChangeRef.current = onAccountChange;

  useEffect(() => {
    setAccount(initialAccount);
  }, [initialAccount]);

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (!mounted) return;
        setAccount((current) => (current?.connected ? current : settings.neteaseAccount));
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!qrLogin) return;

    let cancelled = false;
    let polling = false;
    const check = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await api.checkNeteaseQrLogin(qrLogin.key);
        if (cancelled) return;

        if (result.status === "success" && result.account) {
          setAccount(result.account);
          accountChangeRef.current?.(result.account);
          setQrStatus("登录成功，账号信息已同步。");
          setMessage("网易云账号已登录");
          setQrLogin(null);
          return;
        }

        if (result.status === "expired") {
          setQrStatus("二维码已过期，请重新生成。");
          setQrLogin(null);
          return;
        }

        setQrStatus(result.status === "scanned" ? "已扫码，请在手机上确认登录。" : "等待扫码确认。");
      } catch (error) {
        if (!cancelled) setQrStatus(error instanceof Error ? error.message : "扫码状态获取失败，稍后会自动重试。");
      } finally {
        polling = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrLogin]);

  async function startQrLogin() {
    setQrLoading(true);
    setMessage(null);
    try {
      const result = await api.startNeteaseQrLogin();
      setQrLogin(result);
      setQrStatus("请用网易云音乐 App 扫码。");
    } catch {
      setMessage("二维码生成失败，请确认后端正在运行。");
    } finally {
      setQrLoading(false);
    }
  }

  async function bindCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveNeteaseCookie(cookie.trim());
      setAccount(result.account);
      accountChangeRef.current?.(result.account);
      setCookie("");
      setShowCookie(false);
      setMessage(result.account.connected ? "网易云 Cookie 已保存并登录" : "Cookie 已保存，但登录状态未确认");
    } catch {
      setMessage("保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.clearNeteaseCookie();
      setAccount(result.account);
      accountChangeRef.current?.(result.account);
      setQrLogin(null);
      setQrStatus("点击扫码登录，使用网易云音乐手机端扫描二维码。");
      setMessage("已退出网易云音乐账号");
    } catch {
      setMessage("退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn(embedded ? "rounded-2xl bg-white/55 p-4" : "py-4")}>
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 shadow-xs">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={160} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <SourceLogo source="netease" className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">网易云音乐</span>
              <span className={cn("text-xs font-medium", account?.connected ? "text-emerald-600" : "text-neutral-400")}>
                {account?.connected ? (account.nickname ?? "已登录") : "未登录"}
              </span>
            </div>
            {!embedded && <SourceToggle sourceId="netease" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={startQrLogin} disabled={qrLoading || saving}>
              <QrCode />
              {qrLoading ? "生成中" : qrLogin ? "刷新二维码" : "扫码登录"}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowCookie((value) => !value)}>
              <Cookie />
              Cookie 备用绑定
            </Button>
            {account?.connected && (
              <Button size="sm" variant="subtle" onClick={() => void logout()} disabled={saving}>
                <LogOut />
                退出登录
              </Button>
            )}
          </div>
        </div>
      </div>

      {qrLogin && (
        <div className="settings-inline-well mt-3 flex items-center gap-3 rounded-xl p-3">
          <img
            src={qrLogin.qrImage}
            alt="网易云扫码登录二维码"
            width={120}
            height={120}
            className="settings-qr-box size-[120px] rounded-xl object-contain"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-700">网易云音乐 App 扫码</p>
            <p className="mt-1">{qrStatus}</p>
            <p className="mt-1 text-neutral-400">二维码由本机服务端生成并轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showCookie && (
        <div className="settings-inline-well mt-3 rounded-xl p-3">
          <label className="text-xs font-medium text-neutral-600" htmlFor="netease-cookie">
            网易云 Cookie
          </label>
          <textarea
            id="netease-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={3}
            placeholder="MUSIC_U=...; NMTID=..."
            className="settings-input mt-2 w-full resize-none rounded-lg p-2.5 text-xs outline-none"
          />
          <div className="mt-2.5 flex justify-end">
            <Button size="sm" onClick={() => void bindCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="settings-status-banner mt-2.5 rounded-lg px-3 py-1.5 text-xs">{message}</p>}
    </div>
  );
}

export function OnboardingDialog({
  neteaseAccount,
  hifiEnabled,
  onHifiEnabledChange,
  backgroundEnabled,
  onBackgroundEnabledChange,
  gaplessEnabled,
  onGaplessEnabledChange,
  onAddLocalMusic,
  localMusicInfo,
  scanProgress,
  onAccountChange,
  onSourceAccountChange,
  qqAccount = null,
  bilibiliAccount = null,
  onComplete,
}: {
  neteaseAccount: NeteaseAccountSummary | null;
  hifiEnabled: boolean;
  onHifiEnabledChange: (value: boolean) => void;
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  gaplessEnabled: boolean;
  onGaplessEnabledChange: (value: boolean) => void;
  onAddLocalMusic: () => void;
  localMusicInfo: { path: string; count: number } | null;
  scanProgress: { phase: string; processed: number; total: number; status: string; error?: string | null } | null;
  onAccountChange: (account: NeteaseAccountSummary) => void;
  /** Refresh callback fired after an online source account changes. */
  onSourceAccountChange?: () => void;
  /** QQ Music account, shown in the summary step. */
  qqAccount?: SourceAccountSummary | null;
  /** Bilibili account, shown in the summary step. */
  bilibiliAccount?: SourceAccountSummary | null;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);

  function finish() {
    try {
      window.localStorage.setItem("aria-onboarding-complete", "1");
    } catch {
      // The wizard should never block normal playback when storage is unavailable.
    }
    onComplete();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/25 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="max-h-[min(90vh,52rem)] w-full max-w-2xl overflow-y-auto rounded-[1.5rem] border border-white/80 bg-[#f7f8fa]/95 p-5 shadow-[0_30px_100px_rgba(20,24,35,0.24)] sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Aria</p>
            <h1 className="mt-1 text-2xl font-semibold">开始使用 Aria</h1>
          </div>
          <div className="flex items-center gap-1.5" aria-label={`第 ${step + 1} 步，共 4 步`}>
            {[0, 1, 2, 3].map((item) => (
              <span key={item} className={cn("size-2 rounded-full", item === step ? "bg-neutral-950" : "bg-neutral-300")} />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="mt-8 grid gap-5 sm:grid-cols-[1.1fr_0.9fr] sm:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight">你的音乐，<br />从这里开始。</h2>
              <p className="mt-4 text-sm leading-6 text-neutral-500">Aria 把本地音乐、网易云、QQ 音乐与 B站三个在线音源，以及高音质播放集中在一个安静的工作台里。</p>
            </div>
            <div className="rounded-[1.25rem] bg-neutral-950 p-5 text-white shadow-lg">
              <div className="space-y-3 text-sm text-white/80">
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />本地无损音乐</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />网易云音乐</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />QQ 音乐</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />B站视频与音频</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />{window.ariaDesktop?.platform === "darwin" ? "系统媒体控制" : "任务栏快捷控制"}</p>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">添加你的本地音乐</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">选择一个音乐文件夹，Aria 会扫描歌曲、封面、码率和采样率。文件不会被复制或移动，扫描完成后可以在左侧“本地音乐”查看。</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">选择文件夹</p><p className="mt-1 text-xs leading-5 text-neutral-500">支持 FLAC、ALAC、WAV、MP3 等常见格式。</p></div>
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">自动识别</p><p className="mt-1 text-xs leading-5 text-neutral-500">读取内嵌封面、艺术家、专辑和真实音频参数。</p></div>
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">随时管理</p><p className="mt-1 text-xs leading-5 text-neutral-500">设置中的本地音乐入口可以重新扫描或清除索引。</p></div>
            </div>
            {localMusicInfo && (
              <div className="mt-5 grid gap-3 rounded-[1.1rem] border border-emerald-200/70 bg-emerald-50/70 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700/70">已选择本地音乐</p>
                  <p className="mt-1 truncate text-sm font-semibold text-emerald-950" title={localMusicInfo.path}>{localMusicInfo.path}</p>
                </div>
                <p className="text-lg font-semibold text-emerald-900">{localMusicInfo.count} 首</p>
              </div>
            )}
            {scanProgress?.status === "running" && (
              <div className="mt-4 rounded-[1rem] border border-sky-200/70 bg-sky-50/70 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">正在扫描本地音乐</span>
                  <span className="text-sky-700">{scanProgress.total ? String(scanProgress.processed) + "/" + String(scanProgress.total) : "准备中"}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
                  <div className="h-full rounded-full bg-sky-500 transition-[width] duration-200" style={{ width: (scanProgress.total ? Math.min(100, scanProgress.processed / scanProgress.total * 100) : 8) + "%" }} />
                </div>
              </div>
            )}
            <Button className="mt-5" onClick={onAddLocalMusic}><FolderSearch />{localMusicInfo ? "重新选择文件夹" : "选择本地音乐文件夹"}</Button>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5">
            <h2 className="text-xl font-semibold">连接你的播放源</h2>
            <p className="mt-2 text-sm text-neutral-500">
              Aria 支持多个音源：网易云音乐提供每日推荐、私人漫游与歌单，QQ 音乐提供搜索、播放、歌词、我喜欢、歌单读取和每日推荐，B站提供视频/音频双模式与收藏同步。也可以稍后在设置或右上角完成。
            </p>
            <p className="mt-3 rounded-[1rem] border border-emerald-200/70 bg-emerald-50/70 px-4 py-3 text-xs leading-6 text-emerald-900/80">
              QQ 音乐提示：建议用手机 QQ 扫码登录，登录后才能同步「我喜欢」和读取歌单；歌曲旁出现 VIP 表示整首收听需要绿钻，只有高音质受限的歌曲不会标 VIP。QQ 音乐歌单目前在 Aria 内只读，编辑请回到 QQ 音乐。
            </p>
            <p className="mt-3 rounded-[1rem] border border-sky-200/70 bg-sky-50/70 px-4 py-3 text-xs leading-6 text-sky-900/80">
              B站提示：扫码登录后可同步「Aria」收藏夹与「我的收藏夹」歌单；播放页红心会在第一次使用时自动创建该收藏夹，之后加入或移出。登录状态下视频清晰度更高。匿名搜索与播放无需登录。
            </p>
            <p className="mt-3 rounded-[1rem] border border-rose-200/70 bg-rose-50/60 px-4 py-3 text-xs leading-6 text-rose-900/80">
              YouTube 提示：无需登录即可搜索与播放；无法直连时，可在设置 → 播放源里为 YouTube 单独配置代理端口，其它音源不受影响。
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <NeteaseSourceCard embedded account={neteaseAccount} onAccountChange={onAccountChange} />
              <QqSourceCard embedded onAccountChange={onSourceAccountChange} />
              <div className="lg:col-span-2">
                <BilibiliSourceCard embedded onAccountChange={onSourceAccountChange} />
              </div>
              <div className="lg:col-span-2">
                <YoutubeSourceCard embedded onAccountChange={onSourceAccountChange} />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">设置你的播放偏好</h2>
            <p className="mt-2 text-sm text-neutral-500">这些选项之后都可以在设置中修改。</p>
            <div className="mt-5 space-y-3">
              {[
                ["后台托管", "关闭主窗口后继续播放，并保留系统媒体快捷控制。", backgroundEnabled, onBackgroundEnabledChange],
                ["HiFi 优先", "优先最高原始音质 Hi-Res，不支持时自动降级。", hifiEnabled, onHifiEnabledChange],
                ["无缝衔接", "提前加载下一首，减少歌曲切换时的空隙。", gaplessEnabled, onGaplessEnabledChange],
              ].map(([label, description, enabled, onChange]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 rounded-[1.1rem] bg-white/70 p-4 shadow-sm">
                  <div><p className="font-medium">{String(label)}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{String(description)}</p></div>
                  <button
                    className={cn("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition", enabled ? "bg-neutral-950" : "bg-neutral-200")}
                    onClick={() => (onChange as (value: boolean) => void)(!enabled)}
                    aria-label={`切换 ${String(label)}`}
                    aria-pressed={Boolean(enabled)}
                  >
                    <span className={cn("size-6 rounded-full bg-white shadow-sm transition", enabled && "translate-x-6")} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {neteaseAccount?.connected && (
                <p className="flex items-center gap-2 text-sm text-neutral-600"><CheckCircle2 className="size-4 text-emerald-600" />网易云音乐：{neteaseAccount.nickname ?? "已登录"}</p>
              )}
              {qqAccount?.connected && (
                <p className="flex items-center gap-2 text-sm text-neutral-600"><CheckCircle2 className="size-4 text-emerald-600" />QQ 音乐：{qqAccount.nickname ?? "已登录"}</p>
              )}
              {bilibiliAccount?.connected && (
                <p className="flex items-center gap-2 text-sm text-neutral-600"><CheckCircle2 className="size-4 text-emerald-600" />B站：{bilibiliAccount.nickname ?? "已登录"}</p>
              )}
              {!neteaseAccount?.connected && !qqAccount?.connected && !bilibiliAccount?.connected && (
                <p className="text-sm text-neutral-500">还没有登录在线音源，随时可以在右上角或设置里连接。</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button className="text-sm text-neutral-500 transition hover:text-neutral-950" onClick={finish}>稍后设置</button>
          <Button onClick={() => (step < 3 ? setStep((value) => value + 1) : finish())}>
            {step < 3 ? "继续" : "完成"}
            {step < 3 ? <ArrowRight /> : <CheckCircle2 />}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

type RemoteAccessInfo = {
  enabled: boolean;
  token: string;
  port: number;
  addresses: string[];
};

function RemoteAccessSettings() {
  const desktopReady = typeof window !== "undefined" && Boolean(window.ariaDesktop?.getRemoteAccess);
  const [info, setInfo] = useState<RemoteAccessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "address" | null>(null);

  useEffect(() => {
    let mounted = true;
    window.ariaDesktop
      ?.getRemoteAccess?.()
      .then((value) => {
        if (mounted) setInfo(value);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const pairingPayload = useMemo(() => {
    if (!info?.enabled || !info.addresses.length) return null;
    return JSON.stringify({
      app: "aria",
      version: 1,
      urls: info.addresses.map((address) => `http://${address}:${info.port}`),
      token: info.token,
    });
  }, [info?.enabled, info?.addresses, info?.port, info?.token]);

  useEffect(() => {
    if (!pairingPayload) {
      setQrDataUrl(null);
      return;
    }
    let mounted = true;
    QRCode.toDataURL(pairingPayload, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {
        if (mounted) setQrDataUrl(null);
      });
    return () => {
      mounted = false;
    };
  }, [pairingPayload]);

  if (!desktopReady) return null;

  async function toggleRemoteAccess() {
    if (!info || busy) return;
    setBusy(true);
    setRestarting(true);
    try {
      const updated = await window.ariaDesktop?.setRemoteAccess?.(!info.enabled);
      if (updated) {
        setInfo((current) => ({
          enabled: updated.enabled,
          token: updated.token,
          port: current?.port ?? 3636,
          addresses: current?.addresses ?? [],
        }));
      }
    } finally {
      setBusy(false);
      window.setTimeout(() => setRestarting(false), 2600);
    }
  }

  async function copyText(text: string, kind: "token" | "address") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard may be unavailable; the text remains selectable.
    }
  }

  const enabled = Boolean(info?.enabled);
  const firstAddress = info?.addresses[0] ? `http://${info.addresses[0]}:${info.port}` : null;

  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">手机远程访问</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            开启后，同一局域网内的 Aria 手机版可连接此电脑同步歌单与本地曲库（令牌明文传输，请仅在家用可信网络使用）。
          </p>
        </div>
        <SettingSwitch
          checked={enabled}
          onToggle={() => void toggleRemoteAccess()}
          ariaLabel="切换手机远程访问"
          disabled={busy || !info}
        />
      </div>

      {!info && <p className="mt-2.5 text-xs text-neutral-400">读取远程访问状态…</p>}

      {info && restarting && (
        <p className="mt-2.5 flex items-center gap-2 text-xs text-sky-700">
          <RefreshCw className="size-3.5 animate-spin" />
          后端正在以新配置重启，约 2 秒后生效…
        </p>
      )}

      {info && enabled && (
        <div className="settings-inline-well mt-3 grid gap-4 rounded-xl p-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-2">
            {info.addresses.length === 0 && (
              <p className="settings-status-banner rounded-lg px-3 py-2 text-xs">没有检测到局域网地址，请确认电脑已连接网络。</p>
            )}
            {info.addresses.map((address) => (
              <button
                key={address}
                type="button"
                onClick={() => copyText(`http://${address}:${info.port}`, "address")}
                className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/75 px-3 py-2 text-left transition hover:bg-white"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] text-neutral-400">服务器地址（点击复制）</span>
                  <span className="mt-0.5 block truncate font-mono text-xs font-medium text-neutral-900">http://{address}:{info.port}</span>
                </span>
                {copied === "address" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0 text-neutral-400" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => copyText(info.token, "token")}
              className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/75 px-3 py-2 text-left transition hover:bg-white"
            >
              <span className="min-w-0">
                <span className="block text-[11px] text-neutral-400">连接令牌（点击复制）</span>
                <span className="mt-0.5 block truncate font-mono text-xs font-medium text-neutral-900">{info.token}</span>
              </span>
              {copied === "token" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0 text-neutral-400" />}
            </button>
          </div>
          <div className="flex items-center justify-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Aria 手机连接二维码" className="settings-qr-box size-32 rounded-xl" draggable={false} />
            ) : (
              <div className="flex size-32 items-center justify-center rounded-xl bg-white/70 text-xs text-neutral-400">二维码生成中…</div>
            )}
          </div>
        </div>
      )}

      {info && !enabled && firstAddress && (
        <p className="mt-2 font-mono text-xs text-neutral-400">{firstAddress} · 当前仅本机可访问</p>
      )}
    </div>
  );
}








/** QQ Music source row: QR/cookie login + live account state from /api/sources/qq. */
function QqSourceCard({ onAccountChange, embedded = false }: { onAccountChange?: () => void; embedded?: boolean }) {
  const [account, setAccount] = useState<SourceAccountSummary | null>(null);
  const [hasStoredCookie, setHasStoredCookie] = useState(false);
  const [cookie, setCookie] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState("点击扫码登录，用手机 QQ 扫描二维码。");
  const [qrLogin, setQrLogin] = useState<{ key: string; image: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrRestartsRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    api
      .getSourceAccount("qq")
      .then((result) => {
        if (mounted) setAccount(result.account);
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    api
      .getSettings()
      .then((settings) => {
        if (mounted) setHasStoredCookie(Boolean(settings.hasQqCookie));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  async function startQrLogin() {
    setQrLoading(true);
    setMessage(null);
    try {
      const started = await api.startQqQrLogin();
      setQrLogin({ key: started.key, image: started.qrImage });
      setLoginStatus("请用手机 QQ 扫描二维码，并在手机上确认登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "二维码获取失败，请稍后重试");
    } finally {
      setQrLoading(false);
    }
  }

  // The QR session lives on the server; poll it until it is confirmed, expires,
  // or the card unmounts.
  useEffect(() => {
    if (!qrLogin) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api
        .checkQqQrLogin(qrLogin.key)
        .then((result) => {
          if (cancelled) return;
          if (result.status === "scanned") {
            setLoginStatus("已扫码，请在手机上确认登录。");
            return;
          }
          if (result.status === "waiting") return;
          window.clearInterval(timer);
          setQrLogin(null);
          if (result.status === "success" && result.account) {
            qrRestartsRef.current = 0;
            setAccount(result.account);
            setHasStoredCookie(true);
            onAccountChange?.();
            setLoginStatus(
              result.account.connected
                ? "登录成功，账号信息已同步。"
                : "已获取登录凭证，但资料接口暂未返回账号信息。",
            );
            setMessage(
              result.account.connected
                ? `已登录：${result.account.nickname ?? "QQ 音乐账号"}`
                : "登录凭证已保存，可稍后重新打开账号面板查看",
            );
          } else if (result.status === "expired" && qrRestartsRef.current < 2) {
            // Regenerate silently a couple of times so a card left open keeps
            // offering a scannable code instead of dying after 2 minutes.
            qrRestartsRef.current += 1;
            setLoginStatus("二维码已过期，正在自动刷新…");
            void startQrLogin();
          } else {
            setLoginStatus(result.message);
            setMessage(result.status === "expired" ? "二维码已失效，请重新获取" : result.message);
          }
        })
        .catch(() => {
          // Transient poll failures are expected while the QR is pending.
        });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrLogin]);

  async function saveCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveQqCookie(cookie.trim());
      setAccount(result.account);
      setHasStoredCookie(true);
      onAccountChange?.();
      setCookie("");
      setShowInput(false);
      setMessage(result.account.connected ? "QQ 音乐 Cookie 已保存并登录" : "Cookie 已保存，但登录状态未确认");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.clearQqCookie();
      setAccount(result.account);
      setHasStoredCookie(false);
      onAccountChange?.();
      setQrLogin(null);
      setLoginStatus("已退出 QQ 音乐，可随时重新扫码登录。");
      setMessage("已退出 QQ 音乐账号");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn(embedded ? "rounded-2xl bg-white/55 p-4" : "py-4")}>
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 shadow-xs">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={160} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <SourceLogo source="qq" className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">QQ 音乐</span>
              <span className={cn("text-xs font-medium", account?.connected ? "text-emerald-600" : "text-neutral-400")}>
                {account?.connected ? (account.nickname ?? "已登录") : hasStoredCookie ? "登录已过期" : "未登录"}
              </span>
            </div>
            {!embedded && <SourceToggle sourceId="qq" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void startQrLogin()} disabled={qrLoading || saving}>
              <QrCode />
              {qrLoading ? "生成中" : qrLogin ? "重新获取二维码" : "扫码登录"}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowInput((value) => !value)}>
              <Cookie />
              Cookie 备用绑定
            </Button>
            {account?.connected && (
              <Button size="sm" variant="subtle" onClick={() => void logout()} disabled={saving}>
                <LogOut />
                退出登录
              </Button>
            )}
          </div>
        </div>
      </div>
      {qrLogin && (
        <div className="settings-inline-well mt-3 flex items-center gap-3 rounded-xl p-3">
          <img
            src={qrLogin.image}
            alt="QQ 音乐登录二维码"
            width={120}
            height={120}
            className="settings-qr-box size-[120px] rounded-xl object-contain"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-700">手机 QQ 扫码</p>
            <p className="mt-1">{loginStatus}</p>
            <p className="mt-1 text-neutral-400">二维码会通过本机服务端轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showInput && (
        <div className="settings-inline-well mt-3 rounded-xl p-3">
          <label className="text-xs font-medium text-neutral-600" htmlFor="qq-cookie">
            QQ 音乐 Cookie
          </label>
          <textarea
            id="qq-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={3}
            placeholder="uin=o...; qqmusic_key=...; ..."
            className="settings-input mt-2 w-full resize-none rounded-lg p-2.5 text-xs outline-none"
          />
          <div className="mt-2.5 flex justify-end">
            <Button size="sm" onClick={() => void saveCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="settings-status-banner mt-2.5 rounded-lg px-3 py-1.5 text-xs">{message}</p>}
    </div>
  );
}

function BilibiliDefaultQualityControls({
  defaultVideoQn = 120,
  onDefaultVideoQnChange,
  defaultAudioLevel = "hires",
  onDefaultAudioLevelChange,
  className,
}: {
  defaultVideoQn?: BilibiliDefaultVideoQn;
  onDefaultVideoQnChange?: (qn: BilibiliDefaultVideoQn) => void;
  defaultAudioLevel?: BilibiliDefaultAudioLevel;
  onDefaultAudioLevelChange?: (level: BilibiliDefaultAudioLevel) => void;
  className?: string;
}) {
  if (!onDefaultVideoQnChange && !onDefaultAudioLevelChange) return null;
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {onDefaultVideoQnChange && (
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">B站默认画质</p>
          <p className="mt-0.5 text-xs text-neutral-500">切到 B站 MV 时默认优先请求的清晰度</p>
          <AriaSelect
            ariaLabel="B站默认画质"
            size="sm"
            className="mt-2 w-full"
            value={String(defaultVideoQn)}
            onChange={(value) => onDefaultVideoQnChange(Number(value) as BilibiliDefaultVideoQn)}
            options={bilibiliVideoQualityOptions}
          />
        </div>
      )}
      {onDefaultAudioLevelChange && (
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">B站默认音质</p>
          <p className="mt-0.5 text-xs text-neutral-500">播放 B站音频与 MV 音轨时的首选档位</p>
          <AriaSelect
            ariaLabel="B站默认音质"
            size="sm"
            className="mt-2 w-full"
            value={defaultAudioLevel}
            onChange={(value) => onDefaultAudioLevelChange(value as BilibiliDefaultAudioLevel)}
            options={bilibiliAudioQualityOptions}
          />
        </div>
      )}
    </div>
  );
}

/** Bilibili source row: QR/cookie login + live account state from /api/sources/bilibili. */
function BilibiliSourceCard({
  onAccountChange,
  embedded = false,
}: {
  onAccountChange?: () => void;
  embedded?: boolean;
}) {
  const [account, setAccount] = useState<SourceAccountSummary | null>(null);
  const [hasStoredCookie, setHasStoredCookie] = useState(false);
  const [cookie, setCookie] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState("扫码登录后可同步「Aria」收藏夹和「我的收藏夹」歌单，登录状态下视频清晰度更高。");
  const [qrLogin, setQrLogin] = useState<{ key: string; image: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .getSourceAccount("bilibili")
      .then((result) => {
        if (mounted) setAccount(result.account);
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    api
      .getSettings()
      .then((settings) => {
        if (mounted) setHasStoredCookie(Boolean(settings.hasBilibiliCookie));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  async function startQrLogin() {
    setQrLoading(true);
    setMessage(null);
    try {
      const started = await api.startSourceQrLogin("bilibili");
      setQrLogin({ key: started.key, image: started.qrImage });
      setLoginStatus("请用哔哩哔哩手机客户端扫描二维码，并在手机上确认登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "二维码获取失败，请稍后重试");
    } finally {
      setQrLoading(false);
    }
  }

  useEffect(() => {
    if (!qrLogin) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api
        .checkSourceQrLogin("bilibili", qrLogin.key)
        .then((result) => {
          if (cancelled) return;
          if (result.status === "scanned") {
            setLoginStatus("已扫码，请在手机上确认登录。");
            return;
          }
          if (result.status === "waiting") return;
          window.clearInterval(timer);
          setQrLogin(null);
          if (result.status === "success" && result.account) {
            setAccount(result.account);
            setHasStoredCookie(true);
            onAccountChange?.();
            setLoginStatus("登录成功，B站收藏已同步。");
            setMessage(`已登录：${result.account.nickname ?? "B站账号"}`);
          } else {
            setLoginStatus(result.message);
            setMessage(result.status === "expired" ? "二维码已失效，请重新获取" : result.message);
          }
        })
        .catch(() => {
          // Transient poll failures are expected while the QR is pending.
        });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrLogin]);

  async function saveCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveSourceCookie("bilibili", cookie.trim());
      setAccount(result.account);
      setHasStoredCookie(true);
      onAccountChange?.();
      setCookie("");
      setShowInput(false);
      setMessage(result.account.connected ? "B站 Cookie 已保存并登录" : "Cookie 已保存，但登录状态未确认");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.clearSourceCookie("bilibili");
      setAccount(result.account);
      setHasStoredCookie(false);
      onAccountChange?.();
      setQrLogin(null);
      setLoginStatus("已退出B站，可随时重新扫码登录。");
      setMessage("已退出B站账号");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn(embedded ? "rounded-2xl bg-white/55 p-4" : "py-4")}>
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 shadow-xs">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={160} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <SourceLogo source="bilibili" className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">哔哩哔哩</span>
              <span className={cn("text-xs font-medium", account?.connected ? "text-emerald-600" : "text-neutral-400")}>
                {account?.connected ? (account.nickname ?? "已登录") : hasStoredCookie ? "登录已过期" : "未登录"}
              </span>
            </div>
            {!embedded && <SourceToggle sourceId="bilibili" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void startQrLogin()} disabled={qrLoading || saving}>
              <QrCode />
              {qrLoading ? "生成中" : qrLogin ? "重新获取二维码" : "扫码登录"}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowInput((value) => !value)}>
              <Cookie />
              Cookie 备用绑定
            </Button>
            {account?.connected && (
              <Button size="sm" variant="subtle" onClick={() => void logout()} disabled={saving}>
                <LogOut />
                退出登录
              </Button>
            )}
          </div>
        </div>
      </div>
      {qrLogin && (
        <div className="settings-inline-well mt-3 flex items-center gap-3 rounded-xl p-3">
          <img
            src={qrLogin.image}
            alt="B站登录二维码"
            width={120}
            height={120}
            className="settings-qr-box size-[120px] rounded-xl object-contain"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-700">哔哩哔哩手机客户端扫码</p>
            <p className="mt-1">{loginStatus}</p>
            <p className="mt-1 text-neutral-400">二维码由本机服务端生成与轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showInput && (
        <div className="settings-inline-well mt-3 rounded-xl p-3">
          <label className="text-xs font-medium text-neutral-600" htmlFor="bilibili-cookie">
            B站 Cookie
          </label>
          <textarea
            id="bilibili-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={3}
            placeholder="SESSDATA=...; bili_jct=...; DedeUserID=..."
            className="settings-input mt-2 w-full resize-none rounded-lg p-2.5 text-xs outline-none"
          />
          <div className="mt-2.5 flex justify-end">
            <Button size="sm" onClick={() => void saveCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="settings-status-banner mt-2.5 rounded-lg px-3 py-1.5 text-xs">{message}</p>}
    </div>
  );
}

const SOURCE_SWITCH_LABELS: Record<"netease" | "qq" | "bilibili" | "youtube", string> = {
  netease: "网易云音乐",
  qq: "QQ 音乐",
  bilibili: "哔哩哔哩",
  youtube: "YouTube Music",
};

/**
 * Per-source switch. Turning a source off keeps its login state but stops
 * Aria from sending it any search/stream request, which is the fastest way to
 * silence an upstream outage without restarting the app.
 */
function SourceToggle({ sourceId }: { sourceId: "netease" | "qq" | "bilibili" | "youtube" }) {
  const [enabled, setEnabled] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .listSources()
      .then((result) => {
        if (!alive) return;
        const source = result.sources.find((item) => item.id === sourceId);
        if (source) setEnabled(source.enabled !== false);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sourceId]);

  async function toggle() {
    const next = !enabled;
    setPending(true);
    setEnabled(next);
    try {
      const result = await api.setSourceEnabled(sourceId, next);
      const source = result.sources.find((item) => item.id === sourceId);
      if (source) setEnabled(source.enabled !== false);
    } catch {
      setEnabled(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingSwitch
      checked={enabled}
      onToggle={() => void toggle()}
      ariaLabel={`切换 ${SOURCE_SWITCH_LABELS[sourceId]} 音源`}
      disabled={pending}
    />
  );
}

/**
 * YouTube Music 源卡片：匿名搜索/播放（无账号登录），可选配置 HTTP 代理端口。
 * 代理只作用于 YouTube 的搜索、播放解析、封面与音频流；网易云 / QQ / B站
 * 永远直连，国内使用体验不受影响。
 */
function YoutubeSourceCard({ onAccountChange, embedded = false }: { onAccountChange?: () => void; embedded?: boolean } = {}) {
  const [proxy, setProxy] = useState("");
  const [savedProxy, setSavedProxy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [account, setAccount] = useState<SourceAccountSummary | null>(null);
  const [hasStoredCookie, setHasStoredCookie] = useState(false);
  const [cookie, setCookie] = useState("");
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (!mounted) return;
        const stored = settings.youtubeProxy ?? null;
        setSavedProxy(stored);
        setProxy(stored ?? "");
        setHasStoredCookie(Boolean(settings.hasYoutubeCookie));
      })
      .catch(() => undefined);
    api
      .getSourceAccount("youtube")
      .then((result) => {
        if (mounted) setAccount(result.account);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  function applySavedProxyState(normalized: string | null) {
    setSavedProxy(normalized);
    setProxy(normalized ?? "");
  }

  async function saveProxy(clear: boolean) {
    const value = clear ? "" : proxy.trim();
    if (!clear && !value) {
      setMessage("请先填写代理端口，例如 7890");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveYoutubeProxy(value);
      const normalized = result.youtubeProxy ?? null;
      applySavedProxyState(normalized);
      setMessage(normalized ? "代理已保存" : "已恢复直连");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function syncDraftProxy(): Promise<{ ok: boolean; activeProxy: string }> {
    const draft = proxy.trim();
    const current = savedProxy ?? "";
    if (draft === current) {
      return { ok: true, activeProxy: current };
    }
    setMessage(draft ? "正在保存代理端口…" : "正在清除代理并切换为直连…");
    try {
      const result = await api.saveYoutubeProxy(draft);
      const normalized = result.youtubeProxy ?? null;
      applySavedProxyState(normalized);
      if (draft && !normalized) {
        setMessage("代理格式不正确，请填写端口（如 7890）后重试");
        return { ok: false, activeProxy: "" };
      }
      return { ok: true, activeProxy: normalized ?? "" };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "代理保存失败，请稍后重试");
      return { ok: false, activeProxy: "" };
    }
  }

  async function saveCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveSourceCookie("youtube", cookie.trim());
      setAccount(result.account);
      setHasStoredCookie(true);
      setCookie("");
      setShowCookieInput(false);
      onAccountChange?.();
      window.dispatchEvent(new Event("aria-sources-changed"));
      setMessage(
        result.account.connected
          ? `已登录：${result.account.nickname ?? "YouTube 账号"}`
          : "Cookie 已保存，但登录状态未确认",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.clearSourceCookie("youtube");
      setAccount(result.account);
      setHasStoredCookie(false);
      onAccountChange?.();
      window.dispatchEvent(new Event("aria-sources-changed"));
      setMessage("已退出 YouTube 登录");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage(null);
    try {
      const synced = await syncDraftProxy();
      if (!synced.ok) return;
      const result = await api.searchSource("youtube", "hello world", "tracks", 1);
      setMessage(
        result.tracks.length
          ? "连接正常，已成功返回搜索结果。"
          : "连接成功，但搜索没有返回歌曲，请换个关键词再试。",
      );
    } catch (error) {
      setMessage(
        `连接失败：${error instanceof Error ? error.message : "未知错误"}。若未配置代理，可在上方填写代理端口。`,
      );
    } finally {
      setTesting(false);
    }
  }

  // 窗口登录（主路径）：应用内打开真实 Chromium 窗口登录 Google 账号，
  // 成功后自动提取会话 Cookie；若个别网络环境受限可使用下方 Cookie 备用绑定。
  async function loginInWindow() {
    const openLoginWindow = window.ariaDesktop?.youtubeLoginWindow;
    if (!openLoginWindow) {
      setMessage("窗口登录仅在桌面安装版可用；浏览器模式请使用 Cookie 备用绑定。");
      return;
    }
    // 输入框有修改或与已保存值不一致时先保存再开窗，确保登录窗口使用最新代理。
    setLoginLoading(true);
    setMessage(null);
    const synced = await syncDraftProxy();
    if (!synced.ok) {
      setLoginLoading(false);
      return;
    }
    setMessage(null);
    try {
      const result = await openLoginWindow(synced.activeProxy);
      if (!result.ok || !result.cookie) {
        setMessage(result.message || "登录窗口已关闭，未完成登录。");
        return;
      }
      const saved = await api.saveSourceCookie("youtube", result.cookie);
      setAccount(saved.account);
      setHasStoredCookie(true);
      onAccountChange?.();
      window.dispatchEvent(new Event("aria-sources-changed"));
      setMessage(
        saved.account.connected
          ? `已登录：${saved.account.nickname ?? "YouTube 账号"}，歌单与我喜欢已可同步。`
          : "已捕获登录会话，正在确认登录状态…",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "窗口登录失败，请稍后重试");
    } finally {
      setLoginLoading(false);
    }
  }

  const loginStatusText = account?.connected
    ? `${account.nickname ?? "YouTube 用户"}${account.userId ? ` · ${account.userId}` : ""}`
    : hasStoredCookie
      ? "登录未确认"
      : "未登录";

  return (
    <div className={cn(embedded ? "rounded-2xl bg-white/55 p-4" : "py-4")}>
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 shadow-xs">
          {account?.avatarUrl && account.connected ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={160} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <SourceLogo source="youtube" className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">YouTube Music</span>
              <span className={cn("text-xs font-medium", account?.connected ? "text-emerald-600" : "text-neutral-400")}>
                {loginStatusText}
              </span>
              <span className="text-xs text-neutral-400">· {savedProxy ? `代理 ${savedProxy}` : "直连"}</span>
            </div>
            {!embedded && <SourceToggle sourceId="youtube" />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={proxy}
              onChange={(event) => {
                setProxy(event.target.value);
                if (message) setMessage(null);
              }}
              placeholder="代理端口，如 7890 或 127.0.0.1:7890"
              aria-label="YouTube 代理端口"
              maxLength={200}
              className="settings-input min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            />
            <Button size="sm" onClick={() => void saveProxy(false)} disabled={saving}>
              {saving ? "保存中" : "保存代理"}
            </Button>
            {savedProxy && (
              <Button size="sm" variant="subtle" onClick={() => void saveProxy(true)} disabled={saving}>
                清除
              </Button>
            )}
            <Button size="sm" variant="subtle" onClick={() => void testConnection()} disabled={testing}>
              {testing ? "测试中" : "测试连接"}
            </Button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {typeof window !== "undefined" && window.ariaDesktop?.youtubeLoginWindow && (
              <Button size="sm" onClick={() => void loginInWindow()} disabled={loginLoading || saving}>
                <LogIn />
                {loginLoading ? "等待登录…" : "窗口登录"}
              </Button>
            )}
            <Button size="sm" variant="subtle" onClick={() => setShowCookieInput((value) => !value)}>
              <Cookie />
              Cookie 备用绑定
            </Button>
            {account?.connected && (
              <Button size="sm" variant="subtle" onClick={() => void logout()} disabled={saving}>
                <LogOut />
                退出登录
              </Button>
            )}
          </div>
          {loginLoading && (
            <p className="settings-status-banner mt-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed">
              已打开 YouTube 登录窗口：像平时一样登录 Google 账号即可，登录成功后 Aria 会自动完成绑定。
              {!savedProxy && " 未配置代理时可能无法打开登录页，建议先在上方填写代理端口。"}
            </p>
          )}
          {showCookieInput && (
            <div className="settings-inline-well mt-3 rounded-xl p-3">
              <p className="text-xs leading-relaxed text-neutral-500">
                备用方式：在已登录 YouTube 的浏览器标签页打开开发者工具 → Network，任选一个 music.youtube.com 请求，把完整 Cookie 头粘贴到这里。
              </p>
              <textarea
                value={cookie}
                onChange={(event) => {
                  setCookie(event.target.value);
                  if (message) setMessage(null);
                }}
                placeholder="SID=…; HSID=…; SSID=…; SAPISID=…"
                aria-label="YouTube Cookie"
                rows={3}
                maxLength={20_000}
                className="settings-input mt-2 block w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowCookieInput(false)}>取消</Button>
                <Button size="sm" onClick={() => void saveCookie()} disabled={saving || !cookie.trim()}>
                  {saving ? "保存中" : "保存并登录"}
                </Button>
              </div>
            </div>
          )}
          {message && (
            <p role="status" className="settings-status-banner mt-2.5 rounded-lg px-3 py-2 text-xs">{message}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const BACKUP_MODULE_LABELS: Array<{ key: BackupModuleKey; label: string }> = [
  { key: "eqPresets", label: "EQ 预设" },
  { key: "playlists", label: "自建歌单与 Super 混合" },
  { key: "preferences", label: "外观与音频偏好" },
  { key: "desktopLyrics", label: "桌面歌词设置" },
];

function BackupRoamingCard({
  onBuildSnapshot,
  onApplySnapshot,
  onOpenPrivateCloud,
}: {
  onBuildSnapshot?: (modules: BackupModuleKey[]) => AriaBackupSnapshot;
  onApplySnapshot?: (
    snapshot: AriaBackupSnapshot,
    strategy: BackupMergeStrategy,
    modules: BackupModuleKey[],
  ) => { summary: string };
  onOpenPrivateCloud?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedModules, setSelectedModules] = useState<BackupModuleKey[]>([
    "eqPresets",
    "playlists",
    "preferences",
    "desktopLyrics",
  ]);
  const [strategy, setStrategy] = useState<BackupMergeStrategy>("merge");
  const [webdavInstances, setWebdavInstances] = useState<PrivateCloudInstancePublic[]>([]);
  const [selectedWebdavId, setSelectedWebdavId] = useState("");
  const [remotePath, setRemotePath] = useState("/Aria/.aria-backup.json");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .listPrivateCloudInstances()
      .then((res) => {
        if (!mounted) return;
        const list = (res.instances ?? []).filter((item) => item.kind === "webdav");
        setWebdavInstances(list);
        if (list.length && !selectedWebdavId) {
          setSelectedWebdavId(list[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
    // Only load WebDAV targets on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!onBuildSnapshot || !onApplySnapshot) return null;

  function toggleModule(key: BackupModuleKey) {
    setSelectedModules((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  function handleExportFile() {
    if (!selectedModules.length) {
      setStatus({ kind: "error", text: "请至少选择一个备份模块。" });
      return;
    }
    const snapshot = onBuildSnapshot!(selectedModules);
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `aria-backup-${stamp}.aria-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ kind: "ok", text: "已生成并下载 .aria-backup.json（已自动剥离凭据与密码）。" });
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!selectedModules.length) {
      setStatus({ kind: "error", text: "请至少选择一个要恢复的模块。" });
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseAndValidateBackup(text);
      const res = onApplySnapshot!(parsed, strategy, selectedModules);
      setStatus({ kind: "ok", text: `本地导入完成：${res.summary}` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "备份文件解析失败" });
    } finally {
      setBusy(false);
    }
  }

  async function handleWebdavPush() {
    if (!selectedWebdavId || !selectedModules.length) {
      setStatus({ kind: "error", text: "请先选择 WebDAV 实例并至少勾选一个模块。" });
      return;
    }
    setBusy(true);
    try {
      const snapshot = onBuildSnapshot!(selectedModules);
      const res = await api.pushWebdavBackup(selectedWebdavId, remotePath.trim() || "/Aria/.aria-backup.json", snapshot);
      setStatus({ kind: "ok", text: `已同步至 WebDAV（${res.remotePath}，${(res.bytes / 1024).toFixed(1)} KB）。` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "同步到 WebDAV 失败" });
    } finally {
      setBusy(false);
    }
  }

  async function handleWebdavPull() {
    if (!selectedWebdavId || !selectedModules.length) {
      setStatus({ kind: "error", text: "请先选择 WebDAV 实例并至少勾选一个模块。" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.pullWebdavBackup(selectedWebdavId, remotePath.trim() || "/Aria/.aria-backup.json");
      const parsed = parseAndValidateBackup(res.snapshot);
      const applied = onApplySnapshot!(parsed, strategy, selectedModules);
      setStatus({ kind: "ok", text: `已从 WebDAV 恢复：${applied.summary}` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "从 WebDAV 拉取失败" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">配置备份与 WebDAV 漫游</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            跨设备同步 EQ 预设、歌单与界面偏好；白名单严格导出，绝不包含 Cookie、私有云密码或 Token。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.aria-backup.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
          />
          <Button size="sm" variant="subtle" onClick={handleExportFile} disabled={busy}>
            <Download />
            导出配置
          </Button>
          <Button size="sm" variant="subtle" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <Upload />
            导入配置
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {BACKUP_MODULE_LABELS.map((item) => {
          const active = selectedModules.includes(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleModule(item.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950"
                  : "border-black/10 bg-white/70 text-neutral-600 hover:bg-neutral-100 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300",
              )}
            >
              {item.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1 rounded-full bg-black/[0.04] p-0.5 text-xs dark:bg-white/[0.06]">
          <button
            type="button"
            onClick={() => setStrategy("merge")}
            className={cn(
              "rounded-full px-2.5 py-1 transition",
              strategy === "merge" ? "bg-white font-medium text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-white" : "text-neutral-500",
            )}
          >
            增量合并
          </button>
          <button
            type="button"
            onClick={() => setStrategy("overwrite")}
            className={cn(
              "rounded-full px-2.5 py-1 transition",
              strategy === "overwrite" ? "bg-white font-medium text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-white" : "text-neutral-500",
            )}
          >
            覆盖替换
          </button>
        </div>
      </div>

      <div className="settings-inline-well mt-3 rounded-xl p-3">
        {webdavInstances.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <AriaSelect
              value={selectedWebdavId}
              onChange={(value) => setSelectedWebdavId(value)}
              options={webdavInstances.map((inst) => ({ value: inst.id, label: inst.name }))}
              className="min-w-[150px]"
            />
            <input
              value={remotePath}
              onChange={(event) => setRemotePath(event.target.value)}
              placeholder="/Aria/.aria-backup.json"
              aria-label="WebDAV 备份路径"
              className="settings-input min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            />
            <Button size="sm" onClick={() => void handleWebdavPush()} disabled={busy}>
              <Cloud />
              上传漫游
            </Button>
            <Button size="sm" variant="subtle" onClick={() => void handleWebdavPull()} disabled={busy}>
              <RefreshCw />
              云端恢复
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>尚未添加 WebDAV 私有云实例，添加后可一键云端漫游备份。</span>
            {onOpenPrivateCloud && (
              <Button size="sm" variant="subtle" onClick={onOpenPrivateCloud}>
                <Cloud />
                添加 WebDAV 实例
              </Button>
            )}
          </div>
        )}
      </div>

      {status && (
        <p
          role="status"
          className={cn(
            "settings-status-banner mt-2.5 rounded-lg px-3 py-2 text-xs",
            status.kind === "error" && "text-rose-600 dark:text-rose-400",
          )}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
