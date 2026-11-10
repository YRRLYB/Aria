import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Cookie, Copy, Download, FolderPlus, FolderSearch, Globe, Keyboard, LogIn, LogOut, Monitor, Moon, QrCode, Radio, RefreshCw, RotateCcw, Settings2, Smartphone, Sparkles, Sun, Trash2, UserRound, Volume2, X } from "lucide-react";
import QRCode from "qrcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/music/shared";
import { api, type ApiLibraryWatchState, type NeteaseAccountSummary, type NeteaseQrStart, type SourceAccountSummary, type SourceManifestInfo, type UpdateState } from "@/lib/api";
import { SourceLogo, type SourceLogoOption } from "@/components/music/SourceLogos";
import type { NativeAudioState } from "@/lib/audioTypes";
import type { AudioOutputMode } from "@/lib/playerPresentation";
import { ariaThemeOptions, type AriaTheme } from "@/lib/theme";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  shortcutDefinitions,
  shortcutFromKeyboardEvent,
  shortcutsConflict,
  type KeyboardShortcuts,
  type ShortcutCommand,
} from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { ArtworkImage } from "./ArtworkImage";

function SourceEnableCard() {
  const [sources, setSources] = useState<SourceManifestInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.listSources()
      .then((result) => { if (alive) setSources(result.sources); })
      .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "读取播放源失败"); });
    return () => { alive = false; };
  }, []);

  async function toggle(source: SourceManifestInfo, enabled: boolean) {
    setSources((current) => current.map((item) => item.id === source.id ? { ...item, enabled } : item));
    try {
      const result = await api.setSourceEnabled(source.id, enabled);
      setSources(result.sources);
      window.dispatchEvent(new Event("aria-sources-changed"));
      setError(null);
    } catch (reason) {
      setSources((current) => current.map((item) => item.id === source.id ? { ...item, enabled: source.enabled } : item));
      setError(reason instanceof Error ? reason.message : "切换播放源失败");
    }
  }

  return (
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Sources</p>
        <h3 className="mt-1 text-base font-semibold">播放源启用</h3>
        <p className="mt-1 text-xs text-neutral-500">关闭的源不会出现在搜索里，也不会发起网络请求。</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {sources.map((source) => {
          const enabled = source.enabled !== false;
          const labels = [
            source.capabilities.playback ? "播放" : null,
            source.capabilities.lyrics ? "歌词" : null,
            source.capabilities.videoPlayback ? "视频" : null,
            source.capabilities.account ? "账号" : null,
          ].filter(Boolean).join(" · ");
          return (
            <div key={source.id} className="flex items-center gap-3 rounded-xl border border-white/70 bg-white/70 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
                <SourceLogo source={source.id as SourceLogoOption} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{source.name}</p>
                <p className="truncate text-[11px] text-neutral-500">{labels || "基础播放"}{source.unavailableUntil ? " · 暂时不可用" : ""}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={`切换 ${source.name}`}
                aria-checked={enabled}
                onClick={() => void toggle(source, !enabled)}
                className={cn("relative h-6 w-11 shrink-0 rounded-full bg-neutral-200 transition", enabled && "bg-neutral-950")}
              >
                <span className={cn("absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition", enabled && "translate-x-5")} />
              </button>
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-rose-500">{error}</p>}
    </section>
  );
}

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

  if (!window.ariaDesktop?.updates) {
    return (
      <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Update</p>
        <h3 className="mt-1 text-base font-semibold">版本与更新</h3>
        <p className="mt-2 text-sm text-neutral-500">当前是浏览器模式；桌面安装包支持检查更新。</p>
      </section>
    );
  }

  const statusText = (() => {
    if (!state) return "正在读取更新状态…";
    if (state.status === "checking") return "正在检查更新…";
    if (state.status === "available") return `发现新版本 ${state.availableVersion ?? ""}`;
    if (state.status === "downloading") return `正在下载${state.percent != null ? ` ${Math.round(state.percent)}%` : "…"}`;
    if (state.status === "downloaded") return "更新已下载，重启 Aria 后安装。";
    if (state.status === "up-to-date") return "已经是最新版本。";
    if (state.status === "error") return state.error ?? "检查更新失败";
    if (state.status === "unsupported") return state.reason ?? "当前平台不支持自动更新";
    return "尚未检查更新";
  })();

  return (
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Update</p>
          <h3 className="mt-1 text-base font-semibold">版本与更新</h3>
          <p className="mt-1 text-sm text-neutral-500">当前版本 {state?.currentVersion ?? "—"} · {statusText}</p>
          {state?.releaseNotes && <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-line rounded-xl bg-white/70 p-3 text-xs text-neutral-500">{state.releaseNotes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="glass" disabled={busy || !state?.supported || state.status === "downloading"} onClick={() => void run(() => window.ariaDesktop!.updates!.check())}>
            <RefreshCw className={cn((busy || state?.status === "checking") && "animate-spin")} />
            检查更新
          </Button>
          {state?.status === "available" && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.download())}>
              <Download />下载 {state.availableVersion}
            </Button>
          )}
          {state?.status === "downloaded" && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ariaDesktop!.updates!.install())}>
              重启并安装
            </Button>
          )}
        </div>
      </div>
      {state?.status === "downloading" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-neutral-950 transition-all" style={{ width: `${Math.max(0, Math.min(100, state.percent ?? 0))}%` }} />
        </div>
      )}
    </section>
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
  onNeteaseAccountChange,
  onSourceAccountChange,
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
  /** Fired after NetEase signs in or out from Settings so the header can refresh. */
  onNeteaseAccountChange?: (account: NeteaseAccountSummary) => void;
  /** Fired after a non-NetEase source account changes so the header can refresh. */
  onSourceAccountChange?: () => void;
  onClose: () => void;
}) {
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const desktopReady = Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);
  // macOS reaches the native engine through a Homebrew/system mpv binary, so the
  // "only the browser engine works" case is normal there and needs an explicit
  // hint instead of three silently disabled buttons.
  const isMac = document.documentElement.dataset.platform === "darwin";
  const outputModeLabel =
    audioOutputMode === "exclusive" ? "WASAPI Exclusive" : audioOutputMode === "shared" ? "WASAPI Shared" : "System";

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
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] border border-white/75 shadow-[0_24px_80px_rgba(47,55,76,0.14)]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Settings</p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Aria 设置</h1>
          </div>
          <Button variant="glass" size="sm" aria-label="返回上一页" onClick={onClose}>
            <ArrowLeft />
            返回
          </Button>
        </div>

        <div className="no-scrollbar grid min-h-0 flex-1 auto-rows-max grid-cols-1 content-start gap-4 overflow-y-auto p-5 sm:p-7 lg:grid-cols-2">
          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Runtime</p>
                <h3 className="mt-1 text-base font-semibold">后台托管</h3>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  backgroundEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onBackgroundEnabledChange(!backgroundEnabled)}
                aria-label="切换后台托管"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    backgroundEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={desktopReady ? "Desktop" : "Web"} label="模式" />
              <Metric value={apiState === "online" ? "Online" : apiState === "offline" ? "Offline" : "..."} label="后端" />
              <Metric value={backgroundEnabled ? "ON" : "OFF"} label="托管" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                variant="subtle"
                size="sm"
                disabled={!desktopReady}
                onClick={() => window.ariaDesktop?.minimizeToTray?.()}
              >
                <Settings2 />
                托管到后台
              </Button>
              <Button
                className="flex-1"
                variant="ghost"
                size="sm"
                onClick={refreshApiState}
              >
                <RefreshCw />
                刷新状态
              </Button>
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Appearance</p>
                <h3 className="mt-1 text-base font-semibold">外观主题</h3>
              </div>
              <Badge>{ariaThemeOptions.find((option) => option.value === theme)?.label ?? "跟随系统"}</Badge>
            </div>
            <p className="mt-2 text-xs text-neutral-500">深色模式会同步覆盖首页、播放页与设置页的底色、文字与面板阴影。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {ariaThemeOptions.map((option) => {
                const active = theme === option.value;
                const Icon = option.value === "light" ? Sun : option.value === "dark" ? Moon : Monitor;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      "aria-theme-option flex min-h-24 flex-col justify-between rounded-[1.15rem] border p-3 text-left transition",
                      active
                        ? "is-active border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_34px_rgba(23,23,23,0.16)]"
                        : "border-white/72 bg-white/72 text-neutral-950 hover:bg-white",
                    )}
                    onClick={() => onThemeChange(option.value)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full",
                          active ? "bg-white/14 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      {active && <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-neutral-950">使用中</span>}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={cn("mt-1 block text-xs", active ? "text-white/70" : "text-neutral-500")}>
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <RemoteAccessSettings />

          <KeyboardShortcutSettings
            shortcuts={keyboardShortcuts}
            onChange={onKeyboardShortcutsChange}
          />

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Library</p>
                <h3 className="mt-1 text-base font-semibold">本地音乐目录</h3>
              </div>
              <Badge>{libraryMeta.roots.length} 个目录</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={String(trackCount)} label="曲目" />
              <Metric value={String(likedCount)} label="喜欢" />
              <Metric value={`${lyricProgress}%`} label="歌词" />
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-950/8">
              <div className="h-full rounded-full bg-neutral-950/65" style={{ width: `${lyricProgress}%` }} />
            </div>

            <div className="mt-5 space-y-2">
              {libraryMeta.roots.map((root) => (
                <div key={root} className="flex items-center gap-3 rounded-[1rem] border border-white/70 bg-white/60 px-3 py-2.5 shadow-sm">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-950/[0.045] text-neutral-500">
                    <FolderSearch className="size-4" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium" title={root}>{root}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`移除目录 ${root}`}
                    title="从曲库移除（不会删除音频文件）"
                    onClick={() => onRemoveLibraryRoot(root)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {!libraryMeta.roots.length && (
                <div className="rounded-[1rem] border border-dashed border-neutral-950/10 bg-white/40 px-4 py-5 text-sm text-neutral-500">
                  还没有添加音乐目录。添加后 Aria 会扫描歌曲、封面和歌词信息。
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="subtle" size="sm" onClick={onAddLibraryFolder} disabled={!window.ariaDesktop?.chooseMusicFolder}>
                <FolderPlus />
                添加音乐文件夹
              </Button>
              <div className="flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] px-3 py-2 sm:justify-start">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">自动扫描新歌</p>
                  <p className="mt-0.5 text-xs text-neutral-500">监视目录变化，新加入的文件会自动进入曲库。</p>
                </div>
                <button
                  type="button"
                  className={cn("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition", libraryAutoScanEnabled ? "bg-neutral-950" : "bg-neutral-200")}
                  onClick={() => onToggleLibraryAutoScan(!libraryAutoScanEnabled)}
                  aria-label="切换自动扫描新歌"
                  role="switch"
                  aria-checked={libraryAutoScanEnabled}
                >
                  <span className={cn("size-6 rounded-full bg-white shadow-sm transition", libraryAutoScanEnabled && "translate-x-6")} />
                </button>
              </div>
            </div>
            <p className={cn("mt-3 min-h-4 text-xs", libraryWatchState?.lastError ? "text-rose-500" : "text-neutral-500")}>
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
          </section>

          <NeteaseSourceCard account={neteaseAccount} onAccountChange={onNeteaseAccountChange} />

          <QqSourceCard onAccountChange={onSourceAccountChange} />

          <BilibiliSourceCard onAccountChange={onSourceAccountChange} />

          <SourceEnableCard />

          <UpdateCard />

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Audio</p>
                <h3 className="mt-1 text-base font-semibold">默认音量</h3>
              </div>
              <Badge>{volume}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3">
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
            <div className="mt-4 rounded-[1.15rem] border border-white/70 bg-white/54 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Output</p>
                  <p className="mt-1 text-sm font-semibold">音频输出链路</p>
                </div>
                <Badge>{exclusiveReady ? "Locked" : outputModeLabel}</Badge>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[
                  isMac
                    ? {
                        mode: "system" as const,
                        label: "系统音频",
                        badge: "兼容",
                        desc: "走浏览器音频引擎，跟随 macOS 默认输出设备。",
                        Icon: Volume2,
                      }
                    : {
                        mode: "system" as const,
                        label: "系统音频",
                        badge: "兼容",
                        desc: "WASAPI 共享输出，频谱直接跟随播放器。",
                        Icon: Volume2,
                      },
                  isMac
                    ? {
                        mode: "shared" as const,
                        label: "MPV 共享",
                        badge: nativeAudioSupported ? "兼容" : "未启用",
                        desc: "由 MPV 单独打开音频会话，可与其它应用共用设备。",
                        Icon: Radio,
                      }
                    : {
                        mode: "shared" as const,
                        label: "WASAPI 共享",
                        badge: "兼容",
                        desc: "独立 Aria 音频会话，适合 OOPZ 等应用共享。",
                        Icon: Radio,
                      },
                  isMac
                    ? {
                        mode: "exclusive" as const,
                        label: "MPV 独占",
                        badge: exclusiveReady ? "Locked" : "直通",
                        desc: "MPV 独占音频设备，适合外接 DAC 直连。",
                        Icon: Sparkles,
                      }
                    : {
                        mode: "exclusive" as const,
                        label: "WASAPI 独占",
                        badge: exclusiveReady ? "Locked" : "直通",
                        desc: "独占端点，适合 DAC 或声卡直连。",
                        Icon: Sparkles,
                      },
                ].map(({ mode, label, badge, desc, Icon }) => {
                  const disabled = mode !== "system" && !nativeAudioSupported;
                  const active = audioOutputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        "flex min-h-32 flex-col justify-between rounded-[1.15rem] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_34px_rgba(23,23,23,0.16)]"
                          : "border-white/72 bg-white/72 text-neutral-950 hover:bg-white",
                      )}
                      onClick={() => onAudioOutputModeChange(mode)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "flex size-10 items-center justify-center rounded-full",
                            active ? "bg-white/14 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                            active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                          )}
                        >
                          {badge}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{label}</span>
                        <span className={cn("mt-1 block text-xs leading-5", active ? "text-white/62" : "text-neutral-500")}>
                          {desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {!nativeAudioSupported && (
                <p className="mt-3 rounded-[0.9rem] bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-800">
                  {isMac
                    ? "未检测到 MPV：选区（共享/独占）不可用，播放走浏览器音频引擎。执行 brew install mpv 后重启 Aria 即可解锁 MPV 输出。"
                    : "未检测到 MPV：选区（共享/独占）不可用，播放走浏览器音频引擎。"}
                </p>
              )}
              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Device</p>
                  <p className="mt-1 text-sm font-semibold">播放设备</p>
                </div>
                <Badge>{deviceSwitchSupported ? "可切换" : "系统默认"}</Badge>
              </div>
              <div className="no-scrollbar mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {audioOutputDevices.map((device) => {
                  const active = selectedSinkId === device.id;
                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={!deviceSwitchSupported}
                      onClick={() => onSelectedSinkIdChange(device.id)}
                      className={cn(
                        "grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[0.95rem] border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_30px_rgba(23,23,23,0.12)]"
                          : "border-white/70 bg-white/70 hover:bg-white",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full",
                          active ? "bg-white/15 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                        )}
                      >
                        <Volume2 className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{device.label}</span>
                        <span className={cn("mt-0.5 block truncate text-xs", active ? "text-white/60" : "text-neutral-400")}>
                          {device.id === "default" ? "跟随系统默认输出" : device.id}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                        )}
                      >
                        {active ? "当前" : "选择"}
                      </span>
                    </button>
                  );
                })}
                {!audioOutputDevices.length && (
                  <div className="rounded-[0.95rem] bg-white/65 px-3 py-4 text-sm text-neutral-500">没有检测到可用输出设备。</div>
                )}
              </div>
              <p className="mt-2 truncate text-xs text-neutral-500">
                {nativeAudioState?.deviceId ? `当前设备: ${nativeAudioState.deviceId}` : "当前设备: 默认输出"}
              </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">HiFi 优先</p>
                <p className="mt-1 text-xs text-neutral-500">优先最高原始音质 Hi-Res，不支持时自动降级。</p>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  hifiEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => {
                  const nextEnabled = !hifiEnabled;
                  onHifiEnabledChange(nextEnabled);
                  if (!nextEnabled) onMasterQualityEnabledChange(false);
                }}
                aria-label="切换 HiFi 优先"
                role="switch"
                aria-checked={hifiEnabled}
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    hifiEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            {hifiEnabled && (
              <div className="flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
                <div>
                  <p className="text-sm font-semibold">臻品增强</p>
                  <p className="mt-1 text-xs text-neutral-500">独立开启臻品音质；不支持的歌曲使用原始音质。</p>
                </div>
                <button
                  className={cn("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition", masterQualityEnabled ? "bg-neutral-950" : "bg-neutral-200")}
                  onClick={() => onMasterQualityEnabledChange(!masterQualityEnabled)}
                  aria-label="切换臻品增强"
                  role="switch"
                  aria-checked={masterQualityEnabled}
                >
                  <span className={cn("size-6 rounded-full bg-white shadow-sm transition", masterQualityEnabled && "translate-x-6")} />
                </button>
              </div>
            )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">音量标准化</p>
                <p className="mt-1 text-xs text-neutral-500">平衡歌曲响度，减少忽大忽小。默认关闭，开启后会处理音频动态。</p>
                {normalizationError && <p role="alert" className="mt-1 text-xs text-rose-600">{normalizationError}</p>}
              </div>
              <button
                type="button"
                className={cn("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition", normalizationEnabled ? "bg-neutral-950" : "bg-neutral-200")}
                onClick={() => onNormalizationEnabledChange(!normalizationEnabled)}
                aria-label="切换音量标准化"
                role="switch"
                aria-checked={normalizationEnabled}
              >
                <span className={cn("size-6 rounded-full bg-white shadow-sm transition", normalizationEnabled && "translate-x-6")} />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">无缝衔接</p>
                <p className="mt-1 text-xs text-neutral-500">提前加载下一首，减少歌曲切换时的空隙。</p>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  gaplessEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onGaplessEnabledChange(!gaplessEnabled)}
                aria-label="切换无缝衔接"
                aria-pressed={gaplessEnabled}
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    gaplessEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
          </section>

        </div>
        <div className="flex items-center justify-between border-t border-neutral-950/6 px-5 py-3 text-xs text-neutral-400 sm:px-7">
          <span>Aria Desktop</span>
          <span>v{__APP_VERSION__}</span>
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
        setMessage("请按住 Ctrl、Alt、Shift 或 Win，再按一个功能键。");
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
  }, [onChange, recording, shortcuts]);

  return (
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Shortcuts</p>
          <h3 className="mt-1 text-base font-semibold">全局快捷键</h3>
        </div>
        <Keyboard className="size-5 text-neutral-400" />
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">后台托管或切到其他软件时仍可使用。点击组合键后直接按新的按键。</p>
      <div className="mt-3 space-y-2">
        {shortcutDefinitions.map((definition) => {
          const isRecording = recording === definition.command;
          return (
            <div key={definition.command} className="flex items-center gap-3 rounded-[1rem] bg-white/56 px-3 py-2.5 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{definition.label}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{definition.description}</p>
              </div>
              <button
                type="button"
                className={cn(
                  "min-w-28 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                  isRecording
                    ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_10px_22px_rgba(23,23,23,0.16)]"
                    : "border-neutral-950/10 bg-white text-neutral-700 hover:border-neutral-950/30",
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
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-h-4 text-xs text-rose-500">{message}</p>
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
    </section>
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Accounts</p>
          <p className="mt-0.5 text-sm font-semibold">播放源账号</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      {/* 两张卡片始终标明来源：头像只代表当前登录用户，logo + 名称才说明是哪个平台。 */}
      <div className="mt-3 space-y-2">
        {sourceAccounts.map((source) => {
          const logo = source.id === "qq" ? "qq" : source.id === "bilibili" ? "bilibili" : "netease";
          return (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-[1.1rem] border border-white/70 bg-white/62 p-3 shadow-sm"
            >
              <div className="relative shrink-0">
                {source.avatarUrl && source.connected ? (
                  <ArtworkImage src={source.avatarUrl} cacheSize={128} alt="" draggable={false} className="size-12 rounded-full object-cover shadow-sm" />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-inner">
                    <SourceLogo source={logo} className="size-6" />
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-white shadow ring-1 ring-black/5">
                  <SourceLogo source={logo} className="size-3.5" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
                  <SourceLogo source={logo} className="size-3.5 shrink-0" />
                  {source.label}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold">
                  {source.connected ? source.nickname ?? "已登录" : "未登录"}
                </p>
                <p className={cn("mt-0.5 text-xs", source.connected ? "text-emerald-600" : "text-neutral-400")}>
                  {source.connected ? "已登录并同步" : "前往设置登录"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 rounded-[1rem] bg-neutral-950/[0.03] p-3 text-xs leading-relaxed text-neutral-500">
        网易云音乐、QQ 音乐与 B站的扫码、Cookie 登录和退出都在「设置 → 播放源」里完成。
      </p>
      {onManageSources && (
        <Button className="mt-3 w-full" size="sm" onClick={onManageSources}>
          <Settings2 />
          前往设置管理账号
        </Button>
      )}
    </motion.div>
  );
}

/** NetEase source card in Settings: QR/cookie login, account state and 460 mitigation. */
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
  const [qrStatus, setQrStatus] = useState("点击生成二维码后，用网易云音乐扫码登录。");
  const [showCookie, setShowCookie] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [realIp, setRealIp] = useState("");
  const [savingNetwork, setSavingNetwork] = useState(false);
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
        setRealIp(settings.neteaseRealIp ?? "");
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

  async function saveRealIp() {
    setSavingNetwork(true);
    setMessage(null);
    try {
      const result = await api.saveNeteaseRealIp(realIp.trim());
      setRealIp(result.realIP ?? "");
      setMessage(result.realIP ? "已启用网络环境补偿" : "已恢复正常网络环境");
    } catch {
      setMessage("保存失败，请检查 IP 格式");
    } finally {
      setSavingNetwork(false);
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
      setQrStatus("点击生成二维码后，用网易云音乐扫码登录。");
      setMessage("已退出网易云音乐账号");
    } catch {
      setMessage("退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={cn(
        embedded
          ? "rounded-[1.25rem] bg-white/55 p-4"
          : "rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Sources</p>
          <h3 className="mt-1 truncate text-base font-semibold">播放源 · 网易云音乐</h3>
        </div>
        {!embedded && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge>{account?.connected ? "已登录" : "未登录"}</Badge>
            <SourceToggle sourceId="netease" />
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={320} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <UserRound className="size-9 text-neutral-300" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{account?.connected ? account.nickname ?? "已登录" : "扫码登录"}</p>
          <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{qrStatus}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={startQrLogin} disabled={qrLoading || saving}>
              <RefreshCw />
              {qrLoading ? "生成中" : qrLogin ? "刷新二维码" : "扫码登录"}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowCookie((value) => !value)}>
              <Cookie />
              Cookie 备用绑定
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowNetwork((value) => !value)}>
              <Globe />
              网络环境补偿
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
        <div className="mt-3 flex items-center gap-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <img
            src={qrLogin.qrImage}
            alt="网易云扫码登录二维码"
            width={132}
            height={132}
            className="size-[132px] rounded-[0.9rem] bg-white object-contain shadow-inner"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-600">网易云音乐 App 扫码</p>
            <p className="mt-1">扫码后需要在手机上点「确认登录」，二维码约 3 分钟有效。</p>
            <p className="mt-1 text-neutral-400">二维码由本机服务端生成并轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showCookie && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="netease-cookie">
            网易云 Cookie
          </label>
          <textarea
            id="netease-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={4}
            placeholder="MUSIC_U=...; NMTID=..."
            className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void bindCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {showNetwork && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="netease-real-ip">
            网易云提示「环境异常」时，填入一个中国大陆的 IP
          </label>
          <input
            id="netease-real-ip"
            value={realIp}
            onChange={(event) => setRealIp(event.target.value)}
            placeholder="例如 116.25.146.177，留空表示使用本机网络"
            className="mt-2 w-full rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">
            请求会以这个 IP 的名义发出，用于绕过异地登录风控。仅在你确认本机网络正常、仍然报环境异常时使用。
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void saveRealIp()} disabled={savingNetwork}>
              <Globe />
              {savingNetwork ? "保存中" : "保存"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}
      {!account?.connected && (
        <p className="mt-3 text-xs text-neutral-400">
          登录后即可同步「我喜欢」、歌单、每日推荐与云盘。
        </p>
      )}
    </section>
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
              <p className="text-xs uppercase tracking-[0.2em] text-white/55">Ready when you are</p>
              <div className="mt-5 space-y-3 text-sm text-white/80">
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
              B站提示：扫码登录后可同步「默认收藏夹」，播放页红心会加入或移出该收藏夹；登录状态下视频清晰度更高。匿名搜索与播放无需登录。
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <NeteaseSourceCard embedded account={neteaseAccount} onAccountChange={onAccountChange} />
              <div className="overflow-hidden rounded-[1.25rem] bg-white/55 p-1">
                <QqSourceCard onAccountChange={onSourceAccountChange} />
              </div>
              <div className="overflow-hidden rounded-[1.25rem] bg-white/55 p-1 lg:col-span-2">
                <BilibiliSourceCard onAccountChange={onSourceAccountChange} />
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
  const desktopReady = Boolean(window.ariaDesktop?.getRemoteAccess);
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
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Remote</p>
          <h3 className="mt-1 text-base font-semibold">手机远程访问</h3>
        </div>
        <button
          className={cn(
            "flex h-8 w-14 items-center rounded-full p-1 transition disabled:opacity-50",
            enabled ? "bg-neutral-950" : "bg-neutral-200",
          )}
          disabled={busy || !info}
          onClick={toggleRemoteAccess}
          aria-label="切换手机远程访问"
          aria-pressed={enabled}
        >
          <span className={cn("size-6 rounded-full bg-white shadow-sm transition", enabled && "translate-x-6")} />
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">
        开启后,同一局域网内的 Aria 手机版可以连接这台电脑,同步网易云歌单并串流本地曲库。连接令牌只走明文 HTTP,请仅在可信的家用网络开启。
      </p>

      {!info && <p className="mt-4 text-sm text-neutral-400">读取远程访问状态…</p>}

      {info && restarting && (
        <p className="mt-3 flex items-center gap-2 text-xs text-sky-700">
          <RefreshCw className="size-3.5 animate-spin" />
          后端正在以新配置重启,约 2 秒后生效…
        </p>
      )}

      {info && enabled && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-2">
            {info.addresses.length === 0 && (
              <p className="rounded-[1rem] bg-amber-50 p-3 text-xs text-amber-700">没有检测到局域网地址,请确认电脑已连接网络。</p>
            )}
            {info.addresses.map((address) => (
              <button
                key={address}
                type="button"
                onClick={() => copyText(`http://${address}:${info.port}`, "address")}
                className="flex w-full items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3 text-left transition hover:bg-neutral-950/[0.06]"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-neutral-400">服务器地址(点击复制)</span>
                  <span className="mt-0.5 block truncate font-mono text-sm font-medium">http://{address}:{info.port}</span>
                </span>
                {copied === "address" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0 text-neutral-400" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => copyText(info.token, "token")}
              className="flex w-full items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3 text-left transition hover:bg-neutral-950/[0.06]"
            >
              <span className="min-w-0">
                <span className="block text-xs text-neutral-400">连接令牌(点击复制)</span>
                <span className="mt-0.5 block truncate font-mono text-sm font-medium">{info.token}</span>
              </span>
              {copied === "token" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0 text-neutral-400" />}
            </button>
            <p className="text-xs leading-5 text-neutral-500">
              在手机 Aria 的「连接到电脑」里输入上面的地址和令牌,或用手机相机扫码后把内容填入。
            </p>
          </div>
          <div className="flex items-start justify-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Aria 手机连接二维码" className="size-40 rounded-[1rem] bg-white p-2 shadow-sm" draggable={false} />
            ) : (
              <div className="flex size-40 items-center justify-center rounded-[1rem] bg-white/70 text-xs text-neutral-400">二维码生成中…</div>
            )}
          </div>
        </div>
      )}

      {info && !enabled && firstAddress && (
        <p className="mt-3 font-mono text-xs text-neutral-400">{firstAddress} · 当前仅本机可访问</p>
      )}
    </section>
  );
}








/** QQ Music source row: QR/cookie login + live account state from /api/sources/qq. */
function QqSourceCard({ onAccountChange }: { onAccountChange?: () => void }) {
  const [account, setAccount] = useState<SourceAccountSummary | null>(null);
  const [hasStoredCookie, setHasStoredCookie] = useState(false);
  const [cookie, setCookie] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState("点击扫码登录，用手机 QQ 扫描二维码。");
  const [loginLoading, setLoginLoading] = useState(false);
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

  async function loginInWindow() {
    const openLoginWindow = window.ariaDesktop?.qqLoginWindow;
    if (!openLoginWindow) {
      setMessage("当前环境不支持窗口登录，请使用 Cookie 备用绑定");
      return;
    }
    setLoginLoading(true);
    setMessage(null);
    setLoginStatus("已打开登录窗口，可选择 QQ 或微信扫码并确认登录。");
    try {
      const result = await openLoginWindow();
      if (!result?.ok || !result.cookie) {
        setLoginStatus(result?.message ?? "未完成登录");
        return;
      }
      const saved = await api.saveQqCookie(result.cookie);
      setAccount(saved.account);
      setHasStoredCookie(true);
      onAccountChange?.();
      if (saved.account.connected) {
        setLoginStatus("登录成功，账号信息已同步。");
        setMessage(`已登录：${saved.account.nickname ?? "QQ 音乐账号"}`);
      } else {
        setLoginStatus("已获取 Cookie，但账号信息接口未确认登录状态。");
        setMessage("可重新窗口登录一次，或改用 Cookie 备用绑定粘贴完整 Cookie");
      }
    } catch {
      setLoginStatus("窗口登录失败，可改用 Cookie 备用绑定。");
    } finally {
      setLoginLoading(false);
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
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Sources</p>
          <h3 className="mt-1 truncate text-base font-semibold">播放源 · QQ 音乐</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge>{account?.connected ? "已登录" : hasStoredCookie ? "登录已过期" : "未登录"}</Badge>
          <SourceToggle sourceId="qq" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={320} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <UserRound className="size-9 text-neutral-300" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{account?.connected ? account.nickname ?? "已登录" : "窗口扫码登录"}</p>
          <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{loginStatus}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void startQrLogin()} disabled={qrLoading || loginLoading}>
              <QrCode />
              {qrLoading ? "生成中" : qrLogin ? "重新获取二维码" : "扫码登录"}
            </Button>
            {window.ariaDesktop?.qqLoginWindow && (
              <Button size="sm" variant="subtle" onClick={() => void loginInWindow()} disabled={loginLoading}>
                <LogIn />
                {loginLoading ? "等待登录" : "窗口扫码登录"}
              </Button>
            )}
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
        <div className="mt-3 flex items-center gap-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <img
            src={qrLogin.image}
            alt="QQ 音乐登录二维码"
            width={132}
            height={132}
            className="size-[132px] rounded-[0.9rem] bg-white object-contain shadow-inner"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-600">手机 QQ 扫码</p>
            <p className="mt-1">扫码后需要在手机上点「确认登录」，二维码约 2 分钟有效。</p>
            <p className="mt-1 text-neutral-400">二维码会通过本机服务端轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showInput && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="qq-cookie">
            QQ 音乐 Cookie
          </label>
          <textarea
            id="qq-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={4}
            placeholder="uin=o...; qqmusic_key=...; ..."
            className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void saveCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}
      {!account?.connected && (
        <p className="mt-3 text-xs text-neutral-400">
          绑定后可搜索、播放、读取歌单并双向同步「我喜欢」；VIP 歌需要绿钻账号才能整首播放，仅高音质受限不会影响普通播放。
        </p>
      )}
    </section>
  );
}

/** Bilibili source row: QR/cookie login + live account state from /api/sources/bilibili. */
function BilibiliSourceCard({ onAccountChange }: { onAccountChange?: () => void }) {
  const [account, setAccount] = useState<SourceAccountSummary | null>(null);
  const [hasStoredCookie, setHasStoredCookie] = useState(false);
  const [cookie, setCookie] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState("扫码登录后可同步默认收藏夹，登录状态下视频清晰度更高。");
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
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Sources</p>
          <h3 className="mt-1 truncate text-base font-semibold">播放源 · 哔哩哔哩</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge>{account?.connected ? "已登录" : hasStoredCookie ? "登录已过期" : "未登录"}</Badge>
          <SourceToggle sourceId="bilibili" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
          {account?.avatarUrl ? (
            <ArtworkImage src={account.avatarUrl} cacheSize={320} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <SourceLogo source="bilibili" className="size-10" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{account?.connected ? account.nickname ?? "已登录" : "扫码登录"}</p>
          <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{loginStatus}</p>
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
        <div className="mt-3 flex items-center gap-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <img
            src={qrLogin.image}
            alt="B站登录二维码"
            width={132}
            height={132}
            className="size-[132px] rounded-[0.9rem] bg-white object-contain shadow-inner"
          />
          <div className="min-w-0 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-600">哔哩哔哩手机客户端扫码</p>
            <p className="mt-1">扫码后需要在手机上点「确认登录」，二维码约 3 分钟有效。</p>
            <p className="mt-1 text-neutral-400">二维码由本机服务端生成与轮询，不会上传到第三方。</p>
          </div>
        </div>
      )}
      {showInput && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="bilibili-cookie">
            B站 Cookie
          </label>
          <textarea
            id="bilibili-cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={4}
            placeholder="SESSDATA=...; bili_jct=...; DedeUserID=..."
            className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void saveCookie()} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "保存 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}
      {!account?.connected && (
        <p className="mt-3 text-xs text-neutral-400">
          登录后，「我喜欢」会出现 B站默认收藏夹；播放页的红心会加入或移出该收藏夹。匿名播放仍可用，但视频通常只有 360P。
        </p>
      )}
    </section>
  );
}

/**
 * Per-source switch. Turning a source off keeps its login state but stops
 * Aria from sending it any search/stream request, which is the fastest way to
 * silence an upstream outage without restarting the app.
 */
function SourceToggle({ sourceId }: { sourceId: "netease" | "qq" | "bilibili" }) {
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
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      aria-pressed={enabled}
      title={enabled ? "停用后不再向该音源发送请求" : "启用该音源"}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-neutral-200 bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
        pending && "opacity-60",
      )}
    >
      {enabled ? "已启用" : "已停用"}
    </button>
  );
}
