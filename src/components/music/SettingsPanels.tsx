import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Cookie, Keyboard, Radio, RefreshCw, RotateCcw, Settings2, Sparkles, UserRound, Volume2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/music/shared";
import { api, type NeteaseAccountSummary, type NeteaseQrStart } from "@/lib/api";
import type { NativeAudioState } from "@/lib/audioTypes";
import type { AudioOutputMode } from "@/lib/playerPresentation";
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
export function SettingsPanel({
  backgroundEnabled,
  onBackgroundEnabledChange,
  neteaseAccount,
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
  keyboardShortcuts,
  onKeyboardShortcutsChange,
  onClose,
}: {
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  neteaseAccount: NeteaseAccountSummary | null;
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
  keyboardShortcuts: KeyboardShortcuts;
  onKeyboardShortcutsChange: (shortcuts: KeyboardShortcuts) => void;
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

        <div className="no-scrollbar grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto p-5 sm:p-7 lg:grid-cols-2">
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

          <KeyboardShortcutSettings
            shortcuts={keyboardShortcuts}
            onChange={onKeyboardShortcutsChange}
          />

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
          </section>

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
                    badge: "兼容",
                    desc: "mpv 原生共享，保留无损流并支持应用音频捕获。",
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
              {audioOutputMode === "shared" && nativeAudioSupported && (
                <p className="mt-3 rounded-[0.9rem] bg-neutral-950/[0.035] px-3 py-2 text-xs leading-5 text-neutral-500">
                  共享模式保持原生无损输出；在 OOPZ 中选择 Aria 的程序音频即可共享。Windows 需 10.0.19044 以上，独占模式不会进入系统混音。
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







