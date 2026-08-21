import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Cookie, Download, LogOut, Radio, RefreshCw, Settings2, Sparkles, UserRound, Volume2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/music/shared";
import { api, type DiagnosticsStats, type NeteaseAccountSummary, type NeteaseQrStart, type RuntimeInfo } from "@/lib/api";
import type { NativeAudioState } from "@/lib/audioTypes";
import type { AudioOutputMode } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";

const processLabel: Record<string, string> = {
  browser: "主进程",
  renderer: "界面渲染",
  tab: "界面渲染",
  gpu: "GPU",
  utility: "工具进程",
  zygote: "辅助进程",
  network: "网络服务",
};

function gpuVendorLabel(vendorId: number | null) {
  if (vendorId === 0x10de) return "NVIDIA";
  if (vendorId === 0x1002) return "AMD";
  if (vendorId === 0x8086) return "Intel";
  return vendorId ? `0x${vendorId.toString(16)}` : "未知";
}

function featureLabel(value: string) {
  if (value === "enabled") return "硬件加速";
  if (value === "disabled_software") return "软件渲染(CPU)";
  if (value === "disabled_off") return "已禁用";
  if (value === "unavailable") return "不可用";
  return value;
}

export function SettingsPanel({
  backgroundEnabled,
  onBackgroundEnabledChange,
  globalArrowKeysEnabled,
  onGlobalArrowKeysChange,
  perfMode,
  onPerfModeChange,
  neteaseAccount,
  onLogoutNetease,
  runtimeInfo,
  libraryMeta,
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
  nativeAudioSupported,
  nativeAudioState,
  audioOutputMode,
  onAudioOutputModeChange,
  exclusiveMode,
  onClose,
}: {
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  globalArrowKeysEnabled: boolean;
  onGlobalArrowKeysChange: (value: boolean) => void;
  perfMode: boolean;
  onPerfModeChange: (value: boolean) => void;
  neteaseAccount: NeteaseAccountSummary | null;
  onLogoutNetease: () => void;
  runtimeInfo: RuntimeInfo;
  libraryMeta: { roots: number; updatedAt: string | null };
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
  nativeAudioSupported: boolean;
  nativeAudioState: NativeAudioState | null;
  audioOutputMode: AudioOutputMode;
  onAudioOutputModeChange: (value: AudioOutputMode) => void;
  exclusiveMode: boolean;
  onClose: () => void;
}) {
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const desktopReady = Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);
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

  const [diagStats, setDiagStats] = useState<DiagnosticsStats | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let rafId = 0;
    let sampling = false;
    let sampleTimer = 0;
    let restTimer = 0;
    const count = () => {
      frames += 1;
      rafId = window.requestAnimationFrame(count);
    };
    const start = () => {
      frames = 0;
      sampling = true;
      rafId = window.requestAnimationFrame(count);
      sampleTimer = window.setTimeout(() => {
        const elapsed = 1; // 采样 1 秒
        setFps(elapsed > 0 ? Math.round(frames / elapsed) : 0);
        sampling = false;
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
        restTimer = window.setTimeout(start, 2000);
      }, 1000);
    };
    start();
    return () => {
      window.clearTimeout(sampleTimer);
      window.clearTimeout(restTimer);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  function refreshDiagnostics() {
    window.ariaDesktop?.diagnostics?.getStats?.()
      .then((stats) => {
        if (stats) setDiagStats(stats);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    refreshDiagnostics();
    const timer = window.setInterval(refreshDiagnostics, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportLogs() {
    setExporting(true);
    setExportMessage(null);
    try {
      const result = await window.ariaDesktop?.diagnostics?.exportLogs?.({ ...runtimeInfo, fps });
      if (result?.ok) {
        setExportMessage(`已导出 ${result.copiedLogs ?? 0} 个日志文件 → ${result.path}`);
      } else {
        setExportMessage(result?.error ?? "导出失败");
      }
    } catch {
      setExportMessage("导出失败，请确认桌面版运行环境");
    } finally {
      setExporting(false);
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-[70] flex justify-end bg-white/28 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        initial={{ x: 34, opacity: 0, filter: "blur(12px)" }}
        animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
        exit={{ x: 28, opacity: 0, filter: "blur(12px)" }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="m-3 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.7rem] border border-white/75 bg-white/78 shadow-[0_24px_80px_rgba(47,55,76,0.18)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Settings</p>
            <h2 className="mt-1 text-2xl font-semibold">Aria 设置</h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭设置" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
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

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Library</p>
                <h3 className="mt-1 text-base font-semibold">曲库状态</h3>
              </div>
              <Badge>{libraryMeta.roots} 个目录</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={String(trackCount)} label="曲目" />
              <Metric value={String(likedCount)} label="喜欢" />
              <Metric value={`${lyricProgress}%`} label="歌词" />
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-950/8">
              <div className="h-full rounded-full bg-neutral-950/65" style={{ width: `${lyricProgress}%` }} />
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Account</p>
                <h3 className="mt-1 truncate text-base font-semibold">{neteaseAccount?.nickname ?? "网易云未绑定"}</h3>
              </div>
              <Badge>{neteaseAccount?.connected ? "Ready" : "Cookie"}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              {neteaseAccount?.avatarUrl ? (
                <img src={neteaseAccount.avatarUrl} alt="" draggable={false} className="size-12 rounded-full object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-sm">
                  <UserRound className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {neteaseAccount?.connected ? neteaseAccount.userId : "等待绑定 Cookie"}
                </p>
                <p className="mt-1 truncate text-xs text-neutral-500">{neteaseAccount?.cookiePreview ?? "右上角头像里绑定"}</p>
              </div>
            </div>
            {neteaseAccount?.connected && (
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onLogoutNetease}>
                <LogOut />
                退出登录
              </Button>
            )}
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
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
                    "--range-value": `${volume}%`,
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
                  {
                    mode: "system" as const,
                    label: "系统音频",
                    badge: "兼容",
                    desc: "HTMLAudio 输出，频谱直接跟随播放器。",
                    Icon: Volume2,
                  },
                  {
                    mode: "shared" as const,
                    label: "WASAPI 共享",
                    badge: "HiFi",
                    desc: "后端 mpv 播放，不独占设备。",
                    Icon: Radio,
                  },
                  {
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

            <div className="mt-4 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">HiFi 优先</p>
                <p className="mt-1 text-xs text-neutral-500">自动请求当前歌曲可用的最高音质。</p>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  hifiEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onHifiEnabledChange(!hifiEnabled)}
                aria-label="切换 HiFi 优先"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    hifiEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Shortcut</p>
                <h3 className="mt-1 text-base font-semibold">左右键切歌</h3>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  globalArrowKeysEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onGlobalArrowKeysChange(!globalArrowKeysEnabled)}
                aria-label="切换左右键切歌"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    globalArrowKeysEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              开启后，在 Aria 内或切到其他软件时，按键盘 ← / → 方向键即可切换上一首/下一首；输入框内方向键仍用于移动光标，不受影响。
            </p>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Diagnostics</p>
                <h3 className="mt-1 text-base font-semibold">诊断与日志</h3>
              </div>
              <Badge>{diagStats ? `${diagStats.processes.length} 进程` : "..."}</Badge>
            </div>

            {diagStats?.processes?.length ? (
              <div className="mt-3 space-y-1.5">
                {diagStats.processes.map((process) => (
                  <div
                    key={`${process.type}-${process.pid}`}
                    className="flex items-center justify-between gap-2 rounded-[0.9rem] bg-white/55 px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium text-neutral-600">{processLabel[process.type] ?? process.type}</span>
                    <span className="text-neutral-500">
                      CPU {process.cpuPercent.toFixed(1)}% · 内存 {process.memoryMb} MB
                    </span>
                  </div>
                ))}
                {diagStats.backendPid != null && (
                  <div className="flex items-center justify-between gap-2 rounded-[0.9rem] bg-white/55 px-3 py-1.5 text-xs">
                    <span className="font-medium text-neutral-600">本地后端</span>
                    <span className="text-neutral-500">内存 {diagStats.backendMemoryMb ?? "--"} MB</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-neutral-500">正在读取进程占用…</p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 rounded-[0.9rem] bg-white/55 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-neutral-600">性能模式</p>
                <p className="mt-0.5 text-[0.7rem] leading-relaxed text-neutral-400">
                  关闭毛玻璃等合成效果，可明显降低界面渲染 CPU（A 卡/低配机建议开启）
                </p>
              </div>
              <button
                className={cn(
                  "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition",
                  perfMode ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onPerfModeChange(!perfMode)}
                aria-label="切换性能模式"
              >
                <span className={cn("size-5 rounded-full bg-white shadow-sm transition", perfMode && "translate-x-5")} />
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 rounded-[0.9rem] bg-white/55 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-neutral-600">AMD GPU 渲染优化</p>
                <p className="mt-0.5 text-[0.7rem] leading-relaxed text-neutral-400">
                  A 卡启动时强制 GPU 渲染；关闭后重启可对比 CPU 占用（当前：{diagStats ? (diagStats.gpuOptimizeEnabled ? "开启" : "关闭") : "--"}）
                </p>
              </div>
              <button
                className={cn(
                  "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition",
                  diagStats?.gpuOptimizeEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => {
                  const next = !(diagStats?.gpuOptimizeEnabled ?? true);
                  window.ariaDesktop?.diagnostics?.setGpuOptimize?.(next).catch(() => undefined);
                  setDiagStats((current) => (current ? { ...current, gpuOptimizeEnabled: next } : current));
                  setExportMessage("GPU 渲染优化已切换，重启 Aria 后生效");
                }}
                aria-label="切换 AMD GPU 渲染优化"
              >
                <span
                  className={cn(
                    "size-5 rounded-full bg-white shadow-sm transition",
                    diagStats?.gpuOptimizeEnabled && "translate-x-5",
                  )}
                />
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => void exportLogs()} disabled={exporting}>
                <Download />
                {exporting ? "导出中…" : "导出日志"}
              </Button>
              <Button size="sm" variant="subtle" className="flex-1" onClick={refreshDiagnostics}>
                <RefreshCw />
                刷新
              </Button>
            </div>
            {exportMessage && <p className="mt-3 break-all text-xs text-neutral-500">{exportMessage}</p>}
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              {diagStats
                ? `v${diagStats.appVersion} · 已运行 ${Math.round(diagStats.uptimeSeconds / 60)} 分钟 · 主进程内存 ${diagStats.mainMemoryMb} MB · 当前视图 ${runtimeInfo.view} · 输出 ${runtimeInfo.outputMode}`
                : "导出日志后会自动打开文件夹，把整个文件夹发给开发者即可排查 CPU 占用等问题。"}
            </p>
            {diagStats && (
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                渲染帧率 {fps} fps · CPU {diagStats.cpuModel ?? "未知"}（{diagStats.cpuCores} 核）· 显卡 {gpuVendorLabel(diagStats.gpuVendorId)}
                {diagStats.gpuFeatures
                  ? ` · 合成 ${featureLabel(diagStats.gpuFeatures.gpuCompositing)} · 光栅化 ${featureLabel(diagStats.gpuFeatures.rasterization)}`
                  : ""}
              </p>
            )}
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-950/6 px-5 py-3 text-xs text-neutral-400">
          <span>Aria Desktop</span>
          <span>v{__APP_VERSION__}</span>
        </div>
      </motion.aside>
    </motion.div>
  );
}

export function AccountPanel({
  onClose,
  onAccountChange,
}: {
  onClose: () => void;
  onAccountChange?: (account: NeteaseAccountSummary) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [account, setAccount] = useState<NeteaseAccountSummary | null>(null);
  const [qrLogin, setQrLogin] = useState<NeteaseQrStart | null>(null);
  const [qrStatus, setQrStatus] = useState("点击生成二维码后，用网易云音乐扫码登录。");
  const [showCookie, setShowCookie] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (mounted) {
          setAccount(settings.neteaseAccount);
        }
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!qrLogin || account?.connected) return;

    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.checkNeteaseQrLogin(qrLogin.key);
        if (cancelled) return;

        if (result.status === "success" && result.account) {
          setAccount(result.account);
          onAccountChange?.(result.account);
          setQrLogin(null);
          setQrStatus("登录成功，账号信息已同步。");
          setMessage("网易云账号已登录");
          return;
        }

        if (result.status === "expired") {
          setQrStatus("二维码已过期，请重新生成。");
          return;
        }

        setQrStatus(result.status === "scanned" ? "已扫码，请在手机上确认登录。" : "等待扫码确认。");
      } catch {
        if (!cancelled) setQrStatus("扫码状态获取失败，稍后会自动重试。");
      }
    };

    check();
    const timer = window.setInterval(check, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account?.connected, onAccountChange, qrLogin]);

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
      onAccountChange?.(result.account);
      setCookie("");
      setMessage("Cookie 已保存");
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
      onAccountChange?.(result.account);
      setCookie("");
      setMessage("已退出登录");
    } catch {
      setMessage("退出失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      transition={{ duration: 0.22 }}
      className="glass absolute right-0 top-14 z-50 w-[min(25rem,calc(100vw-2rem))] rounded-[1.4rem] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" draggable={false} className="size-12 rounded-full object-cover shadow-sm" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white">
              <UserRound className="size-5" />
            </div>
          )}
          <div>
            <p className="font-semibold">{account?.nickname ?? "网易云账号"}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {account?.connected ? "已登录并同步 Cookie" : "扫码登录更适合日常使用"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 rounded-[1.2rem] border border-white/70 bg-white/64 p-3 shadow-sm">
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
            {qrLogin?.qrImage ? (
              <img src={qrLogin.qrImage} alt="网易云扫码登录二维码" draggable={false} className="size-full object-contain p-2" />
            ) : account?.avatarUrl ? (
              <img src={account.avatarUrl} alt="" draggable={false} className="size-full object-cover" />
            ) : (
              <UserRound className="size-9 text-neutral-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{account?.connected ? "账号已同步" : "扫码登录"}</p>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{qrStatus}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={startQrLogin} disabled={qrLoading}>
                <RefreshCw />
                {qrLoading ? "生成中" : qrLogin ? "刷新二维码" : "生成二维码"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {account?.connected && (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[1rem] bg-white/50 px-3 py-2 text-sm font-medium text-neutral-600 shadow-sm transition hover:bg-red-50 hover:text-red-600"
          onClick={logout}
          disabled={saving}
        >
          <LogOut className="size-4" />
          退出登录
        </button>
      )}

      <button
        type="button"
        className="mt-3 flex w-full items-center justify-between rounded-[1rem] bg-white/50 px-3 py-2 text-left text-sm font-medium shadow-sm transition hover:bg-white/72"
        onClick={() => setShowCookie((value) => !value)}
      >
        <span className="flex items-center gap-2">
          <Cookie className="size-4" />
          Cookie 备用绑定
        </span>
        <span className="text-xs text-neutral-400">{showCookie ? "收起" : "展开"}</span>
      </button>

      {showCookie && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="cookie">
            网易云 Cookie
          </label>
          <textarea
            id="cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={4}
            placeholder="MUSIC_U=...; NMTID=..."
            className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={bindCookie} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "绑定 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
        <Metric value={account?.connected ? "ON" : "--"} label="状态" />
        <Metric value={account?.userId ?? "--"} label="用户" />
        <Metric value={account?.connected ? "Ready" : "--"} label="同步" />
      </div>
    </motion.div>
  );
}







